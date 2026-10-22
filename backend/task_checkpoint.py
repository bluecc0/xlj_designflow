"""Durable task checkpoints and process locks shared by new and recovered workers."""
from __future__ import annotations

import hashlib
import os
import threading
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from typing import Callable

from .config import settings

_checkpoint: ContextVar[Callable | None] = ContextVar("generation_checkpoint", default=None)
_guard = threading.Lock()
_held: set[str] = set()


class CheckpointError(RuntimeError):
    """A checkpoint could not be persisted; do not submit another paid request."""


class UpstreamTaskFailed(RuntimeError):
    """The upstream explicitly reported a terminal task failure."""


def checkpoint(phase: str, **values) -> None:
    callback = _checkpoint.get()
    if callback:
        try:
            callback(phase, **values)
        except Exception as exc:
            raise CheckpointError("无法保存任务恢复信息") from exc


@contextmanager
def checkpoint_handler(callback):
    token = _checkpoint.set(callback)
    try:
        yield
    finally:
        _checkpoint.reset(token)


def atomic_write(path: Path, content: bytes) -> None:
    """Only expose complete results, including when a process dies during export."""
    import uuid
    temp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with temp.open("wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


@contextmanager
def execution_lock(key: str):
    """Nonblocking OS lock. A crashed process releases it; lock files stay in place.

    The in-process set is also needed because POSIX locks belong to processes,
    while compose workers may run in different threads in the same process.
    """
    digest = hashlib.sha256(key.encode()).hexdigest()
    directory = settings.output_path / ".task-locks"
    directory.mkdir(parents=True, exist_ok=True)
    with _guard:
        busy = digest in _held
        if not busy:
            _held.add(digest)
    if busy:
        yield False
        return
    stream = None
    locked = False
    try:
        stream = (directory / digest).open("a+b")
        if stream.seek(0, os.SEEK_END) == 0:
            stream.write(b"0")
            stream.flush()
        stream.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            locked = True
        except OSError:
            pass
        yield locked
    finally:
        if stream is not None:
            if locked:
                stream.seek(0)
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
            stream.close()
        with _guard:
            _held.discard(digest)

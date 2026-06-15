from __future__ import annotations

import asyncio
import concurrent.futures
import sys
import threading
from pathlib import Path

from .config import settings


_loop: asyncio.AbstractEventLoop | None = None
_thread: threading.Thread | None = None
_ready = threading.Event()
_lock = threading.Lock()


def _get_relay():
    try:
        from .browser import relay
        return relay
    except ModuleNotFoundError as exc:
        if exc.name == "playwright":
            raise RuntimeError(
                "未安装 Playwright。请在主项目环境中执行: pip install playwright && python -m playwright install chromium"
            ) from exc
        raise


def _thread_main() -> None:
    global _loop
    if sys.platform == "win32":
        loop = asyncio.ProactorEventLoop()
    else:
        loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    _loop = loop
    _ready.set()
    loop.run_forever()
    try:
        pending = asyncio.all_tasks(loop)
        for task in pending:
            task.cancel()
        if pending:
            loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
    finally:
        loop.close()


def _ensure_thread() -> asyncio.AbstractEventLoop:
    global _thread
    with _lock:
        if _thread is None or not _thread.is_alive():
            _ready.clear()
            _thread = threading.Thread(target=_thread_main, name="proxy-download-relay", daemon=True)
            _thread.start()
            _ready.wait(timeout=10)
        if _loop is None:
            raise RuntimeError("下载代理事件循环启动失败")
        return _loop


async def _submit(coro, timeout_seconds: int | None = None):
    loop = _ensure_thread()
    future = asyncio.run_coroutine_threadsafe(coro, loop)
    wrapped = asyncio.wrap_future(future)
    try:
        if timeout_seconds is None:
            return await wrapped
        return await asyncio.wait_for(wrapped, timeout=max(1, timeout_seconds))
    except asyncio.TimeoutError:
        future.cancel()
        raise TimeoutError(f"下载代理执行超时（>{timeout_seconds}s）")


async def _ensure_started_impl() -> None:
    relay = _get_relay()
    await relay.ensure_started()


async def ensure_started() -> None:
    await _submit(_ensure_started_impl(), timeout_seconds=30)


async def _stop_impl() -> None:
    relay = _get_relay()
    await relay.stop()


async def stop() -> None:
    global _loop, _thread
    if _thread is None or _loop is None:
        return
    try:
        await _submit(_stop_impl())
    except RuntimeError:
        return
    finally:
        loop = _loop
        thread = _thread
        _loop = None
        _thread = None
        if loop is not None:
            loop.call_soon_threadsafe(loop.stop)
        if thread is not None:
            thread.join(timeout=5)


async def _login_shell_impl() -> None:
    relay = _get_relay()
    await relay.login_shell()


async def login_shell() -> None:
    await _submit(_login_shell_impl())


async def _inspect_impl(source_url: str) -> dict[str, object]:
    relay = _get_relay()
    return await relay.inspect(source_url)


async def inspect_url(source_url: str) -> dict[str, object]:
    return await _submit(
        _inspect_impl(source_url),
        timeout_seconds=max(15, settings.relay_request_timeout_seconds),
    )


async def _download_impl(source_url: str, download_format: str | None) -> tuple[Path, dict[str, object]]:
    relay = _get_relay()
    return await relay.fetch_with_format(source_url, download_format)


async def download_url(source_url: str, download_format: str | None = None) -> tuple[Path, dict[str, object]]:
    return await _submit(
        _download_impl(source_url, download_format),
        timeout_seconds=max(30, settings.relay_request_timeout_seconds),
    )


async def _check_login_impl() -> dict[str, object]:
    relay = _get_relay()
    return await relay.check_login_status()


async def check_login_status() -> dict[str, object]:
    return await _submit(
        _check_login_impl(),
        timeout_seconds=max(10, min(settings.relay_request_timeout_seconds, 30)),
    )


async def _trigger_login_impl() -> None:
    relay = _get_relay()
    await relay.trigger_login()


async def trigger_login() -> None:
    await _submit(_trigger_login_impl(), timeout_seconds=60)

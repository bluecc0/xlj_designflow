"""会话服务：轮次生命周期、事件落库与推送、上传图片登记。"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from pathlib import Path
from typing import AsyncIterator

from ..config import settings
from . import store
from .engine import ModelClient, RoutedModelClient, Tool, run_loop
from .prompts import build_system_prompt
from .tools import build_tools

logger = logging.getLogger(__name__)

_NEXT_RE = re.compile(r"\[\[NEXT:\s*(.+?)\]\]\s*$", re.S)
_running: dict[str, asyncio.Task] = {}

# 测试可替换
model_factory = RoutedModelClient
tools_factory = build_tools


def sse(event: dict) -> str:
    return f"event: {event['type']}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"


def save_upload(user: dict, session_id: str, data: bytes, filename: str) -> dict:
    suffix = Path(filename or "").suffix.lower() or ".png"
    if suffix not in {".png", ".jpg", ".jpeg", ".webp"}:
        suffix = ".png"
    safe_user = re.sub(r"[^A-Za-z0-9_-]", "_", str(user["id"])) or "user"
    folder = settings.output_path / "agent2-uploads" / safe_user / session_id
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{uuid.uuid4().hex}{suffix}"
    path.write_bytes(data)
    url = "/output/" + path.relative_to(settings.output_path).as_posix()
    return store.create_artifact(session_id=session_id, user_id=user["id"], kind="upload", url=url,
                                 path=str(path), label=filename or "")


def _split_next(text: str) -> tuple[str, list[str]]:
    match = _NEXT_RE.search(text or "")
    if not match:
        return text, []
    options = [o.strip() for o in match.group(1).split("|") if o.strip()][:3]
    return text[:match.start()].rstrip(), options


async def _drive(*, user: dict, session: dict, turn_id: str, messages: list[dict],
                 tools: dict[str, Tool], model: ModelClient) -> AsyncIterator[str]:
    """运行引擎；事件先落库，再通过队列按顺序推给前端。"""
    queue: asyncio.Queue = asyncio.Queue()
    session_id = session["id"]

    async def emit(event_type: str, payload: dict) -> None:
        event = store.append_event(session_id, turn_id, event_type, payload)
        if event_type in {"tool.started", "tool.finished"}:
            store.record_tool_call(payload["call_id"], turn_id, payload["tool"], payload.get("args") or {},
                                   "running" if event_type == "tool.started" else ("done" if payload.get("ok") else "failed"),
                                   result=payload.get("result"), duration_ms=payload.get("duration_ms"))
        await queue.put(event)

    system = {"role": "system", "content": build_system_prompt(_user_skill_dir(user))}

    async def runner():
        try:
            result = await run_loop(model=model, tools=tools, messages=[system] + messages, emit=emit,
                                    ctx_base={"user": user, "session_id": session_id, "turn_id": turn_id, "state": {}})
            convo = result.messages[1:]
            title = session.get("title") or next(
                (str(m.get("content"))[:30] for m in convo if m.get("role") == "user"), "")
            store.save_session_messages(session_id, convo, title=title)
            if result.status == "waiting_user":
                store.update_turn(turn_id, status="waiting_user", engine_state={"pending": result.pending})
            else:
                text, options = _split_next(result.text)
                if options:
                    await emit("suggestions", {"options": options})
                await emit("turn.finished", {"text": text})
                store.update_turn(turn_id, status="done")
        except asyncio.CancelledError:
            store.update_turn(turn_id, status="cancelled")
            await emit("turn.cancelled", {})
        except Exception as exc:
            logger.exception("[agent2] turn %s failed", turn_id)
            store.update_turn(turn_id, status="failed", error=str(exc)[:500])
            await emit("turn.failed", {"message": str(exc)[:300]})
        finally:
            _running.pop(turn_id, None)
            await queue.put(None)

    task = asyncio.create_task(runner())
    _running[turn_id] = task
    while True:
        event = await queue.get()
        if event is None:
            break
        yield sse(event)


def _user_skill_dir(user: dict):
    from .. import main
    return main._user_skill_dir(user)


async def start_turn(user: dict, session: dict, text: str, uploads: list[dict], skill: str = "") -> AsyncIterator[str]:
    turn = store.create_turn(session["id"], user["id"], text)
    first = store.append_event(session["id"], turn["id"], "turn.started", {
        "text": text, "uploads": [{"id": u["id"], "url": u["url"]} for u in uploads]})
    yield sse(first)
    session = {**session, "title": session.get("title") or (text or "参考图")[:30]}
    content = text
    if skill:
        content = f"[用户选择了技能：{skill}，请先用 load_skill 加载它再执行]\n{content}"
    if uploads:
        content += "\n\n[用户上传了图片：" + "、".join(u["id"] for u in uploads) + "]"
    messages = store.load_session_messages(session) + [{"role": "user", "content": content}]
    async for chunk in _drive(user=user, session=session, turn_id=turn["id"], messages=messages,
                              tools=tools_factory(), model=model_factory()):
        yield chunk


async def resume_turn(user: dict, session: dict, turn: dict, answer: str) -> AsyncIterator[str]:
    state = json.loads(turn.get("engine_state") or "{}")
    pending = state.get("pending") or {}
    if turn["status"] != "waiting_user" or not pending.get("call_id"):
        raise ValueError("这一轮没有在等待回答")
    store.update_turn(turn["id"], status="running")
    yield sse(store.append_event(session["id"], turn["id"], "input.answered", {"answer": answer}))
    messages = store.load_session_messages(session) + [{
        "role": "tool", "tool_call_id": pending["call_id"],
        "content": json.dumps({"answer": answer}, ensure_ascii=False)}]
    async for chunk in _drive(user=user, session=session, turn_id=turn["id"], messages=messages,
                              tools=tools_factory(), model=model_factory()):
        yield chunk


def cancel_turn(turn_id: str) -> bool:
    task = _running.get(turn_id)
    if not task:
        return False
    task.cancel()
    return True

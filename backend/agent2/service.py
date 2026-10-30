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
from . import memory, store
from .context import ContextManager
from .engine import ModelClient, RoutedModelClient, Tool, run_loop, user_cancelled
from .prompts import build_system_prompt
from .tools import build_tools

logger = logging.getLogger(__name__)

_NEXT_RE = re.compile(r"\[\[NEXT:\s*(.+?)\]\]\s*$", re.S)
_running: dict[str, asyncio.Task] = {}
INTERRUPTED_NOTE = "这一步没有完成（本轮被停止、中断，或用户改发了新消息）"


class TurnBusy(Exception):
    """同一会话已有运行中的轮次。"""

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


def settle_tool_calls(convo: list[dict], note: str = INTERRUPTED_NOTE) -> list[dict]:
    """补齐没有结果的工具调用，保证消息序列合法；这次调用已经生成的图片 ID 一并写进结果。"""
    answered = {m.get("tool_call_id") for m in convo if m.get("role") == "tool"}
    out: list[dict] = []
    pending: list[dict] = []

    def flush():
        for call in pending:
            result = {"error": note}
            images = store.list_call_artifacts(call["id"])
            if images:
                result["images"] = images
            out.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(result, ensure_ascii=False)})
        pending.clear()

    for m in convo:
        if m.get("role") != "tool":
            flush()
        out.append(m)
        if m.get("role") == "assistant" and m.get("tool_calls"):
            pending.extend(c for c in m["tool_calls"] if c.get("id") not in answered)
    flush()
    return out


async def _drive(*, user: dict, session: dict, turn_id: str, messages: list[dict],
                 tools: dict[str, Tool], model: ModelClient, request: str = "") -> AsyncIterator[str]:
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

    system = {"role": "system", "content": build_system_prompt(_user_skill_dir(user), memory.memory_index(user["id"]))}
    context = ContextManager(session, emit)

    full = [system] + messages
    title = session.get("title") or next((str(m.get("content"))[:30] for m in messages if m.get("role") == "user"), "")

    def save(msgs: list[dict], settle: bool = False) -> None:
        convo = msgs[1:]
        store.save_session_messages(session_id, settle_tool_calls(convo) if settle else convo, title=title)

    async def runner():
        try:
            save(full)  # 本轮的用户输入先落库
            result = await run_loop(model=model, tools=tools, messages=full, emit=emit,
                                    ctx_base={"user": user, "session_id": session_id, "turn_id": turn_id,
                                              "state": {"request": request}},
                                    prepare=context.prepare, checkpoint=save)
            save(result.messages)
            if result.status == "waiting_user":
                store.update_turn(turn_id, status="waiting_user", engine_state={"pending": result.pending})
            else:
                text, options = _split_next(result.text)
                if options:
                    await emit("suggestions", {"options": options})
                await emit("turn.finished", {"text": text})
                store.update_turn(turn_id, status="done")
        except asyncio.CancelledError:
            save(full, settle=True)
            store.update_turn(turn_id, status="cancelled")
            await emit("turn.cancelled", {})
        except Exception as exc:
            logger.exception("[agent2] turn %s failed", turn_id)
            save(full, settle=True)
            store.update_turn(turn_id, status="failed", error=str(exc)[:500])
            await emit("turn.failed", {"message": str(exc)[:300]})
        finally:
            _running.pop(turn_id, None)
            user_cancelled.discard(turn_id)
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


def claim_turn(user: dict, session: dict, text: str) -> dict:
    turn = store.claim_turn(session["id"], user["id"], text)
    if not turn:
        raise TurnBusy("上一轮还在进行中，请等它完成或先停止")
    return turn


async def start_turn(user: dict, session: dict, text: str, uploads: list[dict], skill: str = "",
                     turn: dict | None = None) -> AsyncIterator[str]:
    turn = turn or claim_turn(user, session, text)
    session = store.get_session(session["id"], user["id"]) or session  # 占用后读最新历史
    first = store.append_event(session["id"], turn["id"], "turn.started", {
        "text": text, "uploads": [{"id": u["id"], "url": u["url"]} for u in uploads]})
    yield sse(first)
    session = {**session, "title": session.get("title") or (text or "参考图")[:30]}
    content = text
    if skill:
        content = f"[用户选择了技能：{skill}，请先用 load_skill 加载它再执行]\n{content}"
    if uploads:
        content += "\n\n[用户上传了图片：" + "、".join(u["id"] for u in uploads) + "]"
    recovered = store.take_unannounced_recovered(session["id"])
    if recovered:
        content += "\n\n[服务重启后，之前没完成的生图已在后台补回：" + "、".join(
            r["id"] + (f"（{r['label']}）" if r.get("label") else "") for r in recovered) + "]"
    messages = settle_tool_calls(store.load_session_messages(session)) + [{"role": "user", "content": content}]
    async for chunk in _drive(user=user, session=session, turn_id=turn["id"], messages=messages,
                              tools=tools_factory(), model=model_factory(), request=text):
        yield chunk


async def resume_turn(user: dict, session: dict, turn: dict, answer: str, claimed: bool = False) -> AsyncIterator[str]:
    state = json.loads(turn.get("engine_state") or "{}")
    pending = state.get("pending") or {}
    if not pending.get("call_id") or not (claimed or store.claim_answer(turn["id"], user["id"])):
        raise ValueError("这一轮没有在等待回答")
    session = store.get_session(session["id"], user["id"]) or session
    yield sse(store.append_event(session["id"], turn["id"], "input.answered", {"answer": answer}))
    messages = store.load_session_messages(session) + [{
        "role": "tool", "tool_call_id": pending["call_id"],
        "content": json.dumps({"answer": answer}, ensure_ascii=False)}]
    request = f"{turn.get('user_input') or ''}（补充：{answer}）"
    async for chunk in _drive(user=user, session=session, turn_id=turn["id"], messages=messages,
                              tools=tools_factory(), model=model_factory(), request=request):
        yield chunk


def cancel_turn(turn_id: str) -> bool:
    task = _running.get(turn_id)
    if not task:
        return False
    user_cancelled.add(turn_id)
    task.cancel()
    return True


def fail_stale_turns() -> None:
    """服务启动时调用：上次进程中断的轮次标记失败并推送终态事件，前端续接时能结束等待。"""
    message = "服务重启，本轮已中断；已提交的生图任务会在后台继续，完成后图片会补回到这里"
    for row in store.fail_stale_turns(message):
        store.append_event(row["session_id"], row["id"], "turn.failed", {"message": message})

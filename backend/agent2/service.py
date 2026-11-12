"""会话服务：轮次生命周期、事件落库与推送、上传图片登记。"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from pathlib import Path
from typing import AsyncIterator

from ..ai_image import _safe_user_id
from ..character_cards import build_agent_note, load_card_refs
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


TABLE_SUFFIXES = {".xlsx", ".xlsm", ".csv"}


def slim_table(data: bytes, filename: str) -> bytes:
    """表格保存前去掉嵌入图片和外部链接缓存（核对用不到，带着动辄上百 MB）。耗 CPU，调用方放到工作线程里跑。"""
    from ..price_check import slim_xlsx
    return slim_xlsx(data, filename)


def save_upload(user: dict, session_id: str, data: bytes, filename: str) -> dict:
    suffix = Path(filename or "").suffix.lower() or ".png"
    kind = "table" if suffix in TABLE_SUFFIXES else "upload"
    if kind == "upload" and suffix not in {".png", ".jpg", ".jpeg", ".webp"}:
        suffix = ".png"
    safe_user = re.sub(r"[^A-Za-z0-9_-]", "_", str(user["id"])) or "user"
    folder = settings.output_path / "agent2-uploads" / safe_user / session_id
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{uuid.uuid4().hex}{suffix}"
    path.write_bytes(data)
    url = "/output/" + path.relative_to(settings.output_path).as_posix()
    return store.create_artifact(session_id=session_id, user_id=user["id"], kind=kind, url=url,
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

    async def publish(event: dict) -> None:
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
                                              "state": {"request": request}, "publish": publish},
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
            if turn_id in user_cancelled:
                store.update_turn(turn_id, status="cancelled")
                await emit("turn.cancelled", {})
            else:
                # 关服、reload 等非用户取消：记为中断而不是停止，已提交的任务完成后照常补回
                store.update_turn(turn_id, status="failed", error=INTERRUPTED_MESSAGE)
                await emit("turn.failed", {"message": INTERRUPTED_MESSAGE})
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


# 只有用户点停止才记 cancelled（补交付据此跳过）；其余取消一律按服务中断处理
INTERRUPTED_MESSAGE = "服务重启，本轮已中断；已提交的任务会在后台继续，完成后结果会补回到这里"


def _user_skill_dir(user: dict):
    from .. import main
    return main._user_skill_dir(user)


def claim_turn(user: dict, session: dict, text: str) -> dict:
    turn = store.claim_turn(session["id"], user["id"], text)
    if not turn:
        raise TurnBusy("上一轮还在进行中，请等它完成或先停止")
    return turn


def register_characters(user: dict, session_id: str, cards: list[dict]) -> list[dict]:
    """把角色图登记成本会话的图片 ID，返回带 artifact_ids 的人物列表。同一张图只登记一次，连续几轮选同一个角色不会重复复制。
    复制一份：卡片之后被修改、删除或取消共享，会话里的图片 ID 仍然可用。不进对话卡片，也不放进画布。"""
    registered = store.character_artifact_ids(session_id)
    people = []
    for card in cards:
        person = {"id": card["id"], "name": card["name"], "gender": card["gender"], "description": card["description"]}
        ids = []
        for image, (data, name) in zip(card["images"], load_card_refs([card])):
            artifact_id = registered.get(image["id"])
            if not artifact_id:
                file_name = f"{uuid.uuid4().hex}{Path(name).suffix}"
                out = settings.output_path / "ai-images" / _safe_user_id(user["id"]) / "character-refs" / file_name
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_bytes(data)
                artifact_id = store.create_artifact(
                    session_id=session_id, user_id=user["id"], kind="character_ref",
                    url=f"/ai-images/{_safe_user_id(user['id'])}/character-refs/{file_name}", path=str(out),
                    label=card["name"], meta={"operation": "character_ref", "card_id": card["id"], "image_id": image["id"], "person": person},
                )["id"]
            ids.append(artifact_id)
        people.append({**person, "artifact_ids": ids})
    return people


async def start_turn(user: dict, session: dict, text: str, uploads: list[dict], skill: str = "",
                     turn: dict | None = None, characters: list[dict] | None = None) -> AsyncIterator[str]:
    turn = turn or claim_turn(user, session, text)
    session = store.get_session(session["id"], user["id"]) or session  # 占用后读最新历史
    # skill 记下用户选择的技能，用于技能使用统计
    first = store.append_event(session["id"], turn["id"], "turn.started", {
        "text": text, "uploads": _upload_payload(uploads),
        **({"skill": skill} if skill else {}),
        **({"characters": characters} if characters else {})})
    yield sse(first)
    session = {**session, "title": session.get("title") or (text or "参考图")[:30]}
    content = text
    if skill:
        content = f"[用户选择了技能：{skill}，请先用 load_skill 加载它再执行]\n{content}"
    content += upload_note(uploads)
    if characters:
        content += build_agent_note(characters)
    recovered = store.take_unannounced_recovered(session["id"])
    if recovered:
        content += "\n\n[服务重启后，之前没完成的生图已在后台补回：" + "、".join(
            r["id"] + (f"（{r['label']}）" if r.get("label") else "") for r in recovered) + "]"
    messages = settle_tool_calls(store.load_session_messages(session)) + [{"role": "user", "content": content}]
    async for chunk in _drive(user=user, session=session, turn_id=turn["id"], messages=messages,
                              tools=tools_factory(), model=model_factory(), request=text):
        yield chunk


def upload_note(uploads: list[dict]) -> str:
    """告诉模型这次上传了哪些图片和表格（ID 才能给工具用）。"""
    pictures = [u for u in uploads if u["kind"] != "table"]
    tables = [u for u in uploads if u["kind"] == "table"]
    note = ""
    if pictures:
        note += "\n\n[用户上传了图片：" + "、".join(u["id"] for u in pictures) + "]"
    if tables:
        note += "\n\n[用户上传了表格：" + "、".join(f"{u['id']}（{u['label']}）" for u in tables) + "]"
    return note


def _upload_payload(uploads: list[dict]) -> list[dict]:
    return [{"id": u["id"], "url": u["url"], "kind": u["kind"], "name": u["label"]} for u in uploads]


async def resume_turn(user: dict, session: dict, turn: dict, answer: str, claimed: bool = False,
                      uploads: list[dict] | None = None) -> AsyncIterator[str]:
    state = json.loads(turn.get("engine_state") or "{}")
    pending = state.get("pending") or {}
    if not pending.get("call_id") or not (claimed or store.claim_answer(turn["id"], user["id"])):
        raise ValueError("这一轮没有在等待回答")
    session = store.get_session(session["id"], user["id"]) or session
    uploads = uploads or []
    yield sse(store.append_event(session["id"], turn["id"], "input.answered",
                                 {"answer": answer, **({"uploads": _upload_payload(uploads)} if uploads else {})}))
    reply = (answer or "（没有文字，只上传了附件）") + upload_note(uploads)
    messages = store.load_session_messages(session) + [{
        "role": "tool", "tool_call_id": pending["call_id"],
        "content": json.dumps({"answer": reply}, ensure_ascii=False)}]
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
    for row in store.fail_stale_turns(INTERRUPTED_MESSAGE):
        store.append_event(row["session_id"], row["id"], "turn.failed", {"message": INTERRUPTED_MESSAGE})

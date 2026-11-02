"""新版 Agent 的 HTTP 接口。鉴权沿用全局中间件（request.state.user）。"""
from __future__ import annotations

import io

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from PIL import Image

from . import service, store

router = APIRouter(prefix="/agent2")

MAX_UPLOADS = 9  # 与输入框参考图上限一致（换装最多 1 张人物 + 8 张服装）
MAX_UPLOAD_BYTES = 20 * 1024 * 1024


def _is_image(data: bytes) -> bool:
    try:
        with Image.open(io.BytesIO(data)) as img:
            img.verify()
        return True
    except Exception:
        return False


def _user(request: Request) -> dict:
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(401, "请先登录")
    return user


def _session(request: Request, session_id: str) -> tuple[dict, dict]:
    user = _user(request)
    session = store.get_session(session_id, user["id"])
    if not session:
        raise HTTPException(404, "会话不存在")
    return user, session


def _stream(gen) -> StreamingResponse:
    return StreamingResponse(gen, media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/sessions")
def create_session(request: Request):
    return store.create_session(_user(request)["id"])


@router.get("/sessions")
def list_sessions(request: Request):
    return {"sessions": store.list_sessions(_user(request)["id"])}


@router.get("/sessions/{session_id}")
def get_session(request: Request, session_id: str, after_seq: int = 0):
    _user_, session = _session(request, session_id)
    # active_turn：刷新或断线后，前端据此按 seq 续接事件直到这一轮结束；
    # pending_jobs：还有后台生图没交付时，前端在本轮结束后继续低频轮询，接收重启恢复后补回的图片。
    # 三者来自同一个读事务，前端据此停止轮询时不会漏掉刚写入的事件
    return {"session": {k: session[k] for k in ("id", "title", "created_at", "updated_at")},
            **store.session_snapshot(session_id, after_seq)}


@router.delete("/sessions/{session_id}")
def delete_session(request: Request, session_id: str):
    if not store.delete_session(session_id, _user(request)["id"]):
        raise HTTPException(404, "会话不存在")
    return {"ok": True}


@router.post("/sessions/{session_id}/messages")
async def send_message(request: Request, session_id: str, message: str = Form(""), skill: str = Form(""),
                       images: list[UploadFile] = File(default=[])):
    user, session = _session(request, session_id)
    text = message.strip()
    if not text and not images:
        raise HTTPException(400, "消息不能为空")
    if len(images or []) > MAX_UPLOADS:
        raise HTTPException(400, f"一次最多上传 {MAX_UPLOADS} 张图片")
    files = []
    for upload in images or []:
        data = await upload.read(MAX_UPLOAD_BYTES + 1)
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(400, "单张图片不能超过 20MB")
        if data and not _is_image(data):
            raise HTTPException(400, f"{upload.filename or '文件'} 不是图片；Agent 目前只支持上传图片")
        if data:
            files.append((data, upload.filename or ""))
    # 校验通过后再占用会话，避免报错留下一直"运行中"的轮次
    try:
        turn = service.claim_turn(user, session, text)
    except service.TurnBusy as exc:
        raise HTTPException(409, str(exc))
    uploads = [service.save_upload(user, session_id, data, name) for data, name in files]
    return _stream(service.start_turn(user, session, text, uploads, skill=skill.strip(), turn=turn))


@router.post("/turns/{turn_id}/answer")
async def answer(request: Request, turn_id: str, answer: str = Form(...)):
    user = _user(request)
    turn = store.get_turn(turn_id, user["id"])
    if not turn:
        raise HTTPException(404, "轮次不存在")
    _user_, session = _session(request, turn["session_id"])
    if not store.claim_answer(turn_id, user["id"]):
        raise HTTPException(409, "这一轮没有在等待回答")
    return _stream(service.resume_turn(user, session, turn, answer.strip(), claimed=True))


@router.post("/turns/{turn_id}/cancel")
def cancel(request: Request, turn_id: str):
    user = _user(request)
    if not store.get_turn(turn_id, user["id"]):
        raise HTTPException(404, "轮次不存在")
    return {"cancelled": service.cancel_turn(turn_id)}


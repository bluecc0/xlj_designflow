"""个人设置：头像、昵称、修改密码和使用偏好。

头像沿用 avatars/{登录用户名}.png；昵称和使用偏好按用户 id 存在数据库，跟着账号走。
昵称只在用户自己的界面显示（右上角、Agent 欢迎语）；别人看到的名字（团队画布、共享角色卡）
用 login_users.json 里管理员设置的真实姓名 display_name，后台统计也按 user id 映射它，用户改不了。
"""
from __future__ import annotations

import io
import json
import sqlite3
import time
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Request, Response, UploadFile

from .config import settings
from .job_store import _connect, _lock, create_session, hash_password, log_operation, verify_password

router = APIRouter(prefix="/auth")

SESSION_COOKIE = "designflow_session"
AVATAR_MAX_BYTES = 5 * 1024 * 1024
NICKNAME_MAX = 40
PASSWORD_MIN = 6

PREFERENCE_DEFAULTS: dict[str, str] = {
    "send_shortcut": "enter",
    "default_model": "gpt-image-2.6",
    "default_ratio": "auto",
    "default_resolution": "1K",
}
PREFERENCE_CHOICES: dict[str, set[str]] = {
    # enter：Enter 发送、Shift+Enter 换行；mod_enter：Ctrl/⌘+Enter 发送、Enter 换行
    "send_shortcut": {"enter", "mod_enter"},
    "default_model": {"gpt-image-2.6", "gpt-image-2", "nano-banana-pro", "nano-banana-2.1", "seedream-5-0-flash"},
    "default_ratio": {"auto", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "16:9", "9:16"},
    "default_resolution": {"1K", "2K", "4K"},
}


_PREFERENCES_TABLE = """
    CREATE TABLE IF NOT EXISTS user_preferences (
        user_id     TEXT PRIMARY KEY,
        prefs_json  TEXT NOT NULL DEFAULT '{}',
        updated_at  REAL NOT NULL
    )
"""


_PROFILES_TABLE = """
    CREATE TABLE IF NOT EXISTS user_profiles (
        user_id     TEXT PRIMARY KEY,
        nickname    TEXT NOT NULL DEFAULT '',
        updated_at  REAL NOT NULL
    )
"""


def init_user_profile_tables() -> None:
    with _connect() as conn:
        conn.execute(_PREFERENCES_TABLE)
        conn.execute(_PROFILES_TABLE)
        conn.commit()


# ─── 头像 ─────────────────────────────────────────────────────────────────────

def _avatar_dir() -> Path:
    return settings.root_dir / "avatars"


def _avatar_safe_name(username: str) -> str:
    return "".join(ch for ch in str(username or "") if ch.isalnum() or ch in "._-") or "unknown"


def avatar_path(username: str) -> Path:
    return _avatar_dir() / f"{_avatar_safe_name(username)}.png"


def avatar_url(username: str) -> str:
    """有头像时返回带版本号的地址（换头像后浏览器不会继续用旧缓存），没有返回空字符串。"""
    path = avatar_path(username)
    try:
        version = path.stat().st_mtime_ns
    except OSError:
        return ""
    return f"/avatars/{path.name}?v={version}"


def avatar_url_for_user_id(user_id: str) -> str:
    for item in settings.allowed_login_users:
        if str(item.get("id", "")).strip() == str(user_id or ""):
            return avatar_url(str(item.get("username", "")))
    return ""


def save_avatar(username: str, content: bytes) -> str:
    if not content:
        raise HTTPException(400, "图片内容为空")
    if len(content) > AVATAR_MAX_BYTES:
        raise HTTPException(400, "头像图片不能超过 5MB")
    from PIL import Image, UnidentifiedImageError

    try:
        with Image.open(io.BytesIO(content)) as img:
            img = img.convert("RGBA")
            # 居中裁成正方形，再缩到 256 以内
            side = min(img.size)
            left, top = (img.width - side) // 2, (img.height - side) // 2
            img = img.crop((left, top, left + side, top + side))
            img.thumbnail((256, 256), Image.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, format="PNG")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise HTTPException(400, "请上传 PNG、JPEG 或 WebP 图片") from exc
    path = avatar_path(username)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(buf.getvalue())
    return avatar_url(username)


# ─── 偏好 ─────────────────────────────────────────────────────────────────────

def load_preferences(user_id: str) -> dict[str, str]:
    with _connect() as conn:
        try:
            row = conn.execute("SELECT prefs_json FROM user_preferences WHERE user_id = ?", (user_id,)).fetchone()
        except sqlite3.OperationalError:
            # 表还没建（没走启动流程的场景）：按默认值返回
            row = None
    try:
        stored = json.loads(row["prefs_json"]) if row else {}
    except Exception:
        stored = {}
    prefs = dict(PREFERENCE_DEFAULTS)
    for key, value in (stored if isinstance(stored, dict) else {}).items():
        if key in PREFERENCE_CHOICES and value in PREFERENCE_CHOICES[key]:
            prefs[key] = value
    return prefs


def save_preferences(user_id: str, patch: dict) -> dict[str, str]:
    if not isinstance(patch, dict) or not patch:
        raise HTTPException(400, "没有要保存的设置")
    for key, value in patch.items():
        if key not in PREFERENCE_CHOICES:
            raise HTTPException(400, f"不支持的设置项：{key}")
        if value not in PREFERENCE_CHOICES[key]:
            raise HTTPException(400, f"设置项 {key} 的取值无效")
    with _lock, _connect() as conn:
        conn.execute(_PREFERENCES_TABLE)
        row = conn.execute("SELECT prefs_json FROM user_preferences WHERE user_id = ?", (user_id,)).fetchone()
        try:
            stored = json.loads(row["prefs_json"]) if row else {}
        except Exception:
            stored = {}
        stored = {**(stored if isinstance(stored, dict) else {}), **patch}
        conn.execute(
            "INSERT INTO user_preferences (user_id, prefs_json, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(user_id) DO UPDATE SET prefs_json = excluded.prefs_json, updated_at = excluded.updated_at",
            (user_id, json.dumps(stored, ensure_ascii=False), time.time()),
        )
        conn.commit()
    return load_preferences(user_id)


# ─── 账号 ─────────────────────────────────────────────────────────────────────

def _login_entry(user_id: str) -> dict | None:
    for item in settings.allowed_login_users:
        if str(item.get("id", "")).strip() == str(user_id or ""):
            return item
    return None


def get_nickname(user_id: str) -> str:
    with _connect() as conn:
        try:
            row = conn.execute("SELECT nickname FROM user_profiles WHERE user_id = ?", (str(user_id or ""),)).fetchone()
        except sqlite3.OperationalError:
            return ""
    return str(row["nickname"]) if row else ""


def real_name(user: dict) -> str:
    """给其他成员看的名字：管理员设置的真实姓名，没设置就用登录名。"""
    entry = _login_entry(str(user.get("id") or "")) or {}
    return str(entry.get("display_name") or "").strip() or str(user.get("username") or user.get("id") or "")


def public_user(user: dict) -> dict:
    """返回给前端的当前用户：在会话用户基础上补上昵称、头像和偏好，不含密码哈希和后台真实姓名。"""
    return {
        "id": user.get("id", ""),
        "username": user.get("username", ""),
        "nickname": get_nickname(str(user.get("id", ""))),
        "role": user.get("role", "user"),
        "created_at": user.get("created_at"),
        "avatar_url": avatar_url(user.get("username", "")),
        "preferences": load_preferences(str(user.get("id", ""))),
    }


def _update_login_entry(user_id: str, **fields) -> None:
    users = [dict(item) for item in settings.allowed_login_users]
    for item in users:
        if str(item.get("id", "")).strip() == user_id:
            item.update(fields)
            break
    else:
        raise HTTPException(404, "账号不存在")
    settings.save_login_users(users)


def set_nickname(user: dict, nickname: str) -> dict:
    clean = " ".join(str(nickname or "").split())
    if len(clean) > NICKNAME_MAX:
        raise HTTPException(400, f"昵称不能超过 {NICKNAME_MAX} 个字符")
    with _lock, _connect() as conn:
        conn.execute(_PROFILES_TABLE)
        conn.execute(
            "INSERT INTO user_profiles (user_id, nickname, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(user_id) DO UPDATE SET nickname = excluded.nickname, updated_at = excluded.updated_at",
            (str(user["id"]), clean, time.time()),
        )
        conn.commit()
    return public_user(user)


def change_password(user: dict, old_password: str, new_password: str) -> None:
    entry = _login_entry(user["id"])
    if not entry:
        raise HTTPException(404, "账号不存在")
    if not verify_password(old_password or "", str(entry.get("password_hash") or "")):
        raise HTTPException(400, "当前密码输入有误，请重新输入")
    if len(new_password or "") < PASSWORD_MIN:
        raise HTTPException(400, f"新密码至少 {PASSWORD_MIN} 位")
    if new_password == old_password:
        raise HTTPException(400, "新密码不能与当前密码相同")
    # 改了密码哈希后，已有会话（包括其他设备）都会失效
    _update_login_entry(str(user["id"]), password_hash=hash_password(new_password))


# ─── 路由 ─────────────────────────────────────────────────────────────────────

def _user(request: Request) -> dict:
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(401, "请先登录")
    return user


@router.put("/preferences")
async def api_save_preferences(request: Request):
    user = _user(request)
    body = await request.json()
    return {"preferences": save_preferences(str(user["id"]), body if isinstance(body, dict) else {})}


@router.put("/profile")
async def api_save_profile(request: Request):
    user = _user(request)
    body = await request.json()
    if not isinstance(body, dict) or "nickname" not in body:
        raise HTTPException(400, "缺少昵称")
    updated = set_nickname(user, body.get("nickname"))
    log_operation(user_id=user["id"], username=user["username"], action="profile_update",
                  payload=json.dumps({"nickname": updated["nickname"]}, ensure_ascii=False))
    return {"user": updated}


@router.post("/password")
async def api_change_password(request: Request, response: Response):
    user = _user(request)
    body = await request.json()
    body = body if isinstance(body, dict) else {}
    change_password(user, str(body.get("old_password") or ""), str(body.get("new_password") or ""))
    # 当前浏览器换一个新会话继续保持登录
    response.set_cookie(SESSION_COOKIE, create_session(user["id"]), httponly=True, samesite="lax",
                        max_age=60 * 60 * 24 * 30, path="/")
    log_operation(user_id=user["id"], username=user["username"], action="password_change")
    return {"ok": True}


@router.post("/avatar")
async def api_upload_avatar(request: Request, image: UploadFile = File(...)):
    user = _user(request)
    content = await image.read(AVATAR_MAX_BYTES + 1)
    return {"ok": True, "url": save_avatar(str(user.get("username") or user.get("id")), content)}


@router.delete("/avatar")
def api_delete_avatar(request: Request):
    user = _user(request)
    avatar_path(str(user.get("username") or user.get("id"))).unlink(missing_ok=True)
    return {"ok": True}

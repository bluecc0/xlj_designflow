"""
合成任务持久化 — SQLite

在内存 dict 之上添加 SQLite 持久层，后端重启后历史任务仍可查询。
结构：
  jobs(id TEXT PK, status TEXT, request_json TEXT, result_path TEXT,
        error TEXT, progress_json TEXT, created_at REAL, updated_at REAL)
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Optional

from .config import settings
from .models import ComposeJob, ComposeRequest, ComposeStatus


_DB_PATH = settings.root_dir / "jobs.db"
_lock = threading.Lock()


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(str(_DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """建表（幂等），并自动迁移旧表补充新字段"""
    with _connect() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS jobs (
                id               TEXT PRIMARY KEY,
                user_id          TEXT,
                status           TEXT NOT NULL,
                request_json     TEXT NOT NULL,
                result_path      TEXT,
                penpot_file_id   TEXT,
                penpot_edit_url  TEXT,
                error            TEXT,
                progress_json    TEXT NOT NULL DEFAULT '[]',
                created_at       REAL NOT NULL,
                updated_at       REAL NOT NULL
            )
        """)
        # 自动迁移：给旧表补两个新列（已存在会报错但无害）
        for col, typ in [("user_id", "TEXT"), ("penpot_file_id", "TEXT"), ("penpot_edit_url", "TEXT")]:
            try:
                conn.execute(f"ALTER TABLE jobs ADD COLUMN {col} {typ}")
            except sqlite3.OperationalError:
                pass  # 列已存在，忽略

        # 特殊品任务表
        conn.execute("""
            CREATE TABLE IF NOT EXISTS special_jobs (
                id               TEXT PRIMARY KEY,
                user_id          TEXT,
                status           TEXT NOT NULL,
                sku              TEXT,
                request_json     TEXT NOT NULL,
                result_paths_json TEXT,
                result_frame_ids_json TEXT,
                penpot_file_id   TEXT,
                penpot_page_id   TEXT,
                penpot_edit_url  TEXT,
                error            TEXT,
                progress_json    TEXT NOT NULL DEFAULT '[]',
                created_at       REAL NOT NULL,
                updated_at       REAL NOT NULL
            )
        """)
        for col, typ in [("user_id", "TEXT")]:
            try:
                conn.execute(f"ALTER TABLE special_jobs ADD COLUMN {col} {typ}")
            except sqlite3.OperationalError:
                pass
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id               TEXT PRIMARY KEY,
                username         TEXT NOT NULL,
                username_key     TEXT NOT NULL UNIQUE,
                created_at       REAL NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id               TEXT PRIMARY KEY,
                user_id          TEXT NOT NULL,
                created_at       REAL NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ai_image_jobs (
                id               TEXT PRIMARY KEY,
                user_id          TEXT NOT NULL,
                status           TEXT NOT NULL,
                model            TEXT NOT NULL,
                prompt           TEXT NOT NULL,
                size             TEXT NOT NULL,
                image_url        TEXT,
                has_reference    INTEGER NOT NULL DEFAULT 0,
                error            TEXT,
                created_at       REAL NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ai_chat_sessions (
                id               TEXT PRIMARY KEY,
                user_id          TEXT NOT NULL,
                title            TEXT NOT NULL,
                created_at       REAL NOT NULL,
                updated_at       REAL NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ai_chat_messages (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id       TEXT NOT NULL,
                user_id          TEXT NOT NULL,
                role             TEXT NOT NULL,
                type             TEXT NOT NULL,
                text             TEXT,
                image_url        TEXT,
                meta_json        TEXT NOT NULL DEFAULT '{}',
                created_at       REAL NOT NULL
            )
        """)
        conn.commit()


# ─── 基本 CRUD ────────────────────────────────────────────────────────────────

def save_job(job: ComposeJob) -> None:
    """插入或更新 job 记录"""
    now = time.time()
    print(f"[job_store] Saving job {job.id}, status={job.status.value}, db_path={_DB_PATH}")
    with _lock, _connect() as conn:
        conn.execute("""
            INSERT INTO jobs (id, user_id, status, request_json, result_path, penpot_file_id, penpot_edit_url, error, progress_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                user_id         = excluded.user_id,
                status          = excluded.status,
                result_path     = excluded.result_path,
                penpot_file_id  = excluded.penpot_file_id,
                penpot_edit_url = excluded.penpot_edit_url,
                error           = excluded.error,
                progress_json   = excluded.progress_json,
                updated_at      = excluded.updated_at
        """, (
            job.id,
            job.user_id,
            job.status.value,
            job.request.model_dump_json(),
            job.result_path,
            job.penpot_file_id,
            job.penpot_edit_url,
            job.error,
            json.dumps(job.progress, ensure_ascii=False),
            now,
            now,
        ))
        conn.commit()


def load_job(job_id: str) -> Optional[ComposeJob]:
    """从数据库加载 job；不存在返回 None"""
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM jobs WHERE id = ?", (job_id,)
        ).fetchone()

    if row is None:
        return None

    return _row_to_job(row)


def load_recent_jobs(limit: int = 50, user_id: Optional[str] = None) -> list[ComposeJob]:
    """按时间倒序返回最近 N 条任务"""
    print(f"[job_store] Loading recent jobs, limit={limit}, db_path={_DB_PATH}")
    with _connect() as conn:
        if user_id:
            rows = conn.execute(
                "SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
                (user_id, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
        print(f"[job_store] Found {len(rows)} rows in database")
    return [_row_to_job(r) for r in rows]


def _row_to_job(row: sqlite3.Row) -> ComposeJob:
    req = ComposeRequest.model_validate_json(row["request_json"])
    progress = json.loads(row["progress_json"])
    return ComposeJob(
        id=row["id"],
        user_id=row["user_id"],
        status=ComposeStatus(row["status"]),
        request=req,
        result_path=row["result_path"],
        penpot_file_id=row["penpot_file_id"],
        penpot_edit_url=row["penpot_edit_url"],
        error=row["error"],
        progress=progress,
        created_at=row["created_at"],
    )


# ─── 特殊品合成任务 ──────────────────────────────────────────────────────────

def save_special_job(job) -> None:
    """将特殊品 job 持久化到 SQLite（独立表）"""
    now = time.time()
    with _lock, _connect() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS special_jobs (
                id               TEXT PRIMARY KEY,
                status           TEXT NOT NULL,
                sku              TEXT,
                request_json     TEXT NOT NULL,
                result_paths_json TEXT,
                result_frame_ids_json TEXT,
                penpot_file_id   TEXT,
                penpot_page_id   TEXT,
                penpot_edit_url  TEXT,
                error            TEXT,
                progress_json    TEXT NOT NULL DEFAULT '[]',
                created_at       REAL NOT NULL,
                updated_at       REAL NOT NULL
            )
        """)
        conn.execute("""
            INSERT INTO special_jobs
              (id, user_id, status, sku, request_json, result_paths_json, result_frame_ids_json,
               penpot_file_id, penpot_page_id, penpot_edit_url, error, progress_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                user_id              = excluded.user_id,
                status               = excluded.status,
                result_paths_json    = excluded.result_paths_json,
                result_frame_ids_json = excluded.result_frame_ids_json,
                penpot_file_id      = excluded.penpot_file_id,
                penpot_page_id      = excluded.penpot_page_id,
                penpot_edit_url     = excluded.penpot_edit_url,
                error               = excluded.error,
                progress_json       = excluded.progress_json,
                updated_at          = excluded.updated_at
        """, (
            job.id,
            getattr(job, "user_id", None),
            job.status.value if job.status else 'unknown',
            job.request.sku if job.request else '',
            job.request.model_dump_json() if job.request else '{}',
            json.dumps(job.result_paths, ensure_ascii=False),
            json.dumps(job.result_frame_ids, ensure_ascii=False),
            job.penpot_file_id,
            job.penpot_page_id,
            job.penpot_edit_url,
            job.error,
            json.dumps(job.progress, ensure_ascii=False),
            now,
            now,
        ))
        conn.commit()


def load_special_jobs(limit: int = 50, user_id: Optional[str] = None) -> list[dict]:
    """从数据库加载特殊品任务列表（返回 dict 列表供 history API 使用）"""
    with _connect() as conn:
        if user_id:
            rows = conn.execute(
                "SELECT * FROM special_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
                (user_id, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM special_jobs ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
    results = []
    results_dir = settings.output_path / "results"
    for row in rows:
        frame_list = []
        result_paths = json.loads(row["result_paths_json"] or "[]")
        if result_paths:
            # 使用实际生成的文件路径列表
            for p_str in result_paths:
                import re as _re
                m = _re.search(r'results[/\\](.+)$', p_str.replace('\\', '/'))
                url = f"/results/{m.group(1)}" if m else None
                frame_list.append({'url': url})
        else:
            # 兼容旧数据：从 result_frame_ids 推算
            result_frame_ids = json.loads(row["result_frame_ids_json"] or "[]")
            for i, fid in enumerate(result_frame_ids):
                p = results_dir / row["id"] / f"frame_{i}.png"
                url = f"/results/{row['id']}/frame_{i}.png" if p.exists() else None
                frame_list.append({'id': fid, 'url': url})
        results.append({
            'id': row["id"],
            'user_id': row["user_id"],
            'sku': row["sku"] or '',
            'status': row["status"],
            'created_at': row["created_at"],
            'penpot_edit_url': row["penpot_edit_url"],
            'frames': frame_list,
            '_type': 'special',
        })
    return results


def get_or_create_user(username: str) -> dict:
    now = time.time()
    clean = " ".join((username or "").strip().split())
    if not clean:
        raise ValueError("username required")
    allowed = {
        str(item.get("username", "")).strip(): {
            "id": str(item.get("id", "")).strip(),
            "role": str(item.get("role", "user")).strip() or "user",
        }
        for item in settings.allowed_login_users
        if str(item.get("username", "")).strip() and str(item.get("id", "")).strip()
    }
    if clean not in allowed:
        raise ValueError("username not allowed")
    key = clean.casefold()
    fixed_id = allowed[clean]["id"]
    role = allowed[clean]["role"]
    with _lock, _connect() as conn:
        row = conn.execute(
            "SELECT id, username, created_at FROM users WHERE username_key = ?",
            (key,),
        ).fetchone()
        if row:
            existing_id = row["id"]
            if existing_id != fixed_id:
                fixed_row = conn.execute(
                    "SELECT id FROM users WHERE id = ?",
                    (fixed_id,),
                ).fetchone()
                conn.execute("UPDATE jobs SET user_id = ? WHERE user_id = ?", (fixed_id, existing_id))
                conn.execute("UPDATE special_jobs SET user_id = ? WHERE user_id = ?", (fixed_id, existing_id))
                conn.execute("UPDATE sessions SET user_id = ? WHERE user_id = ?", (fixed_id, existing_id))
                if fixed_row:
                    conn.execute("DELETE FROM users WHERE id = ?", (existing_id,))
                else:
                    conn.execute(
                        "UPDATE users SET id = ?, username = ?, username_key = ? WHERE id = ?",
                        (fixed_id, clean, key, existing_id),
                    )
                conn.execute(
                    "UPDATE users SET username = ?, username_key = ? WHERE id = ?",
                    (clean, key, fixed_id),
                )
                conn.commit()
                return {"id": fixed_id, "username": clean, "created_at": row["created_at"], "role": role}
            conn.execute(
                "UPDATE users SET username = ?, username_key = ? WHERE id = ?",
                (clean, key, fixed_id),
            )
            conn.commit()
            return {"id": fixed_id, "username": clean, "created_at": row["created_at"], "role": role}
        row = conn.execute(
            "SELECT id, username, created_at FROM users WHERE id = ?",
            (fixed_id,),
        ).fetchone()
        if row:
            conn.execute(
                "UPDATE users SET username = ?, username_key = ? WHERE id = ?",
                (clean, key, fixed_id),
            )
            conn.commit()
            return {"id": fixed_id, "username": clean, "created_at": row["created_at"], "role": role}
        conn.execute(
            "INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, ?)",
            (fixed_id, clean, key, now),
        )
        conn.commit()
        return {"id": fixed_id, "username": clean, "created_at": now, "role": role}


def create_session(user_id: str) -> str:
    token = uuid.uuid4().hex
    with _lock, _connect() as conn:
        conn.execute(
            "INSERT INTO sessions (id, user_id, created_at) VALUES (?, ?, ?)",
            (token, user_id, time.time()),
        )
        conn.commit()
    return token


def get_user_by_session(session_id: str | None) -> Optional[dict]:
    if not session_id:
        return None
    with _connect() as conn:
        row = conn.execute("""
            SELECT u.id, u.username, u.created_at
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.id = ?
        """, (session_id,)).fetchone()
    if not row:
        return None
    role = "user"
    for item in settings.allowed_login_users:
        if str(item.get("id", "")).strip() == row["id"]:
            role = str(item.get("role", "user")).strip() or "user"
            break
    return {"id": row["id"], "username": row["username"], "created_at": row["created_at"], "role": role}


def delete_session(session_id: str | None) -> None:
    if not session_id:
        return
    with _lock, _connect() as conn:
        conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        conn.commit()


def save_ai_image_job(
    *,
    job_id: str,
    user_id: str,
    status: str,
    model: str,
    prompt: str,
    size: str,
    image_url: str | None = None,
    has_reference: bool = False,
    error: str | None = None,
    created_at: float | None = None,
) -> None:
    now = created_at or time.time()
    with _lock, _connect() as conn:
        conn.execute(
            """
            INSERT INTO ai_image_jobs
              (id, user_id, status, model, prompt, size, image_url, has_reference, error, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                user_id = excluded.user_id,
                status = excluded.status,
                model = excluded.model,
                prompt = excluded.prompt,
                size = excluded.size,
                image_url = excluded.image_url,
                has_reference = excluded.has_reference,
                error = excluded.error
            """,
            (
                job_id,
                user_id,
                status,
                model,
                prompt,
                size,
                image_url,
                1 if has_reference else 0,
                error,
                now,
            ),
        )
        conn.commit()


def load_ai_image_jobs(limit: int = 50, user_id: Optional[str] = None) -> list[dict]:
    with _connect() as conn:
        if user_id:
            rows = conn.execute(
                "SELECT * FROM ai_image_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
                (user_id, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM ai_image_jobs ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
    return [
        {
            "id": row["id"],
            "user_id": row["user_id"],
            "status": row["status"],
            "model": row["model"],
            "prompt": row["prompt"],
            "size": row["size"],
            "image_url": row["image_url"],
            "has_reference": bool(row["has_reference"]),
            "error": row["error"],
            "created_at": row["created_at"],
            "_type": "ai-image",
        }
        for row in rows
    ]


def create_ai_chat_session(*, user_id: str, title: str, created_at: float | None = None) -> dict:
    now = created_at or time.time()
    session_id = uuid.uuid4().hex
    clean_title = (title or "").strip() or "未命名对话"
    with _lock, _connect() as conn:
        conn.execute(
            """
            INSERT INTO ai_chat_sessions (id, user_id, title, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (session_id, user_id, clean_title, now, now),
        )
        conn.commit()
    return {
        "id": session_id,
        "user_id": user_id,
        "title": clean_title,
        "created_at": now,
        "updated_at": now,
    }


def get_ai_chat_session(session_id: str, user_id: Optional[str] = None) -> Optional[dict]:
    with _connect() as conn:
        if user_id:
            row = conn.execute(
                "SELECT * FROM ai_chat_sessions WHERE id = ? AND user_id = ?",
                (session_id, user_id),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM ai_chat_sessions WHERE id = ?",
                (session_id,),
            ).fetchone()
    if not row:
        return None
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "title": row["title"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def touch_ai_chat_session(session_id: str, *, updated_at: float | None = None) -> None:
    now = updated_at or time.time()
    with _lock, _connect() as conn:
        conn.execute(
            "UPDATE ai_chat_sessions SET updated_at = ? WHERE id = ?",
            (now, session_id),
        )
        conn.commit()


def append_ai_chat_message(
    *,
    session_id: str,
    user_id: str,
    role: str,
    type: str,
    text: str | None = None,
    image_url: str | None = None,
    meta: Optional[dict] = None,
    created_at: float | None = None,
) -> int:
    now = created_at or time.time()
    with _lock, _connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO ai_chat_messages
              (session_id, user_id, role, type, text, image_url, meta_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                session_id,
                user_id,
                role,
                type,
                text,
                image_url,
                json.dumps(meta or {}, ensure_ascii=False),
                now,
            ),
        )
        conn.execute(
            "UPDATE ai_chat_sessions SET updated_at = ? WHERE id = ?",
            (now, session_id),
        )
        conn.commit()
        return int(cur.lastrowid)


def list_ai_chat_sessions(limit: int = 50, user_id: Optional[str] = None) -> list[dict]:
    with _connect() as conn:
        if user_id:
            rows = conn.execute(
                "SELECT * FROM ai_chat_sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?",
                (user_id, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM ai_chat_sessions ORDER BY updated_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
    return [
        {
            "id": row["id"],
            "user_id": row["user_id"],
            "title": row["title"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }
        for row in rows
    ]


def delete_ai_chat_session(session_id: str, user_id: Optional[str] = None) -> bool:
    with _lock, _connect() as conn:
        if user_id:
            row = conn.execute(
                "SELECT id FROM ai_chat_sessions WHERE id = ? AND user_id = ?",
                (session_id, user_id),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT id FROM ai_chat_sessions WHERE id = ?",
                (session_id,),
            ).fetchone()
        if not row:
            return False
        conn.execute("DELETE FROM ai_chat_messages WHERE session_id = ?", (session_id,))
        if user_id:
            conn.execute("DELETE FROM ai_chat_sessions WHERE id = ? AND user_id = ?", (session_id, user_id))
        else:
            conn.execute("DELETE FROM ai_chat_sessions WHERE id = ?", (session_id,))
        conn.commit()
        return True


def load_ai_chat_messages(session_id: str, user_id: Optional[str] = None) -> list[dict]:
    with _connect() as conn:
        if user_id:
            rows = conn.execute(
                """
                SELECT m.*
                FROM ai_chat_messages m
                JOIN ai_chat_sessions s ON s.id = m.session_id
                WHERE m.session_id = ? AND s.user_id = ?
                ORDER BY m.created_at ASC, m.id ASC
                """,
                (session_id, user_id),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM ai_chat_messages WHERE session_id = ? ORDER BY created_at ASC, id ASC",
                (session_id,),
            ).fetchall()
    result = []
    for row in rows:
        meta = json.loads(row["meta_json"] or "{}")
        if row["type"] == "user_text":
            result.append({
                "who": "user",
                "text": row["text"] or "",
                "createdAt": row["created_at"],
            })
        elif row["type"] == "ai_image_result":
            result.append({
                "who": "ai",
                "type": "ai-image-generating",
                "model": meta.get("model"),
                "prompt": meta.get("prompt") or (row["text"] or ""),
                "status": meta.get("status") or "done",
                "imageUrl": row["image_url"],
                "error": meta.get("error"),
                "hasReference": bool(meta.get("hasReference")),
                "refCount": int(meta.get("refCount") or 0),
                "finalElapsed": meta.get("finalElapsed"),
                "meta": meta.get("model"),
                "createdAt": row["created_at"],
            })
        elif row["type"] == "ai_text":
            result.append({
                "who": "ai",
                "text": row["text"] or "",
                "meta": meta.get("meta") or "Loom",
                "createdAt": row["created_at"],
            })
    return result

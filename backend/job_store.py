"""
合成任务持久化 — SQLite

在内存 dict 之上添加 SQLite 持久层，后端重启后历史任务仍可查询。
结构：
  jobs(id TEXT PK, status TEXT, request_json TEXT, result_path TEXT,
        error TEXT, progress_json TEXT, created_at REAL, updated_at REAL)
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Optional

import bcrypt

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
        try:
            conn.execute("ALTER TABLE users ADD COLUMN password_hash TEXT")
        except sqlite3.OperationalError:
            pass
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id               TEXT PRIMARY KEY,
                user_id          TEXT NOT NULL,
                created_at       REAL NOT NULL
            )
        """)
        try:
            conn.execute("ALTER TABLE sessions ADD COLUMN password_marker TEXT")
        except sqlite3.OperationalError:
            pass
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ai_image_jobs (
                id               TEXT PRIMARY KEY,
                user_id          TEXT NOT NULL,
                status           TEXT NOT NULL,
                model            TEXT NOT NULL,
                prompt           TEXT NOT NULL,
                original_prompt  TEXT NOT NULL DEFAULT '',
                resolved_prompt  TEXT NOT NULL DEFAULT '',
                prompt_trace     TEXT NOT NULL DEFAULT '',
                size             TEXT NOT NULL,
                image_url        TEXT,
                has_reference    INTEGER NOT NULL DEFAULT 0,
                error            TEXT,
                task_id          TEXT,
                progress         INTEGER NOT NULL DEFAULT 0,
                created_at       REAL NOT NULL
            )
        """)
        # 兼容旧表：添加可能缺失的列
        for col, col_def in [
            ("task_id", "TEXT"),
            ("progress", "INTEGER NOT NULL DEFAULT 0"),
            ("original_prompt", "TEXT NOT NULL DEFAULT ''"),
            ("resolved_prompt", "TEXT NOT NULL DEFAULT ''"),
            ("prompt_trace", "TEXT NOT NULL DEFAULT ''"),
            ("provider_switched", "INTEGER NOT NULL DEFAULT 0"),
        ]:
            try:
                conn.execute(f"ALTER TABLE ai_image_jobs ADD COLUMN {col} {col_def}")
            except Exception:
                pass
        conn.execute("""
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS editor_snapshots (
                user_id          TEXT PRIMARY KEY,
                snapshot_json    TEXT NOT NULL,
                updated_at       REAL NOT NULL
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
        conn.execute("""
            CREATE TABLE IF NOT EXISTS agent_projects (
                id                  TEXT PRIMARY KEY,
                user_id             TEXT NOT NULL,
                title               TEXT NOT NULL,
                status              TEXT NOT NULL,
                phase_json          TEXT NOT NULL,
                intent_json         TEXT NOT NULL,
                brief_json          TEXT,
                current_prompt_json TEXT,
                current_image_json  TEXT,
                conversation_summary TEXT,
                metadata_json       TEXT NOT NULL DEFAULT '{}',
                created_at          REAL NOT NULL,
                updated_at          REAL NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS agent_messages (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id          TEXT NOT NULL,
                user_id             TEXT NOT NULL,
                role                TEXT NOT NULL,
                type                TEXT NOT NULL,
                text                TEXT,
                payload_json        TEXT NOT NULL DEFAULT '{}',
                decision_action     TEXT,
                created_at          REAL NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS agent_images (
                id                  TEXT PRIMARY KEY,
                project_id          TEXT NOT NULL,
                user_id             TEXT NOT NULL,
                parent_image_id     TEXT,
                iteration_number    INTEGER NOT NULL DEFAULT 1,
                provider            TEXT NOT NULL,
                model               TEXT NOT NULL,
                prompt_json         TEXT NOT NULL,
                image_url           TEXT NOT NULL,
                vlm_analysis_json   TEXT NOT NULL DEFAULT '{}',
                user_feedback       TEXT,
                is_favorite         INTEGER NOT NULL DEFAULT 0,
                user_rating         INTEGER,
                created_at          REAL NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS operation_logs (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     TEXT NOT NULL,
                username    TEXT NOT NULL,
                action      TEXT NOT NULL,
                detail      TEXT NOT NULL DEFAULT '',
                payload     TEXT NOT NULL DEFAULT '',
                created_at  REAL NOT NULL
            )
        """)
        # 兼容旧表：添加 payload 列
        try:
            conn.execute("ALTER TABLE operation_logs ADD COLUMN payload TEXT NOT NULL DEFAULT ''")
        except Exception:
            pass
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_oplogs_ts ON operation_logs(created_at)
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS inspiration_posts (
                id            TEXT PRIMARY KEY,
                job_id        TEXT NOT NULL,
                user_id       TEXT NOT NULL,
                image_url     TEXT NOT NULL,
                thumb_url     TEXT NOT NULL DEFAULT '',
                prompt        TEXT NOT NULL,
                original_prompt TEXT NOT NULL DEFAULT '',
                resolved_prompt TEXT NOT NULL DEFAULT '',
                model         TEXT NOT NULL,
                size          TEXT NOT NULL,
                resolution    TEXT,
                has_ref       INTEGER NOT NULL DEFAULT 0,
                image_width   INTEGER NOT NULL DEFAULT 0,
                image_height  INTEGER NOT NULL DEFAULT 0,
                category      TEXT NOT NULL DEFAULT 'share_card',
                tags_json     TEXT NOT NULL DEFAULT '[]',
                vlm_prompt    TEXT NOT NULL DEFAULT '',
                vlm_description TEXT NOT NULL DEFAULT '',
                created_at    REAL NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS inspiration_favorites (
                post_id     TEXT NOT NULL,
                user_id     TEXT NOT NULL,
                created_at  REAL NOT NULL,
                PRIMARY KEY (post_id, user_id)
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_inspiration_created ON inspiration_posts(created_at)
        """)
        # 唯一约束: 同一 job_id 只能有一条灵感 (用 UNIQUE INDEX 实现, 替代 ALTER TABLE 加 UNIQUE)
        conn.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_inspiration_job_id_unique ON inspiration_posts(job_id)
        """)
        # 兼容旧表
        try:
            conn.execute("ALTER TABLE inspiration_posts ADD COLUMN thumb_url TEXT NOT NULL DEFAULT ''")
        except Exception:
            pass
        try:
            conn.execute("ALTER TABLE inspiration_posts ADD COLUMN image_width INTEGER NOT NULL DEFAULT 0")
        except Exception:
            pass
        try:
            conn.execute("ALTER TABLE inspiration_posts ADD COLUMN image_height INTEGER NOT NULL DEFAULT 0")
        except Exception:
            pass
        for col, typ in [
            ("category", "TEXT NOT NULL DEFAULT 'share_card'"),
            ("tags_json", "TEXT NOT NULL DEFAULT '[]'"),
            ("vlm_prompt", "TEXT NOT NULL DEFAULT ''"),
            ("vlm_description", "TEXT NOT NULL DEFAULT ''"),
            ("original_prompt", "TEXT NOT NULL DEFAULT ''"),
            ("resolved_prompt", "TEXT NOT NULL DEFAULT ''"),
        ]:
            try:
                conn.execute(f"ALTER TABLE inspiration_posts ADD COLUMN {col} {typ}")
            except Exception:
                pass
        # 兼容旧表: 如果存在重复 job_id, 保留 created_at 最大的最新一条, 删除较早的
        # SQLite 不支持 DELETE FROM t WHERE id IN (SELECT ... FROM t) 这种自引用, 用嵌套子查询
        conn.execute("""
            DELETE FROM inspiration_posts
            WHERE id IN (
                SELECT id FROM (
                    SELECT id FROM inspiration_posts
                    WHERE job_id IN (
                        SELECT job_id FROM inspiration_posts GROUP BY job_id HAVING COUNT(*) > 1
                    )
                    AND created_at < (
                        SELECT MAX(created_at) FROM inspiration_posts AS t2
                        WHERE t2.job_id = inspiration_posts.job_id
                    )
                )
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


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False


def get_or_create_user(username: str, password: str | None = None) -> dict:
    """校验用户名+密码并返回用户信息。

    password=None 仅用于内部调用（如 session 恢复），外部登录必须传密码。
    """
    now = time.time()
    clean = " ".join((username or "").strip().split())
    if not clean:
        raise ValueError("username required")
    allowed = {
        str(item.get("username", "")).strip(): {
            "id": str(item.get("id", "")).strip(),
            "role": str(item.get("role", "user")).strip() or "user",
            "password_hash": str(item.get("password_hash", "")).strip(),
        }
        for item in settings.allowed_login_users
        if str(item.get("username", "")).strip() and str(item.get("id", "")).strip()
    }
    if clean not in allowed:
        raise ValueError("username not allowed")

    cfg = allowed[clean]
    fixed_id = cfg["id"]
    role = cfg["role"]
    cfg_hash = cfg["password_hash"]

    # 密码校验：有配置 hash 则必须校验，无 hash 则拒绝登录（提示管理员设置密码）
    if password is not None:
        if not cfg_hash:
            # 首次登录，自动设置密码
            new_hash = hash_password(password)
            users = list(settings.allowed_login_users)
            for u in users:
                if u.get("id") == fixed_id:
                    u["password_hash"] = new_hash
                    break
            settings.save_login_users(users)
            cfg_hash = new_hash
        if not verify_password(password, cfg_hash):
            raise ValueError("wrong password")

    key = clean.casefold()
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


def _password_marker(password_hash: str) -> str:
    return hashlib.sha256(password_hash.encode()).hexdigest()


def create_session(user_id: str) -> str:
    token = uuid.uuid4().hex
    password_hash = ""
    for item in settings.allowed_login_users:
        if str(item.get("id", "")).strip() == user_id:
            password_hash = str(item.get("password_hash", "")).strip()
            break
    with _lock, _connect() as conn:
        conn.execute(
            "INSERT INTO sessions (id, user_id, created_at, password_marker) VALUES (?, ?, ?, ?)",
            (token, user_id, time.time(), _password_marker(password_hash)),
        )
        conn.commit()
    return token


def get_user_by_session(session_id: str | None) -> Optional[dict]:
    if not session_id:
        return None
    with _connect() as conn:
        row = conn.execute("""
            SELECT s.password_marker, u.id, u.username, u.created_at
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.id = ?
        """, (session_id,)).fetchone()
    if not row:
        return None
    password_hash = ""
    role = "user"
    for item in settings.allowed_login_users:
        if str(item.get("id", "")).strip() == row["id"]:
            password_hash = str(item.get("password_hash", "")).strip()
            role = str(item.get("role", "user")).strip() or "user"
            break
    if row["password_marker"] != _password_marker(password_hash):
        delete_session(session_id)
        return None
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
    original_prompt: str | None = None,
    resolved_prompt: str | None = None,
    prompt_trace: str | None = None,
    image_url: str | None = None,
    has_reference: bool = False,
    error: str | None = None,
    task_id: str | None = None,
    progress: int = 0,
    created_at: float | None = None,
) -> None:
    now = created_at or time.time()
    with _lock, _connect() as conn:
        conn.execute(
            """
            INSERT INTO ai_image_jobs
              (id, user_id, status, model, prompt, original_prompt, resolved_prompt, prompt_trace, size, image_url, has_reference, error, task_id, progress, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                user_id = excluded.user_id,
                status = excluded.status,
                model = excluded.model,
                prompt = excluded.prompt,
                original_prompt = excluded.original_prompt,
                resolved_prompt = excluded.resolved_prompt,
                prompt_trace = excluded.prompt_trace,
                size = excluded.size,
                image_url = excluded.image_url,
                has_reference = excluded.has_reference,
                -- 进度轮询写入时 error 常为 NULL，不能覆盖已有失败原因；
                -- 终态 done/failed 才以本次写入为准（done 可清空 error）。
                error = CASE
                    WHEN excluded.status IN ('done', 'failed') THEN excluded.error
                    WHEN excluded.error IS NOT NULL AND excluded.error != '' THEN excluded.error
                    ELSE ai_image_jobs.error
                END,
                -- task_id 同理：只在有新值时覆盖，避免进度更新冲掉已记录的上游任务号
                task_id = CASE
                    WHEN excluded.task_id IS NOT NULL AND excluded.task_id != '' THEN excluded.task_id
                    ELSE ai_image_jobs.task_id
                END,
                progress = excluded.progress
            """,
            (
                job_id,
                user_id,
                status,
                model,
                prompt,
                original_prompt or "",
                resolved_prompt or prompt or "",
                prompt_trace or "",
                size,
                image_url,
                1 if has_reference else 0,
                error,
                task_id,
                progress,
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
            "original_prompt": row["original_prompt"] if "original_prompt" in row.keys() else "",
            "resolved_prompt": row["resolved_prompt"] if "resolved_prompt" in row.keys() else "",
            "size": row["size"],
            "image_url": row["image_url"],
            "has_reference": bool(row["has_reference"]),
            "error": row["error"],
            "task_id": row["task_id"],
            "progress": row["progress"],
            "created_at": row["created_at"],
            "_type": "ai-image",
        }
        for row in rows
    ]


def load_ai_image_job(job_id: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM ai_image_jobs WHERE id = ?", (job_id,)).fetchone()
    if not row:
        return None
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "status": row["status"],
        "model": row["model"],
        "prompt": row["prompt"],
        "original_prompt": row["original_prompt"] if "original_prompt" in row.keys() else "",
        "resolved_prompt": row["resolved_prompt"] if "resolved_prompt" in row.keys() else "",
        "prompt_trace": row["prompt_trace"] if "prompt_trace" in row.keys() else "",
        "size": row["size"],
        "image_url": row["image_url"],
        "has_reference": bool(row["has_reference"]),
        "error": row["error"],
        "task_id": row["task_id"],
        "progress": int(row["progress"] or 0),
        "resolution": row["resolution"] if "resolution" in row.keys() else "",
        "provider_switched": bool(row["provider_switched"]) if "provider_switched" in row.keys() else False,
        "created_at": row["created_at"],
    }


def mark_ai_image_job_provider_switched(job_id: str, switched: bool = True) -> None:
    """标记生图 job发生过 provider 兜底切换。独立函数，避免动 save_ai_image_job 签名。"""
    with _lock, _connect() as conn:
        conn.execute(
            "UPDATE ai_image_jobs SET provider_switched = ? WHERE id = ?",
            (1 if switched else 0, job_id),
        )
        conn.commit()


def load_ai_image_job_by_image_url(image_url: str, user_id: str | None = None) -> dict | None:
    """通过 image_url 反查 ai_image_jobs（用于从历史消息中点发布时拿 job_id）。"""
    with _connect() as conn:
        if user_id:
            row = conn.execute(
                "SELECT * FROM ai_image_jobs WHERE image_url = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1",
                (image_url, user_id),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM ai_image_jobs WHERE image_url = ? ORDER BY created_at DESC LIMIT 1",
                (image_url,),
            ).fetchone()
    if not row:
        return None
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "status": row["status"],
        "model": row["model"],
        "prompt": row["prompt"],
        "original_prompt": row["original_prompt"] if "original_prompt" in row.keys() else "",
        "resolved_prompt": row["resolved_prompt"] if "resolved_prompt" in row.keys() else "",
        "size": row["size"],
        "image_url": row["image_url"],
        "has_reference": bool(row["has_reference"]),
        "error": row["error"],
        "task_id": row["task_id"],
        "progress": int(row["progress"] or 0),
        "resolution": row["resolution"] if "resolution" in row.keys() else "",
        "created_at": row["created_at"],
    }


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
    job_id_to_idx = {}  # job_id -> result index (ai_image_result only)
    batch_id_to_idx = {}  # batchId -> result index（批量多图消息）
    batch_job_image = {}  # job_id -> 批量消息里对应的 image dict（灵感状态按图回填）
    for row in rows:
        meta = json.loads(row["meta_json"] or "{}")
        if row["type"] == "user_text":
            result.append({
                "who": "user",
                "text": row["text"] or "",
                "createdAt": row["created_at"],
            })
        elif row["type"] == "ai_image_result":
            job_id = meta.get("job_id") or ""
            err_text = meta.get("error") or ""
            # 历史失败消息若 error 为空，给可排查兜底，避免前端只显示「未知错误」
            if (meta.get("status") == "failed") and not str(err_text).strip():
                err_text = (
                    f"生图失败但未记录错误详情"
                    f"{'（job=' + job_id[:8] + '）' if job_id else ''}，请查后端日志"
                )
            batch_id = str(meta.get("batchId") or "")
            image_item = {
                "jobId": job_id or None,
                "url": row["image_url"],
                "previewUrl": meta.get("previewUrl") or "",
                "status": meta.get("status") or "done",
                "error": err_text or None,
                "batchIndex": int(meta.get("batchIndex") or 0),
            }
            if batch_id and batch_id in batch_id_to_idx:
                # 同一批次的后续结果并入已有多图消息，重算聚合状态
                idx = batch_id_to_idx[batch_id]
                msg = result[idx]
                msg["images"].append(image_item)
                msg["images"].sort(key=lambda im: im.get("batchIndex") or 0)
                ok_imgs = [im for im in msg["images"] if im.get("status") == "done" and im.get("url")]
                msg["status"] = "done" if ok_imgs else "failed"
                msg["imageUrl"] = ok_imgs[0]["url"] if ok_imgs else None
                msg["previewUrl"] = ok_imgs[0]["previewUrl"] if ok_imgs else ""
                msg["error"] = None if ok_imgs else next(
                    (im.get("error") for im in msg["images"] if im.get("error")), None
                )
            else:
                idx = len(result)
                msg = {
                    "who": "ai",
                    "type": "ai-image-generating",
                    "model": meta.get("model"),
                    "prompt": meta.get("prompt") or (row["text"] or ""),
                    "status": meta.get("status") or "done",
                    "imageUrl": row["image_url"],
                    "previewUrl": meta.get("previewUrl") or "",
                    "error": err_text or None,
                    "jobId": job_id or None,
                    "hasReference": bool(meta.get("hasReference")),
                    "refCount": int(meta.get("refCount") or 0),
                    "refPreviews": meta.get("refPreviews") or [],
                    "finalElapsed": meta.get("finalElapsed"),
                    "provider": meta.get("provider"),
                    "providerSwitched": bool(meta.get("providerSwitched")),
                    "meta": "Loom",
                    "createdAt": row["created_at"],
                }
                if batch_id:
                    msg["batchId"] = batch_id
                    msg["batchCount"] = int(meta.get("batchCount") or 0) or None
                    msg["images"] = [image_item]
                    batch_id_to_idx[batch_id] = idx
                result.append(msg)
            if job_id:
                job_id_to_idx[job_id] = idx
                if batch_id:
                    batch_job_image[job_id] = image_item
        elif row["type"] == "ai_text":
            result.append({
                "who": "ai",
                "text": row["text"] or "",
                "meta": meta.get("meta") or "Loom",
                "createdAt": row["created_at"],
            })
    # 批量查灵感状态: job_id 精确匹配 + image_url 兜底
    if job_id_to_idx:
        jids = list(job_id_to_idx.keys())
        placeholders = ",".join("?" * len(jids))
        with _connect() as conn:
            insp_rows = conn.execute(
                f"SELECT job_id, id FROM inspiration_posts WHERE job_id IN ({placeholders})",
                jids,
            ).fetchall()
        for r in insp_rows:
            idx = job_id_to_idx.get(r["job_id"])
            if idx is not None:
                img = batch_job_image.get(r["job_id"])
                if img is not None:
                    # 批量消息：发布状态挂在对应那张图上
                    img["inspirationPostId"] = r["id"]
                else:
                    result[idx]["inspirationPostId"] = r["id"]
    # image_url 兜底 (兼容老消息没有 job_id；批量消息不参与)
    img_msgs = {m.get("imageUrl"): idx for idx, m in enumerate(result)
                if m.get("type") == "ai-image-generating" and not m.get("inspirationPostId")
                and m.get("imageUrl") and not m.get("images")}
    if img_msgs:
        urls = list(img_msgs.keys())
        placeholders = ",".join("?" * len(urls))
        with _connect() as conn:
            insp_rows = conn.execute(
                f"SELECT image_url, id FROM inspiration_posts WHERE image_url IN ({placeholders})",
                urls,
            ).fetchall()
        for r in insp_rows:
            idx = img_msgs.get(r["image_url"])
            if idx is not None:
                result[idx]["inspirationPostId"] = r["id"]
    return result


def _editor_snapshot_stats(snapshot_json: str) -> dict[str, int]:
    try:
        snapshot = json.loads(snapshot_json)
    except Exception:
        return {"json_len": len(snapshot_json), "pages": 0, "shapes": 0, "assets": 0}
    store = {}
    if isinstance(snapshot, dict):
        document = snapshot.get("document")
        if isinstance(document, dict) and isinstance(document.get("store"), dict):
            store = document["store"]
        elif isinstance(snapshot.get("store"), dict):
            store = snapshot["store"]
    pages = shapes = assets = 0
    for record in store.values():
        if not isinstance(record, dict):
            continue
        type_name = record.get("typeName")
        if type_name == "page":
            pages += 1
        elif type_name == "shape":
            shapes += 1
        elif type_name == "asset":
            assets += 1
    return {"json_len": len(snapshot_json), "pages": pages, "shapes": shapes, "assets": assets}


def _should_reject_editor_snapshot_overwrite(old_json: str | None, new_json: str) -> bool:
    if not old_json:
        return False
    old = _editor_snapshot_stats(old_json)
    new = _editor_snapshot_stats(new_json)
    if old["assets"] < 20 and old["shapes"] < 20 and old["pages"] < 2:
        return False
    if new["assets"] <= max(3, old["assets"] // 5) and new["shapes"] <= max(3, old["shapes"] // 5):
        return True
    if old["pages"] > 1 and new["pages"] < old["pages"] and new["json_len"] < old["json_len"] // 4:
        return True
    return False


def save_editor_snapshot(user_id: str, snapshot_json: str) -> None:
    now = time.time()
    with _lock, _connect() as conn:
        existing = conn.execute(
            "SELECT snapshot_json FROM editor_snapshots WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        old_json = existing["snapshot_json"] if existing else None
        if _should_reject_editor_snapshot_overwrite(old_json, snapshot_json):
            reject_dir = settings.root_dir / "output" / "editor-snapshot-rejected"
            reject_dir.mkdir(parents=True, exist_ok=True)
            reject_path = reject_dir / f"{user_id}-{int(now)}.json"
            reject_path.write_text(snapshot_json, encoding="utf-8")
            return
        conn.execute(
            """
            INSERT INTO editor_snapshots (user_id, snapshot_json, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                snapshot_json = excluded.snapshot_json,
                updated_at = excluded.updated_at
            """,
            (user_id, snapshot_json, now),
        )
        conn.commit()


def load_editor_snapshot(user_id: str) -> str | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT snapshot_json FROM editor_snapshots WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    return row["snapshot_json"] if row else None


def create_agent_project(
    *,
    user_id: str,
    title: str,
    status: str,
    phase: dict,
    intent: dict,
    brief: Optional[dict] = None,
    current_prompt: Optional[dict] = None,
    current_image: Optional[dict] = None,
    conversation_summary: str = "",
    metadata: Optional[dict] = None,
    created_at: float | None = None,
) -> dict:
    now = created_at or time.time()
    project_id = uuid.uuid4().hex
    clean_title = (title or "").strip() or "新项目"
    with _lock, _connect() as conn:
        conn.execute(
            """
            INSERT INTO agent_projects
              (id, user_id, title, status, phase_json, intent_json, brief_json, current_prompt_json, current_image_json, conversation_summary, metadata_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                project_id,
                user_id,
                clean_title,
                status,
                json.dumps(phase or {}, ensure_ascii=False),
                json.dumps(intent or {}, ensure_ascii=False),
                json.dumps(brief, ensure_ascii=False) if brief is not None else None,
                json.dumps(current_prompt, ensure_ascii=False) if current_prompt is not None else None,
                json.dumps(current_image, ensure_ascii=False) if current_image is not None else None,
                conversation_summary or "",
                json.dumps(metadata or {}, ensure_ascii=False),
                now,
                now,
            ),
        )
        conn.commit()
    return get_agent_project(project_id, user_id=user_id) or {}


def get_agent_project(project_id: str, user_id: Optional[str] = None) -> Optional[dict]:
    with _connect() as conn:
        if user_id:
            row = conn.execute(
                "SELECT * FROM agent_projects WHERE id = ? AND user_id = ?",
                (project_id, user_id),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM agent_projects WHERE id = ?",
                (project_id,),
            ).fetchone()
    if not row:
        return None
    return _row_to_agent_project(row)


def update_agent_project(
    project_id: str,
    *,
    title: Optional[str] = None,
    status: Optional[str] = None,
    phase: Optional[dict] = None,
    intent: Optional[dict] = None,
    brief: Optional[dict] = None,
    current_prompt: Optional[dict] = None,
    current_image: Optional[dict] = None,
    conversation_summary: Optional[str] = None,
    metadata: Optional[dict] = None,
    updated_at: float | None = None,
) -> Optional[dict]:
    existing = get_agent_project(project_id)
    if not existing:
        return None
    now = updated_at or time.time()
    with _lock, _connect() as conn:
        conn.execute(
            """
            UPDATE agent_projects
            SET title = ?, status = ?, phase_json = ?, intent_json = ?, brief_json = ?, current_prompt_json = ?, current_image_json = ?, conversation_summary = ?, metadata_json = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                (title if title is not None else existing["title"]),
                (status if status is not None else existing["status"]),
                json.dumps(phase if phase is not None else existing["phase"], ensure_ascii=False),
                json.dumps(intent if intent is not None else existing["intent"], ensure_ascii=False),
                json.dumps(brief if brief is not None else existing["brief"], ensure_ascii=False) if (brief if brief is not None else existing["brief"]) is not None else None,
                json.dumps(current_prompt if current_prompt is not None else existing["current_prompt"], ensure_ascii=False) if (current_prompt if current_prompt is not None else existing["current_prompt"]) is not None else None,
                json.dumps(current_image if current_image is not None else existing["current_image"], ensure_ascii=False) if (current_image if current_image is not None else existing["current_image"]) is not None else None,
                conversation_summary if conversation_summary is not None else (existing["conversation_summary"] or ""),
                json.dumps(metadata if metadata is not None else existing["metadata"], ensure_ascii=False),
                now,
                project_id,
            ),
        )
        conn.commit()
    return get_agent_project(project_id)


def list_agent_projects(limit: int = 20, user_id: Optional[str] = None, status: Optional[str] = None) -> list[dict]:
    query = "SELECT * FROM agent_projects"
    params: list = []
    clauses = []
    if user_id:
        clauses.append("user_id = ?")
        params.append(user_id)
    if status:
        clauses.append("status = ?")
        params.append(status)
    if clauses:
        query += " WHERE " + " AND ".join(clauses)
    query += " ORDER BY updated_at DESC LIMIT ?"
    params.append(limit)
    with _connect() as conn:
        rows = conn.execute(query, tuple(params)).fetchall()
    return [_row_to_agent_project(row) for row in rows]


def delete_agent_project(project_id: str, user_id: Optional[str] = None) -> bool:
    with _lock, _connect() as conn:
        if user_id:
            row = conn.execute(
                "SELECT id FROM agent_projects WHERE id = ? AND user_id = ?",
                (project_id, user_id),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT id FROM agent_projects WHERE id = ?",
                (project_id,),
            ).fetchone()
        if not row:
            return False
        conn.execute("DELETE FROM agent_messages WHERE project_id = ?", (project_id,))
        conn.execute("DELETE FROM agent_images WHERE project_id = ?", (project_id,))
        if user_id:
            conn.execute("DELETE FROM agent_projects WHERE id = ? AND user_id = ?", (project_id, user_id))
        else:
            conn.execute("DELETE FROM agent_projects WHERE id = ?", (project_id,))
        conn.commit()
        return True


def append_agent_message(
    *,
    project_id: str,
    user_id: str,
    role: str,
    type: str,
    text: str | None = None,
    payload: Optional[dict] = None,
    decision_action: str | None = None,
    created_at: float | None = None,
) -> int:
    now = created_at or time.time()
    with _lock, _connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO agent_messages
              (project_id, user_id, role, type, text, payload_json, decision_action, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                project_id,
                user_id,
                role,
                type,
                text,
                json.dumps(payload or {}, ensure_ascii=False),
                decision_action,
                now,
            ),
        )
        conn.execute(
            "UPDATE agent_projects SET updated_at = ? WHERE id = ?",
            (now, project_id),
        )
        conn.commit()
        return int(cur.lastrowid)


def load_agent_messages(project_id: str, user_id: Optional[str] = None, limit: Optional[int] = None) -> list[dict]:
    with _connect() as conn:
        if user_id:
            query = """
                SELECT m.*
                FROM agent_messages m
                JOIN agent_projects p ON p.id = m.project_id
                WHERE m.project_id = ? AND p.user_id = ?
                ORDER BY m.created_at ASC, m.id ASC
            """
            params = [project_id, user_id]
        else:
            query = "SELECT * FROM agent_messages WHERE project_id = ? ORDER BY created_at ASC, id ASC"
            params = [project_id]
        rows = conn.execute(query, tuple(params)).fetchall()
    items = [
        {
            "id": row["id"],
            "project_id": row["project_id"],
            "user_id": row["user_id"],
            "role": row["role"],
            "type": row["type"],
            "text": row["text"] or "",
            "payload": json.loads(row["payload_json"] or "{}"),
            "decision_action": row["decision_action"],
            "created_at": row["created_at"],
        }
        for row in rows
    ]
    if limit is not None and limit > 0:
        return items[-limit:]
    return items


def create_agent_image(
    *,
    project_id: str,
    user_id: str,
    provider: str,
    model: str,
    prompt: dict,
    image_url: str,
    vlm_analysis: Optional[dict] = None,
    parent_image_id: Optional[str] = None,
    iteration_number: int = 1,
    created_at: float | None = None,
) -> dict:
    now = created_at or time.time()
    image_id = uuid.uuid4().hex
    with _lock, _connect() as conn:
        conn.execute(
            """
            INSERT INTO agent_images
              (id, project_id, user_id, parent_image_id, iteration_number, provider, model, prompt_json, image_url, vlm_analysis_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                image_id,
                project_id,
                user_id,
                parent_image_id,
                iteration_number,
                provider,
                model,
                json.dumps(prompt or {}, ensure_ascii=False),
                image_url,
                json.dumps(vlm_analysis or {}, ensure_ascii=False),
                now,
            ),
        )
        conn.execute(
            "UPDATE agent_projects SET updated_at = ? WHERE id = ?",
            (now, project_id),
        )
        conn.commit()
    return get_agent_image(image_id) or {}


def get_agent_image(image_id: str) -> Optional[dict]:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM agent_images WHERE id = ?", (image_id,)).fetchone()
    if not row:
        return None
    return _row_to_agent_image(row)


def list_agent_images(project_id: str, user_id: Optional[str] = None) -> list[dict]:
    with _connect() as conn:
        if user_id:
            rows = conn.execute(
                """
                SELECT i.*
                FROM agent_images i
                JOIN agent_projects p ON p.id = i.project_id
                WHERE i.project_id = ? AND p.user_id = ?
                ORDER BY i.created_at ASC
                """,
                (project_id, user_id),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM agent_images WHERE project_id = ? ORDER BY created_at ASC",
                (project_id,),
            ).fetchall()
    return [_row_to_agent_image(row) for row in rows]


def _row_to_agent_project(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "title": row["title"],
        "status": row["status"],
        "phase": json.loads(row["phase_json"] or "{}"),
        "intent": json.loads(row["intent_json"] or "{}"),
        "brief": json.loads(row["brief_json"]) if row["brief_json"] else None,
        "current_prompt": json.loads(row["current_prompt_json"]) if row["current_prompt_json"] else None,
        "current_image": json.loads(row["current_image_json"]) if row["current_image_json"] else None,
        "conversation_summary": row["conversation_summary"] or "",
        "metadata": json.loads(row["metadata_json"] or "{}"),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _row_to_agent_image(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "project_id": row["project_id"],
        "user_id": row["user_id"],
        "parent_image_id": row["parent_image_id"],
        "iteration_number": row["iteration_number"],
        "provider": row["provider"],
        "model": row["model"],
        "prompt": json.loads(row["prompt_json"] or "{}"),
        "image_url": row["image_url"],
        "vlm_analysis": json.loads(row["vlm_analysis_json"] or "{}"),
        "user_feedback": row["user_feedback"],
        "is_favorite": bool(row["is_favorite"]),
        "user_rating": row["user_rating"],
        "created_at": row["created_at"],
    }


# ─── 操作日志 ──────────────────────────────────────────────────────────────────

def log_operation(*, user_id: str, username: str, action: str, detail: str = "", payload: str = "") -> None:
    """记录用户操作（供管理后台查询），payload 为完整请求 JSON"""
    with _lock, _connect() as conn:
        conn.execute(
            "INSERT INTO operation_logs (user_id, username, action, detail, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, username, action, detail, payload, time.time()),
        )
        conn.commit()


def load_operation_logs(
    limit: int = 50,
    offset: int = 0,
    action: str | None = None,
    user_id: str | None = None,
) -> list[dict]:
    """分页查询操作日志"""
    clauses: list[str] = []
    params: list = []
    if action:
        clauses.append("action = ?")
        params.append(action)
    if user_id:
        clauses.append("user_id = ?")
        params.append(user_id)
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    params.extend([limit, offset])
    with _connect() as conn:
        rows = conn.execute(
            f"SELECT * FROM operation_logs{where} ORDER BY created_at DESC LIMIT ? OFFSET ?",
            tuple(params),
        ).fetchall()
    return [dict(r) for r in rows]


def count_operation_logs(
    action: str | None = None,
    user_id: str | None = None,
) -> int:
    """统计操作日志数量（支持与 load_operation_logs 相同的筛选条件）"""
    clauses: list[str] = []
    params: list = []
    if action:
        clauses.append("action = ?")
        params.append(action)
    if user_id:
        clauses.append("user_id = ?")
        params.append(user_id)
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    with _connect() as conn:
        row = conn.execute(
            f"SELECT COUNT(*) AS c FROM operation_logs{where}",
            tuple(params),
        ).fetchone()
    return int(row["c"]) if row else 0


def load_admin_stats() -> dict:
    """聚合统计信息（合成任务 = 普通合成 + 特殊品合成）"""
    with _connect() as conn:
        user_count = conn.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"]
        job_total = conn.execute("SELECT COUNT(*) AS c FROM jobs").fetchone()["c"]
        job_done = conn.execute("SELECT COUNT(*) AS c FROM jobs WHERE status = 'done'").fetchone()["c"]
        job_failed = conn.execute("SELECT COUNT(*) AS c FROM jobs WHERE status = 'failed'").fetchone()["c"]
        special_total = conn.execute("SELECT COUNT(*) AS c FROM special_jobs").fetchone()["c"]
        special_done = conn.execute("SELECT COUNT(*) AS c FROM special_jobs WHERE status = 'done'").fetchone()["c"]
        special_failed = conn.execute("SELECT COUNT(*) AS c FROM special_jobs WHERE status = 'failed'").fetchone()["c"]
        ai_total = conn.execute("SELECT COUNT(*) AS c FROM ai_image_jobs").fetchone()["c"]
        ai_done = conn.execute("SELECT COUNT(*) AS c FROM ai_image_jobs WHERE status = 'done'").fetchone()["c"]
        agent_total = conn.execute("SELECT COUNT(*) AS c FROM agent_projects").fetchone()["c"]
        chat_total = conn.execute("SELECT COUNT(*) AS c FROM ai_chat_sessions").fetchone()["c"]
        active_sessions = conn.execute("SELECT COUNT(*) AS c FROM sessions").fetchone()["c"]
        op_total = conn.execute("SELECT COUNT(*) AS c FROM operation_logs").fetchone()["c"]
    return {
        "users": user_count,
        "jobs": {
            "total": job_total + special_total,
            "done": job_done + special_done,
            "failed": job_failed + special_failed,
        },
        "special_jobs": special_total,
        "ai_images": {"total": ai_total, "done": ai_done},
        "agent_projects": agent_total,
        "ai_chat_sessions": chat_total,
        "active_sessions": active_sessions,
        "operations_logged": op_total,
    }


def load_admin_users() -> list[dict]:
    """用户列表 + 每人活动统计"""
    with _connect() as conn:
        rows = conn.execute("SELECT id, username, created_at FROM users ORDER BY created_at DESC").fetchall()
    users: list[dict] = []
    for row in rows:
        uid = row["id"]
        with _connect() as conn:
            job_c = conn.execute("SELECT COUNT(*) AS c FROM jobs WHERE user_id = ?", (uid,)).fetchone()["c"]
            special_c = conn.execute("SELECT COUNT(*) AS c FROM special_jobs WHERE user_id = ?", (uid,)).fetchone()["c"]
            ai_c = conn.execute("SELECT COUNT(*) AS c FROM ai_image_jobs WHERE user_id = ?", (uid,)).fetchone()["c"]
            proj_c = conn.execute("SELECT COUNT(*) AS c FROM agent_projects WHERE user_id = ?", (uid,)).fetchone()["c"]
            op_c = conn.execute("SELECT COUNT(*) AS c FROM operation_logs WHERE user_id = ?", (uid,)).fetchone()["c"]
            last_op = conn.execute(
                "SELECT action, created_at FROM operation_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
                (uid,),
            ).fetchone()
        users.append({
            "id": row["id"],
            "username": row["username"],
            "created_at": row["created_at"],
            "total_jobs": job_c + special_c,
            "total_special_jobs": special_c,
            "total_ai_images": ai_c,
            "total_agent_projects": proj_c,
            "total_operations": op_c,
            "last_action": dict(last_op) if last_op else None,
        })
    return users


# ─── 灵感（inspiration_posts）──────────────────────────────────────────────────

def create_inspiration_post(
    post_id: str,
    job_id: str,
    user_id: str,
    image_url: str,
    thumb_url: str,
    prompt: str,
    model: str,
    size: str,
    resolution: str,
    has_ref: bool,
    image_width: int,
    image_height: int,
    created_at: float,
    category: str = "share_card",
    tags: Optional[list[str]] = None,
    original_prompt: str = "",
    resolved_prompt: str = "",
) -> bool:
    """发布灵感记录。同一 job_id 唯一约束, 重复插入返回 False (调用方应转为 already_published 语义)。"""
    try:
        with _lock, _connect() as conn:
            conn.execute(
                """
                INSERT INTO inspiration_posts
                    (id, job_id, user_id, image_url, thumb_url, prompt, original_prompt, resolved_prompt, model, size, resolution, has_ref, image_width, image_height, category, tags_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    post_id, job_id, user_id, image_url, thumb_url,
                    prompt, original_prompt or "", resolved_prompt or prompt or "",
                    model, size, resolution, 1 if has_ref else 0,
                    int(image_width or 0), int(image_height or 0),
                    category or "share_card", json.dumps(tags or [], ensure_ascii=False), created_at,
                ),
            )
        return True
    except Exception as e:
        # UNIQUE INDEX 冲突: 同 job_id 重复插入, 视为已存在
        if "UNIQUE constraint failed" in str(e):
            return False
        raise


def update_inspiration_thumb_url(post_id: str, thumb_url: str) -> None:
    """回填缩略图 URL（旧记录兼容用）。"""
    with _connect() as conn:
        conn.execute("UPDATE inspiration_posts SET thumb_url = ? WHERE id = ?", (thumb_url, post_id))


def update_inspiration_dimensions(post_id: str, image_width: int, image_height: int) -> None:
    """回填图片宽高。"""
    with _connect() as conn:
        conn.execute("UPDATE inspiration_posts SET image_width = ?, image_height = ? WHERE id = ?",
                     (int(image_width or 0), int(image_height or 0), post_id))


def update_inspiration_vlm(post_id: str, prompt: str, description: str) -> None:
    with _lock, _connect() as conn:
        conn.execute(
            "UPDATE inspiration_posts SET vlm_prompt = ?, vlm_description = ? WHERE id = ?",
            (prompt or "", description or "", post_id),
        )


def find_inspiration_vlm_cache(job_id: str | None = None, image_url: str | None = None) -> dict | None:
    clauses: list[str] = []
    params: list[str] = []
    if job_id:
        clauses.append("job_id = ?")
        params.append(job_id)
    if image_url:
        clauses.append("image_url = ?")
        params.append(image_url)
    if not clauses:
        return None
    with _connect() as conn:
        row = conn.execute(
            f"""
            SELECT id, vlm_prompt, vlm_description
            FROM inspiration_posts
            WHERE ({' OR '.join(clauses)})
              AND vlm_prompt IS NOT NULL
              AND vlm_prompt != ''
            ORDER BY created_at DESC
            LIMIT 1
            """,
            params,
        ).fetchone()
    return dict(row) if row else None


def get_inspiration_post_by_job(job_id: str) -> dict | None:
    """根据 job_id 查找已发布的灵感（用于检测同 job 是否已发布）。"""
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM inspiration_posts WHERE job_id = ? ORDER BY created_at DESC LIMIT 1",
            (job_id,),
        ).fetchone()
    return dict(row) if row else None


def get_inspiration_post(post_id: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM inspiration_posts WHERE id = ?", (post_id,),
        ).fetchone()
    return dict(row) if row else None


def delete_inspiration_post(post_id: str) -> bool:
    with _lock, _connect() as conn:
        cur = conn.execute("DELETE FROM inspiration_posts WHERE id = ?", (post_id,))
        return cur.rowcount > 0


def list_inspiration_posts(
    limit: int,
    offset: int,
    mine_user_id: str | None = None,
    category: str | None = None,
    favorite_user_id: str | None = None,
    search: str | None = None,
) -> list[dict]:
    """列出灵感。支持按发布者、分类、收藏、prompt/tag 搜索过滤。"""
    clauses: list[str] = []
    params: list[object] = []
    join = ""
    if favorite_user_id:
        join = "JOIN inspiration_favorites f ON f.post_id = p.id AND f.user_id = ?"
        params.append(favorite_user_id)
    if mine_user_id:
        clauses.append("p.user_id = ?")
        params.append(mine_user_id)
    if category:
        clauses.append("p.category = ?")
        params.append(category)
    if search:
        clauses.append("(p.prompt LIKE ? OR p.tags_json LIKE ? OR p.vlm_prompt LIKE ? OR p.vlm_description LIKE ?)")
        q = f"%{search}%"
        params.extend([q, q, q, q])
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    with _connect() as conn:
        rows = conn.execute(
            f"SELECT p.* FROM inspiration_posts p {join} {where} ORDER BY p.created_at DESC LIMIT ? OFFSET ?",
            (*params, limit, offset),
        ).fetchall()
    return [dict(r) for r in rows]


def is_inspiration_favorited(post_id: str, user_id: str) -> bool:
    with _connect() as conn:
        row = conn.execute(
            "SELECT 1 FROM inspiration_favorites WHERE post_id = ? AND user_id = ?",
            (post_id, user_id),
        ).fetchone()
    return bool(row)


def list_inspiration_favorite_ids(post_ids: list[str], user_id: str) -> set[str]:
    if not post_ids or not user_id:
        return set()
    placeholders = ",".join("?" * len(post_ids))
    with _connect() as conn:
        rows = conn.execute(
            f"SELECT post_id FROM inspiration_favorites WHERE user_id = ? AND post_id IN ({placeholders})",
            (user_id, *post_ids),
        ).fetchall()
    return {str(row["post_id"]) for row in rows}


def set_inspiration_favorite(post_id: str, user_id: str, favorite: bool) -> bool:
    with _lock, _connect() as conn:
        if favorite:
            conn.execute(
                "INSERT OR IGNORE INTO inspiration_favorites (post_id, user_id, created_at) VALUES (?, ?, ?)",
                (post_id, user_id, time.time()),
            )
            return True
        cur = conn.execute(
            "DELETE FROM inspiration_favorites WHERE post_id = ? AND user_id = ?",
            (post_id, user_id),
        )
        return cur.rowcount > 0

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
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Optional

import bcrypt

from .config import settings
from .models import ComposeJob, ComposeRequest, ComposeStatus


_DB_PATH = settings.root_dir / "jobs.db"
_lock = threading.Lock()


def _json_value(raw, fallback):
    if raw in (None, ""):
        return fallback
    try:
        return json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return raw


def _json_object(raw) -> dict:
    value = _json_value(raw, {})
    return value if isinstance(value, dict) else {"raw": value}


@contextmanager
def _connect() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(str(_DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        # Preserve sqlite3's native commit/rollback behavior while still
        # releasing the file handle deterministically on every platform.
        with conn:
            yield conn
    finally:
        conn.close()


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
                provider         TEXT,
                prompt           TEXT NOT NULL,
                original_prompt  TEXT NOT NULL DEFAULT '',
                resolved_prompt  TEXT NOT NULL DEFAULT '',
                prompt_trace     TEXT NOT NULL DEFAULT '',
                size             TEXT NOT NULL,
                resolution       TEXT,
                image_url        TEXT,
                has_reference    INTEGER NOT NULL DEFAULT 0,
                reference_count  INTEGER,
                request_meta_json TEXT,
                error            TEXT,
                task_id          TEXT,
                progress         INTEGER NOT NULL DEFAULT 0,
                created_at       REAL NOT NULL,
                updated_at       REAL
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
            ("provider", "TEXT"),
            ("resolution", "TEXT"),
            ("reference_count", "INTEGER"),
            ("request_meta_json", "TEXT"),
            ("updated_at", "REAL"),
        ]:
            try:
                conn.execute(f"ALTER TABLE ai_image_jobs ADD COLUMN {col} {col_def}")
            except Exception:
                pass
        conn.execute("""
        """)
        conn.execute(
            "UPDATE ai_image_jobs SET updated_at = created_at WHERE updated_at IS NULL"
        )
        conn.execute("""
            CREATE TABLE IF NOT EXISTS editor_snapshots (
                user_id          TEXT PRIMARY KEY,
                snapshot_json    TEXT NOT NULL,
                updated_at       REAL NOT NULL,
                revision         INTEGER NOT NULL DEFAULT 1
            )
        """)
        try:
            conn.execute("ALTER TABLE editor_snapshots ADD COLUMN revision INTEGER NOT NULL DEFAULT 1")
        except Exception:
            pass
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
            CREATE TABLE IF NOT EXISTS admin_alert_acknowledgements (
                alert_type       TEXT PRIMARY KEY,
                fingerprint      TEXT NOT NULL,
                acknowledged_by  TEXT NOT NULL,
                acknowledged_at  REAL NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS service_probes (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                service       TEXT NOT NULL,
                scheduled_slot TEXT NOT NULL,
                status        TEXT NOT NULL,
                latency_ms    INTEGER,
                result_json   TEXT NOT NULL DEFAULT '{}',
                error         TEXT NOT NULL DEFAULT '',
                created_at    REAL NOT NULL,
                completed_at  REAL,
                UNIQUE(service, scheduled_slot)
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_service_probes_latest
            ON service_probes(service, created_at DESC)
        """)
        # Admin console reads these columns frequently. Additive indexes keep the
        # operational views responsive without changing any task write path.
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_jobs_admin
            ON jobs(created_at, status)
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_special_jobs_admin
            ON special_jobs(created_at, status)
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_ai_image_jobs_admin
            ON ai_image_jobs(created_at, status)
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_ai_image_jobs_provider
            ON ai_image_jobs(provider, created_at)
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_agent_images_admin
            ON agent_images(created_at, user_id)
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
    provider: str | None = None,
    resolution: str | None = None,
    original_prompt: str | None = None,
    resolved_prompt: str | None = None,
    prompt_trace: str | None = None,
    image_url: str | None = None,
    has_reference: bool = False,
    reference_count: int | None = None,
    request_meta: dict | str | None = None,
    error: str | None = None,
    task_id: str | None = None,
    progress: int = 0,
    created_at: float | None = None,
) -> None:
    now = created_at or time.time()
    updated_at = time.time()
    if isinstance(request_meta, dict):
        request_meta_json = json.dumps(request_meta, ensure_ascii=False)
    elif isinstance(request_meta, str):
        request_meta_json = request_meta
    else:
        request_meta_json = None
    with _lock, _connect() as conn:
        conn.execute(
            """
            INSERT INTO ai_image_jobs
              (id, user_id, status, model, provider, prompt, original_prompt, resolved_prompt,
               prompt_trace, size, resolution, image_url, has_reference, reference_count,
               request_meta_json, error, task_id, progress, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                user_id = excluded.user_id,
                status = excluded.status,
                model = excluded.model,
                provider = COALESCE(excluded.provider, ai_image_jobs.provider),
                prompt = excluded.prompt,
                original_prompt = excluded.original_prompt,
                resolved_prompt = excluded.resolved_prompt,
                prompt_trace = excluded.prompt_trace,
                size = excluded.size,
                resolution = COALESCE(excluded.resolution, ai_image_jobs.resolution),
                image_url = excluded.image_url,
                has_reference = excluded.has_reference,
                reference_count = COALESCE(excluded.reference_count, ai_image_jobs.reference_count),
                request_meta_json = COALESCE(excluded.request_meta_json, ai_image_jobs.request_meta_json),
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
                progress = excluded.progress,
                updated_at = excluded.updated_at
            """,
            (
                job_id,
                user_id,
                status,
                model,
                provider,
                prompt,
                original_prompt or "",
                resolved_prompt or prompt or "",
                prompt_trace or "",
                size,
                resolution,
                image_url,
                1 if has_reference else 0,
                reference_count,
                request_meta_json,
                error,
                task_id,
                progress,
                now,
                updated_at,
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
            "provider": row["provider"] if "provider" in row.keys() else None,
            "prompt": row["prompt"],
            "original_prompt": row["original_prompt"] if "original_prompt" in row.keys() else "",
            "resolved_prompt": row["resolved_prompt"] if "resolved_prompt" in row.keys() else "",
            "size": row["size"],
            "resolution": row["resolution"] if "resolution" in row.keys() else None,
            "image_url": row["image_url"],
            "has_reference": bool(row["has_reference"]),
            "reference_count": row["reference_count"] if "reference_count" in row.keys() else None,
            "error": row["error"],
            "task_id": row["task_id"],
            "progress": row["progress"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"] if "updated_at" in row.keys() else row["created_at"],
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
        "provider": row["provider"] if "provider" in row.keys() else None,
        "prompt": row["prompt"],
        "original_prompt": row["original_prompt"] if "original_prompt" in row.keys() else "",
        "resolved_prompt": row["resolved_prompt"] if "resolved_prompt" in row.keys() else "",
        "prompt_trace": row["prompt_trace"] if "prompt_trace" in row.keys() else "",
        "size": row["size"],
        "image_url": row["image_url"],
        "has_reference": bool(row["has_reference"]),
        "reference_count": row["reference_count"] if "reference_count" in row.keys() else None,
        "request_meta": _json_object(row["request_meta_json"]) if "request_meta_json" in row.keys() else {},
        "error": row["error"],
        "task_id": row["task_id"],
        "progress": int(row["progress"] or 0),
        "resolution": row["resolution"] if "resolution" in row.keys() else "",
        "provider_switched": bool(row["provider_switched"]) if "provider_switched" in row.keys() else False,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"] if "updated_at" in row.keys() else row["created_at"],
    }


def mark_ai_image_job_provider_switched(job_id: str, switched: bool = True) -> None:
    """标记生图 job发生过 provider 兜底切换。独立函数，避免动 save_ai_image_job 签名。"""
    with _lock, _connect() as conn:
        conn.execute(
            "UPDATE ai_image_jobs SET provider_switched = ?, updated_at = ? WHERE id = ?",
            (1 if switched else 0, time.time(), job_id),
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

    # 1. 结构无效保护：新快照没有任何 page (pages == 0)
    if new["pages"] == 0:
        return True

    # 2. 初始空画板覆盖保护（加载失败/崩溃时产生的默认单页 0 图快照覆盖原有有效数据）：
    if (old["shapes"] >= 3 or old["pages"] > 1) and new["shapes"] == 0:
        return True

    # 3. 多页画板丢失/崩溃折叠保护：
    # 旧快照包含多页 (pages > 1)，而新快照画板数减少 (pages < old.pages)，且内容严重缩减
    if old["pages"] > 1 and new["pages"] < old["pages"]:
        if new["shapes"] <= old["shapes"] // 2 or new["json_len"] < old["json_len"] // 3:
            return True

    return False


def save_editor_snapshot(
    user_id: str,
    snapshot_json: str,
    base_revision: int | None = None,
    intent: str | None = None,
) -> tuple[bool, int, str | None]:
    now = time.time()
    with _lock, _connect() as conn:
        try:
            conn.execute("ALTER TABLE editor_snapshots ADD COLUMN revision INTEGER NOT NULL DEFAULT 1")
        except Exception:
            pass
        existing = conn.execute(
            "SELECT snapshot_json, revision FROM editor_snapshots WHERE user_id = ?",
            (user_id,),
        ).fetchone()

        if not existing:
            conn.execute(
                """
                INSERT INTO editor_snapshots (user_id, snapshot_json, updated_at, revision)
                VALUES (?, ?, ?, 1)
                """,
                (user_id, snapshot_json, now),
            )
            conn.commit()
            return True, 1, None

        old_json = existing["snapshot_json"]
        old_revision = int(existing["revision"] or 1)
        new_stats = _editor_snapshot_stats(snapshot_json)

        # 1. 无效结构拦截
        if new_stats["pages"] == 0:
            return False, old_revision, "invalid_snapshot_structure"

        # 2. 覆盖防护拦截：若非用户明确发起的删除操作 (intent != 'user_delete')，
        # 且符合异常清空/缩减特征（如默认单页空画板覆盖原有数据），一律拒绝覆盖！
        if intent != "user_delete" and _should_reject_editor_snapshot_overwrite(old_json, snapshot_json):
            reject_dir = settings.root_dir / "output" / "editor-snapshot-rejected"
            reject_dir.mkdir(parents=True, exist_ok=True)
            reject_path = reject_dir / f"{user_id}-{int(now)}.json"
            reject_path.write_text(snapshot_json, encoding="utf-8")
            return False, old_revision, "uninitialized_overwrite_rejected"

        # 3. 如果客户端显式提供了 base_revision：必须与当前数据库里的 old_revision 完全一致
        if base_revision is not None:
            if int(base_revision) != old_revision:
                # 严格拒绝所有过期的 stale 提交，不给机会溜到后面的覆盖分支！
                return False, old_revision, "stale_revision"

            new_revision = old_revision + 1
            conn.execute(
                """
                UPDATE editor_snapshots
                SET snapshot_json = ?, updated_at = ?, revision = ?
                WHERE user_id = ?
                """,
                (snapshot_json, now, new_revision, user_id),
            )
            conn.commit()
            return True, new_revision, None

        # 3. 只有未提供 base_revision 的旧客户端，才走回退防护规则
        if _should_reject_editor_snapshot_overwrite(old_json, snapshot_json):
            reject_dir = settings.root_dir / "output" / "editor-snapshot-rejected"
            reject_dir.mkdir(parents=True, exist_ok=True)
            reject_path = reject_dir / f"{user_id}-{int(now)}.json"
            reject_path.write_text(snapshot_json, encoding="utf-8")
            return False, old_revision, "stale_revision_or_uninitialized"

        new_revision = old_revision + 1
        conn.execute(
            """
            UPDATE editor_snapshots
            SET snapshot_json = ?, updated_at = ?, revision = ?
            WHERE user_id = ?
            """,
            (snapshot_json, now, new_revision, user_id),
        )
        conn.commit()
        return True, new_revision, None


def load_editor_snapshot(user_id: str) -> tuple[str | None, int]:
    with _connect() as conn:
        try:
            conn.execute("ALTER TABLE editor_snapshots ADD COLUMN revision INTEGER NOT NULL DEFAULT 1")
        except Exception:
            pass
        row = conn.execute(
            "SELECT snapshot_json, revision FROM editor_snapshots WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    if not row:
        return None, 0
    return row["snapshot_json"], int(row["revision"] or 1)


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
    display_name_map = _admin_display_name_map()
    result = []
    for row in rows:
        item = dict(row)
        item["display_name"] = display_name_map.get(str(item.get("user_id") or ""), "")
        result.append(item)
    return result


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


_ADMIN_ACTIVE_STATUSES = {"pending", "queued", "processing", "running"}


def _admin_display_name_map() -> dict[str, str]:
    """Admin-only labels; authentication continues to use id/username unchanged."""
    return {
        str(item.get("id") or ""): str(item.get("display_name") or "").strip()
        for item in settings.allowed_login_users
        if str(item.get("id") or "").strip() and str(item.get("display_name") or "").strip()
    }


def _admin_task_rows(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    """Return a small normalized projection across every persisted task table."""
    return conn.execute(
        """
        SELECT 'compose' AS task_type, id, user_id, status, created_at,
               updated_at, error, '' AS model
        FROM jobs
        UNION ALL
        SELECT 'special' AS task_type, id, user_id, status, created_at,
               updated_at, error, '' AS model
        FROM special_jobs
        UNION ALL
        SELECT 'ai_image' AS task_type, id, user_id, status, created_at,
               COALESCE(updated_at, created_at) AS updated_at, error, model
        FROM ai_image_jobs
        UNION ALL
        SELECT 'agent_image' AS task_type, id, user_id, 'done' AS status, created_at,
               created_at AS updated_at, '' AS error, model
        FROM agent_images
        """
    ).fetchall()


def _admin_failure_group(error: str) -> tuple[str, str]:
    text = (error or "").casefold()
    if any(token in text for token in ("timeout", "timed out", "超时")):
        return "timeout", "请求超时"
    if any(token in text for token in ("429", "rate limit", "too many request", "限流")):
        return "rate_limit", "服务限流"
    if any(token in text for token in ("401", "403", "unauthorized", "forbidden", "鉴权", "权限")):
        return "auth", "鉴权失败"
    if any(token in text for token in ("400", "invalid", "参数", "格式错误")):
        return "request", "请求参数"
    if any(
        token in text
        for token in (
            "500",
            "502",
            "503",
            "504",
            "server disconnected",
            "service unavailable",
            "upstream",
            "服务暂时不可用",
        )
    ):
        return "upstream", "上游服务"
    return "other", "其他错误"


def acknowledge_admin_alert(alert_type: str, fingerprint: str, user_id: str) -> dict:
    clean_type = str(alert_type or "").strip()
    clean_fingerprint = str(fingerprint or "").strip()
    if not clean_type or not clean_fingerprint:
        raise ValueError("alert type and fingerprint required")
    now = time.time()
    with _lock, _connect() as conn:
        conn.execute(
            """
            INSERT INTO admin_alert_acknowledgements
              (alert_type, fingerprint, acknowledged_by, acknowledged_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(alert_type) DO UPDATE SET
              fingerprint = excluded.fingerprint,
              acknowledged_by = excluded.acknowledged_by,
              acknowledged_at = excluded.acknowledged_at
            """,
            (clean_type, clean_fingerprint, str(user_id or ""), now),
        )
        conn.commit()
    return {
        "alert_type": clean_type,
        "fingerprint": clean_fingerprint,
        "acknowledged_by": str(user_id or ""),
        "acknowledged_at": now,
    }


def claim_service_probe(service: str, scheduled_slot: str) -> bool:
    """Atomically claim one scheduled probe slot across restarts/processes."""
    with _lock, _connect() as conn:
        cursor = conn.execute(
            """
            INSERT OR IGNORE INTO service_probes
              (service, scheduled_slot, status, created_at)
            VALUES (?, ?, 'running', ?)
            """,
            (str(service), str(scheduled_slot), time.time()),
        )
        conn.commit()
        return cursor.rowcount == 1


def complete_service_probe(
    service: str,
    scheduled_slot: str,
    *,
    status: str,
    latency_ms: int,
    result: dict | None = None,
    error: str = "",
) -> None:
    with _lock, _connect() as conn:
        conn.execute(
            """
            UPDATE service_probes
            SET status = ?, latency_ms = ?, result_json = ?, error = ?, completed_at = ?
            WHERE service = ? AND scheduled_slot = ?
            """,
            (
                str(status),
                max(0, int(latency_ms or 0)),
                json.dumps(result or {}, ensure_ascii=False),
                str(error or "")[:2000],
                time.time(),
                str(service),
                str(scheduled_slot),
            ),
        )
        conn.commit()


def load_latest_service_probe(service: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT * FROM service_probes
            WHERE service = ?
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (str(service),),
        ).fetchone()
    if not row:
        return None
    item = dict(row)
    item["result"] = _json_object(item.pop("result_json", "{}"))
    return item


def load_latest_completed_service_probe(service: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT * FROM service_probes
            WHERE service = ? AND status IN ('done', 'failed')
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (str(service),),
        ).fetchone()
    if not row:
        return None
    item = dict(row)
    item["result"] = _json_object(item.pop("result_json", "{}"))
    return item


def load_service_probes(service: str, limit: int = 48) -> list[dict]:
    safe_limit = max(1, min(int(limit or 48), 200))
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM service_probes
            WHERE service = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (str(service), safe_limit),
        ).fetchall()
    probes = []
    for row in rows:
        item = dict(row)
        item["result"] = _json_object(item.pop("result_json", "{}"))
        probes.append(item)
    return probes


def prune_service_probes(service: str, before: float) -> list[str]:
    """Delete expired probe rows and return their local image URLs for cleanup."""
    with _lock, _connect() as conn:
        rows = conn.execute(
            "SELECT result_json FROM service_probes WHERE service = ? AND created_at < ?",
            (str(service), float(before)),
        ).fetchall()
        conn.execute(
            "DELETE FROM service_probes WHERE service = ? AND created_at < ?",
            (str(service), float(before)),
        )
    image_urls = []
    for row in rows:
        result = _json_object(row["result_json"])
        image_url = str(result.get("image_url") or "")
        if image_url:
            image_urls.append(image_url)
    return image_urls


def load_admin_overview(hours: int = 24) -> dict:
    """Operational overview for Admin; all calculations are read-only."""
    requested_hours = int(hours)
    all_time = requested_hours == 0
    safe_hours = 0 if all_time else max(1, min(requested_hours, 24 * 31))
    now = time.time()

    with _connect() as conn:
        rows = [dict(row) for row in _admin_task_rows(conn)]
        if all_time:
            active_user_rows = conn.execute(
                "SELECT COUNT(DISTINCT user_id) AS c FROM operation_logs"
            ).fetchone()
        else:
            active_user_rows = conn.execute(
                """
                SELECT COUNT(DISTINCT user_id) AS c
                FROM operation_logs
                WHERE created_at >= ?
                """,
                (now - safe_hours * 3600,),
            ).fetchone()
        user_rows = conn.execute("SELECT id, username FROM users").fetchall()
        stale_ack = conn.execute(
            "SELECT * FROM admin_alert_acknowledgements WHERE alert_type = 'stale_tasks'"
        ).fetchone()

    earliest_created_at = min(
        (float(row.get("created_at") or now) for row in rows),
        default=now,
    )
    since = earliest_created_at if all_time else now - safe_hours * 3600
    window_seconds = max(3600, now - since) if all_time else safe_hours * 3600
    previous_since = since - window_seconds
    username_map = {str(row["id"]): str(row["username"]) for row in user_rows}
    display_name_map = _admin_display_name_map()

    current = rows if all_time else [
        row for row in rows if float(row["created_at"] or 0) >= since
    ]
    previous = [] if all_time else [
        row for row in rows
        if previous_since <= float(row["created_at"] or 0) < since
    ]

    def summarize(items: list[dict]) -> dict:
        done = sum(1 for item in items if item["status"] == "done")
        failed = sum(1 for item in items if item["status"] == "failed")
        active = sum(1 for item in items if item["status"] in _ADMIN_ACTIVE_STATUSES)
        terminal = done + failed
        return {
            "total": len(items),
            "done": done,
            "failed": failed,
            "active": active,
            "success_rate": round(done * 100 / terminal, 1) if terminal else None,
        }

    current_summary = summarize(current)
    previous_summary = summarize(previous)
    current_summary["volume_change"] = (
        round((current_summary["total"] - previous_summary["total"]) * 100 / previous_summary["total"], 1)
        if previous_summary["total"]
        else None
    )
    current_summary["success_rate_change"] = (
        round(current_summary["success_rate"] - previous_summary["success_rate"], 1)
        if current_summary["success_rate"] is not None and previous_summary["success_rate"] is not None
        else None
    )

    breakdown = []
    for task_type in ("ai_image", "agent_image", "compose", "special"):
        summary = summarize([item for item in current if item["task_type"] == task_type])
        summary["type"] = task_type
        breakdown.append(summary)

    bucket_count = 12
    bucket_seconds = window_seconds / bucket_count
    series = []
    for index in range(bucket_count):
        start = since + index * bucket_seconds
        series.append(
            {
                "timestamp": start,
                "total": 0,
                "done": 0,
                "failed": 0,
                "ai_image": 0,
                "agent_image": 0,
                "compose": 0,
                "special": 0,
            }
        )
    for item in current:
        index = int((float(item["created_at"] or 0) - since) / bucket_seconds)
        index = max(0, min(bucket_count - 1, index))
        bucket = series[index]
        bucket["total"] += 1
        if item["task_type"] in {"ai_image", "agent_image", "compose", "special"}:
            bucket[item["task_type"]] += 1
        if item["status"] == "done":
            bucket["done"] += 1
        elif item["status"] == "failed":
            bucket["failed"] += 1

    health_bucket_count = 72
    health_bucket_seconds = window_seconds / health_bucket_count
    health_timeline = []
    for index in range(health_bucket_count):
        start = since + index * health_bucket_seconds
        health_timeline.append(
            {
                "timestamp": start,
                "total": 0,
                "done": 0,
                "failed": 0,
                "active": 0,
                "state": "unknown",
            }
        )
    for item in current:
        index = int((float(item["created_at"] or 0) - since) / health_bucket_seconds)
        index = max(0, min(health_bucket_count - 1, index))
        bucket = health_timeline[index]
        bucket["total"] += 1
        if item["status"] == "done":
            bucket["done"] += 1
        elif item["status"] == "failed":
            bucket["failed"] += 1
        elif item["status"] in _ADMIN_ACTIVE_STATUSES:
            bucket["active"] += 1
    for bucket in health_timeline:
        terminal = bucket["done"] + bucket["failed"]
        if not bucket["total"]:
            bucket["state"] = "unknown"
        elif bucket["failed"]:
            failure_rate = bucket["failed"] / max(1, terminal)
            bucket["state"] = "warning" if failure_rate <= 0.2 else "degraded"
        elif bucket["active"] and not terminal:
            bucket["state"] = "warning"
        else:
            bucket["state"] = "healthy"

    failure_counts: dict[str, dict] = {}
    for item in current:
        if item["status"] != "failed":
            continue
        key, label = _admin_failure_group(item.get("error") or "")
        entry = failure_counts.setdefault(key, {"key": key, "label": label, "count": 0})
        entry["count"] += 1

    stale_threshold = now - 10 * 60
    stale_tasks = [
        {
            "id": item["id"],
            "type": item["task_type"],
            "user_id": item["user_id"],
            "status": item["status"],
            "model": item["model"],
            "created_at": item["created_at"],
            "age_seconds": max(0, int(now - float(item["created_at"] or now))),
        }
        for item in rows
        if item["status"] in _ADMIN_ACTIVE_STATUSES
        and float(item["created_at"] or 0) < stale_threshold
    ]
    stale_tasks.sort(key=lambda item: item["created_at"])
    stale_alert_key = ""
    if stale_tasks:
        stale_ids = "|".join(
            sorted(f"{item['type']}:{item['id']}" for item in stale_tasks)
        )
        stale_alert_key = hashlib.sha256(stale_ids.encode("utf-8")).hexdigest()
    stale_alert_acknowledged = bool(
        stale_alert_key
        and stale_ack
        and str(stale_ack["fingerprint"]) == stale_alert_key
    )

    recent_failures = [
        {
            "id": item["id"],
            "type": item["task_type"],
            "user_id": item["user_id"],
            "model": item["model"],
            "error": item.get("error") or "未记录失败原因",
            "created_at": item["created_at"],
        }
        for item in rows
        if item["status"] == "failed"
    ]
    recent_failures.sort(key=lambda item: item["created_at"], reverse=True)

    ranking_by_user: dict[str, dict] = {}
    for item in current:
        uid = str(item.get("user_id") or "")
        if not uid:
            continue
        entry = ranking_by_user.setdefault(
            uid,
            {
                "user_id": uid,
                "username": username_map.get(uid) or uid,
                "display_name": display_name_map.get(uid, ""),
                "image_count": 0,
                "compose_count": 0,
                "total_count": 0,
            },
        )
        entry["total_count"] += 1
        if item["task_type"] in {"ai_image", "agent_image"}:
            entry["image_count"] += 1
        elif item["task_type"] in {"compose", "special"}:
            entry["compose_count"] += 1
    user_ranking = sorted(
        (item for item in ranking_by_user.values() if item["image_count"] > 0),
        key=lambda item: (-item["image_count"], -item["total_count"], item["user_id"]),
    )[:5]

    return {
        "generated_at": now,
        "range_hours": safe_hours,
        "summary": current_summary,
        "previous_summary": previous_summary,
        "breakdown": breakdown,
        "series": series,
        "health_timeline": health_timeline,
        "active_users": int(active_user_rows["c"] if active_user_rows else 0),
        "stale_tasks": stale_tasks[:20],
        "stale_alert_key": stale_alert_key,
        "stale_alert_acknowledged": stale_alert_acknowledged,
        "stale_alert_acknowledgement": dict(stale_ack) if stale_alert_acknowledged else None,
        "recent_failures": recent_failures[:8],
        "user_ranking": user_ranking,
        "failure_reasons": sorted(
            failure_counts.values(),
            key=lambda item: item["count"],
            reverse=True,
        ),
    }


def load_admin_tasks(
    *,
    limit: int = 50,
    offset: int = 0,
    status: str | None = None,
    task_type: str | None = None,
    user_id: str | None = None,
    search: str | None = None,
    provider: str | None = None,
    reference: str | None = None,
) -> tuple[list[dict], int]:
    """Unified paginated task list used by the operations console."""
    safe_limit = max(1, min(int(limit or 50), 200))
    safe_offset = max(0, int(offset or 0))
    clauses: list[str] = []
    params: list = []
    if status:
        if status == "active":
            clauses.append("status IN ('pending', 'queued', 'processing', 'running')")
        else:
            clauses.append("status = ?")
            params.append(status)
    if task_type:
        clauses.append("task_type = ?")
        params.append(task_type)
    if user_id:
        clauses.append("user_id = ?")
        params.append(user_id)
    if provider:
        clauses.append("provider = ?")
        params.append(provider)
    if reference == "yes":
        clauses.append("has_reference = 1")
    elif reference == "no":
        clauses.append("has_reference = 0")
    clean_search = (search or "").strip()
    if clean_search:
        clauses.append(
            """
            (
                id LIKE ? OR user_id LIKE ? OR model LIKE ? OR
                summary LIKE ? OR error LIKE ? OR
                user_id IN (SELECT id FROM users WHERE username LIKE ?)
            )
            """
        )
        pattern = f"%{clean_search}%"
        params.extend([pattern] * 6)
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""

    task_cte = """
        WITH all_tasks AS (
            SELECT 'compose' AS task_type, id, user_id, status, created_at,
                   updated_at, error, '' AS model, request_json AS summary,
                   0 AS progress, '' AS image_url, 'penpot' AS provider,
                   0 AS has_reference, NULL AS reference_count, '' AS resolution
            FROM jobs
            UNION ALL
            SELECT 'special' AS task_type, id, user_id, status, created_at,
                   updated_at, error, '' AS model, sku AS summary,
                   0 AS progress, '' AS image_url, 'penpot' AS provider,
                   0 AS has_reference, NULL AS reference_count, '' AS resolution
            FROM special_jobs
            UNION ALL
            SELECT 'ai_image' AS task_type, id, user_id, status, created_at,
                   COALESCE(updated_at, created_at) AS updated_at, error, model, prompt AS summary,
                   progress, COALESCE(image_url, '') AS image_url, COALESCE(provider, '') AS provider,
                   has_reference, reference_count, COALESCE(resolution, '') AS resolution
            FROM ai_image_jobs
            UNION ALL
            SELECT 'agent_image' AS task_type, id, user_id, 'done' AS status, created_at,
                   created_at AS updated_at, '' AS error, model, prompt_json AS summary,
                   100 AS progress, COALESCE(image_url, '') AS image_url, COALESCE(provider, '') AS provider,
                   CASE WHEN parent_image_id IS NULL THEN 0 ELSE 1 END AS has_reference,
                   CASE WHEN parent_image_id IS NULL THEN 0 ELSE 1 END AS reference_count,
                   '' AS resolution
            FROM agent_images
        )
    """
    with _connect() as conn:
        total_row = conn.execute(
            task_cte + f" SELECT COUNT(*) AS c FROM all_tasks{where}",
            tuple(params),
        ).fetchone()
        rows = conn.execute(
            task_cte
            + f"""
              SELECT filtered_tasks.*, users.username
              FROM (
                  SELECT * FROM all_tasks
                  {where}
              ) AS filtered_tasks
              LEFT JOIN users ON users.id = filtered_tasks.user_id
              ORDER BY filtered_tasks.created_at DESC
              LIMIT ? OFFSET ?
            """,
            tuple(params + [safe_limit, safe_offset]),
        ).fetchall()

    tasks = []
    display_name_map = _admin_display_name_map()
    for row in rows:
        item = dict(row)
        summary = str(item.get("summary") or "").strip()
        if item["task_type"] == "compose" and summary:
            try:
                payload = json.loads(summary)
                slot_count = len(payload.get("slots") or {})
                frame_id = str(payload.get("template_frame_id") or "")
                summary = f"{slot_count} 个槽位 · 模板 {frame_id[:8]}" if slot_count else f"模板 {frame_id[:8]}"
            except Exception:
                summary = "模板合成"
        elif item["task_type"] == "agent_image" and summary:
            payload = _json_object(summary)
            summary = str(
                payload.get("positive_prompt")
                or payload.get("prompt")
                or payload.get("subject")
                or "Agent 生图"
            )
        item["summary"] = summary[:240]
        item["error"] = str(item.get("error") or "")[:500]
        item["username"] = item.get("username") or item.get("user_id") or "未知用户"
        item["display_name"] = display_name_map.get(str(item.get("user_id") or ""), "")
        tasks.append(item)
    return tasks, int(total_row["c"] if total_row else 0)


def load_admin_task_detail(task_type: str, task_id: str) -> dict | None:
    """Load the full persisted snapshot for one task without guessing missing fields."""
    display_name_map = _admin_display_name_map()
    with _connect() as conn:
        if task_type == "compose":
            row = conn.execute(
                """
                SELECT jobs.*, users.username
                FROM jobs LEFT JOIN users ON users.id = jobs.user_id
                WHERE jobs.id = ?
                """,
                (task_id,),
            ).fetchone()
            if not row:
                return None
            item = dict(row)
            request = _json_object(item.pop("request_json", "{}"))
            progress = _json_value(item.pop("progress_json", "[]"), [])
            return {
                **item,
                "task_type": task_type,
                "username": item.get("username") or item.get("user_id") or "未知用户",
                "display_name": display_name_map.get(str(item.get("user_id") or ""), ""),
                "request": request,
                "progress_log": progress,
                "slot_count": len(request.get("slots") or {}),
                "provider": "penpot",
                "result": {
                    "result_path": item.get("result_path"),
                    "penpot_file_id": item.get("penpot_file_id"),
                    "penpot_edit_url": item.get("penpot_edit_url"),
                },
            }

        if task_type == "special":
            row = conn.execute(
                """
                SELECT special_jobs.*, users.username
                FROM special_jobs LEFT JOIN users ON users.id = special_jobs.user_id
                WHERE special_jobs.id = ?
                """,
                (task_id,),
            ).fetchone()
            if not row:
                return None
            item = dict(row)
            request = _json_object(item.pop("request_json", "{}"))
            progress = _json_value(item.pop("progress_json", "[]"), [])
            result_paths = _json_value(item.pop("result_paths_json", "[]"), [])
            result_frame_ids = _json_value(item.pop("result_frame_ids_json", "[]"), [])
            return {
                **item,
                "task_type": task_type,
                "username": item.get("username") or item.get("user_id") or "未知用户",
                "display_name": display_name_map.get(str(item.get("user_id") or ""), ""),
                "request": request,
                "progress_log": progress,
                "provider": "penpot",
                "result": {
                    "result_paths": result_paths,
                    "result_frame_ids": result_frame_ids,
                    "penpot_file_id": item.get("penpot_file_id"),
                    "penpot_page_id": item.get("penpot_page_id"),
                    "penpot_edit_url": item.get("penpot_edit_url"),
                },
            }

        if task_type == "ai_image":
            row = conn.execute(
                """
                SELECT ai_image_jobs.*, users.username
                FROM ai_image_jobs LEFT JOIN users ON users.id = ai_image_jobs.user_id
                WHERE ai_image_jobs.id = ?
                """,
                (task_id,),
            ).fetchone()
            if not row:
                return None
            item = dict(row)
            trace_raw = item.get("prompt_trace") or ""
            trace = _json_value(trace_raw, {})
            request_meta = _json_object(item.pop("request_meta_json", None))
            return {
                **item,
                "task_type": task_type,
                "username": item.get("username") or item.get("user_id") or "未知用户",
                "display_name": display_name_map.get(str(item.get("user_id") or ""), ""),
                "has_reference": bool(item.get("has_reference")),
                "provider_switched": bool(item.get("provider_switched")),
                "reference_count": item.get("reference_count"),
                "request": {
                    **request_meta,
                    "provider": item.get("provider"),
                    "model": item.get("model"),
                    "size": item.get("size"),
                    "resolution": item.get("resolution"),
                    "has_reference": bool(item.get("has_reference")),
                    "reference_count": item.get("reference_count"),
                },
                "prompts": {
                    "original": item.get("original_prompt") or item.get("prompt") or "",
                    "resolved": item.get("resolved_prompt") or item.get("prompt") or "",
                    "submitted": item.get("prompt") or "",
                    "trace": trace,
                },
                "result": {
                    "image_url": item.get("image_url"),
                    "upstream_task_id": item.get("task_id"),
                },
            }

        if task_type == "agent_image":
            row = conn.execute(
                """
                SELECT agent_images.*, users.username
                FROM agent_images LEFT JOIN users ON users.id = agent_images.user_id
                WHERE agent_images.id = ?
                """,
                (task_id,),
            ).fetchone()
            if not row:
                return None
            item = dict(row)
            prompt = _json_object(item.pop("prompt_json", "{}"))
            vlm = _json_object(item.pop("vlm_analysis_json", "{}"))
            return {
                **item,
                "task_type": task_type,
                "status": "done",
                "updated_at": item.get("created_at"),
                "username": item.get("username") or item.get("user_id") or "未知用户",
                "display_name": display_name_map.get(str(item.get("user_id") or ""), ""),
                "has_reference": bool(item.get("parent_image_id")),
                "reference_count": 1 if item.get("parent_image_id") else 0,
                "request": {
                    "provider": item.get("provider"),
                    "model": item.get("model"),
                    "project_id": item.get("project_id"),
                    "parent_image_id": item.get("parent_image_id"),
                    "iteration_number": item.get("iteration_number"),
                },
                "prompts": {"resolved": prompt},
                "result": {
                    "image_url": item.get("image_url"),
                    "vlm_analysis": vlm,
                },
            }

    return None


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
            agent_image_c = conn.execute("SELECT COUNT(*) AS c FROM agent_images WHERE user_id = ?", (uid,)).fetchone()["c"]
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
            "total_ai_images": ai_c + agent_image_c,
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

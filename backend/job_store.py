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
import logging
import os
import secrets
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Iterator, Optional
from urllib.parse import quote, unquote, urlsplit, urlunsplit

import bcrypt

from .config import settings
from .models import ComposeJob, ComposeRequest, ComposeStatus


_DB_PATH = settings.root_dir / "jobs.db"
_lock = threading.Lock()
_DATABASE_BACKUP_DIR = settings.root_dir / "backups"
_DATABASE_BACKUP_RETENTION = 3
_database_backup_lock = threading.Lock()
logger = logging.getLogger(__name__)


def create_daily_database_backup() -> Path | None:
    """Create one consistent SQLite backup for the current local calendar day."""
    with _database_backup_lock:
        if not _DB_PATH.is_file():
            logger.warning("[database-backup] database file is missing: %s", _DB_PATH)
            return None

        _DATABASE_BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        day = datetime.now().strftime("%Y%m%d")
        backup_path = _DATABASE_BACKUP_DIR / f"jobs.db-{day}.sqlite3"
        temp_path = _DATABASE_BACKUP_DIR / f".{backup_path.name}.{os.getpid()}.tmp"

        try:
            if not backup_path.exists():
                source = None
                target = None
                try:
                    source = sqlite3.connect(str(_DB_PATH), timeout=30)
                    target = sqlite3.connect(str(temp_path), timeout=30)
                    source.backup(target, pages=1000, sleep=0.1)
                    target.commit()
                    check = target.execute("PRAGMA quick_check").fetchone()
                    if not check or check[0] != "ok":
                        raise RuntimeError(f"SQLite quick_check failed: {check!r}")
                finally:
                    if target is not None:
                        target.close()
                    if source is not None:
                        source.close()
                os.replace(temp_path, backup_path)
                logger.info("[database-backup] created %s", backup_path)

            backups = sorted(
                _DATABASE_BACKUP_DIR.glob("jobs.db-*.sqlite3"),
                key=lambda path: path.name,
                reverse=True,
            )
            for stale_path in backups[_DATABASE_BACKUP_RETENTION:]:
                try:
                    stale_path.unlink()
                    logger.info("[database-backup] removed old backup %s", stale_path)
                except FileNotFoundError:
                    pass
            return backup_path
        finally:
            try:
                temp_path.unlink()
            except FileNotFoundError:
                pass


def _public_penpot_edit_url(url: str | None) -> str | None:
    """Use the current browser-facing Penpot host for persisted edit URLs."""
    if not url or not settings.penpot_base_url:
        return url
    try:
        current = urlsplit(settings.penpot_base_url)
        stored = urlsplit(url)
        if not current.netloc or not stored.netloc:
            return url
        return urlunsplit(
            (current.scheme, current.netloc, stored.path, stored.query, stored.fragment)
        )
    except ValueError:
        return url


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
        for col, typ in [("user_id", "TEXT"), ("penpot_file_id", "TEXT"), ("penpot_edit_url", "TEXT"), ("recovery_json", "TEXT")]:
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
                result_frame_names_json TEXT,
                penpot_file_id   TEXT,
                penpot_page_id   TEXT,
                penpot_edit_url  TEXT,
                error            TEXT,
                progress_json    TEXT NOT NULL DEFAULT '[]',
                created_at       REAL NOT NULL,
                updated_at       REAL NOT NULL
            )
        """)
        for col, typ in [("user_id", "TEXT"), ("result_frame_names_json", "TEXT"), ("recovery_json", "TEXT"),
                         ("source", "TEXT")]:
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
        try:
            conn.execute("ALTER TABLE users ADD COLUMN is_test INTEGER DEFAULT 0")
        except sqlite3.OperationalError:
            pass
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id               TEXT PRIMARY KEY,
                user_id          TEXT NOT NULL,
                created_at       REAL NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS image_copy_links (
                token_hash TEXT PRIMARY KEY,
                asset_url TEXT NOT NULL,
                expires_at REAL NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_image_copy_expiry ON image_copy_links(expires_at)")
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
                client_request_id TEXT,
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
            ("client_request_id", "TEXT"),
            ("request_meta_json", "TEXT"),
            ("updated_at", "REAL"),
            ("cost", "REAL"),
            ("cost_source", "TEXT"),
            ("input_tokens", "INTEGER"),
            ("output_tokens", "INTEGER"),
            ("total_tokens", "INTEGER"),
        ]:
            try:
                conn.execute(f"ALTER TABLE ai_image_jobs ADD COLUMN {col} {col_def}")
            except Exception:
                pass
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_ai_image_jobs_created_at
            ON ai_image_jobs(created_at)
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_ai_image_jobs_user_created
            ON ai_image_jobs(user_id, created_at)
        """)
        conn.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_image_jobs_user_client_request_unique
            ON ai_image_jobs(user_id, client_request_id)
            WHERE client_request_id IS NOT NULL AND client_request_id != ''
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

        # 常用语 (Quick Prompts)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS quick_prompts (
                id          TEXT PRIMARY KEY,
                user_id     TEXT NOT NULL,
                title       TEXT NOT NULL,
                content     TEXT NOT NULL,
                category    TEXT NOT NULL DEFAULT '通用',
                sort_order  INTEGER NOT NULL DEFAULT 0,
                created_at  REAL NOT NULL,
                updated_at  REAL NOT NULL
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_quick_prompts_user
            ON quick_prompts(user_id, sort_order, created_at)
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS quick_prompt_seeds (
                user_id     TEXT PRIMARY KEY,
                seeded_at   REAL NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS llm_usage_logs (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id       TEXT,
                session_id    TEXT,
                turn_id       TEXT,
                source        TEXT NOT NULL DEFAULT 'agent2',
                provider      TEXT,
                model         TEXT NOT NULL,
                input_tokens  INTEGER NOT NULL DEFAULT 0,
                output_tokens INTEGER NOT NULL DEFAULT 0,
                total_tokens  INTEGER NOT NULL DEFAULT 0,
                cost          REAL,
                cost_source   TEXT,
                usage_source  TEXT NOT NULL DEFAULT 'upstream',
                created_at    REAL NOT NULL
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_llm_usage_created
            ON llm_usage_logs(created_at)
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_llm_usage_user_created
            ON llm_usage_logs(user_id, created_at)
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_llm_usage_model_created
            ON llm_usage_logs(model, created_at)
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS model_pricing (
                category           TEXT NOT NULL DEFAULT 'image',
                model_key          TEXT NOT NULL,
                unit_price         REAL,
                price_1k           REAL,
                price_1_5k         REAL,
                price_2k           REAL,
                price_4k           REAL,
                input_per_1m       REAL,
                output_per_1m      REAL,
                resolution_2k_mult REAL NOT NULL DEFAULT 1.5,
                resolution_4k_mult REAL NOT NULL DEFAULT 2.0,
                note               TEXT NOT NULL DEFAULT '',
                updated_by         TEXT NOT NULL DEFAULT '',
                updated_at         REAL NOT NULL,
                PRIMARY KEY (category, model_key)
            )
        """)
        for col, col_def in [
            ("price_1k", "REAL"),
            ("price_1_5k", "REAL"),
            ("price_2k", "REAL"),
            ("price_4k", "REAL"),
        ]:
            try:
                conn.execute(f"ALTER TABLE model_pricing ADD COLUMN {col} {col_def}")
            except Exception:
                pass
        conn.execute(
            """
            UPDATE model_pricing
            SET price_1k = COALESCE(price_1k, unit_price),
                price_1_5k = COALESCE(price_1_5k, ROUND(COALESCE(unit_price, 0.04) * 1.25, 6)),
                price_2k = COALESCE(price_2k, ROUND(COALESCE(unit_price, 0.04) * COALESCE(resolution_2k_mult, 1.5), 6)),
                price_4k = COALESCE(price_4k, ROUND(COALESCE(unit_price, 0.04) * COALESCE(resolution_4k_mult, 2.0), 6))
            WHERE category = 'image' AND (price_1k IS NULL OR price_1_5k IS NULL OR price_2k IS NULL OR price_4k IS NULL)
            """
        )
        _seed_default_model_pricing(conn)
        _backfill_ai_image_costs(conn)
        conn.commit()

    try:
        test_uids = settings.get_test_user_ids()
        for uid in test_uids:
            sync_user_test_status(uid, True)
    except Exception:
        pass

def save_job(job: ComposeJob) -> None:
    """插入或更新 job 记录"""
    now = time.time()
    print(f"[job_store] Saving job {job.id}, status={job.status.value}, db_path={_DB_PATH}")
    with _lock, _connect() as conn:
        conn.execute("""
            INSERT INTO jobs (id, user_id, status, request_json, result_path, penpot_file_id, penpot_edit_url, error, progress_json, created_at, updated_at, recovery_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                user_id         = excluded.user_id,
                status          = excluded.status,
                result_path     = excluded.result_path,
                penpot_file_id  = excluded.penpot_file_id,
                penpot_edit_url = excluded.penpot_edit_url,
                error           = excluded.error,
                progress_json   = excluded.progress_json,
                updated_at      = excluded.updated_at,
                recovery_json   = excluded.recovery_json
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
            job.created_at or now,
            now,
            json.dumps(job.recovery, ensure_ascii=False),
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
        penpot_edit_url=_public_penpot_edit_url(row["penpot_edit_url"]),
        error=row["error"],
        progress=progress,
        created_at=row["created_at"],
        recovery=_json_object(row["recovery_json"]) if "recovery_json" in row.keys() else {},
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
                result_frame_names_json TEXT,
                penpot_file_id   TEXT,
                penpot_page_id   TEXT,
                penpot_edit_url  TEXT,
                error            TEXT,
                progress_json    TEXT NOT NULL DEFAULT '[]',
                created_at       REAL NOT NULL,
                updated_at       REAL NOT NULL
            )
        """)
        for col in ("result_frame_names_json", "source"):
            try:
                conn.execute(f"ALTER TABLE special_jobs ADD COLUMN {col} TEXT")
            except sqlite3.OperationalError:
                pass
        conn.execute("""
            INSERT INTO special_jobs
              (id, user_id, status, sku, request_json, result_paths_json, result_frame_ids_json, result_frame_names_json,
               penpot_file_id, penpot_page_id, penpot_edit_url, error, progress_json, created_at, updated_at, recovery_json,
               source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                user_id              = excluded.user_id,
                status               = excluded.status,
                result_paths_json    = excluded.result_paths_json,
                result_frame_ids_json = excluded.result_frame_ids_json,
                result_frame_names_json = excluded.result_frame_names_json,
                penpot_file_id      = excluded.penpot_file_id,
                penpot_page_id      = excluded.penpot_page_id,
                penpot_edit_url     = excluded.penpot_edit_url,
                error               = excluded.error,
                progress_json       = excluded.progress_json,
                updated_at          = excluded.updated_at,
                recovery_json       = excluded.recovery_json,
                -- 来源只在创建时确定；恢复时重建的任务对象没有来源，不能把它清掉
                source              = COALESCE(NULLIF(excluded.source, ''), special_jobs.source)
        """, (
            job.id,
            getattr(job, "user_id", None),
            job.status.value if job.status else 'unknown',
            job.request.sku if job.request else '',
            job.request.model_dump_json() if job.request else '{}',
            json.dumps(job.result_paths, ensure_ascii=False),
            json.dumps(job.result_frame_ids, ensure_ascii=False),
            json.dumps(getattr(job, "result_frame_names", []), ensure_ascii=False),
            job.penpot_file_id,
            job.penpot_page_id,
            job.penpot_edit_url,
            job.error,
            json.dumps(job.progress, ensure_ascii=False),
            job.created_at or now,
            now,
            json.dumps(job.recovery, ensure_ascii=False),
            getattr(job, "source", "") or "",
        ))
        conn.commit()


def load_job_owner_id(job_id: str) -> str | None:
    """合成任务和特殊品任务的归属用户；查不到或没有归属时返回 None。"""
    with _connect() as conn:
        row = conn.execute(
            "SELECT user_id FROM jobs WHERE id = ? UNION ALL SELECT user_id FROM special_jobs WHERE id = ? LIMIT 1",
            (job_id, job_id),
        ).fetchone()
    return row["user_id"] if row else None


def load_special_job(job_id: str) -> dict | None:
    """Load the owner/status fields needed to authorize a persisted special result."""
    with _connect() as conn:
        row = conn.execute(
            "SELECT id, user_id, status, result_paths_json FROM special_jobs WHERE id = ?",
            (job_id,),
        ).fetchone()
    if not row:
        return None
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "status": row["status"],
        "result_paths": json.loads(row["result_paths_json"] or "[]"),
    }


def load_special_job_model(job_id: str, *, legacy_kind: str | None = None):
    """Read legacy results using saved evidence, or the requested result endpoint.

    The endpoint hint is only a read compatibility aid. It must not populate
    recovery.kind, which authorizes execution of a particular compose flow.
    """
    from .models import SpecialComposeJob, SpecialFullComposeJob
    with _connect() as conn:
        row = conn.execute("SELECT * FROM special_jobs WHERE id=?", (job_id,)).fetchone()
    if not row:
        return None
    recovery = _json_object(row["recovery_json"])
    progress = json.loads(row["progress_json"] or "[]")
    kind = recovery.get("kind")
    if not kind:
        for message in progress:
            if str(message).startswith("等待合成队列（特殊品完整）"):
                kind = "special-full"
                break
            if str(message).startswith("等待合成队列（特殊品）"):
                kind = "special"
                break
    kind = kind or legacy_kind
    if kind not in {"special", "special-full"}:
        raise ValueError("历史任务缺少特殊品流程类型")
    cls = SpecialFullComposeJob if kind == "special-full" else SpecialComposeJob
    return cls(
        id=row["id"], user_id=row["user_id"], status=row["status"],
        request=json.loads(row["request_json"]),
        result_paths=json.loads(row["result_paths_json"] or "[]"),
        result_frame_ids=json.loads(row["result_frame_ids_json"] or "[]"),
        result_frame_names=json.loads(row["result_frame_names_json"] or "[]"),
        penpot_file_id=row["penpot_file_id"], penpot_page_id=row["penpot_page_id"],
        penpot_edit_url=row["penpot_edit_url"], error=row["error"],
        progress=progress, created_at=row["created_at"],
        recovery=recovery,
    )


def load_active_compose_jobs() -> list:
    with _connect() as conn:
        ordinary = conn.execute("SELECT id FROM jobs WHERE status IN ('pending','running') ORDER BY created_at").fetchall()
        special = conn.execute("SELECT id FROM special_jobs WHERE status IN ('pending','running') ORDER BY created_at").fetchall()
    jobs = []
    # Untyped legacy jobs are loaded only so the scanner can mark them as
    # non-resumable. The read hint never supplies recovery.kind.
    loaders = [
        (ordinary, load_job),
        (special, lambda job_id: load_special_job_model(job_id, legacy_kind="special")),
    ]
    for rows, loader in loaders:
        for row in rows:
            try:
                job = loader(row["id"])
            except (ValueError, TypeError):
                logger.warning("Cannot recover invalid compose record: job=%s", row["id"], exc_info=True)
                continue
            if job is not None:
                jobs.append(job)
    return jobs


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
            'error': row["error"],
            'created_at': row["created_at"],
            'penpot_edit_url': _public_penpot_edit_url(row["penpot_edit_url"]),
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


def create_image_copy_link(asset_url: str, *, ttl_seconds: int = 3600) -> tuple[str, float]:
    """Persist a single-image capability shared by workers, without storing its bearer token."""
    token = secrets.token_urlsafe(32)
    now = time.time()
    expires_at = now + ttl_seconds
    token_hash = hashlib.sha256(token.encode("ascii")).hexdigest()
    with _connect() as conn:
        conn.execute("DELETE FROM image_copy_links WHERE expires_at <= ?", (now,))
        conn.execute(
            "INSERT INTO image_copy_links (token_hash, asset_url, expires_at) VALUES (?, ?, ?)",
            (token_hash, asset_url, expires_at),
        )
    return token, expires_at


def get_image_copy_asset(token: str) -> str | None:
    if len(token) != 43 or any(not (char.isascii() and (char.isalnum() or char in "_-")) for char in token):
        return None
    token_hash = hashlib.sha256(token.encode("ascii")).hexdigest()
    with _connect() as conn:
        row = conn.execute(
            "SELECT asset_url FROM image_copy_links WHERE token_hash = ? AND expires_at > ?",
            (token_hash, time.time()),
        ).fetchone()
    return row["asset_url"] if row else None


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
    client_request_id: str | None = None,
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
               client_request_id, request_meta_json, error, task_id, progress, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                client_request_id = COALESCE(excluded.client_request_id, ai_image_jobs.client_request_id),
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
                client_request_id,
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
            "client_request_id": row["client_request_id"] if "client_request_id" in row.keys() else None,
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
        "client_request_id": row["client_request_id"] if "client_request_id" in row.keys() else None,
        "request_meta": _json_object(row["request_meta_json"]) if "request_meta_json" in row.keys() else {},
        "error": row["error"],
        "task_id": row["task_id"],
        "progress": int(row["progress"] or 0),
        "resolution": row["resolution"] if "resolution" in row.keys() else "",
        "provider_switched": bool(row["provider_switched"]) if "provider_switched" in row.keys() else False,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"] if "updated_at" in row.keys() else row["created_at"],
    }


def load_ai_image_job_by_client_request_id(user_id: str, client_request_id: str) -> dict | None:
    """Find a durable job created for one user's idempotency token."""
    if not user_id or not client_request_id:
        return None
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT id FROM ai_image_jobs
            WHERE user_id = ? AND client_request_id = ?
            ORDER BY created_at DESC LIMIT 1
            """,
            (user_id, client_request_id),
        ).fetchone()
    return load_ai_image_job(str(row["id"])) if row else None


def load_active_outpainting_jobs(limit: int = 1000) -> list[dict]:
    """Load unfinished BFL outpainting jobs for startup recovery."""
    bounded_limit = max(1, min(int(limit), 10_000))
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT id FROM ai_image_jobs
            WHERE provider = 'bfl'
              AND status IN ('pending', 'queued', 'processing', 'running')
            ORDER BY created_at ASC
            LIMIT ?
            """,
            (bounded_limit,),
        ).fetchall()
    jobs: list[dict] = []
    for row in rows:
        job = load_ai_image_job(str(row["id"]))
        meta = job.get("request_meta") if job else None
        if job and isinstance(meta, dict) and meta.get("operation") == "outpainting":
            jobs.append(job)
    return jobs


def load_recoverable_image_jobs() -> list[dict]:
    """Only ordinary generation/try-on workers; other operations have their own lifecycle."""
    with _connect() as conn:
        rows = conn.execute("""
            SELECT id FROM ai_image_jobs
            WHERE status IN ('pending', 'queued', 'processing', 'running')
               OR (status = 'done' AND json_valid(request_meta_json)
                   AND json_extract(request_meta_json, '$.recovery.phase') = 'downloaded')
               OR (status = 'failed' AND provider IN ('apimart', 'apimart-ext', 'apimart-26-ext', 'kie')
                   AND task_id IS NOT NULL AND task_id != ''
                   AND (request_meta_json IS NULL OR (json_valid(request_meta_json)
                        AND json_extract(request_meta_json, '$.recovery') IS NULL)))
            ORDER BY created_at
        """).fetchall()
    jobs = []
    from .ai_image import SUPPORTED_MODELS
    image_models = {*SUPPORTED_MODELS.keys(), *SUPPORTED_MODELS.values(), "flux-vto"}
    for row in rows:
        job = load_ai_image_job(row["id"])
        if not job:
            continue
        meta = job["request_meta"]
        if meta.get("operation", "") not in {"", "generate", "outfit-change", "view-angle"}:
            continue
        recovery = meta.get("recovery") or {}
        if not recovery and job["model"] not in image_models:
            continue
        if job["status"] == "done" and recovery.get("phase") != "downloaded":
            continue
        jobs.append(job)
    return jobs


def save_image_checkpoint(job_id: str, meta: dict, *, provider: str, task_id: str,
                          error: str | None = None, status: str = "processing") -> None:
    """Update recovery state; success requires an already persisted image URL."""
    with _lock, _connect() as conn:
        result = conn.execute("""
            UPDATE ai_image_jobs SET request_meta_json=?, provider=?, task_id=?,
                status=?, error=?, updated_at=? WHERE id=?
                AND (? != 'done' OR LENGTH(TRIM(COALESCE(image_url, ''))) > 0)
        """, (json.dumps(meta, ensure_ascii=False), provider, task_id,
              status, error, time.time(), job_id, status))
        if status == "done" and result.rowcount != 1:
            raise ValueError("成功结果尚未保存图片地址，不能将任务标记为成功")
        conn.commit()


def mark_ai_image_job_provider_switched(job_id: str, switched: bool = True) -> None:
    """标记生图 job发生过 provider 兜底切换。独立函数，避免动 save_ai_image_job 签名。"""
    with _lock, _connect() as conn:
        conn.execute(
            "UPDATE ai_image_jobs SET provider_switched = ?, updated_at = ? WHERE id = ?",
            (1 if switched else 0, time.time(), job_id),
        )
        conn.commit()


def load_ai_image_job_by_image_url(image_url: str, user_id: str | None = None) -> dict | None:
    """通过 image_url 反查 ai_image_jobs 或 agent_images。"""
    if not image_url:
        return None

    raw_url = str(image_url).strip()
    split = urlsplit(raw_url)
    path = split.path or raw_url

    candidates: set[str] = {raw_url, path}
    try:
        candidates.add(unquote(raw_url))
        candidates.add(unquote(path))
        candidates.add(quote(unquote(path)))
    except Exception:
        pass

    candidate_list = [c for c in candidates if c]
    if not candidate_list:
        return None

    with _connect() as conn:
        placeholders = ",".join("?" for _ in candidate_list)
        if user_id:
            query = f"SELECT * FROM ai_image_jobs WHERE image_url IN ({placeholders}) AND user_id = ? ORDER BY created_at DESC LIMIT 1"
            row = conn.execute(query, (*candidate_list, user_id)).fetchone()
        else:
            query = f"SELECT * FROM ai_image_jobs WHERE image_url IN ({placeholders}) ORDER BY created_at DESC LIMIT 1"
            row = conn.execute(query, tuple(candidate_list)).fetchone()

        if row:
            keys = row.keys()
            request_meta = {}
            if "request_meta_json" in keys and row["request_meta_json"]:
                try:
                    request_meta = json.loads(row["request_meta_json"])
                except Exception:
                    request_meta = {}
            return {
                "id": row["id"],
                "user_id": row["user_id"],
                "status": row["status"],
                "model": row["model"],
                "provider": row["provider"] if "provider" in keys else "",
                "prompt": row["prompt"],
                "original_prompt": row["original_prompt"] if "original_prompt" in keys else "",
                "resolved_prompt": row["resolved_prompt"] if "resolved_prompt" in keys else "",
                "prompt_trace": row["prompt_trace"] if "prompt_trace" in keys else "",
                "size": row["size"],
                "image_url": row["image_url"],
                "has_reference": bool(row["has_reference"]),
                "error": row["error"],
                "task_id": row["task_id"],
                "progress": int(row["progress"] or 0),
                "resolution": row["resolution"] if "resolution" in keys else "",
                "request_meta": request_meta,
                "created_at": row["created_at"],
            }

        # 尝试反查 agent_images 表
        try:
            if user_id:
                agent_query = f"SELECT * FROM agent_images WHERE image_url IN ({placeholders}) AND user_id = ? ORDER BY created_at DESC LIMIT 1"
                agent_row = conn.execute(agent_query, (*candidate_list, user_id)).fetchone()
            else:
                agent_query = f"SELECT * FROM agent_images WHERE image_url IN ({placeholders}) ORDER BY created_at DESC LIMIT 1"
                agent_row = conn.execute(agent_query, tuple(candidate_list)).fetchone()

            if agent_row:
                prompt_json = agent_row["prompt_json"]
                prompt_data = {}
                if prompt_json:
                    try:
                        prompt_data = json.loads(prompt_json) if isinstance(prompt_json, str) else prompt_json
                    except Exception:
                        prompt_data = {}
                prompt_text = ""
                if isinstance(prompt_data, dict):
                    prompt_text = prompt_data.get("generationInstruction") or prompt_data.get("prompt") or prompt_data.get("positive") or ""
                elif isinstance(prompt_data, str):
                    prompt_text = prompt_data

                return {
                    "id": agent_row["id"],
                    "user_id": agent_row["user_id"],
                    "status": "done",
                    "model": agent_row["model"] or "agent",
                    "provider": agent_row["provider"] or "",
                    "prompt": prompt_text,
                    "original_prompt": prompt_text,
                    "resolved_prompt": prompt_text,
                    "prompt_trace": "agent",
                    "size": "",
                    "image_url": agent_row["image_url"],
                    "has_reference": bool(agent_row["parent_image_id"]),
                    "error": None,
                    "task_id": agent_row["project_id"],
                    "progress": 100,
                    "resolution": "",
                    "request_meta": {"project_id": agent_row["project_id"]},
                    "created_at": agent_row["created_at"],
                }
        except Exception:
            pass

    return None


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
        # A restart may occur after writing the result but before marking the job
        # notified. Replaying finalization must not create a second chat card.
        if type == "ai_image_result" and (meta or {}).get("job_id"):
            existing = conn.execute("""
                SELECT id, meta_json FROM ai_chat_messages WHERE session_id=? AND user_id=?
                    AND type=? AND json_extract(meta_json, '$.job_id')=? LIMIT 1
            """, (session_id, user_id, type, meta["job_id"])).fetchone()
            if existing:
                # A legacy reload wrote a failed chat card even after acceptance.
                # Safe recovery updates that card in place when the original task completes.
                if (meta or {}).get("status") == "done" and _json_object(existing["meta_json"]).get("status") == "failed":
                    conn.execute("UPDATE ai_chat_messages SET text=?, image_url=?, meta_json=? WHERE id=?",
                                 (text, image_url, json.dumps(meta, ensure_ascii=False), existing["id"]))
                    conn.commit()
                return int(existing["id"])
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
                "characters": meta.get("characters") or [],
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
                "provider": meta.get("provider"),
                "providerSwitched": bool(meta.get("providerSwitched")),
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
                if meta.get("providerSwitched"):
                    msg["providerSwitched"] = True
                    msg["provider"] = meta.get("provider") or msg.get("provider")
            else:
                idx = len(result)
                msg = {
                    "who": "ai",
                    "type": "ai-image-generating",
                    "model": meta.get("model"),
                    "variant": meta.get("variant") or "flare",
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

    # 兼容新版无限画布格式 (version 2)
    if isinstance(snapshot, dict) and (
        snapshot.get("version") == 2
        or "images" in snapshot
        or "pages" in snapshot
        or "frames" in snapshot
    ):
        raw_pages = snapshot.get("pages") or []
        raw_images = snapshot.get("images") or []
        raw_frames = snapshot.get("frames") or []
        raw_texts = snapshot.get("texts") or []
        page_cnt = len(raw_pages) if isinstance(raw_pages, list) else 1
        shapes_cnt = (
            (len(raw_images) if isinstance(raw_images, list) else 0)
            + (len(raw_frames) if isinstance(raw_frames, list) else 0)
            + (len(raw_texts) if isinstance(raw_texts, list) else 0)
        )
        return {
            "json_len": len(snapshot_json),
            "pages": max(1, page_cnt),
            "shapes": shapes_cnt,
            "assets": len(raw_images) if isinstance(raw_images, list) else 0,
        }

    store = {}
    if isinstance(snapshot, dict):
        document = snapshot.get("document")
        if isinstance(document, dict) and isinstance(document.get("store"), dict):
            store = document["store"]
        elif isinstance(snapshot.get("store"), dict):
            store = snapshot["store"]
    pages = shapes = assets = 0
    # One-way migration intentionally drops legacy freehand strokes and group
    # containers because the new canvas does not support them. Do not count
    # those unsupported records as surviving content when guarding against an
    # accidental blank overwrite; images, text, frames, and unknown shapes
    # remain protected.
    unsupported_legacy_types = {"draw", "group"}
    for record in store.values():
        if not isinstance(record, dict):
            continue
        type_name = record.get("typeName")
        if type_name == "page":
            pages += 1
        elif type_name == "shape" and record.get("type") not in unsupported_legacy_types:
            shapes += 1
        elif type_name == "asset":
            assets += 1
    return {"json_len": len(snapshot_json), "pages": pages, "shapes": shapes, "assets": assets}


def _canvas_record_id(prefix: str, value: object) -> str:
    raw = str(value or "")
    if raw.startswith(f"{prefix}:"):
        return raw
    stable = uuid.uuid5(uuid.NAMESPACE_URL, f"designflow-canvas:{prefix}:{raw}").hex
    return f"{prefix}:{stable}"


def _canvas_document_to_tldraw_snapshot(canvas: dict, template: dict) -> dict:
    """Encode CanvasDocument as tldraw while retaining a lossless V2 payload."""
    result = json.loads(json.dumps(template, ensure_ascii=False))
    document = result.setdefault("document", {})
    old_store = document.get("store") if isinstance(document.get("store"), dict) else result.get("store")
    if not isinstance(old_store, dict):
        raise ValueError("legacy snapshot template has no store")

    store = {
        record_id: record
        for record_id, record in old_store.items()
        if isinstance(record, dict) and record.get("typeName") not in {"page", "shape", "asset"}
    }
    document["store"] = store
    result.pop("store", None)
    result["designflowCanvasDocument"] = canvas

    pages = canvas.get("pages") if isinstance(canvas.get("pages"), list) else []
    if not pages:
        pages = [{"id": "page-1", "name": "画板 1", "order": 0}]
    page_ids: dict[str, str] = {}
    for index, page in enumerate(pages):
        source_id = str(page.get("id") or f"page-{index + 1}")
        page_id = _canvas_record_id("page", source_id)
        page_ids[source_id] = page_id
        store[page_id] = {
            "meta": {},
            "id": page_id,
            "name": str(page.get("name") or f"画板 {index + 1}"),
            "index": f"a{index + 1}",
            "typeName": "page",
        }

    first_page_id = next(iter(page_ids.values()))
    frame_ids: dict[str, str] = {}
    frames = canvas.get("frames") if isinstance(canvas.get("frames"), list) else []
    for index, frame in enumerate(frames):
        source_id = str(frame.get("id") or f"frame-{index + 1}")
        shape_id = _canvas_record_id("shape", source_id)
        frame_ids[source_id] = shape_id
        store[shape_id] = {
            "x": float(frame.get("x") or 0),
            "y": float(frame.get("y") or 0),
            "rotation": 0,
            "isLocked": False,
            "opacity": 1,
            "meta": {"designflowCanvasFrame": True},
            "id": shape_id,
            "type": "frame",
            "props": {
                "w": max(1, float(frame.get("width") or 800)),
                "h": max(1, float(frame.get("height") or 600)),
                "name": str(frame.get("name") or f"画板 {index + 1}"),
            },
            "parentId": page_ids.get(str(frame.get("pageId")), first_page_id),
            "index": f"a{index + 1}",
            "typeName": "shape",
        }

    images = canvas.get("images") if isinstance(canvas.get("images"), list) else []
    for index, image in enumerate(images):
        source_id = str(image.get("id") or f"image-{index + 1}")
        shape_id = _canvas_record_id("shape", source_id)
        asset_id = _canvas_record_id("asset", source_id)
        width = max(1, float(image.get("width") or 400))
        height = max(1, float(image.get("height") or 400))
        natural_width = max(1, float(image.get("naturalWidth") or width))
        natural_height = max(1, float(image.get("naturalHeight") or height))
        store[asset_id] = {
            "id": asset_id,
            "typeName": "asset",
            "type": "image",
            "props": {
                "w": natural_width,
                "h": natural_height,
                "name": str(image.get("name") or "导入图片"),
                "isAnimated": False,
                "mimeType": str((image.get("meta") or {}).get("mimeType") or "image/png"),
                "src": str(image.get("url") or ""),
                "fileSize": (image.get("meta") or {}).get("fileSize"),
            },
            "meta": {},
        }
        store[shape_id] = {
            "x": float(image.get("x") or 0),
            "y": float(image.get("y") or 0),
            "rotation": float(image.get("rotation") or 0) * 3.141592653589793 / 180,
            "isLocked": bool(image.get("locked")),
            "opacity": float(image.get("opacity") if image.get("opacity") is not None else 1),
            "meta": image.get("meta") if isinstance(image.get("meta"), dict) else {},
            "id": shape_id,
            "type": "image",
            "props": {
                "w": width,
                "h": height,
                "assetId": asset_id,
                "playing": True,
                "url": "",
                "crop": None,
                "flipX": False,
                "flipY": False,
                "altText": str(image.get("name") or "导入图片"),
            },
            "parentId": page_ids.get(str(image.get("pageId")), first_page_id),
            "index": f"a{len(frames) + index + 1}",
            "typeName": "shape",
        }

    texts = canvas.get("texts") if isinstance(canvas.get("texts"), list) else []
    for index, text in enumerate(texts):
        source_id = str(text.get("id") or f"text-{index + 1}")
        shape_id = _canvas_record_id("shape", source_id)
        content = str(text.get("text") or "")
        paragraphs = content.split("\n") or [""]
        rich_content = []
        for paragraph in paragraphs:
            node = {"type": "paragraph", "attrs": {"dir": "auto"}}
            if paragraph:
                text_node = {"type": "text", "text": paragraph}
                marks = []
                if text.get("fontWeight") == "bold":
                    marks.append({"type": "bold"})
                if text.get("fontStyle") == "italic":
                    marks.append({"type": "italic"})
                if marks:
                    text_node["marks"] = marks
                node["content"] = [text_node]
            rich_content.append(node)
        store[shape_id] = {
            "x": float(text.get("x") or 0),
            "y": float(text.get("y") or 0),
            "rotation": 0,
            "isLocked": bool(text.get("locked")),
            "opacity": 1,
            "meta": {"designflowCanvasText": True},
            "id": shape_id,
            "type": "text",
            "props": {
                "color": "black",
                "size": "m",
                "w": max(1, float(text.get("width") or 200)),
                "font": "draw",
                "textAlign": str(text.get("textAlign") or "left").replace("left", "start").replace("right", "end"),
                "autoSize": False,
                "scale": max(0.1, float(text.get("fontSize") or 18) / 18),
                "richText": {"type": "doc", "attrs": {"dir": "auto"}, "content": rich_content},
            },
            "parentId": page_ids.get(str(text.get("pageId")), first_page_id),
            "index": f"a{len(frames) + len(images) + index + 1}",
            "typeName": "shape",
        }

    active_page_id = page_ids.get(str(canvas.get("activePageId")), first_page_id)
    session = result.setdefault("session", {})
    session["currentPageId"] = active_page_id
    session["pageStates"] = [
        {
            "pageId": page_id,
            "camera": {"x": 0, "y": 0, "z": 1},
            "selectedShapeIds": [],
            "focusedGroupId": None,
        }
        for page_id in page_ids.values()
    ]
    return result


def _legacy_compatible_editor_snapshot(new_json: str, old_json: str | None) -> str:
    try:
        new_snapshot = json.loads(new_json)
        old_snapshot = json.loads(old_json) if old_json else None
    except Exception:
        return new_json
    if not isinstance(new_snapshot, dict) or new_snapshot.get("version") != 2:
        return new_json
    if not isinstance(old_snapshot, dict):
        return new_json
    old_store = (old_snapshot.get("document") or {}).get("store") or old_snapshot.get("store")
    if not isinstance(old_store, dict):
        return new_json
    return json.dumps(
        _canvas_document_to_tldraw_snapshot(new_snapshot, old_snapshot),
        ensure_ascii=False,
    )


def _should_reject_editor_snapshot_overwrite(old_json: str | None, new_json: str) -> bool:
    if not old_json:
        return False
    old = _editor_snapshot_stats(old_json)
    new = _editor_snapshot_stats(new_json)

    # 1. 结构无效保护：新快照没有任何 page (pages == 0)
    if new["pages"] == 0:
        return True

    # 2. 初始空画板覆盖保护（加载失败/崩溃时产生的默认单页 0 图快照覆盖原有有效数据）：
    if old["shapes"] > 0 and (old["shapes"] >= 3 or old["pages"] > 1) and new["shapes"] == 0:
        return True

    # 3. 多页画板丢失/崩溃折叠保护：
    # 旧快照包含多页 (pages > 1)，而新快照画板数减少 (pages < old.pages)，且内容严重缩减
    if old["pages"] > 1 and new["pages"] < old["pages"]:
        if new["shapes"] <= old["shapes"] // 2 or new["json_len"] < old["json_len"] // 3:
            return True

    return False


def _editor_snapshot_canvas_record_ids(snapshot_json: str, *, prefer_canvas: bool = True) -> set[str]:
    try:
        snapshot = json.loads(snapshot_json)
    except Exception:
        return set()
    if prefer_canvas and isinstance(snapshot, dict):
        canvas = snapshot.get('designflowCanvasDocument')
        if isinstance(canvas, dict) and canvas.get('version') == 2:
            snapshot = canvas
    if isinstance(snapshot, dict) and (
        snapshot.get("version") == 2
        or "pages" in snapshot
        or "frames" in snapshot
        or "images" in snapshot
        or "texts" in snapshot
    ):
        ids: set[str] = set()
        for key in ("pages", "frames", "images", "texts"):
            items = snapshot.get(key)
            if isinstance(items, list):
                ids.update(
                    str(item.get("id"))
                    for item in items
                    if isinstance(item, dict) and item.get("id")
                )
        return ids

    store = {}
    if isinstance(snapshot, dict):
        document = snapshot.get("document")
        if isinstance(document, dict) and isinstance(document.get("store"), dict):
            store = document["store"]
        elif isinstance(snapshot.get("store"), dict):
            store = snapshot["store"]
    return {
        str(record_id)
        for record_id, record in store.items()
        if isinstance(record, dict) and record.get("typeName") in {"page", "shape"}
    }


def _matches_declared_editor_delete(
    old_json: str,
    new_json: str,
    deleted_record_ids: list[str] | None,
) -> bool:
    declared = {str(record_id) for record_id in (deleted_record_ids or []) if record_id}
    if not declared:
        return False
    # Support native canvas IDs and legacy clients without weakening exact deletion matching.
    for prefer_canvas in (True, False):
        removed = _editor_snapshot_canvas_record_ids(old_json, prefer_canvas=prefer_canvas) - _editor_snapshot_canvas_record_ids(new_json, prefer_canvas=prefer_canvas)
        if removed and removed == declared:
            return True
    return False


def save_editor_snapshot(
    user_id: str,
    snapshot_json: str,
    base_revision: int | None = None,
    intent: str | None = None,
    deleted_record_ids: list[str] | None = None,
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
            # A new user in a migrated database has no personal legacy template yet.
            # Reuse only the tldraw schema shell from an existing row; the converter
            # removes every page, shape and asset before inserting this user's data.
            template_row = conn.execute(
                "SELECT snapshot_json FROM editor_snapshots ORDER BY updated_at DESC LIMIT 1"
            ).fetchone()
            snapshot_json = _legacy_compatible_editor_snapshot(
                snapshot_json,
                template_row["snapshot_json"] if template_row else None,
            )
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
        snapshot_json = _legacy_compatible_editor_snapshot(snapshot_json, old_json)
        new_stats = _editor_snapshot_stats(snapshot_json)

        # 1. 无效结构拦截
        if new_stats["pages"] == 0:
            return False, old_revision, "invalid_snapshot_structure"

        # Rebase stale clients before checking deletions against the latest document.
        if base_revision is not None and int(base_revision) != old_revision:
            return False, old_revision, "stale_revision"

        # 2. 大幅缩减只允许删除集合与客户端声明完全一致。单独的 user_delete
        # 标记不足以证明整份快照清空来自用户操作，避免后续异常空白借此绕过保护。
        destructive_overwrite = _should_reject_editor_snapshot_overwrite(old_json, snapshot_json)
        declared_delete_matches = intent == "user_delete" and _matches_declared_editor_delete(
            old_json,
            snapshot_json,
            deleted_record_ids,
        )
        if destructive_overwrite and not declared_delete_matches:
            reject_dir = settings.root_dir / "output" / "editor-snapshot-rejected"
            reject_dir.mkdir(parents=True, exist_ok=True)
            reject_path = reject_dir / f"{user_id}-{int(now)}.json"
            reject_path.write_text(snapshot_json, encoding="utf-8")
            return False, old_revision, "uninitialized_overwrite_rejected"

        # 3. 如果客户端显式提供了 base_revision：必须与当前数据库里的 old_revision 完全一致
        if base_revision is not None:
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


# ─── 操作日志 ──────────────────────────────────────────────────────────────────

def log_operation(*, user_id: str, username: str, action: str, detail: str = "", payload: str = "") -> None:
    """记录用户操作（供管理后台查询），payload 为完整请求 JSON"""
    with _lock, _connect() as conn:
        conn.execute(
            "INSERT INTO operation_logs (user_id, username, action, detail, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, username, action, detail, payload, time.time()),
        )
        conn.commit()


def sync_user_test_status(user_id: str, is_test: bool) -> None:
    """持久化同步 DB users 表中的 is_test 标记"""
    clean_id = str(user_id or "").strip()
    if not clean_id:
        return
    val = 1 if is_test else 0
    with _lock, _connect() as conn:
        row = conn.execute("SELECT id FROM users WHERE id = ?", (clean_id,)).fetchone()
        if row:
            conn.execute("UPDATE users SET is_test = ? WHERE id = ?", (val, clean_id))
        else:
            conn.execute(
                "INSERT INTO users (id, username, username_key, created_at, is_test) VALUES (?, ?, ?, ?, ?)",
                (clean_id, clean_id, clean_id.casefold(), time.time(), val),
            )
        conn.commit()


def _test_user_ids_set() -> set[str]:
    uids = settings.get_test_user_ids()
    try:
        with _connect() as conn:
            rows = conn.execute("SELECT id FROM users WHERE is_test = 1").fetchall()
            for r in rows:
                if r["id"]:
                    uids.add(str(r["id"]))
    except Exception:
        pass
    return uids


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
    else:
        test_uids = _test_user_ids_set()
        if test_uids:
            placeholders = ",".join("?" for _ in test_uids)
            clauses.append(f"(user_id IS NULL OR user_id NOT IN ({placeholders}))")
            params.extend(list(test_uids))
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
    else:
        test_uids = _test_user_ids_set()
        if test_uids:
            placeholders = ",".join("?" for _ in test_uids)
            clauses.append(f"(user_id IS NULL OR user_id NOT IN ({placeholders}))")
            params.extend(list(test_uids))
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    with _connect() as conn:
        row = conn.execute(
            f"SELECT COUNT(*) AS c FROM operation_logs{where}",
            tuple(params),
        ).fetchone()
    return int(row["c"]) if row else 0


def load_admin_stats() -> dict:
    """聚合统计信息（合成任务 = 普通合成 + 特殊品合成，自动排除测试账号）"""
    test_uids = _test_user_ids_set()
    where_clause = ""
    params: list = []
    if test_uids:
        placeholders = ",".join("?" for _ in test_uids)
        where_clause = f" WHERE (user_id IS NULL OR user_id NOT IN ({placeholders}))"
        params = list(test_uids)

    with _connect() as conn:
        all_users = settings.allowed_login_users
        user_count = sum(1 for u in all_users if not u.get("is_test"))

        def _count(table: str, extra_where: str = "") -> int:
            if not where_clause and not extra_where:
                sql = f"SELECT COUNT(*) AS c FROM {table}"
                p: tuple = ()
            elif where_clause and extra_where:
                sql = f"SELECT COUNT(*) AS c FROM {table} {where_clause} AND ({extra_where})"
                p = tuple(params)
            elif where_clause:
                sql = f"SELECT COUNT(*) AS c FROM {table} {where_clause}"
                p = tuple(params)
            else:
                sql = f"SELECT COUNT(*) AS c FROM {table} WHERE {extra_where}"
                p = ()
            return conn.execute(sql, p).fetchone()["c"]

        job_total = _count("jobs")
        job_done = _count("jobs", "status = 'done'")
        job_failed = _count("jobs", "status = 'failed'")
        special_total = _count("special_jobs")
        special_done = _count("special_jobs", "status = 'done'")
        special_failed = _count("special_jobs", "status = 'failed'")
        ai_total = _count("ai_image_jobs")
        ai_done = _count("ai_image_jobs", "status = 'done'")
        agent_total = _count("agent_projects")
        chat_total = _count("ai_chat_sessions")
        active_sessions = _count("sessions")
        op_total = _count("operation_logs")
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
    """Return a small normalized projection across every persisted task table (excluding test users)."""
    test_uids = _test_user_ids_set()
    if test_uids:
        placeholders = ",".join("?" for _ in test_uids)
        where = f"WHERE (user_id IS NULL OR user_id NOT IN ({placeholders}))"
        params = list(test_uids) * 4
        return conn.execute(
            f"""
            SELECT 'compose' AS task_type, id, user_id, status, created_at,
                   updated_at, error, '' AS model, '' AS source
            FROM jobs {where}
            UNION ALL
            SELECT 'special' AS task_type, id, user_id, status, created_at,
                   updated_at, error, '' AS model, {_SPECIAL_SOURCE_SQL} AS source
            FROM special_jobs {where}
            UNION ALL
            SELECT 'ai_image' AS task_type, id, user_id, {_AI_STATUS_SQL} AS status, created_at,
                   COALESCE(updated_at, created_at) AS updated_at, error, model, {_AI_SOURCE_SQL} AS source
            FROM ai_image_jobs {where}
            UNION ALL
            SELECT 'agent_image' AS task_type, id, user_id, 'done' AS status, created_at,
                   created_at AS updated_at, '' AS error, model, '' AS source
            FROM agent_images {where}
            """,
            tuple(params),
        ).fetchall()
    return conn.execute(
        f"""
        SELECT 'compose' AS task_type, id, user_id, status, created_at,
               updated_at, error, '' AS model, '' AS source
        FROM jobs
        UNION ALL
        SELECT 'special' AS task_type, id, user_id, status, created_at,
               updated_at, error, '' AS model, {_SPECIAL_SOURCE_SQL} AS source
        FROM special_jobs
        UNION ALL
        SELECT 'ai_image' AS task_type, id, user_id, {_AI_STATUS_SQL} AS status, created_at,
               COALESCE(updated_at, created_at) AS updated_at, error, model, {_AI_SOURCE_SQL} AS source
        FROM ai_image_jobs
        UNION ALL
        SELECT 'agent_image' AS task_type, id, user_id, 'done' AS status, created_at,
               created_at AS updated_at, '' AS error, model, '' AS source
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


def _agent_usage(since: float, test_uids: set, agent_tasks: list[dict]) -> dict:
    """Agent 模式的使用情况：会话、轮次（用户每发一条需求算一轮）和它发起的生图 / 特殊品任务。"""
    images = [item for item in agent_tasks if item["task_type"] == "ai_image"]
    images_done = sum(1 for item in images if item["status"] == "done")
    usage = {"sessions": 0, "turns": 0, "failed_turns": 0, "cancelled_turns": 0, "users": 0,
             "images": len(images), "images_done": images_done,
             "special": sum(1 for item in agent_tasks if item["task_type"] == "special"),
             "images_per_turn": None}
    where, params = "started_at >= ?", [since]
    if test_uids:
        where += f" AND user_id NOT IN ({','.join('?' for _ in test_uids)})"
        params.extend(test_uids)
    with _connect() as conn:
        if not conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'agent2_turns'").fetchone():
            return usage
        row = conn.execute(f"""
            SELECT COUNT(*) AS turns, COUNT(DISTINCT session_id) AS sessions, COUNT(DISTINCT user_id) AS users,
                   SUM(status = 'failed') AS failed, SUM(status = 'cancelled') AS cancelled
            FROM agent2_turns WHERE {where}
        """, tuple(params)).fetchone()
    usage.update(sessions=row["sessions"], turns=row["turns"], users=row["users"],
                 failed_turns=row["failed"] or 0, cancelled_turns=row["cancelled"] or 0)
    if usage["turns"]:
        usage["images_per_turn"] = round(images_done / usage["turns"], 1)
    return usage


def load_admin_overview(hours: int = 24) -> dict:
    """Operational overview for Admin; all calculations are read-only."""
    requested_hours = int(hours)
    all_time = requested_hours == 0
    safe_hours = 0 if all_time else max(1, min(requested_hours, 24 * 31))
    now = time.time()
    # 按自然日统计：1 天 = 今天 0 点至今，7 / 30 天 = 含今天在内的最近 N 个自然日
    days = max(1, -(-safe_hours // 24))
    start_dt = datetime.fromtimestamp(now).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days - 1)
    range_start = start_dt.timestamp()

    with _connect() as conn:
        rows = [dict(row) for row in _admin_task_rows(conn)]
        test_uids = _test_user_ids_set()
        if all_time:
            if test_uids:
                placeholders = ",".join("?" for _ in test_uids)
                active_user_rows = conn.execute(
                    f"SELECT COUNT(DISTINCT user_id) AS c FROM operation_logs WHERE (user_id IS NULL OR user_id NOT IN ({placeholders}))",
                    tuple(test_uids),
                ).fetchone()
            else:
                active_user_rows = conn.execute(
                    "SELECT COUNT(DISTINCT user_id) AS c FROM operation_logs"
                ).fetchone()
        else:
            if test_uids:
                placeholders = ",".join("?" for _ in test_uids)
                active_user_rows = conn.execute(
                    f"""
                    SELECT COUNT(DISTINCT user_id) AS c
                    FROM operation_logs
                    WHERE created_at >= ? AND (user_id IS NULL OR user_id NOT IN ({placeholders}))
                    """,
                    (range_start, *test_uids),
                ).fetchone()
            else:
                active_user_rows = conn.execute(
                    """
                    SELECT COUNT(DISTINCT user_id) AS c
                    FROM operation_logs
                    WHERE created_at >= ?
                    """,
                    (range_start,),
                ).fetchone()
        user_rows = [row for row in conn.execute("SELECT id, username FROM users").fetchall() if row["id"] not in test_uids]
        stale_ack = conn.execute(
            "SELECT * FROM admin_alert_acknowledgements WHERE alert_type = 'stale_tasks'"
        ).fetchone()

    earliest_created_at = min(
        (float(row.get("created_at") or now) for row in rows),
        default=now,
    )
    since = earliest_created_at if all_time else range_start
    window_seconds = max(3600, now - since)
    # 上一周期取同样长度的同一时段，例如“今天”对比昨天 0 点到昨天此刻
    previous_since = (start_dt - timedelta(days=days)).timestamp()
    previous_end = previous_since + (now - since)
    username_map = {str(row["id"]): str(row["username"]) for row in user_rows}
    display_name_map = _admin_display_name_map()

    current = rows if all_time else [
        row for row in rows if float(row["created_at"] or 0) >= since
    ]
    previous = [] if all_time else [
        row for row in rows
        if previous_since <= float(row["created_at"] or 0) < previous_end
    ]

    def summarize(items: list[dict]) -> dict:
        done = sum(1 for item in items if item["status"] == "done")
        failed = sum(1 for item in items if item["status"] == "failed")
        cancelled = sum(1 for item in items if item["status"] == "cancelled")
        active = sum(1 for item in items if item["status"] in _ADMIN_ACTIVE_STATUSES)
        terminal = done + failed
        return {
            "total": len(items),
            "done": done,
            "failed": failed,
            "cancelled": cancelled,
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
        items = [item for item in current if item["task_type"] == task_type]
        summary = summarize(items)
        summary["type"] = task_type
        summary["agent"] = sum(1 for item in items if item.get("source") == "agent")  # 其中由 Agent 模式发起
        breakdown.append(summary)
    agent_usage = _agent_usage(since, test_uids, [item for item in current if item.get("source") == "agent"])

    # 趋势图按整点 / 整天分桶，标签与时间段对齐
    if all_time:
        bucket_count, bucket_seconds = 12, window_seconds / 12
    elif days == 1:
        bucket_count, bucket_seconds = 12, 2 * 3600
    elif days <= 7:
        bucket_count, bucket_seconds = days, 86400
    else:
        bucket_count, bucket_seconds = -(-days // 2), 2 * 86400
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
    )

    return {
        "generated_at": now,
        "range_hours": safe_hours,
        "summary": current_summary,
        "previous_summary": previous_summary,
        "breakdown": breakdown,
        "agent": agent_usage,
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


# 任务来源：Agent 模式发起的生图 / 特殊品记为 agent，其余入口为空
_AI_SOURCE_SQL = (
    "CASE WHEN json_valid(request_meta_json) AND json_extract(request_meta_json, '$.source') = 'agent2' "
    "THEN 'agent' ELSE '' END"
)
_SPECIAL_SOURCE_SQL = "CASE WHEN source = 'agent2' THEN 'agent' ELSE '' END"

# 用户主动停止的生图任务落库为 failed + recovery.phase=cancelled（见 agent2/tools.py）；
# 统计时归为 cancelled，既不算失败，也不进成功率分母
_AI_STATUS_SQL = (
    "CASE WHEN status = 'failed' AND json_valid(request_meta_json) "
    "AND json_extract(request_meta_json, '$.recovery.phase') = 'cancelled' "
    "THEN 'cancelled' ELSE status END"
)


# 生图任务的 request_meta_json 里记录了所用技能名；非法 JSON 时视为未用技能
_SKILL_SQL = (
    "CASE WHEN json_valid(request_meta_json) "
    "THEN COALESCE(json_extract(request_meta_json, '$.skill'), '') ELSE '' END"
)


def load_skill_usage_stats() -> dict[tuple[str, str], dict]:
    """按 (用户, 技能名) 统计使用次数、失败次数和最近使用时间，每次交互算一次。

    - 聊天框直接用技能生图：一次提交算一次，批量出多张也只算一次；整批都失败才算失败
    - Agent：一轮对话里用户选了该技能，或 Agent 加载、读取了该技能的文件或参考图，算一次；该轮失败才算失败
    """
    uses: dict[tuple[str, str, str], tuple[bool, float]] = {}
    with _connect() as conn:
        for row in conn.execute(
            f"""
            SELECT user_id, {_SKILL_SQL} AS skill,
                   MIN(CASE WHEN {_AI_STATUS_SQL} = 'failed' THEN 1 ELSE 0 END) AS failed,
                   MAX(created_at) AS used_at,
                   COALESCE(NULLIF(CASE WHEN json_valid(request_meta_json)
                       THEN json_extract(request_meta_json, '$.batch_id') END, ''), id) AS interaction
            FROM ai_image_jobs
            WHERE {_SKILL_SQL} != ''
            GROUP BY user_id, skill, interaction
            """
        ):
            uses[(row["user_id"], row["skill"], "job:" + row["interaction"])] = (bool(row["failed"]), row["used_at"])
        if conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'agent2_turns'").fetchone():
            for row in conn.execute(
                """
                SELECT t.user_id, t.id AS turn_id, t.status, t.started_at,
                       json_extract(c.args_json, '$.name') AS skill
                FROM agent2_tool_calls c JOIN agent2_turns t ON t.id = c.turn_id
                WHERE c.tool IN ('load_skill', 'read_skill_file', 'use_skill_image') AND json_valid(c.args_json)
                UNION
                SELECT t.user_id, t.id, t.status, t.started_at, json_extract(e.payload_json, '$.skill')
                FROM agent2_events e JOIN agent2_turns t ON t.id = e.turn_id
                WHERE e.type = 'turn.started' AND json_valid(e.payload_json)
                """
            ):
                if row["skill"]:
                    uses[(row["user_id"], row["skill"], "turn:" + row["turn_id"])] = (
                        row["status"] == "failed", row["started_at"])
    stats: dict[tuple[str, str], dict] = {}
    for (user_id, skill, _interaction), (failed, used_at) in uses.items():
        item = stats.setdefault((user_id, skill), {"total": 0, "failed": 0, "last_used_at": None})
        item["total"] += 1
        item["failed"] += int(failed)
        item["last_used_at"] = max(item["last_used_at"] or 0, used_at or 0) or None
    return stats


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
    skill: str | None = None,
    source: str | None = None,
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
    else:
        test_uids = _test_user_ids_set()
        if test_uids:
            placeholders = ",".join("?" for _ in test_uids)
            clauses.append(f"(user_id IS NULL OR user_id NOT IN ({placeholders}))")
            params.extend(list(test_uids))
    if provider:
        p_clean = provider.strip().lower()
        if p_clean in ("bfl", "blf"):
            clauses.append("provider IN ('bfl', 'blf')")
        else:
            clauses.append("provider = ?")
            params.append(provider)
    if reference == "yes":
        clauses.append("has_reference = 1")
    elif reference == "no":
        clauses.append("has_reference = 0")
    if skill:
        clauses.append("skill = ?")
        params.append(skill)
    if source == "agent":
        clauses.append("source = 'agent'")
    elif source == "normal":
        clauses.append("source = ''")
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

    task_cte = f"""
        WITH all_tasks AS (
            SELECT 'compose' AS task_type, id, user_id, status, created_at,
                   updated_at, error, '' AS model, request_json AS summary,
                   0 AS progress, '' AS image_url, 'penpot' AS provider,
                   0 AS has_reference, NULL AS reference_count, '' AS resolution, '' AS skill, '' AS source
            FROM jobs
            UNION ALL
            SELECT 'special' AS task_type, id, user_id, status, created_at,
                   updated_at, error, '' AS model, sku AS summary,
                   0 AS progress, '' AS image_url, 'penpot' AS provider,
                   0 AS has_reference, NULL AS reference_count, '' AS resolution, '' AS skill,
                   {_SPECIAL_SOURCE_SQL} AS source
            FROM special_jobs
            UNION ALL
            SELECT 'ai_image' AS task_type, id, user_id, status, created_at,
                   COALESCE(updated_at, created_at) AS updated_at, error, model, prompt AS summary,
                   progress, COALESCE(image_url, '') AS image_url, COALESCE(provider, '') AS provider,
                   has_reference, reference_count, COALESCE(resolution, '') AS resolution,
                   {_SKILL_SQL} AS skill, {_AI_SOURCE_SQL} AS source
            FROM ai_image_jobs
            UNION ALL
            SELECT 'agent_image' AS task_type, id, user_id, 'done' AS status, created_at,
                   created_at AS updated_at, '' AS error, model, prompt_json AS summary,
                   100 AS progress, COALESCE(image_url, '') AS image_url, COALESCE(provider, '') AS provider,
                   CASE WHEN parent_image_id IS NULL THEN 0 ELSE 1 END AS has_reference,
                   CASE WHEN parent_image_id IS NULL THEN 0 ELSE 1 END AS reference_count,
                   '' AS resolution, '' AS skill, '' AS source
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
            item["penpot_edit_url"] = _public_penpot_edit_url(item.get("penpot_edit_url"))
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
            item["penpot_edit_url"] = _public_penpot_edit_url(item.get("penpot_edit_url"))
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


def is_inspiration_asset(path: str) -> bool:
    """这张图是否已发布到灵感广场（原图或缩略图）。库里的地址可能带 URL 编码，两种写法都查。"""
    encoded = quote(path, safe="/")
    with _connect() as conn:
        return conn.execute(
            "SELECT 1 FROM inspiration_posts WHERE image_url IN (?, ?) OR thumb_url IN (?, ?) LIMIT 1",
            (path, encoded, path, encoded),
        ).fetchone() is not None


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


# ─── 常用语 (Quick Prompts) ───────────────────────────────────────────────────

DEFAULT_QUICK_PROMPTS: list[dict[str, str]] = [
    {
        "title": "专业商业静物摄影",
        "category": "通用",
        "content": "专业商业静物摄影，极简纯白背景，柔和均匀的影棚双侧柔光箱布光，产品居中，锐利清晰，8K超清画质，无杂物无反光",
    },
]


def seed_default_quick_prompts(user_id: str, force: bool = False) -> list[dict]:
    """为用户注入推荐电商常用语预设（默认仅预设一条常用摄影描述）"""
    clean_user = str(user_id or "").strip()
    if not clean_user:
        return []
    now = time.time()
    with _lock, _connect() as conn:
        if not force:
            row = conn.execute(
                "SELECT 1 FROM quick_prompt_seeds WHERE user_id = ?",
                (clean_user,),
            ).fetchone()
            if row:
                return _list_quick_prompts_internal(conn, clean_user)
        else:
            conn.execute("DELETE FROM quick_prompts WHERE user_id = ?", (clean_user,))

        conn.execute(
            "INSERT OR REPLACE INTO quick_prompt_seeds (user_id, seeded_at) VALUES (?, ?)",
            (clean_user, now),
        )
        for idx, item in enumerate(DEFAULT_QUICK_PROMPTS):
            prompt_id = f"qp_{uuid.uuid4().hex[:12]}"
            conn.execute(
                """
                INSERT INTO quick_prompts (id, user_id, title, content, category, sort_order, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (prompt_id, clean_user, item["title"], item["content"], item.get("category") or "通用", idx, now, now),
            )
        conn.commit()
        return _list_quick_prompts_internal(conn, clean_user)


def _list_quick_prompts_internal(conn: sqlite3.Connection, user_id: str) -> list[dict]:
    rows = conn.execute(
        """
        SELECT id, user_id, title, content, category, sort_order, created_at, updated_at
        FROM quick_prompts
        WHERE user_id = ?
        ORDER BY sort_order ASC, created_at DESC
        """,
        (user_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def list_quick_prompts(user_id: str) -> list[dict]:
    """查询指定用户的常用语列表。若该用户首次访问且未初始化过，则自动注入默认预设。"""
    clean_user = str(user_id or "").strip()
    if not clean_user:
        return []
    with _connect() as conn:
        row = conn.execute(
            "SELECT 1 FROM quick_prompt_seeds WHERE user_id = ?",
            (clean_user,),
        ).fetchone()
        if not row:
            # 首次访问，注入推荐预设
            pass
        else:
            return _list_quick_prompts_internal(conn, clean_user)

    return seed_default_quick_prompts(clean_user, force=False)


def create_quick_prompt(user_id: str, title: str | None = None, content: str = "", category: str = "通用") -> dict:
    """新建常用语。若未传标题，自动取内容前30字符作为摘要。"""
    clean_user = str(user_id or "").strip()
    clean_content = str(content or "").strip()
    clean_title = str(title or "").strip() or clean_content[:30]
    clean_category = str(category or "通用").strip() or "通用"
    if not clean_user:
        raise ValueError("user_id 不能为空")
    if not clean_content:
        raise ValueError("常用语内容不能为空")

    now = time.time()
    prompt_id = f"qp_{uuid.uuid4().hex[:12]}"
    with _lock, _connect() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO quick_prompt_seeds (user_id, seeded_at) VALUES (?, ?)",
            (clean_user, now),
        )
        max_order_row = conn.execute(
            "SELECT MAX(sort_order) AS max_order FROM quick_prompts WHERE user_id = ?",
            (clean_user,),
        ).fetchone()
        next_order = (max_order_row["max_order"] + 1) if max_order_row and max_order_row["max_order"] is not None else 0

        conn.execute(
            """
            INSERT INTO quick_prompts (id, user_id, title, content, category, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (prompt_id, clean_user, clean_title, clean_content, clean_category, next_order, now, now),
        )
        conn.commit()

    return {
        "id": prompt_id,
        "user_id": clean_user,
        "title": clean_title,
        "content": clean_content,
        "category": clean_category,
        "sort_order": next_order,
        "created_at": now,
        "updated_at": now,
    }


def update_quick_prompt(
    prompt_id: str,
    user_id: str,
    title: str | None = None,
    content: str | None = None,
    category: str | None = None,
    sort_order: int | None = None,
) -> dict | None:
    """更新常用语"""
    clean_user = str(user_id or "").strip()
    clean_id = str(prompt_id or "").strip()
    if not clean_user or not clean_id:
        return None

    now = time.time()
    with _lock, _connect() as conn:
        row = conn.execute(
            "SELECT * FROM quick_prompts WHERE id = ? AND user_id = ?",
            (clean_id, clean_user),
        ).fetchone()
        if not row:
            return None

        new_title = str(title).strip() if title is not None else row["title"]
        new_content = str(content).strip() if content is not None else row["content"]
        new_category = str(category).strip() if category is not None else row["category"]
        new_sort = int(sort_order) if sort_order is not None else row["sort_order"]

        if not new_title:
            raise ValueError("标题不能为空")
        if not new_content:
            raise ValueError("内容不能为空")

        conn.execute(
            """
            UPDATE quick_prompts
            SET title = ?, content = ?, category = ?, sort_order = ?, updated_at = ?
            WHERE id = ? AND user_id = ?
            """,
            (new_title, new_content, new_category, new_sort, now, clean_id, clean_user),
        )
        conn.commit()

        updated_row = conn.execute(
            "SELECT id, user_id, title, content, category, sort_order, created_at, updated_at FROM quick_prompts WHERE id = ? AND user_id = ?",
            (clean_id, clean_user),
        ).fetchone()
        return dict(updated_row) if updated_row else None


def delete_quick_prompt(prompt_id: str, user_id: str) -> bool:
    """删除常用语"""
    clean_user = str(user_id or "").strip()
    clean_id = str(prompt_id or "").strip()
    if not clean_user or not clean_id:
        return False
    with _lock, _connect() as conn:
        cur = conn.execute(
            "DELETE FROM quick_prompts WHERE id = ? AND user_id = ?",
            (clean_id, clean_user),
        )
        conn.commit()
        return cur.rowcount > 0


# ── Cost Center (成本中心) ────────────────────────────────────────────────────

def _seed_default_model_pricing(conn: sqlite3.Connection) -> None:
    """Seed default model prices using INSERT OR IGNORE so manual edits are preserved."""
    from .cost_pricing import DEFAULT_IMAGE_PRICING, DEFAULT_LLM_PRICING

    now = time.time()
    for mkey, spec in DEFAULT_IMAGE_PRICING.items():
        if isinstance(spec, dict):
            p1 = float(spec.get("price_1k", spec.get("unit_price", 0.04)))
            p15 = float(spec.get("price_1_5k", round(p1 * 1.25, 6)))
            p2 = float(spec.get("price_2k", round(p1 * 1.5, 6)))
            p4 = float(spec.get("price_4k", round(p1 * 2.0, 6)))
        else:
            p1 = float(spec)
            p15, p2, p4 = round(p1 * 1.25, 6), round(p1 * 1.5, 6), round(p1 * 2.0, 6)
        conn.execute(
            """
            INSERT OR IGNORE INTO model_pricing (
                category, model_key, unit_price, price_1k, price_1_5k, price_2k, price_4k,
                note, updated_by, updated_at
            ) VALUES ('image', ?, ?, ?, ?, ?, ?, '系统默认单价', 'system', ?)
            """,
            (mkey, p1, p1, p15, p2, p4, now),
        )
    for mkey, spec in DEFAULT_LLM_PRICING.items():
        conn.execute(
            """
            INSERT OR IGNORE INTO model_pricing (
                category, model_key, input_per_1m, output_per_1m,
                note, updated_by, updated_at
            ) VALUES ('llm', ?, ?, ?, '系统默认单价', 'system', ?)
            """,
            (mkey, float(spec.get("input_per_1m", 1.0)), float(spec.get("output_per_1m", 4.0)), now),
        )


def _load_db_pricing_overrides(conn: sqlite3.Connection) -> tuple[dict[str, dict], dict[str, dict]]:
    """Load registered model pricing from model_pricing table."""
    img_map: dict[str, dict] = {}
    llm_map: dict[str, dict] = {}
    try:
        rows = conn.execute("SELECT * FROM model_pricing").fetchall()
    except Exception:
        return img_map, llm_map
    for r in rows:
        cat = str(r["category"] or "image")
        key = str(r["model_key"] or "").strip().lower()
        if not key:
            continue
        if cat == "llm":
            llm_map[key] = {
                "input_per_1m": float(r["input_per_1m"] or 0.0),
                "output_per_1m": float(r["output_per_1m"] or 0.0),
            }
        else:
            p1 = r["price_1k"] if r["price_1k"] is not None else r["unit_price"]
            base = float(p1 or 0.0)
            img_map[key] = {
                "price_1k": base,
                "price_1_5k": float(r["price_1_5k"]) if r["price_1_5k"] is not None else round(base * 1.25, 6),
                "price_2k": float(r["price_2k"]) if r["price_2k"] is not None else round(base * float(r["resolution_2k_mult"] or 1.5), 6),
                "price_4k": float(r["price_4k"]) if r["price_4k"] is not None else round(base * float(r["resolution_4k_mult"] or 2.0), 6),
            }
    return img_map, llm_map


def _backfill_ai_image_costs(conn: sqlite3.Connection) -> None:
    """Idempotent backfill of cost & token usage from operation_logs into ai_image_jobs."""
    from .cost_pricing import resolve_image_cost

    pending = conn.execute(
        """
        SELECT id, model, provider, resolution, size, status
        FROM ai_image_jobs
        WHERE status = 'done' AND cost IS NULL AND total_tokens IS NULL
        """
    ).fetchall()
    if not pending:
        return

    img_overrides, _ = _load_db_pricing_overrides(conn)
    by_job_id: dict[str, dict] = {}
    op_rows = conn.execute(
        "SELECT payload FROM operation_logs WHERE action = 'ai_image' AND payload != ''"
    ).fetchall()
    for row in op_rows:
        try:
            data = json.loads(row["payload"])
        except Exception:
            continue
        if not isinstance(data, dict) or data.get("result") != "done":
            continue
        jid = str(data.get("job_id") or "").strip()
        if jid:
            by_job_id[jid] = data

    for job in pending:
        jid = job["id"]
        op = by_job_id.get(jid) or {}
        usage = op.get("usage") if isinstance(op.get("usage"), dict) else {}
        in_tok = int(usage.get("input_tokens") or 0) or None
        out_tok = int(usage.get("output_tokens") or 0) or None
        tot_tok = int(usage.get("total_tokens") or 0) or (
            (in_tok or 0) + (out_tok or 0) if (in_tok or out_tok) else None
        )
        upstream_cost = op.get("cost")
        provider = job["provider"] or op.get("provider")
        cost_val, cost_src = resolve_image_cost(
            job["model"],
            provider=provider,
            resolution=job["resolution"],
            size=job["size"],
            upstream_cost=upstream_cost,
            db_overrides=img_overrides,
        )
        conn.execute(
            """
            UPDATE ai_image_jobs
            SET cost = ?, cost_source = ?,
                input_tokens = COALESCE(input_tokens, ?),
                output_tokens = COALESCE(output_tokens, ?),
                total_tokens = COALESCE(total_tokens, ?)
            WHERE id = ? AND cost IS NULL
            """,
            (cost_val, cost_src, in_tok, out_tok, tot_tok, jid),
        )


def update_ai_image_job_cost(
    job_id: str,
    *,
    cost: float | None = None,
    cost_source: str | None = None,
    usage: dict | None = None,
    model: str | None = None,
    provider: str | None = None,
    resolution: str | None = None,
    size: str | None = None,
) -> None:
    """Persist cost & token usage for a completed ai_image_jobs row."""
    if not job_id:
        return
    from .cost_pricing import resolve_image_cost

    in_tok: int | None = None
    out_tok: int | None = None
    tot_tok: int | None = None
    if isinstance(usage, dict):
        in_tok = int(usage.get("input_tokens") or 0)
        out_tok = int(usage.get("output_tokens") or 0)
        tot_tok = int(usage.get("total_tokens") or (in_tok + out_tok))

    with _lock, _connect() as conn:
        row = conn.execute(
            "SELECT model, provider, resolution, size FROM ai_image_jobs WHERE id = ?",
            (job_id,),
        ).fetchone()
        if not row:
            return
        img_overrides, _ = _load_db_pricing_overrides(conn)
        resolved_cost, resolved_src = resolve_image_cost(
            model or row["model"],
            provider=provider or row["provider"],
            resolution=resolution or row["resolution"],
            size=size or row["size"],
            upstream_cost=cost,
            db_overrides=img_overrides,
        )
        final_src = cost_source or resolved_src
        conn.execute(
            """
            UPDATE ai_image_jobs
            SET cost = ?, cost_source = ?,
                input_tokens = COALESCE(?, input_tokens),
                output_tokens = COALESCE(?, output_tokens),
                total_tokens = COALESCE(?, total_tokens),
                updated_at = ?
            WHERE id = ?
            """,
            (resolved_cost, final_src, in_tok, out_tok, tot_tok, time.time(), job_id),
        )
        conn.commit()


def record_llm_usage(
    *,
    user_id: str | None,
    model: str,
    provider: str | None = None,
    session_id: str | None = None,
    turn_id: str | None = None,
    source: str = "agent2",
    input_tokens: int = 0,
    output_tokens: int = 0,
    total_tokens: int = 0,
    cost: float | None = None,
    cost_source: str | None = None,
    usage_source: str = "upstream",
) -> None:
    """Record one LLM/VLM call's token usage and cost."""
    from .cost_pricing import resolve_llm_cost

    in_tok = max(0, int(input_tokens or 0))
    out_tok = max(0, int(output_tokens or 0))
    tot_tok = max(0, int(total_tokens or (in_tok + out_tok)))

    with _lock, _connect() as conn:
        _, llm_overrides = _load_db_pricing_overrides(conn)
        resolved_cost, resolved_src = resolve_llm_cost(
            model, input_tokens=in_tok, output_tokens=out_tok, upstream_cost=cost,
            db_overrides=llm_overrides,
        )
        final_src = cost_source or resolved_src
        conn.execute(
            """
            INSERT INTO llm_usage_logs (
                user_id, session_id, turn_id, source, provider, model,
                input_tokens, output_tokens, total_tokens,
                cost, cost_source, usage_source, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(user_id) if user_id else None,
                str(session_id) if session_id else None,
                str(turn_id) if turn_id else None,
                str(source or "agent2"),
                str(provider) if provider else None,
                str(model or "unknown"),
                in_tok,
                out_tok,
                tot_tok,
                resolved_cost,
                final_src,
                str(usage_source or "upstream"),
                time.time(),
            ),
        )
        conn.commit()


def _cost_bucket_key(ts: float, granularity: str) -> tuple[str, str]:
    dt = datetime.fromtimestamp(ts)
    if granularity == "month":
        return dt.strftime("%Y-%m"), dt.strftime("%Y-%m")
    if granularity == "week":
        monday = (dt - timedelta(days=dt.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
        return monday.strftime("%Y-%m-%d"), monday.strftime("%m/%d 周")
    return dt.strftime("%Y-%m-%d"), dt.strftime("%m/%d")


def load_admin_cost_center(
    *,
    hours: int = 168,
    start_date: str | None = None,
    end_date: str | None = None,
    user_id: str | None = None,
    model: str | None = None,
    category: str | None = None,
    granularity: str = "day",
    include_test: bool = False,
) -> dict:
    """Aggregate cost and token usage across member, time, and model dimensions."""
    from .cost_pricing import get_usd_to_cny_rate, resolve_image_cost, resolve_llm_cost

    now = time.time()
    all_time = False
    range_start = 0.0
    range_end = now

    if start_date or end_date:
        if start_date:
            s_dt = datetime.strptime(start_date.strip(), "%Y-%m-%d")
            range_start = s_dt.timestamp()
        if end_date:
            e_dt = datetime.strptime(end_date.strip(), "%Y-%m-%d") + timedelta(days=1)
            range_end = e_dt.timestamp()
    else:
        req_hours = int(hours)
        all_time = req_hours == 0
        if not all_time:
            safe_hours = max(1, min(req_hours, 24 * 365))
            days = max(1, -(-safe_hours // 24))
            start_dt = datetime.fromtimestamp(now).replace(
                hour=0, minute=0, second=0, microsecond=0
            ) - timedelta(days=days - 1)
            range_start = start_dt.timestamp()

    safe_granularity = granularity if granularity in ("day", "week", "month") else "day"
    safe_category = category if category in ("all", "image", "llm") else "all"
    clean_user = str(user_id or "").strip() or None
    clean_model = str(model or "").strip() or None

    with _connect() as conn:
        img_overrides, llm_overrides = _load_db_pricing_overrides(conn)
        test_uids = set() if include_test else _test_user_ids_set()
        user_rows = conn.execute("SELECT id, username FROM users").fetchall()
        username_map = {str(r["id"]): str(r["username"]) for r in user_rows if r["id"]}
        display_name_map = _admin_display_name_map()

        img_where = ["status = 'done'"]
        img_params: list = []
        llm_where = ["1=1"]
        llm_params: list = []

        if not all_time:
            img_where.append("created_at >= ? AND created_at <= ?")
            img_params.extend([range_start, range_end])
            llm_where.append("created_at >= ? AND created_at <= ?")
            llm_params.extend([range_start, range_end])

        if test_uids:
            ph = ",".join("?" for _ in test_uids)
            img_where.append(f"(user_id IS NULL OR user_id NOT IN ({ph}))")
            img_params.extend(test_uids)
            llm_where.append(f"(user_id IS NULL OR user_id NOT IN ({ph}))")
            llm_params.extend(test_uids)

        img_rows = conn.execute(
            f"""
            SELECT id, user_id, model, provider, resolution, size,
                   cost, cost_source, input_tokens, output_tokens, total_tokens, created_at
            FROM ai_image_jobs
            WHERE {' AND '.join(img_where)}
            """,
            tuple(img_params),
        ).fetchall()

        llm_rows = conn.execute(
            f"""
            SELECT id, user_id, source, provider, model,
                   input_tokens, output_tokens, total_tokens,
                   cost, cost_source, usage_source, created_at
            FROM llm_usage_logs
            WHERE {' AND '.join(llm_where)}
            """,
            tuple(llm_params),
        ).fetchall()

    def _member_label(uid: str) -> tuple[str, str]:
        uname = username_map.get(uid, uid or "unknown")
        dname = display_name_map.get(uid) or uname
        return uname, dname

    # Collect filter options from all records in the time window before applying user/model filters
    all_member_ids: set[str] = set()
    all_model_names: set[str] = set()
    events: list[dict] = []

    for r in img_rows:
        uid = str(r["user_id"] or "unknown")
        mname = str(r["model"] or "unknown")
        all_member_ids.add(uid)
        all_model_names.add(mname)
        if safe_category == "llm":
            continue
        if clean_user and uid != clean_user:
            continue
        if clean_model and mname != clean_model:
            continue
        cost_val, cost_src = resolve_image_cost(
            mname,
            provider=r["provider"],
            resolution=r["resolution"],
            size=r["size"],
            upstream_cost=r["cost"],
            db_overrides=img_overrides,
        )
        if r["cost"] is not None and r["cost_source"]:
            cost_src = str(r["cost_source"])
        in_tok = int(r["input_tokens"] or 0)
        out_tok = int(r["output_tokens"] or 0)
        tot_tok = int(r["total_tokens"] or (in_tok + out_tok))
        events.append({
            "category": "image",
            "user_id": uid,
            "model": mname,
            "provider": str(r["provider"] or "-"),
            "cost": cost_val,
            "cost_source": cost_src,
            "input_tokens": in_tok,
            "output_tokens": out_tok,
            "total_tokens": tot_tok,
            "created_at": float(r["created_at"] or now),
        })

    for r in llm_rows:
        uid = str(r["user_id"] or "unknown")
        mname = str(r["model"] or "unknown")
        all_member_ids.add(uid)
        all_model_names.add(mname)
        if safe_category == "image":
            continue
        if clean_user and uid != clean_user:
            continue
        if clean_model and mname != clean_model:
            continue
        in_tok = int(r["input_tokens"] or 0)
        out_tok = int(r["output_tokens"] or 0)
        tot_tok = int(r["total_tokens"] or (in_tok + out_tok))
        cost_val, cost_src = resolve_llm_cost(
            mname, input_tokens=in_tok, output_tokens=out_tok, upstream_cost=r["cost"],
            db_overrides=llm_overrides,
        )
        if r["cost"] is not None and r["cost_source"]:
            cost_src = str(r["cost_source"])
        events.append({
            "category": "llm",
            "user_id": uid,
            "model": mname,
            "provider": str(r["provider"] or r["source"] or "-"),
            "cost": cost_val,
            "cost_source": cost_src,
            "input_tokens": in_tok,
            "output_tokens": out_tok,
            "total_tokens": tot_tok,
            "created_at": float(r["created_at"] or now),
        })

    # Aggregate summary, timeline, by_member, by_model
    total_cost = 0.0
    image_cost = 0.0
    llm_cost = 0.0
    image_calls = 0
    llm_calls = 0
    total_tokens = 0
    input_tokens = 0
    output_tokens = 0
    upstream_count = 0
    estimated_count = 0
    free_count = 0

    timeline_map: dict[str, dict] = {}
    member_map: dict[str, dict] = {}
    model_map: dict[str, dict] = {}

    for ev in events:
        c = float(ev["cost"])
        in_t = ev["input_tokens"]
        out_t = ev["output_tokens"]
        tot_t = ev["total_tokens"]
        cat = ev["category"]
        uid = ev["user_id"]
        mname = ev["model"]
        ts = ev["created_at"]

        total_cost += c
        total_tokens += tot_t
        input_tokens += in_t
        output_tokens += out_t
        if cat == "image":
            image_cost += c
            image_calls += 1
        else:
            llm_cost += c
            llm_calls += 1

        if ev["cost_source"] == "upstream":
            upstream_count += 1
        elif ev["cost_source"] == "free":
            free_count += 1
        else:
            estimated_count += 1

        bkey, blabel = _cost_bucket_key(ts, safe_granularity)
        tb = timeline_map.get(bkey)
        if not tb:
            tb = {
                "bucket": bkey,
                "label": blabel,
                "total_cost": 0.0,
                "image_cost": 0.0,
                "llm_cost": 0.0,
                "image_calls": 0,
                "llm_calls": 0,
                "total_tokens": 0,
            }
            timeline_map[bkey] = tb
        tb["total_cost"] += c
        tb["total_tokens"] += tot_t
        if cat == "image":
            tb["image_cost"] += c
            tb["image_calls"] += 1
        else:
            tb["llm_cost"] += c
            tb["llm_calls"] += 1

        mb = member_map.get(uid)
        if not mb:
            uname, dname = _member_label(uid)
            mb = {
                "user_id": uid,
                "username": uname,
                "display_name": dname,
                "total_cost": 0.0,
                "image_cost": 0.0,
                "llm_cost": 0.0,
                "image_calls": 0,
                "llm_calls": 0,
                "total_tokens": 0,
                "input_tokens": 0,
                "output_tokens": 0,
                "last_active_at": ts,
                "_models": {},
            }
            member_map[uid] = mb
        mb["total_cost"] += c
        mb["total_tokens"] += tot_t
        mb["input_tokens"] += in_t
        mb["output_tokens"] += out_t
        if ts > mb["last_active_at"]:
            mb["last_active_at"] = ts
        if cat == "image":
            mb["image_cost"] += c
            mb["image_calls"] += 1
        else:
            mb["llm_cost"] += c
            mb["llm_calls"] += 1

        mm = mb["_models"].get((mname, cat))
        if not mm:
            mm = {"model": mname, "category": cat, "calls": 0, "total_tokens": 0, "cost": 0.0}
            mb["_models"][(mname, cat)] = mm
        mm["calls"] += 1
        mm["total_tokens"] += tot_t
        mm["cost"] += c

        md_key = f"{cat}::{mname}"
        md = model_map.get(md_key)
        if not md:
            md = {
                "model": mname,
                "category": cat,
                "providers": set(),
                "calls": 0,
                "total_tokens": 0,
                "input_tokens": 0,
                "output_tokens": 0,
                "total_cost": 0.0,
                "upstream_count": 0,
                "estimated_count": 0,
                "free_count": 0,
            }
            model_map[md_key] = md
        md["calls"] += 1
        md["total_tokens"] += tot_t
        md["input_tokens"] += in_t
        md["output_tokens"] += out_t
        md["total_cost"] += c
        if ev["provider"] and ev["provider"] != "-":
            md["providers"].add(ev["provider"])
        if ev["cost_source"] == "upstream":
            md["upstream_count"] += 1
        elif ev["cost_source"] == "free":
            md["free_count"] += 1
        else:
            md["estimated_count"] += 1

    timeline = []
    for k in sorted(timeline_map.keys()):
        item = timeline_map[k]
        item["total_cost"] = round(item["total_cost"], 4)
        item["image_cost"] = round(item["image_cost"], 4)
        item["llm_cost"] = round(item["llm_cost"], 4)
        timeline.append(item)

    by_member = []
    for mb in member_map.values():
        models_list = sorted(mb.pop("_models").values(), key=lambda x: (-x["cost"], -x["calls"]))
        for m in models_list:
            m["cost"] = round(m["cost"], 4)
        mb["total_cost"] = round(mb["total_cost"], 4)
        mb["image_cost"] = round(mb["image_cost"], 4)
        mb["llm_cost"] = round(mb["llm_cost"], 4)
        mb["total_calls"] = mb["image_calls"] + mb["llm_calls"]
        mb["top_model"] = models_list[0]["model"] if models_list else "-"
        mb["models"] = models_list
        mb["share_pct"] = round(mb["total_cost"] * 100 / total_cost, 1) if total_cost > 0 else 0.0
        by_member.append(mb)
    by_member.sort(key=lambda x: (-x["total_cost"], -x["total_calls"]))

    by_model = []
    for md in model_map.values():
        provs = sorted(md.pop("providers"))
        md["provider"] = ", ".join(provs) if provs else "-"
        md["total_cost"] = round(md["total_cost"], 4)
        md["avg_cost"] = round(md["total_cost"] / md["calls"], 4) if md["calls"] else 0.0
        md["share_pct"] = round(md["total_cost"] * 100 / total_cost, 1) if total_cost > 0 else 0.0
        by_model.append(md)
    by_model.sort(key=lambda x: (-x["total_cost"], -x["calls"]))

    total_calls = image_calls + llm_calls
    filter_members = []
    for uid in sorted(all_member_ids):
        uname, dname = _member_label(uid)
        filter_members.append({"user_id": uid, "username": uname, "display_name": dname})
    filter_members.sort(key=lambda x: x["display_name"].casefold())

    return {
        "currency": "USD",
        "usd_to_cny": get_usd_to_cny_rate(),
        "range": {
            "hours": 0 if all_time else int(hours),
            "start_date": start_date or "",
            "end_date": end_date or "",
            "granularity": safe_granularity,
            "all_time": all_time,
        },
        "summary": {
            "total_cost": round(total_cost, 4),
            "image_cost": round(image_cost, 4),
            "llm_cost": round(llm_cost, 4),
            "total_calls": total_calls,
            "image_calls": image_calls,
            "llm_calls": llm_calls,
            "total_tokens": total_tokens,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "upstream_cost_count": upstream_count,
            "estimated_cost_count": estimated_count,
            "free_count": free_count,
            "active_members": len(by_member),
            "active_models": len(by_model),
            "avg_cost_per_call": round(total_cost / total_calls, 4) if total_calls else None,
        },
        "timeline": timeline,
        "by_member": by_member,
        "by_model": by_model,
        "filter_options": {
            "members": filter_members,
            "models": sorted(all_model_names),
        },
    }


def list_admin_model_pricing() -> list[dict]:
    """List registered model pricing rows plus any observed models without explicit pricing."""
    from .cost_pricing import normalize_model_key

    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM model_pricing ORDER BY category ASC, model_key ASC"
        ).fetchall()
        items: list[dict] = []
        seen: set[tuple[str, str]] = set()
        for r in rows:
            cat = str(r["category"] or "image")
            mkey = str(r["model_key"] or "").strip().lower()
            seen.add((cat, mkey))
            p1 = r["price_1k"] if r["price_1k"] is not None else r["unit_price"]
            p1_val = float(p1) if p1 is not None else None
            p15_val = float(r["price_1_5k"]) if r["price_1_5k"] is not None else (round(p1_val * 1.25, 6) if p1_val is not None else None)
            p2_val = float(r["price_2k"]) if r["price_2k"] is not None else (round(p1_val * 1.5, 6) if p1_val is not None else None)
            p4_val = float(r["price_4k"]) if r["price_4k"] is not None else (round(p1_val * 2.0, 6) if p1_val is not None else None)
            items.append({
                "category": cat,
                "model_key": mkey,
                "unit_price": p1_val,
                "price_1k": p1_val,
                "price_1_5k": p15_val,
                "price_2k": p2_val,
                "price_4k": p4_val,
                "input_per_1m": r["input_per_1m"],
                "output_per_1m": r["output_per_1m"],
                "note": str(r["note"] or ""),
                "updated_by": str(r["updated_by"] or ""),
                "updated_at": r["updated_at"],
                "registered": True,
            })

        # Discover models observed in ai_image_jobs or llm_usage_logs not yet in model_pricing
        for r in conn.execute("SELECT DISTINCT model FROM ai_image_jobs WHERE model IS NOT NULL AND model != ''").fetchall():
            mkey = normalize_model_key(r["model"])
            if mkey and not mkey.startswith("local-") and ("image", mkey) not in seen:
                seen.add(("image", mkey))
                items.append({
                    "category": "image",
                    "model_key": mkey,
                    "unit_price": None,
                    "price_1k": None,
                    "price_1_5k": None,
                    "price_2k": None,
                    "price_4k": None,
                    "input_per_1m": None,
                    "output_per_1m": None,
                    "note": "未登记单价（当前按默认兜底估算）",
                    "updated_by": "",
                    "updated_at": None,
                    "registered": False,
                })
        for r in conn.execute("SELECT DISTINCT model FROM llm_usage_logs WHERE model IS NOT NULL AND model != ''").fetchall():
            mkey = normalize_model_key(r["model"])
            if mkey and ("llm", mkey) not in seen:
                seen.add(("llm", mkey))
                items.append({
                    "category": "llm",
                    "model_key": mkey,
                    "unit_price": None,
                    "price_1k": None,
                    "price_1_5k": None,
                    "price_2k": None,
                    "price_4k": None,
                    "input_per_1m": None,
                    "output_per_1m": None,
                    "note": "未登记单价（当前按默认兜底估算）",
                    "updated_by": "",
                    "updated_at": None,
                    "registered": False,
                })
    return items


def save_admin_model_pricing(
    *,
    category: str,
    model_key: str,
    unit_price: float | None = None,
    price_1k: float | None = None,
    price_1_5k: float | None = None,
    price_2k: float | None = None,
    price_4k: float | None = None,
    input_per_1m: float | None = None,
    output_per_1m: float | None = None,
    resolution_2k_mult: float = 1.5,
    resolution_4k_mult: float = 2.0,
    note: str = "",
    updated_by: str = "",
    sync_history: bool = True,
) -> dict:
    """Register or update a model's price and optionally sync historical non-upstream records in DB."""
    from .cost_pricing import estimate_image_cost, estimate_llm_cost, normalize_model_key

    cat = "llm" if str(category).strip().lower() == "llm" else "image"
    clean_key = normalize_model_key(model_key)
    if not clean_key or clean_key == "unknown":
        raise ValueError("模型名称不能为空")

    now = time.time()
    m2k = max(0.0, float(resolution_2k_mult if resolution_2k_mult is not None else 1.5))
    m4k = max(0.0, float(resolution_4k_mult if resolution_4k_mult is not None else 2.0))
    clean_note = str(note or "").strip()

    if cat == "image":
        base_raw = price_1k if price_1k is not None else unit_price
        if base_raw is None or float(base_raw) < 0:
            raise ValueError("生图模型 1K 单价不能为负数")
        p1 = round(float(base_raw), 6)
        p15 = round(float(price_1_5k if price_1_5k is not None else p1 * 1.25), 6)
        p2 = round(float(price_2k if price_2k is not None else p1 * m2k), 6)
        p4 = round(float(price_4k if price_4k is not None else p1 * m4k), 6)
        if p15 < 0 or p2 < 0 or p4 < 0:
            raise ValueError("生图模型各分辨率单价不能为负数")
        u_price = p1
        in_p = None
        out_p = None
    else:
        if input_per_1m is None or output_per_1m is None or float(input_per_1m) < 0 or float(output_per_1m) < 0:
            raise ValueError("对话模型输入/输出单价不能为负数")
        u_price = None
        p1 = p15 = p2 = p4 = None
        in_p = round(float(input_per_1m), 6)
        out_p = round(float(output_per_1m), 6)

    synced_count = 0
    with _lock, _connect() as conn:
        conn.execute(
            """
            INSERT INTO model_pricing (
                category, model_key, unit_price, price_1k, price_1_5k, price_2k, price_4k,
                input_per_1m, output_per_1m, resolution_2k_mult, resolution_4k_mult,
                note, updated_by, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(category, model_key) DO UPDATE SET
                unit_price = excluded.unit_price,
                price_1k = excluded.price_1k,
                price_1_5k = excluded.price_1_5k,
                price_2k = excluded.price_2k,
                price_4k = excluded.price_4k,
                input_per_1m = excluded.input_per_1m,
                output_per_1m = excluded.output_per_1m,
                resolution_2k_mult = excluded.resolution_2k_mult,
                resolution_4k_mult = excluded.resolution_4k_mult,
                note = excluded.note,
                updated_by = excluded.updated_by,
                updated_at = excluded.updated_at
            """,
            (cat, clean_key, u_price, p1, p15, p2, p4, in_p, out_p, m2k, m4k, clean_note, str(updated_by or ""), now),
        )

        if sync_history:
            img_overrides, llm_overrides = _load_db_pricing_overrides(conn)
            if cat == "image":
                rows = conn.execute(
                    """
                    SELECT id, model, provider, resolution, size, cost_source
                    FROM ai_image_jobs
                    WHERE status = 'done' AND (cost_source IS NULL OR cost_source != 'upstream')
                    """
                ).fetchall()
                for r in rows:
                    if normalize_model_key(r["model"]) != clean_key:
                        continue
                    new_cost, new_src = estimate_image_cost(
                        r["model"],
                        provider=r["provider"],
                        resolution=r["resolution"],
                        size=r["size"],
                        db_overrides=img_overrides,
                    )
                    conn.execute(
                        "UPDATE ai_image_jobs SET cost = ?, cost_source = ?, updated_at = ? WHERE id = ?",
                        (new_cost, new_src, now, r["id"]),
                    )
                    synced_count += 1
            else:
                rows = conn.execute(
                    """
                    SELECT id, model, input_tokens, output_tokens, cost_source
                    FROM llm_usage_logs
                    WHERE cost_source IS NULL OR cost_source != 'upstream'
                    """
                ).fetchall()
                for r in rows:
                    if normalize_model_key(r["model"]) != clean_key:
                        continue
                    new_cost, new_src = estimate_llm_cost(
                        r["model"],
                        input_tokens=int(r["input_tokens"] or 0),
                        output_tokens=int(r["output_tokens"] or 0),
                        db_overrides=llm_overrides,
                    )
                    conn.execute(
                        "UPDATE llm_usage_logs SET cost = ?, cost_source = ? WHERE id = ?",
                        (new_cost, new_src, r["id"]),
                    )
                    synced_count += 1

        conn.commit()
        saved_row = conn.execute(
            "SELECT * FROM model_pricing WHERE category = ? AND model_key = ?",
            (cat, clean_key),
        ).fetchone()

    item = dict(saved_row) if saved_row else {}
    item["registered"] = True
    return {"item": item, "synced_count": synced_count}




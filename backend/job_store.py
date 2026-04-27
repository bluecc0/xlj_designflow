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
        for col, typ in [("penpot_file_id", "TEXT"), ("penpot_edit_url", "TEXT")]:
            try:
                conn.execute(f"ALTER TABLE jobs ADD COLUMN {col} {typ}")
            except sqlite3.OperationalError:
                pass  # 列已存在，忽略

        # 特殊品任务表
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
        conn.commit()


# ─── 基本 CRUD ────────────────────────────────────────────────────────────────

def save_job(job: ComposeJob) -> None:
    """插入或更新 job 记录"""
    now = time.time()
    print(f"[job_store] Saving job {job.id}, status={job.status.value}, db_path={_DB_PATH}")
    with _lock, _connect() as conn:
        conn.execute("""
            INSERT INTO jobs (id, status, request_json, result_path, penpot_file_id, penpot_edit_url, error, progress_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                status          = excluded.status,
                result_path     = excluded.result_path,
                penpot_file_id  = excluded.penpot_file_id,
                penpot_edit_url = excluded.penpot_edit_url,
                error           = excluded.error,
                progress_json   = excluded.progress_json,
                updated_at      = excluded.updated_at
        """, (
            job.id,
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


def load_recent_jobs(limit: int = 50) -> list[ComposeJob]:
    """按时间倒序返回最近 N 条任务"""
    print(f"[job_store] Loading recent jobs, limit={limit}, db_path={_DB_PATH}")
    with _connect() as conn:
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
              (id, status, sku, request_json, result_paths_json, result_frame_ids_json,
               penpot_file_id, penpot_page_id, penpot_edit_url, error, progress_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
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


def load_special_jobs(limit: int = 50) -> list[dict]:
    """从数据库加载特殊品任务列表（返回 dict 列表供 history API 使用）"""
    with _connect() as conn:
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
            'sku': row["sku"] or '',
            'status': row["status"],
            'created_at': row["created_at"],
            'penpot_edit_url': row["penpot_edit_url"],
            'frames': frame_list,
            '_type': 'special',
        })
    return results

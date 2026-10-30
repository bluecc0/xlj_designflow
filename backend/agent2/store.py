"""Agent 会话、轮次、事件、产物的持久化（沿用 jobs.db）。"""
from __future__ import annotations

import json
import time
import uuid
from typing import Any

from ..job_store import _connect


def init_tables() -> None:
    with _connect() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS agent2_sessions (
                id          TEXT PRIMARY KEY,
                user_id     TEXT NOT NULL,
                title       TEXT NOT NULL DEFAULT '',
                messages_json TEXT NOT NULL DEFAULT '[]',
                next_seq    INTEGER NOT NULL DEFAULT 1,
                created_at  REAL NOT NULL,
                updated_at  REAL NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS agent2_turns (
                id            TEXT PRIMARY KEY,
                session_id    TEXT NOT NULL,
                user_id       TEXT NOT NULL,
                status        TEXT NOT NULL,
                user_input    TEXT NOT NULL DEFAULT '',
                engine_state  TEXT,
                error         TEXT,
                started_at    REAL NOT NULL,
                finished_at   REAL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS agent2_events (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id  TEXT NOT NULL,
                turn_id     TEXT NOT NULL,
                seq         INTEGER NOT NULL,
                type        TEXT NOT NULL,
                payload_json TEXT NOT NULL DEFAULT '{}',
                created_at  REAL NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_agent2_events_session ON agent2_events(session_id, seq)")
        # 上下文压缩：summary 覆盖 messages_json 的前 compacted_upto 条消息
        columns = {r["name"] for r in conn.execute("PRAGMA table_info(agent2_sessions)")}
        if "summary" not in columns:
            conn.execute("ALTER TABLE agent2_sessions ADD COLUMN summary TEXT NOT NULL DEFAULT ''")
        if "compacted_upto" not in columns:
            conn.execute("ALTER TABLE agent2_sessions ADD COLUMN compacted_upto INTEGER NOT NULL DEFAULT 0")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS agent2_tool_calls (
                id          TEXT PRIMARY KEY,
                turn_id     TEXT NOT NULL,
                tool        TEXT NOT NULL,
                args_json   TEXT NOT NULL DEFAULT '{}',
                status      TEXT NOT NULL,
                result_json TEXT,
                error       TEXT,
                duration_ms INTEGER,
                created_at  REAL NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS agent2_artifacts (
                id          TEXT PRIMARY KEY,
                session_id  TEXT NOT NULL,
                user_id     TEXT NOT NULL,
                kind        TEXT NOT NULL,
                url         TEXT NOT NULL,
                path        TEXT NOT NULL DEFAULT '',
                label       TEXT NOT NULL DEFAULT '',
                group_id    TEXT,
                group_type  TEXT,
                position    INTEGER NOT NULL DEFAULT 0,
                parent_id   TEXT,
                source_tool_call_id TEXT,
                meta_json   TEXT NOT NULL DEFAULT '{}',
                created_at  REAL NOT NULL
            )
        """)


def _row(row) -> dict[str, Any] | None:
    return dict(row) if row else None


# ── 会话 ──────────────────────────────────────────────────────────────────────

def create_session(user_id: str, title: str = "") -> dict:
    now = time.time()
    session = {"id": uuid.uuid4().hex, "user_id": user_id, "title": title, "created_at": now, "updated_at": now}
    with _connect() as conn:
        conn.execute(
            "INSERT INTO agent2_sessions (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (session["id"], user_id, title, now, now),
        )
    return session


def get_session(session_id: str, user_id: str) -> dict | None:
    with _connect() as conn:
        return _row(conn.execute(
            "SELECT * FROM agent2_sessions WHERE id = ? AND user_id = ?", (session_id, user_id),
        ).fetchone())


def list_sessions(user_id: str, limit: int = 30) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, title, created_at, updated_at FROM agent2_sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
    return [dict(r) for r in rows]


def delete_session(session_id: str, user_id: str) -> bool:
    """删除会话及其轮次、事件、工具调用和产物记录；生成的图片文件保留。"""
    with _connect() as conn:
        if not conn.execute("SELECT 1 FROM agent2_sessions WHERE id = ? AND user_id = ?", (session_id, user_id)).fetchone():
            return False
        turn_ids = [r["id"] for r in conn.execute("SELECT id FROM agent2_turns WHERE session_id = ?", (session_id,))]
        conn.executemany("DELETE FROM agent2_tool_calls WHERE turn_id = ?", [(t,) for t in turn_ids])
        for table in ("agent2_turns", "agent2_events", "agent2_artifacts"):
            conn.execute(f"DELETE FROM {table} WHERE session_id = ?", (session_id,))
        conn.execute("DELETE FROM agent2_sessions WHERE id = ?", (session_id,))
    return True


def save_session_messages(session_id: str, messages: list[dict], title: str | None = None) -> None:
    with _connect() as conn:
        if title is not None:
            conn.execute(
                "UPDATE agent2_sessions SET messages_json = ?, title = ?, updated_at = ? WHERE id = ?",
                (json.dumps(messages, ensure_ascii=False), title, time.time(), session_id),
            )
        else:
            conn.execute(
                "UPDATE agent2_sessions SET messages_json = ?, updated_at = ? WHERE id = ?",
                (json.dumps(messages, ensure_ascii=False), time.time(), session_id),
            )


def save_compaction(session_id: str, summary: str, compacted_upto: int) -> None:
    with _connect() as conn:
        conn.execute("UPDATE agent2_sessions SET summary = ?, compacted_upto = ? WHERE id = ?",
                     (summary, compacted_upto, session_id))


def load_session_messages(session: dict) -> list[dict]:
    try:
        data = json.loads(session.get("messages_json") or "[]")
    except ValueError:
        return []
    return data if isinstance(data, list) else []


# ── 轮次 ──────────────────────────────────────────────────────────────────────

def claim_turn(session_id: str, user_id: str, user_input: str) -> dict | None:
    """原子占用会话：已有运行中的轮次时返回 None；还在等回答的轮次视为被新消息取代。"""
    turn = {"id": uuid.uuid4().hex, "session_id": session_id, "user_id": user_id, "status": "running",
            "user_input": user_input, "started_at": time.time()}
    with _connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        if conn.execute("SELECT 1 FROM agent2_turns WHERE session_id = ? AND status = 'running'",
                        (session_id,)).fetchone():
            return None
        conn.execute("UPDATE agent2_turns SET status = 'done', finished_at = ? WHERE session_id = ? AND status = 'waiting_user'",
                     (turn["started_at"], session_id))
        conn.execute(
            "INSERT INTO agent2_turns (id, session_id, user_id, status, user_input, started_at) VALUES (?, ?, ?, ?, ?, ?)",
            (turn["id"], session_id, user_id, "running", user_input, turn["started_at"]),
        )
    return turn


def claim_answer(turn_id: str, user_id: str) -> bool:
    """回答提问：只有一个请求能把 waiting_user 切到 running。"""
    with _connect() as conn:
        cur = conn.execute(
            "UPDATE agent2_turns SET status = 'running' WHERE id = ? AND user_id = ? AND status = 'waiting_user'",
            (turn_id, user_id),
        )
        return cur.rowcount == 1


def _active_turn(conn, session_id: str) -> dict | None:
    return _row(conn.execute(
        "SELECT id, status FROM agent2_turns WHERE session_id = ? AND status IN ('running', 'waiting_user') "
        "ORDER BY started_at DESC LIMIT 1", (session_id,),
    ).fetchone())


def get_active_turn(session_id: str) -> dict | None:
    with _connect() as conn:
        return _active_turn(conn, session_id)


def session_snapshot(session_id: str, after_seq: int = 0) -> dict:
    """续接轮询用：事件、活动轮次、未完成生图在同一个读事务里读取，保证是同一时刻的状态。
    否则查完事件后后台才写入补图事件，接口会返回"没有新事件、也没有待处理任务"，前端就此停止轮询。"""
    with _connect() as conn:
        conn.execute("BEGIN")
        return {"events": _list_events(conn, session_id, after_seq),
                "active_turn": _active_turn(conn, session_id),
                "pending_jobs": _count_pending_image_jobs(conn, session_id)}


def fail_stale_turns(message: str) -> list[dict]:
    """服务启动时：上次进程留下的 running 轮次已经没有执行者，标记为失败。"""
    with _connect() as conn:
        rows = [dict(r) for r in conn.execute("SELECT id, session_id FROM agent2_turns WHERE status = 'running'")]
        conn.execute("UPDATE agent2_turns SET status = 'failed', error = ?, finished_at = ? WHERE status = 'running'",
                     (message, time.time()))
    return rows


def get_turn(turn_id: str, user_id: str) -> dict | None:
    with _connect() as conn:
        return _row(conn.execute(
            "SELECT * FROM agent2_turns WHERE id = ? AND user_id = ?", (turn_id, user_id),
        ).fetchone())


def update_turn(turn_id: str, *, status: str, engine_state: dict | None = None, error: str | None = None) -> None:
    finished = time.time() if status in {"done", "failed", "cancelled"} else None
    with _connect() as conn:
        conn.execute(
            "UPDATE agent2_turns SET status = ?, engine_state = ?, error = ?, finished_at = COALESCE(?, finished_at) WHERE id = ?",
            (status, json.dumps(engine_state, ensure_ascii=False) if engine_state is not None else None, error, finished, turn_id),
        )


# ── 事件 ──────────────────────────────────────────────────────────────────────

def append_event(session_id: str, turn_id: str, event_type: str, payload: dict) -> dict:
    """事件先落库再推送；seq 按会话递增，断线重连时据此补发。"""
    with _connect() as conn:
        return _append_event(conn, session_id, turn_id, event_type, payload)


def _append_event(conn, session_id: str, turn_id: str, event_type: str, payload: dict) -> dict:
    now = time.time()
    row = conn.execute("SELECT next_seq FROM agent2_sessions WHERE id = ?", (session_id,)).fetchone()
    seq = int(row["next_seq"]) if row else 1
    conn.execute("UPDATE agent2_sessions SET next_seq = ?, updated_at = ? WHERE id = ?", (seq + 1, now, session_id))
    conn.execute(
        "INSERT INTO agent2_events (session_id, turn_id, seq, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (session_id, turn_id, seq, event_type, json.dumps(payload, ensure_ascii=False), now),
    )
    return {"session_id": session_id, "turn_id": turn_id, "seq": seq, "type": event_type, "payload": payload}


def list_events(session_id: str, after_seq: int = 0) -> list[dict]:
    with _connect() as conn:
        return _list_events(conn, session_id, after_seq)


def _list_events(conn, session_id: str, after_seq: int) -> list[dict]:
    rows = conn.execute(
        "SELECT turn_id, seq, type, payload_json FROM agent2_events WHERE session_id = ? AND seq > ? ORDER BY seq",
        (session_id, after_seq),
    ).fetchall()
    return [
        {"session_id": session_id, "turn_id": r["turn_id"], "seq": r["seq"], "type": r["type"],
         "payload": json.loads(r["payload_json"] or "{}")}
        for r in rows
    ]


# ── 工具调用 ──────────────────────────────────────────────────────────────────

def record_tool_call(call_id: str, turn_id: str, tool: str, args: dict, status: str, *,
                     result: Any = None, error: str | None = None, duration_ms: int | None = None) -> None:
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO agent2_tool_calls (id, turn_id, tool, args_json, status, result_json, error, duration_ms, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET status = excluded.status, result_json = excluded.result_json,
                error = excluded.error, duration_ms = excluded.duration_ms
            """,
            (call_id, turn_id, tool, json.dumps(args, ensure_ascii=False), status,
             json.dumps(result, ensure_ascii=False) if result is not None else None, error, duration_ms, time.time()),
        )


# ── 产物 ──────────────────────────────────────────────────────────────────────

def create_artifact(*, session_id: str, user_id: str, kind: str, url: str, path: str = "", label: str = "",
                    group_id: str | None = None, group_type: str | None = None, position: int = 0,
                    parent_id: str | None = None, source_tool_call_id: str | None = None,
                    meta: dict | None = None) -> dict:
    artifact = {
        "id": "img_" + uuid.uuid4().hex[:10], "session_id": session_id, "user_id": user_id, "kind": kind,
        "url": url, "path": path, "label": label, "group_id": group_id, "group_type": group_type,
        "position": position, "parent_id": parent_id, "source_tool_call_id": source_tool_call_id,
        "meta": meta or {}, "created_at": time.time(),
    }
    with _connect() as conn:
        _insert_artifact(conn, artifact)
    return artifact


def _insert_artifact(conn, a: dict) -> None:
    conn.execute(
        """
        INSERT INTO agent2_artifacts (id, session_id, user_id, kind, url, path, label, group_id, group_type,
            position, parent_id, source_tool_call_id, meta_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (a["id"], a["session_id"], a["user_id"], a["kind"], a["url"], a["path"], a["label"], a["group_id"],
         a["group_type"], a["position"], a["parent_id"], a["source_tool_call_id"],
         json.dumps(a["meta"], ensure_ascii=False), a["created_at"]),
    )


def register_job_artifact(job_id: str, turn_id: str, make_event, **fields) -> tuple[dict, dict] | None:
    """生图任务的产物和 artifact.created 事件在同一个事务里写入：要么都有，要么都没有。
    同一任务只登记一次（实时完成和重启恢复共用）；已登记过返回 None。"""
    artifact = {"id": "img_" + uuid.uuid4().hex[:10], "kind": "image", "path": "", "label": "",
                "group_id": None, "group_type": None, "position": 0, "parent_id": None,
                "source_tool_call_id": None, "created_at": time.time(), **fields}
    artifact["meta"] = {**(fields.get("meta") or {}), "job_id": job_id}
    with _connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        if conn.execute("SELECT 1 FROM agent2_artifacts WHERE json_extract(meta_json, '$.job_id') = ? LIMIT 1",
                        (job_id,)).fetchone():
            return None
        _insert_artifact(conn, artifact)
        event = _append_event(conn, artifact["session_id"], turn_id, "artifact.created", make_event(artifact))
    return artifact, event


def list_artifacts(session_id: str, limit: int = 30) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, kind, label, group_type, created_at FROM agent2_artifacts WHERE session_id = ? "
            "ORDER BY created_at DESC LIMIT ?", (session_id, limit),
        ).fetchall()
    return [dict(r) for r in rows]


def list_call_artifacts(call_id: str) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, label FROM agent2_artifacts WHERE source_tool_call_id = ? ORDER BY position", (call_id,),
        ).fetchall()
    return [dict(r) for r in rows]


# 已出图但产物还没登记的任务也算待处理（后台恢复写完 done 到补登产物之间有空档）；
# 只看最近完成的，历史上没登记成功的任务不会让前端一直轮询
UNDELIVERED_WINDOW_SECONDS = 600


def count_pending_image_jobs(session_id: str) -> int:
    """会话里还没交付的 Agent 生图任务数：执行中、等待后台恢复，或已出图但产物和事件还没写入（用户停止的不算）。"""
    with _connect() as conn:
        return _count_pending_image_jobs(conn, session_id)


def _count_pending_image_jobs(conn, session_id: str) -> int:
    row = conn.execute("""
        SELECT COUNT(*) FROM ai_image_jobs j
        WHERE json_valid(j.request_meta_json)
          AND json_extract(j.request_meta_json, '$.source') = 'agent2'
          AND json_extract(j.request_meta_json, '$.session_id') = ?
          AND COALESCE(json_extract(j.request_meta_json, '$.recovery.phase'), '') != 'cancelled'
          -- 抠图、放大、扩图等处理任务随工具调用结束，不参与重启后的补图
          AND COALESCE(json_extract(j.request_meta_json, '$.operation'), '') NOT IN
              ('matting', 'upscale', 'vectorize', 'layer_extract', 'outpainting')
          AND (j.status IN ('pending', 'queued', 'processing', 'running')
               OR (j.status = 'done' AND COALESCE(j.updated_at, j.created_at) > ?
                   AND NOT EXISTS (SELECT 1 FROM agent2_artifacts a WHERE a.session_id = ?
                                   AND json_extract(a.meta_json, '$.job_id') = j.id)))
    """, (session_id, time.time() - UNDELIVERED_WINDOW_SECONDS, session_id)).fetchone()
    return int(row[0] or 0)


def take_unannounced_recovered(session_id: str) -> list[dict]:
    """取出重启后补回、还没告诉模型的图片，并标记为已告知。"""
    with _connect() as conn:
        rows = [dict(r) for r in conn.execute("""
            SELECT id, label FROM agent2_artifacts WHERE session_id = ?
              AND json_extract(meta_json, '$.recovered') = 1 AND COALESCE(json_extract(meta_json, '$.announced'), 0) = 0
            ORDER BY created_at
        """, (session_id,))]
        conn.executemany("UPDATE agent2_artifacts SET meta_json = json_set(meta_json, '$.announced', 1) WHERE id = ?",
                         [(r["id"],) for r in rows])
    return rows


def find_job_artifact(job_id: str) -> dict | None:
    with _connect() as conn:
        return _row(conn.execute(
            "SELECT * FROM agent2_artifacts WHERE json_extract(meta_json, '$.job_id') = ? LIMIT 1", (job_id,),
        ).fetchone())


def get_artifact(artifact_id: str, user_id: str) -> dict | None:
    with _connect() as conn:
        return _row(conn.execute(
            "SELECT * FROM agent2_artifacts WHERE id = ? AND user_id = ?", (artifact_id, user_id),
        ).fetchone())

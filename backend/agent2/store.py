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


def load_session_messages(session: dict) -> list[dict]:
    try:
        data = json.loads(session.get("messages_json") or "[]")
    except ValueError:
        return []
    return data if isinstance(data, list) else []


# ── 轮次 ──────────────────────────────────────────────────────────────────────

def create_turn(session_id: str, user_id: str, user_input: str) -> dict:
    turn = {"id": uuid.uuid4().hex, "session_id": session_id, "user_id": user_id, "status": "running",
            "user_input": user_input, "started_at": time.time()}
    with _connect() as conn:
        conn.execute(
            "INSERT INTO agent2_turns (id, session_id, user_id, status, user_input, started_at) VALUES (?, ?, ?, ?, ?, ?)",
            (turn["id"], session_id, user_id, "running", user_input, turn["started_at"]),
        )
    return turn


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
    now = time.time()
    with _connect() as conn:
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
        conn.execute(
            """
            INSERT INTO agent2_artifacts (id, session_id, user_id, kind, url, path, label, group_id, group_type,
                position, parent_id, source_tool_call_id, meta_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (artifact["id"], session_id, user_id, kind, url, path, label, group_id, group_type, position,
             parent_id, source_tool_call_id, json.dumps(artifact["meta"], ensure_ascii=False), artifact["created_at"]),
        )
    return artifact


def get_artifact(artifact_id: str, user_id: str) -> dict | None:
    with _connect() as conn:
        return _row(conn.execute(
            "SELECT * FROM agent2_artifacts WHERE id = ? AND user_id = ?", (artifact_id, user_id),
        ).fetchone())

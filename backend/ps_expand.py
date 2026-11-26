"""
Photoshop 原生生成式扩展（PS-Expand）异步任务中心与 Worker 反向 WebSocket 调度。

独立路由前缀 `/api/v1/expand/*`，与现有 BFL 扩图（`/ai-image/outpainting`）完全隔离。
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import re
import secrets
import shutil
import sqlite3
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any, Iterator, Optional

from fastapi import (
    APIRouter,
    File,
    Form,
    Header,
    HTTPException,
    Query,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image, UnidentifiedImageError

from .config import settings

DB_PATH = settings.root_dir / "jobs.db"

logger = logging.getLogger("ps_expand")

router = APIRouter(prefix="/api/v1/expand", tags=["ps-expand"])

_VALID_ANCHORS = {
    "center",
    "top",
    "bottom",
    "left",
    "right",
    "top_left",
    "top_right",
    "bottom_left",
    "bottom_right",
}
_VALID_OUTPUT_FORMATS = {"jpg", "jpeg", "png"}
_SAFE_SEGMENT_RE = re.compile(r"^[A-Za-z0-9._-]+$")
_ASPECT_RATIO_RE = re.compile(r"^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$")

_HEARTBEAT_TIMEOUT_SEC = 45.0
_DISCONNECT_GRACE_SEC = 45.0
_SWEEPER_INTERVAL_SEC = 15.0
_PROCESSING_GRACE_SEC = 30.0
_DEFAULT_AVG_DURATION_SEC = 20.0


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def _now_ts() -> float:
    return time.time()


def _expand_storage_root() -> Path:
    root = settings.output_path / "ps-expand"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _task_dir(task_id: str) -> Path:
    if not _SAFE_SEGMENT_RE.match(task_id):
        raise ValueError("Invalid task_id")
    d = _expand_storage_root() / task_id
    d.mkdir(parents=True, exist_ok=True)
    return d


@contextmanager
def _get_conn() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(str(DB_PATH), timeout=30.0)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=15000")
        yield conn
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        conn.close()


def init_ps_expand_tables() -> None:
    """初始化 expand_tasks 独立任务表，并在重启时回收遗留的 processing 任务。"""
    with _get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS expand_tasks (
                task_id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                stage TEXT DEFAULT '',
                client_id TEXT DEFAULT '',
                client_request_id TEXT DEFAULT '',
                worker_id TEXT DEFAULT '',
                input_filename TEXT NOT NULL,
                spec_json TEXT NOT NULL,
                outputs_json TEXT DEFAULT '[]',
                requested_variants INTEGER DEFAULT 3,
                variants_complete INTEGER DEFAULT 1,
                variant_warning TEXT DEFAULT '',
                error_code TEXT,
                error_message TEXT,
                duration_ms INTEGER,
                created_at TEXT NOT NULL,
                started_at REAL,
                finished_at TEXT,
                updated_ts REAL NOT NULL
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_expand_tasks_status_created ON expand_tasks(status, updated_ts)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_expand_tasks_client_status ON expand_tasks(client_id, status)"
        )
        # 兼容已有旧表：按需补齐多变体完整性字段
        existing_cols = {
            row["name"] for row in conn.execute("PRAGMA table_info(expand_tasks)").fetchall()
        }
        if "requested_variants" not in existing_cols:
            conn.execute("ALTER TABLE expand_tasks ADD COLUMN requested_variants INTEGER DEFAULT 3")
        if "variants_complete" not in existing_cols:
            conn.execute("ALTER TABLE expand_tasks ADD COLUMN variants_complete INTEGER DEFAULT 1")
        if "variant_warning" not in existing_cols:
            conn.execute("ALTER TABLE expand_tasks ADD COLUMN variant_warning TEXT DEFAULT ''")
        # 服务重启时，之前处于 processing 的任务视为中断超时，避免前端永久等待
        now_iso = _now_iso()
        now_ts = _now_ts()
        conn.execute(
            """
            UPDATE expand_tasks
            SET status = 'timeout',
                stage = '',
                error_code = 'PS_EXEC_TIMEOUT',
                error_message = '服务端重启，处理中的任务已中断，请重新提交。',
                finished_at = ?,
                updated_ts = ?
            WHERE status = 'processing'
            """,
            (now_iso, now_ts),
        )
        conn.commit()


# ─── 参数校验与几何换算 ──────────────────────────────────


def _split_by_anchor(delta: int, anchor_axis: str) -> tuple[int, int]:
    """根据轴向锚点（start / center / end）把扩展总像素拆成 (before, after)。"""
    if delta <= 0:
        return 0, 0
    if anchor_axis == "start":
        return 0, delta
    if anchor_axis == "end":
        return delta, 0
    before = delta // 2
    return before, delta - before


def _anchor_axes(anchor: str) -> tuple[str, str]:
    """返回 (horizontal_axis, vertical_axis)，取值为 start / center / end。"""
    h = "center"
    v = "center"
    if "left" in anchor:
        h = "start"
    elif "right" in anchor:
        h = "end"
    if "top" in anchor:
        v = "start"
    elif "bottom" in anchor:
        v = "end"
    return h, v


def normalize_expand_spec(raw_spec: dict[str, Any], orig_w: int, orig_h: int) -> dict[str, Any]:
    """校验并统一换算为精确的四边 padding 与目标画布尺寸。"""
    if orig_w <= 0 or orig_h <= 0:
        raise HTTPException(
            status_code=400,
            detail={"error_code": "INVALID_EXPAND_SPEC", "error_message": "原图尺寸非法。"},
        )

    mode = str(raw_spec.get("mode") or "padding").strip().lower()
    anchor = str(raw_spec.get("anchor") or "center").strip().lower()
    if mode == "target_size" and isinstance(raw_spec.get("target_size"), dict):
        anchor = str(raw_spec["target_size"].get("anchor") or anchor).strip().lower()
    if anchor not in _VALID_ANCHORS:
        raise HTTPException(
            status_code=400,
            detail={"error_code": "INVALID_EXPAND_SPEC", "error_message": f"不支持的锚点值：{anchor}"},
        )

    pad_top = pad_right = pad_bottom = pad_left = 0

    if mode == "padding":
        pad = raw_spec.get("padding")
        if not isinstance(pad, dict):
            raise HTTPException(
                status_code=400,
                detail={"error_code": "INVALID_EXPAND_SPEC", "error_message": "padding 模式缺少 padding 对象。"},
            )
        try:
            pad_top = int(pad.get("top", 0))
            pad_right = int(pad.get("right", 0))
            pad_bottom = int(pad.get("bottom", 0))
            pad_left = int(pad.get("left", 0))
        except (TypeError, ValueError):
            raise HTTPException(
                status_code=400,
                detail={"error_code": "INVALID_EXPAND_SPEC", "error_message": "padding 必须为非负整数。"},
            )
        if min(pad_top, pad_right, pad_bottom, pad_left) < 0:
            raise HTTPException(
                status_code=400,
                detail={"error_code": "INVALID_EXPAND_SPEC", "error_message": "padding 不能为负数。"},
            )

    elif mode == "target_size":
        ts = raw_spec.get("target_size")
        if not isinstance(ts, dict):
            raise HTTPException(
                status_code=400,
                detail={"error_code": "INVALID_EXPAND_SPEC", "error_message": "target_size 模式缺少 target_size 对象。"},
            )
        try:
            tw = int(ts.get("width", 0))
            th = int(ts.get("height", 0))
        except (TypeError, ValueError):
            raise HTTPException(
                status_code=400,
                detail={"error_code": "INVALID_EXPAND_SPEC", "error_message": "目标宽高必须为整数。"},
            )
        if tw < orig_w or th < orig_h:
            raise HTTPException(
                status_code=400,
                detail={
                    "error_code": "INVALID_EXPAND_SPEC",
                    "error_message": f"目标尺寸 {tw}x{th} 不能小于原图 {orig_w}x{orig_h}。",
                },
            )
        h_axis, v_axis = _anchor_axes(anchor)
        pad_left, pad_right = _split_by_anchor(tw - orig_w, h_axis)
        pad_top, pad_bottom = _split_by_anchor(th - orig_h, v_axis)

    elif mode == "aspect_ratio":
        ratio_str = str(raw_spec.get("aspect_ratio") or "").strip()
        m = _ASPECT_RATIO_RE.match(ratio_str)
        if not m:
            raise HTTPException(
                status_code=400,
                detail={"error_code": "INVALID_EXPAND_SPEC", "error_message": f"非法的画幅比例：{ratio_str}"},
            )
        rw, rh = float(m.group(1)), float(m.group(2))
        if rw <= 0 or rh <= 0:
            raise HTTPException(
                status_code=400,
                detail={"error_code": "INVALID_EXPAND_SPEC", "error_message": "画幅比例必须大于 0。"},
            )
        target_ratio = rw / rh
        orig_ratio = orig_w / orig_h
        if target_ratio > orig_ratio:
            tw = max(orig_w, int(math.ceil(orig_h * target_ratio)))
            th = orig_h
        else:
            tw = orig_w
            th = max(orig_h, int(math.ceil(orig_w / target_ratio)))
        h_axis, v_axis = _anchor_axes(anchor)
        pad_left, pad_right = _split_by_anchor(tw - orig_w, h_axis)
        pad_top, pad_bottom = _split_by_anchor(th - orig_h, v_axis)

    else:
        raise HTTPException(
            status_code=400,
            detail={"error_code": "INVALID_EXPAND_SPEC", "error_message": f"不支持的扩图模式：{mode}"},
        )

    if (pad_top + pad_right + pad_bottom + pad_left) <= 0:
        raise HTTPException(
            status_code=400,
            detail={"error_code": "INVALID_EXPAND_SPEC", "error_message": "至少需要向一个方向扩展大于 0 像素。"},
        )

    target_w = orig_w + pad_left + pad_right
    target_h = orig_h + pad_top + pad_bottom
    max_side = max(512, int(settings.ps_expand_max_side or 6000))
    if target_w > max_side or target_h > max_side:
        raise HTTPException(
            status_code=400,
            detail={
                "error_code": "INVALID_EXPAND_SPEC",
                "error_message": f"目标尺寸 {target_w}x{target_h} 超过上限 {max_side}px。",
            },
        )

    output_format = str(raw_spec.get("output_format") or "jpg").strip().lower()
    if output_format == "jpeg":
        output_format = "jpg"
    if output_format not in _VALID_OUTPUT_FORMATS:
        output_format = "jpg"

    try:
        quality = max(1, min(100, int(raw_spec.get("quality", 92))))
    except (TypeError, ValueError):
        quality = 92

    return {
        "mode": mode,
        "source_width": orig_w,
        "source_height": orig_h,
        "target_width": target_w,
        "target_height": target_h,
        "padding": {
            "top": pad_top,
            "right": pad_right,
            "bottom": pad_bottom,
            "left": pad_left,
        },
        "prompt": str(raw_spec.get("prompt") or "").strip(),
        "return_all_variants": bool(raw_spec.get("return_all_variants", True)),
        "output_format": output_format,
        "quality": quality,
    }


# ─── Worker 反向 WebSocket 调度中心 ──────────────────────


@dataclass
class ConnectedWorker:
    worker_id: str
    websocket: WebSocket
    hello_received: bool = False
    ps_version: str = ""
    worker_version: str = ""
    exec_mode: str = "cep"
    busy: bool = False
    paused: bool = False
    quarantined: bool = False
    current_task_id: Optional[str] = None
    last_heartbeat_ts: float = field(default_factory=_now_ts)
    last_heartbeat_iso: str = field(default_factory=_now_iso)


class ExpandCoordinator:
    def __init__(self) -> None:
        self._workers: dict[str, ConnectedWorker] = {}
        self._disconnected_at: dict[str, float] = {}
        self._lock = asyncio.Lock()
        self._sweeper_task: Optional[asyncio.Task] = None

    def start(self) -> None:
        if self._sweeper_task is None or self._sweeper_task.done():
            self._sweeper_task = asyncio.create_task(self._sweeper_loop())

    async def stop(self) -> None:
        if self._sweeper_task and not self._sweeper_task.done():
            self._sweeper_task.cancel()
            await asyncio.gather(self._sweeper_task, return_exceptions=True)
        self._sweeper_task = None
        async with self._lock:
            workers = list(self._workers.values())
            self._workers.clear()
        for w in workers:
            try:
                await w.websocket.close(code=1001)
            except Exception:
                pass

    def _is_worker_alive(self, worker: ConnectedWorker) -> bool:
        return (_now_ts() - worker.last_heartbeat_ts) <= _HEARTBEAT_TIMEOUT_SEC

    async def register_worker(self, worker_id: str, websocket: WebSocket) -> ConnectedWorker:
        old_worker: Optional[ConnectedWorker] = None
        async with self._lock:
            old_worker = self._workers.get(worker_id)
            self._disconnected_at.pop(worker_id, None)
            worker = ConnectedWorker(worker_id=worker_id, websocket=websocket)
            self._workers[worker_id] = worker
        if old_worker is not None:
            logger.info("[ps_expand] replacing stale worker connection: %s", worker_id)
            try:
                await old_worker.websocket.close(code=4001, reason="Replaced by new worker connection")
            except Exception:
                pass
        return worker

    async def unregister_worker(self, worker_id: str, websocket: WebSocket) -> None:
        in_flight_task_id: Optional[str] = None
        async with self._lock:
            current = self._workers.get(worker_id)
            if current and current.websocket is websocket:
                in_flight_task_id = current.current_task_id
                del self._workers[worker_id]
                self._disconnected_at[worker_id] = _now_ts()
        if in_flight_task_id:
            # 短暂网络抖动不会中断 PS 原生生成：保留 processing 状态等待宽限期内重连交付结果，超时由 sweeper 回收
            logger.warning(
                "[ps_expand] worker %s disconnected during task %s; keeping processing within grace window",
                worker_id,
                in_flight_task_id,
            )

    def get_worker_status(self) -> dict[str, Any]:
        alive = [w for w in self._workers.values() if self._is_worker_alive(w)]
        primary = alive[0] if alive else None
        queue_len, avg_sec = self._query_queue_metrics()
        return {
            "online": primary is not None,
            "busy": bool(primary and (primary.busy or primary.quarantined)),
            "paused": bool(primary and primary.paused),
            "quarantined": bool(primary and primary.quarantined),
            "worker_count": len(alive),
            "ps_version": primary.ps_version if primary else "",
            "worker_version": primary.worker_version if primary else "",
            "current_task_id": primary.current_task_id if primary else None,
            "queue_length": queue_len,
            "avg_duration_sec": avg_sec,
            "last_heartbeat_at": primary.last_heartbeat_iso if primary else None,
        }

    def _query_queue_metrics(self) -> tuple[int, float]:
        with _get_conn() as conn:
            row = conn.execute("SELECT COUNT(*) AS cnt FROM expand_tasks WHERE status = 'queued'").fetchone()
            queue_len = int(row["cnt"]) if row else 0
            avg_row = conn.execute(
                """
                SELECT AVG(duration_ms) AS avg_ms
                FROM (
                    SELECT duration_ms FROM expand_tasks
                    WHERE status = 'succeeded' AND duration_ms IS NOT NULL AND duration_ms > 0
                    ORDER BY updated_ts DESC LIMIT 20
                )
                """
            ).fetchone()
            avg_ms = float(avg_row["avg_ms"]) if (avg_row and avg_row["avg_ms"]) else 0.0
        avg_sec = round(avg_ms / 1000.0, 1) if avg_ms > 0 else _DEFAULT_AVG_DURATION_SEC
        return queue_len, max(5.0, min(120.0, avg_sec))

    async def dispatch_next(self) -> bool:
        """若存在已完成握手、空闲、未暂停且未隔离的在线 Worker，从队列原子领取最早的 1 条任务并下发。"""
        async with self._lock:
            idle_worker = None
            for w in self._workers.values():
                if (
                    w.hello_received
                    and self._is_worker_alive(w)
                    and not w.busy
                    and not w.paused
                    and not w.quarantined
                ):
                    idle_worker = w
                    break
            if idle_worker is None:
                return False

            task_row = self._claim_next_queued_task(idle_worker.worker_id)
            if task_row is None:
                return False

            task_id = task_row["task_id"]
            spec = json.loads(task_row["spec_json"])
            input_filename = task_row["input_filename"]
            idle_worker.busy = True
            idle_worker.current_task_id = task_id

            payload = {
                "type": "task.assign",
                "task_id": task_id,
                "image_url": f"/api/v1/expand/internal/input/{task_id}/{input_filename}",
                "upload_url": "/api/v1/expand/internal/upload",
                "spec": spec,
                "timeout_sec": max(30, int(settings.ps_expand_task_timeout_seconds or 90)),
            }

            try:
                await idle_worker.websocket.send_json(payload)
                logger.info("[ps_expand] dispatched task %s to worker %s", task_id, idle_worker.worker_id)
                return True
            except Exception as exc:
                logger.error("[ps_expand] failed to send task %s to worker %s: %s", task_id, idle_worker.worker_id, exc)
                idle_worker.busy = False
                idle_worker.current_task_id = None
                self._requeue_task(task_id)
                return False

    def _claim_next_queued_task(self, worker_id: str) -> Optional[sqlite3.Row]:
        now_ts = _now_ts()
        with _get_conn() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                """
                SELECT * FROM expand_tasks
                WHERE status = 'queued'
                ORDER BY updated_ts ASC, rowid ASC
                LIMIT 1
                """
            ).fetchone()
            if not row:
                conn.rollback()
                return None
            cur = conn.execute(
                """
                UPDATE expand_tasks
                SET status = 'processing',
                    stage = 'downloading',
                    worker_id = ?,
                    started_at = ?,
                    updated_ts = ?
                WHERE task_id = ? AND status = 'queued'
                """,
                (worker_id, now_ts, now_ts, row["task_id"]),
            )
            if cur.rowcount != 1:
                conn.rollback()
                return None
            conn.commit()
            return row

    def _requeue_task(self, task_id: str) -> None:
        with _get_conn() as conn:
            conn.execute(
                """
                UPDATE expand_tasks
                SET status = 'queued', stage = '', worker_id = '', started_at = NULL, updated_ts = ?
                WHERE task_id = ? AND status = 'processing'
                """,
                (_now_ts(), task_id),
            )
            conn.commit()

    def _mark_task_timeout(self, task_id: str, message: str) -> None:
        with _get_conn() as conn:
            conn.execute(
                """
                UPDATE expand_tasks
                SET status = 'timeout',
                    stage = '',
                    error_code = 'PS_EXEC_TIMEOUT',
                    error_message = ?,
                    finished_at = ?,
                    updated_ts = ?
                WHERE task_id = ? AND status = 'processing'
                """,
                (message, _now_iso(), _now_ts(), task_id),
            )
            conn.commit()

    def _mark_worker_stale_processing_timeout(self, worker_id: str, message: str) -> None:
        with _get_conn() as conn:
            conn.execute(
                """
                UPDATE expand_tasks
                SET status = 'timeout',
                    stage = '',
                    error_code = 'PS_EXEC_TIMEOUT',
                    error_message = ?,
                    finished_at = ?,
                    updated_ts = ?
                WHERE worker_id = ? AND status = 'processing'
                """,
                (message, _now_iso(), _now_ts(), worker_id),
            )
            conn.commit()

    async def handle_worker_message(self, worker: ConnectedWorker, data: dict[str, Any]) -> None:
        msg_type = str(data.get("type") or "").strip()
        worker.last_heartbeat_ts = _now_ts()
        worker.last_heartbeat_iso = _now_iso()

        if msg_type == "worker.hello":
            worker.hello_received = True
            worker.ps_version = str(data.get("ps_version") or "")
            worker.worker_version = str(data.get("worker_version") or "")
            worker.exec_mode = str(data.get("exec_mode") or "cep")
            worker.paused = bool(data.get("paused", False))
            worker.quarantined = bool(data.get("quarantined", False))
            worker.busy = bool(data.get("busy", False)) or worker.quarantined
            reported_task_id = str(data.get("current_task_id") or "").strip()
            worker.current_task_id = reported_task_id or None
            logger.info(
                "[ps_expand] worker hello: id=%s ps=%s ver=%s busy=%s paused=%s quarantined=%s task=%s",
                worker.worker_id,
                worker.ps_version,
                worker.worker_version,
                worker.busy,
                worker.paused,
                worker.quarantined,
                worker.current_task_id,
            )
            # 若 Worker 重连后明确上报空闲且未隔离（说明 PS 已重启，原执行任务已中断），回收其遗留 processing 任务
            if not worker.busy and not worker.quarantined:
                self._mark_worker_stale_processing_timeout(
                    worker.worker_id,
                    "订阅机已重启，中断的任务已超时，请重新提交。",
                )
            if not worker.busy and not worker.paused and not worker.quarantined:
                await self.dispatch_next()
            return

        if msg_type == "task.rejected":
            task_id = str(data.get("task_id") or "")
            reason = str(data.get("reason") or "busy")
            worker.paused = bool(data.get("paused", worker.paused))
            worker.quarantined = bool(data.get("quarantined", worker.quarantined))
            worker.busy = bool(data.get("busy", True)) or worker.quarantined
            reported_task_id = str(data.get("current_task_id") or "").strip()
            worker.current_task_id = reported_task_id or None
            logger.warning(
                "[ps_expand] worker %s rejected task %s (reason=%s); requeuing",
                worker.worker_id,
                task_id,
                reason,
            )
            if task_id:
                self._requeue_task(task_id)
            return

        if msg_type == "ping":
            reported_busy = bool(data.get("busy", False))
            reported_quarantined = bool(data.get("quarantined", False))
            worker.paused = bool(data.get("paused", False))
            if reported_quarantined:
                worker.quarantined = True
                worker.busy = True
            elif not reported_busy:
                # Worker 确认原生执行已彻底结束（或重启后恢复空闲）才解除隔离
                if worker.quarantined:
                    logger.info("[ps_expand] worker %s recovered from quarantine", worker.worker_id)
                worker.quarantined = False
                if worker.busy and worker.current_task_id:
                    stale_id = worker.current_task_id
                    worker.busy = False
                    worker.current_task_id = None
                    self._mark_task_timeout(stale_id, "订阅机状态重置，任务已超时，请重试。")
                else:
                    worker.busy = False
                    worker.current_task_id = None
            try:
                await worker.websocket.send_json({"type": "pong", "ts": int(_now_ts())})
            except Exception:
                pass
            if not worker.busy and not worker.paused and not worker.quarantined:
                await self.dispatch_next()
            return

        if msg_type == "task.progress":
            task_id = str(data.get("task_id") or "")
            stage = str(data.get("stage") or "expanding")
            if task_id:
                with _get_conn() as conn:
                    conn.execute(
                        "UPDATE expand_tasks SET stage = ?, updated_ts = ? WHERE task_id = ? AND status = 'processing'",
                        (stage, _now_ts(), task_id),
                    )
                    conn.commit()
            return

        if msg_type == "task.result":
            task_id = str(data.get("task_id") or "")
            outputs = data.get("outputs") if isinstance(data.get("outputs"), list) else []
            duration_ms = int(data.get("duration_ms") or 0)
            requested_variants = max(1, int(data.get("requested_variants") or (3 if len(outputs) > 1 else 1)))
            if "requested_variants" not in data and task_id:
                with _get_conn() as conn:
                    spec_row = conn.execute(
                        "SELECT requested_variants FROM expand_tasks WHERE task_id = ?",
                        (task_id,),
                    ).fetchone()
                    if spec_row and spec_row["requested_variants"]:
                        requested_variants = int(spec_row["requested_variants"])
            variants_complete = bool(data.get("variants_complete", len(outputs) >= requested_variants))
            if len(outputs) < requested_variants:
                variants_complete = False
            variant_warning = str(data.get("variant_warning") or "").strip()
            if not variants_complete and not variant_warning:
                variant_warning = f"仅生成 {len(outputs)}/{requested_variants} 个变体（当前 Photoshop 版本暂不支持自动切换多变体）。"
            ack_payload: dict[str, Any] = {
                "type": "task.ack",
                "task_id": task_id,
                "accepted": False,
                "status": "not_found",
                "reason": "task_id_missing",
            }
            if task_id:
                with _get_conn() as conn:
                    cur = conn.execute(
                        """
                        UPDATE expand_tasks
                        SET status = 'succeeded',
                            stage = 'done',
                            outputs_json = ?,
                            requested_variants = ?,
                            variants_complete = ?,
                            variant_warning = ?,
                            duration_ms = ?,
                            error_code = NULL,
                            error_message = NULL,
                            finished_at = ?,
                            updated_ts = ?
                        WHERE task_id = ? AND status = 'processing' AND worker_id = ?
                        """,
                        (
                            json.dumps(outputs, ensure_ascii=False),
                            requested_variants,
                            1 if variants_complete else 0,
                            variant_warning,
                            duration_ms,
                            _now_iso(),
                            _now_ts(),
                            task_id,
                            worker.worker_id,
                        ),
                    )
                    if cur.rowcount == 1:
                        conn.commit()
                        ack_payload = {
                            "type": "task.ack",
                            "task_id": task_id,
                            "accepted": True,
                            "status": "succeeded",
                        }
                    else:
                        row = conn.execute(
                            "SELECT status, worker_id FROM expand_tasks WHERE task_id = ?",
                            (task_id,),
                        ).fetchone()
                        if not row:
                            ack_payload = {
                                "type": "task.ack",
                                "task_id": task_id,
                                "accepted": False,
                                "status": "not_found",
                                "reason": "task_not_found",
                            }
                        elif row["status"] == "succeeded" and row["worker_id"] == worker.worker_id:
                            ack_payload = {
                                "type": "task.ack",
                                "task_id": task_id,
                                "accepted": True,
                                "idempotent": True,
                                "status": "succeeded",
                            }
                        else:
                            ack_payload = {
                                "type": "task.ack",
                                "task_id": task_id,
                                "accepted": False,
                                "status": str(row["status"]),
                                "reason": "task_not_processing_or_owner_mismatch",
                            }
            if worker.current_task_id == task_id:
                worker.busy = False
                worker.current_task_id = None
            try:
                await worker.websocket.send_json(ack_payload)
            except Exception:
                pass
            await self.dispatch_next()
            return

        if msg_type == "task.error":
            task_id = str(data.get("task_id") or "")
            error_code = str(data.get("error_code") or "PS_EXEC_FAILED")
            error_message = str(data.get("error_message") or "Photoshop 执行失败。")
            next_status = "timeout" if error_code == "PS_EXEC_TIMEOUT" else "failed"
            should_quarantine = (error_code == "PS_EXEC_TIMEOUT") or bool(data.get("quarantined", False))
            err_ack_payload: dict[str, Any] = {
                "type": "task.ack",
                "task_id": task_id,
                "accepted": False,
                "status": "not_found",
                "reason": "task_id_missing",
            }
            if task_id:
                with _get_conn() as conn:
                    cur = conn.execute(
                        """
                        UPDATE expand_tasks
                        SET status = ?,
                            stage = '',
                            error_code = ?,
                            error_message = ?,
                            finished_at = ?,
                            updated_ts = ?
                        WHERE task_id = ? AND status = 'processing' AND worker_id = ?
                        """,
                        (next_status, error_code, error_message, _now_iso(), _now_ts(), task_id, worker.worker_id),
                    )
                    if cur.rowcount == 1:
                        conn.commit()
                        err_ack_payload = {
                            "type": "task.ack",
                            "task_id": task_id,
                            "accepted": True,
                            "status": next_status,
                        }
                    else:
                        row = conn.execute(
                            "SELECT status, worker_id FROM expand_tasks WHERE task_id = ?",
                            (task_id,),
                        ).fetchone()
                        if not row:
                            err_ack_payload = {
                                "type": "task.ack",
                                "task_id": task_id,
                                "accepted": False,
                                "status": "not_found",
                                "reason": "task_not_found",
                            }
                        elif row["status"] == next_status and row["worker_id"] == worker.worker_id:
                            err_ack_payload = {
                                "type": "task.ack",
                                "task_id": task_id,
                                "accepted": True,
                                "idempotent": True,
                                "status": next_status,
                            }
                        else:
                            err_ack_payload = {
                                "type": "task.ack",
                                "task_id": task_id,
                                "accepted": False,
                                "status": str(row["status"]),
                                "reason": "task_not_processing_or_owner_mismatch",
                            }
            try:
                await worker.websocket.send_json(err_ack_payload)
            except Exception:
                pass
            if should_quarantine:
                # 软超时不代表 Photoshop 原生动作已退出：隔离 Worker，禁止继续派单，等待原生完成或 Watchdog 重启恢复
                worker.quarantined = True
                worker.busy = True
                logger.warning(
                    "[ps_expand] worker %s quarantined after %s on task %s; pausing dispatch until recovery",
                    worker.worker_id,
                    error_code,
                    task_id,
                )
                return
            if worker.current_task_id == task_id:
                worker.busy = False
                worker.current_task_id = None
            await self.dispatch_next()
            return

    async def _sweeper_loop(self) -> None:
        while True:
            try:
                await asyncio.sleep(_SWEEPER_INTERVAL_SEC)
                await self.sweep_once()
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.warning("[ps_expand] sweeper error: %s", exc)

    async def sweep_once(self) -> None:
        now = _now_ts()
        timeout_limit = max(30, int(settings.ps_expand_task_timeout_seconds or 90)) + _PROCESSING_GRACE_SEC

        # 1. 踢掉心跳超时的僵尸 Worker
        stale_workers: list[ConnectedWorker] = []
        async with self._lock:
            for wid, w in list(self._workers.items()):
                if not self._is_worker_alive(w):
                    stale_workers.append(w)
                    del self._workers[wid]
        for w in stale_workers:
            logger.warning("[ps_expand] worker heartbeat timeout, dropping: %s", w.worker_id)
            if w.current_task_id:
                self._mark_task_timeout(w.current_task_id, "订阅机心跳超时，任务已自动终止，请重试。")
            try:
                await w.websocket.close(code=4002, reason="Heartbeat timeout")
            except Exception:
                pass

        # 2. 扫描执行超时或断线超过宽限期的孤儿 processing 任务
        timed_out_ids: list[str] = []
        async with self._lock:
            connected_ids = set(self._workers.keys())
            disconnected_snapshot = dict(self._disconnected_at)
        with _get_conn() as conn:
            rows = conn.execute(
                "SELECT task_id, worker_id, started_at FROM expand_tasks WHERE status = 'processing'"
            ).fetchall()
            for r in rows:
                started = float(r["started_at"] or 0.0)
                wid = str(r["worker_id"] or "")
                if started and (now - started) > timeout_limit:
                    timed_out_ids.append(r["task_id"])
                elif wid and wid not in connected_ids:
                    disc_ts = disconnected_snapshot.get(wid, started)
                    if disc_ts and (now - disc_ts) > _DISCONNECT_GRACE_SEC:
                        timed_out_ids.append(r["task_id"])

        for tid in timed_out_ids:
            logger.warning("[ps_expand] task %s exceeded processing timeout, marking timeout and quarantining worker", tid)
            self._mark_task_timeout(tid, "任务执行超时，订阅机正在恢复，请稍后重试。")
            async with self._lock:
                for w in self._workers.values():
                    if w.current_task_id == tid:
                        w.quarantined = True
                        w.busy = True

        if timed_out_ids:
            await self.dispatch_next()

        # 3. 清理过期临时目录
        retention_sec = max(1, int(settings.ps_expand_file_retention_hours or 24)) * 3600
        root = _expand_storage_root()
        for entry in root.iterdir():
            if not entry.is_dir():
                continue
            try:
                age = now - entry.stat().st_mtime
                if age > retention_sec:
                    shutil.rmtree(entry, ignore_errors=True)
            except Exception:
                pass


coordinator = ExpandCoordinator()


# ─── 鉴权辅助 ────────────────────────────────────────────


def _verify_client_auth(authorization: Optional[str]) -> None:
    expected = settings.ps_expand_client_token
    if not expected:
        raise HTTPException(
            status_code=503,
            detail={
                "error_code": "PS_EXPAND_DISABLED",
                "error_message": "PS 扩图服务未配置 PS_EXPAND_CLIENT_TOKEN，默认已禁用。",
            },
        )
    token = ""
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    if not token or not secrets.compare_digest(token, expected):
        raise HTTPException(
            status_code=401,
            detail={"error_code": "UNAUTHORIZED", "error_message": "无效的客户端访问令牌。"},
        )


def _verify_worker_secret(token: Optional[str]) -> None:
    expected = settings.ps_expand_worker_secret
    if not expected:
        raise HTTPException(
            status_code=503,
            detail={
                "error_code": "PS_EXPAND_DISABLED",
                "error_message": "未配置 PS_EXPAND_WORKER_SECRET，Worker 接入默认已禁用。",
            },
        )
    if not token or not secrets.compare_digest(token.strip(), expected):
        raise HTTPException(
            status_code=401,
            detail={"error_code": "UNAUTHORIZED", "error_message": "无效的 Worker Secret。"},
        )


def _queue_position_for_task(conn: sqlite3.Connection, task_id: str) -> int:
    row = conn.execute(
        "SELECT rowid, updated_ts, status FROM expand_tasks WHERE task_id = ?",
        (task_id,),
    ).fetchone()
    if not row or row["status"] != "queued":
        return 0
    cnt = conn.execute(
        """
        SELECT COUNT(*) AS cnt FROM expand_tasks
        WHERE status = 'queued'
          AND (updated_ts < ? OR (updated_ts = ? AND rowid <= ?))
        """,
        (row["updated_ts"], row["updated_ts"], row["rowid"]),
    ).fetchone()
    # 如果有任务正在 processing，排队位次为前面 queued 数 + 1（即 1 表示下一个轮到）
    return int(cnt["cnt"]) if cnt else 1


def _row_to_task_response(conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    outputs = []
    try:
        outputs = json.loads(row["outputs_json"] or "[]")
    except Exception:
        outputs = []
    requested_variants = int(row["requested_variants"] or 3)
    variants_complete = bool(row["variants_complete"]) if row["variants_complete"] is not None else True
    variant_warning = str(row["variant_warning"] or "")
    return {
        "task_id": row["task_id"],
        "status": row["status"],
        "stage": row["stage"] or "",
        "queue_position": _queue_position_for_task(conn, row["task_id"]) if row["status"] == "queued" else 0,
        "outputs": outputs,
        "requested_variants": requested_variants,
        "variants_complete": variants_complete,
        "variant_warning": variant_warning,
        "duration_ms": row["duration_ms"],
        "error_code": row["error_code"],
        "error_message": row["error_message"],
        "created_at": row["created_at"],
        "finished_at": row["finished_at"],
    }


# ─── HTTP API 路由 ───────────────────────────────────────


@router.get("/worker/status")
async def get_expand_worker_status(authorization: Optional[str] = Header(default=None)):
    _verify_client_auth(authorization)
    return coordinator.get_worker_status()


@router.post("/tasks", status_code=202)
async def create_expand_task(
    image: UploadFile = File(...),
    spec: str = Form(...),
    authorization: Optional[str] = Header(default=None),
):
    _verify_client_auth(authorization)

    try:
        raw_spec = json.loads(spec)
        if not isinstance(raw_spec, dict):
            raise ValueError("spec must be a JSON object")
    except Exception:
        raise HTTPException(
            status_code=400,
            detail={"error_code": "INVALID_EXPAND_SPEC", "error_message": "spec 参数不是合法的 JSON 对象。"},
        )

    raw_bytes = await image.read()
    max_bytes = max(1024 * 1024, int(settings.ps_expand_max_upload_bytes or (20 * 1024 * 1024)))
    if not raw_bytes:
        raise HTTPException(
            status_code=400,
            detail={"error_code": "INVALID_EXPAND_SPEC", "error_message": "上传的原图为空。"},
        )
    if len(raw_bytes) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail={"error_code": "INVALID_EXPAND_SPEC", "error_message": f"原图大小超过 {max_bytes // (1024 * 1024)}MB 限制。"},
        )

    try:
        with Image.open(BytesIO(raw_bytes)) as img:
            orig_w, orig_h = img.size
            img_format = (img.format or "PNG").upper()
    except (UnidentifiedImageError, OSError):
        raise HTTPException(
            status_code=400,
            detail={"error_code": "INVALID_EXPAND_SPEC", "error_message": "无法解析上传的图片格式。"},
        )

    normalized_spec = normalize_expand_spec(raw_spec, orig_w, orig_h)
    client_id = str(raw_spec.get("client_id") or "").strip()[:128]
    client_request_id = str(raw_spec.get("client_request_id") or "").strip()[:128]

    task_id = f"exp_{uuid.uuid4().hex[:18]}"
    ext = ".jpg" if img_format == "JPEG" else ".png"
    input_filename = f"input{ext}"

    now_iso = _now_iso()
    now_ts = _now_ts()
    max_queue = max(1, int(settings.ps_expand_max_queue_size or 20))

    with _get_conn() as conn:
        conn.execute("BEGIN IMMEDIATE")

        # 同一设计师最多 1 条在排/在跑任务，防止手抖连点占满队列
        if client_id:
            existing = conn.execute(
                """
                SELECT task_id, status FROM expand_tasks
                WHERE client_id = ? AND status IN ('queued', 'processing')
                LIMIT 1
                """,
                (client_id,),
            ).fetchone()
            if existing:
                conn.rollback()
                return JSONResponse(
                    status_code=409,
                    content={
                        "error_code": "CLIENT_TASK_ACTIVE",
                        "error_message": "你当前已有扩图任务正在排队或执行中，请等待完成或先取消排队。",
                        "active_task_id": existing["task_id"],
                    },
                )

        q_row = conn.execute("SELECT COUNT(*) AS cnt FROM expand_tasks WHERE status = 'queued'").fetchone()
        if q_row and int(q_row["cnt"]) >= max_queue:
            conn.rollback()
            return JSONResponse(
                status_code=429,
                content={
                    "error_code": "QUEUE_FULL",
                    "error_message": f"当前排队任务已达上限（{max_queue}），请稍后再试。",
                },
            )

        tdir = _task_dir(task_id)
        (tdir / input_filename).write_bytes(raw_bytes)

        requested_variants = 3 if normalized_spec.get("return_all_variants", True) else 1
        conn.execute(
            """
            INSERT INTO expand_tasks (
                task_id, status, stage, client_id, client_request_id,
                input_filename, spec_json, requested_variants, created_at, updated_ts
            ) VALUES (?, 'queued', '', ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                task_id,
                client_id,
                client_request_id,
                input_filename,
                json.dumps(normalized_spec, ensure_ascii=False),
                requested_variants,
                now_iso,
                now_ts,
            ),
        )
        queue_pos = _queue_position_for_task(conn, task_id)
        conn.commit()

    # 若当前有空闲 Worker，立刻派单
    dispatched = await coordinator.dispatch_next()
    return {
        "task_id": task_id,
        "status": "processing" if dispatched else "queued",
        "queue_position": 0 if dispatched else queue_pos,
        "created_at": now_iso,
    }


@router.get("/tasks/{task_id}")
async def get_expand_task(task_id: str, authorization: Optional[str] = Header(default=None)):
    _verify_client_auth(authorization)
    if not _SAFE_SEGMENT_RE.match(task_id):
        raise HTTPException(status_code=400, detail="Invalid task_id")
    with _get_conn() as conn:
        row = conn.execute("SELECT * FROM expand_tasks WHERE task_id = ?", (task_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Task not found")
        return _row_to_task_response(conn, row)


@router.post("/tasks/{task_id}/cancel")
async def cancel_expand_task(task_id: str, authorization: Optional[str] = Header(default=None)):
    _verify_client_auth(authorization)
    if not _SAFE_SEGMENT_RE.match(task_id):
        raise HTTPException(status_code=400, detail="Invalid task_id")
    with _get_conn() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT status FROM expand_tasks WHERE task_id = ?", (task_id,)).fetchone()
        if not row:
            conn.rollback()
            raise HTTPException(status_code=404, detail="Task not found")
        if row["status"] != "queued":
            conn.rollback()
            return JSONResponse(
                status_code=409,
                content={
                    "error_code": "CANNOT_CANCEL",
                    "error_message": f"任务当前状态为 {row['status']}，仅排队中的任务可取消。",
                },
            )
        conn.execute(
            """
            UPDATE expand_tasks
            SET status = 'cancelled', stage = '', finished_at = ?, updated_ts = ?
            WHERE task_id = ? AND status = 'queued'
            """,
            (_now_iso(), _now_ts(), task_id),
        )
        conn.commit()
    return {"task_id": task_id, "status": "cancelled"}


@router.get("/files/{task_id}/{filename}")
async def get_expand_output_file(
    task_id: str,
    filename: str,
    authorization: Optional[str] = Header(default=None),
):
    _verify_client_auth(authorization)
    if not _SAFE_SEGMENT_RE.match(task_id) or not _SAFE_SEGMENT_RE.match(filename):
        raise HTTPException(status_code=400, detail="Invalid file path")
    if filename.startswith("input."):
        raise HTTPException(status_code=403, detail="Input files are internal only")
    target = (_expand_storage_root() / task_id / filename).resolve()
    if not target.is_file() or _expand_storage_root().resolve() not in target.parents:
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path=str(target))


# ─── Worker 内部文件接口与反向 WebSocket ─────────────────


@router.get("/internal/input/{task_id}/{filename}")
async def get_expand_input_file_for_worker(
    task_id: str,
    filename: str,
    x_worker_token: Optional[str] = Header(default=None, alias="X-Worker-Token"),
    token: Optional[str] = Query(default=None),
):
    _verify_worker_secret(x_worker_token or token)
    if not _SAFE_SEGMENT_RE.match(task_id) or not _SAFE_SEGMENT_RE.match(filename):
        raise HTTPException(status_code=400, detail="Invalid path")
    target = (_expand_storage_root() / task_id / filename).resolve()
    if not target.is_file() or _expand_storage_root().resolve() not in target.parents:
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path=str(target))


@router.post("/internal/upload")
async def upload_expand_variant_from_worker(
    task_id: str = Form(...),
    variant_index: int = Form(0),
    artifact_type: str = Form("preview"),
    file: UploadFile = File(...),
    x_worker_token: Optional[str] = Header(default=None, alias="X-Worker-Token"),
    token: Optional[str] = Query(default=None),
):
    _verify_worker_secret(x_worker_token or token)
    if not _SAFE_SEGMENT_RE.match(task_id):
        raise HTTPException(status_code=400, detail="Invalid task_id")

    kind = str(artifact_type or "preview").strip().lower()
    if kind not in ("preview", "psd"):
        raise HTTPException(status_code=400, detail="Invalid artifact_type")

    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Empty upload")

    tdir = _task_dir(task_id)

    if kind == "psd":
        # 校验 Adobe Photoshop PSD/PSB 文件头（8BPS + version 1 或 2）
        if len(raw_bytes) < 26 or raw_bytes[:4] != b"8BPS":
            raise HTTPException(status_code=400, detail="Invalid PSD upload (missing 8BPS header)")
        if len(raw_bytes) > 200 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="PSD upload exceeds 200MB limit")
        filename = f"v{int(variant_index)}.psd"
        out_path = tdir / filename
        out_path.write_bytes(raw_bytes)
        return {
            "variant_index": int(variant_index),
            "artifact_type": "psd",
            "url": f"/api/v1/expand/files/{task_id}/{filename}",
            "size_bytes": len(raw_bytes),
        }

    try:
        with Image.open(BytesIO(raw_bytes)) as img:
            w, h = img.size
            fmt = (img.format or "JPEG").upper()
    except (UnidentifiedImageError, OSError):
        raise HTTPException(status_code=400, detail="Invalid image upload")

    ext = ".png" if fmt == "PNG" else ".jpg"
    filename = f"v{int(variant_index)}{ext}"
    out_path = tdir / filename
    out_path.write_bytes(raw_bytes)

    return {
        "variant_index": int(variant_index),
        "artifact_type": "preview",
        "url": f"/api/v1/expand/files/{task_id}/{filename}",
        "width": w,
        "height": h,
        "size_bytes": len(raw_bytes),
    }


@router.websocket("/worker")
async def expand_worker_websocket(
    websocket: WebSocket,
    worker_id: str = Query(default="win-ps-01"),
    token: str = Query(default=""),
):
    expected = settings.ps_expand_worker_secret
    if not expected:
        await websocket.close(code=4403, reason="PS_EXPAND_WORKER_SECRET not configured")
        return
    if not token or not secrets.compare_digest(token.strip(), expected):
        await websocket.close(code=4401, reason="Unauthorized")
        return

    safe_worker_id = re.sub(r"[^A-Za-z0-9._-]", "_", worker_id.strip())[:64] or "win-ps-01"
    await websocket.accept()
    worker = await coordinator.register_worker(safe_worker_id, websocket)
    logger.info("[ps_expand] worker connected: %s", safe_worker_id)

    try:
        while True:
            text = await websocket.receive_text()
            try:
                payload = json.loads(text)
            except Exception:
                continue
            if isinstance(payload, dict):
                await coordinator.handle_worker_message(worker, payload)
    except WebSocketDisconnect:
        logger.info("[ps_expand] worker disconnected: %s", safe_worker_id)
    except Exception as exc:
        logger.warning("[ps_expand] worker ws error (%s): %s", safe_worker_id, exc)
    finally:
        await coordinator.unregister_worker(safe_worker_id, websocket)

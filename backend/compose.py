"""
合成引擎

接受 ComposeRequest，驱动 penpot 完成：
1. 读取模板图层结构
2. 上传产品图片
3. 写入文字和图片到对应 slot
4. 导出 PNG
"""
from __future__ import annotations

import os
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Optional

from .config import settings
from .models import ComposeJob, ComposeRequest, ComposeStatus
from .penpot_client import PenpotClient, PenpotError


# ─── 全局客户端（懒初始化） + 串行锁 ─────────────────────────────────────────

_client: Optional[PenpotClient] = None
# penpot exporter 是单进程渲染器，并发写会产生竞争，用信号量强制串行
_compose_sem = threading.Semaphore(1)


def get_client() -> PenpotClient:
    global _client
    if _client is None:
        _client = PenpotClient(
            base_url=settings.penpot_base_url,
            access_token=settings.penpot_access_token,
        )
        _client.login(settings.penpot_email, settings.penpot_password)
    return _client


# ─── 合成主函数 ───────────────────────────────────────────────────────────────


def run_compose(job: ComposeJob) -> None:
    """
    同步执行合成任务，就地更新 job.status / job.result_path / job.error。
    在后台线程中调用（FastAPI BackgroundTasks）。
    使用信号量确保同一时间只有一个任务写入 penpot，避免版本号冲突。
    """
    # 排队等待，防止并发写 penpot
    _log(job, "等待合成队列…")
    with _compose_sem:
        _run_compose_inner(job)


def _run_compose_inner(job: ComposeJob) -> None:
    """实际执行体，在信号量保护内运行"""
    job.status = ComposeStatus.running
    client = get_client()
    req = job.request

    try:
        # ── Step 1: 复制模板，得到本次合成的独立副本 ─────────────────────────
        import datetime
        ts = datetime.datetime.now().strftime("%Y%m%d-%H%M")
        copy_name = f"合成-{ts}-{job.id[:8]}"
        _log(job, f"复制模板文件 → {copy_name}")
        dup = client.duplicate_file(req.file_id, copy_name)
        work_file_id = dup.get("id") or dup.get("~:id") or req.file_id

        # 拼接 penpot 编辑链接，team-id 按优先级逐步尝试
        project_id = dup.get("projectId") or dup.get("project-id", "")
        team_id = dup.get("teamId") or dup.get("team-id", "")
        if not team_id:
            try:
                # 方法1：从副本文件数据直接取
                dup_file_data = client.get_file(work_file_id)
                team_id = dup_file_data.get("teamId") or dup_file_data.get("team-id", "")
            except Exception:
                pass
        if not team_id and project_id:
            try:
                # 方法2：通过 project 查 team
                proj = client._rpc("get-project", {"id": project_id})
                team_id = proj.get("teamId") or proj.get("team-id", "")
            except Exception:
                pass
        if not team_id:
            try:
                # 方法3：从原模板文件取 team-id（副本和原模板同属一个 project/team）
                orig_data = client.get_file(req.file_id)
                orig_proj_id = orig_data.get("projectId") or orig_data.get("project-id", "")
                if orig_proj_id:
                    proj = client._rpc("get-project", {"id": orig_proj_id})
                    team_id = proj.get("teamId") or proj.get("team-id", "")
            except Exception:
                pass
        edit_url = (
            f"{settings.penpot_base_url}/#/workspace"
            f"?team-id={team_id}&file-id={work_file_id}&page-id={req.page_id}"
        )
        job.penpot_file_id = work_file_id
        job.penpot_edit_url = edit_url
        _log(job, f"副本就绪: {work_file_id[:8]}…  编辑链接已记录")

        # ── Step 2: 读取副本的图层结构 ────────────────────────────────────────
        _log(job, "读取模板图层结构...")
        file_data = client.get_file(work_file_id)
        slots = client.parse_slots(file_data)

        # 按名称建索引，方便查找
        slot_index: dict[str, dict] = {s["name"]: s for s in slots}

        # 找目标 frame（在副本里 frame id 与原模板相同）
        frames = client.parse_frames(file_data)
        frame = next(
            (f for f in frames if f["id"] == req.template_frame_id), None
        )
        if not frame:
            raise PenpotError(f"未找到 frame: {req.template_frame_id}")

        frame_x = frame["x"]
        frame_w = frame["width"]

        changes: list[dict] = []

        # ── Step 3: 遍历每个产品 slot ─────────────────────────────────────────
        for product_key, product in req.slots.items():

            # --- 图片 slot ---
            image_slot_name = f"slot/{product_key}/image"
            image_slot = slot_index.get(image_slot_name)

            if image_slot and product.image_path:
                _log(job, f"上传图片: {product.image_path} → {image_slot_name}")
                media = client.upload_image(work_file_id, product.image_path)
                changes.append(
                    client.set_image_fill(
                        layer_id=image_slot["id"],
                        page_id=image_slot["page_id"],
                        media=media,
                        keep_aspect_ratio=False,
                    )
                )
            elif image_slot and not product.image_path:
                changes.append(client.hide_layer(image_slot["id"], image_slot["page_id"]))

            # --- 文字 slot helper ---
            def write_text_slot(field: str, text: Optional[str]) -> None:
                slot_name = f"slot/{product_key}/{field}"
                slot = slot_index.get(slot_name)
                if slot is None:
                    return
                if text:
                    ts = slot.get("text_style", {})
                    _log(job, f"写入文字: 「{text}」→ {slot_name}")
                    changes.extend(
                        client.set_text_content(
                            layer_id=slot["id"],
                            page_id=slot["page_id"],
                            text=text,
                            frame_x=frame_x,
                            frame_w=frame_w,
                            layer_x=slot["x"],
                            layer_y=slot["y"],
                            layer_w=slot["width"],
                            font_size=ts.get("font_size", 14.0),
                            font_weight=ts.get("font_weight", "400"),
                            font_family=ts.get("font_family", "sourcesanspro"),
                            fill_color=ts.get("fill_color", "#000000"),
                            text_align=ts.get("text_align", "center"),
                            raw_content=slot.get("raw_content"),  # 传入原始结构，保留对齐/样式
                        )
                    )
                else:
                    _log(job, f"隐藏空图层: {slot_name}")
                    changes.append(client.hide_layer(slot["id"], slot["page_id"]))

            write_text_slot("name", product.name)
            write_text_slot("price", product.price)
            write_text_slot("tag", product.tag)
            write_text_slot("spec", product.spec)

        # ── Step 4: 提交变更到副本 ────────────────────────────────────────────
        if changes:
            _log(job, f"提交 {len(changes)} 个变更到副本...")
            client.update_file(work_file_id, changes)
        else:
            _log(job, "无变更，直接导出")

        # ── Step 5: 从副本导出 PNG ────────────────────────────────────────────
        _log(job, "导出 PNG（等待 exporter 渲染，约 5-15 秒）...")
        png_bytes = client.export_frame(
            file_id=work_file_id,
            page_id=req.page_id,
            frame_id=req.template_frame_id,
            scale=req.export_scale,
            name=frame.get("name", "export"),
        )

        # ── Step 6: 保存结果 ──────────────────────────────────────────────────
        out_path = settings.output_path / f"{job.id}.png"
        out_path.write_bytes(png_bytes)

        job.result_path = str(out_path)
        job.status = ComposeStatus.done
        _log(job, f"完成！输出: {out_path} ({len(png_bytes)//1024} KB)")
        _log(job, f"Penpot 编辑链接: {edit_url}")

    except Exception as exc:
        job.status = ComposeStatus.failed
        job.error = str(exc)
        _log(job, f"失败: {exc}")


def _log(job: ComposeJob, msg: str) -> None:
    job.progress.append(msg)

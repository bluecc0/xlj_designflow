"""
特殊品（完整）合成引擎

在 special_compose.py 基础上新增：
1. 支持 banner / poster 场景图 slot（横/竖版，通过 IMAGE_TYPE_FOLDERS 配置）
   slot/product_1/banner  → Banner/ 文件夹
   slot/product_1/poster  → Poster/ 文件夹
2. 导出前自动隐藏模板中名称为 "hide"（大小写不敏感）的所有图层
   设计师可在 Penpot 中保持辅助层可见，导出时自动屏蔽

其余逻辑（时间展开、文案分段、变体导出）与 special_compose.py 完全相同。
入口：POST /special-compose-full，独立端点。
"""
from __future__ import annotations

import datetime
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Optional

from .config import settings
from .models import ComposeStatus, SpecialFullComposeJob, SpecialFullComposeRequest
from .penpot_client import PenpotClient, PenpotError
from .penpot_browser_refresh import refresh_penpot_workspace
from .product_library import ProductLibrary
from .job_store import save_special_job

# 复用主流程的客户端单例和串行信号量
from .compose import get_client, _compose_sem

# 复用 special_compose 中的纯函数（无状态，可安全复用）
from .special_compose import (
    _split_on_last_space,
    expand_time_fields,
)


# ─── 图层查找工具 ─────────────────────────────────────────────────────────────

def _find_hide_layer_ids(file_data: dict, page_id: str) -> list[tuple[str, str]]:
    """找出指定 page 内所有名称为 'hide' 的对象，返回 [(object_id, page_id)]。"""
    data = file_data.get("data", {})
    pages_index = data.get("pagesIndex") or data.get("pages-index", {})
    result = []
    for pid, page in pages_index.items():
        if page_id and pid != page_id:
            continue
        objects = page.get("objects", {})
        for obj_id, obj in objects.items():
            name = obj.get("name") or obj.get("~:name") or ""
            if name.strip().lower() == "hide":
                result.append((obj_id, pid))
    return result


def _find_variant_group_ids(file_data: dict, page_id: str) -> dict[str, list[tuple[str, str]]]:
    """
    在指定 page 内查找名称匹配 'variant_*' 的顶层组/图层。
    返回 {group_name: [(object_id, page_id), ...]}，用于整组显隐切换。
    """
    data = file_data.get("data", {})
    pages_index = data.get("pagesIndex") or data.get("pages-index", {})
    result: dict[str, list[tuple[str, str]]] = {}
    for pid, page in pages_index.items():
        if page_id and pid != page_id:
            continue
        objects = page.get("objects", {})
        for obj_id, obj in objects.items():
            name = (obj.get("name") or obj.get("~:name") or "").strip().lower()
            if name.startswith("variant_") or name.startswith("variant "):
                # 归一化：去空格、转小写
                key = name.replace(" ", "_")
                result.setdefault(key, []).append((obj_id, pid))
    return result


# ─── 合成主函数 ───────────────────────────────────────────────────────────────

def run_special_full_compose(job: SpecialFullComposeJob) -> None:
    """
    同步执行特殊品（完整）合成任务，就地更新 job 状态。
    在后台线程中调用。复用主流程的信号量确保串行。
    """
    _log(job, "等待合成队列（特殊品完整）…")
    with _compose_sem:
        _run_inner(job)


def _run_inner(job: SpecialFullComposeJob) -> None:
    job.status = ComposeStatus.running
    save_special_job(job)
    client = get_client()
    req = job.request
    library = ProductLibrary(settings.product_library_path)

    try:
        # ── Step 0: 展开字段 ──────────────────────────────────────────────────
        raw_time = req.fields.get("time", "")
        time_expanded = expand_time_fields(raw_time)
        merged_fields: dict[str, str] = dict(req.fields)
        merged_fields.setdefault("time", time_expanded["time"])
        merged_fields["time_month"] = time_expanded["time_month"]
        merged_fields["time_hour"] = time_expanded["time_hour"]
        merged_fields["time_c"] = time_expanded["time_c"]
        if raw_time and time_expanded["time"] != raw_time:
            merged_fields["time"] = time_expanded["time"]
            merged_fields.setdefault("time_raw", raw_time)
        raw_name = merged_fields.get("name", "")
        if raw_name:
            n1, n2 = _split_on_last_space(raw_name)
            merged_fields.setdefault("name_1", n1)
            merged_fields.setdefault("name_2", n2)

        # ── Step 1: 复制模板文件 ──────────────────────────────────────────────
        copy_name = f"{req.sku}_特殊品" if req.sku else f"特殊品-{job.id[:8]}"
        _log(job, f"复制模板文件 → {copy_name}")
        dup = client.duplicate_file(req.file_id, copy_name)
        work_file_id = dup.get("id") or dup.get("~:id") or req.file_id

        project_id = dup.get("projectId") or dup.get("project-id", "")
        team_id = dup.get("teamId") or dup.get("team-id", "")
        if not team_id and project_id:
            try:
                proj = client._rpc("get-project", {"id": project_id})
                team_id = proj.get("teamId") or proj.get("team-id", "")
            except Exception:
                pass
        edit_url = (
            f"{settings.penpot_base_url}/#/workspace"
            f"?team-id={team_id}&file-id={work_file_id}&page-id={req.page_id}"
        )
        job.penpot_file_id = work_file_id
        job.penpot_edit_url = edit_url
        _log(job, f"副本就绪: {work_file_id[:8]}…")

        # ── Step 2: 读取副本图层结构 ──────────────────────────────────────────
        _log(job, "读取模板图层结构…")
        file_data = client.get_file(work_file_id)
        slots = client.parse_slots(file_data)
        frames = client.parse_frames(file_data)

        frame_index = {f["id"]: f for f in frames}
        slot_by_frame: dict[str, list[dict]] = {}
        for s in slots:
            slot_by_frame.setdefault(s.get("frame_id", ""), []).append(s)

        # ── Step 3: 构建 slot 变更 ────────────────────────────────────────────
        all_changes: list[dict] = []
        # variant_versions: {ver_key: [(id, pid)]}
        # ver_key 为 "group_part/field_part"，如 "variant_a/1", "variant_a/2"
        variant_versions: dict[str, list[tuple[str, str]]] = {}
        # variant_by_group: 带内容填充的 variant slot（field_part 为文字/图片字段名）
        variant_by_group: dict[str, dict[str, list[tuple[str, str]]]] = {}
        variant_frame_ids: set[str] = set()

        _log(job, f"全部 slots ({len(slots)} 个): {[s['name'] for s in slots]}")

        for frame_id in req.frame_ids:
            frame = frame_index.get(frame_id)
            if not frame:
                _log(job, f"警告：未找到 frame {frame_id}，跳过")
                continue

            frame_x = frame["x"]
            frame_w = frame["width"]
            frame_slots = slot_by_frame.get(frame_id, [])
            _log(job, f"处理画板: {frame['name']}（{len(frame_slots)} 个 slot）")

            for slot in frame_slots:
                slot_name: str = slot["name"]
                parts = slot_name.split("/")
                if len(parts) < 2:
                    continue

                group_part = parts[1]
                field_part = parts[2] if len(parts) >= 3 else ""

                is_variant = group_part.startswith("variant")

                if is_variant:
                    if not field_part:
                        # 空 field_part：仅作占位，跳过
                        continue
                    elif field_part.isdigit():
                        # slot/variant_a/1、slot/variant_a/2 → 版本标记图层，只做显隐
                        ver_key = f"{group_part}/{field_part}"
                        variant_versions.setdefault(ver_key, []).append((slot["id"], slot["page_id"]))
                        variant_frame_ids.add(frame_id)
                        continue  # 不填内容
                    else:
                        # slot/variant_a/name → 带内容的 variant slot，记录并填充
                        (
                            variant_by_group
                            .setdefault(group_part, {})
                            .setdefault(field_part, [])
                            .append((slot["id"], slot["page_id"]))
                        )
                        variant_frame_ids.add(frame_id)
                        # 不 continue — 继续往下填充内容
                elif not field_part:
                    continue

                # ── 图片 slot（含 banner / poster）───────────────────────────
                if field_part == "image" or field_part.startswith("image_") \
                        or field_part in ("banner", "poster"):
                    image_type_key: Optional[str] = slot.get("image_type")
                    folder: Optional[str] = None
                    if image_type_key:
                        folder = settings.IMAGE_TYPE_FOLDERS.get(image_type_key)
                        if not folder:
                            for k, v in settings.IMAGE_TYPE_FOLDERS.items():
                                if k.lower() == image_type_key.lower():
                                    folder = v
                                    break

                    img_path: Optional[str] = None
                    if folder:
                        img_path = library.find_in_folder(req.sku, folder)
                    if img_path is None:
                        img_path = library.find(req.sku)

                    if img_path:
                        _log(job, f"上传图片({image_type_key or '默认'}): {img_path} → {slot_name}")
                        media = client.upload_image(work_file_id, img_path)
                        all_changes.append(
                            client.set_image_fill(
                                layer_id=slot["id"],
                                page_id=slot["page_id"],
                                media=media,
                                keep_aspect_ratio=False,
                            )
                        )
                    else:
                        _log(job, f"未找到图片 SKU={req.sku} type={image_type_key}，隐藏图层")
                        all_changes.append(client.hide_layer(slot["id"], slot["page_id"]))

                # ── 分段文字 slot（name_1 / name_2）──────────────────────────
                elif "split_field" in slot:
                    base_field = slot["split_field"]
                    split_idx = slot["split_index"]
                    direct_key = f"{base_field}_{split_idx}"
                    if direct_key in merged_fields:
                        text_to_write = merged_fields[direct_key]
                    else:
                        raw_text = merged_fields.get(base_field, "")
                        first_part, second_part = _split_on_last_space(raw_text)
                        text_to_write = first_part if split_idx == 1 else second_part

                    ts_style = slot.get("text_style", {})
                    if text_to_write:
                        _log(job, f"写入分段文字[{split_idx}]: 「{text_to_write}」→ {slot_name}")
                        all_changes.extend(
                            client.set_text_content(
                                layer_id=slot["id"],
                                page_id=slot["page_id"],
                                text=text_to_write,
                                frame_x=frame_x,
                                frame_w=frame_w,
                                layer_x=slot["x"],
                                layer_y=slot["y"],
                                layer_w=slot["width"],
                                font_size=ts_style.get("font_size", 14.0),
                                font_weight=ts_style.get("font_weight", "400"),
                                font_family=ts_style.get("font_family", "sourcesanspro"),
                                fill_color=ts_style.get("fill_color", "#000000"),
                                text_align=ts_style.get("text_align", "center"),
                                raw_content=slot.get("raw_content"),
                                grow_type=slot.get("grow_type", "auto-height"),
                                vertical_align=slot.get("vertical_align", "top"),
                            )
                        )
                    else:
                        _log(job, f"隐藏空分段图层: {slot_name}")
                        all_changes.append(client.hide_layer(slot["id"], slot["page_id"]))

                # ── 普通文字 slot ─────────────────────────────────────────────
                elif slot.get("type") == "text":
                    text_to_write = merged_fields.get(field_part, "")
                    ts_style = slot.get("text_style", {})
                    if text_to_write:
                        _log(job, f"写入文字: 「{text_to_write}」→ {slot_name}")
                        all_changes.extend(
                            client.set_text_content(
                                layer_id=slot["id"],
                                page_id=slot["page_id"],
                                text=text_to_write,
                                frame_x=frame_x,
                                frame_w=frame_w,
                                layer_x=slot["x"],
                                layer_y=slot["y"],
                                layer_w=slot["width"],
                                font_size=ts_style.get("font_size", 14.0),
                                font_weight=ts_style.get("font_weight", "400"),
                                font_family=ts_style.get("font_family", "sourcesanspro"),
                                fill_color=ts_style.get("fill_color", "#000000"),
                                text_align=ts_style.get("text_align", "center"),
                                raw_content=slot.get("raw_content"),
                                grow_type=slot.get("grow_type", "auto-height"),
                                vertical_align=slot.get("vertical_align", "top"),
                            )
                        )
                    else:
                        _log(job, f"隐藏空图层: {slot_name}")
                        all_changes.append(client.hide_layer(slot["id"], slot["page_id"]))

        _log(job, f"variant_by_group keys: {list(variant_by_group.keys())}")
        _log(job, f"variant_frame_ids count: {len(variant_frame_ids)}")

        # ── Step 4: 隐藏所有 hide 图层（在提交其他变更之前合并）────────────────
        hide_ids = _find_hide_layer_ids(file_data, req.page_id)
        if hide_ids:
            _log(job, f"隐藏 {len(hide_ids)} 个 hide 图层…")
            for obj_id, pg_id in hide_ids:
                all_changes.append(client.hide_layer(obj_id, pg_id))

        # ── Step 5: 提交所有变更 ──────────────────────────────────────────────
        if all_changes:
            _log(job, f"提交 {len(all_changes)} 个变更…")
            client.update_file(work_file_id, all_changes)
            _log(job, "打开 Penpot 工作区刷新布局…")
            refresh_penpot_workspace(edit_url=edit_url, client=client, log=lambda msg: _log(job, msg))
        else:
            _log(job, "无变更，直接导出")

        # ── Step 6: 导出所有画板 ──────────────────────────────────────────────
        valid_frame_ids = [fid for fid in req.frame_ids if fid in frame_index]
        job.penpot_page_id = req.page_id
        job.result_frame_ids = valid_frame_ids

        results_dir = settings.output_path / "results" / job.id
        results_dir.mkdir(parents=True, exist_ok=True)

        # 优先用数字版本标记（slot/variant_a/1、slot/variant_a/2）构建 export_versions
        # 若没有数字标记，退回到内容 variant_by_group
        export_versions: dict[str, list[tuple[str, str]]] = {}
        if variant_versions:
            export_versions = variant_versions
            _log(job, f"使用数字版本标记: {list(export_versions.keys())}")
        else:
            for gp, field_map in variant_by_group.items():
                for ids in field_map.values():
                    export_versions.setdefault(gp, []).extend(ids)
                export_versions.setdefault(gp, [])

        has_variants = len(export_versions) >= 2
        all_variant_ids = list({(lid, pid) for ids in export_versions.values() for lid, pid in ids})
        _log(job, f"变体模式: {'是' if has_variants else '否'} ({list(export_versions.keys())})")

        _path_buf: dict[str, str] = {}
        _buf_lock = threading.Lock()

        def _export_one_nowait(i: int, frame_id: str, suffix: str) -> None:
            frame = frame_index[frame_id]
            fname = f"frame_{i}{suffix}.png"
            out_path = results_dir / fname
            label = suffix.strip("_") if suffix else ""
            _log(job, f"  导出: {frame['name']}{' [' + label + ']' if label else ''}…")
            try:
                png_bytes = client.export_frame(
                    file_id=work_file_id,
                    page_id=req.page_id,
                    frame_id=frame_id,
                    scale=1.0,
                    name=frame.get("name", "export"),
                    wait_secs=0,
                    background=False,
                )
                out_path.write_bytes(png_bytes)
                with _buf_lock:
                    _path_buf[fname] = str(out_path)
                _log(job, f"  ✓ {frame['name']} ({len(png_bytes)//1024} KB)")
            except Exception as e:
                _log(job, f"  ✗ {frame['name']} 导出失败: {e}")

        def _export_batch(tasks: list[tuple[int, str, str]], wait_secs: float) -> None:
            if not tasks:
                return
            if wait_secs > 0:
                _log(job, f"  等待 {wait_secs}s（Penpot 写入广播）…")
                time.sleep(wait_secs)
            n = len(tasks)
            _log(job, f"  并行导出 {n} 个画板…")
            with ThreadPoolExecutor(max_workers=n) as pool:
                futs = [pool.submit(_export_one_nowait, i, fid, sfx) for i, fid, sfx in tasks]
                for fut in as_completed(futs):
                    exc = fut.exception()
                    if exc:
                        _log(job, f"  [并行导出异常] {exc}")

        if not has_variants:
            _log(job, "并行导出全部画板…")
            tasks = [(i, fid, "") for i, fid in enumerate(valid_frame_ids)]
            _export_batch(tasks, wait_secs=3.0)
        else:
            non_variant_tasks = [
                (i, fid, "") for i, fid in enumerate(valid_frame_ids)
                if fid not in variant_frame_ids
            ]
            if non_variant_tasks:
                _log(job, "并行导出非变体画板…")
                _export_batch(non_variant_tasks, wait_secs=3.0)

            for vi, (vkey, v_ids) in enumerate(sorted(export_versions.items())):
                vis_changes = []
                v_id_set = set(v_ids)
                for lid, pid in all_variant_ids:
                    if (lid, pid) in v_id_set:
                        vis_changes.append(client.show_layer(lid, pid))
                    else:
                        vis_changes.append(client.hide_layer(lid, pid))
                client.update_file(work_file_id, vis_changes)
                suffix = f"_v{vi + 1}"
                _log(job, f"并行导出变体版本 {vkey} → {suffix}…")
                variant_tasks = [
                    (i, fid, suffix) for i, fid in enumerate(valid_frame_ids)
                    if fid in variant_frame_ids
                ]
                _export_batch(variant_tasks, wait_secs=2.0)

        job.result_paths = [
            v for _, v in sorted(_path_buf.items(), key=lambda x: (
                int(__import__('re').search(r'frame_(\d+)', x[0]).group(1)),
                x[0],
            ))
        ]

        job.status = ComposeStatus.done
        save_special_job(job)
        n_out = len(valid_frame_ids) * (2 if has_variants else 1)
        _log(job, f"合成完成！副本 {work_file_id[:8]}…，共导出 {n_out} 张图")

    except Exception as exc:
        job.status = ComposeStatus.failed
        job.error = str(exc)
        save_special_job(job)
        _log(job, f"失败: {exc}")


def _log(job: SpecialFullComposeJob, msg: str) -> None:
    job.progress.append(msg)

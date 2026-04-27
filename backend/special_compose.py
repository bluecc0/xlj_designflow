"""
特殊品合成引擎

处理多画板模板的合成：
1. 解析 /特殊品 指令，拆出 SKU + 各文字字段
2. 按画板的 slot 命名自动决定图片类型（image_XXX → 对应素材文件夹）
3. 文字分段：name_1 / name_2 按最后一个空格切割
4. 时间字段自动展开：time_month / time_hour / time（格式化全文）
5. 每个画板独立导出 PNG，全部完成后打包

Slot 字段映射（特殊品版）：
  slot/product_1/image_white   → White_Base/ 文件夹下的图片
  slot/product_1/image_whitex2 → whitex2 文件夹下的图片（IMAGE_TYPE_FOLDERS 配置）
  slot/product_1/image_png     → PNG/ 文件夹
  slot/product_1/name          → 完整文案（不分段）
  slot/product_1/name_1        → 文案第一段（最后空格前）
  slot/product_1/name_2        → 文案第二段（最后空格后）
  slot/product_1/time          → 格式化全时间：如 "3/28 10:00发售"
  slot/product_1/time_month    → 仅日期部分：如 "3/28"
  slot/product_1/time_hour     → 仅时间部分：如 "10点发售"

与主流程的隔离：
- 入口为 POST /special-compose，独立端点
- 使用同一套 PenpotClient / ProductLibrary / 信号量（避免并发写冲突）
- 不修改主 compose.py 的任何逻辑
"""
from __future__ import annotations

import datetime
import json
import re
import threading
from pathlib import Path
from typing import Optional

from .config import settings
from .models import ComposeStatus, SpecialComposeJob, SpecialComposeRequest
from .penpot_client import PenpotClient, PenpotError
from .product_library import ProductLibrary
from .job_store import save_special_job

# 复用主流程的客户端单例和串行信号量
from .compose import get_client, _compose_sem

# 加载特殊品流程配置
_FLOWS_PATH = Path(__file__).parent.parent / "special_flows.json"
_flows_config: dict = {}

def _load_flows() -> dict:
    global _flows_config
    try:
        with open(_FLOWS_PATH, "r", encoding="utf-8") as f:
            _flows_config = json.load(f).get("flows", {})
    except Exception:
        _flows_config = {}
    return _flows_config

_load_flows()


# ─── 指令解析 ─────────────────────────────────────────────────────────────────

def parse_special_command(text: str) -> Optional[dict]:
    """
    解析 /特殊品 指令，返回 { flow_name, sku, fields } 或 None。

    格式：/特殊品 SKU，文案，时间文案
    分隔符：中文逗号 ，
    """
    text = text.strip()
    for flow_name, flow in _flows_config.items():
        cmd = flow.get("slash_command", "")
        if not text.startswith(cmd):
            continue

        # 去掉指令前缀，取参数部分
        args_str = text[len(cmd):].strip()
        sep = flow.get("input_separator", "，")
        parts = [p.strip() for p in args_str.split(sep)]

        field_defs = flow.get("fields", [])
        result: dict = {"flow_name": flow_name, "sku": "", "fields": {}}

        for i, fdef in enumerate(field_defs):
            val = parts[i] if i < len(parts) else ""
            if fdef.get("is_sku"):
                result["sku"] = val
            else:
                result["fields"][fdef["key"]] = val

        return result
    return None


def _split_on_last_space(text: str) -> tuple[str, str]:
    """
    按最后一个空格切割文案，返回 (前半段, 后半段)。
    支持多种空白字符：普通空格、\xa0（不间断空格）、制表符等。
    先把 2+ 个连续空白压缩为一个空格，再按最后一个空格拆分。
    """
    # 先把多种空白符统一为空格
    import re as _re
    normalized = _re.sub(r'[\s\xa0]+', ' ', text.strip())
    parts = normalized.split(' ')
    if len(parts) <= 1:
        return text, ""
    # 最后一个空格位置 = 倒数第二段末尾
    name_1 = ' '.join(parts[:-1])
    name_2 = parts[-1]
    return name_1, name_2


def expand_time_fields(raw_time: str) -> dict[str, str]:
    """
    解析时间文案，展开为多个 slot 可用的字段。

    输入示例：
      "3月28日 10点发售"   → { time_month:"3/28", time_hour:"10点发售", time:"3/28 10:00发售" }
      "3月28日10点发售"    → 同上（无空格也支持）
      "3/28 10:00发售"    → 直接识别 / 格式
      "28日 10点"         → { time_month:"28日", time_hour:"10点", time:"28日 10点" }
      "3月28日"           → { time_month:"3/28", time_hour:"", time:"3/28" }

    返回 dict 包含：time / time_month / time_hour
    所有字段均为 str，缺失时为 ""。
    """
    raw = (raw_time or "").strip()
    result = {"time": raw, "time_month": "", "time_hour": ""}

    # ── 尝试解析 "N月M日" 格式 ──────────────────────────────────────────────
    month_day_m = re.match(r"(\d{1,2})月(\d{1,2})日\s*", raw)
    slash_day_m = re.match(r"(\d{1,2})/(\d{1,2})\s*", raw)

    date_part = ""
    remainder = raw

    if month_day_m:
        m, d = month_day_m.group(1), month_day_m.group(2)
        date_part = f"{m}/{d}"
        remainder = raw[month_day_m.end():]
    elif slash_day_m:
        m, d = slash_day_m.group(1), slash_day_m.group(2)
        date_part = f"{m}/{d}"
        remainder = raw[slash_day_m.end():]
    else:
        # 无法识别日期，尝试只提取时间部分
        # 格式如 "28日 10点" → time_month=28日，提取后半段
        day_only_m = re.match(r"(\d{1,2}日)\s*", raw)
        if day_only_m:
            date_part = day_only_m.group(1)
            remainder = raw[day_only_m.end():]

    result["time_month"] = date_part

    # ── 解析时间部分：remainder 如 "10点发售" / "10:00发售" / "10点" ─────────
    hour_part = remainder.strip()

    # 统一为可读的 time_hour（保留原始文案）
    result["time_hour"] = hour_part

    # ── 构建 time 全字段 ──────────────────────────────────────────────────────
    # 尝试把 "N点" 转为 "N:00"，让 time 字段更标准
    hour_formatted = hour_part
    hour_num_m = re.match(r"(\d{1,2})点(.*)", hour_part)
    if hour_num_m:
        hh = int(hour_num_m.group(1))
        suffix = hour_num_m.group(2)  # e.g. "发售"
        hour_formatted = f"{hh:02d}:00{suffix}"

    if date_part and hour_formatted:
        result["time"] = f"{date_part} {hour_formatted}"
    elif date_part:
        result["time"] = date_part
    else:
        result["time"] = raw

    return result


# ─── 合成主函数 ───────────────────────────────────────────────────────────────

def run_special_compose(job: SpecialComposeJob) -> None:
    """
    同步执行特殊品合成任务，就地更新 job 状态。
    在后台线程中调用。复用主流程的信号量确保串行。
    """
    _log(job, "等待合成队列（特殊品）…")
    with _compose_sem:
        _run_inner(job)


def _run_inner(job: SpecialComposeJob) -> None:
    job.status = ComposeStatus.running
    save_special_job(job)  # 持久化初始状态
    client = get_client()
    req = job.request
    library = ProductLibrary(settings.product_library_path)

    try:
        # ── Step 0: 展开时间字段，让 time_month / time_hour / time 均可用 ────
        raw_time = req.fields.get("time", "")
        time_expanded = expand_time_fields(raw_time)
        # 合并策略：
        #   - 先用用户传入的 fields 作为基础
        #   - 再用 expand_time_fields 的结果填充（setdefault 不覆盖用户已有的值）
        #   - time_month / time_hour 总是来自展开；time 使用格式化版本，除非用户已传入
        merged_fields: dict[str, str] = dict(req.fields)
        merged_fields.setdefault("time", time_expanded["time"])       # 格式化 time，用户没传时使用
        merged_fields["time_month"] = time_expanded["time_month"]     # 始终覆盖（派生字段）
        merged_fields["time_hour"] = time_expanded["time_hour"]       # 始终覆盖（派生字段）
        # 如果 time slot 需要的是格式化版本（如"3/28 10:00发售"），此处覆盖
        if raw_time and time_expanded["time"] != raw_time:
            # 用户传入了原始时间文案，将格式化版本存到 time，原始文案存到 time_raw
            merged_fields["time"] = time_expanded["time"]
            merged_fields.setdefault("time_raw", raw_time)
        # 展开 name → name_1 / name_2（如果用户没有单独传）
        raw_name = merged_fields.get("name", "")
        if raw_name:
            n1, n2 = _split_on_last_space(raw_name)
            merged_fields.setdefault("name_1", n1)
            merged_fields.setdefault("name_2", n2)

        # ── Step 1: 复制模板文件（一次，所有画板共享同一副本）────────────────
        ts = datetime.datetime.now().strftime("%Y%m%d-%H%M")
        copy_name = f"特殊品-{ts}-{job.id[:8]}"
        _log(job, f"复制模板文件 → {copy_name}")
        dup = client.duplicate_file(req.file_id, copy_name)
        work_file_id = dup.get("id") or dup.get("~:id") or req.file_id

        # 拼接编辑链接
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

        # frame 索引
        frame_index = {f["id"]: f for f in frames}
        # slot 按 frame_id 分组
        slot_by_frame: dict[str, list[dict]] = {}
        for s in slots:
            slot_by_frame.setdefault(s.get("frame_id", ""), []).append(s)

        # ── Step 3: 构建要写入的变更（所有画板共享同一批 changes）────────────
        all_changes: list[dict] = []
        # variant 图层按组收集：{group_part: {field_part: [(layer_id, page_id)]}}
        variant_by_group: dict[str, dict[str, list[tuple[str, str]]]] = {}
        # 哪些 frame_id 包含 variant 图层（只有这些画板需要多版本导出）
        variant_frame_ids: set[str] = set()

        for frame_id in req.frame_ids:
            frame = frame_index.get(frame_id)
            if not frame:
                _log(job, f"警告：未找到 frame {frame_id}，跳过")
                continue

            frame_x = frame["x"]
            frame_w = frame["width"]
            frame_slots = slot_by_frame.get(frame_id, [])
            slot_index = {s["name"]: s for s in frame_slots}

            _log(job, f"处理画板: {frame['name']}（{len(frame_slots)} 个 slot）")

            for slot in frame_slots:
                slot_name: str = slot["name"]  # e.g. slot/product_1/image_white
                parts = slot_name.split("/")
                if len(parts) < 2:
                    continue

                group_part = parts[1]   # e.g. product_1 / variant_a
                field_part = parts[2] if len(parts) >= 3 else ""

                # ── variant 图层：仅做显隐切换，不写内容 ─────────────────────
                # slot/variant_X/N → 按 X 分组，按 N 区分导出版本
                # field_part 为空（如 slot/variant_a/）时跳过，避免产生多余版本
                if group_part.startswith("variant"):
                    if field_part:
                        (
                            variant_by_group
                            .setdefault(group_part, {})
                            .setdefault(field_part, [])
                            .append((slot["id"], slot["page_id"]))
                        )
                        variant_frame_ids.add(frame_id)  # 记录哪个画板含变体
                    _log(job, f"  检测到变体图层: {slot_name}")
                    continue  # 变体图层只做显隐

                if not field_part:
                    continue

                # ── 图片 slot ─────────────────────────────────────────────────
                if field_part == "image" or field_part.startswith("image_"):
                    image_type_key: Optional[str] = slot.get("image_type")  # None or "white" etc
                    folder: Optional[str] = None
                    if image_type_key:
                        folder = settings.IMAGE_TYPE_FOLDERS.get(image_type_key)
                        if not folder:
                            # 尝试大小写不敏感匹配
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

                # ── 文字分段 slot（name_1 / name_2）──────────────────────────
                # split_field 由 penpot_client 在解析 slot 名时标记（field_part 末尾含数字后缀）
                # merged_fields 里已经预展开了 name_1/name_2，直接查即可；
                # 保留原有 split_field 逻辑作为兜底（兼容旧结构）
                elif "split_field" in slot:
                    base_field = slot["split_field"]    # "name"
                    split_idx = slot["split_index"]     # 1 or 2
                    # 优先从 merged_fields 取预展开的值（如 name_1, name_2）
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
                            )
                        )
                    else:
                        _log(job, f"隐藏空分段图层: {slot_name}")
                        all_changes.append(client.hide_layer(slot["id"], slot["page_id"]))

                # ── 普通文字 slot（含 time_month / time_hour / time / name 等）──
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
                            )
                        )
                    else:
                        _log(job, f"隐藏空图层: {slot_name}")
                        all_changes.append(client.hide_layer(slot["id"], slot["page_id"]))

        # ── Step 4: 提交所有变更 ──────────────────────────────────────────────
        if all_changes:
            _log(job, f"提交 {len(all_changes)} 个变更…")
            client.update_file(work_file_id, all_changes)
        else:
            _log(job, "无变更，直接导出")

        # ── Step 5: 导出所有画板结果图 ─────────────────────────────────────
        valid_frame_ids = [fid for fid in req.frame_ids if fid in frame_index]
        job.penpot_file_id = work_file_id
        job.penpot_page_id = req.page_id
        job.result_frame_ids = valid_frame_ids

        results_dir = settings.output_path / "results" / job.id
        results_dir.mkdir(parents=True, exist_ok=True)

        # ── 确定变体导出维度 ──────────────────────────────────────────────────
        # 多组（variant_a + variant_b）→ 按 group_part 区分；
        # 单组（只有 variant_a）且有多个 field → 按 field_part 区分
        if len(variant_by_group) > 1:
            # e.g. {variant_a: {time: [...]}, variant_b: {time: [...]}}
            # → export_versions = {variant_a: [...all ids...], variant_b: [...]}
            export_versions: dict[str, list[tuple[str, str]]] = {}
            for gp, field_map in variant_by_group.items():
                for ids in field_map.values():
                    export_versions.setdefault(gp, []).extend(ids)
        elif variant_by_group:
            # 单组，按 field_part 区分（e.g. "1", "2"）
            only_group = next(iter(variant_by_group.values()))
            export_versions = {fp: ids for fp, ids in only_group.items()}
        else:
            export_versions = {}

        has_variants = len(export_versions) >= 2
        all_variant_ids = [(lid, pid) for ids in export_versions.values() for lid, pid in ids]
        _log(job, f"变体模式: {'是' if has_variants else '否'} ({len(export_versions)} 个版本: {list(export_versions.keys())}，含变体画板: {len(variant_frame_ids)} 个)")

        def _export_one(i: int, frame_id: str, suffix: str, first_wait: float) -> None:
            """导出单个画板，路径写入 job.result_paths"""
            frame = frame_index[frame_id]
            label = suffix.strip("_") if suffix else ""
            fname = f"frame_{i}{suffix}.png"
            out_path = results_dir / fname
            _log(job, f"  导出: {frame['name']}{' [' + label + ']' if label else ''}…")
            try:
                png_bytes = client.export_frame(
                    file_id=work_file_id,
                    page_id=req.page_id,
                    frame_id=frame_id,
                    scale=1.0,
                    name=frame.get("name", "export"),
                    wait_secs=first_wait,
                    background=False,
                )
                out_path.write_bytes(png_bytes)
                job.result_paths.append(str(out_path))
                _log(job, f"  ✓ {frame['name']} ({len(png_bytes)//1024} KB)")
            except Exception as e:
                _log(job, f"  ✗ {frame['name']} 导出失败: {e}")

        if not has_variants:
            # 无变体：所有画板各导出一次
            _log(job, "导出画板预览图…")
            for i, frame_id in enumerate(valid_frame_ids):
                _export_one(i, frame_id, "", first_wait=3.0 if i == 0 else 0.0)
        else:
            # 有变体：
            #   - 不含变体图层的画板 → 正常导出一次（在首次变体导出前，用同一个 wait）
            #   - 含变体图层的画板 → 每个版本导出一次
            _log(job, "导出非变体画板…")
            first = True
            for i, frame_id in enumerate(valid_frame_ids):
                if frame_id in variant_frame_ids:
                    continue
                _export_one(i, frame_id, "", first_wait=3.0 if first else 0.0)
                first = False

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
                _log(job, f"导出变体版本 {vkey} → {suffix}…")
                first_v = True
                for i, frame_id in enumerate(valid_frame_ids):
                    if frame_id not in variant_frame_ids:
                        continue
                    _export_one(i, frame_id, suffix, first_wait=2.0 if first_v else 0.0)
                    first_v = False

        job.status = ComposeStatus.done
        save_special_job(job)  # 持久化完成状态
        n_out = len(valid_frame_ids) * (2 if has_variants else 1)
        _log(job, f"合成完成！副本 {work_file_id[:8]}…，共导出 {n_out} 张图")

    except Exception as exc:
        job.status = ComposeStatus.failed
        job.error = str(exc)
        save_special_job(job)  # 持久化失败状态
        _log(job, f"失败: {exc}")


def _log(job: SpecialComposeJob, msg: str) -> None:
    job.progress.append(msg)

"""
智能铺货 — Excel 解析 → 铺货 JSON

用 openpyxl 读取单元格，按 template_rules.json 的规则解析，
生成 Photoshop 小变量可消费的标准 JSON。
全程固定规则，不调用 AI。
"""
from __future__ import annotations

import copy
import io
import json
import re
import time
from pathlib import Path
from typing import Any, Optional

import openpyxl
from openpyxl.utils import get_column_letter, column_index_from_string
from openpyxl.styles import Color

from .models import SmartDistributeResponse

# 项目根目录
_PROJECT_ROOT = Path(__file__).parent.parent
_RULES_PATH = _PROJECT_ROOT / "template_rules.json"

# 常见黄色色值
_YELLOW_HEXES = {"FFFF00", "FFF2CC", "FFEB9C", "FFE066", "FFD700"}

# SKU 后缀映射
_SKU_SUFFIX_MAP: dict[str, str] = {
    "-M": "模特图",
    "__M": "模特图",
    "-P": "PNG",
    "__P": "PNG",
    "-S": "PNG带阴影",
    "__S": "PNG带阴影",
    "-W": "白底",
    "__W": "白底",
    "-X2": "一双鞋",
    "__X2": "一双鞋",
}


def _load_rules() -> dict[str, Any]:
    """加载模板规则库"""
    with open(_RULES_PATH, "r", encoding="utf-8") as f:
        data: dict[str, Any] = json.load(f)
    return data.get("templates", {})


def _normalize_col(col_name: str, aliases: dict[str, list[str]]) -> Optional[str]:
    """按 fieldAliases 对列名做归一化，返回标准字段名"""
    cleaned = col_name.strip().lower()
    for standard, candidates in aliases.items():
        for c in candidates:
            if c.lower() == cleaned or cleaned == c.lower():
                return standard
    return None


def _get_cell_color(cell) -> Optional[str]:
    """获取单元格填充色的 hex 值，不考虑主题色推导"""
    fill = cell.fill
    if not fill or fill.fgColor is None:
        return None
    color = fill.fgColor
    if color.type == "rgb" and color.rgb:
        raw = str(color.rgb)
        # ARGB 格式，去掉前两位 alpha
        if len(raw) == 8:
            return raw[2:].upper()
        return raw.upper()
    if color.type == "indexed" and color.indexed is not None:
        # indexed 颜色直接用名称判断
        return None
    return None


def _is_yellow(cell) -> bool:
    """判断单元格是否为黄色填充"""
    hex_val = _get_cell_color(cell)
    if hex_val and hex_val in _YELLOW_HEXES:
        return True
    return False


def _parse_sku_suffix(sku: str) -> tuple[str, Optional[str], Optional[str]]:
    """
    解析 SKU 后缀，返回 (cleaned_value, sourceType, reason)

    示例：
        "ARHW015-22-M" → ("ARHW015-22", "模特图", "sku_suffix:-M")
        "ARHW015-22"   → ("ARHW015-22", None, None)
    """
    for suffix, source_type in _SKU_SUFFIX_MAP.items():
        if sku.endswith(suffix):
            cleaned = sku[: -len(suffix)]
            return cleaned, source_type, f"sku_suffix:{suffix}"
    return sku, None, None


def _get_merged_range(ws, row: int, col: int) -> Optional[str]:
    """查找单元格是否在合并单元格中，返回合并范围左上角的值"""
    for merged_range in ws.merged_cells.ranges:
        if merged_range.min_row <= row <= merged_range.max_row and merged_range.min_col <= col <= merged_range.max_col:
            cell = ws.cell(row=merged_range.min_row, column=merged_range.min_col)
            return str(cell.value or "").strip() if cell.value is not None else None
    return None


def _is_row_hidden(ws, row: int) -> bool:
    """判断行是否隐藏"""
    row_dim = ws.row_dimensions.get(row)
    return row_dim is not None and row_dim.hidden


def _cell_str(cell) -> str:
    """安全读单元格值，返回字符串"""
    v = cell.value
    if v is None:
        return ""
    if isinstance(v, str):
        return v.strip()
    return str(v).strip()


def _is_na(value: str) -> bool:
    return value.upper() in {"#N/A", "#REF!", "#VALUE!", "#DIV/0!", "N/A", "NULL"}


class SmartDistributor:
    """智能铺货核心处理类"""

    def __init__(self) -> None:
        self.rules = _load_rules()

    def process(self, file_bytes: bytes, filename: str) -> SmartDistributeResponse:
        """主入口：接收 Excel 字节流和文件名，返回标准铺货 JSON"""
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
        warnings: list[str] = []

        all_jobs: list[dict] = []
        has_yellow = False

        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]

            # 跳过隐藏 sheet
            if ws.sheet_state in ("hidden", "veryHidden"):
                continue

            # 查找模板规则
            rule = self.rules.get(sheet_name.strip())
            if rule is None:
                warnings.append(f"Sheet「{sheet_name}」未匹配模板规则，已跳过")
                continue

            # 解析表头
            header_row = self._find_header_row(ws)
            if header_row is None:
                warnings.append(f"Sheet「{sheet_name}」未检测到有效表头，已跳过")
                continue

            # 归一化列名，建立 列索引 → 标准字段名 映射
            col_mapping: dict[int, str] = {}
            aliases = rule.get("fieldAliases", {})
            module_col = rule.get("moduleColumn", "模块")
            for col_idx in range(1, ws.max_column + 1):
                raw = _cell_str(ws.cell(row=header_row, column=col_idx))
                if not raw:
                    continue
                # 先匹配 fieldAliases
                std = _normalize_col(raw, aliases)
                if std:
                    col_mapping[col_idx] = std
                # 特别识别模块列
                elif raw.strip() == module_col:
                    col_mapping[col_idx] = module_col

            # 验证必备字段
            field_order = rule.get("fieldOrder", [])
            found_fields = set(col_mapping.values())
            missing = [f for f in field_order if f not in found_fields]
            if missing:
                warnings.append(f"模板「{sheet_name}」缺少字段: {', '.join(missing)}")
                continue

            # 识别模块范围
            modules = self._detect_modules(ws, header_row, rule, col_mapping)

            # 逐行读取数据（跳过表头）
            rows_data: list[dict[str, Any]] = []
            module_col = self._get_module_col_index(col_mapping, rule)
            yellow_cells: set[tuple[int, str]] = set()  # (row_idx, field)

            for row_idx in range(header_row + 1, ws.max_row + 1):
                if _is_row_hidden(ws, row_idx):
                    continue

                row_values: dict[str, Any] = {"_row": row_idx}
                row_yellow = False
                sku_value = ""

                for col_idx, field_name in col_mapping.items():
                    cell = ws.cell(row=row_idx, column=col_idx)
                    val = _cell_str(cell)

                    # 检测黄色
                    if _is_yellow(cell):
                        yellow_cells.add((row_idx, field_name))
                        row_yellow = True

                    row_values[field_name] = val
                    if field_name == field_order[0]:  # SKU 通常是第一个字段
                        sku_value = val

                # 过滤：空 SKU 行
                if not sku_value:
                    continue
                # 过滤：错误值
                if _is_na(sku_value):
                    continue

                rows_data.append(row_values)
                if row_yellow:
                    has_yellow = True

            if not rows_data:
                warnings.append(f"模板「{sheet_name}」没有有效数据行")
                continue

            # 按模块分组
            module_col_std = rule.get("moduleColumn", "模块")
            found_module_col = self._find_module_col_in_mapping(col_mapping, module_col_std)
            module_groups = self._group_by_module(rows_data, modules, found_module_col, field_order)

            # 构建 job
            job = self._build_job(sheet_name, rule, module_groups, field_order, rows_data,
                                  yellow_cells, has_yellow, col_mapping)
            all_jobs.append(job)

        if not all_jobs:
            warnings.append("未生成任何铺货任务，请检查表格内容")

        mode = "patch" if has_yellow else "full"
        result = self._build_response(all_jobs, mode, filename, warnings)
        return result

    # ─── 内部方法 ──────────────────────────────────────────────────────────

    def _find_header_row(self, ws) -> Optional[int]:
        """查找表头行：第一个包含 fieldAliases 中任一字段名的行"""
        aliases_pool: set[str] = set()
        for rule in self.rules.values():
            for candidates in rule.get("fieldAliases", {}).values():
                for c in candidates:
                    aliases_pool.add(c.lower())
        for row_idx in range(1, min(ws.max_row + 1, 20)):
            for col_idx in range(1, ws.max_column + 1):
                val = _cell_str(ws.cell(row=row_idx, column=col_idx))
                if val.lower() in aliases_pool:
                    return row_idx
        return None

    def _get_module_col_index(self, col_mapping: dict[int, str], rule: dict) -> Optional[int]:
        module_col_std = rule.get("moduleColumn", "模块")
        for col_idx, field_name in col_mapping.items():
            if field_name == module_col_std:
                return col_idx
        return None

    def _find_module_col_in_mapping(self, col_mapping: dict[int, str], module_col_std: str) -> Optional[int]:
        for col_idx, field_name in col_mapping.items():
            if field_name == module_col_std:
                return col_idx
        return None

    def _detect_modules(self, ws, header_row: int, rule: dict,
                        col_mapping: dict[int, str]) -> list[dict]:
        """
        识别模块范围。
        优先通过模块列的合并单元格，其次向下填充。
        """
        module_col_std = rule.get("moduleColumn", "模块")
        module_col_idx = self._find_module_col_in_mapping(col_mapping, module_col_std)
        if module_col_idx is None:
            return []

        modules: list[dict] = []
        current_module: Optional[str] = None
        module_start: Optional[int] = None

        for row_idx in range(header_row + 1, ws.max_row + 1):
            if _is_row_hidden(ws, row_idx):
                continue

            cell = ws.cell(row=row_idx, column=module_col_idx)
            cell_val = _cell_str(cell)
            merged_val = _get_merged_range(ws, row_idx, module_col_idx)
            module_val = merged_val or cell_val

            if not module_val and current_module is None:
                # 还没检测到任何模块，跳过前面的空行
                continue

            if not module_val and current_module is not None:
                # 当前行无模块值，属于当前模块（向下填充）
                continue

            # module_val 有值
            if current_module is None:
                # 第一个模块
                current_module = module_val
                module_start = row_idx
            elif module_val != current_module:
                # 新模块，关闭上一个
                modules.append({
                    "moduleName": current_module,
                    "rowStart": module_start,
                    "rowEnd": row_idx - 1,
                })
                current_module = module_val
                module_start = row_idx
            # else: module_val == current_module，继续当前模块

        # 最后一个模块
        if current_module is not None and module_start is not None:
            modules.append({
                "moduleName": current_module,
                "rowStart": module_start,
                "rowEnd": ws.max_row,
            })

        return modules

    def _group_by_module(self, rows_data: list[dict], modules: list[dict],
                         module_col_idx: Optional[int],
                         field_order: list[str]) -> list[dict]:
        """将行数据按模块分组"""
        if not modules:
            # 没有模块定义，全部归为默认模块
            return [{
                "moduleName": "默认",
                "rowCount": len(rows_data),
                "rows": rows_data,
            }]

        result = []
        for mod in modules:
            mod_rows = [
                r for r in rows_data
                if mod["rowStart"] <= r["_row"] <= mod["rowEnd"]
            ]
            if mod_rows:
                result.append({
                    "moduleName": mod["moduleName"],
                    "rowCount": len(mod_rows),
                    "rows": mod_rows,
                })
        return result

    def _build_job(self, sheet_name: str, rule: dict,
                   module_groups: list[dict], field_order: list[str],
                   all_rows: list[dict], yellow_cells: set,
                   has_global_yellow: bool, col_mapping: dict[int, str]) -> dict:
        """构建单个 job（一个 sheet/模板对应一个 job）"""
        default_source_type = rule.get("defaultSourceType", "PNG")
        items_per_module = rule.get("itemsPerModule", 0)
        export_format = rule.get("exportFormat", "png")
        image_field = rule.get("imageField", field_order[0])

        modules_out: list[dict] = []

        for mod in module_groups:
            row_count = mod["rowCount"]
            expected_layer_count = row_count * len(field_order)

            if has_global_yellow:
                # patch 模式
                patches: list[dict] = []
                for ri, row_data in enumerate(mod["rows"]):
                    for fi, field_name in enumerate(field_order):
                        row_idx = row_data["_row"]
                        if (row_idx, field_name) in yellow_cells:
                            slot_index = ri * len(field_order) + fi + 1
                            value_data = self._build_value(
                                row_data, field_name, field_order, image_field,
                                default_source_type, slot_index, ri, row_idx, True
                            )
                            patches.append(value_data)

                modules_out.append({
                    "moduleName": mod["moduleName"],
                    "targetGroup": mod["moduleName"],
                    "excelRange": "",
                    "rowCount": row_count,
                    "expectedLayerCount": expected_layer_count,
                    "exportName": f"{sheet_name}_{mod['moduleName']}",
                    "patches": patches,
                })
            else:
                # full 模式
                values: list[dict] = []
                for ri, row_data in enumerate(mod["rows"]):
                    for fi, field_name in enumerate(field_order):
                        slot_index = ri * len(field_order) + fi + 1
                        row_idx = row_data["_row"]
                        value_data = self._build_value(
                            row_data, field_name, field_order, image_field,
                            default_source_type, slot_index, ri, row_idx, False
                        )
                        values.append(value_data)

                modules_out.append({
                    "moduleName": mod["moduleName"],
                    "targetGroup": mod["moduleName"],
                    "excelRange": "",
                    "rowCount": row_count,
                    "expectedLayerCount": expected_layer_count,
                    "exportName": f"{sheet_name}_{mod['moduleName']}",
                    "values": values,
                })

        return {
            "sheetName": sheet_name,
            "templateName": sheet_name,
            "defaultSourceType": default_source_type,
            "fieldOrder": field_order,
            "modules": modules_out,
        }

    def _build_value(self, row_data: dict, field_name: str,
                     field_order: list[str], image_field: str,
                     default_source_type: str,
                     slot_index: int, row_index_in_module: int,
                     source_row: int, changed: bool) -> dict:
        """构建单个 value/patch 条目"""
        raw_value = row_data.get(field_name, "")
        is_image = (field_name == image_field)

        entry: dict = {
            "slotIndex": slot_index,
            "field": field_name,
            "value": raw_value,
            "rowIndexInModule": row_index_in_module + 1,
            "sourceRow": source_row,
        }

        if changed:
            entry["changed"] = True

        if is_image:
            entry["type"] = "image"
            # 解析 SKU 后缀
            cleaned, suffix_type, suffix_reason = _parse_sku_suffix(raw_value)
            entry["value"] = cleaned
            entry["rawValue"] = raw_value
            if suffix_type:
                entry["sourceType"] = suffix_type
                entry["sourceTypeReason"] = suffix_reason
            else:
                entry["sourceType"] = default_source_type
                entry["sourceTypeReason"] = "template_default"
        else:
            entry["type"] = "text"

        return entry

    def _build_response(self, jobs: list[dict], mode: str,
                        filename: str, warnings: list[str]) -> SmartDistributeResponse:
        """组装最终响应"""
        total_slots = 0
        total_suffix_overrides = 0
        for job in jobs:
            for mod in job.get("modules", []):
                if mode == "patch":
                    total_slots += len(mod.get("patches", []))
                else:
                    total_slots += len(mod.get("values", []))
                for v in mod.get("values", []) if mode == "full" else mod.get("patches", []):
                    if v.get("sourceTypeReason", "").startswith("sku_suffix"):
                        total_suffix_overrides += 1

        # source 摘要
        source = {
            "fileName": filename,
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S+08:00", time.localtime()),
            "generator": "internal-chatbot",
        }

        defaults = {
            "sourceType": "PNG",
            "layerOrder": "panel",
            "savePolicy": "overwrite",
            "exportMode": "moduleGroup",
            "exportFormat": "png",
        }

        return SmartDistributeResponse(
            schemaVersion="1.0",
            mode=mode,
            source=source,
            defaults=defaults,
            jobs=jobs,
            warnings=warnings,
        )

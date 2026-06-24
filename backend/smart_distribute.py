"""
智能铺货 - Excel 解析 -> 铺货 JSON

用 openpyxl 读取单元格，自动识别 sheet 和列，
生成 Photoshop 小变量可消费的标准 JSON。
全程固定规则，不调用 AI。

核心逻辑：
  - 有黄色标记 -> patch 模式：所有黄色条目合并成一个 patch job
  - 无黄色标记 -> full 模式：每个模块独立一个 job
"""
from __future__ import annotations

import io
import json
import time
from pathlib import Path
from typing import Any, Optional

import openpyxl

from .models import SmartDistributeResponse

# 常见黄色色值
_YELLOW_HEXES = {"FFFF00", "FFF2CC", "FFEB9C", "FFE066", "FFD700"}

# 模块列识别关键字
_MODULE_COL_KEYWORDS = ["模块", "分类", "品类", "分组"]


def _is_yellow(cell) -> bool:
    """判断单元格是否为手动设置的黄色填充"""
    fill = cell.fill
    if not fill:
        return False
    # 只有 fill_type=solid 才认为是手动设置的颜色
    if fill.fill_type != "solid":
        return False
    fg = fill.fgColor
    if fg is None:
        return False
    # 有 theme 或 indexed 说明不是手动 RGB 色
    if fg.theme is not None or fg.indexed is not None:
        return False
    if fg.type != "rgb" or not fg.rgb:
        return False
    raw = str(fg.rgb)
    # 忽略透明/无色/白色
    if raw.upper() in ("0", "00000000", "FFFFFF", "FFFFFFFF"):
        return False
    # ARGB 去掉 alpha
    if len(raw) == 8:
        hex_val = raw[2:].upper()
    else:
        hex_val = raw.upper()
    return hex_val in _YELLOW_HEXES


def _get_merged_range(ws, row: int, col: int) -> Optional[str]:
    for rng in ws.merged_cells.ranges:
        if rng.min_row <= row <= rng.max_row and rng.min_col <= col <= rng.max_col:
            cell = ws.cell(row=rng.min_row, column=rng.min_col)
            return str(cell.value or "").strip() if cell.value is not None else None
    return None


def _is_row_hidden(ws, row: int) -> bool:
    rd = ws.row_dimensions.get(row)
    return rd is not None and rd.hidden


def _cell_str(cell) -> str:
    v = cell.value
    if v is None:
        return ""
    return str(v).strip() if isinstance(v, str) else str(v).strip()


def _is_na(value: str) -> bool:
    return value.upper() in {"#N/A", "#REF!", "#VALUE!", "#DIV/0!", "N/A", "NULL"}


def _is_module_col(header: str) -> bool:
    cleaned = header.strip().lower()
    return any(kw == cleaned for kw in _MODULE_COL_KEYWORDS)


class SmartDistributor:
    """智能铺货核心处理类"""

    def process(self, file_bytes: bytes, filename: str) -> SmartDistributeResponse:
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
        warnings: list[str] = []

        all_jobs: list[dict] = []
        yellow_items: list[dict] = []
        has_yellow = False
        global_slot = 1

        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            if ws.sheet_state in ("hidden", "veryHidden"):
                continue

            header_row = self._find_header_row(ws)
            if header_row is None:
                warnings.append(f"Sheet[{sheet_name}] 未检测到有效表头，已跳过")
                continue

            headers, module_col_idx = self._scan_headers(ws, header_row)
            if not headers:
                warnings.append(f"Sheet[{sheet_name}] 没有找到有效数据列，已跳过")
                continue

            field_order = list(headers.values())
            image_field = field_order[0]
            modules = self._detect_modules(ws, header_row, module_col_idx)

            rows_data, sheet_yellow_cells = self._read_rows(ws, header_row, headers, field_order)
            if not rows_data:
                warnings.append(f"Sheet[{sheet_name}] 没有有效数据行")
                continue

            if sheet_yellow_cells:
                has_yellow = True
                module_groups = self._group_by_module(rows_data, modules, module_col_idx, field_order)
                for mod in module_groups:
                    for ri, row_data in enumerate(mod["rows"]):
                        for fi, field_name in enumerate(field_order):
                            row_idx = row_data["_row"]
                            if (row_idx, field_name) in sheet_yellow_cells:
                                yellow_items.append({
                                    "slotIndex": global_slot,
                                    "field": field_name,
                                    "type": "image" if field_name == image_field else "text",
                                    "value": row_data.get(field_name, ""),
                                    "rowIndexInModule": ri + 1,
                                    "sourceRow": row_idx,
                                    "changed": True,
                                })
                                global_slot += 1
            else:
                # full: 每个模块一个独立 job
                module_groups = self._group_by_module(rows_data, modules, module_col_idx, field_order)
                for mod in module_groups:
                    job = self._build_module_job(sheet_name, field_order, image_field, mod)
                    all_jobs.append(job)

        if has_yellow and yellow_items:
            all_jobs.append({
                "sheetName": "patch",
                "templateName": "patch",
                "fieldOrder": [],
                "modules": [{
                    "moduleName": "增量修改",
                    "targetGroup": "增量修改",
                    "excelRange": "",
                    "rowCount": 1,
                    "expectedLayerCount": len(yellow_items),
                    "exportName": "patch",
                    "patches": yellow_items,
                }],
            })

        if not all_jobs:
            warnings.append("未生成任何铺货任务，请检查表格内容")

        mode = "patch" if has_yellow else "full"
        source = {
            "fileName": filename,
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S+08:00", time.localtime()),
            "generator": "internal-chatbot",
        }
        defaults = {
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
            jobs=all_jobs,
            warnings=warnings,
        )

    def _find_header_row(self, ws) -> Optional[int]:
        for row_idx in range(1, min(ws.max_row + 1, 20)):
            count = sum(1 for col in range(1, ws.max_column + 1) if _cell_str(ws.cell(row=row_idx, column=col)))
            if count >= 3:
                return row_idx
        return None

    def _scan_headers(self, ws, header_row: int) -> tuple[dict[int, str], Optional[int]]:
        headers = {}
        module_col_idx = None
        for col_idx in range(1, ws.max_column + 1):
            # 跳过隐藏列
            col_letter = openpyxl.utils.get_column_letter(col_idx)
            col_dim = ws.column_dimensions.get(col_letter)
            if col_dim is not None and col_dim.hidden:
                continue
            raw = _cell_str(ws.cell(row=header_row, column=col_idx))
            if not raw:
                continue
            if _is_module_col(raw):
                module_col_idx = col_idx
            else:
                headers[col_idx] = raw
        return headers, module_col_idx

    def _read_rows(self, ws, header_row: int, headers: dict[int, str],
                   field_order: list[str]) -> tuple[list[dict], set]:
        rows_data = []
        yellow_cells = set()
        # 只读第一个数据块，遇到连续空行就结束
        max_check = min(ws.max_row + 1, header_row + 1 + 200)  # 最多读 200 行
        blank_run = 0
        for row_idx in range(header_row + 1, max_check):
            if _is_row_hidden(ws, row_idx):
                continue
            row_values = {"_row": row_idx}
            has_value = False
            sku_value = ""
            for col_idx, field_name in headers.items():
                cell = ws.cell(row=row_idx, column=col_idx)
                val = _cell_str(cell)
                if val:
                    has_value = True
                if _is_yellow(cell):
                    yellow_cells.add((row_idx, field_name))
                row_values[field_name] = val
                if col_idx == min(headers.keys()):
                    sku_value = val
            if not has_value:
                blank_run += 1
                if blank_run >= 5:  # 连续 5 行空行则停止
                    break
                continue
            blank_run = 0
            if not sku_value or _is_na(sku_value):
                continue
            rows_data.append(row_values)
        return rows_data, yellow_cells

    def _detect_modules(self, ws, header_row: int, module_col_idx: Optional[int]) -> list[dict]:
        if module_col_idx is None:
            return []
        modules = []
        current = None
        start = None
        max_check = min(ws.max_row + 1, header_row + 1 + 200)
        blank_run = 0
        for row_idx in range(header_row + 1, max_check):
            if _is_row_hidden(ws, row_idx):
                continue
            cell = ws.cell(row=row_idx, column=module_col_idx)
            mv = _get_merged_range(ws, row_idx, module_col_idx) or _cell_str(cell)
            if not mv:
                blank_run += 1
                if blank_run >= 5:
                    break
                continue
            blank_run = 0
            if current is None:
                current, start = mv, row_idx
            elif mv != current:
                modules.append({"moduleName": current, "rowStart": start, "rowEnd": row_idx - 1})
                current, start = mv, row_idx
        if current is not None and start is not None:
            modules.append({"moduleName": current, "rowStart": start, "rowEnd": row_idx - 1})
        return modules

    def _group_by_module(self, rows_data: list[dict], modules: list[dict],
                         module_col_idx: Optional[int],
                         field_order: list[str]) -> list[dict]:
        if not modules:
            return [{"moduleName": "默认", "rowCount": len(rows_data), "rows": rows_data}]
        result = []
        for mod in modules:
            mr = [r for r in rows_data if mod["rowStart"] <= r["_row"] <= mod["rowEnd"]]
            if mr:
                result.append({"moduleName": mod["moduleName"], "rowCount": len(mr), "rows": mr})
        return result

    def _build_module_job(self, sheet_name: str, field_order: list[str],
                          image_field: str, mod: dict) -> dict:
        row_count = mod["rowCount"]
        elc = row_count * len(field_order)
        items = []
        for ri, row_data in enumerate(mod["rows"]):
            for fi, field_name in enumerate(field_order):
                items.append({
                    "slotIndex": ri * len(field_order) + fi + 1,
                    "field": field_name,
                    "type": "image" if field_name == image_field else "text",
                    "value": row_data.get(field_name, ""),
                    "rowIndexInModule": ri + 1,
                    "sourceRow": row_data["_row"],
                })
        return {
            "sheetName": sheet_name,
            "templateName": sheet_name,
            "fieldOrder": field_order,
            "modules": [{
                "moduleName": mod["moduleName"],
                "targetGroup": mod["moduleName"],
                "excelRange": "",
                "rowCount": row_count,
                "expectedLayerCount": elc,
                "exportName": f"{sheet_name}_{mod['moduleName']}",
                "values": items,
            }],
        }

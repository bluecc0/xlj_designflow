"""
表格解析模块 — 规则匹配

列名标准化 → 直接从 DataFrame 取值 → 图库路径匹配
全程 < 1 秒，无网络依赖。
"""
from __future__ import annotations

import io
from typing import Optional

import pandas as pd

from .config import settings
from .models import ParsedProduct, ParseResult
from .product_library import ProductLibrary
from .slot_schema import schema as slot_schema


def _build_column_rules() -> dict[str, list[str]]:
    """从 slot_schema.json 动态构建列名映射表"""
    rules: dict[str, list[str]] = {
        "image_filename": slot_schema.image_filename_aliases,
    }
    for field_key, aliases in slot_schema.column_aliases.items():
        rules[field_key] = aliases
    return rules


def _normalize_columns(df: pd.DataFrame, required_fields: list[str]) -> pd.DataFrame:
    """
    将原始 DataFrame 的列名映射为标准字段名。
    列名规则从 slot_schema.json 动态加载。
    """
    column_rules = _build_column_rules()
    discard_keywords = slot_schema.discard_keywords
    needed = list(dict.fromkeys(["image_filename"] + required_fields))
    col_map: dict[str, str] = {}

    for col in df.columns:
        col_lower = col.lower().strip()
        if any(kw in col_lower for kw in discard_keywords):
            continue
        for target in needed:
            if target in col_map.values():
                continue
            keywords = column_rules.get(target, [])
            if any(kw.lower() in col_lower or col_lower in kw.lower() for kw in keywords):
                col_map[col] = target
                break

    if not col_map:
        return df

    result = df[list(col_map.keys())].rename(columns=col_map)
    keep = [f for f in needed if f in result.columns]
    return result[keep]


def _suggested_type(count: int) -> str:
    if count <= 1:
        return "single"
    if count <= 4:
        return "grid_4"
    if count <= 6:
        return "grid_6"
    return "grid_9"


def parse_table(
    file_bytes: bytes,
    filename: str,
    required_fields: list[str] | None = None,
    image_type: str | None = None,
) -> ParseResult:
    """
    解析上传的表格文件，返回结构化产品列表。
    纯规则层，不调用 AI，< 1 秒完成。
    """
    # ── 读取表格 ──────────────────────────────────────────────────────────────
    if filename.lower().endswith(".csv"):
        df = pd.read_csv(io.BytesIO(file_bytes))
    else:
        df = pd.read_excel(io.BytesIO(file_bytes))

    print(f"[table_parser] 原始列名: {list(df.columns)}")

    # ── 列名标准化 ────────────────────────────────────────────────────────────
    # 从 schema 取所有文字字段，required_fields 可进一步限定
    all_text_fields = slot_schema.text_fields  # ["name", "price", "tag", "spec", ...]
    clean_required = [f for f in (required_fields or []) if f not in ("image", "image_filename")]
    active_text = clean_required if clean_required else all_text_fields
    active_fields = list(dict.fromkeys(["image_filename"] + active_text))
    normalized_df = _normalize_columns(df, [f for f in active_fields if f != "image_filename"])

    print(f"[table_parser] 标准化后: {list(normalized_df.columns)}")

    # ── 图库匹配 ──────────────────────────────────────────────────────────────
    library = ProductLibrary(settings.product_library_path)
    folder: str | None = None
    if image_type:
        folder = settings.IMAGE_TYPE_FOLDERS.get(image_type)

    products: list[ParsedProduct] = []

    def get_val(row: pd.Series, field: str) -> Optional[str]:
        if field not in row.index:
            return None
        v = row[field]
        if pd.isna(v):
            return None
        s = str(v).strip()
        return s if s else None

    for _, row in normalized_df.iterrows():
        image_filename = get_val(row, "image_filename") or ""
        name = get_val(row, "name") or ""

        sku = image_filename or name
        img_path: Optional[str] = None

        if folder and sku:
            img_path = library.find_in_folder(sku, folder)
        else:
            if image_filename:
                img_path = library.find_by_filename(image_filename)
            if img_path is None and name:
                img_path = library.find(name)

        # 动态构建产品字段（从 schema 的所有文字字段中取值）
        text_values: dict[str, Optional[str]] = {}
        for field_key in slot_schema.text_fields:
            text_values[field_key] = get_val(row, field_key)

        products.append(ParsedProduct(
            image_path=img_path,
            **text_values,
        ))

    print(f"[table_parser] 解析完成: {len(products)} 个产品, image_type={image_type}, folder={folder}")

    return ParseResult(
        products=products,
        suggested_template_type=_suggested_type(len(products)),
        raw_table=normalized_df.to_markdown(index=False),
    )

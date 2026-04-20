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


# ── 列名规则映射表 ─────────────────────────────────────────────────────────────
_COLUMN_RULES: dict[str, list[str]] = {
    "image_filename": ["sku", "货号", "编码", "型号", "款号", "article", "item no", "itemno",
                       "图片文件名", "图片名", "filename", "image"],
    "name":           ["商品名称", "品名", "产品名称", "名称", "商品名", "产品名", "product name", "title"],
    "price":          ["到手价", "售价", "活动价", "最终价", "成交价", "实付", "优惠价",
                       "price", "sale price"],
    "tag":            ["标签", "促销", "活动标签", "tag", "label", "badge"],
    "spec":           ["规格", "尺码", "颜色", "容量", "型号规格", "spec", "size", "color"],
}

# 明确丢弃的列（吊牌价、立省等干扰列）
_DISCARD_KEYWORDS = ["吊牌价", "原价", "市场价", "折扣", "优惠金额",
                     "库存", "销量", "数量", "备注", "remark"]


def _normalize_columns(df: pd.DataFrame, required_fields: list[str]) -> pd.DataFrame:
    """
    将原始 DataFrame 的列名映射为标准字段名。
    只保留 required_fields 中需要的列（image_filename 始终保留）。
    """
    needed = list(dict.fromkeys(["image_filename"] + required_fields))
    col_map: dict[str, str] = {}

    for col in df.columns:
        col_lower = col.lower().strip()
        if any(kw in col_lower for kw in _DISCARD_KEYWORDS):
            continue
        for target in needed:
            if target in col_map.values():
                continue
            keywords = _COLUMN_RULES.get(target, [])
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
    clean_required = [f for f in (required_fields or []) if f not in ("image", "image_filename")]
    active_fields = list(dict.fromkeys(["image_filename", "name"] + (clean_required or ["price", "tag", "spec"])))
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
        price = get_val(row, "price")
        tag = get_val(row, "tag")
        spec = get_val(row, "spec")

        sku = image_filename or name
        img_path: Optional[str] = None

        if folder and sku:
            img_path = library.find_in_folder(sku, folder)
        else:
            if image_filename:
                img_path = library.find_by_filename(image_filename)
            if img_path is None and name:
                img_path = library.find(name)

        products.append(ParsedProduct(
            name=name or None,
            price=price,
            tag=tag,
            spec=spec,
            image_path=img_path,
        ))

    print(f"[table_parser] 解析完成: {len(products)} 个产品, image_type={image_type}, folder={folder}")

    return ParseResult(
        products=products,
        suggested_template_type=_suggested_type(len(products)),
        raw_table=normalized_df.to_markdown(index=False),
    )

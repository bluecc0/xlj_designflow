"""
表格解析模块

两阶段处理：
1. Python 规则层：列名标准化，精确映射 SKU/名称/价格等已知结构化字段
2. AI 层：处理规则层无法确定的非结构化字段（tag、spec），以及兜底识别

对外展示：AI 驱动的智能解析体验。
"""
from __future__ import annotations

import io
import json
import re
from typing import Optional

import pandas as pd
from openai import OpenAI

from .config import settings
from .models import ParsedProduct, ParseResult
from .product_library import ProductLibrary


# ── 列名规则映射表 ─────────────────────────────────────────────────────────────
# 每个目标字段对应一组关键词，按优先级匹配列名（不区分大小写，支持部分匹配）

_COLUMN_RULES: dict[str, list[str]] = {
    # 图片/SKU 列 → image_filename（精确优先）
    "image_filename": ["sku", "货号", "编码", "型号", "款号", "article", "item no", "itemno",
                       "图片文件名", "图片名", "filename", "image"],
    # 产品名称
    "name":           ["商品名称", "品名", "产品名称", "名称", "商品名", "产品名", "product name", "title"],
    # 到手价（排在吊牌价前面，靠列名关键词区分）
    "price":          ["到手价", "售价", "活动价", "最终价", "成交价", "实付", "优惠价",
                       "price", "sale price"],
    # 促销标签
    "tag":            ["标签", "促销", "活动标签", "tag", "label", "badge"],
    # 规格
    "spec":           ["规格", "尺码", "颜色", "容量", "型号规格", "spec", "size", "color"],
}

# 明确需要丢弃的列（即使关键词部分匹配也跳过）
_DISCARD_KEYWORDS = ["吊牌价", "原价", "市场价", "立省", "折扣", "优惠金额",
                     "库存", "销量", "数量", "备注", "remark"]


def _normalize_columns(df: pd.DataFrame, required_fields: list[str]) -> pd.DataFrame:
    """
    将原始 DataFrame 的列名映射为标准字段名。
    只保留 required_fields 中需要的列（image_filename 始终保留）。
    返回列名为标准字段名的新 DataFrame。
    """
    needed = list(dict.fromkeys(["image_filename"] + required_fields))
    col_map: dict[str, str] = {}  # 原列名 → 标准字段名

    for col in df.columns:
        col_lower = col.lower().strip()

        # 先检查是否是需要丢弃的列
        if any(kw in col_lower for kw in _DISCARD_KEYWORDS):
            continue

        # 按 needed 顺序尝试匹配（先匹配到的优先）
        for target in needed:
            if target in col_map.values():
                continue  # 该目标字段已有列映射，跳过
            keywords = _COLUMN_RULES.get(target, [])
            if any(kw.lower() in col_lower or col_lower in kw.lower() for kw in keywords):
                col_map[col] = target
                break

    if not col_map:
        return df  # 没匹配到任何列，原样返回让 AI 处理

    result = df[list(col_map.keys())].rename(columns=col_map)
    # 只保留 needed 中有的列
    keep = [f for f in needed if f in result.columns]
    return result[keep]


def _get_client() -> OpenAI:
    return OpenAI(
        api_key=settings.siliconflow_api_key,
        base_url=settings.siliconflow_base_url,
    )


def parse_table(file_bytes: bytes, filename: str, required_fields: list[str] | None = None) -> ParseResult:
    """
    解析上传的表格文件，返回结构化产品列表和推荐模板类型。
    """
    # ── 读取表格 ──────────────────────────────────────────────────────────────
    if filename.lower().endswith(".csv"):
        df = pd.read_csv(io.BytesIO(file_bytes))
    else:
        df = pd.read_excel(io.BytesIO(file_bytes))

    product_count = len(df)

    # ── 第一阶段：Python 规则层列名标准化 ────────────────────────────────────
    active_fields = list(dict.fromkeys(["image_filename", "name"] + (required_fields or ["price", "tag", "spec"])))
    normalized_df = _normalize_columns(df, [f for f in active_fields if f != "image_filename"])

    # 检查规则层能覆盖多少字段
    rule_covered = set(normalized_df.columns.tolist())
    print(f"[table_parser] 原始列名: {list(df.columns)}")
    print(f"[table_parser] 标准化后: {list(normalized_df.columns)}")

    # ── 第二阶段：AI 处理剩余非结构化字段 + 兜底 ─────────────────────────────
    # 把标准化后的表格（已去掉无关列、列名已标准化）交给 AI
    # AI 只需处理规则层没覆盖的字段，或对已有字段做语义理解
    table_md = normalized_df.to_markdown(index=False)

    # 需要 AI 补充的字段（规则层没覆盖的）
    ai_needed = [f for f in active_fields if f not in rule_covered and f != "image_filename"]

    if ai_needed:
        ai_field_lines = "\n".join(
            f"- {f}: " + {
                "name": "产品名称",
                "price": "最终到手价（忽略吊牌价、立省等）",
                "tag": "促销标签（如 新品、热销；无则 null）",
                "spec": "规格说明（如尺码、颜色；无则 null）",
            }.get(f, f)
            for f in ai_needed
        )
        extra_hint = f"\n需要额外提取以下字段：\n{ai_field_lines}\n"
    else:
        extra_hint = ""

    prompt = f"""你是电商素材生产助手，分析下方已预处理的产品表格：

{table_md}

表格列名已标准化。请按行提取每个产品数据，输出 JSON：
- image_filename: 取 image_filename 列的值（直接复制，不要修改）
- name: 取 name 列的值{extra_hint}
产品数量：{product_count} 个，推荐模板类型：
- 1个 → single，4个 → grid_4，5-6个 → grid_6，7-9个 → grid_9

只返回 JSON，不要其他文字：
{{
  "products": [{{"image_filename": "...", "name": "...", "price": "...", "tag": null, "spec": null}}],
  "suggested_template_type": "grid_6"
}}"""

    client = _get_client()
    response = client.chat.completions.create(
        model=settings.siliconflow_model,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=1024,
        temperature=0.1,
    )

    text = response.choices[0].message.content or ""
    print(f"[table_parser] AI 返回: {text[:500]}")

    # 提取 JSON（兼容带 markdown 代码块的回复）
    json_match = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", text)
    raw = json.loads(json_match.group(1) if json_match else text.strip())

    # ── 匹配产品图库 ──────────────────────────────────────────────────────────
    library = ProductLibrary(settings.product_library_path)
    products: list[ParsedProduct] = []

    for item in raw.get("products", []):
        name = item.get("name") or ""
        image_filename = item.get("image_filename") or ""
        img_path: Optional[str] = None

        # 优先文件名精确查找（SKU 列）
        if image_filename:
            img_path = library.find_by_filename(image_filename)

        # 兜底：产品名称模糊匹配
        if img_path is None and name:
            img_path = library.find(name)

        products.append(
            ParsedProduct(
                name=name or None,
                price=item.get("price") or None,
                tag=item.get("tag") or None,
                spec=item.get("spec") or None,
                image_path=img_path,
            )
        )

    return ParseResult(
        products=products,
        suggested_template_type=raw.get("suggested_template_type", "single"),
        raw_table=table_md,
    )

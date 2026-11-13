"""价格与文案核对：读铺品表格，用看图模型读出文件夹里每张成品图上的商品信息，自动对应到表格并逐项比对，生成 Excel 报告。

不依赖文件夹结构、文件命名和排列顺序：图上没有货号，靠商品名称、文案和价格把图上的商品对应到表格里的行
（同一张图里按顺序对齐，对不上的再单独找）。模型只负责读图，对应和比较都由程序完成。
"""
from __future__ import annotations

import asyncio
import csv
import hashlib
import io
import json
import math
import re
import unicodedata
import zipfile
from dataclasses import dataclass, field
from difflib import SequenceMatcher

import openpyxl
from PIL import Image

from .ai_image import compress_image_to_data_url
from .model_routing import routed_chat_completion

# 表头 → 比对字段；顺序即报告里的列顺序
FIELD_LABELS = {"price": "到手价", "save": "立省", "tag_price": "吊牌价", "discount": "折扣", "fill": "充绒量"}
STATUSES = ("一致", "不一致", "文案待确认", "未识别")
SKU_HEADERS = {"sku", "货号", "款号", "款色号", "商品货号", "商品编码", "商品编号", "货品编码"}
NAME_HEADERS = {"商品名称", "简化标题", "名称", "品名", "商品名", "标题", "商品标题"}
COPY_HINTS = ("文案", "利益点", "卖点")
OCR_CONCURRENCY = 4
OCR_RETRIES = 2
MIN_SIDE = 120          # 任一边更小的是按钮、tab、标题条，不会有商品价格（单品小图常见 200x340，不能跳过）
UPSCALE_BELOW = 1400    # 宽度小于这个值的图放大后再识别，小字才读得准
TALL_RATIO = 2.6                  # 高宽比超过这个值的长图切段识别，否则字太小读不准
VERIFY_SIMILARITY = 0.7           # 图上文字和表格文案相似度超过这个值、又不完全相同时，再复核一次
MAX_DISPLAY_NAME = 16             # 表格名称超过这个长度的是后台长标题，图上不会原样出现，不核对文案

OCR_PROMPT = """这是一张电商页面的图片。按阅读顺序（从上到下，同一行从左到右）列出图中每一个商品，输出 JSON 数组，每项：
{"name": 商品名称原文（多行合在一起）, "texts": [这个商品格子里除价格数字外的其它文字，如卖点、标签，每条原文],
 "price": 最醒目的价格数字（到手价、闪购价等）, "price_label": 价格旁的小字标签原文,
 "save": 立省或立减的金额数字, "tag_price": 划线价或吊牌价数字（图上明确印着划线的原价、或标着"吊牌价"才填；立省金额不是吊牌价）, "discount": 折扣原文（如"4.8折"）, "fill": 含绒量、加绒等标签原文}
图上没有的字段写 null；文字和数字照图上原样写，不要改写或纠正，看不清写 null。
只列商品；标题、按钮、导航、活动规则不算。图里没有商品就输出 []。只输出 JSON。"""


class TableError(Exception):
    pass


# ── 表格 ──────────────────────────────────────────────────────────────────────

def _field_of(header: str) -> str | None:
    h = header.replace(" ", "").replace("\n", "")
    if not h:
        return None
    if any(k in h for k in ("吊牌", "划线", "原价", "市场价")):
        return "tag_price"
    if any(k in h for k in ("立省", "立减", "直降")):
        return "save"
    if "折扣" in h:
        return "discount"
    if any(k in h for k in ("充绒", "含绒", "加绒")):
        return "fill"
    if "到手" in h or (h.endswith("价") and "差价" not in h) or h == "价格":
        return "price"
    return None


_AMOUNT_FIELDS = {"price", "save", "tag_price"}
_AMOUNT_RE = re.compile(r"^[¥￥$]?\s*\d+(?:\.\d+)?\s*元?$")


def _usable(field_name: str, value: str) -> bool:
    """价格类的列只认金额；单元格里填的是路径、备注之类的内容时当作没填（表格里确实出现过把素材路径填进吊牌价的）。"""
    if not value:
        return False
    return bool(_AMOUNT_RE.match(value.replace(",", ""))) if field_name in _AMOUNT_FIELDS else True


def _cell(v) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip()


@dataclass
class Sheet:
    name: str
    headers: list[str]
    fields: dict[str, int]  # 比对字段 → 列号
    rows: list[dict] = field(default_factory=list)
    # 每行：{"sheet", "index", "group": [...], "order", "sku", "name", "copy": [...], "values": {field: str}}

    def groups(self) -> list[dict]:
        out: list[dict] = []
        for row in self.rows:
            if not out or out[-1]["group"] != row["group"]:
                out.append({"group": row["group"], "count": 0, "first": row["name"] or row["sku"], "priced": 0})
            out[-1]["count"] += 1
            out[-1]["priced"] += 1 if row["values"].get("price") else 0
        return out


def _sheet_rows(name: str, rows: list[list]) -> Sheet | None:
    rows = [[_cell(v) for v in r] for r in rows]

    def known(c: str) -> bool:
        return c.lower() in SKU_HEADERS or c in NAME_HEADERS or _field_of(c) is not None

    # 表头：前几行里第一个至少有两个认识的列名的行（标题行、说明行会排在它前面）
    header_idx = next((i for i, r in enumerate(rows[:10]) if sum(known(c) for c in r) >= 2), None)
    if header_idx is None:
        return None
    headers = rows[header_idx]
    sku_col = next((i for i, c in enumerate(headers) if c.lower() in SKU_HEADERS), None)
    name_col = next((i for i, c in enumerate(headers) if c in NAME_HEADERS), None)
    key_col = sku_col if sku_col is not None else name_col
    if key_col is None:
        return None
    copy_cols = [i for i, c in enumerate(headers) if any(k in c for k in COPY_HINTS) and i != name_col]
    fields: dict[str, int] = {}
    for i, h in enumerate(headers):
        f = _field_of(h)
        # 多个价格列时优先"到手价"
        if f and (f not in fields or (f == "price" and "到手" in h and "到手" not in headers[fields[f]])):
            fields[f] = i
    body = [r + [""] * (len(headers) - len(r)) for r in rows[header_idx + 1:]]
    data = [r for r in body if r[key_col]]
    # 关键列左边的列是分组（合并单元格）；"序号"列大多是数字时当序号，否则也当分组（例如写着"鞋履""服饰"）
    order_col = next((i for i, c in enumerate(headers[:key_col]) if c == "序号"), None)
    if order_col is not None:
        vals = [r[order_col] for r in data if r[order_col]]
        if sum(v.isdigit() for v in vals) < len(vals) / 2:
            order_col = None
    group_cols = [i for i in range(key_col) if i != order_col]
    sheet = Sheet(name=name, headers=headers, fields=fields)
    carried = [""] * len(group_cols)
    for r in body:
        for gi, col in enumerate(group_cols):
            if r[col].startswith("="):  # WPS 单元格图片（=DISPIMG(...)）之类的公式，不算分组名
                r[col] = ""
            if r[col]:
                carried[gi] = r[col].replace("\n", " ")
                for deeper in range(gi + 1, len(group_cols)):
                    if not r[group_cols[deeper]]:
                        carried[deeper] = ""
        if not r[key_col]:
            continue
        sheet.rows.append({
            "sheet": name, "index": len(sheet.rows), "group": [g for g in carried if g],
            "order": r[order_col] if order_col is not None else "",
            "sku": r[sku_col] if sku_col is not None else "",
            "name": r[name_col] if name_col is not None else "",
            "copy": [r[i] for i in copy_cols if r[i]],
            "values": {f: r[i] for f, i in fields.items() if _usable(f, r[i])},
        })
    return sheet


SLIM_ABOVE = 5 * 1024 * 1024


def slim_xlsx(data: bytes, filename: str) -> bytes:
    """去掉 Excel 里嵌的图片（xl/media）和外部链接缓存（xl/externalLinks），只留文字和数字：
    核对用不到它们，带着的话文件动辄几十上百 MB。去掉后解析不了就原样返回。"""
    if len(data) <= SLIM_ABOVE or not filename.lower().endswith((".xlsx", ".xlsm")):
        return data
    try:
        out = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(data)) as src, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as dst:
            for info in src.infolist():
                if not info.filename.lower().startswith(("xl/media/", "xl/externallinks/")):
                    dst.writestr(info, src.read(info.filename))
        slim = out.getvalue()
        load_table(slim, filename)
        return slim
    except Exception:
        return data


def load_table(data: bytes, filename: str) -> list[Sheet]:
    if filename.lower().endswith(".csv"):
        text = None
        for encoding in ("utf-8-sig", "gbk"):
            try:
                text = data.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
        sheet = _sheet_rows("Sheet1", list(csv.reader(io.StringIO(text or data.decode("utf-8", errors="replace")))))
        sheets = [sheet] if sheet and sheet.rows else []
    else:
        try:
            # keep_links=False：不读外部链接缓存（引用了别的工作簿的表，这部分解压后能有几百 MB，读它要几分钟）
            wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True, read_only=True, keep_links=False)
        except Exception as exc:
            raise TableError(f"表格打不开：{exc}") from exc
        sheets = []
        for ws in wb.worksheets:
            sheet = _sheet_rows(ws.title, [list(r) for r in ws.iter_rows(values_only=True)])
            if sheet and sheet.rows:
                sheets.append(sheet)
    if not sheets:
        raise TableError("表格里没有找到商品表（需要有货号/SKU 或商品名称列）")
    return sheets


TABLE_IMAGE_PROMPT = """这是一张表格的截图。把表格逐行原样抄成 JSON：{{"headers": [列名...], "rows": [[每个单元格的文字...], ...]}}
- 每一行的单元格数量和列名数量一致，空单元格写 ""；数字和文字照截图原样写，不要计算、不要补全。
- 合并单元格（跨多行的模块名等）只在它开始的那一行写值，下面的行写 ""。
{hint}只输出 JSON。"""


async def load_table_image(data: bytes) -> list[Sheet]:
    """把表格截图读成表格。长截图切段读，后面的段沿用第一段的表头。"""
    parts = await asyncio.to_thread(_image_parts, data)
    if not parts:
        raise TableError("表格截图太小，看不清")
    headers: list[str] = []
    rows: list[list] = []
    for part in parts:
        hint = f"- 这是长截图的后半段，可能没有表头，列的顺序是：{json.dumps(headers, ensure_ascii=False)}，headers 照这个填。\n" if headers else ""
        last: Exception | None = None
        for _ in range(OCR_RETRIES + 1):
            try:
                resp = await routed_chat_completion("vlm", {"messages": [{"role": "user", "content": [
                    {"type": "text", "text": TABLE_IMAGE_PROMPT.format(hint=hint)},
                    {"type": "image_url", "image_url": {"url": compress_image_to_data_url(part, 2000)}}]}],
                    "max_tokens": 8000, "temperature": 0}, timeout=180)
                parsed = json.loads(re.search(r"\{.*\}", resp.json()["choices"][0]["message"]["content"], re.S).group(0))
                headers = headers or [str(h) for h in parsed.get("headers") or []]
                rows.extend(r for r in parsed.get("rows") or [] if isinstance(r, list))
                last = None
                break
            except Exception as exc:
                last = exc
        if last:
            raise TableError(f"表格截图识别失败：{last}")
    sheet = _sheet_rows("表格截图", [headers, *rows])
    if not sheet or not sheet.rows:
        raise TableError("截图里没有认出商品表（需要有货号/SKU 或商品名称列）")
    for row in sheet.rows:
        row["from_image"] = True  # 截图里的文字可能读错：文案只差一两个字的不报
    return [sheet]


def table_warnings(sheets: list[Sheet]) -> list[str]:
    """表格自己算不通的行：吊牌价 − 立省 ≠ 到手价（表格填错，或截图读错）。"""
    out = []
    for sheet in sheets:
        for row in sheet.rows:
            tag, save, price = (_num(row["values"].get(f)) for f in ("tag_price", "save", "price"))
            if None not in (tag, save, price) and abs(tag - save - price) > 0.01:
                out.append(f"{sheet.name} {row['sku']} {row['name']}：吊牌价 {tag:g} − 立省 {save:g} = {tag - save:g}，到手价写的是 {price:g}")
    return out


def pick_sheets(sheets: list[Sheet], wanted: list[str]) -> list[Sheet]:
    """只留用户点名的工作表（名字不用写全，忽略大小写和空格）。"""
    keys = [_clean(w) for w in wanted if _clean(w)]
    if not keys:
        return sheets
    picked = [s for s in sheets if any(k in _clean(s.name) or _clean(s.name) in k for k in keys)]
    if not picked:
        raise TableError(f"表格里没有叫「{'、'.join(wanted)}」的工作表，现有：{'、'.join(s.name for s in sheets)}")
    return picked


def overview(sheets: list[Sheet]) -> list[dict]:
    """给模型看的表格概览：每页的比对字段和分组（合并单元格的模块）。"""
    return [{"sheet": s.name, "fields": {FIELD_LABELS[f]: s.headers[i] for f, i in s.fields.items()},
             "rows": len(s.rows), "groups": s.groups()} for s in sheets]


# ── 识别 ──────────────────────────────────────────────────────────────────────

def split_tall(im: Image.Image) -> list[Image.Image]:
    """长图切成几段分别识别。切口选在附近颜色最单一的一行（商品之间的留白），避免把一个商品切成两半。"""
    w, h = im.size
    if h <= w * TALL_RATIO:
        return [im]
    count = math.ceil(h / (w * 2))
    gray = im.convert("L").resize((48, h))
    pixels = gray.load()

    def spread(y: int) -> int:
        row = [pixels[x, y] for x in range(48)]
        return max(row) - min(row)

    cuts = [0]
    window = int(h / count * 0.15)
    for k in range(1, count):
        target = round(h * k / count)
        lo, hi = max(cuts[-1] + 1, target - window), min(h - 1, target + window)
        cuts.append(min(range(lo, hi + 1), key=lambda y: (spread(y), abs(y - target))))
    cuts.append(h)
    return [im.crop((0, a, w, b)) for a, b in zip(cuts, cuts[1:])]


async def _ocr_one(data: bytes) -> list[dict]:
    last: Exception | None = None
    for _ in range(OCR_RETRIES + 1):
        try:
            resp = await routed_chat_completion("vlm", {"messages": [{"role": "user", "content": [
                {"type": "text", "text": OCR_PROMPT},
                {"type": "image_url", "image_url": {"url": compress_image_to_data_url(data, 2000)}}]}],
                "max_tokens": 4000, "temperature": 0}, timeout=150)
            content = (resp.json()["choices"][0]["message"]["content"] or "")
            match = re.search(r"\[.*\]", content, re.S)
            items = json.loads(match.group(0)) if match else None
            if isinstance(items, list):
                return [i for i in items if isinstance(i, dict)]
            last = ValueError("识别结果不是列表")
        except Exception as exc:  # 线路断开、JSON 不完整等都重试
            last = exc
    raise RuntimeError(f"识别失败：{last}")


def _image_parts(data: bytes) -> list[bytes] | None:
    """识别前的预处理：太小的图返回 None；长图切段；小图放大。"""
    with Image.open(io.BytesIO(data)) as im:
        im.seek(0)
        if im.width < MIN_SIDE or im.height < MIN_SIDE:
            return None
        out = []
        for part in split_tall(im.convert("RGB")):
            if part.width < UPSCALE_BELOW:
                scale = min(3.0, UPSCALE_BELOW / part.width)
                part = part.resize((round(part.width * scale), round(part.height * scale)), Image.LANCZOS)
            buf = io.BytesIO()
            part.save(buf, format="PNG")
            out.append(buf.getvalue())
        return out


async def ocr_image(data: bytes) -> list[dict] | None:
    """返回图上的商品列表；图片太小（按钮、图标）返回 None。"""
    parts = await asyncio.to_thread(_image_parts, data)
    if parts is None:
        return None
    items: list[dict] = []
    for part in parts:
        items.extend(await _ocr_one(part))
    return items


VERIFY_PROMPT = """这张图上有一些文字。下面每一项给出两种写法，其中最多一种是图上真实的写法（差别可能只有一两个字）。
请放大仔细看图上对应的文字，逐项回答图上到底是哪一种。不要猜，也不要按常识选更通顺的那个，只看图。
{items}
输出 JSON 数组，每项 {{"i": 序号, "answer": "A" 或 "B" 或 "都不是"}}。只输出 JSON。"""


async def verify_wording(data: bytes, pairs: list[tuple[str, str]]) -> list[bool]:
    """第一遍识别出的文字和表格只差一点时，让模型在两种写法里二选一复核。返回每一项"图上写的是表格文案"是否成立。
    两种写法的先后按内容排序，不让模型看出哪个来自表格。"""
    def prepare() -> bytes:
        with Image.open(io.BytesIO(data)) as im:
            im.seek(0)
            part = im.convert("RGB")
            if part.width < UPSCALE_BELOW:
                scale = min(3.0, UPSCALE_BELOW / part.width)
                part = part.resize((round(part.width * scale), round(part.height * scale)), Image.LANCZOS)
            buf = io.BytesIO()
            part.save(buf, format="PNG")
            return buf.getvalue()

    options = [sorted([table, seen]) for table, seen in pairs]
    lines = "\n".join(f"{i}. A「{a}」 B「{b}」" for i, (a, b) in enumerate(options))
    try:
        resp = await routed_chat_completion("vlm", {"messages": [{"role": "user", "content": [
            {"type": "text", "text": VERIFY_PROMPT.format(items=lines)},
            {"type": "image_url", "image_url": {"url": compress_image_to_data_url(await asyncio.to_thread(prepare), 2000)}}]}],
            "max_tokens": 1000, "temperature": 0}, timeout=120)
        answers = json.loads(re.search(r"\[.*\]", resp.json()["choices"][0]["message"]["content"], re.S).group(0))
        picked = {int(a["i"]): str(a.get("answer") or "").strip().upper() for a in answers if isinstance(a, dict)}
    except Exception:
        return [False] * len(pairs)  # 复核失败就维持"待确认"
    return [picked.get(i) == "AB"[options[i].index(table)] for i, (table, _seen) in enumerate(pairs)]


def sanitize_item(item: dict) -> dict:
    """去掉明显读串了的数字：吊牌价不可能小于等于到手价或立省金额（常见错误是把立省的数字又填进吊牌价）。
    金额去掉货币符号（"¥559" → "559"），报出来的读数格式统一。"""
    item = {**item, **{f: re.sub(r"^[¥￥\s]+|[元\s]+$", "", item[f]) for f in ("price", "save", "tag_price")
                       if isinstance(item.get(f), str)}}
    tag, price, save = _num(item.get("tag_price")), _num(item.get("price")), _num(item.get("save"))
    if tag is not None and ((price is not None and tag <= price) or (save is not None and tag <= save)):
        item = dict(item, tag_price=None)
    return item


# ── 对应 ──────────────────────────────────────────────────────────────────────

def _clean(text) -> str:
    return re.sub(r"[^0-9a-z一-鿿]+", "", unicodedata.normalize("NFKC", str(text or "")).lower())


def _num(v) -> float | None:
    m = re.search(r"\d+(?:\.\d+)?", str(v)) if v not in (None, "") else None
    return float(m.group(0)) if m else None


def _item_text(item: dict) -> str:
    texts = item.get("texts") if isinstance(item.get("texts"), list) else []
    return _clean(" ".join(str(t) for t in [item.get("name"), *texts, item.get("fill"), item.get("price_label")] if t))


# ── 比对 ──────────────────────────────────────────────────────────────────────

def _same(table_value: str, image_value) -> bool:
    t = _num(table_value)
    if t is None:  # 例如充绒量写"加绒"：图上的标签里包含这几个字就算一致
        return bool(image_value) and _clean(table_value) in _clean(image_value)
    return t == _num(image_value)


def _closest_piece(item: dict, text: str) -> tuple[str, float]:
    """图上这个商品的文字里和表格文案最像的一条，以及相似度。"""
    texts = item.get("texts") if isinstance(item.get("texts"), list) else []
    pieces = [str(t) for t in [item.get("name"), *texts] if t]
    scored = [(p, SequenceMatcher(None, _clean(p), _clean(text)).ratio()) for p in pieces]
    return max(scored, key=lambda x: x[1]) if scored else ("", 0.0)


def _on_image(item: dict, text: str) -> bool:
    """表格文案在图上原样出现。识别时常把一句文案拆成名称和补充文字两段（"长袖T恤" + "保暖亲肤"），
    两段按任意先后拼起来正好是表格文案，也算出现了：两段都必须原样在图上。"""
    target = _clean(text)
    if target in _item_text(item):
        return True
    texts = item.get("texts") if isinstance(item.get("texts"), list) else []
    pieces = [_clean(p) for p in [item.get("name"), *texts] if p]
    return any(i != j and target in pieces[i] + pieces[j] for i in range(len(pieces)) for j in range(len(pieces)))


def wording_diffs(item: dict, row: dict) -> list[tuple[str, str, float]]:
    """表格里要出现在图上的文案（短名称、利益点），图上没有原样出现的：[(表格文案, 图上最像的一条, 相似度)]。"""
    texts = ([row["name"]] if row["name"] and len(_clean(row["name"])) <= MAX_DISPLAY_NAME else []) + row["copy"]
    return [(text, *_closest_piece(item, text)) for text in texts if _clean(text) and not _on_image(item, text)]


def field_diffs(item: dict, row: dict, shown: set[str]) -> tuple[list[str], list[str]]:
    """返回 (数值不一致的字段, 图上没读到的字段)。shown：这张图上出现过的字段，整张图都没有的字段不比。"""
    wrong, unread = [], []
    for f, table_value in row["values"].items():
        if f not in shown:
            continue
        if f == "fill" and ("%" in table_value) != ("%" in str(item.get(f) or "%")):
            continue  # 表格写含绒比例、图上印的是充绒克重（或反过来），不是同一个指标
        if item.get(f) in (None, ""):
            unread.append(f)
        elif not _same(table_value, item.get(f)):
            wrong.append(f)
    return wrong, unread


def differences(item: dict, row: dict, shown: set[str], confirmed: frozenset = frozenset()) -> list[dict]:
    """图上这个商品和表格这一行的差异，每项 {"kind": 价格/文案/没读到, "label", "table", "image"}。
    confirmed：复核后确认图上写的就是表格文案的那些（第一遍识别认错了字）。"""
    wrong, unread = field_diffs(item, row, shown)
    out = [{"kind": "价格", "label": FIELD_LABELS[f], "table": row["values"][f], "image": str(item.get(f))} for f in wrong]
    out += [{"kind": "文案", "label": "文案", "table": text, "image": (piece or item.get("name") or "").replace("\n", " ")}
            for text, piece, _sim in wording_diffs(item, row) if text not in confirmed]
    out += [{"kind": "没读到", "label": FIELD_LABELS[f], "table": row["values"][f], "image": ""} for f in unread]
    return out


def judge(item: dict, row: dict, shown: set[str], confirmed: frozenset = frozenset()) -> tuple[str, list[str]]:
    diffs = differences(item, row, shown, confirmed)
    kinds = {d["kind"] for d in diffs}
    if "价格" in kinds:
        status, used = "不一致", [d for d in diffs if d["kind"] != "没读到"]
    elif "文案" in kinds:
        status, used = "文案待确认", [d for d in diffs if d["kind"] == "文案"]
    elif "没读到" in kinds:
        return "未识别", ["图上没读到" + "、".join(d["label"] for d in diffs) + "，请人工看一下"]
    else:
        return "一致", []
    quote = lambda d, v: f" {v}" if d["kind"] == "价格" else f"「{v}」"
    return status, [f"{d['label']}：表格{quote(d, d['table'])}，图上{quote(d, d['image'])}" for d in used]


def _same_item(item: dict, again: list[dict]) -> dict | None:
    """第二遍识别结果里对应的那个商品：读出了名称就按名称找最像的（要足够像，一样像的取位置近的）；
    没读出名称才按位置取。不能先按位置取：第二遍多读出一个商品（例如 KV 大图）时位置会错开，
    相邻商品名称又常常很像（"保暖短羽绒服""高蓬锁暖羽绒服"），会拿隔壁商品的读数把真错误"确认"掉。"""
    name = _clean(item.get("name"))
    if not name:
        return again[item["_pos"] - 1] if 0 < item["_pos"] <= len(again) else None
    scored = [(SequenceMatcher(None, name, _clean(it.get("name"))).ratio(), -abs(i - (item["_pos"] - 1)), i)
              for i, it in enumerate(again)]
    best = max(scored, default=(0, 0, -1))
    return again[best[2]] if best[0] >= 0.8 else None


# ── 图片对应到表格分组：交给模型判断 ─────────────────────────────────────────
# 图片对应表格哪一组、从这一组第几个开始，要看文件夹名、文件名、图上的商品，规则写不全，交给模型判断。
# 模型只做对应，不碰数字：图上的内容是事先"盲读"出来的（读的时候不看表格），比对由程序完成。

ASSIGN_PROMPT = """你在帮电商运营核对首页成品图上的价格和文案。表格是对的，图片要以表格为准去检查。
下面给出表格的分组（每组有价格的商品按顺序列出），以及同一个文件夹里每张图的路径和图上识别出的商品（从左上角开始、从左到右、从上到下的顺序）。

请判断每张图对应表格的哪一组，以及图上第 1 个带价格的商品对应这一组第几个带价格的商品（start，从 1 开始）。
- 主要看文件夹名、文件名：例如"11-新品上市/女-服饰.png"对应"新品上市 / 女子 / 服饰"；"城市漫游/男/男子-3.jpg"是单品卡片，对应"城市漫游 / 男款"的第 3 个。
- 位置是固定的：表格这一组第 k 个带价格的商品，就印在图上第 k 个带价格的位置。图上的名称、价格和表格不一样，正是要报出来的错误，不能因此换组或错开位置去凑价格。
- 同一组的切片（_01、_02）、单品卡片要接着往下数（前面的切片没有商品时，下一张仍从第 1 个开始）；完整海报、修改版、不同尺寸从第 1 个开始。
- 同一张图在子文件夹里还有一份（例如文件夹名是日期 1104，或带"旧""备份""改"）时，判断哪份是正式版、哪份是旧版本：
  路径后面括号里是文件的修改时间，一般修改时间最新的那份是正式版；旧版本 group 填 null；拿不准时两份都核对。group 和 reason 要一致：reason 里说不核对，group 就填 null。
- 表格里不带价格的是 KV 位，对应图上不带价格的主推大图，不算在 start 的计数里；
  图上只有不带价格的大图时，start 填它对应这一组第几个 KV 位。
- 有的组（例如"KV"组）每个商品前面括号里写着它所属的模块（温度段、场景、品类等），每个商品各印在对应模块的主图上：
  模块文件夹里和模块同名的主图（不是男/女/童单品卡片），对应这一组里括号写着该模块的商品，start 填它在组里的序号。
- 和表格无关的图（导航、按钮、背景、活动规则），或者同一组已经有正式版、这张明显是旧版本的，group 填 null，并在 reason 里说明。

表格分组：
{groups}

这次要判断的图（{folder}）：
{images}
{others}

只输出 JSON 数组，每张图一项：[{{"image": 图片编号, "group": 分组编号或 null, "start": 数字, "reason": "一句话依据"}}]"""


ASSIGN_BATCH = 40       # 图片不多时一次交给模型判断，能看全版本关系；多了按模块分批
MAX_OTHER_PATHS = 300


def _group_catalog(sheets: list[Sheet]) -> list[dict]:
    """表格分组目录：给模型看的编号、名称和组里的商品。"""
    groups: dict[tuple, dict] = {}
    for sheet in sheets:
        for row in sheet.rows:
            key = (row["sheet"], tuple(row["group"]))
            entry = groups.setdefault(key, {"key": key, "name": group_name(row), "priced": [], "plain": []})
            (entry["priced"] if row["values"] else entry["plain"]).append(row)
    return [dict(g, id=i + 1) for i, g in enumerate(groups.values())]


def _describe_row(row: dict) -> str:
    """分组目录里的一行：序号列写的字（例如 KV 行写着"0~10℃"，对应哪个模块的线索）+ 名称 + 利益点文案。"""
    label = f"（{row['order']}）" if row["order"] and not str(row["order"]).isdigit() else ""
    copy = f"｜{'、'.join(row['copy'])}" if row["copy"] else ""
    return f"{label}{row['name'] or row['sku']}{copy}"


def _describe_groups(catalog: list[dict]) -> str:
    lines = []
    for g in catalog:
        priced = "；".join(f"{k + 1}.{_describe_row(r)}" for k, r in enumerate(g["priced"][:12]))
        plain = "；".join(f"{k + 1}.{_describe_row(r)}" for k, r in enumerate(g["plain"][:12]))
        lines.append(f"[{g['id']}] {g['name']}｜带价格：{priced or '无'}" + (f"｜KV 位：{plain}" if plain else ""))
    return "\n".join(lines)


def _describe_image(number: int, rel: str, items, date: str = "") -> str:
    if date:
        rel = f"{rel}（修改于 {date}）"
    if isinstance(items, Exception):
        return f"[{number}] {rel}：识别失败"
    if not items:
        return f"[{number}] {rel}：图上没有商品"
    shown = []
    for k, it in enumerate(items, 1):
        price = "、".join(f"{FIELD_LABELS[f]}{it.get(f)}" for f in ("save", "price") if it.get(f) not in (None, ""))
        shown.append(f"{k}.{it.get('name') or '（没读出名称）'}" + (f"（{price}）" if price else "（不带价格）"))
    return f"[{number}] {rel}：" + "；".join(shown)


async def assign_groups(folder: str, entries: list[tuple[str, object]], catalog: list[dict],
                        others: list[str] | None = None, dates: dict[str, str] | None = None) -> dict[str, dict]:
    """让模型判断这一批图（同一模块）每张对应表格哪一组、从第几个开始。返回 {图片路径: {"group": 目录项或 None, "start", "reason"}}。
    others：这次一起核对、但不在这一批的图片路径，只给模型判断版本关系用（例如同一张图在日期子文件夹里还有一份）。
    dates：{图片路径: 修改时间}，判断同一张图几份里哪份是正式版的依据。"""
    dates = dates or {}
    stamp = lambda rel: f"{rel}（修改于 {dates[rel]}）" if rel in dates else rel
    others_text = ("这次一起核对的其它图片（只用来判断版本关系，不用给它们结果）：\n" + "\n".join(map(stamp, others[:MAX_OTHER_PATHS]))
                   if others else "")
    prompt = ASSIGN_PROMPT.format(groups=_describe_groups(catalog), folder=folder or "用户给的文件夹",
                                  images="\n".join(_describe_image(i + 1, rel, items, dates.get(rel, ""))
                                                   for i, (rel, items) in enumerate(entries)),
                                  others=others_text)
    by_id = {g["id"]: g for g in catalog}
    out: dict[str, dict] = {}
    problems: dict[str, str] = {rel: "模型没有给出这张图的对应" for rel, _items in entries}
    for attempt in range(OCR_RETRIES + 1):
        todo = [n for n, (rel, _items) in enumerate(entries) if rel not in out]
        if not todo:
            break
        ask = prompt
        if attempt:  # 重试时告诉模型上次哪几张没答好
            ask += "\n\n上一次的回答有问题，请重新给出全部图片的结果，特别注意：\n" + "\n".join(
                f"图片 {n + 1}：{problems[entries[n][0]]}" for n in todo[:20])
        try:
            resp = await routed_chat_completion("check_llm", {"messages": [{"role": "user", "content": ask}],
                                                              "temperature": 0}, timeout=120)
            content = resp.json()["choices"][0]["message"]["content"] or ""
            answers = json.loads(re.search(r"\[.*\]", content, re.S).group(0))
        except Exception as exc:  # 线路断开、JSON 不完整都重试
            for n in todo:
                problems[entries[n][0]] = f"模型服务异常：{exc}"
            continue
        seen: dict[int, list[dict]] = {}
        for a in answers if isinstance(answers, list) else []:
            if isinstance(a, dict) and str(a.get("image", "")).strip().isdigit():
                seen.setdefault(int(a["image"]) - 1, []).append(a)
        for n in todo:
            rel, items = entries[n]
            given = seen.get(n, [])
            if not given:
                problems[rel] = "模型没有给出这张图的对应"
                continue
            decisions = [_check_answer(a, items, by_id) for a in given]
            errors = [error for _decision, error in decisions if error]
            if errors:
                problems[rel] = errors[0]
            elif len({(d["group"] or {}).get("id") for d, _e in decisions}) > 1 or len({d["start"] for d, _e in decisions}) > 1:
                problems[rel] = "同一张图给出了不同的对应"
            else:
                out[rel] = decisions[0][0]
    # 重试用完仍没有有效对应的：明确标成"判断对应分组失败"，和模型明确判断"不对应表格"（group 为 null）区分开
    for rel, _items in entries:
        if rel not in out:
            out[rel] = {"group": None, "start": 1, "reason": f"判断对应分组失败：{problems[rel]}", "error": True}
    return out


def _check_answer(answer: dict, items, by_id: dict) -> tuple[dict | None, str]:
    """检查模型对一张图的回答：分组编号要在目录里（或明确填 null 表示不对应），start 要在这一组的范围内。
    返回 (对应, 问题)，有问题时对应为 None。"""
    reason = str(answer.get("reason") or "").strip()
    raw = answer.get("group")
    if raw is None or str(raw).strip().lower() in ("", "null", "none"):
        return {"group": None, "start": 1, "reason": reason}, ""
    if not str(raw).strip().isdigit() or int(raw) not in by_id:
        return None, f"分组编号 {raw} 不在表格分组目录里"
    group = by_id[int(raw)]
    try:
        start = int(answer.get("start") or 1)
    except (TypeError, ValueError):
        return None, f"start {answer.get('start')!r} 不是数字"
    priced = isinstance(items, list) and any(_has_price(it) for it in items)
    # 带价格的图：start 指带价格的商品；只有不带价格大图的：指 KV 位（也可能是价格没读出来的带价格商品）
    limit = len(group["priced"]) if priced else max(len(group["plain"]), len(group["priced"]))
    if not 1 <= start <= max(limit, 1):
        return None, f"start {start} 超出了第 {raw} 组的范围（1~{max(limit, 1)}）"
    return {"group": group, "start": start, "reason": reason}, ""


def _has_price(item: dict) -> bool:
    return any(item.get(f) not in (None, "") for f in ("price", "save", "tag_price"))


def pair_by_position(items: list[dict], group: dict, start: int, reason: str) -> tuple[list[tuple[dict, dict]], list[dict]]:
    """按位置一一对应：图上第 k 个带价格的商品对这一组第 start+k-1 个带价格的商品；不带价格的（KV 大图）对 KV 位。
    图上只有不带价格的大图时（例如每个模块一张 KV 主图），start 指这一组第几个 KV 位。
    名称和价格不参与决定对应谁，只用来报差异。返回 (配对, 图上多出来的商品)。"""
    priced = [it for it in items if _has_price(it)]
    plain = [it for it in items if not _has_price(it)]
    if not priced:
        got = list(zip(plain, group["plain"][start - 1:]))
    else:
        got = list(zip(priced, group["priced"][start - 1:]))
        if start == 1:  # 接着上一张往下数的切片、单品卡片不再对 KV 位
            got += list(zip(plain, group["plain"]))
    for item, row in got:
        where = (f"表格这一组第 {group['priced'].index(row) + 1} 个带价格的商品" if row in group["priced"]
                 else f"表格这一组第 {group['plain'].index(row) + 1} 个 KV 位")
        item["_basis"] = f"对应到「{group['name']}」，{where}" + (f"（{reason}）" if reason else "")
    return sorted(got, key=lambda p: p[0]["_pos"]), priced[len(group["priced"][start - 1:]):]


async def run_check(images: list[tuple[str, object]], sheets: list[Sheet], notify=None, base: str = "",
                    dates: dict[str, str] | None = None) -> dict:
    """images：[(相对路径, 读取函数)]，读取函数返回图片内容。notify(文字)：进度提示。dates：{相对路径: 修改时间}。
    base：用户给的文件夹路径。用户直接指到模块文件夹（例如 …/11-新品上市）时，模块名只在这里，对应时要带上。"""
    async def say(text: str):
        if notify:
            await notify(text)

    await say(f"正在识别图片 0/{len(images)}")
    sem = asyncio.Semaphore(OCR_CONCURRENCY)
    cache: dict[str, asyncio.Task] = {}
    done = 0

    async def one(rel: str, loader):
        nonlocal done
        try:
            data = await asyncio.to_thread(loader)
            digest = hashlib.md5(data).hexdigest()
            if digest not in cache:  # 内容完全相同的图（各版本文件夹里的重复文件）只识别一次

                async def recognise():
                    async with sem:
                        return await ocr_image(data)
                cache[digest] = asyncio.ensure_future(recognise())
            return await cache[digest]
        except Exception as exc:
            return exc
        finally:
            done += 1
            await say(f"正在识别图片 {done}/{len(images)}")

    results = await asyncio.gather(*[one(rel, loader) for rel, loader in images])
    failed, small, empty = [], 0, []
    read: dict[str, object] = {}  # 图片路径 → 识别出的商品（或识别失败的异常、空列表）
    for (rel, _loader), result in zip(images, results):
        if isinstance(result, Exception):
            failed.append(f"{rel}：{result}")
        elif result is None:  # 按钮、tab 之类的小图，不需要核对，也不交给模型判断
            small += 1
            continue
        elif not result:
            empty.append(rel)
        else:
            parts = [p for p in re.split(r"[/\\]", rel) if p]
            result = [sanitize_item(it) for it in result]
            shown = {f for f in FIELD_LABELS if any(it.get(f) not in (None, "") for it in result)}
            result = [dict(it, _image=rel, _path=parts, _pos=i + 1, _shown=shown) for i, it in enumerate(result)]
        read[rel] = result

    # 交给模型判断每张图对应哪一组：图不多时一次全给，能看全切片、单品卡片和各版本的关系；
    # 多了按模块（第一级文件夹）分批，每批附上其它图片的路径，用来判断版本关系
    catalog = _group_catalog(sheets)
    batches: dict[str, list[tuple[str, object]]] = {}
    for rel, result in read.items():
        key = "" if len(read) <= ASSIGN_BATCH or "/" not in rel else rel.split("/", 1)[0]
        batches.setdefault(key, []).append((rel, result))
    await say(f"正在判断 {len(read)} 张图对应表格哪一组")
    decisions: dict[str, dict] = {}
    everything = list(read)
    for answer in await asyncio.gather(*[
            assign_groups("/".join(p for p in (base, key) if p), entries, catalog,
                          [rel for rel in everything if rel not in dict(entries)] if len(batches) > 1 else None,
                          dates=dates)
            for key, entries in batches.items()]):
        decisions.update(answer)

    pairs, unmatched, covered, assigned = [], [], set(), []
    for rel, result in read.items():
        decision = decisions.get(rel) or {"group": None, "start": 1, "reason": "判断对应分组失败：模型没有给出对应",
                                          "error": True}
        group = decision["group"]
        # unassigned：没能判断对应哪一组（模型服务异常或回答无效），没有核对；skipped：模型明确判断不对应表格
        status = ("unassigned" if decision.get("error") else "failed" if isinstance(result, Exception)
                  else "empty" if not result else "skipped" if group is None else "read")
        assigned.append({"image": rel, "group": group["key"] if group else None, "status": status,
                         "reason": decision["reason"]})
        if status != "read":
            if status == "skipped" and result:
                unmatched.extend(result)
            continue
        got, extra = pair_by_position(result, group, decision["start"], decision["reason"])
        unmatched.extend(extra)
        for item, row in got:
            covered.add((row["sheet"], row["index"]))
            pairs.append((item, row))

    # 文案对不上的再确认一遍，按图片分组：
    # - 重新读一遍图，读出来的文字里有表格文案 → 第一遍漏读或读错了；
    # - 只差一两个字的（容易被"读顺"），还要二选一复核也认定图上是表格的写法，两者都成立才不报。漏报比误报严重。
    loaders = dict(images)
    doubts: dict[str, list[tuple[int, str, str, bool]]] = {}
    confirmed: dict[int, set[str]] = {}
    for idx, (item, row) in enumerate(pairs):
        for text, piece, sim in wording_diffs(item, row):
            near = bool(piece) and sim >= VERIFY_SIMILARITY
            if near and row.get("from_image"):  # 表格来自截图：分不清是截图读错还是图上写错，不报
                confirmed.setdefault(idx, set()).add(text)
            else:
                doubts.setdefault(item["_image"], []).append((idx, text, piece, near))
    if doubts:
        await say(f"图片识别完成，正在复核 {len(doubts)} 张图上对不上的文案")

    async def recheck(rel: str, todo: list[tuple[int, str, str, bool]]):
        async with sem:
            try:
                data = await asyncio.to_thread(loaders[rel])
                seen = " ".join(_item_text(it) for it in (await ocr_image(data) or []))
            except Exception:
                return [False] * len(todo)
            reread = [_clean(text) in seen for _idx, text, _piece, _near in todo]
            close = [(n, text, piece) for n, (_idx, text, piece, near) in enumerate(todo) if near and reread[n]]
            if close:
                verdicts = await verify_wording(data, [(text, piece) for _n, text, piece in close])
                for (n, _text, _piece), ok in zip(close, verdicts):
                    reread[n] = ok
            return reread

    for todo, verdicts in zip(doubts.values(), await asyncio.gather(*[recheck(rel, todo) for rel, todo in doubts.items()])):
        for (idx, text, _piece, _near), ok in zip(todo, verdicts):
            if ok:
                confirmed.setdefault(idx, set()).add(text)

    # 数字不一致的再读一遍图：两遍读数不同、且第二遍和表格一致的，是第一遍读错了，不算不一致
    suspects: dict[str, list[tuple[dict, dict, list[str]]]] = {}
    for item, row in pairs:
        wrong, _unread = field_diffs(item, row, item["_shown"])
        if wrong:
            suspects.setdefault(item["_image"], []).append((item, row, wrong))

    if suspects:
        await say(f"正在重新读取 {len(suspects)} 张数字对不上的图，确认不是读错")

    async def reread(rel: str):
        async with sem:
            try:
                again = await ocr_image(await asyncio.to_thread(loaders[rel]))
            except Exception:
                return None
            return [sanitize_item(it) for it in again] if again else None

    for (rel, todo), again in zip(suspects.items(), await asyncio.gather(*[reread(rel) for rel in suspects])):
        if not again:
            continue
        for item, row, wrong in todo:
            second = _same_item(item, again)
            for f in wrong:
                if second is not None and _same(row["values"][f], second.get(f)):
                    item[f] = second.get(f)

    records = []
    for idx, (item, row) in enumerate(pairs):
        status, problems = judge(item, row, item["_shown"], frozenset(confirmed.get(idx, ())))
        records.append({"status": status, "problems": problems, "item": item, "row": row,
                        "diffs": differences(item, row, item["_shown"], frozenset(confirmed.get(idx, ())))})
    # 以表格为准：只报表格里的内容在图上对不上的。
    # "表格有、图上没找到"只看这次核对到的分组：只核对一个模块文件夹时，不把整份表其他模块都列进来
    touched = {a["group"] for a in assigned if a["group"]}
    uncovered = [row for sheet in sheets for row in sheet.rows if row["values"]
                 and (row["sheet"], tuple(row["group"])) in touched and (row["sheet"], row["index"]) not in covered]
    unassigned = [f"{a['image']}：{a['reason']}" for a in assigned if a["status"] == "unassigned"]
    return {"records": records, "unmatched": unmatched, "uncovered": uncovered, "failed": failed, "assigned": assigned,
            "unassigned": unassigned,
            "skipped_small": small, "no_product_images": empty, "image_count": len(images)}


# ── 核对范围（以表格为准）────────────────────────────────────────────────────

def group_name(row: dict) -> str:
    return " / ".join([row["sheet"], *row["group"]])


def coverage(sheets: list[Sheet], result: dict, whole_sheets: bool = False) -> list[dict]:
    """以表格为准，按分组交代这次的核对情况：核对无误、有问题、部分商品没核对到、没有核对（附原因）。
    范围按输入来定：有图（包括识别失败、没识别出商品的）对应到的分组；
    whole_sheets=True（用户点名了工作表）时，这些工作表的每一组都算在范围里。
    只核对一个子文件夹时，不把同一工作表的其它分组都列成"没有核对"（它们见 groups_without_images）。"""
    records, assigned = result["records"], result.get("assigned", [])
    touched = _touched_groups(result)
    groups: dict[tuple, list[dict]] = {}
    for sheet in sheets:
        for row in sheet.rows:
            key = (row["sheet"], tuple(row["group"]))
            if row["values"] and (key in touched or whole_sheets):
                groups.setdefault(key, []).append(row)
    names = {key: group_name(rows[0]) for key, rows in groups.items()}
    for r in records:  # 只有 KV 位（不带价格）的组：核对到了文案，也要在分组结论里交代
        key = (r["row"]["sheet"], tuple(r["row"]["group"]))
        if key not in groups:
            groups[key], names[key] = [], group_name(r["row"])
    why_not = {"failed": "识别失败", "empty": "上没识别出商品"}
    out = []
    for key, rows in groups.items():
        recs = [r for r in records if (r["row"]["sheet"], tuple(r["row"]["group"])) == key]
        checked = {id(r["row"]) for r in recs}
        missing = [r for r in rows if id(r) not in checked]
        priced_ids = {id(r) for r in rows}  # 只数带价格的商品；KV 位的文案问题在卡片和明细里照样列出
        bad = list(dict.fromkeys(id(r["row"]) for r in recs if r["status"] != "一致"))
        bad_priced = [b for b in bad if b in priced_ids]
        # 没核对到的原因：对应到这一组、但没读出来的图（识别失败排在前面）
        unread = sorted((a for a in assigned if a["group"] == key and a["status"] in why_not),
                        key=lambda a: a["status"] != "failed")
        reason = "；".join(f"图片 {a['image']} {why_not[a['status']]}" for a in unread[:3]) + ("等" if len(unread) > 3 else "")
        entry = {"分组": names[key], "表格里有价格的商品数": len(rows),
                 "核对到的商品数": len(rows) - len(missing), "有问题的商品数": len(bad_priced),
                 "图片": list(dict.fromkeys(r["item"]["_image"] for r in recs))[:6]}
        if len(bad) > len(bad_priced):
            entry["KV 位有问题的商品数"] = len(bad) - len(bad_priced)
        if not recs:
            entry["结果"] = "没有核对"
            entry["原因"] = reason or "文件夹里没找到对应这一组的图片"
        elif bad:
            entry["结果"] = "有问题"
        elif missing:
            entry["结果"] = "部分没核对"
        else:
            entry["结果"] = "核对无误"
        if missing and recs:
            entry["没核对到的商品"] = [f"{r['sku']} {r['name']}".strip() for r in missing]
            entry["原因"] = reason or "这些商品在对应的图上没找到"
        out.append(entry)
    order = {"有问题": 0, "没有核对": 1, "部分没核对": 2, "核对无误": 3}
    return sorted(out, key=lambda e: order[e["结果"]])


def _touched_groups(result: dict) -> set[tuple]:
    return ({(r["row"]["sheet"], tuple(r["row"]["group"])) for r in result["records"]}
            | {a["group"] for a in result.get("assigned", []) if a["group"]})


def groups_without_images(sheets: list[Sheet], result: dict) -> list[str]:
    """这次核对到的工作表里，文件夹中没有任何图对应到的带价格分组。不算进结论（用户可能只给了一个子文件夹），
    单独告诉用户：核对整个活动时，它们可能是漏做了图，或图放在别的文件夹。"""
    touched = _touched_groups(result)
    sheets_touched = {key[0] for key in touched}
    names = [group_name(row) for sheet in sheets if sheet.name in sheets_touched for row in sheet.rows
             if row["values"] and (row["sheet"], tuple(row["group"])) not in touched]
    return list(dict.fromkeys(names))


def coverage_summary(groups: list[dict]) -> str:
    count = lambda status: sum(e["结果"] == status for e in groups)
    parts = [f"{count(s)} 组{s}" for s in ("核对无误", "有问题", "部分没核对", "没有核对") if count(s)]
    return f"表格这次涉及 {len(groups)} 组：" + "，".join(parts) if groups else "没有核对到表格里的任何一组"


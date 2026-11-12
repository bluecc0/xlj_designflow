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
    """去掉明显读串了的数字：吊牌价不可能小于等于到手价或立省金额（常见错误是把立省的数字又填进吊牌价）。"""
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


def _name_sim(item: dict, row: dict) -> float:
    name, copies = row["name"], "".join(row["copy"])
    candidates = [name, copies + name, name + copies] if name else [copies]
    shown, full = _clean(item.get("name")), _item_text(item)
    best = 0.0
    for text in candidates:
        c = _clean(text)
        if not c:
            continue
        if len(c) >= 3 and c in full:
            return 1.0
        if shown:
            best = max(best, SequenceMatcher(None, shown, c).ratio())
    return best


def _hint(row: dict, path_parts: list[str]) -> float:
    """文件夹名、文件名里出现了这一行的分组名或工作表名（男/女/童、模块名），作为辅助依据。"""
    score = 0.0
    for label in [row["sheet"], *row["group"]]:
        g = _clean(label)
        for part in path_parts:
            p = _clean(part)
            if not g or not p or p.isdigit():
                continue
            short, long_ = (p, g) if len(p) <= len(g) else (g, p)
            common = SequenceMatcher(None, p, g).find_longest_match(0, len(p), 0, len(g)).size
            if (short in long_ and re.search(r"[一-鿿]", short)) or common >= 3:
                score += 0.15
                break
    return min(score, 0.45)


def _amounts_eq(item: dict, row: dict) -> tuple[bool, bool]:
    price_eq = _num(item.get("price")) is not None and _num(item.get("price")) == _num(row["values"].get("price"))
    save_eq = _num(item.get("save")) is not None and _num(item.get("save")) == _num(row["values"].get("save"))
    return price_eq, save_eq


def _pair_score(item: dict, row: dict, path_parts: list[str]) -> float | None:
    """不知道这张图属于表格哪一组时，按内容在全表里找：名称要对得上，光是金额碰巧相同不算（常见价格很多商品都一样）。"""
    sim = _name_sim(item, row)
    price_eq, save_eq = _amounts_eq(item, row)
    if not (sim >= 0.99 or (sim >= 0.6 and (price_eq or save_eq))):
        return None
    return sim * 2 + 0.6 * price_eq + 0.2 * save_eq + _hint(row, path_parts)


def _scoped_score(item: dict, row: dict) -> float | None:
    """已经按文件夹名、文件名确定在这一组里时，组内对应：名称大致像，或者两个金额都相同。"""
    sim = _name_sim(item, row)
    price_eq, save_eq = _amounts_eq(item, row)
    if not (sim >= 0.5 or (price_eq and save_eq)):
        return None
    return sim * 2 + 0.6 * price_eq + 0.2 * save_eq


# ── 按名称找表格分组 ──────────────────────────────────────────────────────────
# 文件夹名、文件名和表格里的工作表名、模块列（合并单元格）对应：8-限时闪购 ↔ 限时闪购，
# 10-TOP榜/男子/羽绒服.png ↔ TOP榜单 / 男子 / 羽绒服TOP榜，11-新品上市/女-服饰.png ↔ 女子 / 服饰。

_SYNONYMS = {"男": ("男", "男子", "男款", "男士", "男装"), "女": ("女", "女子", "女款", "女士", "女装"),
             "童": ("童", "儿童", "童装", "大童", "小童", "kids")}


def _canon(text: str) -> str:
    c = _clean(re.sub(r"^[\d.\s_-]+", "", unicodedata.normalize("NFKC", str(text or ""))))
    return next((key for key, words in _SYNONYMS.items() if c in words), c)


def _label_matches(label: str, token: str) -> bool:
    a, b = _canon(label), _canon(token)
    if not a or not b or a.isdigit() or b.isdigit():
        return False
    if a == b:
        return True
    if len(a) == 1 or len(b) == 1:  # 男/女/童 这类单字只认完全相同
        return False
    short, long_ = (a, b) if len(a) <= len(b) else (b, a)
    if short in long_:
        return True
    common = SequenceMatcher(None, a, b).find_longest_match(0, len(a), 0, len(b)).size
    return common >= 3 and common >= len(short) * 0.6


def path_tokens(rel_paths: list[str]) -> list[str]:
    """路径里可用来对应的名字：每一级文件夹名、文件名，以及它们按 - _ 空格拆开的部分。"""
    out: list[str] = []
    for rel in rel_paths:
        parts = [p for p in re.split(r"[/\\]", rel) if p]
        if parts:
            parts[-1] = parts[-1].rsplit(".", 1)[0]
        for part in parts:
            out.append(part)
            out.extend(x for x in re.split(r"[-_\s、]+", part) if x and x != part)
    return list(dict.fromkeys(out))


def _row_labels(row: dict) -> list[str]:
    """这一行能被路径名字点到的标签：模块列的各级分组，以及写着名字的"序号"（例如 KV 行写着"加绒鞋"）。"""
    labels = list(row["group"])
    if row["order"] and not str(row["order"]).isdigit():
        labels.append(str(row["order"]))
    return labels


def scope_for(rel_paths: list[str], sheets: list[Sheet]) -> tuple[list[dict], str]:
    """按路径名字找这组图对应表格里的哪些行，返回 (候选行, 对应依据)。对不上任何工作表和分组时返回空列表。"""
    tokens = path_tokens(rel_paths)
    # 工作表对应模块，模块名在文件夹名上（文件名一般是分组名，例如"女-鞋履"里的"鞋履"不该去对"绒暖越冬-鞋履"这张表）
    folder_tokens = path_tokens(["/".join(re.split(r"[/\\]", rel)[:-1]) for rel in rel_paths])
    sheet_hits = ([s for s in sheets if any(_label_matches(s.name, t) for t in folder_tokens)]
                  or [s for s in sheets if any(_label_matches(s.name, t) for t in tokens)])
    # 已经用来对上工作表的名字（例如"10-TOP榜"）不再拿去区分组，否则"外套TOP榜"也会因为"TOP榜"被点到
    used = {t for t in tokens for s in sheet_hits if _label_matches(s.name, t)}
    rest = [t for t in tokens if t not in used]
    matched = lambda label: any(_label_matches(label, t) for t in rest)
    # 表格有好几张工作表时，文件夹名得先对上工作表；对不上就不按名字对应（例如"品类热榜/女子/卫衣"
    # 只是碰巧和"穿搭格调 / 女 / 卫衣"同名），交给后面按商品名称和价格找
    pool = sheet_hits or (sheets if len(sheets) == 1 else [])
    best, rows = 0, []
    for sheet in pool:
        for row in sheet.rows:
            hits = sum(1 for label in _row_labels(row) if matched(label))
            if hits > best:
                best, rows = hits, [row]
            elif hits == best and hits:
                rows.append(row)
    if best:
        groups = list(dict.fromkeys(" / ".join([r["sheet"], *r["group"]]) for r in rows))
        return rows, "按文件夹名、文件名对应到「" + "」「".join(groups[:3]) + "」" + ("等" if len(groups) > 3 else "")
    if sheet_hits:
        rows = [r for s in sheet_hits for r in s.rows]
        return rows, "按文件夹名对应到工作表「" + "」「".join(s.name for s in sheet_hits) + "」"
    return [], ""


def match_unit(items: list[dict], sheets: list[Sheet]) -> dict[int, dict]:
    """名字没能确定到单独一组的图（模块总图、KV 图，或文件夹名对不上表格）：每个商品按名称和价格找对应的行。
    先在名字点到的那几组里找，找不到再在整张表里找；名称要对得上，金额碰巧相同不算。对应依据写进 item["_basis"]。"""
    scope, basis = scope_for(list(dict.fromkeys(it.get("_full", it["_image"]) for it in items)), sheets)
    in_scope = {id(row) for row in scope}
    matched: dict[int, dict] = {}
    used: set[int] = set()
    for i, item in enumerate(items):
        # 名字点到的几组和整张表一起比，取最吻合的一行；名字点到的组只稍微加分。
        # 例如模块总图上的是 KV 款（在"kv"组里），名字却只点到模块下的男/女/童几组
        candidates = [(s + (SCOPE_BONUS if id(row) in in_scope else 0), row)
                      for sheet in sheets for row in sheet.rows if id(row) not in used
                      and (s := _pair_score(item, row, item["_path"])) is not None]
        if not candidates:
            continue
        row = max(candidates, key=lambda c: c[0])[1]
        matched[i] = row
        used.add(id(row))
        group = " / ".join([row["sheet"], *row["group"]])
        item["_basis"] = (f"{basis}，按商品名称和价格对上" if id(row) in in_scope
                          else f"按商品名称和价格对到「{group}」" + ("（文件夹名、文件名没对上表格分组）" if not scope else ""))
    # 只靠名称对上、金额一个都不同的：这张图里要有六成以上的商品能对上才算数。
    # 否则多半是别的活动或旧版本的图，碰巧有通用名称（"防泼水短羽绒服"）和表格里某一行相同
    if len(matched) < len(items) * 0.6:
        matched = {i: row for i, row in matched.items() if any(_amounts_eq(items[i], row))}
    return matched


def single_group(rows: list[dict]) -> bool:
    return len({(r["sheet"], tuple(r["group"])) for r in rows}) == 1


SCOPE_BONUS = 0.3           # 名字点到的分组里的行，按内容找时稍微优先
MISMATCH_IMAGE_BELOW = 0.3  # 按顺序对应后，名称或金额对得上的不到三成：整张图和这一组对不上


def _agree(items: list[dict], seq: list[dict]) -> int:
    """按顺序对下来，名称或价格对得上的个数。"""
    return sum(1 for it, row in zip(items, seq) if _scoped_score(it, row) is not None)


def _strength(items: list[dict], seq: list[dict]) -> float:
    """按顺序对下来的匹配强度：名称越接近、价格立省相同的越多，分越高。
    "红色运动鞋"对"黑色运动鞋"名称也有八成像，光数个数分不出来，要比强度。"""
    return round(sum(s for it, row in zip(items, seq) if (s := _scoped_score(it, row)) is not None), 6)


def match_group(images: list[list[dict]], rows: list[dict], basis: str) -> tuple[list[tuple[dict, dict]], list[dict], list[dict]]:
    """已经确定是表格里同一组的几张图（同一文件夹，按文件名顺序）：图上第 1 个对表格第 1 个，依次往下。
    名称和价格不参与决定对应谁，只用来报差异。返回 (配对, 多出来的商品, 整张对不上的图)。

    同一文件夹里的几张图可能是切片或单品卡片（要接着上一张往下数），也可能是同组商品的几张完整海报、
    修改版、不同尺寸（每张都从这一组第 1 个开始）。每张图两种起点都试，用匹配强度高的那种；
    强度一样时，图上商品比这一组少的当作切片或单品卡片接着数，否则当作完整的一张从头数。
    表格里没价格的行（组里的主推款，图上是大图不带价格）识别时常常不算商品，所以还分"所有行""只数有价格的行"两种数法。"""
    priced = [r for r in rows if r["values"]]
    seqs = [rows] + ([priced] if priced and len(priced) < len(rows) else [])
    pairs, extra, mismatched = [], [], []
    last: dict | None = None  # 上一张图用到的最后一行
    for items in images:
        options = []
        for seq in seqs:
            ids = [id(r) for r in seq]
            starts = {0} | ({ids.index(id(last)) + 1} if last is not None and id(last) in ids else set())
            for start in starts:
                part = seq[start:]
                if not part:
                    continue
                go_on = start > 0
                prefer_go_on = len(items) < len(seq)  # 比这一组少：像切片或单品卡片
                options.append((_strength(items, part), go_on == prefer_go_on, seq is rows, start, part))
        if not options:
            extra.extend(items)
            continue
        # 先比匹配强度（名称一致、价格一致的优先）；强度完全相同、缺少依据时，才按"像切片就接着数"的默认规则
        _strong, _pref, _all, _start, part = max(options, key=lambda o: o[:3])
        agree = _agree(items, part)
        got = list(zip(items, part))
        if len(got) >= 3 and agree < len(got) * MISMATCH_IMAGE_BELOW:
            group = " / ".join([rows[0]["sheet"], *rows[0]["group"]])
            mismatched.append({"images": list(dict.fromkeys(it["_image"] for it in items)),
                               "group": (rows[0]["sheet"], tuple(rows[0]["group"])),
                               "reason": f"按名字对应到「{group}」，但按顺序对下来 {len(got)} 个商品里只有 {agree} 个的名称或价格对得上，"
                                         "可能是旧版本、放错文件夹，或者表格这一组不是这些商品"})
            continue
        for item, row in got:
            item["_basis"] = f"{basis}，对应表格这一组第 {rows.index(row) + 1} 行"
        pairs.extend(got)
        extra.extend(items[len(got):])
        last = got[-1][1] if got else last
    return pairs, extra, mismatched


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


def wording_diffs(item: dict, row: dict) -> list[tuple[str, str, float]]:
    """表格里要出现在图上的文案（短名称、利益点），图上没有原样出现的：[(表格文案, 图上最像的一条, 相似度)]。"""
    full = _item_text(item)
    texts = ([row["name"]] if row["name"] and len(_clean(row["name"])) <= MAX_DISPLAY_NAME else []) + row["copy"]
    return [(text, *_closest_piece(item, text)) for text in texts if _clean(text) and _clean(text) not in full]


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
    """第二遍识别结果里对应的那个商品：数量没变按位置取，否则按名称找。"""
    same_image = [it for it in again]
    name = _clean(item.get("name"))
    by_pos = same_image[item["_pos"] - 1] if 0 < item["_pos"] <= len(same_image) else None
    if by_pos is not None and (not name or SequenceMatcher(None, name, _clean(by_pos.get("name"))).ratio() >= 0.6):
        return by_pos
    scored = [(SequenceMatcher(None, name, _clean(it.get("name"))).ratio(), i) for i, it in enumerate(same_image)] if name else []
    best = max(scored, default=(0, -1))
    return same_image[best[1]] if best[0] >= 0.8 else None


async def run_check(images: list[tuple[str, object]], sheets: list[Sheet], notify=None, base: str = "") -> dict:
    """images：[(相对路径, 读取函数)]，读取函数返回图片内容。notify(文字)：进度提示。
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
    units: list[list[dict]] = []
    # 名字能确定到表格里某一组的图：同一文件夹里对应同一组的（单品图、切片图）按文件名顺序接起来，整组按顺序对应
    in_order: dict[tuple, dict] = {}
    # 没能核对的图按名字对应到哪些分组：核对范围按输入的图来定，识别失败的模块也要在结论里列为"没有核对"
    not_read: list[dict] = []
    for (rel, _loader), result in zip(images, results):
        if isinstance(result, Exception) or (result is not None and not result):
            rows, _basis = scope_for([f"{base}/{rel}" if base else rel], sheets)
            reason = f"图片 {rel} 识别失败" if isinstance(result, Exception) else f"图片 {rel} 上没识别出商品"
            not_read.append({"image": rel, "reason": reason, "groups": {(r["sheet"], tuple(r["group"])) for r in rows},
                             "failed": isinstance(result, Exception)})
        if isinstance(result, Exception):
            failed.append(f"{rel}：{result}")
        elif result is None:
            small += 1
        elif not result:
            empty.append(rel)
        else:
            parts = [p for p in re.split(r"[/\\]", rel) if p]
            parts[-1] = parts[-1].rsplit(".", 1)[0]
            result = [sanitize_item(it) for it in result]
            shown = {f for f in FIELD_LABELS if any(it.get(f) not in (None, "") for it in result)}
            items = [dict(it, _image=rel, _full=f"{base}/{rel}" if base else rel, _path=parts, _pos=i + 1, _shown=shown)
                     for i, it in enumerate(result)]
            rows, basis = scope_for([f"{base}/{rel}" if base else rel], sheets)
            if rows and single_group(rows):
                key = ("/".join(parts[:-1]), rows[0]["sheet"], tuple(rows[0]["group"]))
                in_order.setdefault(key, {"rows": rows, "basis": basis, "images": []})["images"].append(items)
            else:  # 名字没能确定到单独一组：每张图单独按名称和价格找
                units.append(items)

    pairs, unmatched, covered, mismatched = [], [], set(), []
    for unit in in_order.values():
        got, extra, whole = match_group(unit["images"], unit["rows"], unit["basis"])
        mismatched.extend(whole)
        unmatched.extend(extra)
        for item, row in got:
            covered.add((row["sheet"], row["index"]))
            pairs.append((item, row))
    for items in units:
        matched = match_unit(items, sheets)
        for i, item in enumerate(items):
            row = matched.get(i)
            if row is None:
                unmatched.append(item)
                continue
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
    touched = {(row["sheet"], tuple(row["group"])) for _item, row in pairs} | {m["group"] for m in mismatched}
    uncovered = [row for sheet in sheets for row in sheet.rows if row["values"]
                 and (row["sheet"], tuple(row["group"])) in touched and (row["sheet"], row["index"]) not in covered]
    # 整张图对不上：表格这一组在别的图里已经全部核对到了（例如这张是旧版本），就不用提示
    missing = {(row["sheet"], tuple(row["group"])) for row in uncovered}
    mismatched = [m for m in mismatched if m["group"] in missing]
    return {"records": records, "unmatched": unmatched, "uncovered": uncovered, "failed": failed, "mismatched": mismatched,
            "not_read": not_read,
            "skipped_small": small, "no_product_images": empty, "image_count": len(images)}


# ── 核对范围（以表格为准）────────────────────────────────────────────────────

def group_name(row: dict) -> str:
    return " / ".join([row["sheet"], *row["group"]])


def coverage(sheets: list[Sheet], result: dict, whole_sheets: bool = False) -> list[dict]:
    """以表格为准，按分组交代这次的核对情况：核对无误、有问题、部分商品没核对到、没有核对（附原因）。
    范围按输入来定：核对到的、整张对不上的，以及识别失败或没识别出商品的图按名字对应到的工作表；
    whole_sheets=True（用户点名了工作表）时，传进来的工作表全部算在范围里。
    只核对一个模块文件夹时，不把整份表其它模块都列出来。"""
    records, mismatched = result["records"], result.get("mismatched", [])
    not_read = result.get("not_read", [])
    touched = ({r["row"]["sheet"] for r in records} | {m["group"][0] for m in mismatched}
               | {key[0] for n in not_read for key in n["groups"]})
    if whole_sheets:
        touched |= {s.name for s in sheets}
    groups: dict[tuple, list[dict]] = {}
    for sheet in sheets:
        if sheet.name in touched:
            for row in sheet.rows:
                if row["values"]:
                    groups.setdefault((row["sheet"], tuple(row["group"])), []).append(row)
    out = []
    for key, rows in groups.items():
        recs = [r for r in records if (r["row"]["sheet"], tuple(r["row"]["group"])) == key]
        checked = {id(r["row"]) for r in recs}
        missing = [r for r in rows if id(r) not in checked]
        bad = list(dict.fromkeys(id(r["row"]) for r in recs if r["status"] != "一致"))
        reason = next((m["reason"] for m in mismatched if m["group"] == key), "")
        if not reason:  # 识别失败排在"没识别出商品"前面
            unread = sorted((n for n in not_read if key in n["groups"]), key=lambda n: not n["failed"])
            if unread:
                reason = "；".join(n["reason"] for n in unread[:3]) + ("等" if len(unread) > 3 else "")
        entry = {"分组": group_name(rows[0]), "表格里有价格的商品数": len(rows),
                 "核对到的商品数": len(rows) - len(missing), "有问题的商品数": len(bad),
                 "图片": list(dict.fromkeys(r["item"]["_image"] for r in recs))[:6]}
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


def coverage_summary(groups: list[dict]) -> str:
    count = lambda status: sum(e["结果"] == status for e in groups)
    parts = [f"{count(s)} 组{s}" for s in ("核对无误", "有问题", "部分没核对", "没有核对") if count(s)]
    return f"表格这次涉及 {len(groups)} 组：" + "，".join(parts) if groups else "没有核对到表格里的任何一组"


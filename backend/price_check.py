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
            "values": {f: r[i] for f, i in fields.items() if r[i]},
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
    sim = _name_sim(item, row)
    price_eq, save_eq = _amounts_eq(item, row)
    # 名称完全对得上；或名称大致像并且有一个金额相同；或两个金额都相同。
    # 只是名称有点像、金额全不同的不算同一个商品（常见于文件夹里混着别的活动、旧版本的图）
    if not (sim >= 0.99 or (sim >= 0.6 and (price_eq or save_eq)) or (price_eq and save_eq)):
        return None
    return sim * 2 + 0.6 * price_eq + 0.2 * save_eq + _hint(row, path_parts)


def _align(items: list[dict], rows: list[dict]) -> tuple[float, dict[int, int]]:
    """按顺序对齐（允许两边各自跳过），返回 (总分, {图上第几个: 表格第几行})。"""
    n, m = len(items), len(rows)
    scores = [[_pair_score(it, row, it["_path"]) for row in rows] for it in items]
    dp = [[0.0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            best = max(dp[i - 1][j], dp[i][j - 1])
            s = scores[i - 1][j - 1]
            if s is not None:
                best = max(best, dp[i - 1][j - 1] + s)
            dp[i][j] = best
    pairs: dict[int, int] = {}
    i, j = n, m
    while i > 0 and j > 0:
        s = scores[i - 1][j - 1]
        if s is not None and dp[i][j] == dp[i - 1][j - 1] + s:
            pairs[i - 1] = j - 1
            i, j = i - 1, j - 1
        elif dp[i][j] == dp[i - 1][j]:
            i -= 1
        else:
            j -= 1
    return dp[n][m], pairs


def match_unit(items: list[dict], sheets: list[Sheet]) -> dict[int, dict]:
    """把一组图上的商品对应到表格行：先选整体最像的工作表按顺序对齐，没对上的再单独在全表里找。"""
    best_score, best_sheet, best_pairs = 0.0, None, {}
    for sheet in sheets:
        score, pairs = _align(items, sheet.rows)
        if score > best_score:
            best_score, best_sheet, best_pairs = score, sheet, pairs
    matched = {i: best_sheet.rows[j] for i, j in best_pairs.items()} if best_sheet else {}
    used = {id(r) for r in matched.values()}
    ordered = ([best_sheet] if best_sheet else []) + [s for s in sheets if s is not best_sheet]
    for i, item in enumerate(items):
        if i in matched:
            continue
        candidates = [(s, row) for sheet in ordered for row in sheet.rows
                      if (s := _pair_score(item, row, item["_path"])) is not None]
        if candidates:
            # 同分时优先还没被对应过的行、同一张工作表里的行
            row = max(candidates, key=lambda c: (c[0], id(c[1]) not in used, c[1]["sheet"] == getattr(best_sheet, "name", "")))[1]
            matched[i] = row
            used.add(id(row))
    # 只靠名称对上、金额一个都不同的：这组图里要有六成以上的商品能对上才算数。
    # 否则多半是别的活动或旧版本的图，碰巧有通用名称（"防泼水短羽绒服"）和表格里某一行相同
    if len(matched) < len(items) * 0.6:
        matched = {i: row for i, row in matched.items() if any(_amounts_eq(items[i], row))}
    return matched


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
    return status, [f"{d['label']}：表格{' ' if d['kind'] == '价格' else '「'}{d['table']}{'' if d['kind'] == '价格' else '」'}，"
                    f"图上{' ' if d['kind'] == '价格' else '「'}{d['image']}{'' if d['kind'] == '价格' else '」'}" for d in used]


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


async def run_check(images: list[tuple[str, object]], sheets: list[Sheet], notify=None) -> dict:
    """images：[(相对路径, 读取函数)]，读取函数返回图片内容。notify(文字)：进度提示。"""
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
    singles: dict[str, list[dict]] = {}
    for (rel, _loader), result in zip(images, results):
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
            items = [dict(it, _image=rel, _path=parts, _pos=i + 1, _shown=shown) for i, it in enumerate(result)]
            if len(items) == 1:  # 一图一个商品：同一文件夹里的按文件名顺序合成一组再对齐
                singles.setdefault("/".join(parts[:-1]), []).extend(items)
            else:
                units.append(items)
    units.extend(singles.values())

    pairs, unmatched, covered = [], [], set()
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
    uncovered = [row for sheet in sheets for row in sheet.rows
                 if row["values"] and (row["sheet"], row["index"]) not in covered]
    return {"records": records, "unmatched": unmatched, "uncovered": uncovered, "failed": failed,
            "skipped_small": small, "no_product_images": empty, "image_count": len(images)}

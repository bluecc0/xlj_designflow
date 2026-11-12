"""核对卡片：把有问题的成品图和表格里对应的内容拼成一张图，放进对话和画布，方便对着看。

左边是原图，右边逐个列出图上有问题的商品：第几个、货号、名称，以及每一项"表格写的 / 图上印的"。
"""
from __future__ import annotations

import io
import os
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from .price_check import FIELD_LABELS

# 中文字体：线上是 Windows，开发机是 Mac；也可以用环境变量指定
FONT_CANDIDATES = [
    os.getenv("PRICE_CARD_FONT", ""),
    "C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/msyh.ttf", "C:/Windows/Fonts/simhei.ttf", "C:/Windows/Fonts/simsun.ttc",
    "/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc", "/Library/Fonts/Arial Unicode.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
]
IMAGE_BOX = (760, 1000)   # 左边原图最大占位
PANEL_WIDTH = 640
PAD = 28
INK, MUTED, LINE, PANEL = (16, 24, 40), (102, 112, 133), (228, 231, 236), (249, 250, 251)
COLORS = {"价格": (217, 45, 32), "文案": (181, 71, 8), "没读到": (102, 112, 133)}
OK_COLOR = (18, 128, 92)


@lru_cache(maxsize=1)
def font_path() -> str | None:
    return next((p for p in FONT_CANDIDATES if p and Path(p).is_file()), None)


@lru_cache(maxsize=8)
def _font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(font_path(), size)


def _wrap(text: str, font: ImageFont.FreeTypeFont, width: int) -> list[str]:
    lines, current = [], ""
    for ch in str(text).replace("\n", " "):
        if font.getlength(current + ch) > width and current:
            lines.append(current)
            current = ch
        else:
            current += ch
    return lines + [current] if current else lines or [""]


class _Panel:
    """先算高度再画：draw 为 None 时只累计 y。"""

    def __init__(self, draw: ImageDraw.ImageDraw | None, x: int):
        self.draw, self.x, self.y = draw, x, PAD

    def text(self, text: str, size: int, color=INK, indent: int = 0, width: int | None = None, gap: int = 6) -> None:
        font = _font(size)
        for line in _wrap(text, font, (width or PANEL_WIDTH - PAD * 2) - indent):
            if self.draw:
                self.draw.text((self.x + indent, self.y), line, fill=color, font=font)
            self.y += round(size * 1.35)
        self.y += gap

    def rule(self) -> None:
        if self.draw:
            self.draw.line([(self.x, self.y), (self.x + PANEL_WIDTH - PAD * 2, self.y)], fill=LINE, width=1)
        self.y += 14

    def compare(self, label: str, table: str, image: str, color) -> None:
        """一行对比：项目 | 表格 | 图上。"""
        font = _font(20)
        cols = [(0, 96, label, MUTED), (104, 220, table, INK), (340, 244, image, color)]
        wrapped = [(x, _wrap(text, font, w), c) for x, w, text, c in cols]
        for x, lines, c in wrapped:
            for i, line in enumerate(lines):
                if self.draw:
                    self.draw.text((self.x + x, self.y + i * 27), line, fill=c, font=font)
        self.y += max(len(lines) for _x, lines, _c in wrapped) * 27 + 6


def _layout(panel: _Panel, title: str, issues: list[dict], missing: list[str]) -> None:
    panel.text(title, 17, MUTED, gap=4)
    bad = sum(1 for i in issues if i["diffs"])
    panel.text(f"这张图核对了 {len(issues)} 个商品：{len(issues) - bad} 个无误，{bad} 个有问题"
               + (f"；表格这一组还有 {len(missing)} 个没在图上找到" if missing else ""), 18, INK, gap=4)
    panel.text("图上第几个：左上角开始，从左到右、从上到下数", 15, MUTED, gap=10)
    panel.rule()
    for issue in issues:
        if not issue["diffs"]:  # 核对无误：一行带过
            panel.text(f"图上第 {issue['pos']} 个　{issue['sku']}　{issue.get('name') or ''}　核对无误", 18, OK_COLOR, gap=8)
            continue
        panel.text(f"图上第 {issue['pos']} 个　{issue['sku']}", 24, INK, gap=2)
        if issue.get("name"):
            panel.text(issue["name"], 19, MUTED, gap=2)
        if issue.get("seen"):
            panel.text("图上名称：" + issue["seen"], 15, MUTED, gap=2)
        if issue.get("where"):
            panel.text("表格位置：" + issue["where"], 15, MUTED, gap=2)
        if issue.get("basis"):
            panel.text("对应依据：" + issue["basis"], 15, MUTED, gap=8)
        panel.compare("项目", "表格", "图上", MUTED)
        for diff in issue["diffs"]:
            panel.compare(diff["label"], diff["table"], diff["image"] or "没读出来", COLORS[diff["kind"]])
        for label, value in issue.get("same") or []:
            panel.compare(label, value, value + "　一致", OK_COLOR)
        panel.y += 6
        panel.rule()
    if missing:
        panel.text("表格这一组里、没在图上找到（没有核对）：", 18, COLORS["文案"], gap=4)
        for line in missing:
            panel.text("· " + line, 17, INK, gap=2)


def render_card(image: bytes, title: str, issues: list[dict], missing: list[str] | None = None) -> bytes:
    """issues：图上每个对上表格的商品 [{"pos", "sku", "name", "where", "diffs": [...], "same": [(项目, 值)]}]，
    diffs 为空表示核对无误；missing：表格这一组里没在图上找到的商品。"""
    missing = missing or []
    with Image.open(io.BytesIO(image)) as im:
        im.seek(0)
        picture = im.convert("RGB")
    scale = min(IMAGE_BOX[0] / picture.width, IMAGE_BOX[1] / picture.height, 2.0)  # 小图放大，最多两倍
    picture = picture.resize((max(1, round(picture.width * scale)), max(1, round(picture.height * scale))), Image.LANCZOS)
    measure = _Panel(None, 0)
    _layout(measure, title, issues, missing)
    height = max(picture.height + PAD * 2, measure.y + PAD)
    card = Image.new("RGB", (picture.width + PAD * 2 + PANEL_WIDTH, height), "white")
    card.paste(picture, (PAD, PAD))
    draw = ImageDraw.Draw(card)
    left = picture.width + PAD * 2
    draw.rectangle([left, 0, card.width, height], fill=PANEL)
    draw.line([(left, 0), (left, height)], fill=LINE, width=1)
    _layout(_Panel(draw, left + PAD), title, issues, missing)
    buf = io.BytesIO()
    card.save(buf, format="PNG")
    return buf.getvalue()


def issues_for(records: list[dict]) -> list[dict]:
    """同一张图上有问题的商品 → 卡片右侧的内容。没问题的价格项也列出来，方便确认整行。"""
    out = []
    for r in sorted(records, key=lambda r: r["item"]["_pos"]):
        row, item = r["row"], r["item"]
        differing = {d["label"] for d in r["diffs"]}
        same = [(FIELD_LABELS[f], v) for f, v in row["values"].items()
                if FIELD_LABELS[f] not in differing and f in item["_shown"]]
        out.append({"pos": item["_pos"], "sku": row["sku"], "name": row["name"],
                    "seen": str(item.get("name") or "").replace("\n", " "), "basis": item.get("_basis", ""),
                    "where": " / ".join([row["sheet"], *row["group"]]), "diffs": r["diffs"], "same": same})
    return out

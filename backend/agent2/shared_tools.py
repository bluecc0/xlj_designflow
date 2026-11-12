"""共享文件夹与价格核对工具：浏览白名单共享盘、取图、读表格、核对图片上的价格和文案。

对共享文件夹只读：这里和 shared_folders 模块都只列目录、读文件，产生的文件（取出的图片副本、核对卡片）
只写到本机的输出目录，绝不写回、删除、移动或改名共享文件夹里的任何东西。
"""
from __future__ import annotations

import asyncio
import io
import re
import time
import uuid
from pathlib import Path
from urllib.parse import quote

from PIL import Image

from .. import price_cards, price_check, shared_folders
from ..config import settings
from . import store
from .engine import Tool, ToolContext
from .tools import _artifact_event

MAX_SHARED_IMAGES = 12
MAX_PRICE_IMAGES = 600
WEB_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
MAX_REPORTED = 30
MAX_CARDS = 20
HEARTBEAT_SECONDS = 5
# 只是一个路径或文件名（没有任何要求）：smb://…、\\\\host\\…、Z:\\…、/Volumes/…、xxx.xlsx
_PATH_ONLY = re.compile(r"(?:smb:|file:|[A-Za-z]:|[\\\\/]{1,2})\S*|\S+\.(?:xlsx|xlsm|csv)", re.I)


async def _load_sheets(ctx: ToolContext, source: str, folder: str = "",
                       screenshots: list[str] | None = None) -> tuple[list, str, bool]:
    """读出表格，返回 (工作表, 文件名, 是否来自截图)。Excel/CSV 直接解析，表格截图用看图模型读。"""
    data, name = await asyncio.to_thread(_table_source, ctx, source, folder, screenshots)
    if Path(name).suffix.lower() in shared_folders.TABLE_SUFFIXES:
        return await asyncio.to_thread(price_check.load_table, data, name), name, False
    return await price_check.load_table_image(data), name, True


def _has_table(ctx: ToolContext, folder: str) -> bool:
    """对话里上传过 Excel/CSV，或文件夹里有表格。"""
    if any(a["kind"] == "table" for a in store.list_artifacts(ctx.session_id)):
        return True
    try:
        return bool(shared_folders.find_files(ctx.user, folder, shared_folders.TABLE_SUFFIXES, 1)[1])
    except shared_folders.SharedFolderError:
        return False


def _uploaded_images(ctx: ToolContext) -> list[str]:
    """用户这一轮及之前上传到对话里的图片 ID（最近的在前）。"""
    return [a["id"] for a in store.list_artifacts(ctx.session_id) if a["kind"] == "upload"]


def _table_source(ctx: ToolContext, source: str, folder: str = "",
                  screenshots: list[str] | None = None) -> tuple[bytes, str]:
    """表格来源：对话里上传的表格或表格截图的 ID，或共享文件夹里的路径；
    没指定时自动找：先找对话里上传的表格，再找文件夹里的表格，都没有时把用户上传的那张图当作表格截图。
    screenshots：可能是表格截图的图片 ID（没给就用对话里用户上传的图片）。"""
    source = str(source or "").strip()
    artifact = store.get_artifact(source, ctx.user["id"]) if source.startswith("img_") else None
    if not source:
        uploaded = next((a for a in store.list_artifacts(ctx.session_id) if a["kind"] == "table"), None)
        artifact = store.get_artifact(uploaded["id"], ctx.user["id"]) if uploaded else None
    if artifact:
        path = Path(artifact["path"])
        if artifact["kind"] not in ("table", "upload") or not path.is_file():
            raise ValueError(f"{source} 不是表格，也不是用户上传的表格截图")
        # 用户上传的图片当作表格截图。显示用户上传时的文件名；后缀要是图片后缀，后面才会按截图去读
        label = artifact["label"] or path.name
        if artifact["kind"] == "upload" and Path(label).suffix.lower() not in shared_folders.IMAGE_SUFFIXES:
            label = path.name
        return path.read_bytes(), label
    if source:
        data, name, _shown = shared_folders.read_file(
            ctx.user, source, shared_folders.TABLE_SUFFIXES | shared_folders.IMAGE_SUFFIXES, folder)
        return data, name
    if folder:
        _shown, tables, _more = shared_folders.find_files(ctx.user, folder, shared_folders.TABLE_SUFFIXES, 20)
        if len(tables) == 1:
            return tables[0][1].read_bytes(), tables[0][1].name
        if len(tables) > 1:
            raise ValueError("文件夹里有多个表格，请指定用哪个：" + "、".join(rel for rel, _p in tables))
    # 没有 Excel/CSV：用户贴的那张图就是表格截图（只有一张时直接用，多张时问是哪张）
    candidates = list(dict.fromkeys(screenshots if screenshots is not None else _uploaded_images(ctx)))
    if len(candidates) == 1:
        return _table_source(ctx, candidates[0])
    if len(candidates) > 1:
        raise ValueError("没有 Excel/CSV 表格，用户上传了几张图：" + "、".join(candidates)
                         + "。问用户哪张是表格截图，把它的 ID 填进 table")
    raise ValueError("没有找到表格：请上传表格（Excel、CSV 或表格截图），或者给出表格在共享文件夹里的路径")


async def list_shared_folder(ctx: ToolContext, args: dict) -> dict:
    return await asyncio.to_thread(shared_folders.list_folder, ctx.user, str(args.get("path") or ""),
                                   args.get("recursive") is not False)


def _as_web_image(data: bytes, name: str) -> tuple[bytes, str]:
    """tif、bmp、gif 等浏览器和生图接口不一定认的格式转成 PNG。"""
    suffix = Path(name).suffix.lower()
    if suffix in WEB_SUFFIXES:
        return data, suffix
    with Image.open(io.BytesIO(data)) as im:
        im.seek(0)
        buf = io.BytesIO()
        im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB").save(buf, format="PNG")
        return buf.getvalue(), ".png"


async def use_shared_images(ctx: ToolContext, args: dict) -> dict:
    show = args.get("show") is not False
    images, failed = [], []
    for raw in [str(p) for p in (args.get("paths") or [])][:MAX_SHARED_IMAGES]:
        try:
            data, name, shown = await asyncio.to_thread(shared_folders.read_file, ctx.user, raw,
                                                        shared_folders.IMAGE_SUFFIXES, str(args.get("folder") or ""))
            data, suffix = await asyncio.to_thread(_as_web_image, data, name)
        except (shared_folders.SharedFolderError, OSError) as exc:
            failed.append({"path": raw, "error": str(exc)})
            continue
        # 复制一份到本机输出目录：对话卡片能预览下载，后续抠图、生图参考也能直接用
        job_id = uuid.uuid4().hex
        out = settings.output_path / "ai-images" / ctx.user["id"] / "shared" / f"{job_id}{suffix}"
        out.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(out.write_bytes, data)
        url = f"/ai-images/{quote(ctx.user['id'])}/shared/{quote(out.name)}"
        meta = {"operation": "shared", "source": shown}
        if show:
            artifact, event = store.register_job_artifact(
                job_id, ctx.turn_id, _artifact_event, session_id=ctx.session_id, user_id=ctx.user["id"],
                url=url, path=str(out), label=name, source_tool_call_id=ctx.call_id, meta=meta)
            if ctx.publish:
                await ctx.publish(event)
        else:
            artifact = store.create_artifact(session_id=ctx.session_id, user_id=ctx.user["id"], kind="shared_ref",
                                             url=url, path=str(out), label=name, source_tool_call_id=ctx.call_id,
                                             meta=meta)
        images.append({"id": artifact["id"], "url": url, "label": name})
    # 不展示时结果不用 images 字段：前端只把 images 放进画布
    return {("images" if show else "references"): images, "failed": failed}


async def read_table(ctx: ToolContext, args: dict) -> dict:
    sheets, name, _from_image = await _load_sheets(ctx, args.get("source"))
    return {"file": name, "sheets": price_check.overview(sheets), "表格自身算不通的行": price_check.table_warnings(sheets)}


async def check_prices(ctx: ToolContext, args: dict) -> dict:
    folder = str(args.get("folder") or "").strip()
    image_ids = [str(i) for i in (args.get("image_ids") or []) if str(i).strip()]
    if not folder and not image_ids:
        return {"error": "需要要核对的图片：共享文件夹路径（folder），或用户上传到对话里的图片 ID（image_ids）"}
    # 用户只发来路径或表格、还没说要核对时模型容易抢跑：必须带上用户提出核对的原话
    request = str(args.get("request") or "").strip()
    if not request or _PATH_ONLY.fullmatch(request):
        return {"error": "用户还没有提出核对要求，先不要核对。回复一句已收到，问他要做什么（例如核对价格和文案）"}
    # 实时进度：每个阶段说一句，等待期间每隔几秒带上已用时间，让用户知道还在跑
    started = time.time()
    stage = {"text": "正在读取表格"}

    async def notify(text: str):
        same_stage = text[:6] == stage["text"][:6]
        stage["text"] = text
        if same_stage and time.time() - stage.get("at", 0) < 1:  # 同一阶段最多每秒推一次，图片多时不刷屏
            return
        stage["at"] = time.time()
        await ctx.emit("tool.progress", {"call_id": ctx.call_id, "message": f"{text}（已用 {int(time.time() - started)} 秒）"})

    async def heartbeat():
        while True:
            await asyncio.sleep(HEARTBEAT_SECONDS)
            await ctx.emit("tool.progress", {"call_id": ctx.call_id,
                                             "message": f"{stage['text']}（已用 {int(time.time() - started)} 秒）"})

    ticker = asyncio.ensure_future(heartbeat())
    try:
        return await _run_price_check(ctx, args, folder, image_ids, notify)
    finally:
        ticker.cancel()


async def _run_price_check(ctx: ToolContext, args: dict, folder: str, image_ids: list[str], notify) -> dict:
    await notify("正在读取表格")
    table_id = str(args.get("table") or "").strip()
    # 给了共享文件夹时，要核对的图在文件夹里；用户贴进对话的图是表格截图的候选
    screenshots = (image_ids or _uploaded_images(ctx)) if folder else None
    if folder and not table_id and screenshots and not _has_table(ctx, folder):
        table_id = screenshots[0] if len(screenshots) == 1 else ""  # 这张图就是表格截图，不算要核对的图
    sheets, name, from_image = await _load_sheets(ctx, table_id, folder, screenshots)
    sheets = price_check.pick_sheets(sheets, [str(s) for s in (args.get("sheets") or [])])
    await notify("正在查找文件夹里的图片")
    shown, truncated = "对话里上传的图片", False
    images: list[tuple[str, object]] = []
    if folder:
        shown, files, truncated = await asyncio.to_thread(
            shared_folders.find_files, ctx.user, folder, shared_folders.IMAGE_SUFFIXES, MAX_PRICE_IMAGES)
        images = [(rel, path.read_bytes) for rel, path in files]
    for number, image_id in enumerate(i for i in image_ids if i != table_id):  # 表格截图本身不算要核对的图
        artifact = store.get_artifact(image_id, ctx.user["id"])
        if not artifact or not Path(artifact["path"]).is_file():
            return {"error": f"找不到图片 {image_id}，请使用对话里出现过的图片 ID"}
        images.append((artifact["label"] or f"上传的第 {number + 1} 张图", Path(artifact["path"]).read_bytes))
    if not images:
        return {"error": f"{shown} 里没有找到图片"}

    result = await price_check.run_check(images, sheets, notify)
    records = result["records"]
    problem = [r for r in records if r["status"] != "一致"]
    cards, card_note = await _make_cards(ctx, problem, dict(images), shown, notify)

    # 按"哪张图有什么问题"归类，同一张图的问题放在一起，并带上它的核对卡片
    by_image: dict[str, list[dict]] = {}
    for r in sorted(problem, key=lambda r: (price_check.STATUSES.index(r["status"]), r["item"]["_image"], r["item"]["_pos"])):
        by_image.setdefault(r["item"]["_image"], []).append(r)
    problem_images = [{
        "图片": rel, "核对卡片": cards.get(rel, {}).get("id", ""),
        "问题": [{"图上第几个": r["item"]["_pos"], "货号": r["row"]["sku"], "商品": r["row"]["name"],
                  "表格位置": " / ".join([r["row"]["sheet"], *r["row"]["group"]]),
                  "差异": [{"类型": d["kind"], "项目": d["label"], "表格": d["table"], "图上": d["image"] or "没读出来"}
                           for d in r["diffs"]]} for r in items],
    } for rel, items in by_image.items()]

    not_in_table: dict[str, list[str]] = {}
    for it in result["unmatched"]:
        if it.get("price") not in (None, ""):
            not_in_table.setdefault(it["_image"], []).append(f"第{it['_pos']}个 {it.get('name') or ''} ¥{it.get('price')}")
    no_image: dict[str, list[str]] = {}
    for row in result["uncovered"]:
        no_image.setdefault(" / ".join([row["sheet"], *row["group"]]), []).append(f"{row['sku']} {row['name']}".strip())

    notes = [card_note] if card_note else []
    if truncated:
        notes.append(f"图片超过 {MAX_PRICE_IMAGES} 张，只核对了前 {MAX_PRICE_IMAGES} 张，其余请缩小到子文件夹再核对")
    if from_image:
        notes.append("表格是从截图识别出来的，截图里的数字本身可能读错；有疑问的以原始 Excel 为准")
    if result["failed"]:
        notes.append(f"{len(result['failed'])} 张图识别失败，没有核对：" + "；".join(result["failed"][:5]))
    return {
        "概况": {
            "文件夹": shown, "表格": name, "核对的工作表": [s.name for s in sheets],
            "文件夹里的图片数": result["image_count"],
            "其中没有商品的图片数（标题、背景、按钮等，不用核对）": len(result["no_product_images"]) + result["skipped_small"],
            "识别失败的图片数": len(result["failed"]),
            "对应到表格并完成核对的商品数": len(records),
            "核对结果": {"一致": sum(r["status"] == "一致" for r in records), "价格不一致": sum(r["status"] == "不一致" for r in records),
                         "文案待确认": sum(r["status"] == "文案待确认" for r in records),
                         "图上数字没读出来": sum(r["status"] == "未识别" for r in records)},
        },
        # checked / counts 给前端卡片摘要用
        "checked": len(records), "counts": {s: sum(r["status"] == s for r in records) for s in price_check.STATUSES},
        "有问题的图片": problem_images[:MAX_REPORTED],
        "图上有价格但表格里没有的商品": dict(list(not_in_table.items())[:MAX_REPORTED]),
        "表格有价格但没找到图片的商品": dict(list(no_image.items())[:MAX_REPORTED]),
        "表格自身算不通的行": price_check.table_warnings(sheets)[:15],
        "说明": notes,
        "images": list(cards.values()),
    }


async def _make_cards(ctx: ToolContext, problem: list[dict], loaders: dict, shown: str, notify) -> tuple[dict, str]:
    """每张有问题的图生成一张核对卡片（原图 + 表格内容对照），发到对话和画布。返回 ({图片: 卡片}, 说明)。"""
    if not problem:
        return {}, ""
    if not price_cards.font_path():
        return {}, "服务器上没有找到中文字体，没有生成核对卡片（可以用环境变量 PRICE_CARD_FONT 指定字体文件）"
    order: dict[str, list[dict]] = {}
    for r in sorted(problem, key=lambda r: price_check.STATUSES.index(r["status"])):  # 价格不一致的排前面
        order.setdefault(r["item"]["_image"], []).append(r)
    await notify(f"正在生成 {min(len(order), MAX_CARDS)} 张核对卡片")
    cards: dict[str, dict] = {}
    for position, (rel, items) in enumerate(list(order.items())[:MAX_CARDS]):
        try:
            data = await asyncio.to_thread(loaders[rel])
            png = await asyncio.to_thread(price_cards.render_card, data, f"{shown}/{rel}", price_cards.issues_for(items))
        except Exception:
            continue  # 个别图画不出来不影响其它
        job_id = uuid.uuid4().hex
        out = settings.output_path / "ai-images" / ctx.user["id"] / "price-check" / f"{job_id}.png"
        out.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(out.write_bytes, png)
        url = f"/ai-images/{quote(ctx.user['id'])}/price-check/{quote(out.name)}"
        label = "核对 · " + Path(rel).name
        artifact, event = store.register_job_artifact(
            job_id, ctx.turn_id, _artifact_event, session_id=ctx.session_id, user_id=ctx.user["id"],
            url=url, path=str(out), label=label, position=position, source_tool_call_id=ctx.call_id,
            meta={"operation": "price_check", "source": f"{shown}/{rel}"})
        if ctx.publish:
            await ctx.publish(event)
        cards[rel] = {"id": artifact["id"], "url": url, "label": label}
    note = f"有问题的图共 {len(order)} 张，只生成了前 {MAX_CARDS} 张的卡片" if len(order) > MAX_CARDS else ""
    return cards, note


def build_shared_tools() -> list[Tool]:
    return [
        Tool("list_shared_folder",
             "只读查看共享文件夹（管理员配置的白名单共享盘）：按文件夹列出图片（带宽高）和表格，不限层级。"
             "path 直接用用户给的写法（smb://、\\\\ 开头的网络路径、带盘符的路径、共享盘名开头的路径都可以）。",
             {"type": "object", "properties": {"path": {"type": "string"},
                                               "recursive": {"type": "boolean", "description": "默认 true，连子文件夹一起列"}},
              "required": ["path"]},
             list_shared_folder),
        Tool("use_shared_images",
             "从共享文件夹取图片到对话里（复制一份，不改动原文件），得到图片 ID，之后可以看图、抠图、当生图参考。"
             "show 决定是否发到对话和画布：用户要看这些图时 true，只拿来当参考或用户说不要展示时 false。",
             {"type": "object", "properties": {
                 "paths": {"type": "array", "items": {"type": "string"}, "maxItems": MAX_SHARED_IMAGES},
                 "folder": {"type": "string", "description": "可选，paths 写相对路径时的基准文件夹"},
                 "show": {"type": "boolean"}},
              "required": ["paths", "show"]},
             use_shared_images),
        Tool("read_table",
             "读取表格（xlsx/csv）的概览：每个工作表要比对的价格字段，以及按模块合并单元格划分的分组。"
             "source 填对话里上传的表格 ID、表格截图的图片 ID，或共享文件夹里的表格路径；不填就用对话里最近上传的表格。",
             {"type": "object", "properties": {"source": {"type": "string"}}},
             read_table),
        Tool("check_prices",
             "核对图片上的价格和文案是否和表格一致：自动识别文件夹（含子文件夹）里每张图上的商品，"
             "按商品名称、文案和价格对应到表格里的行，逐项比对到手价、立省、吊牌价、折扣、充绒量和文案。"
             "结果按图片归类；每张有问题的图会生成一张核对卡片（原图 + 表格内容对照）发到对话和画布。"
             "不需要事先知道文件夹结构、文件命名或顺序，也不需要先列目录。只在用户提出要核对时调用。"
             "图片多时要跑几分钟。",
             {"type": "object", "properties": {
                 "request": {"type": "string",
                             "description": "用户提出核对要求的原话，例如\"核对一下价格文案信息是否有误\"。"
                                            "用户只发了路径或表格、没说要核对时不要调用本工具"},
                 "folder": {"type": "string", "description": "要核对的图片所在的共享文件夹路径，直接用用户给的写法"},
                 "image_ids": {"type": "array", "items": {"type": "string"},
                               "description": "用户直接上传到对话里要核对的图片 ID（没有共享文件夹时用；可以和 folder 同时给）"},
                 "sheets": {"type": "array", "items": {"type": "string"},
                            "description": "只核对表格里的这几个工作表（用户点名了某个 sheet 时填，名字不用写全）；不填就核对整个表格"},
                 "table": {"type": "string",
                           "description": "表格：上传的 Excel/CSV 的 ID、用户上传的表格截图的图片 ID，或共享文件夹里的表格路径；"
                                          "不填时用对话里上传的 Excel/CSV，没有就用文件夹里的表格"}},
              "required": ["request"]},
             check_prices),
    ]

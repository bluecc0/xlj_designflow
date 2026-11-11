"""共享文件夹与价格核对工具：浏览白名单共享盘、取图、读表格、核对图片上的价格和文案。

对共享文件夹只读：这里和 shared_folders 模块都只列目录、读文件，产生的文件（取出的图片副本、核对报告）
只写到本机的输出目录，绝不写回、删除、移动或改名共享文件夹里的任何东西。
"""
from __future__ import annotations

import asyncio
import io
import time
import uuid
from pathlib import Path
from urllib.parse import quote

from PIL import Image

from .. import price_check, shared_folders
from ..config import settings
from . import store
from .engine import Tool, ToolContext
from .tools import _artifact_event

MAX_SHARED_IMAGES = 12
MAX_PRICE_IMAGES = 600
WEB_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
MAX_REPORTED = 30


def _table_source(ctx: ToolContext, source: str, folder: str = "") -> tuple[bytes, str]:
    """表格来源：对话里上传的表格 ID，或共享文件夹里的路径；没指定时自动找（先找对话里上传的，再找文件夹里的）。"""
    source = str(source or "").strip()
    artifact = store.get_artifact(source, ctx.user["id"]) if source.startswith("img_") else None
    if not source:
        uploaded = next((a for a in store.list_artifacts(ctx.session_id) if a["kind"] == "table"), None)
        artifact = store.get_artifact(uploaded["id"], ctx.user["id"]) if uploaded else None
    if artifact:
        path = Path(artifact["path"])
        if artifact["kind"] != "table" or not path.is_file():
            raise ValueError(f"{source} 不是表格文件")
        return path.read_bytes(), artifact["label"] or path.name
    if source:
        data, name, _shown = shared_folders.read_file(ctx.user, source, shared_folders.TABLE_SUFFIXES, folder)
        return data, name
    if folder:
        _shown, tables, _more = shared_folders.find_files(ctx.user, folder, shared_folders.TABLE_SUFFIXES, 20)
        if len(tables) == 1:
            return tables[0][1].read_bytes(), tables[0][1].name
        if len(tables) > 1:
            raise ValueError("文件夹里有多个表格，请指定用哪个：" + "、".join(rel for rel, _p in tables))
    raise ValueError("没有找到表格：请上传表格，或者给出表格在共享文件夹里的路径")


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
    data, name = await asyncio.to_thread(_table_source, ctx, args.get("source"))
    sheets = await asyncio.to_thread(price_check.load_table, data, name)
    return {"file": name, "sheets": price_check.overview(sheets)}


def _describe(record: dict) -> str:
    row, item = record["row"], record["item"]
    where = " / ".join([row["sheet"], *row["group"]])
    return f"{item['_image']} 第{item['_pos']}个（{where} {row['sku']} {row['name']}）：{'；'.join(record['problems'])}"


async def check_prices(ctx: ToolContext, args: dict) -> dict:
    folder = str(args.get("folder") or "").strip()
    if not folder:
        return {"error": "需要共享文件夹路径（folder）"}
    data, name = await asyncio.to_thread(_table_source, ctx, args.get("table"), folder)
    sheets = await asyncio.to_thread(price_check.load_table, data, name)
    shown, files, truncated = await asyncio.to_thread(
        shared_folders.find_files, ctx.user, folder, shared_folders.IMAGE_SUFFIXES, MAX_PRICE_IMAGES)
    if not files:
        return {"error": f"{shown} 里没有找到图片"}

    async def progress(done: int, total: int):
        await ctx.emit("tool.progress", {"call_id": ctx.call_id, "message": f"已处理 {done}/{total} 张图"})

    result = await price_check.run_check([(rel, path.read_bytes) for rel, path in files], sheets, progress)
    report = await asyncio.to_thread(price_check.build_report, result)
    job_id = uuid.uuid4().hex
    filename = f"价格文案核对-{time.strftime('%m%d-%H%M')}.xlsx"
    out = settings.output_path / "ai-images" / ctx.user["id"] / "reports" / f"{job_id}.xlsx"
    out.parent.mkdir(parents=True, exist_ok=True)
    await asyncio.to_thread(out.write_bytes, report)
    url = f"/ai-images/{quote(ctx.user['id'])}/reports/{quote(out.name)}"
    artifact, event = store.register_job_artifact(
        job_id, ctx.turn_id, _artifact_event, session_id=ctx.session_id, user_id=ctx.user["id"], kind="file",
        url=url, path=str(out), label=filename, source_tool_call_id=ctx.call_id,
        meta={"operation": "price_check", "table": name, "folder": shown})
    if ctx.publish:
        await ctx.publish(event)
    records = result["records"]
    by_status = {s: [r for r in records if r["status"] == s] for s in price_check.STATUSES}
    priced_unmatched = [it for it in result["unmatched"] if it.get("price") not in (None, "")]
    notes = []
    if truncated:
        notes.append(f"图片超过 {MAX_PRICE_IMAGES} 张，只核对了前 {MAX_PRICE_IMAGES} 张，其余请缩小到子文件夹再核对")
    if result["failed"]:
        notes.append(f"{len(result['failed'])} 张图识别失败，没有核对：" + "；".join(result["failed"][:5]))
    return {
        "folder": shown, "table": name, "images_scanned": result["image_count"], "checked": len(records),
        "counts": {s: len(v) for s, v in by_status.items()},
        "价格不一致": [_describe(r) for r in by_status["不一致"][:MAX_REPORTED]],
        "文案待确认": [_describe(r) for r in by_status["文案待确认"][:MAX_REPORTED]],
        "图上数字没读出来_需人工看": [_describe(r) for r in by_status["未识别"][:10]],
        "图上有价格但表格里没有这个商品": {
            "数量": len(priced_unmatched),
            "举例": [f"{it['_image']} 第{it['_pos']}个：{it.get('name') or ''} ¥{it.get('price')}" for it in priced_unmatched[:10]]},
        "表格有价格但没找到对应图片": {
            "数量": len(result["uncovered"]),
            "举例": [f"{' / '.join([r['sheet'], *r['group']])} {r['sku']} {r['name']}" for r in result["uncovered"][:10]]},
        "说明": notes,
        "files": [{"id": artifact["id"], "url": url, "name": filename}],
    }


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
             "source 填对话里上传的表格 ID，或共享文件夹里的表格路径；不填就用对话里最近上传的表格。",
             {"type": "object", "properties": {"source": {"type": "string"}}},
             read_table),
        Tool("check_prices",
             "核对图片上的价格和文案是否和表格一致：自动识别文件夹（含子文件夹）里每张图上的商品，"
             "按商品名称、文案和价格对应到表格里的行，逐项比对到手价、立省、吊牌价、折扣、充绒量和文案，生成 Excel 报告。"
             "不需要事先知道文件夹结构、文件命名或顺序，也不需要先列目录。只在用户提出要核对时调用。"
             "图片多时要跑几分钟。",
             {"type": "object", "properties": {
                 "folder": {"type": "string", "description": "共享文件夹路径，直接用用户给的写法"},
                 "table": {"type": "string",
                           "description": "表格 ID 或共享文件夹里的表格路径；不填时用对话里上传的表格，没有就用文件夹里的表格"}},
              "required": ["folder"]},
             check_prices),
    ]

"""平台已有的图片处理能力包装成 Agent 工具：抠图、高清放大、转矢量、拆分 PSD 图层、扩图、AI 换装、素材库取图。

都复用画布那一套后台任务（main.start_image_operation、main.submit_outpainting_job、换装 prompt），
Agent 只负责找到图片、等任务结束、把结果登记为会话产物。
"""
from __future__ import annotations

import asyncio
import json
import math
import uuid
from pathlib import Path
from urllib.parse import quote

from fastapi import HTTPException
from PIL import Image, ImageColor

from .. import outfit_change
from ..config import settings
from ..job_store import load_ai_image_job
from . import store
from .engine import Tool, ToolContext
from .tools import (ASPECT_RATIOS, DEFAULT_IMAGE_MODEL, JOB_MAX_WAIT_SECONDS, JOB_POLL_SECONDS, MAX_IMAGES_PER_TURN,
                    _artifact_bytes,
                    _artifact_event, _generate_one, _job_terminal, _main)

# 工具名 → (后台任务的 operation, 中文名, 结果类型)
OPERATIONS = {
    "remove_background": ("matting", "抠图", "image"),
    "upscale_image": ("upscale", "高清放大", "image"),
    "vectorize_image": ("vectorize", "转矢量图", "file"),
    "split_layers": ("layer_extract", "拆分 PSD 图层", "file"),
}


def _source(ctx: ToolContext, image_id) -> dict:
    artifact = store.get_artifact(str(image_id or "").strip(), ctx.user["id"])
    if not artifact:
        raise ValueError(f"找不到图片 {image_id}，请使用对话里出现过的图片 ID")
    if not Path(artifact["path"]).is_file():
        raise ValueError(f"图片 {image_id} 的文件已不存在")
    return artifact


def _agent_meta(ctx: ToolContext) -> dict:
    return {"source": "agent2", "session_id": ctx.session_id, "turn_id": ctx.turn_id, "tool_call_id": ctx.call_id}


async def _wait(ctx: ToolContext, job_id: str, label: str) -> dict | None:
    """以任务记录为准等到终态；超时返回 None。"""
    waited, last = 0.0, -1
    while True:
        job = load_ai_image_job(job_id)
        if _job_terminal(job):
            return job
        if waited > JOB_MAX_WAIT_SECONDS:
            return None
        progress = int((job or {}).get("progress") or 0)
        if progress != last:
            last = progress
            await ctx.emit("tool.progress", {"call_id": ctx.call_id, "message": f"{label}中… {progress}%"})
        await asyncio.sleep(JOB_POLL_SECONDS)
        waited += JOB_POLL_SECONDS


async def _deliver(ctx: ToolContext, job: dict | None, *, label: str, kind: str, operation: str) -> dict:
    if job is None:
        return {"error": f"{label}超时，任务仍在后台处理，稍后可在任务记录里查看"}
    if job["status"] != "done":
        return {"error": str(job.get("error") or f"{label}失败")[:200]}
    url = str(job.get("image_url") or "")
    local = str(_main()._resolve_public_asset_path(url) or "")
    if kind == "file":
        # PSD、SVG 不在对话里当图片展示，只给下载
        artifact = store.create_artifact(session_id=ctx.session_id, user_id=ctx.user["id"], kind="file", url=url,
                                         path=local, label=label, source_tool_call_id=ctx.call_id,
                                         meta={"job_id": job["id"], "operation": operation})
        out = {"files": [{"id": artifact["id"], "url": url, "name": Path(local or url).name, "label": label}]}
        if operation == "layer_extract":
            try:
                trace = json.loads(job.get("prompt_trace") or "{}")
            except ValueError:
                trace = {}
            out["layer_count"] = len(trace.get("layers") or [])
        return out
    registered = store.register_job_artifact(
        job["id"], ctx.turn_id, lambda a: _artifact_event(a), session_id=ctx.session_id, user_id=ctx.user["id"],
        url=url, path=local, label=label, source_tool_call_id=ctx.call_id, meta={"operation": operation})
    if registered:
        artifact, event = registered
        if ctx.publish:
            await ctx.publish(event)
    else:
        artifact = store.find_job_artifact(job["id"])
    return {"images": [{"id": artifact["id"], "url": url, "label": label}]}


def _operation_tool(name: str):
    operation, label, kind = OPERATIONS[name]

    async def handler(ctx: ToolContext, args: dict) -> dict:
        source = _source(ctx, args.get("image_id"))
        job_id = uuid.uuid4().hex
        try:
            _main().start_image_operation(ctx.user, operation, job_id, Path(source["path"]), source["url"],
                                          scale=args.get("scale"), extra_meta=_agent_meta(ctx))
        except HTTPException as exc:
            return {"error": str(exc.detail)}
        return await _deliver(ctx, await _wait(ctx, job_id, label), label=label, kind=kind, operation=operation)
    return handler


# ── 扩图 ──────────────────────────────────────────────────────────────────────

OUTPAINT_DIRECTIONS = ["center", "left", "right", "top", "bottom"]


def _outpaint_geometry(width: int, height: int, ratio: str, expand_percent: float, limits: dict,
                       direction: str = "center") -> dict:
    """按目标比例和额外扩展比例算四边扩展像素；超出上限时按比例缩小处理尺寸。
    direction 为 left/right/top/bottom 时只往那一边扩，额外扩展也只加在那个方向上。"""
    new_w, new_h = float(width), float(height)
    if ratio and ratio != "auto":
        a, b = (float(x) for x in ratio.split(":"))
        if new_w / new_h < a / b:
            new_w = new_h * a / b
        else:
            new_h = new_w * b / a
    grow = 1 + max(0.0, min(float(expand_percent or 0), 100.0)) / 100
    if direction in ("left", "right"):
        new_w *= grow
    elif direction in ("top", "bottom"):
        new_h *= grow
    else:
        new_w, new_h = new_w * grow, new_h * grow
    scale = min(1.0, limits["max_width"] / new_w, limits["max_height"] / new_h,
                math.sqrt(limits["max_area_pixels"] / (new_w * new_h)))
    pw, ph = max(1, int(width * scale)), max(1, int(height * scale))
    ew, eh = int(new_w * scale), int(new_h * scale)
    left, top = (ew - pw) // 2, (eh - ph) // 2
    if direction == "left":
        left = ew - pw
    elif direction == "right":
        left = 0
    elif direction == "top":
        top = eh - ph
    elif direction == "bottom":
        top = 0
    return {"processing_width": pw, "processing_height": ph,
            "outpaint": {"left": left, "right": ew - pw - left, "top": top, "bottom": eh - ph - top}}


async def outpaint_image(ctx: ToolContext, args: dict) -> dict:
    main = _main()
    if not (settings.bfl_outpainting_enabled and settings.bfl_api_key.strip()) or main._outpainting_configuration_error():
        return {"error": "扩图服务暂未开通，请联系管理员"}
    ratio = str(args.get("aspect_ratio") or "auto")
    if ratio not in ASPECT_RATIOS:
        return {"error": f"aspect_ratio 只能是 {', '.join(ASPECT_RATIOS)}"}
    expand = float(args.get("expand_percent") or 0)
    if ratio == "auto" and expand <= 0:
        return {"error": "请给出目标比例 aspect_ratio，或扩展比例 expand_percent"}
    source = _source(ctx, args.get("image_id"))
    with Image.open(source["path"]) as img:
        width, height = img.size
    direction = str(args.get("direction") or "center")
    if direction not in OUTPAINT_DIRECTIONS:
        return {"error": f"direction 只能是 {', '.join(OUTPAINT_DIRECTIONS)}"}
    mode = settings.bfl_outpainting_mode
    body = _outpaint_geometry(width, height, ratio, expand, main._outpainting_effective_limits(mode), direction)
    if not any(body["outpaint"].values()):
        return {"error": "原图已经是这个比例，请说明要往哪边扩、扩多少"}
    try:
        submitted = await main.submit_outpainting_job(
            ctx.user, body, source=Path(source["path"]), source_kind="agent_artifact", source_image_url=source["url"],
            client_request_id=str(uuid.uuid4()), mode=mode, extra_meta=_agent_meta(ctx))
    except HTTPException as exc:
        return {"error": str(exc.detail)}
    except Exception as exc:  # 几何校验等错误
        return {"error": str(exc)[:200]}
    job = await _wait(ctx, submitted["job_id"], "扩图")
    out = await _deliver(ctx, job, label="扩图", kind="image", operation="outpainting")
    if out.get("images"):  # 工具只支持比例，回复里要能说清实际输出尺寸
        out["size"] = f"{submitted.get('expected_width')}×{submitted.get('expected_height')}"
    return out


# ── 换底色（本地合成，不花钱）────────────────────────────────────────────────

def _fill_background(src: Path, out: Path, rgb: tuple) -> bool:
    """透明图铺上纯色底；原图没有透明区域时返回 False。"""
    with Image.open(src) as img:
        rgba = img.convert("RGBA")
    if rgba.getchannel("A").getextrema()[0] == 255:
        return False
    canvas = Image.new("RGBA", rgba.size, (*rgb, 255))
    canvas.alpha_composite(rgba)
    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(out)
    return True


async def fill_background(ctx: ToolContext, args: dict) -> dict:
    source = _source(ctx, args.get("image_id"))
    color = str(args.get("color") or "#FFFFFF").strip()
    try:
        rgb = ImageColor.getrgb(color)[:3]
    except ValueError:
        return {"error": f"颜色 {color} 无法识别，请用 #FFFFFF 这样的色值"}
    job_id = uuid.uuid4().hex
    out = settings.output_path / "ai-images" / ctx.user["id"] / "background" / f"{job_id}.png"
    if not await asyncio.to_thread(_fill_background, Path(source["path"]), out, rgb):
        return {"error": "这张图没有透明背景，请先抠图（remove_background）再换底色"}
    url = f"/ai-images/{quote(ctx.user['id'])}/background/{quote(out.name)}"
    label = "白底图" if rgb == (255, 255, 255) else "换底色"
    registered = store.register_job_artifact(
        job_id, ctx.turn_id, lambda a: _artifact_event(a), session_id=ctx.session_id, user_id=ctx.user["id"],
        url=url, path=str(out), label=label, source_tool_call_id=ctx.call_id, meta={"operation": "fill_background"})
    artifact, event = registered
    if ctx.publish:
        await ctx.publish(event)
    return {"images": [{"id": artifact["id"], "url": url, "label": label}]}


# ── 素材库取图（按货号拼路径查找，不浏览目录）─────────────────────────────────

MAX_LIBRARY_IMAGES = 6


async def find_product_images(ctx: ToolContext, args: dict) -> dict:
    sku = str(args.get("sku") or "").strip()
    asset_type = str(args.get("asset_type") or "").strip()
    assets = await asyncio.to_thread(outfit_change.list_sku_assets, sku)
    if asset_type:
        assets = [a for a in assets if a.get("asset_type") == asset_type]
    if not assets:
        kind = outfit_change.ASSET_TYPE_LABELS.get(asset_type, "商品图") if asset_type else "商品图"
        return {"error": f"素材库里没有找到货号 {sku} 的{kind}，请确认货号，或直接上传图片"}
    images = []
    for asset in assets[:MAX_LIBRARY_IMAGES]:
        src = await asyncio.to_thread(outfit_change.resolve_library_asset, asset["asset_type"], asset["path"])
        # 复制到输出目录：对话卡片能预览下载，后续抠图、放大等工具也能直接用
        job_id = uuid.uuid4().hex
        out = settings.output_path / "ai-images" / ctx.user["id"] / "library" / f"{job_id}{src.suffix.lower()}"
        out.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(out.write_bytes, await asyncio.to_thread(src.read_bytes))
        url = f"/ai-images/{quote(ctx.user['id'])}/library/{quote(out.name)}"
        label = f"{sku} {asset.get('type_label') or ''} {asset.get('angle') or ''}".strip()
        artifact, event = store.register_job_artifact(
            job_id, ctx.turn_id, lambda a: _artifact_event(a), session_id=ctx.session_id, user_id=ctx.user["id"],
            url=url, path=str(out), label=label, source_tool_call_id=ctx.call_id,
            meta={"operation": "library", "sku": sku, "asset_type": asset["asset_type"], "filename": src.name})
        if ctx.publish:
            await ctx.publish(event)
        images.append({"id": artifact["id"], "url": url, "label": label})
    out = {"images": images}
    if len(assets) > MAX_LIBRARY_IMAGES:
        out["note"] = f"共找到 {len(assets)} 张，只取了前 {MAX_LIBRARY_IMAGES} 张"
    return out


# ── AI 换装 ───────────────────────────────────────────────────────────────────

MAX_SKU_ANGLES = 3


async def outfit_change_tool(ctx: ToolContext, args: dict) -> dict:
    person = _source(ctx, args.get("person_image_id"))
    slots = [s for s in (args.get("slots") or []) if s in outfit_change.GARMENT_SLOTS]
    refs: list[tuple[bytes, str]] = [_artifact_bytes(ctx, person["id"])]
    references: list[dict] = []
    for idx, image_id in enumerate(args.get("garment_image_ids") or []):
        refs.append(_artifact_bytes(ctx, image_id))
        references.append({"source": "upload", "sku": "", "slot": slots[0] if len(slots) == 1 else "",
                           "type_label": "用户图片", "angle": f"素材 {idx + 1}"})
    sku = str(args.get("sku") or "").strip()
    if sku:
        assets = await asyncio.to_thread(outfit_change.list_sku_assets, sku)
        picked = [a for a in assets if a.get("asset_type") == "white"][:MAX_SKU_ANGLES] or assets[:MAX_SKU_ANGLES]
        if not picked:
            return {"error": f"素材库里没有找到货号 {sku} 的商品图，请上传服装图片"}
        for asset in picked:
            path = await asyncio.to_thread(outfit_change.resolve_library_asset, asset["asset_type"], asset["path"])
            refs.append((await asyncio.to_thread(path.read_bytes), path.name))
            references.append({"source": "library", "sku": sku, "slot": slots[0] if len(slots) == 1 else "",
                               "type_label": outfit_change.ASSET_TYPE_LABELS.get(asset["asset_type"], asset["asset_type"]),
                               "angle": asset.get("angle") or ""})
    if len(refs) < 2:
        return {"error": "需要服装图片：请上传服装图，或提供素材库货号"}
    if len(refs) - 1 > outfit_change.MAX_GARMENT_REFERENCES:
        return {"error": f"服装图最多 {outfit_change.MAX_GARMENT_REFERENCES} 张"}
    prompt = outfit_change.build_outfit_prompt(references=references, target_slots=slots,
                                               extra_prompt=str(args.get("extra_prompt") or ""))
    with Image.open(person["path"]) as img:
        size = outfit_change.nearest_aspect_ratio(*img.size)
    used = int(ctx.state.get("images", 0))
    if used + 1 > MAX_IMAGES_PER_TURN:
        return {"error": f"本轮最多生成 {MAX_IMAGES_PER_TURN} 张，已生成 {used} 张"}
    ctx.state["images"] = used + 1
    result = await _generate_one(
        ctx, 0, {"prompt": prompt, "label": "AI 换装"}, model=DEFAULT_IMAGE_MODEL, variant="flare",
        size=size if size in ASPECT_RATIOS else "auto", resolution="1K", refs=refs, group_id=None, group_type=None,
        extra_meta={"operation": "outfit-change", "outfit": {"skus": [sku] if sku else [], "target_slots": slots}})
    if result.get("error"):
        return {"error": result["error"]}
    return {"images": [result]}


def build_image_op_tools() -> list[Tool]:
    image_id = {"type": "string", "description": "要处理的图片 ID（img_ 开头）"}
    return [
        Tool("remove_background", "抠图：去掉图片背景，得到透明底 PNG。用户说抠图、去背景、去底、要透明底时使用。",
             {"type": "object", "properties": {"image_id": image_id}, "required": ["image_id"]},
             _operation_tool("remove_background")),
        Tool("fill_background", "换底色：给透明底图片铺上纯色背景（默认白底），本地处理，不改变主体。"
             "用户要白底图、纯色底时使用；原图不是透明底的，先用 remove_background 抠图。",
             {"type": "object", "properties": {"image_id": image_id,
                                               "color": {"type": "string", "description": "背景色，默认 #FFFFFF 白色"}},
              "required": ["image_id"]},
             fill_background),
        Tool("upscale_image", "高清放大：把图片放大 2 倍或 4 倍，提高清晰度，不改变内容。",
             {"type": "object", "properties": {"image_id": image_id,
                                               "scale": {"type": "integer", "enum": [2, 4], "description": "默认 2"}},
              "required": ["image_id"]},
             _operation_tool("upscale_image")),
        Tool("vectorize_image", "转矢量图：把图片转成 SVG 文件（适合 logo、图标、简单图形），结果以文件形式下载。",
             {"type": "object", "properties": {"image_id": image_id}, "required": ["image_id"]},
             _operation_tool("vectorize_image")),
        Tool("split_layers", "拆分 PSD 图层：把一张图拆成背景、主体、文字等图层，导出可编辑的分层 PSD 文件。"
             "用户说拆分图层、转 PSD、要分层源文件时使用。",
             {"type": "object", "properties": {"image_id": image_id}, "required": ["image_id"]},
             _operation_tool("split_layers")),
        Tool("outpaint_image", "扩图：在原图四周或某一边补画内容，原图内容不变。给目标比例，"
             "或给 expand_percent 让画面往外扩；用户说只往某一边扩时填 direction。只能按比例扩，不能指定精确像素，结果里的 size 是实际输出尺寸。用户说扩图、画面不够大、改成横版/竖版但保留原图时使用。",
             {"type": "object", "properties": {
                 "image_id": image_id,
                 "aspect_ratio": {"type": "string", "enum": ASPECT_RATIOS, "description": "目标比例；不改比例时用 auto"},
                 "expand_percent": {"type": "number", "description": "在目标比例基础上再扩展的百分比，0–100"},
                 "direction": {"type": "string", "enum": OUTPAINT_DIRECTIONS,
                               "description": "往哪边扩：center 四周（默认）、left、right、top、bottom"}},
              "required": ["image_id"]},
             outpaint_image),
        Tool("find_product_images", "素材库取图：按货号从公司商品素材库取出商品图（白底图、透明 PNG、模特图等），"
             "直接作为图片发给用户，之后可以继续抠图、换底色、做海报参考。只能按完整货号查，不能浏览或搜索文件夹。",
             {"type": "object", "properties": {
                 "sku": {"type": "string", "description": "商品货号"},
                 "asset_type": {"type": "string", "enum": list(outfit_change.ASSET_TYPE_LABELS),
                                "description": "图片类型：" + "、".join(f"{k} {v}" for k, v in outfit_change.ASSET_TYPE_LABELS.items())
                                               + "；用户没说就不填，返回全部类型"}},
              "required": ["sku"]},
             find_product_images),
        Tool("outfit_change", "AI 换装：给人物照片换上指定服装，保持人物、姿势和背景不变。"
             "服装来自用户上传的服装图（garment_image_ids），或素材库货号（sku）。",
             {"type": "object", "properties": {
                 "person_image_id": {"type": "string", "description": "人物或模特照片的图片 ID"},
                 "garment_image_ids": {"type": "array", "items": {"type": "string"}, "description": "服装图片 ID"},
                 "sku": {"type": "string", "description": "素材库货号，没有就不填"},
                 "slots": {"type": "array", "items": {"type": "string", "enum": list(outfit_change.GARMENT_SLOTS)},
                           "description": "要替换的部位，例如 top 上衣、bottom 裤装、shoes 鞋；不确定就不填"},
                 "extra_prompt": {"type": "string", "description": "额外要求，没有就不填"}},
              "required": ["person_image_id"]},
             outfit_change_tool),
    ]

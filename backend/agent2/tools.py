"""工具层：平台能力包装成 Agent 可调用的工具（方案第 5 节、D13）。

工具直接调用现有业务模块，不走 HTTP；需要 main.py 内部函数的地方延迟导入，
避免循环依赖。返回给模型的结果保持精简：只给产物 ID、标签和地址。
"""
from __future__ import annotations

import asyncio
import json
import time
import uuid
from pathlib import Path

from ..agent_skill_loader import build_skill_context, load_agent_skill, load_reference_text
from ..ai_image import compress_image_to_data_url, smart_generate_image_async
from ..config import settings
from ..job_store import save_ai_image_job
from ..model_routing import routed_chat_completion
from . import store
from .engine import Tool, ToolContext

DEFAULT_IMAGE_MODEL = "gpt-image-2.5"
ASPECT_RATIOS = ["auto", "1:1", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "2:3", "3:2"]
MAX_IMAGES_PER_CALL = 6
MAX_IMAGES_PER_TURN = 12


def _main():
    from .. import main  # 延迟导入：main 在启动时才会 import 本模块
    return main


def _artifact_bytes(ctx: ToolContext, artifact_id: str) -> tuple[bytes, str]:
    artifact = store.get_artifact(str(artifact_id or "").strip(), ctx.user["id"])
    if not artifact:
        raise ValueError(f"找不到图片 {artifact_id}，请使用对话里出现过的图片 ID")
    path = Path(artifact["path"])
    if not path.is_file():
        raise ValueError(f"图片 {artifact_id} 的文件已不存在")
    return path.read_bytes(), path.name


# ── generate_image ────────────────────────────────────────────────────────────

async def _generate_one(ctx: ToolContext, index: int, item: dict, *, size: str, resolution: str,
                        refs: list[tuple[bytes, str]], group_id: str | None, group_type: str | None) -> dict:
    prompt = str(item.get("prompt") or "").strip()
    label = str(item.get("label") or "").strip()
    # 单张指定的参考图优先：修改多张已有图时，每张只参考它自己的原图
    if item.get("reference_image_ids"):
        refs = [_artifact_bytes(ctx, rid) for rid in item["reference_image_ids"]]
    job_id = uuid.uuid4().hex
    created_at = time.time()
    meta = {"source": "agent2", "session_id": ctx.session_id, "turn_id": ctx.turn_id, "tool_call_id": ctx.call_id}
    job_args = dict(job_id=job_id, user_id=ctx.user["id"], model=DEFAULT_IMAGE_MODEL, prompt=prompt, size=size,
                    resolution=resolution, has_reference=bool(refs), reference_count=len(refs),
                    request_meta=meta, created_at=created_at)
    save_ai_image_job(status="processing", **job_args)

    async def on_progress(pct, _status=""):
        await ctx.emit("tool.progress", {"call_id": ctx.call_id, "index": index, "label": label, "progress": int(pct or 0)})

    def progress_cb(pct: int, status: str = ""):
        asyncio.get_running_loop().create_task(on_progress(pct, status))

    try:
        result = await smart_generate_image_async(
            model=DEFAULT_IMAGE_MODEL, prompt=prompt, images=refs or None, size=size, resolution=resolution,
            user_id=ctx.user["id"], on_progress=progress_cb,
        )
    except asyncio.CancelledError:
        save_ai_image_job(status="failed", error="用户已停止", **job_args)
        raise
    except Exception as exc:
        save_ai_image_job(status="failed", error=str(exc)[:500], **job_args)
        return {"index": index, "label": label, "error": str(exc)[:200]}
    url = str(result.get("url") or "")
    save_ai_image_job(status="done", image_url=url, provider=str(result.get("provider") or ""), progress=100, **job_args)
    local = _main()._resolve_public_asset_path(url)
    artifact = store.create_artifact(
        session_id=ctx.session_id, user_id=ctx.user["id"], kind="image", url=url, path=str(local or ""),
        label=label, group_id=group_id, group_type=group_type, position=index, source_tool_call_id=ctx.call_id,
        meta={"prompt": prompt, "job_id": job_id, "provider": result.get("provider")},
    )
    await ctx.emit("artifact.created", {"call_id": ctx.call_id, "artifact": {
        "id": artifact["id"], "url": url, "label": label, "group_id": group_id, "group_type": group_type,
        "position": index}})
    return {"index": index, "label": label, "id": artifact["id"], "url": url}


async def generate_image(ctx: ToolContext, args: dict) -> dict:
    items = args.get("images") or []
    if not isinstance(items, list) or not items:
        return {"error": "images 不能为空，至少给出一张图的 prompt"}
    items = [i for i in items if isinstance(i, dict) and str(i.get("prompt") or "").strip()]
    if len(items) > MAX_IMAGES_PER_CALL:
        return {"error": f"一次最多生成 {MAX_IMAGES_PER_CALL} 张，请分批"}
    used = int(ctx.state.get("images", 0))
    if used + len(items) > MAX_IMAGES_PER_TURN:
        return {"error": f"本轮最多生成 {MAX_IMAGES_PER_TURN} 张，已生成 {used} 张"}
    ctx.state["images"] = used + len(items)
    ratio = str(args.get("aspect_ratio") or "auto")
    if ratio not in ASPECT_RATIOS:
        return {"error": f"aspect_ratio 只能是 {', '.join(ASPECT_RATIOS)}"}
    resolution = str(args.get("resolution") or "1K").upper()
    refs = [_artifact_bytes(ctx, rid) for rid in (args.get("reference_image_ids") or [])]
    group_type = args.get("group_type") if args.get("group_type") in {"set", "variant"} else None
    group_id = ("grp_" + uuid.uuid4().hex[:8]) if group_type else None
    results = await asyncio.gather(*[
        _generate_one(ctx, i, item, size=ratio, resolution=resolution, refs=refs,
                      group_id=group_id, group_type=group_type)
        for i, item in enumerate(items)
    ])
    ok = [r for r in results if r.get("id")]
    failed = [r for r in results if r.get("error")]
    return {"images": ok, "failed": failed, "group_id": group_id}


# ── analyze_image ─────────────────────────────────────────────────────────────

async def analyze_image(ctx: ToolContext, args: dict) -> dict:
    data, _name = _artifact_bytes(ctx, args.get("image_id"))
    question = str(args.get("question") or "").strip() or "描述这张图：主体是什么、外观特征、颜色材质、构图和风格，图里有哪些文字。"
    payload = {
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": question + "\n用中文简洁回答，不超过 200 字。"},
            {"type": "image_url", "image_url": {"url": compress_image_to_data_url(data, 1024)}},
        ]}],
        "max_tokens": 600, "temperature": 0.2,
    }
    resp = await routed_chat_completion("vlm", payload, timeout=60)
    content = (((resp.json() or {}).get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    return {"analysis": str(content).strip()}


# ── ask_user（挂起轮次，由引擎处理）──────────────────────────────────────────

async def ask_user(ctx: ToolContext, args: dict) -> dict:  # 不会被直接执行
    return {}


# ── 技能 ──────────────────────────────────────────────────────────────────────

def _load_skill(ctx: ToolContext, name: str):
    skill = load_agent_skill(settings.agent_skill_paths, settings.root_dir, str(name or "").strip(),
                             _main()._user_skill_dir(ctx.user))
    if not skill:
        raise ValueError(f"技能 {name} 不存在")
    return skill


async def load_skill(ctx: ToolContext, args: dict) -> dict:
    skill = _load_skill(ctx, args.get("name"))
    return {"name": skill.name, "content": build_skill_context(skill), "references": skill.references}


async def read_skill_file(ctx: ToolContext, args: dict) -> dict:
    skill = _load_skill(ctx, args.get("name"))
    text = load_reference_text(skill, str(args.get("path") or ""))
    if text is None:
        return {"error": "文件不存在或不在技能目录内"}
    return {"path": args.get("path"), "content": text[:20000]}


# ── special_compose（特殊品，编排逻辑从前端下沉到这里）──────────────────────

def _pick_special_group(full: bool) -> list:
    templates = _main().list_templates()
    frames = [t for t in templates if (t.is_special_full if full else (t.is_special and not t.is_special_full))]
    if not frames:
        return []
    first = frames[0]
    return [t for t in frames if t.file_id == first.file_id and t.group_name == first.group_name]


async def special_compose(ctx: ToolContext, args: dict) -> dict:
    from ..models import SpecialComposeJob, SpecialComposeRequest, SpecialFullComposeJob, SpecialFullComposeRequest
    from ..special_compose import detect_special_materials, run_special_compose
    from ..special_compose_full import run_special_full_compose
    from ..job_store import log_operation, save_special_job

    main = _main()
    sku = str(args.get("sku") or "").strip()
    if not sku:
        return {"error": "缺少 SKU，请向用户询问货号"}
    fields = {"name": str(args.get("name") or "").strip(), "time": str(args.get("time") or "").strip()}
    route = str(args.get("route") or "auto")

    async def step(message: str):
        await ctx.emit("tool.progress", {"call_id": ctx.call_id, "message": message})

    if route == "auto":
        detect = await asyncio.to_thread(detect_special_materials, sku)
        full = bool(detect.get("has_scene"))
        found = [n for n, k in (("Banner", "banner_found"), ("Poster", "poster_found"), ("Poster1", "poster1_found")) if detect.get(k)]
        await step(f"检测素材：发现 {'、'.join(found)}，走完整线路" if full else "检测素材：未发现场景图，走普通线路")
    else:
        full = route == "full"
    try:
        group = await asyncio.to_thread(_pick_special_group, full)
    except Exception as exc:
        return {"error": f"读取模板失败（Penpot 可能不可用）：{exc}"}
    if not group:
        return {"error": f"没有找到{'特殊品（完整）' if full else '特殊品'}模板"}
    req_cls, job_cls, runner = ((SpecialFullComposeRequest, SpecialFullComposeJob, run_special_full_compose) if full
                                else (SpecialComposeRequest, SpecialComposeJob, run_special_compose))
    request = req_cls(file_id=group[0].file_id, page_id=group[0].page_id, frame_ids=[t.id for t in group],
                      sku=sku, fields=fields, export_scale=2.0)
    job = job_cls(id=str(uuid.uuid4()), user_id=ctx.user["id"], request=request, created_at=time.time())
    with main._jobs_lock:
        main._jobs[job.id] = job
    save_special_job(job)
    log_operation(user_id=ctx.user["id"], username=ctx.user.get("username", ""), action="compose",
                  detail=f"kind=special sku={sku} source=agent2", payload=request.model_dump_json())
    await step(f"开始合成 {len(group)} 个画板")
    task = asyncio.create_task(asyncio.to_thread(runner, job))
    seen = 0
    while not task.done():
        await asyncio.sleep(1.5)
        lines = list(job.progress or [])
        for line in lines[seen:]:
            await step(str(line))
        seen = len(lines)
    await task
    if str(getattr(job.status, "value", job.status)) != "done":
        return {"error": job.error or "特殊品合成失败"}
    group_id = "grp_" + uuid.uuid4().hex[:8]
    images = []
    for i, image in enumerate(main._special_canvas_images(job)):
        local = main._resolve_public_asset_path(image.url)
        artifact = store.create_artifact(
            session_id=ctx.session_id, user_id=ctx.user["id"], kind="image", url=image.url, path=str(local or ""),
            label=image.name, group_id=group_id, group_type="set", position=i, source_tool_call_id=ctx.call_id,
            meta={"special_job_id": job.id, "download_url": image.download_url},
        )
        await ctx.emit("artifact.created", {"call_id": ctx.call_id, "artifact": {
            "id": artifact["id"], "url": image.url, "label": image.name, "group_id": group_id,
            "group_type": "set", "position": i}})
        images.append({"id": artifact["id"], "label": image.name, "url": image.url})
    return {"flow": "特殊品（完整）" if full else "特殊品", "images": images,
            "zip_url": f"{'/special-compose-full' if full else '/special-compose'}/{job.id}/download-zip"}


# ── 注册表 ────────────────────────────────────────────────────────────────────

def build_tools() -> dict[str, Tool]:
    tools = [
        Tool("generate_image",
             "生成图片（文生图或参考图生图）。images 里每一项生成一张，可以各自不同的 prompt；"
             "多张一起交付的套图（详情页等）用 group_type=set，多个备选方案用 group_type=variant。"
             "reference_image_ids 填对话中出现过的图片 ID（img_ 开头），作为所有张共用的参考图；"
             "修改多张已有图时，改用每一项自己的 reference_image_ids，一张对应一张。",
             {"type": "object", "properties": {
                 "images": {"type": "array", "maxItems": MAX_IMAGES_PER_CALL, "items": {"type": "object", "properties": {
                     "prompt": {"type": "string", "description": "这张图的生图描述，以用户原话为主体"},
                     "label": {"type": "string", "description": "可选，这张图的名称，例如\"首屏主视觉\""},
                     "reference_image_ids": {"type": "array", "items": {"type": "string"},
                                             "description": "可选，只用于这一张的参考图；修改多张已有图时，每张填它自己的原图 ID"}},
                     "required": ["prompt"]}},
                 "aspect_ratio": {"type": "string", "enum": ASPECT_RATIOS},
                 "resolution": {"type": "string", "enum": ["1K", "2K"]},
                 "reference_image_ids": {"type": "array", "items": {"type": "string"}},
                 "group_type": {"type": "string", "enum": ["set", "variant"]}},
              "required": ["images"]},
             generate_image),
        Tool("analyze_image", "看图：理解用户上传的参考图或商品图，返回主体、外观、风格、文字等描述。",
             {"type": "object", "properties": {"image_id": {"type": "string"}, "question": {"type": "string"}},
              "required": ["image_id"]},
             analyze_image),
        Tool("ask_user", "向用户提一个问题并给出 2–4 个选项。只在确实无法继续时使用（例如缺少 SKU），不要用来确认方向。",
             {"type": "object", "properties": {"question": {"type": "string"},
                                               "options": {"type": "array", "items": {"type": "string"}, "maxItems": 4}},
              "required": ["question"]},
             ask_user, suspends=True),
        Tool("load_skill", "加载一个技能的完整说明（技能目录里列出的技能）。",
             {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]},
             load_skill),
        Tool("read_skill_file", "读取技能目录里的参考文件，例如 references/xxx.md。",
             {"type": "object", "properties": {"name": {"type": "string"}, "path": {"type": "string"}},
              "required": ["name", "path"]},
             read_skill_file),
        Tool("special_compose",
             "平台原生功能：特殊品合成。用户说\"做一个特殊品 SKU，文案，时间\"或类似意思时直接调用。"
             "工具会自动检测素材、选择普通或完整线路、找到模板并合成，返回一组图片（套图）。",
             {"type": "object", "properties": {
                 "sku": {"type": "string", "description": "货号"},
                 "name": {"type": "string", "description": "文案（商品名称等）"},
                 "time": {"type": "string", "description": "时间文案，例如\"3月28日 10点发售\"，没有就留空"},
                 "route": {"type": "string", "enum": ["auto", "normal", "full"], "description": "默认 auto"}},
              "required": ["sku"]},
             special_compose),
    ]
    return {t.name: t for t in tools}

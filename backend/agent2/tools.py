"""工具层：平台能力包装成 Agent 可调用的工具（方案第 5 节、D13）。

工具直接调用现有业务模块，不走 HTTP；需要 main.py 内部函数的地方延迟导入，
避免循环依赖。返回给模型的结果保持精简：只给产物 ID、标签和地址。
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
import uuid
from pathlib import Path
from typing import Sequence
from urllib.parse import quote

from ..agent_skill_loader import SKILL_CONTEXT_MAX_CHARS, build_skill_context, load_agent_skill, load_reference_text
from ..ai_image import GPT_IMAGE_26_MODELS, compress_image_to_data_url, save_user_refs, wants_gif_output
from ..ai_job_recovery import execute_image_job
from ..character_cards import build_character_prompt
from ..config import settings
from ..seedream import SEEDREAM_MODEL, upgrade_seedream_model
from ..job_store import load_ai_image_job, save_ai_image_job, save_image_checkpoint
from ..model_routing import routed_chat_completion
from ..user_skill_store import IMAGE_SUFFIXES
from . import memory, store
from .engine import Tool, ToolContext, user_cancelled

DEFAULT_IMAGE_MODEL = "gpt-image-2.6"
IMAGE_MODELS = ["gpt-image-2.6", "gpt-image-2.5", "gpt-image-2", "nano-banana-pro", "nano-banana-2.1",
                SEEDREAM_MODEL]
RESOLUTIONS = ["1K", "2K", "4K"]
ASPECT_RATIOS = ["auto", "1:1", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "2:3", "3:2"]
MAX_IMAGES_PER_CALL = 6
MAX_IMAGES_PER_TURN = 12
MAX_REFERENCES_PER_IMAGE = 9
JOB_POLL_SECONDS = 1.5
JOB_MAX_WAIT_SECONDS = 15 * 60

logger = logging.getLogger(__name__)


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

# 结果是文件（只给下载、不进画布）的处理任务
FILE_OPERATIONS = {"vectorize", "layer_extract"}


def create_job_artifact(job: dict, recovered: bool = False) -> tuple[dict, dict] | None:
    """把完成的 Agent 任务（生图、抠图、放大、扩图、转矢量、拆 PSD 等）登记为会话产物，
    并在同一事务里写入 artifact.created 事件；同一任务只登记一次（实时完成、重启恢复、补交付扫描共用），
    已登记过返回 None。"""
    meta = job.get("request_meta") or {}
    url = str(job.get("image_url") or "")
    if job.get("status") != "done" or not url or meta.get("source") != "agent2":
        return None
    local = str(_main()._resolve_public_asset_path(url) or "")
    operation = str(meta.get("operation") or "")
    extra: dict = {"prompt": job.get("prompt"), "provider": job.get("provider"), "operation": operation}
    if operation in ("", "outfit-change"):  # 生图记下实际请求的模型，卡片据此显示，不依赖模型写的 label
        extra["model"] = job.get("model")
    if operation == "layer_extract":
        try:
            extra["layer_count"] = len(json.loads(job.get("prompt_trace") or "{}").get("layers") or [])
        except (ValueError, AttributeError):
            pass
    if recovered:
        extra.update(recovered=True, announced=False)
    return store.register_job_artifact(
        job["id"], meta.get("turn_id") or "", lambda artifact: _artifact_event(artifact, recovered),
        kind="file" if operation in FILE_OPERATIONS else "image",
        session_id=meta["session_id"], user_id=job["user_id"], url=url, path=local,
        label=meta.get("label") or "", group_id=meta.get("group_id"), group_type=meta.get("group_type"),
        position=int(meta.get("position") or 0), source_tool_call_id=meta.get("tool_call_id"), meta=extra,
    )


def _artifact_event(artifact: dict, recovered: bool = False) -> dict:
    out = {"id": artifact["id"], "url": artifact["url"], "label": artifact["label"], "group_id": artifact["group_id"],
           "group_type": artifact["group_type"], "position": artifact["position"], "kind": artifact.get("kind") or "image"}
    if (artifact.get("meta") or {}).get("model"):
        out["model"] = artifact["meta"]["model"]
    if out["kind"] == "file":
        out["name"] = Path(artifact.get("path") or artifact["url"]).name
        if (artifact.get("meta") or {}).get("layer_count"):
            out["layer_count"] = artifact["meta"]["layer_count"]
    return {"call_id": artifact["source_tool_call_id"], "recovered": recovered, "artifact": out}


async def backfill_recovered_job(job_id: str) -> None:
    """服务重启后由后台恢复完成的 Agent 生图：补登产物并追加事件；前端据 recovered 更新卡片、交付画布，
    下一轮开始时再把图片 ID 告诉模型。"""
    job = load_ai_image_job(job_id)
    if job:
        create_job_artifact(job, recovered=True)


def deliver_finished_jobs() -> int:
    """补交付扫描：已完成但结果还没进会话的 Agent 任务，只补登产物和事件，不重新发起任务。
    覆盖工具等待超时后才完成、完成落库与登记产物之间服务重启、扩图由自己的恢复流程完成等情况。"""
    delivered = 0
    for job_id in store.list_undelivered_job_ids():
        job = load_ai_image_job(job_id)
        if job and create_job_artifact(job, recovered=True):
            delivered += 1
    return delivered


def _job_terminal(job: dict | None) -> bool:
    return bool(job) and (job["status"] == "failed" or (job["status"] == "done" and bool(job.get("image_url"))))


def _character_artifact(ctx: ToolContext, artifact_id: str) -> dict | None:
    artifact = store.get_artifact(artifact_id, ctx.user["id"])
    return artifact if artifact and artifact["kind"] == "character_ref" else None


def _with_character_prompt(ctx: ToolContext, prompt: str, ref_ids: Sequence[str]) -> str:
    """这一张用了角色图时，由后端按实际参考图顺序追加人物段，不依赖模型自己写。"""
    current = {person["id"]: person for person in store.turn_characters(ctx.turn_id)}
    people: dict[str, dict] = {}
    others: list[int] = []
    for index, ref_id in enumerate(ref_ids, 1):
        artifact = _character_artifact(ctx, ref_id)
        if not artifact:
            others.append(index)
            continue
        meta = json.loads(artifact.get("meta_json") or "{}")
        card_id = str(meta.get("card_id") or artifact["id"])
        # 这一轮选中的以最新资料为准；模型沿用之前轮次的角色图时用登记时的快照
        person = people.setdefault(card_id, {**(current.get(card_id) or meta.get("person") or {
            "name": artifact["label"], "gender": "", "description": ""}), "indexes": []})
        person["indexes"].append(index)
    return f"{prompt}\n\n{build_character_prompt(list(people.values()), others)}" if people else prompt


async def _generate_one(ctx: ToolContext, index: int, item: dict, *, model: str, variant: str,
                        size: str, resolution: str, refs: list[tuple[bytes, str]], group_id: str | None, group_type: str | None,
                        extra_meta: dict | None = None, shared_ids: Sequence[str] = ()) -> dict:
    written_prompt = str(item.get("prompt") or "").strip()
    label = str(item.get("label") or "").strip()
    # 单张指定的参考图优先：修改多张已有图时，每张只参考它自己的原图
    ref_ids = [str(rid) for rid in item.get("reference_image_ids") or shared_ids]
    kept = [rid for rid in ref_ids if not _character_artifact(ctx, rid)] if item.get("no_character") else ref_ids
    if item.get("reference_image_ids") or kept != ref_ids:
        ref_ids, refs = kept, [_artifact_bytes(ctx, rid) for rid in kept]
    prompt = _with_character_prompt(ctx, written_prompt, ref_ids)
    uid = ctx.user["id"]
    job_id = uuid.uuid4().hex
    # 和普通生图一样建成可恢复任务：执行锁防重复执行，断点记录上游 task_id，重启后由后台续跑
    meta = {"source": "agent2", "session_id": ctx.session_id, "turn_id": ctx.turn_id, "tool_call_id": ctx.call_id,
            "position": index, "label": label, "group_id": group_id, "group_type": group_type,
            "recovery": {"version": 1, "phase": "queued"}, "execution_prompt": prompt, "chat_session_id": "",
            "variant": variant, "quality": "auto", "reference_storage_job_id": job_id,
            "reference_names": [name for _data, name in refs], **(extra_meta or {})}
    # 和普通生图一致：2.6 文生图且提示词要动图时出 GIF
    if model in GPT_IMAGE_26_MODELS and not refs and wants_gif_output(prompt):
        meta["output_format"] = "gif"
    if refs:
        save_user_refs(uid, job_id, refs)
    save_ai_image_job(job_id=job_id, user_id=uid, status="processing", model=model, prompt=prompt, size=size,
                      provider="auto", resolution=resolution, original_prompt=written_prompt, resolved_prompt=prompt,
                      has_reference=bool(refs), reference_count=len(refs), request_meta=meta, created_at=time.time())
    worker = asyncio.create_task(execute_image_job(
        _main()._execute_ai_image_background, job_id,
        initial={"refs": refs, "username": str(ctx.user.get("username") or "")}))
    last_progress, waited = -1, 0.0
    try:
        # 以任务记录为准：执行者也可能是抢先认领这条任务的后台恢复扫描
        while True:
            if not worker.done():
                await asyncio.wait({worker}, timeout=JOB_POLL_SECONDS)
            else:
                await asyncio.sleep(JOB_POLL_SECONDS)
            job = load_ai_image_job(job_id)
            if _job_terminal(job):
                break
            waited += JOB_POLL_SECONDS
            if waited > JOB_MAX_WAIT_SECONDS:
                return {"index": index, "label": label, "error": "生成超时，任务仍在后台继续，完成后会补回到会话里"}
            progress = int((job or {}).get("progress") or 0)
            if progress != last_progress:
                last_progress = progress
                await ctx.emit("tool.progress", {"call_id": ctx.call_id, "index": index, "label": label, "progress": progress})
    except asyncio.CancelledError:
        worker.cancel()
        with contextlib.suppress(BaseException):
            await worker
        if ctx.turn_id in user_cancelled:
            # 用户主动停止：不再恢复这条任务；服务重启导致的取消则保留断点，交给后台续跑
            job = load_ai_image_job(job_id)
            if job and job["status"] != "done":
                job_meta = job["request_meta"]
                job_meta.setdefault("recovery", {}).update(phase="cancelled", resuming=False, message="用户已停止")
                save_image_checkpoint(job_id, job_meta, provider=str(job.get("provider") or "auto"),
                                      task_id=str(job.get("task_id") or ""), error="用户已停止", status="failed")
        raise
    if job["status"] != "done":
        return {"index": index, "label": label, "error": str(job.get("error") or "生成失败")[:200]}
    registered = create_job_artifact(job)
    if registered:
        artifact, event = registered
        if ctx.publish:  # 事件已和产物一起落库，这里只推送
            await ctx.publish(event)
    else:  # 已由其它途径登记过
        artifact = store.find_job_artifact(job_id)
    return {"index": index, "label": label, "id": artifact["id"], "url": artifact["url"], "model": model}


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
    if resolution not in RESOLUTIONS:
        return {"error": f"resolution 只能是 {', '.join(RESOLUTIONS)}"}
    model = str(args.get("model") or DEFAULT_IMAGE_MODEL)
    # 每张可以单独指定模型（例如用户要对比几个模型），没填的用整批的 model
    models = [upgrade_seedream_model(item.get("model") or model) for item in items]
    bad = sorted({m for m in models if m not in IMAGE_MODELS})
    if bad:
        return {"error": f"model 只能是 {', '.join(IMAGE_MODELS)}（收到 {', '.join(bad)}）"}
    variant = "sunburst" if args.get("variant") == "sunburst" else "flare"
    shared_ids = [str(rid) for rid in (args.get("reference_image_ids") or [])]
    # 技能参考图（动作包等）通常一张图配一张，放在整批共用参考里时模型往往只登记了一张就让所有图共用
    if len(items) > 1 and any((store.get_artifact(rid, ctx.user["id"]) or {}).get("kind") == "skill_ref"
                              for rid in shared_ids):
        ctx.state["images"] = used
        return {"error": "技能参考图不能放在整批共用的 reference_image_ids 里：请写进每一项自己的 reference_image_ids，"
                         "每张放它自己要用的那张（连同人物、产品、场景图）；确实每张都用同一张时，也在每一项里分别填"}
    registered = set(ctx.state.get("skill_refs") or [])
    if ctx.state.get("skill_ref_attempted"):
        if not registered:
            ctx.state["images"] = used
            return {"error": "这一轮要用技能参考图，但还没有登记成功：按 use_skill_image 返回的 nearby 或技能数据里的真实路径重新登记"}
        # 逐张检查：每一项自己的参考图会替换整批共用的，所以按实际生效的那组判断
        missing = [i + 1 for i, item in enumerate(items)
                   if not registered & {str(rid) for rid in (item.get("reference_image_ids") or shared_ids)}]
        if missing:
            ctx.state["images"] = used
            return {"error": "第 " + "、".join(map(str, missing)) + " 张没有传技能参考图（这一轮登记的是 "
                             + "、".join(sorted(registered)) + "）：把它要用的那张写进它自己的 reference_image_ids"}
    # 这一轮选了人物时，每一张都要真的带上全部人物参考图；用户明确说不要人物的那一张除外
    character_ids = [rid for person in store.turn_characters(ctx.turn_id) for rid in person["artifact_ids"]]
    if character_ids:
        effective = [[str(rid) for rid in (item.get("reference_image_ids") or shared_ids)]
                     for item in items if not item.get("no_character")]
        if any(not set(character_ids) <= set(ids) for ids in effective):
            ctx.state["images"] = used
            return {"error": "这一轮指定了人物，每一张都要把这些人物参考图全部放进 reference_image_ids：" + "、".join(character_ids)
                             + "。修改已有图时和原图一起放；用户明确说某张不要人物时，给那一项设 no_character=true"}
        if any(len(ids) > MAX_REFERENCES_PER_IMAGE for ids in effective):
            ctx.state["images"] = used
            return {"error": f"一张图最多 {MAX_REFERENCES_PER_IMAGE} 张参考图，人物参考图不能去掉，请减少其他参考图"}
    refs = [_artifact_bytes(ctx, rid) for rid in shared_ids]
    group_type = args.get("group_type") if args.get("group_type") in {"set", "variant"} else None
    group_id = ("grp_" + uuid.uuid4().hex[:8]) if group_type else None
    results = await asyncio.gather(*[
        _generate_one(ctx, i, item, model=models[i], variant=variant, size=ratio, resolution=resolution, refs=refs,
                      group_id=group_id, group_type=group_type, shared_ids=shared_ids)
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


# 技能原文常为别的 Agent 环境写成（写文件、跑脚本、自评迭代），加载时附上本平台的执行方式
SKILL_PLATFORM_NOTE = """

# 在 DesignFlow 里执行技能
技能原文可能是为别的 Agent 环境写的，和下面的规定冲突时以这里为准；技能里的审美规律、默认值、检查清单、prompt 写法和硬规则照常使用。
- 技能要求动手前或拼 prompt 时要读的参考文件、示例，先用 read_skill_file 读完再出图，不要凭技能主文件自己发挥。
- 技能里提到的生图工具（MCP、API、命令行）都换成 generate_image：画幅传 aspect_ratio，参考图传对话里的图片 ID，用户没指定模型时不传 model。一次调用只有一个画幅，画幅不同的几张按画幅分几次调用；互不依赖的几张放进同一次调用。
- 技能规定了 prompt 写法时按技能写，可以写成完整的英文 prompt，不受"以用户原话为主体"的限制；label 写中文的镜头名或内容名。
- 技能要用产品图、用户给了货号却没给图时，先用 find_product_images 取图再作参考图；只作参考时填 show=false，不把商品图发到对话和画布。
- 技能要用自己目录里的图片（动作参考、示例图等）作参考或要求打开查看时，先用 use_skill_image 登记成图片 ID，再传给 generate_image 的 reference_image_ids 或 analyze_image；技能规定每张图都要用某张参考图（例如每张一个动作包原图）时，每一张都要真的把那张图登记并传进去，不能只用文字描述代替；技能参考图不够每张一张时，按技能规则跨分类挑整体兼容的，或者重复使用，并在回复里一句话说明；每张图只传它自己要用的那几张参考图（用每一项的 reference_image_ids），同时要把用户给的人物图、产品图、场景图一起放进去。在 prompt 里写清每张参考图的职责（第几张参考图只取动作和机位、第几张只取人物身份等），编号严格按这一张的 reference_image_ids 顺序；同一张图承担几个职责（例如人物图里穿的就是要展示的衣服）时只传一次，在同一个编号下写明它的几个职责。
- 技能要求首次生图前确认生图方式、模型、分辨率等并保存设置时：本平台没有外部 API，直接用平台模型和技能建议的比例，不要用 ask_user 确认生图方式、模型、分辨率、格式，直接生成；用户主动指定的模型、比例、分辨率，用 remember 记成偏好，代替写设置文件。
- 技能里要在用户本机运行、写入本机路径或修改技能文件的维护流程（同步素材库、重建索引等），这里做不了：告诉用户需要在自己电脑上运行，完成后重新上传技能。
- 不写文件：技能要求保存到输出目录、写 prompt 记录、日志或结果表文件时都跳过。平台会把每张图的 prompt 和参数记在卡片上，图片自动放进画布。
- 不运行脚本，也不改写技能文件。技能要求运行脚本时，先用 read_skill_file 读脚本，读得到就按脚本逻辑自己完成（例如按脚本里的选项随机抽取；查询脚本就用 read_skill_file 读它查的数据文件，按同样的条件自己筛选）；读不到就告诉用户这个功能在这里用不了。
- 不自评打分，不自动重新生成：技能要求出图后打分迭代时，出完图就交给用户，请用户指出不满意的地方；用户反馈后，按技能的评分表或排错说明找到对应部分，在上一张的 prompt 原文上只替换那部分的句子，其余一字不改，重新生成；不要把上一张图当参考图（会把旧的姿势、构图和光线带过来），除非用户要保持同一个人物或技能要求这样做。技能要求先定调再批量出（例如套图先出主视觉）时，先出定调图，请用户确认后再出其余几张。
- 用户只要提示词、不要出图时，不调用 generate_image，按技能要求的格式（例如中英文各一版）直接在回复里给出完整提示词。
- 出图后的回复仍按平台规则保持简短，不贴 prompt 和评分表；按默认值补了什么、因检查改了什么，一句话说明。技能列了已知局限且这次画面涉及时，提醒一句并给出技能里写的办法。用户要 prompt 时再给。
"""


async def load_skill(ctx: ToolContext, args: dict) -> dict:
    skill = _load_skill(ctx, args.get("name"))
    return {"name": skill.name, "content": build_skill_context(skill) + SKILL_PLATFORM_NOTE,
            "references": skill.references}


async def read_skill_file(ctx: ToolContext, args: dict) -> dict:
    skill = _load_skill(ctx, args.get("name"))
    text = load_reference_text(skill, str(args.get("path") or ""))
    if text is None:
        return {"error": "文件不存在或不在技能目录内"}
    return {"path": args.get("path"), "content": text[:SKILL_CONTEXT_MAX_CHARS]}


SKILL_IMAGE_SUFFIXES = IMAGE_SUFFIXES  # 和上传保存的图片格式保持一致
MAX_SKILL_IMAGES_PER_CALL = 12


def _nearby_skill_images(root: Path, target: Path, limit: int = 20) -> list[str]:
    """路径写错时，列出最近一级存在的目录下的图片，方便模型改用真实路径。"""
    folder = target if target.is_dir() else target.parent
    while not folder.is_dir() and folder != root:
        folder = folder.parent
    if not folder.is_relative_to(root):
        folder = root
    found = sorted(p for p in folder.rglob("*") if p.suffix.lower() in SKILL_IMAGE_SUFFIXES and p.is_file())
    return [p.relative_to(root).as_posix() for p in found[:limit]]


async def use_skill_image(ctx: ToolContext, args: dict) -> dict:
    """把技能目录里的图片（动作参考、示例图等）登记成对话图片 ID，供参考图和看图使用。
    不发事件：不进对话卡片，也不放进画布。"""
    skill = _load_skill(ctx, args.get("name"))
    root = skill.source_path.resolve()
    paths = [str(p or "").strip().lstrip("/") for p in (args.get("paths") or [])][:MAX_SKILL_IMAGES_PER_CALL]
    ctx.state["skill_ref_attempted"] = True
    images, errors = [], []
    for rel in paths:
        src = (root / rel).resolve()
        if not rel or not src.is_relative_to(root) or src.suffix.lower() not in SKILL_IMAGE_SUFFIXES or not src.is_file():
            errors.append({"path": rel, "error": "不是技能目录里的图片", "nearby": _nearby_skill_images(root, src)})
            continue
        # 复制一份：技能被删除或重新上传后，会话里的图片 ID 仍然可用
        name = f"{uuid.uuid4().hex}{src.suffix.lower()}"
        out = settings.output_path / "ai-images" / ctx.user["id"] / "skill-refs" / name
        out.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(out.write_bytes, await asyncio.to_thread(src.read_bytes))
        artifact = store.create_artifact(
            session_id=ctx.session_id, user_id=ctx.user["id"], kind="skill_ref",
            url=f"/ai-images/{quote(ctx.user['id'])}/skill-refs/{name}", path=str(out),
            label=f"{skill.name} {rel}", source_tool_call_id=ctx.call_id,
            meta={"operation": "skill_ref", "skill": skill.name, "path": rel})
        images.append({"id": artifact["id"], "path": rel})
    ctx.state.setdefault("skill_refs", []).extend(i["id"] for i in images)
    return {"images": images, "failed": errors}


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
    job = job_cls(id=str(uuid.uuid4()), user_id=ctx.user["id"], request=request, created_at=time.time(),
                  source="agent2")
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

# ── remember ──────────────────────────────────────────────────────────────────

async def remember(ctx: ToolContext, args: dict) -> dict:
    action = str(args.get("action") or "add")
    uid = ctx.user["id"]
    try:
        if action == "add":
            entry = memory.add_memory(uid, args.get("content"), args.get("kind") or "preference",
                                      source_session=ctx.session_id, username=str(ctx.user.get("username") or ""))
        elif action == "update":
            entry = memory.update_memory(uid, args.get("memory_id"), args.get("content"), args.get("kind") or "")
        elif action == "delete":
            memory.delete_memory(uid, args.get("memory_id"))
            return {"ok": True, "deleted": args.get("memory_id")}
        else:
            return {"error": "action 只能是 add、update、delete"}
    except memory.MemoryError as exc:
        return {"error": str(exc)}
    return {"ok": True, "memory": {"id": entry["id"], "kind": entry["kind"], "content": entry["content"]}}


def build_tools() -> dict[str, Tool]:
    from .image_ops import build_image_op_tools  # image_ops 依赖本模块，延迟导入
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
                     "model": {"type": "string", "enum": IMAGE_MODELS,
                               "description": "可选，只用于这一张的模型；用户要用几个模型分别出图对比时，每张填一个"},
                     "reference_image_ids": {"type": "array", "items": {"type": "string"},
                                             "description": "可选，只用于这一张的参考图；修改多张已有图时，每张填它自己的原图 ID"},
                     "no_character": {"type": "boolean",
                                      "description": "只有用户指定了人物、又明确说这张不要人物时才设为 true"}},
                     "required": ["prompt"]}},
                 "aspect_ratio": {"type": "string", "enum": ASPECT_RATIOS},
                 "resolution": {"type": "string", "enum": RESOLUTIONS,
                                "description": "默认 1K；只有用户指定分辨率时才改"},
                 "model": {"type": "string", "enum": IMAGE_MODELS,
                           "description": "默认 gpt-image-2.6；只有用户指定模型时才改"},
                 "variant": {"type": "string", "enum": ["flare", "sunburst"],
                             "description": "gpt-image-2.6 / 2.5 的模式：flare 快速（默认），sunburst 优质；只有用户要求优质模式时才用 sunburst"},
                 "reference_image_ids": {"type": "array", "items": {"type": "string"}},
                 "group_type": {"type": "string", "enum": ["set", "variant"]}},
              "required": ["images"]},
             generate_image),
        Tool("analyze_image", "看图：理解用户上传的参考图或商品图，返回主体、外观、风格、文字等描述。",
             {"type": "object", "properties": {"image_id": {"type": "string"}, "question": {"type": "string"}},
              "required": ["image_id"]},
             analyze_image),
        Tool("ask_user", "向用户提一个问题并给出 2–4 个选项。只在主体不明确（用户没说要表现什么内容，例如只说“生成海报”）"
             "或缺少必需的业务信息（例如缺少 SKU）时使用；比例、风格、张数等用默认值，不要用来确认方向。"
             "主体不明确时，选项最后一个固定为“先随便出一张看看”。",
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
        Tool("use_skill_image",
             "把技能目录里的图片（例如动作参考图、示例图）登记成图片 ID，之后可以作为 generate_image 的参考图，"
             "或用 analyze_image 查看。只登记，不会显示给用户，也不放进画布。",
             {"type": "object", "properties": {
                 "name": {"type": "string", "description": "技能名"},
                 "paths": {"type": "array", "items": {"type": "string"}, "maxItems": MAX_SKILL_IMAGES_PER_CALL,
                           "description": "技能目录里的图片相对路径，例如 assets/xxx/0007.jpg"}},
              "required": ["name", "paths"]},
             use_skill_image),
        Tool("remember",
             "管理用户的长期记忆（跨会话生效）。add 新增；update 修改已有的一条（填 memory_id）；"
             "delete 删除（填 memory_id）。只记长期偏好和用户提供的店铺、商品信息，不记一次性的需求。",
             {"type": "object", "properties": {
                 "action": {"type": "string", "enum": ["add", "update", "delete"]},
                 "content": {"type": "string", "description": "一句话，不超过 200 字，例如\"主色偏好橙色\""},
                 "kind": {"type": "string", "enum": ["preference", "fact"],
                          "description": "preference 偏好；fact 用户提供的店铺、商品信息"},
                 "memory_id": {"type": "string", "description": "update / delete 时填，m_ 开头"}},
              "required": ["action"]},
             remember),
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
    ] + build_image_op_tools()
    return {t.name: t for t in tools}

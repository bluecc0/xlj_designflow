"""
设计素材自动化工具 — FastAPI 后端

端点：
  GET  /templates          从 penpot 拉取模板列表（含 slot 信息）
  POST /compose            触发合成任务
  GET  /compose/{id}       查询合成状态
  GET  /compose/{id}/image 下载导出图片
  POST /export/grid        将已合成图片切成九宫格
  POST /parse-table        AI 解析上传的表格
  GET  /products           列出本地产品图库
"""
from __future__ import annotations

import threading
import uuid
from pathlib import Path
from typing import Optional

import pydantic

from contextlib import asynccontextmanager

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .compose import get_client, run_compose
from .config import settings
from .job_store import init_db, load_job, load_recent_jobs, save_job
from .models import (
    ComposeJob,
    ComposeRequest,
    ComposeStatus,
    ExportRequest,
    GridExportRequest,
    ParseResult,
    SlotInfo,
    TemplateInfo,
)
from .product_library import ProductLibrary

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Design Tool API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 开发阶段全开，生产改为具体域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 产品图库静态文件（前端预览用）
if settings.product_library_path.exists():
    app.mount(
        "/product-library",
        StaticFiles(directory=str(settings.product_library_path)),
        name="product-library",
    )

# 导出结果静态文件
if settings.output_path.exists():
    app.mount(
        "/output",
        StaticFiles(directory=str(settings.output_path)),
        name="output",
    )

# ─── 内存任务存储（PoC 阶段，后续换 Redis / DB）────────────────────────────────
_jobs: dict[str, ComposeJob] = {}
_jobs_lock = threading.Lock()


# ─── 路由 ─────────────────────────────────────────────────────────────────────


@app.get("/health")
def health():
    return {"status": "ok", "version": "team-scan-v2"}


@app.get("/debug/team-scan")
def debug_team_scan():
    """调试：打印团队/project/文件扫描结果，确认模板识别逻辑"""
    client = get_client()
    result = {"teams": []}
    try:
        all_teams = client._rpc("get-teams")
    except Exception as e:
        return {"error": str(e)}

    TEMPLATE_MARKER = "模板"
    for team in all_teams:
        tid = team.get("id") or team.get("~:id", "")
        tname = team.get("name") or team.get("~:name", "")
        is_default = bool(team.get("isDefault") or team.get("is-default"))
        team_entry = {"id": tid, "name": tname, "is_default": is_default, "projects": []}
        try:
            projects = client.get_team_projects(tid)
            for p in projects:
                pid = p.get("id") or p.get("~:id", "")
                pname = p.get("name") or p.get("~:name", "")
                matched = TEMPLATE_MARKER in (pname or "")
                proj_entry = {"id": pid, "name": pname, "is_template_project": matched, "files": []}
                if matched:
                    try:
                        files = client.get_project_files(pid)
                        for f in files:
                            proj_entry["files"].append({
                                "id": f.get("id") or f.get("~:id"),
                                "name": f.get("name") or f.get("~:name"),
                            })
                    except Exception as e:
                        proj_entry["files_error"] = str(e)
                team_entry["projects"].append(proj_entry)
        except Exception as e:
            team_entry["projects_error"] = str(e)
        result["teams"].append(team_entry)
    return result


@app.get("/debug/text-layer")
def debug_text_layer(file_id: Optional[str] = None, shape_id: Optional[str] = None):
    """调试：返回文字图层原始结构，shape_id 指定精确查找"""
    fid = file_id or settings.penpot_file_id
    client = get_client()
    file_data = client.get_file(fid)
    data = file_data.get("data", {})
    pages_index = data.get("pagesIndex") or data.get("pages-index", {})

    # 汇总信息
    summary = {"pages": len(pages_index), "text_layers": [], "all_types": {}}
    results = []

    for page_id, page in pages_index.items():
        objects = page.get("objects", {})
        for obj_id, obj in objects.items():
            t = obj.get("type", "")
            summary["all_types"][t] = summary["all_types"].get(t, 0) + 1
            if t == "text":
                name = obj.get("name", "")
                summary["text_layers"].append({"id": obj_id, "name": name})
                if shape_id and obj_id != shape_id:
                    continue
                if not shape_id and not name.replace(" ", "").startswith("slot/"):
                    continue
                results.append({
                    "id": obj_id,
                    "name": name,
                    "page_id": page_id,
                    "content": obj.get("content"),
                    "position_data": obj.get("positionData") or obj.get("position-data"),
                    "grow_type": obj.get("growType") or obj.get("grow-type"),
                    "width": obj.get("width"),
                    "height": obj.get("height"),
                    "x": obj.get("x"),
                    "y": obj.get("y"),
                })
                if len(results) >= 3:
                    break

    return {"summary": summary, "slot_text_layers": results}


def _extract_templates_from_file(client, fid: str) -> list[TemplateInfo]:
    """从单个 penpot 文件中提取模板列表（内部辅助函数）"""
    try:
        file_data = client.get_file(fid)
    except Exception:
        return []
    frames = client.parse_frames(file_data)
    slots = client.parse_slots(file_data)

    slot_by_frame: dict[str, list[dict]] = {}
    for s in slots:
        key = s.get("frame_id") or s["page_id"]
        slot_by_frame.setdefault(key, []).append(s)

    result: list[TemplateInfo] = []
    for f in frames:
        page_slots = slot_by_frame.get(f["id"], [])
        result.append(
            TemplateInfo(
                id=f["id"],
                name=f["name"],
                page_id=f["page_id"],
                file_id=fid,
                x=f.get("x", 0),
                y=f.get("y", 0),
                width=f["width"],
                height=f["height"],
                slots=[
                    SlotInfo(
                        id=s["id"],
                        name=s["name"],
                        type=s["type"],
                        page_id=s["page_id"],
                        x=s["x"],
                        y=s["y"],
                        width=s["width"],
                        height=s["height"],
                    )
                    for s in page_slots
                ],
            )
        )
    return result


@app.get("/templates", response_model=list[TemplateInfo])
def list_templates(file_id: Optional[str] = None):
    """
    从 penpot 拉取模板（frame）列表，包含各模板的 slot 定义。

    扫描策略：
    1. 从 PENPOT_FILE_ID 主文件获取 team_id
    2. 枚举该团队下所有 project 的所有文件
    3. 只扫 project 名含「[模板]」的 project 下的所有文件
    4. 每个文件里的每个 Board（frame）作为一个独立模板条目

    团队协作约定：在 Penpot 里新建一个 project，命名包含「模板」
    （如「测试模板」「电商模板库」），把所有模板文件放进去即可被自动识别。
    合成副本统一放 Drafts，不会出现在模板库中。
    """
    fid = file_id or settings.penpot_file_id
    if not fid:
        raise HTTPException(400, "需要提供 file_id 或在 .env 中设置 PENPOT_FILE_ID")

    client = get_client()

    # Step 1: 获取该账号下所有团队（含个人团队）
    TEMPLATE_MARKER = "模板"
    template_file_ids: list[str] = []

    try:
        all_teams = client._rpc("get-teams")
    except Exception:
        all_teams = []

    for team in all_teams:
        tid = team.get("id") or team.get("~:id", "")
        if not tid:
            continue
        try:
            team_projects = client.get_team_projects(tid)
            for p in team_projects:
                pid = p.get("id") or p.get("~:id", "")
                pname = p.get("name") or p.get("~:name", "")
                if not pid or TEMPLATE_MARKER not in pname:
                    continue
                try:
                    proj_files = client.get_project_files(pid)
                    for pf in proj_files:
                        pf_id = pf.get("id") or pf.get("~:id", "")
                        if pf_id:
                            template_file_ids.append(pf_id)
                except Exception:
                    continue
        except Exception:
            continue

    # 如果所有团队里都没有模板 project，退回主文件（兜底）
    if not template_file_ids:
        template_file_ids = [fid]

    # Step 4: 逐文件提取模板 frame，按 (file_id, frame_id) 去重
    templates: list[TemplateInfo] = []
    seen: set[str] = set()
    for scan_fid in template_file_ids:
        for t in _extract_templates_from_file(client, scan_fid):
            key = f"{scan_fid}:{t.id}"
            if key not in seen:
                seen.add(key)
                templates.append(t)

    return templates


@app.post("/compose", response_model=ComposeJob)
def create_compose(
    request: ComposeRequest, background_tasks: BackgroundTasks
):
    """触发合成任务，立即返回 job id，后台异步执行"""
    job_id = str(uuid.uuid4())
    job = ComposeJob(id=job_id, request=request)

    with _jobs_lock:
        _jobs[job_id] = job
    save_job(job)  # 持久化初始状态

    background_tasks.add_task(_run_and_persist, job)
    return job


def _run_and_persist(job: ComposeJob) -> None:
    """执行合成，每次状态变更后写库"""
    run_compose(job)
    save_job(job)  # 保存最终状态（done / failed）


@app.get("/compose/{job_id}", response_model=ComposeJob)
def get_compose(job_id: str):
    """查询合成任务状态和进度（内存优先，内存没有则查 SQLite）"""
    with _jobs_lock:
        job = _jobs.get(job_id)
    if not job:
        job = load_job(job_id)
    if not job:
        raise HTTPException(404, f"任务不存在: {job_id}")
    return job


@app.get("/compose", response_model=list[ComposeJob])
def list_composes(limit: int = 20):
    """列出最近的合成任务（含历史，从 SQLite 读取）"""
    return load_recent_jobs(limit)


@app.get("/compose/{job_id}/image")
def download_image(job_id: str):
    """下载合成完成后的 PNG 图片（内存优先，回退 SQLite）"""
    with _jobs_lock:
        job = _jobs.get(job_id)
    if not job:
        job = load_job(job_id)
    if not job:
        raise HTTPException(404, f"任务不存在: {job_id}")
    if job.status != ComposeStatus.done or not job.result_path:
        raise HTTPException(400, f"任务尚未完成: {job.status}")
    path = Path(job.result_path)
    if not path.exists():
        raise HTTPException(404, "图片文件不存在")
    return FileResponse(str(path), media_type="image/png", filename=f"{job_id}.png")


@app.post("/mcp/execute")
def execute_mcp(code: str = Form(...)):
    """
    通过后端 relay 到 Penpot MCP Server 执行代码。
    MCP Server 地址: http://localhost:4401
    """
    import requests

    mcp_url = "http://localhost:4401/mcp"

    # MCP JSON-RPC 格式（需要正确的 Accept header）
    payload = {
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {
            "name": "execute_code",
            "arguments": {"code": code}
        },
        "id": str(uuid.uuid4())
    }

    try:
        resp = requests.post(
            mcp_url,
            json=payload,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
            },
            timeout=60,
        )
        if not resp.ok:
            return JSONResponse(
                status_code=502,
                content={"error": f"MCP Server error: {resp.status_code}", "detail": resp.text[:500]}
            )
        # MCP 返回的是 SSE/JSON-RPC，需要解析
        return resp.json()
    except requests.exceptions.ConnectionError:
        raise HTTPException(502, "无法连接到 MCP Server (localhost:4401)，请确保 MCP 服务已启动")
    except requests.exceptions.Timeout:
        raise HTTPException(504, "MCP 执行超时")


@app.get("/mcp/status")
def mcp_status():
    """检查 MCP Server 运行状态 - 只要端口可达就认为运行中"""
    import socket

    try:
        # 简单检测 4401 端口是否开放
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(2)
        result = sock.connect_ex(("localhost", 4401))
        sock.close()
        if result == 0:
            return {
                "status": "ok",
                "connected": True,
                "message": "MCP Server 运行中（请在 Penpot 插件中点击 Connect）"
            }
        else:
            return {"status": "error", "connected": False, "message": "MCP Server 未监听 4401 端口"}
    except Exception as e:
        return {"status": "error", "connected": False, "message": str(e)}


@app.post("/export/grid")
def export_grid(req: GridExportRequest):
    """
    将合成结果图切成 rows × cols 的九宫格，返回各格子路径列表。
    """
    with _jobs_lock:
        job = _jobs.get(req.job_id)
    if not job:
        raise HTTPException(404, f"任务不存在: {req.job_id}")
    if job.status != ComposeStatus.done or not job.result_path:
        raise HTTPException(400, f"任务尚未完成: {job.status}")

    src = Path(job.result_path)
    if not src.exists():
        raise HTTPException(404, "源图片不存在")

    output_paths = _slice_grid(src, req.rows, req.cols, req.job_id)
    return {"job_id": req.job_id, "files": output_paths}


@app.get("/export/grid/{job_id}/{index}")
def download_grid_cell(job_id: str, index: int):
    """下载九宫格中某一格"""
    path = settings.output_path / f"{job_id}_grid_{index:02d}.png"
    if not path.exists():
        raise HTTPException(404, "格子图片不存在，请先调用 /export/grid")
    return FileResponse(str(path), media_type="image/png")


@app.post("/parse-table", response_model=ParseResult)
async def parse_table_endpoint(
    file: UploadFile = File(...),
    required_fields: str = Form(default=""),
):
    """
    上传 Excel / CSV 表格，AI 解析后返回结构化产品数据和推荐模板类型。
    required_fields: 逗号分隔的字段列表，如 "image,name,price"，由前端从模板 slot 推导。
    """
    if not settings.siliconflow_api_key:
        raise HTTPException(500, "未配置 SILICONFLOW_API_KEY，无法使用 AI 解析")

    from .table_parser import parse_table

    fields = [f.strip() for f in required_fields.split(",") if f.strip()] if required_fields else []

    content = await file.read()
    try:
        result = parse_table(content, file.filename or "upload.xlsx", required_fields=fields)
    except Exception as e:
        raise HTTPException(500, f"解析失败: {e}")

    return result


@app.get("/products")
def list_products():
    """列出本地产品图库中的所有图片（含预览 URL）"""
    library = ProductLibrary(settings.product_library_path)
    items = library.list_products()
    for item in items:
        item["url"] = f"/product-library/{item['filename']}"
    return {"products": items}


@app.post("/products/upload")
async def upload_product(file: UploadFile = File(...)):
    """
    上传新产品图片到图库。
    接受 PNG / JPG / WEBP，保存到 product_library_path，返回新图片信息。
    """
    allowed = {"image/png", "image/jpeg", "image/webp", "image/gif"}
    content_type = file.content_type or ""
    if content_type not in allowed:
        raise HTTPException(400, f"不支持的文件类型: {content_type}，仅接受 PNG/JPG/WEBP")

    settings.product_library_path.mkdir(parents=True, exist_ok=True)

    # 保留原始文件名，去掉路径分隔符防注入
    safe_name = Path(file.filename or "upload.png").name
    dest = settings.product_library_path / safe_name

    # 如果同名文件存在，自动加序号
    stem = dest.stem
    suffix = dest.suffix
    counter = 1
    while dest.exists():
        dest = settings.product_library_path / f"{stem}_{counter}{suffix}"
        counter += 1

    data = await file.read()
    dest.write_bytes(data)

    return {
        "name": dest.stem,
        "filename": dest.name,
        "path": str(dest),
        "size": len(data),
        "url": f"/product-library/{dest.name}",
    }


@app.delete("/products/{filename}")
def delete_product(filename: str):
    """从图库中删除指定图片文件"""
    # 防止路径穿越
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(400, "非法文件名")
    path = settings.product_library_path / filename
    if not path.exists():
        raise HTTPException(404, "文件不存在")
    path.unlink()
    return {"deleted": filename}


@app.get("/products/find")
def find_product(name: str):
    """按名称搜索产品图片"""
    library = ProductLibrary(settings.product_library_path)
    path = library.find(name)
    all_matches = library.find_all(name)
    return {
        "name": name,
        "best_match": path,
        "all_matches": all_matches,
    }


@app.get("/templates/{template_id}/thumbnail")
def get_template_thumbnail(
    template_id: str,
    page_id: str,
    file_id: Optional[str] = None,
    refresh: bool = False,
):
    """
    导出模板缩略图（scale=0.3 的小图），首次调用耗时约 5 秒，之后命中缓存立即返回。
    缩略图缓存到 output/thumbnails/{template_id}.png。
    - refresh=true: 强制重新生成（绕过缓存）
    """
    fid = file_id or settings.penpot_file_id
    if not fid:
        raise HTTPException(400, "需要提供 file_id 或在 .env 中设置 PENPOT_FILE_ID")

    thumb_dir = settings.output_path / "thumbnails"
    thumb_dir.mkdir(parents=True, exist_ok=True)
    cache_path = thumb_dir / f"{template_id}.png"

    # refresh=true 时删除缓存，强制重新生成
    if refresh and cache_path.exists():
        cache_path.unlink()

    if cache_path.exists():
        return FileResponse(str(cache_path), media_type="image/png")

    client = get_client()
    try:
        png = client.export_frame(
            file_id=fid,
            page_id=page_id,
            frame_id=template_id,
            scale=0.3,
            name="thumbnail",
        )
        cache_path.write_bytes(png)
        return FileResponse(str(cache_path), media_type="image/png")
    except Exception as exc:
        raise HTTPException(500, f"缩略图生成失败: {exc}")


# ─── 九宫格切图 ───────────────────────────────────────────────────────────────


def _slice_grid(src: Path, rows: int, cols: int, job_id: str) -> list[str]:
    """将图片切成 rows × cols 格，保存到 output 目录"""
    from PIL import Image

    img = Image.open(src)
    w, h = img.size
    cell_w = w // cols
    cell_h = h // rows
    output_paths = []

    for r in range(rows):
        for c in range(cols):
            idx = r * cols + c
            box = (c * cell_w, r * cell_h, (c + 1) * cell_w, (r + 1) * cell_h)
            cell = img.crop(box)
            out_path = settings.output_path / f"{job_id}_grid_{idx:02d}.png"
            cell.save(str(out_path))
            output_paths.append(str(out_path))

    return output_paths


# ─── AI 对话 ──────────────────────────────────────────────────────────────────

class ChatMessage(pydantic.BaseModel):
    role: str
    content: str

class ChatContext(pydantic.BaseModel):
    templateName: Optional[str] = None
    templateSlotCount: Optional[int] = None
    productCount: Optional[int] = None
    jobStatus: Optional[str] = None
    hasResult: Optional[bool] = None

class ChatRequest(pydantic.BaseModel):
    messages: list[ChatMessage]
    context: ChatContext = pydantic.Field(default_factory=ChatContext)

@app.post("/chat")
async def chat_endpoint(req: ChatRequest):
    """
    AI 对话接口：透传到 SiliconFlow，注入平台上下文和用户当前工作台状态。
    """
    if not settings.siliconflow_api_key:
        raise HTTPException(500, "未配置 SILICONFLOW_API_KEY")

    import httpx

    # 构建工作台状态描述，让 AI 知道用户当前在哪一步
    ctx = req.context
    state_lines = []
    if ctx.templateName:
        state_lines.append(f"- 已选模板：{ctx.templateName}（{ctx.templateSlotCount or '?'} 个插槽）")
    else:
        state_lines.append("- 尚未选择模板")
    if ctx.productCount:
        state_lines.append(f"- 已载入 {ctx.productCount} 个产品数据")
    else:
        state_lines.append("- 尚未上传产品表格")
    if ctx.jobStatus == "done":
        state_lines.append("- 生图已完成，可导出 PNG 或切九宫格")
    elif ctx.jobStatus in ("pending", "running"):
        state_lines.append("- 生图正在进行中")
    elif ctx.jobStatus == "failed":
        state_lines.append("- 上次生图失败")
    else:
        state_lines.append("- 尚未开始生图")

    state_str = "\n".join(state_lines)

    system_prompt = f"""你是 DesignFlow 的 AI 设计助手。DesignFlow 是一个 AI 驱动的电商设计资产平台，核心功能是帮助运营/设计人员快速批量合成产品海报。

平台工作流程：
1. 在左侧模板库选择一个 Penpot 设计模板（单品/4宫格/6宫格/9宫格等）
2. 上传产品需求表格（Excel/CSV），包含产品名称、价格、SKU 等信息
3. AI 自动解析表格，将产品数据匹配到模板插槽
4. 点击「/开始生图」，后端调用 Penpot API 自动填充并导出海报
5. 导出 PNG 或切成九宫格图片用于投放

当前用户工作台状态：
{state_str}

快捷操作指令（用户输入后直接触发）：
- `/开始生图` — 启动生图任务
- `/导出PNG` — 下载生图结果
- `/切九宫格` — 将结果裁切为 3×3 九宫格

你的角色：
- 根据用户当前状态，主动给出下一步建议
- 回答用户关于平台功能、操作方法的问题
- 如果用户想执行操作，引导他们使用对应的快捷指令
- 可以解答电商设计、产品海报相关的专业问题
- 语气自然、简洁，不要过度列举，像真人同事一样沟通
- 回复使用中文，长度适中（2-5句为佳），绝对不要在句子中间截断，必须说完整
- 不要总结步骤列表，除非用户明确询问操作流程"""

    messages = [{"role": "system", "content": system_prompt}]
    messages += [{"role": m.role, "content": m.content} for m in req.messages]

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{settings.siliconflow_base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.siliconflow_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": settings.siliconflow_model,
                "messages": messages,
                "max_tokens": 2048,
                "temperature": 0.8,
            },
        )
    if resp.status_code != 200:
        raise HTTPException(500, f"AI 服务返回错误: {resp.text[:200]}")

    data = resp.json()
    try:
        reply = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError) as e:
        raise HTTPException(500, f"AI 响应格式异常: {e}, 原始响应: {str(data)[:200]}")

    # 防御：AI 返回空内容时返回友好提示
    if not reply or not reply.strip():
        reply = "抱歉，AI 暂时没有生成有效回复，请重试或换个问题。"

    return {"reply": reply}

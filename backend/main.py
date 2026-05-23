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

import asyncio
import base64
import logging
import threading
import time
import uuid
from urllib.parse import quote

logger = logging.getLogger(__name__)
from pathlib import Path
from typing import List, Optional

import httpx
import pydantic

from contextlib import asynccontextmanager

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from starlette.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .ai_image import generate_image, generate_image_with_reference, SLASH_MODEL_MAP
from .psd_layered import create_layered_psd_from_image
from .special_compose_full import run_special_full_compose
from .compose import get_client, run_compose
from .config import settings
from .job_store import (
    append_ai_chat_message,
    create_ai_chat_session,
    delete_ai_chat_session,
    create_session,
    delete_session,
    get_ai_chat_session,
    get_or_create_user,
    get_user_by_session,
    init_db,
    list_ai_chat_sessions,
    load_ai_chat_messages,
    load_ai_image_jobs,
    load_job,
    load_recent_jobs,
    save_job,
    save_ai_image_job,
    save_special_job,
    load_special_jobs,
)
from .models import (
    ComposeJob,
    ComposeRequest,
    ComposeStatus,
    ExportRequest,
    GridExportRequest,
    ParseResult,
    SlotInfo,
    SpecialComposeJob,
    SpecialComposeRequest,
    SpecialFullComposeJob,
    SpecialFullComposeRequest,
    TemplateGroup,
    TemplateInfo,
)
from .product_library import ProductLibrary
from .slot_schema import schema as slot_schema
from .special_compose import parse_special_command, run_special_compose

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

# 合成结果图（独立目录，不污染模板缩略图缓存）
results_path = settings.output_path / "results"
if results_path.exists():
    app.mount(
        "/results",
        StaticFiles(directory=str(results_path)),
        name="results",
    )

# AI 生图输出目录
_ai_images_path = settings.output_path / "ai-images"
_ai_images_path.mkdir(parents=True, exist_ok=True)
app.mount(
    "/ai-images",
    StaticFiles(directory=str(_ai_images_path)),
    name="ai-images",
)

# 前端静态文件（frontend-dist）
_frontend_dist = Path(__file__).parent.parent / "frontend-dist"
if _frontend_dist.exists():
    app.mount(
        "/ui",
        StaticFiles(directory=str(_frontend_dist), html=True),
        name="frontend",
    )

# ─── 内存任务存储（PoC 阶段，后续换 Redis / DB）────────────────────────────────
_jobs: dict[str, ComposeJob] = {}
_jobs_lock = threading.Lock()
_psd_jobs: dict[str, dict] = {}
_psd_jobs_lock = threading.Lock()
_SESSION_COOKIE = "designflow_session"
_AUTH_EXEMPT_PREFIXES = (
    "/auth/login-lite",
    "/auth/options",
    "/health",
    "/product-library",
    "/products/reference-image",
    "/products/resolve-references",
    "/ui",
    "/docs",
    "/redoc",
    "/openapi.json",
)


class LiteLoginRequest(pydantic.BaseModel):
    username: str


def _get_session_user(request: Request) -> Optional[dict]:
    return get_user_by_session(request.cookies.get(_SESSION_COOKIE))


def _current_user(request: Request) -> dict:
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(401, "请先输入名字进入系统")
    return user


def _is_admin(user: Optional[dict]) -> bool:
    return bool(user and user.get("role") == "admin")


def _assert_job_owner(job_user_id: Optional[str], user: dict) -> None:
    if _is_admin(user):
        return
    if job_user_id and job_user_id != user["id"]:
        raise HTTPException(403, "无权访问其他人的任务")


@app.middleware("http")
async def attach_user_context(request: Request, call_next):
    request.state.user = _get_session_user(request)
    path = request.url.path or "/"
    if not any(path.startswith(prefix) for prefix in _AUTH_EXEMPT_PREFIXES):
        if request.state.user is None:
            return JSONResponse({"detail": "请先输入名字进入系统"}, status_code=401)
    return await call_next(request)


# ─── 路由 ─────────────────────────────────────────────────────────────────────


@app.get("/health")
async def health():
    library_path = settings.product_library_path
    library_ok = library_path.exists()
    folders_found = []
    if library_ok:
        for key, folder in settings.IMAGE_TYPE_FOLDERS.items():
            if (library_path / folder).exists():
                folders_found.append(folder)

    # Penpot 连通性探测（3 秒超时，不影响主服务）
    penpot_ok = False
    try:
        async with httpx.AsyncClient(timeout=3, trust_env=False) as client:
            r = await client.get(settings.penpot_base_url)
            penpot_ok = r.status_code < 500
    except Exception:
        penpot_ok = False

    # APIMart 真实状态探测：查询账户余额，不消耗生图额度
    ai_provider = {
        "connected": False,
        "configured": bool(settings.ai_image_api_key),
        "provider": "APIMart",
        "url": settings.ai_image_base_url,
    }
    if settings.ai_image_api_key:
        balance_base = settings.ai_image_base_url.rstrip("/")
        if not balance_base.endswith("/v1"):
            balance_url = balance_base + "/v1/user/balance"
        else:
            balance_url = balance_base + "/user/balance"
        try:
            async with httpx.AsyncClient(timeout=3, trust_env=False) as client:
                r = await client.get(
                    balance_url,
                    headers={"Authorization": f"Bearer {settings.ai_image_api_key}"},
                )
            ai_provider["status_code"] = r.status_code
            if r.status_code == 200:
                payload = r.json()
                ai_provider["connected"] = bool(payload.get("success"))
                if "remain_balance" in payload:
                    ai_provider["remain_balance"] = payload.get("remain_balance")
                if "used_balance" in payload:
                    ai_provider["used_balance"] = payload.get("used_balance")
                if "unlimited_quota" in payload:
                    ai_provider["unlimited_quota"] = payload.get("unlimited_quota")
                if payload.get("message"):
                    ai_provider["message"] = payload.get("message")
            else:
                ai_provider["message"] = r.text[:200]
        except Exception as e:
            ai_provider["message"] = str(e)

    return {
        "status": "ok",
        "version": "team-scan-v2",
        "library": {
            "connected": library_ok,
            "path": str(library_path),
            "folders": folders_found,
        },
        "penpot": {
            "connected": penpot_ok,
            "url": settings.penpot_base_url,
        },
        "ai_provider": ai_provider,
    }


@app.post("/auth/login-lite")
def auth_login_lite(body: LiteLoginRequest, response: Response):
    username = " ".join((body.username or "").strip().split())
    if not username:
        raise HTTPException(400, "名字不能为空")
    if len(username) > 40:
        raise HTTPException(400, "名字不能超过 40 个字符")
    try:
        user = get_or_create_user(username)
    except ValueError:
        raise HTTPException(400, "该身份不在可用名单里")
    session_id = create_session(user["id"])
    response.set_cookie(
        _SESSION_COOKIE,
        session_id,
        httponly=True,
        samesite="lax",
        max_age=60 * 60 * 24 * 30,
        path="/",
    )
    return {"user": user}


@app.post("/auth/logout")
def auth_logout(request: Request, response: Response):
    delete_session(request.cookies.get(_SESSION_COOKIE))
    response.delete_cookie(_SESSION_COOKIE, path="/")
    return {"ok": True}


@app.get("/auth/me")
def auth_me(request: Request):
    user = _current_user(request)
    if not user:
        raise HTTPException(401, "未登录")
    return {"user": user}


@app.get("/auth/options")
def auth_options():
    return {"users": settings.allowed_login_users}


@app.get("/history/ai-images")
def list_ai_images(request: Request, limit: int = 20):
    user = _current_user(request)
    return load_ai_image_jobs(limit, None if _is_admin(user) else user["id"])


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


def _extract_templates_from_file(client, fid: str, display_name: str = "") -> list[TemplateInfo]:
    """从单个 penpot 文件中提取模板列表（内部辅助函数）"""
    try:
        file_data = client.get_file(fid)
    except Exception as e:
        logger.warning("get_file(%s) failed: %s", fid, e)
        return []

    # display_name 由调用方从 project_files 列表传入（编码最干净）
    # 兜底从 file_data 内取，两者都损坏时用 fid[:8]
    raw_name = file_data.get("name") or file_data.get("~:name") or ""
    file_name = display_name or raw_name or fid[:8]

    is_special_full = "特殊品" in file_name and "完整" in file_name
    is_special = "特殊品" in file_name and not is_special_full

    frames = client.parse_frames(file_data)
    slots = client.parse_slots(file_data)

    slot_by_frame: dict[str, list[dict]] = {}
    for s in slots:
        key = s.get("frame_id") or s["page_id"]
        slot_by_frame.setdefault(key, []).append(s)

    result: list[TemplateInfo] = []
    for f in frames:
        page_name = f.get("page_name", "")

        # 所有模板统一用文件名作为 group_name（一个 Penpot 文档 = 一张模板卡片）
        # 文档内多个 frame 作为该模板的多个画板，不再按 page_name 或 frame "/" 分组
        effective_group = file_name

        page_slots = slot_by_frame.get(f["id"], [])
        result.append(
            TemplateInfo(
                id=f["id"],
                name=f["name"],
                page_name=page_name,
                group_name=effective_group,
                variant=f.get("variant", ""),
                page_id=f["page_id"],
                file_id=fid,
                x=f.get("x", 0),
                y=f.get("y", 0),
                width=f["width"],
                height=f["height"],
                is_special=is_special,
                is_special_full=is_special_full,
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

    try:
        client = get_client()
    except Exception as e:
        logger.error("get_client() failed: %s", e, exc_info=True)
        raise HTTPException(503, f"Penpot 连接失败: {e}")

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
                        pf_name = pf.get("name") or pf.get("~:name", "")
                        # 二级过滤：文件名本身也必须含「模板」才认定为模板文件
                        # 避免合成时 duplicate_file 产生的副本（副本名称不含「模板」）被误识别
                        if pf_id and TEMPLATE_MARKER in pf_name:
                            template_file_ids.append((pf_id, pf_name))
                except Exception:
                    continue
        except Exception:
            continue

    # 找不到任何模板 project 时，退回 PENPOT_FILE_ID 主文件
    if not template_file_ids and fid:
        template_file_ids = [(fid, "")]

    # Step 4: 逐文件提取模板 frame，按 (file_id, frame_id) 去重
    templates: list[TemplateInfo] = []
    seen: set[str] = set()
    for scan_fid, scan_name in template_file_ids:
        for t in _extract_templates_from_file(client, scan_fid, display_name=scan_name):
            key = f"{scan_fid}:{t.id}"
            if key not in seen:
                seen.add(key)
                templates.append(t)

    return templates


@app.get("/debug-scan")
def debug_scan():
    """调试：列出所有被扫描到的模板文件及其 frame 数量"""
    try:
        client = get_client()
    except Exception as e:
        raise HTTPException(503, f"Penpot 连接失败: {e}")

    TEMPLATE_MARKER = "模板"
    result = {"teams": [], "template_files": [], "penpot_file_id": settings.penpot_file_id}

    try:
        all_teams = client._rpc("get-teams")
    except Exception as e:
        result["error"] = str(e)
        return result

    for team in all_teams:
        tid = team.get("id") or team.get("~:id", "")
        tname = team.get("name") or team.get("~:name", "")
        team_entry = {"id": tid, "name": tname, "projects": []}
        try:
            team_projects = client.get_team_projects(tid)
            for p in team_projects:
                pid = p.get("id") or p.get("~:id", "")
                pname = p.get("name") or p.get("~:name", "")
                has_marker = TEMPLATE_MARKER in pname
                proj_entry = {"id": pid, "name": pname, "has_marker": has_marker, "files": []}
                try:
                    proj_files = client.get_project_files(pid)
                    for pf in proj_files:
                        pf_id = pf.get("id") or pf.get("~:id", "")
                        pf_name = pf.get("name") or pf.get("~:name", "")
                        file_has_marker = TEMPLATE_MARKER in pf_name
                        proj_entry["files"].append({"id": pf_id, "name": pf_name, "file_has_marker": file_has_marker})
                        if has_marker and file_has_marker:
                            fd = client.get_file(pf_id)
                            frames = client.parse_frames(fd)
                            fname = fd.get("name") or fd.get("~:name") or ""
                            result["template_files"].append({
                                "file_id": pf_id,
                                "file_name": pf_name,
                                "penpot_name": fname,
                                "is_special": "特殊品" in fname and "完整" not in fname,
                                "is_special_full": "特殊品" in fname and "完整" in fname,
                                "frame_count": len(frames),
                                "frame_names": [f["name"] for f in frames[:10]],
                            })
                except Exception as e:
                    proj_entry["error"] = str(e)
                team_entry["projects"].append(proj_entry)
        except Exception as e:
            team_entry["error"] = str(e)
        result["teams"].append(team_entry)

    return result


@app.post("/compose", response_model=ComposeJob)
def create_compose(
    request: ComposeRequest, background_tasks: BackgroundTasks, http_request: Request
):
    """触发合成任务，立即返回 job id，后台异步执行"""
    import time
    job_id = str(uuid.uuid4())
    user = _current_user(http_request)
    job = ComposeJob(id=job_id, user_id=user["id"], request=request, created_at=time.time())

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
def get_compose(job_id: str, request: Request):
    """查询合成任务状态和进度（内存优先，内存没有则查 SQLite）"""
    user = _current_user(request)
    with _jobs_lock:
        job = _jobs.get(job_id)
    if not job:
        job = load_job(job_id)
    if not job:
        raise HTTPException(404, f"任务不存在: {job_id}")
    _assert_job_owner(job.user_id, user)
    return job


@app.get("/compose", response_model=list[ComposeJob])
def list_composes(request: Request, limit: int = 20):
    """列出最近的合成任务（含历史，从 SQLite 读取）"""
    user = _current_user(request)
    return load_recent_jobs(limit, None if _is_admin(user) else user["id"])


@app.get("/compose/{job_id}/image")
def download_image(job_id: str, request: Request):
    """下载合成完成后的 PNG 图片（内存优先，回退 SQLite）"""
    user = _current_user(request)
    with _jobs_lock:
        job = _jobs.get(job_id)
    if not job:
        job = load_job(job_id)
    if not job:
        raise HTTPException(404, f"任务不存在: {job_id}")
    _assert_job_owner(job.user_id, user)
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
    image_type: str = Form(default=""),
):
    """
    上传 Excel / CSV 表格，AI 解析后返回结构化产品数据和推荐模板类型。
    required_fields: 逗号分隔的字段列表，如 "image,name,price"，由前端从模板 slot 推导。
    image_type: 图片类型，如 "white"/"png"/"model"/"shadow"/"white2x"，
                对应素材库子文件夹，不传则在根目录匹配。
    """
    if not settings.siliconflow_api_key:
        raise HTTPException(500, "未配置 SILICONFLOW_API_KEY，无法使用 AI 解析")

    from .table_parser import parse_table

    fields = [f.strip() for f in required_fields.split(",") if f.strip()] if required_fields else []

    content = await file.read()
    try:
        result = parse_table(
            content,
            file.filename or "upload.xlsx",
            required_fields=fields,
            image_type=image_type or None,
        )
    except Exception as e:
        raise HTTPException(500, f"解析失败: {e}")

    return result


@app.get("/image-types")
def list_image_types():
    """返回可用的图片类型列表（key + 显示名 + 子文件夹是否存在）"""
    result = []
    for key, folder in settings.IMAGE_TYPE_FOLDERS.items():
        folder_path = settings.product_library_path / folder
        result.append({
            "key": key,
            "folder": folder,
            "exists": folder_path.exists(),
        })
    return {"types": result}


@app.get("/template-groups", response_model=list[TemplateGroup])
def list_template_groups(file_id: Optional[str] = None):
    """
    返回按 group_name 聚合后的模板组列表。
    普通模板（无 "/"）每个画板自成一组；
    特殊品等多画板模板（名称含 "/"）聚合为一组，前端可一次性选中所有画板。
    """
    templates = list_templates(file_id=file_id)
    groups: dict[str, TemplateGroup] = {}
    for t in templates:
        key = f"{t.file_id}:{t.group_name}"
        if key not in groups:
            groups[key] = TemplateGroup(group_name=t.group_name, file_id=t.file_id)
        groups[key].frames.append(t)
    return list(groups.values())


@app.post("/special-compose", response_model=SpecialComposeJob)
def create_special_compose(
    request: SpecialComposeRequest, background_tasks: BackgroundTasks, http_request: Request
):
    """
    触发特殊品合成任务（多画板），立即返回 job id，后台异步执行。
    每个 frame_id 对应一个画板，全部导出后 result_paths 包含所有 PNG 路径。
    """
    import time
    job_id = str(uuid.uuid4())
    user = _current_user(http_request)
    job = SpecialComposeJob(id=job_id, user_id=user["id"], request=request, created_at=time.time())
    with _jobs_lock:
        _jobs[job_id] = job  # type: ignore[assignment]
    background_tasks.add_task(run_special_compose, job)
    return job


@app.get("/special-compose/history")
def list_special_composes(request: Request, limit: int = 20):
    """
    列出最近的特殊品合成任务（含状态和结果图 URL）。
    从 SQLite 持久化存储读取，服务器重启后历史不丢失。
    注意：此路由必须写在 /{job_id} 前面，避免 "history" 被当作 job_id 匹配。
    """
    user = _current_user(request)
    return load_special_jobs(limit, None if _is_admin(user) else user["id"])


@app.get("/special-compose/{job_id}", response_model=SpecialComposeJob)
def get_special_compose(job_id: str, request: Request):
    """查询特殊品合成任务状态"""
    user = _current_user(request)
    with _jobs_lock:
        job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, f"任务不存在: {job_id}")
    if not isinstance(job, SpecialComposeJob):
        raise HTTPException(400, "该任务不是特殊品合成任务")
    _assert_job_owner(job.user_id, user)
    return job


@app.get("/special-compose/{job_id}/images")
def download_special_images(job_id: str, request: Request):
    """返回特殊品合成所有输出图片的 URL 列表"""
    user = _current_user(request)
    with _jobs_lock:
        job = _jobs.get(job_id)
    if not job or not isinstance(job, SpecialComposeJob):
        raise HTTPException(404, f"任务不存在: {job_id}")
    _assert_job_owner(job.user_id, user)
    if job.status != ComposeStatus.done:
        raise HTTPException(400, f"任务尚未完成: {job.status}")
    urls = []
    for path_str in job.result_paths:
        p = Path(path_str)
        if p.exists():
            urls.append(f"/output/{p.name}")
    return {"job_id": job_id, "images": urls}


@app.get("/special-compose/{job_id}/download-zip")
def download_special_zip(job_id: str, names: str = ""):
    """
    将特殊品合成所有图片打包成 zip 下载。
    names: 逗号分隔的画板显示名列表，与 result_frame_ids 顺序对应，
           用于命名文件为 {sku}_{names[i]}.png。
           若不提供则使用序号。
    """
    import zipfile, io
    from PIL import Image

    with _jobs_lock:
        job = _jobs.get(job_id)
    if not job or not isinstance(job, SpecialComposeJob):
        raise HTTPException(404, f"任务不存在: {job_id}")
    if job.status != ComposeStatus.done:
        raise HTTPException(400, f"任务尚未完成: {job.status}")

    sku = job.request.sku or job_id[:8]
    name_list = [n.strip() for n in names.split(",")] if names else []
    # 从独立目录 output/results/{job_id}/ 读取
    results_dir = settings.output_path / "results" / job_id
    job_prefix = job.id + "_"

    # 枚举实际存在的所有输出文件（frame_i.png / frame_i_v1.png / frame_i_v2.png 等）
    import re as _re
    all_frames = sorted(
        results_dir.glob("frame_*.png"),
        key=lambda p: (
            int(_re.search(r'frame_(\d+)', p.stem).group(1)),
            p.stem,
        )
    )

    # 判断是否有变体：v1/v2/... 后缀
    variant_keys = sorted({
        _re.search(r'(_v\d+)$', p.stem).group(1)
        for p in all_frames
        if _re.search(r'(_v\d+)$', p.stem)
    })
    variant_labels = {k: f"_版本{k[2:]}" for k in variant_keys}  # _v1→_版本1, _v2→_版本2

    # 特定画板名 → 自定义文件名前缀规则
    # key: 画板名, value: 替换 "{sku}_{画板名}" 部分的新前缀（None 表示直接用 sku）
    FRAME_NAME_OVERRIDES: dict[str, str | None] = {
        "尖货轮播-PC-1": None,       # → {sku}{变体}.png
        "尖货轮播-PC-2": "{sku}-1",  # → {sku}-1{变体}.png
        "sku": None,                # → {sku}{变体}.png
        "sku-1": "{sku}-1",         # → {sku}-1{变体}.png
    }
    FRAME_EXPORT_FORMATS: dict[str, str] = {
        "分类页": "png",
        "尖货轮播-PC-1": "png",
        "尖货轮播-PC-2": "png",
        "尖货轮播-横版-1": "png",
        "尖货轮播-横版-2": "png",
        "sku": "png",
        "sku-1": "png",
    }

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in all_frames:
            m = _re.match(r'frame_(\d+)(_v\d+)?$', p.stem)
            if not m:
                continue
            idx = int(m.group(1))
            variant_suffix = m.group(2) or ""
            frame_label = name_list[idx] if idx < len(name_list) else f"画板{idx + 1}"
            label_suffix = variant_labels.get(variant_suffix, "")
            export_format = FRAME_EXPORT_FORMATS.get(frame_label, "jpg")
            if frame_label in FRAME_NAME_OVERRIDES:
                override = FRAME_NAME_OVERRIDES[frame_label]
                prefix = override.replace("{sku}", sku) if override else sku
                zip_name = f"{prefix}{label_suffix}.{export_format}"
            else:
                zip_name = f"{sku}_{frame_label}{label_suffix}.{export_format}"
            if export_format == "png":
                zf.write(str(p), zip_name)
            else:
                img = Image.open(p).convert("RGBA")
                rgb = Image.new("RGB", img.size, (255, 255, 255))
                rgb.paste(img, mask=img.getchannel("A"))
                out = io.BytesIO()
                rgb.save(out, format="JPEG", quality=92, optimize=True)
                zf.writestr(zip_name, out.getvalue())

    buffer.seek(0)
    filename = f"{sku}.zip"
    import urllib.parse
    encoded = urllib.parse.quote(filename)
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded}"},
    )


@app.post("/special-compose/parse-command")
def parse_special_command_endpoint(body: dict):
    """
    解析前端传来的 /特殊品 指令文本，返回拆分后的字段。
    供前端在执行合成前预览解析结果。
    """
    text = body.get("text", "")
    result = parse_special_command(text)
    if result is None:
        raise HTTPException(400, "无法识别的特殊品指令格式")
    return result


# ─── 特殊品（完整）端点 ──────────────────────────────────────────────────────────

@app.post("/special-compose-full", response_model=SpecialFullComposeJob)
def create_special_full_compose(
    request: SpecialFullComposeRequest, background_tasks: BackgroundTasks, http_request: Request
):
    """触发特殊品（完整）合成任务，支持 banner/poster 场景图及 hide 图层自动隐藏。"""
    import time
    job_id = str(uuid.uuid4())
    user = _current_user(http_request)
    job = SpecialFullComposeJob(id=job_id, user_id=user["id"], request=request, created_at=time.time())
    with _jobs_lock:
        _jobs[job_id] = job  # type: ignore[assignment]
    background_tasks.add_task(run_special_full_compose, job)
    return job


@app.get("/special-compose-full/{job_id}", response_model=SpecialFullComposeJob)
def get_special_full_compose(job_id: str, request: Request):
    """查询特殊品（完整）合成任务状态"""
    user = _current_user(request)
    with _jobs_lock:
        job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, f"任务不存在: {job_id}")
    if not isinstance(job, SpecialFullComposeJob):
        raise HTTPException(400, "该任务不是特殊品（完整）合成任务")
    _assert_job_owner(job.user_id, user)
    return job


@app.get("/special-compose-full/{job_id}/download-zip")
def download_special_full_zip(job_id: str, names: str = "", request: Request = None):
    """将特殊品（完整）合成所有图片打包成 zip 下载，命名规则与 /special-compose 一致。"""
    import zipfile, io, re as _re
    from PIL import Image

    user = _current_user(request)
    with _jobs_lock:
        job = _jobs.get(job_id)
    if not job or not isinstance(job, SpecialFullComposeJob):
        raise HTTPException(404, f"任务不存在: {job_id}")
    _assert_job_owner(job.user_id, user)
    if job.status != ComposeStatus.done:
        raise HTTPException(400, f"任务尚未完成: {job.status}")

    sku = job.request.sku or job_id[:8]
    name_list = [n.strip() for n in names.split(",")] if names else []
    results_dir = settings.output_path / "results" / job_id
    all_frames = sorted(
        results_dir.glob("frame_*.png"),
        key=lambda p: (int(_re.search(r'frame_(\d+)', p.stem).group(1)), p.stem),
    )
    variant_keys = sorted({
        _re.search(r'(_v\d+)$', p.stem).group(1)
        for p in all_frames if _re.search(r'(_v\d+)$', p.stem)
    })
    variant_labels = {k: f"_版本{k[2:]}" for k in variant_keys}
    FRAME_NAME_OVERRIDES: dict[str, str | None] = {
        "尖货轮播-PC-1": None,
        "尖货轮播-PC-2": "{sku}-1",
        "sku": None,
        "sku-1": "{sku}-1",
    }
    FRAME_EXPORT_FORMATS: dict[str, str] = {
        "分类页": "png",
        "尖货轮播-PC-1": "png",
        "尖货轮播-PC-2": "png",
        "尖货轮播-横版-1": "png",
        "尖货轮播-横版-2": "png",
        "sku": "png",
        "sku-1": "png",
    }

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in all_frames:
            m = _re.match(r'frame_(\d+)(_v\d+)?$', p.stem)
            if not m:
                continue
            idx = int(m.group(1))
            variant_suffix = m.group(2) or ""
            frame_label = name_list[idx] if idx < len(name_list) else f"画板{idx + 1}"
            label_suffix = variant_labels.get(variant_suffix, "")
            export_format = FRAME_EXPORT_FORMATS.get(frame_label, "jpg")
            if frame_label in FRAME_NAME_OVERRIDES:
                override = FRAME_NAME_OVERRIDES[frame_label]
                prefix = override.replace("{sku}", sku) if override else sku
                zip_name = f"{prefix}{label_suffix}.{export_format}"
            else:
                zip_name = f"{sku}_{frame_label}{label_suffix}.{export_format}"
            if export_format == "png":
                zf.write(str(p), zip_name)
            else:
                img = Image.open(p).convert("RGBA")
                rgb = Image.new("RGB", img.size, (255, 255, 255))
                rgb.paste(img, mask=img.getchannel("A"))
                out = io.BytesIO()
                rgb.save(out, format="JPEG", quality=92, optimize=True)
                zf.writestr(zip_name, out.getvalue())

    buffer.seek(0)
    filename = f"{sku}_完整.zip"
    import urllib.parse
    encoded = urllib.parse.quote(filename)
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded}"},
    )


@app.get("/special-flows")
def get_special_flows():
    """返回 special_flows.json 配置内容，供前端获取指令格式和字段定义"""
    from .special_compose import _flows_config
    return _flows_config


@app.get("/slot-schema")
def get_slot_schema():
    """返回当前 slot_schema.json 的完整内容，供前端/插件使用"""
    return slot_schema.to_dict()


@app.post("/slot-schema/reload")
def reload_slot_schema():
    """热重载 slot_schema.json，修改文件后无需重启服务"""
    slot_schema.reload()
    return {"ok": True, "version": slot_schema.version, "fields": slot_schema.all_fields}


@app.get("/products")
def list_products(limit: int = 200):
    """列出本地产品图库根目录中的图片（仅用于预览，默认最多 200 条）"""
    library = ProductLibrary(settings.product_library_path)
    items = library.list_products()[:limit]
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


@app.post("/products/resolve-references")
def resolve_product_references(payload: dict):
    refs = payload.get("refs") if isinstance(payload, dict) else None
    if not isinstance(refs, list):
        raise HTTPException(400, "refs must be a list")

    alias_map = {
        "": "white",
        "default": "white",
        "white": "white",
        "white_base": "white",
        "whitebase": "white",
        "x2": "white2x",
        "white2x": "white2x",
        "whitex2": "white2x",
        "white_basex2": "white2x",
        "whitebasex2": "white2x",
        "一双鞋角度": "white2x",
    }

    library = ProductLibrary(settings.product_library_path)
    results = []
    for item in refs:
        if not isinstance(item, dict):
            continue
        raw = str(item.get("raw") or "").strip()
        sku = str(item.get("sku") or "").strip()
        asset_type_input = str(item.get("asset_type") or "").strip()
        normalized_key = alias_map.get(asset_type_input.casefold(), "")
        if not normalized_key and asset_type_input:
            normalized_key = alias_map.get(asset_type_input.lower(), "")
        normalized_key = normalized_key or "white"
        folder = settings.IMAGE_TYPE_FOLDERS.get(normalized_key)
        matched_path = library.find_in_folder(sku, folder) if (sku and folder) else None

        full_path = Path(matched_path) if matched_path else None
        if full_path:
            url = (
                "/products/reference-image?"
                f"sku={quote(sku)}&asset_type={quote(normalized_key)}"
            )
            mime_type = "image/png" if full_path.suffix.lower() == ".png" else "image/jpeg"
            content_base64 = base64.b64encode(full_path.read_bytes()).decode("ascii")
        else:
            url = None
            mime_type = None
            content_base64 = None

        results.append({
            "raw": raw,
            "sku": sku,
            "asset_type": normalized_key,
            "folder": folder,
            "matched": bool(full_path),
            "path": str(full_path) if full_path else None,
            "url": url,
            "filename": full_path.name if full_path else None,
            "mime_type": mime_type,
            "content_base64": content_base64,
        })

    return {"refs": results}


@app.get("/products/reference-image")
def get_product_reference_image(request: Request, sku: str, asset_type: str = "white"):
    alias_map = {
        "": "white",
        "default": "white",
        "white": "white",
        "white_base": "white",
        "whitebase": "white",
        "x2": "white2x",
        "white2x": "white2x",
        "whitex2": "white2x",
        "white_basex2": "white2x",
        "whitebasex2": "white2x",
        "一双鞋角度": "white2x",
    }
    normalized_key = alias_map.get((asset_type or "").strip().casefold(), "") or "white"
    folder = settings.IMAGE_TYPE_FOLDERS.get(normalized_key)
    library = ProductLibrary(settings.product_library_path)
    matched_path = library.find_in_folder((sku or "").strip(), folder) if folder else None
    if not matched_path:
        raise HTTPException(404, "素材图不存在")
    path = Path(matched_path)
    media_type = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
    return FileResponse(str(path), media_type=media_type, filename=path.name)


@app.get("/templates/{template_id}/thumbnail")
def get_template_thumbnail(
    template_id: str,
    page_id: str,
    file_id: Optional[str] = None,
    refresh: bool = False,
):
    """
    获取模板缩略图。
    优先使用 Penpot 内部缩略图 API（get-file-object-thumbnails + /assets/by-id），
    与编辑器里显示的完全一致，字体正确。
    降级方案：如果内部缩略图不存在，才调用 export_frame。
    缓存 key 包含 file_id 前缀，副本与原模板不会冲突。
    """
    fid = file_id or settings.penpot_file_id
    if not fid:
        raise HTTPException(400, "需要提供 file_id 或在 .env 中设置 PENPOT_FILE_ID")

    thumb_dir = settings.output_path / "thumbnails"
    thumb_dir.mkdir(parents=True, exist_ok=True)
    # file_id 前8位作为前缀，同一 frame_id 在不同文件中不会冲突
    file_prefix = fid[:8]
    cache_path = thumb_dir / f"{file_prefix}_{template_id}.png"

    if refresh and cache_path.exists():
        cache_path.unlink()

    if cache_path.exists():
        return FileResponse(str(cache_path), media_type="image/png")

    client = get_client()

    # ── 优先路径：Penpot 内部缩略图（和编辑器一致，字体正确）────────────────
    try:
        png = client.get_internal_thumbnail(fid, page_id, template_id)
        if png:
            cache_path.write_bytes(png)
            return FileResponse(str(cache_path), media_type="image/png")
    except Exception:
        pass  # 降级到 export

    # ── 降级路径：export_frame（内部缩略图不存在时，如副本文件）──────────────
    try:
        png = client.export_frame(
            file_id=fid,
            page_id=page_id,
            frame_id=template_id,
            scale=2.0,
            name="thumbnail",
        )
        cache_path.write_bytes(png)
        return FileResponse(str(cache_path), media_type="image/png")
    except Exception as exc:
        raise HTTPException(500, f"缩略图生成失败: {exc}")


@app.delete("/templates/cache")
def clear_template_cache():
    """清空所有缩略图缓存文件，下次请求时重新从 Penpot 生成。"""
    thumb_dir = settings.output_path / "thumbnails"
    removed = 0
    if thumb_dir.exists():
        for p in thumb_dir.glob("*.png"):
            p.unlink()
            removed += 1
    return {"removed": removed, "message": f"已清除 {removed} 个缩略图缓存"}


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


async def _build_context_aware_prompt(
    session_id: str,
    user_id: str,
    current_prompt: str,
) -> str:
    """
    根据当前 session 的历史对话，用 LLM 将用户的简短修改指令
    改写为包含上下文的完整生图 prompt。对用户透明。
    """
    messages = load_ai_chat_messages(session_id, user_id=user_id)
    # 至少需要一轮以上对话才有上下文意义
    text_messages = [m for m in messages if m.get("who") in ("user", "ai")]
    if len(text_messages) <= 1:
        return current_prompt

    # 构建简洁的历史摘要
    history_lines = []
    for i, m in enumerate(text_messages[-8:]):  # 最多取最近 8 条
        who = "用户" if m["who"] == "user" else "AI"
        text = (m.get("text") or m.get("prompt") or "").strip()
        if text:
            short = text[:120] + ("…" if len(text) > 120 else "")
            history_lines.append(f"[{who}] {short}")
    history_str = "\n".join(history_lines)

    enrichment_prompt = f"""你是一个 prompt 改写助手。用户在跟 AI 生图工具进行多轮对话，你需要把用户当前简短的修改指令改写为完整的生图 prompt。

要求：
1. 结合对话历史理解用户的修改意图
2. 保持上一轮已确定的构图、风格、主体不变（除非用户明确要改）
3. 输出只包含改写后的 prompt 文本，不加任何解释或前缀
4. 如果用户当前指令已经是完整的生图需求，直接原样输出

[对话历史]
{history_str}

[用户当前指令]
{current_prompt}

改写的 prompt："""

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{settings.siliconflow_base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.siliconflow_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.siliconflow_model,
                    "messages": [{"role": "user", "content": enrichment_prompt}],
                    "max_tokens": 512,
                    "temperature": 0.3,
                },
            )
        if resp.status_code != 200:
            logger.warning("Context enrichment LLM error: %s", resp.text[:120])
            return current_prompt
        data = resp.json()
        enriched = data["choices"][0]["message"]["content"].strip()
        if not enriched or len(enriched) < 3:
            return current_prompt
        logger.info("Context enrichment: %s → %s", current_prompt[:60], enriched[:60])
        return enriched
    except Exception:
        logger.exception("Context enrichment failed, falling back to original prompt")
        return current_prompt


def _build_ai_chat_title(prompt: str) -> str:
    clean = " ".join((prompt or "").strip().split())
    return clean[:28] or "未命名对话"


@app.get("/history/ai-chats")
def history_ai_chats(request: Request, limit: int = 30):
    user = _current_user(request)
    sessions = list_ai_chat_sessions(limit=max(1, min(limit, 100)), user_id=user["id"])
    return {"sessions": sessions}


@app.get("/history/ai-chats/{session_id}")
def history_ai_chat_detail(request: Request, session_id: str):
    user = _current_user(request)
    session = get_ai_chat_session(session_id, user_id=user["id"])
    if not session:
        raise HTTPException(404, "未找到历史对话")
    messages = load_ai_chat_messages(session_id, user_id=user["id"])
    return {"session": session, "messages": messages}


@app.delete("/history/ai-chats/{session_id}")
def delete_history_ai_chat(request: Request, session_id: str):
    user = _current_user(request)
    deleted = delete_ai_chat_session(session_id, user_id=user["id"])
    if not deleted:
        raise HTTPException(404, "未找到历史对话")
    return {"deleted": session_id}


@app.post("/ai-image")
async def ai_image_endpoint(
    request: Request,
    model: str = Form(...),
    prompt: str = Form(...),
    size: str = Form("1024x1024"),
    resolution: str = Form(""),
    chat_session_id: str = Form(""),
    image: List[UploadFile] = File(default=[]),
):
    """
    AI 生图接口。支持文生图（无 image）和图生图（最多 4 张参考图）。
    自动注入对话历史上下文：用 LLM 改写 prompt + 上次结果图作为参考。
    返回: { "url": "/ai-images/{filename}.png", "model": ..., "prompt": ... }
    """
    original_prompt = prompt.strip()
    if not original_prompt:
        raise HTTPException(400, "prompt 不能为空")

    resolved = SLASH_MODEL_MAP.get(model.lower(), model)
    if not resolved:
        raise HTTPException(400, f"未知模型: {model}")
    user = _current_user(request)
    job_id = uuid.uuid4().hex
    session_id = (chat_session_id or "").strip()
    session = get_ai_chat_session(session_id, user_id=user["id"]) if session_id else None
    if not session:
        session = create_ai_chat_session(user_id=user["id"], title=_build_ai_chat_title(original_prompt), created_at=time.time())
        session_id = session["id"]

    images = image[:4] if image else []
    created_at = time.time()
    append_ai_chat_message(
        session_id=session_id,
        user_id=user["id"],
        role="user",
        type="user_text",
        text=original_prompt,
        meta={"model": resolved, "size": size, "resolution": resolution},
        created_at=created_at,
    )
    save_ai_image_job(
        job_id=job_id,
        user_id=user["id"],
        status="running",
        model=resolved,
        prompt=original_prompt,
        size=size,
        has_reference=bool(images),
        created_at=created_at,
    )

    try:
        # —— 上下文注入（对用户透明）——
        enriched_prompt = original_prompt
        context_ref_bytes: list[tuple[bytes, str]] = []

        # 1. LLM 根据历史改写 prompt
        if session_id and settings.siliconflow_api_key:
            enriched_prompt = await _build_context_aware_prompt(
                session_id=session_id,
                user_id=user["id"],
                current_prompt=original_prompt,
            )

        # 2. 取上一张生成的图片作为参考图
        if session_id:
            prev_messages = load_ai_chat_messages(session_id, user_id=user["id"])
            for m in reversed(prev_messages):
                prev_url = m.get("imageUrl") or ""
                if prev_url and prev_url.startswith("/ai-images/"):
                    local_path = settings.output_path / "ai-images" / prev_url[len("/ai-images/"):]
                    try:
                        if local_path.exists():
                            context_ref_bytes.append((local_path.read_bytes(), local_path.name))
                            logger.info("Using previous image as reference: %s", local_path.name)
                            break
                    except Exception:
                        pass

        # 3. 合并用户上传的参考图与上下文的参考图
        all_refs: list[tuple[bytes, str]] = context_ref_bytes + [
            (await f.read(), f.filename or f"ref{i}.png") for i, f in enumerate(images)
        ]
        all_refs = all_refs[:4]  # 总共最多 4 张

        if all_refs:
            result = await generate_image_with_reference(
                model=resolved, prompt=enriched_prompt, images=all_refs,
                size=size, resolution=resolution, user_id=user["id"],
            )
        else:
            result = await generate_image(
                model=resolved, prompt=enriched_prompt,
                size=size, resolution=resolution, user_id=user["id"],
            )

        save_ai_image_job(
            job_id=job_id,
            user_id=user["id"],
            status="done",
            model=resolved,
            prompt=original_prompt,
            size=size,
            image_url=result.get("url"),
            has_reference=bool(images) or bool(context_ref_bytes),
            created_at=created_at,
        )
        append_ai_chat_message(
            session_id=session_id,
            user_id=user["id"],
            role="ai",
            type="ai_image_result",
            text=original_prompt,
            image_url=result.get("url"),
            meta={
                "model": resolved,
                "prompt": original_prompt,
                "size": size,
                "resolution": resolution,
                "status": "done",
                "hasReference": bool(images) or bool(context_ref_bytes),
                "refCount": len(images) + len(context_ref_bytes),
            },
            created_at=time.time(),
        )
        return {**result, "chat_session_id": session_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("ai_image_endpoint error: model=%s size=%s", resolved, size)
        save_ai_image_job(
            job_id=job_id,
            user_id=user["id"],
            status="failed",
            model=resolved,
            prompt=original_prompt,
            size=size,
            has_reference=bool(images) or bool(context_ref_bytes),
            error=str(e),
            created_at=created_at,
        )
        append_ai_chat_message(
            session_id=session_id,
            user_id=user["id"],
            role="ai",
            type="ai_image_result",
            text=original_prompt,
            image_url=None,
            meta={
                "model": resolved,
                "prompt": original_prompt,
                "status": "failed",
                "error": str(e),
                "hasReference": bool(images) or bool(context_ref_bytes),
                "refCount": len(images) + len(context_ref_bytes),
            },
            created_at=time.time(),
        )
        raise HTTPException(502, {"message": f"{type(e).__name__}: {e}", "chat_session_id": session_id})


@app.post("/psd/layered")
async def layered_psd_endpoint(
    request: Request,
    prompt: str = Form(...),
    model: str = Form("nano-banana-pro"),
    size: str = Form("auto"),
    resolution: str = Form(""),
    image: UploadFile = File(...),
):
    user = _current_user(request)
    layer_text = (prompt or "").strip()
    if not layer_text:
        raise HTTPException(400, "请描述要拆出的图层，例如：背景、产品、文字")
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(400, "请上传一张参考图片")
    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(400, "参考图片为空")
    job_id = uuid.uuid4().hex
    with _psd_jobs_lock:
        _psd_jobs[job_id] = {
            "id": job_id,
            "user_id": user["id"],
            "status": "running",
            "logs": ["已创建智能分层任务"],
            "result": None,
            "error": None,
            "created_at": time.time(),
        }
    asyncio.create_task(_run_layered_psd_job(
        job_id=job_id,
        image_bytes=image_bytes,
        filename=image.filename or "reference.png",
        layer_text=layer_text,
        user_id=user["id"],
        model=model,
        size=size,
        resolution=resolution,
    ))
    return {"job_id": job_id, "status": "running", "logs": ["已创建智能分层任务"]}


async def _run_layered_psd_job(
    *,
    job_id: str,
    image_bytes: bytes,
    filename: str,
    layer_text: str,
    user_id: str,
    model: str,
    size: str,
    resolution: str,
):
    def add_log(message: str) -> None:
        with _psd_jobs_lock:
            job = _psd_jobs.get(job_id)
            if job is not None:
                job.setdefault("logs", []).append(message)

    try:
        result = await create_layered_psd_from_image(
            image_bytes=image_bytes,
            filename=filename,
            layer_text=layer_text,
            user_id=user_id,
            model=model,
            size=size,
            resolution=resolution,
            log=add_log,
        )
        with _psd_jobs_lock:
            if job_id in _psd_jobs:
                _psd_jobs[job_id]["status"] = "done"
                _psd_jobs[job_id]["result"] = result
                _psd_jobs[job_id]["logs"].append("任务完成")
    except Exception as exc:
        logger.exception("layered psd job failed: %s", job_id)
        with _psd_jobs_lock:
            if job_id in _psd_jobs:
                _psd_jobs[job_id]["status"] = "failed"
                _psd_jobs[job_id]["error"] = f"{type(exc).__name__}: {exc}"
                _psd_jobs[job_id]["logs"].append(f"任务失败：{type(exc).__name__}: {exc}")


@app.get("/psd/layered/{job_id}")
def layered_psd_status(request: Request, job_id: str):
    user = _current_user(request)
    with _psd_jobs_lock:
        job = dict(_psd_jobs.get(job_id) or {})
    if not job:
        raise HTTPException(404, "PSD 任务不存在")
    _assert_job_owner(job.get("user_id"), user)
    return {
        "job_id": job_id,
        "status": job.get("status"),
        "logs": job.get("logs") or [],
        "result": job.get("result"),
        "error": job.get("error"),
    }


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

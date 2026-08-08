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
import functools
import json
import logging
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime
from urllib.parse import quote, unquote, urlsplit, urlunsplit
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)
from pathlib import Path
from typing import List, Optional

import httpx
import pydantic

from contextlib import asynccontextmanager

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from starlette.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .ai_image import (
    PROVIDER_SUB2API,
    PROVIDER_ADOBE2API,
    PROVIDER_APIMART,
    PROVIDER_AUTO,
    cleanup_user_refs,
    format_generation_error,
    generate_image,
    generate_image_with_reference,
    generate_image_async,
    generate_image_with_reference_async,
    generate_sub2api_async,
    generate_adobe2api_async,
    smart_generate_image_async,
    generate_inspiration_thumb,
    get_inspiration_thumb_url_if_exists,
    load_user_refs,
    normalize_provider,
    save_user_refs,
    compress_image_to_data_url,
    SLASH_MODEL_MAP,
)
from .agent_mode import (
    VisualIntentPatch,
    AgentChatRequest,
    analyze_reference_images,
    apply_intent_patch_to_state,
    apply_decision_to_state,
    build_suggested_refine_from_vlm,
    build_vlm_followup_decision,
    build_brief,
    call_agent_llm,
    _chat_completions_endpoint,
    _coarse_subject_from_message,
    _deep_copy_json,
    _resolve_image_data_url,
    decide_next_action,
    default_project_state,
    detect_confirm,
    extract_message_constraints,
    has_meaningful_patch,
    has_meaningful_intent_update,
    make_sse,
    merge_intent,
    normalize_project_state,
    run_vlm_critic,
    stream_generation_events,
    summarize_project_title,
)
from .psd_layered import create_layered_psd_from_image
from .special_compose_full import run_special_full_compose
from .compose import get_client, run_compose
from .config import settings
from .agent_skill_loader import build_skill_context, list_agent_skills, load_agent_skill
from .job_store import (
    acknowledge_admin_alert,
    append_ai_chat_message,
    create_ai_chat_session,
    create_agent_image,
    create_agent_project,
    delete_agent_project,
    delete_ai_chat_session,
    create_session,
    delete_session,
    get_agent_project,
    get_ai_chat_session,
    get_or_create_user,
    get_user_by_session,
    hash_password,
    init_db,
    list_agent_images,
    list_agent_projects,
    list_ai_chat_sessions,
    load_admin_stats,
    load_admin_overview,
    load_admin_task_detail,
    load_admin_tasks,
    load_admin_users,
    claim_service_probe,
    complete_service_probe,
    load_latest_completed_service_probe,
    load_latest_service_probe,
    load_service_probes,
    prune_service_probes,
    load_ai_chat_messages,
    load_agent_messages,
    load_ai_image_job,
    load_ai_image_jobs,
    load_ai_image_job_by_image_url,
    load_job,
    count_operation_logs,
    load_operation_logs,
    load_recent_jobs,
    log_operation,
    append_agent_message,
    save_job,
    save_ai_image_job,
    save_editor_snapshot,
    load_editor_snapshot,
    save_special_job,
    load_special_jobs,
    sync_user_test_status,
    update_agent_project,
    create_inspiration_post,
    update_inspiration_thumb_url,
    update_inspiration_dimensions,
    update_inspiration_vlm,
    find_inspiration_vlm_cache,
    get_inspiration_post,
    get_inspiration_post_by_job,
    delete_inspiration_post,
    list_inspiration_posts,
    is_inspiration_favorited,
    list_inspiration_favorite_ids,
    set_inspiration_favorite,
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
from .proxy_download_relay import inspect_url as proxy_download_inspect_url, download_url as proxy_download_download_url, stop as proxy_download_stop, check_login_status as proxy_download_check_login, login_shell as proxy_download_login_shell


def _migrate_inspiration_thumbnails() -> None:
    """Backfill inspiration metadata without blocking the FastAPI event loop."""
    try:
        rows = list_inspiration_posts(limit=10000, offset=0)
        pending = [
            row
            for row in rows
            if not row.get("thumb_url") or not row.get("image_width") or not row.get("image_height")
        ]
        for row in pending:
            try:
                thumb, width, height = generate_inspiration_thumb(
                    row["image_url"], row["user_id"], row["job_id"]
                )
                update_inspiration_thumb_url(row["id"], thumb)
                if width and height:
                    update_inspiration_dimensions(row["id"], width, height)
            except Exception:
                logger.exception("Failed to migrate inspiration thumbnail: %s", row.get("id"))
    except Exception:
        logger.exception("Failed to scan inspiration thumbnails for migration")


def _remove_service_probe_image(image_url: str) -> None:
    if not image_url or not image_url.startswith("/ai-images/"):
        return
    try:
        root = _ai_images_path.resolve()
        path = (_ai_images_path / image_url.removeprefix("/ai-images/")).resolve()
        if path.is_relative_to(root) and path.is_file():
            path.unlink()
    except Exception:
        logger.warning("Failed to remove subscription probe image: %s", image_url, exc_info=True)


async def _run_sub2api_service_probe(scheduled_slot: str) -> None:
    started = time.perf_counter()
    image_url = ""
    try:
        result = await asyncio.wait_for(
            generate_sub2api_async(
                model="gpt-image-2",
                prompt="a cute cat",
                images=None,
                size="auto",
                resolution="",
                user_id="_service-monitor",
            ),
            timeout=max(60, settings.sub2api_monitor_timeout_seconds),
        )
        image_url = str(result.get("url") or "")
        complete_service_probe(
            "sub2api",
            scheduled_slot,
            status="done",
            latency_ms=round((time.perf_counter() - started) * 1000),
            result={
                "provider": result.get("provider"),
                "model": result.get("model"),
                "size": result.get("size"),
                "usage": result.get("usage"),
                "image_url": image_url,
            },
        )
        logger.info("[service-probe:sub2api] success slot=%s", scheduled_slot)
    except asyncio.CancelledError:
        complete_service_probe(
            "sub2api",
            scheduled_slot,
            status="failed",
            latency_ms=round((time.perf_counter() - started) * 1000),
            error="服务进程停止，探测已中断",
        )
        raise
    except Exception as exc:
        complete_service_probe(
            "sub2api",
            scheduled_slot,
            status="failed",
            latency_ms=round((time.perf_counter() - started) * 1000),
            error=f"{type(exc).__name__}: {exc}",
        )
        logger.error(
            "[service-probe:sub2api] failed slot=%s error=%s",
            scheduled_slot,
            exc,
        )
    finally:
        retention_seconds = max(1, settings.sub2api_monitor_retention_days) * 86400
        expired_urls = await asyncio.to_thread(
            prune_service_probes,
            "sub2api",
            time.time() - retention_seconds,
        )
        for expired_url in expired_urls:
            await asyncio.to_thread(_remove_service_probe_image, expired_url)


async def _sub2api_service_monitor_loop() -> None:
    try:
        timezone = ZoneInfo(settings.sub2api_monitor_timezone)
    except Exception:
        logger.error(
            "Invalid SUB2API_MONITOR_TIMEZONE=%s; falling back to Asia/Shanghai",
            settings.sub2api_monitor_timezone,
        )
        timezone = ZoneInfo("Asia/Shanghai")
    while True:
        now = datetime.now(timezone)
        if 9 <= now.hour <= 21:
            scheduled_slot = now.strftime("%Y-%m-%dT%H:00%z")
            if claim_service_probe("sub2api", scheduled_slot):
                await _run_sub2api_service_probe(scheduled_slot)
        await asyncio.sleep(30)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    app.state.inspiration_migration_task = asyncio.create_task(
        asyncio.to_thread(_migrate_inspiration_thumbnails)
    )
    app.state.sub2api_monitor_task = None
    if (
        settings.sub2api_monitor_enabled
        and settings.cliproxy_base_url
        and settings.cliproxy_api_key
    ):
        app.state.sub2api_monitor_task = asyncio.create_task(
            _sub2api_service_monitor_loop()
        )
    try:
        yield
    finally:
        monitor_task = app.state.sub2api_monitor_task
        if monitor_task:
            monitor_task.cancel()
            await asyncio.gather(monitor_task, return_exceptions=True)
        await proxy_download_stop()


app = FastAPI(title="Design Tool API", version="0.1.0", lifespan=lifespan)


class CacheAwareStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        normalized_path = path.replace("\\", "/")
        if normalized_path.startswith(("assets/", "compiled/")):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        elif normalized_path.startswith(("vendor/", "fonts/")):
            response.headers["Cache-Control"] = "public, max-age=604800"
        else:
            response.headers["Cache-Control"] = "no-cache, must-revalidate"
        return response

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
results_path.mkdir(parents=True, exist_ok=True)
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

# 用户头像目录
_avatars_path = Path(__file__).parent.parent / "avatars"
_avatars_path.mkdir(parents=True, exist_ok=True)
app.mount(
    "/avatars",
    StaticFiles(directory=str(_avatars_path)),
    name="avatars",
)

# 前端静态文件
_frontend_dist = Path(__file__).parent.parent / "frontend"
if _frontend_dist.exists():
    app.mount(
        "/ui",
        CacheAwareStaticFiles(directory=str(_frontend_dist), html=True),
        name="frontend",
    )

_editor_beta_dist = Path(__file__).parent.parent / "editor-lab-tldraw" / "dist"
if _editor_beta_dist.exists():
    app.mount(
        "/editor-beta",
        CacheAwareStaticFiles(directory=str(_editor_beta_dist), html=True),
        name="editor-beta",
    )

# ─── 内存任务存储（PoC 阶段，后续换 Redis / DB）────────────────────────────────
_jobs: dict[str, ComposeJob] = {}
_jobs_lock = threading.Lock()
_psd_jobs: dict[str, dict] = {}
_psd_jobs_lock = threading.Lock()
_SESSION_COOKIE = "designflow_session"
_AUTH_EXEMPT_PREFIXES = (
    "/auth/session",
    "/auth/login-lite",
    "/auth/options",
    "/health",
    "/product-library",
    "/products/reference-image",
    "/products/resolve-references",
    "/avatars",
    "/editor-beta",
    "/ui",
    "/docs",
    "/redoc",
    "/openapi.json",
)
_AUTH_EXEMPT_EXACT_PATHS = {"/", "/ai-image/client-event"}


class ProxyDownloadInspectRequest(pydantic.BaseModel):
    url: str


class ProxyDownloadRequest(ProxyDownloadInspectRequest):
    format: Optional[str] = None


def _proxy_download_dir() -> Path:
    path = settings.output_path / "proxy-downloads"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _agent_reference_dir(project_id: str) -> Path:
    path = settings.output_path / "agent-references" / str(project_id or "").strip()
    path.mkdir(parents=True, exist_ok=True)
    return path


def _store_agent_reference_images(project_id: str, reference_images: list[tuple[bytes, str]]) -> list[dict]:
    stored: list[dict] = []
    if not project_id or not reference_images:
        return stored
    for index, (content, filename) in enumerate(reference_images, start=1):
        if not content:
            continue
        safe_name = Path(filename or f"reference-{index}.png").name or f"reference-{index}.png"
        rel_path = Path("agent-references") / str(project_id) / f"{uuid.uuid4().hex}_{safe_name}"
        abs_path = settings.output_path / rel_path
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        abs_path.write_bytes(content)
        stored.append({
            "name": safe_name,
            "size": len(content),
            "path": rel_path.as_posix(),
            "url": "/output/" + quote(rel_path.as_posix(), safe="/"),
        })
    return stored


def _load_cached_agent_reference_images(metadata: dict | None) -> list[tuple[bytes, str]]:
    cached = ((metadata or {}).get("referenceContext") or {}).get("storedFiles") or []
    if not isinstance(cached, list):
        return []
    loaded: list[tuple[bytes, str]] = []
    output_root = settings.output_path.resolve()
    for item in cached:
        rel_path = str((item or {}).get("path") or "").strip().replace("\\", "/")
        if not rel_path:
            continue
        try:
            abs_path = (settings.output_path / rel_path).resolve()
            abs_path.relative_to(output_root)
        except Exception:
            continue
        if not abs_path.exists() or not abs_path.is_file():
            continue
        try:
            loaded.append((abs_path.read_bytes(), str((item or {}).get("name") or abs_path.name)))
        except Exception:
            continue
    return loaded


def _safe_download_filename(name: str) -> str:
    clean = "".join(ch if ch.isalnum() or ch in "._-()[] " else "_" for ch in (name or "download.bin")).strip()
    return clean or "download.bin"


def _download_format_matches(filename: str, requested_format: str | None) -> bool:
    fmt = (requested_format or "").strip().lower()
    if not fmt:
        return True
    suffix = Path(filename or "").suffix.lower().lstrip(".")
    if not suffix:
        return False
    if fmt in {"jpg", "jpeg"}:
        return suffix in {"jpg", "jpeg"}
    return suffix == fmt


class LiteLoginRequest(pydantic.BaseModel):
    username: str
    password: str


def _public_agent_project(project: dict, *, messages: Optional[list[dict]] = None, images: Optional[list[dict]] = None) -> dict:
    return {
        "id": project["id"],
        "title": project["title"],
        "status": project["status"],
        "phase": project["phase"],
        "intent": project["intent"],
        "brief": project["brief"],
        "currentImageUrl": _normalize_public_asset_url((project.get("current_image") or {}).get("imageUrl")),
        "currentPrompt": project.get("current_prompt"),
        "conversationSummary": project.get("conversation_summary") or "",
        "metadata": project.get("metadata") or {},
        "messages": _normalize_ai_chat_messages_for_api(messages) if messages is not None else None,
        "iterations": _normalize_agent_images_for_api(images) if images is not None else None,
        "createdAt": project["created_at"],
        "updatedAt": project["updated_at"],
    }


def _get_session_user(request: Request) -> Optional[dict]:
    return get_user_by_session(request.cookies.get(_SESSION_COOKIE))


def _current_user(request: Request) -> dict:
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(401, "请先输入名字进入系统")
    return user


def _is_admin(user: Optional[dict]) -> bool:
    return bool(user and user.get("role") == "admin")


def _public_login_user(user: dict) -> dict:
    return {
        "id": user.get("id", ""),
        "username": user.get("username", ""),
        "display_name": user.get("display_name", ""),
        "role": user.get("role", "user"),
        "is_test": bool(user.get("is_test", False)),
    }


def _is_public_asset_path(path: str) -> bool:
    safe_prefixes = ("/ai-images/", "/results/", "/output/", "/avatars/")
    return (
        path.startswith(safe_prefixes)
        or re.match(r"^/compose/[^/]+/image/?$", path) is not None
        or path.startswith("/export/grid/")
    )


def _normalize_public_asset_url(raw_url: str | None) -> str:
    value = str(raw_url or "").strip()
    if not value:
        return ""
    if _is_public_asset_path(value):
        return value
    if value.startswith(("http://", "https://")):
        try:
            parsed = urlsplit(value)
            if _is_public_asset_path(parsed.path):
                return urlunsplit(("", "", parsed.path, parsed.query, parsed.fragment))
        except Exception:
            return value
    return value


def _resolve_public_asset_path(raw_url: str | None, user: dict | None = None) -> Path:
    """只把站内公开资源 URL 解析成本地文件，避免任意路径/外链读取。"""
    url = _normalize_public_asset_url(raw_url)
    try:
        parsed = urlsplit(url)
        path = parsed.path or url
    except Exception:
        path = url
    path = str(path or "").strip()
    if not path:
        raise HTTPException(400, "图片地址不能为空")

    compose_match = re.match(r"^/compose/([^/]+)/image/?$", path)
    if compose_match:
        job_id = compose_match.group(1)
        with _jobs_lock:
            job = _jobs.get(job_id)
        if not job:
            job = load_job(job_id)
        if not job:
            raise HTTPException(404, "图片文件不存在")
        if user is not None:
            _assert_job_owner(job.user_id, user)
        if job.status != ComposeStatus.done or not job.result_path:
            raise HTTPException(400, "合成任务尚未完成")
        candidate = Path(job.result_path).resolve()
        output_root = settings.output_path.resolve()
        if output_root not in candidate.parents and candidate != output_root:
            raise HTTPException(400, "图片路径不合法")
        if not candidate.exists() or not candidate.is_file():
            raise HTTPException(404, "图片文件不存在")
        return candidate

    grid_match = re.match(r"^/export/grid/([^/]+)/(\d+)/?$", path)
    if grid_match:
        job_id = grid_match.group(1)
        index = int(grid_match.group(2))
        candidate = (settings.output_path / f"{job_id}_grid_{index:02d}.png").resolve()
        output_root = settings.output_path.resolve()
        if output_root not in candidate.parents and candidate != output_root:
            raise HTTPException(400, "图片路径不合法")
        if not candidate.exists() or not candidate.is_file():
            raise HTTPException(404, "图片文件不存在")
        return candidate

    roots: list[tuple[str, Path]] = [
        ("/ai-images/", settings.output_path / "ai-images"),
        ("/results/", settings.output_path / "results"),
        ("/output/", settings.output_path),
        ("/avatars/", Path(__file__).parent.parent / "avatars"),
    ]
    for prefix, root in roots:
        if not path.startswith(prefix):
            continue
        rel = path[len(prefix):].lstrip("/")
        candidate = (root / rel).resolve()
        root_resolved = root.resolve()
        if root_resolved not in candidate.parents and candidate != root_resolved:
            raise HTTPException(400, "图片路径不合法")
        if not candidate.exists() or not candidate.is_file():
            raise HTTPException(404, "图片文件不存在")
        return candidate
    raise HTTPException(400, "只支持站内图片资源放大")


def _persist_data_url_image(raw_url: str, *, user_id: str, job_id: str) -> Path:
    value = str(raw_url or "").strip()
    match = re.match(r"^data:(image/[^;,]+);base64,(.+)$", value, flags=re.I | re.S)
    if not match:
        raise HTTPException(400, "仅支持图片 data URL 放大")
    mime = match.group(1).lower()
    encoded = match.group(2).strip()
    suffix_map = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/webp": ".webp",
    }
    suffix = suffix_map.get(mime)
    if not suffix:
        raise HTTPException(400, f"暂不支持该图片格式放大: {mime}")
    try:
        payload = base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise HTTPException(400, "data URL 图片内容无效") from exc
    src_dir = settings.output_path / "ai-images" / user_id / "_upscale_sources"
    src_dir.mkdir(parents=True, exist_ok=True)
    src_path = src_dir / f"{job_id}{suffix}"
    src_path.write_bytes(payload)
    return src_path


def _find_latest_image_file(folder: Path, after_ts: float) -> Path | None:
    exts = {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff"}
    candidates = []
    if not folder.exists():
        return None
    for item in folder.iterdir():
        try:
            if item.is_file() and item.suffix.lower() in exts and item.stat().st_mtime >= after_ts - 1:
                candidates.append(item)
        except OSError:
            continue
    if not candidates:
        return None
    return max(candidates, key=lambda item: item.stat().st_mtime)


def _run_local_upscale(src_path: Path, out_path: Path, scale: int) -> tuple[int, int, str]:
    scale = max(1, min(int(scale or 2), 4))
    cli_path = settings.upscale_cli_path.strip()
    if not cli_path:
        raise RuntimeError("本机未配置高清放大工具，请先配置 UPSCALE_CLI_PATH")

    exe = Path(cli_path)
    executable = str(exe) if exe.exists() else cli_path
    cmd = [
        sys.executable,
        "-m", "backend.upscale_worker",
        "--exe", executable,
        "--src", str(src_path),
        "--out", str(out_path),
        "--scale", str(scale),
        "--timeout", str(max(30, int(settings.upscale_cli_timeout_seconds or 900))),
    ]
    if settings.upscale_cli_model:
        cmd.extend(["--model", settings.upscale_cli_model])
    out_path.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        cmd,
        cwd=str(settings.root_dir),
        capture_output=True,
        text=True,
        timeout=max(45, int(settings.upscale_cli_timeout_seconds or 900) + 15),
        check=False,
    )
    if proc.returncode != 0:
        try:
            payload = json.loads((proc.stdout or "").strip().splitlines()[-1])
            detail = str(payload.get("error") or "")
        except Exception:
            detail = (proc.stderr or proc.stdout or "").strip()[-800:]
        raise RuntimeError(f"Gigapixel CLI 执行失败: {detail or proc.returncode}")
    if not out_path.exists():
        raise RuntimeError("Gigapixel CLI 未输出图片")
    try:
        from PIL import Image
        with Image.open(out_path) as im:
            return im.width, im.height, "gigapixel"
    except Exception:
        return 0, 0, "gigapixel"


async def _run_upscale_background(job_id: str, user: dict, src_path: Path, scale: int, created_at: float) -> None:
    prompt = f"local upscale x{scale}"
    out_dir = settings.output_path / "ai-images" / user["id"] / "upscaled"
    out_path = out_dir / f"{job_id}.png"
    try:
        save_ai_image_job(
            job_id=job_id, user_id=user["id"], status="processing",
            model="local-upscale", prompt=prompt, size="",
            original_prompt=prompt, resolved_prompt=prompt,
            has_reference=True, progress=15, created_at=created_at,
        )
        width, height, method = await asyncio.to_thread(_run_local_upscale, src_path, out_path, scale)
        image_url = f"/ai-images/{quote(user['id'])}/upscaled/{quote(out_path.name)}"
        save_ai_image_job(
            job_id=job_id, user_id=user["id"], status="done",
            model=f"local-upscale:{method}", prompt=prompt, size=f"{width}x{height}" if width and height else "",
            original_prompt=prompt, resolved_prompt=prompt, image_url=image_url,
            has_reference=True, progress=100, created_at=created_at,
        )
        try:
            generate_inspiration_thumb(image_url, user["id"], job_id)
        except Exception:
            pass
        log_operation(
            user_id=user["id"], username=user.get("username", ""),
            action="ai_image_upscale",
            detail=f"job={job_id[:8]} scale={scale} method={method} result=done",
            payload=json.dumps({"job_id": job_id, "image_url": image_url, "scale": scale, "method": method}, ensure_ascii=False),
        )
    except Exception as exc:
        save_ai_image_job(
            job_id=job_id, user_id=user["id"], status="failed",
            model="local-upscale", prompt=prompt, size="",
            original_prompt=prompt, resolved_prompt=prompt,
            has_reference=True, error=str(exc), progress=100, created_at=created_at,
        )
        log_operation(
            user_id=user["id"], username=user.get("username", ""),
            action="ai_image_upscale",
            detail=f"job={job_id[:8]} scale={scale} result=failed",
            payload=json.dumps({"job_id": job_id, "scale": scale, "error": str(exc)}, ensure_ascii=False),
        )


def _run_local_vectorize(src_path: Path, out_path: Path) -> tuple[int, int]:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        sys.executable,
        "-m", "backend.vectorize_worker",
        "--src", str(src_path),
        "--out", str(out_path),
    ]
    proc = subprocess.run(
        cmd,
        cwd=str(settings.root_dir),
        capture_output=True,
        text=True,
        timeout=max(60, int(settings.ai_image_job_timeout_seconds or 600) + 15),
        check=False,
    )
    try:
        payload = json.loads((proc.stdout or "").strip().splitlines()[-1])
    except Exception:
        payload = {}
    if proc.returncode != 0 or not payload.get("ok"):
        detail = str(payload.get("error") or (proc.stderr or proc.stdout or "").strip()[-800:])
        raise RuntimeError(detail or f"vtracer 子进程退出码 {proc.returncode}")
    return int(payload.get("width") or 0), int(payload.get("height") or 0)


async def _run_vectorize_background(job_id: str, user: dict, src_path: Path, created_at: float) -> None:
    prompt = "local vectorize to svg"
    out_dir = settings.output_path / "ai-images" / user["id"] / "vectorized"
    out_path = out_dir / f"{job_id}.svg"
    try:
        save_ai_image_job(
            job_id=job_id, user_id=user["id"], status="processing",
            model="local-vectorize", prompt=prompt, size="",
            original_prompt=prompt, resolved_prompt=prompt,
            has_reference=True, progress=15, created_at=created_at,
        )
        width, height = await asyncio.to_thread(_run_local_vectorize, src_path, out_path)
        image_url = f"/ai-images/{quote(user['id'])}/vectorized/{quote(out_path.name)}"
        save_ai_image_job(
            job_id=job_id, user_id=user["id"], status="done",
            model="local-vectorize", prompt=prompt,
            size=f"{width}x{height}" if width and height else "",
            original_prompt=prompt, resolved_prompt=prompt, image_url=image_url,
            has_reference=True, progress=100, created_at=created_at,
        )
        log_operation(
            user_id=user["id"], username=user.get("username", ""),
            action="ai_image_vectorize",
            detail=f"job={job_id[:8]} result=done",
            payload=json.dumps({"job_id": job_id, "image_url": image_url}, ensure_ascii=False),
        )
    except Exception as exc:
        save_ai_image_job(
            job_id=job_id, user_id=user["id"], status="failed",
            model="local-vectorize", prompt=prompt, size="",
            original_prompt=prompt, resolved_prompt=prompt,
            has_reference=True, error=str(exc), progress=100, created_at=created_at,
        )
        log_operation(
            user_id=user["id"], username=user.get("username", ""),
            action="ai_image_vectorize",
            detail=f"job={job_id[:8]} result=failed",
            payload=json.dumps({"job_id": job_id, "error": str(exc)}, ensure_ascii=False),
        )


def _run_local_layer_extract(src_path: Path, out_dir: Path, user_id: str) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        sys.executable,
        "-m", "backend.layer_extract_worker",
        "--src", str(src_path),
        "--out-dir", str(out_dir),
        "--user-id", user_id,
    ]
    proc = subprocess.run(
        cmd,
        cwd=str(settings.root_dir),
        capture_output=True,
        text=True,
        timeout=max(
            120,
            int(settings.ai_image_job_timeout_seconds or 600),
            int(settings.kie_timeout_seconds or 900) + 45,
        ),
        check=False,
    )
    try:
        payload = json.loads((proc.stdout or "").strip().splitlines()[-1])
    except Exception:
        payload = {}
    if proc.returncode != 0 or not payload.get("ok"):
        detail = str(payload.get("error") or (proc.stderr or proc.stdout or "").strip()[-1200:])
        if payload.get("kie_task_id"):
            detail = f"{detail} task_id={payload['kie_task_id']}"
        raise RuntimeError(detail or f"layer-extract 子进程退出码 {proc.returncode}")
    return payload


async def _run_layer_extract_background(job_id: str, user: dict, src_path: Path, created_at: float) -> None:
    prompt = "Kie Seedream 5 Pro 图层分离并导出 PSD"
    out_dir = settings.output_path / "ai-images" / user["id"] / "layer-extract" / job_id
    try:
        save_ai_image_job(
            job_id=job_id, user_id=user["id"], status="processing",
            model="layer-extract", prompt=prompt, size="",
            provider="kie",
            original_prompt=prompt, resolved_prompt=prompt,
            has_reference=True, progress=15, created_at=created_at,
        )
        payload = await asyncio.to_thread(_run_local_layer_extract, src_path, out_dir, user["id"])
        psd_path = Path(payload["psd_path"])
        # PSD 落在 out_dir 下，对外暴露 /ai-images/{user}/layer-extract/{job}/{name}.psd
        rel = psd_path.relative_to(settings.output_path / "ai-images")
        psd_url = f"/ai-images/{quote(rel.as_posix())}"
        # manifest 同理
        manifest_path = Path(payload["manifest_path"])
        manifest_rel = manifest_path.relative_to(settings.output_path / "ai-images")
        manifest_url = f"/ai-images/{quote(manifest_rel.as_posix())}"
        # 图层 PNG 目录对外 URL 前缀（job 目录 URL，前端拼 prefix + '/' + layer.path）
        layers_url_prefix = f"/ai-images/{quote((out_dir.relative_to(settings.output_path / 'ai-images')).as_posix())}"
        # 先完整组装 prompt_trace，再一次性写入 done，避免前端轮询读到
        # done 但 layer_extract 尚未准备好的中间状态。
        extra = {
            "psd_url": psd_url,
            "manifest_url": manifest_url,
            "layers_url_prefix": layers_url_prefix,
            "background_status": payload.get("background_status", ""),
            "decomposition_provider": payload.get("decomposition_provider", "kie"),
            "kie_task_id": payload.get("kie_task_id", ""),
            "kie_layers": payload.get("kie_layers", []),
            "kie_model": settings.kie_layer_model,
            "layers": payload.get("layers", []),
            "source_size": payload.get("source_size", []),
        }
        save_ai_image_job(
            job_id=job_id, user_id=user["id"], status="done",
            model="layer-extract", prompt=prompt,
            size=f"{payload['source_size'][0]}x{payload['source_size'][1]}",
            provider="kie",
            original_prompt=prompt, resolved_prompt=prompt,
            image_url=psd_url, prompt_trace=json.dumps(extra, ensure_ascii=False),
            task_id=payload.get("kie_task_id") or None,
            has_reference=True, progress=100, created_at=created_at,
        )
        # 任务已经持久化为 done；操作日志只能 best-effort，不能因为
        # SQLite 短暂锁定或日志表写入失败而进入下面的 failed 收尾路径。
        try:
            log_operation(
                user_id=user["id"], username=user.get("username", ""),
                action="ai_image_layer_extract",
                detail=f"job={job_id[:8]} result=done layers={len(payload.get('layers', []))}",
                payload=json.dumps({"job_id": job_id, "psd_url": psd_url}, ensure_ascii=False),
            )
        except Exception:
            logger.exception("layer-extract success operation log failed: job=%s", job_id)
    except Exception as exc:
        task_match = re.search(r"task_id=([A-Za-z0-9_-]+)", str(exc))
        save_ai_image_job(
            job_id=job_id, user_id=user["id"], status="failed",
            model="layer-extract", prompt=prompt, size="",
            provider="kie",
            original_prompt=prompt, resolved_prompt=prompt,
            has_reference=True, error=str(exc), progress=100, created_at=created_at,
            task_id=task_match.group(1) if task_match else None,
        )
        log_operation(
            user_id=user["id"], username=user.get("username", ""),
            action="ai_image_layer_extract",
            detail=f"job={job_id[:8]} result=failed",
            payload=json.dumps({"job_id": job_id, "error": str(exc)}, ensure_ascii=False),
        )


def _normalize_ai_chat_messages_for_api(messages: list[dict]) -> list[dict]:
    normalized: list[dict] = []
    for item in messages or []:
        msg = dict(item or {})
        if msg.get("type") == "ai-image-generating":
            msg["imageUrl"] = _normalize_public_asset_url(msg.get("imageUrl"))
            msg["previewUrl"] = _normalize_public_asset_url(msg.get("previewUrl"))
            refs = msg.get("refPreviews")
            if isinstance(refs, list):
                msg["refPreviews"] = [
                    _normalize_public_asset_url(ref) if isinstance(ref, str) else ref
                    for ref in refs
                ]
        normalized.append(msg)
    return normalized


def _normalize_agent_images_for_api(images: list[dict]) -> list[dict]:
    normalized: list[dict] = []
    for item in images or []:
        image = dict(item or {})
        image["image_url"] = _normalize_public_asset_url(image.get("image_url"))
        normalized.append(image)
    return normalized


def _normalize_editor_snapshot_assets(snapshot: dict | None) -> dict | None:
    if not isinstance(snapshot, dict):
        return snapshot
    document = snapshot.get("document")
    store = snapshot.get("store")
    if not isinstance(store, dict) and isinstance(document, dict):
        store = document.get("store")
    if not isinstance(store, dict):
        return snapshot
    for record in store.values():
        if not isinstance(record, dict):
            continue
        if record.get("typeName") != "asset" or record.get("type") != "image":
            continue
        props = record.get("props")
        if not isinstance(props, dict):
            continue
        src = props.get("src")
        normalized_src = _normalize_public_asset_url(src)
        if normalized_src and normalized_src != src:
            props["src"] = normalized_src
    return snapshot


def _assert_job_owner(job_user_id: Optional[str], user: dict) -> None:
    if _is_admin(user):
        return
    if job_user_id and job_user_id != user["id"]:
        raise HTTPException(403, "无权访问其他人的任务")


@app.middleware("http")
async def attach_user_context(request: Request, call_next):
    request.state.user = _get_session_user(request)
    path = request.url.path or "/"
    is_exempt = path in _AUTH_EXEMPT_EXACT_PATHS or any(path.startswith(prefix) for prefix in _AUTH_EXEMPT_PREFIXES)
    # 生图相关请求：在应用层入口就打点，便于对照「前端失败但后端无业务日志」
    # （哪怕 401 被中间件拦截、或 multipart 读 body 前就断开，至少 headers 到达时会有一条记录）
    client_req_id = (
        request.headers.get("x-client-request-id")
        or request.headers.get("X-Client-Request-Id")
        or ""
    ).strip()
    is_ai_image_path = path == "/ai-image" or path.startswith("/ai-image/")
    t0 = time.monotonic()
    if is_ai_image_path:
        user = request.state.user or {}
        logger.info(
            "ai_image_access_in method=%s path=%s client=%s user=%s content_length=%s",
            request.method,
            path,
            client_req_id or "-",
            user.get("username") or user.get("id") or ("anon" if is_exempt else "no-session"),
            request.headers.get("content-length") or "-",
        )
    if not is_exempt:
        if request.state.user is None:
            if is_ai_image_path:
                logger.warning(
                    "ai_image_access_out method=%s path=%s client=%s status=401 reason=no_session elapsed_ms=%.0f",
                    request.method, path, client_req_id or "-", (time.monotonic() - t0) * 1000,
                )
            return JSONResponse({"detail": "请先输入名字进入系统"}, status_code=401)
    try:
        response = await call_next(request)
    except Exception:
        if is_ai_image_path:
            logger.exception(
                "ai_image_access_err method=%s path=%s client=%s elapsed_ms=%.0f",
                request.method, path, client_req_id or "-", (time.monotonic() - t0) * 1000,
            )
        raise
    if is_ai_image_path:
        logger.info(
            "ai_image_access_out method=%s path=%s client=%s status=%s elapsed_ms=%.0f",
            request.method,
            path,
            client_req_id or "-",
            getattr(response, "status_code", "?"),
            (time.monotonic() - t0) * 1000,
        )
    return response


# ─── 路由 ─────────────────────────────────────────────────────────────────────


@app.get("/", include_in_schema=False)
async def root_ui():
    index_file = _frontend_dist / "index.html"
    if index_file.exists():
        html = index_file.read_text(encoding="utf-8")
        if '<base href="/ui/">' not in html:
            html = html.replace("<head>", '<head><base href="/ui/">', 1)
        return HTMLResponse(
            content=html,
            headers={"Cache-Control": "no-cache, must-revalidate"},
        )
    return {"detail": "Not found"}


def _local_health_payload() -> dict:
    library_path = settings.product_library_path
    library_ok = library_path.exists()
    folders_found = []
    if library_ok:
        for folder in settings.IMAGE_TYPE_FOLDERS.values():
            if (library_path / folder).exists():
                folders_found.append(folder)

    return {
        "status": "ok",
        "version": "team-scan-v2",
        "library": {
            "connected": library_ok,
            "path": str(library_path),
            "folders": folders_found,
        },
    }


async def _probe_penpot(client: httpx.AsyncClient) -> bool:
    try:
        response = await client.get(settings.penpot_base_url)
        return response.status_code < 500
    except Exception:
        return False


async def _probe_apimart(client: httpx.AsyncClient) -> dict:
    status = {
        "connected": False,
        "configured": bool(settings.ai_image_api_key),
        "provider": "APIMart",
        "url": settings.ai_image_base_url,
    }
    if not settings.ai_image_api_key:
        return status

    balance_base = settings.ai_image_base_url.rstrip("/")
    if not balance_base.startswith("http"):
        balance_base = "https://" + balance_base
    balance_url = (
        balance_base + "/user/balance"
        if balance_base.endswith("/v1")
        else balance_base + "/v1/user/balance"
    )
    try:
        response = await client.get(
            balance_url,
            headers={"Authorization": f"Bearer {settings.ai_image_api_key}"},
        )
        status["status_code"] = response.status_code
        if response.status_code == 200:
            payload = response.json()
            status["connected"] = bool(payload.get("success"))
            for key in ("remain_balance", "used_balance", "unlimited_quota"):
                if key in payload:
                    status[key] = payload.get(key)
            if payload.get("message"):
                status["message"] = payload.get("message")
        else:
            status["message"] = response.text[:200]
    except Exception as exc:
        status["message"] = str(exc)
    return status


async def _probe_adobe2api(client: httpx.AsyncClient) -> dict:
    status = {
        "connected": False,
        "configured": bool(settings.adobe2api_base_url and settings.adobe2api_api_key),
        "provider": "adobe2api",
        "url": settings.adobe2api_base_url,
    }
    if not status["configured"]:
        status["message"] = "未配置 Adobe 线路"
        return status

    # 与生图适配器一致：确保探测走 /v1 前缀，避免根路径 200 掩盖真实接口不可用
    base = settings.adobe2api_base_url.rstrip("/")
    if not base.endswith("/v1"):
        base = f"{base}/v1"
    status["url"] = base
    candidates = [f"{base}/models", f"{base}/chat/completions", base]
    last_error = ""
    for url in candidates:
        try:
            response = await client.get(
                url,
                headers={"Authorization": f"Bearer {settings.adobe2api_api_key}"},
            )
            code = response.status_code
            status["status_code"] = code
            if 200 <= code < 300:
                status["connected"] = True
                status.pop("message", None)
                return status
            if code in (401, 403):
                status["connected"] = False
                status["message"] = f"鉴权失败 HTTP {code}"
                return status
            if code == 429:
                status["connected"] = True
                status["throttled"] = True
                status["message"] = "HTTP 429 限流"
                return status
            if code in (404, 405, 422):
                # chat/completions 对 GET 常返回 405/422，说明路由存在，可视为连通
                if url.rstrip("/").endswith("chat/completions") and code in (404, 405, 422):
                    # 404 继续；405/422 表示端点存在
                    if code in (405, 422):
                        status["connected"] = True
                        status["message"] = f"端点可达 HTTP {code}"
                        return status
                last_error = f"HTTP {code}"
                continue
            if code >= 500:
                last_error = f"HTTP {code}"
                continue
            last_error = f"HTTP {code}"
        except Exception as exc:
            last_error = str(exc)
    status["connected"] = False
    status["message"] = last_error or "探测失败"
    return status


@app.get("/health")
async def health():
    return _local_health_payload()


@app.get("/health/deep")
async def health_deep():
    local_health = _local_health_payload()
    async with httpx.AsyncClient(timeout=3, trust_env=False) as client:
        penpot_ok, ai_provider, adobe_provider = await asyncio.gather(
            _probe_penpot(client),
            _probe_apimart(client),
            _probe_adobe2api(client),
        )

    ai_provider["apimart"] = dict(ai_provider)
    ai_provider["adobe2api"] = adobe_provider

    latest_sub2api_probe = load_latest_service_probe("sub2api")
    latest_completed_sub2api_probe = load_latest_completed_service_probe("sub2api")
    sub2api_configured = bool(settings.cliproxy_api_key and settings.cliproxy_base_url)
    sub2api_availability_probe = (
        latest_completed_sub2api_probe
        if latest_sub2api_probe and latest_sub2api_probe.get("status") == "running"
        else latest_sub2api_probe
    )
    sub2api_connected = bool(
        sub2api_configured
        and sub2api_availability_probe
        and sub2api_availability_probe.get("status") == "done"
    )
    public_sub2api_probe = None
    if latest_sub2api_probe:
        public_sub2api_probe = {
            "status": latest_sub2api_probe.get("status"),
            "scheduled_slot": latest_sub2api_probe.get("scheduled_slot"),
            "latency_ms": latest_sub2api_probe.get("latency_ms"),
            "created_at": latest_sub2api_probe.get("created_at"),
            "completed_at": latest_sub2api_probe.get("completed_at"),
            "error": str(latest_sub2api_probe.get("error") or "")[:160],
        }
    sub2api_status = {
        "connected": sub2api_connected,
        "configured": sub2api_configured,
        "provider": "CLIProxyAPI",
        "url": settings.cliproxy_base_url,
        "monitor_enabled": settings.sub2api_monitor_enabled,
        "last_probe": public_sub2api_probe,
    }
    if not sub2api_configured:
        sub2api_status["message"] = "未配置订阅线路"
    elif not settings.sub2api_monitor_enabled:
        sub2api_status["message"] = "定时生图探测未启用"
    elif not latest_sub2api_probe:
        sub2api_status["message"] = "等待首次生图探测"
    elif latest_sub2api_probe.get("status") == "running":
        if not latest_completed_sub2api_probe:
            sub2api_status["message"] = "生图探测进行中 · 尚无历史结果"
        elif sub2api_connected:
            sub2api_status["message"] = (
                "生图探测进行中 · 上次成功 "
                f"{latest_completed_sub2api_probe.get('latency_ms') or 0} ms"
            )
        else:
            sub2api_status["message"] = (
                "生图探测进行中 · 上次失败 "
                + str(latest_completed_sub2api_probe.get("error") or "未知错误")[:120]
            )
    elif sub2api_connected:
        sub2api_status["message"] = f"最近探测成功 · {latest_sub2api_probe.get('latency_ms') or 0} ms"
    else:
        sub2api_status["message"] = (
            "最近探测失败 · " + str(latest_sub2api_probe.get("error") or "未知错误")[:160]
        )
    ai_provider["sub2api"] = sub2api_status
    ai_provider["connected"] = bool(
        ai_provider.get("connected")
        or sub2api_status.get("connected")
        or adobe_provider.get("connected")
    )
    ai_provider["configured"] = bool(
        ai_provider.get("configured")
        or sub2api_status.get("configured")
        or adobe_provider.get("configured")
    )

    return {
        **local_health,
        "penpot": {
            "connected": penpot_ok,
            "url": settings.penpot_base_url,
        },
        "ai_provider": ai_provider,
    }


@app.get("/auth/session")
def auth_session(request: Request):
    user = getattr(request.state, "user", None)
    return {"user": user}


@app.get("/proxy-download/login-status")
async def proxy_download_login_status(request: Request):
    _current_user(request)
    if not settings.proxy_download_enabled and not (settings.root_dir / "proxy_download").exists():
        raise HTTPException(503, "花瓣下载服务未启用")
    try:
        status = await proxy_download_check_login()
    except Exception as exc:
        raise HTTPException(502, f"登录状态检测失败: {exc}") from exc
    return status


@app.post("/proxy-download/login")
async def proxy_download_login(request: Request):
    _current_user(request)
    if not settings.proxy_download_enabled and not (settings.root_dir / "proxy_download").exists():
        raise HTTPException(503, "花瓣下载服务未启用")
    try:
        await proxy_download_login_shell()
    except Exception as exc:
        raise HTTPException(502, f"打开登录页面失败: {exc}") from exc
    return {"status": "ok", "message": "浏览器已打开，请在浏览器中登录花瓣后再下载"}


@app.post("/proxy-download/inspect")
async def proxy_download_inspect(body: ProxyDownloadInspectRequest, request: Request):
    user = _current_user(request)
    if not settings.proxy_download_enabled and not (settings.root_dir / "proxy_download").exists():
        raise HTTPException(503, "\u82b1\u74e3\u4e0b\u8f7d\u670d\u52a1\u672a\u542f\u7528")
    request_id = uuid.uuid4().hex[:8]
    started = time.monotonic()
    logger.info("[proxy-download:%s] inspect start user=%s url=%s", request_id, user.get("username"), body.url)
    try:
        payload = await asyncio.wait_for(
            proxy_download_inspect_url(body.url),
            timeout=max(10, settings.proxy_download_request_timeout_seconds),
        )
        logger.info(
            "[proxy-download:%s] inspect done elapsed=%.2fs formats=%s title=%s",
            request_id,
            time.monotonic() - started,
            payload.get("formats") or [],
            payload.get("title"),
        )
    except (asyncio.TimeoutError, TimeoutError) as exc:
        logger.exception("[proxy-download:%s] inspect timeout elapsed=%.2fs", request_id, time.monotonic() - started)
        raise HTTPException(504, "格式检测超时，请确认花瓣账号状态或稍后重试") from exc
    except Exception as exc:
        logger.exception("[proxy-download:%s] inspect failed elapsed=%.2fs", request_id, time.monotonic() - started)
        raise HTTPException(502, f"\u683c\u5f0f\u68c0\u6d4b\u5931\u8d25: {exc}") from exc
    return {
        "source_url": payload.get("source_url") or body.url,
        "title": payload.get("title"),
        "formats": payload.get("formats") or [],
    }


@app.post("/proxy-download/download")
async def proxy_download_download(body: ProxyDownloadRequest, request: Request):
    user = _current_user(request)
    if not settings.proxy_download_enabled and not (settings.root_dir / "proxy_download").exists():
        raise HTTPException(503, "\u82b1\u74e3\u4e0b\u8f7d\u670d\u52a1\u672a\u542f\u7528")
    request_id = uuid.uuid4().hex[:8]
    started = time.monotonic()
    logger.info(
        "[proxy-download:%s] download start user=%s url=%s format=%s timeout=%ss",
        request_id,
        user.get("username"),
        body.url,
        body.format or "-",
        max(30, settings.proxy_download_request_timeout_seconds),
    )
    try:
        async def _download_flow():
            logger.info("[proxy-download:%s] phase inspect", request_id)
            inspection = await proxy_download_inspect_url(body.url)
            formats = inspection.get("formats") or []
            logger.info("[proxy-download:%s] phase inspect done formats=%s", request_id, formats)
            if len(formats) > 1 and not body.format:
                logger.info("[proxy-download:%s] phase choose_format formats=%s", request_id, formats)
                return {
                    "status": "choose_format",
                    "source_url": body.url,
                    "formats": formats,
                    "message": "\u8be5\u7d20\u6750\u652f\u6301\u591a\u79cd\u683c\u5f0f\uff0c\u8bf7\u5148\u9009\u62e9\u4e00\u79cd\u683c\u5f0f\u3002",
                }, None, None
            logger.info("[proxy-download:%s] phase download_url", request_id)
            path, meta = await proxy_download_download_url(body.url, body.format)
            logger.info("[proxy-download:%s] phase download_url done path=%s meta=%s", request_id, path, meta)
            return None, path, meta

        early_response, path, meta = await asyncio.wait_for(
            _download_flow(),
            timeout=max(30, settings.proxy_download_request_timeout_seconds),
        )
        if early_response is not None:
            logger.info("[proxy-download:%s] download early_response elapsed=%.2fs status=%s", request_id, time.monotonic() - started, early_response.get("status"))
            return early_response
    except Exception as exc:
        if isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
            logger.exception("[proxy-download:%s] download timeout elapsed=%.2fs", request_id, time.monotonic() - started)
            raise HTTPException(504, "花瓣下载超时：代理浏览器长时间没有返回，请检查登录状态或重试") from exc
        logger.exception("[proxy-download:%s] download failed elapsed=%.2fs", request_id, time.monotonic() - started)
        raise HTTPException(502, f"\u82b1\u74e3\u4e0b\u8f7d\u5931\u8d25: {exc}") from exc

    filename = _safe_download_filename(str(meta.get("filename") or Path(path).name))
    if not _download_format_matches(filename, body.format):
        logger.error(
            "[proxy-download:%s] format mismatch requested=%s filename=%s meta=%s",
            request_id,
            body.format,
            filename,
            meta,
        )
        raise HTTPException(502, f"下载格式不匹配：选择的是 {body.format}，但实际文件是 {filename}")
    file_path = Path(path)
    if file_path.parent != _proxy_download_dir():
        stem = Path(filename).stem
        ext = Path(filename).suffix
        target_name = f"{uuid.uuid4().hex}_{stem}{ext}"
        target_path = _proxy_download_dir() / target_name
        target_path.write_bytes(file_path.read_bytes())
    else:
        target_path = file_path
    logger.info(
        "[proxy-download:%s] download done elapsed=%.2fs filename=%s size=%s",
        request_id,
        time.monotonic() - started,
        filename,
        target_path.stat().st_size,
    )
    return {
        "status": "done",
        "source_url": str(meta.get("source_url") or body.url),
        "filename": filename,
        "size": target_path.stat().st_size,
        "format": body.format or "",
        "file_url": f"/output/proxy-downloads/{quote(target_path.name)}",
        "download_url": f"/output/proxy-downloads/{quote(target_path.name)}",
        "user_id": user["id"],
    }


@app.post("/auth/login-lite")
def auth_login_lite(body: LiteLoginRequest, response: Response):
    username = " ".join((body.username or "").strip().split())
    password = (body.password or "").strip()
    if not username:
        raise HTTPException(400, "名字不能为空")
    if len(username) > 40:
        raise HTTPException(400, "名字不能超过 40 个字符")
    if not password:
        raise HTTPException(400, "密码不能为空")
    try:
        user = get_or_create_user(username, password)
    except ValueError as e:
        msg = str(e)
        if msg == "username not allowed":
            raise HTTPException(400, "该身份不在可用名单里")
        raise HTTPException(401, "用户名或密码错误")
    session_id = create_session(user["id"])
    log_operation(user_id=user["id"], username=user["username"], action="login",
                  payload=json.dumps({"username": user["username"]}, ensure_ascii=False))
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


@app.post("/auth/avatar")
async def auth_avatar(request: Request, image: UploadFile = File(...)):
    """上传当前用户头像，保存到 avatars/{username}.png"""
    user = _current_user(request)
    if not user:
        raise HTTPException(401, "请先登录")
    username = str(user.get("username") or user.get("id", "unknown"))
    safe_name = "".join(ch for ch in username if ch.isalnum() or ch in "._-") or "unknown"
    _avatars_path = settings.root_dir / "avatars"
    _avatars_path.mkdir(parents=True, exist_ok=True)
    out_path = _avatars_path / f"{safe_name}.png"
    content = await image.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(400, "头像图片不能超过 5MB")
    # 简单 resize 到 200x200 以内
    try:
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(content))
        img = img.convert("RGBA")
        img.thumbnail((200, 200), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        content = buf.getvalue()
    except Exception:
        pass  # 非图片或处理失败，保存原文件
    out_path.write_bytes(content)
    return {"ok": True, "url": f"/avatars/{safe_name}.png"}


@app.get("/auth/me")
def auth_me(request: Request):
    user = _current_user(request)
    if not user:
        raise HTTPException(401, "未登录")
    return {"user": user}


@app.get("/auth/options")
def auth_options():
    return {"users": [{"username": u["username"]} for u in settings.allowed_login_users]}


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
    log_operation(
        user_id=user["id"], username=user["username"],
        action="compose",
        detail=f"template={request.template_frame_id[:8] if request.template_frame_id else '?'}",
        payload=request.model_dump_json() if hasattr(request, 'model_dump_json') else json.dumps({"template_frame_id": request.template_frame_id}, ensure_ascii=False),
    )

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


@app.post("/smart-distribute")
async def smart_distribute_endpoint(file: UploadFile = File(...), mode: str = Form("full")):
    """
    上传 Excel，解析为「铺货 JSON」。
    用 openpyxl 读取单元格 + 模板规则库，不调用 AI。
    供 Photoshop 小变量脚本消费。
    """
    from .smart_distribute import SmartDistributor

    filename = file.filename or "upload.xlsx"
    lowered = filename.lower()
    if not (lowered.endswith(".xlsx") or lowered.endswith(".xlsm")):
        raise HTTPException(400, "智能铺货当前仅支持 .xlsx / .xlsm 文件")
    normalized_mode = str(mode or "full").lower()
    if normalized_mode not in {"full", "patch"}:
        raise HTTPException(400, "智能铺货模式仅支持 full / patch")

    content = await file.read()
    try:
        distributor = SmartDistributor()
        result = distributor.process(content, filename, mode=normalized_mode)
        return result
    except Exception as e:
        raise HTTPException(500, f"智能铺货解析失败: {e}")


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
    log_operation(
        user_id=user["id"], username=user["username"],
        action="compose",
        detail=f"kind=special sku={getattr(request, 'sku', '?')}",
        payload=request.model_dump_json() if hasattr(request, 'model_dump_json') else json.dumps({"sku": getattr(request, 'sku', '?')}, ensure_ascii=False),
    )
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
            normalized = str(p).replace("\\", "/")
            marker = "/results/"
            idx = normalized.rfind(marker)
            urls.append(f"/results/{normalized[idx + len(marker):]}" if idx >= 0 else f"/output/{p.name}")
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

@app.post("/api/projects")
def create_agent_project_endpoint(request: Request):
    user = _current_user(request)
    state = default_project_state()
    project = create_agent_project(
        user_id=user["id"],
        title="新项目",
        status=state["status"],
        phase=state["phase"],
        intent=state["intent"],
        brief=state["brief"],
        current_prompt=state["currentPrompt"],
        current_image=state["currentImage"],
        conversation_summary=state["conversationSummary"],
        metadata=state["metadata"],
        created_at=time.time(),
    )
    return {"success": True, "data": _public_agent_project(project)}


@app.get("/api/projects")
def list_agent_projects_endpoint(request: Request, page: int = 1, limit: int = 20, status: str = ""):
    user = _current_user(request)
    safe_limit = max(1, min(limit, 50))
    safe_page = max(1, page)
    rows = list_agent_projects(limit=safe_page * safe_limit, user_id=user["id"], status=(status or None))
    start = (safe_page - 1) * safe_limit
    slice_rows = rows[start:start + safe_limit]
    data = []
    for project in slice_rows:
        images = list_agent_images(project["id"], user_id=user["id"])
        data.append({
            "id": project["id"],
            "title": project["title"],
            "currentImageUrl": _normalize_public_asset_url((project.get("current_image") or {}).get("imageUrl")),
            "phase": project["phase"],
            "totalGenerations": len(images),
            "updatedAt": project["updated_at"],
        })
    return {"success": True, "data": data, "meta": {"total": len(rows), "page": safe_page}}


@app.get("/api/projects/{project_id}")
def get_agent_project_endpoint(request: Request, project_id: str):
    user = _current_user(request)
    project = get_agent_project(project_id, user_id=user["id"])
    if not project:
        raise HTTPException(404, "项目不存在")
    messages = load_agent_messages(project_id, user_id=user["id"], limit=20)
    images = list_agent_images(project_id, user_id=user["id"])
    return {"success": True, "data": _public_agent_project(project, messages=messages, images=images)}


@app.get("/api/projects/{project_id}/images")
def list_agent_project_images_endpoint(request: Request, project_id: str):
    user = _current_user(request)
    project = get_agent_project(project_id, user_id=user["id"])
    if not project:
        raise HTTPException(404, "项目不存在")
    return {"success": True, "data": _normalize_agent_images_for_api(list_agent_images(project_id, user_id=user["id"]))}


@app.delete("/api/projects/{project_id}")
def delete_agent_project_endpoint(request: Request, project_id: str):
    user = _current_user(request)
    deleted = delete_agent_project(project_id, user_id=user["id"])
    if not deleted:
        raise HTTPException(404, "项目不存在")
    return {"success": True, "data": {"id": project_id, "deleted": True}}


@app.post("/api/projects/{project_id}/chat")
async def agent_project_chat_endpoint(request: Request, project_id: str):
    user = _current_user(request)
    project = get_agent_project(project_id, user_id=user["id"])
    if not project:
        raise HTTPException(404, "项目不存在")
    message = ""
    active_skill_name = ""
    reference_images: list[tuple[bytes, str]] = []
    content_type = (request.headers.get("content-type") or "").lower()
    if "multipart/form-data" in content_type:
        form = await request.form()
        message = str(form.get("message") or "").strip()
        active_skill_name = str(form.get("skill") or "").strip()
        for item in form.getlist("image"):
            if not hasattr(item, "read"):
                continue
            content, filename = await _aread_reference_upload(item, index=len(reference_images))
            reference_images.append((content, filename))
    else:
        payload = AgentChatRequest(**(await request.json()))
        message = (payload.message or "").strip()
        active_skill_name = (payload.skill or "").strip()
    if not message:
        raise HTTPException(400, "message 不能为空")
    active_skill_context = ""
    active_skill_meta = None
    if active_skill_name:
        active_skill_context, active_skill_meta = _load_active_skill_context(active_skill_name, include_references=False)

    async def event_stream():
        try:
            state = normalize_project_state(project)
            recent_messages = load_agent_messages(project_id, user_id=user["id"], limit=12)
            user_payload = {}
            if active_skill_meta:
                user_payload["active_skill"] = active_skill_meta
            metadata = dict(state.get("metadata") or {})
            state["metadata"] = metadata
            cached_reference = dict(metadata.get("referenceContext") or {})
            reference_context_parts = []
            if cached_reference.get("count"):
                reference_context_parts.append(
                    f"用户此前已经上传过 {int(cached_reference['count'])} 张参考图，请延续这些参考图对应的视觉方向，不要要求用户重复上传。"
                )
            if cached_reference.get("summary"):
                reference_context_parts.append(f"已保存的参考图摘要：{cached_reference['summary']}")
            if cached_reference.get("notableElements"):
                joined = "、".join([str(item).strip() for item in cached_reference.get("notableElements") or [] if str(item).strip()])
                if joined:
                    reference_context_parts.append(f"参考图关键元素：{joined}")
            if reference_images:
                yield make_sse("agent_thinking", {
                    "phase": "analyzing_reference",
                    "message": "正在分析参考图，提取主体、风格和构图线索...",
                })
                stored_reference_files = _store_agent_reference_images(project_id, reference_images)
                user_payload["reference_images"] = [
                    {"name": item["name"], "size": item["size"], "url": item["url"]}
                    for item in stored_reference_files
                ]
                reference_context_parts = [
                    f"用户已经上传了 {len(reference_images)} 张参考图，请直接基于这些参考图讨论主体、风格、构图、色彩和氛围，不要再要求用户重复上传参考图。"
                ]
                analysis = await analyze_reference_images(reference_images, message, state)
                cached_reference = {
                    "count": len(reference_images),
                    "files": user_payload["reference_images"],
                    "storedFiles": stored_reference_files,
                }
                if analysis:
                    if analysis.summary:
                        reference_context_parts.append(f"参考图初步分析：{analysis.summary}")
                        user_payload["reference_summary"] = analysis.summary
                        cached_reference["summary"] = analysis.summary
                    if analysis.notable_elements:
                        user_payload["reference_elements"] = analysis.notable_elements
                        cached_reference["notableElements"] = analysis.notable_elements
                    if analysis.extracted_info:
                        state["intent"] = merge_intent(state.get("intent") or {}, analysis.extracted_info)
                        cached_reference["extractedInfo"] = analysis.extracted_info
                metadata["referenceContext"] = cached_reference
            reference_context = "\n".join(reference_context_parts)
            append_agent_message(
                project_id=project_id,
                user_id=user["id"],
                role="user",
                type="user_text",
                text=message,
                payload=user_payload,
                created_at=time.time(),
            )
            log_operation(
                user_id=user["id"], username=user["username"],
                action="agent_chat",
                detail=f"project={project_id[:8]}",
                payload=json.dumps({"message": message, "project_id": project_id[:8], "state_intent": (state.get("intent") or {})}, ensure_ascii=False),
            )
            yield make_sse("agent_thinking", {
                "phase": "understanding_intent",
                "message": "正在理解需求，并整理可以确认的创意方向...",
            })

            # ── 真流式：LLM 逐 token 回调 → 入队 → SSE yield ──
            agent_reply = ""
            intent_patch = None
            hard_constraints = extract_message_constraints(message)
            should_direct_generate = bool(
                detect_confirm(message)
                and state.get("brief")
                and not has_meaningful_intent_update(hard_constraints)
            )
            text_queue: asyncio.Queue = asyncio.Queue()

            def _on_llm_chunk(chunk: str) -> None:
                try:
                    text_queue.put_nowait(("text", chunk))
                except Exception:
                    pass

            def _on_llm_think(think: str) -> None:
                try:
                    text_queue.put_nowait(("think", think))
                except Exception:
                    pass

            async def _run_llm():
                nonlocal agent_reply, intent_patch
                agent_reply, intent_patch = await call_agent_llm(
                    message, state, recent_messages, reference_context,
                    skill_context=active_skill_context,
                    on_chunk=_on_llm_chunk,
                    on_think=_on_llm_think,
                )
                text_queue.put_nowait((None, None))  # sentinel: LLM 完成

            if should_direct_generate:
                agent_reply = "收到，开始生成。"
                intent_patch = VisualIntentPatch(
                    turn_type="confirm",
                    confidence=1.0,
                    operation_hint="text_to_image",
                    patch={},
                    creative_suggestion="",
                )
                yield make_sse("agent_text", {"delta": agent_reply})
            else:
                llm_task = asyncio.create_task(_run_llm())

                # 边收边推送 SSE
                heartbeat_messages = [
                    "正在组织回复，先把需求拆成可执行的视觉要点...",
                    "正在校对方向，避免把主题跑偏...",
                    "还在处理，马上给出下一步可确认的方案...",
                ]
                heartbeat_index = 0
                while True:
                    try:
                        item = await asyncio.wait_for(text_queue.get(), timeout=2.5)
                    except asyncio.TimeoutError:
                        message_index = min(heartbeat_index, len(heartbeat_messages) - 1)
                        yield make_sse("agent_thinking", {
                            "phase": "llm_waiting",
                            "message": heartbeat_messages[message_index],
                        })
                        heartbeat_index += 1
                        continue
                    kind, content = item
                    if kind is None:  # sentinel
                        break
                    if kind == "think":
                        yield make_sse("agent_thinking", {"delta": content})
                    else:
                        yield make_sse("agent_text", {"delta": content})

                await llm_task  # 确保拿到 agent_reply / intent_patch

            state = apply_intent_patch_to_state(
                state,
                intent_patch,
                hard_constraints=hard_constraints,
            )
            if not (state.get("intent") or {}).get("subject"):
                guessed_subject = _coarse_subject_from_message(message)
                if guessed_subject:
                    state["intent"] = merge_intent(state.get("intent") or {}, {"subject": guessed_subject})
            if state["brief"] and detect_confirm(message):
                state["brief"] = dict(state["brief"])
                state["brief"]["confirmedByUser"] = True

            decision = decide_next_action(state, intent_patch or VisualIntentPatch(), message)
            state = apply_decision_to_state(state, decision, message)
            title = summarize_project_title(state, project.get("title") or message)

            updated = update_agent_project(
                project_id,
                title=title,
                status=state["status"],
                phase=state["phase"],
                intent=state["intent"],
                brief=state.get("brief"),
                current_prompt=state.get("currentPrompt"),
                current_image=state.get("currentImage"),
                conversation_summary=state.get("conversationSummary") or "",
                metadata=state.get("metadata"),
                updated_at=time.time(),
            )

            append_agent_message(
                project_id=project_id,
                user_id=user["id"],
                role="assistant",
                type="agent_text",
                text=agent_reply,
                payload={
                    "intent_patch": (intent_patch.model_dump() if intent_patch else {}),
                    "action_intent": (intent_patch.model_dump() if intent_patch else {}),
                    "decision": decision,
                },
                decision_action=decision.get("type"),
                created_at=time.time(),
            )
            yield make_sse("decision", decision)

            if decision.get("type") not in {"GENERATE", "REFINE"}:
                final_project = updated or get_agent_project(project_id, user_id=user["id"])
                yield make_sse("done", {"project": _public_agent_project(final_project or project)})
                return

            generated_image = None
            prompt_payload = dict(decision.get("prompt") or state.get("currentPrompt") or {})
            prompt_payload["_snapshot"] = {
                "intent": _deep_copy_json(state.get("intent") or {}),
                "brief": _deep_copy_json(state.get("brief") or {}),
                "contract": _deep_copy_json(((state.get("metadata") or {}).get("creativeContract")) or decision.get("contract") or {}),
                "decisionType": decision.get("type"),
                "createdAt": time.time(),
            }
            state["currentPrompt"] = prompt_payload
            effective_reference_images = reference_images or _load_cached_agent_reference_images(state.get("metadata"))
            async for event_name, payload in stream_generation_events(
                state=state,
                user_id=user["id"],
                username=user.get("username") or "",
                prompt_payload=prompt_payload,
                current_image=project.get("current_image") if decision.get("type") == "REFINE" else None,
                reference_images=effective_reference_images,
            ):
                yield make_sse(event_name, payload)
                if event_name == "generation_completed":
                    generated_image = payload.get("image")
                    if isinstance(generated_image, dict) and payload.get("provider"):
                        generated_image["provider"] = payload.get("provider")

            if not generated_image or not generated_image.get("url"):
                yield make_sse("error", {"message": "生成完成但未拿到图片地址"})
                return

            vlm_analysis = await run_vlm_critic(generated_image["url"], state)
            images = list_agent_images(project_id, user_id=user["id"])
            parent_image = project.get("current_image") or {}
            image_record = create_agent_image(
                project_id=project_id,
                user_id=user["id"],
                provider=str(generated_image.get("provider") or settings.ai_image_provider or "apimart"),
                model=str(prompt_payload.get("model") or ""),
                prompt=prompt_payload,
                image_url=generated_image["url"],
                vlm_analysis=vlm_analysis,
                parent_image_id=parent_image.get("id"),
                iteration_number=len(images) + 1,
                created_at=time.time(),
            )
            state["currentImage"] = {
                "id": image_record["id"],
                "imageUrl": image_record["image_url"],
                "iterationNumber": image_record["iteration_number"],
            }
            metadata = dict(state.get("metadata") or {})
            metadata["lastVlmAnalysis"] = vlm_analysis
            metadata["suggestedRefine"] = build_suggested_refine_from_vlm(vlm_analysis)
            state["metadata"] = metadata
            state["phase"] = {"stage": "refining", "turnsInStage": 0}
            updated = update_agent_project(
                project_id,
                title=summarize_project_title(state, title),
                status=state["status"],
                phase=state["phase"],
                intent=state["intent"],
                brief=state.get("brief"),
                current_prompt=prompt_payload,
                current_image=state["currentImage"],
                conversation_summary=state.get("conversationSummary") or "",
                metadata=metadata,
                updated_at=time.time(),
            )
            append_agent_message(
                project_id=project_id,
                user_id=user["id"],
                role="assistant",
                type="generation_result",
                text=vlm_analysis.get("userFacingSummary") or "图已经生成好了，我们可以继续细修。",
                payload={
                    "image": image_record,
                    "vlmAnalysis": vlm_analysis,
                    "generationInstruction": {
                        "mode": prompt_payload.get("mode"),
                        "instruction": prompt_payload.get("instruction"),
                        "constraints": prompt_payload.get("constraints"),
                        "parameters": prompt_payload.get("parameters"),
                        "reasoningForUser": prompt_payload.get("reasoningForUser"),
                        "contract": ((state.get("metadata") or {}).get("creativeContract")) or decision.get("contract") or {},
                    },
                },
                decision_action=decision.get("type"),
                created_at=time.time(),
            )
            followup_decision = build_vlm_followup_decision(vlm_analysis)
            if followup_decision:
                append_agent_message(
                    project_id=project_id,
                    user_id=user["id"],
                    role="assistant",
                    type="agent_text",
                    text=followup_decision.get("question") or "这版还有可优化空间，要不要继续细修？",
                    payload={
                        "decision": followup_decision,
                        "vlmAnalysis": vlm_analysis,
                    },
                    decision_action=followup_decision.get("type"),
                    created_at=time.time(),
                )
            yield make_sse("agent_text", {"delta": vlm_analysis.get("userFacingSummary") or "图已经生成好了，我们可以继续细修。"})
            yield make_sse("done", {
                "project": _public_agent_project(updated or project),
                "image": image_record,
                "vlmAnalysis": vlm_analysis,
                "generationInstruction": {
                    "mode": prompt_payload.get("mode"),
                    "instruction": prompt_payload.get("instruction"),
                    "constraints": prompt_payload.get("constraints"),
                    "parameters": prompt_payload.get("parameters"),
                    "reasoningForUser": prompt_payload.get("reasoningForUser"),
                    "contract": ((state.get("metadata") or {}).get("creativeContract")) or decision.get("contract") or {},
                },
            })
        except Exception as exc:
            logger.exception("agent project chat failed: %s", project_id)
            yield make_sse("error", {"message": f"{type(exc).__name__}: {exc}"})

    return StreamingResponse(event_stream(), media_type="text/event-stream")


class ChatMessage(pydantic.BaseModel):
    role: str
    content: str

class ChatContext(pydantic.BaseModel):
    templateName: Optional[str] = None
    templateSlotCount: Optional[int] = None
    productCount: Optional[int] = None
    jobStatus: Optional[str] = None
    hasResult: Optional[bool] = None
    skill: Optional[str] = None

class ChatRequest(pydantic.BaseModel):
    messages: list[ChatMessage]
    context: ChatContext = pydantic.Field(default_factory=ChatContext)


def _load_active_skill_context(
    skill_name: str | None,
    *,
    include_references: bool = False,
    references_subset: list[str] | None = None,
) -> tuple[str, dict | None]:
    clean = str(skill_name or "").strip()
    if not clean:
        return "", None
    skill = load_agent_skill(settings.agent_skill_paths, settings.root_dir, clean)
    if not skill:
        raise HTTPException(404, f"Skill 不存在: {clean}")
    return build_skill_context(
        skill,
        include_references=include_references,
        references_subset=references_subset,
    ), {
        "name": skill.name,
        "title": skill.title,
        "description": skill.description,
        "type": skill.type,
        "references": skill.references,
    }


@app.get("/agent-skills")
async def agent_skills_endpoint(request: Request):
    _current_user(request)
    return {"skills": list_agent_skills(settings.agent_skill_paths, settings.root_dir)}


@app.post("/agent-skills/{skill_name}/plan/stream")
async def agent_skill_plan_stream_endpoint(
    request: Request,
    skill_name: str,
    prompt: str = Form(...),
    image: list[UploadFile] = File(default=[]),
):
    """Stream Skill planner output so the UI can show live reasoning/progress.

    支持多模态：上传参考图时压缩后随 SKILL.md + reference-image-analysis.md
    一起发给 skill LLM，planner 真正看图分析并产出带风格转移指令的 final_prompt。
    """
    _current_user(request)
    user_prompt = (prompt or "").strip()
    if not user_prompt:
        raise HTTPException(400, "prompt 不能为空")

    # 取前 3 张参考图，压成长边 1024 的 webp data_url
    ref_data_urls: list[str] = []
    for i, f in enumerate((image or [])[:3]):
        try:
            raw, _name = await _aread_reference_upload(f, index=i)
            if raw:
                ref_data_urls.append(compress_image_to_data_url(raw, 1024))
        except HTTPException:
            raise
        except Exception:
            logger.warning("Failed to compress skill planner reference image", exc_info=True)
    has_reference = bool(ref_data_urls)

    subset = ["references/reference-image-analysis.md"] if has_reference else None
    skill_context, skill_meta = _load_active_skill_context(skill_name, references_subset=subset)
    if not skill_context:
        raise HTTPException(404, f"未找到 Skill: {skill_name}")

    async def event_stream():
        skill_label = (skill_meta or {}).get("name") or skill_name
        if not settings.skill_llm_api_key or not settings.skill_llm_base_url:
            final_prompt, trace = _fallback_skill_plan(user_prompt, skill_label, skill_context, has_reference=has_reference)
            yield make_sse("delta", {"text": json.dumps(trace, ensure_ascii=False), "mode": "fallback"})
            yield make_sse("done", {"final_prompt": final_prompt, "prompt_trace": json.dumps(trace, ensure_ascii=False), "trace": trace})
            return

        endpoint = _skill_llm_endpoint()
        planner_prompt = _build_skill_planner_prompt(user_prompt, skill_label, skill_context, has_reference=has_reference)
        if has_reference:
            user_content: Any = [{"type": "text", "text": planner_prompt}]
            for url in ref_data_urls:
                user_content.append({"type": "image_url", "image_url": {"url": url}})
        else:
            user_content = planner_prompt
        raw_parts: list[str] = []
        try:
            async with httpx.AsyncClient(timeout=settings.skill_llm_timeout_seconds, trust_env=False) as client:
                async with client.stream(
                    "POST",
                    endpoint,
                    headers={
                        "Authorization": f"Bearer {settings.skill_llm_api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": settings.skill_llm_model,
                        "messages": [{"role": "user", "content": user_content}],
                        "max_tokens": 1400,
                        "temperature": 0.25,
                        "stream": True,
                    },
                ) as resp:
                    if resp.status_code != 200:
                        body_text = (await resp.aread()).decode("utf-8", errors="ignore")
                        raise RuntimeError(f"Skill planner HTTP {resp.status_code}: {body_text[:240]}")
                    async for line in resp.aiter_lines():
                        line = (line or "").strip()
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if not data or data == "[DONE]":
                            continue
                        try:
                            chunk = json.loads(data)
                        except Exception:
                            continue
                        choice = (chunk.get("choices") or [{}])[0]
                        delta = choice.get("delta") or {}
                        message = choice.get("message") or {}
                        content = delta.get("content")
                        if content is None:
                            content = message.get("content")
                        if content:
                            text = str(content)
                            raw_parts.append(text)
                            yield make_sse("delta", {"text": text, "mode": "llm", "model": settings.skill_llm_model})

            raw = "".join(raw_parts).strip()
            trace = _extract_json_object(raw)
            final_prompt = str(trace.get("final_prompt") or "").strip()
            if not final_prompt:
                final_prompt, trace = _fallback_skill_plan(user_prompt, skill_label, skill_context, has_reference=has_reference)
            trace.setdefault("skill", skill_label)
            trace.setdefault("mode", "llm")
            trace.setdefault("model", settings.skill_llm_model)
            if has_reference:
                trace.setdefault("used_reference_images", True)
            yield make_sse("done", {"final_prompt": final_prompt, "prompt_trace": json.dumps(trace, ensure_ascii=False), "trace": trace})
        except Exception as exc:
            logger.exception("Skill planner stream failed: %s", skill_name)
            final_prompt, trace = _fallback_skill_plan(user_prompt, skill_label, skill_context, has_reference=has_reference)
            trace["stream_error"] = str(exc)
            yield make_sse("error", {"message": str(exc), "fallback_prompt": final_prompt, "prompt_trace": json.dumps(trace, ensure_ascii=False), "trace": trace})

    return StreamingResponse(event_stream(), media_type="text/event-stream")


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


def _extract_json_object(text: str) -> dict:
    raw = (text or "").strip()
    if not raw:
        return {}
    raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.I).strip()
    raw = re.sub(r"\s*```$", "", raw).strip()
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        pass
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        try:
            parsed = json.loads(raw[start:end + 1])
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def _fallback_skill_plan(
    user_prompt: str,
    skill_name: str,
    skill_context: str,
    *,
    has_reference: bool = False,
) -> tuple[str, dict]:
    base = f"""{user_prompt}

请严格按 ${skill_name} 的中文艺术字设计规范执行：先判断用户意图和文字主体，再选择合适的字形、笔画、材质、构图、负面约束；画面重点服务于中文标题字本身，避免把说明文字或 Skill 文档内容画进图里。""".strip()
    ref_suffix = ""
    applied_rules = [
        "中文文字是画面主体，优先保证可读性和视觉风格一致。",
        "按用户主题推导字形、材质、氛围和构图，不展示 Skill 文档。",
    ]
    if has_reference:
        ref_suffix = "\n\n用户已上传参考图，请从参考图中提取字形结构、笔画形态、材质、边缘处理、色彩分布、装饰体系与构图特征，将其作为风格转移约束转移到目标中文文字上；不要复制参考图里的文字内容或无关装饰。"
        applied_rules.append("参考图控制视觉风格(字形/笔画/材质/色彩/构图)，不复制其文字内容。")
    final_prompt = (base + ref_suffix).strip()
    steps = [
        "识别到用户显式调用 Skill，进入中文艺术字/标题字生图链路。",
        "读取 SKILL.md 的适用场景、风格判断和生成约束。",
        "将用户原始需求转换为 Image 2 可执行的最终生图 prompt。",
    ]
    if has_reference:
        steps.insert(1, "结合用户上传的参考图，提取风格特征并约束风格转移。")
    trace = {
        "mode": "fallback",
        "skill": skill_name,
        "steps": steps,
        "applied_rules": applied_rules,
        "final_prompt": final_prompt,
        "negative_prompt": "不要生成英文主体字、不要把说明文档画进图里、不要低清晰度、不要乱码、不要多余水印。",
    }
    if has_reference:
        trace["used_reference_images"] = True
    return final_prompt, trace


def _skill_llm_endpoint() -> str:
    base_url = settings.skill_llm_base_url.rstrip("/")
    if base_url.endswith("/chat/completions"):
        return base_url
    if base_url.endswith("/v1"):
        return f"{base_url}/chat/completions"
    return f"{base_url}/v1/chat/completions"


def _build_skill_planner_prompt(
    user_prompt: str,
    skill_name: str,
    skill_context: str,
    *,
    has_reference: bool = False,
) -> str:
    ref_section = ""
    if has_reference:
        ref_section = """

[用户已上传参考图]
请按 reference-image-analysis 的维度分析附图：字形结构、笔画形态、材质、边缘处理、色彩分布、装饰体系、构图。
在 final_prompt 中给出具体的、可执行的风格转移指令：从参考图提取哪些特征、如何转移到目标中文文字上。
不要复制参考图里的文字内容、品牌名或无关装饰；转移的是风格原理，不是内容。
"""
    return f"""你是 DesignFlow 的 Skill Planner。你的任务不是直接聊天，而是读取用户显式调用的 Codex-style SKILL.md，并把它转换为一次可执行的生图请求。

必须输出严格 JSON，不要 Markdown，不要代码块。字段：
{{
  "steps": ["你如何理解用户需求", "你从 Skill 中采用哪些规则", "你如何转换给生图模型"],
  "applied_rules": ["具体采用的 Skill 规则，3-6 条"],
  "final_prompt": "最终传给 gpt-image-2 的完整生图 prompt，要求具体、可执行、不要提到 SKILL.md 文件名或文档本身",
  "negative_prompt": "需要避免的画面问题"
}}

约束：
1. final_prompt 必须围绕用户需求，不要泛化成模板说明。
2. 如果是中文艺术字/标题字，必须明确主体文字、字体气质、笔画/材质/构图/背景/质量要求。
3. 不要把“请遵守 Skill”这类元指令写进 final_prompt，要把规则消化成具体画面语言。
4. 不要编造用户没说的品牌名、日期、价格。
{ref_section}
[用户需求]
{user_prompt}

[启用 Skill: {skill_name}]
{skill_context}
"""


async def _plan_skill_image_prompt(user_prompt: str, skill_name: str, skill_context: str) -> tuple[str, dict]:
    """让 LLM 显式解读 Skill，并产出可展示的解析过程与最终生图 prompt。"""
    if not skill_context:
        return user_prompt, {}
    if not settings.skill_llm_api_key or not settings.skill_llm_base_url:
        return _fallback_skill_plan(user_prompt, skill_name, skill_context)

    endpoint = _skill_llm_endpoint()
    planner_prompt = _build_skill_planner_prompt(user_prompt, skill_name, skill_context)
    try:
        async with httpx.AsyncClient(timeout=settings.skill_llm_timeout_seconds, trust_env=False) as client:
            resp = await client.post(
                endpoint,
                headers={
                    "Authorization": f"Bearer {settings.skill_llm_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.skill_llm_model,
                    "messages": [{"role": "user", "content": planner_prompt}],
                    "max_tokens": 1400,
                    "temperature": 0.25,
                },
            )
        if resp.status_code != 200:
            logger.warning(
                "Skill planner LLM error model=%s endpoint=%s status=%s body=%s",
                settings.skill_llm_model,
                endpoint,
                resp.status_code,
                resp.text[:240],
            )
            return _fallback_skill_plan(user_prompt, skill_name, skill_context)
        data = resp.json()
        content = (((data or {}).get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        trace = _extract_json_object(content)
        final_prompt = str(trace.get("final_prompt") or "").strip()
        if not final_prompt:
            return _fallback_skill_plan(user_prompt, skill_name, skill_context)
        trace.setdefault("skill", skill_name)
        trace.setdefault("mode", "llm")
        trace.setdefault("model", settings.skill_llm_model)
        return final_prompt, trace
    except Exception:
        logger.exception("Skill planner failed, falling back to deterministic plan")
        return _fallback_skill_plan(user_prompt, skill_name, skill_context)


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
    messages = _normalize_ai_chat_messages_for_api(load_ai_chat_messages(session_id, user_id=user["id"]))
    return {"session": session, "messages": messages}


@app.delete("/history/ai-chats/{session_id}")
def delete_history_ai_chat(request: Request, session_id: str):
    user = _current_user(request)
    deleted = delete_ai_chat_session(session_id, user_id=user["id"])
    if not deleted:
        raise HTTPException(404, "未找到历史对话")
    return {"deleted": session_id}


async def _run_ai_image_background(
    job_id: str,
    user_id: str,
    username: str,
    session_id: str,
    provider: str,
    model: str,
    prompt: str,
    size: str,
    resolution: str,
    refs: list[tuple[bytes, str]],
    has_reference: bool,
    created_at: float,
    original_prompt: str = "",
    resolved_prompt: str = "",
    prompt_trace: str = "",
    ref_previews: list[str] | None = None,
    request_meta: dict | None = None,
    batch_id: str = "",
    batch_index: int = 0,
    batch_count: int = 1,
):
    """后台异步生图：轮询进度 → 更新 DB → 下载结果 → 写聊天记录"""
    stage = "init"
    upstream_task_id = ""
    active_provider = provider

    def on_progress(pct: int, api_status: str):
        try:
            # 基于进度和 API 状态综合判断
            # 注意：进度回调不得把 status 写成终态 done（最终 done 由成功路径统一落库）
            api_status_lower = (api_status or "").lower()
            if pct == 0 and api_status_lower in ("", "queued", "pending", "submitted"):
                db_status = "queued"
            else:
                db_status = "processing"
            save_ai_image_job(
                job_id=job_id, user_id=user_id, status=db_status,
                model=model, prompt=prompt, size=size,
                provider=active_provider or provider, resolution=resolution,
                original_prompt=original_prompt, resolved_prompt=resolved_prompt or prompt,
                prompt_trace=prompt_trace,
                progress=pct, has_reference=has_reference, reference_count=len(refs),
                request_meta=request_meta, created_at=created_at,
                task_id=upstream_task_id or None,
            )
        except Exception:
            pass

    def on_accepted(accepted_provider: str = "", upstream_id: str = "") -> None:
        """上游明确接受任务后立即落库 provider + task_id，便于失败后后台追踪。"""
        nonlocal upstream_task_id, active_provider
        if accepted_provider:
            active_provider = accepted_provider
        if upstream_id:
            upstream_task_id = str(upstream_id)
        try:
            save_ai_image_job(
                job_id=job_id, user_id=user_id, status="processing",
                model=model, prompt=prompt, size=size,
                provider=active_provider or provider, resolution=resolution,
                original_prompt=original_prompt, resolved_prompt=resolved_prompt or prompt,
                prompt_trace=prompt_trace,
                progress=10, has_reference=has_reference, reference_count=len(refs),
                request_meta=request_meta, created_at=created_at,
                task_id=upstream_task_id or None,
            )
        except Exception:
            pass

    def on_attempt(attempt_provider: str) -> None:
        """每次发起 POST 前记录真实渠道；accepted 只负责补充上游任务号。"""
        nonlocal active_provider
        active_provider = attempt_provider or active_provider
        try:
            save_ai_image_job(
                job_id=job_id, user_id=user_id, status="processing",
                model=model, prompt=prompt, size=size,
                provider=active_provider or provider, resolution=resolution,
                original_prompt=original_prompt, resolved_prompt=resolved_prompt or prompt,
                prompt_trace=prompt_trace,
                progress=0, has_reference=has_reference, reference_count=len(refs),
                request_meta=request_meta, created_at=created_at,
                task_id=upstream_task_id or None,
            )
        except Exception:
            pass

    try:
        stage = "generate"
        if provider == PROVIDER_AUTO or not provider:
            result = await smart_generate_image_async(
                model=model, prompt=prompt,
                images=refs if refs else None,
                size=size, resolution=resolution, user_id=user_id,
                on_progress=on_progress, on_attempt=on_attempt, on_accepted=on_accepted,
            )
        elif provider == PROVIDER_SUB2API:
            result = await generate_sub2api_async(
                model=model, prompt=prompt,
                images=refs if refs else None,
                size=size, resolution=resolution, user_id=user_id,
                on_progress=on_progress, on_accepted=lambda tid: on_accepted(PROVIDER_SUB2API, tid),
            )
        elif provider == PROVIDER_ADOBE2API:
            result = await generate_adobe2api_async(
                model=model, prompt=prompt,
                images=refs,
                size=size, resolution=resolution, user_id=user_id,
                on_progress=on_progress, on_accepted=lambda tid: on_accepted(PROVIDER_ADOBE2API, tid),
            )
        elif refs:
            result = await generate_image_with_reference_async(
                model=model, prompt=prompt, images=refs,
                size=size, resolution=resolution, user_id=user_id,
                on_progress=on_progress, on_accepted=lambda tid: on_accepted(PROVIDER_APIMART, tid),
            )
        else:
            result = await generate_image_async(
                model=model, prompt=prompt,
                size=size, resolution=resolution, user_id=user_id,
                on_progress=on_progress, on_accepted=lambda tid: on_accepted(PROVIDER_APIMART, tid),
            )
        actual_provider = str(result.get("provider") or provider)
        provider_switched = bool(result.get("provider_switched"))
        upstream_task_id = str(result.get("task_id") or "")
        stage = "persist"
        save_ai_image_job(
            job_id=job_id, user_id=user_id, status="done",
            model=model, prompt=prompt, size=size,
            provider=actual_provider, resolution=resolution,
            original_prompt=original_prompt, resolved_prompt=resolved_prompt or prompt,
            prompt_trace=prompt_trace,
            image_url=result.get("url"), task_id=upstream_task_id or None,
            progress=100, has_reference=has_reference, reference_count=len(refs),
            request_meta=request_meta, created_at=created_at,
        )
        if provider_switched:
            mark_ai_image_job_provider_switched(job_id, True)
        cost_str = f" cost={result.get('cost')}" if result.get('cost') is not None else ""
        time_str = f" {result.get('actual_time') or result.get('estimated_time') or ''}s" if (result.get('actual_time') or result.get('estimated_time')) else ""
        usage = result.get("usage")
        usage_str = ""
        if isinstance(usage, dict):
            usage_str = f" tokens={usage.get('total_tokens') or usage.get('input_tokens',0)+usage.get('output_tokens',0)}"
        preview_url = ""
        try:
            preview_url, _, _ = generate_inspiration_thumb(result.get("url") or "", user_id, job_id)
        except Exception:
            preview_url = result.get("url") or ""
        log_operation(
            user_id=user_id, username=username,
            action="ai_image",
            detail=f"job={job_id[:8]} model={model} size={size} result=done{cost_str}{time_str}{usage_str} image={result.get('url', '?')[:60]}",
            payload=json.dumps({
                "job_id": job_id, "model": model, "size": size, "result": "done",
                "image_url": result.get("url", ""), "cost": result.get("cost"), "usage": usage,
                "provider": actual_provider, "provider_switched": provider_switched,
                "upstream_task_id": upstream_task_id,
            }, ensure_ascii=False),
        )
        append_ai_chat_message(
            session_id=session_id, user_id=user_id,
            role="ai", type="ai_image_result",
            text=prompt, image_url=result.get("url"),
            meta={
                "job_id": job_id,
                "model": model, "prompt": prompt,
                "resolvedPrompt": resolved_prompt or prompt,
                "promptTrace": prompt_trace,
                "provider": actual_provider,
                "providerSwitched": provider_switched,
                "taskId": upstream_task_id,
                "size": size, "resolution": resolution,
                "status": "done",
                "hasReference": has_reference,
                "refCount": len(refs),
                "refPreviews": ref_previews or [],
                "previewUrl": preview_url,
                "batchId": batch_id,
                "batchIndex": batch_index,
                "batchCount": batch_count,
            },
            created_at=time.time(),
        )
        # 成功后清理持久化的参考图
        try:
            cleanup_user_refs(user_id, job_id)
        except Exception:
            pass
    except asyncio.CancelledError:
        # Uvicorn reload / server shutdown can cancel in-flight background tasks.
        # Without explicitly persisting this, the UI keeps polling a permanent
        # "processing" job that will never be resumed.
        cancel_provider = active_provider or provider
        error_msg = format_generation_error(
            "生图任务被服务重载或关闭中断，请重新提交",
            stage=stage or "cancelled",
            provider=cancel_provider,
            model=model,
            job_id=job_id,
            task_id=upstream_task_id,
        )
        logger.warning(
            "ai_image background task cancelled: job_id=%s stage=%s provider=%s",
            job_id, stage, cancel_provider,
        )
        save_ai_image_job(
            job_id=job_id, user_id=user_id, status="failed",
            model=model, prompt=prompt, size=size,
            provider=cancel_provider, resolution=resolution,
            original_prompt=original_prompt, resolved_prompt=resolved_prompt or prompt,
            prompt_trace=prompt_trace,
            has_reference=has_reference, error=error_msg, task_id=upstream_task_id or None,
            reference_count=len(refs), request_meta=request_meta,
            progress=100, created_at=created_at,
        )
        log_operation(
            user_id=user_id, username=username,
            action="ai_image",
            detail=f"job={job_id[:8]} model={model} size={size} result=cancelled stage={stage}",
            payload=json.dumps({
                "job_id": job_id, "model": model, "size": size, "result": "cancelled",
                "error": error_msg, "stage": stage, "provider": cancel_provider,
                "upstream_task_id": upstream_task_id,
            }, ensure_ascii=False),
        )
        append_ai_chat_message(
            session_id=session_id, user_id=user_id,
            role="ai", type="ai_image_result",
            text=prompt, image_url=None,
            meta={
                "job_id": job_id,
                "model": model, "prompt": prompt,
                "provider": cancel_provider,
                "status": "failed", "error": error_msg,
                "hasReference": has_reference,
                "refCount": len(refs),
                "taskId": upstream_task_id,
                "stage": stage,
                "batchId": batch_id,
                "batchIndex": batch_index,
                "batchCount": batch_count,
            },
            created_at=time.time(),
        )
        raise
    except Exception as e:
        stage = str(getattr(e, "stage", "") or stage or "generate")
        upstream_task_id = str(getattr(e, "task_id", "") or upstream_task_id)
        fail_provider = str(getattr(e, "provider", "") or active_provider or provider)
        error_msg = format_generation_error(
            e,
            stage=stage or "generate",
            provider=fail_provider,
            model=model,
            job_id=job_id,
            task_id=upstream_task_id,
        )
        logger.exception(
            "ai_image background task failed: job_id=%s stage=%s provider=%s model=%s error=%s",
            job_id, stage, fail_provider, model, error_msg[:200],
        )
        save_ai_image_job(
            job_id=job_id, user_id=user_id, status="failed",
            model=model, prompt=prompt, size=size,
            provider=fail_provider, resolution=resolution,
            original_prompt=original_prompt, resolved_prompt=resolved_prompt or prompt,
            prompt_trace=prompt_trace,
            has_reference=has_reference, error=error_msg, task_id=upstream_task_id or None,
            reference_count=len(refs), request_meta=request_meta,
            progress=100, created_at=created_at,
        )
        log_operation(
            user_id=user_id, username=username,
            action="ai_image",
            detail=f"job={job_id[:8]} model={model} size={size} result=failed stage={stage} error={error_msg[:80]}",
            payload=json.dumps({
                "job_id": job_id, "model": model, "size": size, "result": "failed",
                "error": error_msg[:500], "stage": stage, "provider": fail_provider,
                "upstream_task_id": upstream_task_id,
            }, ensure_ascii=False),
        )
        append_ai_chat_message(
            session_id=session_id, user_id=user_id,
            role="ai", type="ai_image_result",
            text=prompt, image_url=None,
            meta={
                "job_id": job_id,
                "model": model, "prompt": prompt,
                "provider": fail_provider,
                "status": "failed", "error": error_msg,
                "hasReference": has_reference,
                "refCount": len(refs),
                "taskId": upstream_task_id,
                "stage": stage,
                "batchId": batch_id,
                "batchIndex": batch_index,
                "batchCount": batch_count,
            },
            created_at=time.time(),
        )


@app.post("/ai-image/upscale")
async def ai_image_upscale(request: Request):
    """对站内图片执行本地高清放大，返回可轮询的 ai-image job。"""
    user = _current_user(request)
    body = await request.json()
    image_url = str(body.get("image_url") or "").strip()
    try:
        scale = int(body.get("scale") or settings.upscale_cli_scale or 2)
    except Exception:
        scale = settings.upscale_cli_scale or 2
    job_id = uuid.uuid4().hex
    scale = max(1, min(scale, 4))
    if image_url.startswith("data:image/"):
        src_path = _persist_data_url_image(image_url, user_id=user["id"], job_id=job_id)
    else:
        src_path = _resolve_public_asset_path(image_url, user)
    created_at = time.time()
    prompt = f"local upscale x{scale}"
    save_ai_image_job(
        job_id=job_id, user_id=user["id"], status="processing",
        model="local-upscale", prompt=prompt, size="",
        provider="local", reference_count=1,
        request_meta={"operation": "upscale", "scale": scale, "source_image_url": image_url},
        original_prompt=prompt, resolved_prompt=prompt,
        has_reference=True, progress=0, created_at=created_at,
    )
    asyncio.create_task(_run_upscale_background(job_id, dict(user), src_path, scale, created_at))
    return {"job_id": job_id, "status": "processing", "progress": 0}


@app.post("/ai-image/vectorize")
async def ai_image_vectorize(request: Request):
    """对站内图片执行 vtracer 矢量化，返回可轮询的 ai-image job。"""
    user = _current_user(request)
    body = await request.json()
    image_url = str(body.get("image_url") or "").strip()
    job_id = uuid.uuid4().hex
    created_at = time.time()
    if image_url.startswith("data:image/"):
        src_path = _persist_data_url_image(image_url, user_id=user["id"], job_id=job_id)
    else:
        src_path = _resolve_public_asset_path(image_url, user)
    prompt = "local vectorize to svg"
    save_ai_image_job(
        job_id=job_id, user_id=user["id"], status="processing",
        model="local-vectorize", prompt=prompt, size="",
        provider="local", reference_count=1,
        request_meta={"operation": "vectorize", "source_image_url": image_url},
        original_prompt=prompt, resolved_prompt=prompt,
        has_reference=True, progress=0, created_at=created_at,
    )
    asyncio.create_task(_run_vectorize_background(job_id, dict(user), src_path, created_at))
    return {"job_id": job_id, "status": "processing", "progress": 0}


@app.post("/ai-image/layer-extract")
async def ai_image_layer_extract(request: Request):
    """对站内图片执行"转分层 PSD"：Kie 分层 → 本地按坐标导出 PSD。"""
    user = _current_user(request)
    body = await request.json()
    image_url = str(body.get("image_url") or "").strip()
    job_id = uuid.uuid4().hex
    created_at = time.time()
    if image_url.startswith("data:image/"):
        src_path = _persist_data_url_image(image_url, user_id=user["id"], job_id=job_id)
    else:
        src_path = _resolve_public_asset_path(image_url, user)
    prompt = "Kie Seedream 5 Pro 图层分离并导出 PSD"
    save_ai_image_job(
        job_id=job_id, user_id=user["id"], status="processing",
        model="layer-extract", prompt=prompt, size="",
        provider="kie", reference_count=1,
        request_meta={
            "operation": "layer_extract",
            "provider": "kie",
            "model": settings.kie_layer_model,
            "source_image_url": image_url,
        },
        original_prompt=prompt, resolved_prompt=prompt,
        has_reference=True, progress=0, created_at=created_at,
    )
    asyncio.create_task(_run_layer_extract_background(job_id, dict(user), src_path, created_at))
    return {"job_id": job_id, "status": "processing", "progress": 0}


def _sanitize_log_field(value, limit: int) -> str:
    """外部输入进日志前的防注入清洗：替换 Unicode 不可打印字符并截断。"""
    raw = str(value if value is not None else "")
    return "".join(char if char.isprintable() else " " for char in raw)[:limit]


_CLIENT_EVENT_MAX_BODY = 16 * 1024
_CLIENT_EVENT_RATE_LIMIT = 30  # 每 IP 每分钟
_client_event_rate: dict[str, tuple[float, int]] = {}  # ip -> (窗口起点, 计数)


@app.post("/ai-image/client-event")
async def ai_image_client_event(request: Request):
    """接收前端生图链路事件（尤其是主请求未到达时的失败）。

    仅写日志 + 操作流水，不创建 job。用于事后对照：
    前端有失败卡片、但没有 ai_image_endpoint_enter / job 记录的情况。
    路径已加入鉴权豁免（sendBeacon 可能不带 cookie），故做限流与体积限制防滥用。
    """
    user = getattr(request.state, "user", None)
    # 匿名可达：每 IP 固定窗口限流
    ip = (request.client.host if request.client else "") or "unknown"
    now_ts = time.time()
    win_start, win_count = _client_event_rate.get(ip, (now_ts, 0))
    if now_ts - win_start >= 60:
        win_start, win_count = now_ts, 0
    win_count += 1
    _client_event_rate[ip] = (win_start, win_count)
    if len(_client_event_rate) > 4096:
        for stale_ip in [k for k, (ws, _c) in _client_event_rate.items() if now_ts - ws >= 60]:
            _client_event_rate.pop(stale_ip, None)
    if win_count > _CLIENT_EVENT_RATE_LIMIT:
        return {"ok": False, "rate_limited": True}

    content_length = (request.headers.get("content-length") or "").strip()
    if content_length.isdigit() and int(content_length) > _CLIENT_EVENT_MAX_BODY:
        return {"ok": False, "detail": "payload too large"}
    try:
        raw_body = await request.body()
        if len(raw_body) > _CLIENT_EVENT_MAX_BODY:
            return {"ok": False, "detail": "payload too large"}
        body = json.loads(raw_body)
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {"raw": str(body)[:500]}

    client_req = _sanitize_log_field(
        str(body.get("clientRequestId") or body.get("client") or "").strip()
        or (request.headers.get("x-client-request-id") or "").strip()
        or "-",
        64,
    )
    event_type = _sanitize_log_field(body.get("type") or "unknown", 64)
    phase = _sanitize_log_field(body.get("phase"), 32)
    error = _sanitize_log_field(body.get("error"), 500)
    job_id = _sanitize_log_field(body.get("jobId") or body.get("job_id"), 64)
    unreached = bool(body.get("unreached") or body.get("reachedServer") is False)
    online = body.get("online")
    api_base = _sanitize_log_field(body.get("apiBase"), 200)
    username = (user or {}).get("username") or (user or {}).get("id") or "anon"

    logger.warning(
        "ai_image_client_event type=%s phase=%s client=%s job=%s unreached=%s online=%s user=%s error=%s apiBase=%s",
        event_type,
        phase or "-",
        client_req,
        job_id or "-",
        unreached,
        _sanitize_log_field(online, 32) or "-",
        username,
        error[:200] if error else "-",
        api_base or "-",
    )
    try:
        if user and user.get("id"):
            log_operation(
                user_id=user["id"],
                username=username,
                action="ai_image_client_event",
                detail=f"type={event_type} phase={phase or '-'} client={client_req} job={job_id or '-'} unreached={unreached}",
                payload=json.dumps({
                    "type": event_type,
                    "phase": phase,
                    "client_request_id": client_req,
                    "job_id": job_id,
                    "unreached": unreached,
                    "online": online,
                    "error": error[:300],
                    "httpStatus": body.get("httpStatus"),
                    "attempt": body.get("attempt"),
                    "model": body.get("model"),
                    "provider": body.get("provider"),
                    "apiBase": api_base,
                    "href": str(body.get("href") or "")[:200],
                }, ensure_ascii=False)[:2000],
            )
    except Exception:
        logger.exception("ai_image_client_event log_operation failed client=%s", client_req)

    return {"ok": True, "client_request_id": client_req}


@app.get("/ai-image/{job_id}")
def ai_image_status(request: Request, job_id: str):
    """查询生图任务状态，前端轮询此接口获取进度"""
    user = _current_user(request)
    job = load_ai_image_job(job_id)
    if not job:
        raise HTTPException(404, f"任务不存在（job={job_id[:8]}）")
    if not _is_admin(user) and job.get("user_id") != user["id"]:
        raise HTTPException(404, f"任务不存在（job={job_id[:8]}）")
    if job.get("status") in {"queued", "processing"}:
        age_seconds = time.time() - float(job.get("created_at") or 0)
        timeout_seconds = max(60, int(settings.ai_image_job_timeout_seconds or 600))
        if age_seconds > timeout_seconds:
            error_msg = format_generation_error(
                f"生图任务超时：超过 {timeout_seconds} 秒没有返回结果，请稍后重试",
                stage="timeout",
                model=job.get("model") or "",
                job_id=job["id"],
                task_id=job.get("task_id") or "",
            )
            save_ai_image_job(
                job_id=job["id"], user_id=job.get("user_id") or user["id"], status="failed",
                model=job.get("model") or "", prompt=job.get("prompt") or "", size=job.get("size") or "",
                original_prompt=job.get("original_prompt") or job.get("prompt") or "",
                resolved_prompt=job.get("resolved_prompt") or job.get("prompt") or "",
                prompt_trace=job.get("prompt_trace") or "",
                has_reference=bool(job.get("has_reference")), error=error_msg,
                task_id=job.get("task_id"), progress=100,
                created_at=job.get("created_at") or time.time(),
            )
            job = load_ai_image_job(job_id) or job
    image_url = job.get("image_url")
    preview_url = ""
    if image_url:
        preview_url = get_inspiration_thumb_url_if_exists(
            image_url,
            job.get("user_id") or user["id"],
            job["id"],
        )
    layer_extract = None
    if job.get("model") == "layer-extract" and job.get("prompt_trace"):
        try:
            layer_extract = json.loads(job["prompt_trace"])
        except Exception:
            layer_extract = None
    error_text = job.get("error") or ""
    # 历史脏数据：status=failed 但 error 为空，补一条可排查文案，避免前端「未知错误」
    if job.get("status") == "failed" and not str(error_text).strip():
        error_text = format_generation_error(
            "生图失败但未记录错误详情（可能是旧任务或进程异常退出）",
            model=job.get("model") or "",
            job_id=job["id"],
            task_id=job.get("task_id") or "",
        )
        try:
            save_ai_image_job(
                job_id=job["id"], user_id=job.get("user_id") or user["id"], status="failed",
                model=job.get("model") or "", prompt=job.get("prompt") or "", size=job.get("size") or "",
                original_prompt=job.get("original_prompt") or job.get("prompt") or "",
                resolved_prompt=job.get("resolved_prompt") or job.get("prompt") or "",
                prompt_trace=job.get("prompt_trace") or "",
                has_reference=bool(job.get("has_reference")), error=error_text,
                task_id=job.get("task_id"), progress=int(job.get("progress") or 100),
                created_at=job.get("created_at") or time.time(),
            )
        except Exception:
            pass
    return {
        "job_id": job["id"],
        "status": job["status"],
        "progress": job["progress"],
        # 统一返回站内相对路径，避免公网域名 / 内网 IP / 代理 Host 混用时把结果图指到错误主机。
        "image_url": image_url or None,
        "preview_url": preview_url or None,
        "original_prompt": job.get("original_prompt") or job.get("prompt") or "",
        "resolved_prompt": job.get("resolved_prompt") or job.get("prompt") or "",
        "prompt_trace": job.get("prompt_trace") or "",
        "task_id": job.get("task_id"),
        "model": job.get("model"),
        "provider": job.get("provider"),
        "error": error_text or None,
        "providerSwitched": bool(job.get("provider_switched")),
        "layer_extract": layer_extract,
    }


@app.post("/ai-image/retry")
async def ai_image_retry(request: Request):
    """生图失败后触发智能重试。复用原 prompt + 磁盘参考图 + 上下文参考图。"""
    body = await request.json()
    job_id = (body.get("job_id") or "").strip()
    session_id = (body.get("session_id") or "").strip()
    if not job_id or not session_id:
        raise HTTPException(400, "job_id 和 session_id 不能为空")

    user = _current_user(request)
    old_job = load_ai_image_job(job_id)
    if not old_job:
        raise HTTPException(404, "任务不存在")
    if old_job.get("user_id") != user["id"]:
        raise HTTPException(404, "任务不存在")

    prompt = (old_job.get("prompt") or "").strip()
    original_prompt = (old_job.get("original_prompt") or "").strip()
    resolved_prompt = (old_job.get("resolved_prompt") or prompt).strip()
    model = (old_job.get("model") or "gpt-image-2").strip()
    size = (old_job.get("size") or "1024x1024").strip()
    resolution = (old_job.get("resolution") or "").strip()

    # 1. 从磁盘加载用户上传的参考图
    user_refs = load_user_refs(user["id"], job_id)

    # 2. 取上一张成功生成的图片作为上下文参考图
    context_ref_bytes: list[tuple[bytes, str]] = []
    prev_messages = load_ai_chat_messages(session_id, user_id=user["id"])
    for m in reversed(prev_messages):
        prev_url = m.get("imageUrl") or ""
        if prev_url and prev_url.startswith("/ai-images/"):
            local_path = settings.output_path / "ai-images" / prev_url[len("/ai-images/"):]
            try:
                if local_path.exists():
                    context_ref_bytes.append((local_path.read_bytes(), local_path.name))
                    break
            except Exception:
                pass

    # 3. 合并参考图：用户可见参考图在前，保持 @图片N 与前端编号一致；
    # 会话续图的隐藏上下文图追加在后。
    all_refs = user_refs + context_ref_bytes
    all_refs = all_refs[:9]
    has_reference = bool(all_refs)

    new_job_id = uuid.uuid4().hex
    created_at = time.time()
    save_ai_image_job(
        job_id=new_job_id, user_id=user["id"], status="processing",
        model=model, prompt=prompt, size=size,
        provider=PROVIDER_AUTO, resolution=resolution,
        original_prompt=original_prompt, resolved_prompt=resolved_prompt,
        has_reference=has_reference, reference_count=len(all_refs),
        request_meta={
            "chat_session_id": session_id,
            "retry_from": job_id,
            "manual_reference_count": len(user_refs),
            "context_reference_count": len(context_ref_bytes),
            "reference_names": [name for _content, name in all_refs],
        },
        created_at=created_at,
    )
    log_operation(
        user_id=user["id"], username=user["username"],
        action="ai_image",
        detail=f"job={new_job_id[:8]} model={model} size={size} result=retry_auto refs={len(all_refs)}",
        payload=json.dumps({"job_id": new_job_id, "model": model, "size": size, "provider": PROVIDER_AUTO, "retry_from": job_id}, ensure_ascii=False),
    )
    # 重试消息不重新写入聊天记录（不重复显示 prompt），后台任务完成/失败时会自动追加
    asyncio.create_task(
        _run_ai_image_background(
            job_id=new_job_id, user_id=user["id"], username=user["username"],
            session_id=session_id,
            provider=PROVIDER_AUTO,
            model=model, prompt=prompt,
            size=size, resolution=resolution,
            refs=all_refs, has_reference=has_reference, created_at=created_at,
            original_prompt=original_prompt, resolved_prompt=resolved_prompt,
            ref_previews=[],
            request_meta={
                "chat_session_id": session_id,
                "retry_from": job_id,
                "manual_reference_count": len(user_refs),
                "context_reference_count": len(context_ref_bytes),
                "reference_names": [name for _content, name in all_refs],
            },
        )
    )
    return {"job_id": new_job_id, "status": "processing", "provider": PROVIDER_AUTO}


# ─── 灵感（inspiration） ──────────────────────────────────────────────────────

INSPIRATION_CATEGORIES = {
    "share_card": "分享卡片",
    "moments": "朋友圈",
    "poster": "海报",
    "long_image": "长图文",
    "detail_page": "详情页",
    "main_image": "主图",
    "scene_compose": "场景合成",
    "ai_model": "AI模特",
    "ai_tryon": "AI换装",
    "ai_wearable": "AI穿戴",
    "ai_pose": "AI裂变姿势",
}


def _normalize_inspiration_category(value: str | None) -> str:
    clean = str(value or "").strip()
    return clean if clean in INSPIRATION_CATEGORIES else "share_card"


def _normalize_inspiration_tags(value) -> list[str]:
    if isinstance(value, str):
        raw_items = value.replace("，", ",").replace("、", ",").split(",")
    elif isinstance(value, list):
        raw_items = value
    else:
        raw_items = []
    tags: list[str] = []
    seen: set[str] = set()
    for item in raw_items:
        tag = str(item or "").strip().strip("#")
        if not tag:
            continue
        tag = tag[:24]
        key = tag.casefold()
        if key in seen:
            continue
        seen.add(key)
        tags.append(tag)
        if len(tags) >= 12:
            break
    return tags


def _extract_sse_chat_content(text: str) -> str:
    """Collect OpenAI-compatible text/event-stream chat chunks into plain content."""
    parts: list[str] = []
    for line in (text or "").splitlines():
        line = line.strip()
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if not data or data == "[DONE]":
            continue
        try:
            chunk = json.loads(data)
        except Exception:
            continue
        choice = (chunk.get("choices") or [{}])[0]
        delta = choice.get("delta") or {}
        message = choice.get("message") or {}
        content = delta.get("content")
        if content is None:
            content = message.get("content")
        if content:
            parts.append(str(content))
    return "".join(parts).strip()


@app.post("/inspiration")
async def publish_inspiration(request: Request):
    """把已完成的生图结果发布到灵感页。同一 job_id 只能发布一次。
    支持 job_id 或 image_url（用于从历史消息里点发布时拿不到 job_id 的场景）。"""
    user = _current_user(request)
    body = await request.json()
    job_id = (body.get("job_id") or "").strip()
    image_url = (body.get("image_url") or "").strip()
    category = _normalize_inspiration_category(body.get("category"))
    tags = _normalize_inspiration_tags(body.get("tags"))

    job = None
    if job_id:
        job = load_ai_image_job(job_id)
    elif image_url:
        job = load_ai_image_job_by_image_url(image_url, user_id=user["id"])
    if not job:
        raise HTTPException(404, "任务不存在")
    if not _is_admin(user) and job.get("user_id") != user["id"]:
        raise HTTPException(404, "任务不存在")
    if job.get("status") != "done":
        raise HTTPException(400, "生图任务未完成，不能发布")
    job_id = job["id"]
    image_url = job.get("image_url") or ""
    if not image_url:
        raise HTTPException(400, "任务没有图片 URL")

    existing = get_inspiration_post_by_job(job_id)
    if existing:
        # 兼容旧记录：没 thumb_url 就补一张
        if not existing.get("thumb_url"):
            thumb_url, tw, th = generate_inspiration_thumb(image_url, user["id"], job_id)
            update_inspiration_thumb_url(existing["id"], thumb_url)
            existing = dict(existing)
            existing["thumb_url"] = thumb_url
        return {"post": _inspiration_to_api(existing, current_user=user), "already_published": True}

    post_id = uuid.uuid4().hex
    created_at = time.time()
    thumb_url, tw, th = generate_inspiration_thumb(image_url, user["id"], job_id)
    # 缩略图尺寸即瀑布流要用的尺寸
    inserted = create_inspiration_post(
        post_id=post_id,
        job_id=job_id,
        user_id=user["id"],
        image_url=image_url,
        thumb_url=thumb_url,
        prompt=job.get("prompt") or "",
        original_prompt=job.get("original_prompt") or "",
        resolved_prompt=job.get("resolved_prompt") or job.get("prompt") or "",
        model=job.get("model") or "gpt-image-2",
        size=job.get("size") or "1024x1024",
        resolution=job.get("resolution") or "",
        has_ref=bool(job.get("has_reference")),
        image_width=tw,
        image_height=th,
        created_at=created_at,
        category=category,
        tags=tags,
    )
    if not inserted:
        # 竞态: 并发请求在我们 SELECT 之后/INSERT 之前插入了同 job_id
        # 重新查询返回已存在的那条
        existing = get_inspiration_post_by_job(job_id)
        if existing:
            return {"post": _inspiration_to_api(existing, current_user=user), "already_published": True}
    log_operation(
        user_id=user["id"], username=user["username"],
        action="inspiration_publish",
        detail=f"post={post_id[:8]} job={job_id[:8]} category={category} model={job.get('model')}",
        payload=json.dumps({"post_id": post_id, "job_id": job_id, "model": job.get("model"), "category": category, "tags": tags}, ensure_ascii=False),
    )
    post = get_inspiration_post(post_id)
    return {"post": _inspiration_to_api(post, current_user=user), "already_published": False}


@app.delete("/inspiration/{post_id}")
async def unpublish_inspiration(request: Request, post_id: str):
    """下架灵感：发布者本人或 admin 可操作。"""
    user = _current_user(request)
    post = get_inspiration_post(post_id)
    if not post:
        raise HTTPException(404, "灵感不存在")
    if not _is_admin(user) and post.get("user_id") != user["id"]:
        raise HTTPException(403, "无权下架该灵感")
    delete_inspiration_post(post_id)
    log_operation(
        user_id=user["id"], username=user["username"],
        action="inspiration_unpublish",
        detail=f"post={post_id[:8]} job={post.get('job_id', '')[:8]}",
        payload=json.dumps({"post_id": post_id}, ensure_ascii=False),
    )
    return {"deleted": True}


@app.get("/inspiration")
async def list_inspiration(
    request: Request,
    limit: int = 20,
    offset: int = 0,
    mine: int = 0,
    favorite: int = 0,
    category: str = "",
    search: str = "",
):
    """列出灵感。mine=1 只返回当前用户的发布；favorite=1 返回当前用户收藏。"""
    user = _current_user(request)
    mine_user_id = user["id"] if mine else None
    favorite_user_id = user["id"] if favorite else None
    category_key = category if category in INSPIRATION_CATEGORIES else ""
    rows = list_inspiration_posts(
        min(max(limit, 1), 100),
        max(offset, 0),
        mine_user_id=mine_user_id,
        favorite_user_id=favorite_user_id,
        category=category_key or None,
        search=(search or "").strip() or None,
    )
    favorite_ids = list_inspiration_favorite_ids(
        [str(r.get("id")) for r in rows if r.get("id")],
        user["id"],
    )
    return {"posts": [_inspiration_to_api(r, current_user=user, favorite_ids=favorite_ids) for r in rows]}


@app.get("/inspiration/{post_id}")
async def get_inspiration_detail(request: Request, post_id: str):
    user = _current_user(request)
    post = get_inspiration_post(post_id)
    if not post:
        raise HTTPException(404, "灵感不存在")
    return {"post": _inspiration_to_api(post, current_user=user)}


def _inspiration_to_api(post: dict, current_user: dict | None = None, favorite_ids: set[str] | None = None) -> dict:
    """把 DB 记录转 API 返回结构。展示统一用 thumb_url。"""
    current_user_id = current_user.get("id") if current_user else None
    is_mine = bool(current_user_id and post.get("user_id") == current_user_id)
    can_manage = bool(is_mine or _is_admin(current_user))
    tags = []
    try:
        tags = json.loads(post.get("tags_json") or "[]")
    except Exception:
        tags = []
    category = post.get("category") or "share_card"
    return {
        "id": post["id"],
        "job_id": post["job_id"],
        "image_url": _normalize_public_asset_url(post.get("thumb_url") or post.get("image_url") or ""),
        "full_image_url": _normalize_public_asset_url(post.get("image_url") or post.get("thumb_url") or ""),
        "prompt": post["prompt"],
        "original_prompt": post.get("original_prompt") or "",
        "resolved_prompt": post.get("resolved_prompt") or post.get("prompt") or "",
        "vlm_prompt": post.get("vlm_prompt") or "",
        "vlm_description": post.get("vlm_description") or "",
        "model": post["model"],
        "size": post["size"],
        "resolution": post.get("resolution") or "",
        "has_ref": bool(post.get("has_ref")),
        "category": category,
        "category_label": INSPIRATION_CATEGORIES.get(category, "分享卡片"),
        "tags": tags if isinstance(tags, list) else [],
        "favorited": bool(
            current_user_id and (
                (favorite_ids is not None and post["id"] in favorite_ids)
                or (favorite_ids is None and is_inspiration_favorited(post["id"], current_user_id))
            )
        ),
        "is_mine": is_mine,
        "can_manage": can_manage,
        "width": int(post.get("image_width") or 0),
        "height": int(post.get("image_height") or 0),
        "created_at": post["created_at"],
    }


@app.post("/inspiration/{post_id}/favorite")
async def favorite_inspiration(request: Request, post_id: str):
    user = _current_user(request)
    post = get_inspiration_post(post_id)
    if not post:
        raise HTTPException(404, "灵感不存在")
    set_inspiration_favorite(post_id, user["id"], True)
    return {"favorited": True}


@app.delete("/inspiration/{post_id}/favorite")
async def unfavorite_inspiration(request: Request, post_id: str):
    user = _current_user(request)
    post = get_inspiration_post(post_id)
    if not post:
        raise HTTPException(404, "灵感不存在")
    set_inspiration_favorite(post_id, user["id"], False)
    return {"favorited": False}


@app.post("/inspiration/{post_id}/describe")
async def describe_inspiration(request: Request, post_id: str):
    user = _current_user(request)
    post = get_inspiration_post(post_id)
    if not post:
        raise HTTPException(404, "灵感不存在")
    if post.get("vlm_prompt"):
        return {"prompt": post.get("vlm_prompt") or "", "description": post.get("vlm_description") or "", "cached": True}
    cached_vlm = find_inspiration_vlm_cache(
        job_id=post.get("job_id") or "",
        image_url=post.get("image_url") or "",
    )
    if cached_vlm and cached_vlm.get("vlm_prompt"):
        update_inspiration_vlm(
            post_id,
            cached_vlm.get("vlm_prompt") or "",
            cached_vlm.get("vlm_description") or "",
        )
        return {
            "prompt": cached_vlm.get("vlm_prompt") or "",
            "description": cached_vlm.get("vlm_description") or "",
            "cached": True,
            "cache_source": cached_vlm.get("id"),
        }
    if not settings.vlm_api_key:
        raise HTTPException(503, "VLM 未配置，无法反推 prompt")
    image_data_url = await _resolve_image_data_url(post.get("image_url") or post.get("thumb_url") or "")
    if not image_data_url:
        raise HTTPException(400, "无法读取灵感图片")
    messages = [{
        "role": "user",
        "content": [
            {
                "type": "text",
                "text": (
                    "你是资深电商视觉总监和生图提示词工程师。请只根据这张图片，反推出可复刻该图片视觉效果的详细中文生图 prompt。\n"
                    "要求：\n"
                    "1. 必须输出 JSON，不要 Markdown，不要解释。\n"
                    "2. JSON 字段必须包含 description、prompt、elements。\n"
                    "3. description 用 80-120 字概括画面，要说明用途、主体、视觉气质和画面结构。\n"
                    "4. prompt 不少于 180 字，必须可直接用于生图，具体描述主体、构图、镜头视角、空间层次、光影、背景、色彩、材质质感、文字/留白区域、商业用途、精修风格和生成注意事项。\n"
                    "5. elements 必须包含 subject、composition、camera、lighting、background、color、material、typography、style、negative。\n"
                    "6. 如果图中有商品、人物、文案或品牌感，要分别说明它们的位置、比例、关系和优先级。\n"
                    "7. 不要声称知道原始 prompt，不要编造不可见信息，只根据图像反推。"
                ),
            },
            {"type": "image_url", "image_url": {"url": image_data_url}},
        ],
    }]
    try:
        endpoint = _chat_completions_endpoint(settings.vlm_base_url)
        async with httpx.AsyncClient(timeout=60, trust_env=False) as client:
            resp = await client.post(
                endpoint,
                headers={"Authorization": f"Bearer {settings.vlm_api_key}", "Content-Type": "application/json"},
                json={"model": settings.vlm_model, "messages": messages, "temperature": 0.2, "stream": False},
            )
        if not resp.is_success:
            raise HTTPException(resp.status_code, f"VLM 反推失败: {resp.text[:200]}")

        raw = ""
        try:
            payload = resp.json()
        except Exception as exc:
            preview = (resp.text or "").strip()[:200]
            streamed_content = _extract_sse_chat_content(resp.text or "")
            if streamed_content:
                payload = {"choices": [{"message": {"content": streamed_content}}]}
                raw = streamed_content
            else:
                logger.warning("VLM describe returned non-json response from %s: %s", endpoint, preview)
                raise HTTPException(
                    502,
                    "VLM 反推失败: 接口返回的不是 OpenAI-compatible JSON，"
                    f"请检查 VLM_BASE_URL/VLM_MODEL 是否为视觉对话模型。返回预览: {preview or '空响应'}",
                ) from exc
        else:
            raw = payload.get("choices", [{}])[0].get("message", {}).get("content", "")
            if not raw:
                raw = _extract_sse_chat_content(resp.text or "")
        if not raw:
            logger.warning("VLM describe returned no usable content from %s: %s", endpoint, str(payload)[:300])
            raise HTTPException(
                502,
                f"VLM 未返回可用 prompt，返回结构: {json.dumps(payload, ensure_ascii=False)[:300]}",
            )
        clean_raw = str(raw or "").strip()
        if clean_raw.startswith("```"):
            clean_raw = clean_raw.strip("`").strip()
            if clean_raw.lower().startswith("json"):
                clean_raw = clean_raw[4:].strip()
        parsed = None
        if clean_raw:
            try:
                parsed = json.loads(clean_raw)
            except Exception:
                match = re.search(r"(\{.*\})", clean_raw, flags=re.S)
                if match:
                    try:
                        parsed = json.loads(match.group(1))
                    except Exception:
                        parsed = None
        if isinstance(parsed, dict):
            prompt = str(parsed.get("prompt") or "").strip()
            description = str(parsed.get("description") or "").strip()
        else:
            prompt = clean_raw
            description = ""
        if not prompt:
            raise HTTPException(502, f"VLM 未返回可用 prompt，返回结构: {json.dumps(payload, ensure_ascii=False)[:300]}")
        update_inspiration_vlm(post_id, prompt, description)
        log_operation(
            user_id=user["id"], username=user["username"],
            action="inspiration_describe",
            detail=f"post={post_id[:8]}",
            payload=json.dumps({"post_id": post_id, "prompt": prompt[:300]}, ensure_ascii=False),
        )
        return {"prompt": prompt, "description": description, "cached": False}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("inspiration describe failed: %s", post_id)
        raise HTTPException(502, f"VLM 反推失败: {exc}") from exc


@app.post("/editor/snapshot")
async def editor_save_snapshot(request: Request):
    """保存画布快照"""
    user = _current_user(request)
    expected_user_id = str(request.query_params.get("user_id") or "").strip()
    if not expected_user_id or expected_user_id != str(user["id"]):
        raise HTTPException(409, "画板登录用户已变化，请刷新页面后重试")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    snapshot = body.get("snapshot") if isinstance(body, dict) else None
    if not snapshot:
        raise HTTPException(400, "snapshot 不能为空")
    foreign_assets = _editor_snapshot_foreign_asset_urls(snapshot, str(user["id"]))
    if foreign_assets:
        raise HTTPException(409, "画板包含其他用户的图片，已拒绝保存，请刷新页面")
    base_revision = body.get("base_revision") if isinstance(body, dict) else None
    intent = body.get("intent") if isinstance(body, dict) else None

    raw = json.dumps(snapshot, ensure_ascii=False) if not isinstance(snapshot, str) else snapshot
    ok, rev, reason = save_editor_snapshot(user["id"], raw, base_revision=base_revision, intent=intent)
    if not ok:
        raise HTTPException(
            status_code=409,
            detail={"saved": False, "reason": reason or "snapshot_rejected", "current_revision": rev},
        )
    return {"saved": True, "revision": rev}


@app.get("/editor/snapshot")
def editor_load_snapshot(request: Request):
    """加载画布快照"""
    user = _current_user(request)
    expected_user_id = str(request.query_params.get("user_id") or "").strip()
    if not expected_user_id or expected_user_id != str(user["id"]):
        raise HTTPException(409, "画板登录用户已变化，请刷新页面后重试")
    raw, rev = load_editor_snapshot(user["id"])
    if raw is None:
        return {"snapshot": None, "revision": 0}
    try:
        return {
            "snapshot": _normalize_editor_snapshot_assets(json.loads(raw)),
            "revision": rev,
        }
    except Exception:
        return {"snapshot": None, "revision": 0}


def _editor_snapshot_foreign_asset_urls(snapshot: object, user_id: str) -> list[str]:
    if not isinstance(snapshot, dict):
        return []
    store = snapshot.get("store")
    document = snapshot.get("document")
    if not isinstance(store, dict) and isinstance(document, dict):
        store = document.get("store")
    if not isinstance(store, dict):
        return []

    prefix = "/ai-images/"
    foreign: list[str] = []
    for record in store.values():
        if not isinstance(record, dict) or record.get("typeName") != "asset":
            continue
        props = record.get("props")
        src = str(props.get("src") or "") if isinstance(props, dict) else ""
        try:
            path = urlsplit(src).path if "://" in src else src.split("?", 1)[0]
        except Exception:
            path = src
        if not path.startswith(prefix):
            continue
        owner = unquote(path[len(prefix):].split("/", 1)[0])
        if owner and owner != user_id:
            foreign.append(src)
    return foreign


# ─── /ai-image 提交幂等去重 ──────────────────────────────────────────────────
# 前端对网络失败 / 120s 超时 / 502-504 会带同一 client_request_id 自动重试；
# 首次请求可能已被受理（如 prompt 改写耗时超过客户端超时后服务端仍继续执行），
# 不去重会重复建 job、重复消耗上游生图额度。单进程内存表（与 compose 串行锁同假设）。
_AI_IMAGE_SUBMIT_DEDUP_TTL = 600.0  # 秒；覆盖前端两轮 120s 超时 + 重试间隔，留足余量
MAX_REFERENCE_IMAGE_BYTES = 5 * 1024 * 1024  # 单张参考图硬限制 5MB


async def _aread_reference_upload(upload: UploadFile, *, index: int = 0) -> tuple[bytes, str]:
    """读取单张参考图并校验大小，超限直接 400。

    只读取 MAX+1 字节，避免超大上传把整文件载入内存。
    """
    filename = (getattr(upload, "filename", None) or f"ref{index}.png").strip() or f"ref{index}.png"
    content = await upload.read(MAX_REFERENCE_IMAGE_BYTES + 1)
    if not content:
        raise HTTPException(400, f"参考图为空：{filename}")
    if len(content) > MAX_REFERENCE_IMAGE_BYTES:
        raise HTTPException(400, f"参考图不能超过 5MB：{filename}")
    return content, filename
_ai_image_submits: dict[tuple[str, str], tuple[float, asyncio.Future]] = {}


def _ai_image_submit_dedup(func):
    """按 (user_id, client_request_id) 去重 /ai-image 提交。

    首个请求注册 Future 并真正执行；同键的重复请求（含首次仍在处理中的在途
    重复）等待该 Future，原样复用首次的响应或异常，不重复建 job / 写聊天记录。
    成功与 4xx 确定性失败在 TTL 内缓存重放；5xx / 中断等可重试失败完成后即清
    缓存，让后续同键自动重试真正重新执行。未带编号的请求直接放行，行为不变。
    """
    @functools.wraps(func)
    async def wrapper(*args, **kwargs):
        request: Request = kwargs["request"]
        client_req = _sanitize_log_field(
            (kwargs.get("client_request_id") or "").strip()
            or (request.headers.get("x-client-request-id") or "").strip(),
            64,
        )
        if not client_req:
            return await func(*args, **kwargs)
        # 幂等键必须按用户隔离：client_request_id 由客户端提供，不同用户可能撞号，
        # 全局键会让后来者拿到他人的 job_id/会话号且自己的任务不执行。
        # 必须用元组而非分隔符拼接：用户 ID 来自配置、client 号来自客户端，
        # 两者都可能含分隔符，字符串拼接会被构造出跨用户碰撞（"a"+"b:c" == "a:b"+"c"）
        user = getattr(request.state, "user", None) or {}
        dedup_key = (str(user.get("id") or "anon"), client_req)

        now = time.time()
        for key in [
            k for k, (ts, f) in _ai_image_submits.items()
            if f.done() and now - ts > _AI_IMAGE_SUBMIT_DEDUP_TTL
        ]:
            _ai_image_submits.pop(key, None)

        existing = _ai_image_submits.get(dedup_key)
        if existing is not None:
            first_ts, first_fut = existing
            logger.warning(
                "ai_image_submit_dedup user=%s client=%s first_age_ms=%.0f in_flight=%s",
                user.get("username") or user.get("id") or "-",
                client_req, (now - first_ts) * 1000, not first_fut.done(),
            )
            outcome = await first_fut
            if outcome["ok"]:
                return outcome["response"]
            raise outcome["error"]

        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        _ai_image_submits[dedup_key] = (now, fut)
        try:
            response = await func(*args, **kwargs)
        except asyncio.CancelledError:
            # 服务重载/关闭中断首次请求：给等待方一个明确错误，自身照常传播取消；
            # 属可重试失败，不保留缓存
            fut.set_result({"ok": False, "error": HTTPException(503, "提交处理被中断（服务重启或关闭），请重试")})
            _ai_image_submits.pop(dedup_key, None)
            raise
        except BaseException as exc:
            fut.set_result({"ok": False, "error": exc})
            # 5xx / 未知异常视为可重试：完成后即清缓存（在途等待方仍复用本次异常），
            # 同键的下一次请求会真正重新执行；4xx 属确定性失败，保留重放
            status = getattr(exc, "status_code", None)
            if not isinstance(status, int) or status >= 500:
                _ai_image_submits.pop(dedup_key, None)
            raise
        else:
            fut.set_result({"ok": True, "response": response})
            return response

    return wrapper


@app.post("/ai-image")
@_ai_image_submit_dedup
async def ai_image_endpoint(
    request: Request,
    model: str = Form(...),
    provider: str = Form(""),
    prompt: str = Form(...),
    size: str = Form("1024x1024"),
    resolution: str = Form(""),
    skill: str = Form(""),
    planned_prompt: str = Form(""),
    prompt_trace: str = Form(""),
    chat_session_id: str = Form(""),
    image: List[UploadFile] = File(default=[]),
    ref_previews: str = Form(""),
    batch_count: int = Form(1),
    client_request_id: str = Form(""),
):
    """
    AI 生图接口（异步）。支持文生图（无 image）和图生图（最多 9 张参考图）。
    自动注入对话历史上下文：用 LLM 改写 prompt + 上次结果图作为参考。
    batch_count > 1 时并发创建 N 个独立 job（共享 chat_session_id），返回 job_ids 列表。
    提交任务后立即返回 {job_id(s), chat_session_id, status: "processing"}，
    前端轮询 GET /ai-image/{job_id} 获取进度与结果。
    """
    # Form 已解析完成才进入这里；若连这条日志都没有，说明请求卡在鉴权/body 上传阶段
    client_req = _sanitize_log_field(
        (client_request_id or "").strip()
        or (request.headers.get("x-client-request-id") or "").strip()
        or "-",
        64,
    )
    user_early = getattr(request.state, "user", None) or {}
    logger.info(
        "ai_image_endpoint_enter client=%s model=%s provider=%s size=%s batch=%s refs=%s user=%s",
        client_req,
        model,
        provider or "-",
        size,
        batch_count,
        len(image or []),
        user_early.get("username") or user_early.get("id") or "-",
    )
    batch_count = max(1, min(int(batch_count or 1), 4))
    original_prompt = prompt.strip()
    ref_previews_list = []
    try:
        ref_previews_list = json.loads(ref_previews or "[]")
        if not isinstance(ref_previews_list, list):
            ref_previews_list = []
    except (json.JSONDecodeError, TypeError):
        ref_previews_list = []
    if not original_prompt:
        raise HTTPException(400, "prompt 不能为空")

    resolved = SLASH_MODEL_MAP.get(model.lower(), model)
    if not resolved:
        raise HTTPException(400, f"未知模型: {model}")
    # 去掉用户 prompt 中的 /指令 前缀，只保留实际描述内容
    for cmd in SLASH_MODEL_MAP:
        if original_prompt.lower().startswith(cmd):
            original_prompt = original_prompt[len(cmd):].strip()
            break
    try:
        resolved_provider = normalize_provider(provider)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    active_skill_name = (skill or "").strip()
    active_skill_context = ""
    active_skill_meta = None
    if active_skill_name:
        active_skill_context, active_skill_meta = _load_active_skill_context(active_skill_name, include_references=False)
    user = _current_user(request)
    job_id = uuid.uuid4().hex
    session_id = (chat_session_id or "").strip()
    session = get_ai_chat_session(session_id, user_id=user["id"]) if session_id else None
    if not session:
        session = create_ai_chat_session(user_id=user["id"], title=_build_ai_chat_title(original_prompt), created_at=time.time())
        session_id = session["id"]

    images = image[:9] if image else []
    created_at = time.time()
    append_ai_chat_message(
        session_id=session_id,
        user_id=user["id"],
        role="user",
        type="user_text",
        text=original_prompt,
        meta={"model": resolved, "size": size, "resolution": resolution, "refPreviews": ref_previews_list, "batchCount": batch_count, "skill": active_skill_name},
        created_at=created_at,
    )
    try:
        # —— 上下文注入（对用户透明）——
        enriched_prompt = original_prompt
        prompt_trace_payload: dict = {}
        prompt_trace_text = (prompt_trace or "").strip()
        context_ref_bytes: list[tuple[bytes, str]] = []

        # 1. LLM 根据历史改写 prompt
        if session_id and settings.siliconflow_api_key:
            enriched_prompt = await _build_context_aware_prompt(
                session_id=session_id,
                user_id=user["id"],
                current_prompt=original_prompt,
            )

        if planned_prompt.strip():
            enriched_prompt = planned_prompt.strip()
            if prompt_trace_text:
                try:
                    parsed_trace = json.loads(prompt_trace_text)
                    if isinstance(parsed_trace, dict):
                        prompt_trace_payload = parsed_trace
                except Exception:
                    prompt_trace_payload = {"mode": "stream", "raw": prompt_trace_text}
        elif active_skill_context:
            skill_label = (active_skill_meta or {}).get("name") or active_skill_name
            enriched_prompt, prompt_trace_payload = await _plan_skill_image_prompt(
                enriched_prompt,
                skill_label,
                active_skill_context,
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
        user_refs: list[tuple[bytes, str]] = []
        for i, f in enumerate(images):
            user_refs.append(await _aread_reference_upload(f, index=i))

        has_reference = bool(images) or bool(context_ref_bytes)
        # 批次模式：N 个独立 job 共享同样的 session/参数；batch_id 用于把 N 条结果聚合成一张多图卡
        batch_id = uuid.uuid4().hex if batch_count > 1 else ""
        job_ids: list[str] = []
        for _idx in range(batch_count):
            jid = uuid.uuid4().hex
            job_ids.append(jid)
            # 持久化用户参考图（每个 job 各存一份，避免并发覆盖）
            if user_refs:
                try:
                    save_user_refs(user["id"], jid, user_refs)
                except Exception:
                    logger.warning("Failed to save user refs for job %s", jid)
            # 用户可见参考图在前，保持 @图片N 与前端编号一致；
            # 会话续图的隐藏上下文图追加在后。
            all_refs_batch: list[tuple[bytes, str]] = user_refs + context_ref_bytes
            all_refs_batch = all_refs_batch[:9]  # 总共最多 9 张
            request_meta = {
                "client_request_id": client_req,
                "chat_session_id": session_id,
                "skill": active_skill_name,
                "batch_id": batch_id,
                "batch_index": _idx,
                "batch_count": batch_count,
                "manual_reference_count": len(user_refs),
                "context_reference_count": len(context_ref_bytes),
                "reference_names": [name for _content, name in all_refs_batch],
                # data URL 缩略图体积很大，不写入任务库；站内 URL 可以安全保留用于排障。
                "reference_previews": [
                    preview for preview in ref_previews_list
                    if isinstance(preview, str) and not preview.startswith("data:")
                ],
            }
            save_ai_image_job(
                job_id=jid,
                user_id=user["id"],
                status="processing",
                model=resolved,
                prompt=original_prompt,
                size=size,
                provider=resolved_provider,
                resolution=resolution,
                original_prompt=original_prompt,
                resolved_prompt=original_prompt,
                prompt_trace=json.dumps(prompt_trace_payload, ensure_ascii=False) if prompt_trace_payload else prompt_trace_text,
                has_reference=has_reference,
                reference_count=len(all_refs_batch),
                request_meta=request_meta,
                created_at=created_at,
            )
            log_operation(
                user_id=user["id"], username=user["username"],
                action="ai_image",
                detail=f"job={jid[:8]} client={client_req} model={resolved} size={size} prompt={original_prompt[:50]}{'...' if len(original_prompt) > 50 else ''} refs={len(all_refs_batch)} batch={batch_count}",
                payload=json.dumps({
                    "job_id": jid, "client_request_id": client_req, "model": resolved, "size": size,
                    "prompt": original_prompt[:200], "refs": len(all_refs_batch),
                    "provider": resolved_provider, "batch_count": batch_count, "skill": active_skill_name,
                }, ensure_ascii=False),
            )
            asyncio.create_task(
                _run_ai_image_background(
                    job_id=jid, user_id=user["id"], username=user["username"],
                    session_id=session_id,
                    provider=resolved_provider,
                    model=resolved, prompt=enriched_prompt,
                    size=size, resolution=resolution,
                    refs=all_refs_batch, has_reference=has_reference, created_at=created_at,
                    original_prompt=original_prompt, resolved_prompt=enriched_prompt,
                    prompt_trace=json.dumps(prompt_trace_payload, ensure_ascii=False) if prompt_trace_payload else prompt_trace_text,
                    ref_previews=ref_previews_list,
                    request_meta=request_meta,
                    batch_id=batch_id, batch_index=_idx, batch_count=batch_count,
                )
            )
        if batch_count == 1:
            return {
                "job_id": job_ids[0],
                "chat_session_id": session_id,
                "status": "processing",
                "client_request_id": client_req,
                "resolved_prompt": enriched_prompt,
                "prompt_trace": json.dumps(prompt_trace_payload, ensure_ascii=False) if prompt_trace_payload else prompt_trace_text,
            }
        return {
            "job_ids": job_ids,
            "batch_id": batch_id,
            "chat_session_id": session_id,
            "status": "processing",
            "client_request_id": client_req,
            "resolved_prompt": enriched_prompt,
            "prompt_trace": json.dumps(prompt_trace_payload, ensure_ascii=False) if prompt_trace_payload else prompt_trace_text,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("ai_image_endpoint error: model=%s size=%s", resolved, size)
        # 失败时给 batch_count 个失败 job，方便前端轮询看到状态
        failed_ids: list[str] = []
        provider_for_err = ""
        try:
            provider_for_err = resolved_provider  # type: ignore[name-defined]
        except Exception:
            provider_for_err = (provider or "").strip()
        has_ref_for_err = bool(images)
        try:
            has_ref_for_err = bool(images) or bool(context_ref_bytes)  # type: ignore[name-defined]
        except Exception:
            pass
        for _ in range(batch_count):
            fid = uuid.uuid4().hex
            failed_ids.append(fid)
            save_ai_image_job(
                job_id=fid,
                user_id=user["id"],
                status="failed",
                model=resolved,
                prompt=original_prompt,
                size=size,
                provider=provider_for_err or None,
                resolution=resolution,
                original_prompt=original_prompt,
                resolved_prompt=original_prompt,
                has_reference=has_ref_for_err,
                reference_count=len(images),
                request_meta={
                    "client_request_id": client_req,
                    "chat_session_id": session_id,
                    "skill": active_skill_name,
                    "batch_count": batch_count,
                    "stage": "submit",
                },
                error=format_generation_error(
                    e, stage="submit", provider=provider_for_err, model=resolved, job_id=fid,
                ),
                progress=100,
                created_at=created_at,
            )
        err_msg = format_generation_error(
            e, stage="submit", provider=provider_for_err, model=resolved,
        )
        raise HTTPException(502, {
            "message": err_msg,
            "error": err_msg,
            "chat_session_id": session_id,
            "job_ids": failed_ids,
        })


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
    image_bytes, filename = await _aread_reference_upload(image, index=0)
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
        filename=filename,
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
    if not ((settings.chat_llm_api_key and settings.chat_llm_base_url) or settings.siliconflow_api_key):
        raise HTTPException(500, "未配置 CHAT_LLM_API_KEY 或 SILICONFLOW_API_KEY")

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

    # 仅在会话首条消息注入完整知识库，后续消息使用精简上下文（LLM 已有记忆）
    is_first_message = not req.messages or len(req.messages) <= 1
    knowledge_block = (settings._load_knowledge() or "（暂无知识库文档）") if is_first_message else ""

    system_prompt = f"""你是 DesignFlow 的 AI 设计助手。DesignFlow 是一个 AI 驱动的电商设计资产平台，核心功能是帮助运营/设计人员快速批量合成产品海报。

平台工作流程：
1. 在左侧模板库选择一个 Penpot 设计模板（单品/4宫格/6宫格/9宫格等）
2. 上传产品需求表格（Excel/CSV），包含产品名称、价格、SKU 等信息
3. AI 自动解析表格，将产品数据匹配到模板插槽
4. 点击「/开始生图」，后端调用 Penpot API 自动填充并导出海报
5. 导出 PNG 或切成九宫格图片用于投放

当前用户工作台状态：
{state_str}"""

    if knowledge_block:
        system_prompt += f"""

以下是平台的完整功能文档，请严格基于此文档回答用户关于功能使用、操作方法的问题：

---
{knowledge_block}
---"""

    skill_context = ""
    skill_meta = None
    if ctx.skill:
        skill_context, skill_meta = _load_active_skill_context(ctx.skill, include_references=False)
    if skill_context:
        system_prompt += f"""

当前用户显式启用了 Skill：{skill_meta.get('name') if skill_meta else ctx.skill}
以下是该 Skill 的完整说明。你必须优先遵守它，但不要声称读取了未提供的 reference 文件，也不要执行任何脚本：

---
{skill_context}
---"""

    system_prompt += """

你的角色：
- 根据用户当前状态，主动给出下一步建议
- 回答用户关于平台功能、操作方法的问题，严格参考上方知识库文档
- 如果用户想执行操作，引导他们使用对应的快捷指令
- 可以解答电商设计、产品海报相关的专业问题
- 语气自然、简洁，不要过度列举，像真人同事一样沟通
- 回复使用中文，长度适中（2-5句为佳），绝对不要在句子中间截断，必须说完整
- 不要总结步骤列表，除非用户明确询问操作流程"""

    messages = [{"role": "system", "content": system_prompt}]
    messages += [{"role": m.role, "content": m.content} for m in req.messages]

    async def call_chat_model(*, base_url: str, api_key: str, model: str, timeout: int):
        endpoint = _chat_completions_endpoint(base_url)
        async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
            return await client.post(
                endpoint,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": messages,
                    "max_tokens": 2048,
                    "temperature": 0.8,
                },
            )

    resp = None
    primary_error = ""
    if settings.chat_llm_api_key and settings.chat_llm_base_url:
        try:
            resp = await call_chat_model(
                base_url=settings.chat_llm_base_url,
                api_key=settings.chat_llm_api_key,
                model=settings.chat_llm_model,
                timeout=settings.chat_llm_timeout_seconds,
            )
            if resp.status_code != 200:
                primary_error = resp.text[:200]
                resp = None
        except Exception as exc:
            primary_error = f"{type(exc).__name__}: {exc}"

    if resp is None and settings.siliconflow_api_key:
        resp = await call_chat_model(
            base_url=settings.siliconflow_base_url,
            api_key=settings.siliconflow_api_key,
            model=settings.siliconflow_model,
            timeout=30,
        )

    if resp is None:
        raise HTTPException(500, f"AI 服务不可用: {primary_error or '主线路与兜底线路均未配置'}")
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


# ─── 管理后台 ──────────────────────────────────────────────────────────────────

@app.get("/admin/stats")
def admin_stats(request: Request):
    """聚合统计（仅管理员）"""
    user = _current_user(request)
    if not _is_admin(user):
        raise HTTPException(403, "需要管理员权限")
    return load_admin_stats()


@app.get("/admin/overview")
def admin_overview(request: Request, hours: int = 24):
    """运营概览与异常摘要（仅管理员，只读）。"""
    user = _current_user(request)
    if not _is_admin(user):
        raise HTTPException(403, "需要管理员权限")
    safe_hours = 0 if hours == 0 else max(1, min(hours, 24 * 31))
    return load_admin_overview(hours=safe_hours)


@app.get("/admin/service-probes")
def admin_service_probes(
    request: Request,
    service: str = "sub2api",
    limit: int = 48,
):
    """Return persisted real-request service probes for operational diagnosis."""
    user = _current_user(request)
    if not _is_admin(user):
        raise HTTPException(403, "需要管理员权限")
    if service != "sub2api":
        raise HTTPException(400, "不支持的服务探测类型")
    return {
        "service": service,
        "probes": load_service_probes(service, limit=limit),
    }


@app.post("/admin/alerts/stale/acknowledge")
def admin_acknowledge_stale_alert(request: Request, body: dict):
    """Mark the currently visible stale-task alert as operationally handled."""
    user = _current_user(request)
    if not _is_admin(user):
        raise HTTPException(403, "需要管理员权限")
    fingerprint = str(body.get("fingerprint") or "").strip()
    current = load_admin_overview(hours=24)
    current_fingerprint = str(current.get("stale_alert_key") or "")
    if not fingerprint or fingerprint != current_fingerprint:
        raise HTTPException(409, "异常任务集合已经变化，请刷新后重新确认")
    acknowledgement = acknowledge_admin_alert("stale_tasks", fingerprint, user["id"])
    log_operation(
        user_id=user["id"],
        username=user["username"],
        action="admin_alert_acknowledge",
        detail=f"确认处理 {len(current.get('stale_tasks') or [])} 个超时任务",
        payload=json.dumps(
            {
                "fingerprint": fingerprint,
                "task_ids": [item.get("id") for item in current.get("stale_tasks") or []],
            },
            ensure_ascii=False,
        ),
    )
    return {"acknowledgement": acknowledgement}


@app.get("/admin/tasks")
def admin_tasks(
    request: Request,
    limit: int = 50,
    offset: int = 0,
    status: str = "",
    task_type: str = "",
    user_id: str = "",
    search: str = "",
    provider: str = "",
    reference: str = "",
):
    """统一任务中心（仅管理员，只读）。"""
    user = _current_user(request)
    if not _is_admin(user):
        raise HTTPException(403, "需要管理员权限")
    allowed_statuses = {"", "active", "pending", "queued", "processing", "running", "done", "failed"}
    allowed_types = {"", "compose", "special", "ai_image", "agent_image"}
    allowed_references = {"", "yes", "no"}
    if status not in allowed_statuses:
        raise HTTPException(400, "不支持的任务状态")
    if task_type not in allowed_types:
        raise HTTPException(400, "不支持的任务类型")
    if reference not in allowed_references:
        raise HTTPException(400, "不支持的参考图筛选条件")
    tasks, total = load_admin_tasks(
        limit=limit,
        offset=offset,
        status=status or None,
        task_type=task_type or None,
        user_id=user_id or None,
        search=search or None,
        provider=provider or None,
        reference=reference or None,
    )
    return {
        "tasks": tasks,
        "total": total,
        "limit": max(1, min(limit, 200)),
        "offset": max(0, offset),
    }


@app.get("/admin/tasks/{task_type}/{task_id}")
def admin_task_detail(request: Request, task_type: str, task_id: str):
    """任务完整持久化快照（仅管理员，只读）。"""
    user = _current_user(request)
    if not _is_admin(user):
        raise HTTPException(403, "需要管理员权限")
    allowed_types = {"compose", "special", "ai_image", "agent_image"}
    if task_type not in allowed_types:
        raise HTTPException(400, "不支持的任务类型")
    detail = load_admin_task_detail(task_type, task_id)
    if not detail:
        raise HTTPException(404, "任务不存在")
    return {"task": detail}


@app.get("/admin/users")
def admin_users(request: Request, include_test: bool = False):
    """用户列表 + 活动统计（仅管理员，以 login_users.json 为准，补充 DB 活动数据）"""
    user = _current_user(request)
    if not _is_admin(user):
        raise HTTPException(403, "需要管理员权限")
    db_users = load_admin_users()
    db_by_id = {u["id"]: u for u in db_users}
    merged = []
    for u in settings.allowed_login_users:
        is_test = bool(u.get("is_test", False))
        if not include_test and is_test:
            continue
        stats = db_by_id.get(u["id"], {})
        merged.append({
            "id": u["id"],
            "username": u["username"],
            "display_name": u.get("display_name", ""),
            "role": u.get("role", "user"),
            "is_test": is_test,
            "created_at": stats.get("created_at"),
            "total_jobs": stats.get("total_jobs", 0),
            "total_special_jobs": stats.get("total_special_jobs", 0),
            "total_ai_images": stats.get("total_ai_images", 0),
            "total_agent_projects": stats.get("total_agent_projects", 0),
            "total_operations": stats.get("total_operations", 0),
            "last_action": stats.get("last_action"),
        })
    return {"users": merged}


@app.post("/admin/users")
def admin_create_user(request: Request, body: dict):
    """新增用户（仅管理员）"""
    admin = _current_user(request)
    if not _is_admin(admin):
        raise HTTPException(403, "需要管理员权限")
    username = (body.get("username") or "").strip()
    role = (body.get("role") or "user").strip()
    password = (body.get("password") or "").strip()
    display_name = (body.get("display_name") or "").strip()
    is_test = bool(body.get("is_test", False))
    if not username:
        raise HTTPException(400, "username 不能为空")
    if role not in ("admin", "user"):
        raise HTTPException(400, "role 必须是 admin 或 user")
    if not password:
        raise HTTPException(400, "password 不能为空")
    new_id = username.casefold().replace(" ", "_")
    if any(u["id"] == new_id for u in settings.allowed_login_users):
        raise HTTPException(409, f"用户 {new_id} 已存在")
    new_user = {
        "id": new_id,
        "username": username,
        "display_name": display_name[:40],
        "role": role,
        "is_test": is_test,
        "password_hash": hash_password(password),
    }
    settings.save_login_users(list(settings.allowed_login_users) + [new_user])
    sync_user_test_status(new_id, is_test)
    return {"user": _public_login_user(new_user)}


@app.put("/admin/users/{user_id}")
def admin_update_user(request: Request, user_id: str, body: dict):
    """更新用户角色 / 属性（仅管理员）"""
    admin = _current_user(request)
    if not _is_admin(admin):
        raise HTTPException(403, "需要管理员权限")
    users = list(settings.allowed_login_users)
    idx = next((i for i, u in enumerate(users) if u["id"] == user_id), None)
    if idx is None:
        raise HTTPException(404, f"用户 {user_id} 不存在")
    updates = {}
    if "role" in body and body["role"] in ("admin", "user"):
        updates["role"] = body["role"]
    if "username" in body and body["username"].strip():
        updates["username"] = body["username"].strip()
    if "display_name" in body:
        updates["display_name"] = str(body.get("display_name") or "").strip()[:40]
    if "is_test" in body:
        updates["is_test"] = bool(body["is_test"])
    if not updates:
        raise HTTPException(400, "至少需要 role、username、display_name 或 is_test 字段")
    users[idx].update(updates)
    settings.save_login_users(users)
    if "is_test" in updates:
        sync_user_test_status(user_id, updates["is_test"])
    return {"user": _public_login_user(users[idx])}


@app.post("/admin/users/{user_id}/reset-password")
def admin_reset_password(request: Request, user_id: str):
    """重置用户密码为未设置状态（仅管理员）"""
    admin = _current_user(request)
    if not _is_admin(admin):
        raise HTTPException(403, "需要管理员权限")
    users = list(settings.allowed_login_users)
    idx = next((i for i, u in enumerate(users) if u["id"] == user_id), None)
    if idx is None:
        raise HTTPException(404, f"用户 {user_id} 不存在")
    users[idx]["password_hash"] = ""
    settings.save_login_users(users)
    return {"ok": True}


@app.delete("/admin/users/{user_id}")
def admin_delete_user(request: Request, user_id: str):
    """删除用户（仅管理员）"""
    admin = _current_user(request)
    if not _is_admin(admin):
        raise HTTPException(403, "需要管理员权限")
    if user_id == admin["id"]:
        raise HTTPException(400, "不能删除自己")
    users = list(settings.allowed_login_users)
    idx = next((i for i, u in enumerate(users) if u["id"] == user_id), None)
    if idx is None:
        # 用户不在 login_users.json 中（可能已被删除或仅在 DB 中有记录），不算错误
        return {"deleted": {"id": user_id, "note": "不在认证列表中，无需删除"}}
    deleted = users.pop(idx)
    if deleted.get("is_test"):
        sync_user_test_status(user_id, True)
    settings.save_login_users(users)
    return {"deleted": _public_login_user(deleted)}


@app.get("/admin/operations")
def admin_operations(
    request: Request,
    limit: int = 50,
    offset: int = 0,
    action: str = "",
    user_id: str = "",
):
    """操作日志（仅管理员）"""
    user = _current_user(request)
    if not _is_admin(user):
        raise HTTPException(403, "需要管理员权限")
    ops = load_operation_logs(
        limit=min(limit, 200),
        offset=offset,
        action=action or None,
        user_id=user_id or None,
    )
    total = count_operation_logs(
        action=action or None,
        user_id=user_id or None,
    )
    return {
        "operations": ops,
        "total": total,
        "limit": limit,
        "offset": offset,
    }

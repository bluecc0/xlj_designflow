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
import html
import io
import json
import logging
import mimetypes
import re
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timedelta
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
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from .ai_image import (
    PROVIDER_SUB2API,
    PROVIDER_TUZI,
    PROVIDER_ADOBE2API,
    PROVIDER_APIMART,
    PROVIDER_AUTO,
    cleanup_user_refs,
    format_generation_error,
    public_generation_error,
    generate_image,
    generate_image_with_reference,
    generate_image_async,
    generate_image_with_reference_async,
    generate_sub2api_async,
    generate_tuzi_async,
    generate_adobe2api_async,
    smart_generate_image_async,
    resume_image_async,
    generate_inspiration_thumb,
    get_inspiration_thumb_url_if_exists,
    load_user_refs,
    touch_user_refs,
    cleanup_expired_user_refs,
    normalize_provider,
    save_user_refs,
    _ai_image_public_url,
    compress_image_to_data_url,
    normalize_model_name,
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
    _coarse_subject_from_message,
    _deep_copy_json,
    _extract_first_json_object,
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
from . import outfit_change
from .bfl_vto import FLUX_VTO_MODEL, PROVIDER_BFL, generate_vto_async
from .ai_job_recovery import execute_image_job
from .task_checkpoint import checkpoint, execution_lock
from .psd_layered import create_layered_psd_from_image
from .matting_service import matting_service
from .bfl_outpainting import (
    BFL_ALLOWED_MODES,
    BFL_OUTPAINTING_MODEL,
    FAST_SAFE_OUTPUT_PIXELS,
    MAX_OUTPUT_PIXELS,
    MAX_OUTPUT_SIDE,
    MIN_CANVAS_SIDE,
    BflOutpaintingError,
    OutpaintingValidationError,
    PreparedOutpaintingImage,
    OutpaintingGeometry,
    discard_prepared_source_snapshot,
    is_pre_submit_phase,
    load_prepared_source_snapshot,
    persist_prepared_source_snapshot,
    prepare_outpainting_image,
    resolve_geometry_from_meta,
    run_outpainting,
    validate_geometry,
    validate_mode_geometry,
)
from .special_compose_full import run_special_full_compose
from .special_export import SpecialExportSizeError, prepare_special_export_image
from .compose import get_client, run_compose
from .config import settings
from .model_routing import get_model_routes, routed_chat_completion, routed_chat_stream
from .agent_skill_loader import build_skill_context, list_agent_skills, load_agent_skill
from .user_skill_store import (
    MAX_UPLOAD_BYTES as MAX_SKILL_UPLOAD_BYTES,
    SkillUploadError,
    delete_user_skill,
    install_user_skill,
    list_all_user_skills,
    read_user_skill_detail,
    user_skill_dir,
)
from .job_store import (
    acknowledge_admin_alert,
    append_ai_chat_message,
    create_ai_chat_session,
    create_agent_image,
    create_agent_project,
    delete_agent_project,
    delete_ai_chat_session,
    create_session,
    create_image_copy_link,
    get_image_copy_asset,
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
    load_skill_usage_stats,
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
    load_ai_image_job_by_client_request_id,
    load_active_outpainting_jobs,
    load_recoverable_image_jobs,
    load_active_compose_jobs,
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
    create_daily_database_backup,
    save_special_job,
    load_special_job,
    load_special_job_model,
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
    list_quick_prompts,
    create_quick_prompt,
    update_quick_prompt,
    delete_quick_prompt,
    seed_default_quick_prompts,
)
from .models import (
    ComposeJob,
    ComposeRequest,
    ComposeStatus,
    ExportRequest,
    GridExportRequest,
    ParseResult,
    QuickPromptCreateRequest,
    QuickPromptUpdateRequest,
    SlotInfo,
    SpecialComposeJob,
    SpecialComposeRequest,
    SpecialResultImage,
    SpecialFullComposeJob,
    SpecialFullComposeRequest,
    TemplateGroup,
    TemplateInfo,
)
from .product_library import ProductLibrary
from .slot_schema import schema as slot_schema
from .special_compose import detect_special_materials, parse_special_command, run_special_compose
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


async def _database_backup_loop() -> None:
    """Run the daily database backup without blocking the async server."""
    while True:
        backup_succeeded = False
        try:
            backup_path = await asyncio.to_thread(create_daily_database_backup)
            backup_succeeded = backup_path is not None
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("[database-backup] daily backup failed")

        now = datetime.now()
        next_day = (now + timedelta(days=1)).replace(
            hour=0, minute=0, second=5, microsecond=0
        )
        seconds_until_next_day = max(60, (next_day - now).total_seconds())
        try:
            await asyncio.to_thread(cleanup_expired_user_refs, 7)
        except Exception:
            logger.exception("[refs-cleanup] daily expired refs cleanup failed")
        # Retry a failed backup within the same day, but never create a second
        # backup after the current date already has one.
        await asyncio.sleep(
            seconds_until_next_day if backup_succeeded else min(3600, seconds_until_next_day)
        )


def _ensure_ui_build() -> None:
    script = Path(__file__).resolve().parent.parent / "ensure_ui_build.py"
    if not script.is_file():
        logger.warning("ensure_ui_build.py missing; skip UI stale check")
        return
    result = subprocess.run(
        [sys.executable, str(script)],
        cwd=str(script.parent),
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError("frontend / canvas rebuild failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    app.state.outpainting_semaphore = asyncio.Semaphore(
        max(1, int(settings.bfl_outpainting_max_concurrency or 2))
    )
    app.state.outpainting_tasks = set()
    app.state.outpainting_claims = {}
    app.state.ai_image_tasks = set()
    app.state.compose_recovery_tasks = set()
    app.state.recovery_jobs = set()
    await asyncio.to_thread(_ensure_ui_build)
    if settings.matting_enabled:
        app.state.matting_warmup_task = asyncio.create_task(
            asyncio.to_thread(matting_service.warmup)
        )
    app.state.inspiration_migration_task = asyncio.create_task(
        asyncio.to_thread(_migrate_inspiration_thumbnails)
    )
    app.state.database_backup_task = asyncio.create_task(_database_backup_loop())
    app.state.job_recovery_task = asyncio.create_task(_job_recovery_loop())
    app.state.outpainting_recovery_task = None
    if (
        settings.bfl_outpainting_enabled
        and settings.bfl_api_key.strip()
        and not _outpainting_configuration_error()
    ):
        app.state.outpainting_recovery_task = _track_outpainting_task(
            _outpainting_recovery_loop()
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
        app.state.job_recovery_task.cancel()
        await asyncio.gather(app.state.job_recovery_task, return_exceptions=True)
        image_tasks = list(app.state.ai_image_tasks)
        for task in image_tasks:
            task.cancel()
        if image_tasks:
            await asyncio.gather(*image_tasks, return_exceptions=True)
        # Cancelling a to_thread awaiter cannot stop its thread. The OS locks
        # remain held inside the workers until they actually finish or exit.
        for task in list(app.state.compose_recovery_tasks):
            task.cancel()
        monitor_task = app.state.sub2api_monitor_task
        if monitor_task:
            monitor_task.cancel()
            await asyncio.gather(monitor_task, return_exceptions=True)
        backup_task = app.state.database_backup_task
        if backup_task:
            backup_task.cancel()
            await asyncio.gather(backup_task, return_exceptions=True)
        outpainting_tasks = list(getattr(app.state, "outpainting_tasks", set()))
        for task in outpainting_tasks:
            task.cancel()
        if outpainting_tasks:
            await asyncio.gather(*outpainting_tasks, return_exceptions=True)
        await proxy_download_stop()


app = FastAPI(title="Design Tool API", version="0.1.0", lifespan=lifespan)


def _track_ai_image_task(coro):
    tasks = getattr(app.state, "ai_image_tasks", None)
    if tasks is None:
        tasks = app.state.ai_image_tasks = set()
    task = asyncio.create_task(coro)
    tasks.add(task)
    task.add_done_callback(tasks.discard)
    task.add_done_callback(_log_background_exception)
    return task


def _log_background_exception(task):
    if not task.cancelled() and task.exception():
        logger.error("background recovery failed", exc_info=task.exception())


async def _recover_background_jobs_once():
    images, compositions = await asyncio.gather(
        asyncio.to_thread(load_recoverable_image_jobs),
        asyncio.to_thread(load_active_compose_jobs),
    )
    claims = getattr(app.state, "recovery_jobs", None)
    if claims is None:
        claims = app.state.recovery_jobs = set()

    def claimed_task(job_id, coroutine, tasks):
        claims.add(job_id)
        task = asyncio.create_task(coroutine)
        tasks.add(task)
        task.add_done_callback(tasks.discard)
        task.add_done_callback(lambda _: claims.discard(job_id))
        task.add_done_callback(_log_background_exception)

    image_tasks = getattr(app.state, "ai_image_tasks", None)
    if image_tasks is None:
        image_tasks = app.state.ai_image_tasks = set()
    for job in images:
        if len(image_tasks) >= 8:
            break
        if job["id"] not in claims:
            claimed_task(job["id"], execute_image_job(_execute_ai_image_background, job["id"]), image_tasks)
    compose_tasks = getattr(app.state, "compose_recovery_tasks", None)
    if compose_tasks is None:
        compose_tasks = app.state.compose_recovery_tasks = set()
    for job in compositions:
        if len(compose_tasks) >= 2:
            break
        if job.id in claims:
            continue
        if not isinstance(job, ComposeJob) and not job.recovery.get("kind"):
            # Old special/full requests share the same schema. Guessing their
            # kind can export the wrong assets, so require a new explicit request.
            job.status = ComposeStatus.failed
            job.error = "旧任务缺少合成流程信息，无法安全续跑，请重新合成"
            await asyncio.to_thread(save_special_job, job)
            continue
        runner = (_run_and_persist if isinstance(job, ComposeJob) else
                  run_special_full_compose if isinstance(job, SpecialFullComposeJob) else run_special_compose)
        job.recovering = True
        claimed_task(job.id, asyncio.to_thread(runner, job), compose_tasks)


async def _job_recovery_loop():
    # Re-scan while running: an old reload worker may still hold the execution
    # lock during the first startup scan. It must not be skipped forever.
    while True:
        try:
            await _recover_background_jobs_once()
        except Exception:
            logger.exception("background job recovery scan failed")
        await asyncio.sleep(15)


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

_editor_canvas_dist = Path(__file__).parent.parent / "editor-canvas" / "dist"
if not _editor_canvas_dist.exists():
    _editor_canvas_dist = Path(__file__).parent.parent / "editor-lab-kun" / "dist"
if _editor_canvas_dist.exists():
    app.mount(
        "/editor-canvas",
        CacheAwareStaticFiles(directory=str(_editor_canvas_dist), html=True),
        name="editor-canvas",
    )
    # 兼容旧路径
    app.mount(
        "/editor-kun",
        CacheAwareStaticFiles(directory=str(_editor_canvas_dist), html=True),
        name="editor-kun",
    )

# ─── 内存任务存储（PoC 阶段，后续换 Redis / DB）────────────────────────────────
_jobs: dict[str, ComposeJob] = {}
_jobs_lock = threading.Lock()
_psd_jobs: dict[str, dict] = {}
_psd_jobs_lock = threading.Lock()
_SESSION_COOKIE = "designflow_session"
_IMAGE_COPY_FORMATS = {
    "PNG": ("image/png", "png"), "JPEG": ("image/jpeg", "jpg"),
    "WEBP": ("image/webp", "webp"), "GIF": ("image/gif", "gif"),
    "BMP": ("image/bmp", "bmp"), "TIFF": ("image/tiff", "tiff"),
    "AVIF": ("image/avif", "avif"),
}
_AUTH_EXEMPT_PREFIXES = (
    "/auth/session",
    "/auth/login-lite",
    "/auth/options",
    "/health",
    "/product-library",
    "/products/reference-image",
    "/products/mock-image",
    "/avatars",
    "/editor-beta",
    "/editor-canvas",
    "/editor-kun",
    "/ui",
    "/docs",
    "/redoc",
    "/openapi.json",
)
_AUTH_EXEMPT_EXACT_PATHS = {
    "/",
    "/favicon.svg",
    "/favicon.ico",
    "/ai-image/client-event",
    "/ai-image/outpainting/config",
    *(f"/image-copy/original.{extension}" for _, extension in _IMAGE_COPY_FORMATS.values()),
}


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


def _resolve_public_asset_path(
    raw_url: str | None, user: dict | None = None, *, decoded_path: bool = False,
) -> Path:
    """只把站内公开资源 URL 解析成本地文件，避免任意路径/外链读取。"""
    url = str(raw_url or "") if decoded_path else _normalize_public_asset_url(raw_url)
    if decoded_path:
        path = url
    else:
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


def _safe_asset_owner_id(user_id: str) -> str:
    safe = "".join(
        char for char in str(user_id or "").strip()
        if char.isalnum() or char in {"-", "_"}
    )
    return safe or "anonymous"


def _assert_strict_asset_owner(owner_id: str | None, user: dict) -> None:
    if _is_admin(user):
        return
    if not owner_id or owner_id != user.get("id"):
        # Match polling's non-enumerating behavior for another user's assets.
        raise HTTPException(404, "图片文件不存在")


def _outpainting_internal_path(raw_url: str, request: Request, user: dict) -> tuple[Path, str]:
    """Resolve only internal, owner-authorized raster sources for paid outpainting."""
    value = str(raw_url or "").strip()
    if not value:
        raise HTTPException(400, "图片地址不能为空")
    try:
        parsed = urlsplit(value)
    except Exception as exc:
        raise HTTPException(400, "图片地址无效") from exc
    if parsed.scheme or parsed.netloc:
        if parsed.scheme.lower() not in {"http", "https"}:
            raise HTTPException(400, "只支持站内图片地址")
        if parsed.username or parsed.password or parsed.netloc.casefold() != request.url.netloc.casefold():
            raise HTTPException(400, "不允许使用外部图片地址")
        raw_path = parsed.path
    else:
        raw_path = parsed.path or value
    try:
        path = unquote(raw_path)
    except Exception as exc:
        raise HTTPException(400, "图片地址无效") from exc
    if not path.startswith("/") or "\x00" in path or "\\" in path:
        raise HTTPException(400, "图片地址无效")

    compose_match = re.fullmatch(r"/compose/([^/]+)/image/?", path)
    if compose_match:
        candidate = _resolve_public_asset_path(path, user)
        return candidate, path.rstrip("/")

    grid_match = re.fullmatch(r"/export/grid/([^/]+)/(\d+)/?", path)
    if grid_match:
        job_id = grid_match.group(1)
        job = load_job(job_id)
        if not job:
            raise HTTPException(404, "图片文件不存在")
        _assert_strict_asset_owner(job.user_id, user)
        candidate = (settings.output_path / f"{job_id}_grid_{int(grid_match.group(2)):02d}.png").resolve()
        output_root = settings.output_path.resolve()
        if output_root not in candidate.parents or not candidate.is_file():
            raise HTTPException(404, "图片文件不存在")
        return candidate, path.rstrip("/")

    if path.startswith("/ai-images/"):
        rel = path.removeprefix("/ai-images/").lstrip("/")
        parts = Path(rel).parts
        if len(parts) < 2:
            raise HTTPException(400, "图片地址无效")
        owner_id = parts[0]
        expected_owner = _safe_asset_owner_id(str(user.get("id") or ""))
        if not _is_admin(user) and owner_id != expected_owner:
            raise HTTPException(404, "图片文件不存在")
        root = (settings.output_path / "ai-images").resolve()
        owner_root = (root / owner_id).resolve()
        candidate = (root / rel).resolve()
        if owner_root not in candidate.parents or not candidate.is_file():
            raise HTTPException(404, "图片文件不存在")
        return candidate, path

    results_match = re.fullmatch(r"/results/([^/]+)/(.+)", path)
    if results_match:
        job_id = results_match.group(1)
        with _jobs_lock:
            active_job = _jobs.get(job_id)
        owner_id = getattr(active_job, "user_id", None) if active_job else None
        if not owner_id:
            regular_job = load_job(job_id)
            owner_id = regular_job.user_id if regular_job else None
        if not owner_id:
            special_job = load_special_job(job_id)
            owner_id = special_job.get("user_id") if special_job else None
        _assert_strict_asset_owner(owner_id, user)
        root = (settings.output_path / "results").resolve()
        job_root = (root / job_id).resolve()
        rel = path.removeprefix("/results/").lstrip("/")
        candidate = (root / rel).resolve()
        if job_root not in candidate.parents or not candidate.is_file():
            raise HTTPException(404, "图片文件不存在")
        return candidate, path

    output_match = re.fullmatch(r"/output/([^/]+)\.png", path)
    if output_match:
        filename_stem = output_match.group(1)
        grid_name = re.fullmatch(r"(.+)_grid_\d{2}", filename_stem)
        job_id = grid_name.group(1) if grid_name else filename_stem
        job = load_job(job_id)
        if not job:
            raise HTTPException(404, "图片文件不存在")
        _assert_strict_asset_owner(job.user_id, user)
        candidate = (settings.output_path / f"{filename_stem}.png").resolve()
        output_root = settings.output_path.resolve()
        if output_root not in candidate.parents or not candidate.is_file():
            raise HTTPException(404, "图片文件不存在")
        return candidate, path

    psd_match = re.fullmatch(r"/output/psd/([^/]+)/(.+)", path)
    if psd_match:
        owner_id = psd_match.group(1)
        expected_owner = _safe_asset_owner_id(str(user.get("id") or ""))
        if not _is_admin(user) and owner_id != expected_owner:
            raise HTTPException(404, "图片文件不存在")
        root = (settings.output_path / "psd").resolve()
        owner_root = (root / owner_id).resolve()
        rel = path.removeprefix("/output/psd/").lstrip("/")
        candidate = (root / rel).resolve()
        if owner_root not in candidate.parents or not candidate.is_file():
            raise HTTPException(404, "图片文件不存在")
        return candidate, path

    raise HTTPException(400, "仅支持有明确归属的站内图片或图片 data URI")


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


async def _run_matting_background(job_id: str, user: dict, src_path: Path, created_at: float) -> None:
    prompt = "local ai matting background removal"
    out_dir = settings.output_path / "ai-images" / user["id"] / "matting"
    out_path = out_dir / f"{job_id}.png"
    try:
        save_ai_image_job(
            job_id=job_id, user_id=user["id"], status="processing",
            model="local-matting", prompt=prompt, size="",
            provider="local", reference_count=1,
            original_prompt=prompt, resolved_prompt=prompt,
            has_reference=True, progress=15, created_at=created_at,
        )
        width, height = await asyncio.to_thread(matting_service.process_image_file, src_path, out_path)
        image_url = f"/ai-images/{quote(user['id'])}/matting/{quote(out_path.name)}"
        save_ai_image_job(
            job_id=job_id, user_id=user["id"], status="done",
            model="local-matting", prompt=prompt,
            size=f"{width}x{height}" if width and height else "",
            original_prompt=prompt, resolved_prompt=prompt, image_url=image_url,
            has_reference=True, progress=100, created_at=created_at,
        )
        try:
            generate_inspiration_thumb(image_url, user["id"], job_id)
        except Exception:
            pass
        try:
            log_operation(
                user_id=user["id"], username=user.get("username", ""),
                action="ai_image_matting",
                detail=f"job={job_id[:8]} result=done size={width}x{height}",
                payload=json.dumps({"job_id": job_id, "image_url": image_url, "width": width, "height": height}, ensure_ascii=False),
            )
        except Exception:
            logger.exception("matting success operation log failed: job=%s", job_id)
    except Exception as exc:
        logger.exception("[Matting] Matting job failed: %s", exc)
        save_ai_image_job(
            job_id=job_id, user_id=user["id"], status="failed",
            model="local-matting", prompt=prompt, size="",
            original_prompt=prompt, resolved_prompt=prompt,
            has_reference=True, error=str(exc), progress=100, created_at=created_at,
        )
        try:
            log_operation(
                user_id=user["id"], username=user.get("username", ""),
                action="ai_image_matting",
                detail=f"job={job_id[:8]} result=failed",
                payload=json.dumps({"job_id": job_id, "error": str(exc)}, ensure_ascii=False),
            )
        except Exception:
            logger.exception("matting failure operation log failed: job=%s", job_id)


def _outpainting_effective_limits(mode: str | None = None) -> dict[str, int]:
    max_width = min(MAX_OUTPUT_SIDE, max(1, int(settings.outpaint_max_width)))
    max_height = min(MAX_OUTPUT_SIDE, max(1, int(settings.outpaint_max_height)))
    max_area = min(
        MAX_OUTPUT_PIXELS,
        max(1, int(settings.outpaint_max_area_pixels)),
        max_width * max_height,
    )
    return {
        "snap_pixels": 1,
        "max_width": max_width,
        "max_height": max_height,
        "max_area_pixels": max_area,
        "fast_max_area_pixels": min(max_area, FAST_SAFE_OUTPUT_PIXELS),
        "recommended_area_pixels": min(
            max_area,
            max(1, int(settings.outpaint_recommended_area_pixels)),
        ),
        "min_processing_side": (
            MIN_CANVAS_SIDE
            if str(mode or settings.bfl_outpainting_mode or "").strip().casefold() == "fast"
            else 1
        ),
    }


def _outpainting_configuration_error() -> str:
    try:
        api_url = urlsplit(str(settings.bfl_api_url or ""))
    except Exception:
        return "BFL_API_URL 无效"
    path = api_url.path.rstrip("/")
    if (
        api_url.scheme.lower() != "https"
        or (api_url.hostname or "").casefold().rstrip(".") != "api.bfl.ai"
        or path not in {"", "/"}
        or api_url.query
        or api_url.fragment
        or api_url.username
        or api_url.password
    ):
        return "BFL_API_URL 必须为 https://api.bfl.ai"
    if settings.bfl_outpainting_mode not in BFL_ALLOWED_MODES:
        return "BFL_OUTPAINTING_MODE 必须为 fast 或 high"
    if settings.bfl_outpainting_output_format != "PNG":
        return "BFL_OUTPAINTING_OUTPUT_FORMAT 必须为 PNG"
    if settings.bfl_outpainting_auto_crop:
        return "BFL_OUTPAINTING_AUTO_CROP 必须为 false"
    if int(settings.bfl_outpainting_max_concurrency) < 1:
        return "BFL_OUTPAINTING_MAX_CONCURRENCY 必须至少为 1"
    if int(settings.bfl_outpainting_max_queue_size) < 0:
        return "BFL_OUTPAINTING_MAX_QUEUE_SIZE 不能为负数"
    if int(settings.bfl_outpainting_max_pending_per_user) < 1:
        return "BFL_OUTPAINTING_MAX_PENDING_PER_USER 必须至少为 1"
    if int(settings.bfl_outpainting_max_request_bytes) < 1024:
        return "BFL_OUTPAINTING_MAX_REQUEST_BYTES 必须至少为 1024"
    result_host_suffixes = _outpainting_result_host_suffixes()
    if not result_host_suffixes:
        return "BFL_OUTPAINTING_RESULT_HOST_SUFFIXES 不能为空"
    if any(
        suffix != "bfl.ai" and not suffix.endswith(".bfl.ai")
        for suffix in result_host_suffixes
    ):
        return "BFL_OUTPAINTING_RESULT_HOST_SUFFIXES 仅支持 bfl.ai 域名"
    return ""


def _outpainting_result_host_suffixes() -> tuple[str, ...]:
    return tuple(
        value.strip().casefold().lstrip(".")
        for value in str(settings.bfl_outpainting_result_host_suffixes or "").split(",")
        if value.strip().lstrip(".")
    )


_outpainting_submit_lock = threading.Lock()


class _OutpaintingCapacityError(RuntimeError):
    pass


def _outpainting_runtime() -> tuple[asyncio.Semaphore, set[asyncio.Task]]:
    semaphore = getattr(app.state, "outpainting_semaphore", None)
    if semaphore is None:
        semaphore = asyncio.Semaphore(
            max(1, int(settings.bfl_outpainting_max_concurrency or 2))
        )
        app.state.outpainting_semaphore = semaphore
    tasks = getattr(app.state, "outpainting_tasks", None)
    if tasks is None:
        tasks = set()
        app.state.outpainting_tasks = tasks
    return semaphore, tasks


def _outpainting_claims() -> dict[str, str]:
    claims = getattr(app.state, "outpainting_claims", None)
    if claims is None:
        claims = {}
        app.state.outpainting_claims = claims
    return claims


def _release_outpainting_claim(job_id: str) -> None:
    if not job_id:
        return
    with _outpainting_submit_lock:
        _outpainting_claims().pop(job_id, None)


def _track_outpainting_task(
    coroutine,
    *,
    claimed_job_id: str = "",
) -> asyncio.Task:
    _semaphore, tasks = _outpainting_runtime()
    try:
        task = asyncio.create_task(coroutine)
    except Exception:
        _release_outpainting_claim(claimed_job_id)
        raise
    tasks.add(task)

    def _discard(completed: asyncio.Task) -> None:
        tasks.discard(completed)
        _release_outpainting_claim(claimed_job_id)
        if completed.cancelled():
            return
        try:
            error = completed.exception()
        except asyncio.CancelledError:
            return
        if error is not None:
            logger.error(
                "BFL outpainting background task escaped worker handling: %s",
                type(error).__name__,
            )

    task.add_done_callback(_discard)
    return task


async def _save_outpainting_job_with_retries(**values) -> None:
    def persist() -> None:
        last_error: Exception | None = None
        for attempt in range(4):
            try:
                save_ai_image_job(**values)
                return
            except Exception as exc:
                last_error = exc
                if attempt < 3:
                    time.sleep(0.2 * (2**attempt))
        assert last_error is not None
        raise last_error

    await asyncio.to_thread(persist)


def _discard_outpainting_source_snapshot(request_meta: dict | None, user_id: str) -> None:
    discard_prepared_source_snapshot(
        str((request_meta or {}).get("source_snapshot_url") or ""),
        output_root=settings.output_path,
        user_id=str(user_id or ""),
    )


async def _run_outpainting_background(*args, **kwargs):
    job_id = str(args[0] if args else kwargs["job_id"])
    with execution_lock(f"outpainting:{job_id}") as acquired:
        if not acquired:
            return
        stored = load_ai_image_job(job_id)
        if stored:
            if stored["status"] in {"done", "failed"}:
                return
            latest = stored.get("request_meta") or {}
            supplied = args[5] if len(args) > 5 else kwargs.get("request_meta", {})
            if latest.get("phase") != supplied.get("phase"):
                # The old worker advanced between scan and lock acquisition.
                # Re-scan its durable state rather than using a stale submit plan.
                return
        await _execute_outpainting_background(*args, **kwargs)


async def _execute_outpainting_background(
    job_id: str,
    user: dict,
    prepared: PreparedOutpaintingImage | None,
    geometry: OutpaintingGeometry,
    provider_task_id: str,
    request_meta: dict,
    created_at: float,
    *,
    resume_only: bool = False,
    polling_url: str = "",
    acceptance_resume_attempts: int = 1,
    recovery_attempt: int = 1,
) -> None:
    prompt = "FLUX outpainting"
    user_id = str(user.get("id") or "")
    semaphore, _tasks = _outpainting_runtime()
    accepted = {
        "provider_task_id": str(provider_task_id or "").strip(),
        "polling_url": str(polling_url or "").strip(),
    }
    # Resume already has a durable accepted id. A new submit only becomes
    # durable after on_accepted finishes its persistence retries.
    acceptance_persisted = bool(
        resume_only and accepted["provider_task_id"] and accepted["polling_url"]
    )

    def persist_processing(progress: int, phase: str) -> None:
        if accepted["provider_task_id"]:
            request_meta["provider_task_id"] = accepted["provider_task_id"]
            request_meta["provider_task_uuid"] = accepted["provider_task_id"]
        if accepted["polling_url"]:
            request_meta["polling_url"] = accepted["polling_url"]
        progress_meta = {**request_meta, "phase": phase}
        try:
            save_ai_image_job(
                job_id=job_id,
                user_id=user_id,
                status="processing",
                model=BFL_OUTPAINTING_MODEL,
                provider="bfl",
                prompt=prompt,
                original_prompt=prompt,
                resolved_prompt=prompt,
                size=f"{geometry.expected_width}x{geometry.expected_height}",
                resolution="",
                has_reference=True,
                reference_count=1,
                request_meta=progress_meta,
                task_id=accepted["provider_task_id"],
                progress=progress,
                created_at=created_at,
            )
        except Exception:
            # A transient SQLite lock must not abandon an accepted paid task.
            logger.exception(
                "BFL outpainting progress persistence failed: job=%s task=%s phase=%s",
                job_id,
                accepted["provider_task_id"] or "-",
                phase,
            )

    async def on_progress(progress: int, phase: str) -> None:
        await asyncio.to_thread(persist_processing, progress, phase)

    async def on_accepted(task_id: str, poll_url: str) -> None:
        nonlocal acceptance_persisted
        accepted["provider_task_id"] = str(task_id or "").strip()
        accepted["polling_url"] = str(poll_url or "").strip()
        if not accepted["provider_task_id"] or not accepted["polling_url"]:
            raise BflOutpaintingError(
                "扩图服务返回无效响应，请稍后重试",
                diagnostic="accepted callback missing id or polling_url",
            )
        request_meta["provider_task_id"] = accepted["provider_task_id"]
        request_meta["provider_task_uuid"] = accepted["provider_task_id"]
        request_meta["polling_url"] = accepted["polling_url"]
        await _save_outpainting_job_with_retries(
            job_id=job_id,
            user_id=user_id,
            status="processing",
            model=BFL_OUTPAINTING_MODEL,
            provider="bfl",
            prompt=prompt,
            original_prompt=prompt,
            resolved_prompt=prompt,
            size=f"{geometry.expected_width}x{geometry.expected_height}",
            resolution="",
            has_reference=True,
            reference_count=1,
            request_meta={**request_meta, "phase": "polling"},
            task_id=accepted["provider_task_id"],
            progress=15,
            created_at=created_at,
        )
        acceptance_persisted = True

    result = None
    submission_attempted = False
    try:
        persist_processing(5 if not resume_only else 20, "queued" if not resume_only else "recovering")
        async with semaphore:
            persist_processing(10 if not resume_only else 25, "submitting" if not resume_only else "recovering")
            submission_attempted = True
            result = await run_outpainting(
                api_key=settings.bfl_api_key,
                api_url=settings.bfl_api_url,
                proxy_url=settings.bfl_outpainting_proxy_url,
                mode=request_meta.get("mode", settings.bfl_outpainting_mode),
                output_format=settings.bfl_outpainting_output_format,
                auto_crop=settings.bfl_outpainting_auto_crop,
                result_host_suffixes=_outpainting_result_host_suffixes(),
                prepared=prepared,
                geometry=geometry,
                provider_task_id=accepted["provider_task_id"],
                polling_url=accepted["polling_url"],
                result_url=str(request_meta.get("provider_result_url") or ""),
                result_cost=request_meta.get("cost"),
                output_root=settings.output_path,
                user_id=user_id,
                job_id=job_id,
                timeout_seconds=max(1.0, float(settings.bfl_outpainting_timeout_seconds)),
                poll_interval_seconds=max(0.1, float(settings.bfl_outpainting_poll_interval_seconds)),
                transient_retry_count=max(0, int(settings.bfl_outpainting_transient_retries)),
                retry_backoff_seconds=max(0.0, float(settings.bfl_outpainting_retry_backoff_seconds)),
                retry_backoff_cap_seconds=max(0.1, float(settings.bfl_outpainting_retry_backoff_cap_seconds)),
                max_result_bytes=max(1, int(settings.bfl_outpainting_max_result_bytes)),
                result_download_retry_count=max(0, int(settings.bfl_outpainting_result_download_retries)),
                submit_request=not resume_only,
                on_progress=on_progress,
                on_accepted=on_accepted,
            )
            if result.provider_task_id:
                accepted["provider_task_id"] = result.provider_task_id
                request_meta["provider_task_id"] = result.provider_task_id
                request_meta["provider_task_uuid"] = result.provider_task_id
            if result.polling_url:
                accepted["polling_url"] = result.polling_url
                request_meta["polling_url"] = result.polling_url
        final_meta = {
            **request_meta,
            "phase": "done",
            "output_url": result.image_url,
            "cost": result.cost,
            "actual_width": result.width,
            "actual_height": result.height,
            "retry_action": "none",
            "retryable": False,
        }
        await _save_outpainting_job_with_retries(
            job_id=job_id,
            user_id=user_id,
            status="done",
            model=BFL_OUTPAINTING_MODEL,
            provider="bfl",
            prompt=prompt,
            original_prompt=prompt,
            resolved_prompt=prompt,
            size=f"{result.width}x{result.height}",
            resolution="",
            image_url=result.image_url,
            has_reference=True,
            reference_count=1,
            request_meta=final_meta,
            task_id=accepted["provider_task_id"],
            progress=100,
            created_at=created_at,
        )
        _discard_outpainting_source_snapshot(request_meta, user_id)
        try:
            generate_inspiration_thumb(result.image_url, user_id, job_id)
        except Exception:
            logger.exception("BFL outpainting thumbnail failed: job=%s", job_id)
        try:
            task_label = (accepted["provider_task_id"] or "-")[:8]
            log_operation(
                user_id=user_id,
                username=str(user.get("username") or ""),
                action="ai_image_outpainting",
                detail=(
                    f"job={job_id[:8]} task={task_label} result=done "
                    f"size={result.width}x{result.height}"
                ),
                payload=json.dumps(
                    {
                        "job_id": job_id,
                        "provider_task_id": accepted["provider_task_id"],
                        "image_url": result.image_url,
                        "width": result.width,
                        "height": result.height,
                        "cost": result.cost,
                    },
                    ensure_ascii=False,
                ),
            )
        except Exception:
            logger.exception("BFL outpainting success operation log failed: job=%s", job_id)
    except asyncio.CancelledError:
        # Waiting on the semaphore (or cancelled before run_outpainting) never
        # reached BFL. Keep a pre-submit phase so restart resubmits.
        interrupt_phase = "interrupted" if (resume_only or submission_attempted) else "queued"
        interrupted_meta = {**request_meta, "phase": interrupt_phase}
        try:
            await _save_outpainting_job_with_retries(
                job_id=job_id,
                user_id=user_id,
                status="processing",
                model=BFL_OUTPAINTING_MODEL,
                provider="bfl",
                prompt=prompt,
                original_prompt=prompt,
                resolved_prompt=prompt,
                size=f"{geometry.expected_width}x{geometry.expected_height}",
                resolution="",
                has_reference=True,
                reference_count=1,
                request_meta=interrupted_meta,
                task_id=accepted["provider_task_id"],
                progress=20 if resume_only else 10,
                created_at=created_at,
            )
        except Exception:
            logger.exception("BFL outpainting interruption persistence failed: job=%s", job_id)
        raise
    except Exception as exc:
        if result is not None:
            logger.error(
                "BFL outpainting result saved but final persistence failed: job=%s task=%s error=%s",
                job_id,
                accepted["provider_task_id"] or "-",
                type(exc).__name__,
            )
            return
        if (
            accepted["provider_task_id"]
            and accepted["polling_url"]
            and not acceptance_persisted
        ):
            # BFL already accepted (and billed) this task, but the local
            # acceptance row never became durable. Keep a recoverable
            # processing/interrupted job and the source snapshot.
            logger.warning(
                "BFL outpainting accepted but local persistence failed; "
                "keeping recoverable processing job: job=%s task=%s error=%s",
                job_id,
                accepted["provider_task_id"],
                type(exc).__name__,
            )
            interrupted_meta = {**request_meta, "phase": "interrupted"}
            try:
                await _save_outpainting_job_with_retries(
                    job_id=job_id,
                    user_id=user_id,
                    status="processing",
                    model=BFL_OUTPAINTING_MODEL,
                    provider="bfl",
                    prompt=prompt,
                    original_prompt=prompt,
                    resolved_prompt=prompt,
                    size=f"{geometry.expected_width}x{geometry.expected_height}",
                    resolution="",
                    has_reference=True,
                    reference_count=1,
                    request_meta=interrupted_meta,
                    task_id=accepted["provider_task_id"],
                    progress=20,
                    created_at=created_at,
                )
            except Exception:
                logger.exception(
                    "BFL outpainting accepted-id recovery persistence failed: job=%s",
                    job_id,
                )
                return
            if acceptance_resume_attempts <= 0:
                return
            logger.warning(
                "BFL outpainting resuming poll after accepted-id persistence failure: "
                "job=%s task=%s remaining=%s",
                job_id,
                accepted["provider_task_id"],
                acceptance_resume_attempts,
            )
            await _execute_outpainting_background(
                job_id,
                user,
                None,
                geometry,
                accepted["provider_task_id"],
                request_meta,
                created_at,
                resume_only=True,
                polling_url=accepted["polling_url"],
                acceptance_resume_attempts=acceptance_resume_attempts - 1,
                recovery_attempt=recovery_attempt,
            )
            return
        retry_action = exc.retry_action if isinstance(exc, BflOutpaintingError) else "none"
        can_resume = bool(
            accepted["provider_task_id"]
            and accepted["polling_url"]
            and retry_action in {"poll", "download"}
        )
        if can_resume:
            if exc.result_url:
                request_meta["provider_result_url"] = exc.result_url
                request_meta["cost"] = exc.cost
            request_meta.update({
                "retry_action": retry_action,
                # Old clients must never interpret recovery as permission to regenerate.
                "retryable": False,
                "recovery_attempt": recovery_attempt,
            })
        if can_resume and recovery_attempt < 3:
            request_meta = {
                **request_meta,
                "phase": f"{retry_action}_retry",
                "recovery_attempt": recovery_attempt + 1,
            }
            try:
                await _save_outpainting_job_with_retries(
                    job_id=job_id,
                    user_id=user_id,
                    status="processing",
                    model=BFL_OUTPAINTING_MODEL,
                    provider="bfl",
                    prompt=prompt,
                    original_prompt=prompt,
                    resolved_prompt=prompt,
                    size=f"{geometry.expected_width}x{geometry.expected_height}",
                    resolution="",
                    has_reference=True,
                    reference_count=1,
                    request_meta=request_meta,
                    task_id=accepted["provider_task_id"],
                    progress=75,
                    created_at=created_at,
                )
            except Exception:
                logger.exception(
                    "BFL outpainting recovery persistence failed: job=%s task=%s",
                    job_id,
                    accepted["provider_task_id"],
                )
                return
            logger.warning(
                "BFL outpainting recovering accepted task: job=%s task=%s action=%s attempt=%s/3",
                job_id,
                accepted["provider_task_id"],
                retry_action,
                recovery_attempt + 1,
            )
            await asyncio.sleep(recovery_attempt)
            await _execute_outpainting_background(
                job_id, user, None, geometry, accepted["provider_task_id"],
                request_meta, created_at, resume_only=True,
                polling_url=accepted["polling_url"],
                acceptance_resume_attempts=acceptance_resume_attempts,
                recovery_attempt=recovery_attempt + 1,
            )
            return
        if isinstance(exc, BflOutpaintingError):
            public_error = exc.public_message
            diagnostic = exc.diagnostic or type(exc).__name__
        else:
            public_error = "扩图服务处理失败，请稍后重试"
            diagnostic = type(exc).__name__
        if can_resume and recovery_attempt >= 3:
            public_error = f"原扩图任务已尝试恢复 3 次仍未成功：{public_error}"
        logger.error(
            "BFL outpainting failed: job=%s task=%s error=%s diagnostic=%s",
            job_id,
            accepted["provider_task_id"] or "-",
            type(exc).__name__,
            str(diagnostic)[:500],
        )
        failed_meta = {
            **request_meta,
            "phase": "failed",
            "retry_action": retry_action,
            "retryable": False,
        }
        try:
            await _save_outpainting_job_with_retries(
                job_id=job_id,
                user_id=user_id,
                status="failed",
                model=BFL_OUTPAINTING_MODEL,
                provider="bfl",
                prompt=prompt,
                original_prompt=prompt,
                resolved_prompt=prompt,
                size=f"{geometry.expected_width}x{geometry.expected_height}",
                resolution="",
                has_reference=True,
                reference_count=1,
                request_meta=failed_meta,
                task_id=accepted["provider_task_id"],
                error=public_error,
                progress=100,
                created_at=created_at,
            )
            if not can_resume and retry_action != "submission_unknown":
                _discard_outpainting_source_snapshot(request_meta, user_id)
        except Exception:
            logger.exception("BFL outpainting failure persistence failed: job=%s", job_id)
        try:
            task_label = (accepted["provider_task_id"] or "-")[:8]
            log_operation(
                user_id=user_id,
                username=str(user.get("username") or ""),
                action="ai_image_outpainting",
                detail=f"job={job_id[:8]} task={task_label} result=failed",
                payload=json.dumps(
                    {
                        "job_id": job_id,
                        "provider_task_id": accepted["provider_task_id"],
                        "error": public_error,
                    },
                    ensure_ascii=False,
                ),
            )
        except Exception:
            logger.exception("BFL outpainting failure operation log failed: job=%s", job_id)


async def _outpainting_recovery_loop():
    while True:
        try:
            await _recover_outpainting_jobs()
        except Exception:
            logger.exception("outpainting recovery scan failed")
        await asyncio.sleep(15)


async def _recover_outpainting_jobs() -> None:
    try:
        jobs = await asyncio.to_thread(load_active_outpainting_jobs)
    except Exception:
        logger.exception("BFL outpainting recovery scan failed")
        return
    if not jobs:
        return

    logger.warning("BFL outpainting recovery found %s unfinished job(s)", len(jobs))
    recoveries: list[
        tuple[dict, OutpaintingGeometry, str, dict, PreparedOutpaintingImage | None, bool, str]
    ] = []
    for stored_job in jobs:
        job_id = str(stored_job.get("id") or "")
        with execution_lock(f"outpainting:{job_id}") as available:
            if not available:
                continue
            meta = stored_job.get("request_meta")
            try:
                if not job_id or not isinstance(meta, dict):
                    raise OutpaintingValidationError("恢复元数据缺失")
                provider_task_id = str(
                    stored_job.get("task_id")
                    or meta.get("provider_task_id")
                    or meta.get("provider_task_uuid")
                    or ""
                ).strip()
                polling_url = str(meta.get("polling_url") or "").strip()
                geometry = resolve_geometry_from_meta(
                    meta,
                    max_width=MAX_OUTPUT_SIDE,
                    max_height=MAX_OUTPUT_SIDE,
                    max_pixels=MAX_OUTPUT_PIXELS,
                )
                expected_fields = {
                    "expected_width": geometry.expected_width,
                    "expected_height": geometry.expected_height,
                }
                if any(
                    isinstance(meta.get(name), bool)
                    or not isinstance(meta.get(name), int)
                    or meta.get(name) != expected
                    for name, expected in expected_fields.items()
                ):
                    raise OutpaintingValidationError("恢复尺寸不一致")
                resume_only = not is_pre_submit_phase(meta.get("phase"))
                prepared = None
                if resume_only:
                    if not polling_url:
                        raise OutpaintingValidationError("恢复轮询地址缺失")
                else:
                    # Queued jobs never reached BFL; rebuild the prepared image and
                    # submit a new provider task. Later phases poll the accepted id.
                    prepared = load_prepared_source_snapshot(
                        str(meta.get("source_snapshot_url") or ""),
                        output_root=settings.output_path,
                        user_id=str(stored_job.get("user_id") or ""),
                        meta=meta,
                    )
                recoveries.append(
                    (stored_job, geometry, provider_task_id, dict(meta), prepared, resume_only, polling_url)
                )
            except Exception as exc:
                logger.error(
                    "BFL outpainting recovery metadata rejected: job=%s error=%s",
                    job_id or "-",
                    type(exc).__name__,
                )
                if not job_id:
                    continue
                failed_meta = dict(meta) if isinstance(meta, dict) else {"operation": "outpainting"}
                failed_meta["phase"] = "failed"
                try:
                    await _save_outpainting_job_with_retries(
                        job_id=job_id,
                        user_id=str(stored_job.get("user_id") or ""),
                        status="failed",
                        model=BFL_OUTPAINTING_MODEL,
                        provider="bfl",
                        prompt=str(stored_job.get("prompt") or "FLUX outpainting"),
                        original_prompt=str(stored_job.get("original_prompt") or "FLUX outpainting"),
                        resolved_prompt=str(stored_job.get("resolved_prompt") or "FLUX outpainting"),
                        size=str(stored_job.get("size") or ""),
                        resolution=str(stored_job.get("resolution") or ""),
                        has_reference=True,
                        reference_count=1,
                        request_meta=failed_meta,
                        task_id=str(stored_job.get("task_id") or ""),
                        error="扩图任务恢复信息无效，请重新扩图",
                        progress=100,
                        created_at=float(stored_job.get("created_at") or time.time()),
                    )
                    _discard_outpainting_source_snapshot(
                        meta if isinstance(meta, dict) else None,
                        str(stored_job.get("user_id") or ""),
                    )
                except Exception:
                    logger.exception("BFL outpainting invalid recovery persistence failed: job=%s", job_id)

    concurrency = max(1, int(settings.bfl_outpainting_max_concurrency or 2))
    for offset in range(0, len(recoveries), concurrency):
        batch = recoveries[offset:offset + concurrency]
        await asyncio.gather(
            *(
                _run_outpainting_background(
                    str(job.get("id")),
                    {"id": str(job.get("user_id") or ""), "username": ""},
                    prepared,
                    geometry,
                    provider_task_id,
                    meta,
                    float(job.get("created_at") or time.time()),
                    resume_only=resume_only,
                    polling_url=polling_url,
                )
                for job, geometry, provider_task_id, meta, prepared, resume_only, polling_url in batch
            ),
            return_exceptions=True,
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
            int(getattr(settings, "layer_extract_timeout_seconds", 900)) + 45,
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
        task_id = payload.get("task_id") or payload.get("kie_task_id")
        if task_id:
            detail = f"{detail} task_id={task_id}"
        raise RuntimeError(detail or f"layer-extract 子进程退出码 {proc.returncode}")
    return payload


async def _run_layer_extract_background(job_id: str, user: dict, src_path: Path, created_at: float) -> None:
    provider = getattr(settings, "layer_extract_provider", "apimart")
    model_name = getattr(settings, "layer_extract_model", "seedream-5-0-pro")
    prompt = "Seedream 5.0 Pro 图层分离并导出 PSD"
    out_dir = settings.output_path / "ai-images" / user["id"] / "layer-extract" / job_id
    try:
        save_ai_image_job(
            job_id=job_id, user_id=user["id"], status="processing",
            model="layer-extract", prompt=prompt, size="",
            provider=provider,
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
        task_id = payload.get("task_id") or payload.get("kie_task_id", "")
        # 先完整组装 prompt_trace，再一次性写入 done，避免前端轮询读到
        # done 但 layer_extract 尚未准备好的中间状态。
        extra = {
            "psd_url": psd_url,
            "manifest_url": manifest_url,
            "layers_url_prefix": layers_url_prefix,
            "background_status": payload.get("background_status", ""),
            "decomposition_provider": payload.get("decomposition_provider", provider),
            "task_id": task_id,
            "kie_task_id": task_id,
            "model": model_name,
            "kie_model": model_name,
            "result_layers": payload.get("result_layers") or payload.get("kie_layers", []),
            "kie_layers": payload.get("kie_layers", []),
            "layers": payload.get("layers", []),
            "source_size": payload.get("source_size", []),
        }
        save_ai_image_job(
            job_id=job_id, user_id=user["id"], status="done",
            model="layer-extract", prompt=prompt,
            size=f"{payload['source_size'][0]}x{payload['source_size'][1]}",
            provider=provider,
            original_prompt=prompt, resolved_prompt=prompt,
            image_url=psd_url, prompt_trace=json.dumps(extra, ensure_ascii=False),
            task_id=task_id or None,
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
            provider=provider,
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

    # 兼容新版无限画布格式
    if isinstance(snapshot.get("images"), list):
        for im in snapshot["images"]:
            if isinstance(im, dict):
                for key in ("url", "src"):
                    val = im.get(key)
                    if isinstance(val, str) and val.strip():
                        normalized = _normalize_public_asset_url(val)
                        if normalized and normalized != val:
                            im[key] = normalized
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


def _outpainting_asset_owner(path: str) -> str | None:
    try:
        decoded = unquote(path).replace("\\", "/")
    except Exception:
        return None
    parts = [part for part in decoded.split("/") if part]
    if len(parts) < 3 or parts[0] != "ai-images":
        return None
    if not any(part.startswith("outpainting_") for part in parts[2:]):
        return None
    return parts[1]


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
    outpainting_owner = _outpainting_asset_owner(path)
    if (
        outpainting_owner
        and request.state.user is not None
        and not _is_admin(request.state.user)
        and str(request.state.user.get("id") or "") != outpainting_owner
    ):
        return JSONResponse({"detail": "图片不存在"}, status_code=404)
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


class ImageCopyLinkRequest(pydantic.BaseModel):
    src: str = pydantic.Field(min_length=1, max_length=8192)


def _image_copy_media_type(path: Path) -> str:
    from PIL import Image, UnidentifiedImageError

    # Never expose HTML, SVG, database files or arbitrary downloads through a capability.
    try:
        with Image.open(path) as image:
            image_format = _IMAGE_COPY_FORMATS.get(image.format)
    except (OSError, UnidentifiedImageError, Image.DecompressionBombError) as exc:
        raise HTTPException(400, "仅支持原始图片文件") from exc
    if not image_format:
        raise HTTPException(400, "仅支持原始图片文件")
    return image_format[0]


@app.post("/image-copy/link")
def image_copy_link(body: ImageCopyLinkRequest, request: Request):
    user = _current_user(request)
    try:
        parsed = urlsplit(body.src.strip())
        if parsed.scheme or parsed.netloc:
            if (
                parsed.scheme.lower() not in {"http", "https"}
                or parsed.username or parsed.password
                or parsed.netloc.casefold() != request.url.netloc.casefold()
            ):
                raise ValueError("external image")
        path = unquote(parsed.path)
    except ValueError as exc:
        raise HTTPException(400, "仅支持站内图片地址") from exc
    if not path.startswith("/") or path.startswith("//") or "\\" in path or "\x00" in path:
        raise HTTPException(400, "图片地址无效")
    candidate = _resolve_public_asset_path(path, user, decoded_path=True)
    # Check the resolved file so aliases and dot segments cannot bypass outpainting isolation.
    ai_root = (settings.output_path / "ai-images").resolve()
    if ai_root in candidate.parents:
        parts = candidate.relative_to(ai_root).parts
        if len(parts) >= 2 and any(part.startswith("outpainting_") for part in parts[1:]):
            _assert_strict_asset_owner(parts[0], user)
    media_type = _image_copy_media_type(candidate)
    extension = next(ext for mime, ext in _IMAGE_COPY_FORMATS.values() if mime == media_type)
    token, expires_at = create_image_copy_link(path)
    return JSONResponse(
        {"url": f"/image-copy/original.{extension}?token={token}", "expires_at": expires_at},
        headers={"Cache-Control": "no-store"},
    )


@app.api_route("/image-copy/original.{extension}", methods=["GET", "HEAD"])
def image_copy_file(extension: str, token: str = ""):
    path = get_image_copy_asset(token)
    if not path:
        raise HTTPException(404, "图片链接无效或已过期，请重新打开原图")
    # Resolve again so a changed symlink cannot escape the resource directory.
    candidate = _resolve_public_asset_path(path, decoded_path=True)
    media_type = _image_copy_media_type(candidate)
    if (media_type, extension) not in _IMAGE_COPY_FORMATS.values():
        raise HTTPException(404, "图片链接无效")
    return FileResponse(
        candidate, media_type=media_type, filename=candidate.name,
        content_disposition_type="inline",
        headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff"},
    )


@app.api_route("/favicon.svg", methods=["GET", "HEAD"], include_in_schema=False)
async def site_favicon():
    return FileResponse(
        _frontend_dist / "favicon.svg",
        media_type="image/svg+xml",
        headers={"Cache-Control": "no-cache, must-revalidate"},
    )


@app.api_route("/favicon.ico", methods=["GET", "HEAD"], include_in_schema=False)
async def default_site_favicon():
    # 浏览器直接打开图片等文件时，会从站点根目录请求默认图标。
    return RedirectResponse("/favicon.svg", headers={"Cache-Control": "no-cache, must-revalidate"})


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
    # UNC filesystem checks can block for seconds when the library is offline.
    # Keep them off the event loop so session heartbeats and task polls can run.
    return await asyncio.to_thread(_local_health_payload)


@app.get("/health/deep")
async def health_deep():
    local_health = await asyncio.to_thread(_local_health_payload)
    # Penpot is a local/LAN dependency and must never be sent through the
    # optional AI API proxy. Keep a separate client so a proxy failure cannot
    # make a working Penpot instance appear offline in the service dashboard.
    penpot_client_kwargs: dict[str, Any] = {"timeout": 3, "trust_env": False}
    client_kwargs: dict[str, Any] = {"timeout": 3, "trust_env": False}
    if settings.ai_image_api_proxy_url:
        client_kwargs["proxy"] = settings.ai_image_api_proxy_url
    async with (
        httpx.AsyncClient(**penpot_client_kwargs) as penpot_client,
        httpx.AsyncClient(**client_kwargs) as client,
    ):
        penpot_ok, ai_provider, adobe_provider = await asyncio.gather(
            _probe_penpot(penpot_client),
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

    TEMPLATE_MARKERS = ("模板", "测试")
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
                matched = any(m in (pname or "") for m in TEMPLATE_MARKERS)
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
    3. 只扫 project 名含「模板」或「测试」的 project 下的所有文件
    4. 二级过滤：文件名也必须包含「模板」或「测试」
    5. 每个文件里的每个 Board（frame）作为一个独立模板条目

    团队协作约定：在 Penpot 里新建一个 project，命名包含「模板」或「测试」
    （如「测试模板」「电商模板库」），把模板文件放进去即可被自动识别。
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
    TEMPLATE_MARKERS = ("模板", "测试")
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
                # 项目层过滤：排除系统 Drafts 草稿箱，且项目名必须包含「模板」或「测试」
                if not pid or (pname or "").strip().lower() == "drafts":
                    continue
                if not any(m in (pname or "") for m in TEMPLATE_MARKERS):
                    continue
                try:
                    proj_files = client.get_project_files(pid)
                    for pf in proj_files:
                        pf_id = pf.get("id") or pf.get("~:id", "")
                        pf_name = pf.get("name") or pf.get("~:name", "")
                        # 二级过滤：文件名必须含「模板」或「测试」才认定为模板文件
                        # 避免合成时产生的副本（如 ABAW003_特殊品、新建文件等）被误识别
                        if pf_id and any(m in (pf_name or "") for m in TEMPLATE_MARKERS):
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

    TEMPLATE_MARKERS = ("模板", "测试")
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
                is_drafts = (pname or "").strip().lower() == "drafts"
                has_marker = (not is_drafts) and any(m in (pname or "") for m in TEMPLATE_MARKERS)
                proj_entry = {"id": pid, "name": pname, "has_marker": has_marker, "files": []}
                try:
                    proj_files = client.get_project_files(pid)
                    for pf in proj_files:
                        pf_id = pf.get("id") or pf.get("~:id", "")
                        pf_name = pf.get("name") or pf.get("~:name", "")
                        file_has_marker = any(m in (pf_name or "") for m in TEMPLATE_MARKERS)
                        proj_entry["files"].append({"id": pf_id, "name": pf_name, "file_has_marker": file_has_marker})
                        if has_marker and file_has_marker:
                            fd = client.get_file(pf_id)
                            frames = client.parse_frames(fd)
                            fname = fd.get("name") or fd.get("~:name") or ""
                            fname_target = pf_name or fname
                            result["template_files"].append({
                                "file_id": pf_id,
                                "file_name": pf_name,
                                "penpot_name": fname,
                                "is_special": "特殊品" in fname_target and "完整" not in fname_target,
                                "is_special_full": "特殊品" in fname_target and "完整" in fname_target,
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
    """The worker persists state while holding its execution lock."""
    run_compose(job)


@app.get("/compose/{job_id}", response_model=ComposeJob)
def get_compose(job_id: str, request: Request):
    """查询合成任务状态和进度（内存优先，内存没有则查 SQLite）"""
    user = _current_user(request)
    with _jobs_lock:
        job = _jobs.get(job_id)
    job = load_job(job_id) or job
    if not job:
        raise HTTPException(404, f"任务不存在: {job_id}")
    _assert_job_owner(job.user_id, user)
    return job.model_copy(update={"recovering": bool(job.recovery.get("resuming")) and job.status not in {ComposeStatus.done, ComposeStatus.failed}})


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
    save_special_job(job)
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


@app.get("/special-compose/detect")
def detect_special_materials_endpoint(sku: str, request: Request):
    """
    检测指定 SKU 是否在素材库中包含场景图素材（Banner/Poster）。
    只做 exists 路径探测，响应在毫秒级。
    必须写在 /{job_id} 前面，避免 "detect" 被误当成 job_id 路由。
    """
    _current_user(request)
    return detect_special_materials(sku)


@app.get("/special-compose/{job_id}", response_model=SpecialComposeJob)
def get_special_compose(job_id: str, request: Request):
    """查询特殊品合成任务状态"""
    user = _current_user(request)
    with _jobs_lock:
        job = _jobs.get(job_id)
    job = load_special_job_model(job_id, legacy_kind="special") or job
    if not job:
        raise HTTPException(404, f"任务不存在: {job_id}")
    if not isinstance(job, SpecialComposeJob):
        raise HTTPException(400, "该任务不是特殊品合成任务")
    _assert_job_owner(job.user_id, user)
    return job.model_copy(update={"result_images": _special_canvas_images(job), "recovering": bool(job.recovery.get("resuming")) and job.status not in {ComposeStatus.done, ComposeStatus.failed}})


@app.get("/special-compose/{job_id}/images")
def download_special_images(job_id: str, request: Request):
    """返回特殊品合成所有输出图片的 URL 列表"""
    user = _current_user(request)
    with _jobs_lock:
        job = _jobs.get(job_id)
    job = load_special_job_model(job_id, legacy_kind="special") or job
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


_SPECIAL_PNG_FRAME_NAMES = {
    "分类页",
    "尖货轮播-pc-1",
    "尖货轮播-pc-2",
    "尖货轮播-横版-1",
    "尖货轮播-横版-2",
    "sku",
    "sku-1",
    "首页sku",
    "首页sku-1",
    "首页 sku",
    "首页 sku-1",
    "首页[sku]",
    "首页[sku]-1",
}


def _special_export_filename(frame_name: str, sku: str, variant_label: str, export_format: str) -> str:
    real_name = re.sub(r"sku", lambda _match: sku, (frame_name or "画板").strip(), flags=re.IGNORECASE)
    safe_name = _safe_download_filename(real_name)
    return f"{safe_name}{variant_label}.{export_format}"


def _special_export_image(path: Path, frame_name: str) -> tuple[str, bytes]:
    try:
        return prepare_special_export_image(
            path, force_png=frame_name.casefold() in _SPECIAL_PNG_FRAME_NAMES,
        )
    except SpecialExportSizeError as exc:
        raise HTTPException(422, f"{frame_name}：{exc}") from exc


def _special_frame_labels(job, frame_file: str) -> tuple[int, str, str]:
    match = re.fullmatch(r"frame_(\d+)(?:_v(\d+))?\.png", frame_file)
    if not match:
        raise HTTPException(404, "图片不存在")
    index = int(match.group(1))
    names = job.result_frame_names
    frame_name = names[index] if index < len(names) else f"画板{index + 1}"
    variant_label = f"_版本{match.group(2)}" if match.group(2) else ""
    return index, frame_name, variant_label


def _special_canvas_images(job) -> list[SpecialResultImage]:
    if job.status != ComposeStatus.done:
        return []
    endpoint = "/special-compose-full" if isinstance(job, SpecialFullComposeJob) else "/special-compose"
    paths = job.result_paths or [f"frame_{i}.png" for i in range(len(job.result_frame_ids))]
    images = []
    for raw_path in paths:
        frame_file = str(raw_path).replace("\\", "/").rsplit("/", 1)[-1]
        index, frame_name, variant_label = _special_frame_labels(job, frame_file)
        sku = job.request.sku or job.id[:8]
        images.append(SpecialResultImage(
            url=f"/results/{quote(job.id)}/{quote(frame_file)}",
            name=_special_export_filename(frame_name, sku, variant_label, "png")[:-4],
            download_url=f"{endpoint}/{quote(job.id)}/download-image/{quote(frame_file)}",
            frame_index=index,
        ))
    return images


@app.get("/special-compose/{job_id}/download-image/{frame_file}")
@app.get("/special-compose-full/{job_id}/download-image/{frame_file}")
def download_special_image(job_id: str, frame_file: str, request: Request):
    user = _current_user(request)
    with _jobs_lock:
        job = _jobs.get(job_id)
    expected_type = SpecialFullComposeJob if request.url.path.startswith("/special-compose-full/") else SpecialComposeJob
    legacy_kind = "special-full" if expected_type is SpecialFullComposeJob else "special"
    job = load_special_job_model(job_id, legacy_kind=legacy_kind) or job
    if not isinstance(job, expected_type):
        raise HTTPException(404, "任务不存在")
    _assert_job_owner(job.user_id, user)
    if job.status != ComposeStatus.done:
        raise HTTPException(400, "任务尚未完成")
    _, frame_name, variant_label = _special_frame_labels(job, frame_file)
    root = (settings.output_path / "results" / job_id).resolve()
    path = (root / frame_file).resolve()
    if root not in path.parents or not path.is_file():
        raise HTTPException(404, "图片不存在")
    export_format, image_bytes = _special_export_image(path, frame_name)
    filename = _special_export_filename(frame_name, job.request.sku or job_id[:8], variant_label, export_format)
    return Response(
        content=image_bytes, media_type="image/png" if export_format == "png" else "image/jpeg",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}", "Cache-Control": "no-store"},
    )


@app.get("/special-compose/{job_id}/download-zip")
def download_special_zip(job_id: str, names: str = ""):
    """
    将特殊品合成所有图片打包成 zip 下载。
    新任务使用合成时从模板读取并保存的真实画板名；其中 sku 占位符替换为真实 SKU。
    names 仅用于兼容尚未保存画板名的旧任务。
    """
    import zipfile, io

    with _jobs_lock:
        job = _jobs.get(job_id)
    job = load_special_job_model(job_id, legacy_kind="special") or job
    if not job or not isinstance(job, SpecialComposeJob):
        raise HTTPException(404, f"任务不存在: {job_id}")
    if job.status != ComposeStatus.done:
        raise HTTPException(400, f"任务尚未完成: {job.status}")

    sku = job.request.sku or job_id[:8]
    name_list = list(getattr(job, "result_frame_names", []) or [])
    if not name_list and names:
        name_list = [n.strip() for n in names.split(",")]
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
            export_format, image_bytes = _special_export_image(p, frame_label)
            zip_name = _special_export_filename(frame_label, sku, label_suffix, export_format)
            zf.writestr(zip_name, image_bytes)

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
    save_special_job(job)
    background_tasks.add_task(run_special_full_compose, job)
    return job


@app.get("/special-compose-full/{job_id}", response_model=SpecialFullComposeJob)
def get_special_full_compose(job_id: str, request: Request):
    """查询特殊品（完整）合成任务状态"""
    user = _current_user(request)
    with _jobs_lock:
        job = _jobs.get(job_id)
    job = load_special_job_model(job_id, legacy_kind="special-full") or job
    if not job:
        raise HTTPException(404, f"任务不存在: {job_id}")
    if not isinstance(job, SpecialFullComposeJob):
        raise HTTPException(400, "该任务不是特殊品（完整）合成任务")
    _assert_job_owner(job.user_id, user)
    return job.model_copy(update={"result_images": _special_canvas_images(job), "recovering": bool(job.recovery.get("resuming")) and job.status not in {ComposeStatus.done, ComposeStatus.failed}})


@app.get("/special-compose-full/{job_id}/download-zip")
def download_special_full_zip(job_id: str, names: str = "", request: Request = None):
    """将特殊品（完整）合成所有图片打包成 zip 下载，命名规则与 /special-compose 一致。"""
    import zipfile, io, re as _re

    user = _current_user(request)
    with _jobs_lock:
        job = _jobs.get(job_id)
    job = load_special_job_model(job_id, legacy_kind="special-full") or job
    if not job or not isinstance(job, SpecialFullComposeJob):
        raise HTTPException(404, f"任务不存在: {job_id}")
    _assert_job_owner(job.user_id, user)
    if job.status != ComposeStatus.done:
        raise HTTPException(400, f"任务尚未完成: {job.status}")

    sku = job.request.sku or job_id[:8]
    name_list = list(getattr(job, "result_frame_names", []) or [])
    if not name_list and names:
        name_list = [n.strip() for n in names.split(",")]
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
            export_format, image_bytes = _special_export_image(p, frame_label)
            zip_name = _special_export_filename(frame_label, sku, label_suffix, export_format)
            zf.writestr(zip_name, image_bytes)

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


@app.get("/products/search-sku")
def search_product_sku(sku: str):
    """
    查询货号在素材库中各类型子目录的匹配情况。
    支持多个 SKU，以中英文逗号、换行或空格分割。
    返回每个 SKU 的各类匹配资源，以及全局最优 URL。
    """
    raw_input = (sku or "").strip()
    if not raw_input:
        raise HTTPException(400, "SKU 不能为空")

    # 分割多个 SKU（支持中英文逗号、换行、空格）
    raw_skus = [s.strip() for s in re.split(r'[,，\s\n\r]+', raw_input) if s.strip()]
    # 保留顺序去重
    sku_list = list(dict.fromkeys(raw_skus))
    if not sku_list:
        raise HTTPException(400, "未解析到有效 SKU")

    library = ProductLibrary(settings.product_library_path)
    library_exists = settings.product_library_path.exists()

    priority_types = [
        ("white", "白底图", "White_Base"),
        ("png", "透明背景图", "PNG"),
        ("white2x", "一双鞋角度", "White_Basex2"),
        ("shadow", "阴影图", "PNG_Shadow"),
        ("model", "模特图", "Model_Images"),
    ]

    all_results = []
    for clean_sku in sku_list:
        found_assets = []
        for atype, label, folder_name in priority_types:
            folder = settings.IMAGE_TYPE_FOLDERS.get(atype, folder_name)
            matched = library.find_in_folder(clean_sku, folder) if library_exists else None
            if matched:
                p = Path(matched)
                found_assets.append({
                    "asset_type": atype,
                    "label": label,
                    "folder": folder,
                    "filename": p.name,
                    "url": f"/products/reference-image?sku={quote(clean_sku)}&asset_type={quote(atype)}",
                })

        # 尝试根目录查找
        if library_exists:
            root_matched = library.find(clean_sku)
            if root_matched:
                p = Path(root_matched)
                if not any(a["filename"] == p.name for a in found_assets):
                    found_assets.append({
                        "asset_type": "root",
                        "label": "图库根目录",
                        "folder": "",
                        "filename": p.name,
                        "url": f"/products/reference-image?sku={quote(clean_sku)}&asset_type=root",
                    })

        mock_url = f"/products/mock-image?sku={quote(clean_sku)}&asset_type=white"
        all_results.append({
            "sku": clean_sku,
            "found": len(found_assets) > 0,
            "assets": found_assets,
            "best_url": found_assets[0]["url"] if found_assets else mock_url,
            "mock_url": mock_url,
        })

    first = all_results[0] if all_results else {}
    return {
        "sku": first.get("sku", ""),
        "found": any(r["found"] for r in all_results),
        "assets": first.get("assets", []),
        "best_url": first.get("best_url", ""),
        "mock_url": first.get("mock_url", ""),
        "library_exists": library_exists,
        "library_path": str(settings.product_library_path),
        "items": all_results,
    }


@app.get("/products/mock-image")
def get_product_mock_image(sku: str = "DEMO", asset_type: str = "white"):
    """
    开发机未挂载真实素材库时，生成优雅的商品 SVG 占位图供测试导入画布。
    """
    clean_sku = (sku or "DEMO").strip()
    type_names = {
        "white": "白底图",
        "png": "透明背景图",
        "white2x": "一双鞋角度",
        "shadow": "阴影图",
        "model": "模特图",
        "root": "图库原图",
    }
    type_label = type_names.get(asset_type.lower(), asset_type or "白底图")
    escaped_sku = html.escape(clean_sku, quote=True)
    escaped_type_label = html.escape(type_label, quote=True)

    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f8fafc"/>
      <stop offset="100%" stop-color="#edf2f7"/>
    </linearGradient>
    <linearGradient id="badge" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#6366f1"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="16" stdDeviation="20" flood-color="#0f172a" flood-opacity="0.08"/>
    </filter>
  </defs>
  <rect width="800" height="800" fill="url(#bg)"/>
  <rect x="40" y="40" width="720" height="720" rx="24" fill="#ffffff" filter="url(#shadow)" stroke="#e2e8f0" stroke-width="2"/>
  <g transform="translate(400, 330)">
    <!-- 示意鞋履/商品剪影 -->
    <path d="M-160,80 C-170,40 -150,-10 -110,-50 C-70,-90 -20,-110 30,-100 C70,-90 120,-60 160,-20 C180,0 200,40 180,80 C150,110 -100,110 -160,80 Z" fill="#e2e8f0" opacity="0.8"/>
    <path d="M-150,75 C-140,45 -120,-5 -80,-40 C-40,-75 0,-95 40,-85 C75,-75 115,-45 150,-10 C165,10 180,45 165,75 C140,95 -80,95 -150,75 Z" fill="#cbd5e1" opacity="0.6"/>
    <!-- 装饰线 -->
    <path d="M-120,40 Q10,-20 120,30" fill="none" stroke="#94a3b8" stroke-width="4" stroke-linecap="round" stroke-dasharray="6,6"/>
  </g>
  <!-- 货号与信息 -->
  <rect x="220" y="470" width="360" height="46" rx="23" fill="url(#badge)"/>
  <text x="400" y="500" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="20" font-weight="700" fill="#ffffff" text-anchor="middle">SKU: {escaped_sku}</text>
  <text x="400" y="555" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="600" fill="#334155" text-anchor="middle">类型：{escaped_type_label}（开发模拟图）</text>
  <text x="400" y="588" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" fill="#94a3b8" text-anchor="middle">尺寸：800 × 800 px · 连入真实素材库时自动载入高清原图</text>
</svg>"""
    return Response(content=svg, media_type="image/svg+xml")


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
        "png": "png",
        "shadow": "shadow",
        "model": "model",
    }
    clean_sku = (sku or "").strip()
    clean_type = (asset_type or "").strip().casefold()
    normalized_key = alias_map.get(clean_type, clean_type) or "white"
    folder = settings.IMAGE_TYPE_FOLDERS.get(normalized_key)
    library = ProductLibrary(settings.product_library_path)

    matched_path = None
    # 1. 尝试从指定文件夹查找
    if folder:
        matched_path = library.find_in_folder(clean_sku, folder)

    # 2. 如果未指定具体类型或没找到，按常规优先级 fallback 查找
    if not matched_path and normalized_key in ("white", "auto", "default"):
        for fallback_key in ("White_Base", "PNG", "White_Basex2", "PNG_Shadow"):
            matched_path = library.find_in_folder(clean_sku, fallback_key)
            if matched_path:
                break

    # 3. 根目录查找
    if not matched_path:
        matched_path = library.find(clean_sku)

    if not matched_path:
        raise HTTPException(404, "素材图不存在")

    path = Path(matched_path)
    media_type = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
    return FileResponse(str(path), media_type=media_type, filename=path.name)


# ─── AI 换装：素材库多角度素材 ────────────────────────────────────────────────

_OUTFIT_MAX_SKUS = 6


@app.get("/products/outfit-assets")
async def product_outfit_assets(request: Request, sku: str):
    """按 SKU 列出素材库中各类型、各角度的素材图，供 AI 换装弹窗勾选。"""
    _current_user(request)
    raw_skus = [s.strip() for s in re.split(r"[,，\s]+", sku or "") if s.strip()]
    sku_list = list(dict.fromkeys(raw_skus))[:_OUTFIT_MAX_SKUS]
    if not sku_list:
        raise HTTPException(400, "SKU 不能为空")
    library_exists = settings.product_library_path.exists()
    if library_exists:
        groups = await asyncio.gather(*(
            asyncio.to_thread(outfit_change.list_sku_assets, clean_sku) for clean_sku in sku_list
        ))
    else:
        groups = [[] for _ in sku_list]

    items = []
    for clean_sku, assets in zip(sku_list, groups):
        rows = []
        for asset in assets:
            query = f"asset_type={quote(asset['asset_type'])}&path={quote(asset['path'])}"
            rows.append({
                **asset,
                "url": f"/products/library-image?{query}",
                "thumb_url": f"/products/library-image?{query}&thumb=1",
            })
        items.append({"sku": clean_sku, "found": bool(rows), "assets": rows})
    return {
        "library_exists": library_exists,
        "items": items,
        "max_references": outfit_change.MAX_GARMENT_REFERENCES,
        "truncated": len(raw_skus) > len(sku_list),
    }


@app.get("/products/library-image")
async def product_library_image(asset_type: str, path: str, thumb: int = 0):
    """读取素材库中的单个素材文件（thumb=1 返回缓存的 webp 缩略图）。"""
    try:
        file_path = await asyncio.to_thread(outfit_change.resolve_library_asset, asset_type, path)
    except FileNotFoundError:
        raise HTTPException(404, "素材图不存在")
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    headers = {"Cache-Control": "private, max-age=3600"}
    if thumb:
        try:
            thumb_path = await asyncio.to_thread(outfit_change.library_thumbnail, file_path)
            return FileResponse(str(thumb_path), media_type="image/webp", headers=headers)
        except Exception:
            logger.warning("library thumbnail failed: %s", file_path, exc_info=True)
    media_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    return FileResponse(str(file_path), media_type=media_type, headers=headers)


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
        active_skill_context, active_skill_meta = _load_active_skill_context(active_skill_name, user)

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
                try:
                    agent_reply, intent_patch = await call_agent_llm(
                        message, state, recent_messages, reference_context,
                        skill_context=active_skill_context,
                        on_chunk=_on_llm_chunk,
                        on_think=_on_llm_think,
                        on_reset=lambda: text_queue.put_nowait(("reset", None)),
                    )
                finally:
                    text_queue.put_nowait((None, None))  # 失败也结束等待，随后 await 抛出错误

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
                    if kind == "reset":
                        yield make_sse("agent_reset", {})
                    elif kind == "think":
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


def _user_skill_dir(user: dict | None) -> Path | None:
    if not user or not user.get("id"):
        return None
    return user_skill_dir(settings.user_skills_path, str(user["id"]))


def _load_active_skill_context(
    skill_name: str | None,
    user: dict | None,
    *,
    include_references: bool = False,
    has_reference_image: bool = False,
) -> tuple[str, dict | None]:
    clean = str(skill_name or "").strip()
    if not clean:
        return "", None
    skill = load_agent_skill(settings.agent_skill_paths, settings.root_dir, clean, _user_skill_dir(user))
    if not skill:
        raise HTTPException(404, f"技能「{clean}」不存在或已删除")
    # 有参考图时带哪些 reference 由 Skill 自己在 frontmatter 的 references_with_image 里声明
    references_subset = None
    if has_reference_image:
        declared = skill.metadata.get("references_with_image") or []
        if isinstance(declared, str):
            declared = [declared]
        references_subset = [str(item) for item in declared] if isinstance(declared, list) else []
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
    user = _current_user(request)
    return {"skills": list_agent_skills(settings.agent_skill_paths, settings.root_dir, _user_skill_dir(user))}


@app.post("/agent-skills")
async def agent_skill_upload_endpoint(
    request: Request,
    file: UploadFile = File(...),
    overwrite: bool = Form(False),
):
    """上传 Skill（.zip 或 SKILL.md），只安装到当前用户自己的目录。"""
    user = _current_user(request)
    user_dir = _user_skill_dir(user)
    data = await file.read(MAX_SKILL_UPLOAD_BYTES + 1)
    system_skills = {
        item["name"]: item["title"]
        for item in list_agent_skills(settings.agent_skill_paths, settings.root_dir)
    }
    try:
        name, warnings = install_user_skill(
            data, file.filename or "", user_dir, system_skills=system_skills, uploader=user, overwrite=overwrite,
        )
    except SkillUploadError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
    skill = next(
        item for item in list_agent_skills(settings.agent_skill_paths, settings.root_dir, user_dir)
        if item["name"] == name
    )
    log_operation(user_id=user["id"], username=user.get("username", ""), action="skill_upload",
                  payload=json.dumps({"name": name, "overwrite": overwrite}, ensure_ascii=False))
    return {"skill": skill, "warnings": warnings}


@app.delete("/agent-skills/{skill_name}")
async def agent_skill_delete_endpoint(request: Request, skill_name: str):
    """只能删除当前用户自己上传的 Skill，系统 Skill 不可删除。"""
    user = _current_user(request)
    if not delete_user_skill(_user_skill_dir(user), skill_name):
        raise HTTPException(404, "技能不存在，或不是你上传的技能")
    log_operation(user_id=user["id"], username=user.get("username", ""), action="skill_delete",
                  payload=json.dumps({"name": skill_name}, ensure_ascii=False))
    return {"ok": True}


@app.post("/agent-skills/{skill_name}/plan/stream")
async def agent_skill_plan_stream_endpoint(
    request: Request,
    skill_name: str,
    prompt: str = Form(...),
    image: list[UploadFile] = File(default=[]),
):
    """Stream Skill planner output so the UI can show live reasoning/progress.

    支持多模态：上传参考图时压缩后随 SKILL.md 及其 references_with_image 声明的文件
    一起发给 skill LLM，planner 真正看图分析并产出 final_prompt。
    """
    user = _current_user(request)
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

    skill_context, skill_meta = _load_active_skill_context(skill_name, user, has_reference_image=has_reference)
    if not skill_context:
        raise HTTPException(404, f"未找到 Skill: {skill_name}")

    async def event_stream():
        skill_label = (skill_meta or {}).get("name") or skill_name
        if not get_model_routes("skill_llm"):
            final_prompt, trace = _fallback_skill_plan(user_prompt, skill_label)
            yield make_sse("delta", {"text": json.dumps(trace, ensure_ascii=False), "mode": "fallback"})
            yield make_sse("done", {"final_prompt": final_prompt, "prompt_trace": json.dumps(trace, ensure_ascii=False), "trace": trace})
            return

        planner_prompt = _build_skill_planner_prompt(user_prompt, skill_label, skill_context, has_reference=has_reference)
        if has_reference:
            user_content: Any = [{"type": "text", "text": planner_prompt}]
            for url in ref_data_urls:
                user_content.append({"type": "image_url", "image_url": {"url": url}})
        else:
            user_content = planner_prompt
        raw_parts: list[str] = []
        try:
            route_meta = {}
            async for chunk in routed_chat_stream("skill_llm", {
                "messages": [{"role": "user", "content": user_content}],
                "max_tokens": 1400, "temperature": 0.25,
            }, timeout=settings.skill_llm_timeout_seconds,
                validate=lambda text: bool(str(_extract_json_object(text).get("final_prompt") or "").strip())):
                if chunk.get("_route_reset"):
                    raw_parts.clear()
                    yield make_sse("reset", {})
                    continue
                route_meta = chunk.get("_route") or {}
                choice = (chunk.get("choices") or [{}])[0]
                delta = choice.get("delta") or choice.get("message") or {}
                content = delta.get("content")
                if content:
                    text = str(content)
                    raw_parts.append(text)
                    yield make_sse("delta", {"text": text, "mode": "llm", **route_meta})

            raw = "".join(raw_parts).strip()
            trace = _extract_json_object(raw)
            final_prompt = str(trace.get("final_prompt") or "").strip()
            if not final_prompt:
                final_prompt, trace = _fallback_skill_plan(user_prompt, skill_label)
            trace.setdefault("skill", skill_label)
            trace.setdefault("mode", "llm")
            trace.update(route_meta)
            if has_reference:
                trace.setdefault("used_reference_images", True)
            yield make_sse("done", {"final_prompt": final_prompt, "prompt_trace": json.dumps(trace, ensure_ascii=False), "trace": trace})
        except Exception as exc:
            logger.exception("Skill planner stream failed: %s", skill_name)
            final_prompt, trace = _fallback_skill_plan(user_prompt, skill_label)
            trace["stream_error"] = str(exc)
            yield make_sse("error", {"message": str(exc), "fallback_prompt": final_prompt, "prompt_trace": json.dumps(trace, ensure_ascii=False), "trace": trace})

    return StreamingResponse(event_stream(), media_type="text/event-stream")


CONTEXT_INTENT_MODES = {"edit", "regenerate", "new"}


def _context_image_data_url(path: Path) -> str:
    """上一张结果图压成小 JPEG 给 VLM 看，避免大图拖慢意图判断。"""
    from PIL import Image
    with Image.open(path) as im:
        im = im.convert("RGB")
        im.thumbnail((768, 768))
        buffer = io.BytesIO()
        im.save(buffer, format="JPEG", quality=80)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


async def _judge_context_intent(
    history_messages: list[dict],
    current_prompt: str,
    prev_image_path: Path | None,
    has_user_refs: bool,
) -> dict:
    """
    用 VLM 判断本轮生图怎么继承上下文：
    - edit：在上一张图基础上修改（改写 prompt + 上一张图作参考）
    - regenerate：沿用之前的需求重新出图（改写 prompt，不带上一张图）
    - new：与之前无关的新需求（不改写、不带图）
    VLM 不可用或返回异常时按 edit 处理，保持原有行为。
    """
    fallback = {"mode": "edit", "reason": "", "source": "fallback"}
    if not get_model_routes("vlm"):
        return {**fallback, "reason": "VLM 未配置"}

    history_lines = []
    for m in history_messages[-8:]:
        who = "用户" if m.get("who") == "user" else "AI"
        text = (m.get("text") or m.get("prompt") or "").strip()
        if text:
            history_lines.append(f"[{who}] {text[:120]}{'…' if len(text) > 120 else ''}")
    instruction = f"""你在一个电商 AI 生图工具里判断用户本轮指令与之前对话的关系。只输出 JSON：{{"mode": "...", "reason": "..."}}
mode 取值：
- "edit"：要在上一张结果图的基础上修改（换颜色、改背景、调构图、加减元素、继续优化等）
- "regenerate"：沿用之前的需求重新出一张，但不需要以上一张图为底（再来一张、换个方案、重新生成等）
- "new"：与之前的需求无关的全新需求
reason 用一句中文说明依据。
{"附图是上一张生成结果。" if prev_image_path else "上一轮没有可用的结果图。"}用户本轮{"附带了新的参考图" if has_user_refs else "没有附带新的参考图"}。

[对话历史]
{chr(10).join(history_lines) or "（无）"}

[用户本轮指令]
{current_prompt}"""
    content: list[dict] = [{"type": "text", "text": instruction}]
    try:
        if prev_image_path:
            content.append({"type": "image_url", "image_url": {"url": _context_image_data_url(prev_image_path)}})
        resp = await routed_chat_completion("vlm", {
            "messages": [{"role": "user", "content": content}], "temperature": 0,
        }, timeout=30,
            validate=lambda text: str((_extract_first_json_object(text) or {}).get("mode") or "").lower() in CONTEXT_INTENT_MODES)
        if not resp.is_success:
            logger.warning("Context intent VLM error: %s", resp.text[:200])
            return {**fallback, "reason": f"VLM HTTP {resp.status_code}"}
        try:
            raw = resp.json()["choices"][0]["message"]["content"] or ""
        except Exception:
            raw = _extract_sse_chat_content(resp.text or "")
        parsed = _extract_first_json_object(raw) or {}
        mode = str(parsed.get("mode") or "").strip().lower()
        if mode not in CONTEXT_INTENT_MODES:
            logger.warning("Context intent VLM returned unexpected content: %s", raw[:200])
            return {**fallback, "reason": "VLM 返回无法解析"}
        result = {"mode": mode, "reason": str(parsed.get("reason") or "")[:200], "source": "vlm"}
        logger.info("Context intent [%s]: %s → %s (%s)", resp.extensions.get("model_route", {}).get("model"), current_prompt[:60], mode, result["reason"][:60])
        return result
    except Exception as exc:
        logger.exception("Context intent judge failed, falling back to edit")
        return {**fallback, "reason": f"VLM 调用失败: {exc.__class__.__name__}"}


async def _build_context_aware_prompt(
    session_id: str,
    user_id: str,
    current_prompt: str,
) -> str:
    """
    根据当前 session 的历史对话，用 LLM 将用户的简短修改指令
    改写为包含上下文的完整生图 prompt。对用户透明。
    """
    # 如果用户当前指令已经包含精准局部修改坐标信息，跳过 LLM 上下文改写，保护精确坐标
    if "[精准局部修改需求]" in current_prompt or ("坐标" in current_prompt and ("%" in current_prompt or "归一化" in current_prompt)):
        return current_prompt

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
        resp = await routed_chat_completion("chat_llm", {
            "messages": [{"role": "user", "content": enrichment_prompt}],
            "max_tokens": 512, "temperature": 0.3,
        }, timeout=settings.chat_llm_timeout_seconds)
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


def _fallback_skill_plan(user_prompt: str, skill_name: str) -> tuple[str, dict]:
    """Planner 不可用时按原始需求出图，并在 trace 里如实说明技能未生效。"""
    final_prompt = user_prompt.strip()
    trace = {
        "mode": "fallback",
        "skill": skill_name,
        "steps": [f"技能「{skill_name}」解析未成功，本次按原始需求直接生成，技能规则未生效。"],
        "final_prompt": final_prompt,
    }
    return final_prompt, trace


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
附图是用户提供的参考。如果 Skill 规定了参考图的分析和使用方式，按 Skill 执行；否则根据用户需求判断要从参考图中借鉴什么，并在 final_prompt 中写成具体、可执行的画面描述。
"""
    return f"""你是 DesignFlow 的 Skill Planner。你的任务不是直接聊天，而是读取用户显式调用的 Codex-style SKILL.md，并把它转换为一次可执行的生图请求。

必须输出严格 JSON，不要 Markdown，不要代码块。字段：
{{
  "steps": ["你如何理解用户需求", "你从 Skill 中采用哪些规则", "你如何转换给生图模型"],
  "applied_rules": ["具体采用的 Skill 规则，3-6 条"],
  "final_prompt": "最终传给 gpt-image-2.5 的完整生图 prompt，要求具体、可执行、不要提到 SKILL.md 文件名或文档本身",
  "negative_prompt": "需要避免的画面问题"
}}

约束：
1. final_prompt 必须围绕用户需求，不要泛化成模板说明。
2. 画面要素以 Skill 的规则为准，写到具体可执行的程度。
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
    if not get_model_routes("skill_llm"):
        return _fallback_skill_plan(user_prompt, skill_name)

    planner_prompt = _build_skill_planner_prompt(user_prompt, skill_name, skill_context)
    try:
        resp = await routed_chat_completion("skill_llm", {
            "messages": [{"role": "user", "content": planner_prompt}],
            "max_tokens": 1400, "temperature": 0.25,
        }, timeout=settings.skill_llm_timeout_seconds,
            validate=lambda text: bool(str(_extract_json_object(text).get("final_prompt") or "").strip()))
        data = resp.json()
        content = (((data or {}).get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        trace = _extract_json_object(content)
        final_prompt = str(trace.get("final_prompt") or "").strip()
        if not final_prompt:
            return _fallback_skill_plan(user_prompt, skill_name)
        trace.setdefault("skill", skill_name)
        trace.setdefault("mode", "llm")
        trace.update(resp.extensions.get("model_route") or {})
        return final_prompt, trace
    except Exception:
        logger.exception("Skill planner failed, falling back to deterministic plan")
        return _fallback_skill_plan(user_prompt, skill_name)


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


async def _run_ai_image_background(**kwargs):
    await execute_image_job(_execute_ai_image_background, kwargs["job_id"], initial=kwargs)


async def _execute_ai_image_background(
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
    variant: str = "flare",
    quality: str = "auto",
    resume: dict | None = None,
):
    """后台异步生图：轮询进度 → 更新 DB → 下载结果 → 写聊天记录"""
    stage = "init"
    upstream_task_id = ""
    active_provider = provider
    result = None
    reference_count = int((request_meta or {}).get("reference_count", len(refs)))

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
                progress=pct, has_reference=has_reference, reference_count=reference_count,
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
        checkpoint("accepted", task_id=upstream_task_id, provider=active_provider)
        try:
            save_ai_image_job(
                job_id=job_id, user_id=user_id, status="processing",
                model=model, prompt=prompt, size=size,
                provider=active_provider or provider, resolution=resolution,
                original_prompt=original_prompt, resolved_prompt=resolved_prompt or prompt,
                prompt_trace=prompt_trace,
                progress=10, has_reference=has_reference, reference_count=reference_count,
                request_meta=request_meta, created_at=created_at,
                task_id=upstream_task_id or None,
            )
        except Exception:
            pass

    def on_attempt(attempt_provider: str) -> None:
        """记录当前准备使用的渠道；真正发送付费 POST 时由适配器保存 submitting。"""
        nonlocal active_provider, upstream_task_id
        active_provider = attempt_provider or active_provider
        upstream_task_id = ""
        checkpoint("preparing", provider=active_provider)
        try:
            save_ai_image_job(
                job_id=job_id, user_id=user_id, status="processing",
                model=model, prompt=prompt, size=size,
                provider=active_provider or provider, resolution=resolution,
                original_prompt=original_prompt, resolved_prompt=resolved_prompt or prompt,
                prompt_trace=prompt_trace,
                progress=0, has_reference=has_reference, reference_count=reference_count,
                request_meta=request_meta, created_at=created_at,
                task_id=upstream_task_id or None,
            )
        except Exception:
            pass

    try:
        stage = "generate"
        if resume:
            active_provider = str(resume.get("provider") or provider)
            upstream_task_id = str(resume.get("task_id") or "")
            if resume.get("local_url"):
                local_path = _resolve_public_asset_path(str(resume["local_url"]))
                if not local_path or not local_path.is_file():
                    raise RuntimeError("已生成的原图文件不存在")
                result = {"url": resume["local_url"], "provider": active_provider,
                          "task_id": upstream_task_id}
            elif active_provider == PROVIDER_BFL:
                result = await generate_vto_async(
                    prompt=prompt, person=b"", garment=b"", user_id=user_id,
                    on_progress=on_progress,
                    resume={"id": upstream_task_id, "polling_url": resume["polling_url"]},
                )
            else:
                result = await resume_image_async(
                    provider=active_provider, model=model, user_id=user_id,
                    recovery=resume, on_progress=on_progress,
                )
        elif provider == PROVIDER_AUTO or not provider:
            result = await asyncio.wait_for(
                smart_generate_image_async(
                    model=model, prompt=prompt,
                    images=refs if refs else None,
                    size=size, resolution=resolution, user_id=user_id,
                    variant=variant, quality=quality,
                    on_progress=on_progress, on_attempt=on_attempt, on_accepted=on_accepted,
                ),
                timeout=max(60, int(settings.ai_image_smart_route_timeout_seconds or 360)),
            )
        elif provider == PROVIDER_BFL:
            on_attempt(provider)
            if len(refs) < 2:
                raise RuntimeError("FLUX 换装缺少人物图或服装图")
            result = await generate_vto_async(
                prompt=prompt, person=refs[0][0], garment=refs[1][0], user_id=user_id,
                on_progress=on_progress, on_accepted=lambda tid: on_accepted(PROVIDER_BFL, tid),
            )
        elif provider == PROVIDER_SUB2API:
            on_attempt(provider)
            result = await generate_sub2api_async(
                model=model, prompt=prompt,
                images=refs if refs else None,
                size=size, resolution=resolution, user_id=user_id,
                variant=variant, quality=quality,
                on_progress=on_progress, on_accepted=lambda tid: on_accepted(PROVIDER_SUB2API, tid),
            )
        elif provider == PROVIDER_TUZI:
            on_attempt(provider)
            result = await generate_tuzi_async(
                model=model, prompt=prompt, images=refs if refs else None,
                size=size, resolution=resolution, user_id=user_id,
                variant=variant, quality=quality,
                on_progress=on_progress, on_accepted=lambda tid: on_accepted(PROVIDER_TUZI, tid),
            )
        elif provider == PROVIDER_ADOBE2API:
            on_attempt(provider)
            result = await generate_adobe2api_async(
                model=model, prompt=prompt,
                images=refs,
                size=size, resolution=resolution, user_id=user_id,
                on_progress=on_progress, on_accepted=lambda tid: on_accepted(PROVIDER_ADOBE2API, tid),
            )
        elif refs:
            on_attempt(provider)
            result = await generate_image_with_reference_async(
                model=model, prompt=prompt, images=refs,
                size=size, resolution=resolution, user_id=user_id,
                variant=variant, quality=quality,
                on_progress=on_progress, on_accepted=lambda tid: on_accepted(PROVIDER_APIMART, tid),
            )
        else:
            on_attempt(provider)
            result = await generate_image_async(
                model=model, prompt=prompt,
                size=size, resolution=resolution, user_id=user_id,
                variant=variant, quality=quality,
                on_progress=on_progress, on_accepted=lambda tid: on_accepted(PROVIDER_APIMART, tid),
            )
        actual_provider = str(result.get("provider") or provider)
        provider_switched = bool(result.get("provider_switched"))
        upstream_task_id = str(result.get("task_id") or "")
        checkpoint("downloaded", local_url=result.get("url"), task_id=upstream_task_id)
        stage = "persist"
        save_ai_image_job(
            job_id=job_id, user_id=user_id, status="done",
            model=model, prompt=prompt, size=size,
            provider=actual_provider, resolution=resolution,
            original_prompt=original_prompt, resolved_prompt=resolved_prompt or prompt,
            prompt_trace=prompt_trace,
            image_url=result.get("url"), task_id=upstream_task_id or None,
            progress=100, has_reference=has_reference, reference_count=reference_count,
            request_meta=request_meta, created_at=created_at,
        )
        if provider_switched:
            try:
                mark_ai_image_job_provider_switched(job_id, True)
            except Exception:
                logger.exception("failed to mark provider switch: job_id=%s", job_id)
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
        try:
            log_operation(
                user_id=user_id, username=username,
                action="ai_image",
                detail=f"job={job_id[:8]} model={model} size={size} result=done{cost_str}{time_str}{usage_str} image={result.get('url', '?')[:60]}",
                payload=json.dumps({
                    "job_id": job_id, "model": model, "size": size, "result": "done",
                    "variant": variant, "quality": quality,
                    "image_url": result.get("url", ""), "cost": result.get("cost"), "usage": usage,
                    "provider": actual_provider, "provider_switched": provider_switched,
                    "upstream_task_id": upstream_task_id,
                }, ensure_ascii=False),
            )
        except Exception:
            logger.exception("failed to write success operation log: job_id=%s", job_id)
        try:
            append_ai_chat_message(
                session_id=session_id, user_id=user_id,
                role="ai", type="ai_image_result",
                text=prompt, image_url=result.get("url"),
                meta={
                    "job_id": job_id,
                    "model": model, "prompt": prompt,
                    "variant": variant, "quality": quality,
                    "resolvedPrompt": resolved_prompt or prompt,
                    "promptTrace": prompt_trace,
                    "provider": actual_provider,
                    "providerSwitched": provider_switched,
                    "taskId": upstream_task_id,
                    "size": size, "resolution": resolution,
                    "status": "done",
                    "hasReference": has_reference,
                    "refCount": reference_count,
                    "refPreviews": ref_previews or [],
                    "previewUrl": preview_url,
                    "batchId": batch_id,
                    "batchIndex": batch_index,
                    "batchCount": batch_count,
                },
                created_at=time.time(),
            )
        except Exception:
            logger.exception("failed to append success chat message: job_id=%s", job_id)
            raise
        # 注意：参考图目录需保留供重试/复用任务读取，不在此处删除
        checkpoint("done", resuming=False, message=None)
    except asyncio.CancelledError:
        raise
    except Exception as e:
        stage = str(getattr(e, "stage", "") or stage or "generate")
        upstream_task_id = str(getattr(e, "task_id", "") or upstream_task_id)
        fail_provider = str(getattr(e, "provider", "") or active_provider or provider)
        diagnostic_error = format_generation_error(
            e,
            stage=stage or "generate",
            provider=fail_provider,
            model=model,
            job_id=job_id,
            task_id=upstream_task_id,
        )
        # 图片已经生成并落盘后，后续写库/日志异常不得把成功任务覆盖成失败。
        if isinstance(result, dict) and result.get("url"):
            logger.exception(
                "ai_image post-generation persistence failed: job_id=%s provider=%s error=%s",
                job_id, fail_provider, diagnostic_error[:300],
            )
            try:
                save_ai_image_job(
                    job_id=job_id, user_id=user_id, status="done",
                    model=model, prompt=prompt, size=size,
                    provider=str(result.get("provider") or fail_provider), resolution=resolution,
                    original_prompt=original_prompt, resolved_prompt=resolved_prompt or prompt,
                    prompt_trace=prompt_trace, image_url=result.get("url"),
                    task_id=str(result.get("task_id") or upstream_task_id) or None,
                    progress=100, has_reference=has_reference, reference_count=reference_count,
                    request_meta=request_meta, created_at=created_at,
                )
            except Exception:
                logger.exception("failed to recover generated image job: job_id=%s", job_id)
            # Let the durable worker bound finalization retries while keeping
            # the generated image successful and reusing its local result.
            raise
        # The durable worker decides whether to resume the original task or fail.
        # Never convert a polling/download interruption into a fresh generation.
        raise

@app.get("/ai-image/outpainting/config")
def ai_image_outpainting_config():
    """Return only non-secret geometry constraints needed by the canvas UI."""
    limits = _outpainting_effective_limits()
    return {
        "enabled": bool(
            settings.bfl_outpainting_enabled
            and settings.bfl_api_key.strip()
            and not _outpainting_configuration_error()
        ),
        "max_source_bytes": max(1, int(settings.bfl_outpainting_max_source_bytes)),
        "timeout_seconds": max(1, int(settings.bfl_outpainting_timeout_seconds)),
        **limits,
    }


def _outpainting_job_response(job: dict) -> dict:
    meta = job.get("request_meta") if isinstance(job.get("request_meta"), dict) else {}
    expected_width = int(meta.get("expected_width") or 0)
    expected_height = int(meta.get("expected_height") or 0)
    return {
        "job_id": job["id"],
        "status": job.get("status") or "processing",
        "progress": int(job.get("progress") or 0),
        "task_id": job.get("task_id") or meta.get("provider_task_id") or meta.get("provider_task_uuid") or "",
        "processing_width": int(meta.get("processing_width") or 0),
        "processing_height": int(meta.get("processing_height") or 0),
        "expected_width": expected_width,
        "expected_height": expected_height,
        "expected_dimensions": {
            "width": expected_width,
            "height": expected_height,
        },
        "deduplicated": True,
    }


async def _read_outpainting_json_body(request: Request) -> dict:
    max_bytes = max(1024, int(settings.bfl_outpainting_max_request_bytes))
    raw_content_length = str(request.headers.get("content-length") or "").strip()
    if raw_content_length:
        try:
            if int(raw_content_length) > max_bytes:
                raise HTTPException(413, "扩图请求体过大")
        except ValueError as exc:
            raise HTTPException(400, "Content-Length 无效") from exc

    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        if not chunk:
            continue
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(413, "扩图请求体过大")
        chunks.append(chunk)
    try:
        body = json.loads(b"".join(chunks))
    except Exception as exc:
        raise HTTPException(400, "请求 JSON 无效") from exc
    if not isinstance(body, dict):
        raise HTTPException(400, "请求 JSON 必须是对象")
    return body


@app.post("/ai-image/outpainting")
async def ai_image_outpainting(request: Request):
    """Create one durable, idempotent FLUX outpainting job."""
    user = _current_user(request)
    if not settings.bfl_outpainting_enabled:
        raise HTTPException(503, "扩图功能未启用")
    if not settings.bfl_api_key.strip():
        raise HTTPException(503, "扩图服务尚未配置，请联系管理员")
    configuration_error = _outpainting_configuration_error()
    if configuration_error:
        logger.error("BFL outpainting configuration rejected: %s", configuration_error)
        raise HTTPException(503, "扩图服务配置无效，请联系管理员")
    body = await _read_outpainting_json_body(request)

    raw_client_request_id = str(
        body.get("client_request_id")
        or request.headers.get("x-client-request-id")
        or ""
    ).strip()
    try:
        client_request_id = str(uuid.UUID(raw_client_request_id))
    except (ValueError, AttributeError):
        raise HTTPException(400, "client_request_id 必须是有效 UUID")

    existing = await asyncio.to_thread(
        load_ai_image_job_by_client_request_id,
        str(user["id"]),
        client_request_id,
    )
    if existing:
        return _outpainting_job_response(existing)

    mode = body.get("mode", settings.bfl_outpainting_mode)
    if not isinstance(mode, str) or mode not in BFL_ALLOWED_MODES:
        raise HTTPException(400, "mode 必须是 fast 或 high")

    image_url = str(body.get("image_url") or "").strip()
    if not image_url:
        raise HTTPException(400, "image_url 不能为空")
    if image_url.casefold().startswith("data:image/"):
        source: str | Path = image_url
        source_kind = "data_uri"
        source_image_url = None
    else:
        source, source_image_url = _outpainting_internal_path(image_url, request, user)
        source_kind = "internal_url"

    raw_outpaint = body.get("outpaint")
    outpaint = raw_outpaint if isinstance(raw_outpaint, dict) else body
    limits = _outpainting_effective_limits(mode)

    def prepare_and_claim():
        with _outpainting_submit_lock:
            duplicate = load_ai_image_job_by_client_request_id(
                str(user["id"]),
                client_request_id,
            )
            if duplicate:
                return duplicate, None, None, None, None, None

            claims = _outpainting_claims()
            user_id = str(user["id"])
            max_inflight = max(1, int(settings.bfl_outpainting_max_concurrency)) + max(
                0, int(settings.bfl_outpainting_max_queue_size)
            )
            max_per_user = max(1, int(settings.bfl_outpainting_max_pending_per_user))
            if len(claims) >= max_inflight:
                raise _OutpaintingCapacityError("扩图任务较多，请稍后再试")
            if sum(1 for claimed_user_id in claims.values() if claimed_user_id == user_id) >= max_per_user:
                raise _OutpaintingCapacityError("你已有扩图任务在处理中，请等待完成后再试")

            prepared = prepare_outpainting_image(
                source,
                processing_width=body.get("processing_width"),
                processing_height=body.get("processing_height"),
                max_source_bytes=max(1, int(settings.bfl_outpainting_max_source_bytes)),
                max_source_pixels=max(1, int(settings.bfl_outpainting_max_source_pixels)),
                max_encoded_input_bytes=max(1, int(settings.bfl_outpainting_max_encoded_input_bytes)),
            )
            geometry = validate_geometry(
                processing_width=prepared.processing_width,
                processing_height=prepared.processing_height,
                top=outpaint.get("top", 0),
                right=outpaint.get("right", 0),
                bottom=outpaint.get("bottom", 0),
                left=outpaint.get("left", 0),
                max_width=limits["max_width"],
                max_height=limits["max_height"],
                max_pixels=limits["max_area_pixels"],
            )
            validate_mode_geometry(prepared, geometry, mode)
            job_id = uuid.uuid4().hex
            created_at = time.time()
            prompt = "FLUX outpainting"
            source_snapshot_url = persist_prepared_source_snapshot(
                prepared,
                output_root=settings.output_path,
                user_id=user_id,
                job_id=job_id,
            )
            request_meta = {
                "operation": "outpainting",
                "client_request_id": client_request_id,
                "provider": "bfl",
                "model": BFL_OUTPAINTING_MODEL,
                "provider_task_id": "",
                "provider_task_uuid": "",
                "polling_url": "",
                "source_kind": source_kind,
                "source_image_url": source_image_url,
                "source_snapshot_url": source_snapshot_url,
                "source_width": prepared.source_width,
                "source_height": prepared.source_height,
                "source_format": prepared.source_format,
                "source_sha256": prepared.source_sha256,
                "processing_width": prepared.processing_width,
                "processing_height": prepared.processing_height,
                "top": geometry.top,
                "right": geometry.right,
                "bottom": geometry.bottom,
                "left": geometry.left,
                "expected_width": geometry.expected_width,
                "expected_height": geometry.expected_height,
                "provider_top": geometry.provider_top,
                "provider_right": geometry.provider_right,
                "provider_bottom": geometry.provider_bottom,
                "provider_left": geometry.provider_left,
                "provider_width": geometry.provider_width,
                "provider_height": geometry.provider_height,
                "provider_margin_alignment": limits["snap_pixels"],
                "auto_crop": settings.bfl_outpainting_auto_crop,
                "mode": mode,
                "phase": "queued",
                "cost": None,
            }
            claims[job_id] = user_id
            try:
                save_ai_image_job(
                    job_id=job_id,
                    user_id=user["id"],
                    status="processing",
                    model=BFL_OUTPAINTING_MODEL,
                    provider="bfl",
                    prompt=prompt,
                    original_prompt=prompt,
                    resolved_prompt=prompt,
                    size=f"{geometry.expected_width}x{geometry.expected_height}",
                    resolution="",
                    has_reference=True,
                    reference_count=1,
                    client_request_id=client_request_id,
                    request_meta=request_meta,
                    task_id="",
                    progress=0,
                    created_at=created_at,
                )
            except sqlite3.IntegrityError:
                claims.pop(job_id, None)
                discard_prepared_source_snapshot(
                    source_snapshot_url,
                    output_root=settings.output_path,
                    user_id=user_id,
                )
                duplicate = load_ai_image_job_by_client_request_id(
                    str(user["id"]),
                    client_request_id,
                )
                if duplicate:
                    return duplicate, None, None, None, None, None
                raise
            except Exception:
                claims.pop(job_id, None)
                discard_prepared_source_snapshot(
                    source_snapshot_url,
                    output_root=settings.output_path,
                    user_id=user_id,
                )
                raise
            return None, prepared, geometry, job_id, created_at, request_meta

    try:
        existing_job, prepared, geometry, job_id, created_at, request_meta = await asyncio.to_thread(
            prepare_and_claim
        )
    except OutpaintingValidationError as exc:
        raise HTTPException(400, str(exc)) from exc
    except _OutpaintingCapacityError as exc:
        raise HTTPException(429, str(exc)) from exc

    if existing_job:
        return _outpainting_job_response(existing_job)
    _track_outpainting_task(
        _run_outpainting_background(
            job_id,
            dict(user),
            prepared,
            geometry,
            "",
            request_meta,
            created_at,
        ),
        claimed_job_id=job_id,
    )
    return {
        "job_id": job_id,
        "status": "processing",
        "progress": 0,
        "task_id": "",
        "processing_width": prepared.processing_width,
        "processing_height": prepared.processing_height,
        "expected_width": geometry.expected_width,
        "expected_height": geometry.expected_height,
        "expected_dimensions": {
            "width": geometry.expected_width,
            "height": geometry.expected_height,
        },
        "deduplicated": False,
    }


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


@app.post("/ai-image/matting")
async def ai_image_matting(request: Request):
    """对站内图片执行 AI 智能抠图（背景去除），返回可轮询的 ai-image job。"""
    if not settings.matting_enabled:
        raise HTTPException(503, "抠图服务未启用 (MATTING_ENABLED=false)")
    user = _current_user(request)
    body = await request.json()
    image_url = str(body.get("image_url") or "").strip()
    job_id = uuid.uuid4().hex
    created_at = time.time()
    if image_url.startswith("data:image/"):
        src_path = _persist_data_url_image(image_url, user_id=user["id"], job_id=job_id)
    else:
        src_path = _resolve_public_asset_path(image_url, user)
    prompt = "local ai matting background removal"
    save_ai_image_job(
        job_id=job_id, user_id=user["id"], status="processing",
        model="local-matting", prompt=prompt, size="",
        provider="local", reference_count=1,
        request_meta={"operation": "matting", "source_image_url": image_url},
        original_prompt=prompt, resolved_prompt=prompt,
        has_reference=True, progress=0, created_at=created_at,
    )
    asyncio.create_task(_run_matting_background(job_id, dict(user), src_path, created_at))
    return {"job_id": job_id, "status": "processing", "progress": 0}



@app.post("/ai-image/layer-extract")
async def ai_image_layer_extract(request: Request):
    """对站内图片执行"转分层 PSD"：Seedream 图层分离 → 本地按坐标导出 PSD。"""
    user = _current_user(request)
    body = await request.json()
    image_url = str(body.get("image_url") or "").strip()
    job_id = uuid.uuid4().hex
    created_at = time.time()
    if image_url.startswith("data:image/"):
        src_path = _persist_data_url_image(image_url, user_id=user["id"], job_id=job_id)
    else:
        src_path = _resolve_public_asset_path(image_url, user)
    provider = getattr(settings, "layer_extract_provider", "apimart")
    model_name = getattr(settings, "layer_extract_model", "seedream-5-0-pro")
    prompt = "Seedream 5.0 Pro 图层分离并导出 PSD"
    save_ai_image_job(
        job_id=job_id, user_id=user["id"], status="processing",
        model="layer-extract", prompt=prompt, size="",
        provider=provider, reference_count=1,
        request_meta={
            "operation": "layer_extract",
            "provider": provider,
            "model": model_name,
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


@app.get("/ai-image/metadata")
def ai_image_metadata(request: Request, url: str):
    """查询图片元数据（文件体积、物理分辨率、MIME类型及AI生图Prompt/模型信息）"""
    clean_url = (url or "").strip()
    if not clean_url:
        raise HTTPException(400, "图片地址不能为空")

    user = _current_user(request)

    split = urlsplit(clean_url)
    path = split.path or clean_url

    # 1. 尝试反查 AI 生图任务 (ai_image_jobs 或 agent_images)
    if not _is_admin(user):
        owner_match = re.match(r"^/ai-images/([^/]+)/", path)
        if owner_match and unquote(owner_match.group(1)) != str(user["id"]):
            raise HTTPException(404, "图片文件不存在")
    job = load_ai_image_job_by_image_url(path, None if _is_admin(user) else user["id"])

    # 2. 尝试解析本地磁盘文件以获取物理大小与 MIME
    file_size = None
    file_size_formatted = ""
    file_name = Path(path).name
    mime_type = mimetypes.guess_type(path)[0] or "image/png"

    try:
        candidate = _resolve_public_asset_path(path, user)
        if candidate and candidate.exists() and candidate.is_file():
            file_size = candidate.stat().st_size
            file_name = candidate.name
            guessed_mime = mimetypes.guess_type(candidate.name)[0]
            if guessed_mime:
                mime_type = guessed_mime
    except Exception:
        pass

    if file_size is not None:
        if file_size < 1024:
            file_size_formatted = f"{file_size} B"
        elif file_size < 1024 * 1024:
            file_size_formatted = f"{file_size / 1024:.1f} KB"
        else:
            file_size_formatted = f"{file_size / (1024 * 1024):.2f} MB"

    is_ai = bool(job)
    ai_metadata = None
    if job:
        req_meta = job.get("request_meta") or {}
        if isinstance(req_meta, str):
            try:
                req_meta = json.loads(req_meta)
            except Exception:
                req_meta = {}

        ref_images = list(req_meta.get("reference_images") or [])
        job_user_id = job.get("user_id") or (user["id"] if user else None)
        jid = job.get("id")

        # 若 request_meta 中尚未直接记录 reference_images，尝试从磁盘或任务元数据中补充
        if not ref_images and (job.get("has_reference") or req_meta.get("reference_names")):
            if job_user_id and jid:
                ref_dir = settings.output_path / "ai-images" / str(job_user_id) / "refs" / str(jid)
                if ref_dir.exists() and ref_dir.is_dir():
                    ref_files = sorted(ref_dir.iterdir())
                    ref_names = req_meta.get("reference_names") or []
                    for idx, rf in enumerate(ref_files):
                        if rf.is_file():
                            orig_name = ref_names[idx] if idx < len(ref_names) else rf.name
                            ref_images.append({
                                "type": "manual",
                                "name": orig_name,
                                "url": f"/ai-images/{job_user_id}/refs/{jid}/{rf.name}",
                                "label": f"用户参考图 {idx + 1}",
                            })

        # 如果是 outpainting 扩图，source_image_url / source_snapshot_url 即为参考原图
        if req_meta.get("operation") == "outpainting":
            source_url = req_meta.get("source_snapshot_url") or req_meta.get("source_image_url")
            if source_url and not any(r.get("url") == source_url for r in ref_images):
                ref_images.append({
                    "type": "outpainting_source",
                    "name": Path(source_url).name,
                    "url": source_url,
                    "label": "扩图原图",
                })

        # 补充上下文参考图（如果 req_meta 中有记录且尚未加入列表）
        ctx_url = req_meta.get("context_reference_url")
        if ctx_url and not any(r.get("url") == ctx_url for r in ref_images):
            ref_images.append({
                "type": "context",
                "name": Path(ctx_url).name,
                "url": ctx_url,
                "label": "上下文关联图",
            })

        # 如果通过 request_previews 有非 data: 的站内参考图预览
        for pv in req_meta.get("reference_previews") or []:
            if isinstance(pv, str) and pv.startswith("/") and not any(r.get("url") == pv for r in ref_images):
                ref_images.append({
                    "type": "preview",
                    "name": Path(pv).name,
                    "url": pv,
                    "label": f"参考图 {len(ref_images) + 1}",
                })

        ai_metadata = {
            "job_id": job.get("id"),
            "client_request_id": job.get("client_request_id") or req_meta.get("client_request_id") or "",
            "prompt": job.get("prompt") or "",
            "original_prompt": job.get("original_prompt") or "",
            "resolved_prompt": job.get("resolved_prompt") or "",
            "prompt_trace": job.get("prompt_trace") or "",
            "model": job.get("model") or "",
            "provider": job.get("provider") or req_meta.get("provider") or "",
            "size": job.get("size") or "",
            "resolution": job.get("resolution") or "",
            "variant": req_meta.get("variant") or "",
            "quality": req_meta.get("quality") or "",
            "skill": req_meta.get("skill") or "",
            "has_reference": bool(job.get("has_reference")) or len(ref_images) > 0,
            "reference_count": len(ref_images) or job.get("reference_count") or 0,
            "reference_images": ref_images,
            "created_at": job.get("created_at"),
            "request_meta": req_meta,
        }

    return {
        "url": clean_url,
        "file_name": file_name,
        "file_size": file_size,
        "file_size_formatted": file_size_formatted,
        "mime_type": mime_type,
        "is_ai_generated": is_ai,
        "ai_metadata": ai_metadata,
    }


@app.get("/ai-image/{job_id}")
def ai_image_status(request: Request, job_id: str):
    """查询生图任务状态，前端轮询此接口获取进度"""
    user = _current_user(request)
    job = load_ai_image_job(job_id)
    if not job:
        raise HTTPException(404, f"任务不存在（job={job_id[:8]}）")
    if not _is_admin(user) and job.get("user_id") != user["id"]:
        raise HTTPException(404, f"任务不存在（job={job_id[:8]}）")
    # 状态查询只读，不根据任务年龄擅自判失败。智能路由完整跑完后由后台任务写入最终状态。
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
    request_meta = job.get("request_meta") if isinstance(job.get("request_meta"), dict) else {}
    operation = str(request_meta.get("operation") or "")
    outpainting = None
    if operation == "outpainting":
        outpainting = {
            key: request_meta.get(key)
            for key in (
                "provider_task_id",
                "provider_task_uuid",
                "processing_width",
                "processing_height",
                "top",
                "right",
                "bottom",
                "left",
                "expected_width",
                "expected_height",
                "phase",
                "cost",
                "actual_width",
                "actual_height",
                "retryable",
                "retry_action",
                "recovery_attempt",
            )
            if key in request_meta
        }
        # Cached clients must not regenerate historical jobs based on the old ambiguous flag.
        outpainting["retryable"] = False
    error_text = job.get("error") or ""
    # Smart-routed generation errors use a generic two-round message. Operation-specific
    # workers (layer_extract, outpainting, matting, upscale, vectorize) already persist
    # bounded public errors and must not be rewritten here.
    if job.get("status") == "failed" and operation in {"", "generate"} and not request_meta.get("recovery"):
        public_error = public_generation_error(error_text)
        should_update_error = str(error_text).strip() != public_error
        error_text = public_error
        if not should_update_error:
            should_update_error = not str(job.get("error") or "").strip()
    else:
        should_update_error = False
    if should_update_error:
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
        "variant": request_meta.get("variant") or "flare",
        "quality": request_meta.get("quality") or "auto",
        "provider": job.get("provider"),
        "error": error_text or None,
        "providerSwitched": bool(job.get("provider_switched")),
        "layer_extract": layer_extract,
        "outpainting": outpainting,
        "recovering": bool((request_meta.get("recovery") or {}).get("resuming")) and job["status"] not in {"done", "failed"},
        "message": (
            (request_meta.get("recovery") or {}).get("message") or
            (f"正在恢复原扩图任务（第 {request_meta['recovery_attempt']}/3 次尝试）"
            if operation == "outpainting" and job.get("status") == "processing"
            and int(request_meta.get("recovery_attempt") or 1) > 1 else None)
        ),
        "cost": outpainting.get("cost") if outpainting else None,
    }


def _expected_retry_reference_count(
    old_job: dict[str, Any], request_meta: dict[str, Any]
) -> int:
    """返回重试时应校验的参考图数量，优先以任务实际保存数量为准。"""
    expected_manual_count = int(request_meta.get("manual_reference_count") or 0)
    expected_context_count = int(request_meta.get("context_reference_count") or 0)
    stored_reference_count = int(old_job.get("reference_count") or 0)
    if stored_reference_count > 0:
        return stored_reference_count
    return max(
        expected_manual_count + expected_context_count,
        1 if old_job.get("has_reference") else 0,
    )


@app.post("/ai-image/retry")
async def ai_image_retry(request: Request):
    """生图失败或重新生成时触发智能重试。复用上下文集成后的完整 prompt + 磁盘参考图 + 上下文参考图。"""
    body = await request.json()
    job_id = (body.get("job_id") or "").strip()
    session_id = (body.get("session_id") or "").strip()
    if not job_id:
        raise HTTPException(400, "job_id 不能为空")

    user = _current_user(request)
    old_job = load_ai_image_job(job_id)
    if not old_job:
        raise HTTPException(404, "任务不存在")
    if old_job.get("user_id") != user["id"]:
        raise HTTPException(404, "任务不存在")

    request_meta = old_job.get("request_meta") if isinstance(old_job.get("request_meta"), dict) else {}
    if not session_id:
        session_id = str(request_meta.get("chat_session_id") or "").strip()

    prompt = (old_job.get("prompt") or "").strip()
    original_prompt = (old_job.get("original_prompt") or "").strip()
    resolved_prompt = (old_job.get("resolved_prompt") or prompt).strip()
    effective_prompt = resolved_prompt or prompt
    prompt_trace = old_job.get("prompt_trace") or ""
    model = (old_job.get("model") or "gpt-image-2.5").strip()
    # FLUX 换装任务的参考图已是 [人物图, 服装拼图]，重试必须仍走 BFL
    retry_provider = PROVIDER_BFL if model == FLUX_VTO_MODEL else PROVIDER_AUTO
    size = (old_job.get("size") or "1024x1024").strip()
    resolution = (old_job.get("resolution") or "").strip()
    variant = str(request_meta.get("variant") or "flare").strip().lower()
    if variant not in {"flare", "sunburst"}:
        variant = "flare"
    quality = str(request_meta.get("quality") or "auto").strip().lower()
    if quality not in {"auto", "low", "medium", "high", "xhigh", "max"}:
        quality = "auto"

    # 1. 优先加载原任务完整持久化的准确参考图集合。
    # 批量任务和链式重试可能共用同一个参考图目录。
    reference_storage_job_id = str(request_meta.get("reference_storage_job_id") or job_id).strip()
    persisted_refs = load_user_refs(user["id"], reference_storage_job_id)
    all_refs: list[tuple[bytes, str]] = []
    expected_manual_count = int(request_meta.get("manual_reference_count") or 0)
    expected_context_count = int(request_meta.get("context_reference_count") or 0)
    expected_reference_count = _expected_retry_reference_count(old_job, request_meta)
    if persisted_refs:
        # 原任务持久化目录完好，直接准确复用原参考图，顺序严格一致
        all_refs = persisted_refs[:9]
        if len(all_refs) < expected_reference_count:
            raise HTTPException(
                409,
                "原任务的参考图文件不完整，请重新上传参考图后再生成",
            )
        touch_user_refs(user["id"], reference_storage_job_id)
    else:
        # 兼容旧任务（历史已清理任务）：用户手动上传的原图无法推测，不能静默丢失。
        if expected_manual_count > 0:
            raise HTTPException(
                409,
                "原任务的参考图文件已不可用，请重新上传参考图后再生成",
            )
        # 仅尝试恢复明确记录过的上下文图，并严格从原任务之前的消息查找。
        context_ref_bytes: list[tuple[bytes, str]] = []
        context_url = str(request_meta.get("context_image_url") or "").strip()
        if not context_url and session_id and expected_context_count:
            prev_messages = load_ai_chat_messages(session_id, user_id=user["id"])
            job_idx = -1
            for idx_m, m in enumerate(prev_messages):
                if (m.get("jobId") or m.get("id")) == job_id:
                    job_idx = idx_m
                    break
            search_scope = prev_messages[:job_idx] if job_idx > 0 else prev_messages
            for m in reversed(search_scope):
                if (m.get("jobId") or m.get("id")) == job_id:
                    continue
                p_url = m.get("imageUrl") or ""
                if p_url and p_url.startswith("/ai-images/"):
                    context_url = p_url
                    break
        if context_url and context_url.startswith("/ai-images/"):
            local_path = settings.output_path / "ai-images" / context_url[len("/ai-images/"):]
            try:
                if local_path.exists():
                    context_ref_bytes.append((local_path.read_bytes(), local_path.name))
            except Exception:
                pass
        all_refs = context_ref_bytes[:9]
        if expected_reference_count and len(all_refs) < expected_reference_count:
            raise HTTPException(
                409,
                "原任务的参考图文件已不可用，请重新上传参考图后再生成",
            )

    has_reference = bool(all_refs)
    new_job_id = uuid.uuid4().hex
    # 重试任务复用原任务/批次的参考图目录，避免链式重试不断复制大文件。
    if all_refs:
        touch_user_refs(user["id"], reference_storage_job_id)

    created_at = time.time()
    save_ai_image_job(
        job_id=new_job_id, user_id=user["id"], status="processing",
        model=model, prompt=effective_prompt, size=size,
        provider=retry_provider, resolution=resolution,
        original_prompt=original_prompt or prompt, resolved_prompt=effective_prompt,
        prompt_trace=prompt_trace,
        has_reference=has_reference, reference_count=len(all_refs),
        request_meta={
            "chat_session_id": session_id,
            "retry_from": job_id,
            "recovery": {"version": 1, "phase": "queued"},
            "execution_prompt": effective_prompt,
            "reference_storage_job_id": reference_storage_job_id,
            "variant": variant,
            "quality": quality,
            "manual_reference_count": (
                int(request_meta["manual_reference_count"])
                if "manual_reference_count" in request_meta
                else len(all_refs)
            ),
            "context_reference_count": (
                int(request_meta["context_reference_count"])
                if "context_reference_count" in request_meta
                else 0
            ),
            "context_image_url": str(request_meta.get("context_image_url") or ""),
            "reference_names": [name for _content, name in all_refs],
        },
        created_at=created_at,
    )
    log_operation(
        user_id=user["id"], username=user["username"],
        action="ai_image",
        detail=f"job={new_job_id[:8]} model={model} size={size} result=retry_auto refs={len(all_refs)}",
        payload=json.dumps({"job_id": new_job_id, "model": model, "size": size, "provider": retry_provider, "retry_from": job_id}, ensure_ascii=False),
    )
    # 重试消息不重新写入聊天记录（不重复显示 prompt），后台任务完成/失败时会自动追加
    _track_ai_image_task(
        _run_ai_image_background(
            job_id=new_job_id, user_id=user["id"], username=user["username"],
            session_id=session_id,
            provider=retry_provider,
            model=model, prompt=effective_prompt,
            size=size, resolution=resolution,
            variant=variant, quality=quality,
            refs=all_refs, has_reference=has_reference, created_at=created_at,
            original_prompt=original_prompt or prompt, resolved_prompt=effective_prompt,
            ref_previews=[],
            prompt_trace=prompt_trace,
            request_meta={
                "chat_session_id": session_id,
                "retry_from": job_id,
                "recovery": {"version": 1, "phase": "queued"},
                "execution_prompt": effective_prompt,
                "reference_storage_job_id": reference_storage_job_id,
                "variant": variant,
                "quality": quality,
                "manual_reference_count": (
                    int(request_meta["manual_reference_count"])
                    if "manual_reference_count" in request_meta
                    else len(all_refs)
                ),
                "context_reference_count": (
                    int(request_meta["context_reference_count"])
                    if "context_reference_count" in request_meta
                    else 0
                ),
                "context_image_url": str(request_meta.get("context_image_url") or ""),
                "reference_names": [name for _content, name in all_refs],
            },
        )
    )
    return {
        "job_id": new_job_id,
        "status": "processing",
        "provider": retry_provider,
        "resolved_prompt": effective_prompt,
        "original_prompt": original_prompt or prompt,
        "prompt_trace": prompt_trace,
        "model": model,
        "size": size,
        "resolution": resolution,
        "variant": variant,
        "quality": quality,
    }


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
        model=job.get("model") or "gpt-image-2.5",
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
    if not get_model_routes("vlm"):
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
        resp = await routed_chat_completion("vlm", {
            "messages": messages, "temperature": 0.2,
        }, timeout=60)
        endpoint = str(resp.extensions.get("model_route", {}).get("provider") or "model-route")
        if not resp.is_success:
            logger.warning("Image description service failed: provider=%s status=%s", endpoint, resp.status_code)
            # A provider's authentication failure is not the user's expired login session.
            raise HTTPException(502, "图片分析服务暂时不可用，请稍后再试。")

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
    deleted_record_ids = body.get("deleted_record_ids") if isinstance(body, dict) else None
    if not isinstance(deleted_record_ids, list):
        deleted_record_ids = None

    raw = json.dumps(snapshot, ensure_ascii=False) if not isinstance(snapshot, str) else snapshot
    ok, rev, reason = await asyncio.to_thread(
        save_editor_snapshot,
        user["id"],
        raw,
        base_revision=base_revision,
        intent=intent,
        deleted_record_ids=deleted_record_ids,
    )
    if not ok:
        raise HTTPException(
            status_code=409,
            detail={"saved": False, "reason": reason or "snapshot_rejected", "current_revision": rev},
        )
    return {"saved": True, "revision": rev}


_EDITOR_ASSET_SUFFIXES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
_EDITOR_ASSET_MAX_BYTES = 30 * 1024 * 1024


@app.post("/editor/assets")
async def editor_upload_asset(request: Request, image: UploadFile = File(...)):
    """Persist a tldraw image outside the snapshot so autosaves stay small."""
    user = _current_user(request)
    content_type = str(image.content_type or "").split(";", 1)[0].strip().lower()
    suffix = _EDITOR_ASSET_SUFFIXES.get(content_type)
    if not suffix:
        raise HTTPException(400, "仅支持 PNG、JPEG、WebP 或 GIF 图片")

    payload = await image.read(_EDITOR_ASSET_MAX_BYTES + 1)
    if not payload:
        raise HTTPException(400, "图片内容为空")
    if len(payload) > _EDITOR_ASSET_MAX_BYTES:
        raise HTTPException(413, "图片大小不能超过 30 MB")

    safe_user_id = "".join(
        ch for ch in str(user["id"]).strip() if ch.isalnum() or ch in ("-", "_")
    )
    if not safe_user_id:
        raise HTTPException(400, "用户 ID 无效")
    asset_dir = settings.output_path / "ai-images" / safe_user_id / "editor-assets"
    asset_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{suffix}"
    (asset_dir / filename).write_bytes(payload)
    return {"url": f"/ai-images/{quote(safe_user_id)}/editor-assets/{filename}"}


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
    if isinstance(snapshot, str):
        try:
            snapshot = json.loads(snapshot)
        except Exception:
            return []
    if not isinstance(snapshot, dict):
        return []

    prefix = "/ai-images/"
    foreign: list[str] = []

    # 兼容新版无限画布格式 (version 2)
    if isinstance(snapshot.get("images"), list):
        for im in snapshot["images"]:
            if not isinstance(im, dict):
                continue
            raw_url = str(im.get("url") or im.get("src") or "").strip()
            if not raw_url:
                continue
            try:
                path = urlsplit(raw_url).path if "://" in raw_url else raw_url.split("?", 1)[0]
            except Exception:
                path = raw_url
            if not path.startswith(prefix):
                continue
            after_prefix = path[len(prefix):]
            if "/" not in after_prefix:
                continue
            owner = unquote(after_prefix.split("/", 1)[0])
            if owner and owner != user_id:
                foreign.append(raw_url)
        return foreign

    store = snapshot.get("store")
    document = snapshot.get("document")
    if not isinstance(store, dict) and isinstance(document, dict):
        store = document.get("store")
    if not isinstance(store, dict):
        return []

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
        after_prefix = path[len(prefix):]
        if "/" not in after_prefix:
            continue
        owner = unquote(after_prefix.split("/", 1)[0])
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
    display_prompt: str = Form(""),
    size: str = Form("1024x1024"),
    resolution: str = Form(""),
    variant: str = Form("flare"),
    quality: str = Form("auto"),
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
        "ai_image_endpoint_enter client=%s model=%s variant=%s quality=%s provider=%s size=%s batch=%s refs=%s user=%s",
        client_req,
        model,
        variant,
        quality,
        provider or "-",
        size,
        batch_count,
        len(image or []),
        user_early.get("username") or user_early.get("id") or "-",
    )
    batch_count = max(1, min(int(batch_count or 1), 4))
    variant = (variant or "flare").strip().lower()
    if variant not in {"flare", "sunburst"}:
        variant = "flare"
    quality = (quality or "auto").strip().lower()
    if quality not in {"auto", "low", "medium", "high", "xhigh", "max"}:
        quality = "auto"
    original_prompt = prompt.strip()
    # 展示文案单独持久化；局部编辑坐标等完整指令仍用于生图、任务元数据和重试。
    display_prompt = display_prompt.strip() or original_prompt
    ref_previews_list = []
    try:
        ref_previews_list = json.loads(ref_previews or "[]")
        if not isinstance(ref_previews_list, list):
            ref_previews_list = []
    except (json.JSONDecodeError, TypeError):
        ref_previews_list = []
    if not original_prompt:
        raise HTTPException(400, "prompt 不能为空")

    resolved = normalize_model_name(model.lower())
    if not resolved:
        raise HTTPException(400, f"未知模型: {model}")
    try:
        resolved_provider = normalize_provider(provider)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    active_skill_name = (skill or "").strip()
    active_skill_context = ""
    active_skill_meta = None
    user = _current_user(request)
    if active_skill_name:
        active_skill_context, active_skill_meta = _load_active_skill_context(active_skill_name, user)
    job_id = uuid.uuid4().hex
    session_id = (chat_session_id or "").strip()
    session = get_ai_chat_session(session_id, user_id=user["id"]) if session_id else None
    if not session:
        session = create_ai_chat_session(user_id=user["id"], title=_build_ai_chat_title(display_prompt), created_at=time.time())
        session_id = session["id"]

    images = image[:9] if image else []
    created_at = time.time()
    append_ai_chat_message(
        session_id=session_id,
        user_id=user["id"],
        role="user",
        type="user_text",
        text=display_prompt,
        meta={"model": resolved, "size": size, "resolution": resolution, "variant": variant, "quality": quality, "refPreviews": ref_previews_list, "batchCount": batch_count, "skill": active_skill_name},
        created_at=created_at,
    )
    try:
        # —— 上下文注入（对用户透明）——
        enriched_prompt = original_prompt
        prompt_trace_payload: dict = {}
        prompt_trace_text = (prompt_trace or "").strip()
        context_ref_bytes: list[tuple[bytes, str]] = []

        # 1. 找上一张生成的图，并用 VLM 判断本轮是修改、重新生成还是全新需求
        prev_messages = load_ai_chat_messages(session_id, user_id=user["id"])
        # 本轮用户消息已写入会话，判断时只看之前的历史
        history_messages = [m for m in prev_messages if m.get("who") in ("user", "ai")][:-1]
        prev_image_url = ""
        prev_image_path: Path | None = None
        for m in reversed(prev_messages):
            prev_url = m.get("imageUrl") or ""
            if prev_url and prev_url.startswith("/ai-images/"):
                local_path = settings.output_path / "ai-images" / prev_url[len("/ai-images/"):]
                if local_path.is_file():
                    prev_image_url, prev_image_path = prev_url, local_path
                    break
        if history_messages:
            context_intent = await _judge_context_intent(
                history_messages, original_prompt, prev_image_path, has_user_refs=bool(images),
            )
        else:
            context_intent = {"mode": "new", "reason": "会话首轮", "source": "rule"}

        # 2. LLM 根据历史改写 prompt（全新需求不改写）
        if context_intent["mode"] != "new" and get_model_routes("chat_llm"):
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

        # 3. 只有在上一张图基础上修改时，才把它作为参考图
        context_ref_url = ""
        if context_intent["mode"] == "edit" and prev_image_path:
            try:
                context_ref_bytes.append((prev_image_path.read_bytes(), prev_image_path.name))
                context_ref_url = prev_image_url
                logger.info("Using previous image as reference: %s", prev_image_path.name)
            except Exception:
                pass

        # 4. 合并用户上传的参考图与上下文的参考图
        user_refs: list[tuple[bytes, str]] = []
        for i, f in enumerate(images):
            user_refs.append(await _aread_reference_upload(f, index=i))

        has_reference = bool(images) or bool(context_ref_bytes)
        # 批次模式：N 个独立 job 共享同样的 session/参数；batch_id 用于把 N 条结果聚合成一张多图卡
        batch_id = uuid.uuid4().hex if batch_count > 1 else ""
        job_ids: list[str] = []
        saved_reference_storage_id = ""
        stored_reference_urls: list[str] = []
        for _idx in range(batch_count):
            jid = uuid.uuid4().hex
            job_ids.append(jid)
            # 用户可见参考图在前，保持 @图片N 与前端编号一致；
            # 会话续图的隐藏上下文图追加在后。
            all_refs_batch: list[tuple[bytes, str]] = user_refs + context_ref_bytes
            all_refs_batch = all_refs_batch[:9]  # 总共最多 9 张
            # 截断后记录实际参与本任务的分类数量，避免重试把截断前数量当成完整性要求。
            actual_manual_count = min(len(user_refs), len(all_refs_batch))
            actual_context_count = max(0, len(all_refs_batch) - actual_manual_count)
            # 同一批任务共享参考图目录，避免为每个 job 重复保存大文件。
            reference_storage_id = batch_id or jid
            if all_refs_batch and reference_storage_id != saved_reference_storage_id:
                try:
                    ref_paths = save_user_refs(user["id"], reference_storage_id, all_refs_batch)
                    stored_reference_urls = []
                    for ref_path in ref_paths:
                        try:
                            stored_reference_urls.append(_ai_image_public_url(Path(ref_path)))
                        except Exception:
                            stored_reference_urls.append("")
                    saved_reference_storage_id = reference_storage_id
                except Exception:
                    logger.exception("Failed to save user refs for %s", reference_storage_id)
                    raise

            reference_images = []
            for i, (_content, name) in enumerate(all_refs_batch[:actual_manual_count]):
                reference_images.append({
                    "type": "manual",
                    "name": name,
                    "url": stored_reference_urls[i] if i < len(stored_reference_urls) else "",
                    "label": f"用户参考图 {i + 1}",
                })
            if actual_context_count and context_ref_url:
                reference_images.append({
                    "type": "context",
                    "name": Path(context_ref_url).name,
                    "url": context_ref_url,
                    "label": "上下文关联图",
                })
            request_meta = {
                "client_request_id": client_req,
                "recovery": {"version": 1, "phase": "queued"},
                "execution_prompt": enriched_prompt,
                "chat_session_id": session_id,
                "skill": active_skill_name,
                "variant": variant,
                "quality": quality,
                "batch_id": batch_id,
                "batch_index": _idx,
                "batch_count": batch_count,
                "reference_storage_job_id": reference_storage_id,
                "manual_reference_count": actual_manual_count,
                "context_reference_count": actual_context_count,
                "context_reference_url": context_ref_url if context_ref_bytes else "",
                "context_image_url": context_ref_url if context_ref_bytes else "",
                "context_intent": context_intent,
                "reference_names": [name for _content, name in all_refs_batch],
                "reference_images": reference_images,
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
                resolved_prompt=enriched_prompt,
                prompt_trace=json.dumps(prompt_trace_payload, ensure_ascii=False) if prompt_trace_payload else prompt_trace_text,
                has_reference=has_reference,
                reference_count=len(all_refs_batch),
                request_meta=request_meta,
                created_at=created_at,
            )
            log_operation(
                user_id=user["id"], username=user["username"],
                action="ai_image",
                detail=f"job={jid[:8]} client={client_req} model={resolved} variant={variant} quality={quality} size={size} prompt={original_prompt[:50]}{'...' if len(original_prompt) > 50 else ''} refs={len(all_refs_batch)} batch={batch_count}",
                payload=json.dumps({
                    "job_id": jid, "client_request_id": client_req, "model": resolved, "variant": variant, "quality": quality, "size": size,
                    "prompt": original_prompt[:200], "refs": len(all_refs_batch),
                    "provider": resolved_provider, "batch_count": batch_count, "skill": active_skill_name,
                }, ensure_ascii=False),
            )
            _track_ai_image_task(
                _run_ai_image_background(
                    job_id=jid, user_id=user["id"], username=user["username"],
                    session_id=session_id,
                    provider=resolved_provider,
                    model=resolved, prompt=enriched_prompt,
                    size=size, resolution=resolution,
                    variant=variant, quality=quality,
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
                    "variant": variant,
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


# ─── AI 换装：参考图生图 ─────────────────────────────────────────────────────

OUTFIT_MAX_SOURCE_BYTES = 20 * 1024 * 1024
OUTFIT_MODELS = {"gpt-image-2.5", FLUX_VTO_MODEL}


async def _read_outfit_upload(upload: UploadFile, *, label: str) -> bytes:
    content = await upload.read(OUTFIT_MAX_SOURCE_BYTES + 1)
    if not content:
        raise HTTPException(400, f"{label}为空")
    if len(content) > OUTFIT_MAX_SOURCE_BYTES:
        raise HTTPException(400, f"{label}不能超过 20MB")
    return content


async def _prepare_outfit_image(content: bytes, name: str, *, label: str) -> tuple[bytes, str, int, int]:
    try:
        return await asyncio.to_thread(outfit_change.prepare_reference_image, content, name)
    except Exception as exc:
        raise HTTPException(400, f"{label}无法解析，请确认是 PNG/JPG/WEBP 图片") from exc


def _parse_json_form(raw: str, default, *, field: str):
    if not (raw or "").strip():
        return default
    try:
        value = json.loads(raw)
    except (json.JSONDecodeError, TypeError) as exc:
        raise HTTPException(400, f"{field} 不是合法 JSON") from exc
    return value if isinstance(value, type(default)) else default


@app.post("/ai-image/outfit-change")
@_ai_image_submit_dedup
async def ai_image_outfit_change(
    request: Request,
    image: UploadFile = File(...),
    assets: str = Form("[]"),
    uploads: List[UploadFile] = File(default=[]),
    upload_slots: str = Form("[]"),
    upload_items: str = Form("[]"),
    target_slots: str = Form("[]"),
    extra_prompt: str = Form(""),
    model: str = Form(""),
    resolution: str = Form("1K"),
    batch_count: int = Form(1),
    source_name: str = Form(""),
    client_request_id: str = Form(""),
):
    """AI 换装：原图 + 勾选的素材角度图，以参考图生图模式提交（内置换装 prompt）。

    assets: [{"sku": "...", "asset_type": "white", "path": "SKU_2.png", "angle": "角度 2"}]
    返回结构与 /ai-image 一致（job_id / job_ids），前端轮询 GET /ai-image/{job_id}。
    """
    user = _current_user(request)
    client_req = _sanitize_log_field(
        (client_request_id or "").strip() or (request.headers.get("x-client-request-id") or "").strip() or "-",
        64,
    )
    model_key = (model or settings.outfit_default_model or "gpt-image-2.5").strip().lower()
    if model_key not in OUTFIT_MODELS:
        raise HTTPException(400, f"AI 换装不支持模型: {model}")
    # FLUX 走 BFL 官方虚拟试穿接口（人物图 + 单张服装拼图），其余模型走通用参考图生图
    is_flux = model_key == FLUX_VTO_MODEL
    if is_flux and not settings.bfl_api_key:
        raise HTTPException(503, "FLUX 换装未配置 BFL_API_KEY")
    resolved_model = FLUX_VTO_MODEL if is_flux else normalize_model_name(model_key)
    outfit_provider = PROVIDER_BFL if is_flux else PROVIDER_AUTO
    resolution = (resolution or "1K").strip().upper()
    if resolution not in {"1K", "2K", "4K"}:
        resolution = "1K"
    if is_flux and resolution == "4K":
        # vto-v2 输出尺寸跟随人物图，官方上限约 4MP，达不到 4K
        raise HTTPException(400, "FLUX 换装最高支持 2K（约 4MP），4K 请使用 GPT Image 2.5")
    batch_count = max(1, min(int(batch_count or 1), 4))

    asset_list = _parse_json_form(assets, [], field="assets")
    target_slot_list = [
        str(x).strip().lower()
        for x in _parse_json_form(target_slots, [], field="target_slots")
        if str(x).strip()
    ][:12]
    upload_slot_list = [
        str(x).strip().lower()
        for x in _parse_json_form(upload_slots, [], field="upload_slots")
    ]
    upload_item_list = [
        outfit_change.normalize_item(x)
        for x in _parse_json_form(upload_items, [], field="upload_items")
    ]
    uploads = uploads or []

    garment_total = len(asset_list) + len(uploads)
    if garment_total == 0:
        raise HTTPException(400, "请至少勾选一张素材图")
    if garment_total > outfit_change.MAX_GARMENT_REFERENCES:
        raise HTTPException(400, f"素材图最多 {outfit_change.MAX_GARMENT_REFERENCES} 张（含原图共 9 张）")

    # 1. 原图
    source_bytes = await _read_outfit_upload(image, label="原图")
    source_ref = await _prepare_outfit_image(source_bytes, "source", label="原图")
    size = outfit_change.nearest_aspect_ratio(source_ref[2], source_ref[3])

    # 2. 素材库角度图（服务端直接读库，前端只传定位信息）
    refs: list[tuple[bytes, str]] = [(source_ref[0], source_ref[1])]
    ref_meta: list[dict] = []
    for idx, item in enumerate(asset_list):
        if not isinstance(item, dict):
            raise HTTPException(400, "assets 格式错误")
        asset_type = str(item.get("asset_type") or "").strip()
        rel_path = str(item.get("path") or "").strip()
        try:
            file_path = await asyncio.to_thread(outfit_change.resolve_library_asset, asset_type, rel_path)
            raw = await asyncio.to_thread(file_path.read_bytes)
        except FileNotFoundError:
            raise HTTPException(404, f"素材图不存在：{rel_path}")
        except ValueError as exc:
            raise HTTPException(400, f"{exc}：{rel_path}")
        prepared = await _prepare_outfit_image(raw, file_path.stem, label=f"素材图 {file_path.name}")
        refs.append((prepared[0], f"{idx + 2:02d}_{prepared[1]}"))
        sku_value = str(item.get("sku") or "").strip()[:64]
        slot_value = str(item.get("slot") or "").strip().lower()[:32]
        item_value = outfit_change.normalize_item(item.get("item"))
        ref_meta.append({
            "source": "library",
            "sku": sku_value,
            "slot": slot_value,
            "item": item_value,
            "asset_type": asset_type,
            "type_label": outfit_change.ASSET_TYPE_LABELS.get(asset_type, asset_type),
            "path": rel_path,
            "angle": str(item.get("angle") or "").strip()[:20]
                     or outfit_change.angle_label_from_name(file_path.stem, sku_value),
        })

    # 3. 用户本地上传的素材（素材库缺图时的兜底）
    for idx, upload in enumerate(uploads):
        label = f"上传素材 {idx + 1}"
        raw = await _read_outfit_upload(upload, label=label)
        prepared = await _prepare_outfit_image(raw, Path(upload.filename or "upload").stem, label=label)
        refs.append((prepared[0], f"{len(refs) + 1:02d}_{prepared[1]}"))
        upload_slot = upload_slot_list[idx] if idx < len(upload_slot_list) else ""
        upload_item = upload_item_list[idx] if idx < len(upload_item_list) else ""
        ref_meta.append({
            "source": "upload",
            "sku": "",
            "slot": upload_slot,
            "item": upload_item,
            "asset_type": "upload",
            "type_label": "本地上传",
            "path": (upload.filename or "")[:120],
            "angle": label,
        })

    prompt = outfit_change.build_outfit_prompt(
        references=ref_meta,
        target_slots=target_slot_list,
        extra_prompt=extra_prompt,
    )
    if is_flux:
        garment_board = await asyncio.to_thread(
            outfit_change.compose_garment_board, [content for content, _name in refs[1:]]
        )
        person = await asyncio.to_thread(
            outfit_change.fit_person_image, source_bytes, 4.0 if resolution == "2K" else 1.0
        )
        refs = [(person, "01_person.jpg"), (garment_board, "02_garments.jpg")]
        prompt = outfit_change.build_vto_prompt(
            references=ref_meta,
            target_slots=target_slot_list,
            extra_prompt=extra_prompt,
        )
    skus = list(dict.fromkeys(m["sku"] for m in ref_meta if m["sku"]))
    slot_labels = [
        outfit_change.PRESET_SLOTS.get(s, {}).get("label") or outfit_change.GARMENT_SLOTS.get(s, s)
        for s in target_slot_list
    ]
    slot_desc = f"（{'、'.join(slot_labels)}）" if slot_labels else ""
    display_prompt = f"AI 换装{slot_desc}：{'、'.join(skus) if skus else '本地素材'}"
    if extra_prompt.strip():
        display_prompt += f"（{extra_prompt.strip()[:60]}）"

    created_at = time.time()
    session = create_ai_chat_session(user_id=user["id"], title=_build_ai_chat_title(display_prompt), created_at=created_at)
    session_id = session["id"]
    append_ai_chat_message(
        session_id=session_id,
        user_id=user["id"],
        role="user",
        type="user_text",
        text=display_prompt,
        meta={"model": resolved_model, "size": size, "resolution": resolution, "batchCount": batch_count, "operation": "outfit-change"},
        created_at=created_at,
    )

    batch_id = uuid.uuid4().hex if batch_count > 1 else ""
    reference_storage_id = batch_id or uuid.uuid4().hex
    stored_urls: list[str] = []
    try:
        for ref_path in save_user_refs(user["id"], reference_storage_id, refs):
            stored_urls.append(_ai_image_public_url(Path(ref_path)))
    except Exception:
        logger.warning("outfit: failed to save refs for %s", reference_storage_id, exc_info=True)
        raise HTTPException(503, "参考图暂时无法保存，请稍后重试")

    reference_images = [{
        "type": "manual",
        "name": refs[0][1],
        "url": stored_urls[0] if stored_urls else "",
        "label": "图1 · 原图",
    }]
    if is_flux:
        reference_images.append({
            "type": "manual",
            "name": refs[1][1],
            "url": stored_urls[1] if len(stored_urls) > 1 else "",
            "label": f"图2 · 服装拼图（{len(ref_meta)} 张素材）",
        })
    else:
        for i, meta in enumerate(ref_meta):
            label_bits = [b for b in (meta["sku"], meta["type_label"], meta["angle"]) if b]
            reference_images.append({
                "type": "manual",
                "name": refs[i + 1][1],
                "url": stored_urls[i + 1] if i + 1 < len(stored_urls) else "",
                "label": f"图{i + 2} · {' / '.join(label_bits)}",
            })

    job_ids: list[str] = []
    for batch_index in range(batch_count):
        jid = uuid.uuid4().hex
        job_ids.append(jid)
        request_meta = {
            "operation": "outfit-change",
            "recovery": {"version": 1, "phase": "queued"},
            "execution_prompt": prompt,
            "client_request_id": client_req,
            "chat_session_id": session_id,
            "variant": "flare",
            "quality": "auto",
            "batch_id": batch_id,
            "batch_index": batch_index,
            "batch_count": batch_count,
            "reference_storage_job_id": reference_storage_id,
            "manual_reference_count": len(refs),
            "context_reference_count": 0,
            "reference_names": [name for _content, name in refs],
            "reference_images": reference_images,
            "outfit": {
                "skus": skus,
                "assets": ref_meta,
                "target_slots": target_slot_list,
                "source_name": (source_name or "")[:120],
                "extra_prompt": extra_prompt.strip()[:500],
            },
        }
        save_ai_image_job(
            job_id=jid, user_id=user["id"], status="processing",
            model=resolved_model, prompt=display_prompt, size=size,
            provider=outfit_provider, resolution=resolution,
            original_prompt=display_prompt, resolved_prompt=prompt,
            has_reference=True, reference_count=len(refs),
            request_meta=request_meta, created_at=created_at,
        )
        log_operation(
            user_id=user["id"], username=user["username"],
            action="ai_image",
            detail=f"outfit job={jid[:8]} client={client_req} model={resolved_model} size={size} skus={','.join(skus)[:60]} refs={len(refs)} batch={batch_count}",
            payload=json.dumps({
                "job_id": jid, "operation": "outfit-change", "client_request_id": client_req,
                "model": resolved_model, "size": size, "resolution": resolution,
                "skus": skus, "refs": len(refs), "batch_count": batch_count,
            }, ensure_ascii=False),
        )
        _track_ai_image_task(
            _run_ai_image_background(
                job_id=jid, user_id=user["id"], username=user["username"],
                session_id=session_id,
                provider=outfit_provider,
                model=resolved_model, prompt=prompt,
                size=size, resolution=resolution,
                variant="flare", quality="auto",
                refs=refs, has_reference=True, created_at=created_at,
                original_prompt=display_prompt, resolved_prompt=prompt,
                request_meta=request_meta,
                batch_id=batch_id, batch_index=batch_index, batch_count=batch_count,
            )
        )

    response = {
        "chat_session_id": session_id,
        "status": "processing",
        "client_request_id": client_req,
        "resolved_prompt": prompt,
        "size": size,
        "model": resolved_model,
    }
    if batch_count == 1:
        response["job_id"] = job_ids[0]
    else:
        response["job_ids"] = job_ids
        response["batch_id"] = batch_id
    return response


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
async def chat_endpoint(req: ChatRequest, request: Request):
    """
    AI 对话接口：Sub2API 优先、APIMart 兜底，注入平台上下文和工作台状态。
    """
    if not get_model_routes("chat_llm"):
        raise HTTPException(503, "未配置 Sub2API/APIMart LLM")

    # 构建工作台状态描述；前端未传的字段不写，避免误导 AI 认为用户什么都没做
    ctx = req.context
    state_lines = []
    if ctx.templateName:
        state_lines.append(f"- 已选模板：{ctx.templateName}（{ctx.templateSlotCount or '?'} 个插槽）")
    if ctx.productCount:
        state_lines.append(f"- 已载入 {ctx.productCount} 个产品数据")
    if ctx.jobStatus == "done":
        state_lines.append("- 上次任务已完成")
    elif ctx.jobStatus in ("pending", "running"):
        state_lines.append("- 有任务正在进行中")
    elif ctx.jobStatus == "failed":
        state_lines.append("- 上次任务失败")

    # 仅在会话首条消息注入完整知识库，后续消息使用精简上下文（LLM 已有记忆）
    is_first_message = not req.messages or len(req.messages) <= 1
    knowledge_block = (settings._load_knowledge() or "（暂无知识库文档）") if is_first_message else ""

    system_prompt = """你是 DesignFlow（鑫乐纪AI视觉创作平台）的 AI 设计助手，用户正在使用「问答」功能向你提问。DesignFlow 是 AI 驱动的电商设计工作台。

平台主要用法：
1. 在输入框左下角「选择功能」里选择要做的事：问答、AI 生图（GPT Image 2.5 / GPT Image 2 / Nano Banana Pro / Nano Banana 2.1 / Seedream 5.0）、智能铺货、特殊品
2. 在「参数设置」里选比例、清晰度、并发数等，输入描述、SKU 或上传参考图/表格后发送
3. 结果出现在对话区，可放入中间的无限画布继续排版，并在画布上扩图、抠图、高清放大、换装等"""

    if state_lines:
        system_prompt += "\n\n当前用户工作台状态：\n" + "\n".join(state_lines)

    if knowledge_block:
        system_prompt += f"""

以下是平台的完整功能文档，请严格基于此文档回答用户关于功能使用、操作方法的问题：

---
{knowledge_block}
---"""

    skill_context = ""
    skill_meta = None
    if ctx.skill:
        skill_context, skill_meta = _load_active_skill_context(ctx.skill, getattr(request.state, "user", None))
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
- 如果用户想执行操作，引导他们在功能菜单和参数面板中操作，不要提及已不存在的 / 指令
- 可以解答电商设计、产品海报相关的专业问题
- 语气自然、简洁，不要过度列举，像真人同事一样沟通
- 回复使用中文，长度适中（2-5句为佳），绝对不要在句子中间截断，必须说完整
- 不要总结步骤列表，除非用户明确询问操作流程"""

    messages = [{"role": "system", "content": system_prompt}]
    messages += [{"role": m.role, "content": m.content} for m in req.messages]

    try:
        resp = await routed_chat_completion("chat_llm", {
            "messages": messages, "max_tokens": 2048, "temperature": 0.8,
        }, timeout=settings.chat_llm_timeout_seconds)
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc

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
    skill: str = "",
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
        skill=skill or None,
    )
    return {
        "tasks": tasks,
        "total": total,
        "limit": max(1, min(limit, 200)),
        "offset": max(0, offset),
    }


def _admin_reference_images(detail: dict) -> list[dict]:
    """优先展示持久化原图，兼容只有参考图目录或预览地址的历史任务。"""
    meta = detail.get("request") or {}
    images: list[dict] = []
    seen: set[str] = set()

    def append(image):
        if not isinstance(image, dict):
            return
        url = image.get("url")
        if not isinstance(url, str) or not url.strip():
            return
        url = url.strip()
        # 原图链接只允许站内地址或 HTTP(S)，避免将历史脏数据作为可点击链接。
        if "\\" in url or any(ord(char) < 32 for char in url):
            return
        if not (url.startswith("/") and not url.startswith("//")) and not re.match(r"^https?://", url, re.I):
            return
        if url not in seen:
            seen.add(url)
            images.append({**image, "url": url})

    stored = meta.get("reference_images")
    for image in stored if isinstance(stored, list) else []:
        append(image)

    names = meta.get("reference_names")
    names = names if isinstance(names, list) else []
    if (
        (not images or (not any(image.get("type") != "context" for image in images)
                        and meta.get("manual_reference_count") != 0))
        and (detail.get("has_reference") or names)
    ):
        # 批量任务与重试任务可能共用目录，不能仅使用当前任务 ID。
        storage_id = str(meta.get("reference_storage_job_id") or detail.get("id") or "")
        owner = _safe_asset_owner_id(str(detail.get("user_id") or ""))
        if detail.get("user_id") and storage_id and re.fullmatch(r"[\w-]+", storage_id):
            root = (settings.output_path / "ai-images").resolve()
            ref_dir = (root / owner / "refs" / storage_id).resolve()
            try:
                if root in ref_dir.parents and ref_dir.is_dir():
                    files = sorted(p for p in ref_dir.iterdir() if p.is_file()
                                   and ref_dir in p.resolve().parents
                                   and re.fullmatch(r"ref_\d+\.(png|jpe?g|webp)", p.name, re.I))
                    for index, path in enumerate(files):
                        manual_count = meta.get("manual_reference_count")
                        is_context = isinstance(manual_count, int) and index >= manual_count
                        append({
                            "type": "context" if is_context else "manual",
                            "name": names[index] if index < len(names) else path.name,
                            "url": "/ai-images/" + quote(path.relative_to(root).as_posix()),
                            "label": "上下文关联图" if is_context else f"用户参考图 {index + 1}",
                        })
            except OSError:
                logger.warning("Unable to read reference images for admin task %s", detail.get("id"))

    previews = meta.get("reference_previews")
    if not images:
        for index, url in enumerate(previews if isinstance(previews, list) else []):
            append({"url": url, "type": "preview", "name": names[index] if index < len(names) else "",
                    "label": f"参考图 {index + 1}"})
    if meta.get("operation") == "outpainting":
        append({"url": meta.get("source_snapshot_url") or meta.get("source_image_url"),
                "type": "outpainting_source", "label": "扩图原图"})
    append({"url": meta.get("context_reference_url") or meta.get("context_image_url"),
            "type": "context", "label": "上下文关联图"})
    return images


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
    if task_type == "ai_image":
        detail["request"]["reference_images"] = _admin_reference_images(detail)
    return {"task": detail}


@app.get("/admin/skills")
def admin_user_skills(request: Request):
    """所有用户上传的技能，附带使用次数，便于排查（仅管理员，只读）。"""
    user = _current_user(request)
    if not _is_admin(user):
        raise HTTPException(403, "需要管理员权限")
    skills = list_all_user_skills(settings.user_skills_path)
    usage = load_skill_usage_stats()
    for item in skills:
        item["usage"] = usage.get((item["user_id"], item["name"]), {"total": 0, "failed": 0, "last_used_at": None})
    return {"skills": skills}


@app.get("/admin/skills/{user_id}/{skill_name}")
def admin_user_skill_detail(request: Request, user_id: str, skill_name: str):
    """单个用户技能的上传记录和全部文件内容（仅管理员，只读）。"""
    user = _current_user(request)
    if not _is_admin(user):
        raise HTTPException(403, "需要管理员权限")
    detail = read_user_skill_detail(user_skill_dir(settings.user_skills_path, user_id), skill_name)
    if not detail:
        raise HTTPException(404, "技能不存在")
    return {"skill": detail}


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


# ─── 常用语 (Quick Prompts) ───────────────────────────────────────────────────


@app.get("/quick-prompts")
def get_quick_prompts_endpoint(request: Request):
    """获取当前用户的常用语列表。首次访问自动载入默认预设。"""
    user = _current_user(request)
    prompts = list_quick_prompts(user["id"])
    return {"prompts": prompts}


@app.post("/quick-prompts")
def create_quick_prompt_endpoint(request: Request, body: QuickPromptCreateRequest):
    """创建常用语"""
    user = _current_user(request)
    try:
        prompt = create_quick_prompt(
            user_id=user["id"],
            title=body.title,
            content=body.content,
            category=body.category or "通用",
        )
        return {"prompt": prompt}
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.put("/quick-prompts/{prompt_id}")
def update_quick_prompt_endpoint(
    request: Request,
    prompt_id: str,
    body: QuickPromptUpdateRequest,
):
    """修改常用语"""
    user = _current_user(request)
    try:
        updated = update_quick_prompt(
            prompt_id=prompt_id,
            user_id=user["id"],
            title=body.title,
            content=body.content,
            category=body.category,
            sort_order=body.sort_order,
        )
        if not updated:
            raise HTTPException(404, "常用语不存在或无权限修改")
        return {"prompt": updated}
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.delete("/quick-prompts/{prompt_id}")
def delete_quick_prompt_endpoint(request: Request, prompt_id: str):
    """删除常用语"""
    user = _current_user(request)
    ok = delete_quick_prompt(prompt_id=prompt_id, user_id=user["id"])
    if not ok:
        raise HTTPException(404, "常用语不存在或无权限删除")
    return {"deleted": prompt_id}


@app.post("/quick-prompts/seed-defaults")
def seed_default_quick_prompts_endpoint(request: Request):
    """恢复/重置推荐电商常用语预设"""
    user = _current_user(request)
    prompts = seed_default_quick_prompts(user["id"], force=True)
    return {"prompts": prompts}


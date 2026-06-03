"""
AI image adapters.

Flow:
1. Optionally upload reference images to the provider.
2. Submit an async image generation task.
3. Poll task status until completed.
4. Download the final image into output/ai-images/{user_id}/.
"""
from __future__ import annotations

import base64
import json
import logging
import re
import random
import time
import uuid
from pathlib import Path
from typing import Any, Callable

import httpx

from .config import settings

logger = logging.getLogger(__name__)


class TransientTaskStatusError(RuntimeError):
    pass


_TRANSIENT_TASK_STATUS_CODES = {408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 523, 524}

_HTTP_ERRORS: dict[int, str] = {
    400: "请求格式错误，可能是参数不合法",
    401: "API Key 验证失败，请检查配置",
    403: "账号无权限或余额不足",
    404: "接口路径不存在或模型不可用",
    413: "上传的参考图过大",
    429: "请求过于频繁，请稍后重试",
    500: "服务商内部错误，请稍后重试",
    503: "服务暂时不可用，请稍后重试",
}

SLASH_MODEL_MAP: dict[str, str] = {
    "nano banano pro": "gemini-3-pro-image-preview",
    "nano banana pro": "gemini-3-pro-image-preview",
    "nano-banana-pro": "gemini-3-pro-image-preview",
    "gpt image 2": "gpt-image-2",
    "gpt-image-2": "gpt-image-2",
}

PROVIDER_APIMART = "apimart"
PROVIDER_ZENMUX = "zenmux"

_OUTPUT_DIR = settings.output_path / "ai-images"
_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

_SIZE_MAP: dict[str, tuple[str, str]] = {
    "auto": ("auto", "1K"),
    "1024x1024": ("1:1", "1K"),
    "2048x2048": ("1:1", "2K"),
    "4096x4096": ("1:1", "4K"),
    "768x1024": ("3:4", "1K"),
    "1536x2048": ("3:4", "2K"),
    "2448x3264": ("3:4", "4K"),
    "1280x1024": ("5:4", "1K"),
    "2560x2048": ("5:4", "2K"),
    "1080x1920": ("9:16", "1K"),
    "1152x2048": ("9:16", "2K"),
    "2160x3840": ("9:16", "4K"),
}

_ZENMUX_SIZE_MAP: dict[str, dict[str, str]] = {
    "1:1": {"1K": "1024x1024", "2K": "1536x1536", "4K": "2048x2048"},
    "3:4": {"1K": "1024x1536", "2K": "1536x2048", "4K": "1536x2048"},
    "4:3": {"1K": "1536x1024", "2K": "2048x1536", "4K": "2048x1536"},
    "5:4": {"1K": "1280x1024", "2K": "2560x2048", "4K": "2560x2048"},
    "4:5": {"1K": "1024x1280", "2K": "2048x2560", "4K": "2048x2560"},
    "16:9": {"1K": "1536x864", "2K": "2048x1152", "4K": "3840x2160"},
    "9:16": {"1K": "864x1536", "2K": "1152x2048", "4K": "2160x3840"},
    "2:3": {"1K": "1024x1536", "2K": "1360x2048", "4K": "1360x2048"},
    "3:2": {"1K": "1536x1024", "2K": "2048x1360", "4K": "2048x1360"},
}


def _api_error_msg(status: int, raw: str) -> str:
    hint = _HTTP_ERRORS.get(status, "")
    base = f"HTTP {status}"
    if hint:
        base += f" - {hint}"
    if raw:
        base += f" ({raw[:160]})"
    return base


def _ensure_user_output_dir(user_id: str) -> Path:
    safe_user_id = "".join(ch for ch in str(user_id or "").strip() if ch.isalnum() or ch in ("-", "_"))
    safe_user_id = safe_user_id or "anonymous"
    out_dir = _OUTPUT_DIR / safe_user_id
    out_dir.mkdir(parents=True, exist_ok=True)
    return out_dir


def _model_credentials(model: str) -> tuple[str, str]:
    base_url = settings.ai_image_base_url.rstrip("/")
    api_key = settings.ai_image_api_key
    if model == "gemini-3-pro-image-preview" and settings.nano_banana_api_key:
        api_key = settings.nano_banana_api_key
        base_url = (settings.nano_banana_base_url or settings.ai_image_base_url).rstrip("/")
    if not api_key:
        raise ValueError("AI_IMAGE_API_KEY 未配置，请在 .env 中填写")
    if base_url.endswith("/v1"):
        base_url = base_url[:-3]
    return base_url, api_key


def normalize_provider(provider: str | None = None) -> str:
    clean = (provider or settings.ai_image_provider or PROVIDER_APIMART).strip().casefold()
    if clean in ("apimart", "api-mart", "api_mart"):
        return PROVIDER_APIMART
    if clean in ("zenmux", "zen-mux", "zen_mux"):
        return PROVIDER_ZENMUX
    raise ValueError(f"未知生图线路: {provider}")


def _zenmux_model_name(model: str) -> str:
    model_name = _normalize_model_name(model)
    if model_name == "gpt-image-2":
        return settings.zenmux_gpt_image_model
    if model_name == "gemini-3-pro-image-preview":
        return settings.zenmux_nano_banana_model
    return model_name


def _zenmux_headers() -> dict[str, str]:
    if not settings.zenmux_api_key:
        raise ValueError("ZENMUX_API_KEY 未配置，请在 .env 中填写")
    return {
        "Authorization": f"Bearer {settings.zenmux_api_key}",
        "Content-Type": "application/json",
    }


def _normalize_model_name(model: str) -> str:
    clean = (model or "").strip()
    if not clean:
        raise ValueError("model 不能为空")
    return SLASH_MODEL_MAP.get(clean.casefold(), clean)


def _normalize_size(size: str, resolution: str = "") -> tuple[str, str]:
    clean = (size or "").strip()
    if clean in _SIZE_MAP:
        return _SIZE_MAP[clean]
    clean_resolution = (resolution or "").strip().upper() or "1K"
    if clean in ("auto", "1:1", "3:4", "4:3", "5:4", "4:5", "9:16", "16:9", "2:3", "3:2"):
        return clean, clean_resolution
    return "1:1", "1K"


def _normalize_zenmux_size(size: str, resolution: str = "") -> str:
    clean = (size or "").strip()
    clean_resolution = (resolution or "").strip().upper() or "1K"
    if clean == "auto":
        return "auto"
    if re.fullmatch(r"\d+x\d+", clean):
        return clean
    if clean in _SIZE_MAP:
        ratio, mapped_resolution = _SIZE_MAP[clean]
        clean = ratio
        clean_resolution = clean_resolution or mapped_resolution
    ratio_map = _ZENMUX_SIZE_MAP.get(clean or "1:1") or _ZENMUX_SIZE_MAP["1:1"]
    return ratio_map.get(clean_resolution) or ratio_map.get("1K") or "1024x1024"


def _extract_error_text(resp: httpx.Response) -> str:
    try:
        data = resp.json()
    except Exception:
        return resp.text[:160]
    if isinstance(data, dict):
        error = data.get("error")
        if isinstance(error, dict):
            return str(error.get("message") or error.get("detail") or data)[:160]
        return str(data.get("message") or data.get("detail") or data)[:160]
    return str(data)[:160]


def _extract_upload_url(payload: Any) -> str | None:
    if isinstance(payload, str):
        clean = payload.strip()
        if clean.startswith("{") or clean.startswith("["):
            try:
                return _extract_upload_url(json.loads(clean))
            except Exception:
                pass
        if clean.startswith("http://") or clean.startswith("https://") or clean.startswith("/"):
            return clean
    if isinstance(payload, dict):
        for key in ("url", "image_url", "file_url"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        for key in ("data", "result", "output"):
            url = _extract_upload_url(payload.get(key))
            if url:
                return url
    if isinstance(payload, list):
        for item in payload:
            url = _extract_upload_url(item)
            if url:
                return url
    return None


def _extract_result_url(payload: Any) -> str | None:
    if isinstance(payload, str):
        clean = payload.strip()
        if clean.startswith("{") or clean.startswith("["):
            try:
                return _extract_result_url(json.loads(clean))
            except Exception:
                pass
        if clean and (clean.startswith("http://") or clean.startswith("https://") or clean.startswith("/")):
            return clean
    if isinstance(payload, dict):
        for key in ("url", "image_url", "imageUrl", "download_url"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
            if isinstance(value, list):
                nested = _extract_result_url(value)
                if nested:
                    return nested
        for key in ("images", "results", "data", "output", "result"):
            url = _extract_result_url(payload.get(key))
            if url:
                return url
    if isinstance(payload, list):
        for item in payload:
            url = _extract_result_url(item)
            if url:
                return url
    return None


def _extract_zenmux_image_url(payload: Any) -> str | None:
    if isinstance(payload, dict):
        data = payload.get("data")
        if isinstance(data, list):
            for item in data:
                if isinstance(item, dict):
                    b64_json = item.get("b64_json")
                    if isinstance(b64_json, str) and b64_json.strip():
                        output_format = str(payload.get("output_format") or "png").strip().lower()
                        mime_type = {
                            "jpeg": "image/jpeg",
                            "jpg": "image/jpeg",
                            "webp": "image/webp",
                        }.get(output_format, "image/png")
                        return f"data:{mime_type};base64,{b64_json.strip()}"
                    url = _extract_result_url(item.get("url") or item.get("image_url"))
                    if url:
                        return url
        return _extract_result_url(payload)
    return _extract_result_url(payload)


def _extension_from_mime(mime_type: str) -> str:
    clean = (mime_type or "").split(";")[0].strip().lower()
    if clean == "image/jpeg":
        return ".jpg"
    if clean == "image/webp":
        return ".webp"
    return ".png"


def _mime_from_filename(filename: str) -> str:
    suffix = Path(filename or "").suffix.lower()
    if suffix in (".jpg", ".jpeg"):
        return "image/jpeg"
    if suffix == ".webp":
        return "image/webp"
    if suffix == ".gif":
        return "image/gif"
    return "image/png"


def _image_bytes_to_data_url(image_bytes: bytes, filename: str) -> str:
    if not image_bytes:
        raise RuntimeError(f"参考图为空: {filename or 'unknown'}")
    mime_type = _mime_from_filename(filename)
    encoded = base64.b64encode(image_bytes).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def _save_data_url_image(data_url: str, *, user_id: str, prefix: str = "zenmux") -> str:
    match = re.match(r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.+)$", data_url or "", re.DOTALL)
    if not match:
        raise RuntimeError("ZenMux 返回了无法识别的图片 data URL")
    mime_type, raw_b64 = match.groups()
    try:
        content = base64.b64decode(raw_b64, validate=True)
    except Exception as exc:
        raise RuntimeError("ZenMux 返回的图片 base64 解码失败") from exc
    if not content:
        raise RuntimeError("ZenMux 返回的图片内容为空")
    out_dir = _ensure_user_output_dir(user_id)
    filename = f"{prefix}_{uuid.uuid4().hex}{_extension_from_mime(mime_type)}"
    (out_dir / filename).write_bytes(content)
    return f"/ai-images/{out_dir.name}/{filename}"


def _extract_task_id(payload: Any) -> str | None:
    if isinstance(payload, str) and payload:
        return payload
    if isinstance(payload, dict):
        for key in ("task_id", "id"):
            value = payload.get(key)
            if isinstance(value, str) and value:
                return value
        for key in ("data", "result", "output"):
            task_id = _extract_task_id(payload.get(key))
            if task_id:
                return task_id
    if isinstance(payload, list):
        for item in payload:
            task_id = _extract_task_id(item)
            if task_id:
                return task_id
    return None


def _extract_status(payload: Any) -> str | None:
    if isinstance(payload, dict):
        for key in ("status", "state"):
            value = payload.get(key)
            if isinstance(value, str) and value:
                return value
        for key in ("data", "result", "output"):
            status = _extract_status(payload.get(key))
            if status:
                return status
    if isinstance(payload, list):
        for item in payload:
            status = _extract_status(item)
            if status:
                return status
    return None


def _extract_progress(payload: Any) -> int | None:
    """提取生图进度（0-100），文档：data.progress"""
    if isinstance(payload, dict):
        value = payload.get("progress")
        if isinstance(value, (int, float)):
            return max(0, min(100, int(value)))
    return None


def _extract_task_error(payload: Any) -> str | None:
    if isinstance(payload, dict):
        for key in ("error", "message", "detail"):
            value = payload.get(key)
            if isinstance(value, str) and value:
                return value
            if isinstance(value, dict):
                nested = _extract_task_error(value)
                if nested:
                    return nested
        for key in ("data", "result", "output"):
            nested = _extract_task_error(payload.get(key))
            if nested:
                return nested
    if isinstance(payload, list):
        for item in payload:
            nested = _extract_task_error(item)
            if nested:
                return nested
    return None


async def _upload_reference_image(
    client: httpx.AsyncClient,
    base_url: str,
    headers: dict[str, str],
    image_bytes: bytes,
    filename: str,
) -> str:
    endpoint = f"{base_url}/v1/uploads/images"
    files = {"file": (filename, image_bytes, "image/png")}
    resp = await client.post(endpoint, headers={"Authorization": headers["Authorization"]}, files=files)
    if not resp.is_success:
        raise RuntimeError(f"上传参考图失败：{_api_error_msg(resp.status_code, _extract_error_text(resp))}")
    url = _extract_upload_url(resp.json())
    if not url:
        raise RuntimeError(f"上传参考图成功，但响应中没有可用 URL: {resp.text[:160]}")
    return url


async def _submit_generation_task(
    client: httpx.AsyncClient,
    *,
    base_url: str,
    headers: dict[str, str],
    model: str,
    prompt: str,
    size: str,
    resolution: str = "",
    reference_urls: list[str] | None = None,
) -> str:
    model_name = _normalize_model_name(model)
    ratio, resolution = _normalize_size(size, resolution)
    # GPT Image 2 要求 resolution 小写（1k/2k/4k），Gemini 用大写（1K/2K/4K）
    if model_name == "gpt-image-2":
        resolution = resolution.lower()
    payload: dict[str, Any] = {
        "model": model_name,
        "prompt": prompt,
        "size": ratio,
        "resolution": resolution,
    }
    if reference_urls:
        payload["image_urls"] = reference_urls
    endpoint = f"{base_url}/v1/images/generations"
    resp = await client.post(endpoint, json=payload, headers=headers)
    if not resp.is_success:
        raise RuntimeError(f"提交生图任务失败：{_api_error_msg(resp.status_code, _extract_error_text(resp))}")
    data = resp.json()
    task_id = _extract_task_id(data)
    if not task_id:
        raise RuntimeError(f"提交生图任务成功，但未返回 task_id: {str(data)[:200]}")
    return str(task_id)


async def _fetch_task_status(
    client: httpx.AsyncClient,
    *,
    base_url: str,
    headers: dict[str, str],
    task_id: str,
) -> dict[str, Any]:
    """查询任务状态。使用官方文档规范的端点 GET /v1/tasks/{task_id}"""
    endpoint = f"{base_url}/v1/tasks/{task_id}"
    try:
        resp = await client.get(endpoint, headers=headers, params={"language": "zh"})
    except httpx.RequestError as exc:
        raise TransientTaskStatusError(f"查询任务状态网络异常：{exc}") from exc
    if resp.is_success:
        # 文档格式: {"code": 200, "data": {"id": ..., "status": "...", "progress": 50, ...}}
        body = resp.json()
        if isinstance(body, dict):
            if "data" in body and isinstance(body["data"], dict):
                return body["data"]
            return body
        raise RuntimeError(f"任务状态响应格式异常: {str(body)[:200]}")
    last_error = _api_error_msg(resp.status_code, _extract_error_text(resp))
    if resp.status_code in _TRANSIENT_TASK_STATUS_CODES:
        raise TransientTaskStatusError(f"查询任务状态临时失败：{last_error}")
    raise RuntimeError(f"查询任务状态失败：{last_error}")


async def _wait_for_task_result(
    client: httpx.AsyncClient,
    *,
    base_url: str,
    headers: dict[str, str],
    task_id: str,
    timeout_seconds: int = 1000,
    poll_interval: float = 2.0,
    on_progress: Callable[[int, str], Any] | None = None,
) -> tuple[str, int]:
    """轮询等待任务完成，返回 (图片URL, 进度百分比)。on_progress(progress, api_status) 用于实时更新状态。"""
    deadline = time.monotonic() + timeout_seconds
    last_status = "queued"
    last_progress = 0
    completed_without_url = 0
    transient_status_errors = 0
    max_transient_status_errors = 12
    while time.monotonic() < deadline:
        try:
            data = await _fetch_task_status(client, base_url=base_url, headers=headers, task_id=task_id)
            transient_status_errors = 0  # 成功获取后重置计数
        except TransientTaskStatusError as exc:
            transient_status_errors += 1
            logger.warning(
                "task status transient error: task_id=%s attempt=%s error=%s",
                task_id,
                transient_status_errors,
                exc,
            )
            if transient_status_errors >= max_transient_status_errors:
                raise RuntimeError(f"查询任务状态连续失败次数过多: {exc}") from exc
            backoff = min(max(poll_interval, 2.0) * (1.4 ** min(transient_status_errors, 4)), 8.0)
            await asyncio_sleep(backoff + random.uniform(0, 0.35))
            continue
        status = str(_extract_status(data) or "").lower()
        last_status = status or last_status
        last_progress = _extract_progress(data) or last_progress
        if on_progress:
            try:
                on_progress(last_progress, status)
            except Exception:
                pass
        if status in {"completed", "succeeded", "success", "done"}:
            url = _extract_result_url(data)
            if url:
                return url, 100
            completed_without_url += 1
            logger.warning(
                "task completed but no image url yet: task_id=%s attempt=%s payload=%s",
                task_id,
                completed_without_url,
                str(data)[:500],
            )
            if completed_without_url >= 10:
                raise RuntimeError(f"任务已完成，但未拿到图片 URL: {str(data)[:500]}")
            await asyncio_sleep(1.5)
            continue
        if status in {"failed", "error", "cancelled", "canceled"}:
            error_text = str(_extract_task_error(data) or data)[:240]
            raise RuntimeError(f"生图任务失败: {error_text}")
        await asyncio_sleep(poll_interval)
    raise RuntimeError(f"生图任务超时，最后状态: {last_status}")


async def asyncio_sleep(seconds: float) -> None:
    import asyncio

    await asyncio.sleep(seconds)


async def _download_final_image(
    client: httpx.AsyncClient,
    *,
    image_url: str,
    user_id: str,
) -> str:
    resp = await client.get(image_url)
    if not resp.is_success:
        raise RuntimeError(f"下载结果图片失败：HTTP {resp.status_code}")
    filename = f"{uuid.uuid4().hex}.png"
    out_dir = _ensure_user_output_dir(user_id)
    out_path = out_dir / filename
    out_path.write_bytes(resp.content)
    return f"/ai-images/{out_dir.name}/{filename}"


async def generate_image_zenmux_async(
    model: str,
    prompt: str,
    images: list[tuple[bytes, str]] | None = None,
    size: str = "1024x1024",
    resolution: str = "",
    user_id: str = "anonymous",
) -> dict:
    model_name = _zenmux_model_name(model)
    base_url = settings.zenmux_base_url.rstrip("/")
    headers = _zenmux_headers()
    refs = images or []
    zenmux_size = _normalize_zenmux_size(size, resolution)
    payload: dict[str, Any] = {
        "model": model_name,
        "prompt": prompt,
        "n": 1,
        "size": zenmux_size,
    }

    if refs:
        endpoint = f"{base_url}/images/edits"
        form_data = {key: str(value) for key, value in payload.items()}
        files = [
            ("image[]", (filename or f"ref{i}.png", image_bytes, _mime_from_filename(filename)))
            for i, (image_bytes, filename) in enumerate(refs[:4])
        ]
    else:
        endpoint = f"{base_url}/images/generations"
        form_data = {}
        files = []

    async with httpx.AsyncClient(timeout=240, trust_env=False) as client:
        if files:
            multipart_headers = {k: v for k, v in headers.items() if k.lower() != "content-type"}
            resp = await client.post(endpoint, data=form_data, files=files, headers=multipart_headers)
        else:
            resp = await client.post(endpoint, json=payload, headers=headers)
        if not resp.is_success:
            raise RuntimeError(f"ZenMux 生图失败：{_api_error_msg(resp.status_code, _extract_error_text(resp))}")
        data = resp.json()
        image_url = _extract_zenmux_image_url(data)
        if not image_url:
            raise RuntimeError(f"ZenMux 响应中没有图片: {str(data)[:240]}")
        if image_url.startswith("data:image/"):
            local_url = _save_data_url_image(image_url, user_id=user_id)
        else:
            local_url = await _download_final_image(client, image_url=image_url, user_id=user_id)

    return {
        "url": local_url,
        "model": model_name,
        "prompt": prompt,
        "size": zenmux_size,
        "resolution": resolution,
        "provider": PROVIDER_ZENMUX,
        "reference": bool(refs),
        "task_id": f"zenmux:{uuid.uuid4().hex}",
    }


async def generate_image(
    model: str,
    prompt: str,
    size: str = "1024x1024",
    resolution: str = "",
    user_id: str = "anonymous",
) -> dict:
    model_name = _normalize_model_name(model)
    base_url, api_key = _model_credentials(model_name)
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=180, trust_env=False) as client:
        task_id = await _submit_generation_task(
            client,
            base_url=base_url,
            headers=headers,
            model=model_name,
            prompt=prompt,
            size=size,
            resolution=resolution,
        )
        result_url, _ = await _wait_for_task_result(
            client,
            base_url=base_url,
            headers=headers,
            task_id=task_id,
        )
        local_url = await _download_final_image(client, image_url=result_url, user_id=user_id)
    return {
        "url": local_url,
        "model": model_name,
        "prompt": prompt,
        "size": size,
        "resolution": resolution,
        "task_id": task_id,
    }


async def generate_image_with_reference(
    model: str,
    prompt: str,
    images: list[tuple[bytes, str]],
    size: str = "1024x1024",
    resolution: str = "",
    user_id: str = "anonymous",
) -> dict:
    model_name = _normalize_model_name(model)
    base_url, api_key = _model_credentials(model_name)
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=240, trust_env=False) as client:
        reference_urls: list[str] = []
        for index, (image_bytes, filename) in enumerate(images[:4]):
            safe_name = filename or f"reference_{index}.png"
            reference_urls.append(
                await _upload_reference_image(client, base_url, headers, image_bytes, safe_name)
            )
        task_id = await _submit_generation_task(
            client,
            base_url=base_url,
            headers=headers,
            model=model_name,
            prompt=prompt,
            size=size,
            resolution=resolution,
            reference_urls=reference_urls,
        )
        result_url, _ = await _wait_for_task_result(
            client,
            base_url=base_url,
            headers=headers,
            task_id=task_id,
        )
        local_url = await _download_final_image(client, image_url=result_url, user_id=user_id)
    return {
        "url": local_url,
        "model": model_name,
        "prompt": prompt,
        "size": size,
        "resolution": resolution,
        "reference": True,
        "task_id": task_id,
    }


async def generate_image_async(
    model: str,
    prompt: str,
    size: str = "1024x1024",
    resolution: str = "",
    user_id: str = "anonymous",
    on_progress: Callable[[int, str], Any] | None = None,
) -> dict:
    """异步生图：提交任务 → 轮询进度 → 下载结果。on_progress(progress, api_status) 用于持久化进度。"""
    model_name = _normalize_model_name(model)
    base_url, api_key = _model_credentials(model_name)
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=180, trust_env=False) as client:
        task_id = await _submit_generation_task(
            client,
            base_url=base_url,
            headers=headers,
            model=model_name,
            prompt=prompt,
            size=size,
            resolution=resolution,
        )
        result_url, _ = await _wait_for_task_result(
            client,
            base_url=base_url,
            headers=headers,
            task_id=task_id,
            on_progress=on_progress,
        )
        local_url = await _download_final_image(client, image_url=result_url, user_id=user_id)
    return {
        "url": local_url,
        "model": model_name,
        "prompt": prompt,
        "size": size,
        "resolution": resolution,
        "task_id": task_id,
    }


async def generate_image_with_reference_async(
    model: str,
    prompt: str,
    images: list[tuple[bytes, str]],
    size: str = "1024x1024",
    resolution: str = "",
    user_id: str = "anonymous",
    on_progress: Callable[[int], Any] | None = None,
) -> dict:
    """异步图生图：上传参考图 → 提交任务 → 轮询进度 → 下载结果。"""
    model_name = _normalize_model_name(model)
    base_url, api_key = _model_credentials(model_name)
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=240, trust_env=False) as client:
        reference_urls: list[str] = []
        for index, (image_bytes, filename) in enumerate(images[:4]):
            safe_name = filename or f"reference_{index}.png"
            reference_urls.append(
                await _upload_reference_image(client, base_url, headers, image_bytes, safe_name)
            )
        task_id = await _submit_generation_task(
            client,
            base_url=base_url,
            headers=headers,
            model=model_name,
            prompt=prompt,
            size=size,
            resolution=resolution,
            reference_urls=reference_urls,
        )
        result_url, _ = await _wait_for_task_result(
            client,
            base_url=base_url,
            headers=headers,
            task_id=task_id,
            on_progress=on_progress,
        )
        local_url = await _download_final_image(client, image_url=result_url, user_id=user_id)
    return {
        "url": local_url,
        "model": model_name,
        "prompt": prompt,
        "size": size,
        "resolution": resolution,
        "reference": True,
        "task_id": task_id,
    }

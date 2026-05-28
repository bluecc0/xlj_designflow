"""
AI image adapter for APIMart.

Flow:
1. Optionally upload reference images to APIMart.
2. Submit an async image generation task.
3. Poll task status until completed.
4. Download the final image into output/ai-images/{user_id}/.
"""
from __future__ import annotations

import json
import logging
import random
import time
import uuid
from pathlib import Path
from typing import Any

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
    if clean in ("auto", "1:1", "3:4", "5:4", "9:16", "16:9", "2:3", "3:2"):
        return clean, clean_resolution
    return "1:1", "1K"


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
    ratio, resolution = _normalize_size(size, resolution)
    payload: dict[str, Any] = {
        "model": _normalize_model_name(model),
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
    endpoints = [
        f"{base_url}/v1/tasks/{task_id}",
        f"{base_url}/v1/images/generations/{task_id}",
    ]
    last_error: str | None = None
    for endpoint in endpoints:
        try:
            resp = await client.get(endpoint, headers=headers)
        except httpx.RequestError as exc:
            raise TransientTaskStatusError(f"查询任务状态网络异常：{exc}") from exc
        if resp.is_success:
            data = resp.json()
            if isinstance(data, dict):
                return data
            raise RuntimeError(f"任务状态响应格式异常: {str(data)[:200]}")
        last_error = _api_error_msg(resp.status_code, _extract_error_text(resp))
        if resp.status_code in _TRANSIENT_TASK_STATUS_CODES:
            raise TransientTaskStatusError(f"查询任务状态临时失败：{last_error}")
        if resp.status_code != 404:
            break
    raise RuntimeError(f"查询任务状态失败：{last_error or 'unknown error'}")


async def _wait_for_task_result(
    client: httpx.AsyncClient,
    *,
    base_url: str,
    headers: dict[str, str],
    task_id: str,
    timeout_seconds: int = 1000,
    poll_interval: float = 2.0,
) -> str:
    deadline = time.monotonic() + timeout_seconds
    last_status = "queued"
    completed_without_url = 0
    transient_status_errors = 0
    max_transient_status_errors = 12
    while time.monotonic() < deadline:
        try:
            data = await _fetch_task_status(client, base_url=base_url, headers=headers, task_id=task_id)
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
        if status in {"completed", "succeeded", "success", "done"}:
            url = _extract_result_url(data)
            if url:
                return url
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
        result_url = await _wait_for_task_result(
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
        result_url = await _wait_for_task_result(
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

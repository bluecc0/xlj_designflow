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
    402: "账户余额不足或需要充值，请检查 ZenMux/APIMart 账户",
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
    detail = raw
    if raw:
        try:
            import json as _json
            body = _json.loads(raw)
            err = body.get("error") if isinstance(body, dict) else None
            if isinstance(err, dict):
                detail = err.get("message") or err.get("code") or raw
            elif isinstance(err, str):
                detail = err
        except Exception:
            pass
        base += f" ({detail[:200]})"
    return base


def _ensure_user_output_dir(user_id: str) -> Path:
    safe_user_id = "".join(ch for ch in str(user_id or "").strip() if ch.isalnum() or ch in ("-", "_"))
    safe_user_id = safe_user_id or "anonymous"
    out_dir = _OUTPUT_DIR / safe_user_id
    out_dir.mkdir(parents=True, exist_ok=True)
    return out_dir


def generate_inspiration_thumb(image_url: str, user_id: str, job_id: str, max_width: int = 480) -> tuple[str, int, int]:
    """从 image_url 加载原图，生成 ≤max_width 宽度的 webp 缩略图，返回 (URL 路径, 缩略图宽, 缩略图高)。
    失败时回退返回 (原 URL, 0, 0)。"""
    from PIL import Image
    # 从 image_url (/ai-images/xxx) 推断磁盘路径
    if not image_url.startswith("/ai-images/"):
        return image_url, 0, 0
    rel = image_url[len("/ai-images/"):]
    src_path = _OUTPUT_DIR / rel
    if not src_path.exists():
        return image_url, 0, 0
    thumb_dir = _OUTPUT_DIR / user_id / "thumbs"
    thumb_dir.mkdir(parents=True, exist_ok=True)
    thumb_path = thumb_dir / f"{job_id}.webp"
    if thumb_path.exists():
        # 缓存命中：重新读尺寸返回
        try:
            with Image.open(thumb_path) as im:
                return f"/ai-images/{user_id}/thumbs/{job_id}.webp", im.width, im.height
        except Exception:
            pass
    try:
        with Image.open(src_path) as im:
            im = im.convert("RGB")
            ratio = max_width / im.width if im.width > max_width else 1
            new_size = (int(im.width * ratio), int(im.height * ratio))
            im = im.resize(new_size, Image.LANCZOS)
            im.save(thumb_path, "WEBP", quality=82, method=4)
        return f"/ai-images/{user_id}/thumbs/{job_id}.webp", new_size[0], new_size[1]
    except Exception:
        return image_url, 0, 0


def save_user_refs(user_id: str, job_id: str, refs: list[tuple[bytes, str]]) -> list[str]:
    """持久化用户上传的参考图到磁盘，返回相对路径列表。"""
    ref_dir = _ensure_user_output_dir(user_id) / "refs" / job_id
    ref_dir.mkdir(parents=True, exist_ok=True)
    paths: list[str] = []
    for i, (ref_bytes, ref_name) in enumerate(refs):
        safe_name = f"ref_{i}.png" if not ref_name.lower().endswith((".png", ".jpg", ".jpeg", ".webp")) else f"ref_{i}{Path(ref_name).suffix}"
        ref_path = ref_dir / safe_name
        ref_path.write_bytes(ref_bytes)
        paths.append(str(ref_path))
    return paths


def load_user_refs(user_id: str, job_id: str) -> list[tuple[bytes, str]]:
    """从磁盘加载用户上传的参考图。"""
    ref_dir = _ensure_user_output_dir(user_id) / "refs" / job_id
    if not ref_dir.exists():
        return []
    refs: list[tuple[bytes, str]] = []
    for p in sorted(ref_dir.iterdir()):
        if p.is_file():
            refs.append((p.read_bytes(), p.name))
    return refs


def cleanup_user_refs(user_id: str, job_id: str) -> None:
    """删除用户参考图临时目录。"""
    import shutil
    ref_dir = _ensure_user_output_dir(user_id) / "refs" / job_id
    if ref_dir.exists():
        shutil.rmtree(ref_dir)


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
    if clean in ("sub2api", "sub2-api", "sub_2api"):
        return PROVIDER_SUB2API
    raise ValueError(f"未知生图线路: {provider}")


def _zenmux_model_name(model: str) -> str:
    model_name = _normalize_model_name(model)
    if model_name == "gpt-image-2":
        return settings.zenmux_gpt_image_model
    if model_name == "gemini-3-pro-image-preview":
        return settings.zenmux_nano_banana_model
    return model_name


def _is_zenmux_vertex_image_model(model_name: str) -> bool:
    clean = str(model_name or "").strip().lower()
    return clean.startswith("google/gemini-3-pro-image") or clean.startswith("gemini-3-pro-image")


def _split_provider_model(model_name: str, default_provider: str = "google") -> tuple[str, str]:
    clean = str(model_name or "").strip()
    if "/" in clean:
        provider, name = clean.split("/", 1)
        return provider or default_provider, name or clean
    return default_provider, clean


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


def _normalize_zenmux_vertex_image_config(size: str, resolution: str = "") -> dict[str, Any]:
    ratio, clean_resolution = _normalize_size(size, resolution)
    image_config: dict[str, Any] = {
        "imageSize": clean_resolution if clean_resolution in {"1K", "2K", "4K"} else "1K",
    }
    if ratio and ratio != "auto":
        image_config["aspectRatio"] = ratio
    return image_config


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


def _extract_vertex_image_data_url(payload: Any) -> str | None:
    if isinstance(payload, dict):
        inline_data = payload.get("inlineData") or payload.get("inline_data")
        if isinstance(inline_data, dict):
            raw_b64 = inline_data.get("data")
            if isinstance(raw_b64, str) and raw_b64.strip():
                mime_type = str(inline_data.get("mimeType") or inline_data.get("mime_type") or "image/png").strip()
                return f"data:{mime_type};base64,{raw_b64.strip()}"
        for key in ("candidates", "content", "parts", "data", "result", "output"):
            data_url = _extract_vertex_image_data_url(payload.get(key))
            if data_url:
                return data_url
    if isinstance(payload, list):
        for item in payload:
            data_url = _extract_vertex_image_data_url(item)
            if data_url:
                return data_url
    return None


def _extract_vertex_usage(payload: Any) -> dict[str, int] | None:
    if not isinstance(payload, dict):
        return None
    usage = payload.get("usageMetadata")
    if not isinstance(usage, dict):
        return None
    input_tokens = int(usage.get("promptTokenCount") or 0)
    output_tokens = int(usage.get("candidatesTokenCount") or 0)
    total_tokens = int(usage.get("totalTokenCount") or (input_tokens + output_tokens))
    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens,
    }


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


def _extract_task_cost(payload: Any) -> float | None:
    """从任务状态响应中提取费用（APIMart data.cost）"""
    if isinstance(payload, dict):
        cost = payload.get("cost")
        if isinstance(cost, (int, float)):
            return float(cost)
        data = payload.get("data")
        if isinstance(data, dict):
            cost = data.get("cost")
            if isinstance(cost, (int, float)):
                return float(cost)
    return None


def _extract_task_detail(payload: Any) -> dict:
    """从任务状态响应中提取任务详情（status, cost, estimated_time, actual_time）"""
    detail: dict = {}
    if isinstance(payload, dict):
        data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
        if isinstance(data, dict):
            for key in ("status", "progress", "cost", "estimated_time", "actual_time"):
                val = data.get(key)
                if val is not None:
                    detail[key] = val
    return detail


def _extract_task_error(payload: Any) -> str | None:
    """从 API 响应中提取错误详情，优先返回完整结构化信息（code + message + type）"""
    if isinstance(payload, dict):
        # APIMart 格式: {"data": {"error": {"code": "...", "message": "...", "type": "..."}}}
        for key in ("error", "message", "detail"):
            value = payload.get(key)
            if isinstance(value, str) and value:
                return value
            if isinstance(value, dict):
                code = value.get("code", "")
                msg = value.get("message", "")
                etype = value.get("type", "")
                parts = [p for p in [code, msg, etype] if p]
                if parts:
                    return " | ".join(parts)
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
    if model_name == "gpt-image-2":
        payload["official_fallback"] = True
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
) -> tuple[str, int, dict | None]:
    """轮询等待任务完成，返回 (图片URL, 进度百分比, 任务详情{status,cost,estimated_time,actual_time})。"""
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
                detail = _extract_task_detail(data)
                return url, 100, detail if detail else None
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


async def _generate_image_zenmux_vertex_async(
    *,
    model_name: str,
    prompt: str,
    refs: list[tuple[bytes, str]],
    size: str,
    resolution: str,
    user_id: str,
    headers: dict[str, str],
    on_progress: Callable[[int, str], Any] | None = None,
) -> dict:
    provider_name, short_model_name = _split_provider_model(model_name, default_provider="google")
    base_url = settings.zenmux_base_url.rstrip("/")
    vertex_base_url = re.sub(r"/api/v1/?$", "/api/vertex-ai/v1", base_url)
    if vertex_base_url == base_url:
        vertex_base_url = base_url.rstrip("/") + "/api/vertex-ai/v1"
    endpoint = f"{vertex_base_url}/publishers/{provider_name}/models/{short_model_name}:generateContent"

    parts: list[dict[str, Any]] = []
    for image_bytes, filename in refs[:9]:
        parts.append({
            "inlineData": {
                "mimeType": _mime_from_filename(filename),
                "data": base64.b64encode(image_bytes).decode("ascii"),
            }
        })
    parts.append({"text": prompt})

    payload: dict[str, Any] = {
        "contents": [
            {
                "role": "user",
                "parts": parts,
            }
        ],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
            "imageConfig": _normalize_zenmux_vertex_image_config(size, resolution),
        },
    }

    request_headers = {
        "Authorization": headers["Authorization"],
        "Content-Type": "application/json",
    }
    if on_progress:
        on_progress(10, "processing")
    async with httpx.AsyncClient(timeout=240, trust_env=False) as client:
        resp = await client.post(endpoint, json=payload, headers=request_headers)
        if not resp.is_success:
            raise RuntimeError(f"ZenMux 生图失败：{_api_error_msg(resp.status_code, _extract_error_text(resp))}")
        data = resp.json()
        if on_progress:
            on_progress(85, "processing")
        image_data_url = _extract_vertex_image_data_url(data)
        if not image_data_url:
            raise RuntimeError(f"ZenMux Vertex 响应中没有图片: {str(data)[:240]}")
        local_url = _save_data_url_image(image_data_url, user_id=user_id, prefix="zenmux")
        if on_progress:
            on_progress(100, "completed")

    return {
        "url": local_url,
        "model": model_name,
        "prompt": prompt,
        "size": size,
        "resolution": resolution,
        "provider": PROVIDER_ZENMUX,
        "reference": bool(refs),
        "task_id": f"zenmux-vertex:{uuid.uuid4().hex}",
        "usage": _extract_vertex_usage(data),
    }


async def generate_image_zenmux_async(
    model: str,
    prompt: str,
    images: list[tuple[bytes, str]] | None = None,
    size: str = "1024x1024",
    resolution: str = "",
    user_id: str = "anonymous",
    on_progress: Callable[[int, str], Any] | None = None,
) -> dict:
    """ZenMux 生图：无参考图时使用 SSE 流式获取进度 + token 用量；有参考图时使用非流式"""
    model_name = _zenmux_model_name(model)
    headers = _zenmux_headers()
    refs = images or []
    if _is_zenmux_vertex_image_model(model_name):
        return await _generate_image_zenmux_vertex_async(
            model_name=model_name,
            prompt=prompt,
            refs=refs,
            size=size,
            resolution=resolution,
            user_id=user_id,
            headers=headers,
            on_progress=on_progress,
        )
    base_url = settings.zenmux_base_url.rstrip("/")
    zenmux_size = _normalize_zenmux_size(size, resolution)
    payload: dict[str, Any] = {
        "model": model_name,
        "prompt": prompt,
        "n": 1,
        "size": zenmux_size,
    }

    if refs:
        # 有参考图：multipart/form-data 不支持流式，保持原有逻辑
        endpoint = f"{base_url}/images/edits"
        form_data = {key: str(value) for key, value in payload.items()}
        files = [
            ("image[]", (filename or f"ref{i}.png", image_bytes, _mime_from_filename(filename)))
            for i, (image_bytes, filename) in enumerate(refs[:9])
        ]
        if on_progress:
            on_progress(10, "processing")
        async with httpx.AsyncClient(timeout=240, trust_env=False) as client:
            multipart_headers = {k: v for k, v in headers.items() if k.lower() != "content-type"}
            resp = await client.post(endpoint, data=form_data, files=files, headers=multipart_headers)
            if not resp.is_success:
                raise RuntimeError(f"ZenMux 生图失败：{_api_error_msg(resp.status_code, _extract_error_text(resp))}")
            data = resp.json()
            if on_progress:
                on_progress(90, "processing")
            image_url = _extract_zenmux_image_url(data)
            if not image_url:
                raise RuntimeError(f"ZenMux 响应中没有图片: {str(data)[:240]}")
            if image_url.startswith("data:image/"):
                local_url = _save_data_url_image(image_url, user_id=user_id)
            else:
                local_url = await _download_final_image(client, image_url=image_url, user_id=user_id)
            if on_progress:
                on_progress(100, "completed")
        task_id = f"zenmux:{uuid.uuid4().hex}"
        usage = None
    else:
        # 无参考图：SSE 流式，获取进度事件 + token 用量
        endpoint = f"{base_url}/images/generations"
        payload["stream"] = True
        last_b64 = None
        usage: dict | None = None
        output_format = "png"
        partial_count = 0

        async with httpx.AsyncClient(timeout=240, trust_env=False) as client:
            async with client.stream("POST", endpoint, json=payload, headers=headers) as resp:
                if not resp.is_success:
                    body = ""
                    try:
                        async for chunk in resp.aiter_bytes():
                            body += chunk.decode(errors="replace")
                            if len(body) > 500:
                                break
                    except Exception:
                        pass
                    raise RuntimeError(f"ZenMux 生图失败：{_api_error_msg(resp.status_code, body[:200])}")

                current_event = ""
                async for line in resp.aiter_lines():
                    line = line.strip()
                    if line.startswith("event: "):
                        current_event = line[7:].strip()
                    elif line.startswith("data: "):
                        data_str = line[6:]
                        if data_str == "[DONE]":
                            break
                        try:
                            event = json.loads(data_str)
                        except json.JSONDecodeError:
                            continue
                        etype = event.get("type") or current_event
                        if etype == "image_generation.partial_image":
                            partial_count += 1
                            last_b64 = event.get("b64_json")
                            output_format = event.get("output_format", "png")
                            progress = min(partial_count * 15, 85)
                            if on_progress:
                                on_progress(progress, "processing")
                        elif etype == "image_generation.completed":
                            last_b64 = event.get("b64_json")
                            output_format = event.get("output_format", "png")
                            usage = event.get("usage")
                            if on_progress:
                                on_progress(100, "completed")
                        elif etype in ("error", "image_generation.error"):
                            err_msg = event.get("message") or event.get("error") or str(event)[:200]
                            raise RuntimeError(f"ZenMux 生图错误: {err_msg}")

        if not last_b64:
            raise RuntimeError("ZenMux 流式响应中没有图片数据")

        mime = "image/" + output_format
        data_url = f"data:{mime};base64,{last_b64}"
        local_url = _save_data_url_image(data_url, user_id=user_id, prefix="zenmux")
        task_id = f"zenmux:{uuid.uuid4().hex}"

    result: dict = {
        "url": local_url,
        "model": model_name,
        "prompt": prompt,
        "size": zenmux_size,
        "resolution": resolution,
        "provider": PROVIDER_ZENMUX,
        "reference": bool(refs),
        "task_id": task_id,
    }
    if usage:
        result["usage"] = usage
    return result


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
        result_url, _, _task_detail = await _wait_for_task_result(
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
        "cost": _task_detail.get("cost") if _task_detail else None,
        "estimated_time": _task_detail.get("estimated_time") if _task_detail else None,
        "actual_time": _task_detail.get("actual_time") if _task_detail else None,
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
        for index, (image_bytes, filename) in enumerate(images[:9]):
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
        result_url, _, _task_detail = await _wait_for_task_result(
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
        "cost": _task_detail.get("cost") if _task_detail else None,
        "estimated_time": _task_detail.get("estimated_time") if _task_detail else None,
        "actual_time": _task_detail.get("actual_time") if _task_detail else None,
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
        result_url, _, _task_detail = await _wait_for_task_result(
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
        "cost": _task_detail.get("cost") if _task_detail else None,
        "estimated_time": _task_detail.get("estimated_time") if _task_detail else None,
        "actual_time": _task_detail.get("actual_time") if _task_detail else None,
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
        for index, (image_bytes, filename) in enumerate(images[:9]):
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
        result_url, _, _task_detail = await _wait_for_task_result(
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
        "cost": _task_detail.get("cost") if _task_detail else None,
        "estimated_time": _task_detail.get("estimated_time") if _task_detail else None,
        "actual_time": _task_detail.get("actual_time") if _task_detail else None,
    }


# ── Sub2API 订阅线路 ─────────────────────────────────────────────────────────

PROVIDER_SUB2API = "sub2api"

_SUB2API_SIZE_MAP: dict[str, str] = {
    "auto":    "1024x1024",
    "1024x1024": "1024x1024",
    "2048x2048": "2048x2048",
    "4096x4096": "2048x2048",  # 文档最大 2048x2048
    "1:1":   "1024x1024",
    "3:4":   "1024x1536",
    "4:3":   "1536x1024",
    "5:4":   "1280x1024",  # 文档未列 5:4，回退到 1536x1024
    "4:5":   "1024x1536",
    "9:16":  "1024x1536",  # 文档未列 9:16
    "16:9":  "1536x1024",  # 文档未列 16:9
    "3:2":   "1536x1024",  # 文档未列 3:2，转具体像素
    "2:3":   "1024x1536",  # 文档未列 2:3，转具体像素
    # 像素尺寸兼容
    "768x1024":  "1024x1536",
    "1536x2048": "1024x1536",  # 文档最大 2048x2048
    "2448x3264": "1024x1536",
    "1280x1024": "1536x1024",
    "2560x2048": "2048x2048",
    "1080x1920": "1024x1536",
    "1152x2048": "1024x1536",
    "2160x3840": "1024x1536",
}


def _build_sub2api_input(
    prompt: str,
    refs: list[tuple[bytes, str]],
) -> list[dict]:
    """构建 Sub2API /responses 的 input 数组。
    文生图: 只有 input_text
    图生图: input_text + input_image (base64 data URL)"""
    content: list[dict] = [{"type": "input_text", "text": prompt}]
    for image_bytes, filename in refs[:9]:
        mime = _mime_from_filename(filename)
        b64 = base64.b64encode(image_bytes).decode("ascii")
        content.append({
            "type": "input_image",
            "image_url": f"data:{mime};base64,{b64}",
        })
    return [{"role": "user", "content": content}]


def _build_sub2api_tools(
    model: str,
    size: str,
    has_refs: bool = False,
) -> list[dict]:
    """构建 Sub2API /responses 的 tools 数组。
    文生图 action 为 generate，图生图 action 为 edit。"""
    mapped_size = _SUB2API_SIZE_MAP.get(size, "1:1")
    return [{
        "type": "image_generation",
        "action": "edit" if has_refs else "generate",
        "model": "gpt-image-2",
        "size": mapped_size,
        "quality": "medium",
        "output_format": "png",
    }]


def _parse_sub2api_sse_image_url(text: str) -> str | None:
    """从 Sub2API SSE 流式响应文本中解析图片数据。
    优先从 partial_image_b64 提取（直接 base64），其次找 image_url 字段。
    返回 (data_url, is_base64) 元组或 None。"""
    import re
    b64_match = re.search(r'"partial_image_b64"\s*:\s*"([^"]+)"', text)
    if b64_match:
        b64 = b64_match.group(1)
        return (f"data:image/png;base64,{b64}", True)
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if data == "[DONE]" or not data:
            continue
        try:
            event = json.loads(data)
        except Exception:
            continue
        if not isinstance(event, dict):
            continue
        # 兼容 OpenAI Responses API 各种可能字段
        for key in ("image_url", "url"):
            val = event.get(key)
            if val and isinstance(val, str) and val.startswith("http"):
                return (val, False)
        output = event.get("output")
        if isinstance(output, list):
            for item in output:
                if isinstance(item, dict):
                    if item.get("type") == "image":
                        img = item.get("image_url") or item.get("url")
                        if img:
                            return (img, False)
        for key in ("content", "text"):
            val = event.get(key)
            if val and isinstance(val, str) and val.startswith("http"):
                return (val, False)
    return None


async def generate_sub2api_async(
    model: str,
    prompt: str,
    images: list[tuple[bytes, str]] | None = None,
    size: str = "1024x1024",
    resolution: str = "",
    user_id: str = "anonymous",
    on_progress: Callable[[int, str], Any] | None = None,
) -> dict:
    """Sub2API 订阅线路：POST /responses，SSE 流式返回图片 URL。"""
    base_url = settings.sub2api_base_url.rstrip("/")
    api_key = settings.sub2api_api_key
    if not base_url or not api_key:
        raise RuntimeError("Sub2API 未配置：请检查 SUB2API_BASE_URL 和 SUB2API_API_KEY")

    refs = images or []
    input_payload = _build_sub2api_input(prompt, refs)
    tools = _build_sub2api_tools(model, size, has_refs=bool(refs))

    payload = {
        "stream": True,
        "model": "gpt-5.4-mini",
        "store": False,
        "tool_choice": {"type": "image_generation"},
        "input": input_payload,
        "tools": tools,
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }

    if on_progress:
        on_progress(10, "submitted")

    sse_text = ""
    async with httpx.AsyncClient(timeout=600, trust_env=False) as client:
        try:
            async with client.stream("POST", f"{base_url}/responses", json=payload, headers=headers) as resp:
                if not resp.is_success:
                    raw = await resp.aread()
                    raise RuntimeError(_api_error_msg(resp.status_code, raw.decode("utf-8", errors="replace")))
                if on_progress:
                    on_progress(30, "processing")
                async for chunk in resp.aiter_text():
                    sse_text += chunk
        except httpx.TimeoutException:
            raise RuntimeError("Sub2API 请求超时，请稍后重试")

    image_url = _parse_sub2api_sse_image_url(sse_text)
    if not image_url:
        logger.warning("Sub2API 未解析到图片 URL，SSE 前 2KB: %s", sse_text[:2048])
        raise RuntimeError("Sub2API 返回中未找到图片，请检查响应格式")

    if on_progress:
        on_progress(80, "downloading")

    parse_result = _parse_sub2api_sse_image_url(sse_text)
    if not parse_result:
        logger.warning("Sub2API 未解析到图片，SSE 前 2KB: %s", sse_text[:2048])
        raise RuntimeError("Sub2API 返回中未找到图片，请检查响应格式")
    image_url, is_base64 = parse_result

    if is_base64:
        # base64 data URL，直接解码保存
        b64_str = image_url.split(",", 1)[1] if "," in image_url else image_url
        try:
            image_bytes = base64.b64decode(b64_str)
        except Exception as e:
            raise RuntimeError(f"Sub2API 图片 base64 解码失败: {e}")
        filename = f"{uuid.uuid4().hex}.png"
        out_dir = _ensure_user_output_dir(user_id)
        out_path = out_dir / filename
        out_path.write_bytes(image_bytes)
        local_url = f"/ai-images/{out_dir.name}/{filename}"
    else:
        async with httpx.AsyncClient(timeout=120, trust_env=False) as client2:
            local_url = await _download_final_image(client2, image_url=image_url, user_id=user_id)

    if on_progress:
        on_progress(100, "done")

    return {
        "url": local_url,
        "model": model,
        "prompt": prompt,
        "size": size,
        "resolution": resolution,
        "provider": PROVIDER_SUB2API,
        "task_id": None,
    }

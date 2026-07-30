"""
AI image adapters.

Flow:
1. Optionally upload reference images to the provider.
2. Submit an async image generation task.
3. Poll task status until completed.
4. Download the final image into output/ai-images/{user_id}/{YYYY-MM-DD}/.
"""
from __future__ import annotations

import base64
import io
import json
import logging
import re
import random
import time
import uuid
from datetime import date
from pathlib import Path
from typing import Any, Callable

import httpx
from PIL import Image

from .config import settings

logger = logging.getLogger(__name__)


class TransientTaskStatusError(RuntimeError):
    pass


class FinalImageDownloadError(RuntimeError):
    stage = "download"

    def __init__(self, message: str, *, task_id: str = "") -> None:
        super().__init__(message)
        self.task_id = task_id


class AmbiguousUpstreamError(RuntimeError):
    """同步请求可能已送达上游（读超时/写超时/中途断连），状态不确定，禁止跨渠道重提。"""
    stage = "ambiguous"

    def __init__(self, message: str, *, task_id: str = "", provider: str = "") -> None:
        super().__init__(message)
        self.task_id = task_id
        self.provider = provider


_TRANSIENT_TASK_STATUS_CODES = {408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 523, 524}

_HTTP_ERRORS: dict[int, str] = {
    400: "请求格式错误，可能是参数不合法",
    401: "API Key 验证失败，请检查配置",
    402: "账户余额不足或需要充值，请检查 APIMart 账户",
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
PROVIDER_ADOBE2API = "adobe2api"

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


def format_generation_error(
    exc: BaseException | str | None,
    *,
    stage: str = "",
    provider: str = "",
    model: str = "",
    job_id: str = "",
    task_id: str = "",
) -> str:
    """把异常整理成可排查的用户可见错误文案，保证非空。"""
    if isinstance(exc, BaseException):
        raw = (str(exc) or "").strip() or type(exc).__name__
        exc_name = type(exc).__name__
    else:
        raw = (str(exc) if exc is not None else "").strip()
        exc_name = ""
    if not raw:
        raw = "未返回具体错误信息"

    # 常见可操作提示（附加在原文后，不替换上游细节）
    low = raw.lower()
    tip = ""
    if any(k in low for k in ("timeout", "timed out", "超时")):
        tip = "可稍后重试，或换线路"
    elif any(k in low for k in ("401", "api key", "unauthorized", "鉴权", "验证失败")):
        tip = "请检查 API Key / 线路配置"
    elif any(k in low for k in ("402", "403", "余额", "insufficient", "quota", "payment")):
        tip = "请检查账户余额或权限"
    elif any(k in low for k in ("429", "rate limit", "too many", "频繁")):
        tip = "请求过频，请稍后再试"
    elif any(k in low for k in ("502", "503", "504", "upstream", "disconnected", "connection", "network", "dns")):
        tip = "上游服务或网络异常，可换线路重试"
    elif any(k in low for k in ("content", "safety", "policy", "违规", "审核", "moderation", "blocked")):
        tip = "可能触发内容安全策略，请调整提示词或参考图"
    elif any(k in low for k in ("413", "too large", "过大")):
        tip = "参考图可能过大，请压缩后重试"

    # 避免重复堆叠元信息：若原文已含 job= 则不再附加
    meta_parts: list[str] = []
    if stage and f"阶段={stage}" not in raw and f"stage={stage}" not in low:
        meta_parts.append(f"阶段={stage}")
    if provider and f"线路={provider}" not in raw and provider not in raw:
        meta_parts.append(f"线路={provider}")
    if model and f"模型={model}" not in raw and model not in raw:
        meta_parts.append(f"模型={model}")
    if job_id and f"job={job_id[:8]}" not in raw and job_id not in raw:
        meta_parts.append(f"job={job_id[:8]}")
    if task_id and f"task={task_id}" not in raw and task_id not in raw:
        meta_parts.append(f"task={task_id}")
    if exc_name and exc_name not in raw and not raw.startswith(exc_name):
        # 仅在原文太短/无类型信息时附加异常类名
        if len(raw) < 24 or raw in {"Error", "Exception", "RuntimeError"}:
            meta_parts.insert(0, exc_name)

    msg = raw
    if meta_parts:
        msg = f"{raw}（{' · '.join(meta_parts)}）"
    if tip and tip not in msg:
        msg = f"{msg}。{tip}"
    return msg[:800]


def _safe_user_id(user_id: str) -> str:
    safe = "".join(ch for ch in str(user_id or "").strip() if ch.isalnum() or ch in ("-", "_"))
    return safe or "anonymous"


def _ensure_user_output_dir(user_id: str) -> Path:
    """用户根目录：output/ai-images/{user_id}/（refs/thumbs 等仍挂在这里）"""
    out_dir = _OUTPUT_DIR / _safe_user_id(user_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    return out_dir


def _ensure_user_dated_output_dir(user_id: str, day: date | None = None) -> Path:
    """按日期拆分的成图目录：output/ai-images/{user_id}/{YYYY-MM-DD}/"""
    day_key = (day or date.today()).isoformat()  # YYYY-MM-DD
    out_dir = _ensure_user_output_dir(user_id) / day_key
    out_dir.mkdir(parents=True, exist_ok=True)
    return out_dir


def _ai_image_public_url(path: Path) -> str:
    """磁盘路径 → 对外 URL /ai-images/...（支持任意嵌套子目录）"""
    resolved = path.resolve()
    root = _OUTPUT_DIR.resolve()
    try:
        rel = resolved.relative_to(root)
    except ValueError:
        # 兜底：不应发生；至少返回文件名以免写库失败
        return f"/ai-images/{path.name}"
    return f"/ai-images/{rel.as_posix()}"


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


def get_inspiration_thumb_url_if_exists(image_url: str, user_id: str, job_id: str) -> str:
    """只返回已经存在的缩略图 URL；不存在时回退原图，不做同步生成。"""
    if not image_url.startswith("/ai-images/"):
        return image_url
    thumb_path = _OUTPUT_DIR / user_id / "thumbs" / f"{job_id}.webp"
    if thumb_path.exists():
        return f"/ai-images/{user_id}/thumbs/{job_id}.webp"
    return image_url


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


PROVIDER_AUTO = "auto"


def normalize_provider(provider: str | None = None) -> str:
    clean = (provider or settings.ai_image_provider or PROVIDER_AUTO).strip().casefold()
    if clean in ("auto", "smart", "智能路由", "智能"):
        return PROVIDER_AUTO
    if clean in ("apimart", "api-mart", "api_mart"):
        return PROVIDER_APIMART
    if clean in ("sub2api", "sub2-api", "sub_2api"):
        return PROVIDER_SUB2API
    if clean in ("adobe2api", "adobe-2api", "adobe"):
        return PROVIDER_ADOBE2API
    raise ValueError(f"未知生图线路: {provider}")


def _normalize_model_name(model: str) -> str:
    clean = (model or "").strip()
    if not clean:
        raise ValueError("model 不能为空")
    return SLASH_MODEL_MAP.get(clean.casefold(), clean)


def _normalize_size(size: str, resolution: str = "") -> tuple[str, str]:
    clean = (size or "").strip()
    explicit_resolution = (resolution or "").strip().upper()
    if explicit_resolution not in ("1K", "2K", "4K"):
        explicit_resolution = ""

    if clean in _SIZE_MAP:
        mapped_ratio, mapped_resolution = _SIZE_MAP[clean]
        # 像素尺寸命中时 ratio 以 map 为准；显式 resolution 覆盖 map 中的默认清晰度
        # （例如 size=auto + resolution=2K 不能被 _SIZE_MAP["auto"] 的 1K 盖掉）
        return mapped_ratio, explicit_resolution or mapped_resolution

    clean_resolution = explicit_resolution or "1K"
    if clean in ("auto", "1:1", "3:4", "4:3", "5:4", "4:5", "9:16", "16:9", "2:3", "3:2"):
        return clean, clean_resolution
    return "1:1", clean_resolution


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


def _extract_b64_or_image_url(payload: Any) -> str | None:
    if isinstance(payload, str):
        clean = payload.strip()
        if clean.startswith("data:image/"):
            return clean
        if clean.startswith("http://") or clean.startswith("https://") or clean.startswith("/"):
            return clean
        return None
    if isinstance(payload, dict):
        # OpenAI chat.completions 风格：choices[].message.content 可能是 data URL / 外链 / 多模态 list
        choices = payload.get("choices")
        if isinstance(choices, list):
            for choice in choices:
                if not isinstance(choice, dict):
                    continue
                message = choice.get("message") or {}
                content = message.get("content") if isinstance(message, dict) else None
                if isinstance(content, str):
                    found = _extract_b64_or_image_url(content)
                    if found:
                        return found
                elif isinstance(content, list):
                    for part in content:
                        if not isinstance(part, dict):
                            continue
                        if part.get("type") == "image_url":
                            image_url = part.get("image_url")
                            if isinstance(image_url, dict):
                                found = _extract_b64_or_image_url(image_url.get("url"))
                            else:
                                found = _extract_b64_or_image_url(image_url)
                            if found:
                                return found
                        found = _extract_b64_or_image_url(part.get("text") or part.get("url"))
                        if found:
                            return found
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
    if isinstance(payload, list):
        for item in payload:
            found = _extract_b64_or_image_url(item)
            if found:
                return found
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


def _save_data_url_image(data_url: str, *, user_id: str, prefix: str = "ai_image") -> str:
    match = re.match(r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.+)$", data_url or "", re.DOTALL)
    if not match:
        raise RuntimeError("返回了无法识别的图片 data URL")
    mime_type, raw_b64 = match.groups()
    try:
        content = base64.b64decode(raw_b64, validate=True)
    except Exception as exc:
        raise RuntimeError("图片 base64 解码失败") from exc
    if not content:
        raise RuntimeError("图片内容为空")
    out_dir = _ensure_user_dated_output_dir(user_id)
    filename = f"{prefix}_{uuid.uuid4().hex}{_extension_from_mime(mime_type)}"
    out_path = out_dir / filename
    out_path.write_bytes(content)
    return _ai_image_public_url(out_path)


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
                raise RuntimeError(
                    f"任务已完成，但未拿到图片 URL（task_id={task_id}）: {str(data)[:500]}"
                )
            await asyncio_sleep(1.5)
            continue
        if status in {"failed", "error", "cancelled", "canceled"}:
            extracted = _extract_task_error(data)
            if extracted:
                error_text = str(extracted)[:400]
            else:
                # 上游只回 status=failed 无 error 字段时，至少带上原始 payload 片段
                error_text = f"上游状态={status}，详情={str(data)[:360]}"
            raise RuntimeError(f"生图任务失败（task_id={task_id}）: {error_text}")
        await asyncio_sleep(poll_interval)
    raise RuntimeError(
        f"生图任务超时（task_id={task_id}），最后状态={last_status or 'unknown'}，进度={last_progress}%"
    )


async def asyncio_sleep(seconds: float) -> None:
    import asyncio

    await asyncio.sleep(seconds)


async def _download_final_image(
    client: httpx.AsyncClient,
    *,
    image_url: str,
    user_id: str,
    task_id: str = "",
) -> str:
    proxy_url = settings.ai_image_download_proxy_url
    download_client = client
    owned_client: httpx.AsyncClient | None = None
    if proxy_url:
        owned_client = httpx.AsyncClient(
            timeout=httpx.Timeout(180.0, connect=20.0),
            trust_env=False,
            proxy=proxy_url,
            follow_redirects=True,
        )
        download_client = owned_client

    resp: httpx.Response | None = None
    last_error: BaseException | None = None
    try:
        for attempt in range(1, 4):
            try:
                resp = await download_client.get(image_url)
                if resp.is_success:
                    break
                if resp.status_code not in _TRANSIENT_TASK_STATUS_CODES or attempt == 3:
                    raise FinalImageDownloadError(
                        f"下载结果图片失败：HTTP {resp.status_code}",
                        task_id=task_id,
                    )
                last_error = RuntimeError(f"HTTP {resp.status_code}")
            except FinalImageDownloadError:
                raise
            except httpx.RequestError as exc:
                last_error = exc
                if attempt == 3:
                    raise FinalImageDownloadError(
                        f"下载结果图片网络失败：{type(exc).__name__}: {exc}",
                        task_id=task_id,
                    ) from exc
            await asyncio_sleep(float(attempt))
    finally:
        if owned_client is not None:
            await owned_client.aclose()

    if resp is None or not resp.is_success:
        raise FinalImageDownloadError(
            f"下载结果图片失败：{last_error or '未知错误'}",
            task_id=task_id,
        )
    filename = f"{uuid.uuid4().hex}.png"
    out_dir = _ensure_user_dated_output_dir(user_id)
    out_path = out_dir / filename
    out_path.write_bytes(resp.content)
    return _ai_image_public_url(out_path)


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
        local_url = await _download_final_image(
            client, image_url=result_url, user_id=user_id, task_id=task_id
        )
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
        local_url = await _download_final_image(
            client, image_url=result_url, user_id=user_id, task_id=task_id
        )
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
    on_accepted: Callable[[str], Any] | None = None,
) -> dict:
    """异步生图：提交任务 → 轮询进度 → 下载结果。

    on_progress(progress, api_status) 用于 UI/持久化。
    on_accepted(task_id) 仅在上游明确接受任务后触发（用于智能路由防重复计费）。
    """
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
        if on_accepted:
            on_accepted(str(task_id))
        if on_progress:
            on_progress(10, "submitted")
        result_url, _, _task_detail = await _wait_for_task_result(
            client,
            base_url=base_url,
            headers=headers,
            task_id=task_id,
            on_progress=on_progress,
        )
        local_url = await _download_final_image(
            client, image_url=result_url, user_id=user_id, task_id=task_id
        )
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
    on_accepted: Callable[[str], Any] | None = None,
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
        if on_accepted:
            on_accepted(str(task_id))
        if on_progress:
            try:
                on_progress(10, "submitted")  # type: ignore[misc]
            except TypeError:
                on_progress(10)
        result_url, _, _task_detail = await _wait_for_task_result(
            client,
            base_url=base_url,
            headers=headers,
            task_id=task_id,
            on_progress=on_progress,
        )
        local_url = await _download_final_image(
            client, image_url=result_url, user_id=user_id, task_id=task_id
        )
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


# ── Sub2API/CLIProxyAPI 订阅线路 ───────────────────────────────────────────────

PROVIDER_SUB2API = "sub2api"

_CLIPROXY_SIZE_MAP: dict[str, dict[str, str]] = {
    "1K": {
        "auto": "1024x1024",
        "1:1": "1024x1024",
        "4:5": "1024x1280",
        "5:4": "1280x1024",
        "3:4": "1152x1536",
        "4:3": "1536x1152",
        "2:3": "1024x1536",
        "3:2": "1536x1024",
        "9:16": "864x1536",
        "16:9": "1536x864",
        "9:21": "672x1568",
        "21:9": "1568x672",
    },
    "2K": {
        "auto": "2048x2048",
        "1:1": "2048x2048",
        "4:5": "1600x2000",
        "5:4": "2000x1600",
        "3:4": "1536x2048",
        "4:3": "2048x1536",
        "2:3": "1344x2016",
        "3:2": "2016x1344",
        "9:16": "1152x2048",
        "16:9": "2048x1152",
        "9:21": "1152x2688",
        "21:9": "2688x1152",
    },
    "4K": {
        "auto": "2880x2880",
        "1:1": "2880x2880",
        "4:5": "2560x3200",
        "5:4": "3200x2560",
        "3:4": "2448x3264",
        "4:3": "3264x2448",
        "2:3": "2336x3504",
        "3:2": "3504x2336",
        "9:16": "2160x3840",
        "16:9": "3840x2160",
        "9:21": "1632x3808",
        "21:9": "3808x1632",
    },
}

_CLIPROXY_PIXEL_ALIAS: dict[str, str] = {
    # 历史 UI/旧服务商像素值兼容到文档推荐尺寸。
    "1024x1024": "1024x1024",
    "2048x2048": "2048x2048",
    "4096x4096": "2880x2880",
    "1024x1280": "1024x1280",
    "1280x1024": "1280x1024",
    "1152x1536": "1152x1536",
    "1536x1152": "1536x1152",
    "1024x1536": "1024x1536",
    "1536x1024": "1536x1024",
    "864x1536": "864x1536",
    "1536x864": "1536x864",
    "768x1024": "1152x1536",
    "1024x768": "1536x1152",
    "1080x1920": "864x1536",
    "1920x1080": "1536x864",
    "1360x2048": "1344x2016",
    "2048x1360": "2016x1344",
    "2480x3312": "2448x3264",
    "3312x2480": "3264x2448",
    "3520x2336": "3504x2336",
    "2336x3520": "2336x3504",
}


def _cliproxy_size(size: str, resolution: str = "") -> str:
    raw_size = str(size or "auto").strip().lower().replace("×", "x")
    raw_resolution = str(resolution or "1K").strip().upper()
    if raw_resolution not in _CLIPROXY_SIZE_MAP:
        raw_resolution = "1K"
    if raw_size in _CLIPROXY_SIZE_MAP[raw_resolution]:
        return _CLIPROXY_SIZE_MAP[raw_resolution][raw_size]
    if raw_size in _CLIPROXY_PIXEL_ALIAS:
        return _CLIPROXY_PIXEL_ALIAS[raw_size]
    if re.match(r"^\d{2,5}x\d{2,5}$", raw_size):
        return raw_size
    return _CLIPROXY_SIZE_MAP[raw_resolution]["auto"]


def _cliproxy_headers(api_key: str, *, json_request: bool = False) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
        "Accept-Language": "en,zh;q=0.9,zh-CN;q=0.8",
    }
    if json_request:
        headers["Content-Type"] = "application/json"
    return headers


def _save_base64_image(b64_value: str, *, user_id: str) -> str:
    raw = str(b64_value or "")
    if "," in raw and raw.startswith("data:"):
        raw = raw.split(",", 1)[1]
    try:
        image_bytes = base64.b64decode(raw)
    except Exception as exc:
        raise RuntimeError(f"CLIProxyAPI 图片 base64 解码失败: {exc}") from exc
    if not image_bytes:
        raise RuntimeError("CLIProxyAPI 返回的 base64 图片为空")
    filename = f"{uuid.uuid4().hex}.png"
    out_dir = _ensure_user_dated_output_dir(user_id)
    out_path = out_dir / filename
    out_path.write_bytes(image_bytes)
    return _ai_image_public_url(out_path)


async def _download_cliproxy_image(
    image_url: str,
    *,
    user_id: str,
    api_key: str,
) -> str:
    timeout = httpx.Timeout(300.0, connect=30.0)
    client_kwargs: dict[str, Any] = {"timeout": timeout, "trust_env": False}
    if settings.cliproxy_proxy_url:
        client_kwargs["proxy"] = settings.cliproxy_proxy_url
    async with httpx.AsyncClient(**client_kwargs) as client:
        resp = await client.get(image_url)
        if resp.status_code in (401, 403):
            resp = await client.get(image_url, headers=_cliproxy_headers(api_key))
        if not resp.is_success:
            raise RuntimeError(f"下载 CLIProxyAPI 结果图片失败：HTTP {resp.status_code}")
        filename = f"{uuid.uuid4().hex}.png"
        out_dir = _ensure_user_dated_output_dir(user_id)
        out_path = out_dir / filename
        out_path.write_bytes(resp.content)
        return _ai_image_public_url(out_path)


async def _save_cliproxy_response_image(data: dict[str, Any], *, user_id: str, api_key: str) -> tuple[str, dict[str, Any]]:
    if not isinstance(data, dict):
        raise RuntimeError(f"CLIProxyAPI 响应格式异常: {str(data)[:200]}")
    if data.get("error"):
        raise RuntimeError(f"CLIProxyAPI 生图失败: {str(data.get('error'))[:300]}")
    items = data.get("data")
    if not isinstance(items, list) or not items:
        raise RuntimeError(f"CLIProxyAPI 响应中没有图片 data: {str(data)[:300]}")
    item = items[0]
    if not isinstance(item, dict):
        raise RuntimeError(f"CLIProxyAPI 图片条目格式异常: {str(item)[:200]}")
    if item.get("b64_json"):
        return _save_base64_image(str(item.get("b64_json")), user_id=user_id), item
    if item.get("url"):
        return await _download_cliproxy_image(str(item.get("url")), user_id=user_id, api_key=api_key), item
    raise RuntimeError(f"CLIProxyAPI 图片条目没有 b64_json 或 url: {str(item)[:300]}")


async def generate_sub2api_async(
    model: str,
    prompt: str,
    images: list[tuple[bytes, str]] | None = None,
    size: str = "1024x1024",
    resolution: str = "",
    user_id: str = "anonymous",
    on_progress: Callable[[int, str], Any] | None = None,
    on_accepted: Callable[[str], Any] | None = None,
) -> dict:
    """订阅线路：通过 CLIProxyAPI 的 OpenAI Images 兼容接口生图。"""
    base_url = settings.cliproxy_base_url.rstrip("/")
    api_key = settings.cliproxy_api_key
    if not base_url or not api_key:
        raise RuntimeError("CLIProxyAPI 未配置：请检查 CLIPROXY_BASE_URL/CLIPROXY_API_KEY")
    if base_url.endswith("/v1"):
        api_base = base_url
    else:
        api_base = f"{base_url}/v1"

    model_name = _normalize_model_name(model)
    if model_name != "gpt-image-2":
        raise RuntimeError("CLIProxyAPI 订阅线路当前仅支持 gpt-image-2")

    refs = (images or [])[:9]
    mapped_size = _cliproxy_size(size, resolution)
    timeout = httpx.Timeout(1800.0, connect=30.0)

    if on_progress:
        on_progress(5, "starting")

    try:
        client_kwargs: dict[str, Any] = {"timeout": timeout, "trust_env": False}
        if settings.cliproxy_proxy_url:
            client_kwargs["proxy"] = settings.cliproxy_proxy_url
        async with httpx.AsyncClient(**client_kwargs) as client:
            if refs:
                data = {
                    "model": model_name,
                    "prompt": prompt,
                    "size": mapped_size,
                    "n": "1",
                    "quality": "auto",
                    "output_format": "png",
                    "moderation": "auto",
                }
                files = [
                    ("image", (filename or f"reference-{idx + 1}.png", image_bytes, _mime_from_filename(filename)))
                    for idx, (image_bytes, filename) in enumerate(refs)
                ]
                endpoint = f"{api_base}/images/edits"
                resp = await client.post(endpoint, data=data, files=files, headers=_cliproxy_headers(api_key))
            else:
                payload = {
                    "model": model_name,
                    "prompt": prompt,
                    "size": mapped_size,
                    "n": 1,
                    "quality": "auto",
                    "output_format": "png",
                    "moderation": "auto",
                }
                endpoint = f"{api_base}/images/generations"
                resp = await client.post(endpoint, json=payload, headers=_cliproxy_headers(api_key, json_request=True))
    except httpx.RequestError as exc:
        kind = classify_httpx_transport_error(exc)
        if kind == "connect":
            raise RuntimeError(f"CLIProxyAPI 连接失败：{exc}") from exc
        if kind == "ambiguous":
            raise AmbiguousUpstreamError(
                f"CLIProxyAPI 请求可能已送达但响应超时/中断（状态不确定，不切换渠道）：{exc}",
                provider=PROVIDER_SUB2API,
            ) from exc
        raise RuntimeError(f"CLIProxyAPI 请求失败：{exc}") from exc

    raw_text = resp.text
    if not resp.is_success:
        raise RuntimeError(f"CLIProxyAPI 生图失败：{_api_error_msg(resp.status_code, raw_text[:500])}")
    try:
        payload = resp.json()
    except Exception as exc:
        raise RuntimeError(f"CLIProxyAPI 返回不是 JSON: {raw_text[:300]}") from exc
    if isinstance(payload, dict) and payload.get("error"):
        raise RuntimeError(f"CLIProxyAPI 生图失败: {str(payload.get('error'))[:300]}")

    # 同步接口：HTTP 成功且无 error 即上游已接受/完成，后续下载失败不可再跨渠道重提
    upstream_id = str((payload or {}).get("id") or "cliproxy-accepted")
    if on_accepted:
        on_accepted(upstream_id)
    if on_progress:
        on_progress(85, "saving")
    local_url, item = await _save_cliproxy_response_image(payload, user_id=user_id, api_key=api_key)
    if on_progress:
        on_progress(100, "done")

    usage = payload.get("usage") if isinstance(payload, dict) else None
    return {
        "url": local_url,
        "model": model_name,
        "prompt": prompt,
        "size": mapped_size,
        "requested_size": size,
        "resolution": resolution,
        "provider": PROVIDER_SUB2API,
        "task_id": upstream_id if upstream_id != "cliproxy-accepted" else None,
        "usage": usage if isinstance(usage, dict) else None,
        "revised_prompt": item.get("revised_prompt") if isinstance(item, dict) else None,
    }


# ── adobe2api (Firefly / OpenAI 兼容接口) ───────────────────────────────────────────────

async def generate_adobe2api_async(
    model: str,
    prompt: str,
    images: list[tuple[bytes, str]] | None = None,
    size: str = "1024x1024",
    resolution: str = "",
    user_id: str = "anonymous",
    on_progress: Callable[[int, str], Any] | None = None,
    on_accepted: Callable[[str], Any] | None = None,
) -> dict:
    """通过 adobe2api 服务生成/编辑图片 (OpenAI 兼容聊天/生图接口)"""
    base_url = settings.adobe2api_base_url.rstrip("/")
    if not base_url.endswith("/v1"):
        base_url = f"{base_url}/v1"
    api_key = settings.adobe2api_api_key
    if not base_url or not api_key:
        raise RuntimeError("adobe2api 未配置：请检查 ADOBE2API_BASE_URL/ADOBE2API_API_KEY")

    api_endpoint = f"{base_url}/chat/completions"
    ratio, res_clean = _normalize_size(size, resolution)

    model_name = _normalize_model_name(model).lower()
    ratio_suffix = ratio.replace(":", "x")
    res_suffix = res_clean.lower() or "1k"

    # 归一化后的 gemini 模型名不含 banana，需一并识别，避免静默落到 GPT Image
    if (
        "banana" in model_name
        or "gemini" in model_name
        or model_name == "gemini-3-pro-image-preview"
    ):
        target_model = f"firefly-nano-banana-pro-{res_suffix}-{ratio_suffix}"
    else:
        target_model = f"firefly-gpt-image-{res_suffix}-{ratio_suffix}"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    content_list: list[dict[str, Any]] = [{"type": "text", "text": prompt}]

    refs = images or []
    if refs:
        # adobe2api / Firefly 侧可接受多图；与主链路一致最多 9 张
        if len(refs) > 9:
            logger.warning("[adobe2api] 参考图 %d 张，仅发送前 9 张", len(refs))
        for img_bytes, filename in refs[:9]:
            data_url = _image_bytes_to_data_url(img_bytes, filename)
            content_list.append({
                "type": "image_url",
                "image_url": {"url": data_url},
            })

    payload = {
        "model": target_model,
        "messages": [{"role": "user", "content": content_list}],
    }

    if on_progress:
        on_progress(5, "starting")

    timeout = httpx.Timeout(300.0, connect=30.0)
    try:
        async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
            resp = await client.post(api_endpoint, json=payload, headers=headers)
    except httpx.RequestError as exc:
        kind = classify_httpx_transport_error(exc)
        if kind == "connect":
            raise RuntimeError(f"adobe2api 连接失败：{exc}") from exc
        if kind == "ambiguous":
            raise AmbiguousUpstreamError(
                f"adobe2api 请求可能已送达但响应超时/中断（状态不确定，不切换渠道）：{exc}",
                provider=PROVIDER_ADOBE2API,
            ) from exc
        raise RuntimeError(f"adobe2api 请求失败：{exc}") from exc

    if not resp.is_success:
        raise RuntimeError(f"adobe2api 请求失败: HTTP {resp.status_code} - {_extract_error_text(resp)}")

    data = resp.json()
    result_url = _extract_b64_or_image_url(data) or _extract_result_url(data)
    if not result_url:
        raise RuntimeError(f"adobe2api 未返回有效图片 URL 或 Base64: {str(data)[:200]}")

    # 同步接口：拿到有效图片内容后才算上游已接受
    if on_accepted:
        on_accepted(str((data or {}).get("id") or "adobe2api-accepted"))
    if on_progress:
        on_progress(85, "saving")

    if result_url.startswith("data:"):
        local_url = _save_data_url_image(result_url, user_id=user_id, prefix="adobe2api")
    else:
        local_url = await _download_cliproxy_image(result_url, user_id=user_id, api_key=api_key)

    if on_progress:
        on_progress(100, "done")

    return {
        "url": local_url,
        "provider": PROVIDER_ADOBE2API,
        "model": target_model,
        "prompt": prompt,
        "size": size,
        "resolution": resolution,
        "task_id": str((data or {}).get("id") or ""),
    }


# ── 智能路由调度 (Smart Routing) ─────────────────────────────────────────────────────────────

_NON_FAILOVER_HTTP_CODES = {400, 401, 402, 403, 404, 413, 422}


def classify_httpx_transport_error(exc: BaseException) -> str:
    """分类传输层错误：connect=可切换；ambiguous=可能已送达不可切换；other=其它。"""
    if isinstance(exc, (httpx.ConnectError, httpx.ConnectTimeout)):
        return "connect"
    if isinstance(exc, (httpx.ReadTimeout, httpx.WriteTimeout, httpx.PoolTimeout)):
        return "ambiguous"
    if isinstance(exc, httpx.RemoteProtocolError):
        return "ambiguous"
    if isinstance(exc, httpx.TimeoutException):
        # 未细分的 TimeoutException：同步接口保守视为可能已送达
        return "ambiguous"
    if isinstance(exc, httpx.RequestError):
        msg = str(exc).lower()
        if any(k in msg for k in (
            "connect", "connection refused", "name or service not known",
            "nodename nor servname", "dns", "getaddrinfo", "network is unreachable",
        )):
            return "connect"
        return "ambiguous"
    return "other"


def is_transient_provider_error(exc: BaseException | str | None) -> bool:
    """仅对可恢复错误切换线路；参数/鉴权/内容审核等确定性失败不跨渠道重试。

    已提交上游任务后的轮询/下载失败、以及同步接口读/写超时（状态不确定）不切换。
    """
    if isinstance(exc, AmbiguousUpstreamError):
        return False

    raw = str(exc or "").strip()
    if not raw:
        return True
    low = raw.lower()

    # 同步接口状态不确定：禁止切换，避免重复计费
    if any(k in low for k in (
        "请求可能已送达", "状态不确定", "read timeout", "write timeout",
        "pool timeout", "响应超时", "中途断开", "remoteprotocol",
    )):
        return False

    # 任务已提交后的后半程失败：不跨渠道重提
    if any(k in low for k in (
        "下载结果", "下载 cli", "下载结果图片", "poll", "轮询",
        "saving", "task_id=", "task=",
    )) and any(k in low for k in ("timeout", "超时", "http ", "failed", "失败")):
        if "提交" not in low and "submit" not in low:
            if any(k in low for k in ("下载", "download", "poll", "轮询", "saving")):
                return False

    # 确定性错误：不切换
    if any(k in low for k in (
        "content", "safety", "policy", "违规", "审核", "moderation", "blocked",
        "invalid", "参数", "validation", "unprocessable",
        "api key", "unauthorized", "鉴权", "验证失败",
        "余额", "insufficient", "quota", "payment", "permission",
        "not configured", "未配置",
    )):
        return False

    for code in _NON_FAILOVER_HTTP_CODES:
        if re.search(rf"\bHTTP\s*{code}\b", raw, re.IGNORECASE) or f" {code}" in raw or f":{code}" in low:
            if code != 429:
                return False

    # 明确的连接阶段失败 / 限流 / 5xx：可切换
    if any(k in low for k in (
        "connect", "connection refused", "连接超时", "连接失败",
        "429", "rate limit", "too many", "频繁",
        "502", "503", "504", "500", "520", "522", "523", "524",
        "dns", "name or service", "network is unreachable",
        "temporarily", "unavailable", "服务暂时",
    )):
        return True

    # 泛化 timeout 若未命中上面的“响应/读超时”否定项：仍允许切换（多为连接侧文案）
    if any(k in low for k in ("timeout", "timed out", "超时")):
        return True

    # 默认：未知错误允许切换一次（保持可用性）
    return True


# 默认模型选路优先级表：映射标准模型名到首选/降级线路
DEFAULT_MODEL_ROUTING_RULES: dict[str, list[str]] = {
    "default": [PROVIDER_SUB2API, PROVIDER_ADOBE2API, PROVIDER_APIMART],
}

# 服务商能力集合：定义各线路真正支持的模型 (None/空集代表支持全量模型)
PROVIDER_MODEL_CAPABILITIES: dict[str, set[str] | None] = {
    PROVIDER_SUB2API: {"gpt-image-2"},  # Sub2API 当前仅支持 gpt-image-2
    PROVIDER_ADOBE2API: {"gemini-3-pro-image-preview", "gpt-image-2"},
    PROVIDER_APIMART: None,  # APIMart 适配通用架构，全支持
}


def _get_custom_rules() -> dict[str, list[str]]:
    """读取自定义规则（在 .env 中填 SMART_ROUTING_RULES_JSON 覆写）"""
    rules: dict[str, list[str]] = {}
    raw_json = getattr(settings, "smart_routing_rules_json", "").strip()
    if raw_json:
        try:
            parsed = json.loads(raw_json)
            if isinstance(parsed, dict):
                for k, v in parsed.items():
                    if isinstance(v, list):
                        rules[k.casefold()] = [str(item).strip().lower() for item in v if str(item).strip()]
        except Exception as exc:
            logger.warning("[smart-routing] 无法解析 SMART_ROUTING_RULES_JSON: %s", exc)
    return rules


def get_smart_route_candidates(model: str, resolution: str = "", size: str = "1024x1024") -> list[str]:
    """根据请求模型、清晰度、能力表与静态 Key 配置，动态计算选路序列"""
    model_name = _normalize_model_name(model).lower()
    custom_rules = _get_custom_rules()

    # 显式 resolution 优先；仅当未传时才从 size 像素串推断（_normalize_size 在命中 _SIZE_MAP 时会忽略 resolution）
    res_upper = (resolution or "").strip().upper()
    if not res_upper:
        _ratio, res_clean = _normalize_size(size, resolution)
        res_upper = res_clean.upper() if res_clean else "1K"

    # 1. 根据模型与画质分辨率选择匹配规则（环境 JSON 显式规则优先）
    if custom_rules and model_name in custom_rules:
        preferred_order = custom_rules[model_name]
    elif model_name == "gpt-image-2":
        if res_upper in ("2K", "4K"):
            preferred_order = [PROVIDER_ADOBE2API, PROVIDER_APIMART]
        else:  # 1K 或 auto 默认为 1K
            preferred_order = [PROVIDER_SUB2API, PROVIDER_APIMART, PROVIDER_ADOBE2API]
    elif "banana" in model_name or "gemini" in model_name:
        preferred_order = [PROVIDER_APIMART, PROVIDER_ADOBE2API]
    else:
        preferred_order = (custom_rules and custom_rules.get("default")) or [PROVIDER_SUB2API, PROVIDER_ADOBE2API, PROVIDER_APIMART]

    candidates: list[str] = []

    # 2. 能力表 & 静态 Key 双重过滤
    for provider in preferred_order:
        # 校验 2.1: 线路是否支持该模型
        supported = PROVIDER_MODEL_CAPABILITIES.get(provider)
        if supported is not None and model_name not in supported:
            logger.debug("[smart-routing] Provider %s skipped for model %s (not supported by capability matrix)", provider, model_name)
            continue

        # 校验 2.2: 线路是否有配置 Key
        if provider == PROVIDER_SUB2API:
            if settings.cliproxy_base_url and settings.cliproxy_api_key:
                candidates.append(provider)
        elif provider == PROVIDER_ADOBE2API:
            if settings.adobe2api_base_url and settings.adobe2api_api_key:
                candidates.append(provider)
        elif provider == PROVIDER_APIMART:
            if settings.ai_image_api_key:
                candidates.append(provider)

    # 兜底：若过滤后为空，回退使用 apimart / sub2api 暴露明细错误
    if not candidates:
        candidates = [PROVIDER_SUB2API, PROVIDER_APIMART]

    return candidates


async def smart_generate_image_async(
    model: str,
    prompt: str,
    images: list[tuple[bytes, str]] | None = None,
    size: str = "1024x1024",
    resolution: str = "",
    user_id: str = "anonymous",
    on_progress: Callable[[int, str], Any] | None = None,
    on_accepted: Callable[[str, str], Any] | None = None,
) -> dict:
    """智能路由生图：按模型与配置选路，仅对暂态错误自动 Failover。

    是否已提交上游由各 provider 的 on_accepted 明确信号决定。
    外层 on_accepted(provider, upstream_id) 用于立即持久化任务号。
    """
    candidates = get_smart_route_candidates(model, resolution=resolution, size=size)
    logger.info("[smart-routing] Candidate providers for model=%s res=%s size=%s: %s",
                model, resolution, size, candidates)

    errors: list[str] = []
    primary_provider = candidates[0]
    accepted: dict[str, str] = {}
    last_provider = primary_provider

    def _make_on_accepted(provider_name: str):
        def _inner(upstream_id: str = "") -> None:
            uid = str(upstream_id or "accepted")
            accepted[provider_name] = uid
            logger.info(
                "[smart-routing] Provider %s accepted by upstream id=%s",
                provider_name, uid,
            )
            if on_accepted:
                try:
                    on_accepted(provider_name, uid)
                except Exception as cb_exc:
                    logger.warning("[smart-routing] on_accepted callback failed: %s", cb_exc)
        return _inner

    def _raise_with_context(exc: BaseException, provider_name: str, err_msg: str) -> None:
        task_id = accepted.get(provider_name) or getattr(exc, "task_id", "") or ""
        if isinstance(exc, AmbiguousUpstreamError):
            exc.task_id = str(task_id or exc.task_id or "")
            exc.provider = provider_name
            raise AmbiguousUpstreamError(err_msg, task_id=str(task_id or ""), provider=provider_name) from exc
        # 包装为带 task_id 的 RuntimeError 子类信息，供 main 读取
        wrapped = RuntimeError(err_msg)
        wrapped.task_id = str(task_id or "")  # type: ignore[attr-defined]
        wrapped.provider = provider_name  # type: ignore[attr-defined]
        wrapped.stage = getattr(exc, "stage", "smart_route")  # type: ignore[attr-defined]
        raise wrapped from exc

    for index, provider in enumerate(candidates):
        last_provider = provider
        provider_on_accepted = _make_on_accepted(provider)
        try:
            logger.info("[smart-routing] Attempting provider %s (%d/%d)", provider, index + 1, len(candidates))
            if provider == PROVIDER_SUB2API:
                result = await generate_sub2api_async(
                    model=model, prompt=prompt, images=images,
                    size=size, resolution=resolution, user_id=user_id,
                    on_progress=on_progress, on_accepted=provider_on_accepted,
                )
            elif provider == PROVIDER_ADOBE2API:
                result = await generate_adobe2api_async(
                    model=model, prompt=prompt, images=images,
                    size=size, resolution=resolution, user_id=user_id,
                    on_progress=on_progress, on_accepted=provider_on_accepted,
                )
            else:  # APIMart
                if images:
                    result = await generate_image_with_reference_async(
                        model=model, prompt=prompt, images=images,
                        size=size, resolution=resolution, user_id=user_id,
                        on_progress=on_progress, on_accepted=provider_on_accepted,
                    )
                else:
                    result = await generate_image_async(
                        model=model, prompt=prompt,
                        size=size, resolution=resolution, user_id=user_id,
                        on_progress=on_progress, on_accepted=provider_on_accepted,
                    )

            result["provider"] = provider
            if accepted.get(provider) and not result.get("task_id"):
                result["task_id"] = accepted[provider]
            if provider != primary_provider:
                result["provider_switched"] = True
                logger.warning(
                    "[smart-routing] Successfully failovered from %s to %s",
                    primary_provider, provider
                )
            return result

        except Exception as exc:
            err_msg = format_generation_error(exc, stage="smart_route", provider=provider, model=model)
            logger.warning("[smart-routing] Provider %s failed: %s", provider, err_msg)
            errors.append(f"{provider}: {err_msg}")

            is_last = index >= len(candidates) - 1
            already_accepted = provider in accepted
            can_failover = is_transient_provider_error(exc) and not already_accepted and not is_last
            if already_accepted or isinstance(exc, AmbiguousUpstreamError) or not can_failover:
                if already_accepted:
                    logger.warning(
                        "[smart-routing] Provider %s already accepted upstream (id=%s); skip failover to avoid duplicate billing",
                        provider, accepted.get(provider),
                    )
                elif isinstance(exc, AmbiguousUpstreamError):
                    logger.warning(
                        "[smart-routing] Provider %s ambiguous transport error; skip failover to avoid duplicate billing",
                        provider,
                    )
                elif not is_last:
                    logger.warning(
                        "[smart-routing] Provider %s error is non-transient; stop failover",
                        provider,
                    )
                _raise_with_context(exc, provider, err_msg)

    final = RuntimeError(f"所有可用 AI 生图线路均尝试失败：{' | '.join(errors)}")
    final.provider = last_provider  # type: ignore[attr-defined]
    final.task_id = accepted.get(last_provider, "")  # type: ignore[attr-defined]
    raise final


def compress_image_to_data_url(image_bytes: bytes, max_long_side: int = 1024) -> str:
    """把任意图片压成长边 ≤ max_long_side 的 webp data_url，供多模态 LLM 消费。

    alpha 通道合成白底，避免 webp 黑底；只缩小不放大。不拒绝大图。
    """
    src = io.BytesIO(image_bytes)
    with Image.open(src) as img:
        img = img.convert("RGBA")
        rgb = Image.new("RGB", img.size, (255, 255, 255))
        rgb.paste(img, mask=img.getchannel("A"))
        if max(rgb.size) > max_long_side:
            rgb.thumbnail((max_long_side, max_long_side), Image.LANCZOS)
        out = io.BytesIO()
        rgb.save(out, format="WEBP", quality=82, method=4)
        encoded = base64.b64encode(out.getvalue()).decode("ascii")
        return f"data:image/webp;base64,{encoded}"

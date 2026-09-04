"""Black Forest Labs FLUX outpainting transport and image validation.

This module deliberately owns the BFL wire format. Callers must resolve and
authorize internal DesignFlow URLs before passing a local path here.
"""
from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import inspect
import io
import ipaddress
import logging
import math
import os
import re
import time
import uuid
import warnings
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Awaitable, Callable
from urllib.parse import quote, unquote, urljoin, urlsplit

import httpx
from PIL import Image, UnidentifiedImageError


logger = logging.getLogger(__name__)

BFL_API_URL = "https://api.bfl.ai"
BFL_API_HOST = "api.bfl.ai"
BFL_OUTPAINTING_PATH = "/v1/flux-tools/outpainting-v1"
BFL_OUTPAINTING_MODEL = "flux-tools/outpainting-v1"
BFL_ALLOWED_MODES = frozenset({"fast", "high"})
BFL_READY_STATUS = "ready"
BFL_PENDING_STATUSES = frozenset({"pending", "reasoning", "generating"})
BFL_FAILURE_STATUSES = frozenset({
    "error",
    "request moderated",
    "content moderated",
    "task not found",
})
LEGACY_MARGIN_ALIGNMENT = 64
MAX_OUTPUT_SIDE = 2048
MAX_OUTPUT_PIXELS = 4_194_304
MIN_CANVAS_SIDE = 64
_PROVIDER_GEOMETRY_FIELDS = (
    "provider_top",
    "provider_right",
    "provider_bottom",
    "provider_left",
    "provider_width",
    "provider_height",
    "provider_margin_alignment",
)
_TRANSIENT_HTTP_STATUSES = {408, 425, 429, 500, 502, 503, 504}
_ALLOWED_SOURCE_FORMATS = {"PNG", "JPEG", "WEBP"}
_ALLOWED_DATA_MIMES = {
    "image/png": "PNG",
    "image/jpeg": "JPEG",
    "image/jpg": "JPEG",
    "image/webp": "WEBP",
}

ProgressCallback = Callable[[int, str], Awaitable[None] | None]
AcceptedCallback = Callable[[str, str], Awaitable[None] | None]


class OutpaintingValidationError(ValueError):
    """A safe validation failure suitable for an HTTP 4xx response."""


class BflOutpaintingError(RuntimeError):
    """Provider/download failure with separate public and diagnostic messages."""

    def __init__(
        self,
        public_message: str,
        *,
        diagnostic: str = "",
        http_status: int | None = None,
    ) -> None:
        super().__init__(public_message)
        self.public_message = public_message
        self.diagnostic = diagnostic[:800]
        self.http_status = http_status


@dataclass(frozen=True)
class PreparedOutpaintingImage:
    data_uri: str
    source_width: int
    source_height: int
    processing_width: int
    processing_height: int
    source_format: str
    source_sha256: str
    encoded_bytes: int


@dataclass(frozen=True)
class OutpaintingGeometry:
    top: int
    right: int
    bottom: int
    left: int
    expected_width: int
    expected_height: int
    provider_top: int
    provider_right: int
    provider_bottom: int
    provider_left: int
    provider_width: int
    provider_height: int

    def requested_margins(self) -> dict[str, int]:
        return {
            "top": self.top,
            "right": self.right,
            "bottom": self.bottom,
            "left": self.left,
        }

    def provider_margins(self) -> dict[str, int]:
        return {
            "top": self.provider_top,
            "right": self.provider_right,
            "bottom": self.provider_bottom,
            "left": self.provider_left,
        }

    def crop_box(self) -> tuple[int, int, int, int]:
        x0 = self.provider_left - self.left
        y0 = self.provider_top - self.top
        return (
            x0,
            y0,
            x0 + self.expected_width,
            y0 + self.expected_height,
        )

    def bfl_canvas(self) -> dict[str, int]:
        return {
            "width": self.provider_width,
            "height": self.provider_height,
            "reference_offset_x": self.provider_left,
            "reference_offset_y": self.provider_top,
        }


@dataclass(frozen=True)
class BflOutpaintingResult:
    image_url: str
    provider_task_id: str
    polling_url: str
    cost: float | None
    width: int
    height: int


def strict_int(value: Any, field_name: str, *, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise OutpaintingValidationError(f"{field_name} 必须是整数")
    if value < minimum:
        qualifier = "非负" if minimum == 0 else f"至少为 {minimum}"
        raise OutpaintingValidationError(f"{field_name} 必须{qualifier}")
    return value


def align_margin_for_provider(value: int, alignment: int) -> int:
    if value <= 0:
        return 0
    return ((value + alignment - 1) // alignment) * alignment


def validate_geometry(
    *,
    processing_width: int,
    processing_height: int,
    top: Any,
    right: Any,
    bottom: Any,
    left: Any,
    margin_alignment: int = 1,
    max_width: int = MAX_OUTPUT_SIDE,
    max_height: int = MAX_OUTPUT_SIDE,
    max_pixels: int = MAX_OUTPUT_PIXELS,
) -> OutpaintingGeometry:
    processing_width = strict_int(processing_width, "processing_width", minimum=1)
    processing_height = strict_int(processing_height, "processing_height", minimum=1)
    margin_alignment = strict_int(margin_alignment, "margin_alignment", minimum=1)
    max_width = min(MAX_OUTPUT_SIDE, strict_int(max_width, "max_width", minimum=1))
    max_height = min(MAX_OUTPUT_SIDE, strict_int(max_height, "max_height", minimum=1))
    max_pixels = min(MAX_OUTPUT_PIXELS, strict_int(max_pixels, "max_pixels", minimum=1))
    margins = {
        "top": strict_int(top, "top"),
        "right": strict_int(right, "right"),
        "bottom": strict_int(bottom, "bottom"),
        "left": strict_int(left, "left"),
    }
    if not any(margins.values()):
        raise OutpaintingValidationError("至少一个扩图边距必须大于 0")

    expected_width = processing_width + margins["left"] + margins["right"]
    expected_height = processing_height + margins["top"] + margins["bottom"]
    if expected_width < MIN_CANVAS_SIDE or expected_height < MIN_CANVAS_SIDE:
        raise OutpaintingValidationError(
            f"扩图结果不能小于 {MIN_CANVAS_SIDE} × {MIN_CANVAS_SIDE}px"
        )
    if expected_width > max_width or expected_height > max_height:
        raise OutpaintingValidationError(
            f"扩图结果不能超过 {max_width} × {max_height}px"
        )
    if expected_width * expected_height > max_pixels:
        raise OutpaintingValidationError(f"扩图结果不能超过 {max_pixels} 像素")

    if margin_alignment == 1:
        provider_margins = dict(margins)
    else:
        provider_margins = {
            name: align_margin_for_provider(value, margin_alignment)
            for name, value in margins.items()
        }
    provider_width = (
        processing_width
        + provider_margins["left"]
        + provider_margins["right"]
    )
    provider_height = (
        processing_height
        + provider_margins["top"]
        + provider_margins["bottom"]
    )
    if provider_width > max_width or provider_height > max_height:
        raise OutpaintingValidationError(
            f"扩图范围按服务要求处理后不能超过 {max_width} × {max_height}px"
        )
    if provider_width * provider_height > max_pixels:
        raise OutpaintingValidationError(
            f"扩图范围按服务要求处理后不能超过 {max_pixels} 像素"
        )
    return OutpaintingGeometry(
        **margins,
        expected_width=expected_width,
        expected_height=expected_height,
        provider_top=provider_margins["top"],
        provider_right=provider_margins["right"],
        provider_bottom=provider_margins["bottom"],
        provider_left=provider_margins["left"],
        provider_width=provider_width,
        provider_height=provider_height,
    )


def _provider_geometry_snapshot(
    geometry: OutpaintingGeometry,
    alignment: int,
) -> dict[str, int]:
    return {
        "provider_top": geometry.provider_top,
        "provider_right": geometry.provider_right,
        "provider_bottom": geometry.provider_bottom,
        "provider_left": geometry.provider_left,
        "provider_width": geometry.provider_width,
        "provider_height": geometry.provider_height,
        "provider_margin_alignment": alignment,
    }


def resolve_geometry_from_meta(
    meta: dict[str, Any],
    *,
    max_width: int = MAX_OUTPUT_SIDE,
    max_height: int = MAX_OUTPUT_SIDE,
    max_pixels: int = MAX_OUTPUT_PIXELS,
) -> OutpaintingGeometry:
    """Rebuild geometry for recovery.

    New jobs store exact provider margins. In-flight jobs created before that
    change may still have a 64-aligned provider envelope; keep those pollable.
    """
    requested = {
        "processing_width": meta.get("processing_width"),
        "processing_height": meta.get("processing_height"),
        "top": meta.get("top"),
        "right": meta.get("right"),
        "bottom": meta.get("bottom"),
        "left": meta.get("left"),
        "max_width": max_width,
        "max_height": max_height,
        "max_pixels": max_pixels,
    }
    geometry = validate_geometry(**requested, margin_alignment=1)
    present = {name for name in _PROVIDER_GEOMETRY_FIELDS if name in meta}
    if not present:
        return geometry
    if present != set(_PROVIDER_GEOMETRY_FIELDS):
        raise OutpaintingValidationError("恢复服务尺寸信息不完整")

    def stored_matches(expected: dict[str, int]) -> bool:
        return not any(
            isinstance(meta.get(name), bool)
            or not isinstance(meta.get(name), int)
            or meta.get(name) != value
            for name, value in expected.items()
        )

    if stored_matches(_provider_geometry_snapshot(geometry, 1)):
        return geometry
    legacy = validate_geometry(
        **requested,
        margin_alignment=LEGACY_MARGIN_ALIGNMENT,
    )
    if stored_matches(
        _provider_geometry_snapshot(legacy, LEGACY_MARGIN_ALIGNMENT)
    ):
        return legacy
    raise OutpaintingValidationError("恢复服务尺寸不一致")


def _read_source_bytes(source: str | Path, max_source_bytes: int) -> tuple[bytes, str | None]:
    if isinstance(source, Path):
        try:
            size = source.stat().st_size
        except OSError as exc:
            raise OutpaintingValidationError("无法读取源图片") from exc
        if size <= 0:
            raise OutpaintingValidationError("源图片为空")
        if size > max_source_bytes:
            raise OutpaintingValidationError("源图片文件过大")
        try:
            return source.read_bytes(), None
        except OSError as exc:
            raise OutpaintingValidationError("无法读取源图片") from exc

    value = str(source or "").strip()
    match = re.fullmatch(
        r"data:(image/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)",
        value,
        flags=re.IGNORECASE,
    )
    if not match:
        raise OutpaintingValidationError("仅支持站内图片或有效的图片 data URI")
    mime = match.group(1).lower()
    if mime not in _ALLOWED_DATA_MIMES:
        raise OutpaintingValidationError("仅支持 PNG、JPEG 或 WebP 图片")
    encoded = match.group(2)
    estimated_size = (len(encoded) * 3) // 4
    if estimated_size > max_source_bytes + 2:
        raise OutpaintingValidationError("data URI 图片过大")
    try:
        payload = base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise OutpaintingValidationError("data URI 图片内容无效") from exc
    if not payload:
        raise OutpaintingValidationError("源图片为空")
    if len(payload) > max_source_bytes:
        raise OutpaintingValidationError("data URI 图片过大")
    return payload, mime


def _validated_loaded_image(
    payload: bytes,
    *,
    declared_mime: str | None,
    max_source_pixels: int,
) -> tuple[Image.Image, str, int, int]:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(payload)) as probe:
                source_format = str(probe.format or "").upper()
                width, height = probe.size
                if source_format not in _ALLOWED_SOURCE_FORMATS:
                    raise OutpaintingValidationError("仅支持 PNG、JPEG 或 WebP 图片")
                if declared_mime and _ALLOWED_DATA_MIMES.get(declared_mime) != source_format:
                    raise OutpaintingValidationError("data URI 声明格式与图片内容不一致")
                if width <= 0 or height <= 0:
                    raise OutpaintingValidationError("源图片尺寸无效")
                if width * height > max_source_pixels:
                    raise OutpaintingValidationError("源图片像素过大")
                if int(getattr(probe, "n_frames", 1) or 1) != 1:
                    raise OutpaintingValidationError("不支持动画图片")
                probe.verify()

            with Image.open(io.BytesIO(payload)) as decoded:
                decoded.load()
                if decoded.mode in {"RGBA", "LA"} or (
                    decoded.mode == "P" and "transparency" in decoded.info
                ):
                    loaded = decoded.convert("RGBA")
                else:
                    loaded = decoded.convert("RGB")
    except OutpaintingValidationError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise OutpaintingValidationError("源图片像素过大")
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise OutpaintingValidationError("源图片损坏或无法解码") from exc
    return loaded, source_format, width, height


def _processing_size(
    source_width: int,
    source_height: int,
    processing_width: Any,
    processing_height: Any,
) -> tuple[int, int]:
    if processing_width is None and processing_height is None:
        return source_width, source_height
    if processing_width is None or processing_height is None:
        raise OutpaintingValidationError("processing_width 和 processing_height 必须同时提供")
    width = strict_int(processing_width, "processing_width", minimum=1)
    height = strict_int(processing_height, "processing_height", minimum=1)
    if width > source_width or height > source_height:
        raise OutpaintingValidationError("处理尺寸只能按比例缩小，不能放大源图片")
    # Integer resize dimensions may differ by one rounding pixel while preserving the
    # source aspect ratio. Larger distortion is rejected because the canvas preview
    # and provider input would no longer describe the same geometry.
    ratio_error = abs(width * source_height - height * source_width)
    if ratio_error > max(source_width, source_height):
        raise OutpaintingValidationError("处理尺寸必须与源图片保持相同比例")
    return width, height


def prepare_outpainting_image(
    source: str | Path,
    *,
    processing_width: Any = None,
    processing_height: Any = None,
    max_source_bytes: int,
    max_source_pixels: int,
    max_encoded_input_bytes: int,
) -> PreparedOutpaintingImage:
    """Validate, decode and optionally proportionally downscale a source image."""
    payload, declared_mime = _read_source_bytes(source, max_source_bytes)
    image, source_format, source_width, source_height = _validated_loaded_image(
        payload,
        declared_mime=declared_mime,
        max_source_pixels=max_source_pixels,
    )
    width, height = _processing_size(
        source_width,
        source_height,
        processing_width,
        processing_height,
    )
    try:
        if (width, height) != (source_width, source_height):
            image = image.resize((width, height), Image.Resampling.LANCZOS)
        encoded_buffer = io.BytesIO()
        image.save(encoded_buffer, format="PNG", optimize=True)
        encoded_png = encoded_buffer.getvalue()
    finally:
        image.close()
    if len(encoded_png) > max_encoded_input_bytes:
        raise OutpaintingValidationError("处理后的图片数据过大")
    data_uri = "data:image/png;base64," + base64.b64encode(encoded_png).decode("ascii")
    return PreparedOutpaintingImage(
        data_uri=data_uri,
        source_width=source_width,
        source_height=source_height,
        processing_width=width,
        processing_height=height,
        source_format=source_format,
        source_sha256=hashlib.sha256(payload).hexdigest(),
        encoded_bytes=len(encoded_png),
    )


_PRE_SUBMIT_PHASES = frozenset({"queued"})
_SOURCE_SNAPSHOT_NAME = "source.png"


def is_pre_submit_phase(phase: Any) -> bool:
    """True when the persisted job has not yet attempted a BFL submit."""
    return str(phase or "").strip().casefold() in _PRE_SUBMIT_PHASES


def _safe_path_component(value: str) -> str:
    safe = "".join(
        char for char in str(value or "").strip() if char.isalnum() or char in {"-", "_"}
    )
    return safe or "anonymous"


def _png_bytes_from_data_uri(data_uri: str) -> bytes:
    marker = "base64,"
    index = str(data_uri or "").find(marker)
    if index < 0:
        raise OutpaintingValidationError("处理后的图片数据无效")
    try:
        payload = base64.b64decode(data_uri[index + len(marker):], validate=True)
    except (ValueError, binascii.Error) as exc:
        raise OutpaintingValidationError("处理后的图片数据无效") from exc
    if not payload:
        raise OutpaintingValidationError("处理后的图片数据无效")
    return payload


def _snapshot_directory(output_root: Path, user_id: str, job_id: str) -> Path:
    safe_user = _safe_path_component(user_id)
    safe_job = _safe_path_component(job_id)
    if safe_job == "anonymous":
        raise OutpaintingValidationError("扩图任务 ID 无效")
    return output_root / "ai-images" / safe_user / "outpainting" / safe_job


def persist_prepared_source_snapshot(
    prepared: PreparedOutpaintingImage,
    *,
    output_root: Path,
    user_id: str,
    job_id: str,
) -> str:
    """Write the prepared PNG to disk so queued recovery can resubmit the same image."""
    png_payload = _png_bytes_from_data_uri(prepared.data_uri)
    directory = _snapshot_directory(output_root, user_id, job_id)
    directory.mkdir(parents=True, exist_ok=True)
    out_path = directory / _SOURCE_SNAPSHOT_NAME
    temp_path = directory / f".{_SOURCE_SNAPSHOT_NAME}.{uuid.uuid4().hex}.tmp"
    try:
        temp_path.write_bytes(png_payload)
        os.replace(temp_path, out_path)
    finally:
        try:
            temp_path.unlink(missing_ok=True)
        except OSError:
            pass
    rel = out_path.relative_to(output_root / "ai-images")
    return "/ai-images/" + quote(rel.as_posix(), safe="/")


def _resolve_source_snapshot_path(
    snapshot_url: str,
    *,
    output_root: Path,
    user_id: str,
) -> Path:
    value = str(snapshot_url or "").strip()
    prefix = "/ai-images/"
    if not value.startswith(prefix):
        raise OutpaintingValidationError("扩图原图快照路径无效")
    try:
        rel = unquote(value[len(prefix):].lstrip("/"))
    except Exception as exc:
        raise OutpaintingValidationError("扩图原图快照路径无效") from exc
    parts = Path(rel).parts
    safe_user = _safe_path_component(user_id)
    if (
        len(parts) != 4
        or parts[0] != safe_user
        or parts[1] != "outpainting"
        or parts[3] != _SOURCE_SNAPSHOT_NAME
        or parts[2] != _safe_path_component(parts[2])
        or parts[2] == "anonymous"
    ):
        raise OutpaintingValidationError("扩图原图快照路径无效")
    root = (output_root / "ai-images").resolve()
    owner_root = (root / safe_user).resolve()
    candidate = (root.joinpath(*parts)).resolve()
    if owner_root not in candidate.parents:
        raise OutpaintingValidationError("扩图原图快照路径无效")
    if not candidate.is_file():
        raise OutpaintingValidationError("扩图原图快照不存在")
    return candidate


def load_prepared_source_snapshot(
    snapshot_url: str,
    *,
    output_root: Path,
    user_id: str,
    meta: dict[str, Any],
) -> PreparedOutpaintingImage:
    """Rebuild the prepared image from a durable snapshot written before submit."""
    path = _resolve_source_snapshot_path(
        snapshot_url,
        output_root=output_root,
        user_id=user_id,
    )
    payload = path.read_bytes()
    if not payload:
        raise OutpaintingValidationError("扩图原图快照为空")
    try:
        source_width = strict_int(meta.get("source_width"), "source_width", minimum=1)
        source_height = strict_int(meta.get("source_height"), "source_height", minimum=1)
        processing_width = strict_int(meta.get("processing_width"), "processing_width", minimum=1)
        processing_height = strict_int(meta.get("processing_height"), "processing_height", minimum=1)
    except OutpaintingValidationError as exc:
        raise OutpaintingValidationError("扩图原图快照尺寸无效") from exc
    try:
        with Image.open(io.BytesIO(payload)) as image:
            image.load()
            actual_size = image.size
    except (Image.DecompressionBombError, UnidentifiedImageError, OSError, ValueError) as exc:
        raise OutpaintingValidationError("扩图原图快照损坏") from exc
    if actual_size != (processing_width, processing_height):
        raise OutpaintingValidationError("扩图原图快照尺寸不一致")
    data_uri = "data:image/png;base64," + base64.b64encode(payload).decode("ascii")
    return PreparedOutpaintingImage(
        data_uri=data_uri,
        source_width=source_width,
        source_height=source_height,
        processing_width=processing_width,
        processing_height=processing_height,
        source_format=str(meta.get("source_format") or "PNG"),
        source_sha256=str(meta.get("source_sha256") or ""),
        encoded_bytes=len(payload),
    )


def discard_prepared_source_snapshot(
    snapshot_url: str,
    *,
    output_root: Path,
    user_id: str,
) -> None:
    try:
        path = _resolve_source_snapshot_path(
            snapshot_url,
            output_root=output_root,
            user_id=user_id,
        )
        path.unlink(missing_ok=True)
        parent = path.parent
        if parent.exists():
            try:
                parent.rmdir()
            except OSError:
                pass
    except Exception:
        return


def _safe_text(value: Any, limit: int = 300) -> str:
    text = str(value or "")
    text = re.sub(
        r"data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+",
        "[image-data-redacted]",
        text,
        flags=re.IGNORECASE,
    )
    return "".join(char if char.isprintable() else " " for char in text)[:limit]


def public_error_for_status(status_code: int | None) -> str:
    if status_code == 401:
        return "扩图服务鉴权失败，请联系管理员"
    if status_code == 402:
        return "扩图服务账户余额不足，请联系管理员"
    if status_code == 403:
        return "扩图服务拒绝了请求，请联系管理员"
    if status_code == 422:
        return "扩图参数未被服务接受，请调整后重试"
    if status_code == 429:
        return "扩图服务繁忙，请稍后重试"
    if status_code is not None and status_code >= 500:
        return "扩图服务暂时不可用，请稍后重试"
    return "扩图服务处理失败，请稍后重试"


def _json_payload(response: httpx.Response) -> dict[str, Any] | None:
    try:
        payload = response.json()
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None


def _bfl_error_detail(payload: dict[str, Any] | None) -> str:
    if not payload:
        return ""
    detail = payload.get("detail")
    if isinstance(detail, str) and detail.strip():
        return _safe_text(detail, 200)
    if isinstance(detail, list):
        parts: list[str] = []
        for item in detail[:3]:
            if isinstance(item, dict):
                parts.append(_safe_text(item.get("msg") or item.get("message") or item, 80))
            else:
                parts.append(_safe_text(item, 80))
        return "; ".join(part for part in parts if part)
    for key in ("message", "error", "status"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return _safe_text(value, 200)
    return ""


def _raise_bfl_http_error(
    response: httpx.Response,
    *,
    payload: dict[str, Any] | None = None,
) -> None:
    payload = payload if payload is not None else _json_payload(response)
    detail = _bfl_error_detail(payload)
    raise BflOutpaintingError(
        public_error_for_status(response.status_code),
        diagnostic=f"HTTP {response.status_code} {detail}".strip(),
        http_status=response.status_code,
    )


def _raw_base64_from_data_uri(data_uri: str) -> str:
    marker = "base64,"
    index = str(data_uri or "").find(marker)
    if index < 0:
        raise BflOutpaintingError(
            "扩图服务内部状态无效，请稍后重试",
            diagnostic="prepared image is missing base64 payload",
        )
    value = data_uri[index + len(marker):].strip()
    if not value:
        raise BflOutpaintingError(
            "扩图服务内部状态无效，请稍后重试",
            diagnostic="prepared image base64 payload is empty",
        )
    return value


def _normalized_bfl_api_url(api_url: str) -> str:
    parsed = urlsplit(str(api_url or "").strip())
    path = parsed.path.rstrip("/")
    if (
        parsed.scheme.lower() != "https"
        or (parsed.hostname or "").casefold().rstrip(".") != BFL_API_HOST
        or path not in {"", "/"}
        or parsed.query
        or parsed.fragment
        or parsed.username
        or parsed.password
    ):
        raise BflOutpaintingError(
            "扩图服务配置无效，请联系管理员",
            diagnostic="BFL_API_URL must equal https://api.bfl.ai",
        )
    return f"https://{BFL_API_HOST}"


def _host_allowed(hostname: str, allowed_host_suffixes: tuple[str, ...]) -> bool:
    host = hostname.casefold().rstrip(".")
    allowed = tuple(
        suffix.casefold().strip().lstrip(".").rstrip(".")
        for suffix in allowed_host_suffixes
        if suffix.strip().lstrip(".").rstrip(".")
    )
    return bool(allowed) and any(host == suffix or host.endswith("." + suffix) for suffix in allowed)


def _validate_bfl_polling_url(raw_url: str) -> str:
    try:
        parsed = urlsplit(str(raw_url or "").strip())
    except Exception as exc:
        raise BflOutpaintingError(
            "扩图服务返回的轮询地址无效，请稍后重试",
            diagnostic="polling_url parse failed",
        ) from exc
    hostname = (parsed.hostname or "").casefold().rstrip(".")
    if (
        parsed.scheme.lower() != "https"
        or not hostname
        or parsed.username
        or parsed.password
        or not _host_allowed(hostname, ("bfl.ai",))
        or hostname in {"localhost", "localhost.localdomain"}
        or hostname.endswith(".local")
    ):
        raise BflOutpaintingError(
            "扩图服务返回的轮询地址不受信任，请稍后重试",
            diagnostic=f"polling_url host={_safe_text(hostname, 80)}",
        )
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        return parsed.geturl()
    if not address.is_global:
        raise BflOutpaintingError(
            "扩图服务返回的轮询地址无效，请稍后重试",
            diagnostic="polling_url is not a public host",
        )
    return parsed.geturl()


def _accepted_task(payload: dict[str, Any] | None) -> tuple[str, str, float | None]:
    if not payload:
        raise BflOutpaintingError(
            "扩图服务返回无效响应，请稍后重试",
            diagnostic="submit payload is not an object",
        )
    task_id = str(payload.get("id") or "").strip()
    polling_url = str(payload.get("polling_url") or "").strip()
    if not task_id:
        raise BflOutpaintingError(
            "扩图服务返回无效响应，请稍后重试",
            diagnostic="submit response missing id",
        )
    if not polling_url:
        raise BflOutpaintingError(
            "扩图服务返回无效响应，请稍后重试",
            diagnostic="submit response missing polling_url",
        )
    return task_id, _validate_bfl_polling_url(polling_url), _result_cost(payload)


def _poll_status(payload: dict[str, Any] | None) -> str:
    if not payload:
        return ""
    return str(payload.get("status") or payload.get("state") or "").strip().casefold()


def _poll_result_url(payload: dict[str, Any] | None) -> str:
    if not payload:
        return ""
    result = payload.get("result")
    if isinstance(result, dict):
        sample = result.get("sample")
        if isinstance(sample, str) and sample.strip():
            return sample.strip()
        for key in ("imageURL", "imageUrl", "image_url", "url"):
            value = result.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    for key in ("sample", "imageURL", "imageUrl", "image_url", "url"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _public_error_for_bfl_status(status: str) -> str:
    if status in {"request moderated", "content moderated"}:
        return "扩图内容未通过安全审核，请更换图片后重试"
    if status == "task not found":
        return "扩图任务无法恢复，请重新扩图"
    return "扩图服务处理失败，请稍后重试"


async def _notify_accepted(
    callback: AcceptedCallback | None,
    provider_task_id: str,
    polling_url: str,
) -> None:
    if callback is None:
        return
    result = callback(provider_task_id, polling_url)
    if inspect.isawaitable(result):
        await result


def _validate_fast_mode_geometry(
    prepared: PreparedOutpaintingImage,
    geometry: OutpaintingGeometry,
) -> None:
    if prepared.processing_width < MIN_CANVAS_SIDE or prepared.processing_height < MIN_CANVAS_SIDE:
        raise OutpaintingValidationError(
            f"fast 模式要求原图每边至少 {MIN_CANVAS_SIDE}px"
        )
    long_side = max(prepared.processing_width, prepared.processing_height)
    short_side = min(prepared.processing_width, prepared.processing_height)
    if short_side <= 0 or long_side > short_side * 8:
        raise OutpaintingValidationError("fast 模式要求原图宽高比不超过 8:1")
    if geometry.provider_width < MIN_CANVAS_SIDE or geometry.provider_height < MIN_CANVAS_SIDE:
        raise OutpaintingValidationError(
            f"扩图结果不能小于 {MIN_CANVAS_SIDE} × {MIN_CANVAS_SIDE}px"
        )


def _result_cost(item: dict[str, Any] | None) -> float | None:
    if not item:
        return None
    value = item.get("cost")
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    if isinstance(value, str):
        try:
            parsed = float(value)
        except ValueError:
            return None
        return parsed if math.isfinite(parsed) else None
    return None


def _retry_after_seconds(response: httpx.Response | None, fallback: float, cap: float) -> float:
    if response is not None:
        raw = str(response.headers.get("Retry-After") or "").strip()
        if raw:
            try:
                return min(cap, max(0.0, float(raw)))
            except ValueError:
                try:
                    parsed = parsedate_to_datetime(raw)
                    if parsed.tzinfo is None:
                        parsed = parsed.replace(tzinfo=timezone.utc)
                    return min(cap, max(0.0, (parsed - datetime.now(timezone.utc)).total_seconds()))
                except (TypeError, ValueError, OverflowError):
                    pass
    return min(cap, max(0.0, fallback))


async def _notify(callback: ProgressCallback | None, progress: int, phase: str) -> None:
    if callback is None:
        return
    result = callback(progress, phase)
    if inspect.isawaitable(result):
        await result


def _validate_result_url(raw_url: str, allowed_host_suffixes: tuple[str, ...]) -> None:
    try:
        parsed = urlsplit(raw_url)
    except Exception as exc:
        raise BflOutpaintingError("扩图结果地址无效，请稍后重试") from exc
    if parsed.scheme.lower() != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise BflOutpaintingError("扩图结果地址无效，请稍后重试")
    hostname = parsed.hostname.casefold().rstrip(".")
    allowed = tuple(
        suffix.casefold().strip().lstrip(".").rstrip(".")
        for suffix in allowed_host_suffixes
        if suffix.strip().lstrip(".").rstrip(".")
    )
    if not allowed or not any(hostname == suffix or hostname.endswith("." + suffix) for suffix in allowed):
        raise BflOutpaintingError("扩图结果地址不受信任，请稍后重试")
    if hostname in {"localhost", "localhost.localdomain"} or hostname.endswith(".local"):
        raise BflOutpaintingError("扩图结果地址无效，请稍后重试")
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        return
    if not address.is_global:
        raise BflOutpaintingError("扩图结果地址无效，请稍后重试")


class _TransientDownloadError(RuntimeError):
    def __init__(self, message: str, response: httpx.Response | None = None) -> None:
        super().__init__(message)
        self.response = response


async def _download_once(
    client: httpx.AsyncClient,
    image_url: str,
    *,
    max_result_bytes: int,
    allowed_host_suffixes: tuple[str, ...],
    max_redirects: int = 3,
) -> bytes:
    current_url = image_url
    for redirect_count in range(max_redirects + 1):
        _validate_result_url(current_url, allowed_host_suffixes)
        try:
            stream_context = client.stream(
                "GET",
                current_url,
                headers={"Accept": "image/*"},
                follow_redirects=False,
            )
            async with stream_context as response:
                if response.status_code in {301, 302, 303, 307, 308}:
                    location = str(response.headers.get("Location") or "").strip()
                    if not location or redirect_count >= max_redirects:
                        raise BflOutpaintingError("扩图结果下载重定向无效，请稍后重试")
                    current_url = urljoin(current_url, location)
                    continue
                if response.status_code in _TRANSIENT_HTTP_STATUSES:
                    raise _TransientDownloadError(
                        f"download HTTP {response.status_code}", response
                    )
                if not response.is_success:
                    mapped = (
                        public_error_for_status(response.status_code)
                        if response.status_code in {401, 402, 403, 422, 429} or response.status_code >= 500
                        else "扩图结果下载失败，请稍后重试"
                    )
                    raise BflOutpaintingError(
                        mapped,
                        diagnostic=f"download HTTP {response.status_code}",
                        http_status=response.status_code,
                    )
                content_type = str(response.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
                if not content_type.startswith("image/"):
                    raise BflOutpaintingError(
                        "扩图结果不是有效图片，请稍后重试",
                        diagnostic=f"download content_type={_safe_text(content_type, 80)}",
                    )
                raw_length = str(response.headers.get("Content-Length") or "").strip()
                if raw_length.isdigit() and int(raw_length) > max_result_bytes:
                    raise BflOutpaintingError("扩图结果文件过大，已停止下载")
                chunks: list[bytes] = []
                total = 0
                async for chunk in response.aiter_bytes():
                    if not chunk:
                        continue
                    total += len(chunk)
                    if total > max_result_bytes:
                        raise BflOutpaintingError("扩图结果文件过大，已停止下载")
                    chunks.append(chunk)
                if not chunks:
                    raise BflOutpaintingError("扩图结果图片为空，请稍后重试")
                return b"".join(chunks)
        except _TransientDownloadError:
            raise
        except BflOutpaintingError:
            raise
        except httpx.RequestError as exc:
            raise _TransientDownloadError(type(exc).__name__) from exc
    raise BflOutpaintingError("扩图结果下载重定向过多，请稍后重试")


def _validate_and_save_result(
    payload: bytes,
    *,
    output_root: Path,
    user_id: str,
    job_id: str,
    geometry: OutpaintingGeometry,
) -> str:
    safe_image: Image.Image | None = None
    try:
        with Image.open(io.BytesIO(payload)) as probe:
            image_format = str(probe.format or "").upper()
            dimensions = probe.size
            probe.verify()
        if image_format != "PNG":
            raise BflOutpaintingError("扩图服务返回的图片格式不正确，请稍后重试")
        if dimensions != (geometry.provider_width, geometry.provider_height):
            raise BflOutpaintingError(
                "扩图结果尺寸不正确，请稍后重试",
                diagnostic=(
                    f"provider_expected={geometry.provider_width}x{geometry.provider_height} "
                    f"actual={dimensions[0]}x{dimensions[1]}"
                ),
            )
        crop_box = geometry.crop_box()
        if (
            crop_box[0] < 0
            or crop_box[1] < 0
            or crop_box[2] > geometry.provider_width
            or crop_box[3] > geometry.provider_height
            or crop_box[2] <= crop_box[0]
            or crop_box[3] <= crop_box[1]
        ):
            raise BflOutpaintingError(
                "扩图结果裁剪范围无效，请稍后重试",
                diagnostic=(
                    f"crop={crop_box} provider="
                    f"{geometry.provider_width}x{geometry.provider_height}"
                ),
            )
        with Image.open(io.BytesIO(payload)) as decoded:
            decoded.load()
            converted = decoded.convert(
                "RGBA"
                if decoded.mode in {"RGBA", "LA"}
                or (decoded.mode == "P" and "transparency" in decoded.info)
                else "RGB"
            )
        try:
            safe_image = converted.crop(crop_box)
        finally:
            converted.close()
        if safe_image.size != (geometry.expected_width, geometry.expected_height):
            raise BflOutpaintingError(
                "扩图结果裁剪尺寸不正确，请稍后重试",
                diagnostic=(
                    f"expected={geometry.expected_width}x{geometry.expected_height} "
                    f"actual={safe_image.size[0]}x{safe_image.size[1]}"
                ),
            )
    except BflOutpaintingError:
        if safe_image is not None:
            safe_image.close()
        raise
    except (Image.DecompressionBombError, UnidentifiedImageError, OSError, ValueError) as exc:
        if safe_image is not None:
            safe_image.close()
        raise BflOutpaintingError("扩图结果图片损坏，请稍后重试") from exc

    safe_user = "".join(
        char for char in str(user_id or "").strip() if char.isalnum() or char in {"-", "_"}
    ) or "anonymous"
    dated_dir = output_root / "ai-images" / safe_user / datetime.now().date().isoformat()
    dated_dir.mkdir(parents=True, exist_ok=True)
    out_path = dated_dir / f"outpainting_{job_id}.png"
    temp_path = dated_dir / f".{out_path.name}.{uuid.uuid4().hex}.tmp"
    try:
        safe_image.save(temp_path, format="PNG", optimize=True)
        os.replace(temp_path, out_path)
    finally:
        safe_image.close()
        try:
            temp_path.unlink(missing_ok=True)
        except OSError:
            pass
    rel = out_path.relative_to(output_root / "ai-images")
    return "/ai-images/" + quote(rel.as_posix(), safe="/")


async def _download_result(
    client: httpx.AsyncClient,
    image_url: str,
    *,
    output_root: Path,
    user_id: str,
    job_id: str,
    geometry: OutpaintingGeometry,
    max_result_bytes: int,
    allowed_host_suffixes: tuple[str, ...],
    retry_count: int,
    retry_backoff_seconds: float,
    retry_backoff_cap_seconds: float,
) -> str:
    response: httpx.Response | None = None
    for attempt in range(retry_count + 1):
        try:
            payload = await _download_once(
                client,
                image_url,
                max_result_bytes=max_result_bytes,
                allowed_host_suffixes=allowed_host_suffixes,
            )
            return _validate_and_save_result(
                payload,
                output_root=output_root,
                user_id=user_id,
                job_id=job_id,
                geometry=geometry,
            )
        except _TransientDownloadError as exc:
            response = exc.response
            if attempt >= retry_count:
                status_code = response.status_code if response is not None else None
                public_message = (
                    public_error_for_status(status_code)
                    if status_code is not None
                    else "扩图结果下载网络失败，请稍后重试"
                )
                raise BflOutpaintingError(
                    public_message,
                    diagnostic=f"download transient retries={attempt + 1} error={_safe_text(exc, 120)}",
                    http_status=status_code,
                ) from exc
            delay = _retry_after_seconds(
                response,
                retry_backoff_seconds * (2**attempt),
                retry_backoff_cap_seconds,
            )
            await asyncio.sleep(delay)
    raise BflOutpaintingError("扩图结果下载失败，请稍后重试")


async def run_outpainting(
    *,
    api_key: str,
    api_url: str = BFL_API_URL,
    mode: str,
    output_format: str = "png",
    auto_crop: bool = False,
    result_host_suffixes: tuple[str, ...] = ("delivery.bfl.ai", "bfl.ai"),
    prepared: PreparedOutpaintingImage | None,
    geometry: OutpaintingGeometry,
    provider_task_id: str = "",
    polling_url: str = "",
    output_root: Path,
    user_id: str,
    job_id: str,
    timeout_seconds: float,
    poll_interval_seconds: float,
    transient_retry_count: int,
    retry_backoff_seconds: float,
    retry_backoff_cap_seconds: float,
    max_result_bytes: int,
    result_download_retry_count: int,
    submit_request: bool = True,
    on_progress: ProgressCallback | None = None,
    on_accepted: AcceptedCallback | None = None,
) -> BflOutpaintingResult:
    """Submit to BFL outpainting-v1, persist the returned id, then poll and save."""
    api_url = _normalized_bfl_api_url(api_url)
    normalized_mode = str(mode or "").strip().casefold()
    if normalized_mode not in BFL_ALLOWED_MODES:
        raise BflOutpaintingError(
            "扩图服务配置无效，请联系管理员",
            diagnostic=f"unsupported mode={_safe_text(mode, 40)}",
        )
    if str(output_format or "").strip().lower() != "png" or auto_crop:
        raise BflOutpaintingError(
            "扩图服务配置无效，请联系管理员",
            diagnostic="outpainting requires PNG and auto_crop=false",
        )
    if submit_request:
        if prepared is None:
            raise BflOutpaintingError(
                "扩图服务内部状态无效，请稍后重试",
                diagnostic="prepared image is required for submission",
            )
        if normalized_mode == "fast":
            _validate_fast_mode_geometry(prepared, geometry)
    else:
        provider_task_id = str(provider_task_id or "").strip()
        polling_url = str(polling_url or "").strip()
        if not polling_url:
            raise BflOutpaintingError(
                "扩图任务无法恢复，请重新扩图",
                diagnostic="resume requires polling_url",
            )
        polling_url = _validate_bfl_polling_url(polling_url)

    headers = {
        "accept": "application/json",
        "x-key": api_key,
        "Content-Type": "application/json",
    }
    poll_headers = {
        "accept": "application/json",
        "x-key": api_key,
    }
    request_timeout = min(60.0, max(1.0, timeout_seconds))
    timeout = httpx.Timeout(request_timeout, connect=min(20.0, request_timeout))
    result_url = ""
    cost: float | None = None
    deadline = time.monotonic() + timeout_seconds
    submit_url = f"{api_url}{BFL_OUTPAINTING_PATH}"

    if submit_request:
        assert prepared is not None
        logger.info(
            "BFL outpainting submit processing=%sx%s exact=%sx%s "
            "canvas=%sx%s offset=(%s,%s) requested_margins=%s mode=%s",
            prepared.processing_width,
            prepared.processing_height,
            geometry.expected_width,
            geometry.expected_height,
            geometry.provider_width,
            geometry.provider_height,
            geometry.provider_left,
            geometry.provider_top,
            geometry.requested_margins(),
            normalized_mode,
        )
    else:
        logger.info(
            "BFL outpainting resume task=%s exact=%sx%s canvas=%sx%s",
            _safe_text(provider_task_id, 80),
            geometry.expected_width,
            geometry.expected_height,
            geometry.provider_width,
            geometry.provider_height,
        )

    async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
        if submit_request:
            assert prepared is not None
            submission_body = {
                "input_image": _raw_base64_from_data_uri(prepared.data_uri),
                "width": geometry.provider_width,
                "height": geometry.provider_height,
                "reference_offset_x": geometry.provider_left,
                "reference_offset_y": geometry.provider_top,
                "output_format": "png",
                "mode": normalized_mode,
                "auto_crop": False,
            }
            try:
                response = await client.post(submit_url, headers=headers, json=submission_body)
            except httpx.RequestError as exc:
                raise BflOutpaintingError(
                    "扩图服务连接失败，请稍后重试",
                    diagnostic=f"submit {type(exc).__name__}",
                ) from exc
            payload = _json_payload(response)
            if response.status_code in _TRANSIENT_HTTP_STATUSES or not response.is_success:
                if response.status_code in _TRANSIENT_HTTP_STATUSES:
                    raise BflOutpaintingError(
                        "扩图服务连接失败，请稍后重试",
                        diagnostic=f"submit HTTP {response.status_code} ambiguous",
                        http_status=response.status_code,
                    )
                _raise_bfl_http_error(response, payload=payload)
            provider_task_id, polling_url, cost = _accepted_task(payload)
            try:
                await _notify_accepted(on_accepted, provider_task_id, polling_url)
            except BflOutpaintingError:
                raise
            except Exception as exc:
                raise BflOutpaintingError(
                    "扩图服务内部状态无效，请稍后重试",
                    diagnostic=f"accepted-id persistence failed: {type(exc).__name__}",
                ) from exc

        await _notify(on_progress, 20, "polling")
        transient_failures = 0
        polls = 0
        while not result_url:
            if time.monotonic() >= deadline:
                raise BflOutpaintingError("扩图服务处理超时，请稍后重试")
            polls += 1
            try:
                poll_response = await client.get(polling_url, headers=poll_headers)
            except httpx.RequestError as exc:
                transient_failures += 1
                if transient_failures > transient_retry_count:
                    raise BflOutpaintingError(
                        "扩图服务连接失败，请稍后重试",
                        diagnostic=f"poll request retries={transient_failures} error={type(exc).__name__}",
                    ) from exc
                delay = _retry_after_seconds(
                    None,
                    retry_backoff_seconds * (2 ** (transient_failures - 1)),
                    retry_backoff_cap_seconds,
                )
                await asyncio.sleep(delay)
                continue

            poll_payload = _json_payload(poll_response)
            if poll_response.status_code in _TRANSIENT_HTTP_STATUSES:
                transient_failures += 1
                if transient_failures > transient_retry_count:
                    raise BflOutpaintingError(
                        public_error_for_status(poll_response.status_code),
                        diagnostic=f"poll HTTP {poll_response.status_code} retries={transient_failures}",
                        http_status=poll_response.status_code,
                    )
                delay = _retry_after_seconds(
                    poll_response,
                    retry_backoff_seconds * (2 ** (transient_failures - 1)),
                    retry_backoff_cap_seconds,
                )
                await asyncio.sleep(delay)
                continue
            if not poll_response.is_success:
                _raise_bfl_http_error(poll_response, payload=poll_payload)

            transient_failures = 0
            status = _poll_status(poll_payload)
            if status in BFL_FAILURE_STATUSES:
                raise BflOutpaintingError(
                    _public_error_for_bfl_status(status),
                    diagnostic=f"poll terminal status={_safe_text(status, 40)}",
                )
            polled_cost = _result_cost(poll_payload)
            if polled_cost is not None:
                cost = polled_cost
            if status == BFL_READY_STATUS or status not in BFL_PENDING_STATUSES:
                result_url = _poll_result_url(poll_payload)
                if result_url:
                    break
                if status == BFL_READY_STATUS:
                    raise BflOutpaintingError(
                        "扩图服务返回无效响应，请稍后重试",
                        diagnostic="ready response missing result.sample",
                    )
            await _notify(on_progress, min(75, 20 + polls * 3), "polling")
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise BflOutpaintingError("扩图服务处理超时，请稍后重试")
            await asyncio.sleep(min(poll_interval_seconds, remaining))

        await _notify(on_progress, 85, "downloading")
        local_url = await _download_result(
            client,
            result_url,
            output_root=output_root,
            user_id=user_id,
            job_id=job_id,
            geometry=geometry,
            max_result_bytes=max_result_bytes,
            allowed_host_suffixes=result_host_suffixes,
            retry_count=result_download_retry_count,
            retry_backoff_seconds=retry_backoff_seconds,
            retry_backoff_cap_seconds=retry_backoff_cap_seconds,
        )
    return BflOutpaintingResult(
        image_url=local_url,
        provider_task_id=provider_task_id,
        polling_url=polling_url,
        cost=cost,
        width=geometry.expected_width,
        height=geometry.expected_height,
    )

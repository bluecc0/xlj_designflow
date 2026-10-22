"""BFL FLUX 虚拟试穿（vto-v2）客户端。

文档：https://docs.bfl.ai/flux_tools/flux_vto
流程：POST /v1/flux-tools/vto-v2 → 轮询返回的 polling_url → 下载 result.sample。
接口只接受一张人物图（person）+ 一张服装图（garment）；多件服装由调用方先拼成一张。
结果地址是 10 分钟有效的签名 URL，必须在任务完成后立即下载落盘。
"""
from __future__ import annotations

import asyncio
import base64
import logging
import time
import uuid
from typing import Any, Callable, Optional
from urllib.parse import urlsplit

import httpx

from .ai_image import _ai_image_public_url, _ensure_user_dated_output_dir, AmbiguousUpstreamError
from .config import settings
from .task_checkpoint import checkpoint, atomic_write, UpstreamTaskFailed

logger = logging.getLogger(__name__)

FLUX_VTO_MODEL = "flux-vto"
PROVIDER_BFL = "bfl"
VTO_PATH = "/v1/flux-tools/vto-v2"
TRUSTED_HOST_SUFFIX = "bfl.ai"
POLL_INTERVAL_SECONDS = 1.5
TIMEOUT_SECONDS = 300.0
MAX_RESULT_BYTES = 30_000_000

_FAILED_STATUSES = {"error", "failed", "request moderated", "content moderated", "task not found"}
_TRANSIENT_HTTP = {408, 425, 429, 500, 502, 503, 504}


class BflVtoError(RuntimeError):
    pass


class BflVtoSubmissionUnknown(AmbiguousUpstreamError, BflVtoError):
    pass


class BflVtoTaskFailed(UpstreamTaskFailed, BflVtoError):
    pass


def _http_error_message(status: int) -> str:
    if status in (401, 403):
        return "FLUX 换装鉴权失败，请检查 BFL_API_KEY"
    if status == 402:
        return "FLUX 账户余额不足"
    if status == 422:
        return "FLUX 换装参数不合法"
    if status == 429:
        return "FLUX 换装请求过于频繁，请稍后重试"
    return f"FLUX 换装服务异常（HTTP {status}）"


def _trusted_https_url(raw: str, what: str) -> str:
    url = str(raw or "").strip()
    parts = urlsplit(url)
    host = (parts.hostname or "").casefold().rstrip(".")
    if parts.scheme != "https" or not (host == TRUSTED_HOST_SUFFIX or host.endswith("." + TRUSTED_HOST_SUFFIX)):
        raise BflVtoError(f"FLUX 换装返回了不受信任的{what}")
    return url


def _failure_message(status: str) -> str:
    if "moderated" in status:
        return "FLUX 换装内容未通过审核，请更换图片后重试"
    if status == "task not found":
        return "FLUX 换装任务已失效，请重新提交"
    return "FLUX 换装生成失败，请重试"


# 创建任务是付费请求：只有确定请求没被服务端受理时才能重发，否则可能重复建任务
_CREATE_SAFE_ERRORS = (httpx.ConnectError, httpx.ConnectTimeout)
_CREATE_SAFE_HTTP = {429}


async def _request(
    client: httpx.AsyncClient, method: str, url: str, *, create: bool = False, **kwargs
) -> dict[str, Any]:
    """带少量瞬时重试的 JSON 请求；create=True 时只在请求确定未被受理时重试。"""
    last: Exception | None = None
    for attempt in range(3):
        try:
            if create:
                checkpoint("submitting")
            resp = await client.request(method, url, **kwargs)
        except httpx.RequestError as exc:
            if create and not isinstance(exc, _CREATE_SAFE_ERRORS):
                # 读超时 / 连接中断等：服务端可能已建任务，不能盲目重发
                raise BflVtoSubmissionUnknown(
                    "FLUX 换装提交后未收到确认，任务可能已创建，请稍后在任务记录中核对，避免重复提交",
                    provider=PROVIDER_BFL,
                ) from exc
            last = exc
        else:
            retryable = _CREATE_SAFE_HTTP if create else _TRANSIENT_HTTP
            if resp.status_code in retryable and attempt < 2:
                last = BflVtoError(_http_error_message(resp.status_code))
            elif not resp.is_success:
                raise BflVtoError(_http_error_message(resp.status_code))
            else:
                try:
                    data = resp.json()
                except ValueError as exc:
                    raise BflVtoError("FLUX 换装返回了无效响应") from exc
                if not isinstance(data, dict):
                    raise BflVtoError("FLUX 换装返回了无效响应")
                return data
        await asyncio.sleep(1.0 + attempt)
    if isinstance(last, BflVtoError):
        raise last
    raise BflVtoError(f"FLUX 换装网络异常：{type(last).__name__}") from last


async def generate_vto_async(
    *,
    prompt: str,
    person: bytes,
    garment: bytes,
    user_id: str,
    seed: Optional[int] = None,
    on_progress: Optional[Callable[[int, str], None]] = None,
    on_accepted: Optional[Callable[[str], None]] = None,
    resume: dict | None = None,
) -> dict[str, Any]:
    """提交一次 VTO 任务并等待完成，返回与其它生图通道一致的 {url, provider, task_id, cost}。"""
    if not settings.bfl_api_key:
        raise BflVtoError("FLUX 换装未配置 BFL_API_KEY")

    api_url = (settings.bfl_api_url or "https://api.bfl.ai").rstrip("/")
    headers = {"x-key": settings.bfl_api_key, "accept": "application/json"}
    payload: dict[str, Any] = {
        "prompt": prompt,
        "person": base64.b64encode(person).decode("ascii"),
        "garment": base64.b64encode(garment).decode("ascii"),
        "output_format": "jpeg",
    }
    if seed is not None:
        payload["seed"] = int(seed)

    started = time.monotonic()
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(120.0, connect=20.0),
        proxy=settings.bfl_proxy_url or None,
        trust_env=False,
    ) as client:
        submitted = resume or await _request(client, "POST", f"{api_url}{VTO_PATH}", create=True, json=payload, headers=headers)
        task_id = str(submitted.get("id") or "").strip()
        if not task_id:
            raise BflVtoError("FLUX 换装返回了无效响应")
        polling_url = _trusted_https_url(submitted.get("polling_url"), "轮询地址")
        checkpoint("accepted", task_id=task_id, polling_url=polling_url)
        if on_accepted:
            on_accepted(task_id)

        result_url = ""
        while time.monotonic() - started < TIMEOUT_SECONDS:
            await asyncio.sleep(POLL_INTERVAL_SECONDS)
            polled = await _request(client, "GET", polling_url, headers=headers)
            status = str(polled.get("status") or "").strip().casefold()
            if status == "ready":
                result = polled.get("result") if isinstance(polled.get("result"), dict) else {}
                result_url = _trusted_https_url(result.get("sample"), "结果地址")
                break
            if status in _FAILED_STATUSES:
                logger.warning("bfl vto task=%s status=%s", task_id, status)
                raise BflVtoTaskFailed(_failure_message(status))
            if on_progress:
                elapsed = time.monotonic() - started
                on_progress(min(90, 10 + int(elapsed / TIMEOUT_SECONDS * 80)), status or "pending")
        else:
            raise BflVtoError("FLUX 换装超时，请重试")

        checkpoint("downloading", result_url=result_url)
        resp = await client.get(result_url, follow_redirects=True)
        if not resp.is_success:
            raise BflVtoError(_http_error_message(resp.status_code))
        content = resp.content
        if not content or len(content) > MAX_RESULT_BYTES:
            raise BflVtoError("FLUX 换装结果图片无效")

    out_path = _ensure_user_dated_output_dir(user_id) / f"vto_{uuid.uuid4().hex}.jpg"
    atomic_write(out_path, content)
    checkpoint("downloaded", local_url=_ai_image_public_url(out_path))
    return {
        "url": _ai_image_public_url(out_path),
        "provider": PROVIDER_BFL,
        "task_id": task_id,
        "cost": submitted.get("cost"),
        "actual_time": round(time.monotonic() - started, 1),
    }

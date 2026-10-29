"""多个接口共用的小工具（SSE 格式、从模型输出里提取 JSON、把图片地址转成 data URL）。"""
from __future__ import annotations

import base64
import json
import logging
import mimetypes
import re
from typing import Any, Optional

import httpx

from .config import settings

logger = logging.getLogger(__name__)


def make_sse(event: str, payload: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _extract_first_json_object(text: str) -> Optional[dict[str, Any]]:
    if not text:
        return None
    match = re.search(r"(\{.*\})", text, flags=re.S)
    if not match:
        return None
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError:
        return None


async def _resolve_image_data_url(image_url: str) -> str:
    """将图片 URL（本地路径或远程 URL）解析为 base64 data URL。"""
    if not image_url:
        return ""
    if image_url.startswith("data:image/"):
        return image_url

    image_bytes: bytes | None = None
    mime_type = "image/png"

    # 本地路径：/ai-images/{user_id}/... 或 /results/...
    if image_url.startswith("/ai-images/") or image_url.startswith("/results/"):
        local_path = settings.output_path / image_url.lstrip("/")
        if local_path.exists():
            image_bytes = local_path.read_bytes()
            mime_type = mimetypes.guess_type(str(local_path))[0] or "image/png"

    if image_bytes is None and image_url.startswith(("http://", "https://")):
        try:
            async with httpx.AsyncClient(timeout=15, trust_env=False) as client:
                fetch_resp = await client.get(image_url)
                if fetch_resp.status_code == 200:
                    image_bytes = fetch_resp.content
                    content_type = fetch_resp.headers.get("content-type", "")
                    if content_type and content_type.startswith("image/"):
                        mime_type = content_type.split(";")[0].strip()
        except Exception:
            logger.warning("failed to fetch remote image %s", image_url[:120])

    if not image_bytes:
        return ""
    encoded = base64.b64encode(image_bytes).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"

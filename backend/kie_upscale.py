"""Kie Topaz 高清放大客户端。

复用图层分离客户端的上传、重试逻辑，只替换任务参数和结果解析。
放大倍数固定 2x：用户需要更大时在结果上再放大一次。
"""
from __future__ import annotations

import asyncio
import io
import logging
import tempfile
import time
from pathlib import Path

import httpx
from PIL import Image

from backend.kie_layer_decomposition import (
    KieLayerDecompositionClient,
    KieLayerDecompositionError,
    _error_detail,
    extract_result_urls,
)


logger = logging.getLogger(__name__)

UPSCALE_FACTOR = 2
# Kie 限制：输入文件 ≤10MB，最长边 × 倍数 ≤ 20000px。
MAX_INPUT_BYTES = 10 * 1024 * 1024
MAX_OUTPUT_LONG_SIDE = 20000
ALLOWED_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}


class KieUpscaleError(KieLayerDecompositionError):
    """Kie 放大请求或返回结构异常。"""


def prepare_upscale_input(src_path: Path, work_dir: Path) -> Path:
    """校验尺寸；格式不支持或超过 10MB 时转成 WEBP（保留透明通道）。"""
    src_path = Path(src_path)
    with Image.open(src_path) as im:
        long_side = max(im.width, im.height)
        if long_side * UPSCALE_FACTOR > MAX_OUTPUT_LONG_SIDE:
            raise KieUpscaleError(
                f"图片过大（最长边 {long_side}px），放大 {UPSCALE_FACTOR}x 后会超过 {MAX_OUTPUT_LONG_SIDE}px 上限"
            )
        if src_path.suffix.lower() in ALLOWED_SUFFIXES and src_path.stat().st_size <= MAX_INPUT_BYTES:
            return src_path
        image = im.convert("RGBA") if im.mode in {"RGBA", "LA", "P"} else im.convert("RGB")
    for quality in (95, 90, 85, 80):
        buffer = io.BytesIO()
        image.save(buffer, format="WEBP", quality=quality, method=4)
        if buffer.tell() <= MAX_INPUT_BYTES:
            out_path = Path(work_dir) / f"{src_path.stem}.webp"
            out_path.write_bytes(buffer.getvalue())
            return out_path
    raise KieUpscaleError("图片压缩后仍超过 10MB，无法提交高清放大")


class KieUpscaleClient(KieLayerDecompositionClient):
    def __init__(self, *, model: str = "topaz/image-upscale", **kwargs) -> None:
        super().__init__(model=model, **kwargs)

    async def create_upscale_task(self, client: httpx.AsyncClient, *, image_url: str) -> str:
        response = await self._request_with_retry(
            client,
            "POST",
            self._market_url("/api/v1/jobs/createTask"),
            headers={**self._headers, "Content-Type": "application/json"},
            json={
                "model": self.model,
                "input": {"image_url": image_url, "upscale_factor": str(UPSCALE_FACTOR)},
            },
        )
        if response.status_code != 200:
            raise KieUpscaleError(f"Kie 创建放大任务失败: {_error_detail(response)}")
        try:
            payload = response.json()
        except ValueError as exc:
            raise KieUpscaleError("Kie 创建放大任务返回不是 JSON") from exc
        task_id = ((payload.get("data") or {}).get("taskId") if isinstance(payload, dict) else "")
        if not task_id:
            raise KieUpscaleError(f"Kie 创建放大任务未返回 taskId: {str(payload)[:800]}")
        return str(task_id)

    async def poll_result_url(self, client: httpx.AsyncClient, task_id: str) -> str:
        deadline = time.monotonic() + self.timeout_seconds
        while time.monotonic() < deadline:
            response = await self._request_with_retry(
                client,
                "GET",
                self._market_url("/api/v1/jobs/recordInfo"),
                retries=2,
                retry_statuses={500, 502, 503, 504},
                params={"taskId": task_id},
                headers=self._headers,
            )
            if response.status_code != 200:
                raise KieUpscaleError(f"Kie 查询放大任务失败: {_error_detail(response)}")
            try:
                payload = response.json()
            except ValueError as exc:
                raise KieUpscaleError("Kie 查询放大任务返回不是 JSON") from exc
            data = payload.get("data") if isinstance(payload, dict) else {}
            data = data if isinstance(data, dict) else {}
            state = str(data.get("state") or data.get("status") or "").strip().lower()
            if state == "success":
                urls = extract_result_urls(data.get("resultJson") or data)
                if not urls:
                    raise KieUpscaleError("Kie 放大任务成功但未返回图片")
                return urls[0]
            if state in {"fail", "failed", "error"}:
                detail = data.get("failMsg") or data.get("error") or "未知错误"
                raise KieUpscaleError(f"Kie 高清放大失败（task_id={task_id}）: {detail}")
            await asyncio.sleep(self.poll_interval_seconds)
        raise KieUpscaleError(f"Kie 高清放大超时（{self.timeout_seconds}s），task_id={task_id}")

    async def upscale(self, src_path: Path, out_path: Path) -> tuple[int, int, str]:
        """放大 src_path 并保存为 PNG 到 out_path，返回 (width, height, task_id)。"""
        if not self.api_key:
            raise KieUpscaleError("未配置 KIE_API_KEY，请先在 .env 中填写")
        timeout = httpx.Timeout(self.timeout_seconds + 30, connect=30.0)
        with tempfile.TemporaryDirectory() as work_dir:
            input_path = prepare_upscale_input(src_path, Path(work_dir))
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, trust_env=False) as client:
                image_url = await self.upload_image(client, input_path, f"designflow-upscale-{out_path.stem}{input_path.suffix}")
                task_id = await self.create_upscale_task(client, image_url=image_url)
                logger.info("Kie upscale task created task=%s", task_id)
                result_url = await self.poll_result_url(client, task_id)
                response = await self._request_with_retry(client, "GET", result_url, retries=2, retry_statuses={429, 500, 502, 503, 504})
                if response.status_code != 200 or not response.content:
                    raise KieUpscaleError(f"下载放大结果失败: {_error_detail(response)}")
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(io.BytesIO(response.content)) as im:
            im.save(out_path, format="PNG")
            return im.width, im.height, task_id

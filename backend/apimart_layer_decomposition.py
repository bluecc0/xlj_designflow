"""APIMart Seedream 5.0 Pro 图层分离客户端。

负责向 APIMart 提交 Seedream 5.0 Pro 图层分离任务、轮询任务状态以及提取
各图层的图片 URL、z_index、bounding_box 坐标与名称。
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import mimetypes
import time
from pathlib import Path
from typing import Any

import httpx


logger = logging.getLogger(__name__)


class ApimartLayerDecompositionError(RuntimeError):
    """APIMart 图层分离请求或返回结构异常。"""


def _decode_json_string(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    text = value.strip()
    if not text or text[0] not in "[{":
        return value
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return value


def _image_to_data_url(image_path: Path) -> str:
    path = Path(image_path)
    if not path.exists() or not path.is_file():
        raise ApimartLayerDecompositionError(f"输入图片不存在: {image_path}")
    raw = path.read_bytes()
    if not raw:
        raise ApimartLayerDecompositionError(f"输入图片内容为空: {image_path}")
    mime, _ = mimetypes.guess_type(path.name)
    mime = mime or "image/png"
    b64_str = base64.b64encode(raw).decode("ascii")
    return f"data:{mime};base64,{b64_str}"


def extract_result_urls(payload: Any) -> list[str]:
    """递归抽取 payload 中所有的图片 URL。"""
    urls: list[str] = []
    seen: set[str] = set()

    def visit(value: Any) -> None:
        value = _decode_json_string(value)
        if isinstance(value, str):
            candidate = value.strip()
            if candidate.startswith(("http://", "https://", "data:image/")) and candidate not in seen:
                seen.add(candidate)
                urls.append(candidate)
            return
        if isinstance(value, dict):
            for child_value in value.values():
                visit(child_value)
            return
        if isinstance(value, (list, tuple)):
            for child in value:
                visit(child)

    visit(payload)
    return urls


def extract_result_layers(payload: Any) -> list[dict[str, Any]]:
    """解析 APIMart / Seedream 5.0 Pro 返回的图层数据结构。

    Seedream 官方规范返回格式：
    result.images[0].layers = [
        {
            "name": "background",
            "url": "https://...",
            "z_index": 0,
            "bounding_box": {
                "absolute": [0, 0, 1024, 1024],
                "normalized": [0.0, 0.0, 1.0, 1.0]
            }
        },
        ...
    ]
    兼容不同的嵌套层级（result.images[0].layers, data.result.layers, layers_data 等）。
    """
    decoded = _decode_json_string(payload)
    if isinstance(decoded, dict) and "data" in decoded and isinstance(decoded["data"], (dict, list)):
        decoded = decoded["data"]

    # 优先查找 layers 数组
    raw_layers: list[Any] | None = None
    parallel_urls: list[str] = []
    if isinstance(decoded, dict):
        result = decoded.get("result")
        if isinstance(result, dict):
            images = result.get("images")
            if isinstance(images, list) and images and isinstance(images[0], dict):
                raw_layers = images[0].get("layers")
                urls_field = images[0].get("url") or images[0].get("urls")
                if isinstance(urls_field, list):
                    parallel_urls = [str(u).strip() for u in urls_field if str(u).strip()]
                elif isinstance(urls_field, str) and urls_field.strip():
                    parallel_urls = [urls_field.strip()]
            if raw_layers is None:
                raw_layers = result.get("layers")
                urls_field = result.get("url") or result.get("urls")
                if isinstance(urls_field, list):
                    parallel_urls = [str(u).strip() for u in urls_field if str(u).strip()]
        if raw_layers is None:
            images = decoded.get("images")
            if isinstance(images, list) and images and isinstance(images[0], dict):
                raw_layers = images[0].get("layers")
                urls_field = images[0].get("url") or images[0].get("urls")
                if isinstance(urls_field, list):
                    parallel_urls = [str(u).strip() for u in urls_field if str(u).strip()]
        if raw_layers is None:
            raw_layers = decoded.get("layers") or decoded.get("layers_data")

    # 如果在上一级未找到 parallel_urls，从 decoded 整体提取兜底
    if not parallel_urls:
        parallel_urls = extract_result_urls(decoded)

    if isinstance(raw_layers, list) and raw_layers:
        layers: list[dict[str, Any]] = []
        for position, raw in enumerate(raw_layers):
            if not isinstance(raw, dict):
                continue
            url = str(raw.get("url") or raw.get("image_url") or "").strip()
            if not url and position < len(parallel_urls):
                url = parallel_urls[position]
            if not url:
                nested_urls = extract_result_urls(raw)
                url = nested_urls[0] if nested_urls else ""
            if not url.startswith(("http://", "https://", "data:image/")):
                continue
            layer = dict(raw)
            layer["url"] = url
            try:
                layer["z_index"] = int(layer.get("z_index", position))
            except (TypeError, ValueError):
                layer["z_index"] = position
            layers.append(layer)
        if layers:
            return sorted(layers, key=lambda item: int(item.get("z_index", 0)))

    # 兜底：若仅返回 URL 列表，生成带递增 z_index 的基础图层列表
    urls = extract_result_urls(decoded)
    return [{"url": url, "z_index": index} for index, url in enumerate(urls)]


def _error_detail(response: httpx.Response) -> str:
    text = (response.text or "").strip().replace("\n", " ")
    return f"HTTP {response.status_code}: {text[:800]}"


class ApimartLayerDecompositionClient:
    """APIMart Seedream 5.0 Pro 图层分离客户端。"""

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = "https://api.apimart.ai",
        model: str = "seedream-5-0-pro",
        size: str = "auto",
        timeout_seconds: int = 900,
        poll_interval_seconds: float = 3.0,
        download_retries: int = 2,
    ) -> None:
        self.api_key = str(api_key or "").strip()
        self.base_url = str(base_url or "https://api.apimart.ai").rstrip("/")
        self.model = str(model or "seedream-5-0-pro").strip()
        self.size = str(size or "auto").strip().lower()
        self.timeout_seconds = max(60, int(timeout_seconds or 900))
        self.poll_interval_seconds = max(1.0, float(poll_interval_seconds or 3.0))
        self.download_retries = max(0, int(download_retries or 0))

    @property
    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def _api_url(self, path: str) -> str:
        clean_path = "/" + path.lstrip("/")
        return self.base_url + clean_path

    async def _request_with_retry(
        self,
        client: httpx.AsyncClient,
        method: str,
        url: str,
        retries: int = 0,
        retry_statuses: set[int] | None = None,
        **kwargs: Any,
    ) -> httpx.Response:
        retries = max(0, int(retries))
        retry_statuses = retry_statuses or set()
        last_error: httpx.RequestError | None = None
        for attempt in range(retries + 1):
            try:
                response = await client.request(method, url, **kwargs)
            except httpx.RequestError as exc:
                last_error = exc
                if attempt >= retries:
                    raise
                logger.warning(
                    "APIMart request disconnected method=%s url=%s retry=%s",
                    method,
                    url,
                    attempt + 1,
                )
                await asyncio.sleep(2 ** attempt)
                continue
            if response.status_code in retry_statuses and attempt < retries:
                logger.warning(
                    "APIMart request returned HTTP %s method=%s url=%s retry=%s",
                    response.status_code,
                    method,
                    url,
                    attempt + 1,
                )
                await asyncio.sleep(2 ** attempt)
                continue
            return response
        raise last_error or ApimartLayerDecompositionError("APIMart 请求失败")

    async def create_task(
        self,
        client: httpx.AsyncClient,
        *,
        image_input: str,
        prompt: str = "",
    ) -> str:
        if not self.api_key:
            raise ApimartLayerDecompositionError("未配置 AI_IMAGE_API_KEY / LAYER_EXTRACT_API_KEY")

        payload: dict[str, Any] = {
            "model": self.model,
            "layer_decomposition": True,
            "size": self.size,
            "image_urls": [image_input],
        }
        if str(prompt or "").strip():
            payload["prompt"] = str(prompt).strip()

        response = await self._request_with_retry(
            client,
            "POST",
            self._api_url("/v1/images/generations"),
            headers=self._headers,
            json=payload,
        )
        if response.status_code != 200:
            raise ApimartLayerDecompositionError(f"APIMart 创建任务失败: {_error_detail(response)}")
        try:
            res_json = response.json()
        except ValueError as exc:
            raise ApimartLayerDecompositionError("APIMart 创建任务返回不是 JSON") from exc

        # 尝试提取任务 ID（兼容 data 为 list 或 dict 的情况）
        task_id = ""
        if isinstance(res_json, dict):
            task_id = str(res_json.get("task_id") or res_json.get("id") or "").strip()
            if not task_id:
                data_val = res_json.get("data")
                if isinstance(data_val, list) and data_val:
                    first_item = data_val[0]
                    if isinstance(first_item, dict):
                        task_id = str(first_item.get("task_id") or first_item.get("id") or "").strip()
                elif isinstance(data_val, dict):
                    task_id = str(data_val.get("task_id") or data_val.get("id") or "").strip()

        if not task_id:
            raise ApimartLayerDecompositionError(f"APIMart 创建任务未返回 task_id: {str(res_json)[:800]}")
        return task_id

    async def poll_task(
        self,
        client: httpx.AsyncClient,
        task_id: str,
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        deadline = time.monotonic() + self.timeout_seconds
        last_state = ""
        while time.monotonic() < deadline:
            response = await self._request_with_retry(
                client,
                "GET",
                self._api_url(f"/v1/tasks/{task_id}"),
                retries=2,
                retry_statuses={500, 502, 503, 504},
                headers=self._headers,
            )
            if response.status_code != 200:
                raise ApimartLayerDecompositionError(f"APIMart 查询任务失败: {_error_detail(response)}")
            try:
                res_json = response.json()
            except ValueError as exc:
                raise ApimartLayerDecompositionError("APIMart 查询任务返回不是 JSON") from exc

            data = res_json.get("data") if isinstance(res_json, dict) and "data" in res_json else res_json
            data = data if isinstance(data, dict) else {}

            state = str(data.get("status") or data.get("state") or "").strip().lower()
            if state != last_state:
                logger.info("APIMart layer task %s state=%s", task_id, state or "unknown")
                last_state = state

            if state in {"completed", "succeeded", "success", "done"}:
                layers = extract_result_layers(data)
                if not layers:
                    raise ApimartLayerDecompositionError("APIMart 任务成功但未返回有效图层结果")
                return layers, data

            if state in {"failed", "fail", "error", "cancelled", "canceled"}:
                err = data.get("error")
                if isinstance(err, dict):
                    detail = err.get("message") or err.get("code") or str(err)
                else:
                    detail = str(err or data.get("failMsg") or data.get("message") or "未知错误")
                raise ApimartLayerDecompositionError(f"APIMart 图层分离失败（task_id={task_id}）: {detail}")

            await asyncio.sleep(self.poll_interval_seconds)

        raise ApimartLayerDecompositionError(
            f"APIMart 图层分离超时（{self.timeout_seconds}s），task_id={task_id}"
        )

    async def run(
        self,
        image_path: Path,
        prompt: str = "",
    ) -> dict[str, Any]:
        if not self.api_key:
            raise ApimartLayerDecompositionError("未配置 AI_IMAGE_API_KEY / LAYER_EXTRACT_API_KEY，请先在 .env 中配置")

        image_data_url = _image_to_data_url(image_path)
        timeout = httpx.Timeout(self.timeout_seconds + 30, connect=30.0)
        async with httpx.AsyncClient(
            timeout=timeout,
            follow_redirects=True,
            trust_env=False,
        ) as client:
            task_id = await self.create_task(client, image_input=image_data_url, prompt=prompt)
            result_layers, task_data = await self.poll_task(client, task_id)

        return {
            "task_id": task_id,
            "source_url": image_path.name,
            "result_layers": result_layers,
            "result_urls": [layer["url"] for layer in result_layers],
            "task": task_data,
        }

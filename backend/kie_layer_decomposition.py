"""Kie Seedream 图层分离客户端。

这个模块只负责 Kie 的上传、创建任务、轮询和结果元数据解析，不负责 PSD
布局。图层图片、z_index 和 bounding_box 都由 Kie 返回，PSD 布局由
layer_extract_worker 按这些元数据完成。
"""
from __future__ import annotations

import asyncio
import json
import logging
import mimetypes
import time
from pathlib import Path
from typing import Any

import httpx


logger = logging.getLogger(__name__)


class KieLayerDecompositionError(RuntimeError):
    """Kie 请求或返回结构异常。"""


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


def extract_result_urls(payload: Any) -> list[str]:
    """兼容 Kie 的 resultJson 字符串及不同版本的结果字段。"""
    urls: list[str] = []
    seen: set[str] = set()

    def visit(value: Any, key: str = "") -> None:
        value = _decode_json_string(value)
        if isinstance(value, str):
            candidate = value.strip()
            if candidate.startswith(("http://", "https://")) and candidate not in seen:
                seen.add(candidate)
                urls.append(candidate)
            return
        if isinstance(value, dict):
            for child_key, child_value in value.items():
                visit(child_value, str(child_key))
            return
        if isinstance(value, (list, tuple)):
            for child in value:
                visit(child, key)

    visit(payload)
    return urls


def extract_result_layers(payload: Any) -> list[dict[str, Any]]:
    """解析 Kie 的 ``resultObject.layers_data``。

    图层分离接口除了 ``resultUrls`` 外，还会返回每层的 ``z_index``、尺寸、
    名称和 ``bounding_box``。不能只递归抽 URL，否则裁切图层会失去落位信息。
    对旧版本只返回 URL 列表的响应保留顺序降级解析，便于错误诊断和兼容。
    """
    decoded = _decode_json_string(payload)
    if isinstance(decoded, dict) and "resultJson" in decoded:
        decoded = _decode_json_string(decoded.get("resultJson"))

    result_object = decoded.get("resultObject") if isinstance(decoded, dict) else None
    raw_layers = result_object.get("layers_data") if isinstance(result_object, dict) else None
    if isinstance(raw_layers, list):
        layers: list[dict[str, Any]] = []
        for position, raw in enumerate(raw_layers):
            if not isinstance(raw, dict):
                continue
            url = str(raw.get("url") or "").strip()
            if not url:
                nested_urls = extract_result_urls(raw)
                url = nested_urls[0] if nested_urls else ""
            if not url.startswith(("http://", "https://")):
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

    urls = extract_result_urls(decoded)
    return [{"url": url, "z_index": index} for index, url in enumerate(urls)]


def _error_detail(response: httpx.Response) -> str:
    text = (response.text or "").strip().replace("\n", " ")
    return f"HTTP {response.status_code}: {text[:800]}"


class KieLayerDecompositionClient:
    """Kie layer-decomposition API 的最小异步客户端。"""

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = "https://api.kie.ai",
        upload_base_url: str = "https://kieai.redpandaai.co",
        model: str = "seedream/5-pro-layer-decomposition",
        size: str = "auto",
        output_format: str = "png",
        timeout_seconds: int = 900,
        poll_interval_seconds: float = 3.0,
    ) -> None:
        self.api_key = str(api_key or "").strip()
        self.base_url = str(base_url or "https://api.kie.ai").rstrip("/")
        self.upload_base_url = str(upload_base_url or "https://kieai.redpandaai.co").rstrip("/")
        self.model = str(model or "seedream/5-pro-layer-decomposition").strip()
        self.size = str(size or "auto").strip().lower()
        self.output_format = str(output_format or "png").strip().lower()
        self.timeout_seconds = max(60, int(timeout_seconds or 900))
        self.poll_interval_seconds = max(1.0, float(poll_interval_seconds or 3.0))

    @property
    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "application/json",
        }

    def _market_url(self, path: str) -> str:
        clean_path = "/" + path.lstrip("/")
        if self.base_url.endswith("/api/v1") and clean_path.startswith("/api/v1/"):
            return self.base_url + clean_path[len("/api/v1"):]
        if self.base_url.endswith("/api") and clean_path.startswith("/api/"):
            return self.base_url + clean_path[4:]
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
        """让任务查询容忍偶发断连；创建任务默认不自动重试以免重复扣费。"""
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
                    "Kie request disconnected method=%s url=%s retry=%s",
                    method,
                    url,
                    attempt + 1,
                )
                await asyncio.sleep(2 ** attempt)
                continue
            if response.status_code in retry_statuses and attempt < retries:
                logger.warning(
                    "Kie request returned HTTP %s method=%s url=%s retry=%s",
                    response.status_code,
                    method,
                    url,
                    attempt + 1,
                )
                await asyncio.sleep(2 ** attempt)
                continue
            return response
        raise last_error or KieLayerDecompositionError("Kie 请求失败")

    async def upload_image(
        self,
        client: httpx.AsyncClient,
        image_path: Path,
        filename: str | None = None,
    ) -> str:
        if not self.api_key:
            raise KieLayerDecompositionError("未配置 KIE_API_KEY")
        image_path = Path(image_path)
        if not image_path.exists() or not image_path.is_file():
            raise KieLayerDecompositionError(f"Kie 输入图片不存在: {image_path}")
        filename = str(filename or image_path.name).strip() or image_path.name
        mime = mimetypes.guess_type(filename)[0] or "image/png"
        response = await self._request_with_retry(
            client,
            "POST",
            f"{self.upload_base_url}/api/file-stream-upload",
            headers=self._headers,
            data={
                "uploadPath": "images/designflow-layer-inputs",
                "fileName": filename,
            },
            files={"file": (filename, image_path.read_bytes(), mime)},
        )
        if response.status_code != 200:
            raise KieLayerDecompositionError(f"Kie 上传失败: {_error_detail(response)}")
        try:
            payload = response.json()
        except ValueError as exc:
            raise KieLayerDecompositionError("Kie 上传返回不是 JSON") from exc
        download_url = ((payload.get("data") or {}).get("downloadUrl") if isinstance(payload, dict) else "")
        if not isinstance(download_url, str) or not download_url.startswith(("http://", "https://")):
            raise KieLayerDecompositionError(f"Kie 上传未返回有效 downloadUrl: {str(payload)[:800]}")
        return download_url

    async def create_task(
        self,
        client: httpx.AsyncClient,
        *,
        image_url: str,
        prompt: str,
    ) -> str:
        task_input = {
            "image_url": image_url,
            "size": self.size,
            "output_format": self.output_format,
        }
        if str(prompt or "").strip():
            task_input["prompt"] = str(prompt).strip()
        response = await self._request_with_retry(
            client,
            "POST",
            self._market_url("/api/v1/jobs/createTask"),
            headers={**self._headers, "Content-Type": "application/json"},
            json={
                "model": self.model,
                "input": task_input,
            },
        )
        if response.status_code != 200:
            raise KieLayerDecompositionError(f"Kie 创建任务失败: {_error_detail(response)}")
        try:
            payload = response.json()
        except ValueError as exc:
            raise KieLayerDecompositionError("Kie 创建任务返回不是 JSON") from exc
        task_id = ((payload.get("data") or {}).get("taskId") if isinstance(payload, dict) else "")
        if not task_id:
            raise KieLayerDecompositionError(f"Kie 创建任务未返回 taskId: {str(payload)[:800]}")
        return str(task_id)

    async def poll_task(self, client: httpx.AsyncClient, task_id: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        deadline = time.monotonic() + self.timeout_seconds
        last_state = ""
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
                raise KieLayerDecompositionError(f"Kie 查询任务失败: {_error_detail(response)}")
            try:
                payload = response.json()
            except ValueError as exc:
                raise KieLayerDecompositionError("Kie 查询任务返回不是 JSON") from exc
            data = payload.get("data") if isinstance(payload, dict) else {}
            data = data if isinstance(data, dict) else {}
            state = str(data.get("state") or data.get("status") or "").strip().lower()
            if state != last_state:
                logger.info("Kie layer task %s state=%s", task_id, state or "unknown")
                last_state = state
            if state == "success":
                layers = extract_result_layers(data.get("resultJson") or data)
                if not layers:
                    raise KieLayerDecompositionError("Kie 任务成功但未返回图层结果")
                return layers, data
            if state in {"fail", "failed", "error"}:
                detail = data.get("failMsg") or data.get("error") or "未知错误"
                raise KieLayerDecompositionError(f"Kie 图层分离失败（task_id={task_id}）: {detail}")
            await asyncio.sleep(self.poll_interval_seconds)
        raise KieLayerDecompositionError(
            f"Kie 图层分离超时（{self.timeout_seconds}s），task_id={task_id}"
        )

    async def run(
        self,
        image_path: Path,
        prompt: str,
        upload_filename: str | None = None,
    ) -> dict[str, Any]:
        if not self.api_key:
            raise KieLayerDecompositionError("未配置 KIE_API_KEY，请先在 .env 中填写")
        timeout = httpx.Timeout(self.timeout_seconds + 30, connect=30.0)
        async with httpx.AsyncClient(
            timeout=timeout,
            follow_redirects=True,
            trust_env=False,
        ) as client:
            image_url = await self.upload_image(client, image_path, upload_filename)
            task_id = await self.create_task(client, image_url=image_url, prompt=prompt)
            result_layers, task_data = await self.poll_task(client, task_id)
        return {
            "task_id": task_id,
            "source_url": image_url,
            "result_layers": result_layers,
            "result_urls": [layer["url"] for layer in result_layers],
            "task": task_data,
        }

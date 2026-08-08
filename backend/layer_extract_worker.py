"""使用 Kie Seedream 5 Pro 图层分离结果导出 PSD。

链路：
1. 把原图提交给 ``seedream/5-pro-layer-decomposition``；
2. 下载 Kie 返回的图层图片、z_index 和 bounding_box；
3. 按 Kie 返回的坐标生成 manifest，再复用 layer_psd 导出 PSD。

这个文件由 backend.main 作为子进程调用。stdout 最后一行必须是 JSON，诊断
信息写入 stderr，避免破坏主进程的结果解析。
"""
from __future__ import annotations

import argparse
import asyncio
import io
import json
import logging
import re
import sys
from pathlib import Path
from typing import Any

import httpx
from PIL import Image

from backend.config import settings
from backend.kie_layer_decomposition import (
    KieLayerDecompositionClient,
    KieLayerDecompositionError,
)
from backend.layer_psd import export_psd


logger = logging.getLogger("layer_extract_worker")

# 这是发给 Kie 分层模型的固定任务说明，不是 VLM 预识别结果，也不包含
# 前端或本地推断的图层数量、坐标。元素识别和坐标返回全部由 Kie 完成。
LAYER_DECOMPOSITION_PROMPT = (
    "Separate this image into independent editable Photoshop layers. "
    "Return one full-canvas background layer first, followed by each visually "
    "independent foreground object, person, product, text group, logo, shadow, "
    "or decoration. Preserve the original canvas and composition. Return exact "
    "bounding boxes and z-order for every layer, keep foreground layers tightly "
    "cropped with transparency outside visible content, and do not invent or "
    "redesign any content."
)


def _emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


async def _download_result_layer(
    client: httpx.AsyncClient,
    url: str,
    index: int,
    retries: int,
) -> bytes:
    max_attempts = max(0, int(retries or 0)) + 1
    last_error = ""
    for attempt in range(1, max_attempts + 1):
        try:
            response = await client.get(url)
            if 200 <= response.status_code < 300 and response.content:
                return response.content
            if 200 <= response.status_code < 300:
                last_error = f"HTTP {response.status_code} 空响应"
                retryable = True
            else:
                last_error = f"HTTP {response.status_code}"
                retryable = response.status_code == 429 or response.status_code >= 500
        except httpx.HTTPError as exc:
            last_error = str(exc) or exc.__class__.__name__
            retryable = True
        else:
            if not retryable:
                raise RuntimeError(f"下载 Kie 图层 {index} 失败: {last_error}")
        if attempt < max_attempts:
            await asyncio.sleep(min(2.0, 0.5 * attempt))
    raise RuntimeError(
        f"下载 Kie 图层 {index} 失败: {last_error}（已重试 {max_attempts - 1} 次）"
    )


async def _download_result_layers(
    result_layers: list[dict[str, Any]],
    timeout_seconds: int,
    retries: int = 0,
) -> list[dict[str, Any]]:
    timeout = httpx.Timeout(max(60, int(timeout_seconds or 900)), connect=30.0)
    async with httpx.AsyncClient(
        timeout=timeout,
        follow_redirects=True,
        # Kie 的结果 URL 由服务端直接下载；不要继承本机代理，避免代理
        # 返回 503 或拦截对象存储 URL，导致 PSD 任务误报失败。
        trust_env=False,
    ) as client:
        downloaded: list[dict[str, Any]] = []
        for index, layer in enumerate(result_layers, start=1):
            url = str(layer.get("url") or "").strip()
            if not url:
                raise RuntimeError(f"Kie 图层 {index} 缺少图片 URL")
            item = dict(layer)
            item["bytes"] = await _download_result_layer(client, url, index, retries)
            downloaded.append(item)
    return downloaded


def _safe_filename(value: str, fallback: str) -> str:
    clean = re.sub(r"[^\w\-\u4e00-\u9fff]+", "-", str(value or "").strip()).strip("-")
    return clean[:48] or fallback


def _to_rgba(raw: bytes) -> Image.Image:
    with Image.open(io.BytesIO(raw)) as image:
        return image.convert("RGBA")


def _image_size(raw: bytes) -> tuple[int, int] | None:
    try:
        with Image.open(io.BytesIO(raw)) as image:
            return image.size
    except Exception:
        return None


def _coerce_bbox(value: Any, width: int, height: int, normalized: bool = False) -> list[int] | None:
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        return None
    try:
        numbers = [float(item) for item in value]
    except (TypeError, ValueError):
        return None
    if normalized:
        scale_x = width if max(abs(number) for number in numbers) <= 1 else width / 1000
        scale_y = height if max(abs(number) for number in numbers) <= 1 else height / 1000
        numbers = [numbers[0] * scale_x, numbers[1] * scale_y, numbers[2] * scale_x, numbers[3] * scale_y]
    x1, y1, x2, y2 = [round(number) for number in numbers]
    x1 = max(0, min(width - 1, x1))
    y1 = max(0, min(height - 1, y1))
    x2 = max(x1 + 1, min(width, x2))
    y2 = max(y1 + 1, min(height, y2))
    if x2 - x1 < 2 or y2 - y1 < 2:
        return None
    return [x1, y1, x2, y2]


def _layer_bbox(layer: dict[str, Any], width: int, height: int) -> list[int] | None:
    bounding_box = layer.get("bounding_box")
    if isinstance(bounding_box, dict):
        absolute = bounding_box.get("absolute") or bounding_box.get("pixel")
        bbox = _coerce_bbox(absolute, width, height)
        if bbox:
            return bbox
        normalized = bounding_box.get("normalized")
        bbox = _coerce_bbox(normalized, width, height, normalized=True)
        if bbox:
            return bbox
    for key in ("bbox", "box", "coordinates"):
        bbox = _coerce_bbox(layer.get(key), width, height)
        if bbox:
            return bbox
    return None


def _select_background_index(
    result_layers: list[dict[str, Any]],
    source_size: tuple[int, int],
) -> int | None:
    """选择 Kie 返回的全画布背景，避免把局部图拉伸成背景。

    当前 Kie 返回的背景通常是无名称、z_index=0 的全画布 PNG；部分响应
    还会额外返回带 bounding_box 的局部背景（例如地面），后者必须保留为
    普通前景层，不能覆盖主背景。
    """
    width, height = source_size
    full_canvas_without_bbox: list[int] = []
    full_canvas_with_hint: list[int] = []
    for index, layer in enumerate(result_layers):
        raw = layer.get("bytes")
        if not raw or _image_size(raw) != source_size:
            continue
        bbox = _layer_bbox(layer, width, height)
        try:
            z_index = int(layer.get("z_index", index))
        except (TypeError, ValueError):
            z_index = index
        if z_index == 0:
            return index
        if bbox is None:
            full_canvas_without_bbox.append(index)
        text = " ".join(
            str(layer.get(key) or "").lower()
            for key in ("name", "kind", "description")
        )
        if any(marker in text for marker in ("background", "背景", "底图", "场景")):
            full_canvas_with_hint.append(index)
    if full_canvas_without_bbox:
        return full_canvas_without_bbox[0]
    if full_canvas_with_hint:
        return full_canvas_with_hint[0]
    return None


def _prepare_background(raw: bytes | None, source: Image.Image, width: int, height: int, output: Path) -> str:
    source_rgba = source.convert("RGBA")
    if raw:
        image = _to_rgba(raw)
        if image.size != (width, height):
            image = image.resize((width, height), Image.LANCZOS)
        if image.getchannel("A").getextrema()[0] < 255:
            image = Image.alpha_composite(source_rgba, image)
    else:
        image = source_rgba
    image.convert("RGB").save(output, "PNG")
    return "ready" if raw else "source-fallback"


def _prepare_foreground(
    raw: bytes,
    layer: dict[str, Any],
    source_size: tuple[int, int],
    output: Path,
    index: int,
) -> dict[str, Any]:
    width, height = source_size
    image = _to_rgba(raw)
    bbox = _layer_bbox(layer, width, height)

    # Kie 正常会为裁切图返回 bounding_box。若返回全画布透明图，alpha
    # bbox 可以安全地还原位置；非全画布且没有坐标时不能猜位置，直接失败，
    # 避免生成一个看似成功但图层错位的 PSD。
    if bbox is None and image.size == (width, height):
        alpha_bbox = image.getchannel("A").getbbox()
        if alpha_bbox and alpha_bbox != (0, 0, width, height):
            bbox = list(alpha_bbox)
    if bbox is None:
        raise RuntimeError(
            f"Kie 图层缺少 bounding_box，无法安全定位：{layer.get('name') or index}"
        )

    if image.size == (width, height) and tuple(bbox) != (0, 0, width, height):
        image = image.crop(tuple(bbox))

    target_size = (max(1, bbox[2] - bbox[0]), max(1, bbox[3] - bbox[1]))
    if image.size != target_size:
        image = image.resize(target_size, Image.LANCZOS)
    image.save(output, "PNG")
    return {
        "id": f"layer-{index:02d}",
        "name": str(layer.get("name") or f"layer-{index:02d}"),
        "kind": str(layer.get("kind") or "kie-layer"),
        "index": index,
        "z_index": int(layer.get("z_index", index)),
        "path": output.name,
        "bbox": bbox,
        "x": bbox[0],
        "y": bbox[1],
        "width": target_size[0],
        "height": target_size[1],
        "opacity": 1.0,
        "visible": True,
        "locked": False,
    }


async def _run_remote_decomposition(source_copy: Path) -> dict[str, Any]:
    if not settings.kie_api_key:
        raise KieLayerDecompositionError("未配置 KIE_API_KEY，请先在 .env 中填写")
    client = KieLayerDecompositionClient(
        api_key=settings.kie_api_key,
        base_url=settings.kie_base_url,
        upload_base_url=settings.kie_upload_base_url,
        model=settings.kie_layer_model,
        size=settings.kie_layer_size,
        output_format=settings.kie_layer_output_format,
        timeout_seconds=settings.kie_timeout_seconds,
        poll_interval_seconds=settings.kie_poll_interval_seconds,
        input_download_retries=settings.kie_input_download_retries,
    )
    # Kie 文档提示相同 fileName 可能覆盖并命中旧缓存；job 目录名保证每次输入唯一。
    upload_filename = f"designflow-layer-{source_copy.parent.name}.png"
    # Kie 负责元素识别和坐标返回；这里仅提供固定任务说明，不做 VLM 预识别。
    result = await client.run(
        source_copy,
        prompt=LAYER_DECOMPOSITION_PROMPT,
        upload_filename=upload_filename,
    )
    result_layers = await _download_result_layers(
        result["result_layers"],
        settings.kie_timeout_seconds,
        settings.kie_result_download_retries,
    )
    return {
        "kie": result,
        "result_layers": result_layers,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--src", required=True, help="原图磁盘绝对路径")
    parser.add_argument("--out-dir", required=True, help="job 输出目录绝对路径")
    parser.add_argument("--user-id", required=True)
    args = parser.parse_args()

    src_path = Path(args.src)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        with Image.open(src_path) as image:
            source = image.convert("RGBA")
            source_width, source_height = source.size
    except Exception as exc:
        _emit({"ok": False, "error": f"读取原图失败: {exc}"})
        return 1

    source_copy = out_dir / "source.png"
    source.save(source_copy, "PNG")

    try:
        remote = asyncio.run(_run_remote_decomposition(source_copy))
    except (KieLayerDecompositionError, RuntimeError, OSError) as exc:
        _emit({"ok": False, "error": str(exc)})
        return 2
    except Exception as exc:
        logger.exception("Kie 图层分离未预期异常")
        _emit({"ok": False, "error": f"Kie 图层分离异常: {exc}"})
        return 2

    result_layers: list[dict[str, Any]] = remote["result_layers"]
    if not result_layers:
        _emit({
            "ok": False,
            "error": "Kie 任务成功但没有可下载的图层",
            "kie_task_id": remote["kie"].get("task_id", ""),
        })
        return 3

    # Kie 的 layers_data 通常以 z_index=0 的全画布图作为底图；不再根据
    # 外部模型预估数量匹配，而是完整消费 Kie 返回的所有图层。
    source_size = (source_width, source_height)
    background_index = _select_background_index(result_layers, source_size)
    if background_index is None:
        _emit({
            "ok": False,
            "error": "Kie 任务未返回完整画布背景，无法安全生成 PSD",
            "background_status": "missing",
            "decomposition_provider": "kie",
            "kie_task_id": remote["kie"].get("task_id", ""),
        })
        return 3
    background_layer = result_layers[background_index] if background_index is not None else {}
    background_bytes = background_layer.get("bytes")
    foreground_layers = [
        layer for index, layer in enumerate(result_layers)
        if index != background_index
    ]

    background_path = out_dir / "00-background-kie.png"
    background_status = _prepare_background(
        background_bytes, source, source_width, source_height, background_path
    )
    try:
        background_z_index = int(background_layer.get("z_index", 0)) if background_layer else 0
    except (TypeError, ValueError):
        background_z_index = 0
    background_manifest_layer = {
        "id": "background",
        "name": str(background_layer.get("name") or "背景"),
        "kind": "kie-background" if background_index is not None else "source-background",
        "index": 0,
        "z_index": background_z_index,
        "path": background_path.name,
        "bbox": [0, 0, source_width, source_height],
        "x": 0,
        "y": 0,
        "width": source_width,
        "height": source_height,
        "opacity": 1.0,
        "visible": True,
        "locked": False,
        "is_background": True,
        "source_layer_index": background_index,
    }
    layers: list[dict[str, Any]] = [background_manifest_layer]
    for index, layer in enumerate(foreground_layers, start=1):
        raw = layer["bytes"]
        name = _safe_filename(layer.get("name", "foreground"), f"layer-{index:02d}")
        layer_path = out_dir / f"{index:02d}-{name}.png"
        layers.append(_prepare_foreground(raw, layer, source_size, layer_path, index))

    serialized_result_layers = [
        {key: value for key, value in layer.items() if key != "bytes"}
        for layer in result_layers
    ]

    manifest = {
        "jobId": out_dir.name,
        "source": {
            "path": source_copy.name,
            "width": source_width,
            "height": source_height,
            "mimeType": "image/png",
        },
        "background": {
            "path": background_path.name,
            "completedPath": background_path.name,
            "status": background_status,
            "provider": "kie" if background_index is not None else "source",
            "layer": background_manifest_layer,
        },
        "layers": layers,
        "layerExtraction": {
            "provider": "kie",
            "model": settings.kie_layer_model,
            "taskId": remote["kie"].get("task_id", ""),
            "resultCount": len(result_layers),
            "resultLayers": serialized_result_layers,
        },
    }
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "kie-result.json").write_text(
        json.dumps({
            "task_id": remote["kie"].get("task_id", ""),
            "source_url": remote["kie"].get("source_url", ""),
            "result_count": len(result_layers),
            "result_layers": serialized_result_layers,
            "task": remote["kie"].get("task", {}),
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    try:
        psd_path = export_psd(manifest_path)
    except Exception as exc:
        _emit({"ok": False, "error": f"PSD 导出失败: {exc}"})
        return 4

    _emit({
        "ok": True,
        "psd_path": str(psd_path),
        "manifest_path": str(manifest_path),
        "source_size": [source_width, source_height],
        "background_status": background_status,
        "decomposition_provider": "kie",
        "kie_task_id": remote["kie"].get("task_id", ""),
        "kie_layers": serialized_result_layers,
        "layers": layers,
    })
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

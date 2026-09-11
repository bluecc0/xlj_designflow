"""使用 APIMart Seedream 5.0 Pro 图层分离结果导出 PSD。

链路：
1. 把原图提交给 APIMart ``seedream-5-0-pro`` 图层分离接口；
2. 下载模型返回的图层切片、z_index 和 bounding_box；
3. 按返回的坐标生成 manifest，再复用 layer_psd 导出 PSD。

这个文件由 backend.main 作为子进程调用。stdout 最后一行必须是 JSON，诊断
信息写入 stderr，避免破坏主进程的结果解析。
"""
from __future__ import annotations

import argparse
import asyncio
import base64
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
from backend.apimart_layer_decomposition import (
    ApimartLayerDecompositionClient,
    ApimartLayerDecompositionError,
)
from backend.kie_layer_decomposition import (
    KieLayerDecompositionClient,
    KieLayerDecompositionError,
)
from backend.layer_psd import export_psd


logger = logging.getLogger("layer_extract_worker")

# 这是发给图层分离模型的固定任务说明，限制最多拆分 7 层，避免细碎过度拆分。
LAYER_DECOMPOSITION_PROMPT = (
    "Separate this image into independent editable Photoshop layers. "
    "Limit the decomposition to at most 7 layers in total (including the background layer). "
    "Return one full-canvas background layer first, followed by the primary visually "
    "independent foreground objects, person, product, text group, logo, shadow, "
    "or decoration. Merge tiny fragments and decorations into their corresponding "
    "main element to avoid over-segmentation. Preserve the original canvas and composition. "
    "Return exact bounding boxes and z-order for every layer, keep foreground layers tightly "
    "cropped with transparency outside visible content, and do not invent or redesign any content."
)


def _emit(payload: dict[str, Any]) -> None:
    # The parent process parses stdout as JSON, and Windows may expose the
    # child stdout as GBK. ASCII-escape non-ASCII metadata so a successful PSD
    # export cannot fail while printing its result payload.
    print(json.dumps(payload, ensure_ascii=True), flush=True)


async def _download_result_layer(
    client: httpx.AsyncClient,
    url: str,
    index: int,
    retries: int,
) -> bytes:
    if url.startswith("data:image/"):
        try:
            _, b64_data = url.split(",", 1)
            return base64.b64decode(b64_data)
        except Exception as exc:
            raise RuntimeError(f"Base64 图层 {index} 解码失败: {exc}") from exc

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
                raise RuntimeError(f"下载图层 {index} 失败: {last_error}")
        if attempt < max_attempts:
            await asyncio.sleep(min(2.0, 0.5 * attempt))
    raise RuntimeError(
        f"下载图层 {index} 失败: {last_error}（已重试 {max_attempts - 1} 次）"
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
                logger.warning("Kie 图层 %s 缺少图片 URL，跳过", index)
                continue
            item = dict(layer)
            try:
                item["bytes"] = await _download_result_layer(client, url, index, retries)
            except RuntimeError as exc:
                # A single expired result URL should not discard the other
                # layers when Kie returned a usable multi-layer result.
                logger.warning("Kie 图层 %s 下载失败，跳过: %s", index, exc)
                continue
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


def _scale_bbox(
    bbox: list[int],
    coordinate_size: tuple[int, int],
    target_size: tuple[int, int],
) -> list[int] | None:
    coordinate_width, coordinate_height = coordinate_size
    target_width, target_height = target_size
    if min(coordinate_width, coordinate_height, target_width, target_height) <= 0:
        return None
    if coordinate_size == target_size:
        return bbox
    scale_x = target_width / coordinate_width
    scale_y = target_height / coordinate_height
    return _coerce_bbox(
        [
            bbox[0] * scale_x,
            bbox[1] * scale_y,
            bbox[2] * scale_x,
            bbox[3] * scale_y,
        ],
        target_width,
        target_height,
    )


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


def _layer_bbox(
    layer: dict[str, Any],
    width: int,
    height: int,
    coordinate_size: tuple[int, int] | None = None,
) -> list[int] | None:
    coordinate_width, coordinate_height = coordinate_size or (width, height)
    bounding_box = layer.get("bounding_box")
    if isinstance(bounding_box, dict):
        absolute = bounding_box.get("absolute") or bounding_box.get("pixel")
        bbox = _coerce_bbox(absolute, coordinate_width, coordinate_height)
        if bbox:
            return _scale_bbox(bbox, (coordinate_width, coordinate_height), (width, height))
        normalized = bounding_box.get("normalized")
        bbox = _coerce_bbox(normalized, coordinate_width, coordinate_height, normalized=True)
        if bbox:
            return _scale_bbox(bbox, (coordinate_width, coordinate_height), (width, height))
    for key in ("bbox", "box", "coordinates"):
        bbox = _coerce_bbox(layer.get(key), coordinate_width, coordinate_height)
        if bbox:
            return _scale_bbox(bbox, (coordinate_width, coordinate_height), (width, height))
    return None


def _select_background_index(
    result_layers: list[dict[str, Any]],
    source_size: tuple[int, int],
) -> int | None:
    """选择返回的全画布背景，避免把局部图拉伸成背景。

    Seedream / 图层分离模型通常以 name="background" 或 z_index=0 的全画布 PNG 作为底图；
    部分响应还会额外返回带 bounding_box 的局部背景（例如地面），后者必须保留为普通前景层。
    """
    width, height = source_size
    for index, layer in enumerate(result_layers):
        raw = layer.get("bytes")
        if not raw:
            continue
        name = str(layer.get("name") or "").strip().lower()
        if name in ("background", "背景"):
            return index
        bbox = _layer_bbox(layer, width, height)
        try:
            z_index = int(layer.get("z_index", index))
        except (TypeError, ValueError):
            z_index = index
        if z_index == 0 and bbox is None:
            return index

    if result_layers and result_layers[0].get("bytes"):
        bbox = _layer_bbox(result_layers[0], width, height)
        if bbox is None or bbox == [0, 0, width, height]:
            return 0
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
    coordinate_size: tuple[int, int] | None = None,
) -> dict[str, Any]:
    width, height = source_size
    image = _to_rgba(raw)
    canvas_size = coordinate_size or source_size
    bbox = _layer_bbox(layer, width, height, coordinate_size=canvas_size)

    # Kie 正常会为裁切图返回 bounding_box。若返回全画布透明图，alpha
    # bbox 可以安全地还原位置；响应缺少坐标时使用有限的本地兜底位置，
    # 保证多图层成功响应仍能生成可打开的 PSD。
    if bbox is None and image.size == (width, height):
        alpha_bbox = image.getchannel("A").getbbox()
        if alpha_bbox and alpha_bbox != (0, 0, width, height):
            bbox = list(alpha_bbox)
    if bbox is None:
        # A successful Kie response with multiple images is still useful even
        # when one layer omits coordinates. Keep the PSD usable by placing a
        # full-canvas result on the canvas, or an unlocated crop at the origin.
        if image.size == canvas_size:
            bbox = [0, 0, width, height]
        else:
            bbox = [0, 0, min(width, image.width), min(height, image.height)]

    # Kie may return full-canvas layers at its own output size. Normalize them
    # before applying the source-space bounding box.
    if image.size == canvas_size and canvas_size != source_size:
        image = image.resize(source_size, Image.LANCZOS)
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
    provider = getattr(settings, "layer_extract_provider", "apimart").lower()
    if provider == "apimart":
        if not settings.layer_extract_api_key:
            raise ApimartLayerDecompositionError("未配置图层分离 API 密钥（AI_IMAGE_API_KEY / LAYER_EXTRACT_API_KEY）")
        client = ApimartLayerDecompositionClient(
            api_key=settings.layer_extract_api_key,
            base_url=settings.layer_extract_base_url,
            model=settings.layer_extract_model,
            size=settings.layer_extract_size,
            timeout_seconds=settings.layer_extract_timeout_seconds,
            poll_interval_seconds=settings.layer_extract_poll_interval_seconds,
            download_retries=settings.layer_extract_download_retries,
        )
        result = await client.run(
            source_copy,
            prompt=LAYER_DECOMPOSITION_PROMPT,
        )
        result_layers = await _download_result_layers(
            result["result_layers"],
            settings.layer_extract_timeout_seconds,
            settings.layer_extract_download_retries,
        )
        return {
            "provider": "apimart",
            "model": settings.layer_extract_model,
            "task_id": result.get("task_id", ""),
            "raw_result": result,
            "result_layers": result_layers,
        }

    # 兼容历史 kie 模式
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
    upload_filename = f"designflow-layer-{source_copy.parent.name}.png"
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
        "provider": "kie",
        "model": settings.kie_layer_model,
        "task_id": result.get("task_id", ""),
        "raw_result": result,
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
    except (ApimartLayerDecompositionError, KieLayerDecompositionError, RuntimeError, OSError) as exc:
        _emit({"ok": False, "error": str(exc)})
        return 2
    except Exception as exc:
        logger.exception("图层分离未预期异常")
        _emit({"ok": False, "error": f"图层分离异常: {exc}"})
        return 2

    provider = remote.get("provider", "apimart")
    model_name = remote.get("model", "")
    task_id = remote.get("task_id", "")
    result_layers: list[dict[str, Any]] = remote["result_layers"]
    if not result_layers:
        _emit({
            "ok": False,
            "error": "任务成功但没有可下载的图层",
            "task_id": task_id,
            "kie_task_id": task_id,
            "decomposition_provider": provider,
        })
        return 3

    # 图层分离模型通常以 background 或 z_index=0 的全画布图作为底图
    source_size = (source_width, source_height)
    background_index = _select_background_index(result_layers, source_size)
    if background_index is None and len(result_layers) <= 2:
        _emit({
            "ok": False,
            "error": f"任务只返回 {len(result_layers)} 个图层，无法组成 PSD",
            "background_status": "missing",
            "decomposition_provider": provider,
            "task_id": task_id,
            "kie_task_id": task_id,
        })
        return 3
    background_layer = result_layers[background_index] if background_index is not None else {}
    background_bytes = background_layer.get("bytes")
    foreground_layers = [
        layer for index, layer in enumerate(result_layers)
        if index != background_index
    ]
    # 限制总层数最多 7 层（包含背景层 1 层 + 前景最多 6 层），避免过度碎片化
    if len(foreground_layers) > 6:
        foreground_layers = foreground_layers[:6]

    background_path = out_dir / "00-background.png"
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
        "kind": f"{provider}-background" if background_index is not None else "source-background",
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
    coordinate_size = _image_size(background_bytes) or source_size
    for index, layer in enumerate(foreground_layers, start=1):
        raw = layer["bytes"]
        name = _safe_filename(layer.get("name", "foreground"), f"layer-{index:02d}")
        layer_path = out_dir / f"{index:02d}-{name}.png"
        layers.append(
            _prepare_foreground(
                raw,
                layer,
                source_size,
                layer_path,
                index,
                coordinate_size=coordinate_size,
            )
        )

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
            "provider": provider if background_index is not None else "source",
            "layer": background_manifest_layer,
        },
        "layers": layers,
        "layerExtraction": {
            "provider": provider,
            "model": model_name,
            "taskId": task_id,
            "resultCount": len(result_layers),
            "resultLayers": serialized_result_layers,
        },
    }
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    result_meta = {
        "task_id": task_id,
        "provider": provider,
        "model": model_name,
        "result_count": len(result_layers),
        "result_layers": serialized_result_layers,
        "raw": remote.get("raw_result", {}),
    }
    (out_dir / "layer-result.json").write_text(
        json.dumps(result_meta, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (out_dir / "kie-result.json").write_text(
        json.dumps(result_meta, ensure_ascii=False, indent=2),
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
        "decomposition_provider": provider,
        "task_id": task_id,
        "kie_task_id": task_id,
        "result_layers": serialized_result_layers,
        "kie_layers": serialized_result_layers,
        "layers": layers,
    })
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

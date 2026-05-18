from __future__ import annotations

import json
import re
import struct
import time
import uuid
import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from PIL import Image

from .ai_image import generate_image_with_reference
from .config import settings


_PSD_ROOT = settings.output_path / "psd"
_AI_IMAGES_ROOT = settings.output_path / "ai-images"


@dataclass
class LayerSpec:
    name: str
    kind: str


def _safe_name(value: str, fallback: str = "layer") -> str:
    safe = "".join(ch for ch in str(value or "").strip() if ch.isalnum() or ch in ("-", "_"))
    return safe or fallback


def parse_layer_specs(text: str) -> list[LayerSpec]:
    clean = (text or "").strip()
    clean = re.sub(r"^(帮我|请|把|将)?\s*(这个|这张)?图(片)?(里|中的)?", "", clean)
    clean = re.sub(r"(分层|拆层|转psd|转PSD|生成psd|生成PSD)$", "", clean).strip()
    parts = [p.strip(" \t\r\n，,、/|;；。") for p in re.split(r"[，,、/|;；\n]+", clean)]
    if not clean:
        return [
            LayerSpec(name="背景", kind="background"),
            LayerSpec(name="产品", kind="subject"),
            LayerSpec(name="元素", kind="element"),
            LayerSpec(name="文字", kind="text"),
        ]

    specs: list[LayerSpec] = []
    for part in parts:
        if not part:
            continue
        kind = "transparent"
        if any(word in part for word in ("背景", "底图", "场景")):
            kind = "background"
        elif any(word in part for word in ("文字", "文案", "标题", "字体")):
            kind = "text"
        elif any(word in part for word in ("阴影", "光效", "高光", "投影")):
            kind = "effect"
        elif any(word in part for word in ("产品", "主体", "人物", "模特", "物体")):
            kind = "subject"
        elif any(word in part for word in ("元素", "装饰", "贴纸", "图形")):
            kind = "element"
        specs.append(LayerSpec(name=part[:24], kind=kind))
    return specs[:6]


def _layer_prompt(spec: LayerSpec, all_names: list[str]) -> str:
    other = "、".join(name for name in all_names if name != spec.name)
    base = (
        "Use the attached image as the exact visual reference. "
        "Keep the same canvas, composition, scale, position, perspective, lighting direction, and style. "
        "Do not crop, zoom, rotate, or move anything. "
    )
    if spec.kind == "background":
        return (
            base
            + f"Generate only the background layer named '{spec.name}'. "
            + "Remove foreground products, text, decorations, shadows, and light effects from the scene. "
            + "Reconstruct hidden background areas naturally. Output a full-canvas opaque PNG."
        )
    detail_hint = ""
    if spec.kind == "subject":
        detail_hint = "Preserve the product/person identity, silhouette, material, logo, packaging details, and natural shadow/reflection as closely as possible. "
    elif spec.kind == "text":
        detail_hint = "Preserve the original text content, typography style, color, position, spacing, and artistic lettering as closely as possible. "
    elif spec.kind in {"element", "effect"}:
        detail_hint = "Preserve the decorative element shape, color, glow, shadow, and relative stacking as closely as possible. "
    return (
        base
        + f"Generate only the '{spec.name}' layer. "
        + (f"Do not include these other layers: {other}. " if other else "")
        + detail_hint
        + "Remove the original background completely. "
        + "The layer must stay in the exact original position on a full-size canvas. "
        + "Everything except this layer must be a flat pure green chroma key background, exactly #00FF00. "
        + "Do not use gradients, texture, noise, or shadows on the green background. Output a full-canvas PNG."
    )


def _resolve_ai_image_url(url: str) -> Path:
    clean = (url or "").split("?", 1)[0].strip()
    prefix = "/ai-images/"
    if not clean.startswith(prefix):
        raise ValueError("Unexpected generated image path")
    path = (_AI_IMAGES_ROOT / Path(*clean[len(prefix):].split("/"))).resolve()
    if _AI_IMAGES_ROOT.resolve() not in path.parents:
        raise ValueError("Generated image path is outside ai-images")
    if not path.exists():
        raise FileNotFoundError("Generated image file was not found")
    return path


def _normalize_layer_image(path: Path, target_size: tuple[int, int], opaque: bool) -> tuple[Image.Image, dict]:
    image = Image.open(path).convert("RGBA")
    if image.size != target_size:
        image = image.resize(target_size, Image.Resampling.LANCZOS)
    if not opaque:
        image = _green_to_alpha(image)
    alpha = image.getchannel("A")
    alpha_min, alpha_max = alpha.getextrema()
    hist = alpha.histogram()
    transparent_pixels = sum(hist[:250])
    total = target_size[0] * target_size[1]
    if opaque:
        image = Image.merge("RGBA", (*image.convert("RGB").split(), Image.new("L", target_size, 255)))
    return image, {
        "has_alpha": alpha_min < 255,
        "alpha_min": alpha_min,
        "alpha_max": alpha_max,
        "transparent_ratio": round(transparent_pixels / max(total, 1), 4),
        "size": [target_size[0], target_size[1]],
    }


def _green_to_alpha(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    pixels = rgba.load()
    width, height = rgba.size
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            green_score = g - max(r, b)
            is_green = g > 135 and green_score > 45
            if not is_green:
                continue
            distance = ((r - 0) ** 2 + (g - 255) ** 2 + (b - 0) ** 2) ** 0.5
            alpha = int(max(0, min(255, (distance - 24) * 5)))
            if alpha < 12:
                alpha = 0
            pixels[x, y] = (r, g, b, min(a, alpha))

    # Remove green spill on soft edges.
    pixels = rgba.load()
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            if 0 < a < 255 and g > max(r, b):
                g = max(r, b)
                pixels[x, y] = (r, g, b, a)
    return rgba


def _pascal_name(name: str) -> bytes:
    raw = _safe_name(name, "layer").encode("ascii", "ignore")[:255]
    data = bytes([len(raw)]) + raw
    while len(data) % 4:
        data += b"\0"
    return data


def _unicode_layer_name(name: str) -> bytes:
    text = name or "layer"
    raw = text.encode("utf-16-be")
    payload = struct.pack(">I", len(text)) + raw
    if len(payload) % 2:
        payload += b"\0"
    block = b"8BIM" + b"luni" + struct.pack(">I", len(payload)) + payload
    if len(block) % 2:
        block += b"\0"
    return block


def _pack_layer_record(name: str, image: Image.Image) -> tuple[bytes, bytes]:
    img = image.convert("RGBA")
    w, h = img.size
    channels = img.split()
    channel_defs = [
        (0, channels[0].tobytes()),
        (1, channels[1].tobytes()),
        (2, channels[2].tobytes()),
        (-1, channels[3].tobytes()),
    ]
    record = bytearray()
    record += struct.pack(">iiii", 0, 0, h, w)
    record += struct.pack(">H", len(channel_defs))
    for channel_id, channel_data in channel_defs:
        record += struct.pack(">hI", channel_id, len(channel_data) + 2)
    record += b"8BIM"
    record += b"norm"
    record += bytes([255, 0, 8, 0])
    extra = bytearray()
    extra += struct.pack(">I", 0)
    extra += struct.pack(">I", 0)
    extra += _pascal_name(name)
    extra += _unicode_layer_name(name)
    record += struct.pack(">I", len(extra))
    record += extra
    pixels = bytearray()
    for _, channel_data in channel_defs:
        pixels += struct.pack(">H", 0)
        pixels += channel_data
    return bytes(record), bytes(pixels)


def _write_psd(path: Path, preview: Image.Image, layers: list[tuple[str, Image.Image]]) -> None:
    rgb = preview.convert("RGB")
    w, h = rgb.size
    layer_records = bytearray()
    layer_pixels = bytearray()
    for name, image in layers:
        record, pixels = _pack_layer_record(name, image)
        layer_records += record
        layer_pixels += pixels
    layer_info = bytearray()
    layer_info += struct.pack(">h", len(layers))
    layer_info += layer_records
    layer_info += layer_pixels
    if len(layer_info) % 2:
        layer_info += b"\0"
    layer_mask = bytearray()
    layer_mask += struct.pack(">I", len(layer_info))
    layer_mask += layer_info
    layer_mask += struct.pack(">I", 0)
    if len(layer_mask) % 2:
        layer_mask += b"\0"
    with path.open("wb") as fh:
        fh.write(b"8BPS")
        fh.write(struct.pack(">H", 1))
        fh.write(b"\0" * 6)
        fh.write(struct.pack(">HIIHH", 3, h, w, 8, 3))
        fh.write(struct.pack(">I", 0))
        fh.write(struct.pack(">I", 0))
        fh.write(struct.pack(">I", len(layer_mask)))
        fh.write(layer_mask)
        fh.write(struct.pack(">H", 0))
        fh.write(b"".join(ch.tobytes() for ch in rgb.split()))


async def create_layered_psd_from_image(
    *,
    image_bytes: bytes,
    filename: str,
    layer_text: str,
    user_id: str,
    model: str = "gpt-image-2",
    size: str = "auto",
    resolution: str = "",
    log: Callable[[str], None] | None = None,
) -> dict:
    specs = parse_layer_specs(layer_text)
    emit = log or (lambda message: None)

    safe_user = _safe_name(user_id, "anonymous")
    job_id = uuid.uuid4().hex
    out_dir = _PSD_ROOT / safe_user / job_id
    out_dir.mkdir(parents=True, exist_ok=True)

    source_path = out_dir / "source.png"
    source_path.write_bytes(image_bytes)
    source = Image.open(source_path).convert("RGBA")
    target_size = source.size
    request_size = size
    all_names = [spec.name for spec in specs]
    emit(f"已解析参考图：{target_size[0]}×{target_size[1]}")
    emit("智能分层方案：" + "、".join(all_names))

    reference_layer = source.convert("RGBA")
    layers: list[tuple[str, Image.Image]] = [("原图参考", reference_layer)]
    layer_results = []
    started = time.time()

    async def build_one_layer(index: int, spec: LayerSpec) -> tuple[int, str, Image.Image, dict]:
        prompt = _layer_prompt(spec, all_names)
        emit(f"图层任务已启动 {index}/{len(specs)}：{spec.name}")
        generated = await generate_image_with_reference(
            model=model,
            prompt=prompt,
            images=[(image_bytes, filename or "reference.png")],
            size=request_size,
            resolution=resolution,
            user_id=user_id,
        )
        emit(f"图层 {spec.name} 已完成，正在校准边缘与通道")
        generated_path = _resolve_ai_image_url(generated["url"])
        layer_name = f"{index:02d}_{_safe_name(spec.name, f'layer_{index}')}.png"
        layer_path = out_dir / layer_name
        image, alpha_report = _normalize_layer_image(generated_path, target_size, spec.kind == "background")
        image.save(layer_path)
        emit(f"图层 {spec.name} 已归档")
        return index, spec.name, image, {
            "name": spec.name,
            "kind": spec.kind,
            "url": f"/output/psd/{safe_user}/{job_id}/{layer_name}",
            "prompt": prompt,
            "alpha": alpha_report,
            "mode": "opaque_background" if spec.kind == "background" else "green_screen_to_alpha",
            "task_id": generated.get("task_id"),
        }

    emit(f"并行启动 {len(specs)} 个图层任务")
    built_layers = await asyncio.gather(*[
        build_one_layer(index, spec) for index, spec in enumerate(specs, start=1)
    ])
    for _, name, image, result in sorted(built_layers, key=lambda item: item[0]):
        layers.append((name, image))
        layer_results.append(result)

    emit("开始生成合成预览")
    preview = Image.new("RGBA", target_size, (0, 0, 0, 0))
    for _, image in layers[1:]:
        preview.alpha_composite(image)
    preview_path = out_dir / "preview.png"
    preview.save(preview_path)
    emit("合成预览已生成")
    psd_path = out_dir / "layered.psd"
    emit("正在封装 PSD 文件")
    _write_psd(psd_path, preview, layers)
    emit("PSD 文件已完成")

    manifest = {
        "job_id": job_id,
        "source": f"/output/psd/{safe_user}/{job_id}/source.png",
        "reference_layer": "原图参考",
        "preview": f"/output/psd/{safe_user}/{job_id}/preview.png",
        "psd": f"/output/psd/{safe_user}/{job_id}/layered.psd",
        "layers": layer_results,
        "size": [target_size[0], target_size[1]],
        "request_size": request_size,
        "model": model,
        "elapsed_seconds": round(time.time() - started, 1),
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest

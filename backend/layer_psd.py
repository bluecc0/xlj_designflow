"""PSD 导出（方案第 10 节）。

输入：图层提取 worker 产生的 manifest + 输出目录
输出：一份分层 PSD，每个 layer 作为一个 raster 图层，背景为最底层。

使用 psd-tools 1.17+ 的 create_pixel_layer API 写入栅格图层。
第一阶段只导出 raster layer，不做 text layer / shape layer / 混合模式近似。
"""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image
from psd_tools import PSDImage
from psd_tools.constants import BlendMode


def _flatten_on_white(img: Image.Image) -> Image.Image:
    """把 RGBA 在白色背景上 flatten 成 RGB，避免 PSD 里出现半透明背景异常。"""
    if img.mode == "RGBA":
        bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
        out = Image.alpha_composite(bg, img).convert("RGB")
        return out
    return img.convert("RGB")


def _flatten_keep_alpha(img: Image.Image) -> Image.Image:
    """保留透明度，但保证是 RGBA 模式。"""
    if img.mode == "RGBA":
        return img
    if img.mode == "RGB":
        return img.convert("RGBA")
    return img.convert("RGBA")


def _psd_safe_layer_name(layer: dict, index: int) -> str:
    """PSD 的旧 Pascal 图层名字段使用 macroman，中文名改用稳定英文兜底。"""
    raw_name = str(layer.get("name") or "layer").strip()
    try:
        raw_name.encode("macroman")
    except UnicodeEncodeError:
        raw_name = str(layer.get("kind") or "layer").strip() or "layer"
    return f"{index:02d} {raw_name[:180]}"


def export_psd(manifest_path: Path, out_psd: Path | None = None) -> Path:
    """根据 manifest 生成分层 PSD。

    manifest_path: manifest.json 的路径
    out_psd: 可选输出 PSD 路径；默认放在 manifest 同目录下 {jobId}.psd
    返回 PSD 文件路径。
    """
    manifest_path = Path(manifest_path)
    out_dir = manifest_path.parent
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    src_w = int(manifest["source"]["width"])
    src_h = int(manifest["source"]["height"])
    job_id = manifest.get("jobId", out_dir.name)

    if out_psd is None:
        out_psd = out_dir / f"{job_id}.psd"
    out_psd = Path(out_psd)
    out_psd.parent.mkdir(parents=True, exist_ok=True)

    psd = PSDImage.new(mode="RGB", size=(src_w, src_h), color=(255, 255, 255))

    # 底层：背景（优先用 completed background，否则 residual）
    bg_info = manifest.get("background", {})
    bg_rel = bg_info.get("completedPath") or bg_info.get("residualPath")
    if bg_rel:
        bg_path = out_dir / bg_rel
        if bg_path.exists():
            bg_img = Image.open(bg_path)
            bg_img = _flatten_on_white(bg_img)
            if bg_img.size != (src_w, src_h):
                bg_img = bg_img.resize((src_w, src_h), Image.LANCZOS)
            bg_layer = psd.create_pixel_layer(bg_img, name="00 background", top=0, left=0)
            psd.append(bg_layer)

    # 前景图层：按 index 升序追加，index 小的在下层（更靠近背景）
    layers = sorted(manifest.get("layers", []), key=lambda l: int(l.get("index", 0)))
    for layer in layers:
        layer_path = out_dir / layer["path"]
        if not layer_path.exists():
            continue
        img = Image.open(layer_path)
        img = _flatten_keep_alpha(img)
        x = int(layer.get("x", layer.get("bbox", [0, 0, 0, 0])[0]))
        y = int(layer.get("y", layer.get("bbox", [0, 0, 0, 0])[1]))
        # 保证图层尺寸正确
        w = int(layer.get("width", img.width))
        h = int(layer.get("height", img.height))
        if img.size != (w, h):
            img = img.resize((w, h), Image.LANCZOS)
        opacity = float(layer.get("opacity", 1.0))
        opacity_byte = max(0, min(255, int(round(opacity * 255))))
        visible = bool(layer.get("visible", True))
        index = int(layer.get("index", 0))
        name = _psd_safe_layer_name(layer, index)
        psd_layer = psd.create_pixel_layer(
            img, name=name, top=y, left=x,
            opacity=opacity_byte, blend_mode=BlendMode.NORMAL,
        )
        psd_layer.visible = visible
        psd.append(psd_layer)

    # Kie 返回的图层名称可能包含中文，名称已在上面转为 PSD 可编码的稳定兜底名。
    psd.save(str(out_psd))
    return out_psd


if __name__ == "__main__":
    import sys
    result = export_psd(Path(sys.argv[1]), Path(sys.argv[2]) if len(sys.argv) > 2 else None)
    print(f"PSD written: {result}")

"""图片转分层 PSD 子进程 worker（方案第 5-10 节）。

链路：
1. 读原图尺寸 → 推 ratio
2. 调 gpt-image-2 生成分割图（方案 §5.3 prompt + §5.2 调色板）
3. 下载分割图到 job 目录
4. layer_split.split_layers 切层
5. layer_psd.export_psd 导出 PSD
6. stdout 输出一行 JSON：{ok, psd_path, manifest_path, layers, segmentation_url, ...}

作为子进程跑（镜像 vectorize_worker），避免阻塞事件循环且隔离重依赖。
"""
from __future__ import annotations

import argparse
import asyncio
import json
import shutil
import sys
from pathlib import Path

from PIL import Image

from backend.ai_image import generate_image_with_reference, _OUTPUT_DIR
from backend.layer_split import split_layers
from backend.layer_psd import export_psd


# 方案 §5.2 推荐前景调色板
PREFERRED_PALETTE = [
    "#ff0066", "#66ff00", "#00ffff", "#0066ff", "#9933ff",
    "#ff6600", "#996633", "#ffcc00", "#00aa66", "#cc33ff",
]

# 方案 §5.3 分割 prompt 模板
SEGMENTATION_PROMPT = """You are preparing a design-layer segmentation map for converting the attached image into editable PSD-like layers.

Create one low-detail hard-edged flat-color segmentation map.

Rules:
1. Preserve the exact source aspect ratio.
2. Render the entire background as one solid black region: #000000.
3. Use one distinct non-black solid color for each independently editable foreground object or logical text group.
4. Default to object-level granularity, not part-level granularity.
5. A complete object must stay one region even if it contains texture, labels, highlights, shadows, reflections, or printed details.
6. Split only things a designer would reasonably move or edit independently.
7. Text areas should become one filled silhouette or block per logical text group. Do not recreate readable text unless the letter shapes themselves are the object boundary.
8. Do not include labels, legends, icons, gradients, shadows, textures, readable words, source artwork, or antialias-like details in the segmentation map.
9. Do not reuse the same or similar foreground color for unrelated objects.
10. Do not leave important foreground regions uncolored.

Preferred foreground colors:
#ff0066, #66ff00, #00ffff, #0066ff, #9933ff, #ff6600, #996633, #ffcc00, #00aa66, #cc33ff.

Output only the segmentation map as a PNG.
"""

# 方案 §7.3 背景补全 prompt 模板
BACKGROUND_COMPLETION_PROMPT = """You are completing the background layer for a PSD-like layer extraction workflow.

Attached image 1 is the original source image.
Attached image 2 is the locally extracted residual background layer with transparent holes where foreground objects and text were removed.

Task:
Create one clean full-frame background image.

Rules:
1. Fill only the transparent or missing regions from image 2 using visual context from image 1.
2. Remove foreground objects, products, badges, props, logos, and readable text that belong to separated layers.
3. Preserve the source aspect ratio, canvas size, perspective, lighting, color palette, background style, and design intent.
4. Do not add borders, labels, legends, segmentation colors, or side-by-side comparisons.
5. Output a single full-frame PNG.
"""

# 候选 ratio 及其数值宽高比，用于匹配原图
_RATIO_CANDIDATES = [
    ("1:1", 1.0),
    ("3:4", 3 / 4),
    ("4:3", 4 / 3),
    ("5:4", 5 / 4),
    ("4:5", 4 / 5),
    ("9:16", 9 / 16),
    ("16:9", 16 / 9),
    ("2:3", 2 / 3),
    ("3:2", 3 / 2),
]


def _pick_ratio(width: int, height: int) -> str:
    if not width or not height:
        return "1:1"
    target = width / height
    best = min(_RATIO_CANDIDATES, key=lambda kv: abs(kv[1] - target))
    return best[0]


def _emit(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


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
        with Image.open(src_path) as im:
            src_w, src_h = im.width, im.height
            src_mode = im.mode
    except Exception as exc:
        _emit({"ok": False, "error": f"读取原图失败: {exc}"})
        return 1

    # 1. 准备原图副本到 job 目录（manifest 引用 source.png）
    source_copy = out_dir / "source.png"
    try:
        Image.open(src_path).convert("RGBA").save(source_copy, "PNG")
    except Exception as exc:
        _emit({"ok": False, "error": f"原图转 PNG 失败: {exc}"})
        return 1

    # 2. 调 gpt-image-2 生成分割图
    ratio = _pick_ratio(src_w, src_h)
    try:
        with open(source_copy, "rb") as f:
            src_bytes = f.read()
        result = asyncio.run(generate_image_with_reference(
            model="gpt-image-2",
            prompt=SEGMENTATION_PROMPT,
            images=[(src_bytes, "source.png")],
            size=ratio,
            resolution="1K",
            user_id=args.user_id,
        ))
    except Exception as exc:
        _emit({"ok": False, "error": f"生成分割图失败: {exc}"})
        return 2

    seg_url = result.get("url") or ""
    if not seg_url.startswith("/ai-images/"):
        _emit({"ok": False, "error": f"分割图返回 URL 异常: {seg_url}"})
        return 2

    # 3. 把分割图复制到 job 目录
    seg_disk = _OUTPUT_DIR / seg_url[len("/ai-images/"):]
    if not seg_disk.exists():
        _emit({"ok": False, "error": f"分割图磁盘文件不存在: {seg_disk}"})
        return 2
    seg_copy = out_dir / "segmentation.png"
    shutil.copyfile(seg_disk, seg_copy)

    # 4. 切层
    try:
        manifest = split_layers(source_copy, seg_copy, out_dir)
    except Exception as exc:
        _emit({"ok": False, "error": f"切层失败: {exc}"})
        return 3

    # 5. 背景补全：给 gpt-image-2 原图 + residual，让它填透明洞（方案 §7）
    residual_path = out_dir / manifest.get("background", {}).get("residualPath", "00-background-residual.png")
    completed_path = out_dir / "completed-background.png"
    background_status = "residual"
    logs_dir = out_dir / "logs"
    logs_dir.mkdir(exist_ok=True)
    bg_log = logs_dir / "background-completion.log"
    try:
        if residual_path.exists():
            with open(source_copy, "rb") as f1, open(residual_path, "rb") as f2:
                src_bytes = f1.read()
                residual_bytes = f2.read()
            bg_log.write_text(f"start background completion, ratio={ratio}, refs=2\n", encoding="utf-8")
            bg_result = asyncio.run(generate_image_with_reference(
                model="gpt-image-2",
                prompt=BACKGROUND_COMPLETION_PROMPT,
                images=[(src_bytes, "source.png"), (residual_bytes, "residual-background.png")],
                size=ratio,
                resolution="1K",
                user_id=args.user_id,
            ))
            bg_url = bg_result.get("url") or ""
            with open(bg_log, "a", encoding="utf-8") as lf:
                lf.write(f"model returned url: {bg_url}\n")
            if bg_url.startswith("/ai-images/"):
                bg_disk = _OUTPUT_DIR / bg_url[len("/ai-images/"):]
                if bg_disk.exists():
                    # 后处理（方案 §7.4）：resize 到原图尺寸、RGBA、透明像素用白色 flatten
                    bg_img = Image.open(bg_disk).convert("RGBA")
                    if bg_img.size != (src_w, src_h):
                        bg_img = bg_img.resize((src_w, src_h), Image.LANCZOS)
                    # 若仍有透明像素，flatten 到白底
                    alpha = bg_img.split()[3]
                    if alpha.getextrema()[0] < 255:
                        white_bg = Image.new("RGBA", bg_img.size, (255, 255, 255, 255))
                        bg_img = Image.alpha_composite(white_bg, bg_img)
                    bg_img.save(completed_path, "PNG")
                    manifest.setdefault("background", {})["completedPath"] = "completed-background.png"
                    manifest["background"]["status"] = "ready"
                    (out_dir / "manifest.json").write_text(
                        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
                    )
                    background_status = "ready"
                    with open(bg_log, "a", encoding="utf-8") as lf:
                        lf.write(f"completed-background saved, status=ready\n")
                else:
                    with open(bg_log, "a", encoding="utf-8") as lf:
                        lf.write(f"disk file missing: {bg_disk}\n")
            else:
                with open(bg_log, "a", encoding="utf-8") as lf:
                    lf.write(f"url not /ai-images/, got: {bg_url}\n")
        else:
            bg_log.write_text(f"residual not found: {residual_path}\n", encoding="utf-8")
    except Exception as exc:
        # 背景补全失败不致命，保留 residual（方案 §13.4）
        import traceback
        background_status = "failed"
        manifest.setdefault("background", {})["status"] = "failed"
        try:
            (out_dir / "manifest.json").write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        except Exception:
            pass
        err_detail = traceback.format_exc()
        bg_log.write_text(f"background completion failed: {exc}\n{err_detail}\n", encoding="utf-8")
        sys.stderr.write(f"背景补全失败，保留 residual: {exc}\n{err_detail}\n")

    # 6. 导出 PSD
    try:
        psd_path = export_psd(out_dir / "manifest.json")
    except Exception as exc:
        _emit({"ok": False, "error": f"PSD 导出失败: {exc}"})
        return 4

    layers_summary = [
        {
            "index": l.get("index", 0),
            "name": l.get("name", ""),
            "path": l.get("path", ""),
            "bbox": l.get("bbox", [0, 0, 0, 0]),
            "x": l.get("x", 0),
            "y": l.get("y", 0),
            "width": l.get("width", 0),
            "height": l.get("height", 0),
            "segmentationColor": l.get("segmentationColor", ""),
        }
        for l in manifest.get("layers", [])
    ]

    _emit({
        "ok": True,
        "psd_path": str(psd_path),
        "manifest_path": str(out_dir / "manifest.json"),
        "segmentation_url": seg_url,
        "source_size": [src_w, src_h],
        "background_status": background_status,
        "layers": layers_summary,
    })
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

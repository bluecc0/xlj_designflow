"""图片分层切层算法（方案第 6 节）。

输入：原图 + 模型生成的纯色分割图
输出：多个透明 PNG 图层 + residual background + manifest.json

纯 Pillow 实现，避免引入 numpy/scipy/opencv 重依赖。
"""
from __future__ import annotations

import json
from collections import deque
from pathlib import Path
from typing import Any

from PIL import Image, ImageFilter, ImageChops


# 方案 6.4 的参数，针对单张图场景略收紧
CONFIG = {
    "maxLayers": 24,
    "paletteSize": 32,
    "minAreaRatio": 0.00035,
    "minAreaPx": 48,
    "pad": 2,
    "colorMergeDistance": 48,
    "componentMergeGapRatio": 0.035,
    "boundaryTrim": 2,
    "boundaryFlood": 8,
    "boundaryFloodColorDistance": 30,
    "maskGrow": 6,
    "maskGrowColorDistance": 8,
}


def _rgb_distance(a: tuple[int, int, int], b: tuple[int, int, int]) -> int:
    return int(sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5)


def _is_background_color(c: tuple[int, int, int]) -> bool:
    r, g, b = c
    if r < 24 and g < 24 and b < 24:
        return True
    if r > 235 and g > 235 and b > 235:
        return True
    return False


def _resize_nearest(seg: Image.Image, size: tuple[int, int]) -> Image.Image:
    return seg.resize(size, Image.NEAREST)


def _quantize(seg: Image.Image, colors: int) -> Image.Image:
    return seg.convert("RGB").quantize(colors=colors, method=Image.Quantize.MEDIANCUT).convert("RGB")


def _collect_color_regions(seg: Image.Image) -> list[dict[str, Any]]:
    """统计每种颜色出现的像素数和 mask。"""
    pixels = list(seg.getdata())
    counts: dict[tuple[int, int, int], int] = {}
    for p in pixels:
        counts[p] = counts.get(p, 0) + 1
    regions = []
    for color, count in counts.items():
        regions.append({"color": color, "area": count})
    return regions


def _mask_for_color(seg: Image.Image, color: tuple[int, int, int], tolerance: int = 0) -> Image.Image:
    """返回该颜色区域的二值 mask（L 模式，255=命中）。"""
    if tolerance <= 0:
        # 精确匹配
        data = list(seg.getdata())
        mask_data = bytearray([255 if p == color else 0 for p in data])
        mask = Image.frombytes("L", seg.size, bytes(mask_data))
        return mask
    # 容差匹配
    r, g, b = color
    data = list(seg.getdata())
    mask_data = bytearray(len(data))
    tol_sq = tolerance * tolerance
    for i, p in enumerate(data):
        dr, dg, db = p[0] - r, p[1] - g, p[2] - b
        if dr * dr + dg * dg + db * db <= tol_sq:
            mask_data[i] = 255
    return Image.frombytes("L", seg.size, bytes(mask_data))


def _connected_components(mask: Image.Image) -> list[dict[str, Any]]:
    """4-连通连通域。返回每个域的 bbox (left, top, right, bottom) 和像素数 + 独立 mask。"""
    w, h = mask.size
    data = mask.load()
    visited = Image.new("L", mask.size, 0)
    vis = visited.load()
    components: list[dict[str, Any]] = []
    for y in range(h):
        for x in range(w):
            if data[x, y] != 255 or vis[x, y]:
                continue
            # BFS
            q = deque([(x, y)])
            vis[x, y] = 255
            min_x, min_y, max_x, max_y = x, y, x, y
            area = 0
            comp_pixels: list[tuple[int, int]] = []
            while q:
                cx, cy = q.popleft()
                comp_pixels.append((cx, cy))
                area += 1
                if cx < min_x:
                    min_x = cx
                if cx > max_x:
                    max_x = cx
                if cy < min_y:
                    min_y = cy
                if cy > max_y:
                    max_y = cy
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < w and 0 <= ny < h and data[nx, ny] == 255 and not vis[nx, ny]:
                        vis[nx, ny] = 255
                        q.append((nx, ny))
            comp_mask = Image.new("L", mask.size, 0)
            cm = comp_mask.load()
            for px, py in comp_pixels:
                cm[px, py] = 255
            components.append({
                "mask": comp_mask,
                "bbox": (min_x, min_y, max_x + 1, max_y + 1),
                "area": area,
            })
    return components


def _merge_close_components(components: list[dict[str, Any]], gap: int) -> list[dict[str, Any]]:
    """把 bbox 间距小于 gap 的同色连通域合并成一个 mask（OR）。"""
    if len(components) <= 1:
        return components
    w, h = components[0]["mask"].size
    parent = list(range(len(components)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i, j):
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[ri] = rj

    for i in range(len(components)):
        bi = components[i]["bbox"]
        for j in range(i + 1, len(components)):
            bj = components[j]["bbox"]
            if (bi[0] - gap < bj[2] and bj[0] - gap < bi[2]
                    and bi[1] - gap < bj[3] and bj[1] - gap < bi[3]):
                union(i, j)
    groups: dict[int, list[int]] = {}
    for i in range(len(components)):
        groups.setdefault(find(i), []).append(i)
    merged: list[dict[str, Any]] = []
    for members in groups.values():
        combined_mask = Image.new("L", (w, h), 0)
        for m in members:
            combined_mask = ImageChops.lighter(combined_mask, components[m]["mask"])
        b = components[members[0]]["bbox"]
        min_x, min_y = b[0], b[1]
        max_x, max_y = b[2], b[3]
        area = 0
        for m in members:
            bb = components[m]["bbox"]
            min_x = min(min_x, bb[0])
            min_y = min(min_y, bb[1])
            max_x = max(max_x, bb[2])
            max_y = max(max_y, bb[3])
            area += components[m]["area"]
        merged.append({
            "mask": combined_mask,
            "bbox": (int(min_x), int(min_y), int(max_x), int(max_y)),
            "area": area,
        })
    return merged


def _trim_boundary(mask: Image.Image, trim: int) -> Image.Image:
    """边界向内腐蚀 trim 像素，去掉分割图边缘的背景污染。"""
    if trim <= 0:
        return mask
    eroded = mask.filter(ImageFilter.MinFilter(trim * 2 + 1))
    return eroded


def _flood_outside_like_pixels(mask: Image.Image, source: Image.Image, flood: int, color_dist: int) -> Image.Image:
    """从 mask 边界向内，清理与外部颜色接近的像素。简化版：用 source 在 mask 边界附近做颜色比对。"""
    if flood <= 0:
        return mask
    w, h = mask.size
    md = mask.load()
    src = source.convert("RGB").load()
    # 找 mask 边界像素（mask 内、且邻居有 mask 外的像素）
    to_clear: list[tuple[int, int]] = []
    for y in range(h):
        for x in range(w):
            if md[x, y] != 255:
                continue
            # 检查邻居是否在 mask 外
            has_outside = False
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < w and 0 <= ny < h and md[nx, ny] != 255:
                    has_outside = True
                    break
            if not has_outside:
                continue
            # 取外部邻居颜色作参考
            ref = None
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < w and 0 <= ny < h and md[nx, ny] != 255:
                    ref = src[nx, ny]
                    break
            if ref is None:
                continue
            cur = src[x, y]
            if _rgb_distance(cur, ref) <= color_dist:
                to_clear.append((x, y))
    if not to_clear:
        return mask
    result = mask.copy()
    rd = result.load()
    for x, y in to_clear:
        rd[x, y] = 0
    return result


def _grow_mask_safely(mask: Image.Image, source: Image.Image, grow: int, color_dist: int) -> Image.Image:
    """扩张 mask，只接受与 mask 边界颜色连续的像素。"""
    if grow <= 0:
        return mask
    w, h = mask.size
    src = source.convert("RGB")
    src_data = src.load()
    current = mask.copy()
    cd = current.load()
    for _ in range(grow):
        new_pixels: list[tuple[int, int]] = []
        # 找边界外像素
        for y in range(h):
            for x in range(w):
                if cd[x, y] == 255:
                    continue
                # 邻居是否有 mask
                has_mask = False
                ref_color = None
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h:
                        if cd[nx, ny] == 255:
                            has_mask = True
                            ref_color = src_data[nx, ny]
                            break
                if not has_mask or ref_color is None:
                    continue
                if _rgb_distance(src_data[x, y], ref_color) <= color_dist:
                    new_pixels.append((x, y))
        if not new_pixels:
            break
        for x, y in new_pixels:
            cd[x, y] = 255
    return current


def _crop_rgba_by_mask(source: Image.Image, mask: Image.Image, pad: int) -> tuple[Image.Image, tuple[int, int, int, int]]:
    """从 source 按 mask 裁出 RGBA 图层，bbox 外加 pad 像素 padding。返回 (image, bbox in source coords)。"""
    w, h = source.size
    # 找 mask 的 bbox
    md = mask.load()
    min_x = min_y = float("inf")
    max_x = max_y = 0
    for y in range(h):
        for x in range(w):
            if md[x, y] == 255:
                if x < min_x:
                    min_x = x
                if x > max_x:
                    max_x = x
                if y < min_y:
                    min_y = y
                if y > max_y:
                    max_y = y
    if min_x == float("inf"):
        # 空 mask
        return Image.new("RGBA", (1, 1), (0, 0, 0, 0)), (0, 0, 0, 0)
    # 加 padding，限制在画布内
    bx0 = max(0, int(min_x) - pad)
    by0 = max(0, int(min_y) - pad)
    bx1 = min(w, int(max_x) + 1 + pad)
    by1 = min(h, int(max_y) + 1 + pad)
    bw = bx1 - bx0
    bh = by1 - by0
    # 裁 source 和 mask
    src_crop = source.convert("RGBA").crop((bx0, by0, bx1, by1))
    mask_crop = mask.crop((bx0, by0, bx1, by1))
    # 轻微羽化：1px 高斯模糊，软化锯齿边缘（claimed_mask 仍用未羽化 mask，residual 不受影响）
    mask_crop = mask_crop.filter(ImageFilter.GaussianBlur(radius=1))
    # 把 mask 作为 alpha
    if src_crop.mode != "RGBA":
        src_crop = src_crop.convert("RGBA")
    r, g, b, _ = src_crop.split()
    out = Image.merge("RGBA", (r, g, b, mask_crop))
    return out, (bx0, by0, bx1, by1)


def _guess_layer_name(index: int, color: tuple[int, int, int], bbox: tuple[int, int, int, int], source_size: tuple[int, int]) -> str:
    """粗略命名。第一版不追求语义命名，按顺序 + 位置启发。"""
    w, h = source_size
    _, by0, _, by1 = bbox
    cy = (by0 + by1) / 2
    rel_y = cy / h if h else 0
    if rel_y < 0.25:
        pos = "top"
    elif rel_y > 0.75:
        pos = "bottom"
    else:
        pos = "mid"
    cx = (bbox[0] + bbox[2]) / 2
    rel_x = cx / w if w else 0
    if rel_x < 0.3:
        pos += "-left"
    elif rel_x > 0.7:
        pos += "-right"
    return f"layer-{index:02d}-{pos}"


def split_layers(
    source_path: Path,
    segmentation_path: Path,
    out_dir: Path,
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """主入口。返回 manifest dict。"""
    cfg = {**CONFIG, **(config or {})}
    out_dir.mkdir(parents=True, exist_ok=True)
    layers_dir = out_dir / "layers"
    layers_dir.mkdir(exist_ok=True)

    source = Image.open(source_path).convert("RGBA")
    src_w, src_h = source.size
    total_pixels = src_w * src_h

    seg = Image.open(segmentation_path).convert("RGB")
    seg = _resize_nearest(seg, (src_w, src_h))
    seg = seg.filter(ImageFilter.MedianFilter(size=3))
    seg = _quantize(seg, cfg["paletteSize"])

    regions = _collect_color_regions(seg)
    # 过滤背景色和小面积
    regions = [r for r in regions if not _is_background_color(r["color"])]
    regions = [r for r in regions if r["area"] >= max(cfg["minAreaPx"], int(total_pixels * cfg["minAreaRatio"]))]
    # 合并相近颜色
    regions = _merge_similar_colors(regions, cfg["colorMergeDistance"])
    # 按面积降序
    regions.sort(key=lambda r: r["area"], reverse=True)
    # 限制图层数
    regions = regions[: cfg["maxLayers"]]

    layers: list[dict[str, Any]] = []
    claimed_mask = Image.new("L", (src_w, src_h), 0)

    for idx, region in enumerate(regions):
        color = region["color"]
        full_mask = _mask_for_color(seg, color, tolerance=cfg["colorMergeDistance"] // 2 if cfg["colorMergeDistance"] > 0 else 0)
        components = _connected_components(full_mask)
        # 合并空间相近的连通域
        gap = max(2, int(min(src_w, src_h) * cfg["componentMergeGapRatio"]))
        components = _merge_close_components(components, gap)
        # 过滤小连通域
        components = [c for c in components if c["area"] >= max(cfg["minAreaPx"], int(total_pixels * cfg["minAreaRatio"]))]
        if not components:
            continue
        # 取最大连通域作为该颜色的代表（第一版简化：一个颜色一层）
        # 若有多个大连通域且距离远，理论上应拆成多层；这里先合并，后续可优化
        comp = components[0]
        if len(components) > 1:
            # 合并所有大连通域
            combined = Image.new("L", (src_w, src_h), 0)
            for c in components:
                combined = ImageChops.lighter(combined, c["mask"])
            comp = {"mask": combined, "bbox": _mask_bbox(combined), "area": sum(c["area"] for c in components)}

        mask = comp["mask"]
        mask = _trim_boundary(mask, cfg["boundaryTrim"])
        mask = _flood_outside_like_pixels(mask, source, cfg["boundaryFlood"], cfg["boundaryFloodColorDistance"])
        mask = _grow_mask_safely(mask, source, cfg["maskGrow"], cfg["maskGrowColorDistance"])

        layer_img, bbox = _crop_rgba_by_mask(source, mask, cfg["pad"])
        if bbox == (0, 0, 0, 0):
            continue
        layer_name = _guess_layer_name(idx, color, bbox, (src_w, src_h))
        layer_path = layers_dir / f"{idx:02d}-{layer_name}.png"
        layer_img.save(layer_path, "PNG")

        # 累加 claimed
        claimed_mask = ImageChops.lighter(claimed_mask, mask)

        layers.append({
            "id": f"layer-{idx:02d}",
            "name": layer_name,
            "kind": "object",
            "index": idx,
            "path": str(layer_path.relative_to(out_dir)),
            "bbox": list(bbox),
            "x": bbox[0],
            "y": bbox[1],
            "width": bbox[2] - bbox[0],
            "height": bbox[3] - bbox[1],
            "opacity": 1.0,
            "visible": True,
            "locked": False,
            "segmentationColor": f"#{color[0]:02x}{color[1]:02x}{color[2]:02x}",
            "areaPixels": comp["area"],
        })

    # residual background：原图扣掉所有前景
    residual = source.copy()
    # 把 claimed 区域设为透明
    r, g, b, _ = residual.split()
    claimed_inv = Image.eval(claimed_mask, lambda v: 0 if v > 0 else 255)
    residual = Image.merge("RGBA", (r, g, b, claimed_inv))
    residual_path = out_dir / "00-background-residual.png"
    residual.save(residual_path, "PNG")

    manifest = {
        "version": 1,
        "jobId": out_dir.name,
        "source": {
            "path": str(source_path.name),
            "width": src_w,
            "height": src_h,
            "mimeType": "image/png",
        },
        "segmentation": {
            "path": str(segmentation_path.name),
            "model": "gpt-image-2",
            "paletteSize": cfg["paletteSize"],
        },
        "background": {
            "residualPath": str(residual_path.relative_to(out_dir)),
            "status": "residual",
        },
        "layers": layers,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def _mask_bbox(mask: Image.Image) -> tuple[int, int, int, int]:
    md = mask.load()
    w, h = mask.size
    min_x = min_y = float("inf")
    max_x = max_y = 0
    found = False
    for y in range(h):
        for x in range(w):
            if md[x, y] == 255:
                found = True
                if x < min_x:
                    min_x = x
                if x > max_x:
                    max_x = x
                if y < min_y:
                    min_y = y
                if y > max_y:
                    max_y = y
    if not found:
        return (0, 0, 0, 0)
    return (int(min_x), int(min_y), int(max_x + 1), int(max_y + 1))


def _merge_similar_colors(regions: list[dict[str, Any]], distance: int) -> list[dict[str, Any]]:
    """合并 RGB 距离小于 distance 的颜色，取面积大的为代表色，面积累加。"""
    if distance <= 0 or len(regions) <= 1:
        return regions
    # 按面积降序排序，大色作为代表
    regions = sorted(regions, key=lambda r: r["area"], reverse=True)
    merged: list[dict[str, Any]] = []
    used = [False] * len(regions)
    for i, r in enumerate(regions):
        if used[i]:
            continue
        used[i] = True
        rep_color = r["color"]
        total_area = r["area"]
        for j in range(i + 1, len(regions)):
            if used[j]:
                continue
            if _rgb_distance(rep_color, regions[j]["color"]) <= distance:
                used[j] = True
                total_area += regions[j]["area"]
        merged.append({"color": rep_color, "area": total_area})
    return merged

"""超过上游单次像素上限的扩图：拆成多块依次扩，再拼回一张。

上游一次只能把一个矩形往外扩，且单次结果有像素上限。这里把最终画面的新增区域
拆成若干块，每块 = 已知内容的一条（参考）+ 往外扩的一条（新内容）：

1. 先扩左、右两条（高度同原图），参考原图左右边缘；
2. 再扩上、下两条（宽度为整个最终画面，含四角），参考原图和已扩好的左右；
3. 一条太长时沿长度切成几段，相邻段重叠并渐变混合；要扩的距离太大时分层往外推。

拼接时取每块新生成的部分，外加边界内侧一圈过渡区（上游本来就会重画这一圈），其余原图像素不变。
"""
from __future__ import annotations

import asyncio
import math
import os
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable

import numpy as np
from PIL import Image

from .bfl_outpainting import (
    FAST_SAFE_OUTPUT_PIXELS,
    MAX_OUTPUT_PIXELS,
    MAX_OUTPUT_SIDE,
    MIN_CANVAS_SIDE,
    BflOutpaintingError,
    OutpaintingGeometry,
    OutpaintingValidationError,
    strict_int,
)

# 分块扩图的最终画面像素上限（单次调用仍受上游 4MP 限制）
TILED_MAX_OUTPUT_PIXELS = 5_000_000
# 每块最多尝试次数（含第一次）；已被上游受理的块优先续查结果，不重复提交
TILE_MAX_ATTEMPTS = 3

# 相邻段的重叠宽度，重叠区做线性渐变混合
SEGMENT_OVERLAP = 256
# 每块至少保留的参考深度（已知内容不足时用全部已知内容）
MIN_CONTEXT = 256
# 上游会重画已知区域内侧约 24px 做过渡；拼接时保留这一圈并渐变回原像素
EDGE_BLEND = 32
MAX_SEGMENTS = 16
MAX_LAYERS = 16


@dataclass(frozen=True)
class Rect:
    x0: int
    y0: int
    x1: int
    y1: int

    @property
    def width(self) -> int:
        return self.x1 - self.x0

    @property
    def height(self) -> int:
        return self.y1 - self.y0


@dataclass(frozen=True)
class OutpaintTile:
    """一次上游调用：在最终画面坐标系里，把 known 这块已知内容往 side 方向扩 depth。"""
    side: str          # left / right / top / bottom
    known: Rect        # 作为参考发给上游的已知区域
    depth: int         # 往外扩的距离
    overlap: int       # 与同一条带上一段重叠的长度，拼接时渐变混合

    @property
    def margins(self) -> dict[str, int]:
        m = {"top": 0, "right": 0, "bottom": 0, "left": 0}
        m[self.side] = self.depth
        return m

    @property
    def new_area(self) -> Rect:
        k = self.known
        if self.side == "left":
            return Rect(k.x0 - self.depth, k.y0, k.x0, k.y1)
        if self.side == "right":
            return Rect(k.x1, k.y0, k.x1 + self.depth, k.y1)
        if self.side == "top":
            return Rect(k.x0, k.y0 - self.depth, k.x1, k.y0)
        return Rect(k.x0, k.y1, k.x1, k.y1 + self.depth)

    @property
    def output_size(self) -> tuple[int, int]:
        horizontal = self.side in ("left", "right")
        return (
            self.known.width + (self.depth if horizontal else 0),
            self.known.height + (0 if horizontal else self.depth),
        )


def _segments(length: int, count: int, seg: int) -> list[int]:
    if count == 1:
        return [0]
    step = (length - seg) / (count - 1)
    return [round(i * step) for i in range(count)]


def _fit_band(length: int, depth: int, available: int, *, max_side: int, max_pixels: int,
              max_ratio: float | None) -> tuple[int, int, int] | None:
    """为一条带选 (段数, 段长, 参考深度)；放不下返回 None。"""
    for count in range(1, MAX_SEGMENTS + 1):
        seg = math.ceil((length + (count - 1) * SEGMENT_OVERLAP) / count) if count > 1 else length
        if seg > max_side:
            continue
        max_total = min(max_side, max_pixels // seg)
        context = min(available, max_total - depth)
        if context < min(available, max(depth, MIN_CONTEXT)):
            continue
        if max_ratio and max(context, seg) > min(context, seg) * max_ratio:
            continue
        return count, seg, context
    return None


def plan_tiles(*, source_width: int, source_height: int, margins: dict[str, int],
               max_side: int, max_pixels: int, max_ratio: float | None = None) -> list[OutpaintTile]:
    """按 左→右→上→下 规划每次上游调用。坐标系原点为最终画面左上角。"""
    left, right = int(margins.get("left", 0)), int(margins.get("right", 0))
    top, bottom = int(margins.get("top", 0)), int(margins.get("bottom", 0))
    known = Rect(left, top, left + source_width, top + source_height)
    tiles: list[OutpaintTile] = []
    for side, total in (("left", left), ("right", right), ("top", top), ("bottom", bottom)):
        remaining = total
        layers = 0
        while remaining > 0:
            layers += 1
            if layers > MAX_LAYERS:
                raise ValueError("扩图范围过大，无法拆分")
            horizontal = side in ("left", "right")
            length = known.height if horizontal else known.width
            available = known.width if horizontal else known.height
            depth = remaining
            fit = None
            while depth > 0:
                fit = _fit_band(length, depth, available, max_side=max_side,
                                max_pixels=max_pixels, max_ratio=max_ratio)
                if fit:
                    break
                depth //= 2
            if not fit or depth <= 0:
                raise ValueError("扩图范围无法按上游限制拆分")
            count, seg, context = fit
            prev_end = None
            for start in _segments(length, count, seg):
                a, b = start, start + seg
                if horizontal:
                    y0, y1 = known.y0 + a, known.y0 + b
                    x0, x1 = (known.x0, known.x0 + context) if side == "left" else (known.x1 - context, known.x1)
                else:
                    x0, x1 = known.x0 + a, known.x0 + b
                    y0, y1 = (known.y0, known.y0 + context) if side == "top" else (known.y1 - context, known.y1)
                overlap = 0 if prev_end is None else max(0, prev_end - a)
                tiles.append(OutpaintTile(side=side, known=Rect(x0, y0, x1, y1), depth=depth, overlap=overlap))
                prev_end = b
            if side == "left":
                known = Rect(known.x0 - depth, known.y0, known.x1, known.y1)
            elif side == "right":
                known = Rect(known.x0, known.y0, known.x1 + depth, known.y1)
            elif side == "top":
                known = Rect(known.x0, known.y0 - depth, known.x1, known.y1)
            else:
                known = Rect(known.x0, known.y0, known.x1, known.y1 + depth)
            remaining -= depth
    return tiles


def paste_tile(canvas: Image.Image, tile: OutpaintTile, result: Image.Image) -> None:
    """把上游结果贴回画布。

    上游会把紧贴边界、已知区域内侧约 24px 一起重画做过渡；这一圈若换回原像素会出现一条
    明暗台阶。所以除了新区域，再保留内侧 EDGE_BLEND 的过渡区，从上游结果渐变回画布原像素。
    与同一条带上一段重叠的部分，沿条带方向从上一段渐变到这一段。
    """
    if result.size != tile.output_size:
        raise ValueError(f"扩图分块结果尺寸不符：{result.size} != {tile.output_size}")
    known, area, side = tile.known, tile.new_area, tile.side
    horizontal = side in ("left", "right")
    blend = min(EDGE_BLEND, known.width if horizontal else known.height)
    # 要贴的区域（画布坐标）= 新区域 + 已知区域内侧 blend
    if side == "left":
        box = Rect(area.x0, area.y0, area.x1 + blend, area.y1)
    elif side == "right":
        box = Rect(area.x0 - blend, area.y0, area.x1, area.y1)
    elif side == "top":
        box = Rect(area.x0, area.y0, area.x1, area.y1 + blend)
    else:
        box = Rect(area.x0, area.y0 - blend, area.x1, area.y1)
    # 上游结果图的左上角在画布上的位置
    origin_x = area.x0 if side == "left" else known.x0
    origin_y = area.y0 if side == "top" else known.y0
    piece = result.crop((box.x0 - origin_x, box.y0 - origin_y, box.x1 - origin_x, box.y1 - origin_y))
    piece = piece.convert(canvas.mode)

    depth_n = box.width if horizontal else box.height      # 垂直于条带方向的长度
    along_n = box.height if horizontal else box.width       # 沿条带方向的长度
    # 垂直方向：新区域全取上游结果，内侧过渡区从 1 渐变到 0
    across = np.ones(depth_n, dtype=np.float32)
    if blend:
        fade = np.linspace(1.0, 0.0, blend + 2, dtype=np.float32)[1:-1]
        if side in ("left", "top"):
            across[depth_n - blend:] = fade
        else:
            across[:blend] = fade[::-1]
    # 沿条带方向：与上一段重叠处从 0 渐变到 1
    along = np.ones(along_n, dtype=np.float32)
    if tile.overlap > 0:
        along[:tile.overlap] = np.linspace(0.0, 1.0, tile.overlap + 2, dtype=np.float32)[1:-1]
    weights = np.outer(along, across) if horizontal else np.outer(across, along)
    mask = Image.fromarray((weights * 255).round().astype(np.uint8), "L")
    canvas.paste(piece, (box.x0, box.y0), mask)


# ── 任务层：几何判定与逐块执行 ─────────────────────────────────────────────


def single_call_max_pixels(mode: str) -> int:
    """一次上游调用的结果像素上限：fast 模式要给上游内部补齐留余量。"""
    return FAST_SAFE_OUTPUT_PIXELS if mode == "fast" else MAX_OUTPUT_PIXELS


def tile_limits(mode: str) -> dict[str, Any]:
    return {
        "max_side": MAX_OUTPUT_SIDE,
        "max_pixels": single_call_max_pixels(mode),
        "max_ratio": 8 if mode == "fast" else None,
    }


def needs_tiling(processing_width: int, processing_height: int, margins: dict[str, Any], mode: str) -> bool:
    width = processing_width + int(margins.get("left") or 0) + int(margins.get("right") or 0)
    height = processing_height + int(margins.get("top") or 0) + int(margins.get("bottom") or 0)
    return width * height > single_call_max_pixels(mode)


def tiled_geometry(*, processing_width: Any, processing_height: Any, top: Any, right: Any,
                   bottom: Any, left: Any, mode: str, max_width: int = MAX_OUTPUT_SIDE,
                   max_height: int = MAX_OUTPUT_SIDE,
                   max_pixels: int = TILED_MAX_OUTPUT_PIXELS) -> OutpaintingGeometry:
    """校验分块扩图的最终尺寸并确认能按上游限制拆开。上游一次放不下，所以不走 validate_geometry 的单次上限。"""
    width = strict_int(processing_width, "processing_width", minimum=1)
    height = strict_int(processing_height, "processing_height", minimum=1)
    margins = {"top": strict_int(top, "top"), "right": strict_int(right, "right"),
               "bottom": strict_int(bottom, "bottom"), "left": strict_int(left, "left")}
    if not any(margins.values()):
        raise OutpaintingValidationError("至少一个扩图边距必须大于 0")
    expected_width = width + margins["left"] + margins["right"]
    expected_height = height + margins["top"] + margins["bottom"]
    max_width, max_height = min(MAX_OUTPUT_SIDE, max_width), min(MAX_OUTPUT_SIDE, max_height)
    if expected_width > max_width or expected_height > max_height:
        raise OutpaintingValidationError(f"扩图结果不能超过 {max_width} × {max_height}px")
    if expected_width * expected_height > min(TILED_MAX_OUTPUT_PIXELS, max_pixels):
        raise OutpaintingValidationError(f"扩图结果不能超过 {min(TILED_MAX_OUTPUT_PIXELS, max_pixels)} 像素")
    if mode == "fast":
        if width < MIN_CANVAS_SIDE or height < MIN_CANVAS_SIDE:
            raise OutpaintingValidationError(f"fast 模式要求原图每边至少 {MIN_CANVAS_SIDE}px")
        if max(width, height) > min(width, height) * 8:
            raise OutpaintingValidationError("fast 模式要求原图宽高比不超过 8:1")
    try:
        plan_tiles(source_width=width, source_height=height, margins=margins, **tile_limits(mode))
    except ValueError as exc:
        raise OutpaintingValidationError("扩图范围过大，请缩小扩图范围") from exc
    return OutpaintingGeometry(
        **margins, expected_width=expected_width, expected_height=expected_height,
        provider_top=margins["top"], provider_right=margins["right"],
        provider_bottom=margins["bottom"], provider_left=margins["left"],
        provider_width=expected_width, provider_height=expected_height,
    )


def plan_job_tiles(geometry: OutpaintingGeometry, processing_width: int, processing_height: int,
                   mode: str) -> list[OutpaintTile]:
    return plan_tiles(source_width=processing_width, source_height=processing_height,
                      margins=geometry.requested_margins(), **tile_limits(mode))


def _save_atomic(image: Image.Image, path: Path) -> None:
    temp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        image.save(temp, format="PNG")
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


# run_tile(index, tile, input_path, provider_task_id, polling_url, on_accepted) -> (结果图, 费用)
RunTile = Callable[..., Awaitable[tuple[Image.Image, float | None]]]
Persist = Callable[[dict], Awaitable[None]]


async def run_tiled_outpainting(*, work_dir: Path, source_path: Path, geometry: OutpaintingGeometry,
                                tiles: list[OutpaintTile], state: dict, run_tile: RunTile,
                                persist: Persist, max_attempts: int = TILE_MAX_ATTEMPTS,
                                retry_delay: float = 1.0) -> Image.Image:
    """逐块扩图并拼回。每完成一块就把画布写盘、进度落库，重启后从下一块接着做。

    state（存在任务 request_meta 里）：
      tiles_done  已贴回画布的块数
      tile_task   当前块已被上游受理的 {index, provider_task_id, polling_url}，恢复时续查不重提
      tiles_cost  已完成块的费用合计
    """
    canvas_path = work_dir / "canvas.png"
    done = int(state.get("tiles_done") or 0)
    if done and canvas_path.is_file():
        with Image.open(canvas_path) as stored:
            canvas = stored.copy()
    else:
        done = 0
        state.update(tiles_done=0, tile_task=None, tiles_cost=None)
        with Image.open(source_path) as source:
            mode = "RGBA" if "A" in source.getbands() or "transparency" in source.info else "RGB"
            canvas = Image.new(mode, (geometry.expected_width, geometry.expected_height))
            canvas.paste(source.convert(mode), (geometry.left, geometry.top))
    for index in range(done, len(tiles)):
        tile = tiles[index]
        input_path = work_dir / f"tile_{index}.png"
        k = tile.known
        _save_atomic(canvas.crop((k.x0, k.y0, k.x1, k.y1)), input_path)
        for attempt in range(1, max_attempts + 1):
            task = state.get("tile_task") if isinstance(state.get("tile_task"), dict) else None
            if task and task.get("index") != index:
                task = None

            async def on_accepted(task_id: str, poll_url: str, _index: int = index) -> None:
                state["tile_task"] = {"index": _index, "provider_task_id": task_id, "polling_url": poll_url}
                await persist(state)

            try:
                result, cost = await run_tile(
                    index=index, tile=tile, input_path=input_path,
                    provider_task_id=(task or {}).get("provider_task_id", ""),
                    polling_url=(task or {}).get("polling_url", ""),
                    on_accepted=on_accepted,
                )
                break
            except BflOutpaintingError as exc:
                if attempt >= max_attempts:
                    raise
                accepted = isinstance(state.get("tile_task"), dict) and state["tile_task"].get("index") == index
                if not (accepted and exc.retry_action in {"poll", "download"}):
                    # 没被受理或上游明确失败：下一次重新提交这一块
                    state["tile_task"] = None
                    await persist(state)
                await asyncio.sleep(retry_delay * attempt)
        try:
            paste_tile(canvas, tile, result)
        finally:
            result.close()
        _save_atomic(canvas, canvas_path)
        input_path.unlink(missing_ok=True)
        if cost is not None:
            state["tiles_cost"] = round(float(state.get("tiles_cost") or 0) + float(cost), 6)
        state.update(tiles_done=index + 1, tile_task=None)
        await persist(state)
    return canvas

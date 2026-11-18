"""细节修复：把用户摆好的平面图案交给模型做成实拍效果，只把修复区域贴回原图。

没有图案、只有涂抹时是“局部重绘”：按用户的文字只改涂抹区域，同样只把涂抹区域贴回原图。

图案流程：
1. 按前端传来的叠层参数（裁切、位置、大小、旋转）把图案平贴到原图上；可以同时有多个图案
   （例如鞋子外侧和内侧各一个），一次生成；
2. 修复区域 = 用户涂抹区域 ∪ 图案覆盖区域；涂抹区里没被图案盖住的部分先模糊掉旧图案；
3. 以修复区域为中心、多留一圈上下文，按最接近的生图比例裁出局部，放大后发给模型三张参考：
   图1 原图局部（未被遮挡，看清商品原本的材质、褶皱和光影），图2 同一局部叠上新图案的效果（位置/大小/角度），
   图3 起依次是每个图案裁切后的素材（样式细节）；
4. 模型结果缩回局部尺寸，先对齐原图的清晰度和色调（用修复区域外的上下文估计），
   再只把修复区域内“真正变了”的像素（向外略扩、边缘羽化）贴回原图，区域外像素与原图完全一致。

所有坐标都是原图像素坐标；图案的裁切框是图案原图像素坐标。
"""
from __future__ import annotations

import io
import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from PIL import Image, ImageChops, ImageFilter, ImageOps

# 修复区域外多留的上下文：区域长边的比例，且不少于固定像素
CONTEXT_RATIO = 0.5
MIN_CONTEXT_PX = 48
# 发给模型的局部图长边至少放大到这个尺寸
MIN_WORK_SIDE = 1024
MAX_WORK_SIDE = 2048
# 贴回时修复区域先外扩、再羽化，避免边缘露出旧图案或出现硬边
MASK_GROW_PX = 3
# 一次修复最多叠几个图案（参考图 = 原图区域 + 叠加效果 + 每个图案）
MAX_PATTERNS = 4
MIN_FEATHER_PX = 2
# 贴回前对齐色调：在这么大的网格上估计低频色差（局部长边缩到该格数）
TONE_GRID = 48
# 修复区域内与原图差异低于 CHANGE_LOW 的像素保留原图，高于 CHANGE_HIGH 的完全用模型结果（0-255）
CHANGE_LOW = 8.0
CHANGE_HIGH = 28.0
# 改动区域再向外扩（局部长边的比例，至少 3px）：旧图案边缘那圈淡灰边 / 压缩噪点与结果只差一点，
# 若正好落在半贴半留的过渡带里，旧图案的轮廓会半透明地留下来；扩出去让过渡落在干净的底子上。
# 扩太多会把模型自己画的褶皱阴影也带进来，1.2% 在实测中两头兼顾。
CHANGE_GROW_RATIO = 0.012
# 清晰度对齐时尝试的模糊半径
SOFTEN_RADII = (0.4, 0.6, 0.8, 1.0, 1.3, 1.6, 2.0)

SUPPORTED_RATIOS: list[tuple[str, float]] = [
    ("1:1", 1.0),
    ("3:4", 3 / 4),
    ("4:3", 4 / 3),
    ("4:5", 4 / 5),
    ("5:4", 5 / 4),
    ("2:3", 2 / 3),
    ("3:2", 3 / 2),
    ("9:16", 9 / 16),
    ("16:9", 16 / 9),
]


@dataclass(frozen=True)
class Placement:
    """图案叠层在原图上的摆放（原图像素坐标）。"""
    center_x: float
    center_y: float
    width: float
    height: float
    rotation: float = 0.0  # 角度，顺时针为正（与 CSS rotate 一致）
    crop: tuple[int, int, int, int] | None = None  # 图案原图上的裁切框 (x0, y0, x1, y1)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Placement":
        def num(key: str, default: float | None = None) -> float:
            value = data.get(key, default)
            if value is None:
                raise ValueError(f"缺少参数 {key}")
            value = float(value)
            if not math.isfinite(value):
                raise ValueError(f"参数 {key} 无效")
            return value

        crop_raw = data.get("crop")
        crop = None
        if isinstance(crop_raw, dict):
            x, y = num_in(crop_raw, "x"), num_in(crop_raw, "y")
            w, h = num_in(crop_raw, "width"), num_in(crop_raw, "height")
            crop = (round(x), round(y), round(x + w), round(y + h))
        placement = cls(
            center_x=num("center_x"),
            center_y=num("center_y"),
            width=num("width"),
            height=num("height"),
            rotation=num("rotation", 0.0),
            crop=crop,
        )
        if placement.width < 1 or placement.height < 1:
            raise ValueError("图案尺寸过小")
        return placement


def num_in(data: dict[str, Any], key: str) -> float:
    value = float(data.get(key, 0) or 0)
    if not math.isfinite(value):
        raise ValueError(f"裁切参数 {key} 无效")
    return value


@dataclass
class RepairPlan:
    box: tuple[int, int, int, int]  # 原图上的局部裁切框
    size: str  # 生图比例，如 "3:4"
    work_image: bytes  # 图1：放大后的原图局部（未叠加图案，PNG）
    reference_image: bytes | None  # 局部重绘：标红了涂抹区域的局部图（图2，PNG）；图案流程不用
    region_mask: Image.Image  # 原图尺寸的修复区域（L，255=修复）
    has_pattern: bool = True
    guide_image: bytes | None = None  # 图2（仅图案流程）：同一局部叠上所有新图案后的效果（PNG）
    pattern_images: list[bytes] = field(default_factory=list)  # 图3 起（仅图案流程）：每个图案裁切后的素材（PNG）


def open_image(data: bytes) -> Image.Image:
    with Image.open(io.BytesIO(data)) as src:
        src.load()
        return ImageOps.exif_transpose(src).copy()


def crop_pattern(pattern: Image.Image, crop: tuple[int, int, int, int] | None) -> Image.Image:
    pattern = pattern.convert("RGBA")
    if not crop:
        return pattern
    x0, y0, x1, y1 = crop
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(pattern.width, x1), min(pattern.height, y1)
    if x1 - x0 < 1 or y1 - y0 < 1:
        raise ValueError("图案裁切范围无效")
    return pattern.crop((x0, y0, x1, y1))


def render_pattern_layer(size: tuple[int, int], pattern: Image.Image, placement: Placement) -> Image.Image:
    """把（已裁切的）图案按摆放参数画到一张原图尺寸的透明图层上。"""
    w = max(1, round(placement.width))
    h = max(1, round(placement.height))
    scaled = pattern.convert("RGBA").resize((w, h), Image.LANCZOS)
    # PIL 的 rotate 是逆时针，CSS rotate 是顺时针
    rotated = scaled.rotate(-placement.rotation, resample=Image.BICUBIC, expand=True)
    left = round(placement.center_x - rotated.width / 2)
    top = round(placement.center_y - rotated.height / 2)
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    layer.paste(rotated, (left, top), rotated)
    return layer


def _mask_bbox(mask: Image.Image) -> tuple[int, int, int, int] | None:
    return mask.point(lambda v: 255 if v >= 8 else 0).getbbox()


def nearest_ratio(width: float, height: float) -> tuple[str, float]:
    ratio = width / height if height > 0 else 1.0
    return min(SUPPORTED_RATIOS, key=lambda item: abs(math.log(item[1] / ratio)))


def plan_box(region: tuple[int, int, int, int], image_size: tuple[int, int]) -> tuple[tuple[int, int, int, int], str]:
    """修复区域外扩上下文，再按最接近的生图比例取框，尽量不越界。"""
    img_w, img_h = image_size
    x0, y0, x1, y1 = region
    rw, rh = x1 - x0, y1 - y0
    margin = max(MIN_CONTEXT_PX, round(max(rw, rh) * CONTEXT_RATIO))
    bw, bh = rw + margin * 2, rh + margin * 2
    label, ratio = nearest_ratio(bw, bh)
    if bw / bh < ratio:
        bw = bh * ratio
    else:
        bh = bw / ratio
    # 框比原图大时等比缩回原图范围内（仍保证包住修复区域，比例会略有偏差）
    if bw > img_w or bh > img_h:
        shrink = min(img_w / bw, img_h / bh)
        bw, bh = max(rw, bw * shrink), max(rh, bh * shrink)
        bw, bh = min(bw, img_w), min(bh, img_h)
        label, _ = nearest_ratio(bw, bh)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    left = min(max(0, round(cx - bw / 2)), img_w - round(bw))
    top = min(max(0, round(cy - bh / 2)), img_h - round(bh))
    left, top = max(0, left), max(0, top)
    box = (left, top, min(img_w, left + round(bw)), min(img_h, top + round(bh)))
    return box, label


def _read_brush(brush_mask_bytes: bytes | None, size: tuple[int, int]) -> Image.Image:
    brush = Image.new("L", size, 0)
    if brush_mask_bytes:
        raw = open_image(brush_mask_bytes)
        # 涂抹遮罩：优先用透明通道，没有就用亮度
        raw = raw.getchannel("A") if raw.mode in ("RGBA", "LA") else raw.convert("L")
        if raw.size != size:
            raw = raw.resize(size, Image.NEAREST)
        brush = raw.point(lambda v: 255 if v >= 128 else 0)
    return brush


def _upscale(work: Image.Image) -> Image.Image:
    long_side = max(work.size)
    target = min(MAX_WORK_SIDE, max(MIN_WORK_SIDE, long_side))
    if target == long_side:
        return work
    scale = target / long_side
    return work.resize((max(1, round(work.width * scale)), max(1, round(work.height * scale))), Image.LANCZOS)


def _mark_region(local: Image.Image, local_mask: Image.Image) -> Image.Image:
    """局部图上用半透明红色盖住修复区域，并描一圈红边，告诉模型改哪里。"""
    marked = local.convert("RGB")
    red = Image.new("RGB", marked.size, (255, 40, 40))
    marked = Image.composite(Image.blend(marked, red, 0.45), marked, local_mask)
    width = max(2, round(max(marked.size) * 0.004))
    edge = ImageChops.subtract(
        local_mask.filter(ImageFilter.MaxFilter(width * 2 + 1)), local_mask,
    )
    return Image.composite(red, marked, edge)


def build_plan(
    source_bytes: bytes,
    patterns: list[tuple[bytes, Placement]],
    brush_mask_bytes: bytes | None,
) -> RepairPlan:
    """patterns：(图案图片, 摆放参数) 列表；为空时是局部重绘。"""
    source = open_image(source_bytes).convert("RGB")
    brush = _read_brush(brush_mask_bytes, source.size)
    if len(patterns) > MAX_PATTERNS:
        raise ValueError(f"一次最多叠加 {MAX_PATTERNS} 个图案")

    if not patterns:
        # 局部重绘：只有涂抹区域
        if not _mask_bbox(brush):
            raise ValueError("请先在原图上涂抹要修改的区域，或拖入图案")
        box, size = plan_box(_mask_bbox(brush), source.size)
        local = source.crop(box)
        return RepairPlan(
            box=box,
            size=size,
            work_image=_png(_upscale(local)),
            reference_image=_png(_upscale(_mark_region(local, brush.crop(box)))),
            region_mask=brush,
            has_pattern=False,
        )

    cropped = [crop_pattern(open_image(data), placement.crop) for data, placement in patterns]
    layers = [render_pattern_layer(source.size, pattern, placement)
              for pattern, (_data, placement) in zip(cropped, patterns)]
    region = brush
    for layer in layers:
        region = ImageChops.lighter(region, layer.getchannel("A").point(lambda v: 255 if v >= 8 else 0))
    bbox = _mask_bbox(region)
    if not bbox:
        raise ValueError("图案不在原图范围内，请把图案拖到原图上")

    box, size = plan_box(bbox, source.size)

    # 引导图：涂抹区先抹平旧图案（大半径模糊，保留大致明暗），再平贴新图案
    guide = source.copy()
    if brush.getbbox():
        local = source.crop(box)
        radius = max(8, round(max(local.size) * 0.04))
        blurred = Image.new("RGB", source.size)
        blurred.paste(local.filter(ImageFilter.GaussianBlur(radius)), box[:2])
        guide.paste(blurred, (0, 0), brush)
    guide = guide.convert("RGBA")
    for layer in layers:  # 后放上来的图案盖在前面的上面，与前端显示一致
        guide.alpha_composite(layer)

    return RepairPlan(
        box=box,
        size=size,
        work_image=_png(_upscale(source.crop(box))),
        reference_image=None,
        region_mask=region,
        guide_image=_png(_upscale(guide.convert("RGB").crop(box))),
        pattern_images=[_png(p) for p in cropped],
    )


def _gauss_blur(arr: np.ndarray, sigma: float) -> np.ndarray:
    """二维数组的高斯模糊（只用在缩小后的小网格上）。"""
    r = max(1, int(3 * sigma))
    x = np.arange(-r, r + 1, dtype=np.float64)
    k = np.exp(-(x ** 2) / (2 * sigma ** 2))
    k /= k.sum()
    a = np.pad(arr, r, mode="edge")
    a = np.apply_along_axis(lambda v: np.convolve(v, k, mode="valid"), 0, a)
    return np.apply_along_axis(lambda v: np.convolve(v, k, mode="valid"), 1, a)


def _tone_correction(diff: np.ndarray, weight: np.ndarray) -> np.ndarray:
    """用 weight>0 处的色差（原图-结果）估计一张平滑的色差图，并外推到修复区域里。"""
    h, w = weight.shape
    scale = TONE_GRID / max(h, w)
    gw, gh = max(2, round(w * scale)), max(2, round(h * scale))

    def down(arr: np.ndarray) -> np.ndarray:
        return np.asarray(Image.fromarray(arr.astype(np.float32), "F").resize((gw, gh), Image.BOX), np.float64)

    def up(arr: np.ndarray) -> np.ndarray:
        return np.asarray(Image.fromarray(arr.astype(np.float32), "F").resize((w, h), Image.BILINEAR), np.float64)

    sigma = TONE_GRID * 0.12
    den = _gauss_blur(down(weight), sigma)
    total = float(weight.sum())
    out = np.zeros_like(diff)
    for c in range(diff.shape[2]):
        mean = float((diff[..., c] * weight).sum() / total) if total > 0 else 0.0
        num = _gauss_blur(down(diff[..., c] * weight), sigma)
        out[..., c] = up(np.where(den > 1e-3, num / np.maximum(den, 1e-6), mean))
    return out


def _detail_energy(image: Image.Image, weight: np.ndarray) -> float:
    """weight 区域内的平均高频强度，用来比较清晰度。"""
    gray = image.convert("L")
    a = np.asarray(gray, np.float64)
    b = np.asarray(gray.filter(ImageFilter.GaussianBlur(1.2)), np.float64)
    return float((np.abs(a - b) * weight).sum() / max(float(weight.sum()), 1.0))


def _match_sharpness(patch: Image.Image, local: Image.Image, weight: np.ndarray) -> Image.Image:
    """模型结果通常比原图（尤其是放大过的小局部）更锐利，轻微模糊到与周围清晰度一致。"""
    if weight.sum() < 1:
        return patch
    target = _detail_energy(local, weight)
    best, best_err = patch, abs(_detail_energy(patch, weight) - target)
    for radius in SOFTEN_RADII:
        candidate = patch.filter(ImageFilter.GaussianBlur(radius))
        err = abs(_detail_energy(candidate, weight) - target)
        if err < best_err:
            best, best_err = candidate, err
    return best


def _blur_unit(arr: np.ndarray, radius: float) -> np.ndarray:
    img = Image.fromarray(np.clip(arr * 255, 0, 255).round().astype(np.uint8), "L")
    return np.asarray(img.filter(ImageFilter.GaussianBlur(radius)), np.float64) / 255


def paste_back(source: Image.Image, result: Image.Image, box: tuple[int, int, int, int], region_mask: Image.Image) -> Image.Image:
    """模型结果缩回局部尺寸，对齐清晰度和色调后，只把修复区域内真正变了的像素贴回原图。"""
    source = source.convert("RGB")
    bw, bh = box[2] - box[0], box[3] - box[1]
    patch = result.convert("RGB").resize((bw, bh), Image.LANCZOS)
    local = source.crop(box)
    local_mask = region_mask.convert("L").crop(box)
    if MASK_GROW_PX > 0:
        local_mask = local_mask.filter(ImageFilter.MaxFilter(MASK_GROW_PX * 2 + 1))

    # 上下文：修复区域外再隔开一圈（模型在区域边上常有过渡），用来估计清晰度和色差
    gap = max(3, round(max(bw, bh) * 0.03))
    # 用盒式模糊 + 阈值做膨胀（大半径的 MaxFilter 非常慢）
    near = (np.asarray(local_mask.filter(ImageFilter.BoxBlur(gap))) > 0).astype(np.float64)
    context = 1 - near
    if context.sum() < 50:
        context = 1 - np.asarray(local_mask, np.float64) / 255

    patch = _match_sharpness(patch, local, context)
    src = np.asarray(local, np.float64)
    fixed = np.clip(np.asarray(patch, np.float64) + _tone_correction(src - np.asarray(patch, np.float64), context), 0, 255)

    # 修复区域里模型没怎么改的地方保留原图像素，避免整块区域的纹理、褶皱和周围对不上
    diff = np.abs(src - fixed).max(axis=2) / 255
    diff = _blur_unit(diff, 1.5) * 255
    change = np.clip((diff - CHANGE_LOW) / (CHANGE_HIGH - CHANGE_LOW), 0, 1)
    grow = max(3, round(max(bw, bh) * CHANGE_GROW_RATIO))
    core = Image.fromarray(((change > 0.25) * 255).astype(np.uint8), "L")
    grown = (np.asarray(core.filter(ImageFilter.BoxBlur(grow))) > 0).astype(np.float64)
    change = np.maximum(change, _blur_unit(grown, grow / 2))
    feather = max(MIN_FEATHER_PX, round(max(bw, bh) * 0.006))
    region_alpha = np.asarray(local_mask.filter(ImageFilter.GaussianBlur(feather)), np.float64) / 255
    alpha = _blur_unit(region_alpha * change, 1)[..., None]

    merged = src * (1 - alpha) + fixed * alpha
    out = source.copy()
    out.paste(Image.fromarray(merged.round().astype(np.uint8), "RGB"), box[:2])
    return out


def build_inpaint_prompt(instruction: str) -> str:
    return "\n".join([
        "任务：电商图片局部修改，只改指定区域。",
        "",
        "图片说明：",
        "- 图1：原图的一块局部。",
        "- 图2：同一块局部，用半透明红色和红色描边标出了要修改的区域。",
        "",
        "要求：",
        "- 以图1为底图输出一张同样构图的局部照片，不要出现红色标记。",
        f"- 只修改图2红色标出的区域：{instruction.strip()[:500]}",
        "- 修改后的内容与周围的光照、阴影、透视和材质纹理自然衔接。",
        "- 红色区域以外的内容保持不变。",
    ])


def build_prompt(extra_prompt: str = "", pattern_count: int = 1) -> str:
    if pattern_count > 1:
        return _build_multi_prompt(extra_prompt, pattern_count)
    lines = [
        "任务：电商商品图案细节修复（商品可能是服装、包、鞋、帽子等），把平贴的图案做成真实做在商品上的实拍效果。",
        "",
        "图片说明：",
        "- 图1：商品局部原图，展示这块表面原本的颜色、材质纹理、褶皱起伏和光影（包括将被新图案盖住的部分）。",
        "- 图2：同一局部，把新图案平贴在了要印的位置上（还没有贴合商品表面）；图案周围被抹平、变模糊的地方是要去掉的旧图案。",
        "- 图3：新图案素材，用来对照图案的样式细节。",
        "",
        "要求：",
        "- 以图1为底图输出一张同样构图的局部照片。",
        "- 新图案的位置、大小、角度和形状与图2一致，不要移动、缩放或重新设计；图案的样式、颜色和细节参照图3。",
        "- 让图案像真实做在图1这块表面上一样（印花、刺绣、压印等工艺质感参照图3）：跟随图1中表面的曲面、褶皱和起伏变形，带上图1中同样的光照、阴影和材质纹理。",
        "- 图1中位于新图案范围内（图2里被新图案及其底色盖住的地方）的旧图案、旧logo要去掉，只保留新图案。",
        "- 图3如果带有底色或材质背景，只取图案本身，不要把底色方块做到商品上；图案以外的地方保持图1原本的样子。",
        "- 图2中被抹平、变模糊的地方，恢复成与周围一致的商品表面（同样的颜色、材质纹理和褶皱起伏），不要留下旧图案。",
        "- 其他部分（人物、背景、商品其余部分）保持图1的样子不变。",
    ]
    return _with_extra(lines, extra_prompt)


def _build_multi_prompt(extra_prompt: str, count: int) -> str:
    last = count + 2
    lines = [
        "任务：电商商品图案细节修复（商品可能是服装、包、鞋、帽子等），把平贴的多个图案做成真实做在商品上的实拍效果。",
        "",
        "图片说明：",
        "- 图1：商品局部原图，展示这块表面原本的颜色、材质纹理、褶皱起伏和光影（包括将被新图案盖住的部分）。",
        f"- 图2：同一局部，把 {count} 个新图案分别平贴在各自要做的位置上（还没有贴合商品表面，可能分布在商品的不同面上，比如外侧和内侧）；图案周围被抹平、变模糊的地方是要去掉的旧图案。",
        f"- 图3到图{last}：这 {count} 个新图案各自的素材，用来对照样式细节；按图案的样子对应到图2里的位置。",
        "",
        "要求：",
        "- 以图1为底图输出一张同样构图的局部照片。",
        f"- 每个新图案的位置、大小、角度和形状都与图2一致，不要移动、缩放、合并或重新设计；样式、颜色和细节参照图3到图{last}中对应的素材。",
        "- 每个图案都像真实做在它所在的那一面上一样（印花、刺绣、压印等工艺质感参照对应素材）：跟随图1中那一面的曲面、褶皱和起伏变形，带上图1中同样的光照、阴影和材质纹理。",
        "- 图1中位于新图案范围内（图2里被新图案及其底色盖住的地方）的旧图案、旧logo要去掉，只保留新图案。",
        "- 素材如果带有底色或材质背景，只取图案本身，不要把底色方块做到商品上；图案以外的地方保持图1原本的样子。",
        "- 图2中被抹平、变模糊的地方，恢复成与周围一致的商品表面（同样的颜色、材质纹理和褶皱起伏），不要留下旧图案。",
        "- 其他部分（人物、背景、商品其余部分）保持图1的样子不变。",
    ]
    return _with_extra(lines, extra_prompt)


def _with_extra(lines: list[str], extra_prompt: str) -> str:
    extra = (extra_prompt or "").strip()
    if extra:
        lines += ["", f"补充说明：{extra[:500]}"]
    return "\n".join(lines)


def _png(image: Image.Image) -> bytes:
    out = io.BytesIO()
    image.save(out, format="PNG", optimize=True)
    return out.getvalue()


SOURCE_FILENAME = "repair_source.png"
REGION_FILENAME = "repair_region.png"


def save_paste_back_inputs(ref_dir, source_bytes: bytes, region_mask: Image.Image) -> None:
    """保存贴回所需的原图和修复区域，放在任务参考图目录里（不占用 ref_XX 命名）。"""
    from .task_checkpoint import atomic_write

    ref_dir.mkdir(parents=True, exist_ok=True)
    atomic_write(ref_dir / SOURCE_FILENAME, _png(open_image(source_bytes).convert("RGB")))
    atomic_write(ref_dir / REGION_FILENAME, _png(region_mask.convert("L")))


def finish_from_files(ref_dir, result_path, box: tuple[int, int, int, int]) -> bytes:
    """读取保存的原图、修复区域和模型结果，返回贴回后的整图 PNG。"""
    with Image.open(ref_dir / SOURCE_FILENAME) as src, Image.open(ref_dir / REGION_FILENAME) as region, \
            Image.open(result_path) as result:
        return _png(paste_back(src.convert("RGB"), result.convert("RGB"), box, region.convert("L")))

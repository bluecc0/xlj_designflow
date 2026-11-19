"""细节修复：把用户摆好的平面图案交给模型做成实拍效果，只把修复区域贴回原图。

没有图案、只有涂抹时是“局部重绘”：按用户的文字只改涂抹区域，同样只把涂抹区域贴回原图。

图案流程：
1. 按前端传来的叠层参数（裁切、位置、大小、旋转）把图案平贴到原图上；可以同时有多个图案
   （例如鞋子外侧和内侧各一个），一次生成；
2. 修复区域 = 用户涂抹区域 ∪ 图案覆盖区域；涂抹区里没被图案盖住的部分先模糊掉旧图案；
3. 以修复区域为中心、多留一圈上下文，按最接近的生图比例裁出局部，放大后发给模型三张参考：
   图1 原图局部（未被遮挡，看清商品原本的材质、褶皱和光影），图2 同一局部叠上新图案的效果（位置/大小/角度），
   图3 起依次是每个图案裁切后的素材（样式细节）；
4. 模型结果缩回局部尺寸，用修复区域外的上下文把位置、清晰度对齐原图，
   再在修复区域内做泊松融合：边界取原图，区域内只取模型里明确的边（新图案），
   布料的明暗、褶皱、纹理保留原图（模型重画时常会自己添褶皱），区域外像素与原图完全一致。

所有坐标都是原图像素坐标；图案的裁切框是图案原图像素坐标。
"""
from __future__ import annotations

import io
import math
from dataclasses import dataclass, field
from typing import Any

import cv2
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
# 贴回时挑选梯度的阈值（0-255，相邻像素差）：低于 EDGE_LOW 算布纹/明暗等细弱变化，高于 EDGE_HIGH 算明确的边
EDGE_LOW = 4.0
EDGE_HIGH = 12.0
# 对齐模型结果时允许的最大偏差：缩放/旋转（仿射矩阵线性部分偏离单位阵）和平移（局部长边的比例），超出视为对齐失败
ALIGN_MAX_LINEAR = 0.05
ALIGN_MAX_SHIFT = 0.03
# 泊松方程求解（多重网格预条件共轭梯度）：区域内每像素残差的均方根低于这个值就停（0-255 灰度）
POISSON_TOL = 0.001
POISSON_MAX_ITERS = 500
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


def _dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    if radius <= 0:
        return mask.astype(bool)
    kernel = np.ones((2 * radius + 1, 2 * radius + 1), np.uint8)
    return cv2.dilate(mask.astype(np.uint8), kernel).astype(bool)


def _align(local: Image.Image, patch: Image.Image, context: np.ndarray) -> Image.Image:
    """模型会把整个局部重画一遍，常带亚像素的偏移/缩放。用修复区外的内容估计仿射变换，把结果对回原图。
    估不出来或偏差离谱时原样返回。"""
    if context.sum() < 200:
        return patch
    a = cv2.GaussianBlur(np.asarray(local.convert("L"), np.float32), (0, 0), 1.5)
    b = cv2.GaussianBlur(np.asarray(patch.convert("L"), np.float32), (0, 0), 1.5)
    identity = np.eye(2, 3, dtype=np.float32)
    warp = identity
    # 仿射估不动（纹理只有一个方向时会原样返回单位阵）或报错时，退回只估平移
    for motion in (cv2.MOTION_AFFINE, cv2.MOTION_TRANSLATION):
        try:
            _, warp = cv2.findTransformECC(
                a, b, identity.copy(), motion,
                (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-6),
                context.astype(np.uint8) * 255, 5,
            )
        except cv2.error:
            continue
        if not np.array_equal(warp, identity):
            break
    if np.array_equal(warp, identity):
        return patch
    h, w = a.shape
    if (np.abs(warp[:, :2] - np.eye(2)).max() > ALIGN_MAX_LINEAR
            or np.abs(warp[:, 2]).max() > max(w, h) * ALIGN_MAX_SHIFT):
        return patch
    out = cv2.warpAffine(np.asarray(patch.convert("RGB")), warp, (w, h),
                         flags=cv2.INTER_LANCZOS4 + cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REFLECT)
    return Image.fromarray(out, "RGB")


def _grads(a: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """前向差分：gx[y,x] = a[y,x+1]-a[y,x]，gy[y,x] = a[y+1,x]-a[y,x]。"""
    gx = np.zeros_like(a)
    gy = np.zeros_like(a)
    gx[:, :-1] = a[:, 1:] - a[:, :-1]
    gy[:-1] = a[1:] - a[:-1]
    return gx, gy


def _edge_weight(g: np.ndarray) -> np.ndarray:
    """梯度有多像“明确的边”：0（布纹、明暗）到 1（图案边缘）。三通道共用，避免颜色漂移。"""
    return np.clip((np.abs(g).max(axis=2, keepdims=True) - EDGE_LOW) / (EDGE_HIGH - EDGE_LOW), 0, 1)


def _pick_gradient(model_g: np.ndarray, source_g: np.ndarray) -> np.ndarray:
    """模型里明确的边（新图案）用模型的；原图里明确而模型里没有的边（去掉的旧图案）清零；
    其余细弱变化保留原图，模型自己添的褶皱、明暗、布纹不带进来。"""
    wm = _edge_weight(model_g)
    return wm * model_g + (1 - wm) * (1 - _edge_weight(source_g)) * source_g


def _neighbor_sum(a: np.ndarray) -> np.ndarray:
    out = np.zeros_like(a)
    out[1:] += a[:-1]
    out[:-1] += a[1:]
    out[:, 1:] += a[:, :-1]
    out[:, :-1] += a[:, 1:]
    return out


def _apply_lap(v: np.ndarray, m: np.ndarray) -> np.ndarray:
    """区域内的离散负拉普拉斯 (4v - Σ邻居)，区域外视为 0。"""
    return (4 * v - _neighbor_sum(v * m)) * m


def _vcycle(r: np.ndarray, m: np.ndarray) -> np.ndarray:
    """多重网格 V 循环：近似解 A·e = r（区域外 e=0）。用作共轭梯度的预条件。"""
    h, w = m.shape[:2]
    if min(h, w) < 16:
        e = np.zeros_like(r)
        for _ in range(60):  # 最粗一层很小，多做几次加权雅可比即可
            e += 0.8 * (r - _apply_lap(e, m)) / 4 * m
        return e
    e = np.zeros_like(r)
    for _ in range(2):
        e += 0.8 * (r - _apply_lap(e, m)) / 4 * m
    res = r - _apply_lap(e, m)
    hh, ww = (h + 1) // 2 * 2, (w + 1) // 2 * 2
    pad = ((0, hh - h), (0, ww - w), (0, 0))
    rp, mp = np.pad(res, pad), np.pad(m, pad)

    def block_sum(a: np.ndarray) -> np.ndarray:
        return a[0::2, 0::2] + a[1::2, 0::2] + a[0::2, 1::2] + a[1::2, 1::2]

    # 粗网格步长翻倍，算子尺度 ×4：残差取 2x2 之和；区域取 2x2 里有任一像素；修正量按块复制回来
    ec = _vcycle(block_sum(rp), (block_sum(mp) > 0).astype(np.float64))
    e += np.repeat(np.repeat(ec, 2, axis=0), 2, axis=1)[:h, :w] * m
    for _ in range(2):
        e += 0.8 * (r - _apply_lap(e, m)) / 4 * m
    return e


def _cg(b: np.ndarray, m: np.ndarray, x: np.ndarray, tol: float) -> np.ndarray:
    """多重网格预条件的共轭梯度，解 A·x = b（A 见 _apply_lap），三通道一起；
    tol 是区域内每像素残差的均方根（0-255 灰度）。"""
    x = x * m
    r = b - _apply_lap(x, m)
    z = _vcycle(r, m)
    p = z.copy()
    rz = (r * z).sum(axis=(0, 1))
    stop = (tol ** 2) * max(float(m.sum()), 1.0)
    for _ in range(POISSON_MAX_ITERS):
        if ((r * r).sum(axis=(0, 1)) <= stop).all():
            break
        ap = _apply_lap(p, m)
        alpha = rz / np.maximum((p * ap).sum(axis=(0, 1)), 1e-30)
        x += alpha * p
        r -= alpha * ap
        z = _vcycle(r, m)
        rz_new = (r * z).sum(axis=(0, 1))
        p = z + (rz_new / np.where(rz == 0, 1e-30, rz)) * p
        rz = rz_new
    return x


def _poisson(src: np.ndarray, gx: np.ndarray, gy: np.ndarray, omega: np.ndarray) -> np.ndarray:
    """在 omega 内求 f：拉普拉斯(f) = div(gx, gy)，omega 外（含边界）取原图。"""
    om = omega.copy()
    om[0, :] = om[-1, :] = om[:, 0] = om[:, -1] = False
    if not om.any():
        return src
    ys, xs = np.nonzero(om)
    y0, y1, x0, x1 = ys.min() - 1, ys.max() + 2, xs.min() - 1, xs.max() + 2
    s, gx, gy, om = src[y0:y1, x0:x1], gx[y0:y1, x0:x1], gy[y0:y1, x0:x1], om[y0:y1, x0:x1]
    m = om[..., None].astype(np.float64)

    # 4f - Σ邻居 = -div(g)；区域外的已知像素移到右边
    neg_div = -gx.copy()
    neg_div[:, 1:] += gx[:, :-1]
    neg_div -= gy
    neg_div[1:] += gy[:-1]
    b = (_neighbor_sum(s * (1 - m)) + neg_div) * m
    x = _cg(b, m, s, POISSON_TOL)
    out = src.copy()
    out[y0:y1, x0:x1] = np.where(om[..., None], x, s)
    return out


def paste_back(
    source: Image.Image,
    result: Image.Image,
    box: tuple[int, int, int, int],
    region_mask: Image.Image,
    keep_texture: bool = True,
) -> Image.Image:
    """模型结果贴回原图：先把结果对齐到原图，再在修复区域内做泊松融合。

    融合时区域边界取原图像素，区域内按梯度重建，所以边界处在数学上是连续的，不会出现接缝、色块。
    keep_texture=True（图案修复）时只取模型里明确的边（新图案），布料的明暗、褶皱、纹理保留原图；
    False（局部重绘，用户可能要求改任何内容）时整块区域都用模型的梯度。区域外像素与原图完全一致。"""
    source = source.convert("RGB")
    bw, bh = box[2] - box[0], box[3] - box[1]
    local = source.crop(box)
    patch = result.convert("RGB").resize((bw, bh), Image.LANCZOS)
    region = np.asarray(region_mask.convert("L").crop(box), np.uint8) > 127
    omega = _dilate(region, MASK_GROW_PX)
    if not omega.any():
        return source.copy()

    # 上下文：修复区域外再隔开一圈（模型在区域边上常有过渡），用来对齐位置和清晰度
    context = ~_dilate(region, max(3, round(max(bw, bh) * 0.03)))
    patch = _align(local, patch, context)
    patch = _match_sharpness(patch, local, context.astype(np.float64))

    src = np.asarray(local, np.float64)
    model = np.asarray(patch, np.float64)
    mgx, mgy = _grads(model)
    if keep_texture:
        sgx, sgy = _grads(src)
        gx, gy = _pick_gradient(mgx, sgx), _pick_gradient(mgy, sgy)
    else:
        gx, gy = mgx, mgy
    merged = _poisson(src, gx, gy, omega)
    out = source.copy()
    out.paste(Image.fromarray(np.clip(merged, 0, 255).round().astype(np.uint8), "RGB"), box[:2])
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
        "- 保持原图的光影透视还有褶皱，仅作图案修改。",
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
        "- 保持原图的光影透视还有褶皱，仅作图案修改。",
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


def finish_from_files(ref_dir, result_path, box: tuple[int, int, int, int], keep_texture: bool = True) -> bytes:
    """读取保存的原图、修复区域和模型结果，返回贴回后的整图 PNG。keep_texture 见 paste_back。"""
    with Image.open(ref_dir / SOURCE_FILENAME) as src, Image.open(ref_dir / REGION_FILENAME) as region, \
            Image.open(result_path) as result:
        return _png(paste_back(src.convert("RGB"), result.convert("RGB"), box, region.convert("L"), keep_texture))

"""细节修复（整图直出）：把用户直接摆到目标位置的图案/细节图交给模型在完整原图上融合为实拍效果。

没有图案、只有涂抹时是“局部重绘”：按用户的文字只改标红区域，其余画面保持不变。

图案流程（无需强制涂抹、不做局部裁剪与像素拼接）：
1. 按前端传来的叠层参数（裁切、位置、大小、旋转）处理 1~4 张图案素材；
2. 对带纯色/纯布底的图案做 Lab 边缘连通域自动去底（保留图案内部同色文字与已有透明通道）；
3. 在完整原图上先用内容感知修补擦净原位置旧标（自动完整包住相交的旧墨迹，避免边界压字拖出灰斑），
   再叠上去底后的透明新图案，得到完整引导图；
4. 把完整原图（图1）、完整引导图（图2）以及各裁切后的图案高清原图（图3 起）发给 gpt-image-2.6 (1K)，
   模型直接输出完整结果图，彻底避免局部拼接断层、色差与光晕。

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

# 一次修复最多叠几个图案（参考图 = 完整原图 + 完整引导图 + 每个图案）
MAX_PATTERNS = 4
# 单张输入图与摆放中间图的安全预算，防止异常放大或恶意参数耗尽内存
MAX_IMAGE_SIDE = 12000
MAX_IMAGE_PIXELS = 40_000_000
MAX_PLACEMENT_SIDE = 12000
MAX_PLACEMENT_PIXELS = 40_000_000
MAX_PLACEMENT_SCALE_RATIO = 4
# 额外说明（含可选的快捷编辑标记坐标）最大长度
MAX_EXTRA_PROMPT_LEN = 2000

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
        if (
            placement.width > MAX_PLACEMENT_SIDE
            or placement.height > MAX_PLACEMENT_SIDE
            or placement.width * placement.height > MAX_PLACEMENT_PIXELS
        ):
            raise ValueError("图案摆放尺寸超出允许范围")
        return placement


def num_in(data: dict[str, Any], key: str) -> float:
    value = float(data.get(key, 0) or 0)
    if not math.isfinite(value):
        raise ValueError(f"裁切参数 {key} 无效")
    return value


@dataclass
class RepairPlan:
    size: str  # 生图比例（按完整原图宽高比匹配），如 "3:4"
    work_image: bytes  # 图1：完整原图（PNG）
    reference_image: bytes | None  # 局部重绘：标红了涂抹区域的完整图（图2，PNG）；图案流程不用
    has_pattern: bool = True
    guide_image: bytes | None = None  # 图2（仅图案流程）：擦除旧标后叠上去底新图案的完整图（PNG）
    pattern_images: list[bytes] = field(default_factory=list)  # 图3 起（仅图案流程）：每个图案裁切后的高清素材（PNG）


def open_image(data: bytes) -> Image.Image:
    with Image.open(io.BytesIO(data)) as src:
        w, h = src.size
        if w < 1 or h < 1:
            raise ValueError("图片尺寸无效")
        if w > MAX_IMAGE_SIDE or h > MAX_IMAGE_SIDE or w * h > MAX_IMAGE_PIXELS:
            raise ValueError("图片尺寸过大，请缩小后重试")
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


def remove_pattern_bg(pattern: Image.Image) -> tuple[Image.Image, bool]:
    """自动去除图案素材外围的纯色/纯布料背景，返回 (RGBA图, 是否去除了背景)。

    仅从四条外边界做连通域泛洪，因此图案内部与底色相同的区域（例如白底漫画里的白色文字）会被完整保留；
    若素材本身已有透明边框，或边框颜色不均匀（整幅满铺图），则原样返回。
    """
    rgba = pattern.convert("RGBA")
    arr = np.asarray(rgba)
    h, w = arr.shape[:2]
    if h < 4 or w < 4:
        return rgba, False

    alpha = arr[:, :, 3]
    border_alpha = np.concatenate([alpha[0, :], alpha[-1, :], alpha[:, 0], alpha[:, -1]])
    if float((border_alpha < 240).mean()) > 0.15:
        return rgba, False

    rgb = arr[:, :, :3]
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    border_pixels = np.concatenate([
        lab[0, :, :], lab[-1, :, :], lab[:, 0, :], lab[:, -1, :],
    ], axis=0)
    bg_med = np.median(border_pixels, axis=0)
    border_dist = np.linalg.norm(border_pixels - bg_med, axis=1)
    if float(np.percentile(border_dist, 80)) > 22.0:
        return rgba, False

    dist = np.linalg.norm(lab - bg_med[None, None, :], axis=2)
    thresh = max(12.0, min(28.0, float(np.percentile(border_dist, 95)) * 1.6 + 6.0))
    bg_cand = (dist <= thresh).astype(np.uint8)

    _, labels = cv2.connectedComponents(bg_cand, connectivity=4)
    border_labels = set(np.unique(np.concatenate([
        labels[0, :], labels[-1, :], labels[:, 0], labels[:, -1],
    ])))
    border_labels.discard(0)
    if not border_labels:
        return rgba, False

    ext_bg = np.isin(labels, list(border_labels))
    bg_ratio = float(ext_bg.mean())
    if bg_ratio < 0.08 or bg_ratio > 0.99:
        return rgba, False

    fg_hard = (~ext_bg).astype(np.uint8) * 255
    fg_soft = cv2.GaussianBlur(fg_hard.astype(np.float32), (3, 3), 0.7)
    fg_soft = np.where(ext_bg, np.minimum(fg_soft, 120.0), np.maximum(fg_soft, 180.0))
    fg_dil = cv2.dilate(fg_hard, np.ones((3, 3), np.uint8))
    fg_soft = np.where(fg_dil > 0, fg_soft, 0.0)

    out = arr.copy()
    out[:, :, 3] = np.clip(fg_soft, 0, 255).astype(np.uint8)
    return Image.fromarray(out, "RGBA"), True


def _validate_placement_budget(size: tuple[int, int], w: int, h: int, rotation: float) -> None:
    """在任何 resize / rotate 分配内存之前校验目标尺寸与旋转后包围盒预算。"""
    src_w, src_h = size
    if src_w < 1 or src_h < 1:
        raise ValueError("原图尺寸无效")
    max_side = min(MAX_PLACEMENT_SIDE, max(src_w, src_h) * MAX_PLACEMENT_SCALE_RATIO)
    max_pixels = min(MAX_PLACEMENT_PIXELS, max(src_w * src_h * 4, 4_000_000))
    if w > max_side or h > max_side or w * h > max_pixels:
        raise ValueError("图案摆放尺寸超出允许范围")
    rad = math.radians(rotation)
    cos_a = abs(math.cos(rad))
    sin_a = abs(math.sin(rad))
    rot_w = math.ceil(w * cos_a + h * sin_a)
    rot_h = math.ceil(w * sin_a + h * cos_a)
    if (
        rot_w > min(MAX_PLACEMENT_SIDE, max_side * 2)
        or rot_h > min(MAX_PLACEMENT_SIDE, max_side * 2)
        or rot_w * rot_h > min(MAX_PLACEMENT_PIXELS, max_pixels * 2)
    ):
        raise ValueError("图案旋转后尺寸超出允许范围")


def render_pattern_layer(size: tuple[int, int], pattern: Image.Image, placement: Placement) -> Image.Image:
    """把（已裁切的）图案按摆放参数画到一张原图尺寸的透明图层上。"""
    w = max(1, round(placement.width))
    h = max(1, round(placement.height))
    _validate_placement_budget(size, w, h, placement.rotation)
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


def _read_brush(brush_mask_bytes: bytes | None, size: tuple[int, int]) -> Image.Image:
    brush = Image.new("L", size, 0)
    if brush_mask_bytes:
        raw = open_image(brush_mask_bytes)
        raw = raw.getchannel("A") if raw.mode in ("RGBA", "LA") else raw.convert("L")
        if raw.size != size:
            raw = raw.resize(size, Image.NEAREST)
        brush = raw.point(lambda v: 255 if v >= 128 else 0)
    return brush


def _mark_region(image: Image.Image, mask: Image.Image) -> Image.Image:
    """在原图上用半透明红色盖住涂抹区域，并描一圈红边，告诉模型改哪里。"""
    marked = image.convert("RGB")
    red = Image.new("RGB", marked.size, (255, 40, 40))
    marked = Image.composite(Image.blend(marked, red, 0.45), marked, mask)
    width = max(2, round(max(marked.size) * 0.004))
    edge = ImageChops.subtract(
        mask.filter(ImageFilter.MaxFilter(width * 2 + 1)), mask,
    )
    return Image.composite(red, marked, edge)


def _dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    if radius <= 0:
        return mask.astype(bool)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1))
    return cv2.dilate(mask.astype(np.uint8), kernel).astype(bool)


def _sharp_ink_mask(rgb_f32: np.ndarray) -> np.ndarray:
    """检测图像中清晰的高频图案/文字墨迹（忽略大尺度布料明暗与褶皱）。"""
    gray = cv2.cvtColor(np.clip(rgb_f32, 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    edge = np.hypot(gx, gy) / 4.0
    small_bg = cv2.GaussianBlur(rgb_f32, (0, 0), 1.8)
    hf = np.abs(rgb_f32 - small_bg).max(axis=2)
    return (edge >= 12.0) | (hf >= 18.0)


def _expand_to_cover_touching_ink(
    image: Image.Image,
    seed_mask: np.ndarray,
    limit_mask: np.ndarray,
) -> np.ndarray:
    """把与 seed_mask 相交的旧图案墨迹连通块完整包进来，避免 inpaint 边界压在旧文字上拖出灰斑。"""
    if not seed_mask.any():
        return seed_mask
    rgb = np.asarray(image.convert("RGB"), np.float32)
    ink = _dilate(_sharp_ink_mask(rgb), 3) & limit_mask
    if not ink.any():
        return seed_mask
    _, labels = cv2.connectedComponents(ink.astype(np.uint8), connectivity=8)
    touching = set(np.unique(labels[seed_mask]))
    touching.discard(0)
    if not touching:
        return seed_mask
    eroded_limit = cv2.erode(limit_mask.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    border_ring = limit_mask & (~eroded_limit)
    border_labels = set(np.unique(labels[border_ring]))
    keep = touching - border_labels
    if not keep:
        return seed_mask
    kept_u8 = np.isin(labels, list(keep)).astype(np.uint8)
    # 填充闭合轮廓内部，确保较粗的实心旧标/旧文字不会留下中空残影
    cnts, _ = cv2.findContours(kept_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if cnts:
        cv2.drawContours(kept_u8, cnts, -1, 1, thickness=cv2.FILLED)
    return seed_mask | _dilate(kept_u8 > 0, 2)


def _inpaint_image(image: Image.Image, mask_bool: np.ndarray) -> Image.Image:
    """用内容感知修补擦除引导图里的旧图案/涂抹区，不留灰斑。"""
    if not mask_bool.any():
        return image
    rgb = np.asarray(image.convert("RGB"), np.uint8)
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    mask_u8 = mask_bool.astype(np.uint8) * 255
    radius = max(3, min(12, round(max(image.size) * 0.01)))
    repaired_bgr = cv2.inpaint(bgr, mask_u8, radius, cv2.INPAINT_TELEA)
    return Image.fromarray(cv2.cvtColor(repaired_bgr, cv2.COLOR_BGR2RGB), "RGB")


def build_plan(
    source_bytes: bytes,
    patterns: list[tuple[bytes, Placement]],
    brush_mask_bytes: bytes | None,
) -> RepairPlan:
    """patterns：(图案图片, 摆放参数) 列表；为空时是纯涂抹局部重绘。"""
    source = open_image(source_bytes).convert("RGB")
    brush = _read_brush(brush_mask_bytes, source.size)
    if len(patterns) > MAX_PATTERNS:
        raise ValueError(f"一次最多叠加 {MAX_PATTERNS} 个图案")

    size, _ = nearest_ratio(source.width, source.height)

    if not patterns:
        if not _mask_bbox(brush):
            raise ValueError("请先在原图上涂抹要修改的区域，或拖入图案")
        return RepairPlan(
            size=size,
            work_image=_png(source),
            reference_image=_png(_mark_region(source, brush)),
            has_pattern=False,
        )

    cropped = [crop_pattern(open_image(data), placement.crop) for data, placement in patterns]
    cleaned = [remove_pattern_bg(pat)[0] for pat in cropped]

    raw_layers = [
        render_pattern_layer(source.size, pat, placement)
        for pat, (_data, placement) in zip(cropped, patterns)
    ]
    clean_layers = [
        render_pattern_layer(source.size, pat, placement)
        for pat, (_data, placement) in zip(cleaned, patterns)
    ]

    region = brush
    search = brush
    for layer in clean_layers:
        region = ImageChops.lighter(region, layer.getchannel("A").point(lambda v: 255 if v >= 24 else 0))
    for layer in raw_layers:
        search = ImageChops.lighter(search, layer.getchannel("A").point(lambda v: 255 if v >= 8 else 0))

    if not (_mask_bbox(region) or _mask_bbox(search)):
        raise ValueError("图案不在原图范围内，请把图案拖到原图上")

    # 完整引导图（图2）：先擦除旧标（无灰斑），再叠上去底后的透明新图案
    brush_arr = np.asarray(brush, np.uint8) > 127
    fg_arr = np.asarray(region, np.uint8) > 127
    search_arr = np.asarray(search, np.uint8) > 127
    erase_pad = max(3, min(14, round(max(source.size) * 0.012)))
    erase_seed = brush_arr | _dilate(fg_arr, erase_pad)
    erase_mask = _expand_to_cover_touching_ink(source, erase_seed, search_arr)
    guide = _inpaint_image(source, erase_mask).convert("RGBA")
    for layer in clean_layers:  # 后放上来的图案盖在前面的上面，与前端显示一致
        guide.alpha_composite(layer)

    return RepairPlan(
        size=size,
        work_image=_png(source),
        reference_image=None,
        has_pattern=True,
        guide_image=_png(guide.convert("RGB")),
        pattern_images=[_png(p) for p in cropped],
    )


def build_inpaint_prompt(instruction: str) -> str:
    return "\n".join([
        "任务：电商图片局部修改，只改指定区域。",
        "",
        "图片说明：",
        "- 图1：完整原图。",
        "- 图2：同一张完整图，用半透明红色和红色描边标出了要修改的区域。",
        "",
        "要求：",
        "- 以图1为底图输出完全相同构图的完整照片，不要出现红色标记。",
        f"- 只修改图2红色标出的区域：{instruction.strip()[:MAX_EXTRA_PROMPT_LEN]}",
        "- 修改后的内容与周围的光照、阴影、透视和材质纹理自然衔接。",
        "- 红色区域以外的人物、背景、商品其余部分与画面文案保持完全不变。",
    ])


def build_prompt(extra_prompt: str = "", pattern_count: int = 1) -> str:
    if pattern_count > 1:
        return _build_multi_prompt(extra_prompt, pattern_count)
    lines = [
        "任务：电商商品细节修复（商品可能是服装、包、鞋、帽子等），把图2中放在目标位置的新图案融合为真实印制/刺绣在商品表面的实拍效果。",
        "",
        "图片说明：",
        "- 图1：完整原图。",
        "- 图2：同一张完整图，已擦除原位置旧图案并按目标位置、大小和角度叠好了去底的新图案。",
        "- 图3：新图案素材，用来严格对照图案的形状、配色、工艺质感和文字细节。",
        "",
        "要求：",
        "- 以图1为底图输出完全相同构图的完整图片。",
        "- 保持原图的光影透视还有褶皱，仅作图案修改。",
        "- 清除图1目标位置原有的旧图案/旧logo，将图3的新图案按图2的位置、大小和角度真实做在商品表面上，不要移动、缩放或重新设计。",
        "- 忠实还原图3的形状、配色与文字细节（文字清晰可读、不缺字不变形），同时自然跟随图1表面的曲面、褶皱和明暗阴影起伏。",
        "- 若图3带有底色背景，只取图案本身，不要把底色方块做到商品上。",
        "- 除该图案所在区域外，图1中的人物面部、姿态、发型、帽子、背景、商品其余部分以及画面中的所有文案排版必须保持完全不变。",
    ]
    return _with_extra(lines, extra_prompt)


def _build_multi_prompt(extra_prompt: str, count: int) -> str:
    last = count + 2
    lines = [
        "任务：电商商品细节修复（商品可能是服装、包、鞋、帽子等），把图2中放在目标位置的多个新图案融合为真实印制/刺绣在商品表面的实拍效果。",
        "",
        "图片说明：",
        "- 图1：完整原图。",
        f"- 图2：同一张完整图，已擦除原位置旧图案并把 {count} 个去底的新图案分别叠在各自目标位置上。",
        f"- 图3到图{last}：这 {count} 个新图案各自的高清素材，用来严格对照形状、配色、工艺质感和文字细节。",
        "",
        "要求：",
        "- 以图1为底图输出完全相同构图的完整图片。",
        "- 保持原图的光影透视还有褶皱，仅作图案修改。",
        f"- 清除图1对应位置原有的旧图案/旧logo，每个新图案的位置、大小和角度都与图2一致，样式、配色与文字细节严格参照图3到图{last}中对应的素材。",
        "- 每个图案都自然跟随所在表面的曲面、褶皱和明暗阴影起伏，呈现真实的印花/刺绣/压印质感。",
        "- 若素材带有底色背景，只取图案本身，不要把底色方块做到商品上。",
        "- 除目标图案区域外，图1中的人物面部、姿态、发型、帽子、背景、商品其余部分以及画面中的所有文案排版必须保持完全不变。",
    ]
    return _with_extra(lines, extra_prompt)


def _with_extra(lines: list[str], extra_prompt: str) -> str:
    extra = (extra_prompt or "").strip()
    if extra:
        lines += ["", f"补充说明：{extra[:MAX_EXTRA_PROMPT_LEN]}"]
    return "\n".join(lines)


def _png(image: Image.Image) -> bytes:
    out = io.BytesIO()
    image.save(out, format="PNG", optimize=True)
    return out.getvalue()

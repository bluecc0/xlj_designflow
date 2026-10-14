"""
AI 换装（Outfit Change）

画布右键「AI 换装」的后端能力：
- 按 SKU 列出素材库中的多角度素材图（主图 + 角度变体 + SKU 子文件夹）
- 安全读取素材库单个文件、生成缩略图（避免把高清原图塞给弹窗网格）
- 根据用户选择的部位与素材拼装内置换装 prompt

素材库目录约定（全部可选，按顺序探测；只做路径拼接 + exists()，
不对大目录 iterdir()，见 CLAUDE.md "Product image matching is path-based"）：

    <库>/<类型文件夹>/<SKU>.png              主图
    <库>/<类型文件夹>/<SKU>_2.png            角度变体（后缀模式可配置，见 PRODUCT_ANGLE_PATTERNS）
    <库>/<类型文件夹>/<SKU>/*.png            SKU 专属子文件夹（小目录，允许列出）
"""
from __future__ import annotations

import hashlib
import io
import logging
import re
import threading
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Optional

from .config import settings
from .product_library import EXT_PRIORITY, SUPPORTED_EXTS

logger = logging.getLogger(__name__)


# ─── 素材类型 ────────────────────────────────────────────────────────────────

ASSET_TYPE_LABELS: dict[str, str] = {
    "white": "白底图",
    "png": "透明图",
    "white2x": "一双鞋角度",
    "shadow": "阴影图",
    "model": "模特图",
}

# 文件名关键词 → 角度标签（仅用于展示与 prompt 描述，不影响匹配）
_ANGLE_KEYWORDS: list[tuple[tuple[str, ...], str]] = [
    (("front", "正面", "正"), "正面"),
    (("back", "背面", "背"), "背面"),
    (("left", "左"), "左侧"),
    (("right", "右"), "右侧"),
    (("side", "侧面", "侧"), "侧面"),
    (("top", "俯视", "顶"), "俯视"),
    (("bottom", "sole", "底"), "底部"),
    (("detail", "细节", "特写"), "细节"),
    (("45",), "45°"),
]

# 服饰部位显示名称
GARMENT_SLOTS: dict[str, str] = {
    "hat": "帽子/头饰",
    "glasses": "眼镜",
    "top": "上衣",
    "outerwear": "外套",
    "dress": "连衣裙/连体衣",
    "bottom": "裤装/半裙",
    "socks": "袜子",
    "shoes": "鞋",
    "bag": "包",
    "accessory": "配饰",
    "other": "其他",
}

# 预设常用换装部位及其标准指令定义（规范电商换装术语，杜绝敏感词）
PRESET_SLOTS: dict[str, dict[str, Any]] = {
    "top": {
        "key": "top",
        "label": "上衣",
        "region": "上身躯干部位",
        "replace_directive": "将图1人物的上身衣物替换为参考图中的上衣商品，领口、袖子与下摆自然贴合模特身体姿态与轮廓。",
        "keep_directive": "上身衣物保持图1原样不变，不得改变其颜色、款式与版型。",
    },
    "bottom": {
        "key": "bottom",
        "label": "裤子/下装",
        "region": "下身腿部区域",
        "replace_directive": "将图1人物的下装（裤子/裙子）替换为参考图中的下装商品，腰部贴合与裤腿垂坠符合人体站姿。",
        "keep_directive": "下装裤子/裙子保持图1原样不变，原有版型、垂坠与色彩均不改变。",
    },
    "shoes": {
        "key": "shoes",
        "label": "鞋子",
        "region": "脚部区域",
        "replace_directive": "将图1人物脚上的鞋履替换为参考图中的鞋子，透视角度、鞋型与地面阴影自然贴合脚型与站立地面。",
        "keep_directive": "脚部鞋履保持图1原样不变，不得改变鞋型或颜色。",
    },
    "hat": {
        "key": "hat",
        "label": "帽子/头饰",
        "region": "头部发顶区域",
        "replace_directive": "替换或佩戴参考图中的帽子/头饰商品，帽檐角度与发型头型自然贴合，严禁遮挡或修改脸部五官特征。",
        "keep_directive": "头部与发型保持图1原样，不得擅自添加或更改帽子。",
    },
    "outerwear": {
        "key": "outerwear",
        "label": "外套",
        "region": "外层服装区域",
        "replace_directive": "将图1人物的外层外套替换为参考图中的外套商品（或在内搭外层自然穿上该外套），版型轮廓与门襟细节严格参照参考图。",
        "keep_directive": "外套保持图1原样不变（若原图无外套则不额外添加）。",
    },
    "socks": {
        "key": "socks",
        "label": "袜子",
        "region": "脚踝与小腿区域",
        "replace_directive": "将图1人物的袜子替换为参考图中的袜子商品，袜口高度、罗纹与图案细节严格参照参考图，与鞋口自然衔接。",
        "keep_directive": "袜子保持图1原样不变。",
    },
    "dress": {
        "key": "dress",
        "label": "连衣裙/连体衣",
        "region": "全身裙装区域",
        "replace_directive": "将图1人物身上的服装替换为参考图中的连衣裙商品，裙摆垂坠褶皱与腰线比例自然真实。",
        "keep_directive": "全身裙装保持图1原样不变。",
    },
    "bag": {
        "key": "bag",
        "label": "包袋",
        "region": "配包区域",
        "replace_directive": "将图1中的包袋替换为参考图中的包袋商品，背带贴合身体曲线，包身立体轮廓真实呈现。",
        "keep_directive": "包袋保持图1原样不变。",
    },
    "accessory": {
        "key": "accessory",
        "label": "配饰/眼镜",
        "region": "饰品区域",
        "replace_directive": "将图1中的对应饰品替换为参考图中的配饰商品，细节精致且与整体服饰协调。",
        "keep_directive": "原有饰品与配件保持原样不变。",
    },
}

MAX_REFERENCE_IMAGES = 9  # 上游生图接口上限（含原图）
MAX_GARMENT_REFERENCES = MAX_REFERENCE_IMAGES - 1


def _angle_patterns() -> list[str]:
    raw = getattr(settings, "product_angle_patterns", "") or ""
    patterns = [p for p in raw.split("|") if "{n}" in p]
    return patterns or ["_{n}", "-{n}"]


def _outfit_asset_types() -> list[str]:
    raw = getattr(settings, "outfit_asset_types", "") or ""
    keys = [k.strip() for k in raw.split(",") if k.strip()]
    return [k for k in keys if k in settings.IMAGE_TYPE_FOLDERS] or list(ASSET_TYPE_LABELS)


def angle_label_from_name(stem: str, sku: str) -> str:
    """从文件名推断角度标签：SKU → 主图；SKU_3 → 角度 3；含 front/背面 等关键词时用关键词。"""
    rest = stem
    if stem.casefold().startswith(sku.casefold()):
        rest = stem[len(sku):]
    rest = rest.strip(" _-()（）")
    if not rest:
        return "主图"
    lowered = rest.casefold()
    for keywords, label in _ANGLE_KEYWORDS:
        if any(k in lowered for k in keywords):
            return label
    digits = re.findall(r"\d+", rest)
    if digits:
        return f"角度 {int(digits[-1])}"
    return rest[:12]


def _probe(path_without_ext: Path) -> Optional[Path]:
    for ext in EXT_PRIORITY:
        candidate = path_without_ext.with_name(path_without_ext.name + ext)
        if candidate.exists():
            return candidate
    return None


def _list_type_folder(sku: str, asset_type: str) -> list[dict[str, Any]]:
    """在单个类型文件夹中查找该 SKU 的全部角度图（只用路径构造 + exists()）。"""
    folder_name = settings.IMAGE_TYPE_FOLDERS.get(asset_type)
    if not folder_name:
        return []
    folder = settings.product_library_path / folder_name
    if not folder.exists():
        return []

    found: list[Path] = []
    seen: set[str] = set()

    def add(p: Optional[Path]) -> None:
        if p is None:
            return
        key = str(p).casefold()
        if key not in seen:
            seen.add(key)
            found.append(p)

    name_variants = list(dict.fromkeys([sku, sku.upper(), sku.lower()]))

    # 1. 主图
    for variant in name_variants:
        hit = _probe(folder / variant)
        if hit:
            add(hit)
            break

    # 2. 角度后缀变体：遇到连续 2 个缺号即停止，避免对网络盘做大量无效探测
    max_n = max(1, int(getattr(settings, "product_angle_max", 12) or 12))
    base_name = Path(found[0]).stem if found else sku
    for pattern in _angle_patterns():
        misses = 0
        for n in range(1, max_n + 1):
            hit = _probe(folder / (base_name + pattern.replace("{n}", str(n))))
            if hit:
                add(hit)
                misses = 0
            else:
                misses += 1
                if misses >= 2:
                    break

    # 3. SKU 专属子文件夹（目录小，允许列出）
    for variant in name_variants:
        sub = folder / variant
        if sub.is_dir():
            try:
                for entry in sorted(sub.iterdir(), key=lambda p: p.name.casefold()):
                    if entry.is_file() and entry.suffix.lower() in SUPPORTED_EXTS:
                        add(entry)
            except OSError:
                logger.warning("outfit: failed to list %s", sub)
            break

    items: list[dict[str, Any]] = []
    for path in found:
        rel = path.relative_to(folder).as_posix()
        items.append({
            "id": f"{asset_type}:{rel}",
            "asset_type": asset_type,
            "type_label": ASSET_TYPE_LABELS.get(asset_type, asset_type),
            "folder": folder_name,
            "path": rel,
            "filename": path.name,
            "angle": angle_label_from_name(path.stem, sku),
        })
    return items


_ASSET_CACHE: "OrderedDict[str, tuple[float, list[dict[str, Any]]]]" = OrderedDict()
_ASSET_CACHE_LOCK = threading.Lock()
_ASSET_CACHE_TTL = 120.0
_ASSET_CACHE_MAX = 256
_PROBE_POOL = ThreadPoolExecutor(max_workers=6, thread_name_prefix="outfit-probe")


def list_sku_assets(sku: str) -> list[dict[str, Any]]:
    """列出单个 SKU 在各素材类型下的全部角度图（结果短时缓存）。"""
    clean = (sku or "").strip()
    if not clean or "/" in clean or "\\" in clean or ".." in clean:
        return []
    cache_key = clean.casefold()
    now = time.time()
    with _ASSET_CACHE_LOCK:
        cached = _ASSET_CACHE.get(cache_key)
        if cached and now - cached[0] < _ASSET_CACHE_TTL:
            return cached[1]

    types = _outfit_asset_types()
    # 每个类型文件夹的探测互不依赖，并行执行以降低 UNC 路径下的总延迟
    results = list(_PROBE_POOL.map(lambda t: _list_type_folder(clean, t), types))
    items = [item for group in results for item in group]
    for item in items:
        item["sku"] = clean

    with _ASSET_CACHE_LOCK:
        _ASSET_CACHE[cache_key] = (now, items)
        _ASSET_CACHE.move_to_end(cache_key)
        while len(_ASSET_CACHE) > _ASSET_CACHE_MAX:
            _ASSET_CACHE.popitem(last=False)
    return items


def resolve_library_asset(asset_type: str, rel_path: str) -> Path:
    """把 (类型, 相对路径) 解析为素材库内的真实文件；拒绝任何越界路径。"""
    folder_name = settings.IMAGE_TYPE_FOLDERS.get((asset_type or "").strip())
    if not folder_name:
        raise ValueError("未知素材类型")
    rel = (rel_path or "").strip().replace("\\", "/")
    parts = [p for p in rel.split("/") if p]
    # 只允许 <文件> 或 <SKU 子文件夹>/<文件> 两层
    if not parts or len(parts) > 2 or any(p in (".", "..") for p in parts) or ":" in rel:
        raise ValueError("非法素材路径")
    folder = (settings.product_library_path / folder_name).resolve()
    candidate = (folder / Path(*parts)).resolve()
    if folder not in candidate.parents:
        raise ValueError("非法素材路径")
    if candidate.suffix.lower() not in SUPPORTED_EXTS:
        raise ValueError("不支持的素材格式")
    if not candidate.is_file():
        raise FileNotFoundError("素材图不存在")
    return candidate


def library_thumbnail(path: Path, max_side: int = 360) -> Path:
    """生成并缓存素材缩略图（webp），按 路径+mtime+尺寸 作为缓存键。"""
    from PIL import Image

    stat = path.stat()
    digest = hashlib.sha1(f"{path}|{stat.st_mtime_ns}|{stat.st_size}|{max_side}".encode("utf-8")).hexdigest()
    cache_dir = settings.output_path / "cache" / "library-thumbs" / digest[:2]
    cache_dir.mkdir(parents=True, exist_ok=True)
    target = cache_dir / f"{digest}.webp"
    if target.exists():
        return target
    with Image.open(path) as img:
        img.load()
        has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
        img = img.convert("RGBA" if has_alpha else "RGB")
        img.thumbnail((max_side, max_side), Image.LANCZOS)
        tmp = target.with_suffix(".tmp")
        img.save(tmp, format="WEBP", quality=82, method=4)
        tmp.replace(target)
    return target


# ─── 图片预处理 ──────────────────────────────────────────────────────────────

def prepare_reference_image(
    image_bytes: bytes,
    name: str,
    *,
    max_side: int = 2048,
    max_bytes: int = 4_800_000,
) -> tuple[bytes, str, int, int]:
    """把参考图规整为上游可接受的尺寸/体积；返回 (bytes, 文件名, 原始宽, 原始高)。

    - 透明图保留 alpha 输出 PNG（服饰抠图的边缘信息有价值），否则输出 JPEG。
    - 只缩小不放大；体积仍超限时逐级降低长边。
    """
    from PIL import Image, ImageOps

    with Image.open(io.BytesIO(image_bytes)) as src:
        src.load()
        src = ImageOps.exif_transpose(src)
        orig_w, orig_h = src.size
        has_alpha = src.mode in ("RGBA", "LA") or (src.mode == "P" and "transparency" in src.info)
        img = src.convert("RGBA" if has_alpha else "RGB")

    stem = Path(name or "image").stem or "image"
    side = max_side
    while True:
        work = img.copy()
        if max(work.size) > side:
            work.thumbnail((side, side), Image.LANCZOS)
        out = io.BytesIO()
        if has_alpha:
            work.save(out, format="PNG", optimize=True)
            filename = f"{stem}.png"
        else:
            work.save(out, format="JPEG", quality=92, optimize=True)
            filename = f"{stem}.jpg"
        data = out.getvalue()
        if len(data) <= max_bytes or side <= 768:
            return data, filename, orig_w, orig_h
        side = int(side * 0.8)


_SUPPORTED_RATIOS: list[tuple[str, float]] = [
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


def nearest_aspect_ratio(width: int, height: int) -> str:
    """原图宽高 → 最接近的生图比例，保证换装结果与原图构图一致。"""
    if width <= 0 or height <= 0:
        return "auto"
    ratio = width / height
    return min(_SUPPORTED_RATIOS, key=lambda item: abs(item[1] - ratio))[0]


# ─── 内置换装 prompt ─────────────────────────────────────────────────────────

def build_outfit_prompt(
    *,
    references: list[dict[str, Any]],
    target_slots: Optional[list[str]] = None,
    extra_prompt: str = "",
) -> str:
    """拼装内置换装 prompt。

    references 顺序即上传顺序：图1 为原图，references[i] 对应图 i+2。
    每个 reference: {sku, type_label, angle, source: library|upload, slot?: str}
    """
    active_slots = list(dict.fromkeys(
        str(s).strip().lower() for s in (target_slots or []) if str(s).strip()
    ))

    # 按 SKU 和 部位 分组，同一 SKU 的多张图是同一件商品的不同角度
    groups: "OrderedDict[str, list[int]]" = OrderedDict()
    slot_to_indices: dict[str, list[int]] = {}
    for idx, ref in enumerate(references):
        ref_slot = str(ref.get("slot") or "").strip().lower()
        if ref_slot:
            slot_to_indices.setdefault(ref_slot, []).append(idx + 2)
        key = ref.get("sku") or f"上传素材{idx + 1}"
        groups.setdefault(key, []).append(idx + 2)

    def image_refs(indices: list[int]) -> str:
        return "、".join(f"图{i}" for i in indices)

    lines: list[str] = []
    is_person = bool(active_slots)
    if is_person:
        lines.append("任务：电商虚拟换装（virtual try-on）。以图1为底图，把参考图中的服饰穿到图1的人物身上，输出一张换装后的完整照片。")
    else:
        lines.append("任务：电商商品替换。以图1为底图，把图1中的对应商品替换为参考图中的商品，输出一张替换后的完整商品图。")

    lines.append("")
    lines.append("图片说明：")
    lines.append("- 图1：原图（底图）。")
    for sku, indices in groups.items():
        meta = [references[i - 2] for i in indices]
        ref_slot = next((m.get("slot") for m in meta if m.get("slot")), "")
        slot_tag = f"【{PRESET_SLOTS.get(ref_slot, {}).get('label') or GARMENT_SLOTS.get(ref_slot, ref_slot)}】" if ref_slot else ""
        angle_desc = "、".join(
            f"图{i}={m.get('angle') or '素材'}{('/' + m['type_label']) if m.get('type_label') else ''}"
            for i, m in zip(indices, meta)
        )
        if len(indices) > 1:
            lines.append(f"- {image_refs(indices)}：{slot_tag}同一件商品（货号 {sku}）的不同角度素材（{angle_desc}），请综合多个角度理解它的完整外观。")
        else:
            lines.append(f"- {image_refs(indices)}：{slot_tag}商品（货号 {sku}）素材（{angle_desc}）。")
    if len(groups) > 1:
        lines.append("- 不同货号是不同的商品，需要分别穿戴/替换到各自对应的部位，不要把它们融合成一件。")

    lines.append("")
    lines.append("替换要求：")
    if active_slots:
        slot_lines: list[str] = []
        for slot in active_slots:
            slot_meta = PRESET_SLOTS.get(slot, {})
            slot_label = slot_meta.get("label") or GARMENT_SLOTS.get(slot, slot)
            region = slot_meta.get("region", "")
            region_str = f"（{region}）" if region else ""
            img_indices = slot_to_indices.get(slot) or []
            target_img_desc = f"{image_refs(img_indices)}展示的" if img_indices else "参考图中对应的"

            base_directive = slot_meta.get("replace_directive") or f"将图1人物该部位的服饰替换为{target_img_desc}{slot_label}商品。"
            if img_indices and "参考图中的" in base_directive:
                directive = base_directive.replace("参考图中的", f"{target_img_desc}")
            else:
                directive = base_directive

            slot_lines.append(f"  * 【{slot_label}】{region_str}：{directive}")
        lines.append("- 只替换图1中的以下指定部位：\n" + "\n".join(slot_lines))
    else:
        lines.append("- 自动识别参考图商品的品类（如帽子、上衣、裤子、鞋），只替换图1中相同品类、相同部位的服饰。")

    lines.append("- 商品外观必须与参考图严格一致：颜色与色号、图案与印花、logo 与文字、材质质感、版型廓形、长度比例、领口袖口、纽扣拉链、缝线等细节都不能改动或臆造。")
    lines.append("- 参考图中的背景、阴影、衣架、模特、白底边框等都不是商品本身，忽略它们。")
    if is_person:
        lines.append("- 穿着效果自然真实：根据人物姿态和体型生成合理的褶皱、垂坠、贴合与遮挡关系，衣物边缘与身体衔接自然；参考图里看不到的面按同款合理补全。")
    else:
        lines.append("- 替换后的商品保持与原商品相同的摆放角度、大小比例和在画面中的位置，透视与投影自然。")

    lines.append("")
    lines.append("必须保持不变：")
    if is_person:
        lines.append("- 人物身份：脸部五官、表情、发型、肤色、体型与手部完全不变；姿态与取景不变。")
    if active_slots:
        unselected_core = [
            PRESET_SLOTS[s]["label"]
            for s in ("top", "bottom", "shoes", "hat", "outerwear", "dress")
            if s not in active_slots
        ]
        if unselected_core:
            lines.append(f"- 未选择替换的部位（如{'、'.join(unselected_core)}）严格保持图1原样不变，不得改变颜色、版型或款式。")
    if not active_slots:
        lines.append("- 与本次替换无关的服饰、配饰保持原样。")
    lines.append("- 背景、光线、色调、镜头视角、构图与画面比例保持与图1一致。")
    lines.append("- 不要添加任何新的文字、水印、边框或多余物品；不要输出拼图或多宫格，只输出一张图。")
    lines.append("- 画质：商业级电商摄影质感，清晰锐利，细节真实。")

    clean_extra = (extra_prompt or "").strip()
    if clean_extra:
        lines.append("")
        lines.append(f"补充要求（优先满足，但不得违背以上一致性要求）：{clean_extra[:500]}")

    return "\n".join(lines)

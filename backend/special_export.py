"""Choose special-product download formats without changing source exports."""
from __future__ import annotations

import io
from pathlib import Path

from PIL import Image


SPECIAL_EXPORT_MAX_BYTES = 1_000_000


class SpecialExportSizeError(ValueError):
    """The original dimensions cannot fit the download limit even at minimum JPEG quality."""


def prepare_special_export_image(path: Path, *, force_png: bool = False) -> tuple[str, bytes]:
    original = path.read_bytes()
    if force_png or len(original) <= SPECIAL_EXPORT_MAX_BYTES:
        return "png", original

    with Image.open(io.BytesIO(original)) as source:
        rgba = source.convert("RGBA")
    try:
        with Image.new("RGB", rgba.size, (255, 255, 255)) as rgb:
            with rgba.getchannel("A") as alpha:
                rgb.paste(rgba, mask=alpha)

            optimize = True

            def encode(quality: int) -> bytes:
                nonlocal optimize
                out = io.BytesIO()
                if optimize:
                    try:
                        rgb.save(out, format="JPEG", quality=quality, subsampling=0, optimize=True)
                    except OSError:
                        # Detailed 4:4:4 images can overflow Pillow's optimizer
                        # buffer. Huffman optimization does not affect image quality.
                        optimize = False
                        out = io.BytesIO()
                if not optimize:
                    rgb.save(out, format="JPEG", quality=quality, subsampling=0, optimize=False)
                return out.getvalue()

            highest_quality = encode(100)
            if len(highest_quality) <= SPECIAL_EXPORT_MAX_BYTES:
                return "jpg", highest_quality

            # Keep the original dimensions and 4:4:4 color sampling. Search for
            # the highest quality that fits rather than applying a fixed quality to every image.
            low, high = 1, 99
            best = None
            while low <= high:
                quality = (low + high) // 2
                candidate = encode(quality)
                if len(candidate) <= SPECIAL_EXPORT_MAX_BYTES:
                    best = candidate
                    low = quality + 1
                else:
                    high = quality - 1
            if best is None:
                raise SpecialExportSizeError("保持原尺寸时无法将 JPG 控制在 1 MB 内，请调整模板尺寸后重试")
            return "jpg", best
    finally:
        rgba.close()

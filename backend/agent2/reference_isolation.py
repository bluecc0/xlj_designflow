"""Isolate action-only references without changing their framing."""
import io
import re
import threading
from PIL import Image, ImageOps

_LOCK = threading.Lock()


def inspection_failed(text):
    return bool(re.search(r"(?:[:：]|总体|结论)[\s*]*不符合", text))


def action_only(role):
    return bool(re.search(r"动作|姿势|pose|action", role, re.I) and
                (re.search(r"(?:不取|不要|排除|不参考|不使用)[^。；;\n]{0,45}(?:背景|场景)|(?:仅|只).{0,4}(?:取|参考)?(?:动作|姿势)", role) or
                 re.search(r"(?:pose|action)[ -]?only|(?:only|exclude).{0,15}(?:pose|action|background)", role, re.I)))


def excludes_action_scene(request):
    return bool(re.search(r"(?:不要|不取|排除).{0,15}动作(?:包|参考).{0,15}(?:场景|背景)", request))


def isolate_action(data, extract=None):
    from ..matting_service import matting_service
    with _LOCK:
        with Image.open(io.BytesIO(data)) as im:
            source = ImageOps.exif_transpose(im).convert("RGB")
            source.thumbnail((1600, 1600))
            fg = (extract or matting_service.extract_foreground)(source).convert("RGBA")
        if fg.size != source.size:
            raise ValueError("Action isolation changed source framing")
        alpha = fg.getchannel("A")
        hist = alpha.histogram()
        count = source.width * source.height
        if sum(hist[128:]) < count * .03 or sum(hist[:32]) < count * .05:
            raise ValueError("Action foreground cannot be isolated reliably")
        neutral = Image.new("RGB", source.size, (235, 235, 235))
        neutral.paste(fg, (0, 0), alpha)
        out = io.BytesIO()
        neutral.save(out, format="PNG")
        return out.getvalue()

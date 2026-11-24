"""Resolve explicit image constraints without letting tool retries reset them."""
from __future__ import annotations

import re


def turn_inputs(events: list[dict], turn_id: str) -> list[dict]:
    return [event["payload"] for event in events
            if event["turn_id"] == turn_id and event["type"] in {"turn.started", "input.answered"}]


def explicit_models(text: str) -> set[str]:
    # Ignore negative examples rather than turning "不要 Nano Banana" into a selection.
    parts = re.split(r"[，。；;\n]", text)
    models: set[str] = set()
    patterns = [
        (r"nano[\s-]*banana[\s-]*(?:pro?(?![a-z]))?|香蕉(?:\s*pro)?", "nano-banana-pro"),
        (r"nano[\s-]*banana[\s-]*2\.1(?![0-9.])", "nano-banana-2.1"),
        (r"gpt[\s-]*image[\s-]*2\.6(?![0-9.])", "gpt-image-2.6"),
        (r"gpt[\s-]*image[\s-]*2\.5(?![0-9.])", "gpt-image-2.5"),
        (r"gpt[\s-]*image[\s-]*2(?:\.0)?(?![0-9.])", "gpt-image-2"),
        (r"seedream(?:[\s-]*5\.5)?(?![a-z0-9])|即梦", "seedream-5-5"),
    ]
    for part in parts:
        if re.search(r"不要|不用|别用|不使用|不选|不支持|instead of|do not|don't", part, re.I):
            continue
        for pattern, model in patterns:
            if re.search(pattern, part, re.I):
                models.add(model)
        if "nano-banana-2.1" in models and re.search(patterns[1][0], part, re.I):
            # The generic Banana alias must not shadow its numbered variant.
            if not re.search(r"banana[\s-]*pro?(?![a-z])", part, re.I):
                models.discard("nano-banana-pro")
    return models


def numbered_references(text: str, uploads: list[dict]) -> set[str]:
    numbers = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
               "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}
    result: set[str] = set()
    for match in re.finditer(r"(?:参考图|图片|图|@)\s*([1-9][0-9]*|[一二三四五六七八九十])(?![0-9])", text):
        value = match.group(1)
        index = (int(value) if value.isdigit() else numbers[value]) - 1
        if index < len(uploads):
            result.add(uploads[index]["id"])
    return result


def reference_order_error(inputs: list[dict], ids: list[str], prompt: str) -> bool:
    """Do not silently reorder files after a numbered prompt has been written."""
    if not re.search(r"(?:@\s*(?:图片|图)?|参考图|图片|图|reference\s*(?:image\s*)?)\s*[1-9]", prompt, re.I):
        return False
    uploads = [u["id"] for p in inputs for u in p.get("uploads", []) if u.get("kind") != "table"]
    uploads = list(dict.fromkeys(uploads))
    if not uploads:
        return False
    expected = [rid for rid in uploads if rid in ids]
    expected += [rid for rid in ids if rid not in uploads]
    return ids != expected


def bind_upload_numbers(prompt: str, ids: list[str], inputs: list[dict]) -> str:
    """Replace user upload aliases with their actual per-image send positions."""
    uploads = [u['id'] for p in inputs for u in p.get('uploads', []) if u.get('kind') != 'table']
    if not uploads:
        return prompt
    def replace(match):
        index = int(match.group(1)) - 1
        if index >= len(uploads) or uploads[index] not in ids:
            raise ValueError('提示词引用了未发送的用户图片，请修正参考列表和编号后重试')
        return '参考图' + str(ids.index(uploads[index]) + 1)
    return re.sub(r'(?:@\s*(?:图片|图)?|图片)\s*([1-9][0-9]*)(?![0-9])', replace, prompt)


def requested_image_count(text: str) -> int | None:
    # Only unambiguous generation quantities, not reference numbers or dimensions.
    matches = re.findall(r"(?:生成|制作|出图|输出|出)\s*([1-9][0-9]*|[一二三四五六七八九十两])\s*张", text)
    if not matches:
        return None
    value = matches[-1]
    return int(value) if value.isdigit() else {"一": 1, "二": 2, "两": 2, "三": 3, "四": 4,
        "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}[value]


def explicit_reference_roles(text: str, index: int) -> list[str]:
    """Extract direct assignments without asking a model to renumber images."""
    pattern = rf"(?:图片|参考图|图)\s*{index}(?![0-9])\s*(?:是|作|作为|用作|只参考)\s*([^，。；;\n@]{{1,60}})"
    return list(dict.fromkeys(match.strip() for match in re.findall(pattern, text)))

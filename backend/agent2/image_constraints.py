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

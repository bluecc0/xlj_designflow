from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import math
import mimetypes
import re
import time
from pathlib import Path
from typing import Any, AsyncIterator, Callable, Optional

import httpx
import pydantic

from .ai_image import SLASH_MODEL_MAP, generate_image_async, generate_image_with_reference_async
from .config import settings

logger = logging.getLogger(__name__)


# ── 生图场景模板 ──────────────────────────────────────────────────────────────
# 每个场景定义了适合该业务用途的正向 prompt 要素和负向词。
# Agent 根据用户描述的用途/主体自动匹配最合适的场景模板。

PROMPT_SCENES: dict[str, dict[str, Any]] = {
    "portrait_cover": {
        "name": "人物封面海报",
        "match": "人物 人像 女性 封面 竖版 小红书 力量 未来 portrait cover",
        "positive_elements": [
            "premium editorial portrait poster",
            "single clear hero subject",
            "vertical cover composition",
            "minimal high-end layout",
            "clean background with intentional copy space",
            "no product placement",
        ],
        "negative": (
            "product advertisement, cosmetics jar, skincare bottle, product packaging, "
            "perfume bottle, skincare ad, cosmetics ad, commercial product packshot, "
            "brand logo, luxury brand name, Chanel, Dior, product placement, "
            "cluttered, amateur, casual snapshot, messy background, low quality, watermark"
        ),
    },
    "product_white_bg": {
        "name": "白底产品图",
        "match": "白底 产品图 干净背景 商品展示 单品 纯色背景",
        "positive_elements": [
            "commercial product photography",
            "clean white background",
            "studio lighting",
            "sharp focus on product",
            "professional e-commerce photography",
            "product centered, isolated",
        ],
        "negative": (
            "cluttered background, busy scene, text overlay, watermark, "
            "harsh shadows, dark background, multiple products, lifestyle setting"
        ),
    },
    "product_scene": {
        "name": "产品场景图",
        "match": "场景图 模特 穿搭 上身 户外 室内场景 生活场景 lifestyle",
        "positive_elements": [
            "professional lifestyle photography",
            "natural lighting",
            "shallow depth of field",
            "product prominently featured",
            "clean composition",
        ],
        "negative": (
            "studio background, white background, cluttered composition, "
            "distracting elements, text, watermark, low quality"
        ),
    },
    "ecommerce_poster": {
        "name": "电商海报",
        "match": "海报 电商 banner 促销 活动 主图 封面 大促",
        "positive_elements": [
            "professional e-commerce poster",
            "dramatic studio lighting",
            "clear hero subject",
            "clean composition with copy space",
            "commercial advertising photography",
            "high-end retouching",
        ],
        "negative": (
            "cluttered, amateur, casual snapshot, messy background, "
            "low contrast, text, watermark, cropped product"
        ),
    },
    "automotive_poster": {
        "name": "汽车发售海报",
        "match": "汽车 车 新车 新款汽车 发售 跑车 suv 轿车 concept car road poster launch",
        "positive_elements": [
            "cinematic automotive key visual",
            "vehicle as the unmistakable main subject",
            "dynamic road scene or launch-stage atmosphere",
            "premium commercial lighting",
            "strong sense of motion and scale",
            "clean title area for typography",
        ],
        "negative": (
            "person as sole hero subject, cosmetics product, skincare packaging, perfume bottle, "
            "fashion portrait replacing the vehicle, cluttered layout, watermark, low quality"
        ),
    },
    "social_media": {
        "name": "社媒配图",
        "match": "社媒 小红书 朋友圈 公众号 推文 封面 封面图 头像 种草",
        "positive_elements": [
            "social media content",
            "trending aesthetic",
            "clean and modern composition",
            "natural and inviting lighting",
            "brand-friendly visual",
        ],
        "negative": (
            "corporate stock photo style, cluttered, outdated, "
            "low effort, amateur, text heavy, watermark"
        ),
    },
    "fashion_lookbook": {
        "name": "时尚画册",
        "match": "球鞋 服饰 穿搭 时尚 潮流 街头 运动鞋",
        "positive_elements": [
            "fashion editorial photography",
            "dramatic directional lighting",
            "product as hero subject",
            "high-end fashion retouching",
            "atmospheric and premium feel",
        ],
        "negative": (
            "casual snapshot, flat lighting, busy background, "
            "low quality, distorted product, text, watermark"
        ),
    },
}

# 未匹配到任何场景时的通用高质量电商 prompt
FALLBACK_POSITIVE = (
    "strong visual focus, clean composition, intentional lighting, "
    "clear subject hierarchy, high quality, sharp details"
)
FALLBACK_NEGATIVE = (
    "low quality, blurry, distorted, amateur, cluttered, "
    "text, watermark, ugly, deformed"
)

# 所有场景统一追加的质量后缀
QUALITY_SUFFIX = "masterpiece, best quality, highly detailed"


def _match_prompt_scene(intent: dict[str, Any]) -> dict[str, Any] | None:
    """根据用户意图匹配最合适的生图场景模板（命中关键词最多者优先）。"""
    core_text = " ".join([
        str(intent.get("subject") or ""),
        str(intent.get("scene") or ""),
        str(intent.get("useCase") or ""),
        str(intent.get("composition") or ""),
        str(intent.get("camera") or ""),
        str(intent.get("style") or ""),
        str(intent.get("mood") or ""),
    ]).lower()
    search_text = " ".join([
        str(intent.get("subject") or ""),
        str(intent.get("scene") or ""),
        str(intent.get("style") or ""),
        str(intent.get("useCase") or ""),
        str(intent.get("platform") or ""),
        str(intent.get("targetAudience") or ""),
        str(intent.get("camera") or ""),
        str(intent.get("mood") or ""),
        str(intent.get("composition") or ""),
        str(intent.get("copyText") or ""),
        str(intent.get("aspectRatio") or ""),
        str(intent.get("mustInclude") or ""),
    ]).lower()
    if not search_text.strip():
        return None

    # 汽车发售是强业务语义，不能被“小红书/未来/竖版”这些弱特征误归到人物封面。
    has_auto = any(token in core_text for token in ("汽车", "新车", "跑车", "轿车", "suv", "concept car"))
    has_auto_context = any(token in core_text for token in ("发售", "公路", "道路", "发布会", "车身", "低机位"))
    if has_auto and has_auto_context:
        return PROMPT_SCENES["automotive_poster"]

    # 人物封面是强业务语义，不能被“海报/封面”误归到电商海报，否则会注入 product hero shot。
    has_person = any(token in core_text for token in ("人物", "人像", "女性", "portrait"))
    has_cover_context = any(token in core_text for token in ("封面", "小红书", "竖版", "cover", "3:4", "4:5", "9:16"))
    if has_person and has_cover_context:
        return PROMPT_SCENES["portrait_cover"]

    best_scene = None
    best_hits = 0
    for key, scene in PROMPT_SCENES.items():
        match_keywords = scene["match"].lower().split()
        hits = sum(1 for kw in match_keywords if kw in search_text)
        if hits > best_hits:
            best_hits = hits
            best_scene = scene
    return best_scene


def _split_constraint_items(value: Any) -> list[str]:
    if isinstance(value, list):
        items = [str(item).strip() for item in value if str(item).strip()]
    else:
        text = str(value or "").strip()
        if not text:
            return []
        items = [part.strip() for part in re.split(r"[,\n;；，、]+", text) if part.strip()]
    seen: set[str] = set()
    ordered: list[str] = []
    for item in items:
        key = item.casefold()
        if key in seen:
            continue
        seen.add(key)
        ordered.append(item)
    return ordered


def _join_instruction_sentences(parts: list[str]) -> str:
    clean = [str(part).strip().rstrip("。.") for part in parts if str(part).strip()]
    return ". ".join(clean)


def _build_instruction_constraints(*, must_include: list[str], avoid: list[str], preserve: list[str]) -> dict[str, list[str]]:
    return {
        "mustInclude": must_include,
        "avoid": avoid,
        "preserve": preserve,
    }


INTENT_KEYS = (
    "subject",
    "scene",
    "style",
    "mood",
    "backgroundStyle",
    "composition",
    "safeArea",
    "camera",
    "colorPalette",
    "lighting",
    "useCase",
    "taskPurpose",
    "platform",
    "targetAudience",
    "copyText",
    "subtitleText",
    "titleFontStyle",
    "subtitleFontStyle",
    "aspectRatio",
    "mustInclude",
    "avoid",
)

DIMENSIONS = (
    {"key": "subject", "weight": 30, "required": True, "inferrable": False},
    {"key": "scene", "weight": 12, "required": False, "inferrable": True},
    {"key": "style", "weight": 20, "required": False, "inferrable": True},
    {"key": "mood", "weight": 15, "required": False, "inferrable": True},
    {"key": "composition", "weight": 10, "required": False, "inferrable": True},
    {"key": "camera", "weight": 8, "required": False, "inferrable": True},
    {"key": "colorPalette", "weight": 10, "required": False, "inferrable": True},
    {"key": "lighting", "weight": 10, "required": False, "inferrable": True},
    {"key": "useCase", "weight": 5, "required": False, "inferrable": True},
    {"key": "platform", "weight": 5, "required": False, "inferrable": True},
    {"key": "targetAudience", "weight": 5, "required": False, "inferrable": True},
)

GENERATE_THRESHOLD = 50
MIN_EXPLICIT_DIMS_FOR_GENERATE = 2  # 至少用户明确提供了 2 个维度才能生成
MAX_TURNS_PER_STAGE = 3
FREE_PLAY_PATTERNS = (
    "你来决定",
    "随便",
    "自由发挥",
    "你定",
    "帮我想",
    "你觉得怎么好就怎么来",
    "surprise me",
    "you decide",
    "up to you",
    "you can decide",
)
CONFIRM_PATTERNS = (
    "就这样",
    "可以开始",
    "开始生成",
    "生成吧",
    "出图吧",
    "没问题",
    "确定",
    "确认",
    "好，就这个",
    "generate it",
    "generate now",
    "generate it now",
    "go ahead",
    "looks good",
    "do it",
)
REFINE_PATTERNS = (
    "改一下",
    "调整",
    "换成",
    "再来一版",
    "优化",
    "细一点",
    "重做",
    "保留",
    "refine",
    "adjust",
    "change it",
    "iterate",
)


class AgentChatRequest(pydantic.BaseModel):
    message: str
    skill: str | None = None


class AgentCompletenessResult(pydantic.BaseModel):
    score: float
    critical_gaps: list[str] = pydantic.Field(default_factory=list)
    inferrable_gaps: list[str] = pydantic.Field(default_factory=list)
    can_generate: bool = False


class AgentOperationReadiness(pydantic.BaseModel):
    executable: bool = False
    missing_requirements: list[str] = pydantic.Field(default_factory=list)
    required_capability: str = "none"


class VisualIntentPatch(pydantic.BaseModel):
    turn_type: str = "add_detail"
    target_image_id: str | None = None
    target_region: str = "whole_image"
    operation_hint: str = "none"
    patch: dict[str, Any] = pydantic.Field(default_factory=dict)
    preserve: list[str] = pydantic.Field(default_factory=list)
    change: list[str] = pydantic.Field(default_factory=list)
    avoid: list[str] = pydantic.Field(default_factory=list)
    assumptions: list[str] = pydantic.Field(default_factory=list)
    missing_critical_info: list[str] = pydantic.Field(default_factory=list)
    confidence: float = 0.5
    creative_suggestion: str = ""


class ReferenceImageAnalysis(pydantic.BaseModel):
    summary: str = ""
    extracted_info: dict[str, Any] = pydantic.Field(default_factory=dict)
    notable_elements: list[str] = pydantic.Field(default_factory=list)


def _deep_copy_json(value: Any) -> Any:
    if value is None:
        return None
    return json.loads(json.dumps(value, ensure_ascii=False))


def empty_intent() -> dict[str, Any]:
    return {key: "" for key in INTENT_KEYS} | {"userAuthorizedFreedom": False}


def default_project_state() -> dict[str, Any]:
    return {
        "status": "active",
        "phase": {"stage": "exploring", "turnsInStage": 0},
        "intent": empty_intent(),
        "brief": None,
        "currentPrompt": None,
        "currentImage": None,
        "conversationSummary": "",
        "metadata": {"decisionLogs": []},
    }


def normalize_project_state(project: dict[str, Any]) -> dict[str, Any]:
    state = default_project_state()
    state.update({
        "status": project.get("status") or "active",
        "brief": _deep_copy_json(project.get("brief")),
        "currentPrompt": _deep_copy_json(project.get("current_prompt")),
        "currentImage": _deep_copy_json(project.get("current_image")),
        "conversationSummary": project.get("conversation_summary") or "",
        "metadata": _deep_copy_json(project.get("metadata")),
    })
    # brief 仅作为参考展示，确认态不持久化：每次加载项目时强制重置
    if state.get("brief") and isinstance(state["brief"], dict):
        state["brief"]["confirmedByUser"] = False
    phase = project.get("phase") or {}
    state["phase"] = {
        "stage": phase.get("stage") or "exploring",
        "turnsInStage": int(phase.get("turnsInStage") or 0),
    }
    intent = empty_intent()
    intent.update(project.get("intent") or {})
    state["intent"] = intent
    return state


def detect_free_play(message: str) -> bool:
    text = (message or "").lower()
    return any(pattern.lower() in text for pattern in FREE_PLAY_PATTERNS)


def detect_confirm(message: str) -> bool:
    text = (message or "").strip().lower()
    if any(pattern.lower() in text for pattern in CONFIRM_PATTERNS):
        return True
    chinese_confirm_patterns = (
        "现在就生成",
        "直接生成",
        "马上生成",
        "开始生成",
        "开始出图",
        "出图吧",
        "生成吧",
        "就按这个方向生成",
        "就按这个方向继续",
    )
    if any(pattern in (message or "") for pattern in chinese_confirm_patterns):
        return True
    return False


def detect_regenerate(message: str) -> bool:
    text = (message or "").strip().lower()
    return any(pattern.lower() in text for pattern in ("start over", "new image", "new scene", "重新来", "重新生成", "换一个场景"))


def detect_refine(message: str, state: dict[str, Any]) -> bool:
    if not state.get("currentImage"):
        return False
    text = (message or "").lower()
    if any(pattern.lower() in text for pattern in REFINE_PATTERNS):
        return True
    return False


def merge_intent(base: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    merged = empty_intent()
    merged.update(base or {})
    for key, value in (incoming or {}).items():
        if key not in merged:
            continue
        if isinstance(value, str):
            clean = value.strip()
            if clean:
                merged[key] = clean
        elif isinstance(value, bool):
            merged[key] = value
    if incoming.get("userAuthorizedFreedom"):
        merged["userAuthorizedFreedom"] = True
    return merged


def has_meaningful_intent_update(incoming: dict[str, Any]) -> bool:
    if not incoming:
        return False
    if incoming.get("userAuthorizedFreedom"):
        return True
    for key in INTENT_KEYS:
        value = incoming.get(key)
        if isinstance(value, str) and value.strip():
            return True
    return False


def has_meaningful_patch(intent_patch: "VisualIntentPatch | None") -> bool:
    if not intent_patch:
        return False
    return has_meaningful_intent_update(intent_patch.patch or {})


def intent_update_from_patch(intent_patch: "VisualIntentPatch | None") -> dict[str, Any]:
    if not intent_patch:
        return {}
    extracted = dict(intent_patch.patch or {})
    if intent_patch.avoid:
        avoid_text = "，".join([item for item in intent_patch.avoid if item])
        if avoid_text:
            extracted["avoid"] = avoid_text
    if intent_patch.change:
        change_text = "，".join([item for item in intent_patch.change if item])
        if change_text and not extracted.get("mustInclude"):
            extracted["mustInclude"] = change_text
    if intent_patch.turn_type == "confirm":
        extracted["creativeDirectionConfirmed"] = True
    return extracted


def apply_intent_patch_to_state(
    state: dict[str, Any],
    intent_patch: "VisualIntentPatch | None",
    *,
    hard_constraints: dict[str, Any] | None = None,
) -> dict[str, Any]:
    preserved_reference_context = _deep_copy_json(((state.get("metadata") or {}).get("referenceContext")))
    if intent_patch and intent_patch.turn_type == "create_new":
        updated = default_project_state()
        if preserved_reference_context:
            updated["metadata"]["referenceContext"] = preserved_reference_context
    else:
        updated = _deep_copy_json(state)
    if not intent_patch and not hard_constraints:
        return updated

    extracted = intent_update_from_patch(intent_patch)
    if hard_constraints:
        extracted = merge_intent(extracted, hard_constraints)

    if has_meaningful_intent_update(extracted):
        updated["intent"] = merge_intent(updated.get("intent") or {}, extracted)

    metadata = dict(updated.get("metadata") or {})
    updated["metadata"] = metadata

    if intent_patch:
        suggested_refine = metadata.get("suggestedRefine") or {}
        if intent_patch.turn_type in {"revise_image", "select_variant"} and suggested_refine:
            if not intent_patch.preserve:
                intent_patch.preserve = [str(item).strip() for item in (suggested_refine.get("preserve") or []) if str(item).strip()]
            if not intent_patch.change:
                intent_patch.change = [str(item).strip() for item in (suggested_refine.get("change") or []) if str(item).strip()]
            if not intent_patch.avoid:
                intent_patch.avoid = [str(item).strip() for item in (suggested_refine.get("avoid") or []) if str(item).strip()]
            if (not intent_patch.target_region or intent_patch.target_region == "whole_image") and suggested_refine.get("targetRegion"):
                intent_patch.target_region = str(suggested_refine.get("targetRegion") or "whole_image")

        metadata["lastIntentPatch"] = {
            "turnType": intent_patch.turn_type,
            "targetImageId": intent_patch.target_image_id,
            "targetRegion": intent_patch.target_region,
            "operationHint": intent_patch.operation_hint,
            "preserve": intent_patch.preserve,
            "change": intent_patch.change,
            "avoid": intent_patch.avoid,
            "assumptions": intent_patch.assumptions,
            "missingCriticalInfo": intent_patch.missing_critical_info,
            "confidence": intent_patch.confidence,
        }
        if intent_patch.turn_type in {"revise_image", "select_variant", "reject_result"}:
            metadata["pendingEdit"] = {
                "targetImageId": intent_patch.target_image_id,
                "targetRegion": intent_patch.target_region,
                "operationHint": intent_patch.operation_hint,
                "preserve": intent_patch.preserve,
                "change": intent_patch.change,
                "avoid": intent_patch.avoid,
            }
        elif "pendingEdit" in metadata:
            metadata.pop("pendingEdit", None)

    if intent_patch and intent_patch.turn_type != "confirm" and updated.get("brief"):
        updated["brief"] = dict(updated["brief"])
        updated["brief"]["confirmedByUser"] = False

    return updated


def build_suggested_refine_from_vlm(vlm_analysis: dict[str, Any] | None) -> dict[str, Any]:
    analysis = vlm_analysis or {}
    iteration_diff = analysis.get("iterationDiff") or {}
    keep = [str(item).strip() for item in (iteration_diff.get("keep") or []) if str(item).strip()]
    adjust = [str(item).strip() for item in (iteration_diff.get("adjust") or []) if str(item).strip()]
    prompt_delta = iteration_diff.get("promptDelta") or {}
    add_items = [str(item).strip() for item in (prompt_delta.get("add") or []) if str(item).strip()]
    remove_items = [str(item).strip() for item in (prompt_delta.get("remove") or []) if str(item).strip()]
    modify_map = prompt_delta.get("modify") or {}
    modify_items = [f"{k}:{v}" for k, v in modify_map.items() if str(k).strip() and str(v).strip()]
    problems = [str(item).strip() for item in (analysis.get("problemElements") or []) if str(item).strip()]

    target_region = "whole_image"
    for item in adjust + problems:
        lowered = item.lower()
        if "背景" in item or "background" in lowered:
            target_region = "background"
            break
        if "文字" in item or "title" in lowered or "text" in lowered:
            target_region = "text_area"
            break
        if "人脸" in item or "面部" in item or "face" in lowered:
            target_region = "face"
            break
        if "主体" in item or "人物" in item or "product" in lowered or "subject" in lowered:
            target_region = "subject"
            break

    return {
        "targetRegion": target_region,
        "preserve": keep,
        "change": adjust + add_items + modify_items,
        "avoid": remove_items + problems,
        "suggestion": str(analysis.get("nextStepSuggestion") or "").strip(),
    }


def build_vlm_followup_decision(vlm_analysis: dict[str, Any] | None) -> dict[str, Any] | None:
    analysis = vlm_analysis or {}
    suggestion = str(analysis.get("nextStepSuggestion") or "").strip()
    problems = [str(item).strip() for item in (analysis.get("problemElements") or []) if str(item).strip()]
    quality = int(analysis.get("qualityScore") or 0)
    intent_match = int(analysis.get("intentMatch") or 0)
    if not suggestion and not problems:
        return None
    if quality >= 85 and intent_match >= 85 and suggestion in {"", "可以基于这版微调"}:
        return None

    prompt_bits: list[str] = []
    if suggestion:
        prompt_bits.append(suggestion)
    if problems:
        prompt_bits.append("重点处理：" + "；".join(problems[:3]))
    refine_value = "优化一下：" + "；".join(prompt_bits[:2]) if prompt_bits else "优化一下当前这版"
    question = suggestion or "我看这版还有可优化空间，要不要按建议继续细修一版？"
    return {
        "type": "ASK",
        "question": question,
        "dimension": "vlm_refine",
        "choices": [
            {"label": "按建议优化", "value": refine_value},
            {"label": "换个方向优化", "value": "优化一下，但换个方向给我一版新的修改方案"},
            {"label": "先保留这版", "value": "这版先这样，我们继续下一步"},
        ],
        "source": "vlm",
    }


def _extract_subject_description(text: str) -> str:
    raw = str(text or "").strip()
    if not raw:
        return ""
    patterns = (
        r"(?:画面主体|产品主体|主体|主视觉)\s*(?:是|为|[:：])\s*([^，。；;\n]{2,80})",
        r"(?:画面以|主画面是|主图是)\s*([^，。；;\n]{2,80})",
    )
    for pattern in patterns:
        match = re.search(pattern, raw)
        if match and match.group(1).strip():
            return match.group(1).strip(" \"'“”‘’[]()（）")
    return ""


def _coarse_subject_from_message(message: str) -> str:
    text = (message or "").strip()
    if not text:
        return ""
    explicit_subject = _extract_subject_description(text)
    if explicit_subject:
        return explicit_subject
    lowered = text.lower()
    for token in ("generate it now", "generate now", "generate it", "go ahead", "please", "帮我", "给我", "现在", "生成", "出图"):
        lowered = lowered.replace(token, " ")
        text = re.sub(re.escape(token), " ", text, flags=re.I)
    for token in ("做一张", "来一张", "要一张", "帮我做", "生成一张", "出一张"):
        text = text.replace(token, " ")
    text = re.sub(r"\s+", " ", text).strip(" ,.，。!！?？")
    if len(text) < 4:
        return ""
    first_clause = re.split(r"[，。；;\n]", text)[0].strip()
    return (first_clause or text)[:160]


def _collect_keyword_phrases(text: str, keywords: tuple[str, ...]) -> list[str]:
    phrases: list[str] = []
    for keyword in keywords:
        pattern = re.compile(re.escape(keyword) + r"\s*[:：]?\s*([^，。；;\n]{1,40})")
        for match in pattern.finditer(text):
            phrase = str(match.group(1) or "").strip(" \"'“”‘’[]()（）")
            if phrase:
                phrases.append(phrase)
    clean: list[str] = []
    seen: set[str] = set()
    for phrase in phrases:
        key = phrase.casefold()
        if key in seen:
            continue
        seen.add(key)
        clean.append(phrase)
    return clean


def _infer_subject_category(subject_text: str) -> str:
    text = str(subject_text or "").strip().lower()
    if not text:
        return ""
    if any(token in text for token in ("汽车", "新车", "跑车", "轿车", "suv", "concept car")):
        return "汽车"
    if any(token in text for token in ("球鞋", "运动鞋", "鞋子", "鞋款", "鞋")):
        return "鞋类产品"
    if any(token in text for token in ("人物", "人像", "女性", "男模", "模特", "portrait")):
        return "人物"
    if any(token in text for token in ("手机", "智能手机", "iphone", "安卓机")):
        return "手机产品"
    return subject_text


def extract_message_constraints(message: str) -> dict[str, Any]:
    """从用户原话里兜底提取硬约束，避免 LLM JSON 漏掉标题/比例/用途。"""
    text = (message or "").strip()
    if not text:
        return {}
    extracted: dict[str, Any] = {}

    subtitle_match = re.search(r"(?:副标题|副文案|副字)\s*(?:是|为|[:：])?\s*[“\"「『](.*?)[”\"」』]", text)
    if subtitle_match and subtitle_match.group(1).strip():
        extracted["subtitleText"] = subtitle_match.group(1).strip()

    title_match = re.search(r"(?:主文案|主标题)\s*(?:是|为|[:：])?\s*[“\"「『](.*?)[”\"」』]", text)
    if title_match and title_match.group(1).strip():
        extracted["copyText"] = title_match.group(1).strip()

    copy_match = re.search(r"(?:文案|标题|文字|slogan|Slogan)\s*[:：]?\s*[“\"「『](.*?)[”\"」』]", text)
    if copy_match and copy_match.group(1).strip() and not extracted.get("copyText"):
        extracted["copyText"] = copy_match.group(1).strip()

    ratio_match = re.search(r"(\d{1,2})\s*[:：]\s*(\d{1,2})", text)
    if ratio_match:
        extracted["aspectRatio"] = f"{ratio_match.group(1)}:{ratio_match.group(2)}"

    task_match = re.search(r"(?:用途|目的|任务|要做|做一张)\s*[:：]?\s*([^，。；;\n]{2,40})", text)
    if task_match and task_match.group(1).strip():
        extracted["taskPurpose"] = task_match.group(1).strip()

    background_match = re.search(r"(?:背景|背景风格)\s*(?:是|为|[:：])?\s*([^，。；;\n]{2,40})", text)
    if background_match and background_match.group(1).strip():
        extracted["backgroundStyle"] = background_match.group(1).strip()

    title_font_match = re.search(r"(?:主标题字体|标题字体|主文案字体)\s*(?:是|为|[:：])?\s*([^，。；;\n]{2,50})", text)
    if title_font_match and title_font_match.group(1).strip():
        extracted["titleFontStyle"] = title_font_match.group(1).strip()

    subtitle_font_match = re.search(r"(?:副标题字体|副文案字体)\s*(?:是|为|[:：])?\s*([^，。；;\n]{2,50})", text)
    if subtitle_font_match and subtitle_font_match.group(1).strip():
        extracted["subtitleFontStyle"] = subtitle_font_match.group(1).strip()

    safe_area_match = re.search(r"(?:安全线|留白要求|文字区域)\s*(?:是|为|[:：])?\s*([^，。；;\n]{2,50})", text)
    if safe_area_match and safe_area_match.group(1).strip():
        extracted["safeArea"] = safe_area_match.group(1).strip()
    elif any(token in text for token in ("不贴边", "不被遮挡", "文字清晰", "清晰可读")):
        safe_bits: list[str] = []
        if "不贴边" in text:
            safe_bits.append("文字不贴边")
        if "不被遮挡" in text:
            safe_bits.append("文字不被主体遮挡")
        if "文字清晰" in text or "清晰可读" in text:
            safe_bits.append("文字清晰可读")
        if safe_bits:
            extracted["safeArea"] = "，".join(dict.fromkeys(safe_bits))

    explicit_subject = _extract_subject_description(text)
    if explicit_subject:
        extracted["subject"] = explicit_subject

    use_case_parts: list[str] = []
    platform_parts: list[str] = []
    if "小红书" in text:
        platform_parts.append("小红书")
    if "抖音" in text:
        platform_parts.append("抖音")
    if "淘宝" in text or "天猫" in text:
        platform_parts.append("电商")
    if "公众号" in text:
        platform_parts.append("公众号")
    if "instagram" in text.lower() or "ins" in text.lower():
        platform_parts.append("Instagram")
    if "封面" in text:
        use_case_parts.append("封面")
    if "海报" in text:
        use_case_parts.append("海报")
    if "kv" in text.lower() or "key visual" in text.lower():
        use_case_parts.append("KV")
    if "主图" in text:
        use_case_parts.append("主图")
    if "详情页" in text:
        use_case_parts.append("详情页")
    if use_case_parts:
        extracted["useCase"] = " / ".join(dict.fromkeys(use_case_parts))
    if platform_parts:
        extracted["platform"] = " / ".join(dict.fromkeys(platform_parts))

    lowered = text.lower()
    if not extracted.get("subject"):
        if any(token in text for token in ("汽车", "新车", "跑车", "轿车", "suv")) or "concept car" in lowered:
            extracted["subject"] = "汽车"
        elif any(token in text for token in ("球鞋", "运动鞋", "鞋子")):
            extracted["subject"] = "鞋类产品"
        elif ("人物" in text or "人像" in text or "女性" in text) and any(token in text for token in ("封面", "海报", "肖像")):
            extracted["subject"] = "人物"

    composition_parts: list[str] = []
    if "竖版" in text:
        composition_parts.append("竖版构图")
    if "横版" in text:
        composition_parts.append("横版构图")
    if "人物封面" in text or "人像封面" in text:
        composition_parts.append("人物封面构图")
    if "特写" in text:
        composition_parts.append("特写构图")
    if "留白" in text:
        composition_parts.append("留白构图")
    if ratio_match:
        composition_parts.append(f"{ratio_match.group(1)}:{ratio_match.group(2)} 画幅")
    if composition_parts:
        extracted["composition"] = "，".join(dict.fromkeys(composition_parts))

    scene_parts: list[str] = []
    if "公路" in text or "道路" in text:
        scene_parts.append("公路场景")
    if "海边" in text:
        scene_parts.append("海边场景")
    if "棚拍" in text:
        scene_parts.append("棚拍场景")
    if "发布会" in text:
        scene_parts.append("发布会场景")
    if "白底" in text:
        scene_parts.append("纯白背景")
    if scene_parts:
        extracted["scene"] = "，".join(dict.fromkeys(scene_parts))

    camera_parts: list[str] = []
    if "广角" in text:
        camera_parts.append("广角视角")
    if "近景" in text:
        camera_parts.append("近景")
    if "远景" in text:
        camera_parts.append("远景")
    if "俯拍" in text:
        camera_parts.append("俯拍")
    if "仰拍" in text:
        camera_parts.append("仰拍")
    if camera_parts:
        extracted["camera"] = "，".join(dict.fromkeys(camera_parts))

    if "简约高级" in text or "高级简约" in text:
        extracted["style"] = "简约高级"
    elif "电影感" in text:
        extracted["style"] = "电影感大片风格"

    audience_parts: list[str] = []
    if "女性用户" in text or "女生" in text:
        audience_parts.append("女性用户")
    if "年轻人" in text:
        audience_parts.append("年轻人")
    if "高端用户" in text or "高净值" in text:
        audience_parts.append("高端用户")
    if audience_parts:
        extracted["targetAudience"] = "，".join(dict.fromkeys(audience_parts))

    must_include_parts = _collect_keyword_phrases(text, ("要有", "必须有", "需要有", "包含", "带上"))
    if must_include_parts:
        extracted["mustInclude"] = "，".join(must_include_parts)

    avoid_parts = _collect_keyword_phrases(text, ("不要", "避免", "别做成", "不要出现", "别出现"))
    if avoid_parts:
        extracted["avoid"] = "，".join(dict.fromkeys(avoid_parts))

    return extracted


def calculate_completeness(state: dict[str, Any]) -> AgentCompletenessResult:
    score = 0.0
    critical_gaps: list[str] = []
    inferrable_gaps: list[str] = []
    explicit_count = 0
    intent = state.get("intent") or {}
    contract_fields = _contract_field_map(build_creative_contract(state))
    for dim in CONTRACT_DIMENSIONS:
        value = contract_fields.get(dim["key"]) or ""
        has_value = isinstance(value, str) and value.strip()
        if has_value:
            score += dim["weight"]
            explicit_count += 1
            continue
        if dim["required"] and not dim["inferrable"]:
            critical_gaps.append(dim["key"])
        elif dim["inferrable"]:
            inferrable_gaps.append(dim["key"])
            # 推断维度只给 20% 分数，避免"猜的"凑够 GENERATE 门槛
            score += dim["weight"] * 0.2
    if intent.get("userAuthorizedFreedom"):
        score = max(score, 85)
    score = min(score, 100)
    # 两个条件同时满足才能生成：1. 分数达标  2. 用户至少明确了 2 个维度
    can_generate = bool(not critical_gaps and score >= GENERATE_THRESHOLD and explicit_count >= MIN_EXPLICIT_DIMS_FOR_GENERATE)
    return AgentCompletenessResult(
        score=score,
        critical_gaps=critical_gaps,
        inferrable_gaps=inferrable_gaps,
        can_generate=can_generate,
    )


def calculate_operation_readiness(state: dict[str, Any], intent_patch: "VisualIntentPatch | None") -> AgentOperationReadiness:
    turn_type = str((intent_patch.turn_type if intent_patch else "") or "")
    hint = str((intent_patch.operation_hint if intent_patch else "") or "none")
    current_image = state.get("currentImage") or {}

    if turn_type in {"revise_image", "select_variant"} or hint in {"variation", "inpaint", "outpaint", "upscale", "text_overlay"}:
        missing = []
        if not current_image.get("imageUrl"):
            missing.append("current_image")
        return AgentOperationReadiness(
            executable=not missing,
            missing_requirements=missing,
            required_capability=hint if hint != "none" else "variation",
        )

    if turn_type == "export":
        missing = []
        if not current_image.get("imageUrl"):
            missing.append("current_image")
        return AgentOperationReadiness(
            executable=not missing,
            missing_requirements=missing,
            required_capability="none",
        )

    return AgentOperationReadiness(
        executable=True,
        missing_requirements=[],
        required_capability="text_to_image" if hint == "text_to_image" else "none",
    )


def get_confirmation_gaps(state: dict[str, Any]) -> list[str]:
    intent = state.get("intent") or {}
    gaps: list[str] = []
    copy_text = str(intent.get("copyText") or "").strip()
    subtitle_text = str(intent.get("subtitleText") or "").strip()
    title_font_style = str(intent.get("titleFontStyle") or "").strip()
    subtitle_font_style = str(intent.get("subtitleFontStyle") or "").strip()
    background_style = str(intent.get("backgroundStyle") or "").strip()
    use_case = str(intent.get("useCase") or "").strip()
    task_purpose = str(intent.get("taskPurpose") or "").strip()

    if copy_text and not title_font_style:
        gaps.append("titleFontStyle")
    if subtitle_text and not subtitle_font_style:
        gaps.append("subtitleFontStyle")
    if (("海报" in use_case) or ("封面" in use_case) or ("海报" in task_purpose) or ("封面" in task_purpose)) and not background_style:
        gaps.append("backgroundStyle")
    return gaps


def _font_style_choices_for_state(state: dict[str, Any], *, subtitle: bool = False) -> list[dict[str, str]]:
    intent = state.get("intent") or {}
    subject = str(intent.get("subject") or "")
    use_case = str(intent.get("useCase") or "")
    task_purpose = str(intent.get("taskPurpose") or "")
    style = str(intent.get("style") or "")
    context = " ".join([subject, use_case, task_purpose, style])

    if any(token in context for token in ("运动", "鞋", "球", "竞速", "力量")):
        return [
            {"label": ("副标题更有力量感" if subtitle else "主标题更有力量感"), "value": "高级力量感无衬线"},
            {"label": ("副标题更有速度感" if subtitle else "主标题更有速度感"), "value": "速度感斜切字形"},
            {"label": ("副标题更偏锐利科技" if subtitle else "主标题更偏锐利科技"), "value": "科技锐利无衬线"},
            {"label": "你来决定", "value": "你来决定"},
        ]
    if any(token in context for token in ("手机", "数码", "科技", "电子")):
        return [
            {"label": ("副标题更偏科技锐利" if subtitle else "主标题更偏科技锐利"), "value": "科技锐利无衬线"},
            {"label": ("副标题更偏极简现代" if subtitle else "主标题更偏极简现代"), "value": "极简现代无衬线"},
            {"label": ("副标题更偏高级克制" if subtitle else "主标题更偏高级克制"), "value": "高级克制几何字形"},
            {"label": "你来决定", "value": "你来决定"},
        ]
    if any(token in context for token in ("美妆", "护肤", "香水", "高级", "轻奢")):
        return [
            {"label": ("副标题更偏轻奢高级" if subtitle else "主标题更偏轻奢高级"), "value": "轻奢高级细体无衬线"},
            {"label": ("副标题更偏简约现代" if subtitle else "主标题更偏简约现代"), "value": "简约现代无衬线"},
            {"label": ("副标题更偏优雅克制" if subtitle else "主标题更偏优雅克制"), "value": "优雅克制字形"},
            {"label": "你来决定", "value": "你来决定"},
        ]
    return [
        {"label": ("副标题更偏简约现代" if subtitle else "主标题更偏简约现代"), "value": "简约现代无衬线"},
        {"label": ("副标题更偏高级力量感" if subtitle else "主标题更偏高级力量感"), "value": "高级力量感无衬线"},
        {"label": ("副标题更偏科技锐利" if subtitle else "主标题更偏科技锐利"), "value": "科技锐利无衬线"},
        {"label": "你来决定", "value": "你来决定"},
    ]


def _background_style_choices_for_state(state: dict[str, Any]) -> list[dict[str, str]]:
    intent = state.get("intent") or {}
    subject = str(intent.get("subject") or "")
    use_case = str(intent.get("useCase") or "")
    task_purpose = str(intent.get("taskPurpose") or "")
    style = str(intent.get("style") or "")
    context = " ".join([subject, use_case, task_purpose, style])
    if any(token in context for token in ("运动", "鞋", "球", "海报", "大促")):
        return [
            {"label": "背景更有冲击感", "value": "运动冲击感背景"},
            {"label": "背景更简洁促销", "value": "简洁促销背景"},
            {"label": "背景更有速度氛围", "value": "速度感氛围背景"},
            {"label": "你来决定", "value": "你来决定"},
        ]
    if any(token in context for token in ("手机", "数码", "科技")):
        return [
            {"label": "背景更偏纯净科技", "value": "纯净科技背景"},
            {"label": "背景更偏柔光空间", "value": "柔光空间背景"},
            {"label": "背景更偏极简纯色", "value": "极简纯色背景"},
            {"label": "你来决定", "value": "你来决定"},
        ]
    return [
        {"label": "背景更纯净统一", "value": "纯净统一背景"},
        {"label": "背景更偏柔光氛围", "value": "柔和自然光背景"},
        {"label": "背景更偏空间场景", "value": "简洁空间场景背景"},
        {"label": "你来决定", "value": "你来决定"},
    ]


def pick_question(state: dict[str, Any], gaps: list[str]) -> dict[str, Any]:
    """根据缺失维度生成问题 + 结构化选项。"""
    intent = state.get("intent") or {}
    copy_text = str(intent.get("copyText") or "").strip()
    subtitle_text = str(intent.get("subtitleText") or "").strip()
    templates: dict[str, dict[str, Any]] = {
        "subject": {
            "question": "我先帮你收一下核心信息，这张图最想表现的主体是什么？比如人物、产品、场景，或者某个具体物件。",
            "choices": [],  # 主体太开放，不适合选项
        },
        "purpose": {
            "question": "这张图主要用在哪里？",
            "choices": [
                {"label": "电商海报", "value": "电商海报"},
                {"label": "社媒配图", "value": "社媒配图"},
                {"label": "白底产品图", "value": "白底产品图"},
                {"label": "场景图", "value": "场景图"},
                {"label": "你来决定", "value": "你来决定"},
            ],
        },
        "overallStyle": {
            "question": "风格上你更偏好哪一种？",
            "choices": [
                {"label": "高级简约", "value": "高级简约风格"},
                {"label": "酷炫潮流", "value": "酷炫潮流风格"},
                {"label": "自然温暖", "value": "自然温暖风格"},
                {"label": "电影感大片", "value": "电影感大片风格"},
                {"label": "你来决定", "value": "你来决定"},
            ],
        },
        "backgroundStyle": {
            "question": "现在是在确认背景风格，不是在改主体构图。你更想让这张海报的背景走哪种感觉？",
            "choices": _background_style_choices_for_state(state),
        },
        "layout": {
            "question": "构图上有没有明确偏好？",
            "choices": [
                {"label": "产品居中", "value": "产品居中特写"},
                {"label": "留白设计", "value": "留白设计感构图"},
                {"label": "纵深感", "value": "场景纵深构图"},
                {"label": "你来决定", "value": "你来决定"},
            ],
        },
        "mainTitle": {
            "question": "画面里要不要带主标题文案？如果要，主标题写什么？",
            "choices": [],
        },
        "titleFontStyle": {
            "question": f"现在是在确认主标题「{copy_text or '当前主标题'}」的字体风格，不是在改主体画面。你希望这行标题更偏哪种字感？",
            "choices": _font_style_choices_for_state(state, subtitle=False),
        },
        "subtitleFontStyle": {
            "question": f"现在是在确认副标题「{subtitle_text or '当前副标题'}」的字体风格。你希望这行副标题更偏哪种字感？",
            "choices": _font_style_choices_for_state(state, subtitle=True),
        },
        "mood": {
            "question": "你希望画面的情绪更偏哪边？",
            "choices": [
                {"label": "克制专业", "value": "克制专业"},
                {"label": "热烈活力", "value": "热烈活力"},
                {"label": "高级冷淡", "value": "高级冷淡"},
                {"label": "温暖亲切", "value": "温暖亲切"},
                {"label": "你来决定", "value": "你来决定"},
            ],
        },
    }
    for key in ("subject", "purpose", "overallStyle", "backgroundStyle", "layout", "mainTitle", "titleFontStyle", "subtitleFontStyle", "mood"):
        if key in gaps:
            return templates.get(key, {"question": "我再补一个关键点，这张图里你最在意的视觉信息是什么？", "choices": []})
    return {"question": "我再补一个关键点，这张图里你最在意的视觉信息是什么？", "choices": []}


def _build_ask_action(
    state: dict[str, Any],
    *,
    question: str,
    dimension: str,
    choices: list[dict[str, Any]] | None = None,
    completeness: AgentCompletenessResult | None = None,
    readiness: AgentOperationReadiness | None = None,
) -> dict[str, Any]:
    payload = {
        "type": "ASK",
        "question": question,
        "dimension": dimension,
        "choices": choices or [],
        "brief": build_brief(state),
        "contract": build_creative_contract(state),
    }
    if completeness is not None:
        payload["completeness"] = completeness.model_dump()
    if readiness is not None:
        payload["operationReadiness"] = readiness.model_dump()
    return payload


def infer_defaults(intent: dict[str, Any], gaps: list[str]) -> dict[str, str]:
    subject = (intent.get("subject") or "").lower()
    defaults: dict[str, str] = {}
    if "backgroundStyle" in gaps:
        defaults["scene"] = "clean branded scene" if "产品" in subject or "shoe" in subject else "simple contextual scene"
        defaults["backgroundStyle"] = "简洁统一背景" if "产品" in subject or "shoe" in subject else "简洁场景背景"
    if "overallStyle" in gaps:
        defaults["style"] = "cinematic commercial illustration" if any(token in subject for token in ("product", "shoe", "bag", "汽车")) else "cinematic concept art"
    if "mood" in gaps:
        defaults["mood"] = "focused and atmospheric"
    if "layout" in gaps:
        defaults["composition"] = "clear hero composition"
    if "aspectRatio" in gaps:
        defaults["aspectRatio"] = settings.agent_image_size
    if "titleFontStyle" in gaps and intent.get("copyText"):
        defaults["titleFontStyle"] = "简约现代无衬线"
    if "subtitleFontStyle" in gaps and intent.get("subtitleText"):
        defaults["subtitleFontStyle"] = "清晰信息型无衬线"
    if "camera" in gaps:
        defaults["camera"] = "hero-angle shot"
    if "colorPalette" in gaps:
        defaults["colorPalette"] = "rich contrast with controlled highlight colors"
    if "lighting" in gaps:
        defaults["lighting"] = "dramatic directional lighting"
    if "purpose" in gaps:
        defaults["useCase"] = "hero image"
        defaults["taskPurpose"] = "生成一张可直接投放的创意图"
    if "platform" in gaps:
        defaults["platform"] = "brand campaign"
    if "targetAudience" in gaps:
        defaults["targetAudience"] = "broad lifestyle audience"
    return defaults


def build_brief(state: dict[str, Any]) -> dict[str, Any]:
    intent = state.get("intent") or {}
    concept_parts = [intent.get("subject"), intent.get("scene"), intent.get("style"), intent.get("mood")]
    concept = "，".join([part for part in concept_parts if isinstance(part, str) and part.strip()]) or "待补充视觉方案"
    visual_elements = []
    for key in ("subject", "scene", "composition", "camera", "copyText", "subtitleText", "aspectRatio", "lighting", "colorPalette", "mustInclude"):
        value = intent.get(key)
        if isinstance(value, str) and value.strip():
            visual_elements.append(value.strip())
    return {
        "concept": concept,
        "visualElements": visual_elements[:4],
        "platform": intent.get("platform") or "",
        "targetAudience": intent.get("targetAudience") or "",
        "style": intent.get("style") or "",
        "mood": intent.get("mood") or "",
        "colorDirection": intent.get("colorPalette") or "",
        "copyText": intent.get("copyText") or "",
        "subtitleText": intent.get("subtitleText") or "",
        "aspectRatio": intent.get("aspectRatio") or "",
        "confirmedByUser": False,
    }


def _split_channel_values(value: Any) -> list[str]:
    text = str(value or "").strip()
    if not text:
        return []
    return [item.strip() for item in re.split(r"[/／,，、|]+", text) if item.strip()]


def _nonempty_list(*values: Any) -> list[str]:
    items: list[str] = []
    seen: set[str] = set()
    for value in values:
        if isinstance(value, list):
            source = value
        else:
            source = [value]
        for item in source:
            text = str(item or "").strip()
            if not text:
                continue
            key = text.casefold()
            if key in seen:
                continue
            seen.add(key)
            items.append(text)
    return items


def build_creative_contract(state: dict[str, Any]) -> dict[str, Any]:
    intent = state.get("intent") or {}
    subject_text = str(intent.get("subject") or "").strip()
    subject_category = _infer_subject_category(subject_text)
    use_case = str(intent.get("useCase") or "").strip()
    task_purpose = str(intent.get("taskPurpose") or "").strip() or use_case
    aspect_ratio = str(intent.get("aspectRatio") or "").strip().replace("：", ":") or _intent_size(intent)
    composition = str(intent.get("composition") or "").strip()
    safe_area = str(intent.get("safeArea") or "").strip()
    style = str(intent.get("style") or "").strip()
    background_style = str(intent.get("backgroundStyle") or "").strip() or str(intent.get("scene") or "").strip()
    lighting = str(intent.get("lighting") or "").strip()
    color_palette = _split_constraint_items(intent.get("colorPalette"))
    copy_text = str(intent.get("copyText") or "").strip()
    subtitle_text = str(intent.get("subtitleText") or "").strip()
    title_font_style = str(intent.get("titleFontStyle") or "").strip()
    subtitle_font_style = str(intent.get("subtitleFontStyle") or "").strip()
    must_include_items = _split_constraint_items(intent.get("mustInclude"))
    avoid_items = _split_constraint_items(intent.get("avoid"))
    platform_items = _split_channel_values(intent.get("platform"))
    target_audience = str(intent.get("targetAudience") or "").strip()
    mood = str(intent.get("mood") or "").strip()
    camera = str(intent.get("camera") or "").strip()

    acceptance = _nonempty_list(
        subject_text and "主体是画面第一焦点",
        copy_text and "主标题清晰可读",
        background_style and "背景风格统一干净",
        style and f"整体风格符合{style}",
        safe_area and "文字区域不贴边、不被主体遮挡",
    )

    return {
        "task": {
            "purpose": task_purpose,
            "channel": platform_items,
            "targetAudience": target_audience,
        },
        "subject": {
            "category": subject_category,
            "description": subject_text,
            "presentation": style,
            "mustShow": must_include_items[:4],
        },
        "composition": {
            "aspectRatio": aspect_ratio,
            "layout": composition,
            "safeArea": safe_area,
            "focus": subject_text and "主体为第一视觉中心" or "",
            "camera": camera,
        },
        "visualStyle": {
            "overall": style,
            "backgroundStyle": background_style,
            "lighting": lighting,
            "mood": mood,
            "colorPalette": color_palette,
        },
        "copy": {
            "mainTitle": {
                "text": copy_text,
                "fontStyle": title_font_style,
            },
            "subtitle": {
                "text": subtitle_text,
                "fontStyle": subtitle_font_style,
            },
            "requirements": _nonempty_list(
                copy_text and "主标题清晰可读",
                subtitle_text and "副标题清晰可读",
                (copy_text or subtitle_text) and "中文不乱码",
                (copy_text or subtitle_text) and "文字不变形",
            ),
        },
        "constraints": {
            "mustInclude": must_include_items,
            "avoid": avoid_items,
            "preserve": [],
        },
        "acceptanceCriteria": acceptance,
    }


CONTRACT_DIMENSIONS = (
    {"key": "subject", "weight": 28, "required": True, "inferrable": False},
    {"key": "purpose", "weight": 12, "required": False, "inferrable": True},
    {"key": "aspectRatio", "weight": 10, "required": False, "inferrable": True},
    {"key": "overallStyle", "weight": 16, "required": False, "inferrable": True},
    {"key": "backgroundStyle", "weight": 10, "required": False, "inferrable": True},
    {"key": "layout", "weight": 8, "required": False, "inferrable": True},
    {"key": "mainTitle", "weight": 6, "required": False, "inferrable": True},
    {"key": "titleFontStyle", "weight": 4, "required": False, "inferrable": True},
    {"key": "subtitle", "weight": 3, "required": False, "inferrable": True},
    {"key": "subtitleFontStyle", "weight": 3, "required": False, "inferrable": True},
)


def _contract_field_map(contract: dict[str, Any]) -> dict[str, str]:
    task = contract.get("task") or {}
    subject = contract.get("subject") or {}
    composition = contract.get("composition") or {}
    visual_style = contract.get("visualStyle") or {}
    copy = contract.get("copy") or {}
    main_title = copy.get("mainTitle") or {}
    subtitle = copy.get("subtitle") or {}
    return {
        "subject": str(subject.get("description") or subject.get("category") or "").strip(),
        "purpose": str(task.get("purpose") or "").strip(),
        "aspectRatio": str(composition.get("aspectRatio") or "").strip(),
        "overallStyle": str(visual_style.get("overall") or "").strip(),
        "backgroundStyle": str(visual_style.get("backgroundStyle") or "").strip(),
        "layout": str(composition.get("layout") or composition.get("focus") or "").strip(),
        "mainTitle": str(main_title.get("text") or "").strip(),
        "titleFontStyle": str(main_title.get("fontStyle") or "").strip(),
        "subtitle": str(subtitle.get("text") or "").strip(),
        "subtitleFontStyle": str(subtitle.get("fontStyle") or "").strip(),
    }


def _intent_size(intent: dict[str, Any]) -> str:
    ratio = str(intent.get("aspectRatio") or "").strip().replace("：", ":")
    if ratio in {"1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16"}:
        return ratio
    composition = str(intent.get("composition") or "")
    match = re.search(r"(\d{1,2})\s*[:：]\s*(\d{1,2})", composition)
    if match:
        ratio = f"{match.group(1)}:{match.group(2)}"
        if ratio in {"1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16"}:
            return ratio
    return settings.agent_image_size


def build_generation_instruction(state: dict[str, Any]) -> dict[str, Any]:
    """将当前状态构造成 generation instruction，同时保留 provider 兼容字段。"""
    intent = state.get("intent") or {}
    scene = _match_prompt_scene(intent)
    must_include_items = _split_constraint_items(intent.get("mustInclude"))
    avoid_items = _split_constraint_items(intent.get("avoid"))

    subject = str(intent.get("subject") or "").strip()
    scene_text = str(intent.get("scene") or "").strip()
    use_case = str(intent.get("useCase") or "").strip()
    platform = str(intent.get("platform") or "").strip()
    target_audience = str(intent.get("targetAudience") or "").strip()
    composition = str(intent.get("composition") or "").strip()
    safe_area = str(intent.get("safeArea") or "").strip()
    aspect_ratio = str(intent.get("aspectRatio") or "").strip().replace("：", ":")
    style = str(intent.get("style") or "").strip()
    mood = str(intent.get("mood") or "").strip()
    camera = str(intent.get("camera") or "").strip()
    lighting = str(intent.get("lighting") or "").strip()
    color_palette = str(intent.get("colorPalette") or "").strip()
    copy_text = str(intent.get("copyText") or "").strip()
    subtitle_text = str(intent.get("subtitleText") or "").strip()
    background_style = str(intent.get("backgroundStyle") or "").strip()
    title_font_style = str(intent.get("titleFontStyle") or "").strip()
    subtitle_font_style = str(intent.get("subtitleFontStyle") or "").strip()
    task_purpose = str(intent.get("taskPurpose") or "").strip()

    instruction_parts: list[str] = []
    if subject and aspect_ratio:
        instruction_parts.append(f"Create a {aspect_ratio} image with {subject} as the clear main subject")
    elif subject:
        instruction_parts.append(f"Create an image with {subject} as the clear main subject")
    elif aspect_ratio:
        instruction_parts.append(f"Create a {aspect_ratio} image with a single clear visual focus")
    if use_case:
        instruction_parts.append(f"The intended use is {use_case}")
    elif task_purpose:
        instruction_parts.append(f"The creative task is {task_purpose}")
    if platform:
        instruction_parts.append(f"Target publishing context: {platform}")
    if target_audience:
        instruction_parts.append(f"Target audience: {target_audience}")
    if scene_text:
        instruction_parts.append(f"Scene direction: {scene_text}")
    if background_style:
        instruction_parts.append(f"Background style: {background_style}")
    if composition:
        instruction_parts.append(f"Use {composition}")
    if safe_area:
        instruction_parts.append(f"Typography safe area: {safe_area}")
    if camera:
        instruction_parts.append(f"Camera direction: {camera}")
    if style:
        instruction_parts.append(f"Visual style: {style}")
    if mood:
        instruction_parts.append(f"Overall mood: {mood}")
    if lighting:
        instruction_parts.append(f"Lighting direction: {lighting}")
    if color_palette:
        instruction_parts.append(f"Color direction: {color_palette}")
    if copy_text:
        instruction_parts.append(f'Include the exact Chinese text "{copy_text}" clearly in the composition')
        if title_font_style:
            instruction_parts.append(f"Main title font style: {title_font_style}")
    if subtitle_text:
        instruction_parts.append(f'Include the exact Chinese subtitle text "{subtitle_text}" clearly in the composition')
        if subtitle_font_style:
            instruction_parts.append(f"Subtitle font style: {subtitle_font_style}")
    if must_include_items:
        instruction_parts.append(f"Must include: {', '.join(must_include_items)}")
    if scene:
        instruction_parts.append(f"Helpful visual execution cues: {', '.join(scene['positive_elements'])}")
        scene_name = scene["name"]
    else:
        instruction_parts.append(f"Helpful visual execution cues: {FALLBACK_POSITIVE}")
        scene_name = "通用视觉"

    provider_positive_parts: list[str] = []
    for key in ("subject", "scene", "useCase", "taskPurpose", "platform", "targetAudience", "composition", "safeArea", "aspectRatio", "camera", "style", "mood", "lighting", "colorPalette", "backgroundStyle"):
        value = intent.get(key)
        if isinstance(value, str) and value.strip():
            provider_positive_parts.append(value.strip())
    if copy_text:
        provider_positive_parts.append(f'include exact Chinese title text "{copy_text}"')
        if title_font_style:
            provider_positive_parts.append(f"main title font style {title_font_style}")
    if subtitle_text:
        provider_positive_parts.append(f'include exact Chinese subtitle text "{subtitle_text}"')
        if subtitle_font_style:
            provider_positive_parts.append(f"subtitle font style {subtitle_font_style}")
    provider_positive_parts.extend(must_include_items)
    provider_positive_parts.extend(scene["positive_elements"] if scene else [FALLBACK_POSITIVE])
    provider_positive_parts.append(QUALITY_SUFFIX)

    negative_items = _split_constraint_items(scene["negative"] if scene else FALLBACK_NEGATIVE) + avoid_items
    negative_items = _split_constraint_items(negative_items)
    if copy_text or subtitle_text:
        negative_items = [item for item in negative_items if "text" not in item.lower()]

    return {
        "mode": "text_to_image",
        "model": settings.agent_image_model,
        "instruction": _join_instruction_sentences(instruction_parts),
        "constraints": _build_instruction_constraints(
            must_include=must_include_items,
            avoid=avoid_items,
            preserve=[],
        ),
        "parameters": {
            "aspectRatio": aspect_ratio or _intent_size(intent),
            "size": _intent_size(intent),
            "resolution": settings.agent_image_resolution,
        },
        "reasoningForUser": f"我会先按「{scene_name}」方向执行，但主体和文案以你刚确认的要求为准。",
        "positive": ", ".join(provider_positive_parts),
        "negative": ", ".join(negative_items),
        "promptReasoning": f"使用 {settings.agent_image_model} 文生图，匹配到「{scene_name}」场景模板。",
    }


def build_generation_prompt(state: dict[str, Any]) -> dict[str, Any]:
    return build_generation_instruction(state)


def build_refine_prompt(state: dict[str, Any], user_message: str) -> dict[str, Any]:
    """迭代优化 instruction：保留当前 prompt 核心，按用户反馈微调。"""
    current = state.get("currentPrompt") or {}
    intent = state.get("intent") or {}
    scene = _match_prompt_scene(intent)
    pending_edit = ((state.get("metadata") or {}).get("pendingEdit")) or {}

    positive = current.get("positive") or current.get("instruction") or ""
    if user_message.strip():
        keep_marker = "keep overall composition and subject consistency"
        if keep_marker not in positive:
            positive = f"{positive}, {keep_marker}"
        positive = f"{positive}, refine with: {user_message.strip()}"

    preserve_items = [str(item).strip() for item in (pending_edit.get("preserve") or []) if str(item).strip()]
    change_items = [str(item).strip() for item in (pending_edit.get("change") or []) if str(item).strip()]
    avoid_items = [str(item).strip() for item in (pending_edit.get("avoid") or []) if str(item).strip()]
    target_region = str(pending_edit.get("targetRegion") or "whole_image").strip()

    if preserve_items:
        positive = f"{positive}, preserve: {', '.join(preserve_items)}"
    if change_items:
        positive = f"{positive}, focus adjustments on {target_region}: {', '.join(change_items)}"

    negative = current.get("negative") or FALLBACK_NEGATIVE
    if scene and scene["negative"] not in negative:
        negative = f"{negative}, {scene['negative']}"
    if avoid_items:
        negative = f"{negative}, {', '.join(avoid_items)}"

    mode = str(pending_edit.get("operationHint") or "").strip() or "variation"
    if mode == "none":
        mode = "variation"
    refine_instruction_parts = [
        "Create a refined new version based on the current image",
        f"Focus on {target_region}" if target_region else "",
        f"Keep: {', '.join(preserve_items)}" if preserve_items else "",
        f"Change: {', '.join(change_items)}" if change_items else "",
        f"Avoid: {', '.join(avoid_items)}" if avoid_items else "",
        f"Additional user feedback: {user_message.strip()}" if user_message.strip() else "",
    ]

    return {
        "mode": mode,
        "positive": positive,
        "negative": negative,
        "model": settings.agent_refine_model,
        "instruction": _join_instruction_sentences(refine_instruction_parts),
        "constraints": _build_instruction_constraints(
            must_include=change_items,
            avoid=avoid_items,
            preserve=preserve_items,
        ),
        "parameters": {
            "aspectRatio": str(((current.get("parameters") or {}).get("aspectRatio")) or (intent.get("aspectRatio") or _intent_size(intent))),
            "size": (current.get("parameters") or {}).get("size") or settings.agent_image_size,
            "resolution": (current.get("parameters") or {}).get("resolution") or settings.agent_image_resolution,
        },
        "reasoningForUser": "我会基于当前版本保留满意部分，只把你点到的区域继续细修。",
        "promptReasoning": f"使用 {settings.agent_refine_model} 在保留现有画面核心主体的基础上按用户反馈迭代。",
    }


def summarize_project_title(state: dict[str, Any], fallback: str) -> str:
    subject = (state.get("intent") or {}).get("subject") or ""
    title = " ".join(str(subject).split())[:32].strip()
    return title or " ".join((fallback or "").split())[:32].strip() or "新项目"


def make_sse(event: str, payload: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _extract_json_block(text: str) -> Optional[dict[str, Any]]:
    if not text:
        return None
    patterns = (
        r"\[\[VISUAL_INTENT_PATCH\]\]\s*(\{.*\})",
        r"\[\[ACTION_INTENT\]\]\s*(\{.*\})",
        r"<visual_intent_patch>\s*(\{.*\})\s*</visual_intent_patch>",
        r"<action_intent>\s*(\{.*\})\s*</action_intent>",
        r"```json\s*(\{.*\})\s*```",
    )
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.S)
        if not match:
            continue
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            continue
    return None


def strip_action_block(text: str) -> str:
    cleaned = re.sub(r"\[\[VISUAL_INTENT_PATCH\]\]\s*\{.*\}\s*$", "", text or "", flags=re.S).strip()
    cleaned = re.sub(r"<visual_intent_patch>\s*\{.*\}\s*</visual_intent_patch>", "", cleaned, flags=re.S).strip()
    cleaned = re.sub(r"\[\[ACTION_INTENT\]\]\s*\{.*\}\s*$", "", cleaned, flags=re.S).strip()
    cleaned = re.sub(r"<action_intent>\s*\{.*\}\s*</action_intent>", "", cleaned, flags=re.S).strip()
    cleaned = re.sub(r"```json\s*\{.*\}\s*```", "", cleaned, flags=re.S).strip()
    return cleaned


def _chat_completions_endpoint(base_url: str) -> str:
    clean = (base_url or "").rstrip("/")
    if clean.endswith("/v1"):
        return clean + "/chat/completions"
    return clean + "/v1/chat/completions"


def _extract_first_json_object(text: str) -> Optional[dict[str, Any]]:
    if not text:
        return None
    match = re.search(r"(\{.*\})", text, flags=re.S)
    if not match:
        return None
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError:
        return None


def _looks_like_vlm_refusal(text: str) -> bool:
    lowered = (text or "").strip().lower()
    if not lowered:
        return True
    refusal_markers = (
        "i'm unable to assist with that",
        "i am unable to assist with that",
        "unable to assist",
        "can't help with that",
        "cannot help with that",
        "sorry",
        "抱歉",
        "无法协助",
        "不能帮助",
    )
    return any(marker in lowered for marker in refusal_markers)


def _normalize_reference_analysis(parsed: dict[str, Any], raw_message: str) -> Optional[ReferenceImageAnalysis]:
    summary = str(parsed.get("summary") or "").strip()
    extracted_info = parsed.get("extractedInfo") or {}
    notable_elements = [str(item).strip() for item in (parsed.get("notableElements") or []) if str(item).strip()]
    if _looks_like_vlm_refusal(raw_message):
        return None
    if not summary and not extracted_info and not notable_elements:
        return None
    return ReferenceImageAnalysis(
        summary=summary,
        extracted_info=extracted_info,
        notable_elements=notable_elements,
    )


async def analyze_reference_images(
    reference_images: list[tuple[bytes, str]],
    user_message: str,
    state: dict[str, Any],
) -> Optional[ReferenceImageAnalysis]:
    if not reference_images or not settings.agent_vlm_api_key:
        return None
    content: list[dict[str, Any]] = [{
        "type": "text",
        "text": f"""你是视觉参考图分析助手。请阅读用户上传的参考图，并返回 JSON：
{{"summary":"1到2句中文总结","extractedInfo":{{"subject":"","style":"","mood":"","composition":"","colorPalette":"","lighting":"","useCase":""}},"notableElements":["..."]}}

要求：
1. 只总结看得见的视觉特征，不要编造品牌或材质。
2. summary 用中文，适合作为后续创意对话的上下文。
3. extractedInfo 里只填写能从图片里较明确判断的信息。

当前项目意图：
{json.dumps(state.get("intent") or {}, ensure_ascii=False)}

用户这次说：
{user_message}
"""
    }]
    for image_bytes, filename in reference_images[:9]:
        mime = mimetypes.guess_type(filename or "")[0] or "image/png"
        encoded = base64.b64encode(image_bytes).decode("ascii")
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:{mime};base64,{encoded}"},
        })
    try:
        async with httpx.AsyncClient(timeout=settings.agent_vlm_timeout_seconds, trust_env=False) as client:
            resp = await client.post(
                _chat_completions_endpoint(settings.agent_vlm_base_url),
                headers={
                    "Authorization": f"Bearer {settings.agent_vlm_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.agent_vlm_model,
                    "messages": [{"role": "user", "content": content}],
                    "max_tokens": 700,
                    "temperature": 0.2,
                    "stream": False,
                },
            )
        if resp.status_code != 200:
            return None
        data = resp.json()
        message = (((data or {}).get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        parsed = _extract_first_json_object(message) or {}
        return _normalize_reference_analysis(parsed, message)
    except Exception:
        logger.exception("reference image analysis failed")
        return None


async def call_agent_llm(
    user_message: str,
    state: dict[str, Any],
    recent_messages: list[dict[str, Any]],
    reference_context: str = "",
    skill_context: str = "",
    *,
    on_chunk: Callable[[str], None] | None = None,
    on_think: Callable[[str], None] | None = None,
) -> tuple[str, VisualIntentPatch]:
    """调用 Agent LLM，返回 (展示用文本, 结构化状态补丁)。

    当 on_chunk 不为 None 时，使用 stream=True 逐 token 回调；
    当 on_think 不为 None 时，实时回调模型的 reasoning_content（思考过程）。
    """
    if not settings.agent_llm_api_key:
        raise RuntimeError("AGENT_LLM_API_KEY 未配置")
    history_lines = []
    for item in recent_messages[-6:]:
        role = "用户" if item.get("role") == "user" else "助手"
        text = (item.get("text") or "").strip()
        if text:
            history_lines.append(f"[{role}] {text[:200]}")
    history_block = "\n".join(history_lines) or "（暂无）"
    prompt = f"""你是 Muse，一个会和用户一起把创意聊清楚的视觉创意搭档。

⚠️ 重要：系统会自动从你的回复末尾提取 JSON，用户看不到它。绝对不要在对话文字中提及 [[VISUAL_INTENT_PATCH]]、JSON、格式、字段名等技术细节。只把 JSON 块放在最后一行，前面完全是自然对话。

先自然回复用户，再在最后一行的 [[VISUAL_INTENT_PATCH]] 块中输出 JSON：
[[VISUAL_INTENT_PATCH]]{{...}}

要求：
1. 回复用中文，2到4句，自然、像设计师同事，不要列表。
2. 你的首要任务是确认和用户对创意方向达成了共识。如果你在某个维度上是在猜测，请告诉用户你的猜测，让对方确认或纠正。
3. 如果用户说"你来定/自由发挥/随便"，就在 patch 里写入 userAuthorizedFreedom=true。
4. JSON 中只保留你本轮新提取的信息，没有就留空对象。
5. 如果参考图分析里明确写了用户已经上传参考图，不要再要求用户重复上传参考图。
6. 如果本轮用户明确确认了方向，turnType 用 confirm。
7. 如果用户给了文案/标题/画幅/比例/禁忌/背景/字体风格，请务必写入 patch：
   - copyText：主标题/主文案，用户要求出现在画面里的精确文字
   - subtitleText：副标题/副文案，用户要求出现在画面里的第二段精确文字
   - backgroundStyle：背景风格，例如“米白统一背景 / 发布会舞台背景 / 极简纯色背景”
   - titleFontStyle：主标题字体风格，例如“高级力量感 / 几何无衬线 / 科技感字形”
   - subtitleFontStyle：副标题字体风格，例如“简约现代 / 信息型无衬线”
   - safeArea：文字安全区域要求，例如“文字不贴边，不被主体遮挡”
   - aspectRatio：例如 "3:4"、"9:16"
   - mustInclude：必须出现的元素
   - avoid：必须避免的元素
8. 你的职责是描述“这句话如何修改当前视觉任务状态”，不是替系统做最终动作决策。不要输出 REQUEST_GENERATE / PRESENT_BRIEF / REQUEST_REFINE 之类动作词。
9. turnType 只从这些值里选一个：create_new / add_detail / select_variant / revise_image / reject_result / confirm / ask_question / export
10. operationHint 只从这些值里选一个：text_to_image / variation / inpaint / outpaint / upscale / text_overlay / none

当前项目状态：
{json.dumps(state, ensure_ascii=False)}

最近对话：
{history_block}

参考图分析：
{reference_context or "（无）"}

当前启用 Skill：
{skill_context or "（无）"}

用户这次说：
{user_message}

输出示例：
[[VISUAL_INTENT_PATCH]]{{"turnType":"add_detail","operationHint":"text_to_image","targetRegion":"whole_image","patch":{{"subject":"...","style":"...","backgroundStyle":"...","copyText":"...","subtitleText":"...","titleFontStyle":"...","subtitleFontStyle":"...","safeArea":"...","aspectRatio":"3:4","avoid":"..."}},"preserve":[],"change":["style"],"avoid":["..."],"assumptions":[],"missingCriticalInfo":[],"confidence":0.72,"creativeSuggestion":"..."}}"""

    use_stream = on_chunk is not None

    # R1/QwQ 原生 reasoning，不需要 enable_thinking；GPT 系列也不需要
    model_lower = (settings.agent_llm_model or "").lower()
    needs_thinking_param = not any(k in model_lower for k in ("r1", "qwq", "reasoning", "gpt"))

    payload: dict[str, Any] = {
        "model": settings.agent_llm_model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 2048,
        "temperature": 0.8,
        "stream": use_stream,
    }
    if needs_thinking_param:
        payload["enable_thinking"] = True

    headers = {
        "Authorization": f"Bearer {settings.agent_llm_api_key}",
        "Content-Type": "application/json",
    }
    accumulated = ""
    if use_stream:
        # ── 流式路径：逐 token 回调，自动过滤结构化 patch ──
        safe_len = 0  # 已回调给调用方的安全字符数
        async with httpx.AsyncClient(timeout=settings.agent_llm_timeout_seconds, trust_env=False) as client:
            async with client.stream(
                "POST",
                _chat_completions_endpoint(settings.agent_llm_base_url),
                headers=headers,
                json=payload,
            ) as resp:
                if resp.status_code != 200:
                    raw = await resp.aread()
                    raise RuntimeError(f"Agent LLM error: {raw.decode('utf-8', errors='ignore')[:240]}")
                async for line in resp.aiter_lines():
                    if not line or not line.startswith("data: "):
                        continue
                    data_str = line[6:]
                    if data_str.strip() == "[DONE]":
                        break
                    try:
                        data = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue
                    delta_content = ""
                    delta_reasoning = ""
                    try:
                        choice_delta = ((((data or {}).get("choices") or [{}])[0].get("delta") or {}))
                        delta_content = choice_delta.get("content") or ""
                        delta_reasoning = choice_delta.get("reasoning_content") or ""
                    except Exception:
                        pass

                    if delta_reasoning and on_think:
                        on_think(delta_reasoning)

                    if not delta_content:
                        continue

                    accumulated += delta_content

                    markers = ["[[VISUAL_INTENT_PATCH]]", "[[ACTION_INTENT]]"]
                    marker_positions = [accumulated.find(marker) for marker in markers if accumulated.find(marker) >= 0]
                    patch_idx = min(marker_positions) if marker_positions else -1
                    if patch_idx >= 0:
                        if patch_idx > safe_len:
                            on_chunk(accumulated[safe_len:patch_idx])
                        safe_len = len(accumulated)
                    elif safe_len < len(accumulated):
                        new_text = accumulated[safe_len:]
                        on_chunk(new_text)
                        safe_len = len(accumulated)
    else:
        async with httpx.AsyncClient(timeout=settings.agent_llm_timeout_seconds, trust_env=False) as client:
            resp = await client.post(
                _chat_completions_endpoint(settings.agent_llm_base_url),
                headers=headers,
                json=payload,
            )
            if resp.status_code != 200:
                raise RuntimeError(f"Agent LLM error: {resp.text[:240]}")
            data = resp.json()
            accumulated = (((data or {}).get("choices") or [{}])[0].get("message") or {}).get("content") or ""

    # 提取 VisualIntentPatch
    parsed = _extract_json_block(accumulated) or {}
    patch_payload = parsed.get("patch") if isinstance(parsed.get("patch"), dict) else {}
    if not patch_payload and isinstance(parsed.get("extractedInfo"), dict):
        patch_payload = parsed.get("extractedInfo") or {}
    action = VisualIntentPatch(
        turn_type=str(parsed.get("turnType") or parsed.get("type") or "add_detail"),
        target_image_id=str(parsed.get("targetImageId") or "").strip() or None,
        target_region=str(parsed.get("targetRegion") or "whole_image"),
        operation_hint=str(parsed.get("operationHint") or "none"),
        patch=patch_payload,
        preserve=[str(item).strip() for item in (parsed.get("preserve") or []) if str(item).strip()],
        change=[str(item).strip() for item in (parsed.get("change") or []) if str(item).strip()],
        avoid=[str(item).strip() for item in (parsed.get("avoid") or []) if str(item).strip()],
        assumptions=[str(item).strip() for item in (parsed.get("assumptions") or []) if str(item).strip()],
        missing_critical_info=[str(item).strip() for item in (parsed.get("missingCriticalInfo") or parsed.get("openQuestions") or []) if str(item).strip()],
        confidence=max(0.0, min(1.0, float(parsed.get("confidence") or 0.5))),
        creative_suggestion=str(parsed.get("creativeSuggestion") or ""),
    )
    return strip_action_block(accumulated), action


def decide_next_action(state: dict[str, Any], action_intent: VisualIntentPatch, user_message: str) -> dict[str, Any]:
    if detect_free_play(user_message):
        state.setdefault("intent", {})["userAuthorizedFreedom"] = True

    readiness = calculate_operation_readiness(state, action_intent)

    if action_intent.turn_type == "ask_question" and action_intent.missing_critical_info:
        question_meta = pick_question(state, action_intent.missing_critical_info)
        return _build_ask_action(
            state,
            question=question_meta["question"],
            dimension=action_intent.missing_critical_info[0],
            choices=question_meta.get("choices", []),
            readiness=readiness,
        )

    if action_intent.turn_type == "reject_result":
        return _build_ask_action(
            state,
            question="我收到这版不对了。先告诉我最想改的是主体、风格、构图、颜色，还是画面气质？我只抓最关键的那个点继续收。",
            dimension=(action_intent.missing_critical_info[0] if action_intent.missing_critical_info else "feedback"),
            choices=[],
            readiness=readiness,
        )

    if detect_regenerate(user_message) and (state.get("brief") or state.get("currentPrompt")):
        completeness = calculate_completeness(state)
        return {
            "type": "GENERATE",
            "prompt": build_generation_prompt(state),
            "brief": build_brief(state),
            "contract": build_creative_contract(state),
            "completeness": completeness.model_dump(),
            "operationReadiness": readiness.model_dump(),
        }

    if action_intent.turn_type in {"revise_image", "select_variant"}:
        if readiness.executable:
            return {
                "type": "REFINE",
                "prompt": build_refine_prompt(state, user_message),
                "operationReadiness": readiness.model_dump(),
            }
        return _build_ask_action(
            state,
            question="我可以继续细修，但当前还没有可继承的图。要不要先确定方向并生成第一版？",
            dimension="current_image",
            choices=[],
            readiness=readiness,
        )

    if detect_refine(user_message, state):
        return {
            "type": "REFINE",
            "prompt": build_refine_prompt(state, user_message),
            "operationReadiness": readiness.model_dump(),
        }

    completeness = calculate_completeness(state)
    confirmation_gaps = get_confirmation_gaps(state)

    if action_intent.turn_type == "confirm" or detect_confirm(user_message):
        if confirmation_gaps:
            q = pick_question(state, [confirmation_gaps[0]])
            return _build_ask_action(
                state,
                question=q["question"],
                dimension=confirmation_gaps[0],
                choices=q.get("choices", []),
                completeness=completeness,
                readiness=readiness,
            )
        return {
            "type": "GENERATE",
            "prompt": build_generation_prompt(state),
            "brief": build_brief(state),
            "contract": build_creative_contract(state),
            "completeness": completeness.model_dump(),
            "operationReadiness": readiness.model_dump(),
        }

    if completeness.critical_gaps:
        q = pick_question(state, completeness.critical_gaps)
        return _build_ask_action(
            state,
            question=q["question"],
            dimension=completeness.critical_gaps[0],
            choices=q.get("choices", []),
            completeness=completeness,
            readiness=readiness,
        )

    if completeness.can_generate:
        if confirmation_gaps:
            q = pick_question(state, [confirmation_gaps[0]])
            return _build_ask_action(
                state,
                question=q["question"],
                dimension=confirmation_gaps[0],
                choices=q.get("choices", []),
                completeness=completeness,
                readiness=readiness,
            )
        brief = state.get("brief")
        if not brief or not brief.get("confirmedByUser"):
            return _build_confirm_action(state, completeness, action_intent, readiness)
        return {
            "type": "GENERATE",
            "prompt": build_generation_prompt(state),
            "brief": build_brief(state),
            "contract": build_creative_contract(state),
            "completeness": completeness.model_dump(),
            "operationReadiness": readiness.model_dump(),
        }

    if int((state.get("phase") or {}).get("turnsInStage") or 0) >= MAX_TURNS_PER_STAGE:
        return {
            "type": "EXPLORE",
            "suggestion": action_intent.creative_suggestion or "我先帮你定一个方向试试，如果不对可以随时告诉我调整。",
            "completeness": completeness.model_dump(),
            "operationReadiness": readiness.model_dump(),
        }

    if completeness.inferrable_gaps:
        high_weight_gaps = [g for g in completeness.inferrable_gaps if g in ("overallStyle", "backgroundStyle", "purpose", "titleFontStyle", "subtitleFontStyle")]
        if high_weight_gaps:
            q = pick_question(state, [high_weight_gaps[0]])
            return _build_ask_action(
                state,
                question=q["question"],
                dimension=high_weight_gaps[0],
                choices=q.get("choices", []),
                completeness=completeness,
                readiness=readiness,
            )
        defaults = infer_defaults(state.get("intent") or {}, completeness.inferrable_gaps)
        state["intent"] = merge_intent(state.get("intent") or {}, defaults)
        brief = build_brief(state)
        return {"type": "CONFIRM", "brief": brief, "contract": build_creative_contract(state), "completeness": completeness.model_dump(), "operationReadiness": readiness.model_dump()}

    return {"type": "CONFIRM", "brief": build_brief(state), "contract": build_creative_contract(state), "completeness": completeness.model_dump(), "operationReadiness": readiness.model_dump()}


def _brief_fragment(intent: dict[str, Any]) -> str:
    parts = []
    for key in ("subject", "useCase", "aspectRatio", "copyText"):
        value = str(intent.get(key) or "").strip()
        if value:
            parts.append(value)
    return "，".join(parts) or "当前创意方向"


def _build_creative_quick_actions(
    state: dict[str, Any],
    action_intent: VisualIntentPatch | None = None,
) -> list[dict[str, str]]:
    """基于当前 brief 生成拓展方向，避免全局固定三连按钮。"""
    intent = state.get("intent") or {}
    scene = _match_prompt_scene(intent)
    scene_name = scene["name"] if scene else "通用设计"
    base = _brief_fragment(intent)
    style_text = str(intent.get("style") or "")
    mood_text = str(intent.get("mood") or "")
    color_text = str(intent.get("colorPalette") or "")
    copy_text = str(intent.get("copyText") or "").strip()

    candidates: list[tuple[str, str]] = []
    if scene_name == "人物封面海报":
        candidates.extend([
            ("黑白杂志封面", f"换个方向：保留{base}，改成黑白高反差杂志封面，人物更有力量感，标题留白更克制"),
            ("未来冷光封面", f"换个方向：保留{base}，加入冷色未来光效和更锋利的竖版构图，避免商品广告感"),
            ("极简留白封面", f"换个方向：保留{base}，做极简留白人物封面，减少装饰，把情绪和标题作为视觉核心"),
            ("更强眼神张力", f"换个方向：保留{base}，强化人物眼神、面部轮廓和封面压迫感，整体更有态度"),
        ])
    elif scene_name == "白底产品图":
        candidates.extend([
            ("更干净白底", f"换个方向：保留{base}，做更干净的白底商业产品图，突出轮廓、材质和阴影层次"),
            ("轻奢棚拍", f"换个方向：保留{base}，改成轻奢棚拍质感，用柔和高光突出产品高级感"),
            ("结构更利落", f"换个方向：保留{base}，减少干扰元素，强化产品正面结构和电商主图识别度"),
        ])
    elif scene_name == "电商海报":
        candidates.extend([
            ("强化卖点层级", f"换个方向：保留{base}，加强商品卖点层级、主视觉冲击和活动氛围"),
            ("高级商业大片", f"换个方向：保留{base}，做成高级商业摄影海报，光影更戏剧化，画面更像品牌大片"),
            ("更强购买欲", f"换个方向：保留{base}，增强促销节奏和视觉焦点，让用户第一眼看到核心卖点"),
        ])
    elif scene_name == "产品场景图":
        candidates.extend([
            ("自然生活场景", f"换个方向：保留{base}，放进自然生活场景，光线更真实，产品存在感不要丢"),
            ("高级空间场景", f"换个方向：保留{base}，改成高级室内空间场景，用环境衬托产品质感"),
            ("户外氛围感", f"换个方向：保留{base}，尝试户外自然光氛围，构图更松弛但产品仍是核心"),
        ])
    elif scene_name == "时尚画册":
        candidates.extend([
            ("街头画册感", f"换个方向：保留{base}，改成街头时尚画册风，姿态、光影和背景更有潮流感"),
            ("运动机能风", f"换个方向：保留{base}，强化运动机能和速度感，画面更有能量"),
            ("高级大片风", f"换个方向：保留{base}，做成高级时尚大片，减少电商感，提升摄影质感"),
        ])
    elif scene_name == "汽车发售海报":
        candidates.extend([
            ("速度感更强", f"换个方向：保留{base}，强化车身姿态、路面运动模糊和速度张力，让发售气势更强"),
            ("发布会质感", f"换个方向：保留{base}，改成更像品牌发布会 KV 的方向，灯光更克制，车更有雕塑感"),
            ("黄昏大片感", f"换个方向：保留{base}，保留黄昏公路氛围，把天空层次、车灯反光和标题区做得更有电影感"),
        ])
    elif scene_name == "社媒配图":
        candidates.extend([
            ("小红书停留率", f"换个方向：保留{base}，强化小红书封面停留率，主体更醒目，信息更聚焦"),
            ("轻盈种草感", f"换个方向：保留{base}，做得更自然轻盈，像真实可发布的社媒种草图"),
            ("更强封面感", f"换个方向：保留{base}，强化封面视觉锚点和标题区域，让缩略图更好读"),
        ])
    else:
        candidates.extend([
            ("更高级克制", f"换个方向：保留{base}，整体做得更高级、更克制，减少廉价装饰"),
            ("更强视觉冲击", f"换个方向：保留{base}，强化构图张力、光影对比和第一眼记忆点"),
            ("更商业可用", f"换个方向：保留{base}，提升商业落地感，让画面更适合直接投放和复用"),
        ])

    if copy_text:
        candidates.append(("强化文案张力", f"换个方向：保留文案“{copy_text}”，让文字成为画面核心视觉之一，排版更有封面张力"))
    if "黑白" in color_text or "黑白" in style_text:
        candidates.append(("黑白更极致", f"换个方向：保留{base}，把黑白对比做得更极致，提升明暗层次和高级感"))
    if "未来" in mood_text or "未来" in style_text:
        candidates.append(("未来感更明确", f"换个方向：保留{base}，强化未来感材质、冷光和空间纵深，但不要偏科幻杂乱"))
    if action_intent and action_intent.creative_suggestion:
        suggestion = action_intent.creative_suggestion.strip()
        if 6 <= len(suggestion) <= 120:
            candidates.append(("采用 Agent 方案", suggestion))

    seen: set[str] = set()
    unique = []
    for label, value in candidates:
        if label in seen:
            continue
        seen.add(label)
        unique.append({"label": label, "value": value})

    logs = (((state.get("metadata") or {}).get("decisionLogs")) or [])
    signature = json.dumps(intent, ensure_ascii=False, sort_keys=True) + str(len(logs))
    offset = int(hashlib.sha1(signature.encode("utf-8")).hexdigest()[:6], 16) % max(1, len(unique))
    rotated = unique[offset:] + unique[:offset]
    return [{"label": "确认，开始生成", "value": "确认，开始生成"}] + rotated[:2]


def _build_confirm_action(
    state: dict[str, Any],
    completeness: AgentCompletenessResult,
    action_intent: VisualIntentPatch | None = None,
    readiness: AgentOperationReadiness | None = None,
) -> dict[str, Any]:
    """构造 CONFIRM 动作，给出基于当前 brief 的少量拓展方向。"""
    quick_actions = _build_creative_quick_actions(state, action_intent)
    payload = {
        "type": "CONFIRM",
        "brief": build_brief(state),
        "contract": build_creative_contract(state),
        "completeness": completeness.model_dump(),
        "quickActions": quick_actions,
    }
    if readiness is not None:
        payload["operationReadiness"] = readiness.model_dump()
    return payload


def apply_decision_to_state(state: dict[str, Any], decision: dict[str, Any], user_message: str) -> dict[str, Any]:
    updated = _deep_copy_json(state)
    phase = updated.setdefault("phase", {"stage": "exploring", "turnsInStage": 0})
    phase["turnsInStage"] = int(phase.get("turnsInStage") or 0) + 1
    kind = decision.get("type")
    if kind in {"ASK", "EXPLORE", "CONFIRM"}:
        phase["stage"] = "exploring"
    elif kind == "GENERATE":
        phase["stage"] = "generating"
        updated["currentPrompt"] = decision.get("prompt")
        updated["brief"] = decision.get("brief") or updated.get("brief") or build_brief(updated)
    elif kind == "REFINE":
        phase["stage"] = "refining"
        updated["currentPrompt"] = decision.get("prompt")
    if kind == "CONFIRM" and decision.get("brief"):
        updated["brief"] = decision["brief"]
        # confirmedByUser 不持久化，状态由 normalize_project_state 每次重置
    if decision.get("contract"):
        updated.setdefault("metadata", {})["creativeContract"] = decision.get("contract")
    logs = (((updated.get("metadata") or {}).get("decisionLogs")) or [])
    logs.append({"type": kind, "at": math.floor(time.time()), "userMessage": user_message[:200]})
    updated.setdefault("metadata", {})["decisionLogs"] = logs[-20:]
    return updated


async def run_vlm_critic(image_url: str, state: dict[str, Any]) -> dict[str, Any]:
    """VLM 质检：拿实际生成的图片，与「用户确认过的 Brief + generation instruction」逐项对比。"""
    summary = "图片已生成，但视觉质检暂未完成。"
    result = {
        "qualityScore": 0,
        "intentMatch": 0,
        "briefMatch": {},  # 每个 brief 维度的独立评分
        "autoRetry": False,
        "satisfiedElements": [],
        "problemElements": ["VLM 质检未完成，不能判断是否符合 brief"],
        "iterationDiff": {"keep": [], "adjust": [], "promptDelta": {"add": [], "remove": [], "modify": {}}},
        "userFacingSummary": summary,
        "confidence": 0.0,
        "nextStepSuggestion": "",
        "status": "not_checked",
    }
    if not settings.agent_vlm_api_key:
        return result

    # 将图片转为 base64 data URL
    image_data_url = await _resolve_image_data_url(image_url)
    if not image_data_url:
        logger.warning("vlm_critic: unable to resolve image for %s", image_url)
        return result

    prompt_payload = state.get("currentPrompt") or {}
    instruction_payload = {
        "mode": prompt_payload.get("mode"),
        "instruction": prompt_payload.get("instruction"),
        "constraints": prompt_payload.get("constraints"),
        "parameters": prompt_payload.get("parameters"),
        "reasoningForUser": prompt_payload.get("reasoningForUser"),
    }
    brief = state.get("brief") or {}
    # 把 brief 各维度拆成结构化检查点
    brief_dimensions = []
    if brief.get("concept"):
        brief_dimensions.append(("核心方案 (concept)", brief["concept"]))
    if brief.get("visualElements"):
        for el in (brief["visualElements"] if isinstance(brief["visualElements"], list) else [brief["visualElements"]]):
            if el:
                brief_dimensions.append(("视觉要素 (visualElement)", el))
    if brief.get("style"):
        brief_dimensions.append(("风格 (style)", brief["style"]))
    if brief.get("mood"):
        brief_dimensions.append(("氛围 (mood)", brief["mood"]))
    if brief.get("colorDirection"):
        brief_dimensions.append(("色彩方向 (colorDirection)", brief["colorDirection"]))

    brief_checklist = "\n".join(f"  - {name}：{val}" for name, val in brief_dimensions) or "  (无明确维度)"

    content: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": f"""你是图片质检助手。拿用户确认过的 Brief 与实际执行的 generation instruction 逐项对比，判断生成图是否同时满足两者。

【用户确认 Brief】（用户在 Agent 流程中点过「确认，开始生成」的方案，权威基准）
{json.dumps(brief, ensure_ascii=False, indent=2)}

【Brief 各维度拆解】
{brief_checklist}

【实际生成指令】（instruction / constraints / parameters 是执行标准）
{json.dumps(instruction_payload, ensure_ascii=False, indent=2)}

判断要求：
1. **核心方案**：图片是否表达 Brief 的 concept
2. **视觉要素**：brief.visualElements 列出的每项是否在图中出现
3. **风格 / 氛围 / 色彩**：是否匹配
4. **避免项**：图片是否包含 constraints.avoid 禁止的元素（如品牌名、错别字、不该出现的包装）
5. **文案准确性**：若 brief.copyText 里有具体文字，画面文字是否正确
6. **质量**：清晰度、构图、色彩

请返回 JSON：
{{
  "qualityScore": 0-100,
  "intentMatch": 0-100,
  "confidence": 0.0-1.0,                    // 你对这次判断的把握度
  "briefMatch": {{                              // 逐维度评分（0-100），不存在的维度省略
    "concept": 0-100,
    "visualElements": 0-100,
    "style": 0-100,
    "mood": 0-100,
    "colorDirection": 0-100
  }},
  "satisfiedElements": ["满足 Brief 的具体点"],
  "problemElements": ["未满足或违反的具体点"],
  "userFacingSummary": "一句中文（不超过 30 字）说明图片是否达到 Brief 要求",
  "nextStepSuggestion": "如果完全满意，填「可以基于这版微调」；如需改进，填具体调整方向",
  "iterationDiff": {{
    "keep": ["建议保留的元素"],
    "adjust": ["建议调整的元素"],
    "promptDelta": {{"add": [], "remove": [], "modify": {{"key": "value"}}}}
  }}
}}""",
        },
        {"type": "image_url", "image_url": {"url": image_data_url}},
    ]

    try:
        async with httpx.AsyncClient(timeout=settings.agent_vlm_timeout_seconds, trust_env=False) as client:
            resp = await client.post(
                _chat_completions_endpoint(settings.agent_vlm_base_url),
                headers={
                    "Authorization": f"Bearer {settings.agent_vlm_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.agent_vlm_model,
                    "messages": [{"role": "user", "content": content}],
                    "max_tokens": 600,
                    "temperature": 0.2,
                    "stream": False,
                },
            )
        if resp.status_code == 200:
            data = resp.json()
            content_text = (((data or {}).get("choices") or [{}])[0].get("message") or {}).get("content") or ""
            match = re.search(r"(\{.*\})", content_text, flags=re.S)
            if match:
                parsed = json.loads(match.group(1))
                result["qualityScore"] = int(parsed.get("qualityScore") or result["qualityScore"])
                result["intentMatch"] = int(parsed.get("intentMatch") or result["intentMatch"])
                if isinstance(parsed.get("briefMatch"), dict):
                    result["briefMatch"] = parsed.get("briefMatch")
                if isinstance(parsed.get("satisfiedElements"), list):
                    result["satisfiedElements"] = parsed.get("satisfiedElements")
                if isinstance(parsed.get("problemElements"), list):
                    result["problemElements"] = parsed.get("problemElements")
                if isinstance(parsed.get("iterationDiff"), dict):
                    result["iterationDiff"] = parsed["iterationDiff"]
                result["userFacingSummary"] = str(parsed.get("userFacingSummary") or result["userFacingSummary"])
                result["nextStepSuggestion"] = str(parsed.get("nextStepSuggestion") or "")
                if isinstance(parsed.get("confidence"), (int, float)):
                    result["confidence"] = float(parsed["confidence"])
                # autoRetry：质量分<50 或 intentMatch<50 且 confidence>0.6 时建议自动重试
                if (result["qualityScore"] < 50 or result["intentMatch"] < 50) and result["confidence"] > 0.6:
                    result["autoRetry"] = True
                result["status"] = "checked"
    except Exception:
        logger.exception("vlm critic failed")
    return result


async def _resolve_image_data_url(image_url: str) -> str:
    """将图片 URL（本地路径或远程 URL）解析为 base64 data URL。"""
    if not image_url:
        return ""

    # 已经是 data URL
    if image_url.startswith("data:image/"):
        return image_url

    image_bytes: bytes | None = None
    mime_type = "image/png"

    # 本地路径：/ai-images/{user_id}/... 或 /ai-images/{user_id}/{YYYY-MM-DD}/...
    if image_url.startswith("/ai-images/") or image_url.startswith("/results/"):
        local_path = settings.output_path / image_url.lstrip("/")
        if local_path.exists():
            image_bytes = local_path.read_bytes()
            mime_type = mimetypes.guess_type(str(local_path))[0] or "image/png"

    # 远程 URL
    if image_bytes is None and image_url.startswith(("http://", "https://")):
        try:
            async with httpx.AsyncClient(timeout=15, trust_env=False) as client:
                fetch_resp = await client.get(image_url)
                if fetch_resp.status_code == 200:
                    image_bytes = fetch_resp.content
                    content_type = fetch_resp.headers.get("content-type", "")
                    if content_type and content_type.startswith("image/"):
                        mime_type = content_type.split(";")[0].strip()
        except Exception:
            logger.warning("vlm_critic: failed to fetch remote image %s", image_url[:120])

    if not image_bytes:
        return ""

    encoded = base64.b64encode(image_bytes).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def _log_agent_image_action(
    *,
    user_id: str,
    username: str,
    resolved_model: str,
    size: str,
    reference_images: Optional[list[tuple[bytes, str]]],
    success: bool,
    error: Optional[BaseException] = None,
    result: Optional[dict[str, Any]] = None,
) -> None:
    """记录 Agent 触发的生图操作到 operation_logs。

    失败/成功都记，方便 Admin 在管理后台看到。
    username 兜底按 user_id 反查 users 表，避免伪造 "agent" 字符串。
    """
    try:
        from .job_store import log_operation as _log_op
        # username 反查
        resolved_username = username
        if not resolved_username:
            try:
                from .job_store import _connect as _job_connect
                with _job_connect() as _conn:
                    _row = _conn.execute("SELECT username FROM users WHERE id = ?", (user_id,)).fetchone()
                    if _row:
                        resolved_username = _row["username"]
            except Exception:
                logger.exception("agent: failed to look up username for user_id=%s", user_id)

        ref_count = len(reference_images or [])
        if success and result:
            image_url = result.get("url", "")
            _log_op(
                user_id=user_id,
                username=resolved_username or "",
                action="ai_image",
                detail=f"agent_gen job={str(result.get('task_id') or '?')[:8]} model={resolved_model} size={size} refs={ref_count} image={image_url[:60]}",
                payload=json.dumps({
                    "source": "agent",
                    "model": resolved_model,
                    "size": size,
                    "image_url": image_url,
                    "usage": result.get("usage"),
                    "cost": result.get("cost"),
                    "ref_count": ref_count,
                }, ensure_ascii=False),
            )
        else:
            _log_op(
                user_id=user_id,
                username=resolved_username or "",
                action="ai_image",
                detail=f"agent_gen model={resolved_model} size={size} refs={ref_count} result=failed error={str(error or '')[:80]}",
                payload=json.dumps({
                    "source": "agent",
                    "model": resolved_model,
                    "size": size,
                    "ref_count": ref_count,
                    "error": str(error or "")[:500],
                }, ensure_ascii=False),
            )
    except Exception:
        logger.exception("agent: failed to log image gen operation")


async def stream_generation_events(
    *,
    state: dict[str, Any],
    user_id: str,
    username: str = "",
    prompt_payload: dict[str, Any],
    current_image: Optional[dict[str, Any]] = None,
    reference_images: Optional[list[tuple[bytes, str]]] = None,
) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    resolved_model = SLASH_MODEL_MAP.get(str(prompt_payload.get("model") or settings.agent_image_model).lower(), prompt_payload.get("model") or settings.agent_image_model)
    parameters = prompt_payload.get("parameters") or {}
    size = parameters.get("size") or settings.agent_image_size
    resolution = parameters.get("resolution") or settings.agent_image_resolution
    prompt = prompt_payload.get("positive") or prompt_payload.get("instruction") or ""
    mode = str(prompt_payload.get("mode") or "text_to_image").strip() or "text_to_image"
    yield "generation_started", {"jobId": None, "estimatedSeconds": 45}

    progress_queue: asyncio.Queue[tuple[int, str]] = asyncio.Queue()

    def on_progress(pct: int, api_status: str) -> None:
        try:
            progress_queue.put_nowait((int(pct or 0), api_status or ""))
        except Exception:
            pass

    async def _run_generation():
        refs = list(reference_images or [])
        if mode in {"variation", "inpaint", "outpaint", "upscale", "text_overlay"} and current_image and current_image.get("imageUrl", "").startswith("/ai-images/"):
            local_path = settings.output_path / "ai-images" / current_image["imageUrl"].split("/ai-images/", 1)[1]
            if local_path.exists():
                refs.insert(0, (local_path.read_bytes(), local_path.name))
        if refs:
            return await generate_image_with_reference_async(
                model=resolved_model,
                prompt=prompt,
                images=refs,
                size=size,
                resolution=resolution,
                user_id=user_id,
                on_progress=on_progress,
            )
        return await generate_image_async(
            model=resolved_model,
            prompt=prompt,
            size=size,
            resolution=resolution,
            user_id=user_id,
            on_progress=on_progress,
        )

    task = asyncio.create_task(_run_generation())
    last_progress = None
    while True:
        if task.done() and progress_queue.empty():
            break
        try:
            pct, _status = await asyncio.wait_for(progress_queue.get(), timeout=0.5)
            if pct != last_progress:
                last_progress = pct
                yield "generation_progress", {"progress": pct}
        except asyncio.TimeoutError:
            continue

    try:
        result = await task
    except Exception as exc:
        _log_agent_image_action(
            user_id=user_id, username=username, resolved_model=resolved_model, size=size,
            reference_images=reference_images, success=False, error=exc, result=result if False else None,
        )
        raise

    image_url = result.get("url", "")
    # 记录到操作日志：让管理后台能看到 Agent 触发的生图请求
    _log_agent_image_action(
        user_id=user_id, username=username, resolved_model=resolved_model, size=size,
        reference_images=reference_images, success=True, error=None, result=result,
    )
    yield "generation_completed", {
        "jobId": result.get("task_id"),
        "provider": result.get("provider"),
        "image": {
            "id": result.get("task_id") or result.get("url"),
            "url": result.get("url"),
            "width": None,
            "height": None,
        },
    }

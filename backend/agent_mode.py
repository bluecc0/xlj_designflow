from __future__ import annotations

import asyncio
import base64
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
            "product hero shot",
            "clean composition with copy space",
            "commercial advertising photography",
            "high-end retouching",
        ],
        "negative": (
            "cluttered, amateur, casual snapshot, messy background, "
            "low contrast, text, watermark, cropped product"
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
    "professional commercial photography, clean composition, "
    "studio lighting, product focused, high quality, sharp details"
)
FALLBACK_NEGATIVE = (
    "low quality, blurry, distorted, amateur, cluttered, "
    "text, watermark, ugly, deformed"
)

# 所有场景统一追加的质量后缀
QUALITY_SUFFIX = "masterpiece, best quality, highly detailed"


def _match_prompt_scene(intent: dict[str, Any]) -> dict[str, Any] | None:
    """根据用户意图匹配最合适的生图场景模板（命中关键词最多者优先）。"""
    search_text = " ".join([
        str(intent.get("subject") or ""),
        str(intent.get("style") or ""),
        str(intent.get("useCase") or ""),
        str(intent.get("mood") or ""),
    ]).lower()
    if not search_text.strip():
        return None

    best_scene = None
    best_hits = 0
    for key, scene in PROMPT_SCENES.items():
        match_keywords = scene["match"].lower().split()
        hits = sum(1 for kw in match_keywords if kw in search_text)
        if hits > best_hits:
            best_hits = hits
            best_scene = scene
    return best_scene


INTENT_KEYS = (
    "subject",
    "style",
    "mood",
    "composition",
    "colorPalette",
    "lighting",
    "useCase",
)

DIMENSIONS = (
    {"key": "subject", "weight": 30, "required": True, "inferrable": False},
    {"key": "style", "weight": 20, "required": False, "inferrable": True},
    {"key": "mood", "weight": 15, "required": False, "inferrable": True},
    {"key": "composition", "weight": 10, "required": False, "inferrable": True},
    {"key": "colorPalette", "weight": 10, "required": False, "inferrable": True},
    {"key": "lighting", "weight": 10, "required": False, "inferrable": True},
    {"key": "useCase", "weight": 5, "required": False, "inferrable": True},
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
    "start over",
    "new image",
    "new scene",
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


class AgentCompletenessResult(pydantic.BaseModel):
    score: float
    critical_gaps: list[str] = pydantic.Field(default_factory=list)
    inferrable_gaps: list[str] = pydantic.Field(default_factory=list)
    can_generate: bool = False


class AgentActionIntent(pydantic.BaseModel):
    type: str = "CONTINUE_CHAT"
    confidence: float = 0.5
    extracted_info: dict[str, Any] = pydantic.Field(default_factory=dict)
    open_questions: list[str] = pydantic.Field(default_factory=list)
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
    if detect_regenerate(message):
        return False
    return True


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


def _coarse_subject_from_message(message: str) -> str:
    text = (message or "").strip()
    if not text:
        return ""
    lowered = text.lower()
    for token in ("generate it now", "generate now", "generate it", "go ahead", "please", "帮我", "给我", "现在", "生成", "出图"):
        lowered = lowered.replace(token, " ")
        text = re.sub(re.escape(token), " ", text, flags=re.I)
    text = re.sub(r"\s+", " ", text).strip(" ,.，。!！?？")
    if len(text) < 4:
        return ""
    return text[:160]


def calculate_completeness(state: dict[str, Any]) -> AgentCompletenessResult:
    score = 0.0
    critical_gaps: list[str] = []
    inferrable_gaps: list[str] = []
    explicit_count = 0
    intent = state.get("intent") or {}
    for dim in DIMENSIONS:
        value = intent.get(dim["key"])
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


def pick_question(gaps: list[str]) -> dict[str, Any]:
    """根据缺失维度生成问题 + 结构化选项。"""
    templates: dict[str, dict[str, Any]] = {
        "subject": {
            "question": "我先帮你收一下核心信息，这张图最想表现的主体是什么？比如人物、产品、场景，或者某个具体物件。",
            "choices": [],  # 主体太开放，不适合选项
        },
        "useCase": {
            "question": "这张图主要用在哪里？",
            "choices": [
                {"label": "电商海报", "value": "电商海报"},
                {"label": "社媒配图", "value": "社媒配图"},
                {"label": "白底产品图", "value": "白底产品图"},
                {"label": "场景图", "value": "场景图"},
                {"label": "你来决定", "value": "你来决定"},
            ],
        },
        "style": {
            "question": "风格上你更偏好哪一种？",
            "choices": [
                {"label": "高级简约", "value": "高级简约风格"},
                {"label": "酷炫潮流", "value": "酷炫潮流风格"},
                {"label": "自然温暖", "value": "自然温暖风格"},
                {"label": "电影感大片", "value": "电影感大片风格"},
                {"label": "你来决定", "value": "你来决定"},
            ],
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
        "composition": {
            "question": "构图上有没有明确偏好？",
            "choices": [
                {"label": "产品居中特写", "value": "产品居中特写"},
                {"label": "场景纵深感", "value": "场景纵深构图"},
                {"label": "留白设计感", "value": "留白设计感构图"},
                {"label": "你来决定", "value": "你来决定"},
            ],
        },
    }
    for key in ("subject", "useCase", "style", "mood", "composition"):
        if key in gaps:
            return templates.get(key, {"question": "我再补一个关键点，这张图里你最在意的视觉信息是什么？", "choices": []})
    return {"question": "我再补一个关键点，这张图里你最在意的视觉信息是什么？", "choices": []}


def infer_defaults(intent: dict[str, Any], gaps: list[str]) -> dict[str, str]:
    subject = (intent.get("subject") or "").lower()
    defaults: dict[str, str] = {}
    if "style" in gaps:
        defaults["style"] = "cinematic commercial illustration" if any(token in subject for token in ("product", "shoe", "bag")) else "cinematic concept art"
    if "mood" in gaps:
        defaults["mood"] = "focused and atmospheric"
    if "composition" in gaps:
        defaults["composition"] = "clear hero composition"
    if "colorPalette" in gaps:
        defaults["colorPalette"] = "rich contrast with controlled highlight colors"
    if "lighting" in gaps:
        defaults["lighting"] = "dramatic directional lighting"
    if "useCase" in gaps:
        defaults["useCase"] = "hero image"
    return defaults


def build_brief(state: dict[str, Any]) -> dict[str, Any]:
    intent = state.get("intent") or {}
    concept_parts = [intent.get("subject"), intent.get("style"), intent.get("mood")]
    concept = "，".join([part for part in concept_parts if isinstance(part, str) and part.strip()]) or "待补充视觉方案"
    visual_elements = []
    for key in ("subject", "composition", "lighting", "colorPalette"):
        value = intent.get(key)
        if isinstance(value, str) and value.strip():
            visual_elements.append(value.strip())
    return {
        "concept": concept,
        "visualElements": visual_elements[:4],
        "style": intent.get("style") or "",
        "mood": intent.get("mood") or "",
        "colorDirection": intent.get("colorPalette") or "",
        "confirmedByUser": False,
    }


def build_generation_prompt(state: dict[str, Any]) -> dict[str, Any]:
    """将当前意图构建为生图 prompt。优先保留用户原始描述，场景模板仅做补充。"""
    intent = state.get("intent") or {}
    scene = _match_prompt_scene(intent)

    positive_parts: list[str] = []

    # 1. 用户描述的主体和构图永远排在最前面
    for key in ("subject", "composition"):
        value = intent.get(key)
        if isinstance(value, str) and value.strip():
            positive_parts.append(value.strip())

    # 2. 用户明确表达的 style / mood / lighting / colorPalette
    for key in ("style", "mood", "lighting", "colorPalette"):
        value = intent.get(key)
        if isinstance(value, str) and value.strip():
            positive_parts.append(value.strip())

    # 3. 场景模板注入（作为补充，不覆盖用户描述）
    if scene:
        for elem in scene["positive_elements"]:
            if elem.lower() not in " ".join(positive_parts).lower():
                positive_parts.append(elem)
        scene_name = scene["name"]
    else:
        # 未匹配场景时注入通用电商摄影要素
        if FALLBACK_POSITIVE.lower() not in " ".join(positive_parts).lower():
            positive_parts.append(FALLBACK_POSITIVE)
        scene_name = "通用电商"

    # 4. useCase 放最后
    use_case = intent.get("useCase")
    if isinstance(use_case, str) and use_case.strip():
        positive_parts.append(use_case.strip())

    # 5. 质量后缀
    positive_parts.append(QUALITY_SUFFIX)

    positive = ", ".join(positive_parts)

    # 负向 prompt
    negative = scene["negative"] if scene else FALLBACK_NEGATIVE

    return {
        "positive": positive,
        "negative": negative,
        "model": settings.agent_image_model,
        "parameters": {
            "size": settings.agent_image_size,
            "resolution": settings.agent_image_resolution,
        },
        "promptReasoning": f"使用 {settings.agent_image_model} 文生图，匹配到「{scene_name}」场景模板。",
    }


def build_refine_prompt(state: dict[str, Any], user_message: str) -> dict[str, Any]:
    """迭代优化 prompt：保留当前 prompt 核心，按用户反馈微调。"""
    current = state.get("currentPrompt") or {}
    intent = state.get("intent") or {}
    scene = _match_prompt_scene(intent)

    positive = current.get("positive") or ""
    if user_message.strip():
        keep_marker = "keep overall composition and subject consistency"
        if keep_marker not in positive:
            positive = f"{positive}, {keep_marker}"
        positive = f"{positive}, refine with: {user_message.strip()}"

    negative = current.get("negative") or FALLBACK_NEGATIVE
    if scene and scene["negative"] not in negative:
        negative = f"{negative}, {scene['negative']}"

    return {
        "positive": positive,
        "negative": negative,
        "model": settings.agent_refine_model,
        "parameters": {
            "size": (current.get("parameters") or {}).get("size") or settings.agent_image_size,
            "resolution": (current.get("parameters") or {}).get("resolution") or settings.agent_image_resolution,
        },
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
        r"\[\[ACTION_INTENT\]\]\s*(\{.*\})",
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
    cleaned = re.sub(r"\[\[ACTION_INTENT\]\]\s*\{.*\}\s*$", "", text or "", flags=re.S).strip()
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
    for image_bytes, filename in reference_images[:4]:
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
    *,
    on_chunk: Callable[[str], None] | None = None,
    on_think: Callable[[str], None] | None = None,
) -> tuple[str, AgentActionIntent]:
    """调用 Agent LLM，返回 (展示用文本, 结构化意图)。

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
    prompt = f"""你是 Muse，一个会和用户一起把创意聊清楚的视觉创意搭档。请先自然回复用户，再在最后单独输出一段 JSON，格式必须是：
[[ACTION_INTENT]]{{...}}

要求：
1. 回复用中文，2到4句，自然、像设计师同事，不要列表。
2. 你的首要任务是确认和用户对创意方向达成了共识。如果你在某个维度上是在猜测，请告诉用户你的猜测，让对方确认或纠正。
3. 如果用户说"你来定/自由发挥/随便"，把 userAuthorizedFreedom 设为 true。
4. JSON 中只保留你本轮新提取的信息，没有就留空对象。
5. 如果参考图分析里明确写了用户已经上传参考图，不要再要求用户重复上传参考图，而是基于已有参考图继续聊视觉方向。

当前项目状态：
{json.dumps(state, ensure_ascii=False)}

最近对话：
{history_block}

参考图分析：
{reference_context or "（无）"}

用户这次说：
{user_message}

输出示例：
[[ACTION_INTENT]]{{"type":"CONTINUE_CHAT","confidence":0.72,"extractedInfo":{{"subject":"...","style":"..."}},"openQuestions":["..."],"creativeSuggestion":"..."}}"""

    use_stream = on_chunk is not None

    async with httpx.AsyncClient(timeout=settings.agent_llm_timeout_seconds, trust_env=False) as client:
        resp = await client.post(
            _chat_completions_endpoint(settings.agent_llm_base_url),
            headers={
                "Authorization": f"Bearer {settings.agent_llm_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": settings.agent_llm_model,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 2048,
                "temperature": 0.8,
                "stream": use_stream,
                "enable_thinking": True,
            },
        )

    if use_stream:
        # ── 流式路径：逐 token 回调，自动过滤 [[ACTION_INTENT]] ──
        accumulated = ""
        safe_len = 0  # 已回调给调用方的安全字符数

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

            # 检测 [[ACTION_INTENT]] 边界：一旦发现，之后的内容不再推送给用户
            action_idx = accumulated.find("[[ACTION_INTENT]]")
            if action_idx >= 0:
                if action_idx > safe_len:
                    # 把标记之前的剩余安全文本推出去
                    on_chunk(accumulated[safe_len:action_idx])
                safe_len = len(accumulated)  # 标记之后不再推送
            elif safe_len < len(accumulated):
                new_text = accumulated[safe_len:]
                on_chunk(new_text)
                safe_len = len(accumulated)
    else:
        # ── 非流式路径（兼容旧调用）──
        if resp.status_code != 200:
            raise RuntimeError(f"Agent LLM error: {resp.text[:240]}")
        data = resp.json()
        accumulated = (((data or {}).get("choices") or [{}])[0].get("message") or {}).get("content") or ""

    # 提取 ActionIntent
    parsed = _extract_json_block(accumulated) or {}
    action = AgentActionIntent(
        type=str(parsed.get("type") or "CONTINUE_CHAT"),
        confidence=max(0.0, min(1.0, float(parsed.get("confidence") or 0.5))),
        extracted_info=parsed.get("extractedInfo") or {},
        open_questions=parsed.get("openQuestions") or [],
        creative_suggestion=str(parsed.get("creativeSuggestion") or ""),
    )
    return strip_action_block(accumulated), action


def decide_next_action(state: dict[str, Any], action_intent: AgentActionIntent, user_message: str) -> dict[str, Any]:
    if detect_free_play(user_message):
        state.setdefault("intent", {})["userAuthorizedFreedom"] = True

    # REFINE：仅当用户明确说"改一下"时才触发，LLM 的推断不能绕过确认
    if detect_refine(user_message, state):
        return {"type": "REFINE", "prompt": build_refine_prompt(state, user_message)}

    completeness = calculate_completeness(state)

    # GENERATE：仅当用户明确说"确认/生成/出图"时才触发，LLM 的 REQUEST_GENERATE 不能直接生图
    if detect_confirm(user_message):
        return {
            "type": "GENERATE",
            "prompt": build_generation_prompt(state),
            "brief": build_brief(state),
            "completeness": completeness.model_dump(),
        }

    # 信息严重不足 → ASK 最重要的缺失维度
    if completeness.critical_gaps:
        q = pick_question(completeness.critical_gaps)
        return {
            "type": "ASK",
            "question": q["question"],
            "dimension": completeness.critical_gaps[0],
            "choices": q.get("choices", []),
            "completeness": completeness.model_dump(),
        }

    # LLM 主动想生成，但用户没有明确确认 → 转 CONFIRM，让用户点按钮
    if action_intent.type == "REQUEST_GENERATE":
        return _build_confirm_action(state, completeness)

    # 分数达标 + 至少 2 个明确维度 → CONFIRM
    if completeness.can_generate:
        brief = state.get("brief")
        if not brief or not brief.get("confirmedByUser"):
            return _build_confirm_action(state, completeness)
        return {
            "type": "GENERATE",
            "prompt": build_generation_prompt(state),
            "brief": build_brief(state),
            "completeness": completeness.model_dump(),
        }

    # 同阶段停留过久 → EXPLORE
    if int((state.get("phase") or {}).get("turnsInStage") or 0) >= MAX_TURNS_PER_STAGE:
        return {
            "type": "EXPLORE",
            "suggestion": action_intent.creative_suggestion or "我先帮你定一个方向试试，如果不对可以随时告诉我调整。",
            "completeness": completeness.model_dump(),
        }

    # 信息不够但可推断 → 优先 ASK 高权重缺失维度，低权重的自动推断
    if completeness.inferrable_gaps:
        # 取权重最高的缺失维度来询问用户（style=20, mood=15 优先）
        high_weight_gaps = [g for g in completeness.inferrable_gaps if g in ("style", "mood", "useCase")]
        if high_weight_gaps:
            q = pick_question([high_weight_gaps[0]])
            return {
                "type": "ASK",
                "question": q["question"],
                "dimension": high_weight_gaps[0],
                "choices": q.get("choices", []),
                "completeness": completeness.model_dump(),
            }
        # 低权重维度（composition/colorPalette/lighting）自动推断
        defaults = infer_defaults(state.get("intent") or {}, completeness.inferrable_gaps)
        state["intent"] = merge_intent(state.get("intent") or {}, defaults)
        brief = build_brief(state)
        return {"type": "CONFIRM", "brief": brief, "completeness": completeness.model_dump()}

    return {"type": "CONFIRM", "brief": build_brief(state), "completeness": completeness.model_dump()}


def _build_confirm_action(state: dict[str, Any], completeness: AgentCompletenessResult) -> dict[str, Any]:
    """构造 CONFIRM 动作，含场景化快捷按钮。"""
    scene = _match_prompt_scene(state.get("intent") or {})
    scene_name = scene["name"] if scene else ""
    quick_actions = [
        {"label": "确认，开始生成", "value": "确认，开始生成"},
    ]
    if scene_name == "白底产品图":
        quick_actions.append({"label": "试试电影感光影", "value": "换个方向，试试电影感光影效果"})
        quick_actions.append({"label": "试试自然场景风", "value": "换个方向，把产品放到自然场景里"})
    elif scene_name == "电商海报":
        quick_actions.append({"label": "试试更简约高级", "value": "换个方向，试试更简约高级的风格"})
        quick_actions.append({"label": "试试更炫酷潮流", "value": "换个方向，试试更炫酷潮流的风格"})
    elif scene_name == "产品场景图":
        quick_actions.append({"label": "试试白底干净风", "value": "换个方向，试试白底干净风格"})
        quick_actions.append({"label": "试试高级冷淡风", "value": "换个方向，试试高级冷淡风格"})
    elif scene_name == "时尚画册":
        quick_actions.append({"label": "试试电影感大片", "value": "换个方向，试试电影感大片风格"})
        quick_actions.append({"label": "试试极简留白", "value": "换个方向，试试极简留白风格"})
    elif scene_name == "社媒配图":
        quick_actions.append({"label": "试试品牌高级感", "value": "换个方向，试试品牌高级感"})
        quick_actions.append({"label": "试试温暖生活感", "value": "换个方向，试试温暖生活感"})
    else:
        quick_actions.append({"label": "换个方向试试", "value": "换个方向试试"})
    return {"type": "CONFIRM", "brief": build_brief(state), "completeness": completeness.model_dump(), "quickActions": quick_actions}


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
    if updated.get("brief") and detect_confirm(user_message):
        updated["brief"]["confirmedByUser"] = True
    logs = (((updated.get("metadata") or {}).get("decisionLogs")) or [])
    logs.append({"type": kind, "at": math.floor(time.time()), "userMessage": user_message[:200]})
    updated.setdefault("metadata", {})["decisionLogs"] = logs[-20:]
    return updated


async def run_vlm_critic(image_url: str, state: dict[str, Any]) -> dict[str, Any]:
    """VLM 质检：真正读取图片并传给 VLM 做视觉分析。"""
    summary = "图片已生成，当前先使用基础分析结果。"
    result = {
        "qualityScore": 78,
        "intentMatch": 76,
        "autoRetry": False,
        "satisfiedElements": ["已完成一次可用出图"],
        "problemElements": [],
        "iterationDiff": {"keep": [], "adjust": [], "promptDelta": {"add": [], "remove": [], "modify": {}}},
        "userFacingSummary": summary,
    }
    if not settings.agent_vlm_api_key:
        return result

    # 将图片转为 base64 data URL
    image_data_url = await _resolve_image_data_url(image_url)
    if not image_data_url:
        logger.warning("vlm_critic: unable to resolve image for %s", image_url)
        return result

    content: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": f"""你是图片质检助手。请根据当前创意意图，分析图片质量并返回 JSON。

当前创意：
{json.dumps(state.get("brief") or state.get("intent") or {}, ensure_ascii=False)}

请返回 JSON：
{{"qualityScore":0-100,"intentMatch":0-100,"userFacingSummary":"一句中文总结图片质量和匹配度"}}""",
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
                    "max_tokens": 300,
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
                result["userFacingSummary"] = str(parsed.get("userFacingSummary") or result["userFacingSummary"])
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

    # 本地路径：/ai-images/{user_id}/{filename}.png
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


async def stream_generation_events(
    *,
    state: dict[str, Any],
    user_id: str,
    prompt_payload: dict[str, Any],
    current_image: Optional[dict[str, Any]] = None,
    reference_images: Optional[list[tuple[bytes, str]]] = None,
) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    resolved_model = SLASH_MODEL_MAP.get(str(prompt_payload.get("model") or settings.agent_image_model).lower(), prompt_payload.get("model") or settings.agent_image_model)
    size = ((prompt_payload.get("parameters") or {}).get("size")) or settings.agent_image_size
    resolution = ((prompt_payload.get("parameters") or {}).get("resolution")) or settings.agent_image_resolution
    prompt = prompt_payload.get("positive") or ""
    yield "generation_started", {"jobId": None, "estimatedSeconds": 45}

    progress_queue: asyncio.Queue[tuple[int, str]] = asyncio.Queue()

    def on_progress(pct: int, api_status: str) -> None:
        try:
            progress_queue.put_nowait((int(pct or 0), api_status or ""))
        except Exception:
            pass

    async def _run_generation():
        refs = list(reference_images or [])
        if current_image and current_image.get("imageUrl", "").startswith("/ai-images/"):
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

    result = await task
    yield "generation_completed", {
        "jobId": result.get("task_id"),
        "image": {
            "id": result.get("task_id") or result.get("url"),
            "url": result.get("url"),
            "width": None,
            "height": None,
        },
    }

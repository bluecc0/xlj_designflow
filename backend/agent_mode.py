from __future__ import annotations

import asyncio
import base64
import json
import logging
import math
import mimetypes
import re
import time
from typing import Any, AsyncIterator, Optional

import httpx
import pydantic

from .ai_image import SLASH_MODEL_MAP, generate_image_async, generate_image_with_reference_async
from .config import settings

logger = logging.getLogger(__name__)


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

GENERATE_THRESHOLD = 60
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
    intent = state.get("intent") or {}
    for dim in DIMENSIONS:
        value = intent.get(dim["key"])
        has_value = isinstance(value, str) and value.strip()
        if has_value:
            score += dim["weight"]
            continue
        if dim["required"] and not dim["inferrable"]:
            critical_gaps.append(dim["key"])
        elif dim["inferrable"]:
            inferrable_gaps.append(dim["key"])
            score += dim["weight"] * 0.5
    if intent.get("userAuthorizedFreedom"):
        score = max(score, 85)
    score = min(score, 100)
    return AgentCompletenessResult(
        score=score,
        critical_gaps=critical_gaps,
        inferrable_gaps=inferrable_gaps,
        can_generate=not critical_gaps and score >= GENERATE_THRESHOLD,
    )


def pick_question(gaps: list[str]) -> str:
    templates = {
        "subject": "我先帮你收一下核心信息，这张图最想表现的主体是什么？比如人物、产品、场景，或者某个具体物件。",
        "useCase": "这张图更偏什么用途？海报、封面、电商主图，还是社媒配图？",
        "style": "风格上你更想靠近哪一类？比如高级感、电影感、赛博朋克、极简，或者你也可以让我来定。",
        "mood": "你希望画面的情绪更偏哪边？克制、浪漫、神秘、热烈，都可以。",
        "composition": "构图上有没有明确偏好？比如近景特写、居中主体，或者更有纵深的大场景。",
    }
    for key in ("subject", "useCase", "style", "mood", "composition"):
        if key in gaps:
            return templates.get(key, "我再补一个关键点，这张图里你最在意的视觉信息是什么？")
    return "我再补一个关键点，这张图里你最在意的视觉信息是什么？"


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
    intent = state.get("intent") or {}
    prompt_bits = [
        intent.get("subject"),
        intent.get("composition"),
        intent.get("style"),
        intent.get("mood"),
        intent.get("lighting"),
        intent.get("colorPalette"),
        intent.get("useCase"),
        "masterpiece, best quality, highly detailed",
    ]
    positive = ", ".join([bit.strip() for bit in prompt_bits if isinstance(bit, str) and bit.strip()])
    return {
        "positive": positive,
        "negative": "low quality, blurry, distorted anatomy, extra fingers, malformed text, watermark",
        "model": settings.agent_image_model,
        "parameters": {
            "size": settings.agent_image_size,
            "resolution": settings.agent_image_resolution,
        },
        "promptReasoning": "基于当前确认的主体、风格、情绪和构图信息生成。",
    }


def build_refine_prompt(state: dict[str, Any], user_message: str) -> dict[str, Any]:
    current = state.get("currentPrompt") or {}
    positive = current.get("positive") or ""
    if user_message.strip():
        positive = f"{positive}, keep overall composition and subject consistency, refine with: {user_message.strip()}"
    return {
        "positive": positive,
        "negative": current.get("negative") or "low quality, blurry, distorted anatomy, malformed text, watermark",
        "model": settings.agent_image_model,
        "parameters": {
            "size": settings.agent_image_size,
            "resolution": settings.agent_image_resolution,
        },
        "promptReasoning": "在保留现有画面核心主体的基础上按用户反馈迭代。",
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
) -> tuple[str, AgentActionIntent]:
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
2. 如果信息已经足够，不要继续追问，可以先帮用户总结方向。
3. 如果用户说“你来定/自由发挥/随便”，把 userAuthorizedFreedom 设为 true。
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
                "max_tokens": 1200,
                "temperature": 0.8,
                "stream": False,
            },
        )
    if resp.status_code != 200:
        raise RuntimeError(f"Agent LLM error: {resp.text[:240]}")
    data = resp.json()
    content = (((data or {}).get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    parsed = _extract_json_block(content) or {}
    action = AgentActionIntent(
        type=str(parsed.get("type") or "CONTINUE_CHAT"),
        confidence=max(0.0, min(1.0, float(parsed.get("confidence") or 0.5))),
        extracted_info=parsed.get("extractedInfo") or {},
        open_questions=parsed.get("openQuestions") or [],
        creative_suggestion=str(parsed.get("creativeSuggestion") or ""),
    )
    return strip_action_block(content), action


def decide_next_action(state: dict[str, Any], action_intent: AgentActionIntent, user_message: str) -> dict[str, Any]:
    if detect_free_play(user_message):
        state.setdefault("intent", {})["userAuthorizedFreedom"] = True

    if detect_refine(user_message, state) or (
        state.get("currentImage")
        and action_intent.type in {"REQUEST_REFINE", "REQUEST_GENERATE"}
        and not detect_regenerate(user_message)
    ):
        return {"type": "REFINE", "prompt": build_refine_prompt(state, user_message)}

    completeness = calculate_completeness(state)
    if detect_confirm(user_message) or action_intent.type == "REQUEST_GENERATE":
        return {
            "type": "GENERATE",
            "prompt": build_generation_prompt(state),
            "brief": build_brief(state),
            "completeness": completeness.model_dump(),
        }

    if completeness.critical_gaps:
        return {
            "type": "ASK",
            "question": pick_question(completeness.critical_gaps),
            "dimension": completeness.critical_gaps[0],
            "completeness": completeness.model_dump(),
        }

    if completeness.can_generate:
        brief = state.get("brief")
        if not brief or not brief.get("confirmedByUser"):
            if action_intent.type == "PRESENT_BRIEF":
                return {"type": "CONFIRM", "brief": build_brief(state), "completeness": completeness.model_dump()}
            return {"type": "CONFIRM", "brief": build_brief(state), "completeness": completeness.model_dump()}
        return {
            "type": "GENERATE",
            "prompt": build_generation_prompt(state),
            "brief": build_brief(state),
            "completeness": completeness.model_dump(),
        }

    if int((state.get("phase") or {}).get("turnsInStage") or 0) >= MAX_TURNS_PER_STAGE:
        return {
            "type": "EXPLORE",
            "suggestion": action_intent.creative_suggestion or "我可以先给你定一个方向：用更明确的主体和情绪来收束这张图，然后我们直接出一版看感觉。",
            "completeness": completeness.model_dump(),
        }

    if completeness.inferrable_gaps:
        defaults = infer_defaults(state.get("intent") or {}, completeness.inferrable_gaps)
        state["intent"] = merge_intent(state.get("intent") or {}, defaults)
        brief = build_brief(state)
        return {"type": "CONFIRM", "brief": brief, "completeness": completeness.model_dump()}

    return {"type": "CONFIRM", "brief": build_brief(state), "completeness": completeness.model_dump()}


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
    try:
        prompt = f"""你是图片质检助手。请根据当前创意意图，返回 JSON：
{{"qualityScore":0-100,"intentMatch":0-100,"userFacingSummary":"一句中文总结"}}

当前创意：
{json.dumps(state.get("brief") or state.get("intent") or {}, ensure_ascii=False)}

图片地址：
{image_url}
"""
        async with httpx.AsyncClient(timeout=settings.agent_vlm_timeout_seconds, trust_env=False) as client:
            resp = await client.post(
                _chat_completions_endpoint(settings.agent_vlm_base_url),
                headers={
                    "Authorization": f"Bearer {settings.agent_vlm_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.agent_vlm_model,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 300,
                    "temperature": 0.2,
                    "stream": False,
                },
            )
        if resp.status_code == 200:
            data = resp.json()
            content = (((data or {}).get("choices") or [{}])[0].get("message") or {}).get("content") or ""
            match = re.search(r"(\{.*\})", content, flags=re.S)
            if match:
                parsed = json.loads(match.group(1))
                result["qualityScore"] = int(parsed.get("qualityScore") or result["qualityScore"])
                result["intentMatch"] = int(parsed.get("intentMatch") or result["intentMatch"])
                result["userFacingSummary"] = str(parsed.get("userFacingSummary") or result["userFacingSummary"])
    except Exception:
        logger.exception("vlm critic failed")
    return result


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

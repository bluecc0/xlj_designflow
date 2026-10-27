"""Shared Sub2API -> APIMart routing for text and vision completions."""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Callable

import httpx

from .config import settings

logger = logging.getLogger(__name__)


class ModelRoutingError(RuntimeError):
    pass


@dataclass(frozen=True)
class ModelRoute:
    provider: str
    base_url: str
    api_key: str = field(repr=False)
    model: str
    proxy: str = field(default="", repr=False)


def chat_completions_endpoint(base_url: str) -> str:
    clean = base_url.strip().rstrip("/")
    if not clean.startswith(("http://", "https://")):
        clean = "https://" + clean
    if clean.endswith("/chat/completions"):
        return clean
    return clean + ("/chat/completions" if clean.endswith("/v1") else "/v1/chat/completions")


def get_model_routes(purpose: str) -> list[ModelRoute]:
    if purpose not in {"chat_llm", "agent_llm", "skill_llm", "vlm", "agent_vlm"}:
        raise ValueError(f"Unknown model routing purpose: {purpose}")
    if purpose == "vlm":
        base, key, model = settings.current_vlm_config()
    else:
        base = getattr(settings, purpose + "_base_url")
        key = getattr(settings, purpose + "_api_key")
        model = getattr(settings, purpose + "_model")
    routes = []
    api_base, api_key = settings.ai_image_base_url, settings.ai_image_api_key
    sub_base, sub_key = settings.cliproxy_base_url, settings.cliproxy_api_key
    # Preserve separately configured subscription endpoints on older installations.
    same_as_apimart = chat_completions_endpoint(base) == chat_completions_endpoint(api_base) if base else False
    if not (sub_base and sub_key) and base and key and not same_as_apimart:
        sub_base, sub_key = base, key
    if sub_base and sub_key:
        routes.append(ModelRoute("sub2api", sub_base, sub_key, model, settings.cliproxy_proxy_url))
    if same_as_apimart and key:
        api_base, api_key = base, key
    fallback_model = (
        settings.apimart_vlm_model if "vlm" in purpose else settings.apimart_llm_model
    ) or model
    if api_base and api_key:
        route = ModelRoute("apimart", api_base, api_key, fallback_model, settings.ai_image_api_proxy_url)
        if not any(
            chat_completions_endpoint(r.base_url) == chat_completions_endpoint(route.base_url)
            and r.api_key == route.api_key and r.model == route.model for r in routes
        ):
            routes.append(route)
    return routes


def _client_options(route: ModelRoute, timeout: float) -> dict:
    options: dict[str, Any] = {"timeout": timeout, "trust_env": False}
    if route.proxy:
        options["proxy"] = route.proxy
    return options


def _payload(route: ModelRoute, payload: dict, *, stream: bool) -> dict:
    body = {**payload, "model": route.model, "stream": stream}
    if any(k in route.model.lower() for k in ("r1", "qwq", "reasoning", "gpt")):
        body.pop("enable_thinking", None)
    return body


def _headers(route: ModelRoute) -> dict[str, str]:
    return {"Authorization": f"Bearer {route.api_key}", "Content-Type": "application/json"}


def _chunk_text(chunk: dict) -> str:
    choices = chunk.get("choices") or []
    choice = choices[0] if choices else {}
    message = choice.get("delta") or choice.get("message") or {}
    return str(message.get("content") or "")


def _check_content(data: dict, validate: Callable[[str], bool] | None) -> None:
    if not isinstance(data, dict) or data.get("error"):
        raise ModelRoutingError("模型返回错误响应")
    content = _chunk_text(data)
    if not content.strip() or (validate and not validate(content)):
        raise ModelRoutingError("模型返回空内容或无效结果")


async def routed_chat_completion(
    purpose: str, payload: dict, *, timeout: float = 60,
    validate: Callable[[str], bool] | None = None,
) -> httpx.Response:
    errors = []
    for route in get_model_routes(purpose):
        try:
            async with httpx.AsyncClient(**_client_options(route, timeout)) as client:
                response = await client.post(
                    chat_completions_endpoint(route.base_url), headers=_headers(route),
                    json=_payload(route, payload, stream=False),
                )
            if response.status_code != 200:
                raise ModelRoutingError(f"HTTP {response.status_code}")
            try:
                data = response.json()
            except ValueError:
                # Some compatible gateways return SSE even with stream=False.
                parts = []
                finished = False
                for line in response.text.splitlines():
                    if not line.startswith("data:"):
                        continue
                    raw = line[5:].strip()
                    if raw == "[DONE]":
                        finished = True
                        break
                    chunk = json.loads(raw)
                    if chunk.get("error"):
                        raise ModelRoutingError("模型流返回错误")
                    parts.append(_chunk_text(chunk))
                    finished = finished or any(c.get("finish_reason") for c in chunk.get("choices", []))
                if not finished:
                    raise ModelRoutingError("模型响应中断")
                data = {"choices": [{"message": {"content": "".join(parts)}}]}
                response = httpx.Response(200, json=data)
            _check_content(data, validate)
            response.extensions["model_route"] = {"provider": route.provider, "model": route.model}
            logger.info("[model-routing] %s succeeded via %s model=%s", purpose, route.provider, route.model)
            return response
        except (httpx.HTTPError, ValueError, TypeError, AttributeError, IndexError, ModelRoutingError) as exc:
            # Do not log response bodies, credentials, URLs or user image data.
            reason = str(exc) if isinstance(exc, ModelRoutingError) else type(exc).__name__
            errors.append(f"{route.provider}: {reason}")
            logger.warning("[model-routing] %s %s failed (%s); trying next route", purpose, route.provider, reason)
    raise ModelRoutingError("模型服务暂不可用（" + ("；".join(errors) or "Sub2API/APIMart 未配置") + "）")


async def routed_chat_stream(
    purpose: str, payload: dict, *, timeout: float = 60,
    validate: Callable[[str], bool] | None = None,
) -> AsyncIterator[dict]:
    errors = []
    emitted = False
    for route in get_model_routes(purpose):
        if emitted:
            yield {"_route_reset": True}
            emitted = False
        text_parts = []
        finished = False
        try:
            async with httpx.AsyncClient(**_client_options(route, timeout)) as client:
                async with client.stream(
                    "POST", chat_completions_endpoint(route.base_url), headers=_headers(route),
                    json=_payload(route, payload, stream=True),
                ) as response:
                    if response.status_code != 200:
                        raise ModelRoutingError(f"HTTP {response.status_code}")
                    async for line in response.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        raw = line[5:].strip()
                        if not raw:
                            continue
                        if raw == "[DONE]":
                            finished = True
                            break
                        chunk = json.loads(raw)
                        if not isinstance(chunk, dict) or chunk.get("error"):
                            raise ModelRoutingError("模型流返回错误")
                        choices = chunk.get("choices") or []
                        if any(c.get("finish_reason") == "error" for c in choices):
                            raise ModelRoutingError("模型流异常终止")
                        finished = finished or any(c.get("finish_reason") for c in choices)
                        content = _chunk_text(chunk)
                        if content:
                            text_parts.append(content)
                        if choices:
                            emitted = True
                            yield {**chunk, "_route": {"provider": route.provider, "model": route.model}}
            _check_content({"choices": [{"message": {"content": "".join(text_parts)}}]}, validate)
            if not finished:
                raise ModelRoutingError("模型流响应中断")
            logger.info("[model-routing] %s stream succeeded via %s model=%s", purpose, route.provider, route.model)
            return
        except (httpx.HTTPError, ValueError, TypeError, AttributeError, IndexError, ModelRoutingError) as exc:
            reason = str(exc) if isinstance(exc, ModelRoutingError) else type(exc).__name__
            errors.append(f"{route.provider}: {reason}")
            logger.warning("[model-routing] %s %s stream failed (%s); trying next route", purpose, route.provider, reason)
    raise ModelRoutingError("模型服务暂不可用（" + ("；".join(errors) or "Sub2API/APIMart 未配置") + "）")

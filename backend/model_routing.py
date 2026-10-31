"""Shared Sub2API -> APIMart routing for text and vision completions."""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Callable

import httpx

from .config import settings

logger = logging.getLogger(__name__)


class ModelRoutingError(RuntimeError):
    pass


class RouteHTTPError(ModelRoutingError):
    def __init__(self, status: int):
        super().__init__(f"HTTP {status}")
        self.status = status


# 连接建立要快：连不上就换线路，不等满整个读超时
CONNECT_TIMEOUT_SECONDS = 8
# 失败的线路冷却一段时间：期间排到最后，后续请求直接从健康线路开始
ROUTE_COOLDOWN_SECONDS = 60
_cooldown: dict[tuple[str, str], float] = {}
# 这些错误说明整家供应商不通（网络、代理、网关断开、鉴权），本次请求跳过它的其余模型
_PROVIDER_ERRORS = (httpx.ConnectError, httpx.ConnectTimeout, httpx.ProxyError, httpx.RemoteProtocolError,
                    httpx.ReadTimeout, httpx.PoolTimeout)


def _split_models(value: str) -> list[str]:
    return list(dict.fromkeys(m.strip() for m in str(value or "").split(",") if m.strip()))


def _cooling(route: "ModelRoute", now: float) -> bool:
    return any(_cooldown.get(key, 0) > now for key in ((route.provider, "*"), (route.provider, route.model)))


def route_failed(route: "ModelRoute", exc: BaseException) -> bool:
    """记录线路失败；返回 True 表示整家供应商不可用，本次请求应跳过它的其余模型。"""
    provider_down = isinstance(exc, _PROVIDER_ERRORS) or (
        isinstance(exc, RouteHTTPError) and exc.status in (401, 403))
    _cooldown[(route.provider, "*" if provider_down else route.model)] = time.time() + ROUTE_COOLDOWN_SECONDS
    return provider_down


def route_succeeded(route: "ModelRoute") -> None:
    _cooldown.pop((route.provider, "*"), None)
    _cooldown.pop((route.provider, route.model), None)


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
    # 模型配置可以是逗号分隔的列表：同一家供应商内按顺序作为备用
    models = _split_models(model)
    routes = []
    api_base, api_key = settings.ai_image_base_url, settings.ai_image_api_key
    sub_base, sub_key = settings.cliproxy_base_url, settings.cliproxy_api_key
    # Preserve separately configured subscription endpoints on older installations.
    same_as_apimart = chat_completions_endpoint(base) == chat_completions_endpoint(api_base) if base else False
    if not (sub_base and sub_key) and base and key and not same_as_apimart:
        sub_base, sub_key = base, key
    if sub_base and sub_key:
        routes += [ModelRoute("sub2api", sub_base, sub_key, m, settings.cliproxy_proxy_url) for m in models]
    if same_as_apimart and key:
        api_base, api_key = base, key
    fallback_models = _split_models(
        settings.apimart_vlm_model if "vlm" in purpose else settings.apimart_llm_model
    ) or models
    if api_base and api_key:
        for m in fallback_models:
            route = ModelRoute("apimart", api_base, api_key, m, settings.ai_image_api_proxy_url)
            if not any(
                chat_completions_endpoint(r.base_url) == chat_completions_endpoint(route.base_url)
                and r.api_key == route.api_key and r.model == route.model for r in routes
            ):
                routes.append(route)
    # 冷却中的线路不删除，只排到最后：全部故障时仍会尝试
    now = time.time()
    return [r for r in routes if not _cooling(r, now)] + [r for r in routes if _cooling(r, now)]


def _client_options(route: ModelRoute, timeout: float) -> dict:
    options: dict[str, Any] = {"timeout": httpx.Timeout(timeout, connect=min(timeout, CONNECT_TIMEOUT_SECONDS)),
                               "trust_env": False}
    if route.proxy:
        options["proxy"] = route.proxy
    return options


def _payload(route: ModelRoute, payload: dict, *, stream: bool) -> dict:
    body = {**payload, "model": route.model, "stream": stream}
    if any(k in route.model.lower() for k in ("r1", "qwq", "reasoning", "gpt")):
        body.pop("enable_thinking", None)
    # APIMart 的 GPT 系列默认带推理参数，chat/completions 里推理和工具调用不能同时用，会直接 400
    if body.get("tools") and route.model.lower().startswith("gpt-"):
        body.setdefault("reasoning_effort", "none")
    return body


def _headers(route: ModelRoute) -> dict[str, str]:
    return {"Authorization": f"Bearer {route.api_key}", "Content-Type": "application/json"}


def _chunk_text(chunk: dict) -> str:
    choices = chunk.get("choices") or []
    choice = choices[0] if choices else {}
    message = choice.get("delta") or choice.get("message") or {}
    return str(message.get("content") or "")


def _check_response_error(data: dict) -> None:
    if not isinstance(data, dict) or data.get("error"):
        raise ModelRoutingError("模型返回错误响应")
    if any(choice.get("finish_reason") == "error" for choice in (data.get("choices") or [])):
        raise ModelRoutingError("模型响应异常终止")


def _check_content(data: dict, validate: Callable[[str], bool] | None) -> None:
    _check_response_error(data)
    content = _chunk_text(data)
    if not content.strip() or (validate and not validate(content)):
        raise ModelRoutingError("模型返回空内容或无效结果")


async def routed_chat_completion(
    purpose: str, payload: dict, *, timeout: float = 60,
    validate: Callable[[str], bool] | None = None,
) -> httpx.Response:
    errors = []
    down: set[str] = set()
    for route in get_model_routes(purpose):
        if route.provider in down:
            continue
        try:
            async with httpx.AsyncClient(**_client_options(route, timeout)) as client:
                response = await client.post(
                    chat_completions_endpoint(route.base_url), headers=_headers(route),
                    json=_payload(route, payload, stream=False),
                )
            if response.status_code != 200:
                raise RouteHTTPError(response.status_code)
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
                    _check_response_error(chunk)
                    parts.append(_chunk_text(chunk))
                    finished = finished or any(c.get("finish_reason") for c in chunk.get("choices", []))
                if not finished:
                    raise ModelRoutingError("模型响应中断")
                data = {"choices": [{"message": {"content": "".join(parts)}}]}
                response = httpx.Response(200, json=data)
            _check_content(data, validate)
            route_succeeded(route)
            response.extensions["model_route"] = {"provider": route.provider, "model": route.model}
            logger.info("[model-routing] %s succeeded via %s model=%s", purpose, route.provider, route.model)
            return response
        except (httpx.HTTPError, ValueError, TypeError, AttributeError, IndexError, ModelRoutingError) as exc:
            # Do not log response bodies, credentials, URLs or user image data.
            reason = str(exc) if isinstance(exc, ModelRoutingError) else type(exc).__name__
            errors.append(f"{route.provider}/{route.model}: {reason}")
            if route_failed(route, exc):
                down.add(route.provider)
            logger.warning("[model-routing] %s %s model=%s failed (%s); trying next route",
                           purpose, route.provider, route.model, reason)
    raise ModelRoutingError("模型服务暂不可用（" + ("；".join(errors) or "Sub2API/APIMart 未配置") + "）")


async def routed_chat_stream(
    purpose: str, payload: dict, *, timeout: float = 60,
    validate: Callable[[str], bool] | None = None,
) -> AsyncIterator[dict]:
    errors = []
    emitted = False
    down: set[str] = set()
    for route in get_model_routes(purpose):
        if route.provider in down:
            continue
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
                        raise RouteHTTPError(response.status_code)
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
                        _check_response_error(chunk)
                        choices = chunk.get("choices") or []
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
            route_succeeded(route)
            logger.info("[model-routing] %s stream succeeded via %s model=%s", purpose, route.provider, route.model)
            return
        except (httpx.HTTPError, ValueError, TypeError, AttributeError, IndexError, ModelRoutingError) as exc:
            reason = str(exc) if isinstance(exc, ModelRoutingError) else type(exc).__name__
            errors.append(f"{route.provider}/{route.model}: {reason}")
            if route_failed(route, exc):
                down.add(route.provider)
            logger.warning("[model-routing] %s %s model=%s stream failed (%s); trying next route",
                           purpose, route.provider, route.model, reason)
    raise ModelRoutingError("模型服务暂不可用（" + ("；".join(errors) or "Sub2API/APIMart 未配置") + "）")

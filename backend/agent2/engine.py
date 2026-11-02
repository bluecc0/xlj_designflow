"""引擎适配层的默认实现：自写的工具调用循环（方案 D1 兜底路线）。

复用 model_routing 的线路、代理与失败切换；和 routed_chat_stream 不同，
这里接受"只有工具调用、没有文字"的响应。任何引擎都只通过 emit 产出标准事件，
工具一律交给工具层执行。
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Awaitable, Callable, Protocol

import httpx

from ..model_routing import (
    ModelRoutingError,
    RouteHTTPError,
    _check_response_error,
    _client_options,
    _headers,
    _payload,
    chat_completions_endpoint,
    get_model_routes,
    route_failed,
    route_succeeded,
)

logger = logging.getLogger(__name__)

Emit = Callable[[str, dict], Awaitable[None]]

MAX_STEPS = 12
_OVERFLOW_HINTS = ("context_length", "context length", "maximum context", "too many tokens",
                   "prompt is too long", "input is too long", "context window")


# 用户主动停止的轮次：工具据此区分"用户停止"和"服务重启"，后者要保留任务以便恢复
user_cancelled: set[str] = set()


class ContextOverflow(Exception):
    """上游明确报上下文超限：换线路也没用，交给引擎压缩后重试。"""


# ── 模型客户端 ────────────────────────────────────────────────────────────────

@dataclass
class ModelStep:
    text: str = ""
    tool_calls: list[dict] = field(default_factory=list)
    route: dict = field(default_factory=dict)


class ModelClient(Protocol):
    def stream(self, messages: list[dict], tools: list[dict]) -> AsyncIterator[tuple[str, Any]]:
        """产出 ("text", delta) / ("reset", None) / ("step", ModelStep)。"""


class RoutedModelClient:
    """按 agent_llm 的线路顺序尝试；中途失败时发 reset，前端清掉已显示的半段文字。"""

    def __init__(self, purpose: str = "agent_llm", timeout: float = 90):
        self.purpose = purpose
        self.timeout = timeout

    async def stream(self, messages: list[dict], tools: list[dict]) -> AsyncIterator[tuple[str, Any]]:
        errors: list[str] = []
        routes = get_model_routes(self.purpose)
        if not routes:
            raise ModelRoutingError("Agent 模型线路未配置")
        down: set[str] = set()
        for route in routes:
            if route.provider in down:
                continue
            emitted = False
            text_parts: list[str] = []
            calls: dict[int, dict] = {}
            finished = False
            try:
                body = _payload(route, {"messages": messages, "tools": tools, "temperature": 0.4}, stream=True)
                async with httpx.AsyncClient(**_client_options(route, self.timeout)) as client:
                    async with client.stream("POST", chat_completions_endpoint(route.base_url),
                                             headers=_headers(route), json=body) as response:
                        if response.status_code != 200:
                            detail = (await response.aread()).decode("utf-8", "ignore")[:500]
                            if any(h in detail.lower() for h in _OVERFLOW_HINTS):
                                raise ContextOverflow(detail)
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
                            # 顶层 error 或 finish_reason=error 都是失败：丢弃本线路的文字和工具调用，换下一条
                            _check_response_error(chunk)
                            for choice in chunk.get("choices") or []:
                                delta = choice.get("delta") or choice.get("message") or {}
                                content = delta.get("content")
                                if content:
                                    text_parts.append(content)
                                    emitted = True
                                    yield ("text", content)
                                for tc in delta.get("tool_calls") or []:
                                    slot = calls.setdefault(int(tc.get("index", 0)), {"id": "", "name": "", "arguments": ""})
                                    if tc.get("id"):
                                        slot["id"] = tc["id"]
                                    fn = tc.get("function") or {}
                                    if fn.get("name"):
                                        slot["name"] += fn["name"]
                                    if fn.get("arguments"):
                                        slot["arguments"] += fn["arguments"]
                                if choice.get("finish_reason"):
                                    finished = True
                if not finished:
                    raise ModelRoutingError("模型流响应中断")
                if not text_parts and not calls:
                    raise ModelRoutingError("模型返回空内容")
                tool_calls = [
                    {"id": c["id"] or f"call_{i}", "name": c["name"], "arguments": c["arguments"]}
                    for i, c in sorted(calls.items())
                ]
                route_succeeded(route)
                yield ("step", ModelStep(text="".join(text_parts), tool_calls=tool_calls,
                                         route={"provider": route.provider, "model": route.model}))
                return
            except (httpx.HTTPError, ValueError, ModelRoutingError) as exc:
                reason = str(exc) if isinstance(exc, ModelRoutingError) else type(exc).__name__
                errors.append(f"{route.provider}/{route.model}: {reason}")
                if route_failed(route, exc):
                    down.add(route.provider)
                logger.warning("[agent2] %s route %s model=%s failed (%s)", self.purpose, route.provider, route.model, reason)
                if emitted:
                    yield ("reset", None)
        raise ModelRoutingError("模型服务暂不可用（" + "；".join(errors) + "）")


# ── 工具 ──────────────────────────────────────────────────────────────────────

@dataclass
class Tool:
    name: str
    description: str
    parameters: dict
    handler: Callable[["ToolContext", dict], Awaitable[dict]]
    suspends: bool = False  # True：调用后挂起轮次，等待用户回答

    def spec(self) -> dict:
        return {"type": "function", "function": {"name": self.name, "description": self.description,
                                                  "parameters": self.parameters}}


@dataclass
class ToolContext:
    user: dict
    session_id: str
    turn_id: str
    call_id: str
    emit: Emit
    state: dict  # 轮次内共享的计数等
    publish: Callable[[dict], Awaitable[None]] | None = None  # 推送已落库的事件（和数据同一事务写入的）


@dataclass
class TurnResult:
    status: str  # done / waiting_user
    messages: list[dict]
    text: str = ""
    pending: dict | None = None  # waiting_user 时：{"call_id", "question", ...}


async def _run_tool(tool: Tool | None, name: str, call: dict, ctx_base: dict, emit: Emit) -> str:
    call_id = call["id"]
    try:
        args = json.loads(call.get("arguments") or "{}")
        if not isinstance(args, dict):
            raise ValueError
    except ValueError:
        return json.dumps({"error": "参数不是合法的 JSON 对象，请修正后重试"}, ensure_ascii=False)
    if tool is None:
        return json.dumps({"error": f"没有名为 {name} 的工具"}, ensure_ascii=False)
    await emit("tool.started", {"call_id": call_id, "tool": name, "args": args})
    started = time.monotonic()
    ctx = ToolContext(call_id=call_id, emit=emit, **ctx_base)
    try:
        result = await tool.handler(ctx, args)
        ok = not (isinstance(result, dict) and result.get("error"))
    except Exception as exc:  # 工具内部错误转成模型能据此行动的提示
        logger.exception("[agent2] tool %s failed", name)
        result, ok = {"error": f"{type(exc).__name__}: {exc}"}, False
    duration_ms = int((time.monotonic() - started) * 1000)
    await emit("tool.finished", {"call_id": call_id, "tool": name, "ok": ok, "result": result,
                                 "duration_ms": duration_ms})
    return json.dumps(result, ensure_ascii=False)


async def run_loop(
    *,
    model: ModelClient,
    tools: dict[str, Tool],
    messages: list[dict],
    emit: Emit,
    ctx_base: dict,
    max_steps: int = MAX_STEPS,
    prepare: Callable[[list[dict], bool], Awaitable[list[dict]]] | None = None,
    checkpoint: Callable[[list[dict]], None] | None = None,
) -> TurnResult:
    """执行到模型不再调用工具，或遇到需要用户回答的工具为止。

    prepare(messages, force) 返回这一步实际发给模型的消息（裁剪、压缩后的视图），
    messages 本身始终是完整历史。checkpoint(messages) 在每步工具结果写回后调用，用于逐步持久化。
    """
    specs = [t.spec() for t in tools.values()]
    final_text = ""
    for _ in range(max_steps):
        step: ModelStep | None = None
        for attempt in range(2):
            view = await prepare(messages, attempt > 0) if prepare else messages
            try:
                async for kind, value in model.stream(view, specs):
                    if kind == "text":
                        await emit("message.delta", {"text": value})
                    elif kind == "reset":
                        await emit("message.reset", {})
                    elif kind == "step":
                        step = value
                break
            except ContextOverflow:
                if attempt or not prepare:
                    raise
                logger.warning("[agent2] context overflow, forcing compaction")
        assert step is not None
        assistant: dict[str, Any] = {"role": "assistant", "content": step.text or None}
        if step.tool_calls:
            assistant["tool_calls"] = [
                {"id": c["id"], "type": "function", "function": {"name": c["name"], "arguments": c["arguments"] or "{}"}}
                for c in step.tool_calls
            ]
        messages.append(assistant)
        if step.tool_calls and checkpoint:
            checkpoint(messages)  # 工具开始前先落库：中途中断也知道发起过哪些调用
        if step.text:
            final_text = step.text
        if not step.tool_calls:
            return TurnResult(status="done", messages=messages, text=final_text)

        suspending = [c for c in step.tool_calls if tools.get(c["name"]) and tools[c["name"]].suspends]
        normal = [c for c in step.tool_calls if c not in suspending]
        results = await asyncio.gather(*[
            _run_tool(tools.get(c["name"]), c["name"], c, ctx_base, emit) for c in normal
        ])
        for call, content in zip(normal, results):
            messages.append({"role": "tool", "tool_call_id": call["id"], "content": content})
        if checkpoint:
            checkpoint(messages)
        if suspending:
            call = suspending[0]
            # 同一步里多余的提问直接回复"已忽略"，保证消息序列完整
            for extra in suspending[1:]:
                messages.append({"role": "tool", "tool_call_id": extra["id"],
                                 "content": json.dumps({"error": "一次只能提一个问题，已忽略"}, ensure_ascii=False)})
            try:
                args = json.loads(call.get("arguments") or "{}")
            except ValueError:
                args = {}
            pending = {"call_id": call["id"], "tool": call["name"], **(args if isinstance(args, dict) else {})}
            await emit("input.required", pending)
            return TurnResult(status="waiting_user", messages=messages, text=final_text, pending=pending)
    await emit("message.delta", {"text": "\n（本轮步骤已达上限，先停在这里。）"})
    return TurnResult(status="done", messages=messages, text=final_text)

from __future__ import annotations

import asyncio
import json
import unittest
from unittest.mock import patch

import httpx

from backend.agent2 import engine
from backend.model_routing import ModelRoute


def _sse(chunks: list[dict]) -> bytes:
    return "".join(f"data: {json.dumps(c, ensure_ascii=False)}\n\n" for c in chunks).encode() + b"data: [DONE]\n\n"


ERROR_STREAM = _sse([
    {"choices": [{"index": 0, "delta": {"content": "好的，正在生成"}}]},
    {"choices": [{"index": 0, "delta": {"tool_calls": [
        {"index": 0, "id": "bad", "function": {"name": "generate_image", "arguments": "{\"images\":"}}]}}]},
    {"choices": [{"index": 0, "delta": {}, "finish_reason": "error"}]},
])
OK_STREAM = _sse([
    {"choices": [{"index": 0, "delta": {"content": "备用线路的回复"}}]},
    {"choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]},
])


class RoutedModelClientTest(unittest.TestCase):
    def test_required_tool_text_only_response_fails_over(self):
        seen = []
        def handler(request):
            seen.append(request.url.host)
            if request.url.host == "bad.example":
                return httpx.Response(200, content=OK_STREAM)
            return httpx.Response(200, content=_sse([{"choices": [{"delta": {"tool_calls": [{
                "index": 0, "id": "c", "function": {"name": "ask_user", "arguments": "{}"}}]},
                "finish_reason": "tool_calls"}]}]))
        real_client = httpx.AsyncClient
        routes = [ModelRoute("sub2api", "http://bad.example/v1", "k", "gpt-6.1-sol"),
                  ModelRoute("apimart", "http://good.example/v1", "k", "m")]
        async def run():
            client = engine.RoutedModelClient()
            client.require_tool_once = True
            return [part async for part in client.stream([], [{"type": "function", "function": {"name": "ask_user"}}])]
        with patch.object(engine, "get_model_routes", return_value=routes), \
             patch.object(engine.httpx, "AsyncClient", lambda **kw: real_client(transport=httpx.MockTransport(handler))):
            parts = asyncio.run(run())
        self.assertEqual(seen, ["bad.example", "good.example"])
        self.assertEqual(parts[-1][1].tool_calls[0]["name"], "ask_user")

    def test_corrective_request_requires_a_tool_only_once(self):
        requests = []
        def handler(request):
            requests.append(json.loads(request.content))
            return httpx.Response(200, content=_sse([{"choices": [{"delta": {"tool_calls": [{
                "index": 0, "id": "c", "function": {"name": "ask_user", "arguments": "{}"}}]},
                "finish_reason": "tool_calls"}]}]))
        real_client = httpx.AsyncClient
        route = ModelRoute("sub2api", "http://test.example/v1", "k", "gpt-6.1-sol")
        async def run():
            client = engine.RoutedModelClient()
            client.require_tool_once = True
            specs = [{"type": "function", "function": {"name": "ask_user", "parameters": {"type": "object"}}}]
            _ = [part async for part in client.stream([], specs)]
            _ = [part async for part in client.stream([], specs)]
        with patch.object(engine, "get_model_routes", return_value=[route]), \
             patch.object(engine.httpx, "AsyncClient", lambda **kw: real_client(transport=httpx.MockTransport(handler))):
            asyncio.run(run())
        self.assertEqual(requests[0]["tool_choice"], "required")
        self.assertNotIn("tool_choice", requests[1])

    def _run(self, streams: dict[str, bytes]):
        seen = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(request.url.host)
            return httpx.Response(200, content=streams[request.url.host])

        real_client = httpx.AsyncClient
        routes = [ModelRoute("first", f"http://{host}/v1", "k", "m") for host in streams]
        with patch.object(engine, "get_model_routes", lambda purpose: routes), \
                patch.object(engine.httpx, "AsyncClient",
                             lambda **kw: real_client(transport=httpx.MockTransport(handler))):
            async def collect():
                return [part async for part in engine.RoutedModelClient().stream([], [])]
            return asyncio.run(collect()), seen

    def test_finish_reason_error_discards_partial_output_and_tries_next_route(self):
        parts, seen = self._run({"bad.example": ERROR_STREAM, "good.example": OK_STREAM})
        self.assertEqual(seen, ["bad.example", "good.example"])
        kinds = [k for k, _ in parts]
        self.assertEqual(kinds, ["text", "reset", "text", "step"])
        step = parts[-1][1]
        self.assertEqual(step.text, "备用线路的回复")
        self.assertEqual(step.tool_calls, [])

    def test_all_routes_error_raises(self):
        with self.assertRaises(engine.ModelRoutingError):
            self._run({"bad.example": ERROR_STREAM})


if __name__ == "__main__":
    unittest.main()

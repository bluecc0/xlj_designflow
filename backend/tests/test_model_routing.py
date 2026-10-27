from __future__ import annotations

import asyncio
import json
import unittest
from unittest.mock import AsyncMock, Mock, patch

import httpx

from backend import agent_mode, main, model_routing


def completion(text: str = "ok") -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": {"content": text}}]})


def sse(text: str, *, finished: bool = True) -> httpx.Response:
    events = ["data: " + json.dumps({"choices": [{"delta": {"content": text}}]})]
    if finished:
        events.append("data: [DONE]")
    return httpx.Response(200, text="\n\n".join(events) + "\n\n", headers={"Content-Type": "text/event-stream"})


class ModelRoutingTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.settings_patch = patch.multiple(
            model_routing.settings,
            cliproxy_base_url="https://sub.test/v1", cliproxy_api_key="sub-key", cliproxy_proxy_url="",
            ai_image_base_url="https://api.test", ai_image_api_key="api-key", ai_image_api_proxy_url="",
            apimart_llm_model="", apimart_vlm_model="",
            chat_llm_base_url="https://sub.test/v1", chat_llm_api_key="sub-key", chat_llm_model="text-model",
            agent_llm_base_url="https://sub.test/v1", agent_llm_api_key="sub-key", agent_llm_model="agent-model",
            skill_llm_base_url="https://sub.test/v1", skill_llm_api_key="sub-key", skill_llm_model="skill-model",
            agent_vlm_base_url="https://api.test", agent_vlm_api_key="api-key", agent_vlm_model="vision-model",
            current_vlm_config=lambda: ("https://api.test", "api-key", "vision-model"),
        )
        self.settings_patch.start()
        self.addCleanup(self.settings_patch.stop)
        self.requests = []
        self.real_client = httpx.AsyncClient

    def transport(self, handler):
        def capture(request):
            self.requests.append(request)
            return handler(request)
        transport = httpx.MockTransport(capture)
        return patch.object(model_routing.httpx, "AsyncClient", side_effect=lambda **kw: self.real_client(transport=transport, **kw))

    def test_routes_for_every_purpose(self):
        for purpose in ("chat_llm", "agent_llm", "skill_llm", "vlm", "agent_vlm"):
            with self.subTest(purpose=purpose):
                routes = model_routing.get_model_routes(purpose)
                self.assertEqual([r.provider for r in routes], ["sub2api", "apimart"])
                self.assertNotIn("sub-key", repr(routes))
                self.assertNotIn("api-key", repr(routes))
        with patch.multiple(model_routing.settings, apimart_llm_model="api-text", apimart_vlm_model="api-vision"):
            self.assertEqual(model_routing.get_model_routes("chat_llm")[1].model, "api-text")
            self.assertEqual(model_routing.get_model_routes("vlm")[1].model, "api-vision")

    def test_endpoint_normalization(self):
        for base in ("https://api.test", "https://api.test/v1/", "https://api.test/v1/chat/completions"):
            self.assertEqual(model_routing.chat_completions_endpoint(base), "https://api.test/v1/chat/completions")

    async def test_primary_success_never_calls_apimart(self):
        with self.transport(lambda _: completion()):
            response = await model_routing.routed_chat_completion("chat_llm", {"messages": []})
        self.assertEqual(len(self.requests), 1)
        self.assertEqual(response.extensions["model_route"]["provider"], "sub2api")

    async def test_errors_and_invalid_responses_fail_over_with_images_intact(self):
        messages = [{"role": "user", "content": [
            {"type": "text", "text": "描述"},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,cGlj"}},
        ]}]
        for failure in (401, 429, 502, "connect", "read", "empty", "malformed", "error", "invalid_result"):
            with self.subTest(failure=failure):
                self.requests.clear()
                def handler(request):
                    if request.url.host == "api.test":
                        return completion('{"mode":"edit"}')
                    if failure == "connect":
                        raise httpx.ConnectError("unavailable")
                    if failure == "read":
                        raise httpx.ReadTimeout("timeout")
                    if failure == "empty":
                        return completion("")
                    if failure == "malformed":
                        return httpx.Response(200, text="<html>gateway error</html>")
                    if failure == "error":
                        return httpx.Response(200, json={"error": {"message": "unavailable"}})
                    if failure == "invalid_result":
                        return completion("not json")
                    return httpx.Response(failure)
                with self.transport(handler), patch.object(model_routing.settings, "apimart_vlm_model", "api-vision"):
                    response = await model_routing.routed_chat_completion(
                        "vlm", {"messages": messages}, validate=lambda text: text.startswith('{"mode":'),
                    )
                self.assertEqual([r.url.host for r in self.requests], ["sub.test", "api.test"])
                for r, key in zip(self.requests, ("sub-key", "api-key")):
                    self.assertEqual(json.loads(r.content)["messages"], messages)
                    self.assertEqual(r.headers["authorization"], "Bearer " + key)
                self.assertEqual(json.loads(self.requests[1].content)["model"], "api-vision")
                self.assertEqual(response.extensions["model_route"]["provider"], "apimart")

    async def test_stream_partial_failure_resets_before_fallback(self):
        def handler(request):
            return sse("partial", finished=False) if request.url.host == "sub.test" else sse("complete")
        with self.transport(handler):
            events = [chunk async for chunk in model_routing.routed_chat_stream("agent_llm", {"messages": []})]
        self.assertEqual(events[0]["choices"][0]["delta"]["content"], "partial")
        self.assertTrue(events[1]["_route_reset"])
        self.assertEqual(events[2]["choices"][0]["delta"]["content"], "complete")
        self.assertEqual(events[2]["_route"]["provider"], "apimart")

    async def test_stream_http_error_empty_and_embedded_errors_fail_over(self):
        for failure in (httpx.Response(503), sse(""), httpx.Response(200, text='data: {"error":{"message":"bad"}}\n\n')):
            with self.subTest(failure=failure):
                self.requests.clear()
                with self.transport(lambda r: failure if r.url.host == "sub.test" else sse("complete")):
                    events = [chunk async for chunk in model_routing.routed_chat_stream("skill_llm", {"messages": []})]
                self.assertEqual(events[-1]["_route"]["provider"], "apimart")
                self.assertEqual(len(self.requests), 2)

    async def test_cancel_does_not_submit_fallback(self):
        def handler(request):
            raise asyncio.CancelledError()
        with self.transport(handler), self.assertRaises(asyncio.CancelledError):
            await model_routing.routed_chat_completion("chat_llm", {"messages": []})
        self.assertEqual(len(self.requests), 1)

    async def test_both_routes_fail_once_and_stop(self):
        with self.transport(lambda _: httpx.Response(503)), self.assertRaises(model_routing.ModelRoutingError):
            await model_routing.routed_chat_completion("chat_llm", {"messages": []})
        self.assertEqual(len(self.requests), 2)
        self.requests.clear()
        with self.transport(lambda _: httpx.Response(503)), self.assertRaises(model_routing.ModelRoutingError):
            _ = [c async for c in model_routing.routed_chat_stream("agent_llm", {"messages": []})]
        self.assertEqual(len(self.requests), 2)

    async def test_missing_subscription_uses_apimart(self):
        with patch.multiple(model_routing.settings, cliproxy_base_url="", cliproxy_api_key=""), self.transport(lambda _: completion()):
            response = await model_routing.routed_chat_completion("agent_vlm", {"messages": []})
        self.assertEqual([r.url.host for r in self.requests], ["api.test"])
        self.assertEqual(response.extensions["model_route"]["provider"], "apimart")

    async def test_nonstream_sse_compatibility(self):
        with self.transport(lambda _: sse("ok")):
            response = await model_routing.routed_chat_completion("vlm", {"messages": []})
        self.assertEqual(response.json()["choices"][0]["message"]["content"], "ok")

    async def test_chat_endpoint_uses_new_fallback(self):
        with self.transport(lambda r: httpx.Response(503) if r.url.host == "sub.test" else completion("回答")):
            result = await main.chat_endpoint(main.ChatRequest(messages=[{"role": "user", "content": "你好"}]))
        self.assertEqual(result, {"reply": "回答"})
        self.assertEqual([r.url.host for r in self.requests], ["sub.test", "api.test"])

    async def test_agent_stream_discards_failed_reply_and_patch(self):
        final = '新回复[[VISUAL_INTENT_PATCH]]{"turnType":"add_detail","patch":{"subject":"新主体"}}'
        def handler(request):
            return sse("旧回复[[VISUAL_INTENT_PATCH]]", finished=False) if request.url.host == "sub.test" else sse(final)
        visible = []
        resets = []
        def reset():
            visible.clear()
            resets.append(True)
        with self.transport(handler):
            text, patch_result = await agent_mode.call_agent_llm(
                "生成", agent_mode.default_project_state(), [], on_chunk=visible.append, on_reset=reset,
            )
        self.assertEqual(text, "新回复")
        self.assertEqual("".join(visible), "新回复")
        self.assertEqual(patch_result.patch["subject"], "新主体")
        self.assertEqual(resets, [True])

    async def test_skill_planner_uses_apimart_before_deterministic_fallback(self):
        reply = '{"final_prompt":"有效的生图描述","steps":["理解需求"]}'
        with self.transport(lambda r: httpx.Response(503) if r.url.host == "sub.test" else completion(reply)):
            prompt, trace = await main._plan_skill_image_prompt("海报", "test-skill", "skill instructions")
        self.assertEqual(prompt, "有效的生图描述")
        self.assertEqual(trace["provider"], "apimart")

    async def test_reference_analysis_uses_vision_fallback(self):
        reply = '{"summary":"一张商品图","extractedInfo":{"subject":"商品"}}'
        with self.transport(lambda r: httpx.Response(503) if r.url.host == "sub.test" else completion(reply)):
            result = await agent_mode.analyze_reference_images([(b"image", "image.png")], "分析", {})
        self.assertEqual(result.summary, "一张商品图")
        self.assertEqual([r.url.host for r in self.requests], ["sub.test", "api.test"])
        for request in self.requests:
            image = json.loads(request.content)["messages"][0]["content"][1]
            self.assertTrue(image["image_url"]["url"].startswith("data:image/png;base64,"))

    async def test_critic_uses_vision_fallback(self):
        reply = '{"qualityScore":80,"intentMatch":90,"confidence":0.9}'
        with self.transport(lambda r: httpx.Response(503) if r.url.host == "sub.test" else completion(reply)), \
                patch.object(agent_mode, "_resolve_image_data_url", AsyncMock(return_value="data:image/png;base64,cGlj")):
            result = await agent_mode.run_vlm_critic("/test.png", agent_mode.default_project_state())
        self.assertEqual(result["status"], "checked")
        self.assertEqual(result["qualityScore"], 80)

    async def test_context_rewrite_uses_new_route(self):
        with self.transport(lambda r: httpx.Response(503) if r.url.host == "sub.test" else completion("完整改写后的需求")), \
                patch.object(main, "load_ai_chat_messages", return_value=[
                    {"who": "user", "text": "白底杯子"}, {"who": "ai", "text": "生成白底杯子"},
                ]):
            result = await main._build_context_aware_prompt("test-session", "test-user", "换红色")
        self.assertEqual(result, "完整改写后的需求")
        self.assertEqual([r.url.host for r in self.requests], ["sub.test", "api.test"])

    async def test_skill_stream_sends_reset_and_valid_final_plan(self):
        def handler(request):
            return sse('broken', finished=False) if request.url.host == "sub.test" else sse('{"final_prompt":"有效计划"}')
        with self.transport(handler), patch.object(main, "_current_user", return_value={"id": "test-user"}), \
                patch.object(main, "_load_active_skill_context", return_value=("instructions", {"name": "test-skill"})):
            response = await main.agent_skill_plan_stream_endpoint(Mock(), "test-skill", "海报", image=[])
            events = "".join([part async for part in response.body_iterator])
        self.assertIn("event: reset\n", events)
        self.assertIn("event: done\n", events)
        final_event = events.split("event: done\n")[-1]
        self.assertIn('"final_prompt": "有效计划"', final_event)
        self.assertIn('"provider": "apimart"', final_event)
        self.assertNotIn("broken", final_event)

    async def test_agent_endpoint_both_failures_end_with_error(self):
        request = Mock()
        request.headers = {"content-type": "application/json"}
        request.json = AsyncMock(return_value={"message": "设计一张海报"})
        with self.transport(lambda _: httpx.Response(503)), \
                patch.object(main, "_current_user", return_value={"id": "test-user", "username": "tester"}), \
                patch.object(main, "get_agent_project", return_value={"id": "test-project"}), \
                patch.object(main, "load_agent_messages", return_value=[]), \
                patch.object(main, "log_operation"), \
                patch.object(main, "append_agent_message"):
            response = await main.agent_project_chat_endpoint(request, "test-project")
            async def collect():
                return "".join([part async for part in response.body_iterator])
            events = await asyncio.wait_for(collect(), timeout=1)
        self.assertIn("event: error\n", events)
        self.assertEqual([r.url.host for r in self.requests], ["sub.test", "api.test"])


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import base64
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from backend import ai_image, job_store


class SmartRoutingTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_db_path = job_store._DB_PATH
        job_store._DB_PATH = Path(self.temp_dir.name) / "smart-routing-test.db"
        job_store.init_db()

    def tearDown(self) -> None:
        job_store._DB_PATH = self.original_db_path
        self.temp_dir.cleanup()

    def test_normalize_provider(self) -> None:
        self.assertEqual(ai_image.normalize_provider("auto"), "auto")
        self.assertEqual(ai_image.normalize_provider("smart"), "auto")
        self.assertEqual(ai_image.normalize_provider("智能路由"), "auto")
        self.assertEqual(ai_image.normalize_provider("adobe2api"), "adobe2api")
        self.assertEqual(ai_image.normalize_provider("sub2api"), "sub2api")

    def test_get_smart_route_candidates(self) -> None:
        with patch.object(ai_image.settings, "cliproxy_base_url", "http://sub2api:8080"), \
             patch.object(ai_image.settings, "cliproxy_api_key", "sk-sub2api"), \
             patch.object(ai_image.settings, "adobe2api_base_url", "http://adobe:6001"), \
             patch.object(ai_image.settings, "adobe2api_api_key", "sk-adobe"), \
             patch.object(ai_image.settings, "ai_image_api_key", "sk-apimart"):

            gpt_1k_candidates = ai_image.get_smart_route_candidates("gpt-image-2", resolution="1K")
            self.assertEqual(gpt_1k_candidates, ["sub2api", "apimart", "adobe2api"])

            gpt_2k_candidates = ai_image.get_smart_route_candidates("gpt-image-2", resolution="2K")
            self.assertEqual(gpt_2k_candidates, ["apimart", "adobe2api"])

            gpt_4k_candidates = ai_image.get_smart_route_candidates("gpt-image-2", resolution="4K")
            self.assertEqual(gpt_4k_candidates, ["apimart", "adobe2api"])

            banana_candidates = ai_image.get_smart_route_candidates("nano-banana-pro")
            self.assertEqual(banana_candidates, ["apimart", "adobe2api"])

    def test_custom_routing_rules_json_override(self) -> None:
        custom_json = '{"gpt-image-2": ["adobe2api", "sub2api"]}'
        with patch.object(ai_image.settings, "smart_routing_rules_json", custom_json), \
             patch.object(ai_image.settings, "cliproxy_base_url", "http://sub2api:8080"), \
             patch.object(ai_image.settings, "cliproxy_api_key", "sk-sub2api"), \
             patch.object(ai_image.settings, "adobe2api_base_url", "http://adobe:6001"), \
             patch.object(ai_image.settings, "adobe2api_api_key", "sk-adobe"):

            candidates = ai_image.get_smart_route_candidates("gpt-image-2", resolution="1K")
            self.assertEqual(candidates, ["adobe2api", "sub2api"])

    async def test_smart_generate_image_failover(self) -> None:
        attempts = []

        async def mock_sub2api(*args, **kwargs):
            raise RuntimeError("CLIProxyAPI 连接失败：ConnectError")

        async def mock_adobe2api(*args, **kwargs):
            return {
                "url": "/ai-images/test/result.png",
                "model": "firefly-gpt-image-1k-1x1",
                "prompt": "test prompt",
                "size": "1024x1024",
                "provider": "adobe2api",
            }

        with patch.object(ai_image, "generate_sub2api_async", side_effect=mock_sub2api), \
             patch.object(ai_image, "generate_adobe2api_async", side_effect=mock_adobe2api), \
             patch.object(ai_image, "get_smart_route_candidates", return_value=["sub2api", "adobe2api"]):

            result = await ai_image.smart_generate_image_async(
                model="gpt-image-2",
                prompt="test prompt",
                user_id="test_user",
                on_attempt=attempts.append,
            )

            self.assertEqual(result["provider"], "adobe2api")
            self.assertTrue(result.get("provider_switched"))
            self.assertEqual(attempts, ["sub2api", "adobe2api"])

    def test_empty_candidates_are_not_repopulated(self) -> None:
        with patch.object(ai_image.settings, "smart_routing_rules_json", ""), \
             patch.object(ai_image.settings, "cliproxy_base_url", ""), \
             patch.object(ai_image.settings, "cliproxy_api_key", ""), \
             patch.object(ai_image.settings, "adobe2api_base_url", ""), \
             patch.object(ai_image.settings, "adobe2api_api_key", ""), \
             patch.object(ai_image.settings, "ai_image_api_key", ""):
            self.assertEqual(
                ai_image.get_smart_route_candidates("gpt-image-2", resolution="1K"),
                [],
            )

    async def test_smart_route_rejects_empty_candidates_before_dispatch(self) -> None:
        with patch.object(ai_image, "get_smart_route_candidates", return_value=[]):
            with self.assertRaisesRegex(ai_image.AllProvidersFailedError, "经过 2 轮尝试后仍未成功"):
                await ai_image.smart_generate_image_async(
                    model="gpt-image-2",
                    prompt="test",
                    user_id="u",
                )

    async def test_http_504_before_accepted_does_failover(self) -> None:
        """拿到明确 HTTP 错误码后，本请求不会返回图，应静默切到下一线路。"""
        calls = {"sub": 0, "adobe": 0}

        async def mock_sub2api(*args, **kwargs):
            calls["sub"] += 1
            raise RuntimeError("CLIProxyAPI 生图失败：HTTP 504")

        async def mock_adobe(*args, **kwargs):
            calls["adobe"] += 1
            return {"url": "/x.png", "provider": "adobe2api"}

        with patch.object(ai_image, "generate_sub2api_async", side_effect=mock_sub2api), \
             patch.object(ai_image, "generate_adobe2api_async", side_effect=mock_adobe), \
             patch.object(ai_image, "get_smart_route_candidates", return_value=["sub2api", "adobe2api"]):
            result = await ai_image.smart_generate_image_async(
                model="gpt-image-2",
                prompt="test",
                user_id="u",
            )
        self.assertEqual(calls, {"sub": 1, "adobe": 1})
        self.assertEqual(result.get("provider"), "adobe2api")
        self.assertTrue(result.get("provider_switched"))

    async def test_sub2api_malformed_200_fails_over_before_acceptance(self) -> None:
        adobe_calls = 0

        class FakeResponse:
            is_success = True
            status_code = 200
            text = "<html>bad gateway body</html>"

            def json(self):
                raise ValueError("not json")

        class FakeClient:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

            async def post(self, *args, **kwargs):
                return FakeResponse()

        async def mock_adobe(*args, **kwargs):
            nonlocal adobe_calls
            adobe_calls += 1
            return {"url": "/x.png", "provider": "adobe2api"}

        with patch.object(ai_image.settings, "cliproxy_base_url", "http://sub2api:8080"), \
             patch.object(ai_image.settings, "cliproxy_api_key", "sk-sub2api"), \
             patch.object(ai_image.httpx, "AsyncClient", FakeClient), \
             patch.object(ai_image, "generate_adobe2api_async", side_effect=mock_adobe), \
             patch.object(ai_image, "get_smart_route_candidates", return_value=["sub2api", "adobe2api"]):
            result = await ai_image.smart_generate_image_async(
                model="gpt-image-2",
                prompt="test",
                user_id="u",
            )
        self.assertEqual(adobe_calls, 1)
        self.assertEqual(result.get("provider"), "adobe2api")
        self.assertTrue(result.get("provider_switched"))

    async def test_apimart_submit_504_is_hard_failure(self) -> None:
        class FakeResponse:
            is_success = False
            status_code = 504
            text = '{"error":"gateway timeout"}'

            def json(self):
                return {"error": "gateway timeout"}

        class FakeClient:
            async def post(self, *args, **kwargs):
                return FakeResponse()

        with self.assertRaises(RuntimeError) as ctx:
            await ai_image._submit_generation_task(
                FakeClient(),
                base_url="http://apimart",
                headers={"Authorization": "Bearer test"},
                model="gpt-image-2",
                prompt="test",
                size="auto",
            )
        self.assertNotIsInstance(ctx.exception, ai_image.AmbiguousUpstreamError)
        self.assertIn("HTTP 504", str(ctx.exception))
        self.assertTrue(ai_image.is_transient_provider_error(ctx.exception))

    async def test_sub2api_http_500_failovers_silently(self) -> None:
        """POST 后明确 HTTP 500：用户无感切线，不抛 ambiguous。"""
        adobe_calls = 0

        class FakeResponse:
            is_success = False
            status_code = 500
            text = (
                "The server had an error while processing your request. "
                "Sorry about that!"
            )

            def json(self):
                return {"error": self.text}

        class FakeClient:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

            async def post(self, *args, **kwargs):
                return FakeResponse()

        async def mock_adobe(*args, **kwargs):
            nonlocal adobe_calls
            adobe_calls += 1
            return {"url": "/x.png", "provider": "adobe2api"}

        with patch.object(ai_image.settings, "cliproxy_base_url", "http://sub2api:8080"), \
             patch.object(ai_image.settings, "cliproxy_api_key", "sk-sub2api"), \
             patch.object(ai_image.httpx, "AsyncClient", FakeClient), \
             patch.object(ai_image, "generate_adobe2api_async", side_effect=mock_adobe), \
             patch.object(ai_image, "get_smart_route_candidates", return_value=["sub2api", "adobe2api"]):
            result = await ai_image.smart_generate_image_async(
                model="gpt-image-2",
                prompt="test",
                user_id="u",
            )
        self.assertEqual(adobe_calls, 1)
        self.assertEqual(result.get("provider"), "adobe2api")
        self.assertTrue(result.get("provider_switched"))

    async def test_two_round_cycle_recovers_on_second_pass(self) -> None:
        """线路 1→2→3 全失败后，第二轮回到线路 1 成功，用户无感。"""
        calls = {"sub": 0, "adobe": 0, "api": 0}

        async def mock_sub2api(*args, **kwargs):
            calls["sub"] += 1
            if calls["sub"] == 1:
                raise RuntimeError("CLIProxyAPI 生图失败：HTTP 500")
            return {"url": "/ok.png", "provider": "sub2api"}

        async def mock_adobe(*args, **kwargs):
            calls["adobe"] += 1
            raise RuntimeError("adobe2api 请求失败: HTTP 503 - unavailable")

        async def mock_apimart(*args, **kwargs):
            calls["api"] += 1
            raise RuntimeError("提交生图任务失败：HTTP 502 - bad gateway")

        attempts: list[str] = []
        with patch.object(ai_image, "generate_sub2api_async", side_effect=mock_sub2api), \
             patch.object(ai_image, "generate_adobe2api_async", side_effect=mock_adobe), \
             patch.object(ai_image, "generate_image_async", side_effect=mock_apimart), \
             patch.object(
                 ai_image,
                 "get_smart_route_candidates",
                 return_value=["sub2api", "adobe2api", "apimart"],
             ):
            result = await ai_image.smart_generate_image_async(
                model="gpt-image-2",
                prompt="test",
                user_id="u",
                on_attempt=attempts.append,
            )

        self.assertEqual(calls, {"sub": 2, "adobe": 1, "api": 1})
        self.assertEqual(attempts, ["sub2api", "adobe2api", "apimart", "sub2api"])
        self.assertEqual(result.get("provider"), "sub2api")
        self.assertTrue(result.get("provider_switched"))

    async def test_two_round_all_fail_raises_after_full_cycle(self) -> None:
        """两轮全部暂态失败后才抛错。"""
        calls = {"sub": 0, "adobe": 0}

        async def mock_sub2api(*args, **kwargs):
            calls["sub"] += 1
            raise RuntimeError("CLIProxyAPI 生图失败：HTTP 500")

        async def mock_adobe(*args, **kwargs):
            calls["adobe"] += 1
            raise RuntimeError("adobe2api 请求失败: HTTP 503 - unavailable")

        with patch.object(ai_image, "generate_sub2api_async", side_effect=mock_sub2api), \
             patch.object(ai_image, "generate_adobe2api_async", side_effect=mock_adobe), \
             patch.object(ai_image, "get_smart_route_candidates", return_value=["sub2api", "adobe2api"]):
            with self.assertRaises(RuntimeError) as ctx:
                await ai_image.smart_generate_image_async(
                    model="gpt-image-2",
                    prompt="test",
                    user_id="u",
                )

        self.assertEqual(calls, {"sub": 2, "adobe": 2})
        self.assertIn("2 轮", str(ctx.exception))

    def test_skill_generation_uses_smart_routing(self) -> None:
        chat_source = (
            Path(__file__).resolve().parents[1] / "frontend" / "src" / "Chat.jsx"
        ).read_text(encoding="utf-8")
        branch_start = chat_source.index(
            "if (activeSkill && !aiCmd && aiOptions.workflow !== 'download')"
        )
        branch_end = chat_source.index("// 检测\"重新生成\"关键词", branch_start)
        skill_branch = chat_source[branch_start:branch_end]
        self.assertIn("provider: 'auto'", skill_branch)
        self.assertNotIn("provider: 'sub2api'", skill_branch)

    def test_batch_history_keeps_actual_failover_provider(self) -> None:
        session = job_store.create_ai_chat_session(user_id="u", title="batch")
        common_meta = {
            "model": "gpt-image-2",
            "prompt": "test",
            "status": "done",
            "batchId": "batch-1",
            "batchCount": 2,
        }
        job_store.append_ai_chat_message(
            session_id=session["id"],
            user_id="u",
            role="ai",
            type="ai_image_result",
            text="test",
            image_url="/first.png",
            meta={
                **common_meta,
                "job_id": "job-1",
                "batchIndex": 0,
                "provider": "sub2api",
                "providerSwitched": False,
            },
        )
        job_store.append_ai_chat_message(
            session_id=session["id"],
            user_id="u",
            role="ai",
            type="ai_image_result",
            text="test",
            image_url="/second.png",
            meta={
                **common_meta,
                "job_id": "job-2",
                "batchIndex": 1,
                "provider": "adobe2api",
                "providerSwitched": True,
            },
        )

        messages = job_store.load_ai_chat_messages(session["id"], user_id="u")
        self.assertEqual(len(messages), 1)
        self.assertTrue(messages[0]["providerSwitched"])
        self.assertEqual(messages[0]["provider"], "adobe2api")
        self.assertEqual(messages[0]["images"][1]["provider"], "adobe2api")

    def test_normalize_size_respects_explicit_resolution(self) -> None:
        ratio, res = ai_image._normalize_size("auto", "2K")
        self.assertEqual(ratio, "auto")
        self.assertEqual(res, "2K")
        ratio, res = ai_image._normalize_size("auto", "4K")
        self.assertEqual(res, "4K")
        ratio, res = ai_image._normalize_size("1024x1024", "2K")
        self.assertEqual(ratio, "1:1")
        self.assertEqual(res, "2K")

    async def test_adobe2api_request_maps_gemini_and_sends_all_refs(self) -> None:
        """真实调用 generate_adobe2api_async，断言请求 JSON 模型名与参考图数量。"""
        captured: dict = {}
        tiny_png = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        )
        data_url = "data:image/png;base64," + base64.b64encode(tiny_png).decode("ascii")

        class FakeResponse:
            is_success = True
            status_code = 200

            def json(self):
                return {
                    "id": "chatcmpl-test",
                    "choices": [{
                        "message": {
                            "content": data_url,
                        }
                    }],
                }

        class FakeClient:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

            async def post(self, url, json=None, headers=None):
                captured["url"] = url
                captured["json"] = json
                captured["headers"] = headers
                return FakeResponse()

        refs = [(tiny_png, f"ref-{i}.png") for i in range(9)]
        with patch.object(ai_image.settings, "adobe2api_base_url", "http://adobe:6001/v1"), \
             patch.object(ai_image.settings, "adobe2api_api_key", "sk-adobe"), \
             patch.object(ai_image.httpx, "AsyncClient", FakeClient), \
             patch.object(ai_image, "_save_data_url_image", return_value="/ai-images/t/out.png"):
            result = await ai_image.generate_adobe2api_async(
                model="nano-banana-pro",
                prompt="edit this product",
                images=refs,
                size="auto",
                resolution="2K",
                user_id="u1",
            )

        self.assertEqual(result["model"], "firefly-nano-banana-pro-2k-auto")
        payload = captured["json"]
        self.assertEqual(payload["model"], "firefly-nano-banana-pro-2k-auto")
        content = payload["messages"][0]["content"]
        self.assertEqual(len(content), 10)
        self.assertEqual(content[0]["type"], "text")
        self.assertEqual(sum(1 for c in content if c.get("type") == "image_url"), 9)

    def test_adobe2api_extracts_markdown_wrapped_image_url(self) -> None:
        image_url = "https://cdn.example.com/generated/result.png?token=abc"
        payload = {
            "id": "chatcmpl-test",
            "object": "chat.completion",
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": f"图片已生成：\n![result]({image_url})",
                },
            }],
        }

        self.assertEqual(ai_image._extract_b64_or_image_url(payload), image_url)

    def test_adobe2api_extracts_image_from_json_string_content(self) -> None:
        image_url = "https://cdn.example.com/generated/result.webp"
        payload = {
            "choices": [{
                "message": {
                    "content": '{"type":"image_url","image_url":{"url":"' + image_url + '"}}',
                },
            }],
        }

        self.assertEqual(ai_image._extract_b64_or_image_url(payload), image_url)

    async def test_adobe2api_url_result_uses_shared_download_pipeline(self) -> None:
        image_url = "https://cdn.example.com/generated/result.png"

        class FakeResponse:
            is_success = True
            status_code = 200

            def json(self):
                return {
                    "id": "chatcmpl-adobe-result",
                    "choices": [{
                        "message": {
                            "content": f"图片已生成：![result]({image_url})",
                        },
                    }],
                }

        class FakeClient:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

            async def post(self, *args, **kwargs):
                return FakeResponse()

        async def fake_download(client, *, image_url, user_id, task_id=""):
            self.assertEqual(image_url, "https://cdn.example.com/generated/result.png")
            self.assertEqual(user_id, "u1")
            self.assertEqual(task_id, "chatcmpl-adobe-result")
            return "/ai-images/u1/result.png"

        with patch.object(ai_image.settings, "adobe2api_base_url", "http://adobe:6001/v1"), \
             patch.object(ai_image.settings, "adobe2api_api_key", "sk-adobe"), \
             patch.object(ai_image.httpx, "AsyncClient", FakeClient), \
             patch.object(ai_image, "_download_final_image", side_effect=fake_download) as download_mock:
            result = await ai_image.generate_adobe2api_async(
                model="gpt-image-2",
                prompt="create a poster",
                size="16:9",
                resolution="2K",
                user_id="u1",
            )

        self.assertEqual(result["url"], "/ai-images/u1/result.png")
        self.assertEqual(result["model"], "firefly-gpt-image-2k-16x9")
        self.assertEqual(result["task_id"], "chatcmpl-adobe-result")
        download_mock.assert_awaited_once()

    async def test_non_safety_400_still_fails_over(self) -> None:
        calls = {"adobe": 0, "apimart": 0}

        async def mock_adobe(*args, **kwargs):
            calls["adobe"] += 1
            raise RuntimeError("adobe2api 请求失败: HTTP 400 - invalid prompt")

        async def mock_apimart(*args, **kwargs):
            calls["apimart"] += 1
            return {"url": "/x.png", "provider": "apimart"}

        with patch.object(ai_image, "generate_adobe2api_async", side_effect=mock_adobe), \
             patch.object(ai_image, "generate_image_async", side_effect=mock_apimart), \
             patch.object(ai_image, "get_smart_route_candidates", return_value=["adobe2api", "apimart"]):
            result = await ai_image.smart_generate_image_async(
                model="gpt-image-2",
                prompt="bad",
                user_id="u",
                resolution="2K",
            )
        self.assertEqual(calls["adobe"], 1)
        self.assertEqual(calls["apimart"], 1)
        self.assertEqual(result["provider"], "apimart")

    async def test_already_accepted_skips_same_provider_but_tries_another(self) -> None:
        """上游已接受后不重复提交同一线路，但继续尝试其他线路。"""
        calls = {"sub": 0, "adobe": 0}

        async def mock_sub2api(*args, **kwargs):
            calls["sub"] += 1
            on_accepted = kwargs.get("on_accepted")
            if on_accepted:
                on_accepted("cliproxy-task-1")
            on_progress = kwargs.get("on_progress")
            if on_progress:
                on_progress(85, "saving")
            raise RuntimeError("下载结果图片失败：HTTP 504")

        async def mock_adobe(*args, **kwargs):
            calls["adobe"] += 1
            return {"url": "/x.png", "provider": "adobe2api"}

        with patch.object(ai_image, "generate_sub2api_async", side_effect=mock_sub2api), \
             patch.object(ai_image, "generate_adobe2api_async", side_effect=mock_adobe), \
             patch.object(ai_image, "get_smart_route_candidates", return_value=["sub2api", "adobe2api"]):
            result = await ai_image.smart_generate_image_async(
                model="gpt-image-2",
                prompt="test",
                user_id="u",
            )
        self.assertEqual(calls["sub"], 1)
        self.assertEqual(calls["adobe"], 1)
        self.assertEqual(result["provider"], "adobe2api")

    async def test_pre_accept_progress_callback_still_allows_failover(self) -> None:
        """请求发出前的 starting/submitted 进度不得阻止 failover（修复假阳性）。"""
        calls = {"sub": 0, "adobe": 0}

        async def mock_sub2api(*args, **kwargs):
            calls["sub"] += 1
            on_progress = kwargs.get("on_progress")
            if on_progress:
                on_progress(5, "starting")
                on_progress(10, "submitted")
            raise RuntimeError("CLIProxyAPI 请求失败：Connection refused")

        async def mock_adobe(*args, **kwargs):
            calls["adobe"] += 1
            return {"url": "/x.png", "provider": "adobe2api"}

        with patch.object(ai_image, "generate_sub2api_async", side_effect=mock_sub2api), \
             patch.object(ai_image, "generate_adobe2api_async", side_effect=mock_adobe), \
             patch.object(ai_image, "get_smart_route_candidates", return_value=["sub2api", "adobe2api"]):
            result = await ai_image.smart_generate_image_async(
                model="gpt-image-2",
                prompt="test",
                user_id="u",
            )
        self.assertEqual(calls["sub"], 1)
        self.assertEqual(calls["adobe"], 1)
        self.assertEqual(result["provider"], "adobe2api")
        self.assertTrue(result.get("provider_switched"))

    async def test_apimart_accepted_then_poll_fail_tries_another_provider(self) -> None:
        """APIMart 拿到 task_id 后轮询失败时，跳过该线路并尝试其他线路。"""
        calls = {"apimart": 0, "adobe": 0}

        async def mock_apimart(*args, **kwargs):
            calls["apimart"] += 1
            on_accepted = kwargs.get("on_accepted")
            if on_accepted:
                on_accepted("task-abc")
            raise RuntimeError("查询任务状态网络异常：timeout")

        async def mock_adobe(*args, **kwargs):
            calls["adobe"] += 1
            return {"url": "/x.png", "provider": "adobe2api"}

        with patch.object(ai_image, "generate_image_async", side_effect=mock_apimart), \
             patch.object(ai_image, "generate_adobe2api_async", side_effect=mock_adobe), \
             patch.object(ai_image, "get_smart_route_candidates", return_value=["apimart", "adobe2api"]):
            result = await ai_image.smart_generate_image_async(
                model="gpt-image-2",
                prompt="test",
                user_id="u",
            )
        self.assertEqual(calls["apimart"], 1)
        self.assertEqual(calls["adobe"], 1)
        self.assertEqual(result["provider"], "adobe2api")

    async def test_safety_review_stops_immediately(self) -> None:
        calls = {"sub": 0, "adobe": 0}

        async def mock_sub2api(*args, **kwargs):
            calls["sub"] += 1
            raise RuntimeError("HTTP 400: content_policy_violation")

        async def mock_adobe(*args, **kwargs):
            calls["adobe"] += 1
            return {"url": "/x.png", "provider": "adobe2api"}

        with patch.object(ai_image, "generate_sub2api_async", side_effect=mock_sub2api), \
             patch.object(ai_image, "generate_adobe2api_async", side_effect=mock_adobe), \
             patch.object(ai_image, "get_smart_route_candidates", return_value=["sub2api", "adobe2api"]):
            with self.assertRaises(ai_image.SafetyReviewError) as ctx:
                await ai_image.smart_generate_image_async(
                    model="gpt-image-2",
                    prompt="test",
                    user_id="u",
                )
        self.assertEqual(calls, {"sub": 1, "adobe": 0})
        self.assertEqual(str(ctx.exception), "内容被上游安全审核系统拦截，请调整提示词或参考图后重试")


class AdobeHealthProbeTest(unittest.IsolatedAsyncioTestCase):
    async def test_probe_adobe2api_status_codes(self) -> None:
        from backend.main import _probe_adobe2api

        class Resp:
            def __init__(self, code: int):
                self.status_code = code

        class Client:
            def __init__(self, sequence):
                self.sequence = list(sequence)
                self.calls = []

            async def get(self, url, headers=None):
                self.calls.append(url)
                code = self.sequence.pop(0) if self.sequence else 500
                return Resp(code)

        with patch("backend.main.settings") as s:
            s.adobe2api_base_url = "http://adobe:6001/v1"
            s.adobe2api_api_key = "sk"

            c = Client([200])
            st = await _probe_adobe2api(c)
            self.assertTrue(st["connected"])
            self.assertTrue(st["url"].endswith("/v1"))

            c = Client([401])
            st = await _probe_adobe2api(c)
            self.assertFalse(st["connected"])
            self.assertIn("401", st.get("message", ""))

            # /models 404 后继续探测，chat/completions 405 视为端点可达
            c = Client([404, 405])
            st = await _probe_adobe2api(c)
            self.assertTrue(st["connected"])
            self.assertEqual(len(c.calls), 2)

            c = Client([429])
            st = await _probe_adobe2api(c)
            self.assertTrue(st["connected"])
            self.assertTrue(st.get("throttled"))

            # 未带 /v1 的 base 会被规范化
            s.adobe2api_base_url = "http://adobe:6001"
            c = Client([200])
            st = await _probe_adobe2api(c)
            self.assertTrue(st["url"].endswith("/v1"))
            self.assertTrue(c.calls[0].startswith("http://adobe:6001/v1/"))


class TimeoutClassificationTest(unittest.IsolatedAsyncioTestCase):
    def test_classify_httpx_transport_error(self) -> None:
        self.assertEqual(ai_image.classify_httpx_transport_error(httpx.ConnectTimeout("t")), "connect")
        self.assertEqual(ai_image.classify_httpx_transport_error(httpx.ConnectError("refused")), "connect")
        self.assertEqual(ai_image.classify_httpx_transport_error(httpx.ReadTimeout("rt")), "ambiguous")
        self.assertEqual(ai_image.classify_httpx_transport_error(httpx.WriteTimeout("wt")), "ambiguous")
        # Read/Write/CloseError 即使文案含 connection 也不得判为 connect
        self.assertEqual(ai_image.classify_httpx_transport_error(httpx.ReadError("Connection reset by peer")), "ambiguous")
        self.assertEqual(ai_image.classify_httpx_transport_error(httpx.WriteError("Connection reset by peer")), "ambiguous")
        self.assertEqual(ai_image.classify_httpx_transport_error(httpx.CloseError("connection closed")), "ambiguous")
        self.assertEqual(ai_image.classify_httpx_transport_error(httpx.RemoteProtocolError("server disconnected")), "ambiguous")

    def test_ambiguous_error_message_does_not_suggest_switch_line(self) -> None:
        msg = ai_image.format_generation_error(
            ai_image.AmbiguousUpstreamError(
                "CLIProxyAPI 请求可能已送达但响应超时/中断（状态不确定，不切换渠道）：ReadTimeout"
            ),
            stage="smart_route",
            provider="sub2api",
            model="gpt-image-2",
        )
        self.assertIn("状态暂时无法确认", msg)
        self.assertNotIn("换线路", msg)

    async def test_read_timeout_before_acceptance_does_failover(self) -> None:
        calls = {"sub": 0, "adobe": 0}

        async def mock_sub2api(*args, **kwargs):
            calls["sub"] += 1
            raise ai_image.AmbiguousUpstreamError(
                "CLIProxyAPI 请求响应超时/中断（未收到受理确认）：ReadTimeout",
                provider="sub2api",
            )

        async def mock_adobe(*args, **kwargs):
            calls["adobe"] += 1
            return {"url": "/x.png", "provider": "adobe2api"}

        with patch.object(ai_image, "generate_sub2api_async", side_effect=mock_sub2api), \
             patch.object(ai_image, "generate_adobe2api_async", side_effect=mock_adobe), \
             patch.object(ai_image, "get_smart_route_candidates", return_value=["sub2api", "adobe2api"]):
            result = await ai_image.smart_generate_image_async(
                model="gpt-image-2",
                prompt="test",
                user_id="u",
            )
        self.assertEqual(calls["sub"], 1)
        self.assertEqual(calls["adobe"], 1)
        self.assertEqual(result.get("provider"), "adobe2api")
        self.assertTrue(result.get("provider_switched"))

    async def test_pre_accept_disconnects_exhaust_all_routing_rounds(self) -> None:
        calls = {"sub": 0, "adobe": 0}

        async def mock_sub2api(*args, **kwargs):
            calls["sub"] += 1
            raise ai_image.AmbiguousUpstreamError(
                "CLIProxyAPI 请求响应超时/中断（未收到受理确认）",
                provider="sub2api",
            )

        async def mock_adobe(*args, **kwargs):
            calls["adobe"] += 1
            raise ai_image.AmbiguousUpstreamError(
                "adobe2api 请求响应超时/中断（未收到受理确认）",
                provider="adobe2api",
            )

        with patch.object(ai_image, "generate_sub2api_async", side_effect=mock_sub2api), \
             patch.object(ai_image, "generate_adobe2api_async", side_effect=mock_adobe), \
             patch.object(ai_image, "get_smart_route_candidates", return_value=["sub2api", "adobe2api"]):
            with self.assertRaises(ai_image.AllProvidersFailedError) as ctx:
                await ai_image.smart_generate_image_async(
                    model="gpt-image-2",
                    prompt="test",
                    user_id="u",
                )

        self.assertEqual(calls, {"sub": ai_image.SMART_ROUTE_ROUNDS, "adobe": ai_image.SMART_ROUTE_ROUNDS})
        self.assertEqual(str(ctx.exception), ai_image.public_generation_error())
        self.assertNotIn("未收到受理确认", str(ctx.exception))

    def test_public_error_has_only_two_categories(self) -> None:
        self.assertEqual(
            ai_image.public_generation_error(RuntimeError("HTTP 401 unauthorized")),
            ai_image.public_generation_error(),
        )
        self.assertEqual(
            ai_image.public_generation_error(RuntimeError("blocked by safety filter")),
            "内容被上游安全审核系统拦截，请调整提示词或参考图后重试",
        )
        self.assertFalse(ai_image.is_safety_review_error(RuntimeError("HTTP 403 permission denied")))

    async def test_connect_error_does_failover(self) -> None:
        calls = {"sub": 0, "adobe": 0}

        async def mock_sub2api(*args, **kwargs):
            calls["sub"] += 1
            raise RuntimeError("CLIProxyAPI 连接失败：Connection refused")

        async def mock_adobe(*args, **kwargs):
            calls["adobe"] += 1
            return {"url": "/x.png", "provider": "adobe2api"}

        with patch.object(ai_image, "generate_sub2api_async", side_effect=mock_sub2api), \
             patch.object(ai_image, "generate_adobe2api_async", side_effect=mock_adobe), \
             patch.object(ai_image, "get_smart_route_candidates", return_value=["sub2api", "adobe2api"]):
            result = await ai_image.smart_generate_image_async(
                model="gpt-image-2",
                prompt="test",
                user_id="u",
            )
        self.assertEqual(calls["sub"], 1)
        self.assertEqual(calls["adobe"], 1)
        self.assertEqual(result["provider"], "adobe2api")

    async def test_on_accepted_outer_callback_receives_provider_and_task_id(self) -> None:
        seen = []

        async def mock_apimart(*args, **kwargs):
            on_accepted = kwargs.get("on_accepted")
            if on_accepted:
                on_accepted("task-xyz")
            raise RuntimeError("查询任务状态网络异常：timeout")

        with patch.object(ai_image, "generate_image_async", side_effect=mock_apimart), \
             patch.object(ai_image, "get_smart_route_candidates", return_value=["apimart"]):
            with self.assertRaises(RuntimeError) as ctx:
                await ai_image.smart_generate_image_async(
                    model="gpt-image-2",
                    prompt="test",
                    user_id="u",
                    on_accepted=lambda provider, tid: seen.append((provider, tid)),
                )
        self.assertEqual(seen, [("apimart", "task-xyz")])
        self.assertEqual(getattr(ctx.exception, "task_id", ""), "task-xyz")



    async def test_accepted_without_real_task_id_skips_same_provider(self) -> None:
        """无真实上游 id 时仍标记 accepted，跳过该线路并尝试其他线路。"""
        calls = {"sub": 0, "adobe": 0}
        seen = []

        async def mock_sub2api(*args, **kwargs):
            calls["sub"] += 1
            on_accepted = kwargs.get("on_accepted")
            if on_accepted:
                on_accepted("")  # 无真实 id
            raise RuntimeError("下载结果图片失败：HTTP 504")

        async def mock_adobe(*args, **kwargs):
            calls["adobe"] += 1
            return {"url": "/x.png", "provider": "adobe2api"}

        with patch.object(ai_image, "generate_sub2api_async", side_effect=mock_sub2api), \
             patch.object(ai_image, "generate_adobe2api_async", side_effect=mock_adobe), \
             patch.object(ai_image, "get_smart_route_candidates", return_value=["sub2api", "adobe2api"]):
            result = await ai_image.smart_generate_image_async(
                model="gpt-image-2",
                prompt="test",
                user_id="u",
                on_accepted=lambda provider, tid: seen.append((provider, tid)),
            )
        self.assertEqual(calls["sub"], 1)
        self.assertEqual(calls["adobe"], 1)
        self.assertEqual(seen, [("sub2api", "")])
        self.assertEqual(result["provider"], "adobe2api")

if __name__ == "__main__":
    unittest.main()

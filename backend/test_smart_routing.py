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
            self.assertEqual(gpt_2k_candidates, ["adobe2api", "apimart"])

            gpt_4k_candidates = ai_image.get_smart_route_candidates("gpt-image-2", resolution="4K")
            self.assertEqual(gpt_4k_candidates, ["adobe2api", "apimart"])

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
        async def mock_sub2api(*args, **kwargs):
            raise RuntimeError("sub2api timeout")

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
            )

            self.assertEqual(result["provider"], "adobe2api")
            self.assertTrue(result.get("provider_switched"))

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

    async def test_non_transient_error_does_not_failover(self) -> None:
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
            with self.assertRaises(RuntimeError):
                await ai_image.smart_generate_image_async(
                    model="gpt-image-2",
                    prompt="bad",
                    user_id="u",
                    resolution="2K",
                )
        self.assertEqual(calls["adobe"], 1)
        self.assertEqual(calls["apimart"], 0)

    async def test_already_accepted_does_not_failover(self) -> None:
        """上游已 on_accepted 后，下载失败不得再切下一渠道，且不提示换线路。"""
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

        with patch.object(ai_image, "generate_sub2api_async", side_effect=mock_sub2api),              patch.object(ai_image, "generate_adobe2api_async", side_effect=mock_adobe),              patch.object(ai_image, "get_smart_route_candidates", return_value=["sub2api", "adobe2api"]):
            with self.assertRaises(ai_image.AmbiguousUpstreamError) as ctx:
                await ai_image.smart_generate_image_async(
                    model="gpt-image-2",
                    prompt="test",
                    user_id="u",
                )
        self.assertEqual(calls["sub"], 1)
        self.assertEqual(calls["adobe"], 0)
        self.assertEqual(getattr(ctx.exception, "task_id", ""), "cliproxy-task-1")
        msg = str(ctx.exception)
        self.assertIn("状态暂时无法确认", msg)
        self.assertNotIn("换线路", msg)

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

    async def test_apimart_accepted_then_poll_fail_no_failover(self) -> None:
        """APIMart 拿到 task_id 后轮询失败，不得再向下一渠道提交。"""
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
            with self.assertRaises(RuntimeError):
                await ai_image.smart_generate_image_async(
                    model="gpt-image-2",
                    prompt="test",
                    user_id="u",
                )
        self.assertEqual(calls["apimart"], 1)
        self.assertEqual(calls["adobe"], 0)


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

    async def test_read_timeout_does_not_failover(self) -> None:
        calls = {"sub": 0, "adobe": 0}

        async def mock_sub2api(*args, **kwargs):
            calls["sub"] += 1
            raise ai_image.AmbiguousUpstreamError(
                "CLIProxyAPI 请求可能已送达但响应超时/中断（状态不确定，不切换渠道）：ReadTimeout",
                provider="sub2api",
            )

        async def mock_adobe(*args, **kwargs):
            calls["adobe"] += 1
            return {"url": "/x.png", "provider": "adobe2api"}

        with patch.object(ai_image, "generate_sub2api_async", side_effect=mock_sub2api), \
             patch.object(ai_image, "generate_adobe2api_async", side_effect=mock_adobe), \
             patch.object(ai_image, "get_smart_route_candidates", return_value=["sub2api", "adobe2api"]):
            with self.assertRaises(ai_image.AmbiguousUpstreamError):
                await ai_image.smart_generate_image_async(
                    model="gpt-image-2",
                    prompt="test",
                    user_id="u",
                )
        self.assertEqual(calls["sub"], 1)
        self.assertEqual(calls["adobe"], 0)

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



    async def test_accepted_without_real_task_id_still_blocks_failover(self) -> None:
        """无真实上游 id 时仍标记 accepted，但 callback 收到空 task_id。"""
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
            with self.assertRaises(RuntimeError):
                await ai_image.smart_generate_image_async(
                    model="gpt-image-2",
                    prompt="test",
                    user_id="u",
                    on_accepted=lambda provider, tid: seen.append((provider, tid)),
                )
        self.assertEqual(calls["sub"], 1)
        self.assertEqual(calls["adobe"], 0)
        self.assertEqual(seen, [("sub2api", "")])

if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import json
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from backend import ai_image


class KieNanoBananaProTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        ai_image.reset_provider_freeze()
        self.addCleanup(ai_image.reset_provider_freeze)
        p = patch.multiple(
            ai_image.settings, ai_image_api_key="sk-apimart", kie_api_key="sk-kie",
            kie_base_url="https://kie.test", kie_upload_base_url="https://upload.kie.test",
            kie_poll_interval_seconds=1, kie_timeout_seconds=60,
            cliproxy_api_key="", tuzi_api_key="", adobe2api_api_key="sk-adobe",
            adobe2api_base_url="http://adobe", smart_routing_rules_json="",
        )
        p.start()
        self.addCleanup(p.stop)
        sleep = patch.object(ai_image, "asyncio_sleep", AsyncMock())
        sleep.start()
        self.addCleanup(sleep.stop)

    def test_route_is_apimart_then_kie_without_adobe(self):
        self.assertEqual(ai_image.get_smart_route_candidates("nano-banana-pro", resolution="4K"), ["apimart", "kie"])
        ai_image.record_provider_failure("apimart", model="nano-banana-pro")
        ai_image.record_provider_failure("apimart", model="nano-banana-pro")
        self.assertEqual(ai_image.get_smart_route_candidates("nano-banana-pro"), ["kie"])
        # Kie 只接 Nano Banana Pro，其他模型不会路由过去
        self.assertNotIn("kie", ai_image.get_smart_route_candidates("gpt-image-2.5"))
        with patch.object(ai_image.settings, "kie_api_key", ""):
            self.assertEqual(ai_image.get_smart_route_candidates("nano-banana-pro"), ["apimart"])

    def _transport(self, requests, *, states=("generating", "success"), create_body=None):
        polls = iter(states)

        def handler(request: httpx.Request):
            requests.append(request)
            if request.url.path == "/api/file-stream-upload":
                return httpx.Response(200, json={"code": 200, "data": {"downloadUrl": "https://files.kie.test/ref.png"}})
            if request.url.path == "/api/v1/jobs/createTask":
                return httpx.Response(200, json=create_body or {"code": 200, "data": {"taskId": "kie-task"}})
            if request.url.path == "/api/v1/jobs/recordInfo":
                state = next(polls)
                data = {"taskId": "kie-task", "state": state}
                if state == "success":
                    data["resultJson"] = json.dumps({"resultUrls": ["https://files.kie.test/out.png"]})
                if state == "fail":
                    data["failMsg"] = "bad input"
                return httpx.Response(200, json={"code": 200, "data": data})
            if request.url.host == "files.kie.test":
                return httpx.Response(200, content=b"\x89PNG\r\n\x1a\nfake")
            return httpx.Response(404)
        return httpx.MockTransport(handler)

    def _client_kwargs(self, transport):
        return lambda timeout: {"timeout": timeout, "transport": transport}

    async def test_generate_uploads_references_creates_task_and_downloads(self):
        requests = []
        transport = self._transport(requests)
        accepted = []
        with patch.object(ai_image, "_ai_image_client_kwargs", self._client_kwargs(transport)), \
             patch.object(ai_image, "_download_final_image", AsyncMock(return_value="/ai-images/out.png")) as download:
            result = await ai_image.generate_kie_async(
                model="nano-banana-pro", prompt="把@图1 放到桌面上", images=[(b"img", "a.png")] * 9,
                size="21:9", resolution="4K", user_id="u1", on_accepted=accepted.append,
            )
        uploads = [r for r in requests if r.url.path == "/api/file-stream-upload"]
        self.assertEqual(len(uploads), 8)  # Kie 最多 8 张参考图
        self.assertEqual(uploads[0].headers["Authorization"], "Bearer sk-kie")
        create = next(r for r in requests if r.url.path == "/api/v1/jobs/createTask")
        body = json.loads(create.content)
        self.assertEqual(body["model"], "nano-banana-pro")
        self.assertEqual(body["input"]["aspect_ratio"], "21:9")
        self.assertEqual(body["input"]["resolution"], "4K")
        self.assertEqual(body["input"]["output_format"], "png")
        self.assertEqual(body["input"]["image_input"], ["https://files.kie.test/ref.png"] * 8)
        self.assertEqual(accepted, ["kie-task"])
        self.assertEqual(download.call_args.kwargs["image_url"], "https://files.kie.test/out.png")
        self.assertEqual(result["task_id"], "kie-task")
        self.assertEqual(result["url"], "/ai-images/out.png")

    async def test_unsupported_ratio_falls_back_to_auto(self):
        requests = []
        with patch.object(ai_image, "_ai_image_client_kwargs", self._client_kwargs(self._transport(requests))), \
             patch.object(ai_image, "_download_final_image", AsyncMock(return_value="/x.png")):
            await ai_image.generate_kie_async(model="nano-banana-pro", prompt="海报", size="auto")
        body = json.loads(next(r for r in requests if r.url.path == "/api/v1/jobs/createTask").content)
        self.assertEqual(body["input"]["aspect_ratio"], "auto")
        self.assertEqual(body["input"]["image_input"], [])

    async def test_business_error_in_http_200_body_is_not_accepted(self):
        requests = []
        transport = self._transport(requests, create_body={"code": 402, "msg": "Insufficient Credits"})
        with patch.object(ai_image, "_ai_image_client_kwargs", self._client_kwargs(transport)), \
             self.assertRaisesRegex(RuntimeError, "HTTP 402"):
            await ai_image.generate_kie_async(model="nano-banana-pro", prompt="海报")
        self.assertFalse(any(r.url.path == "/api/v1/jobs/recordInfo" for r in requests))

    async def test_failed_task_is_terminal_failure(self):
        with patch.object(ai_image, "_ai_image_client_kwargs", self._client_kwargs(self._transport([], states=("fail",)))), \
             self.assertRaises(ai_image.UpstreamTaskFailed):
            await ai_image.generate_kie_async(model="nano-banana-pro", prompt="海报")

    async def test_smart_route_fails_over_from_apimart_to_kie(self):
        attempts = []
        with patch.object(ai_image, "generate_image_async",
                          side_effect=httpx.ConnectError("connection refused")) as apimart, \
             patch.object(ai_image, "generate_kie_async",
                          AsyncMock(return_value={"url": "/kie.png", "task_id": "kie-task"})) as kie, \
             patch.object(ai_image, "generate_adobe2api_async") as adobe:
            result = await ai_image.smart_generate_image_async(
                model="nano-banana-pro", prompt="海报", resolution="2K", size="16:9",
                user_id="u1", on_attempt=attempts.append,
            )
        self.assertEqual(attempts, ["apimart", "kie"])
        self.assertEqual(result["provider"], "kie")
        self.assertEqual(kie.call_args.kwargs["model"], "nano-banana-pro")
        self.assertEqual(kie.call_args.kwargs["resolution"], "2K")
        apimart.assert_awaited_once()
        adobe.assert_not_called()

    async def test_resume_polls_existing_task_without_create(self):
        requests = []
        with patch.object(ai_image, "_ai_image_client_kwargs", self._client_kwargs(self._transport(requests, states=("success",)))), \
             patch.object(ai_image, "_download_final_image", AsyncMock(return_value="/resumed.png")):
            result = await ai_image.resume_image_async(
                provider="kie", model="nano-banana-pro", user_id="u1", recovery={"task_id": "kie-task"},
            )
        self.assertEqual(result["url"], "/resumed.png")
        self.assertFalse(any(r.url.path == "/api/v1/jobs/createTask" for r in requests))
        self.assertIn("kie", ai_image.TASK_RESUMABLE_PROVIDERS)


if __name__ == "__main__":
    unittest.main()

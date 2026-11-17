from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from backend import ai_image, job_store


class NanoBanana21Test(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        for patcher in (
            patch.object(job_store, "_DB_PATH", Path(self.temp.name) / "jobs.db"),
            patch.object(ai_image.settings, "ai_image_api_key", "test-key"),
            patch.object(ai_image, "_get_custom_rules", return_value=None),
            patch.object(ai_image, "_model_credentials", return_value=("https://apimart.test", "test-key")),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        job_store.init_db()
        ai_image.reset_provider_freeze()
        self.addCleanup(ai_image.reset_provider_freeze)

    def test_alias_and_routes_for_all_resolutions(self):
        self.assertEqual(ai_image.normalize_model_name("nano-banana-2.1"), "gemini-nano-banana-2.1")
        for resolution in ("1K", "2K", "4K"):
            self.assertEqual(ai_image.get_smart_route_candidates("nano-banana-2.1", resolution=resolution),
                             ["apimart-ext", "apimart"])
        ai_image.record_provider_failure("apimart-ext", model="nano-banana-2.1")
        ai_image.record_provider_failure("apimart-ext", model="nano-banana-2.1")
        self.assertEqual(ai_image.get_smart_route_candidates("nano-banana-2.1"), ["apimart"])

    async def test_payload_contract_for_both_routes_and_all_ratios(self):
        captured = []

        def handler(request):
            captured.append((json.loads(request.content), request.headers))
            return httpx.Response(200, json={"code": 200, "data": [{"status": "submitted", "task_id": "task-21"}]})

        ratios = ("auto", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "1:4", "4:1", "1:8", "8:1")
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            for ext in (True, False):
                for resolution in ("1K", "2K", "4K"):
                    for ratio in ratios:
                        with self.subTest(ext=ext, resolution=resolution, ratio=ratio):
                            task_id = await ai_image._submit_generation_task(
                                client, base_url="https://apimart.test", headers={},
                                model="nano-banana-2.1", prompt="保留主体，更换背景", size=ratio,
                                resolution=resolution, variant="sunburst", quality="high", apimart_ext=ext,
                                reference_urls=["https://reference.test/image.png"],
                            )
                            body, headers = captured[-1]
                            self.assertEqual(task_id, "task-21")
                            expected = {"model": "gemini-nano-banana-2.1" + ("-ext" if ext else ""),
                                        "prompt": "保留主体，更换背景", "size": ratio, "resolution": resolution,
                                        "n": 1, "image_urls": ["https://reference.test/image.png"]}
                            if ext:
                                expected["official_fallback"] = False
                            self.assertEqual(body, expected)
                            self.assertNotIn("X-APIMart-Response-Version", headers)

    async def test_text_and_reference_generation_fall_back_after_rejection_or_terminal_failure(self):
        for references in (None, [(b"image", "product.png")]):
            for terminal_failure in (False, True):
                with self.subTest(references=bool(references), terminal_failure=terminal_failure):
                    submitted = []
                    queried = []

                    def handler(request):
                        if request.method == "POST":
                            body = json.loads(request.content)
                            submitted.append(body)
                            ext = body["model"].endswith("-ext")
                            if ext and not terminal_failure:
                                return httpx.Response(400, json={"error": {"message": "ext unavailable"}})
                            return httpx.Response(200, json={"data": [{"task_id": "ext-task" if ext else "official-task"}]})
                        queried.append(request.url.path)
                        if request.url.path.endswith("ext-task"):
                            return httpx.Response(200, json={"data": {"status": "failed", "error": {"message": "render failed"}}})
                        return httpx.Response(200, json={"data": {"status": "completed", "progress": 100,
                            "result": {"images": [{"url": ["https://result.test/image.png"]}]}}})

                    with (
                        patch.object(ai_image, "_ai_image_client_kwargs", return_value={"transport": httpx.MockTransport(handler)}),
                        patch.object(ai_image, "_upload_reference_image", return_value="https://reference.test/product.png"),
                        patch.object(ai_image, "_download_final_image", return_value="/ai-images/test/result.png"),
                    ):
                        result = await ai_image.smart_generate_image_async(
                            model="nano-banana-2.1", prompt="产品海报", images=references,
                            resolution="4K", size="21:9", user_id="test",
                        )
                    self.assertEqual([body["model"] for body in submitted],
                                     ["gemini-nano-banana-2.1-ext", "gemini-nano-banana-2.1"])
                    self.assertTrue(all(body["n"] == 1 for body in submitted))
                    self.assertEqual(result["provider"], "apimart")
                    self.assertEqual(result["task_id"], "official-task")
                    self.assertTrue(result["provider_switched"])
                    if references:
                        self.assertTrue(all(body["image_urls"] == ["https://reference.test/product.png"] for body in submitted))
                    else:
                        self.assertTrue(all("image_urls" not in body for body in submitted))

    async def test_timed_out_ext_task_is_abandoned_and_switches_route(self):
        # 新策略：线路超时（含已受理后轮询超时）一律放弃该请求并换下一条线路，不再等待恢复原任务。
        submitted = []

        def handler(request):
            body = json.loads(request.content)
            submitted.append(body["model"])
            return httpx.Response(200, json={"data": [{"task_id": f"task-{len(submitted)}"}]})

        async def poll(client, **kwargs):
            if kwargs["task_id"] == "task-1":
                raise TimeoutError("poll interrupted")
            return "https://result.test/image.png", 100, {}

        with (
            patch.object(ai_image, "_ai_image_client_kwargs", return_value={"transport": httpx.MockTransport(handler)}),
            patch.object(ai_image, "_wait_for_task_result", side_effect=poll),
            patch.object(ai_image, "_download_final_image", return_value="/ai-images/test/result.png"),
        ):
            result = await ai_image.smart_generate_image_async(model="nano-banana-2.1", prompt="产品海报")
        self.assertEqual(submitted, ["gemini-nano-banana-2.1-ext", "gemini-nano-banana-2.1"])
        self.assertEqual(result["provider"], "apimart")
        self.assertEqual(result["task_id"], "task-2")
        self.assertTrue(result.get("provider_switched"))

    async def test_resume_polls_accepted_ext_task_without_another_submission(self):
        # 进程重启等恢复场景仍只查询原任务，不重新提交。
        submitted = []

        def handler(request):
            submitted.append(request.method)
            return httpx.Response(500)

        with (
            patch.object(ai_image, "_ai_image_client_kwargs", return_value={"transport": httpx.MockTransport(handler)}),
            patch.object(ai_image, "_wait_for_task_result", return_value=("https://result.test/image.png", 100, {})) as poll,
            patch.object(ai_image, "_download_final_image", return_value="/ai-images/test/result.png"),
        ):
            result = await ai_image.resume_image_async(provider="apimart-ext", model="nano-banana-2.1",
                user_id="test", recovery={"task_id": "accepted-ext"})
        self.assertEqual(result["task_id"], "accepted-ext")
        self.assertEqual(poll.call_args.kwargs["task_id"], "accepted-ext")
        self.assertEqual(submitted, [])

if __name__ == "__main__":
    unittest.main()

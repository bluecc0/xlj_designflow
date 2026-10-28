from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from backend import ai_image, job_store


class Seedream5Test(unittest.IsolatedAsyncioTestCase):
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

    def test_aliases_and_routes(self):
        for version in ("flash", "pro"):
            model = f"seedream-5-0-{version}"
            self.assertEqual(ai_image.normalize_model_name(f"seedream-5.0-{version}"), model)
            for resolution in ("1K", "1.5K", "2K"):
                self.assertEqual(ai_image.get_smart_route_candidates(model, resolution=resolution), ["apimart"])

    async def test_payload_for_both_versions_all_ratios_and_resolutions(self):
        captured = []

        def handler(request):
            captured.append((json.loads(request.content), request.headers))
            return httpx.Response(200, json={"data": [{"task_id": "seedream-task"}]})

        ratios = ("auto", "1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "2:1", "1:2", "21:9")
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            for version in ("flash", "pro"):
                for resolution in ("1K", "1.5K", "2K"):
                    for ratio in ratios:
                        for refs in (None, ["https://reference.test/product.png"]):
                            with self.subTest(version=version, resolution=resolution, ratio=ratio, refs=refs):
                                tid = await ai_image._submit_generation_task(
                                    client, base_url="https://apimart.test", headers={},
                                    model=f"seedream-5-0-{version}", prompt="产品海报", size=ratio,
                                    resolution=resolution, reference_urls=refs, variant="sunburst", quality="max",
                                )
                                body, headers = captured[-1]
                                expected = {"model": f"seedream-5-0-{version}", "prompt": "产品海报",
                                            "size": ratio, "resolution": resolution, "n": 1, "output_format": "png"}
                                if refs:
                                    expected["image_urls"] = refs
                                self.assertEqual(body, expected)
                                self.assertEqual(tid, "seedream-task")
                                self.assertNotIn("X-APIMart-Response-Version", headers)

    async def test_invalid_parameters_are_rejected_before_submission(self):
        def handler(request):
            self.fail("非法参数不应发出上游请求")

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            for params in (
                {"size": "4:5"}, {"size": "1:8"}, {"size": "512x512"},
                {"size": "99999x99999"}, {"resolution": "4K"},
                {"reference_urls": ["https://ref.test/image.png"] * 11},
                {"apimart_ext": True},
            ):
                with self.subTest(params=params), self.assertRaises(ValueError):
                    await ai_image._submit_generation_task(
                        client, base_url="https://apimart.test", headers={},
                        model="seedream-5-0-flash", prompt="海报", **{"size": "auto", **params},
                    )

    def test_size_normalization(self):
        for size in ("2x1", "1x2", "21x9"):
            self.assertEqual(ai_image._normalize_seedream_size(size, "1.5k"), (size.replace("x", ":"), "1.5K"))
        self.assertEqual(ai_image._normalize_seedream_size("1.5K", "2K"), ("auto", "1.5K"))
        self.assertEqual(ai_image._normalize_seedream_size("2048×1024", ""), ("2048x1024", "1K"))

    async def test_generation_and_recovery_keep_selected_version(self):
        for version in ("flash", "pro"):
            for references in (None, [(b"image", "product.png")]):
                model = f"seedream-5-0-{version}"
                submitted = []

                def handler(request):
                    if request.method == "POST":
                        submitted.append(json.loads(request.content))
                        return httpx.Response(200, json={"data": [{"task_id": "accepted-task"}]})
                    return httpx.Response(200, json={"status": "success", "progress": 100,
                        "result": {"images": [{"url": ["https://result.test/image.png"]}]}})

                with (
                    patch.object(ai_image, "_ai_image_client_kwargs", return_value={"transport": httpx.MockTransport(handler)}),
                    patch.object(ai_image, "_upload_reference_image", return_value="https://reference.test/product.png"),
                    patch.object(ai_image, "_download_final_image", return_value="/ai-images/test/result.png"),
                ):
                    result = await ai_image.smart_generate_image_async(
                        model=model, prompt="产品海报", images=references, resolution="1.5K", size="2:1", user_id="test",
                    )
                    self.assertEqual(result["model"], model)
                    self.assertEqual(result["provider"], "apimart")
                    self.assertEqual(submitted[0]["resolution"], "1.5K")
                    self.assertEqual(submitted[0]["model"], model)
                    self.assertEqual(submitted[0]["n"], 1)
                    submitted.clear()
                    with patch.object(ai_image, "_wait_for_task_result", side_effect=TimeoutError("poll interrupted")):
                        with self.assertRaises(TimeoutError) as raised:
                            await ai_image.smart_generate_image_async(model=model, prompt="海报", images=references)
                    self.assertEqual(raised.exception.task_id, "accepted-task")
                    self.assertEqual(raised.exception.provider, "apimart")
                    resumed = await ai_image.resume_image_async(provider="apimart", model=model, user_id="test",
                        recovery={"task_id": "accepted-task"})
                    self.assertEqual(resumed["task_id"], "accepted-task")
                    self.assertEqual(len(submitted), 1)
                    self.assertEqual(submitted[0]["model"], model)


if __name__ == "__main__":
    unittest.main()

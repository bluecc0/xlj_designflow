from __future__ import annotations

import unittest
from unittest.mock import patch

import httpx

from backend import ai_image


class GptImage26ExtTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        ai_image.reset_provider_freeze()
        self.addCleanup(ai_image.reset_provider_freeze)
        p = patch.multiple(ai_image.settings, cliproxy_base_url="http://sub2api", cliproxy_api_key="test",
                           ai_image_api_key="test", tuzi_api_key="", adobe2api_api_key="",
                           smart_routing_rules_json="")
        p.start()
        self.addCleanup(p.stop)

    async def test_payload_preserves_version_resolution_quality_and_references(self):
        sent = []

        def handler(request):
            import json
            sent.append(json.loads(request.content))
            self.assertNotIn("X-APIMart-Response-Version", request.headers)
            return httpx.Response(200, json={"data": [{"task_id": "accepted"}]})

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            for model, variant, version in (("gpt-image-2.6", "flare", "flare"),
                                             ("gpt-image-2.6", "sunburst", "sunburst"),
                                             ("gpt-image-2.6-sunburst", "flare", "sunburst")):
                for resolution in ("1K", "2K", "4K"):
                    for quality in ("auto", "low", "medium", "high", "xhigh", "max"):
                        with self.subTest(model=model, resolution=resolution, quality=quality):
                            task_id = await ai_image._submit_generation_task(
                                client, base_url="https://apimart.test", headers={}, model=model,
                                prompt="产品海报", size="21:9", resolution=resolution,
                                variant=variant, quality=quality, apimart_ext=True,
                                reference_urls=["https://ref.test/image.png"],
                            )
                            self.assertEqual(task_id, "accepted")
                            self.assertEqual(sent[-1], {
                                "model": "gpt-image-2.6-ext", "version": version, "prompt": "产品海报",
                                "size": "21:9", "resolution": resolution.lower(), "quality": quality,
                                "n": 1, "image_urls": ["https://ref.test/image.png"],
                            })

    async def test_gif_omits_ratio_and_keeps_ext_resolution(self):
        sent = []

        def handler(request):
            import json
            sent.append(json.loads(request.content))
            return httpx.Response(200, json={"data": [{"task_id": "gif-task"}]})

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            kwargs = dict(client=client, base_url="https://apimart.test", headers={},
                          model="gpt-image-2.6", prompt="挥手动图", size="16:9", resolution="4K",
                          quality="max", apimart_ext=True, output_format="gif")
            await ai_image._submit_generation_task(**kwargs)
            self.assertNotIn("size", sent[0])
            self.assertEqual(sent[0]["resolution"], "4k")
            self.assertEqual(sent[0]["output_format"], "gif")
            with self.assertRaisesRegex(ValueError, "仅支持"):
                await ai_image._submit_generation_task(**kwargs, reference_urls=["https://ref.test/image.png"])
            self.assertEqual(len(sent), 1)

    async def test_reference_limit_rejects_before_post(self):
        async with httpx.AsyncClient() as client:
            with patch.object(client, "post") as post, self.assertRaisesRegex(ValueError, "16"):
                await ai_image._submit_generation_task(
                    client, base_url="https://apimart.test", headers={}, model="gpt-image-2.6",
                    prompt="产品", size="1:1", apimart_ext=True, reference_urls=["https://ref.test/a"] * 17,
                )
            post.assert_not_called()

    async def test_sub2api_then_ext_then_normal_preserves_model_and_options(self):
        for images in (None, [(b"reference", "ref.png")]):
            with self.subTest(reference=bool(images)):
                attempts, calls = [], []

                async def apimart(**kwargs):
                    calls.append(kwargs)
                    if kwargs["apimart_ext"]:
                        raise ai_image.UpstreamTaskFailed("Ext task failed")
                    return {"url": "/result.png"}

                generator = "generate_image_with_reference_async" if images else "generate_image_async"
                with patch.object(ai_image, "generate_sub2api_async", side_effect=httpx.ConnectError("connection refused")), \
                     patch.object(ai_image, generator, side_effect=apimart):
                    result = await ai_image.smart_generate_image_async(
                        model="gpt-image-2.6", prompt="产品", images=images, size="3:4", resolution="1K",
                        variant="sunburst", quality="medium", on_attempt=attempts.append,
                    )
                self.assertEqual(attempts, ["sub2api", "apimart-26-ext", "apimart"])
                self.assertEqual(result["provider"], "apimart")
                for call in calls:
                    self.assertEqual((call["model"], call["variant"], call["quality"], call["size"]),
                                     ("gpt-image-2.6", "sunburst", "medium", "3:4"))
                ai_image.reset_provider_freeze()

    def test_ext_freeze_is_independent_and_missing_key_skips_both_apimart_routes(self):
        for _ in range(ai_image.PROVIDER_FAILURE_THRESHOLD):
            ai_image.record_provider_failure("apimart-26-ext", model="gpt-image-2.6")
        self.assertEqual(ai_image.get_smart_route_candidates("gpt-image-2.6", resolution="2K"),
                         ["apimart", "apimart-ext"])
        self.assertFalse(ai_image.is_provider_frozen("apimart-ext", model="gpt-image-2.5"))
        with patch.object(ai_image.settings, "ai_image_api_key", ""):
            self.assertEqual(ai_image.get_smart_route_candidates("gpt-image-2.6", resolution="1K"), ["sub2api"])

    async def test_accepted_ext_timeout_switches_and_explicit_resume_only_polls(self):
        async def accepted(**kwargs):
            kwargs["on_accepted"]("paid-ext")
            raise TimeoutError("poll interrupted")

        with patch.object(ai_image, "generate_image_async", side_effect=accepted) as generate:
            with self.assertRaises(ai_image.AllProvidersFailedError):
                await ai_image.smart_generate_image_async(model="gpt-image-2.6", prompt="产品", resolution="2K")
            self.assertGreater(generate.await_count, 1)
        with patch.object(httpx.AsyncClient, "post", side_effect=AssertionError("must not repost")), \
             patch.object(ai_image, "_wait_for_task_result", return_value=("https://result.test/a.png", 100, {})) as poll, \
             patch.object(ai_image, "_download_final_image", return_value="/result.png"):
            result = await ai_image.resume_image_async(provider="apimart-26-ext", model="gpt-image-2.6",
                                                       user_id="test", recovery={"task_id": "paid-ext"})
        self.assertEqual(poll.call_args.kwargs["task_id"], "paid-ext")
        self.assertEqual(result["provider"], "apimart-26-ext")

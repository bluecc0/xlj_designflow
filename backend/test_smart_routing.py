from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import config, ai_image, job_store


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
        # 1. 模拟所有 Key 均已配置的情况
        with patch.object(ai_image.settings, "cliproxy_base_url", "http://sub2api:8080"), \
             patch.object(ai_image.settings, "cliproxy_api_key", "sk-sub2api"), \
             patch.object(ai_image.settings, "adobe2api_base_url", "http://adobe:6001"), \
             patch.object(ai_image.settings, "adobe2api_api_key", "sk-adobe"), \
             patch.object(ai_image.settings, "ai_image_api_key", "sk-apimart"):

            # gpt-image-2 1K 优先选 sub2api -> apimart -> adobe2api
            gpt_1k_candidates = ai_image.get_smart_route_candidates("gpt-image-2", resolution="1K")
            self.assertEqual(gpt_1k_candidates, ["sub2api", "apimart", "adobe2api"])

            # gpt-image-2 2K/4K 优先选 adobe2api -> apimart
            gpt_2k_candidates = ai_image.get_smart_route_candidates("gpt-image-2", resolution="2K")
            self.assertEqual(gpt_2k_candidates, ["adobe2api", "apimart"])

            gpt_4k_candidates = ai_image.get_smart_route_candidates("gpt-image-2", resolution="4K")
            self.assertEqual(gpt_4k_candidates, ["adobe2api", "apimart"])

            # gemini/banana 优先选 apimart -> adobe2api
            banana_candidates = ai_image.get_smart_route_candidates("nano-banana-pro")
            self.assertEqual(banana_candidates, ["apimart", "adobe2api"])

    def test_custom_routing_rules_json_override(self) -> None:
        # 验证可通过 SMART_ROUTING_RULES_JSON 覆写特定模型的优先级
        custom_json = '{"gpt-image-2": ["adobe2api", "sub2api"]}'
        with patch.object(ai_image.settings, "smart_routing_rules_json", custom_json), \
             patch.object(ai_image.settings, "cliproxy_base_url", "http://sub2api:8080"), \
             patch.object(ai_image.settings, "cliproxy_api_key", "sk-sub2api"), \
             patch.object(ai_image.settings, "adobe2api_base_url", "http://adobe:6001"), \
             patch.object(ai_image.settings, "adobe2api_api_key", "sk-adobe"):

            candidates = ai_image.get_smart_route_candidates("gpt-image-2", resolution="1K")
            self.assertEqual(candidates, ["adobe2api", "sub2api"])

    async def test_smart_generate_image_failover(self) -> None:
        # 模拟 sub2api 抛出异常，adobe2api 成功出图的 Failover 场景
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

    def test_adobe2api_model_mapping_for_gemini(self) -> None:
        # 归一化后的 gemini 模型名应映射到 firefly-nano-banana-pro，而非 gpt-image
        with patch.object(ai_image.settings, "adobe2api_base_url", "http://adobe:6001/v1"), \
             patch.object(ai_image.settings, "adobe2api_api_key", "sk-adobe"):
            # 直接测映射逻辑：调用内部 size 归一化 + 模型选择片段
            ratio, res_clean = ai_image._normalize_size("auto", "2K")
            model_name = ai_image._normalize_model_name("nano-banana-pro").lower()
            self.assertIn("gemini", model_name)
            res_suffix = res_clean.lower()
            ratio_suffix = ratio.replace(":", "x")
            if "banana" in model_name or "gemini" in model_name:
                target = f"firefly-nano-banana-pro-{res_suffix}-{ratio_suffix}"
            else:
                target = f"firefly-gpt-image-{res_suffix}-{ratio_suffix}"
            self.assertEqual(target, "firefly-nano-banana-pro-2k-auto")

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

    async def test_already_submitted_does_not_failover(self) -> None:
        calls = {"sub": 0, "adobe": 0}

        async def mock_sub2api(*args, **kwargs):
            calls["sub"] += 1
            on_progress = kwargs.get("on_progress")
            if on_progress:
                on_progress(10, "submitted")
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
                )
        self.assertEqual(calls["sub"], 1)
        self.assertEqual(calls["adobe"], 0)


if __name__ == "__main__":
    unittest.main()

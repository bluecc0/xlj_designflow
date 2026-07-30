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


if __name__ == "__main__":
    unittest.main()

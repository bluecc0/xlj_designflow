import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import HTTPException
from starlette.requests import Request

from backend import ai_image, main


class PublicErrorTest(unittest.IsolatedAsyncioTestCase):
    def test_completed_and_uncertain_tasks_keep_recovery_guidance(self):
        ambiguous = ai_image.public_generation_error(ai_image.AmbiguousUpstreamError("read timeout"))
        downloaded = ai_image.public_generation_error(ai_image.FinalImageDownloadError("HTTP 503"))
        self.assertIn("避免重复提交", ambiguous)
        self.assertIn("图片已生成", downloaded)
        self.assertNotIn("重试", ambiguous + downloaded)

    def test_all_routes_must_agree_before_reporting_a_specific_cause(self):
        failure = ai_image.AllProvidersFailedError()
        failure.provider_errors = ("HTTP 402 insufficient quota", "HTTP 402 insufficient quota")
        self.assertIn("额度不足", ai_image.public_generation_error(failure))
        failure.provider_errors = ("HTTP 402 insufficient quota", "HTTP 500 internal error")
        self.assertIn("未提供一致的失败原因", ai_image.public_generation_error(failure))
        self.assertNotIn("额度不足", ai_image.public_generation_error(failure))
        formatted = ai_image.format_generation_error(RuntimeError("HTTP 403 permission denied"))
        self.assertNotIn("额度不足", ai_image.public_generation_error(formatted))

    async def test_provider_401_does_not_expire_the_users_session(self):
        request = Request({"type": "http", "headers": []})
        response = httpx.Response(401, text="invalid provider secret", request=httpx.Request("POST", "https://provider.test/chat"))
        with patch.object(main, "_current_user", return_value={"id": "test-user"}), \
             patch.object(main, "get_inspiration_post", return_value={"image_url": "/test.png"}), \
             patch.object(main, "find_inspiration_vlm_cache", return_value=None), \
             patch.object(main, "get_model_routes", return_value=["test"]), \
             patch.object(main, "_resolve_image_data_url", new=AsyncMock(return_value="data:image/png;base64,AA==")), \
             patch.object(main, "routed_chat_completion", new=AsyncMock(return_value=response)):
            with self.assertRaises(HTTPException) as result:
                await main.describe_inspiration(request, "test-post")
        self.assertEqual(result.exception.status_code, 502)
        self.assertNotIn("secret", result.exception.detail)
        self.assertNotIn("登录", result.exception.detail)


if __name__ == "__main__":
    unittest.main()

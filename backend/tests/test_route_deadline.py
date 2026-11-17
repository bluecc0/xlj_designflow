import asyncio
import unittest
from unittest.mock import patch

from backend import ai_image


class RouteDeadlineTest(unittest.IsolatedAsyncioTestCase):
    async def test_timeout_abandons_accepted_request_and_switches(self):
        cancelled = []
        attempts = []

        async def slow(**kwargs):
            kwargs["on_accepted"]("abandoned-task")
            try:
                await asyncio.sleep(10)
            finally:
                cancelled.append(True)

        async def fast(**kwargs):
            return {"url": "/ok.png"}

        with patch.object(ai_image, "SMART_ROUTE_ATTEMPT_SECONDS", 0.02), \
             patch.object(ai_image, "get_smart_route_candidates", return_value=["sub2api", "apimart"]), \
             patch.object(ai_image, "generate_sub2api_async", side_effect=slow), \
             patch.object(ai_image, "generate_image_async", side_effect=fast):
            result = await ai_image.smart_generate_image_async(
                model="gpt-image-2.6", prompt="test", on_attempt=attempts.append,
            )
        self.assertEqual(result["provider"], "apimart")
        self.assertNotIn("task_id", result)
        self.assertEqual(cancelled, [True])
        self.assertEqual(attempts, ["sub2api", "sub2api", "apimart"])

    async def test_timeouts_exhaust_two_rounds(self):
        calls = []

        async def slow(**kwargs):
            calls.append(True)
            kwargs["on_accepted"]("abandoned-task")
            await asyncio.sleep(10)

        with patch.object(ai_image, "SMART_ROUTE_ATTEMPT_SECONDS", 0.01), \
             patch.object(ai_image, "get_smart_route_candidates", return_value=["sub2api", "apimart"]), \
             patch.object(ai_image, "generate_sub2api_async", side_effect=slow), \
             patch.object(ai_image, "generate_image_async", side_effect=slow):
            with self.assertRaises(ai_image.AllProvidersFailedError) as raised:
                await ai_image.smart_generate_image_async(model="gpt-image-2.6", prompt="test")
        self.assertEqual(len(calls), 4)
        self.assertEqual(raised.exception.task_id, "")

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

import httpx

from backend import ai_image


class FinalImageDownloadTest(unittest.IsolatedAsyncioTestCase):
    async def test_configured_proxy_retries_and_saves_result(self) -> None:
        request = httpx.Request("GET", "https://upload.apimart.ai/result.png")
        proxy_client = AsyncMock()
        proxy_client.get.side_effect = [
            httpx.ConnectError("temporary failure", request=request),
            httpx.Response(200, request=request, content=b"image-bytes"),
        ]

        with tempfile.TemporaryDirectory() as temp_dir:
            with (
                patch.object(ai_image.settings, "ai_image_download_proxy_url", "http://127.0.0.1:7897"),
                patch.object(ai_image, "_OUTPUT_DIR", Path(temp_dir)),
                patch.object(ai_image.httpx, "AsyncClient", return_value=proxy_client) as client_factory,
                patch.object(ai_image, "asyncio_sleep", new=AsyncMock()) as sleep_mock,
            ):
                result_url = await ai_image._download_final_image(
                    AsyncMock(),
                    image_url=str(request.url),
                    user_id="tester",
                    task_id="task-123",
                )

            self.assertTrue(result_url.startswith("/ai-images/tester/"))
            self.assertEqual(proxy_client.get.await_count, 2)
            proxy_client.aclose.assert_awaited_once()
            sleep_mock.assert_awaited_once_with(1.0)
            self.assertEqual(client_factory.call_args.kwargs["proxy"], "http://127.0.0.1:7897")

    async def test_network_failure_keeps_upstream_task_id(self) -> None:
        request = httpx.Request("GET", "https://upload.apimart.ai/result.png")
        proxy_client = AsyncMock()
        proxy_client.get.side_effect = httpx.ConnectError("unreachable", request=request)

        with (
            patch.object(ai_image.settings, "ai_image_download_proxy_url", "http://127.0.0.1:7897"),
            patch.object(ai_image.httpx, "AsyncClient", return_value=proxy_client),
            patch.object(ai_image, "asyncio_sleep", new=AsyncMock()),
        ):
            with self.assertRaises(ai_image.FinalImageDownloadError) as raised:
                await ai_image._download_final_image(
                    AsyncMock(),
                    image_url=str(request.url),
                    user_id="tester",
                    task_id="task-456",
                )

        self.assertEqual(raised.exception.stage, "download")
        self.assertEqual(raised.exception.task_id, "task-456")
        self.assertEqual(proxy_client.get.await_count, 3)


if __name__ == "__main__":
    unittest.main()

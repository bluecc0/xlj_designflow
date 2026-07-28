from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

import httpx

from backend import ai_image


class FinalImageDownloadTest(unittest.IsolatedAsyncioTestCase):
    async def test_zenmux_reference_download_receives_initialized_task_id(self) -> None:
        response = Mock()
        response.is_success = True
        response.json.return_value = {"data": [{"url": "https://upload.example/result.png"}]}
        client = AsyncMock()
        client.post.return_value = response
        client.__aenter__.return_value = client
        download_mock = AsyncMock(return_value="/ai-images/tester/result.png")

        with (
            patch.object(ai_image, "_zenmux_model_name", return_value="openai/gpt-image-2"),
            patch.object(ai_image, "_zenmux_headers", return_value={"Authorization": "Bearer test"}),
            patch.object(ai_image, "_is_zenmux_vertex_image_model", return_value=False),
            patch.object(ai_image.httpx, "AsyncClient", return_value=client),
            patch.object(ai_image, "_download_final_image", new=download_mock),
        ):
            result = await ai_image.generate_image_zenmux_async(
                model="gpt-image-2",
                prompt="test",
                images=[(b"reference", "reference.png")],
                user_id="tester",
            )

        task_id = result["task_id"]
        self.assertTrue(task_id.startswith("zenmux:"))
        self.assertEqual(download_mock.await_args.kwargs["task_id"], task_id)

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

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from PIL import Image

from backend.apimart_layer_decomposition import ApimartLayerDecompositionClient, ApimartLayerDecompositionError
from backend.layer_extract_worker import LAYER_DECOMPOSITION_PROMPT


class ApimartLayerDecompositionClientTest(unittest.IsolatedAsyncioTestCase):
    async def test_empty_or_rejected_decomposition_keeps_task_id_without_resubmitting(self) -> None:
        for terminal in (
            {"status": "completed", "result": {"images": [{"layers": []}]}},
            {"status": "failed", "error": {"message": "No decomposable layers found"}},
        ):
            with self.subTest(status=terminal["status"]), tempfile.TemporaryDirectory() as directory:
                source = Path(directory) / "source.png"
                Image.new("RGB", (16, 12), "white").save(source)
                requests = []

                def respond(request):
                    requests.append(request)
                    if request.method == "POST":
                        return httpx.Response(200, json={"data": [{"task_id": "task-1"}]})
                    return httpx.Response(200, json={"data": terminal})

                http_client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
                client = ApimartLayerDecompositionClient(api_key="test-key")
                with patch("backend.apimart_layer_decomposition.httpx.AsyncClient", return_value=http_client):
                    with self.assertRaisesRegex(ApimartLayerDecompositionError, "task_id=task-1") as caught:
                        await client.run(source, prompt=LAYER_DECOMPOSITION_PROMPT)

                self.assertEqual([request.method for request in requests], ["POST", "GET"])
                self.assertEqual(requests[1].url.path, "/v1/tasks/task-1")
                payload = json.loads(requests[0].content)
                self.assertTrue(payload["layer_decomposition"])
                self.assertEqual(payload["prompt"], LAYER_DECOMPOSITION_PROMPT)
                self.assertTrue(payload["image_urls"][0].startswith("data:image/png;base64,"))
                if terminal["status"] == "failed":
                    self.assertIn("No decomposable layers found", str(caught.exception))

    async def test_proxy_argument_is_accepted_and_used_for_run(self) -> None:
        class FakeClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return None

        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "source.png"
            source.write_bytes(b"png")
            client = ApimartLayerDecompositionClient(
                api_key="test-key",
                proxy_url="http://127.0.0.1:7897",
            )
            with (
                patch("backend.apimart_layer_decomposition._image_to_data_url", return_value="data:image/png;base64,AAAA"),
                patch("backend.apimart_layer_decomposition.httpx.AsyncClient", return_value=FakeClient()) as factory,
                patch.object(client, "create_task", return_value="task-1"),
                patch.object(client, "poll_task", return_value=([{"url": "https://example.test/layer.png"}], {"status": "completed"})),
            ):
                result = await client.run(source)

            self.assertEqual(result["task_id"], "task-1")
            self.assertEqual(factory.call_args.kwargs["proxy"], "http://127.0.0.1:7897")
            self.assertFalse(factory.call_args.kwargs["trust_env"])


if __name__ == "__main__":
    unittest.main()

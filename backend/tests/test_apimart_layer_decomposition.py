from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.apimart_layer_decomposition import ApimartLayerDecompositionClient


class ApimartLayerDecompositionClientTest(unittest.IsolatedAsyncioTestCase):
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

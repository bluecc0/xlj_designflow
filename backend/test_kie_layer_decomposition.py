from __future__ import annotations

import json
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from PIL import Image

from backend.kie_layer_decomposition import extract_result_layers, extract_result_urls
from backend.layer_extract_worker import (
    _coerce_bbox,
    _download_result_layer,
    _download_result_layers,
    _layer_bbox,
    _prepare_foreground,
    _select_background_index,
)


class KieLayerDecompositionHelpersTest(unittest.TestCase):
    def test_extract_result_urls_supports_result_json_string(self) -> None:
        payload = {
            "data": {
                "resultJson": '{"resultUrls":["https://example.test/a.png", "https://example.test/b.png"]}'
            }
        }
        self.assertEqual(
            extract_result_urls(payload),
            ["https://example.test/a.png", "https://example.test/b.png"],
        )

    def test_extract_result_layers_keeps_kie_coordinates_and_z_index(self) -> None:
        result_json = {
            "resultObject": {
                "layers_data": [
                    {
                        "z_index": 0,
                        "size": "1024x1024",
                        "url": "https://example.test/background.png",
                    },
                    {
                        "z_index": 2,
                        "size": "240x180",
                        "name": "Subject",
                        "bounding_box": {
                            "absolute": [100, 200, 340, 380],
                            "normalized": [97, 195, 332, 371],
                        },
                        "url": "https://example.test/subject.png",
                    },
                    {
                        "z_index": 1,
                        "size": "1024x120",
                        "name": "Shadow",
                        "bounding_box": {"absolute": [0, 700, 1024, 820]},
                        "url": "https://example.test/shadow.png",
                    },
                ]
            }
        }
        payload = {"data": {"resultJson": json.dumps(result_json)}}

        layers = extract_result_layers(payload["data"])

        self.assertEqual([layer["z_index"] for layer in layers], [0, 1, 2])
        self.assertEqual(layers[1]["name"], "Shadow")
        self.assertEqual(layers[2]["bounding_box"]["absolute"], [100, 200, 340, 380])

    def test_extract_result_layers_falls_back_to_result_urls(self) -> None:
        payload = {"resultJson": '{"resultUrls":["https://example.test/a.png"]}'}
        self.assertEqual(
            extract_result_layers(payload),
            [{"url": "https://example.test/a.png", "z_index": 0}],
        )

    def test_normalized_bbox_supports_zero_to_one_and_zero_to_thousand(self) -> None:
        self.assertEqual(
            _coerce_bbox([0.1, 0.2, 0.5, 0.8], 1000, 2000, normalized=True),
            [100, 400, 500, 1600],
        )
        self.assertEqual(
            _coerce_bbox([100, 200, 500, 800], 1000, 2000, normalized=True),
            [100, 400, 500, 1600],
        )

    def test_layer_bbox_prefers_absolute_coordinates(self) -> None:
        layer = {
            "bounding_box": {
                "absolute": [10, 20, 110, 220],
                "normalized": [0, 0, 1000, 1000],
            }
        }
        self.assertEqual(_layer_bbox(layer, 1000, 2000), [10, 20, 110, 220])

    def test_select_background_uses_full_canvas_z_index_zero(self) -> None:
        image = io.BytesIO()
        Image.new("RGB", (100, 200), "white").save(image, format="PNG")
        raw = image.getvalue()
        layers = [
            {"z_index": 0, "bytes": raw},
            {
                "z_index": 1,
                "name": "全画布底层背景",
                "bytes": raw,
                "bounding_box": {"absolute": [0, 100, 100, 200]},
            },
        ]
        self.assertEqual(_select_background_index(layers, (100, 200)), 0)

    def test_select_background_rejects_explicit_partial_layer(self) -> None:
        image = io.BytesIO()
        Image.new("RGB", (50, 50), "white").save(image, format="PNG")
        layers = [{
            "z_index": 0,
            "bytes": image.getvalue(),
            "bounding_box": {"absolute": [0, 0, 50, 50]},
        }]
        self.assertIsNone(_select_background_index(layers, (100, 200)))

    def test_select_background_accepts_kie_output_without_size_check(self) -> None:
        image = io.BytesIO()
        Image.new("RGB", (864, 1000), "white").save(image, format="PNG")
        layers = [{"z_index": 0, "bytes": image.getvalue()}]

        self.assertEqual(_select_background_index(layers, (726, 968)), 0)

    def test_layer_bbox_scales_kie_coordinates_to_source_canvas(self) -> None:
        layer = {"bounding_box": {"absolute": [171, 439, 747, 700]}}

        self.assertEqual(
            _layer_bbox(layer, 726, 968, coordinate_size=(864, 1152)),
            [144, 369, 628, 588],
        )

    def test_foreground_without_bbox_is_kept_at_origin(self) -> None:
        image = io.BytesIO()
        Image.new("RGBA", (40, 30), (255, 0, 0, 255)).save(image, format="PNG")
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "layer.png"
            manifest_layer = _prepare_foreground(
                image.getvalue(), {}, (100, 80), output, 1
            )

            self.assertEqual(manifest_layer["bbox"], [0, 0, 40, 30])
            self.assertTrue(output.exists())


class KieResultDownloadRetryTest(unittest.IsolatedAsyncioTestCase):
    async def test_skips_one_failed_layer_when_other_layers_download(self) -> None:
        class FakeClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return None

            async def get(self, url: str) -> httpx.Response:
                request = httpx.Request("GET", url)
                if "bad" in url:
                    return httpx.Response(404, request=request)
                return httpx.Response(200, content=b"png-bytes", request=request)

        with patch("backend.layer_extract_worker.httpx.AsyncClient", return_value=FakeClient()):
            layers = await _download_result_layers(
                [{"url": "https://example.test/bad.png"}, {"url": "https://example.test/good.png"}],
                60,
            )

        self.assertEqual(len(layers), 1)
        self.assertEqual(layers[0]["url"], "https://example.test/good.png")

    async def test_retries_server_error_before_success(self) -> None:
        class FakeClient:
            def __init__(self) -> None:
                self.calls = 0

            async def get(self, url: str) -> httpx.Response:
                self.calls += 1
                request = httpx.Request("GET", url)
                if self.calls == 1:
                    return httpx.Response(503, request=request)
                return httpx.Response(200, content=b"png-bytes", request=request)

        client = FakeClient()
        content = await _download_result_layer(client, "https://example.test/layer.png", 1, 1)

        self.assertEqual(content, b"png-bytes")
        self.assertEqual(client.calls, 2)

    async def test_does_not_retry_client_error(self) -> None:
        class FakeClient:
            def __init__(self) -> None:
                self.calls = 0

            async def get(self, url: str) -> httpx.Response:
                self.calls += 1
                return httpx.Response(404, request=httpx.Request("GET", url))

        client = FakeClient()
        with self.assertRaisesRegex(RuntimeError, r"HTTP 404"):
            await _download_result_layer(client, "https://example.test/layer.png", 1, 2)
        self.assertEqual(client.calls, 1)

    async def test_retries_empty_success_response(self) -> None:
        class FakeClient:
            def __init__(self) -> None:
                self.calls = 0

            async def get(self, url: str) -> httpx.Response:
                self.calls += 1
                request = httpx.Request("GET", url)
                if self.calls == 1:
                    return httpx.Response(200, request=request)
                return httpx.Response(200, content=b"png-bytes", request=request)

        client = FakeClient()
        content = await _download_result_layer(client, "https://example.test/layer.png", 1, 1)

        self.assertEqual(content, b"png-bytes")
        self.assertEqual(client.calls, 2)


if __name__ == "__main__":
    unittest.main()

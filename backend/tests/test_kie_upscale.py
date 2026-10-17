from __future__ import annotations

import asyncio
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from PIL import Image

from backend import kie_upscale
from backend.kie_upscale import KieUpscaleClient, KieUpscaleError, prepare_upscale_input


def _png_bytes(width: int, height: int, mode: str = "RGB") -> bytes:
    buffer = io.BytesIO()
    Image.new(mode, (width, height)).save(buffer, format="PNG")
    return buffer.getvalue()


def _mock_transport(state: str, requests: list[httpx.Request]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        path = request.url.path
        if path == "/api/file-stream-upload":
            return httpx.Response(200, json={"data": {"downloadUrl": "https://files.test/in.png"}})
        if path == "/api/v1/jobs/createTask":
            return httpx.Response(200, json={"code": 200, "data": {"taskId": "task_1"}})
        if path == "/api/v1/jobs/recordInfo":
            if state == "success":
                result = json.dumps({"resultUrls": ["https://files.test/out.png"]})
                return httpx.Response(200, json={"data": {"state": "success", "resultJson": result}})
            return httpx.Response(200, json={"data": {"state": "fail", "failMsg": "bad input"}})
        if request.url.host == "files.test" and path == "/out.png":
            return httpx.Response(200, content=_png_bytes(20, 10))
        return httpx.Response(404)

    return httpx.MockTransport(handler)


class KieUpscaleTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _run(self, state: str) -> tuple[tuple[int, int, str], list[httpx.Request]]:
        src = self.dir / "src.png"
        src.write_bytes(_png_bytes(10, 5))
        requests: list[httpx.Request] = []
        real_client = httpx.AsyncClient
        transport = _mock_transport(state, requests)

        def fake_client(**kwargs):
            return real_client(transport=transport, **kwargs)

        client = KieUpscaleClient(
            api_key="test-key",
            base_url="https://api.kie.test",
            upload_base_url="https://upload.kie.test",
            poll_interval_seconds=1,
        )
        with patch.object(kie_upscale.httpx, "AsyncClient", side_effect=fake_client):
            result = asyncio.run(client.upscale(src, self.dir / "out" / "job.png"))
        return result, requests

    def test_upscale_sends_2x_and_saves_png(self) -> None:
        (width, height, task_id), requests = self._run("success")
        self.assertEqual((width, height, task_id), (20, 10, "task_1"))
        create = next(r for r in requests if r.url.path == "/api/v1/jobs/createTask")
        body = json.loads(create.content)
        self.assertEqual(body["model"], "topaz/image-upscale")
        self.assertEqual(body["input"], {"image_url": "https://files.test/in.png", "upscale_factor": "2"})
        with Image.open(self.dir / "out" / "job.png") as im:
            self.assertEqual(im.format, "PNG")

    def test_failed_task_raises_without_fallback(self) -> None:
        with self.assertRaisesRegex(KieUpscaleError, "bad input"):
            self._run("fail")
        self.assertFalse((self.dir / "out" / "job.png").exists())

    def test_missing_api_key_raises(self) -> None:
        with self.assertRaisesRegex(KieUpscaleError, "KIE_API_KEY"):
            asyncio.run(KieUpscaleClient(api_key="").upscale(self.dir / "x.png", self.dir / "y.png"))

    def test_prepare_rejects_image_exceeding_output_limit(self) -> None:
        src = self.dir / "big.png"
        Image.new("RGB", (10001, 10)).save(src)
        with self.assertRaisesRegex(KieUpscaleError, "过大"):
            prepare_upscale_input(src, self.dir)

    def test_prepare_keeps_small_supported_file(self) -> None:
        src = self.dir / "ok.png"
        src.write_bytes(_png_bytes(10, 10))
        self.assertEqual(prepare_upscale_input(src, self.dir), src)

    def test_prepare_converts_oversized_file_to_webp_keeping_alpha(self) -> None:
        src = self.dir / "heavy.png"
        src.write_bytes(_png_bytes(10, 10, "RGBA"))
        with patch.object(kie_upscale, "MAX_INPUT_BYTES", 30):
            with self.assertRaisesRegex(KieUpscaleError, "10MB"):
                prepare_upscale_input(src, self.dir)
        with patch.object(kie_upscale, "MAX_INPUT_BYTES", 10_000), patch.object(Path, "stat") as stat:
            stat.return_value.st_size = 20_000
            out = prepare_upscale_input(src, self.dir)
        self.assertEqual(out.suffix, ".webp")
        with Image.open(out) as im:
            self.assertEqual(im.mode, "RGBA")


if __name__ == "__main__":
    unittest.main()

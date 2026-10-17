from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from PIL import Image

from backend import config, main


HISTORY = [
    {"who": "user", "text": "白底红色保温杯主图"},
    {"who": "ai", "prompt": "白色背景上的红色保温杯，居中构图"},
]


class JudgeContextIntentTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.prev = Path(self.tmp.name) / "prev.png"
        Image.new("RGB", (1200, 800), "red").save(self.prev)
        self.requests: list[httpx.Request] = []

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _judge(self, reply, *, status: int = 200, api_key: str = "test-key", prev: Path | None = None) -> dict:
        def handler(request: httpx.Request) -> httpx.Response:
            self.requests.append(request)
            if status != 200:
                return httpx.Response(status, text="upstream down")
            return httpx.Response(200, json={"choices": [{"message": {"content": reply}}]})

        real_client = httpx.AsyncClient
        transport = httpx.MockTransport(handler)
        live_config = ("https://vlm.test/v1", api_key, "test-vlm")
        with patch.object(main.settings, "current_vlm_config", return_value=live_config), \
                patch.object(main.httpx, "AsyncClient", side_effect=lambda **kw: real_client(transport=transport, **kw)):
            return asyncio.run(main._judge_context_intent(HISTORY, "背景换成蓝色", prev, has_user_refs=False))

    def test_returns_each_mode_from_vlm(self) -> None:
        for mode in ("edit", "regenerate", "new"):
            with self.subTest(mode=mode):
                result = self._judge(json.dumps({"mode": mode, "reason": "依据"}), prev=self.prev)
                self.assertEqual(result, {"mode": mode, "reason": "依据", "source": "vlm"})

    def test_sends_previous_image_as_small_jpeg(self) -> None:
        self._judge('```json\n{"mode": "edit", "reason": "改背景"}\n```', prev=self.prev)
        body = json.loads(self.requests[0].content)
        self.assertEqual(body["model"], "test-vlm")
        content = body["messages"][0]["content"]
        self.assertIn("背景换成蓝色", content[0]["text"])
        self.assertIn("白底红色保温杯主图", content[0]["text"])
        self.assertTrue(content[1]["image_url"]["url"].startswith("data:image/jpeg;base64,"))

    def test_without_previous_image_sends_text_only(self) -> None:
        self._judge('{"mode": "regenerate", "reason": "再来一张"}', prev=None)
        content = json.loads(self.requests[0].content)["messages"][0]["content"]
        self.assertEqual(len(content), 1)

    def test_falls_back_to_edit_on_failures(self) -> None:
        cases = {
            "unconfigured": dict(reply="", api_key=""),
            "http_error": dict(reply="", status=502),
            "bad_mode": dict(reply='{"mode": "maybe"}'),
            "not_json": dict(reply="我觉得是修改"),
        }
        for name, kwargs in cases.items():
            with self.subTest(case=name):
                result = self._judge(prev=self.prev, **kwargs)
                self.assertEqual(result["mode"], "edit")
                self.assertEqual(result["source"], "fallback")


class CurrentVlmConfigTest(unittest.TestCase):
    def test_reads_env_file_on_every_call(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            env_path = Path(tmp) / ".env"
            env_path.write_text("VLM_MODEL=model-a\nVLM_BASE_URL=vlm.test/v1\nVLM_API_KEY=k1\n", encoding="utf-8")
            with patch.object(config, "_env_path", env_path):
                self.assertEqual(main.settings.current_vlm_config(), ("https://vlm.test/v1", "k1", "model-a"))
                env_path.write_text("VLM_MODEL=model-b\nAI_IMAGE_BASE_URL=https://img.test\nAI_IMAGE_API_KEY=k2\n", encoding="utf-8")
                self.assertEqual(main.settings.current_vlm_config(), ("https://img.test", "k2", "model-b"))


if __name__ == "__main__":
    unittest.main()

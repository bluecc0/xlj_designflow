from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from starlette.requests import Request

from backend import job_store, main


def _request(url: str = "") -> Request:
    query = f"url={url}".encode("utf-8") if url else b""
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/ai-image/metadata",
            "query_string": query,
            "headers": [],
        }
    )


class AiImageMetadataTest(unittest.TestCase):
    def test_rejects_empty_url(self) -> None:
        with self.assertRaises(HTTPException) as raised:
            main.ai_image_metadata(_request(""), "")
        self.assertEqual(raised.exception.status_code, 400)

    def test_returns_metadata_for_ai_image(self) -> None:
        mock_job = {
            "id": "job_12345",
            "user_id": "test_user",
            "status": "done",
            "model": "gpt-image-2.5",
            "provider": "apimart",
            "prompt": "电商服饰白底人像摄影，纯色干净背景",
            "original_prompt": "电商服饰白底人像摄影",
            "resolved_prompt": "电商服饰白底人像摄影，高分辨率",
            "prompt_trace": "enhanced",
            "size": "1024x1024",
            "resolution": "1K",
            "has_reference": True,
            "created_at": 1718001122.0,
            "request_meta": {"quality": "xhigh"},
        }
        with (
            patch.object(main, "load_ai_image_job_by_image_url", return_value=mock_job),
            patch.object(main, "_current_user", return_value={"id": "test_user"}),
        ):
            res = main.ai_image_metadata(
                _request("/ai-images/test_user/2026-09-15/demo.png"),
                "/ai-images/test_user/2026-09-15/demo.png",
            )

        self.assertTrue(res["is_ai_generated"])
        self.assertIsNotNone(res["ai_metadata"])
        self.assertEqual(res["ai_metadata"]["prompt"], "电商服饰白底人像摄影，纯色干净背景")
        self.assertEqual(res["ai_metadata"]["model"], "gpt-image-2.5")
        self.assertEqual(res["ai_metadata"]["provider"], "apimart")
        self.assertEqual(res["ai_metadata"]["job_id"], "job_12345")

    def test_calculates_file_size_when_file_exists(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(b"PNG fake content with some bytes 1234567890")
            temp_path = Path(f.name)

        try:
            with (
                patch.object(job_store, "load_ai_image_job_by_image_url", return_value=None),
                patch.object(main, "_resolve_public_asset_path", return_value=temp_path),
            ):
                res = main.ai_image_metadata(
                    _request("/ai-images/test.png"),
                    "/ai-images/test.png",
                )

            self.assertFalse(res["is_ai_generated"])
            self.assertIsNone(res["ai_metadata"])
            self.assertEqual(res["file_size"], temp_path.stat().st_size)
            self.assertIn("B", res["file_size_formatted"])
        finally:
            temp_path.unlink(missing_ok=True)

    def test_load_ai_image_job_by_image_url_handles_encoded_and_full_urls(self) -> None:
        test_id = "test_url_norm_job"
        test_url = "/ai-images/user_a/2026/测试图片.png"
        job_store.save_ai_image_job(
            job_id=test_id,
            user_id="user_a",
            status="done",
            model="nano-banana-pro",
            prompt="测试提示词",
            size="1024x1024",
            image_url=test_url,
            created_at=1718000000.0,
        )

        try:
            # 精确匹配
            j1 = job_store.load_ai_image_job_by_image_url(test_url)
            self.assertIsNotNone(j1)
            self.assertEqual(j1["id"], test_id)

            # 完整 URL 匹配
            j2 = job_store.load_ai_image_job_by_image_url(f"http://localhost:8000{test_url}")
            self.assertIsNotNone(j2)
            self.assertEqual(j2["id"], test_id)

            # URL 编码路径匹配
            encoded_url = "/ai-images/user_a/2026/%E6%B5%8B%E8%AF%95%E5%9B%BE%E7%89%87.png"
            j3 = job_store.load_ai_image_job_by_image_url(encoded_url)
            self.assertIsNotNone(j3)
            self.assertEqual(j3["id"], test_id)
        finally:
            with job_store._connect() as conn:
                conn.execute("DELETE FROM ai_image_jobs WHERE id = ?", (test_id,))
                conn.commit()


if __name__ == "__main__":
    unittest.main()

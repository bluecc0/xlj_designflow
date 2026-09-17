from __future__ import annotations

import asyncio
import os
import shutil
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi import HTTPException

from backend import ai_image
from backend.main import (
    MAX_REFERENCE_IMAGE_BYTES,
    _aread_reference_upload,
    _expected_retry_reference_count,
)


class NormalizeReferencePromptTest(unittest.TestCase):
    def test_explicit_mentions_normalize(self) -> None:
        prompt = "查看@图片1 的氛围，把@图3的鞋子放到#2的场景里，参考第一张图"
        self.assertEqual(
            ai_image.normalize_reference_prompt(prompt),
            "查看[image 1] 的氛围，把[image 3]的鞋子放到[image 2]的场景里，参考[image 1]",
        )

    def test_plain_words_not_rewritten(self) -> None:
        cases = [
            "使用构图1方案",
            "参考效果图1的光影",
            "截图1已经导出",
            "图1放左边",
            "图片2作为背景",
        ]
        for text in cases:
            with self.subTest(text=text):
                self.assertEqual(ai_image.normalize_reference_prompt(text), text)


class ReferenceMergeOrderTest(unittest.TestCase):
    def test_user_refs_keep_frontend_numbering_ahead_of_context(self) -> None:
        """1 张历史上下文 + 2 张用户可见参考图时，@图片1/@图片2 应对齐用户图。"""
        context_ref_bytes = [(b"prev", "prev.png")]
        user_refs = [(b"u1", "user1.png"), (b"u2", "user2.png")]

        # 与 main.py 中 ai_image_endpoint / retry 路径保持一致：
        # 用户可见参考图在前，隐藏上下文图追加在后。
        all_refs = (user_refs + context_ref_bytes)[:9]
        names = [name for _content, name in all_refs]

        self.assertEqual(names, ["user1.png", "user2.png", "prev.png"])
        self.assertEqual(
            ai_image.normalize_reference_prompt("把@图片1 放到@图片2 的场景"),
            "把[image 1] 放到[image 2] 的场景",
        )

    def test_retry_reference_count_uses_truncated_set(self) -> None:
        """9 张手动图再追加上下文图时，重试只校验实际保存的前 9 张。"""
        user_refs = [(f"u{i}".encode(), f"user{i}.png") for i in range(9)]
        context_refs = [(b"context", "context.png")]
        all_refs = (user_refs + context_refs)[:9]

        actual_manual_count = min(len(user_refs), len(all_refs))
        actual_context_count = max(0, len(all_refs) - actual_manual_count)
        old_job = {
            "has_reference": True,
            "reference_count": len(all_refs),
        }
        request_meta = {
            # 覆盖旧版本曾记录的截断前数量，确保任务 reference_count 是权威值。
            "manual_reference_count": len(user_refs),
            "context_reference_count": len(context_refs),
        }

        self.assertEqual(len(all_refs), 9)
        self.assertEqual(actual_manual_count, 9)
        self.assertEqual(actual_context_count, 0)
        self.assertEqual(_expected_retry_reference_count(old_job, request_meta), 9)


class ReferenceUploadLimitTest(unittest.IsolatedAsyncioTestCase):
    async def test_reads_only_max_plus_one_bytes(self) -> None:
        oversized = b"x" * (MAX_REFERENCE_IMAGE_BYTES + 8)
        upload = SimpleNamespace(
            filename="big.png",
            read=AsyncMock(return_value=oversized[: MAX_REFERENCE_IMAGE_BYTES + 1]),
        )

        with self.assertRaises(HTTPException) as ctx:
            await _aread_reference_upload(upload, index=0)

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("5MB", str(ctx.exception.detail))
        upload.read.assert_awaited_once_with(MAX_REFERENCE_IMAGE_BYTES + 1)

    async def test_accepts_within_limit(self) -> None:
        payload = b"ok-image"
        upload = SimpleNamespace(
            filename="ok.png",
            read=AsyncMock(return_value=payload),
        )
        content, name = await _aread_reference_upload(upload, index=0)
        self.assertEqual(content, payload)
        self.assertEqual(name, "ok.png")
        upload.read.assert_awaited_once_with(MAX_REFERENCE_IMAGE_BYTES + 1)


class PersistAndLoadTaskReferencesTest(unittest.TestCase):
    def test_save_and_load_refs_exact_order(self) -> None:
        test_dir = Path(tempfile.mkdtemp())
        try:
            with unittest.mock.patch("backend.ai_image._ensure_user_output_dir", return_value=test_dir):
                refs = [
                    (b"ref-0", "first.png"),
                    (b"ref-1", "second.jpg"),
                    (b"ref-2", "third.webp"),
                ]
                paths = ai_image.save_user_refs("test-user", "job-123", refs)
                self.assertEqual(len(paths), 3)

                loaded = ai_image.load_user_refs("test-user", "job-123")
                self.assertEqual(len(loaded), 3)
                self.assertEqual(loaded[0][0], b"ref-0")
                self.assertEqual(loaded[1][0], b"ref-1")
                self.assertEqual(loaded[2][0], b"ref-2")
                self.assertTrue(loaded[0][1].startswith("ref_00"))
                self.assertTrue(loaded[1][1].startswith("ref_01"))
                self.assertTrue(loaded[2][1].startswith("ref_02"))
        finally:
            shutil.rmtree(test_dir, ignore_errors=True)

    def test_cleanup_expired_refs_keeps_recent_and_removes_old(self) -> None:
        root = Path(tempfile.mkdtemp())
        try:
            old_dir = root / "user-a" / "refs" / "old-job"
            recent_dir = root / "user-a" / "refs" / "recent-job"
            old_dir.mkdir(parents=True)
            recent_dir.mkdir(parents=True)
            (old_dir / "ref_00.png").write_bytes(b"old")
            (recent_dir / "ref_00.png").write_bytes(b"recent")
            old_timestamp = time.time() - (8 * 86400)
            for path in (old_dir, old_dir / "ref_00.png"):
                os.utime(path, (old_timestamp, old_timestamp))

            with unittest.mock.patch.object(ai_image, "_OUTPUT_DIR", root):
                cleaned = ai_image.cleanup_expired_user_refs(max_age_days=7)

            self.assertEqual(cleaned, 1)
            self.assertFalse(old_dir.exists())
            self.assertTrue(recent_dir.exists())
        finally:
            shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()

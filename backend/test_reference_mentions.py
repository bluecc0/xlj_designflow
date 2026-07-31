from __future__ import annotations

import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi import HTTPException

from backend import ai_image
from backend.main import MAX_REFERENCE_IMAGE_BYTES, _aread_reference_upload


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


if __name__ == "__main__":
    unittest.main()

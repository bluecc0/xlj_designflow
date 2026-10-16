from __future__ import annotations

import unittest
import asyncio
from backend import main


class QuickEditCoordinatePromptTest(unittest.TestCase):
    def test_coordinate_prompt_bypass_context_enrichment(self):
        prompt_with_tag = """[精准局部修改需求]
用户指定了参考图中的局部修改位置，坐标信息如下（以参考图左上角为原点 (0%, 0%)，包含归一化坐标与百分比坐标）：
- 标记 1: 坐标 (x: 35%, y: 42%), 归一化坐标 (350, 420), 像素位置 (x: 358px, y: 430px)

修改要求：
标记1改为红色"""

        # When prompt has the marker tag, it should return without calling LLM
        res = asyncio.run(
            main._build_context_aware_prompt(
                session_id="dummy_session",
                user_id="dummy_user",
                current_prompt=prompt_with_tag,
            )
        )
        self.assertEqual(res, prompt_with_tag)

    def test_coordinate_with_percentage_bypass(self):
        prompt_with_coords = "请在坐标 (x: 50%, y: 50%) 处改为金色光芒"
        res = asyncio.run(
            main._build_context_aware_prompt(
                session_id="dummy_session",
                user_id="dummy_user",
                current_prompt=prompt_with_coords,
            )
        )
        self.assertEqual(res, prompt_with_coords)


if __name__ == "__main__":
    unittest.main()

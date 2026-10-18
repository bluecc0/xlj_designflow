from __future__ import annotations

import unittest
import asyncio
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from backend import job_store, main
from backend.config import settings


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


class QuickEditChatHistoryTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.user = {"id": "quick-edit-user", "username": "tester", "role": "user"}
        self.background = AsyncMock()
        for patcher in (
            patch.object(job_store, "_DB_PATH", Path(self.temp_dir.name) / "jobs.db"),
            patch.object(main, "_get_session_user", return_value=self.user),
            patch.object(main, "_run_ai_image_background", self.background),
            patch.object(settings, "siliconflow_api_key", ""),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        job_store.init_db()
        self.client = TestClient(main.app)
        self.addCleanup(self.client.close)
        self.display_prompt = "<标记1>改为红色"
        self.prompt = (
            "[精准局部修改需求]\n"
            "- 标记 1 [坐标点]: 坐标 (x: 35%, y: 42%), 归一化坐标 (350, 420)\n\n"
            f"修改要求：\n{self.display_prompt}"
        )

    def submit_and_restore(self, **extra):
        response = self.client.post("/ai-image", data={
            "model": "gpt-image-2.5", "provider": "auto", "prompt": self.prompt, **extra,
        })
        self.assertEqual(response.status_code, 200, response.text)
        submitted = response.json()
        history = self.client.get(f"/history/ai-chats/{submitted['chat_session_id']}")
        self.assertEqual(history.status_code, 200, history.text)
        return submitted, history.json()

    def test_restored_history_keeps_display_text_and_generation_keeps_coordinates(self):
        submitted, history = self.submit_and_restore(display_prompt=f"  {self.display_prompt}  ")
        user_messages = [m["text"] for m in history["messages"] if m.get("who") == "user"]
        self.assertEqual(user_messages, [self.display_prompt])
        session = job_store.get_ai_chat_session(submitted["chat_session_id"], user_id=self.user["id"])
        self.assertEqual(session["title"], self.display_prompt)
        job = job_store.load_ai_image_job(submitted["job_id"])
        self.assertEqual(job["original_prompt"], self.prompt)
        self.assertEqual(self.background.call_args.kwargs["prompt"], self.prompt)
        self.assertEqual(self.background.call_args.kwargs["resolved_prompt"], self.prompt)

    def test_batch_restores_one_display_message_and_keeps_all_job_prompts(self):
        submitted, history = self.submit_and_restore(display_prompt=self.display_prompt, batch_count="2")
        self.assertEqual([m["text"] for m in history["messages"] if m.get("who") == "user"], [self.display_prompt])
        self.assertEqual(len(submitted["job_ids"]), 2)
        for job_id in submitted["job_ids"]:
            self.assertEqual(job_store.load_ai_image_job(job_id)["original_prompt"], self.prompt)
        self.assertEqual(self.background.call_count, 2)

    def test_omitted_display_prompt_preserves_existing_client_behavior(self):
        _, history = self.submit_and_restore()
        self.assertEqual(history["messages"][0]["text"], self.prompt)

    def test_blank_display_prompt_falls_back_to_generation_prompt(self):
        _, history = self.submit_and_restore(display_prompt="  \n ")
        self.assertEqual(history["messages"][0]["text"], self.prompt)


if __name__ == "__main__":
    unittest.main()

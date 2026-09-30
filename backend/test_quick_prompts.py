from __future__ import annotations

import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch
from starlette.requests import Request

from backend import job_store
from backend import main
from backend.models import QuickPromptCreateRequest, QuickPromptUpdateRequest


def _mock_request(user_id: str) -> Request:
    return Request({
        "type": "http",
        "method": "GET",
        "path": "/quick-prompts",
        "headers": [],
    })


class QuickPromptsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_db_path = job_store._DB_PATH
        job_store._DB_PATH = Path(self.temp_dir.name) / "test_quick_prompts.db"
        job_store.init_db()
        self.user_a = f"test_user_a_{uuid.uuid4().hex[:8]}"
        self.user_b = f"test_user_b_{uuid.uuid4().hex[:8]}"

    def tearDown(self) -> None:
        job_store._DB_PATH = self.original_db_path
        self.temp_dir.cleanup()

    def test_default_seeding_on_first_list(self) -> None:
        prompts = job_store.list_quick_prompts(self.user_a)
        self.assertEqual(len(prompts), 1)
        titles = [p["title"] for p in prompts]
        self.assertIn("专业商业静物摄影", titles)
        for p in prompts:
            self.assertEqual(p["user_id"], self.user_a)

    def test_create_and_update_prompt(self) -> None:
        created = job_store.create_quick_prompt(
            user_id=self.user_a,
            title="我的自定义提示词",
            content="高清镜头下的香水瓶特写，金色反光",
            category="特写",
        )
        self.assertTrue(created["id"].startswith("qp_"))
        self.assertEqual(created["title"], "我的自定义提示词")
        self.assertEqual(created["category"], "特写")

        # Update
        updated = job_store.update_quick_prompt(
            prompt_id=created["id"],
            user_id=self.user_a,
            title="我的自定义提示词-修改版",
            content="更新后的提示词内容",
            category="场景",
        )
        self.assertIsNotNone(updated)
        self.assertEqual(updated["title"], "我的自定义提示词-修改版")
        self.assertEqual(updated["content"], "更新后的提示词内容")
        self.assertEqual(updated["category"], "场景")

    def test_user_isolation(self) -> None:
        created_a = job_store.create_quick_prompt(
            user_id=self.user_a,
            title="A的提示词",
            content="内容A",
        )
        # User B cannot update User A's prompt
        updated_by_b = job_store.update_quick_prompt(
            prompt_id=created_a["id"],
            user_id=self.user_b,
            title="非法篡改",
        )
        self.assertIsNone(updated_by_b)

        # User B cannot delete User A's prompt
        deleted_by_b = job_store.delete_quick_prompt(
            prompt_id=created_a["id"],
            user_id=self.user_b,
        )
        self.assertFalse(deleted_by_b)

        # User A can delete their own prompt
        deleted_by_a = job_store.delete_quick_prompt(
            prompt_id=created_a["id"],
            user_id=self.user_a,
        )
        self.assertTrue(deleted_by_a)

    def test_api_endpoints(self) -> None:
        with patch.object(main, "_current_user", return_value={"id": self.user_a}):
            req = _mock_request(self.user_a)
            # 1. GET
            res = main.get_quick_prompts_endpoint(req)
            self.assertIn("prompts", res)
            self.assertEqual(len(res["prompts"]), 1)

            # 2. POST
            create_req = QuickPromptCreateRequest(
                title="API新增",
                content="API新增内容，超清晰",
                category="创意",
            )
            post_res = main.create_quick_prompt_endpoint(req, create_req)
            self.assertIn("prompt", post_res)
            prompt_id = post_res["prompt"]["id"]

            # 3. PUT
            update_req = QuickPromptUpdateRequest(
                title="API更新标题",
            )
            put_res = main.update_quick_prompt_endpoint(req, prompt_id, update_req)
            self.assertEqual(put_res["prompt"]["title"], "API更新标题")

            # 4. DELETE
            del_res = main.delete_quick_prompt_endpoint(req, prompt_id)
            self.assertEqual(del_res["deleted"], prompt_id)


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.main import app


class TemplateScanMarkerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    @patch("backend.main.get_client")
    @patch("backend.main._get_session_user", return_value={"id": "test-user", "username": "tester", "role": "user"})
    def test_templates_matching_test_marker(self, mock_user: MagicMock, mock_get_client: MagicMock) -> None:
        client_mock = MagicMock()
        mock_get_client.return_value = client_mock

        # 模拟 Penpot API 结构
        client_mock._rpc.return_value = [{"id": "team-1", "name": "设计团队"}]
        client_mock.get_team_projects.return_value = [
            {"id": "proj-1", "name": "模板项目"},
            {"id": "proj-2", "name": "临时测试项目"},
            {"id": "proj-3", "name": "其他无关项目"},
        ]
        # proj-1 下有普通模板、新测试模板，以及合成工作副本
        def mock_get_project_files(pid: str):
            if pid == "proj-1":
                return [
                    {"id": "file-1", "name": "特殊品完整_测试"},
                    {"id": "file-2", "name": "特殊品_测试"},
                    {"id": "file-3", "name": "常规电商模板"},
                    {"id": "file-4", "name": "合成-20260914-12345678"},  # 不含模板/测试，应被过滤
                ]
            if pid == "proj-2":
                return [
                    {"id": "file-5", "name": "新测试画板模板"},
                ]
            return []

        client_mock.get_project_files.side_effect = mock_get_project_files

        def mock_get_file(fid: str):
            return {
                "id": fid,
                "name": fid,
                "pagesIndex": {"page-1": {"name": "Page 1"}},
                "shapes": {},
            }

        client_mock.get_file.side_effect = mock_get_file
        client_mock.parse_frames.return_value = [
            {"id": "frame-1", "name": "画板1", "page_id": "page-1", "width": 800, "height": 800}
        ]
        client_mock.parse_slots.return_value = []

        resp = self.client.get("/templates")
        self.assertEqual(resp.status_code, 200)
        templates = resp.json()

        file_names = [t["group_name"] for t in templates]
        self.assertIn("特殊品完整_测试", file_names)
        self.assertIn("特殊品_测试", file_names)
        self.assertIn("常规电商模板", file_names)
        self.assertIn("新测试画板模板", file_names)
        self.assertNotIn("合成-20260914-12345678", file_names)

        full_tpl = next(t for t in templates if t["group_name"] == "特殊品完整_测试")
        self.assertTrue(full_tpl["is_special_full"])
        self.assertFalse(full_tpl["is_special"])

        special_tpl = next(t for t in templates if t["group_name"] == "特殊品_测试")
        self.assertTrue(special_tpl["is_special"])
        self.assertFalse(special_tpl["is_special_full"])

        normal_tpl = next(t for t in templates if t["group_name"] == "常规电商模板")
        self.assertFalse(normal_tpl["is_special"])
        self.assertFalse(normal_tpl["is_special_full"])


if __name__ == "__main__":
    unittest.main()

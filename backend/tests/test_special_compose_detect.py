from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.config import settings
from backend.main import app
from backend.special_compose import detect_special_materials


class SpecialComposeDetectTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = Path(tempfile.mkdtemp())
        self.banner_dir = self.temp_dir / "场景图" / "Banner"
        self.poster_dir = self.temp_dir / "场景图" / "Poster"
        self.banner_dir.mkdir(parents=True, exist_ok=True)
        self.poster_dir.mkdir(parents=True, exist_ok=True)

    def tearDown(self) -> None:
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_empty_sku(self) -> None:
        res = detect_special_materials("")
        self.assertFalse(res["has_scene"])
        self.assertEqual(res["recommended_flow"], "special")

    def test_no_scene_materials(self) -> None:
        with patch.object(settings, "product_library_path", self.temp_dir):
            res = detect_special_materials("TEST-SKU-001")
            self.assertFalse(res["has_scene"])
            self.assertFalse(res["banner_found"])
            self.assertFalse(res["poster_found"])
            self.assertEqual(res["recommended_flow"], "special")

    def test_banner_found(self) -> None:
        (self.banner_dir / "TEST-SKU-001.png").write_bytes(b"dummy")
        with patch.object(settings, "product_library_path", self.temp_dir):
            res = detect_special_materials("TEST-SKU-001")
            self.assertTrue(res["has_scene"])
            self.assertTrue(res["banner_found"])
            self.assertFalse(res["poster_found"])
            self.assertEqual(res["recommended_flow"], "special_full")

    def test_poster_found(self) -> None:
        (self.poster_dir / "TEST-SKU-002.jpg").write_bytes(b"dummy")
        with patch.object(settings, "product_library_path", self.temp_dir):
            res = detect_special_materials("TEST-SKU-002")
            self.assertTrue(res["has_scene"])
            self.assertFalse(res["banner_found"])
            self.assertTrue(res["poster_found"])
            self.assertEqual(res["recommended_flow"], "special_full")

    def test_both_found(self) -> None:
        (self.banner_dir / "TEST-SKU-003.webp").write_bytes(b"dummy")
        (self.poster_dir / "TEST-SKU-003.png").write_bytes(b"dummy")
        with patch.object(settings, "product_library_path", self.temp_dir):
            res = detect_special_materials("TEST-SKU-003")
            self.assertTrue(res["has_scene"])
            self.assertTrue(res["banner_found"])
            self.assertTrue(res["poster_found"])
            self.assertEqual(res["recommended_flow"], "special_full")

    def test_endpoint_routing(self) -> None:
        client = TestClient(app)
        (self.banner_dir / "TEST-SKU-API.png").write_bytes(b"dummy")
        mock_user = {"id": "test-user", "username": "tester", "role": "user"}
        with patch.object(settings, "product_library_path", self.temp_dir), \
             patch("backend.main._get_session_user", return_value=mock_user):
            resp = client.get("/special-compose/detect?sku=TEST-SKU-API")
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertTrue(data["has_scene"])
            self.assertEqual(data["recommended_flow"], "special_full")

    def test_time_4_expansion(self) -> None:
        from backend.special_compose import expand_time_fields
        res = expand_time_fields("9月19日10点发售")
        self.assertEqual(res["time_4"], "9/19 火爆发售中")
        self.assertEqual(res["time_month"], "9/19")
        self.assertEqual(res["time_hour_c"], "10点发售")
        self.assertEqual(res["time_hour"], "10:00发售")
        self.assertEqual(res["time_cn"], "9月19日 10:00")

        res2 = expand_time_fields("9月19日 10点发售")
        self.assertEqual(res2["time_4"], "9/19 火爆发售中")
        self.assertEqual(res2["time_hour_c"], "10点发售")
        self.assertEqual(res2["time_cn"], "9月19日 10:00")

        res3 = expand_time_fields("9/19 10:00发售")
        self.assertEqual(res3["time_4"], "9/19 火爆发售中")
        self.assertEqual(res3["time_hour_c"], "10点发售")
        self.assertEqual(res3["time_cn"], "9月19日 10:00")

        res4 = expand_time_fields("9月19日 10点")
        self.assertEqual(res4["time_hour_c"], "10点发售")
        self.assertEqual(res4["time_cn"], "9月19日 10:00")

        res5 = expand_time_fields("9月19日")
        self.assertEqual(res5["time_4"], "9/19 火爆发售中")
        self.assertEqual(res5["time_hour_c"], "")
        self.assertEqual(res5["time_cn"], "9月19日")

        res6 = expand_time_fields("")
        self.assertEqual(res6["time_4"], "")
        self.assertEqual(res6["time_hour_c"], "")
        self.assertEqual(res6["time_cn"], "")

    def test_time_cn_various_formats(self) -> None:
        from backend.special_compose import expand_time_fields
        # 测试用户示例：8月15日10点发售 / 8月15日 10:00
        self.assertEqual(expand_time_fields("8月15日10点发售")["time_cn"], "8月15日 10:00")
        self.assertEqual(expand_time_fields("8月15日 10:00发售")["time_cn"], "8月15日 10:00")
        self.assertEqual(expand_time_fields("8/15 10:30")["time_cn"], "8月15日 10:30")
        self.assertEqual(expand_time_fields("8/15")["time_cn"], "8月15日")


if __name__ == "__main__":
    unittest.main()

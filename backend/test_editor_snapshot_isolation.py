from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi import HTTPException
from starlette.requests import Request

from backend import main


def _request(user_id: str = "") -> Request:
    query = f"user_id={user_id}".encode("ascii") if user_id else b""
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/editor/snapshot",
            "query_string": query,
            "headers": [],
        }
    )


class EditorSnapshotIsolationTest(unittest.TestCase):
    def test_rejects_snapshot_request_from_stale_user_context(self) -> None:
        with patch.object(main, "_current_user", return_value={"id": "operator_a"}):
            with self.assertRaises(HTTPException) as raised:
                main.editor_load_snapshot(_request("admin"))

        self.assertEqual(raised.exception.status_code, 409)

    def test_loads_snapshot_for_matching_user_context(self) -> None:
        with (
            patch.object(main, "_current_user", return_value={"id": "operator_a"}),
            patch.object(main, "load_editor_snapshot", return_value=(None, 12)),
        ):
            result = main.editor_load_snapshot(_request("operator_a"))

        self.assertEqual(result, {"snapshot": None, "revision": 0})

    def test_detects_assets_owned_by_another_user(self) -> None:
        snapshot = {
            "store": {
                "asset:mine": {
                    "typeName": "asset",
                    "props": {"src": "/ai-images/operator_a/mine.png"},
                },
                "asset:foreign": {
                    "typeName": "asset",
                    "props": {"src": "/ai-images/admin/foreign.png"},
                },
            }
        }

        self.assertEqual(
            main._editor_snapshot_foreign_asset_urls(snapshot, "operator_a"),
            ["/ai-images/admin/foreign.png"],
        )

    def test_detects_canvas_document_assets_owned_by_another_user(self) -> None:
        snapshot = {
            "version": 2,
            "images": [
                {"id": "img-1", "url": "/ai-images/operator_a/mine.png"},
                {"id": "img-2", "url": "/ai-images/operator_b/private.png"},
                {"id": "img-3", "url": "https://example.com/external.png"},
            ],
        }

        self.assertEqual(
            main._editor_snapshot_foreign_asset_urls(snapshot, "operator_a"),
            ["/ai-images/operator_b/private.png"],
        )

    def test_normalizes_canvas_document_asset_urls(self) -> None:
        snapshot = {
            "version": 2,
            "images": [
                {"id": "img-1", "url": "http://127.0.0.1:8000/ai-images/operator_a/1.png"},
                {"id": "img-2", "src": "http://192.168.1.50:8000/ai-images/operator_a/2.png"},
            ],
        }
        normalized = main._normalize_editor_snapshot_assets(snapshot)
        self.assertEqual(
            normalized["images"][0]["url"],
            "/ai-images/operator_a/1.png",
        )
        self.assertEqual(
            normalized["images"][1]["src"],
            "/ai-images/operator_a/2.png",
        )

    def test_auth_exempt_prefixes_does_not_blindly_exempt_product_delete(self) -> None:
        self.assertNotIn("/products/", main._AUTH_EXEMPT_PREFIXES)
        self.assertIn("/products/reference-image", main._AUTH_EXEMPT_PREFIXES)
        self.assertIn("/products/mock-image", main._AUTH_EXEMPT_PREFIXES)

    def test_mock_image_escapes_xml_and_script_tags(self) -> None:
        response = main.get_product_mock_image(
            sku='DEMO</text><script>alert("xss")</script><text>',
            asset_type='white"><script>alert(1)</script>',
        )
        body = response.body.decode("utf-8")
        self.assertNotIn("<script>", body)
        self.assertIn("&lt;script&gt;", body)
        self.assertIn("&quot;", body)

    def test_user_delete_intent_allows_clearing_content_while_update_is_rejected(self) -> None:
        import json
        from backend import job_store
        import tempfile
        from pathlib import Path

        doc_with_images = json.dumps({
            "version": 2,
            "pages": [{"id": "p1", "name": "P1", "order": 0}],
            "activePageId": "p1",
            "frames": [],
            "images": [
                {"id": "img-1", "url": "/a.png"},
                {"id": "img-2", "url": "/b.png"},
                {"id": "img-3", "url": "/c.png"},
            ],
            "texts": [],
        })
        empty_doc = json.dumps({
            "version": 2,
            "pages": [{"id": "p1", "name": "P1", "order": 0}],
            "activePageId": "p1",
            "frames": [],
            "images": [],
            "texts": [],
        })

        with tempfile.TemporaryDirectory() as temp_dir:
            test_db = Path(temp_dir) / "test_jobs.db"
            with patch.object(job_store, "_DB_PATH", test_db):
                job_store.init_db()

                # 初始保存 3 张图片
                ok, rev1, reason = job_store.save_editor_snapshot("test_user", doc_with_images)
                self.assertTrue(ok)
                self.assertEqual(rev1, 1)

                # 使用默认 intent='update' 清空，触发防误清空保护被拒绝
                ok, rev_rej, reason = job_store.save_editor_snapshot(
                    "test_user",
                    empty_doc,
                    base_revision=1,
                    intent="update",
                )
                self.assertFalse(ok)
                self.assertIn("overwrite_rejected", str(reason))

                # 使用 intent='user_delete' 清空（用户显式删除或撤销插入），成功持久化
                ok, rev2, reason = job_store.save_editor_snapshot(
                    "test_user",
                    empty_doc,
                    base_revision=1,
                    intent="user_delete",
                )
                self.assertTrue(ok)
                self.assertEqual(rev2, 2)


if __name__ == "__main__":
    unittest.main()

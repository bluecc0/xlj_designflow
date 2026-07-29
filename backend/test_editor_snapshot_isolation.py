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


if __name__ == "__main__":
    unittest.main()

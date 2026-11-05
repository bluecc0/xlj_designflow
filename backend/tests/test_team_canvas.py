from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from starlette.requests import Request

from backend import job_store, main, team_canvas

OWNER = {"id": "owner", "username": "小王"}
MEMBER = {"id": "member", "username": "小李"}


def _personal_doc() -> dict:
    return {
        "version": 2,
        "pages": [{"id": "p1", "name": "春季主图", "order": 0}, {"id": "p2", "name": "草稿", "order": 1}],
        "groups": [],
        "activePageId": "p1",
        "frames": [{"id": "f1", "pageId": "p1", "name": "画板 1", "x": 0, "y": 0, "width": 100, "height": 100}],
        "images": [
            {"id": "i1", "pageId": "p1", "url": "/ai-images/owner/a.png", "x": 0, "y": 0, "width": 10, "height": 10},
            {"id": "i2", "pageId": "p2", "url": "/ai-images/owner/b.png", "x": 0, "y": 0, "width": 10, "height": 10},
        ],
        "texts": [],
    }


class _TeamCanvasBase(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.patches = [
            patch.object(job_store, "_DB_PATH", root / "jobs.db"),
            patch.object(team_canvas.settings, "output_path", root / "output"),
        ]
        for p in self.patches:
            p.start()
        job_store.init_db()
        team_canvas.init_team_canvas_tables()
        team_canvas._invalidate_asset_index()
        job_store.save_editor_snapshot("owner", json.dumps(_personal_doc()))

    def tearDown(self) -> None:
        for p in self.patches:
            p.stop()
        team_canvas._invalidate_asset_index()
        self.tmp.cleanup()

    def _personal(self, user_id: str = "owner") -> dict:
        raw, _ = job_store.load_editor_snapshot(user_id)
        return team_canvas._personal_v2(raw)

    def _share(self) -> str:
        return team_canvas.share_page(OWNER, "p1")["canvas"]["id"]


class TeamCanvasTest(_TeamCanvasBase):

    def test_share_moves_page_out_of_personal_canvas(self) -> None:
        canvas_id = self._share()
        personal = self._personal()
        self.assertEqual([p["id"] for p in personal["pages"]], ["p2"])
        self.assertEqual([im["id"] for im in personal["images"]], ["i2"])
        loaded = team_canvas.load_canvas(canvas_id)
        self.assertEqual([im["id"] for im in loaded["snapshot"]["images"]], ["i1"])
        self.assertEqual(loaded["canvas"]["name"], "春季主图")
        self.assertEqual([c["id"] for c in team_canvas.list_canvases()], [canvas_id])

    def test_sharing_only_page_leaves_an_empty_personal_page(self) -> None:
        team_canvas.share_page(OWNER, "p1")
        team_canvas.share_page(OWNER, "p2")
        personal = self._personal()
        self.assertEqual(len(personal["pages"]), 1)
        self.assertNotIn(personal["pages"][0]["id"], {"p1", "p2"})

    def test_stale_revision_is_rejected_for_client_merge(self) -> None:
        canvas_id = self._share()
        doc = team_canvas.load_canvas(canvas_id)["snapshot"]
        self.assertEqual(team_canvas.save_canvas(MEMBER, canvas_id, doc, 1, "update")[0], True)
        self.assertEqual(team_canvas.save_canvas(OWNER, canvas_id, doc, 1, "update"), (False, 2, "stale_revision"))

    def test_save_records_generation_and_deletion_with_restorable_payload(self) -> None:
        canvas_id = self._share()
        doc = team_canvas.load_canvas(canvas_id)["snapshot"]
        doc["images"] = [{"id": "g1", "pageId": "p1", "url": "/ai-images/member/g.png", "x": 0, "y": 0,
                          "width": 10, "height": 10, "meta": {"model": "gpt-image-2", "prompt": "海边"}}]
        ok, revision, _ = team_canvas.save_canvas(MEMBER, canvas_id, doc, 1, "user_delete")
        self.assertTrue(ok)
        actions = {item["action"]: item for item in team_canvas.list_activity(canvas_id)}
        self.assertIn("gpt-image-2", actions["generate"]["summary"])
        self.assertEqual(actions["generate"]["username"], "小李")
        self.assertEqual(actions["delete"]["payload"]["images"][0]["id"], "i1")
        self.assertTrue(team_canvas.list_versions(canvas_id))
        self.assertEqual(revision, 2)

    def test_canvas_ai_operations_are_recorded_by_type(self) -> None:
        old = {"pages": [{"id": "p1", "name": "画布"}], "images": []}
        new = {"pages": [{"id": "p1", "name": "画布"}], "images": [
            {"id": "m1", "url": "/ai-images/member/m.png", "meta": {"operation": "matting", "sourceImageId": "i1"}},
            {"id": "o1", "url": "/ai-images/member/o.png", "meta": {"operation": "outfit-change", "model": "gpt-image-2"}},
            {"id": "u1", "url": "/ai-images/member/u.png"},
        ]}
        summaries = [summary for _, summary, _ in team_canvas.diff_activity(old, new)]
        self.assertEqual(summaries, ["用抠图生成了 1 张图片", "用AI 换装生成了 1 张图片", "添加了 1 张图片"])

    def test_member_can_restore_image_deleted_from_this_canvas(self) -> None:
        canvas_id = self._share()
        doc = team_canvas.load_canvas(canvas_id)["snapshot"]
        deleted = doc["images"][0]
        doc["images"] = []
        team_canvas.save_canvas(MEMBER, canvas_id, doc, 1, "user_delete")
        self.assertFalse(team_canvas.is_shared_canvas_asset(deleted["url"]))
        doc["images"] = [deleted]
        self.assertEqual(team_canvas.save_canvas(MEMBER, canvas_id, doc, 2, "update"), (True, 3, None))

    def test_text_mentioning_a_url_does_not_authorize_restoring_it(self) -> None:
        canvas_id = self._share()
        doc = team_canvas.load_canvas(canvas_id)["snapshot"]
        secret = "/ai-images/stranger/secret.png"
        doc["texts"] = [{"id": "t1", "pageId": "p1", "text": secret, "x": 0, "y": 0, "width": 1, "height": 1}]
        team_canvas.save_canvas(MEMBER, canvas_id, doc, 1, "update")
        doc["texts"] = []
        team_canvas.save_canvas(MEMBER, canvas_id, doc, 2, "user_delete")
        doc["images"].append({"id": "x", "pageId": "p1", "url": secret, "x": 0, "y": 0, "width": 1, "height": 1})
        self.assertEqual(team_canvas.save_canvas(MEMBER, canvas_id, doc, 3, "update")[2], "foreign_asset_rejected")

    def test_foreign_asset_must_come_from_a_shared_canvas(self) -> None:
        canvas_id = self._share()
        doc = team_canvas.load_canvas(canvas_id)["snapshot"]
        doc["images"].append({"id": "x", "pageId": "p1", "url": "/ai-images/stranger/secret.png",
                              "x": 0, "y": 0, "width": 1, "height": 1})
        self.assertEqual(team_canvas.save_canvas(MEMBER, canvas_id, doc, 1, "update")[2], "foreign_asset_rejected")
        self.assertTrue(team_canvas.is_shared_canvas_asset("/ai-images/owner/a.png"))

    def test_only_owner_can_unshare_and_content_returns_with_member_images_copied(self) -> None:
        canvas_id = self._share()
        source = Path(team_canvas.settings.output_path) / "ai-images" / "member" / "g.png"
        source.parent.mkdir(parents=True)
        source.write_bytes(b"png")
        doc = team_canvas.load_canvas(canvas_id)["snapshot"]
        doc["images"].append({"id": "g1", "pageId": "p1", "url": "/ai-images/member/g.png",
                              "x": 0, "y": 0, "width": 1, "height": 1})
        team_canvas.save_canvas(MEMBER, canvas_id, doc, 1, "update")
        with self.assertRaises(HTTPException) as raised:
            team_canvas.unshare_canvas(MEMBER, canvas_id)
        self.assertEqual(raised.exception.status_code, 403)

        team_canvas.unshare_canvas(OWNER, canvas_id)
        personal = self._personal()
        self.assertIn("p1", [p["id"] for p in personal["pages"]])
        urls = {im["id"]: im["url"] for im in personal["images"]}
        self.assertEqual(urls["g1"], "/ai-images/owner/team-imports/member/g.png")
        self.assertTrue((Path(team_canvas.settings.output_path) / "ai-images/owner/team-imports/member/g.png").is_file())
        self.assertEqual(team_canvas.list_canvases(), [])
        self.assertFalse(team_canvas.is_shared_canvas_asset("/ai-images/owner/a.png"))
        with self.assertRaises(HTTPException):
            team_canvas.load_canvas(canvas_id)

    def test_restore_version_bumps_revision(self) -> None:
        canvas_id = self._share()
        doc = team_canvas.load_canvas(canvas_id)["snapshot"]
        doc["images"] = []
        team_canvas.save_canvas(MEMBER, canvas_id, doc, 1, "user_delete")
        version_id = team_canvas.list_versions(canvas_id)[0]["id"]
        self.assertEqual(team_canvas.restore_version(OWNER, canvas_id, version_id), 3)
        self.assertEqual([im["id"] for im in team_canvas.load_canvas(canvas_id)["snapshot"]["images"]], ["i1"])


class SharedImageCopiedToPersonalTest(_TeamCanvasBase):
    """成员把团队画布里别人的扩图存进个人画布，原画布取消分享后图片仍可用。"""

    OUTPAINT = "/ai-images/owner/outpainting_example/result.png"

    def _save_personal(self, user: dict, doc: dict) -> dict:
        async def body():
            return {"snapshot": json.dumps(doc), "base_revision": None}

        req = Request({"type": "http", "method": "POST", "path": "/editor/snapshot",
                       "query_string": f"user_id={user['id']}".encode(),
                       "headers": [(b"content-type", b"application/json")]})
        with patch.object(main, "_current_user", return_value=user), patch.object(req, "json", side_effect=body):
            return asyncio.run(main.editor_save_snapshot(req))

    def test_personal_copy_survives_unshare(self) -> None:
        source = Path(team_canvas.settings.output_path) / "ai-images/owner/outpainting_example/result.png"
        source.parent.mkdir(parents=True)
        source.write_bytes(b"png")
        canvas_id = self._share()
        doc = team_canvas.load_canvas(canvas_id)["snapshot"]
        doc["images"].append({"id": "o1", "pageId": "p1", "url": self.OUTPAINT, "x": 0, "y": 0, "width": 1, "height": 1})
        team_canvas.save_canvas(OWNER, canvas_id, doc, 1, "update")

        personal = {"version": 2, "pages": [{"id": "m1", "name": "我的"}], "activePageId": "m1", "frames": [], "texts": [],
                    "images": [{"id": "c1", "pageId": "m1", "url": self.OUTPAINT, "x": 0, "y": 0, "width": 1, "height": 1}]}
        result = self._save_personal(MEMBER, personal)
        copied = "/ai-images/member/team-imports/owner/outpainting_example/result.png"
        self.assertEqual(result["rewritten_urls"], {self.OUTPAINT: copied})
        raw, _ = job_store.load_editor_snapshot("member")
        self.assertEqual([im["url"] for im in team_canvas._personal_v2(raw)["images"]], [copied])

        team_canvas.unshare_canvas(OWNER, canvas_id)
        self.assertFalse(team_canvas.is_shared_canvas_asset(self.OUTPAINT))
        # 查看：中间件只放行图片所有者本人，复制后的地址属于成员自己
        self.assertEqual(main._outpainting_asset_owner(copied), "member")
        self.assertEqual(main._outpainting_asset_owner(self.OUTPAINT), "owner")
        # 用作扩图/参考图：按成员身份解析到成员自己的文件
        path, _ = main._outpainting_internal_path(copied, None, MEMBER)
        self.assertTrue(path.is_file())
        with self.assertRaises(HTTPException):
            main._outpainting_internal_path(self.OUTPAINT, None, MEMBER)
        # 之后继续保存个人画布不会再被拒绝
        personal["images"][0]["url"] = copied
        self.assertTrue(self._save_personal(MEMBER, personal)["saved"])


if __name__ == "__main__":
    unittest.main()

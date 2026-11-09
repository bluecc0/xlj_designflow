from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from starlette.requests import Request

from backend import job_store, main, team_canvas, user_profile

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
        loaded = team_canvas.load_canvas(OWNER, canvas_id)
        self.assertEqual([im["id"] for im in loaded["snapshot"]["images"]], ["i1"])
        self.assertEqual(loaded["canvas"]["name"], "春季主图")
        self.assertEqual([c["id"] for c in team_canvas.list_canvases(OWNER)], [canvas_id])

    def test_sharing_only_page_leaves_an_empty_personal_page(self) -> None:
        team_canvas.share_page(OWNER, "p1")
        team_canvas.share_page(OWNER, "p2")
        personal = self._personal()
        self.assertEqual(len(personal["pages"]), 1)
        self.assertNotIn(personal["pages"][0]["id"], {"p1", "p2"})

    def test_viewers_and_activity_carry_avatar_urls(self) -> None:
        canvas_id = self._share()
        with patch.object(team_canvas.settings, "root_dir", Path(self.tmp.name)), \
                patch.object(team_canvas.settings, "allowed_login_users",
                             [{"id": "owner", "username": "小王"}, {"id": "member", "username": "小李"}]):
            avatar = Path(self.tmp.name) / "avatars" / "小王.png"
            avatar.parent.mkdir(parents=True)
            avatar.write_bytes(b"png")
            team_canvas.heartbeat(OWNER, canvas_id)
            viewers = {v["id"]: v for v in team_canvas.heartbeat(MEMBER, canvas_id)["viewers"]}
            self.assertTrue(viewers["owner"]["avatar_url"].startswith("/avatars/小王.png?v="))
            self.assertEqual(viewers["member"]["avatar_url"], "")
            share_item = team_canvas.list_activity(OWNER, canvas_id)[-1]
            self.assertTrue(share_item["avatar_url"].startswith("/avatars/小王.png?v="))

    def test_names_shown_to_others_use_admin_real_name_not_nickname(self) -> None:
        with patch.object(team_canvas.settings, "allowed_login_users",
                          [{"id": "owner", "username": "小王", "display_name": "王小明"},
                           {"id": "member", "username": "小李"}]):
            user_profile.set_nickname(OWNER, "阿明")
            canvas_id = self._share()
            self.assertEqual(team_canvas.load_canvas(OWNER, canvas_id)["canvas"]["owner_name"], "王小明")
            names = {v["id"]: v["name"] for v in team_canvas.heartbeat(MEMBER, canvas_id)["viewers"]}
            names.update({v["id"]: v["name"] for v in team_canvas.heartbeat(OWNER, canvas_id)["viewers"]})
            self.assertEqual(names, {"owner": "王小明", "member": "小李"})
            self.assertEqual(team_canvas.list_activity(OWNER, canvas_id)[-1]["username"], "王小明")

    def test_stale_revision_is_rejected_for_client_merge(self) -> None:
        canvas_id = self._share()
        doc = team_canvas.load_canvas(OWNER, canvas_id)["snapshot"]
        self.assertEqual(team_canvas.save_canvas(MEMBER, canvas_id, doc, 1, "update")[0], True)
        self.assertEqual(team_canvas.save_canvas(OWNER, canvas_id, doc, 1, "update"), (False, 2, "stale_revision"))

    def test_save_records_generation_and_deletion_with_restorable_payload(self) -> None:
        canvas_id = self._share()
        doc = team_canvas.load_canvas(OWNER, canvas_id)["snapshot"]
        doc["images"] = [{"id": "g1", "pageId": "p1", "url": "/ai-images/member/g.png", "x": 0, "y": 0,
                          "width": 10, "height": 10, "meta": {"model": "gpt-image-2", "prompt": "海边"}}]
        ok, revision, _ = team_canvas.save_canvas(MEMBER, canvas_id, doc, 1, "user_delete")
        self.assertTrue(ok)
        actions = {item["action"]: item for item in team_canvas.list_activity(OWNER, canvas_id)}
        self.assertIn("gpt-image-2", actions["generate"]["summary"])
        self.assertEqual(actions["generate"]["username"], "小李")
        self.assertEqual(actions["delete"]["payload"]["images"][0]["id"], "i1")
        self.assertTrue(team_canvas.list_versions(OWNER, canvas_id))
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
        doc = team_canvas.load_canvas(OWNER, canvas_id)["snapshot"]
        deleted = doc["images"][0]
        doc["images"] = []
        team_canvas.save_canvas(MEMBER, canvas_id, doc, 1, "user_delete")
        self.assertFalse(team_canvas.is_shared_canvas_asset(deleted["url"], OWNER))
        doc["images"] = [deleted]
        self.assertEqual(team_canvas.save_canvas(MEMBER, canvas_id, doc, 2, "update"), (True, 3, None))

    def test_text_mentioning_a_url_does_not_authorize_restoring_it(self) -> None:
        canvas_id = self._share()
        doc = team_canvas.load_canvas(OWNER, canvas_id)["snapshot"]
        secret = "/ai-images/stranger/secret.png"
        doc["texts"] = [{"id": "t1", "pageId": "p1", "text": secret, "x": 0, "y": 0, "width": 1, "height": 1}]
        team_canvas.save_canvas(MEMBER, canvas_id, doc, 1, "update")
        doc["texts"] = []
        team_canvas.save_canvas(MEMBER, canvas_id, doc, 2, "user_delete")
        doc["images"].append({"id": "x", "pageId": "p1", "url": secret, "x": 0, "y": 0, "width": 1, "height": 1})
        self.assertEqual(team_canvas.save_canvas(MEMBER, canvas_id, doc, 3, "update")[2], "foreign_asset_rejected")

    def test_foreign_asset_must_come_from_a_shared_canvas(self) -> None:
        canvas_id = self._share()
        doc = team_canvas.load_canvas(OWNER, canvas_id)["snapshot"]
        doc["images"].append({"id": "x", "pageId": "p1", "url": "/ai-images/stranger/secret.png",
                              "x": 0, "y": 0, "width": 1, "height": 1})
        self.assertEqual(team_canvas.save_canvas(MEMBER, canvas_id, doc, 1, "update")[2], "foreign_asset_rejected")
        self.assertTrue(team_canvas.is_shared_canvas_asset("/ai-images/owner/a.png", OWNER))

    def test_only_owner_can_unshare_and_content_returns_with_member_images_copied(self) -> None:
        canvas_id = self._share()
        source = Path(team_canvas.settings.output_path) / "ai-images" / "member" / "g.png"
        source.parent.mkdir(parents=True)
        source.write_bytes(b"png")
        doc = team_canvas.load_canvas(OWNER, canvas_id)["snapshot"]
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
        self.assertEqual(team_canvas.list_canvases(OWNER), [])
        self.assertFalse(team_canvas.is_shared_canvas_asset("/ai-images/owner/a.png", OWNER))
        with self.assertRaises(HTTPException):
            team_canvas.load_canvas(OWNER, canvas_id)

    def test_restore_version_bumps_revision(self) -> None:
        canvas_id = self._share()
        doc = team_canvas.load_canvas(OWNER, canvas_id)["snapshot"]
        doc["images"] = []
        team_canvas.save_canvas(MEMBER, canvas_id, doc, 1, "user_delete")
        version_id = team_canvas.list_versions(OWNER, canvas_id)[0]["id"]
        self.assertEqual(team_canvas.restore_version(OWNER, canvas_id, version_id), 3)
        self.assertEqual([im["id"] for im in team_canvas.load_canvas(OWNER, canvas_id)["snapshot"]["images"]], ["i1"])


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
        doc = team_canvas.load_canvas(OWNER, canvas_id)["snapshot"]
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
        self.assertFalse(team_canvas.is_shared_canvas_asset(self.OUTPAINT, OWNER))
        # 查看：中间件只放行图片所有者本人，复制后的地址属于成员自己
        self.assertEqual(main._ai_image_asset_parts(copied)[0], "member")
        self.assertEqual(main._ai_image_asset_parts(self.OUTPAINT)[0], "owner")
        # 用作扩图/参考图：按成员身份解析到成员自己的文件
        path, _ = main._outpainting_internal_path(copied, None, MEMBER)
        self.assertTrue(path.is_file())
        with self.assertRaises(HTTPException):
            main._outpainting_internal_path(self.OUTPAINT, None, MEMBER)
        # 之后继续保存个人画布不会再被拒绝
        personal["images"][0]["url"] = copied
        self.assertTrue(self._save_personal(MEMBER, personal)["saved"])


class CopyToPersonalTest(_TeamCanvasBase):
    """团队成员和分享者都能把团队画布复制成个人画布，原画布取消分享后副本不受影响。"""

    def setUp(self) -> None:
        super().setUp()
        self.ai_root = Path(team_canvas.settings.output_path) / "ai-images"
        for rel in ("owner/a.png", "owner/outpainting_example/result.png", "member/g.png"):
            (self.ai_root / rel).parent.mkdir(parents=True, exist_ok=True)
            (self.ai_root / rel).write_bytes(b"png")
        self.canvas_id = self._share()
        doc = team_canvas.load_canvas(OWNER, self.canvas_id)["snapshot"]
        doc["images"][0]["frameId"] = "f1"
        doc["images"].append({"id": "o1", "pageId": "p1", "url": "/ai-images/owner/outpainting_example/result.png",
                              "x": 0, "y": 0, "width": 1, "height": 1})
        doc["texts"] = [{"id": "t1", "pageId": "p1", "frameId": "f1", "text": "标题", "x": 0, "y": 0,
                         "width": 1, "height": 1}]
        self.assertTrue(team_canvas.save_canvas(OWNER, self.canvas_id, doc, 1, "update")[0])
        doc["images"].insert(1, {"id": "g1", "pageId": "p1", "url": "/ai-images/member/g.png", "x": 0, "y": 0,
                                 "width": 1, "height": 1, "meta": {"operation": "matting", "sourceImageId": "i1"}})
        self.assertTrue(team_canvas.save_canvas(MEMBER, self.canvas_id, doc, 2, "update")[0])
        job_store.save_editor_snapshot("member", json.dumps({
            "version": 2, "pages": [{"id": "m1", "name": "我的", "order": 0}], "groups": [], "activePageId": "m1",
            "frames": [], "texts": [],
            "images": [{"id": "mine", "pageId": "m1", "url": "/ai-images/member/g.png", "x": 0, "y": 0,
                        "width": 1, "height": 1}],
        }))

    def _page_records(self, user_id: str, page_id: str) -> dict[str, list[dict]]:
        personal = self._personal(user_id)
        return {key: [r for r in personal[key] if r["pageId"] == page_id] for key in ("frames", "images", "texts")}

    def test_member_gets_new_personal_page_with_all_layers(self) -> None:
        before = team_canvas.load_canvas(OWNER, self.canvas_id)
        result = team_canvas.copy_to_personal(MEMBER, self.canvas_id)
        page = result["page"]
        self.assertEqual(page["name"], "春季主图 副本")
        self.assertEqual(result["personal_revision"], job_store.load_editor_snapshot("member")[1])

        personal = self._personal("member")
        self.assertEqual([p["id"] for p in personal["pages"]], ["m1", page["id"]])
        self.assertEqual(personal["activePageId"], "m1")
        self.assertEqual([im["id"] for im in personal["images"] if im["pageId"] == "m1"], ["mine"])
        records = self._page_records("member", page["id"])
        self.assertEqual({key: len(value) for key, value in records.items()}, {"frames": 1, "images": 3, "texts": 1})
        self.assertEqual(records["texts"][0]["text"], "标题")

        # 图层都换了新 id，图层之间的引用指向副本里的新图层
        team_ids = {r["id"] for key in ("frames", "images", "texts") for r in before["snapshot"][key]}
        copied_ids = {r["id"] for value in records.values() for r in value}
        self.assertFalse(team_ids & copied_ids)
        frame_id = records["frames"][0]["id"]
        self.assertEqual(records["images"][0]["frameId"], frame_id)
        self.assertEqual(records["texts"][0]["frameId"], frame_id)
        self.assertEqual(records["images"][1]["meta"]["sourceImageId"], records["images"][0]["id"])

        # 复制不影响原画布，也不会把副本加入共享
        after = team_canvas.load_canvas(OWNER, self.canvas_id)
        self.assertEqual(after["snapshot"], before["snapshot"])
        self.assertEqual(after["revision"], before["revision"])
        self.assertEqual([c["id"] for c in team_canvas.list_canvases(OWNER)], [self.canvas_id])

    def test_copied_images_survive_unshare(self) -> None:
        page = team_canvas.copy_to_personal(MEMBER, self.canvas_id)["page"]
        urls = [im["url"] for im in self._page_records("member", page["id"])["images"]]
        self.assertEqual(urls, [
            "/ai-images/member/team-imports/owner/a.png",
            "/ai-images/member/g.png",
            "/ai-images/member/team-imports/owner/outpainting_example/result.png",
        ])

        team_canvas.unshare_canvas(OWNER, self.canvas_id)
        self.assertEqual(self._page_records("member", page["id"])["images"][0]["url"], urls[0])
        for url in urls:
            self.assertTrue((self.ai_root / url.removeprefix("/ai-images/")).is_file())
            path, _ = main._outpainting_internal_path(url, None, MEMBER)
            self.assertTrue(path.is_file())
        # 原图已不能访问，复制后的扩图地址属于成员自己
        with self.assertRaises(HTTPException):
            main._outpainting_internal_path("/ai-images/owner/a.png", None, MEMBER)
        self.assertEqual(main._ai_image_asset_parts(urls[2])[0], "member")

    def test_owner_copy_and_unshare_keep_both_pages_complete(self) -> None:
        page = team_canvas.copy_to_personal(OWNER, self.canvas_id)["page"]
        team_canvas.unshare_canvas(OWNER, self.canvas_id)
        personal = self._personal()
        self.assertEqual(sorted(p["name"] for p in personal["pages"]), ["春季主图", "春季主图 副本", "草稿"])
        for page_id in ("p1", page["id"]):
            records = self._page_records("owner", page_id)
            self.assertEqual({key: len(value) for key, value in records.items()}, {"frames": 1, "images": 3, "texts": 1})
        # 分享者自己的图片不需要复制，他人的图片复制到分享者目录
        urls = {im["url"] for im in self._page_records("owner", page["id"])["images"]}
        self.assertIn("/ai-images/owner/a.png", urls)
        self.assertIn("/ai-images/owner/team-imports/member/g.png", urls)

    def test_repeated_copies_get_numbered_names_and_distinct_ids(self) -> None:
        first = team_canvas.copy_to_personal(MEMBER, self.canvas_id)["page"]
        second = team_canvas.copy_to_personal(MEMBER, self.canvas_id)["page"]
        third = team_canvas.copy_to_personal(MEMBER, self.canvas_id)["page"]
        self.assertEqual([first["name"], second["name"], third["name"]],
                         ["春季主图 副本", "春季主图 副本 2", "春季主图 副本 3"])
        ids = [im["id"] for im in self._personal("member")["images"]]
        self.assertEqual(len(ids), len(set(ids)))

    def test_member_without_personal_canvas_can_copy(self) -> None:
        newcomer = {"id": "newcomer", "username": "小张"}
        page = team_canvas.copy_to_personal(newcomer, self.canvas_id)["page"]
        personal = self._personal("newcomer")
        self.assertEqual([p["id"] for p in personal["pages"]], [page["id"]])
        self.assertEqual(personal["activePageId"], page["id"])
        self.assertEqual(len(personal["images"]), 3)

    def test_copied_page_can_keep_saving_after_unshare(self) -> None:
        team_canvas.copy_to_personal(MEMBER, self.canvas_id)
        team_canvas.unshare_canvas(OWNER, self.canvas_id)
        raw, revision = job_store.load_editor_snapshot("member")
        async def body():
            return {"snapshot": raw, "base_revision": revision}
        req = Request({"type": "http", "method": "POST", "path": "/editor/snapshot",
                       "query_string": b"user_id=member", "headers": [(b"content-type", b"application/json")]})
        with patch.object(main, "_current_user", return_value=MEMBER), patch.object(req, "json", side_effect=body):
            self.assertTrue(asyncio.run(main.editor_save_snapshot(req))["saved"])

    def test_unshared_canvas_cannot_be_copied(self) -> None:
        team_canvas.unshare_canvas(OWNER, self.canvas_id)
        with self.assertRaises(HTTPException) as raised:
            team_canvas.copy_to_personal(MEMBER, self.canvas_id)
        self.assertEqual(raised.exception.status_code, 404)

    def test_copy_route_uses_current_user(self) -> None:
        request = SimpleNamespace(state=SimpleNamespace(user=MEMBER))
        result = team_canvas.api_copy(self.canvas_id, request)
        self.assertIn(result["page"]["id"], [p["id"] for p in self._personal("member")["pages"]])


class TeamCanvasMembersTest(_TeamCanvasBase):
    """指定成员的画布只有分享者、成员和管理员能看到，图片权限跟随成员名单。"""

    OUTSIDER = {"id": "outsider", "username": "小张"}
    ADMIN = {"id": "admin", "username": "admin", "role": "admin"}
    OTHER_ADMIN = {"id": "boss", "username": "另一位管理员", "role": "admin"}
    IMAGE = "/ai-images/owner/a.png"

    def setUp(self) -> None:
        super().setUp()
        users = patch.object(team_canvas.settings, "allowed_login_users", [
            {"id": "owner", "username": "小王"},
            {"id": "member", "username": "小李"},
            {"id": "outsider", "username": "小张", "display_name": "张三"},
            {"id": "tester", "username": "测试", "is_test": True},
        ])
        users.start()
        self.addCleanup(users.stop)
        self.canvas_id = team_canvas.share_page(OWNER, "p1", ["member", "owner"])["canvas"]["id"]

    def _assert_hidden(self, user: dict, call) -> None:
        with self.assertRaises(HTTPException) as raised:
            call(user, self.canvas_id)
        self.assertEqual(raised.exception.status_code, 404)

    def test_owner_is_dropped_from_member_list(self) -> None:
        self.assertEqual(team_canvas.load_canvas(OWNER, self.canvas_id)["canvas"]["member_ids"], ["member"])

    def test_list_only_returns_canvases_the_user_can_access(self) -> None:
        for user, visible in ((OWNER, True), (MEMBER, True), (self.ADMIN, True), (self.OUTSIDER, False)):
            with self.subTest(user=user["id"]):
                self.assertEqual(bool(team_canvas.list_canvases(user)), visible)

    def test_other_admin_accounts_follow_member_list(self) -> None:
        self.assertEqual(team_canvas.list_canvases(self.OTHER_ADMIN), [])
        self._assert_hidden(self.OTHER_ADMIN, team_canvas.load_canvas)
        self._assert_hidden(self.OTHER_ADMIN, team_canvas.unshare_canvas)
        self.assertFalse(team_canvas.is_shared_canvas_asset(self.IMAGE, self.OTHER_ADMIN))
        with self.assertRaises(HTTPException) as raised:
            team_canvas.set_members(self.OTHER_ADMIN, self.canvas_id, ["outsider"])
        self.assertEqual(raised.exception.status_code, 404)

    def test_outsider_cannot_reach_any_canvas_operation(self) -> None:
        for call in (team_canvas.load_canvas, team_canvas.heartbeat, team_canvas.list_activity,
                     team_canvas.list_versions, team_canvas.copy_to_personal, team_canvas.unshare_canvas):
            with self.subTest(call=call.__name__):
                self._assert_hidden(self.OUTSIDER, call)
        with self.assertRaises(HTTPException) as raised:
            team_canvas.save_canvas(self.OUTSIDER, self.canvas_id, {}, 1, "update")
        self.assertEqual(raised.exception.status_code, 404)
        with self.assertRaises(HTTPException) as raised:
            team_canvas.restore_version(self.OUTSIDER, self.canvas_id, 1)
        self.assertEqual(raised.exception.status_code, 404)

    def test_member_can_edit_but_not_manage(self) -> None:
        doc = team_canvas.load_canvas(MEMBER, self.canvas_id)["snapshot"]
        self.assertTrue(team_canvas.save_canvas(MEMBER, self.canvas_id, doc, 1, "update")[0])
        with self.assertRaises(HTTPException) as raised:
            team_canvas.set_members(MEMBER, self.canvas_id, ["outsider"])
        self.assertEqual(raised.exception.status_code, 403)

    def test_image_access_follows_member_list(self) -> None:
        self.assertTrue(team_canvas.is_shared_canvas_asset(self.IMAGE, MEMBER))
        self.assertTrue(team_canvas.is_shared_canvas_asset(self.IMAGE, self.ADMIN))
        self.assertFalse(team_canvas.is_shared_canvas_asset(self.IMAGE, self.OUTSIDER))
        with self.assertRaises(HTTPException):
            main._assert_strict_asset_owner("owner", self.OUTSIDER, self.IMAGE)

        team_canvas.set_members(OWNER, self.canvas_id, ["outsider"])
        self.assertTrue(team_canvas.is_shared_canvas_asset(self.IMAGE, self.OUTSIDER))
        self.assertFalse(team_canvas.is_shared_canvas_asset(self.IMAGE, MEMBER))

        team_canvas.set_members(OWNER, self.canvas_id, None)
        self.assertTrue(team_canvas.is_shared_canvas_asset(self.IMAGE, MEMBER))

    def test_image_in_team_and_member_canvas_is_visible_to_everyone(self) -> None:
        other = team_canvas.share_page(OWNER, "p2")["canvas"]["id"]
        doc = team_canvas.load_canvas(OWNER, other)["snapshot"]
        doc["images"][0]["url"] = self.IMAGE
        self.assertTrue(team_canvas.save_canvas(OWNER, other, doc, 1, "update")[0])
        team_canvas._invalidate_asset_index()
        self.assertTrue(team_canvas.is_shared_canvas_asset(self.IMAGE, self.OUTSIDER))

    def test_restricted_image_cannot_be_pulled_into_another_canvas(self) -> None:
        other = team_canvas.share_page(OWNER, "p2")["canvas"]["id"]
        doc = team_canvas.load_canvas(self.OUTSIDER, other)["snapshot"]
        doc["images"].append({"id": "x", "pageId": "p2", "url": self.IMAGE, "x": 0, "y": 0, "width": 1, "height": 1})
        saved, _revision, reason = team_canvas.save_canvas(self.OUTSIDER, other, doc, 1, "update")
        self.assertFalse(saved)
        self.assertEqual(reason, "foreign_asset_rejected")

    def test_removed_member_loses_access_and_admin_can_manage(self) -> None:
        canvas = team_canvas.set_members(self.ADMIN, self.canvas_id, ["outsider"])["canvas"]
        self.assertEqual(canvas["member_ids"], ["outsider"])
        self._assert_hidden(MEMBER, team_canvas.heartbeat)
        self.assertEqual(team_canvas.list_activity(OWNER, self.canvas_id)[0]["action"], "members")

    def test_invalid_member_lists_are_rejected(self) -> None:
        for member_ids in ([], ["owner"], ["nobody"], "member"):
            with self.subTest(member_ids=member_ids), self.assertRaises(HTTPException) as raised:
                team_canvas.set_members(OWNER, self.canvas_id, member_ids)
            self.assertEqual(raised.exception.status_code, 400)
        with self.assertRaises(HTTPException):
            team_canvas.share_page(OWNER, "p2", [])
        self.assertIn("p2", [p["id"] for p in self._personal()["pages"]])

    def test_share_targets_exclude_test_accounts(self) -> None:
        names = {t["id"]: t["name"] for t in team_canvas.list_share_targets()}
        self.assertEqual(names, {"owner": "小王", "member": "小李", "outsider": "张三"})

    def test_existing_canvas_table_is_migrated_as_team_wide(self) -> None:
        with job_store._connect() as conn:
            conn.execute("ALTER TABLE team_canvases DROP COLUMN member_ids")
            conn.commit()
        team_canvas.init_team_canvas_tables()
        team_canvas._invalidate_asset_index()
        self.assertEqual(team_canvas.load_canvas(self.OUTSIDER, self.canvas_id)["canvas"]["member_ids"], None)


if __name__ == "__main__":
    unittest.main()

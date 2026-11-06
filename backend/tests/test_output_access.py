from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from PIL import Image

from backend import job_store, main, team_canvas
from backend.models import ComposeJob, ComposeRequest, ComposeStatus, SpecialComposeJob, SpecialComposeRequest

OWNER = {"id": "owner", "username": "小王", "role": "user"}
MEMBER = {"id": "member", "username": "小李", "role": "user"}
OUTSIDER = {"id": "outsider", "username": "小张", "role": "user"}
ADMIN = {"id": "admin", "username": "admin", "role": "admin"}
OTHER_ADMIN = {"id": "boss", "username": "另一位管理员", "role": "admin"}
USERS = {user["id"]: user for user in (OWNER, MEMBER, OUTSIDER, ADMIN, OTHER_ADMIN)}

JOB = "job-owner"
SPECIAL = "special-owner"
RESULT = f"/results/{SPECIAL}/frame_0.png"
ROOT_FILE = f"/output/{JOB}.png"
GRID_FILE = f"/output/{JOB}_grid_00.png"
UPLOAD = "/output/agent2-uploads/owner/session/a.png"
OWNED_ACCESS = ((OWNER, 200), (ADMIN, 200), (OUTSIDER, 404), (OTHER_ADMIN, 404), (None, 401))


class OutputAccessTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        self.output = root / "output"
        for rel in (f"results/{SPECIAL}/frame_0.png", f"{JOB}.png", f"{JOB}_grid_00.png",
                    "agent2-uploads/owner/session/a.png", "agent2-uploads/outsider/session/mine.png",
                    "proxy-downloads/old.png", "psd/owner/a.png", "thumbnails/t.png", "stray.png",
                    "results/orphan/frame_0.png", "ai-images/flat.png"):
            self.write_file(rel)
        for rel in (".task-locks/lock", "editor-snapshot-rejected/owner-1.json"):
            path = self.output / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("{}", encoding="utf-8")
        mounts = {route.name: route.app for route in main.app.routes if getattr(route, "name", "") in ("results", "output", "ai-images")}
        for patcher in (
            patch.object(job_store, "_DB_PATH", root / "jobs.db"),
            patch.object(main.settings, "output_path", self.output),
            patch.object(main, "_jobs", {}),
            patch.object(team_canvas.settings, "allowed_login_users", list(USERS.values())),
            patch.object(mounts["results"], "all_directories", [str(self.output / "results")]),
            patch.object(mounts["output"], "all_directories", [str(self.output)]),
            patch.object(mounts["ai-images"], "all_directories", [str(self.output / "ai-images")]),
            patch.object(main, "_get_session_user", side_effect=lambda request: USERS.get(
                request.cookies.get("designflow_session"))),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        job_store.init_db()
        team_canvas.init_team_canvas_tables()
        team_canvas._invalidate_asset_index()
        self.addCleanup(team_canvas._invalidate_asset_index)
        job_store.save_job(ComposeJob(
            id=JOB, user_id="owner", status=ComposeStatus.done,
            request=ComposeRequest(template_frame_id="t", page_id="p", file_id="f"),
            result_path=str(self.output / f"{JOB}.png"),
        ))
        job_store.save_special_job(SpecialComposeJob(
            id=SPECIAL, user_id="owner", status=ComposeStatus.done,
            request=SpecialComposeRequest(file_id="f", page_id="p", frame_ids=[], sku="SKU"),
        ))

    def write_file(self, rel: str) -> None:
        path = self.output / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (4, 4), "red").save(path, format="PNG")

    def client(self, user: dict | None) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://designflow.test",
            cookies={"designflow_session": user["id"]} if user else {},
        )

    async def status(self, user: dict | None, url: str) -> int:
        async with self.client(user) as client:
            return (await client.get(url)).status_code

    def share_with_member(self, *urls: str) -> str:
        job_store.save_editor_snapshot("owner", json.dumps({
            "version": 2,
            "pages": [{"id": "p1", "name": "主图", "order": 0}, {"id": "p2", "name": "草稿", "order": 1}],
            "groups": [], "activePageId": "p1", "frames": [], "texts": [],
            "images": [{"id": f"i{index}", "pageId": "p1", "url": url, "x": 0, "y": 0, "width": 4, "height": 4}
                       for index, url in enumerate(urls)],
        }))
        return team_canvas.share_page(OWNER, "p1", ["member"])["canvas"]["id"]

    async def test_job_files_and_user_directories_follow_owner(self) -> None:
        for url in (RESULT, f"/output/results/{SPECIAL}/frame_0.png", ROOT_FILE, GRID_FILE, UPLOAD, "/output/psd/owner/a.png"):
            for user, expected in OWNED_ACCESS:
                with self.subTest(url=url, user=user and user["id"]):
                    self.assertEqual(await self.status(user, url), expected)
        self.assertEqual(await self.status(OUTSIDER, "/output/agent2-uploads/outsider/session/mine.png"), 200)

    async def test_files_without_owner_are_only_readable_by_admin_account(self) -> None:
        for url in ("/output/.task-locks/lock", "/output/editor-snapshot-rejected/owner-1.json",
                    "/output/thumbnails/t.png", "/output/stray.png", "/output/proxy-downloads/old.png",
                    "/results/orphan/frame_0.png"):
            for user, expected in ((OWNER, 404), (OUTSIDER, 404), (OTHER_ADMIN, 404), (ADMIN, 200)):
                with self.subTest(url=url, user=user["id"]):
                    self.assertEqual(await self.status(user, url), expected)

    async def test_alias_paths_cannot_reach_another_users_file(self) -> None:
        for url in (
            f"/output/./results/{SPECIAL}/frame_0.png",
            f"/output/x/%2e%2e/results/{SPECIAL}/frame_0.png",
            f"/output/RESULTS/{SPECIAL}/frame_0.png",
            f"/output/results./{SPECIAL}/frame_0.png",
            f"/results/{SPECIAL.upper()}/frame_0.png",
            f"/results/orphan/%2e%2e/{SPECIAL}/frame_0.png",
            f"/results/{SPECIAL}%3F/%2e%2e/{SPECIAL}/frame_0.png",
            f"/output/{JOB.upper()}.png",
            f"/output/{JOB}.PNG",
            "/output/agent2-uploads/outsider/%2e%2e/owner/session/a.png",
            "/output/agent2-uploads/outsider%3F/%2e%2e/%2e%2e/owner/session/a.png",
            "/output/agent2-uploads/OWNER/session/a.png",
            "/output/AGENT2-UPLOADS/owner/session/a.png",
            "/output/.TASK-LOCKS/lock",
        ):
            with self.subTest(url=url):
                self.assertEqual(await self.status(OUTSIDER, url), 404)

    async def test_proxy_download_is_stored_per_user(self) -> None:
        source = self.output / "proxy-downloads" / "fresh.png"
        Image.new("RGB", (4, 4), "red").save(source, format="PNG")
        target, url = main._store_proxy_download(source, "花瓣 图.png", "owner")
        self.assertFalse(source.exists())
        self.assertEqual(target.parent, self.output / "proxy-downloads" / "owner")
        for user, expected in OWNED_ACCESS:
            with self.subTest(user=user and user["id"]):
                self.assertEqual(await self.status(user, url), expected)

    async def test_canvas_file_follows_member_list(self) -> None:
        canvas_id = self.share_with_member(RESULT)
        for url in (RESULT, f"/output/results/{SPECIAL}/frame_0.png"):
            with self.subTest(url=url):
                self.assertEqual(await self.status(MEMBER, url), 200)
                self.assertEqual(await self.status(OUTSIDER, url), 404)
        team_canvas.unshare_canvas(OWNER, canvas_id)
        self.assertEqual(await self.status(MEMBER, RESULT), 404)

    async def test_canvas_member_can_open_every_kind_of_image_on_the_canvas(self) -> None:
        self.write_file("proxy-downloads/owner/a.png")
        urls = (RESULT, ROOT_FILE, UPLOAD, "/output/proxy-downloads/owner/a.png", "/output/psd/owner/a.png",
                f"/compose/{JOB}/image", f"/export/grid/{JOB}/00")
        canvas_id = self.share_with_member(*urls)
        for url in (*urls, f"/export/grid/{JOB}/0"):
            with self.subTest(url=url):
                self.assertEqual(await self.status(MEMBER, url), 200)
                self.assertIn(await self.status(OUTSIDER, url), (403, 404))
                async with self.client(MEMBER) as client:
                    link = await client.post("/image-copy/link", json={"src": url})
                self.assertEqual(link.status_code, 200, link.text)
                self.assertEqual(await self.status(None, link.json()["url"]), 200)
        team_canvas.unshare_canvas(OWNER, canvas_id)
        for url in urls:
            with self.subTest(url=url, unshared=True):
                self.assertIn(await self.status(MEMBER, url), (403, 404))

    async def save_personal(self, user: dict, urls: tuple[str, ...]) -> httpx.Response:
        doc = {"version": 2, "pages": [{"id": "m1", "name": "我的"}], "activePageId": "m1", "frames": [], "texts": [],
               "groups": [], "images": [{"id": f"c{index}", "pageId": "m1", "url": url, "x": 0, "y": 0, "width": 4, "height": 4}
                                        for index, url in enumerate(urls)]}
        async with self.client(user) as client:
            return await client.post(f"/editor/snapshot?user_id={user['id']}", json={"snapshot": doc})

    async def test_foreign_file_saved_to_personal_canvas_survives_unshare_and_can_be_reshared(self) -> None:
        urls = (RESULT, ROOT_FILE, UPLOAD, f"/compose/{JOB}/image", f"/export/grid/{JOB}/00")
        canvas_id = self.share_with_member(*urls)
        response = await self.save_personal(MEMBER, urls)
        self.assertEqual(response.status_code, 200, response.text)
        rewritten = response.json()["rewritten_urls"]
        self.assertEqual(set(rewritten), set(urls))
        for copied in rewritten.values():
            self.assertTrue(copied.startswith("/ai-images/member/team-imports/"), copied)
        raw, _ = job_store.load_editor_snapshot("member")
        self.assertEqual({im["url"] for im in team_canvas._personal_v2(raw)["images"]}, set(rewritten.values()))

        team_canvas.unshare_canvas(OWNER, canvas_id)
        self.assertEqual(await self.status(MEMBER, RESULT), 404)
        for copied in rewritten.values():
            with self.subTest(copied=copied):
                self.assertEqual(await self.status(MEMBER, copied), 200)
                self.assertEqual(await self.status(OUTSIDER, copied), 404)
        self.assertTrue(team_canvas.share_page(MEMBER, "m1", ["outsider"])["canvas"]["id"])
        for copied in rewritten.values():
            with self.subTest(copied=copied, reshared=True):
                self.assertEqual(await self.status(OUTSIDER, copied), 200)

    async def test_personal_canvas_rejects_foreign_file_that_is_not_shared(self) -> None:
        for url in (RESULT, f"/output/results/{SPECIAL}/frame_0.png", ROOT_FILE, UPLOAD, f"/compose/{JOB}/image", f"/export/grid/{JOB}/00"):
            with self.subTest(url=url):
                self.assertEqual((await self.save_personal(OUTSIDER, (url,))).status_code, 409)
        response = await self.save_personal(OWNER, (RESULT, ROOT_FILE, UPLOAD))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json().get("rewritten_urls", {}), {})

    async def test_unsharing_and_copying_canvas_keep_other_members_files(self) -> None:
        canvas_id = self.share_with_member("/ai-images/flat.png")
        doc = team_canvas.load_canvas(MEMBER, canvas_id)["snapshot"]
        doc["images"].append({**doc["images"][0], "id": "m1", "url": "/output/agent2-uploads/member/s/m.png"})
        self.write_file("agent2-uploads/member/s/m.png")
        self.assertTrue(team_canvas.save_canvas(MEMBER, canvas_id, doc, 1, "update")[0])
        copied = "/ai-images/outsider/team-imports/agent2-uploads/member/s/m.png"
        self.assertEqual(team_canvas.copy_asset_to_user("/output/agent2-uploads/member/s/m.png", "outsider"), copied)
        self.assertEqual(team_canvas.copy_asset_to_user(UPLOAD, "owner"), None)
        team_canvas.unshare_canvas(OWNER, canvas_id)
        raw, _ = job_store.load_editor_snapshot("owner")
        urls = {im["url"] for im in team_canvas._personal_v2(raw)["images"]}
        self.assertIn("/ai-images/owner/team-imports/agent2-uploads/member/s/m.png", urls)
        self.assertEqual(await self.status(OWNER, "/output/agent2-uploads/member/s/m.png"), 404)

    async def test_output_alias_of_ai_image_is_treated_as_the_same_file(self) -> None:
        self.write_file("ai-images/owner/d/a.png")
        canonical, alias = "/ai-images/owner/d/a.png", "/output/ai-images/owner/d/a.png"
        copied = "/ai-images/member/team-imports/owner/d/a.png"
        self.assertTrue(team_canvas.is_foreign_asset(alias, "member"))
        self.assertFalse(team_canvas.is_foreign_asset(alias, "owner"))
        self.assertEqual((await self.save_personal(OUTSIDER, (alias,))).status_code, 409)

        canvas_id = self.share_with_member(alias)
        for url in (canonical, alias):
            with self.subTest(url=url):
                self.assertEqual(await self.status(MEMBER, url), 200)
                self.assertEqual(await self.status(OUTSIDER, url), 404)

        for url in (canonical, alias):
            with self.subTest(url=url, saved=True):
                response = await self.save_personal(MEMBER, (url,))
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["rewritten_urls"], {url: copied})

        doc = team_canvas.load_canvas(MEMBER, canvas_id)["snapshot"]
        doc["images"].append({**doc["images"][0], "id": "i2", "url": canonical})
        self.assertTrue(team_canvas.save_canvas(MEMBER, canvas_id, doc, 1, "update")[0])

        job_store.save_editor_snapshot("member", json.dumps({
            "version": 2, "pages": [{"id": "m1", "name": "我的", "order": 0}], "groups": [],
            "activePageId": "m1", "frames": [], "texts": [], "images": [],
        }))
        team_canvas.copy_to_personal(MEMBER, canvas_id)
        raw, _ = job_store.load_editor_snapshot("member")
        self.assertEqual({im["url"] for im in team_canvas._personal_v2(raw)["images"]}, {copied})

        team_canvas.unshare_canvas(OWNER, canvas_id)
        self.assertEqual(await self.status(MEMBER, alias), 404)
        self.assertEqual(await self.status(MEMBER, copied), 200)

    async def test_saving_foreign_file_into_canvas_does_not_grant_access(self) -> None:
        canvas_id = self.share_with_member("/ai-images/flat.png")
        doc = team_canvas.load_canvas(MEMBER, canvas_id)["snapshot"]
        revision = 1
        for url in (RESULT, f"/output/results/{SPECIAL}/frame_0.png", f"/results/orphan/../{SPECIAL}/frame_0.png",
                    f"https://evil.test{RESULT}", "/output/ai-images/owner/d/a.png", ROOT_FILE, UPLOAD, "/output/.task-locks/lock",
                    f"/compose/{JOB}/image", f"/export/grid/{JOB}/00"):
            with self.subTest(url=url):
                doc["images"][0]["url"] = url
                self.assertEqual(team_canvas.save_canvas(MEMBER, canvas_id, doc, revision, "update")[2], "foreign_asset_rejected")
        self.assertEqual(await self.status(MEMBER, RESULT), 404)
        doc["images"].append({**doc["images"][0], "id": "i2", "url": RESULT})
        self.assertTrue(team_canvas.save_canvas(OWNER, canvas_id, doc, revision, "update")[0])
        self.assertEqual(await self.status(MEMBER, RESULT), 200)

    async def test_sharing_page_with_foreign_file_does_not_grant_access(self) -> None:
        job_store.save_editor_snapshot("outsider", json.dumps({
            "version": 2,
            "pages": [{"id": "p1", "name": "主图", "order": 0}, {"id": "p2", "name": "草稿", "order": 1}],
            "groups": [], "activePageId": "p1", "frames": [], "texts": [],
            "images": [{"id": "i1", "pageId": "p1", "url": RESULT, "x": 0, "y": 0, "width": 4, "height": 4}],
        }))
        with self.assertRaises(main.HTTPException) as raised:
            team_canvas.share_page(OUTSIDER, "p1", ["member"])
        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(await self.status(OUTSIDER, RESULT), 404)

    async def test_server_side_endpoints_respect_the_same_rule(self) -> None:
        async with self.client(OUTSIDER) as client:
            for src in (RESULT, f"/output/results/{SPECIAL}/frame_0.png", ROOT_FILE, UPLOAD, f"/export/grid/{JOB}/0"):
                with self.subTest(src=src):
                    response = await client.post("/image-copy/link", json={"src": src})
                    self.assertIn(response.status_code, (403, 404))
        for raw in (RESULT, UPLOAD, "/output/thumbnails/t.png"):
            with self.subTest(raw=raw), self.assertRaises(main.HTTPException) as raised:
                main._resolve_public_asset_path(raw, OUTSIDER)
            self.assertEqual(raised.exception.status_code, 404)
        self.assertTrue(main._resolve_public_asset_path(RESULT, OWNER).is_file())
        self.assertTrue(main._resolve_public_asset_path(UPLOAD).is_file())

    async def test_download_routes_check_job_owner(self) -> None:
        main._jobs[JOB] = job_store.load_job(JOB)
        for method, url, body in (
            ("GET", f"/special-compose/{SPECIAL}/download-zip", None),
            ("GET", f"/export/grid/{JOB}/0", None),
            ("POST", "/export/grid", {"job_id": JOB, "rows": 1, "cols": 1}),
        ):
            for user, expected in ((OWNER, 200), (ADMIN, 200), (OUTSIDER, 403)):
                with self.subTest(url=url, user=user["id"]):
                    async with self.client(user) as client:
                        response = await client.request(method, url, json=body)
                    self.assertEqual(response.status_code, expected, response.text if response.is_error else "")


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from PIL import Image

from backend import job_store, main, team_canvas

OWNER = {"id": "owner", "username": "小王", "role": "user"}
MEMBER = {"id": "member", "username": "小李", "role": "user"}
OUTSIDER = {"id": "outsider", "username": "小张", "role": "user"}
ADMIN = {"id": "admin", "username": "admin", "role": "admin"}
OTHER_ADMIN = {"id": "boss", "username": "另一位管理员", "role": "admin"}
USERS = {user["id"]: user for user in (OWNER, MEMBER, OUTSIDER, ADMIN, OTHER_ADMIN)}

IMAGE = "/ai-images/owner/2026-01-01/a.png"
PRIVATE = "/ai-images/owner/2026-01-01/private.png"


class AiImageAccessTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        output = root / "output"
        for rel in ("owner/2026-01-01/a.png", "owner/2026-01-01/private.png", "owner/2026-01-01/b.png",
                    "owner/thumbs/t.webp", "flat.png"):
            path = output / "ai-images" / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            Image.new("RGB", (4, 4), "red").save(path, format="WEBP" if rel.endswith(".webp") else "PNG")
        mounts = {route.name: route.app for route in main.app.routes if getattr(route, "name", "") in ("ai-images", "output")}
        for patcher in (
            patch.object(job_store, "_DB_PATH", root / "jobs.db"),
            patch.object(main.settings, "output_path", output),
            patch.object(team_canvas.settings, "allowed_login_users", list(USERS.values())),
            patch.object(mounts["ai-images"], "all_directories", [str(output / "ai-images")]),
            patch.object(mounts["output"], "all_directories", [str(output)]),
            patch.object(main, "_get_session_user", side_effect=lambda request: USERS.get(
                request.cookies.get("designflow_session"))),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        job_store.init_db()
        team_canvas.init_team_canvas_tables()
        team_canvas._invalidate_asset_index()
        self.addCleanup(team_canvas._invalidate_asset_index)
        job_store.save_editor_snapshot("owner", json.dumps({
            "version": 2,
            "pages": [{"id": "p1", "name": "主图", "order": 0}, {"id": "p2", "name": "草稿", "order": 1}],
            "groups": [], "activePageId": "p1", "frames": [],
            "images": [
                {"id": "i1", "pageId": "p1", "url": IMAGE, "x": 0, "y": 0, "width": 4, "height": 4},
                {"id": "i2", "pageId": "p1", "url": "/ai-images/owner/2026-01-01/b.png", "x": 9, "y": 0, "width": 4, "height": 4},
            ],
            "texts": [],
        }))
        self.canvas_id = team_canvas.share_page(OWNER, "p1", ["member"])["canvas"]["id"]

    async def status(self, user: dict | None, url: str) -> int:
        cookies = {"designflow_session": user["id"]} if user else {}
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://designflow.test", cookies=cookies,
        ) as client:
            return (await client.get(url)).status_code

    async def test_private_image_is_only_readable_by_owner_and_admin_account(self) -> None:
        for user, expected in ((OWNER, 200), (ADMIN, 200), (MEMBER, 404), (OUTSIDER, 404), (OTHER_ADMIN, 404), (None, 401)):
            with self.subTest(user=user and user["id"]):
                self.assertEqual(await self.status(user, PRIVATE), expected)

    async def test_alias_paths_cannot_reach_another_users_image(self) -> None:
        for url in (
            "/output/ai-images/owner/2026-01-01/private.png",
            "/output/./ai-images/owner/2026-01-01/private.png",
            "/ai-images/outsider/%2e%2e/owner/2026-01-01/private.png",
            "/output/ai-images/outsider/%2e%2e/owner/2026-01-01/private.png",
            "/output/x/%2e%2e/ai-images/owner/2026-01-01/private.png",
            "/ai-images/outsider%3F/%2e%2e/%2e%2e/owner/2026-01-01/private.png",
        ):
            with self.subTest(url=url):
                self.assertEqual(await self.status(OUTSIDER, url), 404)
        self.assertEqual(await self.status(OWNER, "/output/ai-images/owner/2026-01-01/private.png"), 200)

    def test_path_normalization_covers_platform_aliases(self) -> None:
        for path in ("/output/AI-Images/owner/a.png", "/ai-images\\owner\\a.png", "/output/ai-images./owner/a.png"):
            with self.subTest(path=path):
                self.assertEqual(main._ai_image_asset_parts(path), ["owner", "a.png"])
        self.assertIsNone(main._ai_image_asset_parts("/ai-image/outpainting/config"))
        self.assertIsNone(main._ai_image_asset_parts("/output/results/a.png"))
        self.assertFalse(main._can_read_ai_image(["OWNER.", "a.png"], OUTSIDER))
        self.assertTrue(main._can_read_ai_image(["OWNER.", "a.png"], OWNER))

    async def test_canvas_image_follows_member_list(self) -> None:
        self.assertEqual(await self.status(MEMBER, IMAGE), 200)
        self.assertEqual(await self.status(OUTSIDER, IMAGE), 404)
        self.assertEqual(await self.status(OTHER_ADMIN, IMAGE), 404)
        team_canvas.set_members(OWNER, self.canvas_id, ["outsider"])
        self.assertEqual(await self.status(MEMBER, IMAGE), 404)
        self.assertEqual(await self.status(OUTSIDER, IMAGE), 200)
        team_canvas.unshare_canvas(OWNER, self.canvas_id)
        self.assertEqual(await self.status(OUTSIDER, IMAGE), 404)

    async def test_deleted_canvas_image_stays_visible_in_activity_but_not_reusable(self) -> None:
        deleted = "/ai-images/owner/2026-01-01/b.png"
        doc = team_canvas.load_canvas(OWNER, self.canvas_id)["snapshot"]
        doc["images"] = [im for im in doc["images"] if im["url"] != deleted]
        self.assertTrue(team_canvas.save_canvas(OWNER, self.canvas_id, doc, 1, "user_delete")[0])
        self.assertEqual(await self.status(MEMBER, deleted), 200)
        self.assertEqual(await self.status(OUTSIDER, deleted), 404)
        self.assertFalse(team_canvas.is_shared_canvas_asset(deleted, MEMBER))

    async def test_inspiration_image_is_visible_to_everyone_until_unpublished(self) -> None:
        thumb = "/ai-images/owner/thumbs/t.webp"
        with job_store._connect() as conn:
            conn.execute(
                "INSERT INTO inspiration_posts (id, job_id, user_id, image_url, thumb_url, prompt, model, size, created_at) "
                "VALUES ('post', 'job', 'owner', ?, ?, 'p', 'm', '1:1', 0)",
                (PRIVATE, thumb),
            )
            conn.commit()
        self.assertEqual(await self.status(OUTSIDER, PRIVATE), 200)
        self.assertEqual(await self.status(OUTSIDER, thumb), 200)
        job_store.delete_inspiration_post("post")
        self.assertEqual(await self.status(OUTSIDER, PRIVATE), 404)

    async def test_legacy_flat_file_without_owner_stays_readable(self) -> None:
        self.assertEqual(await self.status(OUTSIDER, "/ai-images/flat.png"), 200)

    async def test_server_side_endpoints_respect_the_same_rule(self) -> None:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://designflow.test",
            cookies={"designflow_session": "outsider"},
        ) as client:
            for src in (PRIVATE, "/output/ai-images/owner/2026-01-01/private.png"):
                with self.subTest(src=src):
                    response = await client.post("/image-copy/link", json={"src": src})
                    self.assertEqual(response.status_code, 404)
        with self.assertRaises(main.HTTPException) as raised:
            main._resolve_public_asset_path("/output/ai-images/owner/2026-01-01/private.png", OUTSIDER)
        self.assertEqual(raised.exception.status_code, 404)
        self.assertTrue(main._resolve_public_asset_path(PRIVATE, OWNER).is_file())
        self.assertTrue(main._resolve_public_asset_path(PRIVATE).is_file())


if __name__ == "__main__":
    unittest.main()

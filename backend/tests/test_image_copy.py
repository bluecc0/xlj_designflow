from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import quote

import httpx
from PIL import Image

from backend import job_store, main


class ImageCopyTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.output = self.root / "output"
        self.image = self.output / "results" / "job-a" / "原图 空格#%.png"
        self.image.parent.mkdir(parents=True)
        Image.new("RGB", (40, 52), "red").save(self.image)
        self.src = "/results/job-a/" + quote(self.image.name)
        for patcher in (
            patch.object(job_store, "_DB_PATH", self.root / "jobs.db"),
            patch.object(main.settings, "output_path", self.output),
            patch.object(main, "_get_session_user", side_effect=lambda request: (
                {"id": "operator_a", "role": "user"}
                if request.cookies.get("designflow_session") == "test-session" else None
            )),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        job_store.init_db()

    def client(self, logged_in=False):
        return httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://designflow.test",
            cookies={"designflow_session": "test-session"} if logged_in else {},
        )

    async def issue(self, client, src=None):
        response = await client.post("/image-copy/link", json={"src": src or self.src})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["url"]

    async def test_anonymous_can_read_exact_original_but_cannot_issue_links(self):
        async with self.client() as anonymous, self.client(True) as logged_in:
            self.assertEqual((await anonymous.get(self.src)).status_code, 401)
            self.assertEqual((await anonymous.post("/image-copy/link", json={"src": self.src})).status_code, 401)
            url = await self.issue(logged_in)
            response = await anonymous.get(url)
            self.assertEqual(response.status_code, 200)
            self.assertTrue(url.startswith('/image-copy/original.png?token='))
            self.assertEqual(response.content, self.image.read_bytes())
            self.assertEqual(response.headers["content-type"], "image/png")
            self.assertTrue(response.headers["content-disposition"].startswith("inline;"))
            self.assertEqual(response.headers["cache-control"], "no-store")
            head = await anonymous.head(url)
            self.assertEqual(head.status_code, 200)
            self.assertEqual(int(head.headers["content-length"]), len(response.content))
            # A caller cannot switch the granted image with an extra parameter.
            self.assertEqual((await anonymous.get(url + "&src=/output/other.png")).content, response.content)
            self.assertEqual((await anonymous.get(self.src)).status_code, 401)

    async def test_invalid_tampered_and_expired_tokens_are_denied(self):
        async with self.client(True) as logged_in, self.client() as anonymous:
            url = await self.issue(logged_in)
            token = url.split("token=", 1)[1]
            for invalid in ("", "forged", "a" * 43, token[:-1] + ("a" if token[-1] != "a" else "b")):
                self.assertEqual((await anonymous.get("/image-copy/original.png", params={"token": invalid})).status_code, 404)
            self.assertEqual((await anonymous.get(url.replace('original.png', 'original.jpg'))).status_code, 404)
            with job_store._connect() as conn:
                row = conn.execute("SELECT * FROM image_copy_links").fetchone()
                self.assertNotEqual(row["token_hash"], token)
                self.assertEqual(row["asset_url"], "/results/job-a/" + self.image.name)
                conn.execute("UPDATE image_copy_links SET expires_at = 0")
            self.assertEqual((await anonymous.get(url)).status_code, 404)
            await self.issue(logged_in)
            with job_store._connect() as conn:
                self.assertEqual(conn.execute("SELECT COUNT(*) FROM image_copy_links").fetchone()[0], 1)

    async def test_external_unsafe_non_image_and_missing_sources_are_denied(self):
        non_image = self.output / "results" / "job-a" / "not-image.html"
        non_image.write_text("<html>private content</html>")
        Image.new("RGB", (5, 5)).save(self.root / "outside.png")
        async with self.client(True) as client:
            for src, status in (
                ("http://external.test" + self.src, 400),
                ("//external.test" + self.src, 400),
                ("http://user:password@designflow.test" + self.src, 400),
                ("file:///results/job-a/a.png", 400),
                ("/output/%2e%2e/outside.png", 400),
                ("/output/%5coutside.png", 400),
                ("/output/%00.png", 400),
                ("/results/job-a/not-image.html", 400),
                ("/results/job-a/missing.png", 404),
                ("/auth/options", 400),
            ):
                with self.subTest(src=src):
                    response = await client.post("/image-copy/link", json={"src": src})
                    self.assertEqual(response.status_code, status, response.text)
            await self.issue(client, "http://designflow.test" + self.src)

    async def test_cannot_grant_another_users_compose_or_outpainting_image(self):
        other = self.output / "ai-images" / "operator_b" / "day" / "outpainting_job.png"
        other.parent.mkdir(parents=True)
        Image.new("RGB", (5, 5)).save(other)
        async with self.client(True) as client:
            for src in (
                "/ai-images/operator_b/day/outpainting_job.png",
                "/output/ai-images/operator_b/day/outpainting_job.png",
                "/ai-images/operator_a/../operator_b/day/outpainting_job.png",
            ):
                self.assertEqual((await client.post("/image-copy/link", json={"src": src})).status_code, 404)
            with patch.object(main, "load_job", return_value=SimpleNamespace(user_id="operator_b")):
                response = await client.post("/image-copy/link", json={"src": "/compose/foreign/image"})
                self.assertEqual(response.status_code, 403)

    async def test_original_is_revalidated_on_read(self):
        async with self.client(True) as client:
            url = await self.issue(client)
        async with self.client() as anonymous:
            self.image.write_text("<script>replaced file</script>")
            self.assertEqual((await anonymous.get(url)).status_code, 400)
            self.image.unlink()
            self.assertEqual((await anonymous.get(url)).status_code, 404)

    async def test_jpeg_preserves_bytes_mime_and_url_extension(self):
        jpg = self.image.with_suffix('.jpg')
        Image.new('RGB', (40, 52), 'blue').save(jpg)
        async with self.client(True) as client:
            url = await self.issue(client, '/results/job-a/' + quote(jpg.name))
        async with self.client() as anonymous:
            response = await anonymous.get(url)
            self.assertEqual(response.status_code, 200)
            self.assertTrue(url.startswith('/image-copy/original.jpg?token='))
            self.assertEqual(response.headers['content-type'], 'image/jpeg')
            self.assertEqual(response.content, jpg.read_bytes())


if __name__ == "__main__":
    unittest.main()

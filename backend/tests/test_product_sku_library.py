from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import unquote

import httpx
from PIL import Image

from backend.product_sku_library import SkuFolderLibrary


class SkuLibraryFixture:
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.primary = self.root / "primary"
        self.additional = self.root / "李宁儿童AI素材库"
        self.primary.mkdir()
        self.additional.mkdir()
        self.library = SkuFolderLibrary(self.primary, self.additional)
        self.colour = self.additional / "02 产品库" / "YKCW196" / "YKCW196-16"
        self.image = self.make_image(self.colour / "YKCW196-16-WHITE-2.jpg")
        self.make_image(self.colour / "YKCW196-16-WHITE-10.jpg")
        self.make_image(self.colour.parent / "YKCW196-17" / "商品.png")
        (self.colour / "Thumbs.db").write_bytes(b"ignored")

    def make_image(self, path, size=(120, 80)):
        path.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", size, "red").save(path)
        return path


class SkuFolderLibraryTest(SkuLibraryFixture, unittest.TestCase):
    def test_style_lists_colour_folders_and_sorts_images_naturally(self):
        result = self.library.search("YKCW196")
        self.assertEqual(result["missing_skus"], [])
        self.assertEqual([f["name"] for f in result["folders"]], ["YKCW196/YKCW196-16", "YKCW196/YKCW196-17"])
        images = result["folders"][0]["images"]
        self.assertEqual([i["filename"] for i in images], [self.image.name, "YKCW196-16-WHITE-10.jpg"])
        self.assertTrue(images[0]["preview_url"].endswith("&thumb=1"))
        self.assertNotIn("thumb=", images[0]["url"])

    def test_colour_sku_locates_nested_directory(self):
        folders = self.library.search("ykcw196-16")["folders"]
        self.assertEqual(len(folders), 1)
        self.assertEqual(len(folders[0]["images"]), 2)
        item = folders[0]["images"][0]
        self.assertEqual(self.library.resolve_image(item["library"], item["sku"], item["path"]), self.image.resolve())

    def test_direct_sku_layout_and_products_root_are_supported(self):
        self.make_image(self.primary / "DIRECT" / "original.png")
        self.assertEqual(self.library.search("DIRECT")["folders"][0]["images"][0]["library"], "primary")
        library = SkuFolderLibrary(self.primary, self.additional / "02 产品库")
        self.assertEqual(len(library.search("YKCW196-16")["folders"][0]["images"]), 2)

    def test_overlapping_queries_do_not_duplicate_folders_or_images(self):
        for query in ("YKCW196 YKCW196-16 ykcw196", "YKCW196-16 YKCW196"):
            with self.subTest(query=query):
                folders = self.library.search(query)["folders"]
                images = [i for f in folders for i in f["images"]]
                self.assertEqual(len(folders), 2)
                self.assertEqual(len(images), 3)
                self.assertEqual(len({i["id"] for i in images}), 3)

    def test_overlapping_library_roots_do_not_duplicate_images(self):
        library = SkuFolderLibrary(self.additional, self.additional / "02 产品库")
        self.assertEqual(sum(len(f["images"]) for f in library.search("YKCW196")["folders"]), 3)

    def test_empty_missing_and_offline_are_distinct(self):
        (self.additional / "EMPTY").mkdir()
        result = self.library.search("EMPTY MISSING")
        self.assertTrue(result["library_exists"])
        self.assertEqual(result["missing_skus"], ["MISSING"])
        self.assertEqual(result["folders"][0]["images"], [])
        result = SkuFolderLibrary(self.root / "offline").search("ANY")
        self.assertFalse(result["library_exists"])

    def test_scan_is_limited_to_matched_sku(self):
        import os
        walk = os.walk
        with patch("backend.product_sku_library.os.walk", wraps=walk) as mocked:
            self.library.search("YKCW196-16")
        self.assertEqual(mocked.call_args.args[0], self.colour.resolve())
        self.assertEqual(mocked.call_count, 1)

    def test_scan_errors_are_not_reported_as_empty_folder(self):
        def inaccessible(*args, onerror, **kwargs):
            onerror(PermissionError("private server path"))
            return iter(())
        with patch("backend.product_sku_library.os.walk", side_effect=inaccessible):
            with self.assertRaises(PermissionError):
                self.library.search("YKCW196")

    def test_rejects_invalid_skus_and_query_limit(self):
        for sku in ("", "../outside", "C:\\secret", "\\\\server\\share", "..", "SKU."):
            with self.subTest(sku=sku), self.assertRaises(ValueError):
                self.library.search(sku)
        with self.assertRaises(ValueError):
            self.library.search(" ".join(f"SKU{i}" for i in range(21)))

    def test_image_resolution_rejects_other_sku_traversal_and_non_images(self):
        for path in ("../outside.png", "/outside.png", "C:/outside.png", "02 产品库/YKCW196/YKCW196-17/商品.png",
                     "02 产品库/YKCW196/YKCW196-16/Thumbs.db", "02 产品库\\YKCW196\\secret.png"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.library.resolve_image("sku", "YKCW196-16", path)
        with self.assertRaises(ValueError):
            self.library.resolve_image("unknown", "YKCW196", "image.png")

    def test_symlink_cannot_escape_library(self):
        outside = self.make_image(self.root / "outside" / "hidden.png")
        link = self.colour / "linked.png"
        try:
            link.symlink_to(outside)
        except OSError:
            self.skipTest("Creating symlinks is unavailable on this Windows host")
        relative = link.relative_to(self.additional).as_posix()
        with self.assertRaises(ValueError):
            self.library.resolve_image("sku", "YKCW196", relative)
        self.assertFalse(any(i["filename"] == link.name for f in self.library.search("YKCW196")["folders"] for i in f["images"]))

    def test_import_copies_only_selected_original_bytes_and_dimensions(self):
        item = self.library.search("YKCW196")["folders"][0]["images"][0]
        result = self.library.import_images([item, item], self.root / "output", "user-a")
        self.assertEqual(len(result), 1)
        self.assertEqual((result[0]["naturalWidth"], result[0]["naturalHeight"]), (120, 80))
        self.assertEqual(result[0]["name"], self.image.name)
        self.assertTrue(result[0]["url"].startswith("/ai-images/user-a/product-import/"))
        copied = self.root / "output" / unquote(result[0]["url"].lstrip("/"))
        self.assertEqual(copied.read_bytes(), self.image.read_bytes())
        self.assertEqual(len(list((self.root / "output").rglob("*.jpg"))), 1)

    def test_import_orientation_and_unicode_filename(self):
        image = self.make_image(self.colour / "原图.jpg", (40, 80))
        with Image.open(image) as source:
            exif = source.getexif()
            exif[274] = 6
            source.save(image, exif=exif)
        item = next(i for f in self.library.search("YKCW196")["folders"] for i in f["images"] if i["filename"] == image.name)
        result = self.library.import_images([item], self.root / "output", "user-a")[0]
        self.assertEqual((result["naturalWidth"], result["naturalHeight"]), (80, 40))
        self.assertIn("%", result["url"])

    def test_failed_import_removes_its_partial_copies(self):
        images = self.library.search("YKCW196")["folders"][0]["images"]
        import shutil
        copyfile = shutil.copyfile
        def fail_second(source, target):
            if Path(target).parent.name == "1":
                raise OSError("disk unavailable")
            return copyfile(source, target)
        with patch("backend.product_sku_library.shutil.copyfile", side_effect=fail_second):
            with self.assertRaises(OSError):
                self.library.import_images(images, self.root / "output", "user-a")
        self.assertEqual(list((self.root / "output").rglob("*.jpg")), [])
        self.assertTrue(self.image.exists())

    def test_import_validates_selection_before_copying(self):
        for items in ([], [{}] * 201, ["invalid"], [{"library": "sku", "sku": "YKCW196", "path": "../outside.jpg"}]):
            with self.subTest(items=str(items)[:50]), self.assertRaises((ValueError, FileNotFoundError)):
                self.library.import_images(items, self.root / "output", "user-a")
        self.assertFalse((self.root / "output").exists())


class SkuFolderApiTest(SkuLibraryFixture, unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        from backend import main
        self.main = main
        for name, value in (("product_library_path", self.primary), ("product_sku_library_path", self.additional), ("output_path", self.root / "output")):
            context = patch.object(main.settings, name, value)
            context.start()
            self.addCleanup(context.stop)
        context = patch.object(main, "_get_session_user", return_value={"id": "test-user", "role": "user"})
        self.auth = context.start()
        self.addCleanup(context.stop)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://designflow.test")
        self.addAsyncCleanup(self.client.aclose)

    async def test_search_preview_and_import_original(self):
        response = await self.client.get("/products/sku-folders", params={"sku": "YKCW196-16"})
        self.assertEqual(response.status_code, 200)
        item = response.json()["folders"][0]["images"][0]
        response = await self.client.get(item["url"])
        self.assertEqual(response.content, self.image.read_bytes())
        with patch.object(self.main.outfit_change, "library_thumbnail", return_value=self.image) as thumb:
            self.assertEqual((await self.client.get(item["preview_url"])).status_code, 200)
            thumb.assert_called_once()
        response = await self.client.post("/products/import-sku-images", json={"items": [item]})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["items"][0]["url"].startswith("/ai-images/test-user/"))

    async def test_new_endpoints_require_login(self):
        self.auth.return_value = None
        for method, path in (("GET", "/products/sku-folders?sku=YKCW196"), ("GET", "/products/sku-folder-image?library=sku&sku=YKCW196&path=a.png"), ("POST", "/products/import-sku-images")):
            response = await self.client.request(method, path, json={"items": []} if method == "POST" else None)
            self.assertEqual(response.status_code, 401)

    async def test_invalid_or_missing_images_return_friendly_errors(self):
        response = await self.client.post("/products/import-sku-images", json={"items": "invalid"})
        self.assertEqual(response.status_code, 400)
        with patch.object(self.main.SkuFolderLibrary, "import_images", side_effect=FileNotFoundError("private filesystem path")):
            response = await self.client.post("/products/import-sku-images", json={"items": [{}]})
            self.assertEqual(response.status_code, 404)
            self.assertNotIn("private", response.text)
        with patch.object(self.main.SkuFolderLibrary, "search", side_effect=OSError("server path")):
            response = await self.client.get("/products/sku-folders", params={"sku": "YKCW196"})
            self.assertEqual(response.status_code, 503)
            self.assertNotIn("server path", response.text)

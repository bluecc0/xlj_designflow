from __future__ import annotations

import io
import random
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
from urllib.parse import unquote

import httpx
from PIL import Image, JpegImagePlugin

from backend import special_export


def save_noise(path: Path) -> bytes:
    with Image.frombytes("RGB", (700, 700), random.Random(42).randbytes(700 * 700 * 3)) as image:
        image.save(path, format="PNG")
    return path.read_bytes()


class SpecialExportImageTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "frame.png"

    def test_small_png_keeps_exact_bytes_and_transparency(self):
        with Image.new("RGBA", (40, 60), (255, 0, 0, 128)) as image:
            image.save(self.path)
        original = self.path.read_bytes()
        extension, payload = special_export.prepare_special_export_image(self.path)
        self.assertEqual(extension, "png")
        self.assertEqual(payload, original)
        with Image.open(io.BytesIO(payload)) as image:
            self.assertEqual(image.getpixel((0, 0)), (255, 0, 0, 128))

    def test_png_at_exact_limit_is_not_converted(self):
        with Image.new("RGB", (40, 60), "red") as image:
            image.save(self.path)
        original = self.path.read_bytes()
        with patch.object(special_export, "SPECIAL_EXPORT_MAX_BYTES", len(original)):
            self.assertEqual(special_export.prepare_special_export_image(self.path), ("png", original))

    def test_large_png_uses_quality_100_when_jpeg_fits(self):
        with Image.new("RGBA", (700, 700), (255, 0, 0, 128)) as image:
            image.save(self.path, compress_level=0)
        original = self.path.read_bytes()
        self.assertGreater(len(original), special_export.SPECIAL_EXPORT_MAX_BYTES)
        extension, payload = special_export.prepare_special_export_image(self.path)
        self.assertEqual(extension, "jpg")
        self.assertLessEqual(len(payload), special_export.SPECIAL_EXPORT_MAX_BYTES)
        with Image.open(io.BytesIO(payload)) as image:
            self.assertEqual(image.size, (700, 700))
            self.assertEqual(image.format, "JPEG")
            self.assertEqual(JpegImagePlugin.get_sampling(image), 0)
            self.assertTrue(all(value == 1 for table in image.quantization.values() for value in table))
            self.assertTrue(all(abs(value - expected) <= 2 for value, expected in zip(image.getpixel((0, 0)), (255, 127, 127))))
        self.assertEqual(self.path.read_bytes(), original)

    def test_large_detailed_image_is_bounded_without_resizing_or_subsampling(self):
        original = save_noise(self.path)
        with Image.open(self.path) as image:
            quality_100 = io.BytesIO()
            image.save(quality_100, format="JPEG", quality=100, subsampling=0, optimize=False)
            self.assertGreater(len(quality_100.getvalue()), special_export.SPECIAL_EXPORT_MAX_BYTES)
        extension, payload = special_export.prepare_special_export_image(self.path)
        self.assertEqual(extension, "jpg")
        self.assertLessEqual(len(payload), special_export.SPECIAL_EXPORT_MAX_BYTES)
        with Image.open(io.BytesIO(payload)) as image:
            self.assertEqual(image.size, (700, 700))
            self.assertEqual(JpegImagePlugin.get_sampling(image), 0)
        self.assertEqual(self.path.read_bytes(), original)

    def test_fixed_png_stays_lossless_even_when_over_limit(self):
        original = save_noise(self.path)
        self.assertGreater(len(original), special_export.SPECIAL_EXPORT_MAX_BYTES)
        self.assertEqual(special_export.prepare_special_export_image(self.path, force_png=True), ("png", original))

    def test_optimizer_failure_falls_back_without_reducing_requested_quality(self):
        with Image.new("RGB", (700, 700), "red") as image:
            image.save(self.path, compress_level=0)
        save = Image.Image.save
        attempts = []

        def save_with_optimizer_failure(image, out, **options):
            attempts.append(options["optimize"])
            if options["optimize"]:
                raise OSError("optimizer buffer full")
            return save(image, out, **options)

        with patch.object(Image.Image, "save", new=save_with_optimizer_failure):
            extension, payload = special_export.prepare_special_export_image(self.path)
        self.assertEqual(extension, "jpg")
        self.assertEqual(attempts, [True, False])
        with Image.open(io.BytesIO(payload)) as image:
            self.assertTrue(all(value == 1 for table in image.quantization.values() for value in table))

    def test_cannot_fit_reports_error_instead_of_silently_resizing(self):
        with Image.new("RGB", (40, 60), "red") as image:
            image.save(self.path)
        original = self.path.read_bytes()
        with patch.object(special_export, "SPECIAL_EXPORT_MAX_BYTES", 1):
            with self.assertRaises(special_export.SpecialExportSizeError):
                special_export.prepare_special_export_image(self.path)
        self.assertEqual(self.path.read_bytes(), original)


class SpecialExportZipTest(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        from backend import main
        cls.main = main

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.output = Path(self.temp.name)
        self.jobs = {}
        self.originals = {}
        for job_id, job_type, request_type in (
            ("plain", self.main.SpecialComposeJob, self.main.SpecialComposeRequest),
            ("full", self.main.SpecialFullComposeJob, self.main.SpecialFullComposeRequest),
        ):
            folder = self.output / "results" / job_id
            folder.mkdir(parents=True)
            small = folder / "frame_0.png"
            with Image.new("RGBA", (40, 60), (255, 0, 0, 128)) as image:
                image.save(small)
            large = folder / "frame_1_v2.png"
            with Image.new("RGB", (700, 700), "blue") as image:
                image.save(large, compress_level=0)
            fixed = folder / "frame_2.png"
            fixed.write_bytes(large.read_bytes())
            self.originals[job_id] = {path.name: path.read_bytes() for path in folder.iterdir()}
            self.jobs[job_id] = job_type(
                id=job_id, user_id="test-user", status=self.main.ComposeStatus.done,
                request=request_type(file_id="file", page_id="page", frame_ids=["0", "1", "2"], sku="SKU-123"),
                result_frame_names=["详情页-sku", "横幅-sku", "分类页"],
                result_paths=[str(small), str(large), str(fixed)],
                result_frame_ids=["0", "1", "2"],
            )
        for patcher in (
            patch.object(self.main.settings, "output_path", self.output),
            patch.object(self.main, "_jobs", self.jobs),
            patch.object(self.main, "_get_session_user", return_value={"id": "test-user", "role": "user"}),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    async def test_both_downloads_use_actual_format_and_keep_sku_variant_names(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.main.app), base_url="http://test") as client:
            for job_id, endpoint in (("plain", "special-compose"), ("full", "special-compose-full")):
                with self.subTest(endpoint=endpoint):
                    response = await client.get(f"/{endpoint}/{job_id}/download-zip")
                    self.assertEqual(response.status_code, 200, response.text if response.is_error else "")
                    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
                        self.assertEqual(set(archive.namelist()), {"详情页-SKU-123.png", "横幅-SKU-123_版本2.jpg", "分类页.png"})
                        self.assertEqual(archive.read("详情页-SKU-123.png"), self.originals[job_id]["frame_0.png"])
                        self.assertEqual(archive.read("分类页.png"), self.originals[job_id]["frame_2.png"])
                        jpeg = archive.read("横幅-SKU-123_版本2.jpg")
                        self.assertLessEqual(len(jpeg), special_export.SPECIAL_EXPORT_MAX_BYTES)
                        with Image.open(io.BytesIO(jpeg)) as image:
                            self.assertEqual(image.format, "JPEG")
                            self.assertEqual(image.size, (700, 700))
                    for filename, original in self.originals[job_id].items():
                        self.assertEqual((self.output / "results" / job_id / filename).read_bytes(), original)

    async def test_both_downloads_report_size_failure_with_frame_name(self):
        with patch.object(self.main, "prepare_special_export_image", side_effect=special_export.SpecialExportSizeError("保持原尺寸时无法压缩")):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.main.app), base_url="http://test") as client:
                for job_id, endpoint in (("plain", "special-compose"), ("full", "special-compose-full")):
                    response = await client.get(f"/{endpoint}/{job_id}/download-zip")
                    self.assertEqual(response.status_code, 422)
                    self.assertIn("详情页-sku", response.json()["detail"])

    async def test_poll_metadata_uses_actual_frame_indices_and_variant_names(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.main.app), base_url="http://test") as client:
            for job_id, endpoint in (("plain", "special-compose"), ("full", "special-compose-full")):
                # A missing earlier frame or extra variant must not shift later image names.
                job = self.jobs[job_id]
                job.result_paths = [job.result_paths[1], job.result_paths[0]]
                response = await client.get(f"/{endpoint}/{job_id}")
                self.assertEqual(response.status_code, 200, response.text)
                images = response.json()["result_images"]
                self.assertEqual([image["name"] for image in images], ["横幅-SKU-123_版本2", "详情页-SKU-123"])
                self.assertEqual([image["frame_index"] for image in images], [1, 0])
                self.assertEqual(images[0]["url"], f"/results/{job_id}/frame_1_v2.png")
                self.assertEqual(images[0]["download_url"], f"/{endpoint}/{job_id}/download-image/frame_1_v2.png")

    async def test_single_download_matches_zip_format_name_and_bytes(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.main.app), base_url="http://test") as client:
            for job_id, endpoint in (("plain", "special-compose"), ("full", "special-compose-full")):
                zip_response = await client.get(f"/{endpoint}/{job_id}/download-zip")
                self.assertEqual(zip_response.status_code, 200)
                with zipfile.ZipFile(io.BytesIO(zip_response.content)) as archive:
                    for frame_file, filename, mime in (
                        ("frame_0.png", "详情页-SKU-123.png", "image/png"),
                        ("frame_1_v2.png", "横幅-SKU-123_版本2.jpg", "image/jpeg"),
                        ("frame_2.png", "分类页.png", "image/png"),
                    ):
                        response = await client.get(f"/{endpoint}/{job_id}/download-image/{frame_file}")
                        self.assertEqual(response.status_code, 200)
                        self.assertEqual(response.headers["content-type"], mime)
                        self.assertEqual(unquote(response.headers["content-disposition"].split("UTF-8''")[1]), filename)
                        self.assertEqual(response.content, archive.read(filename))

    async def test_single_download_checks_login_owner_task_type_and_file(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.main.app), base_url="http://test") as client:
            url = "/special-compose/plain/download-image/frame_0.png"
            with patch.object(self.main, "_get_session_user", return_value=None):
                self.assertEqual((await client.get(url)).status_code, 401)
            with patch.object(self.main, "_get_session_user", return_value={"id": "other-user", "role": "user"}):
                self.assertEqual((await client.get(url)).status_code, 403)
            for invalid in (
                "/special-compose-full/plain/download-image/frame_0.png",
                "/special-compose/plain/download-image/frame_999.png",
                "/special-compose/plain/download-image/jobs.db",
            ):
                self.assertEqual((await client.get(invalid)).status_code, 404)


if __name__ == "__main__":
    unittest.main()

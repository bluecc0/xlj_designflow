from __future__ import annotations

import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from PIL import Image

from backend import job_store, main, outfit_change
from backend.config import settings


def _png_bytes(size: tuple[int, int] = (64, 96), color=(200, 30, 30, 255)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGBA", size, color).save(buf, format="PNG")
    return buf.getvalue()


def _jpg_bytes(size: tuple[int, int] = (300, 400)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (20, 120, 200)).save(buf, format="JPEG")
    return buf.getvalue()


class LibraryLayoutTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        self.library = root / "library"
        self.output = root / "output"
        white = self.library / "White_Base"
        model = self.library / "Model_Images"
        white.mkdir(parents=True)
        model.mkdir(parents=True)
        (white / "C24B1201.png").write_bytes(_png_bytes())
        (white / "C24B1201_2.png").write_bytes(_png_bytes())
        (white / "C24B1201_3.jpg").write_bytes(_jpg_bytes())
        # 缺号 4、5 之后的 6 不应被探测到（连续 2 次缺号即停止）
        (white / "C24B1201_6.png").write_bytes(_png_bytes())
        (white / "C24B1201-back.png").write_bytes(_png_bytes())
        (white / "OTHER.png").write_bytes(_png_bytes())
        sub = model / "C24B1201"
        sub.mkdir()
        (sub / "front.jpg").write_bytes(_jpg_bytes())
        (sub / "notes.txt").write_text("ignore")

        self.patchers = [
            patch.object(settings, "product_library_path", self.library),
            patch.object(settings, "output_path", self.output),
            patch.object(settings, "product_angle_patterns", "_{n}|-{n}| ({n})|({n})"),
            patch.object(settings, "outfit_asset_types", "white,png,model"),
        ]
        for p in self.patchers:
            p.start()
        outfit_change._ASSET_CACHE.clear()

    def tearDown(self) -> None:
        for p in self.patchers:
            p.stop()
        outfit_change._ASSET_CACHE.clear()
        self.temp_dir.cleanup()

    def test_lists_main_angle_variants_and_sku_subfolder(self) -> None:
        assets = outfit_change.list_sku_assets("C24B1201")
        ids = [a["id"] for a in assets]
        self.assertEqual(
            ids,
            [
                "white:C24B1201.png",
                "white:C24B1201_2.png",
                "white:C24B1201_3.jpg",
                "model:C24B1201/front.jpg",
            ],
        )
        angles = {a["id"]: a["angle"] for a in assets}
        self.assertEqual(angles["white:C24B1201.png"], "主图")
        self.assertEqual(angles["white:C24B1201_2.png"], "角度 2")
        self.assertEqual(angles["model:C24B1201/front.jpg"], "正面")

    def test_unknown_or_unsafe_sku_returns_nothing(self) -> None:
        self.assertEqual(outfit_change.list_sku_assets("NOPE"), [])
        self.assertEqual(outfit_change.list_sku_assets("../White_Base/OTHER"), [])

    def test_resolve_library_asset_rejects_traversal(self) -> None:
        ok = outfit_change.resolve_library_asset("white", "C24B1201_2.png")
        self.assertTrue(ok.is_file())
        for bad in ("../Model_Images/C24B1201/front.jpg", "a/b/c.png", "/etc/passwd", "C:/x.png", ""):
            with self.assertRaises(ValueError, msg=bad):
                outfit_change.resolve_library_asset("white", bad)
        with self.assertRaises(ValueError):
            outfit_change.resolve_library_asset("not-a-type", "C24B1201.png")
        with self.assertRaises(FileNotFoundError):
            outfit_change.resolve_library_asset("white", "MISSING.png")

    def test_thumbnail_is_cached_webp(self) -> None:
        src = outfit_change.resolve_library_asset("white", "C24B1201_3.jpg")
        thumb = outfit_change.library_thumbnail(src, max_side=100)
        self.assertEqual(thumb.suffix, ".webp")
        with Image.open(thumb) as img:
            self.assertLessEqual(max(img.size), 100)
        self.assertEqual(outfit_change.library_thumbnail(src, max_side=100), thumb)


class PromptAndHelpersTest(unittest.TestCase):
    def test_nearest_aspect_ratio(self) -> None:
        self.assertEqual(outfit_change.nearest_aspect_ratio(1000, 1000), "1:1")
        self.assertEqual(outfit_change.nearest_aspect_ratio(750, 1000), "3:4")
        self.assertEqual(outfit_change.nearest_aspect_ratio(1080, 1920), "9:16")
        self.assertEqual(outfit_change.nearest_aspect_ratio(0, 10), "auto")

    def test_prepare_reference_image_downscales_and_keeps_alpha(self) -> None:
        data, name, w, h = outfit_change.prepare_reference_image(_png_bytes((3000, 1000)), "garment", max_side=1024)
        self.assertEqual((w, h), (3000, 1000))
        self.assertTrue(name.endswith(".png"))
        with Image.open(io.BytesIO(data)) as img:
            self.assertEqual(max(img.size), 1024)
            self.assertEqual(img.mode, "RGBA")
        data, name, _, _ = outfit_change.prepare_reference_image(_jpg_bytes(), "source")
        self.assertTrue(name.endswith(".jpg"))

    def test_normalize_analysis_clamps_unknown_values(self) -> None:
        result = outfit_change.normalize_analysis({
            "image_type": "Model",
            "garments": [{"slot": "hat", "name": "棒球帽", "color": "黑色"}, {"slot": "cape"}, "bad"],
        })
        self.assertEqual(result["image_type"], "model")
        self.assertEqual([g["id"] for g in result["garments"]], ["g1", "g2"])
        self.assertEqual(result["garments"][1]["slot"], "other")

    def test_prompt_groups_angles_and_keeps_untargeted_garments(self) -> None:
        analysis = outfit_change.normalize_analysis({
            "image_type": "model",
            "summary": "女模特白底站立",
            "subject": {"pose": "站立", "view": "正面"},
            "garments": [
                {"slot": "hat", "name": "棒球帽", "color": "黑色"},
                {"slot": "top", "name": "T恤", "color": "白色"},
            ],
        })
        prompt = outfit_change.build_outfit_prompt(
            analysis=analysis,
            references=[
                {"sku": "A1", "type_label": "白底图", "angle": "主图"},
                {"sku": "A1", "type_label": "白底图", "angle": "背面"},
                {"sku": "B2", "type_label": "模特图", "angle": "主图"},
            ],
            target_garment_ids=["g2"],
            extra_prompt="衣摆塞进裤腰",
        )
        self.assertIn("虚拟换装", prompt)
        self.assertIn("图2、图3：同一件商品（货号 A1）", prompt)
        self.assertIn("图4：商品（货号 B2）", prompt)
        self.assertIn("不同货号是不同的商品", prompt)
        self.assertIn("只替换图1中的这些部位：上衣：白色T恤", prompt)
        self.assertIn("未被替换的服饰与配饰保持原样：黑色棒球帽", prompt)
        self.assertIn("衣摆塞进裤腰", prompt)

    def test_prompt_without_analysis_falls_back_to_product_mode(self) -> None:
        prompt = outfit_change.build_outfit_prompt(
            analysis=None,
            references=[{"sku": "", "type_label": "本地上传", "angle": "上传素材 1"}],
            target_garment_ids=[],
        )
        self.assertIn("商品替换", prompt)
        self.assertIn("自动识别参考图商品的品类", prompt)


class OutfitEndpointTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        self.library = root / "library"
        (self.library / "White_Base").mkdir(parents=True)
        (self.library / "White_Base" / "SKU9.png").write_bytes(_png_bytes())
        (self.library / "White_Base" / "SKU9_2.png").write_bytes(_png_bytes())
        self.patchers = [
            patch.object(job_store, "_DB_PATH", root / "jobs.db"),
            patch.object(settings, "product_library_path", self.library),
            patch.object(settings, "outfit_asset_types", "white"),
            patch.object(main, "_get_session_user", lambda request: {"id": "u1", "username": "tester", "role": "user"}),
        ]
        for p in self.patchers:
            p.start()
        job_store.init_db()
        outfit_change._ASSET_CACHE.clear()
        outfit_change._ANALYSIS_CACHE.clear()
        self.client = TestClient(main.app)

    def tearDown(self) -> None:
        for p in self.patchers:
            p.stop()
        self.temp_dir.cleanup()

    def test_outfit_assets_endpoint(self) -> None:
        resp = self.client.get("/products/outfit-assets", params={"sku": "SKU9, MISSING"})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data["library_exists"])
        self.assertEqual(data["max_references"], 8)
        first, second = data["items"]
        self.assertEqual([a["path"] for a in first["assets"]], ["SKU9.png", "SKU9_2.png"])
        self.assertTrue(first["assets"][0]["thumb_url"].endswith("&thumb=1"))
        self.assertFalse(second["found"])

        img = self.client.get(first["assets"][1]["url"])
        self.assertEqual(img.status_code, 200)
        self.assertEqual(img.headers["content-type"], "image/png")
        bad = self.client.get("/products/library-image", params={"asset_type": "white", "path": "../x.png"})
        self.assertEqual(bad.status_code, 400)

    def test_analyze_endpoint_reports_missing_vlm(self) -> None:
        with patch.object(settings, "vlm_api_key", ""):
            resp = self.client.post(
                "/ai-image/outfit-analyze",
                files={"image": ("a.png", _png_bytes(), "image/png")},
            )
        self.assertEqual(resp.status_code, 503)

    def test_analyze_endpoint_parses_vlm_json(self) -> None:
        vlm_json = json.dumps({
            "image_type": "model",
            "summary": "模特",
            "garments": [{"slot": "top", "name": "T恤", "color": "白"}],
        }, ensure_ascii=False)

        class FakeResp:
            is_success = True
            status_code = 200
            text = ""

            def json(self):
                return {"choices": [{"message": {"content": f"```json\n{vlm_json}\n```"}}]}

        with patch.object(settings, "vlm_api_key", "k"), patch("httpx.AsyncClient.post", new=AsyncMock(return_value=FakeResp())):
            resp = self.client.post(
                "/ai-image/outfit-analyze",
                files={"image": ("a.png", _png_bytes(), "image/png")},
            )
            again = self.client.post(
                "/ai-image/outfit-analyze",
                files={"image": ("a.png", _png_bytes(), "image/png")},
            )
        self.assertEqual(resp.status_code, 200, resp.text)
        data = resp.json()
        self.assertEqual(data["image_type"], "model")
        self.assertEqual(data["garments"][0]["slot_label"], "上衣")
        self.assertFalse(data["cached"])
        self.assertTrue(again.json()["cached"])

    def test_outfit_change_submits_job_with_ordered_references(self) -> None:
        captured: dict = {}

        async def fake_background(**kwargs):
            captured.update(kwargs)

        with patch.object(main, "_run_ai_image_background", new=fake_background):
            resp = self.client.post(
                "/ai-image/outfit-change",
                files=[
                    ("image", ("src.jpg", _jpg_bytes((750, 1000)), "image/jpeg")),
                    ("uploads", ("hat.png", _png_bytes(), "image/png")),
                ],
                data={
                    "assets": json.dumps([
                        {"sku": "SKU9", "asset_type": "white", "path": "SKU9.png", "angle": "主图"},
                        {"sku": "SKU9", "asset_type": "white", "path": "SKU9_2.png"},
                    ]),
                    "analysis": json.dumps({"image_type": "model", "garments": [{"slot": "top", "name": "T恤"}]}),
                    "target_garments": json.dumps(["g1"]),
                    "model": "nano-banana-pro",
                    "client_request_id": "req-1",
                },
            )
        self.assertEqual(resp.status_code, 200, resp.text)
        body = resp.json()
        self.assertEqual(body["size"], "3:4")
        self.assertIn("job_id", body)
        self.assertEqual(captured["model"], "gemini-3-pro-image-preview")
        self.assertEqual(len(captured["refs"]), 4)
        self.assertTrue(captured["refs"][0][1].startswith("source"))
        self.assertIn("图2、图3：同一件商品（货号 SKU9）", captured["prompt"])
        self.assertIn("只替换图1中的这些部位：上衣", captured["prompt"])
        meta = captured["request_meta"]
        self.assertEqual(meta["operation"], "outfit-change")
        self.assertEqual(meta["outfit"]["skus"], ["SKU9"])
        self.assertEqual(meta["reference_images"][1]["label"], "图2 · SKU9 / 白底图 / 主图")
        self.assertEqual(meta["reference_images"][2]["label"], "图3 · SKU9 / 白底图 / 角度 2")
        self.assertEqual(meta["reference_images"][3]["label"], "图4 · 本地上传 / 上传素材 1")
        job = job_store.load_ai_image_job(body["job_id"])
        self.assertEqual(job["status"], "processing")

    def test_outfit_change_validation(self) -> None:
        src = ("image", ("src.jpg", _jpg_bytes(), "image/jpeg"))
        resp = self.client.post("/ai-image/outfit-change", files=[src], data={"assets": "[]"})
        self.assertEqual(resp.status_code, 400)
        too_many = [{"sku": "SKU9", "asset_type": "white", "path": "SKU9.png"}] * 9
        resp = self.client.post("/ai-image/outfit-change", files=[src], data={"assets": json.dumps(too_many)})
        self.assertEqual(resp.status_code, 400)
        resp = self.client.post(
            "/ai-image/outfit-change",
            files=[src],
            data={"assets": json.dumps([{"asset_type": "white", "path": "../../etc/passwd.png"}])},
        )
        self.assertEqual(resp.status_code, 400)
        resp = self.client.post(
            "/ai-image/outfit-change",
            files=[src],
            data={"assets": json.dumps([{"asset_type": "white", "path": "SKU9.png"}]), "model": "dall-e"},
        )
        self.assertEqual(resp.status_code, 400)


if __name__ == "__main__":
    unittest.main()

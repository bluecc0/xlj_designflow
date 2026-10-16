from __future__ import annotations

import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image

import asyncio

import httpx

from backend import ai_image, bfl_vto, job_store, main, outfit_change
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

    def test_prompt_groups_angles_and_keeps_untargeted_garments(self) -> None:
        prompt = outfit_change.build_outfit_prompt(
            references=[
                {"sku": "A1", "type_label": "白底图", "angle": "主图"},
                {"sku": "A1", "type_label": "白底图", "angle": "背面"},
                {"sku": "B2", "type_label": "模特图", "angle": "主图"},
            ],
            target_slots=["top"],
            extra_prompt="衣摆塞进裤腰",
        )
        self.assertIn("虚拟换装", prompt)
        self.assertIn("图2、图3：同一件商品（货号 A1）", prompt)
        self.assertIn("图4：商品（货号 B2）", prompt)
        self.assertIn("不同货号是不同的商品", prompt)
        self.assertIn("只替换图1中的以下指定部位", prompt)
        self.assertIn("【上衣】", prompt)
        self.assertIn("未选择替换的部位", prompt)
        self.assertIn("帽子/头饰", prompt)
        self.assertIn("衣摆塞进裤腰", prompt)

    def test_prompt_without_target_slots_falls_back_to_product_mode(self) -> None:
        prompt = outfit_change.build_outfit_prompt(
            references=[{"sku": "", "type_label": "本地上传", "angle": "上传素材 1"}],
        )
        self.assertIn("商品替换", prompt)
        self.assertIn("自动识别参考图商品的品类", prompt)

    def test_prompt_with_target_slots_generates_region_instructions(self) -> None:
        prompt = outfit_change.build_outfit_prompt(
            references=[
                {"sku": "TOP1", "slot": "top", "type_label": "白底图", "angle": "正面"},
                {"sku": "PANT1", "slot": "bottom", "type_label": "白底图", "angle": "正面"},
            ],
            target_slots=["top", "bottom"],
        )
        # 指定部位自动识别为虚拟换装任务
        self.assertIn("电商虚拟换装", prompt)
        # 包含指定部位
        self.assertIn("【上衣】", prompt)
        self.assertIn("【裤子/下装】", prompt)
        self.assertIn("图2展示的", prompt)
        self.assertIn("图3展示的", prompt)
        # 保护未选核心部位
        self.assertIn("鞋子", prompt)
        self.assertIn("帽子/头饰", prompt)
        self.assertIn("未选择替换的部位", prompt)
        # 安全规范：严禁出现敏感词
        self.assertNotIn("脱下", prompt)
        self.assertNotIn("脱去", prompt)
        self.assertNotIn("裸露", prompt)



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

    def test_retired_analysis_endpoint_is_not_registered(self) -> None:
        self.assertNotIn("/ai-image/outfit-analyze", {route.path for route in main.app.routes})

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
                    "target_slots": json.dumps(["top"]),
                    "model": "gpt-image-2.5",
                    "client_request_id": "req-1",
                },
            )
        self.assertEqual(resp.status_code, 200, resp.text)
        body = resp.json()
        self.assertEqual(body["size"], "3:4")
        self.assertIn("job_id", body)
        self.assertEqual(captured["model"], "gpt-image-2.5")
        self.assertEqual(captured["provider"], "auto")
        self.assertEqual(len(captured["refs"]), 4)
        self.assertTrue(captured["refs"][0][1].startswith("source"))
        self.assertIn("图2、图3：同一件商品（货号 SKU9）", captured["prompt"])
        self.assertIn("只替换图1中的以下指定部位", captured["prompt"])
        self.assertIn("【上衣】", captured["prompt"])
        meta = captured["request_meta"]
        self.assertEqual(meta["operation"], "outfit-change")
        self.assertEqual(meta["outfit"]["skus"], ["SKU9"])
        self.assertEqual(meta["reference_images"][1]["label"], "图2 · SKU9 / 白底图 / 主图")
        self.assertEqual(meta["reference_images"][2]["label"], "图3 · SKU9 / 白底图 / 角度 2")
        self.assertEqual(meta["reference_images"][3]["label"], "图4 · 本地上传 / 上传素材 1")
        job = job_store.load_ai_image_job(body["job_id"])
        self.assertEqual(job["status"], "processing")

    def test_outfit_change_endpoint_accepts_target_slots(self) -> None:
        captured: dict = {}

        async def fake_background(**kwargs):
            captured.update(kwargs)

        with patch.object(main, "_run_ai_image_background", new=fake_background):
            resp = self.client.post(
                "/ai-image/outfit-change",
                files=[
                    ("image", ("src.jpg", _jpg_bytes((750, 1000)), "image/jpeg")),
                ],
                data={
                    "assets": json.dumps([
                        {"sku": "SKU9", "slot": "top", "asset_type": "white", "path": "SKU9.png", "angle": "主图"},
                    ]),
                    "target_slots": json.dumps(["top", "shoes"]),
                    "model": "gpt-image-2.5",
                },
            )
        self.assertEqual(resp.status_code, 200, resp.text)
        self.assertIn("【上衣】", captured["prompt"])
        self.assertIn("【鞋子】", captured["prompt"])
        meta = captured["request_meta"]["outfit"]
        self.assertEqual(meta["target_slots"], ["top", "shoes"])

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
        # Nano Banana Pro 已由 FLUX 换装替代
        resp = self.client.post(
            "/ai-image/outfit-change",
            files=[src],
            data={"assets": json.dumps([{"asset_type": "white", "path": "SKU9.png"}]), "model": "nano-banana-pro"},
        )
        self.assertEqual(resp.status_code, 400)

    def test_flux_outfit_sends_person_and_single_garment_board(self) -> None:
        captured: dict = {}

        async def fake_background(**kwargs):
            captured.update(kwargs)

        with patch.object(settings, "bfl_api_key", "test-key"), \
                patch.object(main, "_run_ai_image_background", new=fake_background):
            resp = self.client.post(
                "/ai-image/outfit-change",
                files=[
                    ("image", ("src.jpg", _jpg_bytes((1500, 2000)), "image/jpeg")),
                    ("uploads", ("shoe.png", _png_bytes(), "image/png")),
                ],
                data={
                    "assets": json.dumps([
                        {"sku": "SKU9", "slot": "top", "asset_type": "white", "path": "SKU9.png"},
                        {"sku": "SKU9", "slot": "top", "asset_type": "white", "path": "SKU9_2.png"},
                    ]),
                    "upload_slots": json.dumps(["shoes"]),
                    "target_slots": json.dumps(["top", "shoes"]),
                    "model": "flux-vto",
                    "resolution": "1K",
                },
            )
        self.assertEqual(resp.status_code, 200, resp.text)
        self.assertEqual(resp.json()["model"], "flux-vto")
        self.assertEqual(captured["provider"], "bfl")
        self.assertEqual([name for _c, name in captured["refs"]], ["01_person.jpg", "02_garments.jpg"])
        with Image.open(io.BytesIO(captured["refs"][0][0])) as person:
            self.assertLessEqual(person.width * person.height, 1_000_000)
        with Image.open(io.BytesIO(captured["refs"][1][0])) as board:
            self.assertGreater(board.width, board.height / 2)  # 3 张素材 → 2x2 网格
        self.assertIn("wearing the top and shoes of image 2", captured["prompt"])
        labels = [r["label"] for r in captured["request_meta"]["reference_images"]]
        self.assertEqual(labels, ["图1 · 原图", "图2 · 服装拼图（3 张素材）"])
        job = job_store.load_ai_image_job(resp.json()["job_id"])
        self.assertEqual(job["provider"], "bfl")

    def test_outfit_resolution_4k_only_for_gpt(self) -> None:
        captured: dict = {}

        async def fake_background(**kwargs):
            captured.update(kwargs)

        form = {"assets": json.dumps([{"sku": "SKU9", "asset_type": "white", "path": "SKU9.png"}]), "resolution": "4K"}
        src = [("image", ("src.jpg", _jpg_bytes(), "image/jpeg"))]
        with patch.object(settings, "bfl_api_key", "test-key"), \
                patch.object(main, "_run_ai_image_background", new=fake_background):
            resp = self.client.post("/ai-image/outfit-change", files=src, data={**form, "model": "gpt-image-2.5"})
            self.assertEqual(resp.status_code, 200, resp.text)
            self.assertEqual(captured["resolution"], "4K")
            resp = self.client.post("/ai-image/outfit-change", files=src, data={**form, "model": "flux-vto"})
            self.assertEqual(resp.status_code, 400)
            self.assertIn("2K", resp.json()["detail"])

    def test_flux_outfit_requires_api_key(self) -> None:
        with patch.object(settings, "bfl_api_key", ""):
            resp = self.client.post(
                "/ai-image/outfit-change",
                files=[("image", ("src.jpg", _jpg_bytes(), "image/jpeg"))],
                data={"assets": json.dumps([{"asset_type": "white", "path": "SKU9.png"}]), "model": "flux-vto"},
            )
        self.assertEqual(resp.status_code, 503)


class FluxVtoHelpersTest(unittest.TestCase):
    def test_garment_board_grid_layout(self) -> None:
        def size_of(n: int) -> tuple[int, int]:
            data = outfit_change.compose_garment_board([_png_bytes()] * n, cell=90, gap=10)
            with Image.open(io.BytesIO(data)) as img:
                return img.size

        self.assertEqual(size_of(1), (110, 140))   # 1 列
        self.assertEqual(size_of(3), (210, 270))   # 2x2
        self.assertEqual(size_of(5), (310, 270))   # 3 列 x 2 行
        with self.assertRaises(ValueError):
            outfit_change.compose_garment_board([])

    def test_fit_person_image_only_downscales(self) -> None:
        big = outfit_change.fit_person_image(_jpg_bytes((3000, 4000)), 1.0)
        with Image.open(io.BytesIO(big)) as img:
            self.assertLessEqual(img.width * img.height, 1_000_000)
            self.assertAlmostEqual(img.width / img.height, 0.75, places=2)
        small = outfit_change.fit_person_image(_jpg_bytes((300, 400)), 1.0)
        with Image.open(io.BytesIO(small)) as img:
            self.assertEqual(img.size, (300, 400))

    def test_vto_prompt_follows_official_formula(self) -> None:
        prompt = outfit_change.build_vto_prompt(
            references=[{"sku": "A", "slot": "outerwear"}],
            target_slots=["outerwear"],
            extra_prompt="袖口微挽",
        )
        self.assertTrue(prompt.startswith(
            "The person of image 1, maintaining exactly their face and pose, wearing the jacket of image 2."
        ))
        self.assertNotIn("several reference views", prompt)
        self.assertIn("Additional styling: 袖口微挽", prompt)
        multi = outfit_change.build_vto_prompt(
            references=[{"sku": "A", "slot": "top"}, {"sku": "A", "slot": "top"}],
            target_slots=["top"],
        )
        self.assertIn("several reference views", multi)


class FluxVtoClientTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.requests: list[httpx.Request] = []
        self.poll_statuses = ["Pending", "Ready"]
        real_client = httpx.AsyncClient

        def handler(request: httpx.Request) -> httpx.Response:
            self.requests.append(request)
            if request.method == "POST":
                return httpx.Response(200, json={"id": "t1", "polling_url": "https://api.bfl.ai/v1/get_result?id=t1"})
            if request.url.path == "/v1/get_result":
                status = self.poll_statuses.pop(0)
                body = {"id": "t1", "status": status}
                if status == "Ready":
                    body["result"] = {"sample": "https://delivery.bfl.ai/r/out.jpg"}
                return httpx.Response(200, json=body)
            return httpx.Response(200, content=_jpg_bytes(), headers={"content-type": "image/jpeg"})

        def client_factory(**kwargs):
            kwargs.pop("proxy", None)
            return real_client(transport=httpx.MockTransport(handler), **kwargs)

        self.patchers = [
            patch.object(settings, "bfl_api_key", "test-key"),
            patch.object(settings, "bfl_api_url", "https://api.bfl.ai"),
            patch.object(ai_image, "_OUTPUT_DIR", Path(self.temp_dir.name)),
            patch.object(bfl_vto, "POLL_INTERVAL_SECONDS", 0),
            patch.object(bfl_vto.httpx, "AsyncClient", client_factory),
        ]
        for p in self.patchers:
            p.start()

    def tearDown(self) -> None:
        for p in self.patchers:
            p.stop()
        self.temp_dir.cleanup()

    def _run(self) -> dict:
        return asyncio.run(bfl_vto.generate_vto_async(
            prompt="p", person=b"person", garment=b"garment", user_id="u1",
        ))

    def test_submit_poll_download(self) -> None:
        accepted: list[str] = []
        result = asyncio.run(bfl_vto.generate_vto_async(
            prompt="p", person=b"person", garment=b"garment", user_id="u1",
            on_accepted=accepted.append,
        ))
        self.assertEqual(accepted, ["t1"])
        self.assertEqual(result["provider"], "bfl")
        self.assertEqual(result["task_id"], "t1")
        self.assertTrue(result["url"].startswith("/ai-images/u1/"))
        submit = self.requests[0]
        self.assertEqual(submit.url.path, "/v1/flux-tools/vto-v2")
        self.assertEqual(submit.headers["x-key"], "test-key")
        body = json.loads(submit.content)
        self.assertEqual(body["person"], "cGVyc29u")  # base64("person")
        self.assertEqual(set(body), {"prompt", "person", "garment", "output_format"})
        saved = list(Path(self.temp_dir.name).rglob("vto_*.jpg"))
        self.assertEqual(len(saved), 1)

    def test_moderated_task_raises_readable_error(self) -> None:
        self.poll_statuses = ["Content Moderated"]
        with self.assertRaisesRegex(bfl_vto.BflVtoError, "审核"):
            self._run()


if __name__ == "__main__":
    unittest.main()

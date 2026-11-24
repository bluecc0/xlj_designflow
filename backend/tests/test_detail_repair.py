from __future__ import annotations

import io
import unittest

from PIL import Image, ImageDraw

from backend import detail_repair as dr


def png(image: Image.Image) -> bytes:
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


def source_image(size=(600, 800)) -> Image.Image:
    img = Image.new("RGB", size)
    px = img.load()
    for y in range(size[1]):
        for x in range(size[0]):
            px[x, y] = (x % 256, y % 256, (x + y) % 256)
    return img


class PlacementTest(unittest.TestCase):
    def test_from_dict_parses_crop_and_rejects_bad_values(self):
        p = dr.Placement.from_dict({
            "center_x": 100, "center_y": 120, "width": 50, "height": 40, "rotation": 15,
            "crop": {"x": 10, "y": 20, "width": 30, "height": 40},
        })
        self.assertEqual(p.crop, (10, 20, 40, 60))
        with self.assertRaises(ValueError):
            dr.Placement.from_dict({"center_x": 1, "center_y": 1, "width": 0, "height": 10})
        with self.assertRaises(ValueError):
            dr.Placement.from_dict({"center_x": "nan", "center_y": 1, "width": 10, "height": 10})
        with self.assertRaises(ValueError):
            dr.Placement.from_dict({"center_y": 1, "width": 10, "height": 10})

    def test_pattern_layer_lands_at_center_with_size(self):
        pattern = Image.new("RGBA", (10, 10), (255, 0, 0, 255))
        layer = dr.render_pattern_layer((400, 300), pattern, dr.Placement(200, 150, 80, 40))
        self.assertEqual(layer.getchannel("A").getbbox(), (160, 130, 240, 170))

    def test_rotation_is_clockwise_like_css(self):
        pattern = Image.new("RGBA", (100, 10), (255, 0, 0, 255))
        layer = dr.render_pattern_layer((400, 400), pattern, dr.Placement(200, 200, 100, 10, rotation=90))
        x0, y0, x1, y1 = layer.getchannel("A").getbbox()
        self.assertLess(x1 - x0, 20)
        self.assertGreater(y1 - y0, 90)

    def test_crop_pattern_cuts_white_border(self):
        pattern = Image.new("RGB", (100, 100), "white")
        ImageDraw.Draw(pattern).rectangle((20, 30, 59, 69), fill="blue")
        cropped = dr.crop_pattern(pattern, (20, 30, 60, 70))
        self.assertEqual(cropped.size, (40, 40))
        self.assertEqual(cropped.getpixel((0, 0))[:3], (0, 0, 255))
        with self.assertRaises(ValueError):
            dr.crop_pattern(pattern, (200, 200, 300, 300))


class RemovePatternBgTest(unittest.TestCase):
    def test_strips_uniform_white_border_and_keeps_interior_white(self):
        pat = Image.new("RGB", (120, 120), (248, 248, 248))
        d = ImageDraw.Draw(pat)
        d.rectangle((25, 25, 95, 95), fill=(80, 40, 160))
        d.rectangle((45, 45, 75, 75), fill=(255, 255, 255))
        cleaned, removed = dr.remove_pattern_bg(pat)
        self.assertTrue(removed)
        self.assertEqual(cleaned.getpixel((5, 5))[3], 0)
        self.assertEqual(cleaned.getpixel((60, 60))[3], 255)
        self.assertEqual(cleaned.getpixel((35, 35))[3], 255)

    def test_preserves_existing_transparent_png(self):
        pat = Image.new("RGBA", (80, 80), (0, 0, 0, 0))
        ImageDraw.Draw(pat).ellipse((20, 20, 60, 60), fill=(200, 30, 30, 255))
        cleaned, removed = dr.remove_pattern_bg(pat)
        self.assertFalse(removed)
        self.assertEqual(cleaned.tobytes(), pat.tobytes())


class BuildPlanTest(unittest.TestCase):
    def setUp(self):
        self.source = source_image((600, 800))
        self.pattern = Image.new("RGB", (80, 80), "white")
        ImageDraw.Draw(self.pattern).ellipse((15, 15, 64, 64), fill="blue")

    def test_plan_outputs_full_source_and_clean_guide_image(self):
        plan = dr.build_plan(
            png(self.source),
            [(png(self.pattern), dr.Placement(300, 400, 80, 80, crop=(10, 10, 70, 70)))],
            None,
        )
        self.assertTrue(plan.has_pattern)
        self.assertEqual(plan.size, "3:4")
        work = Image.open(io.BytesIO(plan.work_image)).convert("RGB")
        guide = Image.open(io.BytesIO(plan.guide_image)).convert("RGB")
        self.assertEqual(work.size, self.source.size)
        self.assertEqual(guide.size, self.source.size)
        self.assertEqual(work.tobytes(), self.source.tobytes())
        self.assertEqual([Image.open(io.BytesIO(b)).size for b in plan.pattern_images], [(60, 60)])
        # 图案中心在图2已叠上蓝色新图案，角落外围保持原图不变
        px = guide.getpixel((300, 400))
        self.assertTrue(px[2] > 200 and px[0] < 60, px)
        self.assertEqual(guide.getpixel((5, 5)), self.source.getpixel((5, 5)))

    def test_guide_erases_old_ink_without_grey_smudge(self):
        # 白底原图中间有旧黑字（比新圆更宽），放一个略窄的蓝圆覆盖后，图2里伸出新圆外的旧黑字应擦干净且保持白底
        src = Image.new("RGB", (400, 400), (245, 245, 245))
        ImageDraw.Draw(src).rectangle((158, 192, 242, 208), fill=(25, 25, 25))
        plan = dr.build_plan(png(src), [(png(self.pattern), dr.Placement(200, 200, 100, 100))], None)
        guide = Image.open(io.BytesIO(plan.guide_image)).convert("RGB")
        # 紧邻新圆外侧原本有旧黑字的位置已被擦回干净浅色底，无黑字残留也无大面积灰斑
        for pt in ((162, 200), (238, 200)):
            r, g, b = guide.getpixel(pt)
            self.assertGreater(min(r, g, b), 220, (pt, (r, g, b)))

    def test_plan_with_two_patterns_composites_both_on_full_guide(self):
        red = Image.new("RGB", (40, 40), "red")
        plan = dr.build_plan(png(self.source), [
            (png(self.pattern), dr.Placement(150, 200, 60, 60)),
            (png(red), dr.Placement(450, 600, 40, 40, rotation=20)),
        ], None)
        self.assertEqual([Image.open(io.BytesIO(b)).size for b in plan.pattern_images], [(80, 80), (40, 40)])
        guide = Image.open(io.BytesIO(plan.guide_image)).convert("RGB")
        blue_px = guide.getpixel((150, 200))
        red_px = guide.getpixel((450, 600))
        self.assertTrue(blue_px[2] > 200 and blue_px[0] < 60, blue_px)
        self.assertTrue(red_px[0] > 200 and red_px[2] < 60, red_px)

    def test_pattern_outside_image_is_rejected(self):
        with self.assertRaises(ValueError):
            dr.build_plan(png(self.source), [(png(self.pattern), dr.Placement(-500, -500, 60, 60))], None)

    def test_too_many_patterns_rejected(self):
        item = (png(self.pattern), dr.Placement(300, 300, 40, 40))
        with self.assertRaises(ValueError):
            dr.build_plan(png(self.source), [item] * (dr.MAX_PATTERNS + 1), None)

    def test_inpaint_plan_without_pattern_marks_full_image(self):
        brush = Image.new("L", self.source.size, 0)
        ImageDraw.Draw(brush).rectangle((250, 300, 350, 420), fill=255)
        plan = dr.build_plan(png(self.source), [], png(brush))
        self.assertFalse(plan.has_pattern)
        work = Image.open(io.BytesIO(plan.work_image)).convert("RGB")
        marked = Image.open(io.BytesIO(plan.reference_image)).convert("RGB")
        self.assertEqual(work.size, self.source.size)
        self.assertEqual(marked.size, self.source.size)
        self.assertGreater(marked.getpixel((300, 360))[0], work.getpixel((300, 360))[0])
        with self.assertRaises(ValueError):
            dr.build_plan(png(self.source), [], None)

    def test_prompts(self):
        self.assertIn("图3：新图案素材", dr.build_prompt("", 1))
        text = dr.build_prompt("鞋内侧也要", 2)
        self.assertIn("图3到图4", text)
        self.assertIn("2 个新图案", text)
        self.assertIn("补充说明：鞋内侧也要", text)
        self.assertNotIn("补充说明", dr.build_prompt(""))
        instruction = "保持原图的光影透视还有褶皱，仅作图案修改"
        for count in (1, 2, dr.MAX_PATTERNS):
            self.assertEqual(dr.build_prompt("", count).count(instruction), 1)
        self.assertNotIn(instruction, dr.build_inpaint_prompt("改成红色"))
        self.assertIn("改成蓝色口袋", dr.build_inpaint_prompt("改成蓝色口袋"))


class DetailRepairEndpointTest(unittest.TestCase):
    def setUp(self):
        import json
        import tempfile
        from pathlib import Path
        from unittest.mock import AsyncMock, patch

        from fastapi.testclient import TestClient

        from backend import ai_image, job_store, main
        from backend.config import settings

        self.json = json
        self.main = main
        self.job_store = job_store
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        root = Path(self.temp_dir.name)
        self.user = {"id": "repair-user", "username": "tester", "role": "user"}
        self.background = AsyncMock()
        for patcher in (
            patch.object(job_store, "_DB_PATH", root / "jobs.db"),
            patch.object(main, "_get_session_user", return_value=self.user),
            patch.object(main, "_run_ai_image_background", self.background),
            patch.object(settings, "output_path", root),
            patch.object(ai_image, "_OUTPUT_DIR", root / "ai-images"),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        job_store.init_db()
        self.client = TestClient(main.app)
        self.addCleanup(self.client.close)
        self.source = source_image((600, 800))

    def submit(self, placement, **extra):
        pattern = Image.new("RGB", (50, 50), "blue")
        files = {
            "image": ("source.png", png(self.source), "image/png"),
            "pattern": ("pattern.png", png(pattern), "image/png"),
        }
        return self.client.post("/ai-image/detail-repair", data={
            "placement": self.json.dumps(placement), **extra,
        }, files=files)

    def test_submit_dispatches_full_image_1k_batch(self):
        resp = self.submit({"center_x": 300, "center_y": 400, "width": 80, "height": 80, "rotation": 10},
                           extra_prompt="颜色偏亮")
        self.assertEqual(resp.status_code, 200, resp.text)
        body = resp.json()
        self.assertEqual(len(body["job_ids"]), self.main.DETAIL_REPAIR_BATCH)
        self.assertEqual(self.main.DETAIL_REPAIR_BATCH, 4)
        self.assertEqual(self.background.call_count, 4)
        metas = [self.job_store.load_ai_image_job(j)["request_meta"] for j in body["job_ids"]]
        self.assertEqual(sorted(m["batch_index"] for m in metas), [0, 1, 2, 3])
        self.assertEqual(len({m["detail_repair"]["storage_id"] for m in metas}), 1)
        meta = metas[0]
        self.assertEqual(meta["operation"], "detail-repair")
        self.assertEqual(meta["detail_repair"]["mode"], "full_image")
        kwargs = self.background.call_args.kwargs
        self.assertEqual(kwargs["resolution"], "1K")
        self.assertEqual(kwargs["size"], "3:4")
        self.assertEqual([name for _c, name in kwargs["refs"]],
                         ["01_source_full.png", "02_pattern_overlay.png", "03_pattern.png"])
        self.assertIn("补充说明：颜色偏亮", kwargs["prompt"])

    def test_inpaint_without_pattern(self):
        brush = Image.new("L", self.source.size, 0)
        ImageDraw.Draw(brush).rectangle((100, 100, 200, 200), fill=255)
        files = {
            "image": ("source.png", png(self.source), "image/png"),
            "mask": ("mask.png", png(brush), "image/png"),
        }
        resp = self.client.post("/ai-image/detail-repair", data={"extra_prompt": "去掉污渍"}, files=files)
        self.assertEqual(resp.status_code, 200, resp.text)
        kwargs = self.background.call_args.kwargs
        self.assertEqual([name for _c, name in kwargs["refs"]], ["01_source_full.png", "02_marked_area.png"])
        self.assertIn("去掉污渍", kwargs["prompt"])
        resp = self.client.post("/ai-image/detail-repair", data={}, files=files)
        self.assertEqual(resp.status_code, 400)

    def test_submit_two_patterns_sends_one_reference_per_pattern(self):
        files = [
            ("image", ("source.png", png(self.source), "image/png")),
            ("pattern", ("a.png", png(Image.new("RGB", (50, 50), "blue")), "image/png")),
            ("pattern", ("b.png", png(Image.new("RGB", (40, 40), "red")), "image/png")),
        ]
        placements = [{"center_x": 150, "center_y": 200, "width": 60, "height": 60},
                      {"center_x": 450, "center_y": 600, "width": 40, "height": 40, "rotation": 15}]
        resp = self.client.post("/ai-image/detail-repair", data={"placement": self.json.dumps(placements)}, files=files)
        self.assertEqual(resp.status_code, 200, resp.text)
        kwargs = self.background.call_args.kwargs
        self.assertEqual([name for _c, name in kwargs["refs"]],
                         ["01_source_full.png", "02_pattern_overlay.png", "03_pattern_1.png", "04_pattern_2.png"])
        self.assertIn("图3到图4", kwargs["prompt"])
        meta = self.job_store.load_ai_image_job(resp.json()["job_id"])["request_meta"]
        self.assertEqual([r["label"] for r in meta["reference_images"]],
                         ["图1 · 完整原图", "图2 · 叠加效果", "图3 · 图案样式 1", "图4 · 图案样式 2"])
        resp = self.client.post("/ai-image/detail-repair", data={"placement": self.json.dumps(placements[:1])}, files=files)
        self.assertEqual(resp.status_code, 400)

    def test_rejects_bad_placement_and_pattern_outside(self):
        self.assertEqual(self.submit({"center_x": 1}).status_code, 400)
        resp = self.submit({"center_x": -900, "center_y": -900, "width": 50, "height": 50})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("不在原图范围内", resp.json()["detail"])
        self.background.assert_not_called()


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import io
import unittest

from PIL import Image, ImageChops, ImageDraw

from backend import detail_repair as dr


def png(image: Image.Image) -> bytes:
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


def source_image(size=(800, 1000)) -> Image.Image:
    # 有渐变的底图，方便检查区域外像素是否被改动
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
        # 横条顺时针转 90° 变竖条
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


class PlanBoxTest(unittest.TestCase):
    def test_box_contains_region_and_matches_supported_ratio(self):
        region = (300, 400, 380, 460)
        box, size = dr.plan_box(region, (800, 1000))
        self.assertLessEqual(box[0], region[0])
        self.assertLessEqual(box[1], region[1])
        self.assertGreaterEqual(box[2], region[2])
        self.assertGreaterEqual(box[3], region[3])
        ratio = dict(dr.SUPPORTED_RATIOS)[size]
        self.assertAlmostEqual((box[2] - box[0]) / (box[3] - box[1]), ratio, delta=0.02)

    def test_box_near_edge_stays_inside_image(self):
        for region in [(0, 0, 50, 50), (760, 950, 800, 1000), (0, 400, 800, 500)]:
            box, _ = dr.plan_box(region, (800, 1000))
            self.assertGreaterEqual(box[0], 0)
            self.assertGreaterEqual(box[1], 0)
            self.assertLessEqual(box[2], 800)
            self.assertLessEqual(box[3], 1000)
            self.assertLessEqual(box[0], region[0])
            self.assertGreaterEqual(box[2], region[2])


class PlanAndPasteBackTest(unittest.TestCase):
    def setUp(self):
        self.source = source_image()
        # 平滑渐变的“面料”，贴回测试用（模型结果缩放后不会因为锐利的色带产生大误差）
        self.smooth = Image.linear_gradient("L").resize((800, 1000)).convert("RGB")
        self.smooth = Image.merge("RGB", [
            self.smooth.getchannel(0).point(lambda v: 60 + v // 4),
            self.smooth.getchannel(1).point(lambda v: 70 + v // 5),
            Image.new("L", (800, 1000), 90),
        ])
        self.pattern = Image.new("RGB", (60, 60), "white")
        ImageDraw.Draw(self.pattern).ellipse((10, 10, 49, 49), fill="blue")

    def test_plan_outputs_upscaled_work_image_and_region(self):
        brush = Image.new("L", self.source.size, 0)
        ImageDraw.Draw(brush).rectangle((380, 480, 470, 560), fill=255)
        plan = dr.build_plan(
            png(self.source), [(png(self.pattern), dr.Placement(420, 520, 60, 60, crop=(10, 10, 50, 50)))],
            png(brush),
        )
        work = Image.open(io.BytesIO(plan.work_image))
        self.assertEqual(max(work.size), dr.MIN_WORK_SIDE)
        self.assertEqual([Image.open(io.BytesIO(b)).size for b in plan.pattern_images], [(40, 40)])
        # 图1 是未遮挡的原图局部，图2 才叠了图案
        guide = Image.open(io.BytesIO(plan.guide_image)).convert("RGB")
        self.assertEqual(guide.size, work.size)
        x0, y0, x1, y1 = plan.box
        expected = self.source.crop(plan.box).resize(work.size, Image.LANCZOS).convert("RGB")
        self.assertEqual(work.convert("RGB").tobytes(), expected.tobytes())
        cx = round((420 - x0) * work.width / (x1 - x0)); cy = round((520 - y0) * work.height / (y1 - y0))
        self.assertNotEqual(work.convert("RGB").getpixel((cx, cy)), guide.getpixel((cx, cy)))
        self.assertEqual(guide.getpixel((cx, cy))[2] > 200 and guide.getpixel((cx, cy))[0] < 60, True)
        # 修复区域 = 涂抹 ∪ 图案
        self.assertEqual(plan.region_mask.getbbox(), (380, 480, 471, 561))
        x0, y0, x1, y1 = plan.box
        self.assertTrue(x0 <= 380 and y0 <= 480 and x1 >= 471 and y1 >= 561)

    def test_pattern_outside_image_is_rejected(self):
        with self.assertRaises(ValueError):
            dr.build_plan(png(self.source), [(png(self.pattern), dr.Placement(-500, -500, 60, 60))], None)

    def test_plan_with_two_patterns_covers_both_and_keeps_each_pattern(self):
        red = Image.new("RGB", (30, 30), "red")
        plan = dr.build_plan(png(self.source), [
            (png(self.pattern), dr.Placement(150, 200, 60, 60, crop=(10, 10, 50, 50))),
            (png(red), dr.Placement(450, 600, 40, 40, rotation=20)),
        ], None)
        self.assertEqual([Image.open(io.BytesIO(b)).size for b in plan.pattern_images], [(40, 40), (30, 30)])
        # 修复区域同时包含两个图案，局部框也把两处都框进去
        x0, y0, x1, y1 = plan.region_mask.getbbox()
        self.assertTrue(x0 <= 120 and y0 <= 170 and x1 >= 470 and y1 >= 620)
        bx0, by0, bx1, by1 = plan.box
        self.assertTrue(bx0 <= x0 and by0 <= y0 and bx1 >= x1 and by1 >= y1)
        # 图2 两处都叠了图案
        guide = Image.open(io.BytesIO(plan.guide_image)).convert("RGB")
        k = guide.width / (bx1 - bx0)
        blue = guide.getpixel((round((150 - bx0) * k), round((200 - by0) * k)))
        redpx = guide.getpixel((round((450 - bx0) * k), round((600 - by0) * k)))
        self.assertTrue(blue[2] > 200 and blue[0] < 60, blue)
        self.assertTrue(redpx[0] > 200 and redpx[2] < 60, redpx)

    def test_too_many_patterns_rejected(self):
        item = (png(self.pattern), dr.Placement(300, 300, 40, 40))
        with self.assertRaises(ValueError):
            dr.build_plan(png(self.source), [item] * (dr.MAX_PATTERNS + 1), None)

    def test_multi_pattern_prompt_numbers_references(self):
        self.assertIn("图3：新图案素材", dr.build_prompt("", 1))
        text = dr.build_prompt("鞋内侧也要", 2)
        self.assertIn("图3到图4", text)
        self.assertIn("2 个新图案", text)
        self.assertIn("补充说明：鞋内侧也要", text)

    def _fake_model_result(self, plan, shift=-30, logo=(255, 255, 255)):
        """模拟模型输出：整体偏暗（色调漂移），图案中心多一块白色。"""
        x0, y0, x1, y1 = plan.box
        local = self.smooth.crop(plan.box)
        shifted = Image.eval(local, lambda v: max(0, min(255, v + shift)))
        draw = ImageDraw.Draw(shifted)
        draw.rectangle((400 - 15 - x0, 500 - 15 - y0, 400 + 15 - x0, 500 + 15 - y0), fill=logo)
        return shifted.resize((1024, round(1024 * (y1 - y0) / (x1 - x0))), Image.LANCZOS)

    def test_paste_back_keeps_pixels_outside_region(self):
        plan = dr.build_plan(png(self.smooth), [(png(self.pattern), dr.Placement(400, 500, 80, 80))], None)
        out = dr.paste_back(self.smooth, self._fake_model_result(plan), plan.box, plan.region_mask)
        self.assertEqual(out.size, self.smooth.size)
        diff_bbox = ImageChops.difference(out, self.smooth).getbbox()
        self.assertIsNotNone(diff_bbox)
        # 改动只出现在修复区域外扩 + 羽化的范围内
        rx0, ry0, rx1, ry1 = plan.region_mask.getbbox()
        slack = dr.MASK_GROW_PX + 4 * dr.MIN_FEATHER_PX + 4
        self.assertGreaterEqual(diff_bbox[0], rx0 - slack)
        self.assertGreaterEqual(diff_bbox[1], ry0 - slack)
        self.assertLessEqual(diff_bbox[2], rx1 + slack)
        self.assertLessEqual(diff_bbox[3], ry1 + slack)

    def test_paste_back_corrects_tone_shift_and_keeps_unchanged_fabric(self):
        plan = dr.build_plan(png(self.smooth), [(png(self.pattern), dr.Placement(400, 500, 80, 80))], None)
        out = dr.paste_back(self.smooth, self._fake_model_result(plan), plan.box, plan.region_mask)
        # 新图案贴上了
        self.assertTrue(all(v >= 235 for v in out.getpixel((400, 500))))
        # 修复区域里模型只是整体变暗的地方：色调被校正回原图，不出现一块偏暗的方块
        for pt in ((370, 470), (430, 530), (370, 530)):
            got, want = out.getpixel(pt), self.smooth.getpixel(pt)
            self.assertTrue(all(abs(a - b) <= 4 for a, b in zip(got, want)), (pt, got, want))

    def test_paste_back_leaves_no_outline_of_removed_old_logo(self):
        # 原图：均匀底色上有个旧 logo，边上一圈只比底色暗 12 的淡边（压缩/抗锯齿常见）
        bg = 230
        source = Image.new("RGB", (400, 400), (bg, bg, bg))
        draw = ImageDraw.Draw(source)
        draw.rectangle((170, 170, 230, 230), fill=(bg - 12,) * 3)
        draw.rectangle((174, 174, 226, 226), fill=(40, 40, 40))
        plan = dr.build_plan(png(source), [(png(self.pattern), dr.Placement(200, 200, 120, 120))], None)
        x0, y0, x1, y1 = plan.box
        # 模型结果：旧 logo 去掉了，底色干净，中间是新图案
        result = Image.new("RGB", (x1 - x0, y1 - y0), (bg, bg, bg))
        ImageDraw.Draw(result).ellipse((190 - x0, 190 - y0, 210 - x0, 210 - y0), fill="blue")
        out = dr.paste_back(source, result.resize((1024, 1024)), plan.box, plan.region_mask)
        # 旧 logo 的淡边位置不能残留半透明的轮廓
        for pt in ((171, 200), (200, 171), (229, 200), (200, 229), (172, 172)):
            self.assertTrue(all(abs(v - bg) <= 3 for v in out.getpixel(pt)), (pt, out.getpixel(pt)))

    def test_inpaint_plan_without_pattern_uses_brush_only(self):
        brush = Image.new("L", self.source.size, 0)
        ImageDraw.Draw(brush).rectangle((300, 300, 360, 380), fill=255)
        plan = dr.build_plan(png(self.source), [], png(brush))
        self.assertFalse(plan.has_pattern)
        self.assertEqual(plan.region_mask.getbbox(), (300, 300, 361, 381))
        work = Image.open(io.BytesIO(plan.work_image)).convert("RGB")
        marked = Image.open(io.BytesIO(plan.reference_image)).convert("RGB")
        self.assertEqual(work.size, marked.size)
        # 图2 在涂抹区中心偏红，图1 保持原样
        cx, cy = work.width // 2, work.height // 2
        self.assertGreater(marked.getpixel((cx, cy))[0], work.getpixel((cx, cy))[0])
        with self.assertRaises(ValueError):
            dr.build_plan(png(self.source), [], None)

    def test_inpaint_prompt_contains_instruction(self):
        self.assertIn("改成蓝色口袋", dr.build_inpaint_prompt("改成蓝色口袋"))

    def test_prompt_includes_extra_text(self):
        self.assertIn("补充说明：图案偏亮一点", dr.build_prompt("图案偏亮一点"))
        self.assertNotIn("补充说明", dr.build_prompt(""))


if __name__ == "__main__":
    unittest.main()


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

    def test_submit_saves_plan_and_paste_back_produces_full_image(self):
        resp = self.submit({"center_x": 300, "center_y": 400, "width": 80, "height": 80, "rotation": 10},
                           extra_prompt="颜色偏亮")
        self.assertEqual(resp.status_code, 200, resp.text)
        body = resp.json()
        # 一次提交固定生成 4 张供挑选，共用同一份贴回输入
        self.assertEqual(len(body["job_ids"]), self.main.DETAIL_REPAIR_BATCH)
        self.assertEqual(self.main.DETAIL_REPAIR_BATCH, 4)
        self.assertEqual(self.background.call_count, 4)
        metas = [self.job_store.load_ai_image_job(j)["request_meta"] for j in body["job_ids"]]
        self.assertEqual(sorted(m["batch_index"] for m in metas), [0, 1, 2, 3])
        self.assertEqual(len({m["detail_repair"]["storage_id"] for m in metas}), 1)
        job = self.job_store.load_ai_image_job(body["job_id"])
        meta = job["request_meta"]
        self.assertEqual(meta["operation"], "detail-repair")
        self.assertEqual(len(meta["detail_repair"]["box"]), 4)
        kwargs = self.background.call_args.kwargs
        self.assertEqual([name for _c, name in kwargs["refs"]], ["01_source_area.png", "02_pattern_overlay.png", "03_pattern.png"])
        self.assertIn("补充说明：颜色偏亮", kwargs["prompt"])

        # 模拟模型生成的局部图，走贴回
        raw_dir = self.main.settings.output_path / "ai-images" / "repair-user"
        raw_dir.mkdir(parents=True, exist_ok=True)
        (raw_dir / "raw.png").write_bytes(png(Image.new("RGB", (1024, 1024), (0, 255, 0))))
        url = self.main._finish_detail_repair("repair-user", body["job_id"], meta, "/ai-images/repair-user/raw.png")
        out_path = self.main._resolve_public_asset_path(url)
        with Image.open(out_path) as merged:
            self.assertEqual(merged.size, self.source.size)
            # 修复区域被模型结果改动（具体颜色会经过色调校正，不再逐像素等于模型输出）
            self.assertNotEqual(merged.convert("RGB").getpixel((300, 400)), self.source.getpixel((300, 400)))
            self.assertEqual(merged.convert("RGB").getpixel((5, 5)), self.source.getpixel((5, 5)))

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
        self.assertEqual([name for _c, name in kwargs["refs"]], ["01_repair_area.png", "02_marked_area.png"])
        self.assertIn("去掉污渍", kwargs["prompt"])
        # 没有说明文字时拒绝
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
                         ["01_source_area.png", "02_pattern_overlay.png", "03_pattern_1.png", "04_pattern_2.png"])
        self.assertIn("图3到图4", kwargs["prompt"])
        meta = self.job_store.load_ai_image_job(resp.json()["job_id"])["request_meta"]
        self.assertEqual([r["label"] for r in meta["reference_images"]],
                         ["图1 · 原图区域", "图2 · 叠加效果", "图3 · 图案样式 1", "图4 · 图案样式 2"])
        # 图案数和摆放参数数对不上时拒绝
        resp = self.client.post("/ai-image/detail-repair", data={"placement": self.json.dumps(placements[:1])}, files=files)
        self.assertEqual(resp.status_code, 400)

    def test_rejects_bad_placement_and_pattern_outside(self):
        self.assertEqual(self.submit({"center_x": 1}).status_code, 400)
        resp = self.submit({"center_x": -900, "center_y": -900, "width": 50, "height": 50})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("不在原图范围内", resp.json()["detail"])
        self.background.assert_not_called()

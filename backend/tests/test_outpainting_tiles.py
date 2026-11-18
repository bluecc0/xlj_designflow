"""分块扩图：规划、拼接、逐块执行与断点续跑、后端任务接入。"""
import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image

from backend import main as app_main
from backend import outpainting_tiles as ot
from backend.bfl_outpainting import (
    FAST_SAFE_OUTPUT_PIXELS,
    MAX_OUTPUT_PIXELS,
    BflOutpaintingError,
    BflOutpaintingResult,
    OutpaintingValidationError,
)

CASES = [
    # (原图宽, 原图高, 边距, 模式)
    (1500, 2000, {"left": 350, "right": 350, "top": 135, "bottom": 135}, "fast"),
    (2000, 2000, {"left": 118, "right": 118, "top": 118, "bottom": 118}, "fast"),
    (2000, 2000, {"left": 118, "right": 118, "top": 118, "bottom": 118}, "high"),
    (4000, 1000, {"top": 120, "bottom": 120}, "fast"),
    (4000, 700, {"top": 500}, "fast"),
    (1000, 1000, {"left": 1200, "right": 1200, "top": 0, "bottom": 0}, "fast"),
    (800, 2400, {"top": 0, "bottom": 0, "left": 0, "right": 1300}, "high"),
    (2048, 2048, {"left": 0, "right": 300, "top": 0, "bottom": 0}, "fast"),
]


def _final_size(w, h, m):
    return w + m.get("left", 0) + m.get("right", 0), h + m.get("top", 0) + m.get("bottom", 0)


class PlanTilesTest(unittest.TestCase):
    def test_every_tile_fits_one_upstream_call_and_new_areas_cover_the_canvas(self):
        for w, h, m, mode in CASES:
            with self.subTest(size=(w, h), margins=m, mode=mode):
                W, H = _final_size(w, h, m)
                limits = ot.tile_limits(mode)
                tiles = ot.plan_tiles(source_width=w, source_height=h, margins=m, **limits)
                known = np.zeros((H, W), dtype=bool)
                top, left = m.get("top", 0), m.get("left", 0)
                known[top:top + h, left:left + w] = True
                for tile in tiles:
                    ow, oh = tile.output_size
                    self.assertLessEqual(ow * oh, limits["max_pixels"])
                    self.assertLessEqual(max(ow, oh), 4096)
                    k = tile.known
                    if mode == "fast":
                        self.assertLessEqual(max(k.width, k.height), min(k.width, k.height) * 8)
                    # 发给上游的参考区域必须已经有内容
                    self.assertTrue(known[k.y0:k.y1, k.x0:k.x1].all())
                    a = tile.new_area
                    self.assertTrue(0 <= a.x0 < a.x1 <= W and 0 <= a.y0 < a.y1 <= H)
                    known[a.y0:a.y1, a.x0:a.x1] = True
                self.assertTrue(known.all(), "最终画面有区域没被任何一块覆盖")

    def test_large_depth_is_split_into_layers(self):
        tiles = ot.plan_tiles(source_width=1000, source_height=1000,
                              margins={"left": 1200, "right": 1200}, **ot.tile_limits("fast"))
        left_depths = [t.depth for t in tiles if t.side == "left"]
        self.assertEqual(sum(left_depths), 1200)

    def test_long_band_is_split_into_overlapping_segments(self):
        # 4000 宽的条带一次放不下足够的参考深度，要沿长度切段
        tiles = ot.plan_tiles(source_width=4000, source_height=700,
                              margins={"top": 500}, **ot.tile_limits("fast"))
        top = [t for t in tiles if t.side == "top"]
        self.assertGreater(len(top), 1)
        self.assertEqual(top[0].overlap, 0)
        self.assertTrue(all(t.overlap > 0 for t in top[1:]))


class GeometryTest(unittest.TestCase):
    def test_needs_tiling_uses_single_call_limit_per_mode(self):
        m = {"right": 101}
        self.assertFalse(ot.needs_tiling(1900, 1900, {"right": 100}, "fast"))
        self.assertTrue(ot.needs_tiling(1900, 1900, m, "fast"))
        self.assertFalse(ot.needs_tiling(1900, 1900, m, "high"))
        self.assertTrue(ot.needs_tiling(2048, 2048, {"right": 1}, "high"))

    def test_tiled_geometry_accepts_up_to_5mp_and_rejects_more(self):
        g = ot.tiled_geometry(processing_width=2000, processing_height=2000, top=118, right=118,
                              bottom=118, left=118, mode="fast")
        self.assertEqual((g.expected_width, g.expected_height), (2236, 2236))
        self.assertGreater(g.expected_width * g.expected_height, MAX_OUTPUT_PIXELS)
        with self.assertRaisesRegex(OutpaintingValidationError, "5000000"):
            ot.tiled_geometry(processing_width=2048, processing_height=2048, top=0, right=500,
                              bottom=0, left=0, mode="fast")
        with self.assertRaisesRegex(OutpaintingValidationError, "4096"):
            ot.tiled_geometry(processing_width=1000, processing_height=1000, top=0, right=3200,
                              bottom=0, left=0, mode="high")


def _truth(W, H):
    """一张平滑的“真实画面”，用来模拟上游结果。"""
    x = np.linspace(0, 1, W)[None, :]
    y = np.linspace(0, 1, H)[:, None]
    r = 60 + 120 * x + 0 * y
    g = 80 + 100 * y + 0 * x
    b = 120 + 60 * x * y
    return Image.fromarray(np.dstack([r, g, b]).astype(np.uint8), "RGB")


def _fake_result(truth, canvas, tile, *, edge_shift=0):
    """上游结果：已知区域是画布原样（紧贴边界的一圈可选整体偏亮，模拟上游重画），新区域取 truth。"""
    k, a = tile.known, tile.new_area
    x0, y0 = min(k.x0, a.x0), min(k.y0, a.y0)
    x1, y1 = max(k.x1, a.x1), max(k.y1, a.y1)
    out = truth.crop((x0, y0, x1, y1))
    out.paste(canvas.crop((k.x0, k.y0, k.x1, k.y1)), (k.x0 - x0, k.y0 - y0))
    if edge_shift:
        arr = np.asarray(out).astype(int)
        band = 24
        if tile.side == "left":
            arr[:, a.width:a.width + band] += edge_shift
        elif tile.side == "right":
            arr[:, k.width - band:k.width] += edge_shift
        elif tile.side == "top":
            arr[a.height:a.height + band, :] += edge_shift
        else:
            arr[k.height - band:k.height, :] += edge_shift
        out = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")
    return out


class PasteTileTest(unittest.TestCase):
    def test_paste_keeps_source_pixels_beyond_edge_blend_and_fills_new_area(self):
        w, h, m = 1500, 2000, {"left": 350, "right": 350, "top": 135, "bottom": 135}
        W, H = _final_size(w, h, m)
        truth = _truth(W, H)
        source = Image.new("RGB", (w, h), (10, 200, 30))
        canvas = Image.new("RGB", (W, H), (255, 0, 255))
        canvas.paste(source, (m["left"], m["top"]))
        for tile in ot.plan_tiles(source_width=w, source_height=h, margins=m, **ot.tile_limits("fast")):
            ot.paste_tile(canvas, tile, _fake_result(truth, canvas, tile, edge_shift=6))
        arr = np.asarray(canvas)
        e = ot.EDGE_BLEND
        inner = arr[m["top"] + e:m["top"] + h - e, m["left"] + e:m["left"] + w - e]
        self.assertTrue((inner == (10, 200, 30)).all())
        # 没有洋红色缺口
        self.assertFalse(((arr == (255, 0, 255)).all(axis=2)).any())
        # 新区域远离接缝的位置就是上游结果
        np.testing.assert_array_equal(arr[1000, :300], np.asarray(truth)[1000, :300])

    def test_wrong_result_size_is_rejected(self):
        tile = ot.OutpaintTile(side="left", known=ot.Rect(100, 0, 600, 500), depth=100, overlap=0)
        with self.assertRaises(ValueError):
            ot.paste_tile(Image.new("RGB", (600, 500)), tile, Image.new("RGB", (500, 500)))


class RunTiledOutpaintingTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.work = Path(self.tmp.name)
        self.w, self.h = 1500, 2000
        self.m = {"left": 350, "right": 350, "top": 135, "bottom": 135}
        self.source_path = self.work / "source.png"
        Image.new("RGB", (self.w, self.h), (10, 200, 30)).save(self.source_path)
        self.geometry = ot.tiled_geometry(processing_width=self.w, processing_height=self.h,
                                          mode="fast", **self.m)
        self.tiles = ot.plan_job_tiles(self.geometry, self.w, self.h, "fast")
        self.truth = _truth(self.geometry.expected_width, self.geometry.expected_height)
        self.persisted = []

    def tearDown(self):
        self.tmp.cleanup()

    async def persist(self, state):
        self.persisted.append(dict(state))

    def make_run_tile(self, calls, *, fail=None):
        async def run_tile(*, index, tile, input_path, provider_task_id, polling_url, on_accepted):
            calls.append((index, provider_task_id))
            if fail:
                await fail(index, provider_task_id, on_accepted)
            with Image.open(input_path) as known:
                canvas = Image.new("RGB", (self.geometry.expected_width, self.geometry.expected_height))
                canvas.paste(known, (tile.known.x0, tile.known.y0))
            return _fake_result(self.truth, canvas, tile), 0.05
        return run_tile

    async def run_job(self, state, run_tile):
        return await ot.run_tiled_outpainting(
            work_dir=self.work, source_path=self.source_path, geometry=self.geometry,
            tiles=self.tiles, state=state, run_tile=run_tile, persist=self.persist, retry_delay=0,
        )

    async def test_all_tiles_run_once_and_cost_is_summed(self):
        calls, state = [], {}
        canvas = await self.run_job(state, self.make_run_tile(calls))
        self.assertEqual([c[0] for c in calls], list(range(len(self.tiles))))
        self.assertEqual(state["tiles_done"], len(self.tiles))
        self.assertAlmostEqual(state["tiles_cost"], 0.05 * len(self.tiles))
        self.assertEqual(canvas.size, (self.geometry.expected_width, self.geometry.expected_height))
        self.assertTrue((self.work / "canvas.png").is_file())

    async def test_restart_continues_from_next_tile_using_saved_canvas(self):
        calls, state = [], {}

        async def crash_on_tile_2(index, _task, _accepted):
            if index == 2:
                raise asyncio.CancelledError()

        with self.assertRaises(asyncio.CancelledError):
            await self.run_job(state, self.make_run_tile(calls, fail=crash_on_tile_2))
        self.assertEqual(state["tiles_done"], 2)
        calls.clear()
        canvas = await self.run_job(state, self.make_run_tile(calls))
        self.assertEqual([c[0] for c in calls], list(range(2, len(self.tiles))))
        uninterrupted = await ot.run_tiled_outpainting(
            work_dir=Path(tempfile.mkdtemp(dir=self.tmp.name)), source_path=self.source_path,
            geometry=self.geometry, tiles=self.tiles, state={}, run_tile=self.make_run_tile([]),
            persist=self.persist, retry_delay=0,
        )
        np.testing.assert_array_equal(np.asarray(canvas), np.asarray(uninterrupted))

    async def test_accepted_tile_is_polled_again_not_resubmitted(self):
        calls, state = [], {}

        async def poll_fails_once(index, task_id, on_accepted):
            if index == 1 and not task_id:
                await on_accepted("task-1", "https://api.bfl.ai/poll/1")
                raise BflOutpaintingError("timeout", retry_action="poll")

        await self.run_job(state, self.make_run_tile(calls, fail=poll_fails_once))
        self.assertEqual([c for c in calls if c[0] == 1], [(1, ""), (1, "task-1")])

    async def test_rejected_tile_is_resubmitted(self):
        calls, state = [], {}

        async def rejected_once(index, task_id, on_accepted):
            if index == 0 and len(calls) == 1:
                await on_accepted("task-0", "https://api.bfl.ai/poll/0")
                raise BflOutpaintingError("moderated", retry_action="none")

        await self.run_job(state, self.make_run_tile(calls, fail=rejected_once))
        self.assertEqual([c for c in calls if c[0] == 0], [(0, ""), (0, "")])

    async def test_tile_failing_every_attempt_fails_the_job(self):
        calls = []

        async def always(index, _task, _accepted):
            if index == 1:
                raise BflOutpaintingError("down")

        with self.assertRaises(BflOutpaintingError):
            await self.run_job({}, self.make_run_tile(calls, fail=always))
        self.assertEqual(sum(1 for c in calls if c[0] == 1), ot.TILE_MAX_ATTEMPTS)


class TiledJobIntegrationTest(unittest.IsolatedAsyncioTestCase):
    """后端任务：提交时判定分块、后台逐块调上游、落库为一张图。"""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.saved = []
        self.patches = [
            patch.object(app_main.settings, "output_path", self.root),
            patch.object(app_main.settings, "bfl_api_key", "bfl-test-key"),
            patch.object(app_main, "save_ai_image_job", side_effect=lambda **kw: self.saved.append(kw)),
            patch.object(app_main, "load_ai_image_job", return_value=None),
            patch.object(app_main, "generate_inspiration_thumb"),
            patch.object(app_main, "log_operation"),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        self.tmp.cleanup()

    async def test_large_job_is_split_and_saved_as_one_image(self):
        w, h = 1500, 2000
        m = {"left": 350, "right": 350, "top": 135, "bottom": 135}
        geometry = ot.tiled_geometry(processing_width=w, processing_height=h, mode="fast", **m)
        snapshot_dir = self.root / "ai-images" / "u1" / "outpainting" / "job1"
        snapshot_dir.mkdir(parents=True)
        Image.new("RGB", (w, h), (10, 200, 30)).save(snapshot_dir / "source.png")
        submitted = []

        async def fake_run_outpainting(*, prepared, geometry, provider_task_id, output_root, user_id,
                                       job_id, submit_request, on_accepted, **_):
            submitted.append((geometry.expected_width * geometry.expected_height, submit_request))
            self.assertLessEqual(geometry.provider_width * geometry.provider_height, FAST_SAFE_OUTPUT_PIXELS)
            await on_accepted(f"task-{len(submitted)}", "https://api.bfl.ai/poll")
            out = Image.new("RGB", (geometry.expected_width, geometry.expected_height), (90, 90, 90))
            path = output_root / "ai-images" / user_id / "tmp" / f"{job_id}.png"
            path.parent.mkdir(parents=True, exist_ok=True)
            out.save(path)
            return BflOutpaintingResult(f"/ai-images/{user_id}/tmp/{job_id}.png", "t", "p", 0.05,
                                        out.width, out.height)

        meta = {"processing_width": w, "processing_height": h, "mode": "fast", "tiled": True,
                "source_snapshot_url": "/ai-images/u1/outpainting/job1/source.png",
                "expected_width": geometry.expected_width, "expected_height": geometry.expected_height, **m}
        with patch.object(app_main, "run_outpainting", side_effect=fake_run_outpainting):
            await app_main._run_tiled_outpainting_background("job1", {"id": "u1"}, geometry, meta, 0.0)

        final = self.saved[-1]
        self.assertEqual(final["status"], "done", final.get("error"))
        self.assertEqual(len(submitted), len(ot.plan_job_tiles(geometry, w, h, "fast")))
        self.assertTrue(all(s for _, s in submitted))
        out_path = self.root / "ai-images" / final["image_url"].removeprefix("/ai-images/")
        with Image.open(out_path) as result:
            self.assertEqual(result.size, (geometry.expected_width, geometry.expected_height))
        self.assertAlmostEqual(final["request_meta"]["cost"], 0.05 * len(submitted))
        self.assertFalse(snapshot_dir.exists(), "完成后临时画布和原图快照应清理")
        self.assertFalse(list((self.root / "ai-images" / "u1" / "tmp").glob("*.png")), "每块的中间结果应删除")

    async def test_submit_marks_large_job_as_tiled(self):
        tracked = []
        with (
            patch.object(app_main.settings, "bfl_outpainting_enabled", True),
            patch.object(app_main.settings, "outpaint_max_area_pixels", 5_000_000),
            patch.object(app_main, "load_ai_image_job_by_client_request_id", return_value=None),
            patch.object(app_main, "persist_prepared_source_snapshot", return_value="/ai-images/u1/outpainting/x/source.png"),
            patch.object(app_main, "_track_outpainting_task", side_effect=lambda coro, **_: (tracked.append(coro.__qualname__), coro.close())),
        ):
            from backend.tests.test_bfl_outpainting import png_data_uri
            await app_main.submit_outpainting_job(
                {"id": "u1"}, {"outpaint": {"left": 118, "right": 118, "top": 118, "bottom": 118}},
                source=png_data_uri((2000, 2000)), source_kind="data_uri", source_image_url=None,
                client_request_id="c1", mode="fast",
            )
        meta = self.saved[-1]["request_meta"]
        self.assertTrue(meta["tiled"])
        self.assertEqual((meta["expected_width"], meta["expected_height"]), (2236, 2236))
        self.assertEqual(tracked, ["_run_tiled_outpainting_background"])

    async def test_recovery_resumes_tiled_job(self):
        meta = {"operation": "outpainting", "tiled": True, "processing_width": 1500, "processing_height": 2000,
                "left": 350, "right": 350, "top": 135, "bottom": 135, "mode": "fast",
                "expected_width": 2200, "expected_height": 2270, "phase": "tiling", "tiles_done": 2}
        tracked = []
        with (
            patch.object(app_main, "load_active_outpainting_jobs",
                         return_value=[{"id": "job1", "user_id": "u1", "request_meta": meta, "created_at": 1.0}]),
            patch.object(app_main, "_track_outpainting_task", side_effect=lambda coro, **_: (tracked.append(coro.__qualname__), coro.close())),
        ):
            await app_main._recover_outpainting_jobs()
        self.assertEqual(tracked, ["_run_tiled_outpainting_background"])
        self.assertFalse(any(s["status"] == "failed" for s in self.saved))


if __name__ == "__main__":
    unittest.main()

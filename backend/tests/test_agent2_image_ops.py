from __future__ import annotations

import asyncio
import io
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from PIL import Image

from backend import job_store
from backend.agent2 import image_ops, routes, service, store
from backend.agent2 import tools as a2tools
from backend.tests.test_agent2_engine import FakeModel, _collect, _events


def _png(size=(40, 50)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, "white").save(buf, format="PNG")
    return buf.getvalue()


class Agent2ImageOpsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_patch = patch.object(job_store, "_DB_PATH", Path(self.tmp.name) / "a2.db")
        self.db_patch.start()
        job_store.init_db()
        store.init_tables()
        self.user = {"id": "u1", "username": "tester"}
        self.session = store.create_session("u1")
        src = Path(self.tmp.name) / "src.png"
        src.write_bytes(_png())
        self.source = store.create_artifact(session_id=self.session["id"], user_id="u1", kind="upload",
                                            url="/output/src.png", path=str(src))
        self.result = Path(self.tmp.name) / "result.png"
        self.result.write_bytes(_png())
        self.started = []

        def start_image_operation(user, operation, job_id, src_path, image_url, *, scale=None, extra_meta=None):
            self.started.append({"operation": operation, "src": src_path, "url": image_url, "meta": extra_meta})
            url = "/ai-images/u1/layer.psd" if operation == "layer_extract" else "/ai-images/u1/result.png"
            job_store.save_ai_image_job(job_id=job_id, user_id="u1", status="done", model=f"local-{operation}",
                                        prompt=operation, size="", image_url=url, progress=100,
                                        request_meta={"operation": operation, **(extra_meta or {})},
                                        prompt_trace='{"layers": [1, 2, 3]}')

        self.main = MagicMock()
        self.main.start_image_operation.side_effect = start_image_operation
        self.main._resolve_public_asset_path.return_value = self.result
        self.patches = [
            patch.object(a2tools, "_main", lambda: self.main),
            patch.object(image_ops, "_main", lambda: self.main),
            patch.object(image_ops, "JOB_POLL_SECONDS", 0.01),
            patch.object(service, "tools_factory", a2tools.build_tools),
            patch.object(service, "_user_skill_dir", lambda user: None),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.db_patch.stop()
        self.tmp.cleanup()

    def _run(self, steps, text="处理一下这张图"):
        model = FakeModel(steps)
        with patch.object(service, "model_factory", lambda: model):
            session = store.get_session(self.session["id"], "u1")
            return _events(asyncio.run(_collect(service.start_turn(self.user, session, text, [])))), model

    def test_remove_background_reuses_platform_job_and_delivers_image(self):
        events, model = self._run([
            [("call", "remove_background", {"image_id": self.source["id"]})],
            [("text", "抠好了。")],
        ], "把这张图的背景去掉")
        started = self.started[0]
        self.assertEqual(started["operation"], "matting")
        self.assertEqual(started["url"], "/output/src.png")
        self.assertEqual(started["meta"]["source"], "agent2")
        self.assertEqual(started["meta"]["session_id"], self.session["id"])
        created = [e for e in events if e["type"] == "artifact.created"]
        self.assertEqual(len(created), 1)
        finished = next(e for e in events if e["type"] == "tool.finished")
        self.assertTrue(finished["payload"]["ok"])
        image_id = finished["payload"]["result"]["images"][0]["id"]
        self.assertEqual(created[0]["payload"]["artifact"]["id"], image_id)
        self.assertIn(image_id, [m for m in model.seen[1] if m["role"] == "tool"][0]["content"])
        # 处理类任务随工具调用结束，不计入重启后的补图轮询
        self.assertEqual(store.count_pending_image_jobs(self.session["id"]), 0)

    def test_split_layers_returns_psd_as_download_not_image(self):
        events, _ = self._run([
            [("call", "split_layers", {"image_id": self.source["id"]})],
            [("text", "拆好了。")],
        ], "转成分层 PSD")
        self.assertEqual(self.started[0]["operation"], "layer_extract")
        created = [e["payload"]["artifact"] for e in events if e["type"] == "artifact.created"]
        self.assertEqual([a["kind"] for a in created], ["file"])
        result = next(e for e in events if e["type"] == "tool.finished")["payload"]["result"]
        self.assertEqual(result["files"][0]["url"], "/ai-images/u1/layer.psd")
        self.assertEqual(result["layer_count"], 3)

    def _agent_job(self, job_id, *, operation="", status="done", url="/ai-images/u1/result.png", turn_id="t1",
                   phase="done", trace=""):
        meta = {"source": "agent2", "session_id": self.session["id"], "turn_id": turn_id, "tool_call_id": "call_x",
                "label": "结果", "recovery": {"phase": phase}}
        if operation:
            meta["operation"] = operation
        job_store.save_ai_image_job(job_id=job_id, user_id="u1", status=status, model="m", prompt="p", size="",
                                    image_url=url if status == "done" else "", request_meta=meta, prompt_trace=trace)

    def test_finished_but_unregistered_jobs_are_delivered_once(self):
        # 完成落库后、登记产物前服务重启：普通恢复扫描不会再管 phase=done 的任务，由补交付扫描补上
        self._agent_job("gen1")
        self._agent_job("out1", operation="outpainting")
        self._agent_job("psd1", operation="layer_extract", url="/ai-images/u1/layer.psd", trace='{"layers": [1, 2]}')
        self.assertEqual(job_store.load_recoverable_image_jobs(), [])
        self.assertEqual(store.count_pending_image_jobs(self.session["id"]), 3)
        # 宽限期内不补：工具调用可能还在等结果
        self.assertEqual(a2tools.deliver_finished_jobs(), 0)
        with patch.object(store, "DELIVERY_GRACE_SECONDS", -1):
            self.assertEqual(a2tools.deliver_finished_jobs(), 3)
            self.assertEqual(a2tools.deliver_finished_jobs(), 0)
        self.assertEqual(store.count_pending_image_jobs(self.session["id"]), 0)
        kinds = {store.find_job_artifact(j)["kind"] for j in ("gen1", "out1")}
        self.assertEqual(kinds, {"image"})
        psd = store.find_job_artifact("psd1")
        self.assertEqual((psd["kind"], psd["meta"]["layer_count"], psd["meta"]["recovered"]), ("file", 2, True))
        events = [e for e in store.session_snapshot(self.session["id"], 0)["events"] if e["type"] == "artifact.created"]
        self.assertEqual(len(events), 3)
        self.assertTrue(all(e["payload"]["recovered"] and e["payload"]["call_id"] == "call_x" for e in events))

    def test_processing_result_after_tool_timeout_is_delivered(self):
        def slow(user, operation, job_id, src_path, image_url, *, scale=None, extra_meta=None):
            self.started.append(job_id)
            job_store.save_ai_image_job(job_id=job_id, user_id="u1", status="processing", model="local-matting",
                                        prompt="matting", size="", request_meta={"operation": operation, **extra_meta})
        self.main.start_image_operation.side_effect = slow
        with patch.object(image_ops, "JOB_MAX_WAIT_SECONDS", 0.02):
            events, _ = self._run([[("call", "remove_background", {"image_id": self.source["id"]})], [("text", "还在处理")]])
        finished = next(e for e in events if e["type"] == "tool.finished")["payload"]
        self.assertFalse(finished["ok"])
        self.assertIn("自动补回", finished["result"]["error"])
        # 后台仍在处理：前端据此继续轮询
        self.assertEqual(store.count_pending_image_jobs(self.session["id"]), 1)
        job = job_store.load_ai_image_job(self.started[0])
        job_store.save_ai_image_job(job_id=job["id"], user_id="u1", status="done", model=job["model"], prompt="matting",
                                    size="", image_url="/ai-images/u1/result.png", request_meta=job["request_meta"])
        with patch.object(store, "DELIVERY_GRACE_SECONDS", -1):
            self.assertEqual(a2tools.deliver_finished_jobs(), 1)
        artifact = store.find_job_artifact(job["id"])
        self.assertEqual((artifact["label"], artifact["source_tool_call_id"]), ("抠图", finished["call_id"]))
        self.assertEqual(store.count_pending_image_jobs(self.session["id"]), 0)

    def test_results_of_user_stopped_turns_are_not_delivered(self):
        turn = store.claim_turn(self.session["id"], "u1", "抠图")
        store.update_turn(turn["id"], status="cancelled")
        self._agent_job("stopped1", operation="matting", turn_id=turn["id"])
        self.assertEqual(store.count_pending_image_jobs(self.session["id"]), 0)
        with patch.object(store, "DELIVERY_GRACE_SECONDS", -1):
            self.assertEqual(a2tools.deliver_finished_jobs(), 0)

    def test_failed_job_and_unknown_image_are_reported(self):
        def failing(user, operation, job_id, *a, **k):
            job_store.save_ai_image_job(job_id=job_id, user_id="u1", status="failed", model="m", prompt="p",
                                        size="", error="抠图失败：模型未加载")
        self.main.start_image_operation.side_effect = failing
        events, _ = self._run([[("call", "remove_background", {"image_id": self.source["id"]})], [("text", "失败了")]])
        finished = next(e for e in events if e["type"] == "tool.finished")["payload"]
        self.assertFalse(finished["ok"])
        self.assertIn("模型未加载", finished["result"]["error"])
        events, _ = self._run([[("call", "upscale_image", {"image_id": "img_missing"})], [("text", "找不到")]])
        finished = next(e for e in events if e["type"] == "tool.finished")["payload"]
        self.assertFalse(finished["ok"])

    def test_outpaint_geometry_targets_ratio_and_respects_limits(self):
        limits = {"max_width": 4096, "max_height": 4096, "max_area_pixels": 4096 * 4096}
        g = image_ops._outpaint_geometry(800, 1000, "16:9", 0, limits)
        o = g["outpaint"]
        self.assertEqual((g["processing_width"], g["processing_height"]), (800, 1000))
        self.assertEqual(o["top"] + o["bottom"], 0)
        self.assertAlmostEqual((800 + o["left"] + o["right"]) / 1000, 16 / 9, places=2)
        self.assertLessEqual(abs(o["left"] - o["right"]), 1)
        # 超出上限时缩小处理尺寸，输出不超过上限
        small = {"max_width": 1000, "max_height": 1000, "max_area_pixels": 1000 * 1000}
        g = image_ops._outpaint_geometry(800, 1000, "1:1", 50, small)
        o = g["outpaint"]
        self.assertLessEqual(g["processing_width"] + o["left"] + o["right"], 1000)
        self.assertLessEqual(g["processing_height"] + o["top"] + o["bottom"], 1000)

    def test_outpaint_direction_only_grows_that_side(self):
        limits = {"max_width": 4096, "max_height": 4096, "max_area_pixels": 4096 * 4096}
        o = image_ops._outpaint_geometry(800, 1000, "auto", 25, limits, "left")["outpaint"]
        self.assertEqual((o["left"], o["right"], o["top"], o["bottom"]), (200, 0, 0, 0))
        o = image_ops._outpaint_geometry(800, 1000, "auto", 10, limits, "bottom")["outpaint"]
        self.assertEqual((o["left"], o["right"], o["top"], o["bottom"]), (0, 0, 0, 100))

    def test_fill_background_composites_locally_and_requires_transparency(self):
        cutout = Path(self.tmp.name) / "cutout.png"
        img = Image.new("RGBA", (20, 20), (0, 0, 0, 0))
        img.paste((255, 0, 0, 255), (5, 5, 15, 15))
        img.save(cutout)
        art = store.create_artifact(session_id=self.session["id"], user_id="u1", kind="image",
                                    url="/output/cutout.png", path=str(cutout))
        with patch.object(image_ops.settings, "output_path", Path(self.tmp.name) / "out"):
            events, _ = self._run([
                [("call", "fill_background", {"image_id": art["id"]})],
                [("call", "fill_background", {"image_id": self.source["id"]})],
                [("text", "好了")],
            ], "换成白底")
        finished = [e["payload"] for e in events if e["type"] == "tool.finished"]
        self.assertTrue(finished[0]["ok"])
        out = store.get_artifact(finished[0]["result"]["images"][0]["id"], "u1")
        with Image.open(out["path"]) as result:
            self.assertEqual(result.getpixel((0, 0)), (255, 255, 255))
            self.assertEqual(result.getpixel((10, 10)), (255, 0, 0))
        self.assertEqual(len([e for e in events if e["type"] == "artifact.created"]), 1)
        # 不透明的原图：提示先抠图
        self.assertFalse(finished[1]["ok"])
        self.assertIn("先抠图", finished[1]["result"]["error"])

    def test_find_product_images_copies_library_files_into_session(self):
        lib = Path(self.tmp.name) / "lib"
        (lib / "White_Base").mkdir(parents=True)
        (lib / "PNG").mkdir()
        (lib / "White_Base" / "A1234.jpg").write_bytes(_png())
        (lib / "White_Base" / "A1234_1.jpg").write_bytes(_png())
        (lib / "PNG" / "A1234.png").write_bytes(_png())
        image_ops.outfit_change._ASSET_CACHE.clear()
        with patch.object(image_ops.settings, "product_library_path", lib), \
                patch.object(image_ops.settings, "output_path", Path(self.tmp.name) / "out"):
            events, _ = self._run([
                [("call", "find_product_images", {"sku": "A1234", "asset_type": "white"})],
                [("call", "find_product_images", {"sku": "../etc"})],
                [("call", "find_product_images", {"sku": "Z9999"})],
                [("text", "好了")],
            ], "把 A1234 的白底图发我")
        finished = [e["payload"] for e in events if e["type"] == "tool.finished"]
        images = finished[0]["result"]["images"]
        self.assertEqual(len(images), 2)
        self.assertEqual(len([e for e in events if e["type"] == "artifact.created"]), 2)
        art = store.get_artifact(images[0]["id"], "u1")
        self.assertTrue(Path(art["path"]).is_file())
        self.assertNotIn(str(lib), art["path"])
        self.assertIn("/library/", art["url"])
        # 越界货号和不存在的货号都只报找不到
        self.assertFalse(finished[1]["ok"])
        self.assertFalse(finished[2]["ok"])
        self.assertIn("Z9999", finished[2]["result"]["error"])

    def test_outfit_change_uses_durable_generation_with_built_in_prompt(self):
        person = self.source
        garment_path = Path(self.tmp.name) / "shirt.png"
        garment_path.write_bytes(_png((30, 30)))
        garment = store.create_artifact(session_id=self.session["id"], user_id="u1", kind="upload",
                                        url="/output/shirt.png", path=str(garment_path))
        captured = {}

        async def fake_generate_one(ctx, index, item, **kwargs):
            captured.update(item=item, **kwargs)
            return {"index": 0, "label": item["label"], "id": "img_out", "url": "/x.png"}

        with patch.object(image_ops, "_generate_one", fake_generate_one):
            events, _ = self._run([
                [("call", "outfit_change", {"person_image_id": person["id"], "garment_image_ids": [garment["id"]],
                                            "slots": ["top"]})],
                [("text", "换好了")],
            ], "给她换上这件上衣")
        self.assertEqual(len(captured["refs"]), 2)
        self.assertEqual(captured["extra_meta"]["operation"], "outfit-change")
        self.assertIn("图1", captured["item"]["prompt"])
        finished = next(e for e in events if e["type"] == "tool.finished")["payload"]
        self.assertEqual(finished["result"]["images"][0]["id"], "img_out")


class Agent2UploadValidationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_patch = patch.object(job_store, "_DB_PATH", Path(self.tmp.name) / "a2.db")
        self.db_patch.start()
        store.init_tables()
        self.user = {"id": "u1", "username": "tester"}
        self.session = store.create_session("u1")
        self.request = SimpleNamespace(state=SimpleNamespace(user=self.user))

    def tearDown(self):
        self.db_patch.stop()
        self.tmp.cleanup()

    def _upload(self, data: bytes, name: str):
        upload = MagicMock()
        upload.filename = name

        async def read(n=-1):
            return data
        upload.read = read
        return upload

    def _send(self, uploads):
        return asyncio.run(routes.send_message(self.request, self.session["id"], message="做主图", skill="",
                                               images=uploads))

    def test_more_than_max_images_is_rejected_instead_of_dropped(self):
        with self.assertRaises(HTTPException) as raised:
            self._send([self._upload(_png(), f"{i}.png") for i in range(routes.MAX_UPLOADS + 1)])
        self.assertEqual(raised.exception.status_code, 400)
        self.assertIn("最多", raised.exception.detail)
        self.assertIsNone(store.get_active_turn(self.session["id"]))

    def test_non_image_file_is_rejected(self):
        with self.assertRaises(HTTPException) as raised:
            self._send([self._upload(b"PK\x03\x04 not an image", "铺货.xlsx")])
        self.assertIn("不是图片", raised.exception.detail)
        self.assertIsNone(store.get_active_turn(self.session["id"]))


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import io
import json
import tempfile
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from backend import ps_expand
from backend.config import settings


def _make_png_bytes(width: int = 200, height: int = 100, color: tuple[int, int, int] = (40, 120, 220)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), color).save(buf, format="PNG")
    return buf.getvalue()


class TestPsExpand(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        tmp_path = Path(self._tmpdir.name)
        self._orig_db = ps_expand.DB_PATH
        self._orig_out = settings.output_path
        self._orig_secret = settings.ps_expand_worker_secret
        self._orig_client_token = settings.ps_expand_client_token
        self._orig_max_side = settings.ps_expand_max_side
        self._orig_max_queue = settings.ps_expand_max_queue_size

        ps_expand.DB_PATH = tmp_path / "test_expand.db"
        settings.output_path = tmp_path / "output"
        settings.output_path.mkdir(parents=True, exist_ok=True)
        settings.ps_expand_worker_secret = "test-secret"
        settings.ps_expand_client_token = ""
        settings.ps_expand_max_side = 6000
        settings.ps_expand_max_queue_size = 3

        ps_expand.coordinator._workers.clear()
        ps_expand.init_ps_expand_tables()

        app = FastAPI()
        app.include_router(ps_expand.router)
        self.client = TestClient(app)

    def tearDown(self) -> None:
        self.client.close()
        ps_expand.coordinator._workers.clear()
        ps_expand.DB_PATH = self._orig_db
        settings.output_path = self._orig_out
        settings.ps_expand_worker_secret = self._orig_secret
        settings.ps_expand_client_token = self._orig_client_token
        settings.ps_expand_max_side = self._orig_max_side
        settings.ps_expand_max_queue_size = self._orig_max_queue
        self._tmpdir.cleanup()

    def test_normalize_expand_spec_modes(self) -> None:
        spec_pad = ps_expand.normalize_expand_spec(
            {"mode": "padding", "padding": {"top": 50, "right": 100, "bottom": 0, "left": 20}},
            200,
            100,
        )
        self.assertEqual(spec_pad["target_width"], 320)
        self.assertEqual(spec_pad["target_height"], 150)
        self.assertEqual(spec_pad["padding"], {"top": 50, "right": 100, "bottom": 0, "left": 20})

        spec_ts = ps_expand.normalize_expand_spec(
            {"mode": "target_size", "target_size": {"width": 400, "height": 200, "anchor": "top_left"}},
            200,
            100,
        )
        self.assertEqual(spec_ts["padding"], {"top": 0, "right": 200, "bottom": 100, "left": 0})

        spec_ar = ps_expand.normalize_expand_spec(
            {"mode": "aspect_ratio", "aspect_ratio": "1:1", "anchor": "center"},
            200,
            100,
        )
        self.assertEqual(spec_ar["target_width"], 200)
        self.assertEqual(spec_ar["target_height"], 200)
        self.assertEqual(spec_ar["padding"], {"top": 50, "right": 0, "bottom": 50, "left": 0})

    def test_submit_validation_queue_and_cancel(self) -> None:
        img = _make_png_bytes(200, 100)

        # 1. 超过 6000px 硬上限直接拒绝
        r_bad = self.client.post(
            "/api/v1/expand/tasks",
            files={"image": ("demo.png", img, "image/png")},
            data={"spec": json.dumps({"mode": "padding", "padding": {"top": 6000, "right": 0, "bottom": 0, "left": 0}})},
        )
        self.assertEqual(r_bad.status_code, 400)

        # 2. 正常提交入队（Worker 离线时 status=queued）
        r1 = self.client.post(
            "/api/v1/expand/tasks",
            files={"image": ("demo.png", img, "image/png")},
            data={"spec": json.dumps({"mode": "padding", "padding": {"top": 100, "right": 0, "bottom": 0, "left": 0}, "client_id": "mac-a:alice"})},
        )
        self.assertEqual(r1.status_code, 202)
        t1 = r1.json()
        self.assertEqual(t1["status"], "queued")
        self.assertEqual(t1["queue_position"], 1)

        # 3. 同一设计师同时只能有 1 条在排/在跑任务
        r_dup = self.client.post(
            "/api/v1/expand/tasks",
            files={"image": ("demo.png", img, "image/png")},
            data={"spec": json.dumps({"mode": "padding", "padding": {"top": 100, "right": 0, "bottom": 0, "left": 0}, "client_id": "mac-a:alice"})},
        )
        self.assertEqual(r_dup.status_code, 409)
        self.assertEqual(r_dup.json()["error_code"], "CLIENT_TASK_ACTIVE")

        # 4. 另一个设计师提交排第 2 位
        r2 = self.client.post(
            "/api/v1/expand/tasks",
            files={"image": ("demo.png", img, "image/png")},
            data={"spec": json.dumps({"mode": "padding", "padding": {"top": 0, "right": 80, "bottom": 0, "left": 0}, "client_id": "win-b:bob"})},
        )
        self.assertEqual(r2.status_code, 202)
        t2 = r2.json()
        self.assertEqual(t2["queue_position"], 2)

        # 5. 排队中可以取消
        rc = self.client.post(f"/api/v1/expand/tasks/{t1['task_id']}/cancel")
        self.assertEqual(rc.status_code, 200)
        self.assertEqual(rc.json()["status"], "cancelled")

        # 取消后 t2 前移至第 1 位
        rt2 = self.client.get(f"/api/v1/expand/tasks/{t2['task_id']}")
        self.assertEqual(rt2.status_code, 200)
        self.assertEqual(rt2.json()["queue_position"], 1)

    def test_end_to_end_worker_ws_flow(self) -> None:
        img = _make_png_bytes(200, 100)

        r_sub = self.client.post(
            "/api/v1/expand/tasks",
            files={"image": ("demo.png", img, "image/png")},
            data={"spec": json.dumps({"mode": "padding", "padding": {"top": 50, "right": 50, "bottom": 0, "left": 0}, "client_id": "mac-a:alice"})},
        )
        self.assertEqual(r_sub.status_code, 202)
        task_id = r_sub.json()["task_id"]

        with self.client.websocket_connect("/api/v1/expand/worker?worker_id=win-ps-01&token=test-secret") as ws:
            ws.send_json({"type": "worker.hello", "ps_version": "26.1.0", "worker_version": "1.0.0"})
            assigned = ws.receive_json()
            self.assertEqual(assigned["type"], "task.assign")
            self.assertEqual(assigned["task_id"], task_id)

            st = self.client.get("/api/v1/expand/worker/status").json()
            self.assertTrue(st["online"])
            self.assertTrue(st["busy"])
            self.assertEqual(st["current_task_id"], task_id)

            # processing 状态的任务不可取消（409）
            rc = self.client.post(f"/api/v1/expand/tasks/{task_id}/cancel")
            self.assertEqual(rc.status_code, 409)

            # Worker 下载原图
            r_in = self.client.get(assigned["image_url"], headers={"X-Worker-Token": "test-secret"})
            self.assertEqual(r_in.status_code, 200)
            self.assertEqual(len(r_in.content), len(img))

            # Worker 上报进度并上传 3 张变体
            ws.send_json({"type": "task.progress", "task_id": task_id, "stage": "expanding"})
            outputs = []
            for idx, color in enumerate([(200, 60, 60), (60, 200, 60), (60, 60, 200)]):
                out_bytes = _make_png_bytes(250, 150, color)
                ru = self.client.post(
                    assigned["upload_url"],
                    headers={"X-Worker-Token": "test-secret"},
                    data={"task_id": task_id, "variant_index": str(idx)},
                    files={"file": (f"v{idx}.png", out_bytes, "image/png")},
                )
                self.assertEqual(ru.status_code, 200)
                outputs.append(ru.json())

            ws.send_json({"type": "task.result", "task_id": task_id, "outputs": outputs, "duration_ms": 12340})
            ws.send_json({"type": "ping", "busy": False, "paused": False})
            pong = ws.receive_json()
            self.assertEqual(pong["type"], "pong")

        r_done = self.client.get(f"/api/v1/expand/tasks/{task_id}")
        self.assertEqual(r_done.status_code, 200)
        body = r_done.json()
        self.assertEqual(body["status"], "succeeded")
        self.assertEqual(len(body["outputs"]), 3)
        self.assertEqual(body["duration_ms"], 12340)

        r_file = self.client.get(body["outputs"][0]["url"])
        self.assertEqual(r_file.status_code, 200)
        self.assertGreater(len(r_file.content), 0)


if __name__ == "__main__":
    unittest.main()

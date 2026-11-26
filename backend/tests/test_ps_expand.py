from __future__ import annotations

import gc
import io
import json
import tempfile
import unittest
import warnings
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
from starlette.websockets import WebSocketDisconnect

from backend import ps_expand
from backend.config import settings


def _make_png_bytes(width: int = 200, height: int = 100, color: tuple[int, int, int] = (40, 120, 220)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), color).save(buf, format="PNG")
    return buf.getvalue()


class TestPsExpand(unittest.TestCase):
    CLIENT_HEADERS = {"Authorization": "Bearer test-client-token"}
    WORKER_HEADERS = {"X-Worker-Token": "test-worker-secret"}

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
        settings.ps_expand_worker_secret = "test-worker-secret"
        settings.ps_expand_client_token = "test-client-token"
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
        gc.collect()
        self._tmpdir.cleanup()

    def test_fail_closed_auth_when_secrets_unset_or_invalid(self) -> None:
        img = _make_png_bytes(200, 100)

        # 未配置客户端 token 时默认禁用（503）
        settings.ps_expand_client_token = ""
        self.assertEqual(self.client.get("/api/v1/expand/worker/status").status_code, 503)
        self.assertEqual(
            self.client.post(
                "/api/v1/expand/tasks",
                files={"image": ("demo.png", img, "image/png")},
                data={"spec": json.dumps({"mode": "padding", "padding": {"top": 50, "right": 0, "bottom": 0, "left": 0}})},
            ).status_code,
            503,
        )

        # 未配置 Worker secret 时拒绝 WS 连接与内部上传
        settings.ps_expand_worker_secret = ""
        with self.assertRaises(WebSocketDisconnect) as ctx:
            with self.client.websocket_connect("/api/v1/expand/worker?worker_id=win-ps-01&token=anything"):
                pass
        self.assertEqual(ctx.exception.code, 4403)

        r_up = self.client.post(
            "/api/v1/expand/internal/upload",
            data={"task_id": "exp_demo", "variant_index": "0"},
            files={"file": ("v0.png", img, "image/png")},
        )
        self.assertEqual(r_up.status_code, 503)

        # 配置客户端 token 后，缺失或错误 token 返回 401
        settings.ps_expand_client_token = "strong-secret-token"
        self.assertEqual(self.client.get("/api/v1/expand/worker/status").status_code, 401)
        self.assertEqual(
            self.client.get("/api/v1/expand/worker/status", headers={"Authorization": "Bearer wrong"}).status_code,
            401,
        )
        self.assertEqual(
            self.client.get("/api/v1/expand/worker/status", headers={"Authorization": "Bearer strong-secret-token"}).status_code,
            200,
        )

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

    def test_submit_validation_queue_and_cancel_no_resource_warning(self) -> None:
        img = _make_png_bytes(200, 100)

        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always", ResourceWarning)

            r_bad = self.client.post(
                "/api/v1/expand/tasks",
                headers=self.CLIENT_HEADERS,
                files={"image": ("demo.png", img, "image/png")},
                data={"spec": json.dumps({"mode": "padding", "padding": {"top": 6000, "right": 0, "bottom": 0, "left": 0}})},
            )
            self.assertEqual(r_bad.status_code, 400)

            r1 = self.client.post(
                "/api/v1/expand/tasks",
                headers=self.CLIENT_HEADERS,
                files={"image": ("demo.png", img, "image/png")},
                data={"spec": json.dumps({"mode": "padding", "padding": {"top": 100, "right": 0, "bottom": 0, "left": 0}, "client_id": "mac-a:alice"})},
            )
            self.assertEqual(r1.status_code, 202)
            t1 = r1.json()
            self.assertEqual(t1["status"], "queued")
            self.assertEqual(t1["queue_position"], 1)

            r_dup = self.client.post(
                "/api/v1/expand/tasks",
                headers=self.CLIENT_HEADERS,
                files={"image": ("demo.png", img, "image/png")},
                data={"spec": json.dumps({"mode": "padding", "padding": {"top": 100, "right": 0, "bottom": 0, "left": 0}, "client_id": "mac-a:alice"})},
            )
            self.assertEqual(r_dup.status_code, 409)
            self.assertEqual(r_dup.json()["error_code"], "CLIENT_TASK_ACTIVE")

            r2 = self.client.post(
                "/api/v1/expand/tasks",
                headers=self.CLIENT_HEADERS,
                files={"image": ("demo.png", img, "image/png")},
                data={"spec": json.dumps({"mode": "padding", "padding": {"top": 0, "right": 80, "bottom": 0, "left": 0}, "client_id": "win-b:bob"})},
            )
            self.assertEqual(r2.status_code, 202)
            t2 = r2.json()
            self.assertEqual(t2["queue_position"], 2)

            rc = self.client.post(f"/api/v1/expand/tasks/{t1['task_id']}/cancel", headers=self.CLIENT_HEADERS)
            self.assertEqual(rc.status_code, 200)
            self.assertEqual(rc.json()["status"], "cancelled")

            rt2 = self.client.get(f"/api/v1/expand/tasks/{t2['task_id']}", headers=self.CLIENT_HEADERS)
            self.assertEqual(rt2.status_code, 200)
            self.assertEqual(rt2.json()["queue_position"], 1)

            gc.collect()
            resource_warnings = [w for w in caught if issubclass(w.category, ResourceWarning)]
            self.assertEqual(resource_warnings, [])

    def test_timeout_quarantines_worker_until_recovery(self) -> None:
        """回归测试：第一单 PS_EXEC_TIMEOUT 后必须隔离 Worker，绝不立即派发第二单；直到恢复/重启重连后再派发。"""
        img = _make_png_bytes(200, 100)

        r1 = self.client.post(
            "/api/v1/expand/tasks",
            headers=self.CLIENT_HEADERS,
            files={"image": ("a.png", img, "image/png")},
            data={"spec": json.dumps({"mode": "padding", "padding": {"top": 50, "right": 0, "bottom": 0, "left": 0}, "client_id": "u1"})},
        )
        r2 = self.client.post(
            "/api/v1/expand/tasks",
            headers=self.CLIENT_HEADERS,
            files={"image": ("b.png", img, "image/png")},
            data={"spec": json.dumps({"mode": "padding", "padding": {"top": 0, "right": 50, "bottom": 0, "left": 0}, "client_id": "u2"})},
        )
        task1_id = r1.json()["task_id"]
        task2_id = r2.json()["task_id"]

        with self.client.websocket_connect("/api/v1/expand/worker?worker_id=win-ps-01&token=test-worker-secret") as ws:
            ws.send_json({"type": "worker.hello", "ps_version": "26.0.0", "worker_version": "1.0.0"})
            assigned1 = ws.receive_json()
            self.assertEqual(assigned1["task_id"], task1_id)

            # Worker 触发软超时并上报 PS_EXEC_TIMEOUT
            ws.send_json({
                "type": "task.error",
                "task_id": task1_id,
                "error_code": "PS_EXEC_TIMEOUT",
                "error_message": "soft timeout",
                "quarantined": True,
            })
            ack = ws.receive_json()
            self.assertEqual(ack["type"], "task.ack")
            self.assertEqual(ack["task_id"], task1_id)
            # 发 ping 确认同步点：此时仍处于隔离态，第二单不能被派发
            ws.send_json({"type": "ping", "busy": True, "paused": False, "quarantined": True})
            pong = ws.receive_json()
            self.assertEqual(pong["type"], "pong")

            st = self.client.get("/api/v1/expand/worker/status", headers=self.CLIENT_HEADERS).json()
            self.assertTrue(st["quarantined"])
            self.assertTrue(st["busy"])

            t1_state = self.client.get(f"/api/v1/expand/tasks/{task1_id}", headers=self.CLIENT_HEADERS).json()
            t2_state = self.client.get(f"/api/v1/expand/tasks/{task2_id}", headers=self.CLIENT_HEADERS).json()
            self.assertEqual(t1_state["status"], "timeout")
            self.assertEqual(t2_state["status"], "queued")

        # 模拟 Watchdog 强杀重启 PS 后 Worker 全新重连，第二单才被派发
        with self.client.websocket_connect("/api/v1/expand/worker?worker_id=win-ps-01&token=test-worker-secret") as ws2:
            ws2.send_json({"type": "worker.hello", "ps_version": "26.0.0", "worker_version": "1.0.0"})
            assigned2 = ws2.receive_json()
            self.assertEqual(assigned2["type"], "task.assign")
            self.assertEqual(assigned2["task_id"], task2_id)

    def test_reconnect_preserves_quarantine_and_busy_state(self) -> None:
        """二审 P1 回归：同 PS 断线重连携带 busy/quarantined 时严禁派发第二单；task.rejected 可安全放回队列。"""
        img = _make_png_bytes(200, 100)
        r1 = self.client.post(
            "/api/v1/expand/tasks",
            headers=self.CLIENT_HEADERS,
            files={"image": ("a.png", img, "image/png")},
            data={"spec": json.dumps({"mode": "padding", "padding": {"top": 50, "right": 0, "bottom": 0, "left": 0}, "client_id": "u1"})},
        )
        r2 = self.client.post(
            "/api/v1/expand/tasks",
            headers=self.CLIENT_HEADERS,
            files={"image": ("b.png", img, "image/png")},
            data={"spec": json.dumps({"mode": "padding", "padding": {"top": 0, "right": 50, "bottom": 0, "left": 0}, "client_id": "u2"})},
        )
        task1_id = r1.json()["task_id"]
        task2_id = r2.json()["task_id"]

        # 第一单软超时后连接断开
        with self.client.websocket_connect("/api/v1/expand/worker?worker_id=win-ps-01&token=test-worker-secret") as ws1:
            ws1.send_json({"type": "worker.hello", "ps_version": "26.0.0", "worker_version": "1.0.0", "busy": False, "quarantined": False})
            assigned1 = ws1.receive_json()
            self.assertEqual(assigned1["task_id"], task1_id)
            ws1.send_json({
                "type": "task.error",
                "task_id": task1_id,
                "error_code": "PS_EXEC_TIMEOUT",
                "error_message": "soft timeout",
                "quarantined": True,
            })

        # 同一个 PS（尚未重启恢复）用相同 worker_id 重连，hello 携带 busy=True, quarantined=True
        with self.client.websocket_connect("/api/v1/expand/worker?worker_id=win-ps-01&token=test-worker-secret") as ws_reconn:
            ws_reconn.send_json({
                "type": "worker.hello",
                "ps_version": "26.0.0",
                "worker_version": "1.0.0",
                "busy": True,
                "quarantined": True,
                "current_task_id": task1_id,
            })
            ws_reconn.send_json({"type": "ping", "busy": True, "paused": False, "quarantined": True})
            pong = ws_reconn.receive_json()
            self.assertEqual(pong["type"], "pong")

            # 第二单必须仍然处于 queued，绝不能被错误派发
            t2_state = self.client.get(f"/api/v1/expand/tasks/{task2_id}", headers=self.CLIENT_HEADERS).json()
            self.assertEqual(t2_state["status"], "queued")
            st = self.client.get("/api/v1/expand/worker/status", headers=self.CLIENT_HEADERS).json()
            self.assertTrue(st["quarantined"])
            self.assertTrue(st["busy"])

            # 只有当 Worker 明确上报原生已结束（busy=False, quarantined=False）才派发第二单
            ws_reconn.send_json({"type": "ping", "busy": False, "paused": False, "quarantined": False})
            msg_a = ws_reconn.receive_json()
            msg_b = ws_reconn.receive_json()
            types = {msg_a["type"]: msg_a, msg_b["type"]: msg_b}
            self.assertIn("task.assign", types)
            self.assertEqual(types["task.assign"]["task_id"], task2_id)

            # 测试 task.rejected 兜底：若 Worker 拒收，任务放回 queued
            ws_reconn.send_json({
                "type": "task.rejected",
                "task_id": task2_id,
                "reason": "busy",
                "busy": True,
                "paused": False,
                "quarantined": False,
                "current_task_id": task1_id,
            })
            ws_reconn.send_json({"type": "ping", "busy": True, "paused": False, "quarantined": False})
            self.assertEqual(ws_reconn.receive_json()["type"], "pong")
            t2_after_reject = self.client.get(f"/api/v1/expand/tasks/{task2_id}", headers=self.CLIENT_HEADERS).json()
            self.assertEqual(t2_after_reject["status"], "queued")

    def test_partial_variants_reported_explicitly(self) -> None:
        """二审 P2 回归：请求 3 变体但 PS 仅返回 1 张时，必须明确标记 variants_complete=False 与 warning。"""
        img = _make_png_bytes(200, 100)
        r_sub = self.client.post(
            "/api/v1/expand/tasks",
            headers=self.CLIENT_HEADERS,
            files={"image": ("demo.png", img, "image/png")},
            data={"spec": json.dumps({"mode": "padding", "padding": {"top": 32, "right": 32, "bottom": 0, "left": 0}, "return_all_variants": True})},
        )
        task_id = r_sub.json()["task_id"]

        with self.client.websocket_connect("/api/v1/expand/worker?worker_id=win-ps-01&token=test-worker-secret") as ws:
            ws.send_json({"type": "worker.hello", "ps_version": "26.0.0", "worker_version": "1.0.0"})
            assigned = ws.receive_json()
            ru = self.client.post(
                assigned["upload_url"],
                headers=self.WORKER_HEADERS,
                data={"task_id": task_id, "variant_index": "0"},
                files={"file": ("v0.png", _make_png_bytes(232, 132), "image/png")},
            )
            ws.send_json({
                "type": "task.result",
                "task_id": task_id,
                "outputs": [ru.json()],
                "requested_variants": 3,
                "variants_complete": False,
                "variant_warning": "PS 26.0.0 变体切换不可用，仅导出 1/3 个变体",
                "duration_ms": 8200,
            })
            ack = ws.receive_json()
            self.assertEqual(ack["type"], "task.ack")
            self.assertEqual(ack["task_id"], task_id)
            ws.send_json({"type": "ping", "busy": False, "paused": False, "quarantined": False})
            self.assertEqual(ws.receive_json()["type"], "pong")

        res = self.client.get(f"/api/v1/expand/tasks/{task_id}", headers=self.CLIENT_HEADERS).json()
        self.assertEqual(res["status"], "succeeded")
        self.assertEqual(len(res["outputs"]), 1)
        self.assertEqual(res["requested_variants"], 3)
        self.assertFalse(res["variants_complete"])
        self.assertIn("1/3", res["variant_warning"])

    def test_transient_disconnect_recovers_and_delivers_result(self) -> None:
        """三审 P1 回归：执行中短暂断线不立即判 timeout，同 Worker 重连后可正常交付 task.result 并收到 task.ack。"""
        img = _make_png_bytes(200, 100)
        r_sub = self.client.post(
            "/api/v1/expand/tasks",
            headers=self.CLIENT_HEADERS,
            files={"image": ("demo.png", img, "image/png")},
            data={"spec": json.dumps({"mode": "padding", "padding": {"top": 40, "right": 0, "bottom": 0, "left": 0}, "return_all_variants": False})},
        )
        task_id = r_sub.json()["task_id"]

        # 接单后模拟短暂网络断线
        with self.client.websocket_connect("/api/v1/expand/worker?worker_id=win-ps-01&token=test-worker-secret") as ws1:
            ws1.send_json({"type": "worker.hello", "ps_version": "26.0.0", "worker_version": "1.0.0"})
            assigned = ws1.receive_json()
            self.assertEqual(assigned["task_id"], task_id)

        # 断线后仍在宽限期内，任务必须保持 processing 而非立刻 timeout
        mid = self.client.get(f"/api/v1/expand/tasks/{task_id}", headers=self.CLIENT_HEADERS).json()
        self.assertEqual(mid["status"], "processing")

        # 同一个 Worker 重连上报原任务 busy，上传成图并交付 task.result
        with self.client.websocket_connect("/api/v1/expand/worker?worker_id=win-ps-01&token=test-worker-secret") as ws2:
            ws2.send_json({
                "type": "worker.hello",
                "ps_version": "26.0.0",
                "worker_version": "1.0.0",
                "busy": True,
                "quarantined": False,
                "current_task_id": task_id,
            })
            ru = self.client.post(
                assigned["upload_url"],
                headers=self.WORKER_HEADERS,
                data={"task_id": task_id, "variant_index": "0"},
                files={"file": ("v0.png", _make_png_bytes(200, 140), "image/png")},
            )
            self.assertEqual(ru.status_code, 200)
            ws2.send_json({
                "type": "task.result",
                "task_id": task_id,
                "outputs": [ru.json()],
                "requested_variants": 1,
                "variants_complete": True,
                "duration_ms": 9500,
            })
            ack = ws2.receive_json()
            self.assertEqual(ack["type"], "task.ack")
            self.assertEqual(ack["task_id"], task_id)
            self.assertEqual(ack["status"], "succeeded")

        done = self.client.get(f"/api/v1/expand/tasks/{task_id}", headers=self.CLIENT_HEADERS).json()
        self.assertEqual(done["status"], "succeeded")
        self.assertEqual(len(done["outputs"]), 1)

    def test_end_to_end_worker_ws_flow(self) -> None:
        img = _make_png_bytes(200, 100)

        r_sub = self.client.post(
            "/api/v1/expand/tasks",
            headers=self.CLIENT_HEADERS,
            files={"image": ("demo.png", img, "image/png")},
            data={"spec": json.dumps({"mode": "padding", "padding": {"top": 50, "right": 50, "bottom": 0, "left": 0}, "client_id": "mac-a:alice"})},
        )
        self.assertEqual(r_sub.status_code, 202)
        task_id = r_sub.json()["task_id"]

        with self.client.websocket_connect("/api/v1/expand/worker?worker_id=win-ps-01&token=test-worker-secret") as ws:
            ws.send_json({"type": "worker.hello", "ps_version": "26.1.0", "worker_version": "1.0.0"})
            assigned = ws.receive_json()
            self.assertEqual(assigned["type"], "task.assign")
            self.assertEqual(assigned["task_id"], task_id)

            st = self.client.get("/api/v1/expand/worker/status", headers=self.CLIENT_HEADERS).json()
            self.assertTrue(st["online"])
            self.assertTrue(st["busy"])
            self.assertFalse(st["quarantined"])
            self.assertEqual(st["current_task_id"], task_id)

            rc = self.client.post(f"/api/v1/expand/tasks/{task_id}/cancel", headers=self.CLIENT_HEADERS)
            self.assertEqual(rc.status_code, 409)

            r_in = self.client.get(assigned["image_url"], headers=self.WORKER_HEADERS)
            self.assertEqual(r_in.status_code, 200)
            self.assertEqual(len(r_in.content), len(img))

            ws.send_json({"type": "task.progress", "task_id": task_id, "stage": "expanding"})
            outputs = []
            for idx, color in enumerate([(200, 60, 60), (60, 200, 60), (60, 60, 200)]):
                out_bytes = _make_png_bytes(250, 150, color)
                ru = self.client.post(
                    assigned["upload_url"],
                    headers=self.WORKER_HEADERS,
                    data={"task_id": task_id, "variant_index": str(idx)},
                    files={"file": (f"v{idx}.png", out_bytes, "image/png")},
                )
                self.assertEqual(ru.status_code, 200)
                outputs.append(ru.json())

            ws.send_json({"type": "task.result", "task_id": task_id, "outputs": outputs, "duration_ms": 12340})
            ack = ws.receive_json()
            self.assertEqual(ack["type"], "task.ack")
            ws.send_json({"type": "ping", "busy": False, "paused": False, "quarantined": False})
            pong = ws.receive_json()
            self.assertEqual(pong["type"], "pong")

        r_done = self.client.get(f"/api/v1/expand/tasks/{task_id}", headers=self.CLIENT_HEADERS)
        self.assertEqual(r_done.status_code, 200)
        body = r_done.json()
        self.assertEqual(body["status"], "succeeded")
        self.assertEqual(len(body["outputs"]), 3)
        self.assertEqual(body["duration_ms"], 12340)

        # 未携带令牌访问输出文件被拒绝（401），携带令牌可正常下载（200）
        self.assertEqual(self.client.get(body["outputs"][0]["url"]).status_code, 401)
        r_file = self.client.get(body["outputs"][0]["url"], headers=self.CLIENT_HEADERS)
        self.assertEqual(r_file.status_code, 200)
        self.assertGreater(len(r_file.content), 0)


if __name__ == "__main__":
    unittest.main()

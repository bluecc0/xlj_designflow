from __future__ import annotations

import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image

from backend import ai_image, job_store, main, view_angle
from backend.config import settings


def _image_bytes(size=(750, 1000), mode="RGB", color=(20, 120, 200), fmt="JPEG") -> bytes:
    buf = io.BytesIO()
    Image.new(mode, size, color).save(buf, format=fmt)
    return buf.getvalue()


class ViewAnglePromptTest(unittest.TestCase):
    def test_views_snap_to_fixed_steps_and_dedupe(self) -> None:
        views = view_angle.normalize_views([
            {"azimuth": 170, "elevation": 5},
            {"azimuth": -95, "elevation": 40, "distance": "closer"},
            {"azimuth": 185, "elevation": -3},  # 吸附后与第一个相同
        ])
        self.assertEqual(views, [
            {"azimuth": 180, "elevation": 0, "distance": "same"},
            {"azimuth": 270, "elevation": 30, "distance": "closer"},
        ])
        self.assertEqual(view_angle.view_label(270, 30, "closer"), "左侧 · 俯视 · 近景")
        self.assertEqual(view_angle.view_label(0, 30), "俯视")
        self.assertEqual(view_angle.view_label(0, 0, "farther"), "远景")

    def test_views_validation(self) -> None:
        for raw, message in (
            ([], "至少选择一个视角"),
            ([{"azimuth": 10, "elevation": 0}], "与原图不同"),
            ([{"azimuth": 90, "distance": "macro"}], "不支持的景别"),
            ([{"azimuth": "x"}], "必须是数字"),
            ([{"azimuth": a} for a in (45, 90, 135, 180, 225)], "最多生成 4 个"),
        ):
            with self.subTest(raw=raw), self.assertRaisesRegex(ValueError, message):
                view_angle.normalize_views(raw)

    def test_prompt_states_result_direction_and_keeps_subject(self) -> None:
        prompt = view_angle.build_view_prompt(azimuth=90, elevation=0)
        self.assertIn("朝向画面左侧", prompt)
        self.assertIn("不要朝画面右侧", prompt)
        self.assertIn("主体必须保持不变", prompt)
        self.assertIn("背景随相机移动同步变化", prompt)
        # 原景别保持图1的取景范围；不能要求「完整入镜」，否则半身图会被拉远成全身
        self.assertIn("不要拉远成全身", prompt)
        self.assertNotIn("完整入镜", prompt)
        self.assertIn("取景比图1更紧", view_angle.build_view_prompt(azimuth=90, elevation=0, distance="closer"))
        mirrored = view_angle.build_view_prompt(azimuth=270, elevation=0)
        self.assertIn("朝向画面右侧", mirrored)
        subject = view_angle.build_view_prompt(azimuth=180, elevation=30, mode="subject", extra_prompt="保留手里的包")
        self.assertIn("让主体在原地转动", subject)
        self.assertIn("背景、地面、光线保持与图1一致", subject)
        self.assertIn("自上而下俯视", subject)
        self.assertIn("补充要求：保留手里的包", subject)

    def test_flatten_alpha_paints_transparent_area_white(self) -> None:
        flat = Image.open(io.BytesIO(view_angle.flatten_alpha(
            _image_bytes((8, 8), "RGBA", (0, 0, 0, 0), "PNG"))))
        self.assertEqual(flat.mode, "RGB")
        self.assertEqual(flat.getpixel((0, 0)), (255, 255, 255))
        opaque = _image_bytes((8, 8))
        self.assertIs(view_angle.flatten_alpha(opaque), opaque)


class ViewAngleEndpointTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        self.patchers = [
            patch.object(job_store, "_DB_PATH", root / "jobs.db"),
            patch.object(settings, "output_path", root),
            patch.object(ai_image, "_OUTPUT_DIR", root / "ai-images"),
            patch.object(main, "_get_session_user", lambda request: {"id": "u1", "username": "tester", "role": "user"}),
        ]
        for p in self.patchers:
            p.start()
        job_store.init_db()
        self.client = TestClient(main.app)

    def tearDown(self) -> None:
        for p in self.patchers:
            p.stop()
        self.temp_dir.cleanup()

    def _submit(self, views, **data):
        captured: list[dict] = []

        async def fake_background(**kwargs):
            captured.append(kwargs)

        with patch.object(main, "_run_ai_image_background", new=fake_background):
            resp = self.client.post(
                "/ai-image/view-angle",
                files=[("image", ("src.png", _image_bytes((750, 1000), "RGBA", (200, 30, 30, 0), "PNG"), "image/png"))],
                data={"views": json.dumps(views), **data},
            )
        return resp, captured

    def test_each_view_becomes_a_recoverable_gpt_26_job(self) -> None:
        resp, captured = self._submit(
            [{"azimuth": 180, "elevation": 0}, {"azimuth": 90, "elevation": 30}],
            mode="subject", source_name="kid.png", client_request_id="view-angle-req-1",
        )
        self.assertEqual(resp.status_code, 200, resp.text)
        body = resp.json()
        self.assertEqual(body["labels"], ["背面", "右侧 · 俯视"])
        self.assertEqual(len(body["job_ids"]), 2)
        self.assertEqual(body["size"], "3:4")
        self.assertEqual([c["model"] for c in captured], ["gpt-image-2.6", "gpt-image-2.6"])
        self.assertEqual({c["provider"] for c in captured}, {"auto"})
        self.assertIn("完全背对镜头", captured[0]["prompt"])
        self.assertIn("朝向画面左侧", captured[1]["prompt"])
        self.assertIn("让主体在原地转动", captured[1]["prompt"])
        # 原图是唯一参考图，透明区域已铺白
        self.assertEqual(len(captured[0]["refs"]), 1)
        ref = Image.open(io.BytesIO(captured[0]["refs"][0][0]))
        self.assertEqual(ref.convert("RGB").getpixel((0, 0)), (255, 255, 255))
        meta = captured[1]["request_meta"]
        self.assertEqual(meta["operation"], "view-angle")
        self.assertEqual(meta["view_angle"]["label"], "右侧 · 俯视")
        self.assertEqual(meta["view_angle"]["mode"], "subject")
        self.assertEqual(meta["batch_id"], body["batch_id"])
        self.assertEqual(meta["manual_reference_count"], 1)
        job = job_store.load_ai_image_job(body["job_ids"][1])
        self.assertEqual((job["model"], job["prompt"]), ("gpt-image-2.6", "切换视角：右侧 · 俯视"))
        # 服务重启后可以被后台恢复
        self.assertIn(body["job_ids"][0], {j["id"] for j in job_store.load_recoverable_image_jobs()})

    def test_single_view_returns_job_id(self) -> None:
        resp, captured = self._submit([{"azimuth": 225}])
        self.assertEqual(resp.status_code, 200, resp.text)
        self.assertIn("job_id", resp.json())
        self.assertEqual(captured[0]["request_meta"]["view_angle"]["mode"], "camera")

    def test_invalid_views_are_rejected_without_jobs(self) -> None:
        resp, captured = self._submit([{"azimuth": 0, "elevation": 0}])
        self.assertEqual(resp.status_code, 400)
        self.assertIn("与原图不同", resp.json()["detail"])
        self.assertEqual(captured, [])


if __name__ == "__main__":
    unittest.main()

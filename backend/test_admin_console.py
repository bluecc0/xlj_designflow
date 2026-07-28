from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import job_store


class AdminConsoleStoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_db_path = job_store._DB_PATH
        self.original_login_users = list(job_store.settings.allowed_login_users)
        job_store.settings.allowed_login_users = [
            {"id": "admin", "username": "管理员", "display_name": "张运营", "role": "admin"},
            {"id": "designer", "username": "设计师", "display_name": "李设计", "role": "user"},
        ]
        job_store._DB_PATH = Path(self.temp_dir.name) / "admin-test.db"
        job_store.init_db()
        self.now = time.time()

        with job_store._connect() as conn:
            conn.executemany(
                "INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, ?)",
                [
                    ("admin", "管理员", "admin", self.now - 10_000),
                    ("designer", "设计师", "designer", self.now - 9_000),
                ],
            )
            conn.executemany(
                """
                INSERT INTO ai_image_jobs
                  (id, user_id, status, model, prompt, size, error, progress, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    ("ai-done", "admin", "done", "gpt-image-2", "夏季鞋服海报", "auto", "", 100, self.now - 100),
                    ("ai-failed", "designer", "failed", "gpt-image-2", "产品主图", "1:1", "request timeout", 0, self.now - 200),
                    ("ai-stale", "designer", "processing", "gpt-image-2", "仍在处理", "auto", "", 42, self.now - 1_200),
                ],
            )
            conn.execute(
                """
                UPDATE ai_image_jobs
                SET provider = 'sub2api', resolution = '2K', reference_count = 2,
                    has_reference = 1,
                    request_meta_json = '{"manual_reference_count":1,"context_reference_count":1,"reference_names":["a.png","previous.png"]}',
                    original_prompt = '做一张鞋服海报',
                    resolved_prompt = '夏季鞋服海报，蓝色背景',
                    prompt_trace = '{"planner":"skill"}',
                    task_id = 'upstream-1',
                    image_url = '/ai-images/admin/result.png'
                WHERE id = 'ai-done'
                """
            )
            conn.execute(
                """
                INSERT INTO agent_images
                  (id, project_id, user_id, provider, model, prompt_json, image_url,
                   vlm_analysis_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "agent-done",
                    "project-1",
                    "designer",
                    "sub2api",
                    "gpt-image-2",
                    '{"positive_prompt":"Agent 鞋服海报"}',
                    "/ai-images/designer/agent.png",
                    '{"score":88}',
                    self.now - 90,
                ),
            )
            conn.execute(
                """
                INSERT INTO jobs
                  (id, user_id, status, request_json, progress_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "compose-done",
                    "admin",
                    "done",
                    '{"template_frame_id":"frame-12345678","slots":{"product_1":{}}}',
                    "[]",
                    self.now - 300,
                    self.now - 250,
                ),
            )
            conn.execute(
                """
                INSERT INTO special_jobs
                  (id, user_id, status, sku, request_json, progress_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "special-previous",
                    "admin",
                    "failed",
                    "ABAW023-6",
                    "{}",
                    "[]",
                    self.now - 25 * 3600,
                    self.now - 25 * 3600,
                ),
            )
            conn.executemany(
                """
                INSERT INTO operation_logs
                  (user_id, username, action, detail, payload, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                [
                    ("admin", "管理员", "compose", "", "", self.now - 60),
                    ("designer", "设计师", "ai_image", "", "", self.now - 80),
                ],
            )
            conn.commit()

    def tearDown(self) -> None:
        job_store._DB_PATH = self.original_db_path
        job_store.settings.allowed_login_users = self.original_login_users
        self.temp_dir.cleanup()

    def test_overview_summarizes_current_period_and_stale_tasks(self) -> None:
        with patch("backend.job_store.time.time", return_value=self.now):
            overview = job_store.load_admin_overview(24)

        self.assertEqual(overview["summary"]["total"], 5)
        self.assertEqual(overview["summary"]["done"], 3)
        self.assertEqual(overview["summary"]["failed"], 1)
        self.assertEqual(overview["summary"]["active"], 1)
        self.assertEqual(overview["summary"]["success_rate"], 75.0)
        self.assertEqual(overview["active_users"], 2)
        self.assertEqual(len(overview["series"]), 12)
        self.assertEqual(sum(item["ai_image"] for item in overview["series"]), 3)
        self.assertEqual(sum(item["agent_image"] for item in overview["series"]), 1)
        self.assertEqual(sum(item["compose"] for item in overview["series"]), 1)
        self.assertEqual(sum(item["special"] for item in overview["series"]), 0)
        self.assertEqual(len(overview["health_timeline"]), 72)
        self.assertIn(
            "degraded",
            {item["state"] for item in overview["health_timeline"]},
        )
        self.assertEqual([item["id"] for item in overview["stale_tasks"]], ["ai-stale"])
        self.assertEqual(overview["failure_reasons"][0]["key"], "timeout")
        self.assertEqual(overview["user_ranking"][0]["display_name"], "李设计")
        self.assertEqual(overview["user_ranking"][0]["image_count"], 3)

    def test_overview_supports_all_time_range(self) -> None:
        with patch("backend.job_store.time.time", return_value=self.now):
            overview = job_store.load_admin_overview(0)

        self.assertEqual(overview["range_hours"], 0)
        self.assertEqual(overview["summary"]["total"], 6)
        self.assertEqual(overview["summary"]["failed"], 2)
        self.assertIsNone(overview["summary"]["volume_change"])
        self.assertEqual(
            next(item for item in overview["breakdown"] if item["type"] == "special")["total"],
            1,
        )
        self.assertEqual(sum(item["total"] for item in overview["series"]), 6)

    def test_task_list_filters_and_formats_compose_summary(self) -> None:
        failed, failed_total = job_store.load_admin_tasks(status="failed")
        self.assertEqual(failed_total, 2)
        self.assertEqual({item["id"] for item in failed}, {"ai-failed", "special-previous"})

        images, image_total = job_store.load_admin_tasks(
            task_type="ai_image",
            user_id="designer",
            search="产品主图",
        )
        self.assertEqual(image_total, 1)
        self.assertEqual(images[0]["id"], "ai-failed")
        self.assertEqual(images[0]["username"], "设计师")
        self.assertEqual(images[0]["display_name"], "李设计")

        by_username, username_total = job_store.load_admin_tasks(search="设计师")
        self.assertEqual(username_total, 3)
        self.assertEqual({item["id"] for item in by_username}, {"ai-failed", "ai-stale", "agent-done"})

        compose, compose_total = job_store.load_admin_tasks(task_type="compose")
        self.assertEqual(compose_total, 1)
        self.assertIn("1 个槽位", compose[0]["summary"])
        self.assertIn("frame-12", compose[0]["summary"])

        referenced, referenced_total = job_store.load_admin_tasks(
            task_type="ai_image",
            provider="sub2api",
            reference="yes",
        )
        self.assertEqual(referenced_total, 1)
        self.assertEqual(referenced[0]["reference_count"], 2)

    def test_task_detail_returns_persisted_diagnostics(self) -> None:
        detail = job_store.load_admin_task_detail("ai_image", "ai-done")
        self.assertIsNotNone(detail)
        self.assertEqual(detail["provider"], "sub2api")
        self.assertEqual(detail["request"]["reference_count"], 2)
        self.assertEqual(detail["request"]["manual_reference_count"], 1)
        self.assertEqual(detail["prompts"]["original"], "做一张鞋服海报")
        self.assertEqual(detail["prompts"]["resolved"], "夏季鞋服海报，蓝色背景")
        self.assertEqual(detail["prompts"]["trace"]["planner"], "skill")
        self.assertEqual(detail["result"]["upstream_task_id"], "upstream-1")

        compose = job_store.load_admin_task_detail("compose", "compose-done")
        self.assertEqual(compose["slot_count"], 1)
        self.assertEqual(compose["request"]["template_frame_id"], "frame-12345678")

        agent = job_store.load_admin_task_detail("agent_image", "agent-done")
        self.assertEqual(agent["request"]["provider"], "sub2api")
        self.assertEqual(agent["prompts"]["resolved"]["positive_prompt"], "Agent 鞋服海报")

    def test_progress_update_preserves_initial_request_snapshot(self) -> None:
        created_at = self.now - 30
        job_store.save_ai_image_job(
            job_id="persist-meta",
            user_id="admin",
            status="processing",
            model="gpt-image-2",
            provider="zenmux",
            prompt="海报",
            size="3:4",
            resolution="4K",
            has_reference=True,
            reference_count=3,
            request_meta={"batch_count": 2},
            created_at=created_at,
        )
        job_store.save_ai_image_job(
            job_id="persist-meta",
            user_id="admin",
            status="processing",
            model="gpt-image-2",
            prompt="海报",
            size="3:4",
            has_reference=True,
            progress=50,
            created_at=created_at,
        )
        detail = job_store.load_admin_task_detail("ai_image", "persist-meta")
        self.assertEqual(detail["provider"], "zenmux")
        self.assertEqual(detail["resolution"], "4K")
        self.assertEqual(detail["reference_count"], 3)
        self.assertEqual(detail["request"]["batch_count"], 2)

    def test_stale_alert_acknowledgement_persists_until_task_set_changes(self) -> None:
        with patch("backend.job_store.time.time", return_value=self.now):
            first = job_store.load_admin_overview(24)
        self.assertFalse(first["stale_alert_acknowledged"])
        self.assertTrue(first["stale_alert_key"])

        job_store.acknowledge_admin_alert("stale_tasks", first["stale_alert_key"], "admin")
        with patch("backend.job_store.time.time", return_value=self.now):
            acknowledged = job_store.load_admin_overview(24)
        self.assertTrue(acknowledged["stale_alert_acknowledged"])
        self.assertEqual(acknowledged["stale_alert_acknowledgement"]["acknowledged_by"], "admin")

        with job_store._connect() as conn:
            conn.execute(
                """
                INSERT INTO ai_image_jobs
                  (id, user_id, status, model, prompt, size, error, progress, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "ai-new-stale",
                    "admin",
                    "processing",
                    "gpt-image-2",
                    "新异常任务",
                    "auto",
                    "",
                    12,
                    self.now - 1_400,
                ),
            )
            conn.commit()

        with patch("backend.job_store.time.time", return_value=self.now):
            changed = job_store.load_admin_overview(24)
        self.assertFalse(changed["stale_alert_acknowledged"])
        self.assertNotEqual(changed["stale_alert_key"], first["stale_alert_key"])

    def test_service_probe_slot_is_unique_and_result_is_persisted(self) -> None:
        slot = "2026-07-28T09:00+0800"
        self.assertTrue(job_store.claim_service_probe("sub2api", slot))
        self.assertFalse(job_store.claim_service_probe("sub2api", slot))
        job_store.complete_service_probe(
            "sub2api",
            slot,
            status="done",
            latency_ms=1234,
            result={
                "model": "gpt-image-2",
                "image_url": "/ai-images/_service-monitor/probe.png",
            },
        )
        latest = job_store.load_latest_service_probe("sub2api")
        self.assertIsNotNone(latest)
        self.assertEqual(latest["status"], "done")
        self.assertEqual(latest["latency_ms"], 1234)
        self.assertEqual(latest["result"]["model"], "gpt-image-2")
        completed = job_store.load_latest_completed_service_probe("sub2api")
        self.assertEqual(completed["scheduled_slot"], slot)

        running_slot = "2026-07-28T10:00+0800"
        self.assertTrue(job_store.claim_service_probe("sub2api", running_slot))
        self.assertEqual(job_store.load_latest_service_probe("sub2api")["status"], "running")
        self.assertEqual(
            job_store.load_latest_completed_service_probe("sub2api")["scheduled_slot"],
            slot,
        )
        history = job_store.load_service_probes("sub2api", limit=48)
        self.assertEqual([item["scheduled_slot"] for item in history], [running_slot, slot])
        self.assertEqual(history[1]["result"]["image_url"], "/ai-images/_service-monitor/probe.png")
        expired_urls = job_store.prune_service_probes("sub2api", self.now + 1)
        self.assertEqual(expired_urls, ["/ai-images/_service-monitor/probe.png"])
        self.assertEqual(job_store.load_service_probes("sub2api"), [])

    def test_inspiration_writes_commit_before_connection_closes(self) -> None:
        post_id = "inspiration-commit"
        self.assertTrue(
            job_store.create_inspiration_post(
                post_id=post_id,
                job_id="inspiration-job",
                user_id="admin",
                image_url="/ai-images/admin/source.png",
                thumb_url="",
                prompt="发布测试",
                model="gpt-image-2",
                size="1:1",
                resolution="1K",
                has_ref=False,
                image_width=1024,
                image_height=1024,
                created_at=self.now,
            )
        )
        self.assertIsNotNone(job_store.get_inspiration_post(post_id))

        job_store.update_inspiration_thumb_url(post_id, "/thumbs/source.webp")
        job_store.update_inspiration_dimensions(post_id, 800, 1200)
        job_store.update_inspiration_vlm(post_id, "反推提示词", "图片描述")
        updated = job_store.get_inspiration_post(post_id)
        self.assertEqual(updated["thumb_url"], "/thumbs/source.webp")
        self.assertEqual((updated["image_width"], updated["image_height"]), (800, 1200))
        self.assertEqual(updated["vlm_prompt"], "反推提示词")
        self.assertEqual(updated["vlm_description"], "图片描述")

        self.assertTrue(job_store.set_inspiration_favorite(post_id, "designer", True))
        self.assertTrue(job_store.is_inspiration_favorited(post_id, "designer"))
        self.assertTrue(job_store.set_inspiration_favorite(post_id, "designer", False))
        self.assertFalse(job_store.is_inspiration_favorited(post_id, "designer"))

        self.assertTrue(job_store.delete_inspiration_post(post_id))
        self.assertIsNone(job_store.get_inspiration_post(post_id))


if __name__ == "__main__":
    unittest.main()

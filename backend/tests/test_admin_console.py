from __future__ import annotations

import json
import tempfile
import time
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from backend import job_store, main


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

    def test_agent_mode_counted_per_request_and_by_source(self) -> None:
        from backend.agent2 import store as agent2_store
        from backend.models import SpecialComposeJob, SpecialComposeRequest

        agent2_store.init_tables()
        with job_store._connect() as conn:
            conn.executemany(
                "INSERT INTO ai_image_jobs (id, user_id, status, model, prompt, size, progress, created_at, request_meta_json)"
                " VALUES (?, ?, ?, 'gpt-image-2.5', '跑鞋', '3:4', 100, ?, ?)",
                [("agent-ai-1", "designer", "done", self.now - 50, '{"source":"agent2","session_id":"s1"}'),
                 ("agent-ai-2", "designer", "failed", self.now - 40, '{"source":"agent2","session_id":"s1"}')],
            )
            conn.executemany(
                "INSERT INTO agent2_turns (id, session_id, user_id, status, started_at) VALUES (?, ?, ?, ?, ?)",
                [("t1", "s1", "designer", "done", self.now - 60), ("t2", "s1", "designer", "failed", self.now - 45),
                 ("t3", "s2", "admin", "cancelled", self.now - 30), ("t-old", "s0", "admin", "done", self.now - 30 * 86400)],
            )
        request = SpecialComposeRequest(file_id="f", page_id="p", frame_ids=["a"], sku="ABAW1", fields={})
        job = SpecialComposeJob(id="agent-special", user_id="designer", request=request,
                                created_at=self.now - 20, source="agent2")
        job_store.save_special_job(job)
        # 恢复时重建的任务对象没有来源，再保存也不能清掉
        job_store.save_special_job(job.model_copy(update={"source": ""}))

        with patch("backend.job_store.time.time", return_value=self.now):
            overview = job_store.load_admin_overview(24)
        # 产出层：每次生图、特殊品都是一个任务，计入总量，并标出其中来自 Agent 的数量
        self.assertEqual(overview["summary"]["total"], 8)
        breakdown = {item["type"]: item for item in overview["breakdown"]}
        self.assertEqual((breakdown["ai_image"]["total"], breakdown["ai_image"]["agent"]), (5, 2))
        self.assertEqual((breakdown["special"]["total"], breakdown["special"]["agent"]), (1, 1))
        # 使用层：会话、轮次只统计时间范围内的
        self.assertEqual(overview["agent"], {
            "sessions": 2, "turns": 3, "failed_turns": 1, "cancelled_turns": 1, "users": 2,
            "images": 2, "images_done": 1, "special": 1, "images_per_turn": 0.3})

        agent_tasks, total = job_store.load_admin_tasks(source="agent")
        self.assertEqual(total, 3)
        self.assertEqual({t["id"] for t in agent_tasks}, {"agent-ai-1", "agent-ai-2", "agent-special"})
        self.assertTrue(all(t["source"] == "agent" for t in agent_tasks))
        normal, _ = job_store.load_admin_tasks(source="normal")
        self.assertFalse({t["id"] for t in normal} & {"agent-ai-1", "agent-special"})
        with (
            patch.object(main, "_current_user", return_value={"id": "admin", "role": "admin"}),
            patch.object(main, "_is_admin", return_value=True),
            self.assertRaises(HTTPException) as raised,
        ):
            main.admin_tasks(object(), source="bogus")
        self.assertEqual(raised.exception.status_code, 400)

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
            provider="sub2api",
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
        self.assertEqual(detail["provider"], "sub2api")
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

    def test_load_admin_tasks_bfl_provider(self) -> None:
        created_at = self.now - 60
        job_store.save_ai_image_job(
            job_id="ai-bfl-outpaint",
            user_id="designer",
            status="done",
            model="flux-outpaint",
            provider="bfl",
            prompt="扩图",
            size="1024x1024",
            created_at=created_at,
        )
        tasks_bfl, total_bfl = job_store.load_admin_tasks(provider="bfl")
        self.assertEqual(total_bfl, 1)
        self.assertEqual(tasks_bfl[0]["id"], "ai-bfl-outpaint")

        tasks_blf, total_blf = job_store.load_admin_tasks(provider="blf")
        self.assertEqual(total_blf, 1)
        self.assertEqual(tasks_blf[0]["id"], "ai-bfl-outpaint")

    def test_user_ranking_includes_all_users_beyond_five(self) -> None:
        with job_store._connect() as conn:
            for i in range(1, 8):
                uid = f"user_rank_{i}"
                conn.execute(
                    "INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, ?)",
                    (uid, f"user{i}", f"user{i}", self.now - 1000),
                )
                conn.execute(
                    """
                    INSERT INTO ai_image_jobs (id, user_id, status, model, prompt, size, created_at)
                    VALUES (?, ?, 'done', 'gpt-image-2', 'test', '1024x1024', ?)
                    """,
                    (f"rank-job-{i}", uid, self.now - 100),
                )
            conn.commit()

        with patch("backend.job_store.time.time", return_value=self.now):
            overview = job_store.load_admin_overview(24)

        self.assertGreaterEqual(len(overview["user_ranking"]), 7)

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

    def test_test_user_isolation_and_exclusion(self) -> None:
        """验证标记为 is_test: True 的测试账号发起的任务和操作不计入后台管理和统计"""
        job_store.settings.allowed_login_users = [
            {"id": "admin", "username": "管理员", "display_name": "张运营", "role": "admin"},
            {"id": "designer", "username": "设计师", "display_name": "李设计", "role": "user"},
            {"id": "test_bot", "username": "测试账号", "display_name": "自动化测试", "role": "user", "is_test": True},
        ]
        self.assertIn("test_bot", job_store.settings.get_test_user_ids())

        # 模拟已有配置中存在测试账号的真实场景，调用 init_db() 触发自动全量同步持久化
        job_store.init_db()
        self.assertIn("test_bot", job_store._test_user_ids_set())

        # 模拟测试账号产生任务与日志
        with job_store._connect() as conn:
            conn.execute(
                """
                INSERT INTO ai_image_jobs
                  (id, user_id, status, model, prompt, size, error, progress, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                ("ai-test-user", "test_bot", "done", "gpt-image-2", "测试图", "auto", "", 100, self.now - 50),
            )
            conn.execute(
                """
                INSERT INTO jobs
                  (id, user_id, status, request_json, result_path, error, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                ("compose-test-user", "test_bot", "done", "{}", "/out/test.png", "", self.now - 50, self.now - 50),
            )

        job_store.log_operation(user_id="test_bot", username="测试账号", action="ai_image", detail="测试账号生图")

        # 1. 验证后台基础统计已排除 test_bot
        stats = job_store.load_admin_stats()
        self.assertEqual(stats["users"], 2)  # admin + designer，不含 test_bot

        # 2. 验证后台 overview 已排除 test_bot 任务
        overview = job_store.load_admin_overview(24)
        for task in overview.get("recent_failures", []):
            self.assertNotEqual(task.get("user_id"), "test_bot")

        # 3. 验证 load_admin_tasks 默认不包含 test_bot 任务，但显式指定 user_id 时可查出
        tasks, total = job_store.load_admin_tasks()
        task_user_ids = [t["user_id"] for t in tasks]
        self.assertNotIn("test_bot", task_user_ids)

        test_tasks, _ = job_store.load_admin_tasks(user_id="test_bot")
        self.assertEqual(len(test_tasks), 2)

        # 4. 验证管理员可以显式查看特定测试任务的快照详情 (P2 修复验证)
        detail = job_store.load_admin_task_detail("ai_image", "ai-test-user")
        self.assertIsNotNone(detail)
        self.assertEqual(detail["id"], "ai-test-user")

        # 5. 验证操作日志默认不包含 test_bot 的日志
        logs = job_store.load_operation_logs()
        log_users = [l["user_id"] for l in logs]
        self.assertNotIn("test_bot", log_users)

        # 6. 生命周期的后置验证 (P1 修复验证)：从 allowed_login_users 中删除该测试账号
        job_store.settings.allowed_login_users = [
            {"id": "admin", "username": "管理员", "display_name": "张运营", "role": "admin"},
            {"id": "designer", "username": "设计师", "display_name": "李设计", "role": "user"},
        ]
        # 即使删除后，DB users 表中已记录 is_test = 1，其历史数据依然不能恢复污染正式统计
        stats_after_delete = job_store.load_admin_stats()
        self.assertEqual(stats_after_delete["users"], 2)
        tasks_after_delete, _ = job_store.load_admin_tasks()
        self.assertNotIn("test_bot", [t["user_id"] for t in tasks_after_delete])

    def test_admin_create_user_syncs_test_status(self) -> None:
        body = {
            "username": "route_test_user",
            "display_name": "路由测试",
            "role": "user",
            "password": "temporary-password",
            "is_test": True,
        }
        with (
            patch("backend.main._current_user", return_value={"id": "admin", "role": "admin"}),
            patch.object(main.settings, "save_login_users") as save_users,
            patch("backend.main.hash_password", return_value="hashed-password"),
            patch("backend.main.sync_user_test_status") as sync_test_status,
        ):
            result = main.admin_create_user(object(), body)

        self.assertEqual(result["user"]["id"], "route_test_user")
        save_users.assert_called_once()
        sync_test_status.assert_called_once_with("route_test_user", True)


class AdminReferenceImagesTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.output = Path(self.temp.name)
        patcher = patch.object(main.settings, "output_path", self.output)
        patcher.start()
        self.addCleanup(patcher.stop)

    def detail(self, meta):
        return {"id": "retry-job", "user_id": "designer", "has_reference": True, "request": meta}

    def test_admin_endpoint_exposes_originals_and_context_without_duplicates(self):
        refs = [{"url": "/ai-images/designer/refs/batch/ref_00.png", "name": "商品.png", "type": "manual"},
                {"url": "/ai-images/designer/previous.png", "type": "context"}]
        detail = self.detail({"reference_images": refs, "context_reference_url": refs[1]["url"],
                              "reference_previews": ["/thumbnail.png"]})
        with (
            patch.object(main, "_current_user", return_value={"id": "admin", "role": "admin"}),
            patch.object(main, "load_admin_task_detail", return_value=detail),
        ):
            result = main.admin_task_detail(object(), "ai_image", "retry-job")
        self.assertEqual(result["task"]["request"]["reference_images"], refs)
        # Returned data remains serializable in the HTTP response.
        json.dumps(result)

    def test_legacy_batch_and_retry_use_shared_reference_directory(self):
        ref_dir = self.output / "ai-images/designer/refs/shared-batch"
        ref_dir.mkdir(parents=True)
        for name in ("ref_01.jpg", "ref_00.png", "unrelated.png"):
            (ref_dir / name).write_bytes(b"test")
        refs = main._admin_reference_images(self.detail({
            "reference_storage_job_id": "shared-batch", "manual_reference_count": 1,
            "reference_names": ["上衣.png", "previous.jpg"],
        }))
        self.assertEqual([r["name"] for r in refs], ["上衣.png", "previous.jpg"])
        self.assertEqual([r["type"] for r in refs], ["manual", "context"])
        self.assertEqual(refs[0]["url"], "/ai-images/designer/refs/shared-batch/ref_00.png")
        self.assertNotIn(str(self.output), json.dumps(refs))

    def test_legacy_job_id_preview_and_missing_files(self):
        ref_dir = self.output / "ai-images/designer/refs/retry-job"
        ref_dir.mkdir(parents=True)
        (ref_dir / "ref_00.webp").write_bytes(b"test")
        self.assertEqual(main._admin_reference_images(self.detail({}))[0]["url"],
                         "/ai-images/designer/refs/retry-job/ref_00.webp")
        detail = self.detail({"reference_storage_job_id": "missing",
                              "reference_previews": ["data:image/png;base64,AAAA", "javascript:alert(1)",
                                                     "/legacy.png", "/legacy.png"]})
        self.assertEqual([r["url"] for r in main._admin_reference_images(detail)], ["/legacy.png"])
        detail["request"]["reference_previews"] = []
        self.assertEqual(main._admin_reference_images(detail), [])
        detail["request"].update(reference_previews=["/manual.png"], context_reference_url="/context.png")
        self.assertEqual([r["url"] for r in main._admin_reference_images(detail)],
                         ["/manual.png", "/context.png"])
        refs = main._admin_reference_images(self.detail({"manual_reference_count": 0}))
        self.assertEqual(refs[0]["type"], "context")

    def test_outpainting_source_and_invalid_storage_directory(self):
        ref_dir = self.output / "ai-images/designer/refs/shared-batch"
        ref_dir.mkdir(parents=True)
        (ref_dir / "ref_00.png").write_bytes(b"test")
        detail = self.detail({"reference_storage_job_id": "../refs/shared-batch"})
        self.assertEqual(main._admin_reference_images(detail), [])
        detail["request"].update(operation="outpainting", source_snapshot_url="/source.png")
        self.assertEqual(main._admin_reference_images(detail)[0]["type"], "outpainting_source")

    def test_non_admin_cannot_read_task_references(self):
        with (
            patch.object(main, "_current_user", return_value={"id": "designer", "role": "user"}),
            patch.object(main, "load_admin_task_detail") as loader,
            self.assertRaises(HTTPException) as raised,
        ):
            main.admin_task_detail(object(), "ai_image", "retry-job")
        self.assertEqual(raised.exception.status_code, 403)
        loader.assert_not_called()


if __name__ == "__main__":
    unittest.main()


class AdminSkillUsageTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_db_path = job_store._DB_PATH
        self.original_login_users = list(job_store.settings.allowed_login_users)
        job_store.settings.allowed_login_users = []
        job_store._DB_PATH = Path(self.temp_dir.name) / "skill-usage.db"
        job_store.init_db()
        now = time.time()
        with job_store._connect() as conn:
            conn.executemany(
                """
                INSERT INTO ai_image_jobs
                  (id, user_id, status, model, prompt, size, progress, created_at, request_meta_json)
                VALUES (?, ?, ?, 'gpt-image-2', 'p', 'auto', 0, ?, ?)
                """,
                [
                    ("s1", "alice", "done", now - 30, '{"skill": "poster-main"}'),
                    ("s2", "alice", "failed", now - 20, '{"skill": "poster-main"}'),
                    ("s3", "bob", "done", now - 10, '{"skill": "poster-main"}'),
                    ("s4", "alice", "done", now - 5, '{"skill": ""}'),
                    ("s5", "alice", "done", now, "not json"),
                ],
            )

    def tearDown(self) -> None:
        job_store._DB_PATH = self.original_db_path
        job_store.settings.allowed_login_users = self.original_login_users
        self.temp_dir.cleanup()

    def test_usage_stats_group_by_user_and_skill(self) -> None:
        stats = job_store.load_skill_usage_stats()
        self.assertEqual(set(stats), {("alice", "poster-main"), ("bob", "poster-main")})
        self.assertEqual(stats[("alice", "poster-main")]["total"], 2)
        self.assertEqual(stats[("alice", "poster-main")]["failed"], 1)

    def test_admin_tasks_filter_by_skill_and_user(self) -> None:
        tasks, total = job_store.load_admin_tasks(skill="poster-main", user_id="alice")
        self.assertEqual(total, 2)
        self.assertEqual(sorted(task["id"] for task in tasks), ["s1", "s2"])


class AdminOverviewCalendarRangeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_db_path = job_store._DB_PATH
        self.original_login_users = list(job_store.settings.allowed_login_users)
        job_store.settings.allowed_login_users = []
        job_store._DB_PATH = Path(self.temp_dir.name) / "calendar.db"
        job_store.init_db()
        self.today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        self.now = (self.today + timedelta(hours=10)).timestamp()
        rows = [
            ("today-early", self.today + timedelta(minutes=30)),
            ("yesterday-late", self.today - timedelta(hours=1)),
            ("yesterday-morning", self.today - timedelta(hours=19)),
            ("six-days-ago", self.today - timedelta(days=6) + timedelta(hours=1)),
            ("seven-days-ago", self.today - timedelta(days=7) + timedelta(hours=1)),
        ]
        with job_store._connect() as conn:
            conn.executemany(
                """
                INSERT INTO ai_image_jobs (id, user_id, status, model, prompt, size, progress, created_at)
                VALUES (?, 'u1', 'done', 'gpt-image-2', 'p', 'auto', 100, ?)
                """,
                [(task_id, at.timestamp()) for task_id, at in rows],
            )

    def tearDown(self) -> None:
        job_store._DB_PATH = self.original_db_path
        job_store.settings.allowed_login_users = self.original_login_users
        self.temp_dir.cleanup()

    def _overview(self, hours: int) -> dict:
        with patch("backend.job_store.time.time", return_value=self.now):
            return job_store.load_admin_overview(hours)

    def test_today_starts_at_midnight_and_compares_same_period_yesterday(self) -> None:
        overview = self._overview(24)
        # 昨天 23:00 的任务距此刻不足 24 小时，但不属于“今天”
        self.assertEqual(overview["summary"]["total"], 1)
        # 上一周期是昨天 0 点到昨天 10 点：只含昨天 05:00 那条
        self.assertEqual(overview["previous_summary"]["total"], 1)
        self.assertEqual(overview["series"][0]["timestamp"], self.today.timestamp())
        self.assertEqual(len(overview["series"]), 12)

    def test_seven_days_includes_today_and_previous_six_calendar_days(self) -> None:
        overview = self._overview(168)
        self.assertEqual(overview["summary"]["total"], 4)
        self.assertEqual(len(overview["series"]), 7)
        self.assertEqual(overview["series"][0]["timestamp"], (self.today - timedelta(days=6)).timestamp())

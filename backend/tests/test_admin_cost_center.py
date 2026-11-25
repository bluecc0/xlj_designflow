import asyncio
import contextlib
import json
import os
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from backend import cost_pricing, job_store, model_routing
from backend.agent2 import routes as agent2_routes


class AdminCostCenterTest(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmpdir.name) / "test_jobs.db"
        self.orig_db_path = job_store._DB_PATH
        job_store._DB_PATH = self.db_path

    def tearDown(self):
        job_store._DB_PATH = self.orig_db_path
        self.tmpdir.cleanup()

    def test_cost_pricing_resolution(self):
        cost, src = cost_pricing.resolve_image_cost("gpt-image-2.6", provider="apimart", upstream_cost=0.12)
        self.assertEqual(cost, 0.12)
        self.assertEqual(src, "upstream")

        cost, src = cost_pricing.resolve_image_cost("gpt-image-2.6-flare", resolution="2K")
        self.assertEqual(src, "estimated")
        self.assertGreater(cost, 0.06)

        cost, src = cost_pricing.resolve_image_cost("local-matting", provider="local")
        self.assertEqual(cost, 0.0)
        self.assertEqual(src, "free")

        llm_cost, llm_src = cost_pricing.resolve_llm_cost("gpt-5", input_tokens=100_000, output_tokens=10_000)
        self.assertEqual(llm_src, "estimated")
        self.assertGreater(llm_cost, 0)

    def test_bfl_outpainting_actual_credits_and_idempotent_backfill(self):
        job_store.init_db()
        job_store.save_ai_image_job(job_id="outpaint-cost", user_id="u", status="done",
            model="flux-tools/outpainting-v1", provider="bfl", prompt="extend", size="1024x1024",
            request_meta={"cost": 5.7, "operation": "outpainting"})
        with job_store._connect() as conn:
            row = conn.execute("SELECT cost,cost_source,cost_unit FROM ai_image_jobs WHERE id='outpaint-cost'").fetchone()
            self.assertEqual(tuple(row), (0.057, "upstream", "USD"))
            conn.execute("UPDATE ai_image_jobs SET cost=0,cost_source='manual'")
            job_store._backfill_ai_image_costs(conn)
            job_store._backfill_ai_image_costs(conn)
            row = conn.execute("SELECT cost,cost_source,cost_unit FROM ai_image_jobs WHERE id='outpaint-cost'").fetchone()
            self.assertEqual(tuple(row), (0.057, "upstream", "USD"))

    def test_bfl_missing_or_invalid_cost_is_not_marked_actual(self):
        job_store.init_db()
        for index, cost in enumerate([None, True, -1, "nan", "invalid"]):
            job_store.save_ai_image_job(job_id=f"invalid-{index}", user_id="u", status="done",
                model="flux-tools/outpainting-v1", provider="bfl", prompt="extend", size="1024x1024",
                request_meta={"cost": cost})
        with job_store._connect() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM ai_image_jobs WHERE cost_source='upstream'").fetchone()[0], 0)

    def test_kie_credits_not_treated_as_usd(self):
        # Without KIE_CREDIT_TO_USD, 10 KIE credits must NOT become $10.00 upstream USD
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("KIE_CREDIT_TO_USD", None)
            cost, src = cost_pricing.resolve_image_cost("kie-topaz", provider="kie", upstream_cost=10)
            self.assertEqual(src, "estimated")
            self.assertAlmostEqual(cost, 0.04, places=4)

        # With explicit conversion rate, convert credits to USD
        with patch.dict(os.environ, {"KIE_CREDIT_TO_USD": "0.005"}):
            cost, src = cost_pricing.resolve_image_cost("kie-topaz", provider="kie", upstream_cost=10)
            self.assertEqual(src, "upstream")
            self.assertAlmostEqual(cost, 0.05, places=4)

    def test_legacy_db_migration_and_backfill(self):
        now = time.time()
        with contextlib.closing(sqlite3.connect(self.db_path)) as conn, conn:
            conn.execute("""
                CREATE TABLE ai_image_jobs (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    model TEXT NOT NULL,
                    provider TEXT,
                    prompt TEXT NOT NULL,
                    size TEXT NOT NULL,
                    image_url TEXT,
                    has_reference INTEGER NOT NULL DEFAULT 0,
                    error TEXT,
                    created_at REAL NOT NULL,
                    cost REAL,
                    cost_source TEXT,
                    input_tokens INTEGER,
                    output_tokens INTEGER,
                    total_tokens INTEGER
                )
            """)
            conn.execute("""
                CREATE TABLE operation_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    username TEXT NOT NULL,
                    action TEXT NOT NULL,
                    detail TEXT NOT NULL DEFAULT '',
                    payload TEXT NOT NULL DEFAULT '',
                    created_at REAL NOT NULL
                )
            """)
            conn.execute("""
                CREATE TABLE users (
                    id TEXT PRIMARY KEY,
                    username TEXT NOT NULL,
                    username_key TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    password_hash TEXT,
                    is_test INTEGER NOT NULL DEFAULT 0
                )
            """)
            conn.execute(
                "INSERT INTO users (id, username, username_key, created_at, is_test) VALUES (?, ?, ?, ?, 0)",
                ("u1", "alice", "alice", now),
            )
            conn.execute(
                "INSERT INTO ai_image_jobs (id, user_id, status, model, provider, prompt, size, image_url, created_at) VALUES (?, ?, 'done', ?, ?, 'poster', '1:1', '/output/1.png', ?)",
                ("job-1", "u1", "gpt-image-2.6", "apimart", now),
            )
            conn.execute(
                "INSERT INTO ai_image_jobs (id, user_id, status, model, provider, prompt, size, image_url, created_at) VALUES (?, ?, 'done', ?, ?, 'banner', '1:1', '/output/2.png', ?)",
                ("job-2", "u1", "gpt-image-2", "sub2api", now),
            )
            # Simulate previously mis-recorded KIE credits as upstream USD
            conn.execute(
                "INSERT INTO ai_image_jobs (id, user_id, status, model, provider, prompt, size, image_url, created_at, cost, cost_source) VALUES (?, ?, 'done', ?, ?, 'upscale', '', '/output/3.png', ?, 10.0, 'upstream')",
                ("job-kie", "u1", "kie-topaz", "kie", now),
            )
            conn.execute(
                "INSERT INTO operation_logs (user_id, username, action, detail, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    "u1",
                    "alice",
                    "ai_image",
                    "done",
                    json.dumps({
                        "job_id": "job-1",
                        "model": "gpt-image-2.6",
                        "result": "done",
                        "cost": 0.08,
                        "usage": {"input_tokens": 100, "output_tokens": 200, "total_tokens": 300},
                        "provider": "apimart",
                    }),
                    now,
                ),
            )

        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("KIE_CREDIT_TO_USD", None)
            job_store.init_db()

        with contextlib.closing(sqlite3.connect(self.db_path)) as conn:
            conn.row_factory = sqlite3.Row
            j1 = conn.execute("SELECT cost, cost_source, total_tokens FROM ai_image_jobs WHERE id='job-1'").fetchone()
            j2 = conn.execute("SELECT cost, cost_source FROM ai_image_jobs WHERE id='job-2'").fetchone()
            jkie = conn.execute("SELECT cost, cost_source FROM ai_image_jobs WHERE id='job-kie'").fetchone()
            self.assertAlmostEqual(j1["cost"], 0.08, places=4)
            self.assertEqual(j1["cost_source"], "upstream")
            self.assertEqual(j1["total_tokens"], 300)
            self.assertIn(j2["cost_source"], ("estimated", "manual"))
            self.assertGreater(j2["cost"], 0)
            self.assertNotEqual(jkie["cost_source"], "upstream")
            self.assertLess(jkie["cost"], 1.0)

    def test_load_admin_cost_center_dimensions(self):
        job_store.init_db()
        now = time.time()
        with contextlib.closing(sqlite3.connect(self.db_path)) as conn, conn:
            conn.execute(
                "INSERT INTO users (id, username, username_key, created_at, is_test) VALUES (?, ?, ?, ?, 0)",
                ("u1", "alice", "alice", now),
            )
            conn.execute(
                "INSERT INTO users (id, username, username_key, created_at, is_test) VALUES (?, ?, ?, ?, 0)",
                ("u2", "bob", "bob", now),
            )
            conn.execute(
                "INSERT INTO users (id, username, username_key, created_at, is_test) VALUES (?, ?, ?, ?, 1)",
                ("u_test", "tester", "tester", now),
            )
            conn.execute(
                "INSERT INTO ai_image_jobs (id, user_id, status, model, provider, prompt, size, created_at, cost, cost_source, total_tokens) VALUES (?, ?, 'done', ?, ?, 'p', '1:1', ?, ?, 'upstream', ?)",
                ("img-1", "u1", "gpt-image-2.6", "sub2api", now, 0.10, 1200),
            )
            conn.execute(
                "INSERT INTO ai_image_jobs (id, user_id, status, model, provider, prompt, size, created_at, cost, cost_source, total_tokens) VALUES (?, ?, 'done', ?, ?, 'p', '1:1', ?, ?, 'upstream', ?)",
                ("img-test", "u_test", "gpt-image-2.6", "sub2api", now, 9.99, 5000),
            )

        job_store.record_llm_usage(
            user_id="u2",
            model="gpt-5",
            provider="sub2api",
            input_tokens=2000,
            output_tokens=500,
            total_tokens=2500,
            cost=0.02,
        )

        with patch.object(job_store, "_test_user_ids_set", return_value={"u_test"}):
            data = job_store.load_admin_cost_center(hours=24, include_test=False)
            self.assertEqual(data["summary"]["total_calls"], 2)
            self.assertAlmostEqual(data["summary"]["total_cost"], 0.12, places=4)
            self.assertEqual(data["summary"]["total_tokens"], 3700)
            self.assertEqual(len(data["by_member"]), 2)
            self.assertEqual(data["by_member"][0]["user_id"], "u1")
            self.assertEqual(len(data["by_model"]), 2)
            self.assertGreaterEqual(len(data["timeline"]), 1)

            filtered = job_store.load_admin_cost_center(hours=24, model="gpt-5", include_test=False)
            self.assertEqual(filtered["summary"]["total_calls"], 1)
            self.assertAlmostEqual(filtered["summary"]["total_cost"], 0.02, places=4)

    def test_manual_model_pricing_and_db_sync(self):
        job_store.init_db()
        now = time.time()
        with contextlib.closing(sqlite3.connect(self.db_path)) as conn, conn:
            conn.execute(
                "INSERT INTO users (id, username, username_key, created_at, is_test) VALUES (?, ?, ?, ?, 0)",
                ("u1", "alice", "alice", now),
            )
            conn.execute(
                "INSERT INTO ai_image_jobs (id, user_id, status, model, provider, prompt, size, created_at, cost, cost_source) VALUES (?, ?, 'done', ?, ?, 'p', '1:1', ?, ?, 'estimated')",
                ("img-est", "u1", "custom-img-model", "sub2api", now, 0.04),
            )
            conn.execute(
                "INSERT INTO ai_image_jobs (id, user_id, status, model, provider, prompt, size, created_at, cost, cost_source) VALUES (?, ?, 'done', ?, ?, 'p', '1:1', ?, ?, 'upstream')",
                ("img-up", "u1", "custom-img-model", "apimart", now, 0.25),
            )

        items = job_store.list_admin_model_pricing()
        unreg = [it for it in items if it["model_key"] == "custom-img-model"]
        self.assertEqual(len(unreg), 1)
        self.assertFalse(unreg[0]["registered"])

        res = job_store.save_admin_model_pricing(
            category="image",
            model_key="custom-img-model",
            price_1k=0.05,
            price_1_5k=0.07,
            price_2k=0.09,
            price_4k=0.14,
            note="手动登记",
            updated_by="admin",
            sync_history=True,
        )
        self.assertEqual(res["synced_count"], 1)

        with contextlib.closing(sqlite3.connect(self.db_path)) as conn:
            conn.row_factory = sqlite3.Row
            est_row = conn.execute("SELECT cost, cost_source FROM ai_image_jobs WHERE id='img-est'").fetchone()
            up_row = conn.execute("SELECT cost, cost_source FROM ai_image_jobs WHERE id='img-up'").fetchone()
            self.assertAlmostEqual(est_row["cost"], 0.05, places=4)
            self.assertEqual(est_row["cost_source"], "manual")
            self.assertAlmostEqual(up_row["cost"], 0.25, places=4)
            self.assertEqual(up_row["cost_source"], "upstream")

    def test_resolution_tiers_and_size_inference(self):
        self.assertEqual(cost_pricing.infer_resolution_tier("1.5K", "auto"), "1.5K")
        self.assertEqual(cost_pricing.infer_resolution_tier(None, "2048x2048"), "2K")
        self.assertEqual(cost_pricing.infer_resolution_tier(None, "4096x4096"), "4K")
        self.assertEqual(cost_pricing.infer_resolution_tier("", "1536x1536"), "1.5K")
        self.assertEqual(cost_pricing.infer_resolution_tier(None, "1024x1024"), "1K")

        c1, _ = cost_pricing.resolve_image_cost("seedream-5.0-lite", resolution="1K")
        c15, _ = cost_pricing.resolve_image_cost("seedream-5.0-lite", resolution="1.5K")
        c2, _ = cost_pricing.resolve_image_cost("seedream-5.0-lite", resolution="2K")
        self.assertLess(c1, c15)
        self.assertLess(c15, c2)

    def test_agent2_user_context_binding_and_concurrency_isolation(self):
        with model_routing.usage_user_scope(None):
            req = SimpleNamespace(state=SimpleNamespace(user={"id": "operator_e", "username": "operator_e"}))
            u = agent2_routes._user(req)
            self.assertEqual(u["id"], "operator_e")
            self.assertEqual(model_routing.get_usage_user(), "operator_e")

        # After scope exit, context is restored
        self.assertIsNone(model_routing.get_usage_user())

        async def _run_concurrent():
            results = {}

            async def worker(uid: str, delay: float):
                with model_routing.usage_user_scope(uid):
                    await asyncio.sleep(delay)
                    results[uid] = model_routing.get_usage_user()

            await asyncio.gather(worker("user_a", 0.02), worker("user_b", 0.01))
            return results

        res = asyncio.run(_run_concurrent())
        self.assertEqual(res, {"user_a": "user_a", "user_b": "user_b"})
        self.assertIsNone(model_routing.get_usage_user())

    def test_cost_mode_actual_excludes_sub2api(self):
        job_store.init_db()
        now = time.time()
        with contextlib.closing(sqlite3.connect(self.db_path)) as conn, conn:
            conn.execute(
                "INSERT INTO users (id, username, username_key, created_at, is_test) VALUES (?, ?, ?, ?, 0)",
                ("u1", "alice", "alice", now),
            )
            conn.execute(
                "INSERT INTO ai_image_jobs (id, user_id, status, model, provider, prompt, size, created_at, cost, cost_source) VALUES (?, ?, 'done', ?, ?, 'p', '1:1', ?, ?, 'estimated')",
                ("img-sub", "u1", "gpt-image-2.6", "sub2api", now, 0.06),
            )
            conn.execute(
                "INSERT INTO ai_image_jobs (id, user_id, status, model, provider, prompt, size, created_at, cost, cost_source) VALUES (?, ?, 'done', ?, ?, 'p', '1:1', ?, ?, 'upstream')",
                ("img-api", "u1", "gpt-image-2.6", "apimart", now, 0.08),
            )
        job_store.record_llm_usage(
            user_id="u1",
            model="gpt-5",
            provider="sub2api",
            input_tokens=1000,
            output_tokens=200,
            total_tokens=1200,
            cost=0.03,
        )
        job_store.record_llm_usage(
            user_id="u1",
            model="gpt-5",
            provider="apimart",
            input_tokens=1000,
            output_tokens=200,
            total_tokens=1200,
            cost=0.04,
        )

        est = job_store.load_admin_cost_center(hours=24, cost_mode="estimated", include_test=False)
        self.assertEqual(est["summary"]["total_calls"], 4)
        self.assertAlmostEqual(est["summary"]["total_cost"], 0.21, places=4)

        act = job_store.load_admin_cost_center(hours=24, cost_mode="actual", include_test=False)
        self.assertEqual(act["summary"]["total_calls"], 2)
        self.assertAlmostEqual(act["summary"]["total_cost"], 0.12, places=4)

    def test_kie_write_stats_restart_backfill_idempotency(self):
        with patch.dict(os.environ, {"KIE_CREDIT_TO_USD": "0.005"}):
            job_store.init_db()
            now = time.time()
            with contextlib.closing(sqlite3.connect(self.db_path)) as conn, conn:
                conn.execute(
                    "INSERT INTO users (id, username, username_key, created_at, is_test) VALUES (?, ?, ?, ?, 0)",
                    ("u1", "alice", "alice", now),
                )
                conn.execute(
                    "INSERT INTO ai_image_jobs (id, user_id, status, model, provider, prompt, size, created_at) VALUES (?, ?, 'done', ?, ?, 'upscale', '', ?)",
                    ("kie-1", "u1", "kie-topaz", "kie", now),
                )
                conn.execute(
                    "INSERT INTO operation_logs (user_id, username, action, detail, payload, created_at) VALUES (?, ?, 'ai_image', 'done', ?, ?)",
                    ("u1", "alice", json.dumps({"job_id": "kie-1", "result": "done", "cost": 10, "provider": "kie"}), now),
                )

            # 1. Write normalized cost from 10 raw KIE credits -> $0.05 USD
            job_store.update_ai_image_job_cost("kie-1", cost=10, model="kie-topaz", provider="kie")
            with contextlib.closing(sqlite3.connect(self.db_path)) as conn:
                conn.row_factory = sqlite3.Row
                row = conn.execute("SELECT cost, cost_source, cost_unit FROM ai_image_jobs WHERE id='kie-1'").fetchone()
                self.assertAlmostEqual(row["cost"], 0.05, places=6)
                self.assertEqual(row["cost_source"], "upstream")
                self.assertEqual(row["cost_unit"], "USD")

            # 2. Load cost center -> must report $0.05 (NOT 0.00025 / 0.0003)
            stats = job_store.load_admin_cost_center(hours=24, include_test=False)
            self.assertAlmostEqual(stats["summary"]["total_cost"], 0.05, places=6)

            # 3. Simulate server restart (init_db again) -> cost must stay $0.05
            job_store.init_db()
            with contextlib.closing(sqlite3.connect(self.db_path)) as conn:
                conn.row_factory = sqlite3.Row
                row2 = conn.execute("SELECT cost, cost_source, cost_unit FROM ai_image_jobs WHERE id='kie-1'").fetchone()
                self.assertAlmostEqual(row2["cost"], 0.05, places=6)
                self.assertEqual(row2["cost_unit"], "USD")
            stats2 = job_store.load_admin_cost_center(hours=24, include_test=False)
            self.assertAlmostEqual(stats2["summary"]["total_cost"], 0.05, places=6)


if __name__ == "__main__":
    unittest.main()

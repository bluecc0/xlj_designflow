from __future__ import annotations

import asyncio
import hashlib
import io
import json
import subprocess
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

import httpx
from PIL import Image
from starlette.requests import Request

from backend import ai_image, ai_job_recovery, compose_recovery, job_store, main
from backend import special_compose, special_compose_full, compose, bfl_vto
from backend.models import (
    ComposeJob, ComposeRequest, ComposeStatus, SpecialComposeJob, SpecialFullComposeJob,
)
from backend.task_checkpoint import checkpoint, execution_lock, UpstreamTaskFailed


def png(color="red"):
    buffer = io.BytesIO()
    Image.new("RGB", (16, 16), color).save(buffer, "PNG")
    return buffer.getvalue()


class RecoveryTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for target, name, value in [
            (job_store, "_DB_PATH", self.root / "jobs.db"),
            (main.settings, "output_path", self.root),
            (ai_image, "_OUTPUT_DIR", self.root / "ai-images"),
        ]:
            patcher = patch.object(target, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        job_store.init_db()
        with job_store._connect() as connection:
            connection.execute("INSERT INTO ai_chat_sessions(id,user_id,title,created_at,updated_at) VALUES ('session','owner','test',0,0)")
            connection.commit()
        self.image = self.root / "result.png"
        self.image.write_bytes(png())
        self.patches = [
            patch.object(main, "generate_inspiration_thumb", return_value=("/preview.png", 16, 16)),
            patch.object(main, "_resolve_public_asset_path", return_value=self.image),
        ]
        for patcher in self.patches:
            patcher.start()
            self.addCleanup(patcher.stop)

    def seed(self, phase="queued", provider="apimart", **recovery):
        recovery = {"version": 1, "phase": phase, "provider": provider, **recovery}
        job_store.save_ai_image_job(
            job_id="image-job", user_id="owner", status="processing", model="gpt-image-2.5",
            prompt="用户输入", resolved_prompt="实际增强后的提示词", size="1:1",
            provider=provider, resolution="1K", created_at=123456.0,
            request_meta={"recovery": recovery, "execution_prompt": "实际增强后的提示词",
                          "chat_session_id": "session", "quality": "medium", "variant": "sunburst",
                          "batch_id": "batch", "batch_index": 1, "batch_count": 2},
        )

    def job(self):
        return job_store.load_ai_image_job("image-job")

    async def execute(self):
        await ai_job_recovery.execute_image_job(main._execute_ai_image_background, "image-job")

    def retry_now(self):
        job = self.job()
        meta = job["request_meta"]
        meta["recovery"]["retry_after"] = 0
        job_store.save_image_checkpoint("image-job", meta, provider=job["provider"],
                                        task_id=job["task_id"] or "")

    async def test_queued_restores_original_inputs(self):
        self.seed()
        generate = AsyncMock(return_value={"url": "/result.png", "task_id": "original"})
        with patch.object(main, "generate_image_async", generate):
            await self.execute()
        self.assertEqual(generate.await_count, 1)
        self.assertEqual(generate.call_args.kwargs["prompt"], "实际增强后的提示词")
        self.assertEqual(generate.call_args.kwargs["variant"], "sunburst")
        self.assertEqual(generate.call_args.kwargs["quality"], "medium")
        self.assertEqual(self.job()["status"], "done")
        self.assertEqual(self.job()["created_at"], 123456.0)

    async def test_shutdown_after_acceptance_polls_original_without_post(self):
        self.seed()
        accepted = asyncio.Event()

        async def generate(**kwargs):
            kwargs["on_accepted"]("paid-task")
            accepted.set()
            await asyncio.Event().wait()

        generate_mock = AsyncMock(side_effect=generate)
        with patch.object(main, "generate_image_async", generate_mock):
            task = asyncio.create_task(self.execute())
            await accepted.wait()
            # A concurrent startup scanner cannot take over a live worker.
            await self.execute()
            self.assertEqual(generate_mock.await_count, 1)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
        self.assertEqual(self.job()["status"], "processing")
        self.assertEqual(self.job()["task_id"], "paid-task")
        resume = AsyncMock(return_value={"url": "/result.png", "task_id": "paid-task", "provider": "apimart"})
        with patch.object(main, "resume_image_async", resume), patch.object(main, "generate_image_async") as post:
            await self.execute()
        post.assert_not_called()
        self.assertEqual(resume.call_args.kwargs["recovery"]["task_id"], "paid-task")
        self.assertEqual(self.job()["status"], "done")

    async def test_shutdown_before_any_post_can_resume(self):
        self.seed()
        with self.assertRaises(asyncio.CancelledError):
            await ai_job_recovery.execute_image_job(AsyncMock(side_effect=asyncio.CancelledError), "image-job")
        self.assertEqual(self.job()["request_meta"]["recovery"]["phase"], "queued")
        with patch.object(main, "generate_image_async", AsyncMock(return_value={"url": "/result.png"})) as generate:
            await self.execute()
        self.assertEqual(generate.await_count, 1)

    async def test_uncertain_submission_never_reposts(self):
        for provider in ["sub2api", "apimart", "tuzi", "adobe2api", "bfl"]:
            with self.subTest(provider=provider):
                self.seed(phase="submitting", provider=provider)
                worker = AsyncMock()
                await ai_job_recovery.execute_image_job(worker, "image-job")
                worker.assert_not_called()
                self.assertEqual(self.job()["status"], "failed")
                self.assertIn("避免重复", self.job()["error"])

    async def test_sync_completion_id_is_not_a_polling_id(self):
        self.seed(phase="accepted", provider="sub2api", task_id="chatcmpl-123")
        worker = AsyncMock()
        await ai_job_recovery.execute_image_job(worker, "image-job")
        worker.assert_not_called()
        self.assertEqual(self.job()["request_meta"]["recovery"]["phase"], "submission_unknown")

    async def test_read_timeout_stops_auto_routing_and_marks_uncertain(self):
        self.seed(provider="auto")
        async def lost_submission(**kwargs):
            checkpoint("submitting")
            raise httpx.ReadTimeout("lost response")
        with patch.object(ai_image, "get_smart_route_candidates", return_value=["sub2api", "apimart"]), \
             patch.object(ai_image, "generate_sub2api_async", AsyncMock(side_effect=lost_submission)) as sub, \
             patch.object(ai_image, "generate_image_async", AsyncMock()) as post:
            await self.execute()
        self.assertEqual(sub.await_count, 1)
        post.assert_not_called()
        self.assertEqual(self.job()["request_meta"]["recovery"]["phase"], "submission_unknown")

    async def test_interrupted_while_waiting_for_provider_slot_can_resume(self):
        self.seed(provider="sub2api")
        waiting = asyncio.Event()
        async def wait_before_post(**kwargs):
            waiting.set()
            await asyncio.Event().wait()
        with patch.object(main, "generate_sub2api_async", AsyncMock(side_effect=wait_before_post)):
            task = asyncio.create_task(self.execute())
            await waiting.wait()
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
        self.assertEqual(self.job()["request_meta"]["recovery"]["phase"], "preparing")
        with patch.object(main, "generate_sub2api_async", AsyncMock(return_value={"url": "/result.png"})) as generate:
            await self.execute()
        self.assertEqual(generate.await_count, 1)
        self.assertEqual(self.job()["status"], "done")

    async def test_poll_network_error_recovers_with_same_task(self):
        self.seed(phase="accepted", task_id="paid-task")
        with patch.object(main, "resume_image_async", AsyncMock(side_effect=httpx.ConnectError("offline"))):
            await self.execute()
        self.assertEqual(self.job()["status"], "processing")
        self.assertEqual(self.job()["request_meta"]["recovery"]["attempts"], 1)
        self.retry_now()
        with patch.object(main, "resume_image_async", AsyncMock(return_value={"url": "/result.png", "task_id": "paid-task"})), \
             patch.object(main, "generate_image_async") as post:
            await self.execute()
        post.assert_not_called()
        self.assertEqual(self.job()["status"], "done")

    async def test_sync_result_download_recovers_without_generation(self):
        self.seed(phase="downloading", provider="tuzi", result_url="https://cdn.example/result.png")
        with patch.object(ai_image, "_download_tuzi_image", AsyncMock(return_value="/result.png")) as download, \
             patch.object(main, "generate_tuzi_async") as post:
            await self.execute()
        post.assert_not_called()
        self.assertEqual(download.call_args.args[0], "https://cdn.example/result.png")
        self.assertEqual(self.job()["status"], "done")

    async def test_terminal_upstream_failure_is_not_auto_retried(self):
        self.seed(phase="accepted", task_id="paid-task")
        with patch.object(main, "resume_image_async", AsyncMock(side_effect=UpstreamTaskFailed("content rejected"))) as resume:
            await self.execute()
            await self.execute()
        self.assertEqual(resume.await_count, 1)
        self.assertEqual(self.job()["status"], "failed")

    async def test_recovery_stops_after_three_attempts_without_post(self):
        self.seed(phase="accepted", task_id="paid-task")
        with patch.object(main, "resume_image_async", AsyncMock(side_effect=httpx.ReadTimeout("offline"))) as resume, \
             patch.object(main, "generate_image_async") as post:
            for _ in range(3):
                await self.execute()
                if self.job()["status"] != "failed":
                    self.retry_now()
            await self.execute()
        self.assertEqual(resume.await_count, 3)
        post.assert_not_called()
        self.assertEqual(self.job()["status"], "failed")
        self.assertIn("未重新发起生图", self.job()["error"])

    async def test_finalization_is_idempotent(self):
        self.seed(phase="downloaded", local_url="/result.png", task_id="paid-task")
        await self.execute()
        meta = self.job()["request_meta"]
        meta["recovery"]["phase"] = "downloaded"
        job_store.save_image_checkpoint("image-job", meta, provider="apimart", task_id="paid-task", status="done")
        await self.execute()
        with job_store._connect() as connection:
            messages = connection.execute("SELECT meta_json FROM ai_chat_messages WHERE session_id='session'").fetchall()
        self.assertEqual(len(messages), 1)
        self.assertEqual(json.loads(messages[0]["meta_json"])["batchId"], "batch")
        self.assertEqual(self.job()["request_meta"]["recovery"]["phase"], "done")

    async def test_recovery_scan_ignores_other_operations_and_terminal_jobs(self):
        for index, operation in enumerate(["outpainting", "matting", "upscale", "vectorize", "layer_extract"]):
            job_store.save_ai_image_job(job_id=f"other-{index}", user_id="owner", status="processing",
                model="gpt-image-2.5", prompt="p", size="auto", request_meta={"operation": operation})
        self.seed()
        self.assertEqual([job["id"] for job in job_store.load_recoverable_image_jobs()], ["image-job"])
        job_store.save_image_checkpoint("image-job", self.job()["request_meta"], provider="apimart", task_id="", status="failed")
        self.assertEqual(job_store.load_recoverable_image_jobs(), [])

    async def test_missing_queued_references_fails_before_post(self):
        self.seed()
        with job_store._connect() as connection:
            connection.execute("UPDATE ai_image_jobs SET reference_count=2, has_reference=1 WHERE id='image-job'")
            connection.commit()
        with patch.object(main, "generate_image_async") as post:
            await self.execute()
        post.assert_not_called()
        self.assertIn("参考图不完整", self.job()["error"])

    def test_reference_reload_preserves_order_and_ignores_incomplete_temporary_files(self):
        paths = ai_image.save_user_refs("owner", "refs-job", [(b"first", "PHOTO.JPG"), (b"second", "B.PNG")])
        directory = Path(paths[0]).parent
        (directory / ".ref_00.jpg.partial.tmp").write_bytes(b"unfinished")
        # Old reference snapshots can contain uppercase extensions.
        Path(paths[1]).rename(directory / "ref_01.PNG")
        self.assertEqual([content for content, _ in ai_image.load_user_refs("owner", "refs-job")], [b"first", b"second"])

    async def test_startup_rescans_jobs_held_by_old_worker(self):
        self.seed()
        main.app.state.ai_image_tasks = set()
        main.app.state.compose_recovery_tasks = set()
        main.app.state.recovery_jobs = set()
        with patch.object(main, "generate_image_async", AsyncMock(return_value={"url": "/result.png"})) as generate:
            with execution_lock("ai-image:image-job"):
                await main._recover_background_jobs_once()
                await asyncio.gather(*list(main.app.state.ai_image_tasks))
            generate.assert_not_called()
            await main._recover_background_jobs_once()
            await asyncio.gather(*list(main.app.state.ai_image_tasks))
        self.assertEqual(generate.await_count, 1)
        self.assertEqual(self.job()["status"], "done")

    async def test_legacy_failed_accepted_task_can_recover_without_post(self):
        self.seed()
        meta = {"chat_session_id": "session"}
        job_store.save_image_checkpoint("image-job", meta, provider="apimart", task_id="legacy-paid", status="failed")
        job_store.append_ai_chat_message(session_id="session", user_id="owner", role="ai", type="ai_image_result",
            meta={"job_id": "image-job", "status": "failed", "error": "服务重载"})
        self.assertEqual([job["id"] for job in job_store.load_recoverable_image_jobs()], ["image-job"])
        with patch.object(main, "resume_image_async", AsyncMock(return_value={"url": "/result.png", "task_id": "legacy-paid"})), \
             patch.object(main, "generate_image_async") as post:
            await self.execute()
        post.assert_not_called()
        self.assertEqual(self.job()["status"], "done")
        with job_store._connect() as connection:
            rows = connection.execute("SELECT meta_json FROM ai_chat_messages").fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual(json.loads(rows[0]["meta_json"])["status"], "done")

    async def test_failed_checkpoint_prevents_paid_request(self):
        self.seed()
        persist = ai_job_recovery.save_image_checkpoint
        calls = 0
        def fail_once(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise sqlite3.OperationalError("disk unavailable")
            return persist(*args, **kwargs)
        with patch.object(ai_job_recovery, "save_image_checkpoint", side_effect=fail_once), \
             patch.object(main, "generate_image_async") as post:
            await self.execute()
        post.assert_not_called()

    async def test_vto_resume_only_sends_get_requests(self):
        seen = []
        def upstream(request):
            seen.append(request)
            if "poll" in request.url.path:
                return httpx.Response(200, json={"status": "Ready", "result": {"sample": "https://cdn.bfl.ai/result.jpg"}})
            return httpx.Response(200, content=png())
        client = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
        with patch.object(bfl_vto.httpx, "AsyncClient", return_value=client), \
             patch.object(bfl_vto.settings, "bfl_api_key", "fake-key"), \
             patch.object(bfl_vto.asyncio, "sleep", AsyncMock()):
            result = await bfl_vto.generate_vto_async(prompt="p", person=b"", garment=b"", user_id="owner",
                resume={"id": "paid-vto", "polling_url": "https://api.bfl.ai/poll/paid-vto"})
        self.assertEqual([request.method for request in seen], ["GET", "GET"])
        self.assertEqual(result["task_id"], "paid-vto")

    def test_process_lock_excludes_other_process_and_releases(self):
        script = (
            "from pathlib import Path; from backend.config import settings; "
            "from backend.task_checkpoint import execution_lock; "
            f"settings.output_path=Path({str(self.root)!r}); "
            "\nwith execution_lock('shared') as acquired: print(int(acquired))"
        )
        def probe():
            return subprocess.check_output([sys.executable, "-c", script], text=True).strip()
        with execution_lock("shared") as acquired:
            self.assertTrue(acquired)
            self.assertEqual(probe(), "0")
        self.assertEqual(probe(), "1")


class SpecialRecoveryTest(unittest.TestCase):
    setUp = RecoveryTest.setUp
    def special(self, full=False):
        cls = SpecialFullComposeJob if full else SpecialComposeJob
        return cls(id="special-job", user_id="owner", created_at=123456,
                   request={"file_id": "template", "page_id": "page", "frame_ids": ["a", "b"], "sku": "SKU"},
                   penpot_file_id="existing-copy", penpot_page_id="page",
                   result_frame_ids=["a", "b"], result_frame_names=["首页", "主图"])

    def plan(self, job):
        job.recovery.update(phase="exporting", export_plan={
            "frames": [{"id": "a", "name": "首页"}, {"id": "b", "name": "主图"}],
            "versions": {"first": [["one", "page"]], "second": [["two", "page"]]},
            "variant_frames": ["b"],
        }, completed={})
        job.status = ComposeStatus.running
        job_store.save_special_job(job)

    def test_two_kinds_round_trip_and_response_hides_private_checkpoints(self):
        for full in [False, True]:
            job = self.special(full)
            job_store.save_special_job(job)
            loaded = job_store.load_special_job_model(job.id)
            self.assertEqual(type(loaded), type(job))
            self.assertEqual(loaded.created_at, 123456)
            self.assertNotIn("recovery", loaded.model_dump())

    def test_partial_variant_export_resumes_without_copy_or_refill(self):
        for full in [False, True]:
            with self.subTest(full=full):
                job = self.special(full)
                self.plan(job)
                directory = self.root / "results" / job.id
                directory.mkdir(parents=True, exist_ok=True)
                done = directory / "frame_0.png"
                done.write_bytes(png("blue"))
                job.recovery["completed"] = {done.name: hashlib.sha256(done.read_bytes()).hexdigest()}
                job_store.save_special_job(job)
                client = Mock()
                client.export_frame.return_value = png("green")
                module = special_compose_full if full else special_compose
                runner = module.run_special_full_compose if full else module.run_special_compose
                with patch.object(module, "get_client", return_value=client), patch.object(compose_recovery.time, "sleep"):
                    runner(job)
                client.duplicate_file.assert_not_called()
                client.parse_slots.assert_not_called()
                self.assertEqual(client.export_frame.call_count, 2)
                self.assertEqual([Path(p).name for p in job.result_paths], ["frame_0.png", "frame_1_v1.png", "frame_1_v2.png"])
                self.assertEqual(job.status, ComposeStatus.done)
                self.assertEqual(done.read_bytes(), png("blue"))

    def test_uncheckpointed_or_corrupt_png_is_exported_again(self):
        job = self.special()
        self.plan(job)
        directory = self.root / "results" / job.id
        directory.mkdir(parents=True)
        (directory / "frame_0.png").write_bytes(b"partial png")
        job.recovery["completed"] = {"frame_0.png": hashlib.sha256(b"partial png").hexdigest()}
        client = Mock()
        client.export_frame.return_value = png()
        with patch.object(compose_recovery.time, "sleep"):
            compose_recovery.export_special(job, client, lambda *_: None)
        self.assertEqual(client.export_frame.call_count, 3)
        self.assertEqual(job.status, ComposeStatus.done)

    def test_missing_frame_does_not_report_success(self):
        job = self.special()
        self.plan(job)
        client = Mock()
        client.export_frame.side_effect = httpx.ConnectError("export offline")
        with patch.object(special_compose, "get_client", return_value=client), patch.object(compose_recovery.time, "sleep"):
            special_compose.run_special_compose(job)
        self.assertEqual(job.status, ComposeStatus.running)
        self.assertEqual(job.recovery["attempts"], 1)
        self.assertEqual(job.result_paths, [])
        self.assertTrue(job_store.load_active_compose_jobs())

    def test_special_status_and_download_survive_empty_memory_and_keep_owner(self):
        job = self.special()
        self.plan(job)
        client = Mock()
        client.export_frame.return_value = png()
        with patch.object(compose_recovery.time, "sleep"):
            compose_recovery.export_special(job, client, lambda *_: None)
        request = Request({"type": "http", "method": "GET", "path": "/", "headers": []})
        with patch.object(main, "_jobs", {}), patch.object(main, "_current_user", return_value={"id": "owner"}):
            response = main.get_special_compose(job.id, request)
            self.assertEqual(response.status, ComposeStatus.done)
            self.assertEqual(len(main.download_special_images(job.id, request)["images"]), 3)
        with patch.object(main, "_jobs", {}), patch.object(main, "_current_user", return_value={"id": "other"}):
            from fastapi import HTTPException
            with self.assertRaises(HTTPException):
                main.get_special_compose(job.id, request)

    def test_ordinary_compose_reuses_saved_copy_and_does_not_run_twice(self):
        job = ComposeJob(id="compose-job", user_id="owner", penpot_file_id="existing-copy",
            request=ComposeRequest(file_id="template", page_id="page", template_frame_id="a", slots={}))
        job_store.save_job(job)
        client = Mock()
        client.parse_slots.return_value = []
        client.parse_frames.return_value = [{"id": "a", "x": 0, "width": 100, "name": "main"}]
        client.export_frame.return_value = png()
        with patch.object(compose, "get_client", return_value=client):
            main._run_and_persist(job)
            main._run_and_persist(job)
        client.duplicate_file.assert_not_called()
        self.assertEqual(client.export_frame.call_count, 1)
        self.assertEqual(job_store.load_job(job.id).status, ComposeStatus.done)


if __name__ == "__main__":
    unittest.main()

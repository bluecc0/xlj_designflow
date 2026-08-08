from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import main as app_main


class LayerExtractJobPersistenceTest(unittest.IsolatedAsyncioTestCase):
    async def test_success_log_failure_does_not_overwrite_done(self) -> None:
        job_id = "layer-job-test"
        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "output"
            out_dir = output_path / "ai-images" / "operator_a" / "layer-extract" / job_id
            payload = {
                "psd_path": str(out_dir / "result.psd"),
                "manifest_path": str(out_dir / "manifest.json"),
                "source_size": [100, 200],
                "kie_task_id": "kie-task-test",
                "background_status": "ready",
                "decomposition_provider": "kie",
                "layers": [{"path": "01-layer.png"}],
                "kie_layers": [],
            }
            saved_jobs: list[dict] = []

            def record_job(**kwargs: dict) -> None:
                saved_jobs.append(kwargs)

            with (
                patch.object(app_main.settings, "output_path", output_path),
                patch.object(app_main, "_run_local_layer_extract", return_value=payload),
                patch.object(app_main, "save_ai_image_job", side_effect=record_job),
                patch.object(app_main, "log_operation", side_effect=RuntimeError("database locked")),
                patch.object(app_main.logger, "exception") as log_exception,
            ):
                await app_main._run_layer_extract_background(
                    job_id,
                    {"id": "operator_a", "username": "运营A"},
                    Path(temp_dir) / "source.png",
                    123.0,
                )

            self.assertEqual([job["status"] for job in saved_jobs], ["processing", "done"])
            self.assertEqual(saved_jobs[-1]["image_url"], f"/ai-images/operator_a/layer-extract/{job_id}/result.psd")
            log_exception.assert_called_once()


if __name__ == "__main__":
    unittest.main()

"""Checkpoints for Penpot composition and per-frame special exports."""
from __future__ import annotations

import functools
import hashlib
import io
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
import requests
from PIL import Image

from .config import settings
from .job_store import load_job, load_special_job_model, save_job, save_special_job
from .models import ComposeJob, ComposeStatus
from .task_checkpoint import execution_lock, atomic_write


class ExportInterrupted(RuntimeError):
    pass


def copy_edit_url(job, client):
    """A restart can occur immediately after persisting a new copy ID."""
    if job.penpot_edit_url:
        return job.penpot_edit_url
    info = client.get_file(job.penpot_file_id)
    info = info if isinstance(info, dict) else {}
    team_id = info.get("teamId") or info.get("team-id") or ""
    project_id = info.get("projectId") or info.get("project-id")
    if not team_id and project_id:
        project = client._rpc("get-project", {"id": project_id})
        if isinstance(project, dict):
            team_id = project.get("teamId") or project.get("team-id") or ""
    job.penpot_edit_url = (
        f"{settings.penpot_base_url}/#/workspace?team-id={team_id}"
        f"&file-id={job.penpot_file_id}&page-id={job.request.page_id}"
    )
    (save_job if isinstance(job, ComposeJob) else save_special_job)(job)
    return job.penpot_edit_url


def compose_execution(function):
    @functools.wraps(function)
    def run(job):
        recovering = job.recovering
        # Both normal requests and restart recovery use these same OS locks.
        with execution_lock(f"compose:{job.id}") as own:
            if not own:
                return
            stored = load_job(job.id) if isinstance(job, ComposeJob) else load_special_job_model(job.id)
            if stored:
                job.__dict__.update(stored.__dict__)
            if job.status in {ComposeStatus.done, ComposeStatus.failed}:
                return
            if float(job.recovery.get("retry_after") or 0) > time.time():
                return
            with execution_lock("penpot-compose-exporter") as exporter:
                if exporter:
                    if recovering:
                        job.recovery["resuming"] = True
                    function(job)
    return run


def compose_error(job, exc, log):
    transient = isinstance(exc, (ExportInterrupted, httpx.RequestError, requests.RequestException,
                                  ConnectionError, TimeoutError))
    attempts = int(job.recovery.get("attempts") or 0) + 1
    if transient and attempts < 3:
        job.recovery.update(attempts=attempts, retry_after=time.time() + 15 * attempts)
        job.status = ComposeStatus.running
        job.error = None
        log(job, "连接暂时中断，正在等待恢复合成任务…")
    else:
        job.status = ComposeStatus.failed
        job.error = str(exc)
        log(job, f"失败: {exc}")
    (save_job if isinstance(job, ComposeJob) else save_special_job)(job)


def _valid_png(path: Path, digest: str) -> bool:
    try:
        if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            return False
        with Image.open(path) as image:
            if image.format != "PNG":
                return False
            image.load()
        return True
    except (OSError, ValueError):
        return False


def export_special(job, client, log, *, frame_index=None, export_versions=None,
                   variant_frame_ids=None):
    """Save the export plan first, then checkpoint complete PNGs for each variant."""
    plan = job.recovery.get("export_plan")
    if not plan:
        plan = {
            "frames": [{"id": fid, "name": frame_index[fid].get("name", "export")}
                       for fid in job.result_frame_ids],
            "versions": export_versions or {}, "variant_frames": sorted(variant_frame_ids or []),
        }
        job.recovery.update(phase="exporting", export_plan=plan, completed={})
        save_special_job(job)
    frames = plan["frames"]
    versions = plan["versions"]
    variant_ids = set(plan["variant_frames"])
    has_variants = len(versions) >= 2
    all_layers = {tuple(layer) for layers in versions.values() for layer in layers}
    completed = job.recovery.setdefault("completed", {})
    results_dir = settings.output_path / "results" / job.id
    results_dir.mkdir(parents=True, exist_ok=True)
    lock = threading.Lock()
    paths = {}
    errors = []
    expected = set()

    def export_one(index, suffix):
        frame = frames[index]
        filename = f"frame_{index}{suffix}.png"
        out_path = results_dir / filename
        expected.add(filename)
        if filename in completed and _valid_png(out_path, completed[filename]):
            with lock:
                paths[filename] = str(out_path)
            return
        try:
            content = client.export_frame(
                file_id=job.penpot_file_id, page_id=job.request.page_id,
                frame_id=frame["id"], scale=1.0, name=frame["name"],
                wait_secs=0, background=False,
            )
            with Image.open(io.BytesIO(content)) as image:
                if image.format != "PNG":
                    raise ValueError("导出结果不是 PNG")
                image.load()
            atomic_write(out_path, content)
            with lock:
                paths[filename] = str(out_path)
                completed[filename] = hashlib.sha256(content).hexdigest()
                job.result_paths = _ordered_paths(paths)
                save_special_job(job)
            log(job, f"  ✓ {frame['name']}{suffix} ({len(content)//1024} KB)")
        except Exception as exc:
            with lock:
                errors.append(f"{frame['name']}{suffix}: {exc}")

    def batch(indices, suffix, delay):
        # No waiting or Penpot writes are needed if this entire batch is complete.
        pending = [i for i in indices if not _valid_png(
            results_dir / f"frame_{i}{suffix}.png", completed.get(f"frame_{i}{suffix}.png", ""))]
        if pending and delay:
            time.sleep(delay)
        with ThreadPoolExecutor(max_workers=max(1, min(8, len(indices)))) as pool:
            list(pool.map(lambda i: export_one(i, suffix), indices))

    if not frames:
        raise ValueError("没有可导出的画板")
    if not has_variants:
        batch(list(range(len(frames))), "", 3)
    else:
        batch([i for i, frame in enumerate(frames) if frame["id"] not in variant_ids], "", 3)
        for index, (_version, layers) in enumerate(sorted(versions.items())):
            suffix = f"_v{index + 1}"
            indices = [i for i, frame in enumerate(frames) if frame["id"] in variant_ids]
            if any(not _valid_png(results_dir / f"frame_{i}{suffix}.png",
                                  completed.get(f"frame_{i}{suffix}.png", "")) for i in indices):
                visible = {tuple(layer) for layer in layers}
                client.update_file(job.penpot_file_id, [
                    (client.show_layer if layer in visible else client.hide_layer)(*layer)
                    for layer in sorted(all_layers)
                ])
            batch(indices, suffix, 2)
    job.result_paths = _ordered_paths(paths)
    if errors or len(paths) != len(expected):
        raise ExportInterrupted("部分画板导出失败：" + "; ".join(errors)[:400])
    job.status = ComposeStatus.done
    job.error = None
    job.recovery.update(phase="done", retry_after=0)
    log(job, f"合成完成，共导出 {len(paths)} 张图")
    save_special_job(job)


def _ordered_paths(paths):
    return [path for name, path in sorted(paths.items(),
            key=lambda item: (int(re.search(r"frame_(\d+)", item[0]).group(1)), item[0]))]

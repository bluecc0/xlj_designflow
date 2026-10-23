"""Resume durable image jobs without resubmitting an accepted or uncertain request."""
from __future__ import annotations

import asyncio
import logging
import time

import httpx

from .ai_image import (
    AllProvidersFailedError, SafetyReviewError, load_user_refs, public_generation_error,
    submission_may_be_accepted,
)
from .job_store import load_ai_image_job, save_image_checkpoint, append_ai_chat_message
from .task_checkpoint import (
    checkpoint_handler, execution_lock, UpstreamTaskFailed,
)

logger = logging.getLogger(__name__)
UNKNOWN_MESSAGE = "提交后受理状态暂无法确认，请先核对任务记录，避免重复生成和扣费"
RECOVERY_MESSAGE = "服务已恢复，正在继续原任务…"


async def execute_image_job(worker, job_id: str, *, initial: dict | None = None) -> None:
    with execution_lock(f"ai-image:{job_id}") as acquired:
        if not acquired:
            return
        job = load_ai_image_job(job_id)
        if not job:
            return
        meta = job["request_meta"]
        meta.setdefault("requested_provider", job.get("provider") or "auto")
        meta["reference_count"] = int(job.get("reference_count") or 0)
        recovery = meta.get("recovery") or {}
        if job["status"] == "failed" and not (
            not recovery and job.get("provider") in {"apimart", "apimart-ext"} and job.get("task_id")
        ):
            return
        if job["status"] == "done" and recovery.get("phase") != "downloaded":
            return
        if float(recovery.get("retry_after") or 0) > time.time():
            return
        provider = str(recovery.get("provider") or job.get("provider") or "auto")
        # Legacy records cannot prove a POST was not sent. Only real async IDs are resumable.
        if not recovery:
            recovery = {"version": 1, "phase": "submitting", "provider": provider}
            if provider in {"apimart", "apimart-ext"} and job.get("task_id"):
                recovery.update(phase="accepted", task_id=job["task_id"])
            meta["recovery"] = recovery
        phase = recovery.get("phase")
        is_resume = phase not in {"queued", "preparing"}

        def persist(error=None, status=None):
            if status is None:
                status = "done" if job["status"] == "done" and job.get("image_url") else "processing"
            save_image_checkpoint(job_id, meta, provider=provider,
                                  task_id=str(recovery.get("task_id") or ""),
                                  error=error, status=status)

        def fail(message, phase="failed"):
            recovery.update(phase=phase, message=message)
            persist(message, "failed")
            append_ai_chat_message(
                session_id=meta.get("chat_session_id") or "", user_id=job["user_id"],
                role="ai", type="ai_image_result", text=job.get("prompt"),
                meta={"job_id": job_id, "model": job["model"], "status": "failed",
                      "error": message, "batchId": meta.get("batch_id", ""),
                      "batchIndex": meta.get("batch_index", 0),
                      "batchCount": meta.get("batch_count", 1)},
            )

        if is_resume and not (
            recovery.get("local_url") or recovery.get("result_url")
            or (provider in {"apimart", "apimart-ext"} and recovery.get("task_id"))
            or (provider == "bfl" and recovery.get("task_id") and recovery.get("polling_url"))
        ):
            fail(UNKNOWN_MESSAGE, "submission_unknown")
            return

        def on_checkpoint(next_phase, **values):
            nonlocal provider
            if next_phase == "preparing":
                provider = str(values.pop("provider", provider))
                # Never associate a newly attempted route with an earlier route's ID.
                attempts = int(recovery.get("attempts") or 0)
                recovery.clear()
                recovery.update(version=1, phase=next_phase, provider=provider, attempts=attempts)
            else:
                recovery["phase"] = next_phase
            recovery.update(values)
            recovery.pop("retry_after", None)
            if next_phase == "done":
                recovery.pop("finalization_error", None)
            persist(status="done" if next_phase == "done" else None)

        kwargs = dict(
            job_id=job_id, user_id=job["user_id"],
            username=(initial or {}).get("username", ""),
            session_id=meta.get("chat_session_id") or "",
            provider=provider if is_resume else meta["requested_provider"], model=job["model"],
            prompt=meta.get("execution_prompt") or job.get("resolved_prompt") or job["prompt"],
            size=job["size"], resolution=job.get("resolution") or "",
            refs=[], has_reference=job["has_reference"], created_at=job["created_at"],
            original_prompt=job.get("original_prompt") or job["prompt"],
            resolved_prompt=meta.get("execution_prompt") or job.get("resolved_prompt") or job["prompt"],
            prompt_trace=job.get("prompt_trace") or "",
            ref_previews=(initial or {}).get("ref_previews") or meta.get("reference_previews", []),
            request_meta=meta, batch_id=meta.get("batch_id", ""),
            batch_index=meta.get("batch_index", 0), batch_count=meta.get("batch_count", 1),
            variant=meta.get("variant", "flare"), quality=meta.get("quality", "auto"),
            resume=recovery if is_resume else None,
        )
        try:
            # Original references are unnecessary for polling/download, but retain counts.
            if not is_resume:
                refs = (initial or {}).get("refs")
                if refs is None:
                    refs = load_user_refs(job["user_id"], meta.get("reference_storage_job_id") or job_id)
                    names = meta.get("reference_names") or []
                    refs = [(data, names[i] if i < len(names) else name)
                            for i, (data, name) in enumerate(refs)]
                if len(refs) != int(job.get("reference_count") or 0):
                    fail("原任务参考图不完整，无法继续，请重新选择参考图")
                    return
                kwargs["refs"] = refs
            if is_resume:
                recovery.update(resuming=True, message=RECOVERY_MESSAGE)
                persist()
            with checkpoint_handler(on_checkpoint):
                await worker(**kwargs)
        except asyncio.CancelledError:
            # Preserve the exact phase. A POST in flight is deliberately not re-queued.
            recovery.update(resuming=True, message="服务重启中，正在等待恢复任务…")
            persist()
            raise
        except Exception as exc:
            logger.exception("image recovery worker failed: job=%s phase=%s", job_id, recovery.get("phase"))
            if recovery.get("local_url"):
                # Image success and notification delivery have separate budgets.
                # Never change a completed image to failed or poll/generate it again.
                attempts = int(recovery.get("finalization_attempts") or 0) + 1
                recovery.update(finalization_attempts=attempts, finalization_error=str(exc)[:400])
                if attempts < 3:
                    recovery.update(phase="downloaded", resuming=True,
                                    message="图片已生成，正在补写结果记录…",
                                    retry_after=time.time() + 15 * attempts)
                else:
                    recovery.update(phase="finalization_failed", resuming=False,
                                    message="图片已生成，结果记录补写失败，已停止自动重试")
                    recovery.pop("retry_after", None)
                persist(status="done")
                return
            resumable = bool(
                recovery.get("result_url")
                or (provider in {"apimart", "apimart-ext"} and recovery.get("task_id"))
                or (provider == "bfl" and recovery.get("polling_url") and recovery.get("task_id"))
            )
            before_submit = recovery.get("phase") in {"queued", "preparing"} and (
                submission_may_be_accepted(exc) or isinstance(exc, (httpx.RequestError, asyncio.TimeoutError))
            )
            if (resumable or before_submit) and not isinstance(exc, (UpstreamTaskFailed, SafetyReviewError, AllProvidersFailedError)):
                attempts = int(recovery.get("attempts") or 0) + 1
                recovery["attempts"] = attempts
                if attempts < 3:
                    if provider in {"apimart", "apimart-ext", "bfl"} and recovery.get("task_id"):
                        # Signed result links may expire during a restart. Poll
                        # the original task again to obtain its current result.
                        recovery.pop("result_url", None)
                    recovery.update(resuming=True, message="连接暂时中断，正在恢复原任务…",
                                    retry_after=time.time() + 15 * attempts)
                    persist()
                    return
                fail("原任务已尝试恢复 3 次仍未成功，请核对任务记录；未重新发起生图", "recovery_failed")
            elif submission_may_be_accepted(exc) or isinstance(exc, asyncio.TimeoutError):
                fail(UNKNOWN_MESSAGE, "submission_unknown")
            else:
                fail(public_generation_error(exc))

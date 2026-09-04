from __future__ import annotations

import asyncio
import base64
import io
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import httpx
from fastapi import HTTPException
from PIL import Image
from starlette.requests import Request

from backend import job_store
from backend import main as app_main
from backend import bfl_outpainting as bfl


def png_bytes(size: tuple[int, int] = (64, 64), color=(20, 80, 140, 255)) -> bytes:
    output = io.BytesIO()
    Image.new("RGBA", size, color).save(output, format="PNG")
    return output.getvalue()


def png_data_uri(size: tuple[int, int] = (64, 64)) -> str:
    return "data:image/png;base64," + base64.b64encode(png_bytes(size)).decode("ascii")


def coordinate_png_bytes(size: tuple[int, int]) -> bytes:
    image = Image.new("RGBA", size)
    image.putdata([
        (x % 256, y % 256, (x + y) % 256, 255)
        for y in range(size[1])
        for x in range(size[0])
    ])
    output = io.BytesIO()
    image.save(output, format="PNG")
    image.close()
    return output.getvalue()


def json_request(body: dict, *, host: str = "designflow.test") -> Request:
    raw = json.dumps(body).encode("utf-8")
    sent = False

    async def receive():
        nonlocal sent
        if sent:
            return {"type": "http.request", "body": b"", "more_body": False}
        sent = True
        return {"type": "http.request", "body": raw, "more_body": False}

    request = Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "POST",
            "scheme": "https",
            "path": "/ai-image/outpainting",
            "raw_path": b"/ai-image/outpainting",
            "query_string": b"",
            "headers": [(b"host", host.encode("ascii")), (b"content-type", b"application/json")],
            "server": (host, 443),
            "client": ("127.0.0.1", 12345),
        },
        receive,
    )
    request.state.user = {"id": "operator_a", "username": "运营A", "role": "user"}
    return request



TASK_ID = "11111111-1111-4111-8111-111111111111"
POLLING_URL = f"https://api.bfl.ai/v1/get_result?id={TASK_ID}"
RESULT_URL = "https://delivery.bfl.ai/result.png"


def make_result(**overrides) -> bfl.BflOutpaintingResult:
    values = {
        "image_url": "/ai-images/operator_a/2026-01-01/outpainting_job.png",
        "provider_task_id": TASK_ID,
        "polling_url": POLLING_URL,
        "cost": 0.02,
        "width": 64,
        "height": 128,
    }
    values.update(overrides)
    return bfl.BflOutpaintingResult(**values)


class ImagePreparationTest(unittest.TestCase):
    def test_validates_and_proportionally_downscales_to_png_data_uri(self) -> None:
        prepared = bfl.prepare_outpainting_image(
            png_data_uri((128, 64)),
            processing_width=64,
            processing_height=32,
            max_source_bytes=1024 * 1024,
            max_source_pixels=1024 * 1024,
            max_encoded_input_bytes=1024 * 1024,
        )
        self.assertEqual((prepared.source_width, prepared.source_height), (128, 64))
        self.assertEqual((prepared.processing_width, prepared.processing_height), (64, 32))
        self.assertTrue(prepared.data_uri.startswith("data:image/png;base64,"))

        geometry = bfl.validate_geometry(
            processing_width=64,
            processing_height=32,
            top=64,
            right=128,
            bottom=0,
            left=0,
        )
        self.assertEqual((geometry.expected_width, geometry.expected_height), (192, 96))

    def test_source_snapshot_round_trips_prepared_image(self) -> None:
        prepared = bfl.prepare_outpainting_image(
            png_data_uri((128, 64)),
            processing_width=64,
            processing_height=32,
            max_source_bytes=1024 * 1024,
            max_source_pixels=1024 * 1024,
            max_encoded_input_bytes=1024 * 1024,
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            output_root = Path(temp_dir)
            snapshot_url = bfl.persist_prepared_source_snapshot(
                prepared,
                output_root=output_root,
                user_id="operator_a",
                job_id="jobsource1",
            )
            self.assertEqual(
                snapshot_url,
                "/ai-images/operator_a/outpainting/jobsource1/source.png",
            )
            snapshot_path = output_root / "ai-images" / "operator_a" / "outpainting" / "jobsource1" / "source.png"
            self.assertTrue(snapshot_path.is_file())
            loaded = bfl.load_prepared_source_snapshot(
                snapshot_url,
                output_root=output_root,
                user_id="operator_a",
                meta={
                    "source_width": prepared.source_width,
                    "source_height": prepared.source_height,
                    "processing_width": prepared.processing_width,
                    "processing_height": prepared.processing_height,
                    "source_format": prepared.source_format,
                    "source_sha256": prepared.source_sha256,
                },
            )
            self.assertEqual(loaded.processing_width, 64)
            self.assertEqual(loaded.processing_height, 32)
            self.assertEqual(loaded.source_sha256, prepared.source_sha256)
            self.assertTrue(loaded.data_uri.startswith("data:image/png;base64,"))
            self.assertFalse(bfl.is_pre_submit_phase("submitting"))
            self.assertTrue(bfl.is_pre_submit_phase("queued"))
            self.assertFalse(bfl.is_pre_submit_phase("interrupted"))
            self.assertFalse(bfl.is_pre_submit_phase(None))

    def test_rejects_non_proportional_or_upscaled_processing_size(self) -> None:
        common = {
            "max_source_bytes": 1024 * 1024,
            "max_source_pixels": 1024 * 1024,
            "max_encoded_input_bytes": 1024 * 1024,
        }
        with self.assertRaisesRegex(bfl.OutpaintingValidationError, "相同比例"):
            bfl.prepare_outpainting_image(
                png_data_uri((100, 50)),
                processing_width=50,
                processing_height=30,
                **common,
            )
        with self.assertRaisesRegex(bfl.OutpaintingValidationError, "不能放大"):
            bfl.prepare_outpainting_image(
                png_data_uri((100, 50)),
                processing_width=200,
                processing_height=100,
                **common,
            )

    def test_rejects_bad_declared_format_and_decoded_byte_cap(self) -> None:
        jpeg_declared_png = "data:image/jpeg;base64," + base64.b64encode(png_bytes()).decode("ascii")
        with self.assertRaisesRegex(bfl.OutpaintingValidationError, "声明格式"):
            bfl.prepare_outpainting_image(
                jpeg_declared_png,
                max_source_bytes=1024 * 1024,
                max_source_pixels=1024 * 1024,
                max_encoded_input_bytes=1024 * 1024,
            )
        with self.assertRaisesRegex(bfl.OutpaintingValidationError, "过大"):
            bfl.prepare_outpainting_image(
                png_data_uri(),
                max_source_bytes=10,
                max_source_pixels=1024 * 1024,
                max_encoded_input_bytes=1024 * 1024,
            )

    def test_geometry_keeps_exact_margins_without_provider_alignment(self) -> None:
        with self.assertRaisesRegex(bfl.OutpaintingValidationError, "至少一个"):
            bfl.validate_geometry(
                processing_width=64, processing_height=64,
                top=0, right=0, bottom=0, left=0,
            )
        with self.assertRaisesRegex(bfl.OutpaintingValidationError, "必须是整数"):
            bfl.validate_geometry(
                processing_width=64, processing_height=64,
                top=True, right=0, bottom=0, left=0,
            )
        with self.assertRaisesRegex(bfl.OutpaintingValidationError, "必须是整数"):
            bfl.validate_geometry(
                processing_width=64, processing_height=64,
                top=1.5, right=0, bottom=0, left=0,
            )
        with self.assertRaisesRegex(bfl.OutpaintingValidationError, "非负"):
            bfl.validate_geometry(
                processing_width=64, processing_height=64,
                top=-1, right=0, bottom=0, left=0,
            )

        geometry = bfl.validate_geometry(
            processing_width=640,
            processing_height=480,
            top=1,
            right=65,
            bottom=0,
            left=64,
        )
        self.assertEqual(
            geometry.requested_margins(),
            {"top": 1, "right": 65, "bottom": 0, "left": 64},
        )
        self.assertEqual(
            geometry.provider_margins(),
            {"top": 1, "right": 65, "bottom": 0, "left": 64},
        )
        self.assertEqual((geometry.expected_width, geometry.expected_height), (769, 481))
        self.assertEqual((geometry.provider_width, geometry.provider_height), (769, 481))
        self.assertEqual(geometry.crop_box(), (0, 0, 769, 481))
        self.assertEqual(
            [bfl.align_margin_for_provider(value, 64) for value in (0, 1, 64, 65)],
            [0, 64, 64, 128],
        )
        aligned = bfl.validate_geometry(
            processing_width=640,
            processing_height=480,
            top=1,
            right=65,
            bottom=0,
            left=64,
            margin_alignment=64,
        )
        self.assertEqual(
            aligned.provider_margins(),
            {"top": 64, "right": 128, "bottom": 0, "left": 64},
        )
        self.assertEqual(aligned.crop_box(), (0, 63, 769, 544))

    def test_geometry_rejects_output_overflow(self) -> None:
        boundary = bfl.validate_geometry(
            processing_width=2047,
            processing_height=2048,
            top=0,
            right=1,
            bottom=0,
            left=0,
        )
        self.assertEqual((boundary.expected_width, boundary.expected_height), (2048, 2048))
        self.assertEqual((boundary.provider_width, boundary.provider_height), (2048, 2048))

        with self.assertRaisesRegex(bfl.OutpaintingValidationError, "不能超过"):
            bfl.validate_geometry(
                processing_width=2048,
                processing_height=64,
                top=0,
                right=1,
                bottom=0,
                left=0,
            )


    def test_geometry_rejects_canvas_smaller_than_64(self) -> None:
        with self.assertRaisesRegex(bfl.OutpaintingValidationError, "不能小于"):
            bfl.validate_geometry(
                processing_width=64,
                processing_height=32,
                top=1,
                right=0,
                bottom=0,
                left=0,
            )



class StreamContext:
    def __init__(self, response: httpx.Response) -> None:
        self.response = response

    async def __aenter__(self) -> httpx.Response:
        return self.response

    async def __aexit__(self, *_args) -> bool:
        return False


class FakeClient:
    def __init__(
        self,
        post_results: list | None = None,
        get_results: list | None = None,
        stream_results: list[httpx.Response] | None = None,
    ) -> None:
        self.post_results = list(post_results or [])
        self.get_results = list(get_results or [])
        self.stream_results = list(stream_results or [])
        self.post_calls: list[dict] = []
        self.get_calls: list[dict] = []
        self.stream_calls: list[dict] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    async def post(self, url: str, **kwargs):
        self.post_calls.append({"url": url, **kwargs})
        result = self.post_results.pop(0)
        if isinstance(result, BaseException):
            raise result
        return result

    async def get(self, url: str, **kwargs):
        self.get_calls.append({"url": url, **kwargs})
        result = self.get_results.pop(0)
        if isinstance(result, BaseException):
            raise result
        return result

    def stream(self, method: str, url: str, **kwargs):
        self.stream_calls.append({"method": method, "url": url, **kwargs})
        return StreamContext(self.stream_results.pop(0))


class BflTransportTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.prepared = bfl.prepare_outpainting_image(
            png_data_uri(),
            max_source_bytes=1024 * 1024,
            max_source_pixels=1024 * 1024,
            max_encoded_input_bytes=1024 * 1024,
        )
        self.geometry = bfl.validate_geometry(
            processing_width=64,
            processing_height=64,
            top=1,
            right=65,
            bottom=0,
            left=0,
        )
        self.task_id = TASK_ID
        self.polling_url = POLLING_URL

    def response(self, status: int, payload=None, *, headers=None, content: bytes | None = None) -> httpx.Response:
        request = httpx.Request("POST", bfl.BFL_API_URL)
        if content is not None:
            return httpx.Response(status, request=request, headers=headers, content=content)
        return httpx.Response(status, request=request, headers=headers, json=payload)

    def submit_ok(self, *, cost: float | None = 0.0123) -> httpx.Response:
        payload = {"id": self.task_id, "polling_url": self.polling_url}
        if cost is not None:
            payload["cost"] = cost
        return self.response(200, payload)

    def ready(self, *, cost: float | None = 0.0123, sample: str = RESULT_URL) -> httpx.Response:
        payload = {
            "id": self.task_id,
            "status": "Ready",
            "result": {"sample": sample},
        }
        if cost is not None:
            payload["cost"] = cost
        return self.response(200, payload)

    def png_result(self, size: tuple[int, int] = (129, 65)) -> httpx.Response:
        return self.response(200, headers={"Content-Type": "image/png"}, content=png_bytes(size))

    async def run_with_client(self, fake: FakeClient, output_root: Path, **overrides):
        kwargs = {
            "api_key": "bfl-test-key",
            "mode": "fast",
            "prepared": self.prepared,
            "geometry": self.geometry,
            "output_root": output_root,
            "user_id": "operator_a",
            "job_id": "job-1",
            "timeout_seconds": 30,
            "poll_interval_seconds": 0.1,
            "transient_retry_count": 3,
            "retry_backoff_seconds": 1,
            "retry_backoff_cap_seconds": 20,
            "max_result_bytes": 1024 * 1024,
            "result_download_retry_count": 2,
        }
        kwargs.update(overrides)
        with (
            patch.object(bfl.httpx, "AsyncClient", return_value=fake),
            patch.object(bfl.asyncio, "sleep", new=AsyncMock()) as sleep_mock,
        ):
            result = await bfl.run_outpainting(**kwargs)
        return result, sleep_mock

    async def test_canvas_offset_payload_poll_retry_after_and_validated_download(self) -> None:
        accepted: list[tuple[str, str]] = []
        fake = FakeClient(
            post_results=[self.submit_ok()],
            get_results=[
                self.response(429, {"status": "Pending"}, headers={"Retry-After": "7"}),
                self.ready(),
            ],
            stream_results=[self.png_result()],
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            result, sleep_mock = await self.run_with_client(
                fake,
                Path(temp_dir),
                on_accepted=lambda task_id, polling_url: accepted.append((task_id, polling_url)),
            )
            self.assertTrue(
                (Path(temp_dir) / "ai-images" / result.image_url.removeprefix("/ai-images/")).is_file()
            )

        self.assertEqual(result.cost, 0.0123)
        self.assertEqual((result.width, result.height), (129, 65))
        self.assertEqual(result.provider_task_id, self.task_id)
        self.assertEqual(result.polling_url, self.polling_url)
        self.assertEqual(accepted, [(self.task_id, self.polling_url)])
        self.assertEqual(len(fake.post_calls), 1)
        self.assertEqual(len(fake.get_calls), 2)
        submit = fake.post_calls[0]
        self.assertEqual(submit["url"], "https://api.bfl.ai/v1/flux-tools/outpainting-v1")
        self.assertEqual(submit["headers"]["x-key"], "bfl-test-key")
        self.assertEqual(submit["headers"]["accept"], "application/json")
        body = submit["json"]
        self.assertIsInstance(body, dict)
        self.assertEqual(body["width"], 129)
        self.assertEqual(body["height"], 65)
        self.assertEqual(body["reference_offset_x"], 0)
        self.assertEqual(body["reference_offset_y"], 1)
        self.assertEqual(body["output_format"], "png")
        self.assertEqual(body["mode"], "fast")
        self.assertFalse(body["auto_crop"])
        self.assertNotIn("prompt", body)
        self.assertFalse(body["input_image"].startswith("data:"))
        self.assertGreater(len(body["input_image"]), 20)
        for poll_call in fake.get_calls:
            self.assertEqual(poll_call["url"], self.polling_url)
            self.assertEqual(poll_call["headers"]["x-key"], "bfl-test-key")
            self.assertNotIn("Content-Type", poll_call["headers"])
        sleep_mock.assert_any_await(7.0)

    def test_provider_result_is_cropped_to_exact_requested_geometry(self) -> None:
        payload = coordinate_png_bytes(
            (self.geometry.provider_width, self.geometry.provider_height)
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            output_root = Path(temp_dir)
            image_url = bfl._validate_and_save_result(
                payload,
                output_root=output_root,
                user_id="operator_a",
                job_id="crop-test",
                geometry=self.geometry,
            )
            saved_path = output_root / "ai-images" / image_url.removeprefix("/ai-images/")
            with Image.open(saved_path) as result:
                self.assertEqual(
                    result.size,
                    (self.geometry.expected_width, self.geometry.expected_height),
                )
                x0, y0, x1, y1 = self.geometry.crop_box()
                self.assertEqual(result.getpixel((0, 0)), (x0, y0, (x0 + y0) % 256, 255))
                self.assertEqual(
                    result.getpixel((result.width - 1, result.height - 1)),
                    ((x1 - 1) % 256, (y1 - 1) % 256, (x1 + y1 - 2) % 256, 255),
                )

    async def test_ambiguous_submission_fails_without_polling_or_resubmitting(self) -> None:
        request = httpx.Request("POST", bfl.BFL_API_URL)
        for submit_result in (
            httpx.ReadTimeout("ambiguous", request=request),
            self.response(503, {"status": "error"}),
        ):
            with self.subTest(submit_result=type(submit_result).__name__ if isinstance(submit_result, BaseException) else submit_result.status_code):
                fake = FakeClient(post_results=[submit_result])
                with tempfile.TemporaryDirectory() as temp_dir:
                    with self.assertRaises(bfl.BflOutpaintingError) as raised:
                        await self.run_with_client(fake, Path(temp_dir))
                self.assertIn("连接失败", raised.exception.public_message)
                self.assertEqual(len(fake.post_calls), 1)
                self.assertEqual(len(fake.get_calls), 0)
                self.assertEqual(len(fake.stream_calls), 0)

    async def test_resume_polls_existing_id_without_submission(self) -> None:
        fake = FakeClient(
            get_results=[self.ready(cost=0.04)],
            stream_results=[self.png_result()],
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            result, _sleep = await self.run_with_client(
                fake,
                Path(temp_dir),
                prepared=None,
                provider_task_id=self.task_id,
                polling_url=self.polling_url,
                submit_request=False,
                retry_backoff_seconds=0,
                retry_backoff_cap_seconds=1,
                result_download_retry_count=0,
            )
        self.assertEqual(result.cost, 0.04)
        self.assertEqual(result.provider_task_id, self.task_id)
        self.assertEqual(len(fake.post_calls), 0)
        self.assertEqual(len(fake.get_calls), 1)
        self.assertEqual(fake.get_calls[0]["url"], self.polling_url)
        self.assertEqual(fake.get_calls[0]["headers"]["x-key"], "bfl-test-key")

    async def test_http_402_on_submit_is_not_treated_as_pending(self) -> None:
        fake = FakeClient(post_results=[self.response(402, {"detail": "insufficient funds"})])
        with tempfile.TemporaryDirectory() as temp_dir:
            with self.assertRaises(bfl.BflOutpaintingError) as raised:
                await self.run_with_client(
                    fake,
                    Path(temp_dir),
                    transient_retry_count=1,
                    retry_backoff_seconds=0,
                    retry_backoff_cap_seconds=1,
                    result_download_retry_count=0,
                )
        self.assertEqual(raised.exception.public_message, "扩图服务账户余额不足，请联系管理员")
        self.assertEqual(len(fake.post_calls), 1)
        self.assertEqual(len(fake.get_calls), 0)

    async def test_poll_pending_then_ready(self) -> None:
        fake = FakeClient(
            post_results=[self.submit_ok(cost=None)],
            get_results=[
                self.response(200, {"id": self.task_id, "status": "Pending"}),
                self.ready(cost=0.04),
            ],
            stream_results=[self.png_result()],
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            result, _sleep = await self.run_with_client(fake, Path(temp_dir))
        self.assertEqual(result.cost, 0.04)
        self.assertEqual(len(fake.post_calls), 1)
        self.assertEqual(len(fake.get_calls), 2)

    async def test_moderated_status_is_terminal(self) -> None:
        fake = FakeClient(
            post_results=[self.submit_ok()],
            get_results=[self.response(200, {"id": self.task_id, "status": "Content Moderated"})],
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            with self.assertRaises(bfl.BflOutpaintingError) as raised:
                await self.run_with_client(
                    fake,
                    Path(temp_dir),
                    transient_retry_count=1,
                    retry_backoff_seconds=0,
                    retry_backoff_cap_seconds=1,
                    result_download_retry_count=0,
                )
        self.assertEqual(raised.exception.public_message, "扩图内容未通过安全审核，请更换图片后重试")
        self.assertEqual(len(fake.get_calls), 1)
        self.assertEqual(len(fake.stream_calls), 0)

    async def test_task_not_found_is_terminal(self) -> None:
        fake = FakeClient(
            get_results=[self.response(200, {"id": self.task_id, "status": "Task not found"})],
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            with self.assertRaises(bfl.BflOutpaintingError) as raised:
                await self.run_with_client(
                    fake,
                    Path(temp_dir),
                    prepared=None,
                    provider_task_id=self.task_id,
                    submit_request=False,
                    transient_retry_count=1,
                    retry_backoff_seconds=0,
                    retry_backoff_cap_seconds=1,
                    result_download_retry_count=0,
                )
        self.assertEqual(raised.exception.public_message, "扩图任务无法恢复，请重新扩图")
        self.assertEqual(len(fake.post_calls), 0)
        self.assertEqual(len(fake.get_calls), 1)

    async def test_rejects_untrusted_result_and_redirect_hosts(self) -> None:
        with self.assertRaisesRegex(bfl.BflOutpaintingError, "不受信任"):
            bfl._validate_result_url("https://evil.example/result.png", ("delivery.bfl.ai", "bfl.ai"))
        bfl._validate_result_url("https://delivery.bfl.ai/result.png", ("delivery.bfl.ai", "bfl.ai"))

        fake = FakeClient(
            post_results=[self.submit_ok()],
            get_results=[self.ready()],
            stream_results=[self.response(302, headers={"Location": "https://evil.example/result.png"}, content=b"")],
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            with self.assertRaisesRegex(bfl.BflOutpaintingError, "不受信任"):
                await self.run_with_client(
                    fake,
                    Path(temp_dir),
                    transient_retry_count=1,
                    retry_backoff_seconds=0,
                    retry_backoff_cap_seconds=1,
                    result_download_retry_count=0,
                )

    async def test_download_retries_transient_status_with_retry_after(self) -> None:
        fake = FakeClient(
            post_results=[self.submit_ok()],
            get_results=[self.ready()],
            stream_results=[
                self.response(503, headers={"Retry-After": "6", "Content-Type": "text/plain"}, content=b"busy"),
                self.png_result(),
            ],
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            _result, sleep_mock = await self.run_with_client(fake, Path(temp_dir))
        self.assertEqual(len(fake.stream_calls), 2)
        sleep_mock.assert_any_await(6.0)

    async def test_download_requires_image_content_type_and_exact_dimensions(self) -> None:
        for headers, content, expected_message in (
            ({"Content-Type": "text/html"}, b"not an image", "不是有效图片"),
            ({"Content-Type": "image/png"}, png_bytes((192, 128)), "尺寸不正确"),
        ):
            with self.subTest(expected_message=expected_message):
                fake = FakeClient(
                    post_results=[self.submit_ok()],
                    get_results=[self.ready()],
                    stream_results=[self.response(200, headers=headers, content=content)],
                )
                with tempfile.TemporaryDirectory() as temp_dir:
                    with self.assertRaisesRegex(bfl.BflOutpaintingError, expected_message):
                        await self.run_with_client(
                            fake,
                            Path(temp_dir),
                            transient_retry_count=1,
                            retry_backoff_seconds=0,
                            retry_backoff_cap_seconds=1,
                            result_download_retry_count=0,
                        )


class OutpaintingApiTest(unittest.IsolatedAsyncioTestCase):
    async def test_public_config_is_safe_and_reflects_effective_enablement(self) -> None:
        with (
            patch.object(app_main.settings, "bfl_outpainting_enabled", True),
            patch.object(app_main.settings, "bfl_api_key", "super-secret"),
            patch.object(app_main.settings, "bfl_outpainting_mode", "fast"),
        ):
            config = app_main.ai_image_outpainting_config()
        self.assertTrue(config["enabled"])
        self.assertEqual(config["snap_pixels"], 1)
        self.assertEqual(config["max_width"], 2048)
        self.assertEqual(config["max_height"], 2048)
        self.assertEqual(config["max_area_pixels"], 4_194_304)
        self.assertEqual(config["max_source_bytes"], app_main.settings.bfl_outpainting_max_source_bytes)
        self.assertEqual(
            config["timeout_seconds"],
            max(1, int(app_main.settings.bfl_outpainting_timeout_seconds)),
        )
        self.assertIsInstance(config["timeout_seconds"], int)
        self.assertNotIn("model", config)
        self.assertNotIn("api_url", config)
        self.assertNotIn("api_key", config)
        self.assertNotIn("secret", json.dumps(config).casefold())

    async def test_feature_flag_rejects_before_job_creation(self) -> None:
        request = json_request({"image_url": png_data_uri(), "top": 64})
        with (
            patch.object(app_main.settings, "bfl_outpainting_enabled", False),
            patch.object(app_main.settings, "bfl_api_key", ""),
            patch.object(app_main, "save_ai_image_job") as save_job,
        ):
            with self.assertRaises(HTTPException) as raised:
                await app_main.ai_image_outpainting(request)
        self.assertEqual(raised.exception.status_code, 503)
        save_job.assert_not_called()

        request = json_request({"image_url": png_data_uri(), "top": 64})
        with (
            patch.object(app_main.settings, "bfl_outpainting_enabled", True),
            patch.object(app_main.settings, "bfl_api_key", ""),
            patch.object(app_main, "save_ai_image_job") as save_job,
        ):
            with self.assertRaises(HTTPException) as missing_key:
                await app_main.ai_image_outpainting(request)
        self.assertEqual(missing_key.exception.status_code, 503)
        save_job.assert_not_called()

    async def test_requires_client_request_uuid_before_preparing_image(self) -> None:
        request = json_request({"image_url": png_data_uri(), "outpaint": {"top": 64}})
        with (
            patch.object(app_main.settings, "bfl_outpainting_enabled", True),
            patch.object(app_main.settings, "bfl_api_key", "bfl-test-key"),
            patch.object(app_main, "prepare_outpainting_image") as prepare_image,
        ):
            with self.assertRaises(HTTPException) as raised:
                await app_main.ai_image_outpainting(request)
        self.assertEqual(raised.exception.status_code, 400)
        prepare_image.assert_not_called()

    async def test_rejects_oversized_json_before_image_preparation(self) -> None:
        request = json_request({
            "client_request_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "padding": "x" * 2048,
        })
        with (
            patch.object(app_main.settings, "bfl_outpainting_enabled", True),
            patch.object(app_main.settings, "bfl_api_key", "bfl-test-key"),
            patch.object(app_main.settings, "bfl_outpainting_max_request_bytes", 1024),
            patch.object(app_main, "prepare_outpainting_image") as prepare_image,
        ):
            with self.assertRaises(HTTPException) as raised:
                await app_main.ai_image_outpainting(request)
        self.assertEqual(raised.exception.status_code, 413)
        prepare_image.assert_not_called()

    async def test_rejects_new_job_when_bounded_queue_is_full(self) -> None:
        request = json_request({
            "image_url": png_data_uri(),
            "outpaint": {"top": 64},
            "client_request_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        })
        app_main.app.state.outpainting_claims = {"busy-job": "operator_b"}
        try:
            with (
                patch.object(app_main.settings, "bfl_outpainting_enabled", True),
                patch.object(app_main.settings, "bfl_api_key", "bfl-test-key"),
                patch.object(app_main.settings, "bfl_outpainting_max_concurrency", 1),
                patch.object(app_main.settings, "bfl_outpainting_max_queue_size", 0),
                patch.object(app_main.settings, "bfl_outpainting_max_pending_per_user", 2),
                patch.object(app_main, "load_ai_image_job_by_client_request_id", return_value=None),
                patch.object(app_main, "prepare_outpainting_image") as prepare_image,
            ):
                with self.assertRaises(HTTPException) as raised:
                    await app_main.ai_image_outpainting(request)
            self.assertEqual(raised.exception.status_code, 429)
            prepare_image.assert_not_called()
        finally:
            app_main.app.state.outpainting_claims = {}

    async def test_invalid_configuration_disables_config_and_submission(self) -> None:
        with (
            patch.object(app_main.settings, "bfl_outpainting_enabled", True),
            patch.object(app_main.settings, "bfl_api_key", "bfl-test-key"),
            patch.object(app_main.settings, "bfl_outpainting_mode", "quality"),
        ):
            self.assertFalse(app_main.ai_image_outpainting_config()["enabled"])
            request = json_request({
                "image_url": png_data_uri(),
                "outpaint": {"top": 64},
                "client_request_id": "44444444-4444-4444-8444-444444444444",
            })
            with self.assertRaises(HTTPException) as raised:
                await app_main.ai_image_outpainting(request)
        self.assertEqual(raised.exception.status_code, 503)

    async def test_duplicate_client_request_returns_existing_job_without_resubmitting(self) -> None:
        token = "55555555-5555-4555-8555-555555555555"
        existing = {
            "id": "existing-job",
            "status": "processing",
            "progress": 42,
            "task_id": "66666666-6666-4666-8666-666666666666",
            "request_meta": {
                "processing_width": 640,
                "processing_height": 480,
                "expected_width": 704,
                "expected_height": 480,
            },
        }
        request = json_request({"client_request_id": token})
        with (
            patch.object(app_main.settings, "bfl_outpainting_enabled", True),
            patch.object(app_main.settings, "bfl_api_key", "bfl-test-key"),
            patch.object(app_main, "load_ai_image_job_by_client_request_id", return_value=existing),
            patch.object(app_main, "prepare_outpainting_image") as prepare_image,
            patch.object(app_main, "save_ai_image_job") as save_job,
            patch.object(app_main, "_track_outpainting_task") as track_task,
        ):
            response = await app_main.ai_image_outpainting(request)
        self.assertTrue(response["deduplicated"])
        self.assertEqual(response["job_id"], "existing-job")
        self.assertEqual(response["expected_dimensions"], {"width": 704, "height": 480})
        prepare_image.assert_not_called()
        save_job.assert_not_called()
        track_task.assert_not_called()

    async def test_endpoint_persists_task_uuid_metadata_and_returns_expected_dimensions(self) -> None:
        request = json_request({
            "image_url": png_data_uri((128, 128)),
            "processing_width": 64,
            "processing_height": 64,
            "outpaint": {
                "top": 1,
                "right": 65,
                "bottom": 0,
                "left": 0,
            },
            "client_request_id": "33333333-3333-4333-8333-333333333333",
        })
        saved: list[dict] = []

        def close_task(coroutine, *, claimed_job_id=""):
            coroutine.close()
            app_main._release_outpainting_claim(claimed_job_id)
            return Mock()

        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "output"
            output_path.mkdir()
            with (
                patch.object(app_main.settings, "bfl_outpainting_enabled", True),
                patch.object(app_main.settings, "bfl_api_key", "bfl-test-key"),
                patch.object(app_main.settings, "output_path", output_path),
                patch.object(app_main, "load_ai_image_job_by_client_request_id", return_value=None),
                patch.object(app_main, "save_ai_image_job", side_effect=lambda **kwargs: saved.append(kwargs)),
                patch.object(app_main, "_track_outpainting_task", side_effect=close_task),
            ):
                response = await app_main.ai_image_outpainting(request)

            self.assertEqual(response["expected_dimensions"], {"width": 129, "height": 65})
            self.assertEqual(response["processing_width"], 64)
            self.assertEqual(response["task_id"], "")
            self.assertEqual(len(saved), 1)
            initial = saved[0]
            self.assertEqual(initial["provider"], "bfl")
            self.assertEqual(initial["client_request_id"], "33333333-3333-4333-8333-333333333333")
            self.assertEqual(initial["model"], "flux-tools/outpainting-v1")
            self.assertEqual(initial["task_id"], "")
            self.assertEqual(initial["request_meta"]["provider_task_id"], "")
            self.assertEqual(initial["request_meta"]["provider_task_uuid"], "")
            self.assertEqual(initial["request_meta"]["polling_url"], "")
            self.assertEqual(initial["request_meta"]["phase"], "queued")
            snapshot_url = initial["request_meta"]["source_snapshot_url"]
            self.assertEqual(
                snapshot_url,
                f"/ai-images/operator_a/outpainting/{initial['job_id']}/source.png",
            )
            self.assertTrue((output_path / "ai-images" / "operator_a" / "outpainting" / initial["job_id"] / "source.png").is_file())
            self.assertEqual(
                {
                    key: initial["request_meta"][key]
                    for key in ("top", "right", "bottom", "left", "expected_width", "expected_height")
                },
                {
                    "top": 1,
                    "right": 65,
                    "bottom": 0,
                    "left": 0,
                    "expected_width": 129,
                    "expected_height": 65,
                },
            )
            self.assertEqual(
                {
                    key: initial["request_meta"][key]
                    for key in (
                        "provider_top",
                        "provider_right",
                        "provider_bottom",
                        "provider_left",
                        "provider_width",
                        "provider_height",
                        "provider_margin_alignment",
                    )
                },
                {
                    "provider_top": 1,
                    "provider_right": 65,
                    "provider_bottom": 0,
                    "provider_left": 0,
                    "provider_width": 129,
                    "provider_height": 65,
                    "provider_margin_alignment": 1,
                },
            )
            self.assertEqual(initial["request_meta"]["source_kind"], "data_uri")
            self.assertIsNone(initial["request_meta"]["source_image_url"])
            self.assertNotIn("base64", json.dumps(initial["request_meta"]))

    async def test_strict_internal_resolver_blocks_foreign_and_external_urls(self) -> None:
        request = json_request({})
        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "output"
            own = output_path / "ai-images" / "operator_a" / "2026-01-01" / "own.png"
            foreign = output_path / "ai-images" / "operator_b" / "2026-01-01" / "foreign.png"
            own.parent.mkdir(parents=True)
            foreign.parent.mkdir(parents=True)
            own.write_bytes(png_bytes())
            foreign.write_bytes(png_bytes())
            with patch.object(app_main.settings, "output_path", output_path):
                resolved, normalized = app_main._outpainting_internal_path(
                    "/ai-images/operator_a/2026-01-01/own.png",
                    request,
                    request.state.user,
                )
                self.assertEqual(resolved, own.resolve())
                self.assertEqual(normalized, "/ai-images/operator_a/2026-01-01/own.png")
                with self.assertRaises(HTTPException) as foreign_error:
                    app_main._outpainting_internal_path(
                        "/ai-images/operator_b/2026-01-01/foreign.png",
                        request,
                        request.state.user,
                    )
                self.assertEqual(foreign_error.exception.status_code, 404)
                with self.assertRaises(HTTPException) as traversal_error:
                    app_main._outpainting_internal_path(
                        "/ai-images/operator_a/../operator_b/2026-01-01/foreign.png",
                        request,
                        request.state.user,
                    )
                self.assertEqual(traversal_error.exception.status_code, 404)
                with self.assertRaises(HTTPException) as external_error:
                    app_main._outpainting_internal_path(
                        "https://evil.example/ai-images/operator_a/2026-01-01/own.png",
                        request,
                        request.state.user,
                    )
                self.assertEqual(external_error.exception.status_code, 400)

    def test_outpainting_result_path_identifies_owning_user(self) -> None:
        self.assertEqual(
            app_main._outpainting_asset_owner(
                "/ai-images/operator_a/2026-01-01/outpainting_job.png"
            ),
            "operator_a",
        )
        self.assertEqual(
            app_main._outpainting_asset_owner(
                "/ai-images/operator_a/2026-01-01/%6futpainting_job.png"
            ),
            "operator_a",
        )
        self.assertIsNone(
            app_main._outpainting_asset_owner(
                "/ai-images/operator_a/2026-01-01/generated_job.png"
            )
        )

    async def test_worker_persists_cost_and_polling_projects_outpainting_metadata(self) -> None:
        prepared = bfl.prepare_outpainting_image(
            png_data_uri(),
            max_source_bytes=1024 * 1024,
            max_source_pixels=1024 * 1024,
            max_encoded_input_bytes=1024 * 1024,
        )
        geometry = bfl.validate_geometry(
            processing_width=64,
            processing_height=64,
            top=64,
            right=0,
            bottom=0,
            left=0,
        )
        provider_uuid = "22222222-2222-4222-8222-222222222222"
        metadata = {
            "operation": "outpainting",
            "provider_task_uuid": provider_uuid,
            "expected_width": 64,
            "expected_height": 128,
            "source_sha256": "private-digest",
            "cost": None,
        }
        saved: list[dict] = []
        result = make_result(
            image_url="/ai-images/operator_a/2026-01-01/outpainting_job.png",
            provider_task_id=provider_uuid,
            polling_url=f"https://api.bfl.ai/v1/get_result?id={provider_uuid}",
            cost=0.02,
            width=64,
            height=128,
        )
        app_main.app.state.outpainting_semaphore = app_main.asyncio.Semaphore(1)
        app_main.app.state.outpainting_tasks = set()
        run_mock = AsyncMock(return_value=result)
        with (
            patch.object(app_main, "run_outpainting", new=run_mock),
            patch.object(app_main.settings, "bfl_outpainting_mode", "fast"),
            patch.object(app_main.settings, "bfl_outpainting_output_format", "PNG"),
            patch.object(app_main, "save_ai_image_job", side_effect=lambda **kwargs: saved.append(kwargs)),
            patch.object(app_main, "generate_inspiration_thumb"),
            patch.object(app_main, "log_operation"),
        ):
            await app_main._run_outpainting_background(
                "job-2",
                {"id": "operator_a", "username": "运营A", "role": "user"},
                prepared,
                geometry,
                provider_uuid,
                metadata,
                123.0,
            )
        self.assertEqual(saved[-1]["status"], "done")
        transport = run_mock.await_args.kwargs
        self.assertEqual(transport["api_url"], app_main.settings.bfl_api_url)
        self.assertEqual(transport["mode"], "fast")
        self.assertEqual(transport["output_format"], "PNG")
        self.assertFalse(transport["auto_crop"])
        self.assertIsNotNone(transport["on_accepted"])
        self.assertNotIn("model", transport)
        self.assertNotIn("output_quality", transport)
        self.assertNotIn("ttl_seconds", transport)
        self.assertNotIn("provider_task_uuid", transport)
        self.assertEqual(saved[-1]["task_id"], provider_uuid)
        self.assertEqual(saved[-1]["request_meta"]["cost"], 0.02)
        self.assertEqual(saved[-1]["image_url"], result.image_url)

        persisted = {
            "id": "job-2",
            "user_id": "operator_a",
            "status": "done",
            "progress": 100,
            "image_url": result.image_url,
            "original_prompt": "FLUX outpainting",
            "resolved_prompt": "FLUX outpainting",
            "prompt": "FLUX outpainting",
            "prompt_trace": "",
            "task_id": provider_uuid,
            "model": bfl.BFL_OUTPAINTING_MODEL,
            "provider": "bfl",
            "error": None,
            "provider_switched": False,
            "request_meta": saved[-1]["request_meta"],
        }
        with (
            patch.object(app_main, "_current_user", return_value={"id": "operator_a", "role": "user"}),
            patch.object(app_main, "load_ai_image_job", return_value=persisted),
            patch.object(app_main, "get_inspiration_thumb_url_if_exists", return_value=result.image_url),
        ):
            poll = app_main.ai_image_status(object(), "job-2")
        self.assertEqual(poll["cost"], 0.02)
        self.assertEqual(poll["outpainting"]["provider_task_id"], provider_uuid)
        self.assertEqual(poll["outpainting"]["provider_task_uuid"], provider_uuid)
        self.assertNotIn("source_sha256", poll["outpainting"])

    async def test_recovery_polls_legacy_aligned_provider_envelope(self) -> None:
        provider_uuid = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
        stored_job = {
            "id": "job-recovery",
            "user_id": "operator_a",
            "status": "processing",
            "model": bfl.BFL_OUTPAINTING_MODEL,
            "provider": "bfl",
            "prompt": "FLUX outpainting",
            "original_prompt": "FLUX outpainting",
            "resolved_prompt": "FLUX outpainting",
            "size": "129x65",
            "resolution": "",
            "task_id": provider_uuid,
            "created_at": 123.0,
            "request_meta": {
                "operation": "outpainting",
                "provider_task_uuid": provider_uuid,
                "processing_width": 64,
                "processing_height": 64,
                "top": 1,
                "right": 65,
                "bottom": 0,
                "left": 0,
                "expected_width": 129,
                "expected_height": 65,
                "provider_top": 64,
                "provider_right": 128,
                "provider_bottom": 0,
                "provider_left": 0,
                "provider_width": 192,
                "provider_height": 128,
                "provider_margin_alignment": 64,
            },
        }
        result = make_result(
            image_url="/ai-images/operator_a/2026-01-01/outpainting_job-recovery.png",
            provider_task_id=provider_uuid,
            cost=0.03,
            width=129,
            height=65,
        )
        saved: list[dict] = []
        app_main.app.state.outpainting_semaphore = app_main.asyncio.Semaphore(1)
        run_mock = AsyncMock(return_value=result)
        with (
            patch.object(app_main, "load_active_outpainting_jobs", return_value=[stored_job]),
            patch.object(app_main, "run_outpainting", new=run_mock),
            patch.object(app_main, "save_ai_image_job", side_effect=lambda **kwargs: saved.append(kwargs)),
            patch.object(app_main, "generate_inspiration_thumb"),
            patch.object(app_main, "log_operation"),
            patch.object(app_main.settings, "bfl_outpainting_max_concurrency", 1),
        ):
            await app_main._recover_outpainting_jobs()
        transport = run_mock.await_args.kwargs
        self.assertIsNone(transport["prepared"])
        self.assertFalse(transport["submit_request"])
        self.assertEqual(transport["provider_task_id"], provider_uuid)
        self.assertEqual(
            transport["geometry"].provider_margins(),
            {"top": 64, "right": 128, "bottom": 0, "left": 0},
        )
        self.assertEqual(saved[-1]["status"], "done")
        self.assertEqual(saved[-1]["image_url"], result.image_url)

    async def test_recovery_accepts_legacy_aligned_metadata_without_provider_fields(self) -> None:
        provider_uuid = "abababab-abab-4bab-8bab-abababababab"
        stored_job = {
            "id": "job-legacy-recovery",
            "user_id": "operator_a",
            "status": "processing",
            "model": bfl.BFL_OUTPAINTING_MODEL,
            "provider": "bfl",
            "prompt": "FLUX outpainting",
            "original_prompt": "FLUX outpainting",
            "resolved_prompt": "FLUX outpainting",
            "size": "64x128",
            "resolution": "",
            "task_id": provider_uuid,
            "created_at": 123.0,
            "request_meta": {
                "operation": "outpainting",
                "provider_task_uuid": provider_uuid,
                "processing_width": 64,
                "processing_height": 64,
                "top": 64,
                "right": 0,
                "bottom": 0,
                "left": 0,
                "expected_width": 64,
                "expected_height": 128,
            },
        }
        result = make_result(
            image_url="/ai-images/operator_a/2026-01-01/outpainting_job-legacy.png",
            provider_task_id=provider_uuid,
            cost=0.01,
            width=64,
            height=128,
        )
        app_main.app.state.outpainting_semaphore = app_main.asyncio.Semaphore(1)
        run_mock = AsyncMock(return_value=result)
        with (
            patch.object(app_main, "load_active_outpainting_jobs", return_value=[stored_job]),
            patch.object(app_main, "run_outpainting", new=run_mock),
            patch.object(app_main, "save_ai_image_job"),
            patch.object(app_main, "generate_inspiration_thumb"),
            patch.object(app_main, "log_operation"),
            patch.object(app_main.settings, "bfl_outpainting_max_concurrency", 1),
        ):
            await app_main._recover_outpainting_jobs()
        self.assertFalse(run_mock.await_args.kwargs["submit_request"])
        self.assertEqual(
            run_mock.await_args.kwargs["geometry"].provider_margins(),
            {"top": 64, "right": 0, "bottom": 0, "left": 0},
        )

    async def test_recovery_rejects_partial_or_inconsistent_provider_geometry(self) -> None:
        provider_uuid = "acacacac-acac-4cac-8cac-acacacacacac"
        base_meta = {
            "operation": "outpainting",
            "provider_task_uuid": provider_uuid,
            "processing_width": 64,
            "processing_height": 64,
            "top": 1,
            "right": 65,
            "bottom": 0,
            "left": 0,
            "expected_width": 129,
            "expected_height": 65,
        }
        cases = (
            {**base_meta, "provider_top": 64},
            {
                **base_meta,
                "provider_top": 64,
                "provider_right": 64,
                "provider_bottom": 0,
                "provider_left": 0,
                "provider_width": 128,
                "provider_height": 128,
                "provider_margin_alignment": 64,
            },
        )
        for index, request_meta in enumerate(cases):
            with self.subTest(index=index):
                stored_job = {
                    "id": f"job-invalid-recovery-{index}",
                    "user_id": "operator_a",
                    "status": "processing",
                    "model": bfl.BFL_OUTPAINTING_MODEL,
                    "provider": "bfl",
                    "prompt": "FLUX outpainting",
                    "original_prompt": "FLUX outpainting",
                    "resolved_prompt": "FLUX outpainting",
                    "size": "129x65",
                    "resolution": "",
                    "task_id": provider_uuid,
                    "created_at": 123.0,
                    "request_meta": request_meta,
                }
                saved: list[dict] = []
                run_mock = AsyncMock()
                with (
                    patch.object(app_main, "load_active_outpainting_jobs", return_value=[stored_job]),
                    patch.object(app_main, "run_outpainting", new=run_mock),
                    patch.object(app_main, "save_ai_image_job", side_effect=lambda **kwargs: saved.append(kwargs)),
                ):
                    await app_main._recover_outpainting_jobs()
                run_mock.assert_not_awaited()
                self.assertEqual(saved[-1]["status"], "failed")
                self.assertEqual(saved[-1]["error"], "扩图任务恢复信息无效，请重新扩图")

    async def test_recovery_resubmits_queued_job_from_snapshot(self) -> None:
        request = json_request({
            "image_url": png_data_uri((128, 128)),
            "processing_width": 64,
            "processing_height": 64,
            "outpaint": {"top": 1, "right": 65, "bottom": 0, "left": 0},
            "client_request_id": "77777777-7777-4777-8777-777777777777",
        })
        saved: list[dict] = []

        def close_task(coroutine, *, claimed_job_id=""):
            coroutine.close()
            app_main._release_outpainting_claim(claimed_job_id)
            return Mock()

        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "output"
            output_path.mkdir()
            with (
                patch.object(app_main.settings, "bfl_outpainting_enabled", True),
                patch.object(app_main.settings, "bfl_api_key", "bfl-test-key"),
                patch.object(app_main.settings, "output_path", output_path),
                patch.object(app_main, "load_ai_image_job_by_client_request_id", return_value=None),
                patch.object(app_main, "save_ai_image_job", side_effect=lambda **kwargs: saved.append(kwargs)),
                patch.object(app_main, "_track_outpainting_task", side_effect=close_task),
            ):
                response = await app_main.ai_image_outpainting(request)

            queued = saved[0]
            self.assertEqual(queued["request_meta"]["phase"], "queued")
            stored_job = {
                "id": queued["job_id"],
                "user_id": queued["user_id"],
                "status": queued["status"],
                "model": queued["model"],
                "provider": queued["provider"],
                "prompt": queued["prompt"],
                "original_prompt": queued["original_prompt"],
                "resolved_prompt": queued["resolved_prompt"],
                "size": queued["size"],
                "resolution": queued["resolution"],
                "task_id": queued["task_id"],
                "created_at": queued["created_at"],
                "request_meta": queued["request_meta"],
            }
            result = make_result(
                image_url="/ai-images/operator_a/2026-01-01/outpainting_job-queued.png",
                provider_task_id=str(queued["task_id"] or TASK_ID),
                cost=0.02,
                width=129,
                height=65,
            )
            recovered: list[dict] = []
            run_mock = AsyncMock(return_value=result)
            app_main.app.state.outpainting_semaphore = app_main.asyncio.Semaphore(1)
            with (
                patch.object(app_main.settings, "output_path", output_path),
                patch.object(app_main, "load_active_outpainting_jobs", return_value=[stored_job]),
                patch.object(app_main, "run_outpainting", new=run_mock),
                patch.object(app_main, "save_ai_image_job", side_effect=lambda **kwargs: recovered.append(kwargs)),
                patch.object(app_main, "generate_inspiration_thumb"),
                patch.object(app_main, "log_operation"),
                patch.object(app_main.settings, "bfl_outpainting_max_concurrency", 1),
            ):
                await app_main._recover_outpainting_jobs()

            transport = run_mock.await_args.kwargs
            self.assertTrue(transport["submit_request"])
            self.assertIsNotNone(transport["prepared"])
            self.assertEqual(transport.get("provider_task_id") or "", "")
            self.assertEqual(transport["prepared"].processing_width, 64)
            self.assertEqual(transport["prepared"].processing_height, 64)
            self.assertEqual(recovered[-1]["status"], "done")

    async def test_recovery_fails_queued_job_without_source_snapshot(self) -> None:
        provider_uuid = "88888888-8888-4888-8888-888888888888"
        stored_job = {
            "id": "job-queued-missing-source",
            "user_id": "operator_a",
            "status": "processing",
            "model": bfl.BFL_OUTPAINTING_MODEL,
            "provider": "bfl",
            "prompt": "FLUX outpainting",
            "original_prompt": "FLUX outpainting",
            "resolved_prompt": "FLUX outpainting",
            "size": "128x64",
            "resolution": "",
            "task_id": provider_uuid,
            "created_at": 123.0,
            "request_meta": {
                "operation": "outpainting",
                "provider_task_uuid": provider_uuid,
                "phase": "queued",
                "processing_width": 64,
                "processing_height": 64,
                "top": 64,
                "right": 0,
                "bottom": 0,
                "left": 0,
                "expected_width": 64,
                "expected_height": 128,
            },
        }
        saved: list[dict] = []
        run_mock = AsyncMock()
        with (
            patch.object(app_main, "load_active_outpainting_jobs", return_value=[stored_job]),
            patch.object(app_main, "run_outpainting", new=run_mock),
            patch.object(app_main, "save_ai_image_job", side_effect=lambda **kwargs: saved.append(kwargs)),
        ):
            await app_main._recover_outpainting_jobs()
        run_mock.assert_not_awaited()
        self.assertEqual(saved[-1]["status"], "failed")
        self.assertEqual(saved[-1]["error"], "扩图任务恢复信息无效，请重新扩图")

    async def test_cancel_while_waiting_for_semaphore_recovers_as_resubmit(self) -> None:
        job_id = "job-cancel-queued"
        provider_uuid = "99999999-9999-4999-8999-999999999999"
        waiting = asyncio.Event()
        held = asyncio.Semaphore(0)

        class WaitingSemaphore:
            async def __aenter__(self):
                waiting.set()
                await held.acquire()
                return self

            async def __aexit__(self, exc_type, exc, tb):
                held.release()
                return False

        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "output"
            output_path.mkdir()
            prepared = bfl.prepare_outpainting_image(
                png_data_uri((128, 128)),
                processing_width=64,
                processing_height=64,
                max_source_bytes=1024 * 1024,
                max_source_pixels=1024 * 1024,
                max_encoded_input_bytes=1024 * 1024,
            )
            geometry = bfl.validate_geometry(
                processing_width=64,
                processing_height=64,
                top=1,
                right=65,
                bottom=0,
                left=0,
            )
            snapshot_url = bfl.persist_prepared_source_snapshot(
                prepared,
                output_root=output_path,
                user_id="operator_a",
                job_id=job_id,
            )
            snapshot_path = (
                output_path / "ai-images" / "operator_a" / "outpainting" / job_id / "source.png"
            )
            request_meta = {
                "operation": "outpainting",
                "provider_task_uuid": provider_uuid,
                "source_snapshot_url": snapshot_url,
                "source_width": prepared.source_width,
                "source_height": prepared.source_height,
                "processing_width": prepared.processing_width,
                "processing_height": prepared.processing_height,
                "source_format": prepared.source_format,
                "source_sha256": prepared.source_sha256,
                "top": 1,
                "right": 65,
                "bottom": 0,
                "left": 0,
                "expected_width": geometry.expected_width,
                "expected_height": geometry.expected_height,
                "phase": "queued",
            }
            saved: list[dict] = []
            app_main.app.state.outpainting_semaphore = WaitingSemaphore()
            with (
                patch.object(app_main.settings, "output_path", output_path),
                patch.object(app_main, "save_ai_image_job", side_effect=lambda **kwargs: saved.append(kwargs)),
                patch.object(app_main, "run_outpainting", new=AsyncMock()) as run_mock,
            ):
                worker = asyncio.create_task(
                    app_main._run_outpainting_background(
                        job_id,
                        {"id": "operator_a", "username": "运营A", "role": "user"},
                        prepared,
                        geometry,
                        provider_uuid,
                        request_meta,
                        123.0,
                    )
                )
                await asyncio.wait_for(waiting.wait(), timeout=2)
                worker.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await worker
                run_mock.assert_not_awaited()
                self.assertEqual(saved[-1]["request_meta"]["phase"], "queued")
                self.assertEqual(saved[-1]["status"], "processing")
                self.assertTrue(snapshot_path.is_file())

                stored_job = {
                    "id": job_id,
                    "user_id": "operator_a",
                    "status": saved[-1]["status"],
                    "model": saved[-1]["model"],
                    "provider": saved[-1]["provider"],
                    "prompt": saved[-1]["prompt"],
                    "original_prompt": saved[-1]["original_prompt"],
                    "resolved_prompt": saved[-1]["resolved_prompt"],
                    "size": saved[-1]["size"],
                    "resolution": saved[-1]["resolution"],
                    "task_id": saved[-1]["task_id"],
                    "created_at": saved[-1]["created_at"],
                    "request_meta": saved[-1]["request_meta"],
                }
                result = make_result(
                    image_url="/ai-images/operator_a/2026-01-01/outpainting_job-cancel.png",
                    provider_task_id=provider_uuid,
                    cost=0.02,
                    width=129,
                    height=65,
                )
                recovered: list[dict] = []
                recover_mock = AsyncMock(return_value=result)
                app_main.app.state.outpainting_semaphore = asyncio.Semaphore(1)
                with (
                    patch.object(app_main, "load_active_outpainting_jobs", return_value=[stored_job]),
                    patch.object(app_main, "run_outpainting", new=recover_mock),
                    patch.object(app_main, "save_ai_image_job", side_effect=lambda **kwargs: recovered.append(kwargs)),
                    patch.object(app_main, "generate_inspiration_thumb"),
                    patch.object(app_main, "log_operation"),
                    patch.object(app_main.settings, "bfl_outpainting_max_concurrency", 1),
                ):
                    await app_main._recover_outpainting_jobs()

                self.assertTrue(recover_mock.await_args.kwargs["submit_request"])
                self.assertIsNotNone(recover_mock.await_args.kwargs["prepared"])
                self.assertEqual(recovered[-1]["status"], "done")

    async def test_terminal_success_discards_source_snapshot(self) -> None:
        job_id = "job-done-snapshot"
        provider_uuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "output"
            output_path.mkdir()
            prepared = bfl.prepare_outpainting_image(
                png_data_uri((128, 128)),
                processing_width=64,
                processing_height=64,
                max_source_bytes=1024 * 1024,
                max_source_pixels=1024 * 1024,
                max_encoded_input_bytes=1024 * 1024,
            )
            geometry = bfl.validate_geometry(
                processing_width=64,
                processing_height=64,
                top=1,
                right=65,
                bottom=0,
                left=0,
            )
            snapshot_url = bfl.persist_prepared_source_snapshot(
                prepared,
                output_root=output_path,
                user_id="operator_a",
                job_id=job_id,
            )
            snapshot_path = (
                output_path / "ai-images" / "operator_a" / "outpainting" / job_id / "source.png"
            )
            self.assertTrue(snapshot_path.is_file())
            result = make_result(
                image_url="/ai-images/operator_a/2026-01-01/outpainting_job-done.png",
                provider_task_id=provider_uuid,
                cost=0.01,
                width=129,
                height=65,
            )
            app_main.app.state.outpainting_semaphore = asyncio.Semaphore(1)
            with (
                patch.object(app_main.settings, "output_path", output_path),
                patch.object(app_main, "run_outpainting", new=AsyncMock(return_value=result)),
                patch.object(app_main, "save_ai_image_job"),
                patch.object(app_main, "generate_inspiration_thumb"),
                patch.object(app_main, "log_operation"),
            ):
                await app_main._run_outpainting_background(
                    job_id,
                    {"id": "operator_a", "username": "运营A", "role": "user"},
                    prepared,
                    geometry,
                    provider_uuid,
                    {
                        "operation": "outpainting",
                        "provider_task_uuid": provider_uuid,
                        "source_snapshot_url": snapshot_url,
                        "expected_width": geometry.expected_width,
                        "expected_height": geometry.expected_height,
                    },
                    123.0,
                )
            self.assertFalse(snapshot_path.exists())

    async def test_terminal_failure_discards_source_snapshot(self) -> None:
        job_id = "job-failed-snapshot"
        provider_uuid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "output"
            output_path.mkdir()
            prepared = bfl.prepare_outpainting_image(
                png_data_uri((128, 128)),
                processing_width=64,
                processing_height=64,
                max_source_bytes=1024 * 1024,
                max_source_pixels=1024 * 1024,
                max_encoded_input_bytes=1024 * 1024,
            )
            geometry = bfl.validate_geometry(
                processing_width=64,
                processing_height=64,
                top=1,
                right=65,
                bottom=0,
                left=0,
            )
            snapshot_url = bfl.persist_prepared_source_snapshot(
                prepared,
                output_root=output_path,
                user_id="operator_a",
                job_id=job_id,
            )
            snapshot_path = (
                output_path / "ai-images" / "operator_a" / "outpainting" / job_id / "source.png"
            )
            self.assertTrue(snapshot_path.is_file())
            app_main.app.state.outpainting_semaphore = asyncio.Semaphore(1)
            with (
                patch.object(app_main.settings, "output_path", output_path),
                patch.object(
                    app_main,
                    "run_outpainting",
                    new=AsyncMock(side_effect=bfl.BflOutpaintingError("扩图失败", diagnostic="boom")),
                ),
                patch.object(app_main, "save_ai_image_job"),
                patch.object(app_main, "log_operation"),
            ):
                await app_main._run_outpainting_background(
                    job_id,
                    {"id": "operator_a", "username": "运营A", "role": "user"},
                    prepared,
                    geometry,
                    provider_uuid,
                    {
                        "operation": "outpainting",
                        "provider_task_uuid": provider_uuid,
                        "source_snapshot_url": snapshot_url,
                        "expected_width": geometry.expected_width,
                        "expected_height": geometry.expected_height,
                    },
                    123.0,
                )
            self.assertFalse(snapshot_path.exists())

    async def test_done_persistence_retries_without_marking_paid_result_failed(self) -> None:
        prepared = bfl.prepare_outpainting_image(
            png_data_uri(),
            max_source_bytes=1024 * 1024,
            max_source_pixels=1024 * 1024,
            max_encoded_input_bytes=1024 * 1024,
        )
        geometry = bfl.validate_geometry(
            processing_width=64,
            processing_height=64,
            top=64,
            right=0,
            bottom=0,
            left=0,
        )
        provider_uuid = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
        result = make_result(
            image_url="/ai-images/operator_a/2026-01-01/outpainting_job-retry.png",
            provider_task_id=provider_uuid,
            cost=0.01,
            width=64,
            height=128,
        )
        saved: list[dict] = []
        done_attempts = 0

        def save_with_one_lock_failure(**kwargs):
            nonlocal done_attempts
            if kwargs["status"] == "done":
                done_attempts += 1
                if done_attempts == 1:
                    raise sqlite3.OperationalError("database is locked")
            saved.append(kwargs)

        app_main.app.state.outpainting_semaphore = app_main.asyncio.Semaphore(1)
        with (
            patch.object(app_main, "run_outpainting", new=AsyncMock(return_value=result)),
            patch.object(app_main, "save_ai_image_job", side_effect=save_with_one_lock_failure),
            patch.object(app_main.time, "sleep"),
            patch.object(app_main, "generate_inspiration_thumb"),
            patch.object(app_main, "log_operation"),
        ):
            await app_main._run_outpainting_background(
                "job-retry",
                {"id": "operator_a", "username": "运营A", "role": "user"},
                prepared,
                geometry,
                provider_uuid,
                {
                    "operation": "outpainting",
                    "provider_task_uuid": provider_uuid,
                    "expected_width": 64,
                    "expected_height": 128,
                },
                123.0,
            )
        self.assertEqual(done_attempts, 2)
        self.assertEqual(saved[-1]["status"], "done")
        self.assertNotIn("failed", [item["status"] for item in saved])


class JobStoreIdempotencyTest(unittest.TestCase):
    def test_client_request_id_is_durable_unique_per_user(self) -> None:
        token = "77777777-7777-4777-8777-777777777777"

        def save(job_id: str, user_id: str) -> None:
            job_store.save_ai_image_job(
                job_id=job_id,
                user_id=user_id,
                status="processing",
                model="flux-tools/outpainting-v1",
                provider="bfl",
                prompt="FLUX outpainting",
                size="128x64",
                client_request_id=token,
                request_meta={"operation": "outpainting", "expected_width": 128, "expected_height": 64},
            )

        with tempfile.TemporaryDirectory() as temp_dir:
            database_path = Path(temp_dir) / "jobs.db"
            with patch.object(job_store, "_DB_PATH", database_path):
                job_store.init_db()
                save("job-a", "operator_a")
                save("job-b", "operator_b")
                self.assertEqual(
                    job_store.load_ai_image_job_by_client_request_id("operator_a", token)["id"],
                    "job-a",
                )
                self.assertEqual(
                    job_store.load_ai_image_job_by_client_request_id("operator_b", token)["id"],
                    "job-b",
                )
                self.assertEqual(
                    {job["id"] for job in job_store.load_active_outpainting_jobs()},
                    {"job-a", "job-b"},
                )
                with self.assertRaises(sqlite3.IntegrityError):
                    save("job-a-duplicate", "operator_a")


if __name__ == "__main__":
    unittest.main()

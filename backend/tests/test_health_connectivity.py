from __future__ import annotations

import asyncio
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx

from backend import main


class HealthConnectivityTest(unittest.IsolatedAsyncioTestCase):
    async def test_unreachable_library_does_not_block_session_heartbeat(self):
        for path in ("/health", "/health/deep"):
            with self.subTest(path=path):
                started = threading.Event()
                release = threading.Event()
                checked = threading.Event()

                def slow_exists():
                    started.set()
                    release.wait(2)
                    checked.set()
                    return False

                library = SimpleNamespace(exists=slow_exists)
                with (
                    patch.object(main.settings, "product_library_path", library),
                    patch.object(main, "_get_session_user", return_value={"id": "test-user"}),
                    patch.object(main, "_probe_penpot", new=AsyncMock(return_value=False)),
                    patch.object(main, "_probe_apimart", new=AsyncMock(return_value={"connected": False})),
                    patch.object(main, "_probe_adobe2api", new=AsyncMock(return_value={"connected": False})),
                    patch.object(main, "load_latest_service_probe", return_value=None),
                    patch.object(main, "load_latest_completed_service_probe", return_value=None),
                ):
                    async with httpx.AsyncClient(
                        transport=httpx.ASGITransport(app=main.app),
                        base_url="http://designflow.test",
                    ) as client:
                        health = asyncio.create_task(client.get(path))
                        try:
                            self.assertTrue(await asyncio.to_thread(started.wait, 1))
                            response = await asyncio.wait_for(client.get("/auth/session"), 1)
                            self.assertEqual(response.status_code, 200)
                            self.assertEqual(response.json()["user"]["id"], "test-user")
                            self.assertFalse(checked.is_set(), "Library check must still be pending while the heartbeat succeeds")
                        finally:
                            release.set()
                            result = await health
                        self.assertEqual(result.status_code, 200)
                        self.assertFalse(result.json()["library"]["connected"])

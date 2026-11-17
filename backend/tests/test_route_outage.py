"""线路持续故障时的回归测试：连续多个请求都不能把单线路的错误抛给用户。

2026-11-17 正式机 sub2api 故障，旧逻辑遇到 5xx / 超时 / 断连就直接报错，且这类失败
没有计入熔断，导致每个请求都先打到故障线路然后失败。这里用真实的选路和熔断逻辑，
只把各线路的生图函数换成假的，模拟一段持续故障。
"""
import asyncio
import unittest
from unittest.mock import patch

import httpx

from backend import ai_image


def _outage_errors():
    def accepted_then_lost(**kwargs):
        kwargs["on_accepted"]("sub-task")
        raise httpx.ReadTimeout("read timed out")

    def raise_(exc):
        def _inner(**kwargs):
            raise exc
        return _inner

    return {
        "HTTP 502": raise_(RuntimeError("Sub2API 生图失败: HTTP 502 Bad Gateway")),
        "HTTP 500": raise_(RuntimeError("Sub2API 生图失败: HTTP 500")),
        "响应丢失": raise_(ai_image.AmbiguousUpstreamError("请求可能已送达，状态不确定", provider="sub2api")),
        "断连": raise_(httpx.RemoteProtocolError("Server disconnected without sending a response")),
        "连接失败": raise_(httpx.ConnectError("connection refused")),
        "单次尝试超时": raise_(ai_image.UpstreamTaskFailed("线路等待超时（上限 100 秒），已放弃本次请求并切换线路")),
        "受理后结果丢失": accepted_then_lost,
    }


class ProviderOutageTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        ai_image.reset_provider_freeze()
        self.settings = patch.multiple(
            ai_image.settings,
            cliproxy_base_url="http://sub2api:8080", cliproxy_api_key="sk-sub2api",
            ai_image_api_key="sk-apimart", tuzi_base_url="", tuzi_api_key="",
            kie_api_key="", smart_routing_rules_json="",
        )
        self.settings.start()

    def tearDown(self) -> None:
        self.settings.stop()
        ai_image.reset_provider_freeze()

    async def _run_outage(self, sub2api_error, *, requests: int, concurrent: bool = False):
        calls = {"sub2api": 0, "apimart": 0}

        async def broken_sub2api(**kwargs):
            calls["sub2api"] += 1
            sub2api_error(**kwargs)

        async def healthy_apimart(**kwargs):
            calls["apimart"] += 1
            await asyncio.sleep(0)
            return {"url": "/ok.png"}

        async def one_request():
            return await ai_image.smart_generate_image_async(
                model="gpt-image-2", prompt="test", resolution="1K", user_id="u",
            )

        with patch.object(ai_image, "generate_sub2api_async", side_effect=broken_sub2api), \
             patch.object(ai_image, "generate_image_async", side_effect=healthy_apimart):
            if concurrent:
                results = await asyncio.gather(*(one_request() for _ in range(requests)))
            else:
                results = [await one_request() for _ in range(requests)]
        return results, calls

    async def test_sequential_requests_all_succeed_and_broken_route_is_frozen(self):
        self.assertEqual(ai_image.get_smart_route_candidates("gpt-image-2", resolution="1K"), ["sub2api", "apimart"])
        for name, error in _outage_errors().items():
            with self.subTest(error=name):
                ai_image.reset_provider_freeze()
                results, calls = await self._run_outage(error, requests=6)
                # 用户侧：每个请求都出图，都由后备线路完成
                self.assertEqual([r["provider"] for r in results], ["apimart"] * 6)
                # 故障线路连续失败 2 次后冻结，之后的请求不再先去撞它
                self.assertEqual(calls, {"sub2api": 2, "apimart": 6})
                self.assertTrue(ai_image.is_provider_frozen("sub2api", model="gpt-image-2"))
                self.assertEqual(ai_image.get_smart_route_candidates("gpt-image-2", resolution="1K"), ["apimart"])

    async def test_concurrent_requests_during_outage_all_succeed(self):
        for name, error in _outage_errors().items():
            with self.subTest(error=name):
                ai_image.reset_provider_freeze()
                results, calls = await self._run_outage(error, requests=8, concurrent=True)
                self.assertEqual([r["provider"] for r in results], ["apimart"] * 8)
                self.assertEqual(calls["apimart"], 8)
                self.assertTrue(ai_image.is_provider_frozen("sub2api", model="gpt-image-2"))

    async def test_backup_route_also_down_reports_all_routes_failed(self):
        async def broken(**kwargs):
            raise RuntimeError("HTTP 503 Service Unavailable")

        with patch.object(ai_image, "generate_sub2api_async", side_effect=broken), \
             patch.object(ai_image, "generate_image_async", side_effect=broken):
            with self.assertRaises(ai_image.AllProvidersFailedError) as ctx:
                await ai_image.smart_generate_image_async(
                    model="gpt-image-2", prompt="test", resolution="1K", user_id="u",
                )
        # 两条线路各试两轮都失败才报错
        self.assertEqual(len(ctx.exception.provider_errors), 4)


if __name__ == "__main__":
    unittest.main()

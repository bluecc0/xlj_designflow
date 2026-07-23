"""生图提交幂等去重与客户端事件上报的回归测试。

无 pytest 依赖，直接运行：
    python3 tests/test_ai_image_dedup.py

覆盖：
- 幂等键按用户隔离（不同用户同 client_request_id 互不串线）
- 元组键防分隔符碰撞（ID 含冒号时不可构造跨用户串线）
- 同用户在途/已完成去重
- 5xx 可重试失败不永久缓存（自动重试真正重新执行）
- 4xx 确定性失败缓存重放（不重复执行）
- /ai-image/client-event 匿名可达、限流、体积上限
- 匿名事件字段含换行/控制字符时日志仍为单行（防日志注入）
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException  # noqa: E402

import backend.main as m  # noqa: E402


class _Headers:
    def __init__(self, d=None):
        self._d = {k.lower(): v for k, v in (d or {}).items()}

    def get(self, k, default=None):
        return self._d.get(k.lower(), default)


class _State:
    def __init__(self, user):
        self.user = user


class _Req:
    def __init__(self, user=None, headers=None):
        self.headers = _Headers(headers)
        self.state = _State(user)


def _user(uid):
    return {"id": uid, "username": uid}


async def test_user_isolation():
    """P1：不同用户提交相同 client_request_id，必须各自执行、互不串线。"""
    calls = []

    @m._ai_image_submit_dedup
    async def ep(**kwargs):
        uid = kwargs["request"].state.user["id"]
        calls.append(uid)
        await asyncio.sleep(0.05)
        return {"job_id": "job-" + uid}

    r1, r2 = await asyncio.gather(
        ep(request=_Req(_user("alice")), client_request_id="same-id"),
        ep(request=_Req(_user("bob")), client_request_id="same-id"),
    )
    assert sorted(calls) == ["alice", "bob"], f"两个用户都应执行，实际 {calls}"
    assert r1["job_id"] == "job-alice" and r2["job_id"] == "job-bob", (r1, r2)
    print("user isolation: OK")


async def test_same_user_inflight_and_replay():
    """同用户同编号：在途去重 + 完成后重放，只执行一次。"""
    calls = []

    @m._ai_image_submit_dedup
    async def ep(**kwargs):
        calls.append(1)
        await asyncio.sleep(0.05)
        return {"job_id": "j1"}

    r1, r2 = await asyncio.gather(
        ep(request=_Req(_user("carol")), client_request_id="cid-1"),
        ep(request=_Req(_user("carol")), client_request_id="cid-1"),
    )
    r3 = await ep(request=_Req(_user("carol")), client_request_id="cid-1")
    assert len(calls) == 1 and r1 == r2 == r3
    print("same-user dedup: OK")


async def test_retryable_error_reexecutes():
    """P2：5xx 失败完成后清缓存，同编号重试真正重新执行（瞬时故障可恢复）。"""
    calls = []

    @m._ai_image_submit_dedup
    async def ep(**kwargs):
        calls.append(1)
        if len(calls) == 1:
            raise HTTPException(502, "上游瞬时故障")
        return {"job_id": "recovered"}

    try:
        await ep(request=_Req(_user("dave")), client_request_id="cid-r")
        raise AssertionError("第一次应抛 502")
    except HTTPException as e:
        assert e.status_code == 502
    r = await ep(request=_Req(_user("dave")), client_request_id="cid-r")
    assert r["job_id"] == "recovered" and len(calls) == 2
    print("retryable 5xx re-executes: OK")


async def test_inflight_5xx_waiter_shares_error_then_next_reexecutes():
    """在途等待方复用首次异常；完成后缓存已清，下一次重新执行。"""
    calls = []

    @m._ai_image_submit_dedup
    async def ep(**kwargs):
        calls.append(1)
        await asyncio.sleep(0.05)
        raise HTTPException(502, "boom")

    async def run():
        try:
            await ep(request=_Req(_user("frank")), client_request_id="cid-w")
            return None
        except HTTPException as e:
            return e

    e1, e2 = await asyncio.gather(run(), run())
    assert len(calls) == 1 and e1.status_code == e2.status_code == 502
    e3 = await run()
    assert len(calls) == 2 and e3.status_code == 502
    print("in-flight waiter + re-execute: OK")


async def test_4xx_replayed_without_reexecution():
    """4xx 确定性失败：缓存重放，不重复执行。"""
    calls = []

    @m._ai_image_submit_dedup
    async def ep(**kwargs):
        calls.append(1)
        raise HTTPException(400, "prompt 不能为空")

    for _ in range(2):
        try:
            await ep(request=_Req(_user("erin")), client_request_id="cid-4xx")
            raise AssertionError("应抛 400")
        except HTTPException as e:
            assert e.status_code == 400
    assert len(calls) == 1
    print("4xx replay without re-execution: OK")


def test_client_event_anonymous_and_limits():
    """P2：client-event 匿名可达（不再被 401 拦截）、体积上限、限流。"""
    from starlette.testclient import TestClient

    original = m._get_session_user
    m._get_session_user = lambda request: None  # 模拟无 cookie 的 sendBeacon
    try:
        client = TestClient(m.app)  # 不用 with：跳过 lifespan
        r = client.post("/ai-image/client-event", json={"type": "t", "clientRequestId": "x"})
        assert r.status_code == 200 and r.json().get("ok") is True, r.text

        big = "x" * (17 * 1024)
        rb = client.post("/ai-image/client-event", json={"type": "t", "error": big})
        assert rb.status_code == 200 and rb.json().get("ok") is False, rb.text

        limited = False
        for _ in range(m._CLIENT_EVENT_RATE_LIMIT + 5):
            rr = client.post("/ai-image/client-event", json={"type": "t"})
            if rr.json().get("rate_limited"):
                limited = True
                break
        assert limited, "应触发限流"
    finally:
        m._get_session_user = original
        m._client_event_rate.clear()
    print("client-event anon + limits: OK")


async def test_user_isolation_with_delimiter_chars():
    """P1 二轮：ID 含冒号等分隔符时不得构造出跨用户碰撞。

    字符串拼接键会让 ("a", "b:c") 与 ("a:b", "c") 撞成同一个键，
    元组键必须让两者各自执行。
    """
    calls = []

    @m._ai_image_submit_dedup
    async def ep(**kwargs):
        uid = kwargs["request"].state.user["id"]
        calls.append(uid)
        await asyncio.sleep(0.02)
        return {"uid": uid}

    r1, r2 = await asyncio.gather(
        ep(request=_Req(_user("a")), client_request_id="b:c"),
        ep(request=_Req(_user("a:b")), client_request_id="c"),
    )
    assert sorted(calls) == ["a", "a:b"], f"两个用户都应执行，实际 {calls}"
    assert {r1["uid"], r2["uid"]} == {"a", "a:b"}, (r1, r2)
    print("delimiter-char isolation: OK")


def test_client_event_log_injection_sanitized():
    """P2 二轮：匿名事件字段带换行/控制字符时，日志必须仍是单行。"""
    import logging

    from starlette.testclient import TestClient

    records = []

    class Cap(logging.Handler):
        def emit(self, record):
            records.append(record)

    handler = Cap()
    logging.getLogger().addHandler(handler)
    logging.getLogger().setLevel(logging.INFO)
    original = m._get_session_user
    m._get_session_user = lambda request: None
    try:
        client = TestClient(m.app)
        r = client.post("/ai-image/client-event", json={
            "type": "x\nFAKE-LOG-LINE user=admin action=login",
            "phase": "p\r\ninjected",
            "error": "err\n2026-01-01 ERROR forged line",
            "clientRequestId": "c\nid\ttab",
            "jobId": "j\nid",
            "apiBase": "http://x\n.evil",
            "online": "yes\nno",
        })
        assert r.status_code == 200, r.text
        evs = [rec for rec in records if "ai_image_client_event" in rec.getMessage()]
        assert evs, "应有事件日志"
        for rec in evs:
            msg = rec.getMessage()
            assert "\n" not in msg and "\r" not in msg and "\t" not in msg, repr(msg)
        assert any("FAKE-LOG-LINE" in rec.getMessage() for rec in evs), "内容应保留（仅去控制字符）"
    finally:
        m._get_session_user = original
        m._client_event_rate.clear()
        logging.getLogger().removeHandler(handler)
    print("log injection sanitized: OK")


def main():
    asyncio.run(test_user_isolation())
    asyncio.run(test_user_isolation_with_delimiter_chars())
    asyncio.run(test_same_user_inflight_and_replay())
    asyncio.run(test_retryable_error_reexecutes())
    asyncio.run(test_inflight_5xx_waiter_shares_error_then_next_reexecutes())
    asyncio.run(test_4xx_replayed_without_reexecution())
    test_client_event_anonymous_and_limits()
    test_client_event_log_injection_sanitized()
    print("\nALL TESTS PASSED")


if __name__ == "__main__":
    main()

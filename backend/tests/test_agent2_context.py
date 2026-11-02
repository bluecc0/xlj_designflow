from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import job_store
from backend.agent2 import context, service, store
from backend.agent2.engine import ContextOverflow, ModelStep


def _convo(turns: int, tool_chars: int = 2000) -> list[dict]:
    """每轮：用户 → Agent 调工具 → 工具结果 → Agent 回复。"""
    out = []
    for t in range(turns):
        out += [
            {"role": "user", "content": f"第 {t} 轮需求"},
            {"role": "assistant", "content": None, "tool_calls": [
                {"id": f"c{t}", "type": "function", "function": {"name": "load_skill", "arguments": "{}"}}]},
            {"role": "tool", "tool_call_id": f"c{t}", "content": "技能说明" * (tool_chars // 4)},
            {"role": "assistant", "content": f"第 {t} 轮完成"},
        ]
    return out


class ContextTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_patch = patch.object(job_store, "_DB_PATH", Path(self.tmp.name) / "ctx.db")
        self.db_patch.start()
        store.init_tables()
        self.session = store.create_session("u1")
        self.events = []
        self.summaries = []

    def tearDown(self):
        self.db_patch.stop()
        self.tmp.cleanup()

    async def _emit(self, event_type, payload):
        self.events.append(event_type)

    async def _summarize(self, previous, messages):
        self.summaries.append((previous, messages))
        return f"摘要{len(self.summaries)}"

    def _manager(self):
        return context.ContextManager(store.get_session(self.session["id"], "u1"), self._emit, self._summarize)

    def test_trims_old_tool_results_but_keeps_recent_ones(self):
        convo = _convo(5)
        trimmed = context.trim_old_tool_results(convo)
        tools = [m["content"] for m in trimmed if m["role"] == "tool"]
        self.assertTrue(all("已省略" in c for c in tools[:2]))
        self.assertTrue(all("已省略" not in c for c in tools[2:]))
        self.assertEqual(len(convo[2]["content"]), 2000)  # 原消息不被修改

    def test_under_budget_sends_history_without_summary(self):
        messages = [{"role": "system", "content": "SYS"}] + _convo(2)
        view = asyncio.run(self._manager().prepare(messages))
        self.assertEqual(view, messages)
        self.assertEqual(self.summaries, [])

    def test_over_budget_compacts_older_turns_and_persists(self):
        messages = [{"role": "system", "content": "SYS"}] + _convo(10)
        store.create_artifact(session_id=self.session["id"], user_id="u1", kind="image", url="/x.png", label="首屏")
        with patch.object(context, "COMPACT_TRIGGER_TOKENS", 3000):
            view = asyncio.run(self._manager().prepare(messages))
        # 前 4 轮被总结，保留最近 6 轮原文
        self.assertEqual([m["content"] for m in self.summaries[0][1] if m["role"] == "user"],
                         [f"第 {t} 轮需求" for t in range(4)])
        self.assertIn("摘要1", view[0]["content"])
        self.assertIn("首屏", view[0]["content"])
        self.assertEqual(view[1]["content"], "第 4 轮需求")
        self.assertEqual(self.events, ["context.compacting"])
        saved = store.get_session(self.session["id"], "u1")
        self.assertEqual((saved["summary"], saved["compacted_upto"]), ("摘要1", 16))

        # 下一轮：沿用已保存的摘要，不再重复压缩
        messages.append({"role": "user", "content": "再来一张"})
        view2 = asyncio.run(self._manager().prepare(messages))
        self.assertEqual(len(self.summaries), 1)
        self.assertEqual(view2[1]["content"], "第 4 轮需求")
        self.assertEqual(view2[-1]["content"], "再来一张")

    def test_force_compacts_even_few_turns(self):
        messages = [{"role": "system", "content": "SYS"}] + _convo(3)
        view = asyncio.run(self._manager().prepare(messages, force=True))
        self.assertEqual(view[1]["content"], "第 2 轮需求")
        self.assertIn("摘要1", view[0]["content"])

    def test_summarizer_failure_falls_back_to_full_view(self):
        async def broken(previous, messages):
            raise RuntimeError("down")
        manager = context.ContextManager(store.get_session(self.session["id"], "u1"), self._emit, broken)
        messages = [{"role": "system", "content": "SYS"}] + _convo(3)
        view = asyncio.run(manager.prepare(messages, force=True))
        self.assertEqual(len(view), len(messages))

    def test_engine_retries_after_context_overflow(self):
        store.save_session_messages(self.session["id"], _convo(3))

        class OverflowOnce:
            def __init__(self):
                self.calls = []

            async def stream(self, messages, tools):
                self.calls.append(messages)
                if len(self.calls) == 1:
                    raise ContextOverflow("maximum context length exceeded")
                yield ("text", "好了")
                yield ("step", ModelStep(text="好了"))

        model = OverflowOnce()
        user = {"id": "u1", "username": "t"}
        with patch.object(service, "model_factory", lambda: model), \
                patch.object(service, "tools_factory", lambda: {}), \
                patch.object(service, "_user_skill_dir", lambda u: None), \
                patch.object(context, "summarize", self._summarize):
            session = store.get_session(self.session["id"], "u1")

            async def run():
                return [c async for c in service.start_turn(user, session, "继续", [])]
            chunks = asyncio.run(run())
        types = [json.loads(c.split("data: ", 1)[1])["type"] for c in chunks]
        self.assertIn("context.compacting", types)
        self.assertEqual(types[-1], "turn.finished")
        self.assertIn("摘要1", model.calls[1][0]["content"])
        self.assertEqual(model.calls[1][1]["content"], "继续")


if __name__ == "__main__":
    unittest.main()

import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from backend.agent2.engine import ModelStep, Tool, run_loop
from backend.agent2.reference_preflight import check_reference_roles


class ReferencePreflightTest(unittest.IsolatedAsyncioTestCase):
    async def check(self, result, inputs=None, ctx=None):
        complete = AsyncMock(return_value=SimpleNamespace(json=lambda: {
            "choices": [{"message": {"content": json.dumps(result, ensure_ascii=False)}}]}))
        outcome = await check_reference_roles(ctx or SimpleNamespace(state={}), inputs or [{
            "text": "参考图1是场景", "uploads": [{"id": "product", "kind": "upload"}]}],
            read_image=lambda ctx, rid: (b"image", "image.png"),
            encode_image=lambda data, size: "data:image/png;base64,a", complete=complete)
        return outcome, complete

    async def test_product_as_scene_requires_clarification(self):
        result, _ = await self.check({"conflicts": [{"image_id": "product", "description": "只有白底鞋子，没有环境场景"}]})
        self.assertIn("第1张", result["clarification"]["question"])
        self.assertIn("尚未提交", result["error"])

    async def test_matching_reference_passes(self):
        result, _ = await self.check({"conflicts": []})
        self.assertIsNone(result)

    async def test_malformed_result_cannot_bypass_preflight(self):
        result, _ = await self.check({"conflicts": "none"})
        self.assertIn("未得到有效结果", result["error"])

    async def test_user_confirmation_is_included_and_rechecked(self):
        result, complete = await self.check({"conflicts": []}, inputs=[{
            "text": "参考图1是场景", "uploads": [{"id": "product"}]}, {
            "answer": "确认用白底作为背景", "uploads": []}])
        self.assertIsNone(result)
        content = complete.call_args.args[1]["messages"][0]["content"][0]["text"]
        self.assertIn("确认用白底作为背景", content)

    async def test_engine_suspends_without_another_planning_call(self):
        class Model:
            async def stream(self, messages, specs):
                yield "step", ModelStep(text="", tool_calls=[{
                    "id": "gen", "name": "generate_image", "arguments": "{}"}])

        async def generate(ctx, args):
            return {"error": "conflict", "clarification": {"question": "请确认第五张用途", "options": ["更正", "确认"]}}

        events = []

        async def emit(kind, payload):
            events.append((kind, payload))

        result = await run_loop(model=Model(), tools={
            "generate_image": Tool("generate_image", "gen", {}, generate)}, messages=[], emit=emit,
            ctx_base={"user": {"id": "u"}, "session_id": "s", "turn_id": "t", "state": {}})
        self.assertEqual(result.status, "waiting_user")
        self.assertEqual(result.pending["tool"], "ask_user")
        self.assertEqual(events[-1][0], "input.required")
        self.assertEqual(result.messages[-1]["tool_calls"][0]["id"], result.pending["call_id"])

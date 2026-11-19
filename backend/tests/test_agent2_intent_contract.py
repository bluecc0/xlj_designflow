import unittest
from types import SimpleNamespace
from unittest.mock import patch, AsyncMock

from backend.agent2.image_constraints import reference_order_error, requested_image_count, explicit_reference_roles
from backend.agent2.reference_preflight import check_reference_roles
from backend.agent2.engine import run_loop, Tool, ModelStep


class IntentContractTest(unittest.IsolatedAsyncioTestCase):
    def test_uploaded_order_precedes_skill_reference(self):
        inputs = [{"uploads": [{"id": "coat"}, {"id": "scene"}, {"id": "person"}]}]
        self.assertTrue(reference_order_error(inputs, ["person", "coat", "scene", "pose"], "reference image 1"))
        self.assertFalse(reference_order_error(inputs, ["coat", "scene", "person", "pose"], "参考图3是人物"))
        self.assertFalse(reference_order_error([], ["person", "coat"], "参考图1"))

    def test_quantity_only_recognizes_generation_request(self):
        self.assertEqual(requested_image_count("图片8是人物，生成4张，比例3:4，1K"), 4)
        self.assertEqual(requested_image_count("生成四张"), 4)
        self.assertIsNone(requested_image_count("第四张背景改一下"))

    def test_roles_bind_to_upload_numbers_not_mention_order(self):
        text = "@图片8 是儿童人物，@图片1 是羽绒上衣，@图片7 是场景图"
        self.assertEqual(explicit_reference_roles(text, 7), ["场景图"])
        self.assertEqual(explicit_reference_roles(text, 8), ["儿童人物"])
        self.assertEqual(explicit_reference_roles(text, 1), ["羽绒上衣"])

    async def test_unrelated_confirmation_does_not_skip_preflight(self):
        events = [{"turn_id": "t", "type": "input.required", "payload": {"call_id": "other"}},
                  {"turn_id": "t", "type": "input.answered", "payload": {"answer": "确认按原来指定的用途使用"}}]
        complete = AsyncMock(return_value=SimpleNamespace(json=lambda: {
            "choices": [{"message": {"content": '{"conflicts": []}'}}]}))
        with patch("backend.agent2.reference_preflight.store.list_events", return_value=events):
            result = await check_reference_roles(SimpleNamespace(state={}, session_id="s", turn_id="t"),
                [{"text": "图片1是场景", "uploads": [{"id": "scene"}]}],
                read_image=lambda *a: (b"image", "a.png"), encode_image=lambda *a: "data:a", complete=complete)
        self.assertIsNone(result)
        complete.assert_awaited_once()

    async def test_exact_preflight_confirmation_does_not_reask(self):
        events = [{"turn_id": "t", "type": "input.required", "payload": {"call_id": "clarify_123"}},
                  {"turn_id": "t", "type": "input.answered", "payload": {"answer": "确认按原来指定的用途使用"}}]
        complete = AsyncMock()
        with patch("backend.agent2.reference_preflight.store.list_events", return_value=events):
            result = await check_reference_roles(SimpleNamespace(state={}, session_id="s", turn_id="t"),
                [{"text": "图片1是场景", "uploads": [{"id": "scene"}]}],
                read_image=lambda *a: self.fail("should not reread"), encode_image=None, complete=complete)
        self.assertIsNone(result)
        complete.assert_not_awaited()

    async def test_short_batch_requires_user_decision_not_paid_resubmit(self):
        class Model:
            def __init__(self):
                self.count = 0

            async def stream(self, messages, tools):
                self.count += 1
                yield "step", (ModelStep(tool_calls=[{"id": "c", "name": "generate_image", "arguments": "{}"}])
                               if self.count == 1 else ModelStep(text="已生成三张。"))

        generate = AsyncMock(return_value={"images": [{"id": "a"}, {"id": "b"}, {"id": "c"}]})
        emit = AsyncMock()
        result = await run_loop(model=Model(), tools={"generate_image": Tool("generate_image", "gen", {}, generate)},
            messages=[{"role": "user", "content": "生成4张"}], emit=emit,
            ctx_base={"user": {"id": "u"}, "session_id": "s", "turn_id": "t", "state": {}})
        self.assertEqual(result.status, "waiting_user")
        self.assertIn("实际只生成3张", result.pending["question"])
        generate.assert_awaited_once()

import asyncio
import unittest
from backend.agent2.engine import run_loop
from backend.tests.test_agent2_engine import FakeModel


class QualityRepairTest(unittest.TestCase):
    def run_case(self, state, steps):
        events = []

        async def emit(kind, payload):
            events.append((kind, payload))

        model = FakeModel(steps)
        result = asyncio.run(run_loop(model=model, tools={},
            messages=[{"role": "user", "content": "检查这些已有图片"}],
            ctx_base={"state": state}, emit=emit))
        return result, model, events

    def test_visual_judgement_does_not_force_paid_correction(self):
        state = {"skill_repair_limit": 2, "quality_failures": {"img_bad": "场景不符合"}}
        result, model, events = self.run_case(state,
            [[("text", "建议修复")], [("text", "仍未执行")], [("text", "未能完成，保留问题说明")]])
        self.assertEqual(len(model.seen), 1)
        self.assertNotIn("quality_repair_round", state)

    def test_no_paid_repair_without_skill_permission(self):
        _, model, _ = self.run_case({"quality_failures": {"img_bad": "不符合"}},
                                   [[("text", "是否修复？")]])
        self.assertEqual(len(model.seen), 1)

    def test_exhausted_budget_never_retries(self):
        for state in [
            {"skill_repair_limit": 2, "quality_repair_round": 2},
            {"skill_repair_limit": 2, "images": 12},
        ]:
            _, model, _ = self.run_case({**state, "quality_failures": {"x": "不符合"}},
                                       [[("text", "如实报告剩余问题")]])
            self.assertEqual(len(model.seen), 1)

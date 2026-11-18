import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from backend.agent2 import tools


class ReferenceBindingTest(unittest.IsolatedAsyncioTestCase):
    def context(self):
        return SimpleNamespace(user={"id": "u"}, session_id="s", turn_id="t", state={})

    async def test_missing_current_scene_stops_before_paid_call(self):
        ctx = self.context()
        events = [{"turn_id": "t", "type": "turn.started", "payload": {
            "text": "场景按照参考图1，人物不变", "uploads": [{"id": "new-scene", "kind": "upload"}]}}]
        with patch.object(tools.store, "list_events", return_value=events), \
             patch.object(tools, "_generate_one", AsyncMock()) as generate:
            result = await tools.generate_image(ctx, {"images": [
                {"prompt": "test", "reference_image_ids": ["old-scene"]}]})
        self.assertIn("new-scene", result["error"])
        generate.assert_not_called()
        self.assertEqual(ctx.state["images"], 0)

    async def test_role_cannot_name_unsent_reference(self):
        with patch.object(tools, "_generate_one", AsyncMock()) as generate:
            result = await tools.generate_image(self.context(), {"images": [{"prompt": "test",
                "reference_image_ids": ["shoe"], "reference_roles": {"scene": "场景"}}]})
        self.assertIn("reference_roles", result["error"])
        generate.assert_not_called()

    async def test_single_explicit_reference_required_for_each_output(self):
        events = [{"turn_id": "t", "type": "turn.started", "payload": {
            "text": "场景按照参考图1", "uploads": [{"id": "scene", "kind": "upload"}]}}]
        with patch.object(tools.store, "list_events", return_value=events), \
             patch.object(tools, "_generate_one", AsyncMock()) as generate:
            result = await tools.generate_image(self.context(), {"images": [
                {"prompt": "one", "reference_image_ids": ["scene"]},
                {"prompt": "two", "reference_image_ids": ["old"]}]})
        self.assertIn("每张输出", result["error"])
        generate.assert_not_called()

    async def test_analysis_receives_result_and_reference(self):
        response = SimpleNamespace(json=lambda: {"choices": [{"message": {"content": "checked"}}]})
        with patch.object(tools, "_artifact_bytes", return_value=(b"image", "a.png")), \
             patch.object(tools, "compress_image_to_data_url", return_value="data:image/png;base64,a"), \
             patch.object(tools, "routed_chat_completion", AsyncMock(return_value=response)) as model:
            await tools.analyze_image(self.context(), {"image_id": "result", "reference_image_ids": ["scene"]})
        content = model.call_args.args[1]["messages"][0]["content"]
        self.assertEqual(sum(x["type"] == "image_url" for x in content), 2)

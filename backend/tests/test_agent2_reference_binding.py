import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from backend.agent2 import tools
from backend.agent2.image_constraints import explicit_models, numbered_references


class ReferenceBindingTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        for name, value in [('list_events', []), ('get_artifact', None), ('turn_characters', [])]:
            patcher = patch.object(tools.store, name, return_value=value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_explicit_model_aliases_and_comparison(self):
        self.assertEqual(explicit_models("调用Nano Banana Pr模型，1K"), {"nano-banana-pro"})
        self.assertEqual(explicit_models("GPT Image 2.5"), {"gpt-image-2.5"})
        self.assertEqual(explicit_models("Nano Banana 2.1"), {"nano-banana-2.1"})
        self.assertEqual(explicit_models("即梦"), {"seedream-5-5"})
        self.assertEqual(explicit_models("Nano Banana Pro和GPT Image 2.6各一张"),
                         {"nano-banana-pro", "gpt-image-2.6"})

    def test_numbered_aliases(self):
        uploads = [{"id": "person"}, {"id": "scene"}, {"id": "shoe"}]
        self.assertEqual(numbered_references("@1 人物，图二场景，图片3鞋子", uploads),
                         {"person", "scene", "shoe"})

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

    async def test_retry_keeps_model_after_skill_reference_rejection(self):
        ctx = self.context()
        ctx.state.update(skill_ref_attempted=True, skill_refs=["action"])
        with patch.object(tools.store, "list_events", return_value=[]), \
             patch.object(tools.store, "turn_characters", return_value=[]), \
             patch.object(tools, "_generate_one", AsyncMock(return_value={"id": "out"})) as generate:
            first = await tools.generate_image(ctx, {"images": [{"prompt": "test", "model": "nano-banana-pro"}]})
            self.assertIn("error", first)
            await tools.generate_image(ctx, {"images": [{"prompt": "test", "reference_image_ids": ["action"]}]})
        self.assertEqual(generate.call_args.kwargs["model"], "nano-banana-pro")
        self.assertEqual(ctx.state["images"], 1)

    async def test_user_model_cannot_be_changed(self):
        events = [{"turn_id": "t", "type": "turn.started", "payload": {"text": "调用Nano Banana Pro模型，1K"}}]
        with patch.object(tools.store, "list_events", return_value=events), \
             patch.object(tools, "_generate_one", AsyncMock()) as generate:
            result = await tools.generate_image(self.context(), {"model": "gpt-image-2.6", "images": [{"prompt": "test"}]})
        self.assertIn("用户指定", result["error"])
        generate.assert_not_called()

    async def test_skill_batch_cannot_cover_references_only_in_union(self):
        ctx = self.context()
        ctx.state.update(skill_ref_attempted=True, skill_refs=["action"])
        events = [{"turn_id": "t", "type": "turn.started", "payload": {
            "text": "@1 人物，图二 场景", "uploads": [{"id": "person"}, {"id": "scene"}]}}]
        with patch.object(tools.store, "list_events", return_value=events), \
             patch.object(tools, "_generate_one", AsyncMock()) as generate:
            result = await tools.generate_image(ctx, {"images": [
                {"prompt": "one", "reference_image_ids": ["person", "action"]},
                {"prompt": "two", "reference_image_ids": ["scene", "action"]}]})
        self.assertIn("每张输出", result["error"])
        generate.assert_not_called()

    async def test_duplicates_stop_before_paid_call(self):
        with patch.object(tools.store, "list_events", return_value=[]), \
             patch.object(tools, "_generate_one", AsyncMock()) as generate:
            result = await tools.generate_image(self.context(), {"images": [
                {"prompt": "test", "reference_image_ids": ["pants", "pants"]}]})
        self.assertIn("重复", result["error"])
        generate.assert_not_called()

    async def test_generated_result_automatically_receives_source_references(self):
        response = SimpleNamespace(json=lambda: {"choices": [{"message": {"content": "checked"}}]})
        artifact = {"source_tool_call_id": "call", "meta_json": '{"reference_image_ids": ["scene", "person"]}'}
        with patch.object(tools.store, "get_artifact", return_value=artifact), \
             patch.object(tools, "_artifact_bytes", return_value=(b"image", "a.png")), \
             patch.object(tools, "compress_image_to_data_url", return_value="data:image/png;base64,a"), \
             patch.object(tools, "routed_chat_completion", AsyncMock(return_value=response)) as model:
            result = await tools.analyze_image(self.context(), {"image_id": "result"})
        self.assertEqual(result["reference_image_ids"], ["scene", "person"])
        self.assertEqual(result["verification_scope"], "reference_comparison")
        content = model.call_args.args[1]["messages"][0]["content"]
        self.assertEqual(sum(x["type"] == "image_url" for x in content), 3)

    async def test_distinct_models_remain_valid(self):
        with patch.object(tools.store, "list_events", return_value=[]), \
             patch.object(tools.store, "turn_characters", return_value=[]), \
             patch.object(tools, "_generate_one", AsyncMock(return_value={"id": "out"})) as generate:
            result = await tools.generate_image(self.context(), {"images": [
                {"prompt": "one", "model": "nano-banana-pro"},
                {"prompt": "two", "model": "gpt-image-2.6"}]})
        self.assertNotIn("error", result)
        self.assertEqual([call.kwargs["model"] for call in generate.call_args_list],
                         ["nano-banana-pro", "gpt-image-2.6"])

    async def test_reference_limit_without_character_card(self):
        with patch.object(tools.store, "list_events", return_value=[]), \
             patch.object(tools, "_generate_one", AsyncMock()) as generate:
            result = await tools.generate_image(self.context(), {"images": [
                {"prompt": "test", "reference_image_ids": [str(i) for i in range(10)]}]})
        self.assertIn("最多 9", result["error"])
        generate.assert_not_called()

    async def test_nonexistent_number_is_rejected(self):
        with patch.object(tools.store, "list_events", return_value=[]), \
             patch.object(tools, "_generate_one", AsyncMock()) as generate:
            result = await tools.generate_image(self.context(), {"images": [
                {"prompt": "参考图7是动作", "reference_image_ids": ["scene"]}]})
        self.assertIn("不存在", result["error"])
        generate.assert_not_called()

    async def test_single_image_analysis_does_not_claim_comparison(self):
        response = SimpleNamespace(json=lambda: {"choices": [{"message": {"content": "clear"}}]})
        with patch.object(tools.store, "get_artifact", return_value=None), \
             patch.object(tools, "_artifact_bytes", return_value=(b"image", "a.png")), \
             patch.object(tools, "compress_image_to_data_url", return_value="data:image/png;base64,a"), \
             patch.object(tools, "routed_chat_completion", AsyncMock(return_value=response)):
            result = await tools.analyze_image(self.context(), {"image_id": "input"})
        self.assertEqual(result["verification_scope"], "single_image_only")

    async def test_preflight_conflict_never_submits_generation(self):
        ctx = self.context()
        conflict = {"error": "用途冲突", "clarification": {"question": "这是白底商品，确实作场景吗？"}}
        with patch.object(tools.store, "list_events", return_value=[]), \
             patch.object(tools.store, "turn_characters", return_value=[]), \
             patch.object(tools, "check_reference_roles", AsyncMock(return_value=conflict)), \
             patch.object(tools, "_generate_one", AsyncMock()) as generate:
            result = await tools.generate_image(ctx, {"images": [{"prompt": "test"}]})
        self.assertIn("clarification", result)
        self.assertEqual(ctx.state["images"], 0)
        generate.assert_not_called()

from __future__ import annotations

import unittest

from backend.agent_mode import (
    VisualIntentPatch,
    _match_prompt_scene,
    apply_intent_patch_to_state,
    build_generation_prompt,
    build_refine_prompt,
    calculate_operation_readiness,
    default_project_state,
    decide_next_action,
    extract_message_constraints,
)


class AgentModeRegressionTest(unittest.TestCase):
    def test_create_new_resets_stale_state_but_keeps_reference_context(self) -> None:
        state = default_project_state()
        state["intent"]["subject"] = "女性人像封面"
        state["brief"] = {"concept": "旧方向"}
        state["currentPrompt"] = {"instruction": "old"}
        state["currentImage"] = {"id": "img1", "imageUrl": "/ai-images/u/a.png"}
        state["metadata"]["referenceContext"] = {"count": 2, "summary": "保留参考图"}

        updated = apply_intent_patch_to_state(
            state,
            VisualIntentPatch(turn_type="create_new", patch={"subject": "汽车发售海报", "aspectRatio": "9:16"}),
        )

        self.assertEqual(updated["intent"]["subject"], "汽车发售海报")
        self.assertIsNone(updated["brief"])
        self.assertIsNone(updated["currentImage"])
        self.assertEqual((updated["metadata"].get("referenceContext") or {}).get("count"), 2)

    def test_automotive_prompt_uses_automotive_scene_not_portrait_cover(self) -> None:
        state = default_project_state()
        state["intent"].update(
            {
                "subject": "汽车",
                "scene": "公路场景",
                "platform": "小红书 / 抖音",
                "targetAudience": "年轻人",
                "useCase": "发售海报",
                "composition": "竖版构图，留白构图",
                "camera": "低机位广角",
                "aspectRatio": "9:16",
                "style": "电影感大片风格",
                "mood": "动感，临场感",
                "colorPalette": "黄昏夕阳下的温暖金色调",
                "copyText": "未来已来",
                "mustInclude": "整车主体，标题区留白",
                "avoid": "人物抢主体，杂乱背景",
            }
        )

        scene = _match_prompt_scene(state["intent"])
        payload = build_generation_prompt(state)

        self.assertEqual(scene["name"], "汽车发售海报")
        self.assertIn("vehicle as the unmistakable main subject", payload["instruction"])
        self.assertNotIn("premium editorial portrait poster", payload["instruction"])
        self.assertEqual(payload["constraints"]["mustInclude"], ["整车主体", "标题区留白"])

    def test_refine_requires_current_image_before_variation(self) -> None:
        state = default_project_state()
        patch = VisualIntentPatch(turn_type="revise_image", operation_hint="variation", change=["背景改成海边"])

        readiness = calculate_operation_readiness(state, patch)
        decision = decide_next_action(state, patch, "背景改成海边")

        self.assertFalse(readiness.executable)
        self.assertEqual(readiness.missing_requirements, ["current_image"])
        self.assertEqual(decision["type"], "ASK")
        self.assertEqual(decision["operationReadiness"]["required_capability"], "variation")

    def test_refine_prompt_preserves_structured_edit_intent(self) -> None:
        state = default_project_state()
        state["intent"].update({"subject": "汽车", "aspectRatio": "9:16"})
        state["currentPrompt"] = build_generation_prompt(state)
        state["currentImage"] = {"id": "img2", "imageUrl": "/ai-images/u/a.png"}
        state["metadata"]["pendingEdit"] = {
            "operationHint": "variation",
            "targetRegion": "background",
            "preserve": ["车身主体"],
            "change": ["背景更有速度线"],
            "avoid": ["人物抢主体"],
        }

        prompt = build_refine_prompt(state, "背景更有速度线")

        self.assertEqual(prompt["mode"], "variation")
        self.assertEqual(prompt["constraints"]["preserve"], ["车身主体"])
        self.assertEqual(prompt["constraints"]["mustInclude"], ["背景更有速度线"])
        self.assertEqual(prompt["constraints"]["avoid"], ["人物抢主体"])
        self.assertIn("Focus on background", prompt["instruction"])

    def test_message_constraint_extraction_is_less_biased(self) -> None:
        automotive = extract_message_constraints(
            '我想做一张新款汽车发售海报，9:16，竖版构图，公路场景，电影感，文案“未来已来”，不要人物抢主体，要有整车主体和标题区留白'
        )
        portrait = extract_message_constraints(
            "做一张小红书女性人物封面，3:4，简约高级，留白构图，避免太商业"
        )

        self.assertEqual(automotive.get("subject"), "汽车")
        self.assertEqual(automotive.get("scene"), "公路场景")
        self.assertEqual(automotive.get("avoid"), "人物抢主体")
        self.assertEqual(portrait.get("subject"), "人物")
        self.assertEqual(portrait.get("platform"), "小红书")
        self.assertEqual(portrait.get("avoid"), "太商业")

    def test_confirm_path_carries_operation_readiness(self) -> None:
        state = default_project_state()
        patch = VisualIntentPatch(
            turn_type="add_detail",
            operation_hint="text_to_image",
            patch={"subject": "女性人物封面", "platform": "小红书", "aspectRatio": "3:4", "style": "简约高级"},
        )
        state = apply_intent_patch_to_state(state, patch)

        decision = decide_next_action(state, patch, "我想做一张小红书女性封面")

        self.assertEqual(decision["type"], "CONFIRM")
        self.assertIn("operationReadiness", decision)
        self.assertEqual(decision["operationReadiness"]["required_capability"], "text_to_image")


if __name__ == "__main__":
    unittest.main()

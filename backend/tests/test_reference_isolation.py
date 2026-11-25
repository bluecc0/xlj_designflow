import io
import unittest
import asyncio
from types import SimpleNamespace
from unittest.mock import patch
from PIL import Image
from backend.agent2.reference_isolation import action_only, isolate_action, inspection_failed, excludes_action_scene


class IsolationTest(unittest.TestCase):
    def test_script_alias_only_resolves_declared_whitelist_entries(self):
        from backend.agent2 import tools
        for script, expected in [('scripts.build_prompt_context.py', 'scripts/build_prompt_context.py'),
                                 ('scripts.unapproved.py', 'scripts.unapproved.py')]:
            with self.subTest(script=script), \
                 patch.object(tools, '_load_skill', return_value=SimpleNamespace(name='kids-lookbook', scope='user')), \
                 patch.object(tools, 'allowed_scripts', return_value=['scripts/build_prompt_context.py']), \
                 patch.object(tools, '_run_skill_script', return_value={}) as execute:
                asyncio.run(tools.run_skill_script(None, {'script': script, 'args': []}))
                self.assertEqual(execute.call_args.args[1], expected)

    def test_user_exclusion_survives_abbreviated_model_roles(self):
        self.assertTrue(excludes_action_scene("不要提取动作包中的人物场景以及人物外貌特征。"))
        self.assertFalse(excludes_action_scene("人物和场景都参考动作包"))

    def test_multiple_short_action_ids_are_not_silently_overwritten(self):
        from backend.agent2 import tools
        calls = []

        def execute(skill, script, args, text):
            calls.append(args)
            return {"exit_code": 0, "output": "match"}

        with patch.object(tools, "_load_skill", return_value=SimpleNamespace(name="kids-lookbook", scope="user")), \
             patch.object(tools, "_run_skill_script", side_effect=execute):
            result = asyncio.run(tools.run_skill_script(None, {"name": "kids-lookbook",
                "script": "scripts/query_action_packs.py", "args": ["--people", "单人",
                "--id", "0125", "--id", "0059", "--id", "0057", "--id", "0400"]}))
        self.assertEqual(len(result["queries"]), 4)
        self.assertEqual({args[-1] for args in calls}, {"0125", "0059", "0057", "0400"})
        self.assertTrue(all(args.count("--asset-id") == 1 for args in calls))

    def test_inspection_requires_actual_negative_verdict(self):
        self.assertTrue(inspection_failed("- **场景：不符合。** 使用了动作图背景"))
        self.assertFalse(inspection_failed("场景：符合；没有发现不符合项"))

    def test_role_is_explicit(self):
        self.assertTrue(action_only("仅动作、构图，不取背景"))
        self.assertFalse(action_only("场景和光影"))
        self.assertFalse(action_only("动作与背景，不要服装"))
        self.assertTrue(action_only("动作表情构图，不取背景和外貌"))
        self.assertTrue(action_only("动作0059，不取人物外观、帽子、衣服、背景或光影"))

    def test_canvas_is_preserved_and_background_removed(self):
        image = Image.new("RGB", (100, 150), "red")
        stream = io.BytesIO()
        image.save(stream, "PNG")

        def extract(source):
            result = Image.new("RGBA", source.size, (0, 0, 0, 0))
            result.paste((0, 0, 255, 255), (25, 40, 75, 140))
            return result

        result = Image.open(io.BytesIO(isolate_action(stream.getvalue(), extract)))
        self.assertEqual(result.size, image.size)
        self.assertEqual(result.getpixel((0, 0)), (235, 235, 235))
        self.assertEqual(result.getpixel((50, 80)), (0, 0, 255))

    def test_failed_segmentation_is_not_silently_used(self):
        stream = io.BytesIO()
        Image.new("RGB", (50, 50)).save(stream, "PNG")
        with self.assertRaises(ValueError):
            isolate_action(stream.getvalue(), lambda image: image.convert("RGBA"))


if __name__ == "__main__":
    unittest.main()

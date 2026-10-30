from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import main


def _write_skill(root: Path, name: str, frontmatter_extra: str = "") -> None:
    skill_dir = root / name
    (skill_dir / "references").mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: test skill\n{frontmatter_extra}---\n\n# {name} body\n",
        encoding="utf-8",
    )
    (skill_dir / "references" / "image-guide.md").write_text("IMAGE GUIDE", encoding="utf-8")
    (skill_dir / "references" / "other.md").write_text("OTHER DOC", encoding="utf-8")


class SkillReferenceDeclarationTest(unittest.TestCase):
    def _load(self, root: Path, name: str, has_reference_image: bool) -> str:
        with patch.multiple(main.settings, agent_skill_paths=str(root), root_dir=root):
            context, _meta = main._load_active_skill_context(name, has_reference_image=has_reference_image)
        return context

    def test_declared_references_load_only_with_reference_image(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_skill(root, "declared", "references_with_image:\n  - references/image-guide.md\n")
            with_image = self._load(root, "declared", True)
            without_image = self._load(root, "declared", False)
        self.assertIn("IMAGE GUIDE", with_image)
        self.assertNotIn("OTHER DOC", with_image)
        self.assertNotIn("IMAGE GUIDE", without_image)

    def test_undeclared_skill_with_reference_image_loads_only_skill_md(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_skill(root, "plain")
            context = self._load(root, "plain", True)
        self.assertIn("plain body", context)
        self.assertNotIn("IMAGE GUIDE", context)
        self.assertNotIn("OTHER DOC", context)


class SkillPlannerGenericTest(unittest.TestCase):
    def test_fallback_uses_original_prompt_and_reports_skill_not_applied(self) -> None:
        final_prompt, trace = main._fallback_skill_plan("白底产品主图", "ecommerce-main")
        self.assertEqual(final_prompt, "白底产品主图")
        self.assertEqual(trace["mode"], "fallback")
        self.assertIn("未生效", trace["steps"][0])
        self.assertNotIn("艺术字", str(trace))

    def test_planner_prompt_has_no_skill_specific_rules(self) -> None:
        prompt = main._build_skill_planner_prompt("白底产品主图", "ecommerce-main", "skill body", has_reference=True)
        for word in ("艺术字", "字形", "笔画", "reference-image-analysis"):
            self.assertNotIn(word, prompt)
        self.assertIn("[用户已上传参考图]", prompt)


if __name__ == "__main__":
    unittest.main()

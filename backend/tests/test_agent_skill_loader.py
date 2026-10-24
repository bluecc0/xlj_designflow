from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.agent_skill_loader import list_agent_skills


def _write_skill(root: Path, folder: str, frontmatter: str) -> None:
    skill_dir = root / folder
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text("---\n" + frontmatter + "\n---\n\n# Body\n", encoding="utf-8")


class AgentSkillListTest(unittest.TestCase):
    def test_lists_display_title_and_summary(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_skill(root, "text-art", "name: text-art\ntitle: 中文艺术字\nsummary: 标题字与海报字效\ndescription: Long model-facing text")
            skills = list_agent_skills(str(root), root)
        self.assertEqual(len(skills), 1)
        self.assertEqual(skills[0]["title"], "中文艺术字")
        self.assertEqual(skills[0]["summary"], "标题字与海报字效")

    def test_summary_defaults_to_empty_and_title_to_name(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_skill(root, "plain", "name: plain\ndescription: Only a description")
            skills = list_agent_skills(str(root), root)
        self.assertEqual(skills[0]["title"], "plain")
        self.assertEqual(skills[0]["summary"], "")


if __name__ == "__main__":
    unittest.main()

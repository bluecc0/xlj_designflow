from __future__ import annotations

import io
import tempfile
import unittest
import zipfile
from pathlib import Path

from backend.agent_skill_loader import list_agent_skills, load_agent_skill
from backend.user_skill_store import (
    SkillUploadError,
    delete_user_skill,
    install_user_skill,
    list_all_user_skills,
    read_user_skill_detail,
    user_skill_dir,
)


SKILL_MD = "---\nname: poster-main\ntitle: 电商主图\ndescription: 白底主图规则\n---\n\n# 主图规则\n"


def _zip(files: dict[str, bytes | str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as archive:
        for name, content in files.items():
            archive.writestr(name, content.encode("utf-8") if isinstance(content, str) else content)
    return buf.getvalue()


class UserSkillStoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.system = self.root / "skills"
        self.system.mkdir()
        self.base = self.root / "user-skills"
        self.alice = user_skill_dir(self.base, "alice")
        self.bob = user_skill_dir(self.base, "bob")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _install(self, data: bytes, filename: str = "skill.zip", user_dir: Path | None = None, **kwargs):
        uploader = {"id": "bob" if user_dir == self.bob else "alice", "username": "测试"}
        return install_user_skill(data, filename, user_dir or self.alice, system_skills={"text-art-design": "中文艺术字"}, uploader=uploader, **kwargs)

    def test_zip_with_wrapper_folder_and_mac_junk_installs(self) -> None:
        name, warnings = self._install(_zip({
            "poster/SKILL.md": SKILL_MD,
            "poster/references/a.md": "参考",
            "__MACOSX/poster/._SKILL.md": b"junk",
            "poster/.DS_Store": b"junk",
        }))
        self.assertEqual(name, "poster-main")
        self.assertEqual(warnings, [])
        self.assertTrue((self.alice / "poster-main" / "SKILL.md").exists())
        self.assertTrue((self.alice / "poster-main" / "references" / "a.md").exists())
        self.assertFalse((self.alice / "poster-main" / ".DS_Store").exists())

    def test_single_md_with_bom_gbk_and_block_description(self) -> None:
        text = "﻿---\nname: 主图规范\ndescription: >\n  第一行\n  第二行\n---\n\n正文\n"
        name, _ = self._install(text.encode("utf-8"), "SKILL.md")
        skill = load_agent_skill(str(self.system), self.root, name, self.alice)
        self.assertIsNotNone(skill)
        self.assertEqual(skill.title, "主图规范")
        self.assertEqual(skill.description, "第一行 第二行")
        gbk_name, _ = self._install("---\nname: gbk-skill\ndescription: 中文描述\n---\n".encode("gbk"), "SKILL.md")
        self.assertEqual(load_agent_skill(str(self.system), self.root, gbk_name, self.alice).description, "中文描述")

    def test_users_are_isolated(self) -> None:
        self._install(_zip({"SKILL.md": SKILL_MD}))
        alice_names = [s["name"] for s in list_agent_skills(str(self.system), self.root, self.alice)]
        bob_names = [s["name"] for s in list_agent_skills(str(self.system), self.root, self.bob)]
        self.assertIn("poster-main", alice_names)
        self.assertNotIn("poster-main", bob_names)
        self.assertIsNone(load_agent_skill(str(self.system), self.root, "poster-main", self.bob))
        self.assertFalse(delete_user_skill(self.bob, "poster-main"))

    def test_rejections(self) -> None:
        cases = {
            "缺少 SKILL.md": _zip({"README.md": "x"}),
            "多个 SKILL.md": _zip({"a/SKILL.md": SKILL_MD, "b/SKILL.md": SKILL_MD}),
            "不安全的路径": _zip({"../SKILL.md": SKILL_MD}),
            "Windows 盘符绝对路径": _zip({"SKILL.md": SKILL_MD, "C:/Users/Public/outside.txt": "x"}),
            "Windows 盘符反斜杠路径": _zip({"SKILL.md": SKILL_MD, "C:\\Windows\\outside.md": "x"}),
            "Windows 盘符相对路径": _zip({"SKILL.md": SKILL_MD, "C:outside.txt": "x"}),
            "UNC 路径": _zip({"SKILL.md": SKILL_MD, "//server/share/outside.txt": "x"}),
            "系统技能": _zip({"SKILL.md": SKILL_MD.replace("poster-main", "text-art-design")}),
            "缺少 description": _zip({"SKILL.md": "---\nname: a\n---\n"}),
        }
        for label, data in cases.items():
            with self.subTest(label), self.assertRaises(SkillUploadError):
                self._install(data)
        with self.assertRaises(SkillUploadError):
            self._install(b"x", "skill.rar")

    def test_write_guard_rejects_targets_outside_staging_dir(self) -> None:
        from backend.user_skill_store import _safe_target
        tmp = self.root / "staging"
        tmp.mkdir()
        self.assertEqual(_safe_target(tmp, "refs/a.md"), (tmp / "refs" / "a.md").resolve())
        for rel in ["../outside.md", str(self.root / "outside.md"), "."]:
            with self.subTest(rel), self.assertRaises(SkillUploadError):
                _safe_target(tmp, rel)
        self.assertFalse((self.root / "outside.md").exists())

    def test_same_name_requires_overwrite(self) -> None:
        self._install(_zip({"SKILL.md": SKILL_MD}))
        with self.assertRaises(SkillUploadError) as ctx:
            self._install(_zip({"SKILL.md": SKILL_MD}))
        self.assertEqual(ctx.exception.status_code, 409)
        self._install(_zip({"SKILL.md": SKILL_MD.replace("主图规则", "新规则")}), overwrite=True)
        self.assertIn("新规则", (self.alice / "poster-main" / "SKILL.md").read_text(encoding="utf-8"))
        self.assertEqual([p.name for p in self.alice.iterdir()], ["poster-main"])

    def test_standard_skill_with_scripts_passes_and_skips_non_text(self) -> None:
        name, warnings = self._install(_zip({
            "pdf/SKILL.md": SKILL_MD,
            "pdf/scripts/run.py": "print(1)",
            "pdf/assets/logo.png": b"\x89PNG",
            "pdf/LICENSE.txt": "MIT",
        }))
        skill_dir = self.alice / name
        self.assertTrue((skill_dir / "LICENSE.txt").exists())
        self.assertFalse((skill_dir / "scripts").exists())
        self.assertFalse((skill_dir / "assets").exists())
        self.assertTrue(any("已跳过" in w for w in warnings))

    def test_overlong_content_warns_instead_of_rejecting(self) -> None:
        _, warnings = self._install(_zip({"SKILL.md": SKILL_MD + "字" * 30000}))
        self.assertTrue(any("不会被使用" in w for w in warnings))

    def test_admin_listing_and_detail_show_upload_record(self) -> None:
        self._install(_zip({"poster/SKILL.md": SKILL_MD, "poster/run.sh": "echo"}), filename="poster.zip")
        self._install(_zip({"SKILL.md": SKILL_MD}), user_dir=self.bob)
        items = list_all_user_skills(self.base)
        self.assertEqual(sorted(item["user_id"] for item in items), ["alice", "bob"])
        alice_item = next(item for item in items if item["user_id"] == "alice")
        self.assertEqual(alice_item["title"], "电商主图")
        self.assertEqual(alice_item["original_filename"], "poster.zip")
        self.assertEqual(alice_item["skipped_files"], ["run.sh"])
        self.assertEqual(alice_item["file_count"], 1)
        detail = read_user_skill_detail(self.alice, "poster-main")
        self.assertEqual([f["path"] for f in detail["files"]], ["SKILL.md"])
        self.assertIn("主图规则", detail["files"][0]["content"])
        self.assertEqual(detail["manifest"]["username"], "测试")
        self.assertIsNone(read_user_skill_detail(self.alice, "../bob"))

    def test_script_mention_warns_and_delete_removes(self) -> None:
        _, warnings = self._install(_zip({"SKILL.md": SKILL_MD + "\n运行 scripts/fill.py\n"}))
        self.assertTrue(any("脚本" in w for w in warnings))
        self.assertTrue(delete_user_skill(self.alice, "poster-main"))
        self.assertFalse((self.alice / "poster-main").exists())


if __name__ == "__main__":
    unittest.main()

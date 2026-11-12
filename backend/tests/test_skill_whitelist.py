from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from backend import skill_whitelist
from backend.agent_skill_loader import load_agent_skill
from backend.agent2.tools import SKILL_PLATFORM_NOTE, _whitelisted_platform_note

QUERY_SCRIPT = '''
import sys
from pathlib import Path
root = Path(__file__).resolve().parent.parent
print("参数：" + " ".join(sys.argv[1:]))
print("参考：" + str(root / "assets" / "0007.jpg"))
'''

# 含 GBK 编不了的字符（𠮷、✓、é），Windows 下子进程按 GBK 输出时会乱码或直接报错
UNICODE_SCRIPT = '''
import sys
from pathlib import Path
root = Path(__file__).resolve().parent.parent
print("分类：单人/全身 童装 𠮷 ✓ é")
print("参考：" + str(root / "assets" / "单人" / "全身" / "0007.jpg"))
print("错误：标签 𠮷 ✓ é", file=sys.stderr)
sys.exit(1 if "--fail" in sys.argv else 0)
'''

CHECK_SCRIPT = '''
import sys
text = open(sys.argv[sys.argv.index("--check") + 1], encoding="utf-8").read()
if "street" in text:
    print("最终提示词含原场景词：street")
    sys.exit(1)
print("通过")
'''


class SkillWhitelistTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.skills_dir = root / "skills"
        skill = self.skills_dir / "lookbook"
        (skill / "scripts").mkdir(parents=True)
        (skill / "assets").mkdir()
        (skill / "SKILL.md").write_text("---\nname: lookbook\ndescription: test\n---\n正文", encoding="utf-8")
        (skill / "scripts" / "query.py").write_text(QUERY_SCRIPT, encoding="utf-8")
        (skill / "scripts" / "check.py").write_text(CHECK_SCRIPT, encoding="utf-8")
        (skill / "scripts" / "unicode.py").write_text(UNICODE_SCRIPT, encoding="utf-8")
        (skill / "scripts" / "rebuild.py").write_text("print('should not run')", encoding="utf-8")
        (skill / "scripts" / "slow.py").write_text("import time\ntime.sleep(5)", encoding="utf-8")
        self.whitelist = root / "skill_whitelist.json"
        self.write_whitelist({"lookbook": {
            "scripts": ["scripts/query.py", "/scripts/check.py", "scripts/slow.py", "scripts/unicode.py"],
            "self_check": {"enabled": True, "max_repairs": 2},
        }})
        self.env = patch.dict(os.environ, {"SKILL_WHITELIST_PATH": str(self.whitelist)})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.addCleanup(self.tmp.cleanup)
        self.skill = load_agent_skill(str(self.skills_dir), root, "lookbook")

    def write_whitelist(self, skills: dict) -> None:
        self.whitelist.write_text(json.dumps({"skills": skills}, ensure_ascii=False), encoding="utf-8")

    def test_declared_script_runs_with_args_and_paths_become_relative(self) -> None:
        result = skill_whitelist.run_skill_script(self.skill, "scripts/query.py", ["--people", "单人", "a b"])
        self.assertEqual(result["exit_code"], 0)
        self.assertIn("参数：--people 单人 a b", result["output"])
        # Windows 下相对路径用反斜杠，两种分隔符都能直接交给 use_skill_image
        self.assertIn("参考：assets/0007.jpg", result["output"].replace("\\", "/"))
        self.assertNotIn(self.tmp.name, result["output"])
        # 不往技能目录写缓存
        self.assertFalse((self.skills_dir / "lookbook" / "scripts" / "__pycache__").exists())

    def test_chinese_and_non_gbk_text_round_trip_in_stdout_stderr_and_paths(self) -> None:
        ok = skill_whitelist.run_skill_script(self.skill, "scripts/unicode.py")
        self.assertEqual(ok["exit_code"], 0)
        self.assertIn("分类：单人/全身 童装 𠮷 ✓ é", ok["output"])
        self.assertIn("参考：assets/单人/全身/0007.jpg", ok["output"].replace("\\", "/"))
        self.assertNotIn("\ufffd", ok["output"])
        failed = skill_whitelist.run_skill_script(self.skill, "scripts/unicode.py", ["--fail"])
        self.assertEqual(failed["exit_code"], 1)
        self.assertIn("错误：标签 𠮷 ✓ é", failed["output"])
        self.assertNotIn("\ufffd", failed["output"])

    def test_interpreter_is_forced_into_utf8_mode(self) -> None:
        # -E 会忽略 PYTHONIOENCODING / PYTHONUTF8，只能靠 -X utf8 保证 Windows 下输出 UTF-8
        with patch.object(skill_whitelist.subprocess, "run", wraps=subprocess.run) as run:
            skill_whitelist.run_skill_script(self.skill, "scripts/query.py")
        argv = run.call_args.args[0]
        self.assertEqual(argv[1:4], ["-E", "-X", "utf8"])

    def test_input_text_is_passed_as_file_and_failures_are_reported(self) -> None:
        ok = skill_whitelist.run_skill_script(self.skill, "scripts/check.py", ["--check", "{input_file}"], "a quiet park")
        self.assertEqual((ok["exit_code"], ok["output"]), (0, "通过"))
        bad = skill_whitelist.run_skill_script(self.skill, "scripts/check.py", ["--check", "{input_file}"], "a busy street")
        self.assertEqual(bad["exit_code"], 1)
        self.assertIn("street", bad["output"])
        self.assertIn("error", skill_whitelist.run_skill_script(self.skill, "scripts/check.py", ["--check", "{input_file}"]))

    def test_only_declared_scripts_of_whitelisted_system_skills_run(self) -> None:
        self.assertIn("只允许运行", skill_whitelist.run_skill_script(self.skill, "scripts/rebuild.py")["error"])
        self.assertIn("error", skill_whitelist.run_skill_script(self.skill, "scripts/../scripts/rebuild.py"))
        # 用户上传的同名技能不在白名单范围内
        user_skill = replace(self.skill, scope="user")
        self.assertIn("不在白名单", skill_whitelist.run_skill_script(user_skill, "scripts/query.py")["error"])
        # 从白名单移除后立即失效
        self.write_whitelist({})
        self.assertIn("不在白名单", skill_whitelist.run_skill_script(self.skill, "scripts/query.py")["error"])

    def test_slow_script_is_stopped(self) -> None:
        with patch.object(skill_whitelist, "SCRIPT_TIMEOUT_SECONDS", 1):
            self.assertIn("超过", skill_whitelist.run_skill_script(self.skill, "scripts/slow.py")["error"])

    def test_platform_note_unlocks_scripts_and_self_check_only_for_whitelisted(self) -> None:
        note = _whitelisted_platform_note(self.skill)
        self.assertIn("run_skill_script", note)
        self.assertIn("scripts/query.py", note)
        self.assertIn("最多返修 2 次", note)
        self.assertNotIn("- 不运行脚本", note)
        self.assertNotIn("- 不自评打分", note)
        # 其余平台规则保留
        self.assertIn("- 不写文件", note)
        self.assertIn("- 不运行脚本", SKILL_PLATFORM_NOTE)

        self.write_whitelist({"lookbook": {"scripts": ["scripts/query.py"], "self_check": {"enabled": False}}})
        note = _whitelisted_platform_note(self.skill)
        self.assertIn("run_skill_script", note)
        self.assertIn("- 不自评打分", note)
        self.assertEqual(skill_whitelist.self_check_repairs(self.skill), 0)

    def test_missing_or_invalid_whitelist_means_nothing_is_whitelisted(self) -> None:
        self.whitelist.write_text("not json", encoding="utf-8")
        self.assertIsNone(skill_whitelist.whitelist_entry(self.skill))
        self.whitelist.unlink()
        self.assertEqual(skill_whitelist.load_whitelist(), {})


if __name__ == "__main__":
    unittest.main()

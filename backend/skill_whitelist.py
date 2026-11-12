"""技能白名单：给经过审核的系统技能开放额外能力。

普通技能只会被读取；列在 skill_whitelist.json 里的系统技能（管理员放在 AGENT_SKILL_PATHS 目录中的技能）
可以额外：
- 运行它声明过的 Python 脚本（查询、检查类的只读脚本），由 Agent 通过 run_skill_script 调用；
- 出图后按技能的检查项自检，并有限次数地针对性返修。

用户自己上传的技能永远不在白名单范围内，脚本一律不执行。
能写入技能目录（例如共享盘）的人，等同于能在服务器上运行这些脚本，请只把可信的人加入维护名单。
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path, PurePosixPath

from .agent_skill_loader import SKILL_CONTEXT_MAX_CHARS, AgentSkill
from .config import settings

SCRIPT_TIMEOUT_SECONDS = 30
MAX_SCRIPT_ARGS = 40
MAX_ARG_CHARS = 2000
MAX_INPUT_CHARS = 50_000
INPUT_FILE_PLACEHOLDER = "{input_file}"
DEFAULT_MAX_REPAIRS = 2


def _whitelist_path() -> Path:
    return Path(os.getenv("SKILL_WHITELIST_PATH") or settings.root_dir / "skill_whitelist.json")


def load_whitelist() -> dict[str, dict]:
    """每次读取：管理员改了白名单不用重启。文件不存在或格式不对时视为空白名单。"""
    try:
        data = json.loads(_whitelist_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    skills = data.get("skills") if isinstance(data, dict) else None
    return {str(k): v for k, v in skills.items() if isinstance(v, dict)} if isinstance(skills, dict) else {}


def whitelist_entry(skill: AgentSkill) -> dict | None:
    """只有系统技能能命中白名单；用户上传的同名技能不行。"""
    if skill.scope != "system":
        return None
    return load_whitelist().get(skill.name)


def allowed_scripts(skill: AgentSkill) -> list[str]:
    entry = whitelist_entry(skill) or {}
    scripts = entry.get("scripts") if isinstance(entry.get("scripts"), list) else []
    return [PurePosixPath(str(item).strip().lstrip("/")).as_posix() for item in scripts if str(item).strip()]


def self_check_repairs(skill: AgentSkill) -> int:
    """开启出图后自检时返回每张图最多返修次数，未开启返回 0。"""
    entry = whitelist_entry(skill) or {}
    policy = entry.get("self_check")
    if not isinstance(policy, dict) or not policy.get("enabled", True):
        return 0
    try:
        return max(0, min(3, int(policy.get("max_repairs", DEFAULT_MAX_REPAIRS))))
    except (TypeError, ValueError):
        return DEFAULT_MAX_REPAIRS


def _relativize(text: str, root: Path, extra_roots: list[Path]) -> str:
    """脚本输出里的技能目录绝对路径换成相对路径，Agent 才能直接交给 use_skill_image。"""
    for base in [root, *extra_roots]:
        for form in {str(base), base.as_posix(), str(base).replace("/", "\\")}:
            if form:
                text = text.replace(form.rstrip("/\\") + "/", "").replace(form.rstrip("/\\") + "\\", "")
    return text


def run_skill_script(skill: AgentSkill, script: str, args: list | None = None, input_text: str | None = None) -> dict:
    """运行白名单技能声明过的脚本，返回 {exit_code, output, truncated} 或 {error}。"""
    if whitelist_entry(skill) is None:
        return {"error": "这个技能不在白名单里，不能运行脚本；按技能里的说明读数据文件自己完成"}
    rel = PurePosixPath(str(script or "").strip().lstrip("/").replace("\\", "/")).as_posix()
    allowed = allowed_scripts(skill)
    if rel not in allowed:
        return {"error": f"不能运行 {rel}，这个技能只允许运行：" + "、".join(allowed)}
    root = skill.source_path.resolve()
    path = (root / rel).resolve()
    if not path.is_relative_to(root) or path.suffix.lower() != ".py" or not path.is_file():
        return {"error": f"技能里没有找到脚本 {rel}"}

    raw_args = args if isinstance(args, list) else []
    if len(raw_args) > MAX_SCRIPT_ARGS:
        return {"error": f"参数太多，最多 {MAX_SCRIPT_ARGS} 个"}
    clean_args = [str(item) for item in raw_args]
    if any(len(item) > MAX_ARG_CHARS or "\x00" in item for item in clean_args):
        return {"error": "参数过长或包含非法字符"}
    if input_text is not None and len(str(input_text)) > MAX_INPUT_CHARS:
        return {"error": f"input_text 超过 {MAX_INPUT_CHARS} 字"}

    with tempfile.TemporaryDirectory(prefix="skill-script-") as tmp:
        if input_text is not None:
            input_path = Path(tmp) / "input.txt"
            input_path.write_text(str(input_text), encoding="utf-8")
            clean_args = [str(input_path) if item == INPUT_FILE_PLACEHOLDER else item for item in clean_args]
        elif INPUT_FILE_PLACEHOLDER in clean_args:
            return {"error": f"参数里用了 {INPUT_FILE_PLACEHOLDER}，但没有提供 input_text"}
        # 参数逐个传入、不经过 shell；-E 忽略环境变量里的 Python 配置，-s 不加载用户目录的包，-B 不往技能目录写缓存。
        # -E 也会忽略 PYTHONIOENCODING / PYTHONUTF8，所以用 -X utf8 强制 UTF-8：Windows 默认按 GBK 输出，中文和路径会乱码
        env = {key: os.environ[key] for key in ("PATH", "SYSTEMROOT", "TEMP", "TMP") if key in os.environ}
        try:
            proc = subprocess.run(
                [sys.executable, "-E", "-X", "utf8", "-s", "-B", str(path), *clean_args],
                cwd=str(root), env=env, capture_output=True, timeout=SCRIPT_TIMEOUT_SECONDS,
                stdin=subprocess.DEVNULL,
            )
        except subprocess.TimeoutExpired:
            return {"error": f"脚本运行超过 {SCRIPT_TIMEOUT_SECONDS} 秒，已停止；请缩小查询条件"}
        except OSError as exc:
            return {"error": f"脚本无法运行：{exc}"}

    output = proc.stdout.decode("utf-8", errors="replace")
    if proc.returncode != 0:
        output += "\n" + proc.stderr.decode("utf-8", errors="replace")
    output = _relativize(output.strip(), root, [skill.source_path])
    truncated = len(output) > SKILL_CONTEXT_MAX_CHARS
    if truncated:
        output = output[:SKILL_CONTEXT_MAX_CHARS].rstrip() + "\n\n[输出过长已截断，请加上更多筛选条件再查]"
    return {"exit_code": proc.returncode, "output": output, "truncated": truncated}

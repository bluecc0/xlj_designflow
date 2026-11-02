"""用户记忆（方案第 9.5 节）：按用户目录保存跨会话的长期偏好。

目录结构：<user_memory_path>/<用户>/
  MEMORY.md      索引，每条一行，每轮注入系统提示词
  m_xxxxxxxx.md  每条记忆一个文件，frontmatter 记录类型、来源会话和时间

只在用户明确要求或表达长期偏好时由 remember 工具写入、修改和删除；管理员可在后台查看。
"""
from __future__ import annotations

import json
import re
import time
import uuid
from pathlib import Path

from ..agent_skill_loader import parse_frontmatter
from ..config import settings
from ..user_skill_store import user_skill_dir

KINDS = {"preference": "偏好", "fact": "信息"}
MAX_MEMORIES = 50
MAX_CONTENT_CHARS = 200
MAX_INDEX_CHARS = 1500
INDEX_NAME = "MEMORY.md"
OWNER_NAME = ".owner.json"  # 记录用户 ID 和用户名，供管理后台显示
_ID_RE = re.compile(r"^m_[0-9a-f]{8}$")
# 记忆只能是偏好和信息，不接受改变 Agent 行为规则的指令
_INJECTION_RE = re.compile(
    r"忽略.{0,6}(规则|指令|提示|以上|之前)|无视.{0,6}(规则|指令)|系统提示|system\s*prompt|"
    r"ignore\s+(all\s+)?(previous|above|prior)|你现在是|扮演|越狱|jailbreak", re.I)


class MemoryError(ValueError):
    pass


def memory_dir(user_id: str) -> Path:
    return user_skill_dir(settings.user_memory_path, str(user_id))


def _read(path: Path) -> dict | None:
    try:
        meta, body = parse_frontmatter(path.read_text(encoding="utf-8"))
    except OSError:
        return None
    return {
        "id": path.stem, "kind": meta.get("kind") if meta.get("kind") in KINDS else "preference",
        "content": body.strip(), "source_session": meta.get("source_session") or "",
        "created_at": float(meta.get("created_at") or 0), "updated_at": float(meta.get("updated_at") or 0),
    }


def _write(folder: Path, entry: dict) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    text = (f"---\nkind: {entry['kind']}\nsource_session: {entry['source_session']}\n"
            f"created_at: {entry['created_at']}\nupdated_at: {entry['updated_at']}\n---\n{entry['content']}\n")
    (folder / f"{entry['id']}.md").write_text(text, encoding="utf-8")


def list_memories(user_id: str) -> list[dict]:
    folder = memory_dir(user_id)
    if not folder.is_dir():
        return []
    entries = [e for p in folder.glob("m_*.md") if _ID_RE.match(p.stem) and (e := _read(p))]
    return sorted(entries, key=lambda e: e["created_at"])


def _rebuild_index(user_id: str) -> None:
    folder = memory_dir(user_id)
    lines = [f"- [{e['id']}]（{KINDS[e['kind']]}）{e['content']}" for e in list_memories(user_id)]
    if folder.is_dir():
        (folder / INDEX_NAME).write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


def _clean(content: str) -> str:
    content = " ".join(str(content or "").split())
    if not content:
        raise MemoryError("记忆内容不能为空")
    if len(content) > MAX_CONTENT_CHARS:
        raise MemoryError(f"一条记忆不超过 {MAX_CONTENT_CHARS} 字，请精简")
    if _INJECTION_RE.search(content):
        raise MemoryError("记忆只能保存偏好和信息，不能保存改变 Agent 规则的指令")
    return content


def add_memory(user_id: str, content: str, kind: str = "preference", source_session: str = "",
               username: str = "") -> dict:
    content = _clean(content)
    existing = list_memories(user_id)
    if any(e["content"] == content for e in existing):
        raise MemoryError("已经有一条相同的记忆")
    if len(existing) >= MAX_MEMORIES:
        raise MemoryError(f"记忆最多 {MAX_MEMORIES} 条，请先删除或合并旧的")
    now = time.time()
    entry = {"id": "m_" + uuid.uuid4().hex[:8], "kind": kind if kind in KINDS else "preference",
             "content": content, "source_session": source_session, "created_at": now, "updated_at": now}
    folder = memory_dir(user_id)
    _write(folder, entry)
    (folder / OWNER_NAME).write_text(json.dumps({"user_id": str(user_id), "username": username},
                                                ensure_ascii=False), encoding="utf-8")
    _rebuild_index(user_id)
    return entry


def _path(user_id: str, memory_id: str) -> Path:
    if not _ID_RE.match(str(memory_id or "")):
        raise MemoryError(f"记忆 ID 不正确：{memory_id}")
    path = memory_dir(user_id) / f"{memory_id}.md"
    if not path.is_file():
        raise MemoryError(f"找不到记忆 {memory_id}")
    return path


def update_memory(user_id: str, memory_id: str, content: str, kind: str = "") -> dict:
    entry = _read(_path(user_id, memory_id))
    entry["content"] = _clean(content)
    if kind in KINDS:
        entry["kind"] = kind
    entry["updated_at"] = time.time()
    _write(memory_dir(user_id), entry)
    _rebuild_index(user_id)
    return entry


def delete_memory(user_id: str, memory_id: str) -> None:
    _path(user_id, memory_id).unlink()
    _rebuild_index(user_id)


def memory_index(user_id: str) -> str:
    """注入系统提示词的索引；超长时保留最新的条目。"""
    path = memory_dir(user_id) / INDEX_NAME
    text = path.read_text(encoding="utf-8").strip() if path.is_file() else ""
    while len(text) > MAX_INDEX_CHARS and "\n" in text:
        text = text.split("\n", 1)[1]
    return text


def list_all_memories() -> list[dict]:
    """管理后台：所有用户的记忆，按用户分组。"""
    base = settings.user_memory_path
    if not base.is_dir():
        return []
    out = []
    for folder in sorted(p for p in base.iterdir() if p.is_dir()):
        entries = [e for p in folder.glob("m_*.md") if _ID_RE.match(p.stem) and (e := _read(p))]
        if not entries:
            continue
        try:
            owner = json.loads((folder / OWNER_NAME).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            owner = {}
        out.append({"user_id": owner.get("user_id") or folder.name, "username": owner.get("username") or "",
                    "memories": sorted(entries, key=lambda e: e["created_at"])})
    return out

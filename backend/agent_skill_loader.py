"""Codex-style instruction skill loader for DesignFlow.

A skill is any directory containing a SKILL.md file with optional YAML-like
frontmatter. This loader is intentionally read-only: it never executes scripts.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any


_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n(.*)$", re.S)
_SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$")


@dataclass(frozen=True)
class AgentSkill:
    name: str
    title: str
    description: str
    type: str
    source_path: Path
    content: str
    metadata: dict[str, Any]
    references: list[str]


def _parse_scalar(value: str) -> Any:
    value = value.strip()
    if not value:
        return ""
    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
        return value[1:-1]
    if value.lower() in {"true", "false"}:
        return value.lower() == "true"
    return value


def parse_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    match = _FRONTMATTER_RE.match(text or "")
    if not match:
        return {}, text or ""
    raw_meta, body = match.group(1), match.group(2)
    meta: dict[str, Any] = {}
    current_key: str | None = None
    for raw_line in raw_meta.splitlines():
        line = raw_line.rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        list_match = re.match(r"^\s*-\s*(.+?)\s*$", line)
        if list_match and current_key:
            meta.setdefault(current_key, [])
            if isinstance(meta[current_key], list):
                meta[current_key].append(_parse_scalar(list_match.group(1)))
            continue
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        if not key:
            continue
        current_key = key
        value = value.strip()
        if value:
            meta[key] = _parse_scalar(value)
        else:
            meta[key] = []
    return meta, body


def _split_skill_paths(raw_paths: str | None, root_dir: Path) -> list[Path]:
    values = [item.strip() for item in (raw_paths or "").split(os.pathsep) if item.strip()]
    if not values:
        values = ["./skills"]
    paths: list[Path] = []
    for value in values:
        path = Path(value).expanduser()
        if not path.is_absolute():
            path = root_dir / path
        paths.append(path)
    return paths


def _discover_skill_dirs(search_paths: list[Path]) -> list[Path]:
    found: list[Path] = []
    seen: set[Path] = set()
    for root in search_paths:
        if not root.exists() or not root.is_dir():
            continue
        candidates = [root] if (root / "SKILL.md").exists() else []
        if not candidates:
            try:
                candidates = [child for child in root.iterdir() if child.is_dir() and (child / "SKILL.md").exists()]
            except OSError:
                candidates = []
        for item in candidates:
            resolved = item.resolve()
            if resolved in seen:
                continue
            seen.add(resolved)
            found.append(item)
    return found


def _collect_references(skill_dir: Path) -> list[str]:
    refs_dir = skill_dir / "references"
    if not refs_dir.exists() or not refs_dir.is_dir():
        return []
    refs: list[str] = []
    for path in sorted(refs_dir.rglob("*.md")):
        try:
            rel = path.relative_to(skill_dir).as_posix()
        except ValueError:
            continue
        refs.append(rel)
    return refs


def _load_skill_from_dir(skill_dir: Path) -> AgentSkill | None:
    skill_file = skill_dir / "SKILL.md"
    if not skill_file.exists():
        return None
    try:
        text = skill_file.read_text(encoding="utf-8")
    except OSError:
        return None
    meta, _body = parse_frontmatter(text)
    name = str(meta.get("name") or skill_dir.name).strip()
    if not _SAFE_NAME_RE.match(name):
        return None
    description = str(meta.get("description") or "").strip()
    title = str(meta.get("title") or name).strip() or name
    skill_type = str(meta.get("type") or "instruction").strip() or "instruction"
    return AgentSkill(
        name=name,
        title=title,
        description=description,
        type=skill_type,
        source_path=skill_dir,
        content=text,
        metadata=meta,
        references=_collect_references(skill_dir),
    )


def list_agent_skills(raw_paths: str | None, root_dir: Path) -> list[dict[str, Any]]:
    skills = []
    for skill_dir in _discover_skill_dirs(_split_skill_paths(raw_paths, root_dir)):
        skill = _load_skill_from_dir(skill_dir)
        if not skill:
            continue
        skills.append({
            "name": skill.name,
            "title": skill.title,
            "description": skill.description,
            "type": skill.type,
            "tags": skill.metadata.get("tags") if isinstance(skill.metadata.get("tags"), list) else [],
            "references": skill.references,
        })
    skills.sort(key=lambda item: item["name"])
    return skills


def load_agent_skill(raw_paths: str | None, root_dir: Path, name: str) -> AgentSkill | None:
    clean_name = str(name or "").strip()
    if not _SAFE_NAME_RE.match(clean_name):
        return None
    for skill_dir in _discover_skill_dirs(_split_skill_paths(raw_paths, root_dir)):
        skill = _load_skill_from_dir(skill_dir)
        if skill and skill.name == clean_name:
            return skill
    return None


def load_reference_text(skill: AgentSkill, rel_path: str) -> str | None:
    """读取 skill 下指定 reference 文件的文本，路径越界或不存在返回 None。"""
    rel = (rel_path or "").strip().lstrip("/")
    if not rel:
        return None
    ref_path = (skill.source_path / rel).resolve()
    try:
        ref_path.relative_to(skill.source_path.resolve())
    except ValueError:
        return None
    try:
        return ref_path.read_text(encoding="utf-8")
    except OSError:
        return None


def build_skill_context(
    skill: AgentSkill,
    include_references: bool = False,
    max_chars: int = 28000,
    references_subset: list[str] | None = None,
) -> str:
    parts = [f"# Active Skill: {skill.name}\n", skill.content]
    if references_subset is not None:
        for rel in references_subset:
            text = load_reference_text(skill, rel)
            if text is None:
                continue
            parts.append(f"\n\n# Reference: {rel.lstrip('/')}\n{text}")
    elif include_references:
        for rel in skill.references:
            ref_path = (skill.source_path / rel).resolve()
            try:
                ref_path.relative_to(skill.source_path.resolve())
            except ValueError:
                continue
            try:
                ref_text = ref_path.read_text(encoding="utf-8")
            except OSError:
                continue
            parts.append(f"\n\n# Reference: {rel}\n{ref_text}")
    text = "".join(parts).strip()
    if len(text) > max_chars:
        text = text[:max_chars].rstrip() + "\n\n[Skill context truncated]"
    return text

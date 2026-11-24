"""Enforce opt-in skill preferences independently of model tool selection."""
from __future__ import annotations

import re

from . import memory

SKILL_TOOLS = frozenset({'load_skill', 'read_skill_file', 'run_skill_script', 'use_skill_image'})
_SKILL = re.compile(r'skills?\b|技能', re.I)
_DENY = re.compile(r'不要|不得|禁止|不允许|别|不主动|不默认|不自动|do not|don.t|never', re.I)
_USE = re.compile(r'使用|调用|加载|启用|选择|用|use|load|invoke', re.I)


def skill_allowed(user_id: str, request: str, name: str, selected: str = '') -> bool:
    # Only current user input / menu selection can authorize; history and tool output cannot.
    clauses = re.split(r'[。！？\n;；]', request or '')
    skill_clauses = [c for c in clauses if _SKILL.search(c) or (name and name.lower() in c.lower())]
    if any(_DENY.search(c) for c in skill_clauses):
        return False
    if selected and selected == name:
        return True
    explicit = any(name and re.search(r'(?<![a-zA-Z0-9_-])' + re.escape(name) + r'(?![a-zA-Z0-9_-])', c, re.I)
                   and _USE.search(c) for c in skill_clauses)
    if explicit:
        return True
    for entry in memory.list_memories(user_id):
        text = entry.get('content', '')
        if _SKILL.search(text) and _DENY.search(text):
            return False
    return True


def rejection(user_id: str, state: dict, name: str) -> dict | None:
    if skill_allowed(user_id, state.get('request', ''), name, state.get('selected_skill', '')):
        return None
    return {'error': '用户未授权本轮使用该技能。不要加载技能、读取技能文件或脚本、引入技能参考图；直接按用户原始要求使用普通工具完成，不要反复请求技能授权。',
            'code': 'skill_not_authorized'}

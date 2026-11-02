"""长会话上下文管理（方案第 9.4 节）。

数据库里保存完整的消息历史，这里只决定"这一步发给模型什么"：
1. 较早轮次里的大段工具结果裁剪成短文本；
2. 估算超过 COMPACT_TRIGGER_TOKENS 时，把较早的轮次总结成摘要，最近几轮保留原文；
3. 有摘要时，在系统提示词后附上摘要和本会话图片清单，压缩后仍能按 ID 找到图片；
4. 模型仍报上下文超限时，由引擎调用 prepare(force=True) 强制压缩后重试。
"""
from __future__ import annotations

import json
import logging
from typing import Awaitable, Callable

from ..model_routing import routed_chat_completion
from . import store

logger = logging.getLogger(__name__)

COMPACT_TRIGGER_TOKENS = 256_000
KEEP_RECENT_TURNS = 6      # 压缩时保留原文的最近轮数
TRIM_AFTER_TURNS = 3       # 早于最近 3 轮的工具结果会被裁剪
TRIM_TOOL_CHARS = 600
SUMMARY_INPUT_CHARS = 200_000

SUMMARY_PROMPT = """下面是设计 Agent 和用户较早的一段对话记录（可能附有之前的摘要）。请把它整理成一份新的摘要，供 Agent 继续工作时参考。
必须保留：
- 用户的目标和需求（做什么、给谁用、什么平台）
- 已经定下的风格、比例、模型、文案等参数
- 用户否定过、不喜欢的方向
- 关键图片的 ID（img_ 开头）和它们分别是什么、用户对它们的评价
- 还没完成的事项
不要寒暄，不要编造对话里没有的内容。用中文分条写，不超过 1500 字。"""


def estimate_tokens(messages: list[dict]) -> int:
    """粗略估算：中文约 1 字 1 token，其余约 4 字符 1 token。"""
    text = json.dumps(messages, ensure_ascii=False)
    wide = sum(1 for ch in text if ord(ch) > 0x2E7F)
    return wide + (len(text) - wide) // 4


def _turn_starts(convo: list[dict]) -> list[int]:
    return [i for i, m in enumerate(convo) if m.get("role") == "user"]


def trim_old_tool_results(convo: list[dict]) -> list[dict]:
    starts = _turn_starts(convo)
    if len(starts) <= TRIM_AFTER_TURNS:
        return convo
    boundary = starts[-TRIM_AFTER_TURNS]
    out = []
    for i, m in enumerate(convo):
        content = m.get("content")
        if i < boundary and m.get("role") == "tool" and isinstance(content, str) and len(content) > TRIM_TOOL_CHARS:
            m = {**m, "content": content[:TRIM_TOOL_CHARS // 2] + "…[较早的工具结果已省略，需要时重新调用工具]"}
        out.append(m)
    return out


def _render(messages: list[dict]) -> str:
    lines = []
    for m in messages:
        role = m.get("role")
        if role == "user":
            lines.append(f"用户：{m.get('content') or ''}")
        elif role == "assistant":
            if m.get("content"):
                lines.append(f"Agent：{m['content']}")
            for call in m.get("tool_calls") or []:
                fn = call.get("function") or {}
                lines.append(f"Agent 调用 {fn.get('name')}：{str(fn.get('arguments') or '')[:500]}")
        elif role == "tool":
            lines.append(f"工具结果：{str(m.get('content') or '')[:300]}")
    text = "\n".join(lines)
    return text if len(text) <= SUMMARY_INPUT_CHARS else "…（更早的记录已省略）\n" + text[-SUMMARY_INPUT_CHARS:]


async def summarize(previous: str, messages: list[dict]) -> str:
    body = (f"【之前的摘要】\n{previous}\n\n" if previous else "") + f"【对话记录】\n{_render(messages)}"
    resp = await routed_chat_completion("agent_llm", {
        "messages": [{"role": "system", "content": SUMMARY_PROMPT}, {"role": "user", "content": body}],
        "temperature": 0.2,
    }, timeout=120, validate=lambda text: bool(text.strip()))
    content = (((resp.json() or {}).get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    return str(content).strip()


def _image_catalog(session_id: str) -> str:
    rows = store.list_artifacts(session_id)
    lines = []
    for r in rows:
        kind = "用户上传" if r["kind"] == "upload" else ("套图" if r["group_type"] == "set" else "生成")
        lines.append(f"- {r['id']}：{kind}" + (f"，{r['label']}" if r.get("label") else ""))
    return "\n".join(lines)


class ContextManager:
    def __init__(self, session: dict, emit: Callable[[str, dict], Awaitable[None]],
                 summarizer: Callable[[str, list[dict]], Awaitable[str]] | None = None):
        self.session_id = session["id"]
        self.summary = session.get("summary") or ""
        self.upto = int(session.get("compacted_upto") or 0)
        self.emit = emit
        self.summarizer = summarizer or summarize

    def _view(self, messages: list[dict]) -> list[dict]:
        system, convo = messages[0], messages[1:]
        if self.summary:
            extra = f"\n\n## 之前对话的摘要\n{self.summary}"
            catalog = _image_catalog(self.session_id)
            if catalog:
                extra += f"\n\n## 本会话的图片（最近 30 张）\n{catalog}"
            system = {**system, "content": system["content"] + extra}
        return [system] + trim_old_tool_results(convo[self.upto:])

    async def prepare(self, messages: list[dict], force: bool = False) -> list[dict]:
        """messages = [system] + 已保存的历史 + 本轮新增；返回这一步实际发送的消息。"""
        view = self._view(messages)
        if not force and estimate_tokens(view) <= COMPACT_TRIGGER_TOKENS:
            return view
        convo = messages[1:]
        starts = [i for i in _turn_starts(convo) if i > self.upto]
        cut = starts[-KEEP_RECENT_TURNS] if len(starts) > KEEP_RECENT_TURNS else 0
        if cut <= self.upto and starts:
            cut = starts[-1]  # 轮数不多但内容很长：只保留当前这一轮的原文
        if cut <= self.upto:
            return view
        await self.emit("context.compacting", {})
        try:
            summary = await self.summarizer(self.summary, convo[self.upto:cut])
        except Exception:
            logger.exception("[agent2] compaction failed for session %s", self.session_id)
            return view
        if not summary:
            return view
        self.summary, self.upto = summary, cut
        store.save_compaction(self.session_id, summary, cut)
        return self._view(messages)

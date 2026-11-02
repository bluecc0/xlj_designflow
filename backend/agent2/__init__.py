"""新版 Agent 模式（第零阶段原型）。

设计见 docs/agent-mode-redesign-plan.md：会话服务 → 引擎适配层 → 工具层，
所有事件先落库再推送，前端只认 SSE 事件协议。
"""

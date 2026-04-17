/**
 * 左栏容器 — 带 Tab 切换
 * Tab 1: 模板库
 * Tab 2: 历史记录
 * Tab 3: MCP 创建（Coming Soon）
 */
import { useState } from "react";
import HistoryPanel from "./HistoryPanel";
import TemplateLibrary from "./TemplateLibrary";

type Tab = "templates" | "history" | "mcp";

export default function LeftPanel() {
  const [tab, setTab] = useState<Tab>("templates");

  return (
    <div className="left-panel">
      <div className="left-tabs">
        <button
          className={`left-tab${tab === "templates" ? " active" : ""}`}
          onClick={() => setTab("templates")}
        >
          模板库
        </button>
        <button
          className={`left-tab${tab === "history" ? " active" : ""}`}
          onClick={() => setTab("history")}
        >
          历史记录
        </button>
        <button
          className={`left-tab${tab === "mcp" ? " active" : ""}`}
          onClick={() => setTab("mcp")}
        >
          MCP创建
        </button>
      </div>

      <div className="left-content">
        {tab === "templates" && <TemplateLibrary />}
        {tab === "history" && <HistoryPanel />}
        {tab === "mcp" && (
          <div className="coming-soon">
            <div className="coming-soon-icon">🔧</div>
            <div className="coming-soon-title">MCP 模板创建</div>
            <div className="coming-soon-sub">Coming Soon</div>
          </div>
        )}
      </div>

      {/* 底部进度入口 */}
      <a
        className="left-footer-link"
        href="/PROGRESS.html"
        target="_blank"
        rel="noreferrer"
      >
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
          <rect x="1" y="3" width="14" height="11" rx="2" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M5 7h6M5 10h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <path d="M5 1v4M11 1v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        项目进度
      </a>
    </div>
  );
}

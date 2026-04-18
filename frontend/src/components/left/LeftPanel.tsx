/**
 * 左栏容器 — 带 Tab 切换
 * Tab 1: 模板库
 * Tab 2: 历史记录
 * Tab 3: MCP 创建（Coming Soon）
 */
import { useEffect, useState } from "react";
import HistoryPanel from "./HistoryPanel";
import TemplateLibrary from "./TemplateLibrary";
import { fetchHealth, type HealthStatus } from "../../api/client";

type Tab = "templates" | "history" | "mcp";

type ConnStatus = "checking" | "ok" | "error";

export default function LeftPanel() {
  const [tab, setTab] = useState<Tab>("templates");
  const [backendStatus, setBackendStatus] = useState<ConnStatus>("checking");
  const [libraryStatus, setLibraryStatus] = useState<ConnStatus>("checking");
  const [libraryFolders, setLibraryFolders] = useState<string[]>([]);

  // 每 15 秒检测一次
  useEffect(() => {
    const check = () => {
      fetchHealth()
        .then((h: HealthStatus) => {
          setBackendStatus("ok");
          setLibraryStatus(h.library.connected ? "ok" : "error");
          setLibraryFolders(h.library.folders);
        })
        .catch(() => {
          setBackendStatus("error");
          setLibraryStatus("error");
          setLibraryFolders([]);
        });
    };
    check();
    const timer = setInterval(check, 15000);
    return () => clearInterval(timer);
  }, []);

  const statusDot = (s: ConnStatus) => (
    <span className={`conn-dot ${s}`} />
  );

  const statusLabel = (s: ConnStatus, okText: string, errText: string) => {
    if (s === "checking") return <span className="conn-label checking">检测中…</span>;
    if (s === "ok")       return <span className="conn-label ok">{okText}</span>;
    return                       <span className="conn-label error">{errText}</span>;
  };

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

      {/* 底部状态 + 进度入口 */}
      <div className="left-footer">
        <div className="conn-row">
          {statusDot(backendStatus)}
          <span className="conn-name">后端</span>
          {statusLabel(backendStatus, "已连接", "未连接")}
        </div>
        <div
          className="conn-row"
          title={
            libraryStatus === "ok"
              ? `已挂载文件夹：${libraryFolders.join("、") || "—"}`
              : "素材库路径不可访问"
          }
        >
          {statusDot(libraryStatus)}
          <span className="conn-name">素材库</span>
          {statusLabel(
            libraryStatus,
            libraryFolders.length > 0 ? `${libraryFolders.length} 个文件夹` : "已连接",
            "未连接",
          )}
        </div>
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
    </div>
  );
}

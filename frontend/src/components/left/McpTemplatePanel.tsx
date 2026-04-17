/**
 * 左栏 — MCP 模板快速创建面板
 * 提供一键创建模板的功能，通过 MCP 协议执行代码
 */
import { useEffect, useState } from "react";
import { executeMcp, getMcpStatus, type McpStatus, type McpExecuteResult } from "../../api/client";

interface McpTemplatePanelProps {
  onTemplateCreated?: (boardId: string, boardName: string) => void;
}

interface TemplateOption {
  id: string;
  name: string;
  desc: string;
  code: string;
  color: string;
}

const TEMPLATE_OPTIONS: TemplateOption[] = [
  {
    id: "grid_4",
    name: "4宫格",
    desc: "2×2 产品展示 (1200×1200)",
    code: `const { createGridTemplate } = require('./mcp_templates/index.js');
return createGridTemplate('grid_4');`,
    color: "#FF6B35",
  },
  {
    id: "grid_6",
    name: "6宫格",
    desc: "2×3 产品展示 (1200×900)",
    code: `const { createGridTemplate } = require('./mcp_templates/index.js');
return createGridTemplate('grid_6');`,
    color: "#00B894",
  },
  {
    id: "grid_9",
    name: "9宫格",
    desc: "3×3 产品展示 (1200×1600)",
    code: `const { createGridTemplate } = require('./mcp_templates/index.js');
return createGridTemplate('grid_9');`,
    color: "#E17055",
  },
  {
    id: "single",
    name: "单品模板",
    desc: "单产品主图 (800×1000)",
    code: `const { createGridTemplate } = require('./mcp_templates/index.js');
return createGridTemplate('single');`,
    color: "#6C5CE7",
  },
];

export default function McpTemplatePanel({ onTemplateCreated }: McpTemplatePanelProps) {
  const [mcpStatus, setMcpStatus] = useState<McpStatus | null>(null);
  const [executing, setExecuting] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 检查 MCP 状态
  const checkStatus = async () => {
    try {
      const status = await getMcpStatus();
      setMcpStatus(status);
    } catch (err) {
      setMcpStatus({ status: "error", connected: false, message: String(err) });
    }
  };

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 30000); // 每 30 秒检查一次
    return () => clearInterval(interval);
  }, []);

  // 执行 MCP 代码
  const handleExecute = async (option: TemplateOption) => {
    setExecuting(option.id);
    setError(null);
    setLastResult(null);

    try {
      const result = await executeMcp(option.code);

      if (result.error) {
        setError(result.error);
        return;
      }

      // 解析结果
      const content = result.result?.content?.[0]?.text;
      if (content) {
        setLastResult(content);
        try {
          const parsed = JSON.parse(content);
          if (parsed.board_id && onTemplateCreated) {
            onTemplateCreated(parsed.board_id, parsed.board_name || option.name);
          }
        } catch {
          // 不是 JSON，直接显示
        }
      }

      // 重新检查状态
      await checkStatus();
    } catch (err) {
      setError(String(err));
    } finally {
      setExecuting(null);
    }
  };

  return (
    <div className="mcp-panel">
      <div className="panel-section-header">
        <span className="panel-title">MCP 模板创建</span>
        <button
          className="refresh-btn"
          onClick={checkStatus}
          title="刷新 MCP 状态"
        >
          ↻
        </button>
      </div>

      {/* MCP 状态指示 */}
      <div className="mcp-status-bar">
        <span
          className={`status-dot ${mcpStatus?.connected ? "connected" : "disconnected"}`}
        />
        <span className="status-text">
          {mcpStatus?.connected ? "MCP 已连接" : "MCP 未连接"}
        </span>
        {mcpStatus?.connected && (
          <span className="status-hint">可直接在 Penpot 中使用</span>
        )}
      </div>

      {/* 模板按钮 */}
      <div className="mcp-template-grid">
        {TEMPLATE_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            className={`mcp-template-btn ${executing === opt.id ? "executing" : ""}`}
            onClick={() => handleExecute(opt)}
            disabled={!mcpStatus?.connected || executing !== null}
            style={{ "--accent": opt.color } as React.CSSProperties}
          >
            <span className="btn-icon" style={{ background: opt.color }}>
              {opt.name.charAt(0)}
            </span>
            <span className="btn-text">
              <span className="btn-title">{opt.name}</span>
              <span className="btn-desc">{opt.desc}</span>
            </span>
            {executing === opt.id && <span className="btn-spinner">⟳</span>}
          </button>
        ))}
      </div>

      {/* 结果显示 */}
      {error && (
        <div className="mcp-result error">
          <span className="result-icon">✗</span>
          <span className="result-text">{error}</span>
        </div>
      )}

      {lastResult && (
        <div className="mcp-result success">
          <details>
            <summary>
              <span className="result-icon">✓</span>
              模板已创建
            </summary>
            <pre className="result-json">{lastResult}</pre>
          </details>
        </div>
      )}

      <div className="mcp-help">
        <span>通过 MCP 协议在 Penpot 中直接创建模板</span>
      </div>
    </div>
  );
}
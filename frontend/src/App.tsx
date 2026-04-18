import ChatPanel from "./components/right/ChatPanel";
import ComposePreview from "./components/middle/ComposePreview";
import LeftPanel from "./components/left/LeftPanel";
import "./App.css";

export default function App() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <header className="app-header">
        {/* Logo */}
        <div className="app-logo">
          <div className="app-logo-mark">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M4 2 L4 14 L8 14 C11.314 14 14 11.314 14 8 C14 4.686 11.314 2 8 2 Z" fill="white" opacity="0.9"/>
            </svg>
          </div>
          <span className="app-logo-text">Loom</span>
          <span className="app-logo-beta">BETA</span>
        </div>

        {/* Breadcrumb */}
        <div className="app-breadcrumb">
          <span>Design Tool</span>
          <span className="app-breadcrumb-sep">›</span>
          <span className="app-breadcrumb-file">AI 生图工作台</span>
        </div>

        {/* Right side */}
        <div className="app-header-right">
          <div className="synced-indicator">
            <span className="synced-dot" />
            Synced
          </div>
          <div className="avatar-stack">
            <div className="avatar-circle" style={{ background: "oklch(0.88 0.08 280)", color: "oklch(0.38 0.18 275)" }}>A</div>
            <div className="avatar-circle" style={{ background: "oklch(0.90 0.06 155)", color: "oklch(0.35 0.15 155)" }}>B</div>
            <div className="avatar-circle" style={{ background: "oklch(0.90 0.07 70)", color: "oklch(0.40 0.15 70)" }}>C</div>
          </div>
          <button className="share-btn">Share</button>
        </div>
      </header>

      <div className="app-layout">
        <aside className="panel panel-left">
          <LeftPanel />
        </aside>
        <main className="panel panel-middle">
          <ComposePreview />
        </main>
        <aside className="panel panel-right">
          <ChatPanel />
        </aside>
      </div>
    </div>
  );
}

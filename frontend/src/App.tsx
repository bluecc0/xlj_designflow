import ChatPanel from "./components/right/ChatPanel";
import ComposePreview from "./components/middle/ComposePreview";
import LeftPanel from "./components/left/LeftPanel";
import "./App.css";

export default function App() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <header className="app-header">
        <div className="app-logo">
          <div className="app-logo-mark">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M9.5 1.5 L4 9 H8.5 L6.5 14.5 L13 7 H8.5 Z" fill="white"/>
            </svg>
          </div>
          DesignFlow
          <span>AI 生图工作台</span>
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

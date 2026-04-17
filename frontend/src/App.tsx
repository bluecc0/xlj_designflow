import ChatPanel from "./components/right/ChatPanel";
import ComposePreview from "./components/middle/ComposePreview";
import LeftPanel from "./components/left/LeftPanel";
import "./App.css";

export default function App() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <header className="app-header">
        <div className="app-logo">
          <div className="app-logo-mark">AI</div>
          DesignFlow
          <span>/ AI 生图平台</span>
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

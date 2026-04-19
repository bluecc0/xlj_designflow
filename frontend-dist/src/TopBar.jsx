// Top bar — logo, backend + library health status (Chinese)

const TopBar = () => {
  const [health, setHealth] = React.useState(null); // null=loading, obj=ok, 'error'=fail

  React.useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const h = await API.fetchHealth();
        if (alive) setHealth(h);
      } catch {
        if (alive) setHealth('error');
      }
    };
    check();
    const iv = setInterval(check, 30000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  const backendOk = health && health !== 'error' && health.status === 'ok';
  const libraryOk = health && health !== 'error' && health.library?.connected;

  const backendColor = health === null ? 'var(--warn)' : backendOk ? 'var(--ok)' : 'oklch(0.6 0.18 25)';
  const libraryColor = health === null ? 'var(--warn)' : libraryOk ? 'var(--ok)' : 'oklch(0.6 0.18 25)';

  const backendText = health === null ? '连接中…' : backendOk ? '已连接' : '离线';
  const libraryText = health === null ? '检测中…' : libraryOk ? '已连接' : '未连接';

  return (
    <div style={{
      height: 48, flexShrink: 0,
      display: 'flex', alignItems: 'center',
      padding: '0 14px', gap: 16,
      background: 'var(--panel)',
      borderBottom: '1px solid var(--line)',
    }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 160 }}>
        <div style={{
          width: 22, height: 22, borderRadius: 6,
          background: 'linear-gradient(135deg, var(--ink) 0%, oklch(0.28 0.04 275) 100%)',
          display: 'grid', placeItems: 'center',
          color: 'white',
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M4 20 V6 M4 6 C10 6, 10 14, 16 14 C22 14, 22 6, 20 6"/>
          </svg>
        </div>
        <span className="serif" style={{ fontSize: 18, letterSpacing: '-0.01em' }}>Loom</span>
        <span className="mono" style={{ fontSize: 9, color: 'var(--ink-3)', padding: '2px 5px', borderRadius: 3, background: 'var(--panel-2)', border: '1px solid var(--line)' }}>BETA</span>
      </div>

      {/* Project crumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--ink-2)' }}>
        <span style={{ color: 'var(--ink-3)' }}>AI 生图工作台</span>
      </div>

      <div style={{ flex: 1 }}/>

      {/* Status indicators */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>

        {/* 后端状态 */}
        <StatusChip
          color={backendColor}
          label="后端服务"
          value={backendText}
          pulse={health === null}
        />

        {/* 素材库状态 */}
        <StatusChip
          color={libraryColor}
          label="素材库"
          value={libraryText}
          pulse={health === null}
          title={health && health !== 'error' && health.library?.path ? `路径：${health.library.path}` : ''}
        />

      </div>
    </div>
  );
};

const StatusChip = ({ color, label, value, pulse, title }) => (
  <div title={title || ''} style={{
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '4px 9px', borderRadius: 6,
    background: 'var(--panel-2)', border: '1px solid var(--line-2)',
    fontSize: 11, cursor: title ? 'help' : 'default',
  }}>
    <span style={{ position: 'relative', width: 7, height: 7, flexShrink: 0 }}>
      <span style={{
        position: 'absolute', inset: 0, borderRadius: 99,
        background: color, transition: 'background 300ms',
      }}/>
      {pulse && (
        <span style={{
          position: 'absolute', inset: -2, borderRadius: 99,
          background: color, opacity: 0.3,
          animation: 'statusPulse 1.6s ease-in-out infinite',
        }}/>
      )}
    </span>
    <span style={{ fontWeight: 500, color: 'var(--ink-2)' }}>{label}</span>
    <span className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)' }}>{value}</span>
    <style>{`@keyframes statusPulse { 0%,100%{transform:scale(1);opacity:0.3} 50%{transform:scale(1.8);opacity:0} }`}</style>
  </div>
);

window.TopBar = TopBar;

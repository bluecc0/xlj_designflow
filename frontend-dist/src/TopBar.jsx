// Top bar — logo, project crumb, backend health status

const TopBar = () => {
  const [health, setHealth] = React.useState(null); // null=loading, object=ok, 'error'=fail

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
  const backendColor = health === null ? 'var(--warn)' : backendOk ? 'var(--ok)' : 'oklch(0.6 0.18 25)';
  const backendLabel = health === null ? 'connecting…' : backendOk ? 'connected' : 'offline';

  return (
    <div style={{
      height: 48, flexShrink: 0,
      display: 'flex', alignItems: 'center',
      padding: '0 14px', gap: 16,
      background: 'var(--panel)',
      borderBottom: '1px solid var(--line)',
    }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 180 }}>
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
        <span style={{ color: 'var(--ink-3)' }}>Design Tool</span>
        <I.chevronRight size={10} stroke={1.8}/>
        <span style={{ color: 'var(--ink)' }}>AI 生图工作台</span>
      </div>

      <div style={{ flex: 1 }}/>

      {/* Right cluster */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {/* Backend status */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '4px 8px', borderRadius: 6,
          background: 'var(--panel-2)', border: '1px solid var(--line-2)',
          fontSize: 11,
        }}>
          <span style={{ width: 7, height: 7, borderRadius: 99, background: backendColor, flexShrink: 0, transition: 'background 300ms' }}/>
          <span style={{ fontWeight: 500, color: 'var(--ink-2)' }}>Backend</span>
          <span className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)' }}>{backendLabel}</span>
        </div>

        {/* Version */}
        {backendOk && health.version && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '4px 8px', borderRadius: 6,
            background: 'var(--panel-2)', border: '1px solid var(--line-2)',
            fontSize: 11,
          }}>
            <span className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)' }}>v{health.version}</span>
          </div>
        )}
      </div>
    </div>
  );
};

window.TopBar = TopBar;

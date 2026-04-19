// Polls /health every 30s and renders a status dot + label
const StatusChip = ({ label, fetchUrl, okKey, okText, errText }) => {
  const [status, setStatus] = React.useState('loading'); // 'loading' | 'ok' | 'err'

  React.useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch(fetchUrl);
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!alive) return;
        if (okKey) {
          // e.g. okKey='library' → data.library.connected
          setStatus(data[okKey]?.connected ? 'ok' : 'err');
        } else {
          setStatus(data.status === 'ok' ? 'ok' : 'err');
        }
      } catch {
        if (alive) setStatus('err');
      }
    };
    check();
    const iv = setInterval(check, 30000);
    return () => { alive = false; clearInterval(iv); };
  }, [fetchUrl, okKey]);

  const color = status === 'loading' ? 'var(--warn)' : status === 'ok' ? 'var(--ok)' : 'oklch(0.6 0.18 25)';
  const text  = status === 'loading' ? '检测中…'   : status === 'ok' ? okText      : errText;
  const pulse = status === 'loading';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5,
      padding: '4px 8px', borderRadius: 6,
      background: 'var(--panel-2)', border: '1px solid var(--line-2)',
      fontSize: 11,
    }}>
      <span style={{ position: 'relative', width: 7, height: 7, flexShrink: 0 }}>
        <span style={{ position: 'absolute', inset: 0, borderRadius: 99, background: color, transition: 'background 300ms' }}/>
        {pulse && <span style={{ position: 'absolute', inset: -2, borderRadius: 99, background: color, opacity: 0.3, animation: 'statusPulse 1.6s ease-in-out infinite' }}/>}
      </span>
      <span style={{ fontWeight: 500, color: 'var(--ink-2)' }}>{label}</span>
      <span className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)' }}>{text}</span>
      <style>{`@keyframes statusPulse{0%,100%{transform:scale(1);opacity:.3}50%{transform:scale(1.8);opacity:0}}`}</style>
    </div>
  );
};

const TopBar = () => {
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
        <span style={{ color: 'var(--ink-3)' }}>Autumn Campaign</span>
        <I.chevronRight size={10} stroke={1.8}/>
        <span style={{ color: 'var(--ink)' }}>Hero visual — Draft 03</span>
        <button style={{
          marginLeft: 4, padding: '3px 6px', borderRadius: 4,
          color: 'var(--ink-3)', fontSize: 10,
        }}>
          <I.chevronDown size={10} stroke={2}/>
        </button>
      </div>

      <div style={{ flex: 1 }}/>

      {/* Right cluster — live status chips */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <StatusChip label="后端服务" fetchUrl="/health" okText="已连接" errText="离线"/>
        <StatusChip label="素材库" fetchUrl="/health" okKey="library" okText="已连接" errText="未连接"/>
      </div>
    </div>
  );
};

window.TopBar = TopBar;

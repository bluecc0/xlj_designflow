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

      {/* Right cluster */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '4px 8px', borderRadius: 6,
          background: 'var(--panel-2)', border: '1px solid var(--line-2)',
          fontSize: 11,
        }}>
          <span style={{ width: 7, height: 7, borderRadius: 99, background: 'var(--ok)', flexShrink: 0 }}/>
          <span style={{ fontWeight: 500, color: 'var(--ink-2)' }}>Backend</span>
          <span className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)' }}>api.loom.ai</span>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '4px 8px', borderRadius: 6,
          background: 'var(--panel-2)', border: '1px solid var(--line-2)',
          fontSize: 11,
        }}>
          <span style={{ width: 7, height: 7, borderRadius: 99, background: 'var(--warn)', flexShrink: 0 }}/>
          <span style={{ fontWeight: 500, color: 'var(--ink-2)' }}>Frontend</span>
          <span className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)' }}>v0.4.2</span>
        </div>
        <div style={{ width: 1, height: 18, background: 'var(--line)', margin: '0 4px' }}/>
        <div style={{ display: 'flex' }}>
          {['EM','JR','KT'].map((n, i) => (
            <div key={n} style={{
              width: 22, height: 22, borderRadius: 99,
              background: ['oklch(0.85 0.06 40)', 'oklch(0.82 0.07 200)', 'oklch(0.84 0.07 140)'][i],
              color: 'oklch(0.3 0.05 0)',
              fontSize: 9, fontWeight: 600,
              display: 'grid', placeItems: 'center',
              border: '2px solid var(--panel)',
              marginLeft: i ? -6 : 0,
            }}>{n}</div>
          ))}
        </div>
      </div>
    </div>
  );
};

window.TopBar = TopBar;

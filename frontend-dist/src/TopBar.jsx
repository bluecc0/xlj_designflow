// Polls /health every 30s and renders compact status icons.

const STATUS_COLORS = {
  loading: 'var(--warn)',
  ok: 'var(--ok)',
  err: 'oklch(0.6 0.18 25)',
};

const StatusIcon = ({ title, fetchUrl, okKey, icon: Icon, renderDetail }) => {
  const [status, setStatus] = React.useState('loading'); // 'loading' | 'ok' | 'err'
  const [payload, setPayload] = React.useState(null);
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef(null);

  React.useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch(fetchUrl);
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!alive) return;
        setPayload(data);
        if (okKey) {
          setStatus(data[okKey]?.connected ? 'ok' : 'err');
        } else {
          const ok = data.status === 'ok' && data.penpot?.connected;
          setStatus(ok ? 'ok' : 'err');
        }
      } catch {
        if (alive) {
          setPayload(null);
          setStatus('err');
        }
      }
    };
    check();
    const iv = setInterval(check, 30000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [fetchUrl, okKey]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!wrapRef.current || wrapRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const color = STATUS_COLORS[status] || STATUS_COLORS.err;
  const pulse = status === 'loading';
  const text = status === 'loading' ? '检测中' : status === 'ok' ? '正常' : '异常';
  const detail = renderDetail ? renderDetail(payload) : null;
  const clickable = Boolean(detail);

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'relative',
        flexShrink: 0,
      }}
    >
      <button
        title={title + '：' + text}
        aria-label={title + '：' + text}
        onClick={clickable ? () => setOpen(v => !v) : undefined}
        style={{
          width: 28,
          height: 28,
          borderRadius: 7,
          background: open ? 'var(--accent-soft)' : 'var(--panel-2)',
          border: '1px solid ' + (open ? 'var(--accent)' : 'var(--line-2)'),
          display: 'grid',
          placeItems: 'center',
          position: 'relative',
          color: 'var(--ink-2)',
          cursor: clickable ? 'pointer' : 'default',
        }}
      >
        <span
          style={{ display: 'grid', placeItems: 'center' }}
        >
          <Icon size={13} stroke={2}/>
        </span>
        <span
          style={{
            position: 'absolute',
            right: 4,
            bottom: 4,
            width: 6,
            height: 6,
            borderRadius: 99,
            background: color,
            boxShadow: '0 0 0 2px ' + (open ? 'var(--accent-soft)' : 'var(--panel-2)'),
            transition: 'background 300ms',
          }}
        />
        {pulse && (
          <span
            style={{
              position: 'absolute',
              right: 2,
              bottom: 2,
              width: 10,
              height: 10,
              borderRadius: 99,
              background: color,
              opacity: 0.22,
              animation: 'statusPulse 1.6s ease-in-out infinite',
            }}
          />
        )}
      </button>
      {open && detail && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          right: 0,
          minWidth: 180,
          padding: 10,
          borderRadius: 8,
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          boxShadow: '0 10px 24px rgba(0,0,0,0.12)',
          zIndex: 30,
        }}>
          {detail}
        </div>
      )}
      <style>{`@keyframes statusPulse{0%,100%{transform:scale(1);opacity:.22}50%{transform:scale(1.7);opacity:0}}`}</style>
    </div>
  );
};

const TopBar = ({ user, onSwitchUser }) => {
  const renderAiProviderDetail = React.useCallback((data) => {
    const info = data && data.ai_provider;
    if (!info) return null;
    const hasBalance = typeof info.remain_balance !== 'undefined';
    const statusText = info.connected ? '正常' : (info.configured ? '异常' : '未配置');
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink)' }}>AI 服务商</div>
        <div style={{ fontSize: 11, color: 'var(--ink-2)' }}>状态：{statusText}</div>
        {hasBalance && <div style={{ fontSize: 11, color: 'var(--ink-2)' }}>余额：{String(info.remain_balance)}</div>}
        {!hasBalance && info.connected && info.unlimited_quota && <div style={{ fontSize: 11, color: 'var(--ink-2)' }}>额度：不限额</div>}
        {info.message && <div style={{ fontSize: 10.5, color: 'var(--ink-3)', lineHeight: 1.45 }}>{String(info.message).slice(0, 120)}</div>}
      </div>
    );
  }, []);

  return (
    <div style={{
      height: 48, flexShrink: 0,
      display: 'flex', alignItems: 'center',
      padding: '0 14px', gap: 16,
      background: 'var(--panel)',
      borderBottom: '1px solid var(--line)',
    }}>
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
        <span className="serif" style={{ fontSize: 18, letterSpacing: '-0.01em' }}>Designflow</span>
        <span className="mono" style={{ fontSize: 9, color: 'var(--ink-3)', padding: '2px 5px', borderRadius: 3, background: 'var(--panel-2)', border: '1px solid var(--line)' }}>BETA</span>
      </div>

      <div style={{ flex: 1 }}/>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <StatusIcon title="后端服务" fetchUrl="/health" icon={I.settings}/>
        <StatusIcon title="素材库" fetchUrl="/health" okKey="library" icon={I.folder}/>
        <StatusIcon title="AI 服务商" fetchUrl="/health" okKey="ai_provider" icon={I.sparkles} renderDetail={renderAiProviderDetail}/>
        {user && React.createElement('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 8,
            marginLeft: 6, padding: '4px 8px', borderRadius: 6,
            background: 'var(--panel-2)', border: '1px solid var(--line-2)',
          }
        },
          React.createElement(I.user, { size: 12, style: { color: 'var(--ink-3)' } }),
          React.createElement('span', { style: { fontSize: 11.5, color: 'var(--ink)' } }, user.username),
          React.createElement('button', {
            onClick: onSwitchUser,
            title: '切换身份',
            style: {
              width: 22, height: 22, borderRadius: 5,
              background: 'var(--panel)', border: '1px solid var(--line)',
              color: 'var(--ink-3)', display: 'grid', placeItems: 'center',
              cursor: 'pointer',
            }
          }, React.createElement(I.refresh, { size: 11 }))
        )}
      </div>
    </div>
  );
};

window.TopBar = TopBar;

// Polls /health every 30s and renders compact status icons.

const STATUS_COLORS = {
  loading: 'var(--warn)',
  ok: 'var(--ok)',
  err: 'oklch(0.6 0.18 25)',
};

const StatusIcon = ({ title, fetchUrl, okKey, icon: Icon, renderDetail, placement = 'bottom' }) => {
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
          setStatus(data.status === 'ok' ? 'ok' : 'err');
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
          ...(placement === 'top'
            ? { bottom: 'calc(100% + 8px)', top: 'auto' }
            : { top: 'calc(100% + 8px)' }),
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

const InspirationCurveIcon = () => {
  const groupRef = React.useRef(null);
  const pathRef = React.useRef(null);
  const particlesRef = React.useRef([]);

  React.useEffect(function() {
    const group = groupRef.current;
    const path = pathRef.current;
    const particles = particlesRef.current.filter(Boolean);
    if (!group || !path || !particles.length) return;

    const config = {
      amplitude: 9.2,
      petalCount: 2,
      curveScale: 3.25,
      particleCount: particles.length,
      trailSpan: 0.42,
      durationMs: 4600,
      rotationDurationMs: 28000,
      pulseDurationMs: 4200,
      strokeWidth: 5.5,
      rotate: true,
      point: function(progress, detailScale, cfg) {
        const t = progress * Math.PI * 2;
        const petals = Math.round(cfg.petalCount);
        const radius = cfg.amplitude * detailScale * Math.cos(petals * t);
        return {
          x: 50 + radius * Math.cos(t) * cfg.curveScale,
          y: 50 + radius * Math.sin(t) * cfg.curveScale,
        };
      },
    };
    const normalizeProgress = function(progress) {
      return ((progress % 1) + 1) % 1;
    };
    const buildPath = function(detailScale, steps) {
      return Array.from({ length: steps + 1 }, function(_, index) {
        const point = config.point(index / steps, detailScale, config);
        return (index === 0 ? 'M' : 'L') + ' ' + point.x.toFixed(2) + ' ' + point.y.toFixed(2);
      }).join(' ');
    };
    const getDetailScale = function(time) {
      const pulseProgress = (time % config.pulseDurationMs) / config.pulseDurationMs;
      const pulseAngle = pulseProgress * Math.PI * 2;
      return 0.52 + ((Math.sin(pulseAngle + 0.55) + 1) / 2) * 0.48;
    };
    const getParticle = function(index, progress, detailScale) {
      const tailOffset = index / (config.particleCount - 1);
      const point = config.point(
        normalizeProgress(progress - tailOffset * config.trailSpan),
        detailScale,
        config
      );
      const fade = Math.pow(1 - tailOffset, 0.56);
      return {
        x: point.x,
        y: point.y,
        radius: 0.9 + fade * 2.7,
        opacity: 0.04 + fade * 0.96,
      };
    };

    const startedAt = performance.now();
    let raf = 0;
    const render = function(now) {
      const time = now - startedAt;
      const progress = (time % config.durationMs) / config.durationMs;
      const detailScale = getDetailScale(time);
      const rotation = -((time % config.rotationDurationMs) / config.rotationDurationMs) * 360;

      group.setAttribute('transform', 'rotate(' + rotation.toFixed(2) + ' 50 50)');
      path.setAttribute('d', buildPath(detailScale, 220));
      particles.forEach(function(node, index) {
        const particle = getParticle(index, progress, detailScale);
        node.setAttribute('cx', particle.x.toFixed(2));
        node.setAttribute('cy', particle.y.toFixed(2));
        node.setAttribute('r', (particle.radius * 0.78).toFixed(2));
        node.setAttribute('opacity', particle.opacity.toFixed(3));
      });
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return function() { cancelAnimationFrame(raf); };
  }, []);

  return (
    <span className="inspiration-curve-icon" aria-hidden="true">
      <svg width="30" height="30" viewBox="0 0 100 100" fill="none" style={{ display: 'block' }}>
        <defs>
          <linearGradient id="inspirationIconGradient" x1="16" y1="18" x2="84" y2="82" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#06b6d4"/>
            <stop offset="50%" stopColor="#3b82f6"/>
            <stop offset="100%" stopColor="#8b5cf6"/>
          </linearGradient>
        </defs>
        <g ref={groupRef} className="inspiration-curve-icon__dots">
          <path ref={pathRef} stroke="url(#inspirationIconGradient)" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.14"/>
          {Array.from({ length: 64 }).map(function(_, i) {
            return <circle key={i} ref={function(node) { particlesRef.current[i] = node; }} fill="url(#inspirationIconGradient)"/>;
          })}
        </g>
      </svg>
    </span>
  );
};

const TopBar = ({ user, onSwitchUser, currentView, onNavigate, onOpenInspiration, inspirationOpen }) => {
  const isAgentPage = typeof window !== 'undefined' && /\/ui\/agent\.html(?:$|\?)/.test(window.location.href);

  React.useEffect(function() {
    if (document.getElementById('inspiration-flow-style')) return;
    const style = document.createElement('style');
    style.id = 'inspiration-flow-style';
    style.textContent = `
.inspiration-flow {
  position: relative;
  border-radius: 8px;
}
.inspiration-flow__inner {
  display: inline-flex;
  align-items: center;
  gap: 2;
  height: 100%;
  width: 100%;
  padding: 0 10px 0 2px;
  border-radius: 7px;
  background: var(--panel);
  cursor: pointer;
  flex-shrink: 0;
  border: none;
  outline: none;
  position: relative;
  -webkit-tap-highlight-color: transparent;
  -webkit-user-select: none;
  user-select: none;
  transition: none;
}
.inspiration-flow__inner:hover,
.inspiration-flow__inner:focus,
.inspiration-flow__inner:active,
.inspiration-flow__inner:focus-visible,
.inspiration-flow__inner:focus-within {
  background: var(--panel);
  outline: none;
}
.inspiration-flow__text {
  font-size: 13px;
  font-weight: 600;
  background: linear-gradient(90deg, #06b6d4 0%, #3b82f6 50%, #8b5cf6 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.inspiration-curve-icon {
  width: 30px;
  height: 30px;
  display: inline-grid;
  place-items: center;
}
`;
    document.head.appendChild(style);
  }, []);
const fmtBalance = (n) => {
  if (typeof n !== 'number') return '';
  return Math.min(n, 99.99).toFixed(2);
};
const renderAiProviderDetail = function(data) {
  const info = data && data.ai_provider;
  if (!info) return null;
  const hasBalance = typeof info.remain_balance !== 'undefined';
  const zenmux = info.zenmux;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 11, color: 'var(--ink-2)' }}>
        APIMart {info.connected ? '正常' : (info.configured ? '异常' : '未配置')}
        {hasBalance ? ` · 余额 $${fmtBalance(info.remain_balance)}` : ''}
      </div>
      {zenmux && (
        <div style={{ fontSize: 11, color: 'var(--ink-2)' }}>
          ZenMux {zenmux.connected ? '正常' : (zenmux.configured ? '异常' : '未配置')}
          {typeof zenmux.total_credits === 'number' ? ` · 余额 $${fmtBalance(zenmux.total_credits)}` : ''}
        </div>
      )}
      {info.message && <div style={{ fontSize: 10.5, color: 'var(--ink-3)', lineHeight: 1.45 }}>{String(info.message).slice(0, 120)}</div>}
    </div>
  );
};
window.renderAiProviderDetail = renderAiProviderDetail;


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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em' }}>Designflow</span>
            <span style={{ fontSize: 11, color: 'var(--ink-3)', letterSpacing: '0.02em', marginTop: 1 }}>丨  AI 驱动的电商设计资产生成平台</span>
          </div>
      </div>

      <div style={{ flex: 1 }}/>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {isAgentPage && (
          <a
            href="/ui/"
            style={{
              height: 28,
              padding: '0 10px',
              borderRadius: 7,
              background: 'var(--panel-2)',
              border: '1px solid var(--line-2)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              color: 'var(--ink-2)',
              textDecoration: 'none',
              fontSize: 11.5,
              flexShrink: 0,
            }}
          >
            <I.sparkles size={12}/>
            <span>主工作台</span>
          </a>
        )}
        {user && (
          <div className="inspiration-flow" style={{ height: 30, flexShrink: 0 }}>
            <button
              onClick={onOpenInspiration}
              title="灵感"
              className="inspiration-flow__inner"
            >
              <InspirationCurveIcon/>
              <span className="inspiration-flow__text">灵感</span>
            </button>
          </div>
        )}
        {user && user.role === 'admin' && onNavigate && (
          <button
            onClick={() => onNavigate('#/admin')}
            title="管理后台"
            style={{
              height: 28, padding: '0 10px', borderRadius: 7,
              background: 'var(--panel-2)', border: '1px solid var(--line-2)',
              color: 'var(--ink-2)', fontSize: 11.5, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 5,
              flexShrink: 0,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            <span>管理</span>
          </button>
        )}
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
window.StatusIcon = StatusIcon;

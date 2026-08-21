// src/Icons.jsx
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// Minimal stroke icon set
const Icon = ({
  d,
  size = 14,
  stroke = 1.5,
  fill = 'none',
  children,
  style
}) => /*#__PURE__*/React.createElement("svg", {
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: fill,
  stroke: "currentColor",
  strokeWidth: stroke,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  style: style
}, d ? /*#__PURE__*/React.createElement("path", {
  d: d
}) : children);
const I = {
  search: p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("circle", {
    cx: "11",
    cy: "11",
    r: "7"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m20 20-3.5-3.5"
  })),
  plus: p => /*#__PURE__*/React.createElement(Icon, _extends({
    d: "M12 5v14M5 12h14"
  }, p)),
  arrowRight: p => /*#__PURE__*/React.createElement(Icon, _extends({
    d: "M5 12h14m-6-6 6 6-6 6"
  }, p)),
  arrowUp: p => /*#__PURE__*/React.createElement(Icon, _extends({
    d: "M12 19V5m-7 7 7-7 7 7"
  }, p)),
  paperclip: p => /*#__PURE__*/React.createElement(Icon, _extends({
    d: "M21 11.5 12.5 20a5.5 5.5 0 0 1-7.8-7.8l9.2-9.2a3.7 3.7 0 0 1 5.2 5.2L9.9 17.4a1.8 1.8 0 0 1-2.6-2.6L15 7"
  }, p)),
  image: p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "4",
    width: "18",
    height: "16",
    rx: "2"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "9",
    cy: "10",
    r: "1.5"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m3 17 5-5 5 5 3-3 5 5"
  })),
  sparkles: p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("path", {
    d: "M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"
  })),
  wand: p => /*#__PURE__*/React.createElement(Icon, _extends({
    d: "M15 4V2m0 14v-2M8 9h2M20 9h2M17.8 11.8 19 13M17.8 6.2 19 5M3 21l9-9m-1.8-3.8L12 7"
  }, p)),
  logo: p => /*#__PURE__*/React.createElement("span", _extends({}, p, {
    style: Object.assign({
      display: 'inline-grid',
      placeItems: 'center',
      color: 'white',
      background: 'linear-gradient(135deg, var(--ink), oklch(0.3 0.08  275))',
      borderRadius: 5
    }, p.style || {})
  }), /*#__PURE__*/React.createElement("svg", {
    width: p.size || 12,
    height: p.size || 12,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"
  }))),
  close: p => /*#__PURE__*/React.createElement(Icon, _extends({
    d: "M6 6l12 12M18 6 6 18"
  }, p)),
  more: p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("circle", {
    cx: "5",
    cy: "12",
    r: "1"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "1"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "19",
    cy: "12",
    r: "1"
  })),
  grid: p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "3",
    width: "7",
    height: "7",
    rx: "1"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "14",
    y: "3",
    width: "7",
    height: "7",
    rx: "1"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "14",
    width: "7",
    height: "7",
    rx: "1"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "14",
    y: "14",
    width: "7",
    height: "7",
    rx: "1"
  })),
  layers: p => /*#__PURE__*/React.createElement(Icon, _extends({
    d: "m12 2 10 6-10 6L2 8l10-6Zm-10 10 10 6 10-6M2 16l10 6 10-6"
  }, p)),
  heart: p => /*#__PURE__*/React.createElement(Icon, _extends({
    d: "M19.5 12.6 12 20l-7.5-7.4a5 5 0 0 1 7-7.2l.5.5.5-.5a5 5 0 0 1 7 7.2Z"
  }, p)),
  download: p => /*#__PURE__*/React.createElement(Icon, _extends({
    d: "M12 3v12m-5-5 5 5 5-5M4 21h16"
  }, p)),
  check: p => /*#__PURE__*/React.createElement(Icon, _extends({
    d: "m5 12 5 5L20 7"
  }, p)),
  refresh: p => /*#__PURE__*/React.createElement(Icon, _extends({
    d: "M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"
  }, p)),
  zap: p => /*#__PURE__*/React.createElement(Icon, _extends({
    d: "M13 2 4 14h7l-1 8 9-12h-7l1-8Z"
  }, p)),
  folder: p => /*#__PURE__*/React.createElement(Icon, _extends({
    d: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"
  }, p)),
  user: p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "8",
    r: "4"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M4 21a8 8 0 0 1 16 0"
  })),
  settings: p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "3"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
  })),
  bookmark: p => /*#__PURE__*/React.createElement(Icon, _extends({
    d: "M19 21 12 16 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z"
  }, p)),
  film: p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("rect", {
    x: "3",
    y: "3",
    width: "18",
    height: "18",
    rx: "2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M3 9h18M3 15h18M9 3v18M15 3v18"
  })),
  type: p => /*#__PURE__*/React.createElement(Icon, _extends({
    d: "M4 7V5h16v2M9 20h6M12 5v15"
  }, p)),
  palette: p => /*#__PURE__*/React.createElement(Icon, _extends({
    d: "M12 3a9 9 0 1 0 9 9c0-1-1-2-2-2h-2a2 2 0 0 1-2-2v-1a2 2 0 0 1 2-2h1a2 2 0 0 0 2-2 9 9 0 0 0-8-2Z"
  }, p), /*#__PURE__*/React.createElement("circle", {
    cx: "7.5",
    cy: "10.5",
    r: "1"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "8.5",
    cy: "14.5",
    r: "1"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "7.5",
    r: "1"
  })),
  dims: p => /*#__PURE__*/React.createElement(Icon, _extends({
    d: "M3 3v18h18M7 17V9m-4 4h4m10 0h4m-4 4V9"
  }, p)),
  play: p => /*#__PURE__*/React.createElement(Icon, _extends({
    d: "M6 4v16l14-8L6 4Z",
    fill: "currentColor"
  }, p)),
  stop: p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("rect", {
    x: "6",
    y: "6",
    width: "12",
    height: "12",
    rx: "1.5",
    fill: "currentColor"
  })),
  bolt: p => /*#__PURE__*/React.createElement(Icon, _extends({
    d: "M11 3 3 14h7l-1 7 9-11h-7l1-7Z"
  }, p)),
  attach: p => /*#__PURE__*/React.createElement(Icon, _extends({
    d: "M21 12.8 13 21a5 5 0 0 1-7-7l8.5-8.5a3 3 0 1 1 4.2 4.2L10 18a1 1 0 1 1-1.4-1.4L15 10"
  }, p)),
  eye: p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("path", {
    d: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "3"
  })),
  copy: p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("rect", {
    x: "9",
    y: "9",
    width: "11",
    height: "11",
    rx: "2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
  })),
  share: p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("circle", {
    cx: "18",
    cy: "5",
    r: "3"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "6",
    cy: "12",
    r: "3"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "18",
    cy: "19",
    r: "3"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"
  })),
  filter: p => /*#__PURE__*/React.createElement(Icon, _extends({
    d: "M3 5h18M6 12h12M10 19h4"
  }, p)),
  chevronDown: p => /*#__PURE__*/React.createElement(Icon, _extends({
    d: "m6 9 6 6 6-6"
  }, p)),
  chevronRight: p => /*#__PURE__*/React.createElement(Icon, _extends({
    d: "m9 6 6 6-6 6"
  }, p)),
  file: p => /*#__PURE__*/React.createElement(Icon, _extends({
    d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6ZM14 2v6h6"
  }, p)),
  dot: p => /*#__PURE__*/React.createElement(Icon, p, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "3",
    fill: "currentColor"
  })),
  edit: p => /*#__PURE__*/React.createElement(Icon, _extends({
    d: "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5Z"
  }, p)),
  externalLink: p => /*#__PURE__*/React.createElement(Icon, _extends({
    d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"
  }, p))
};
window.I = I;
window.Icon = Icon;

// src/Utils.jsx
// Striped / gradient placeholder imagery. No hand-drawn illustrations.

const hashHue = s => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = h * 31 + s.charCodeAt(i) | 0;
  return Math.abs(h) % 360;
};
const Stripe = ({
  label,
  ratio = '4/5',
  tone = 'neutral',
  seed = 'x',
  tag
}) => {
  const hue = tone === 'accent' ? 275 : tone === 'warm' ? 40 : hashHue(seed);
  const light = tone === 'accent' ? 0.92 : 0.96;
  const light2 = tone === 'accent' ? 0.88 : 0.93;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      aspectRatio: ratio,
      position: 'relative',
      borderRadius: 8,
      overflow: 'hidden',
      background: `repeating-linear-gradient(135deg, oklch(${light} 0.02 ${hue}) 0 8px, oklch(${light2} 0.025 ${hue}) 8px 16px)`,
      border: '1px solid var(--line-2)'
    }
  }, label && /*#__PURE__*/React.createElement("div", {
    className: "mono",
    style: {
      position: 'absolute',
      left: 8,
      top: 8,
      fontSize: 9,
      letterSpacing: '0.02em',
      color: `oklch(0.45 0.05 ${hue})`,
      textTransform: 'uppercase'
    }
  }, label), tag && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      right: 8,
      bottom: 8,
      fontSize: 10,
      color: `oklch(0.35 0.05 ${hue})`,
      background: 'rgba(255,255,255,0.85)',
      backdropFilter: 'blur(4px)',
      padding: '2px 6px',
      borderRadius: 4
    }
  }, tag));
};
const Swatch = ({
  color,
  label
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    minWidth: 0
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    height: 28,
    borderRadius: 6,
    background: color,
    border: '1px solid rgba(0,0,0,0.05)'
  }
}), /*#__PURE__*/React.createElement("div", {
  className: "mono",
  style: {
    fontSize: 9,
    color: 'var(--ink-3)',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  }
}, label));
window.Stripe = Stripe;
window.Swatch = Swatch;

// src/TopBar.jsx
// Polls /health every 30s and renders compact status icons.

const STATUS_COLORS = {
  loading: 'var(--warn)',
  ok: 'var(--ok)',
  err: 'oklch(0.6 0.18 25)'
};
const StatusIcon = ({
  title,
  fetchUrl,
  okKey,
  icon: Icon,
  renderDetail,
  placement = 'bottom'
}) => {
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
    const onDown = e => {
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
  return /*#__PURE__*/React.createElement("div", {
    ref: wrapRef,
    style: {
      position: 'relative',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("button", {
    title: title + '：' + text,
    "aria-label": title + '：' + text,
    onClick: clickable ? () => setOpen(v => !v) : undefined,
    style: {
      width: 28,
      height: 28,
      borderRadius: 7,
      background: open ? 'var(--accent-soft)' : 'var(--panel-2)',
      border: '1px solid ' + (open ? 'var(--accent)' : 'var(--line-2)'),
      display: 'grid',
      placeItems: 'center',
      position: 'relative',
      color: 'var(--ink-2)',
      cursor: clickable ? 'pointer' : 'default'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'grid',
      placeItems: 'center'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    size: 13,
    stroke: 2
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      right: 4,
      bottom: 4,
      width: 6,
      height: 6,
      borderRadius: 99,
      background: color,
      boxShadow: '0 0 0 2px ' + (open ? 'var(--accent-soft)' : 'var(--panel-2)'),
      transition: 'background 300ms'
    }
  }), pulse && /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      right: 2,
      bottom: 2,
      width: 10,
      height: 10,
      borderRadius: 99,
      background: color,
      opacity: 0.22,
      animation: 'statusPulse 1.6s ease-in-out infinite'
    }
  })), open && detail && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      ...(placement === 'top' ? {
        bottom: 'calc(100% + 8px)',
        top: 'auto'
      } : {
        top: 'calc(100% + 8px)'
      }),
      right: 0,
      minWidth: 180,
      padding: 10,
      borderRadius: 8,
      background: 'var(--panel)',
      border: '1px solid var(--line)',
      boxShadow: '0 10px 24px rgba(0,0,0,0.12)',
      zIndex: 30
    }
  }, detail), /*#__PURE__*/React.createElement("style", null, `@keyframes statusPulse{0%,100%{transform:scale(1);opacity:.22}50%{transform:scale(1.7);opacity:0}}`));
};
const InspirationCurveIcon = () => {
  const groupRef = React.useRef(null);
  const pathRef = React.useRef(null);
  const particlesRef = React.useRef([]);
  React.useEffect(function () {
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
      point: function (progress, detailScale, cfg) {
        const t = progress * Math.PI * 2;
        const petals = Math.round(cfg.petalCount);
        const radius = cfg.amplitude * detailScale * Math.cos(petals * t);
        return {
          x: 50 + radius * Math.cos(t) * cfg.curveScale,
          y: 50 + radius * Math.sin(t) * cfg.curveScale
        };
      }
    };
    const normalizeProgress = function (progress) {
      return (progress % 1 + 1) % 1;
    };
    const buildPath = function (detailScale, steps) {
      return Array.from({
        length: steps + 1
      }, function (_, index) {
        const point = config.point(index / steps, detailScale, config);
        return (index === 0 ? 'M' : 'L') + ' ' + point.x.toFixed(2) + ' ' + point.y.toFixed(2);
      }).join(' ');
    };
    const getDetailScale = function (time) {
      const pulseProgress = time % config.pulseDurationMs / config.pulseDurationMs;
      const pulseAngle = pulseProgress * Math.PI * 2;
      return 0.52 + (Math.sin(pulseAngle + 0.55) + 1) / 2 * 0.48;
    };
    const getParticle = function (index, progress, detailScale) {
      const tailOffset = index / (config.particleCount - 1);
      const point = config.point(normalizeProgress(progress - tailOffset * config.trailSpan), detailScale, config);
      const fade = Math.pow(1 - tailOffset, 0.56);
      return {
        x: point.x,
        y: point.y,
        radius: 0.9 + fade * 2.7,
        opacity: 0.04 + fade * 0.96
      };
    };
    const startedAt = performance.now();
    let raf = 0;
    const render = function (now) {
      const time = now - startedAt;
      const progress = time % config.durationMs / config.durationMs;
      const detailScale = getDetailScale(time);
      const rotation = -(time % config.rotationDurationMs / config.rotationDurationMs) * 360;
      group.setAttribute('transform', 'rotate(' + rotation.toFixed(2) + ' 50 50)');
      path.setAttribute('d', buildPath(detailScale, 220));
      particles.forEach(function (node, index) {
        const particle = getParticle(index, progress, detailScale);
        node.setAttribute('cx', particle.x.toFixed(2));
        node.setAttribute('cy', particle.y.toFixed(2));
        node.setAttribute('r', (particle.radius * 0.78).toFixed(2));
        node.setAttribute('opacity', particle.opacity.toFixed(3));
      });
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return function () {
      cancelAnimationFrame(raf);
    };
  }, []);
  return /*#__PURE__*/React.createElement("span", {
    className: "inspiration-curve-icon",
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("svg", {
    width: "30",
    height: "30",
    viewBox: "0 0 100 100",
    fill: "none",
    style: {
      display: 'block'
    }
  }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("linearGradient", {
    id: "inspirationIconGradient",
    x1: "16",
    y1: "18",
    x2: "84",
    y2: "82",
    gradientUnits: "userSpaceOnUse"
  }, /*#__PURE__*/React.createElement("stop", {
    offset: "0%",
    stopColor: "#06b6d4"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "50%",
    stopColor: "#3b82f6"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "100%",
    stopColor: "#8b5cf6"
  }))), /*#__PURE__*/React.createElement("g", {
    ref: groupRef,
    className: "inspiration-curve-icon__dots"
  }, /*#__PURE__*/React.createElement("path", {
    ref: pathRef,
    stroke: "url(#inspirationIconGradient)",
    strokeWidth: "5.5",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    opacity: "0.14"
  }), Array.from({
    length: 64
  }).map(function (_, i) {
    return /*#__PURE__*/React.createElement("circle", {
      key: i,
      ref: function (node) {
        particlesRef.current[i] = node;
      },
      fill: "url(#inspirationIconGradient)"
    });
  }))));
};
const TopBar = ({
  user,
  onSwitchUser,
  currentView,
  onNavigate,
  onOpenInspiration,
  inspirationOpen
}) => {
  const isAgentPage = typeof window !== 'undefined' && /\/ui\/agent\.html(?:$|\?)/.test(window.location.href);
  React.useEffect(function () {
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
  const fmtBalance = n => {
    if (typeof n !== 'number') return '';
    return Math.min(n, 99.99).toFixed(2);
  };
  const renderAiProviderDetail = function (data) {
    const info = data && data.ai_provider;
    if (!info) return null;
    const apimart = info.apimart || info;
    const adobe = info.adobe2api || {};
    const sub2api = info.sub2api || {};
    const hasBalance = typeof apimart.remain_balance !== 'undefined';
    const line = function (name, node) {
      if (!node || node.configured === false && !node.connected && !node.message) return null;
      let state = '未配置';
      if (node.configured === false) state = '未配置';else if (node.throttled) state = '受限';else if (node.connected) state = '正常';else state = '异常';
      return name + ' ' + state;
    };
    const parts = [line('APIMart', apimart), line('订阅', sub2api), line('Adobe', adobe)].filter(Boolean);
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 4
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: 'var(--ink-2)'
      }
    }, parts.length ? parts.join(' · ') : '智能路由', hasBalance ? ` · 余额 $${fmtBalance(apimart.remain_balance)}` : ''), (apimart.message || adobe.message || sub2api.message) && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10.5,
        color: 'var(--ink-3)',
        lineHeight: 1.45
      }
    }, String(apimart.message || adobe.message || sub2api.message).slice(0, 120)));
  };
  window.renderAiProviderDetail = renderAiProviderDetail;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: 48,
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      padding: '0 14px',
      gap: 16,
      background: 'var(--panel)',
      borderBottom: '1px solid var(--line)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      minWidth: 180
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 22,
      height: 22,
      borderRadius: 6,
      background: 'linear-gradient(135deg, var(--ink) 0%, oklch(0.28 0.04 275) 100%)',
      display: 'grid',
      placeItems: 'center',
      color: 'white'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "12",
    height: "12",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.2",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M4 20 V6 M4 6 C10 6, 10 14, 16 14 C22 14, 22 6, 20 6"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 18,
      fontWeight: 600,
      letterSpacing: '-0.01em'
    }
  }, "Designflow"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--ink-3)',
      letterSpacing: '0.02em',
      marginTop: 1
    }
  }, "\u4E28  AI \u9A71\u52A8\u7684\u7535\u5546\u8BBE\u8BA1\u8D44\u4EA7\u751F\u6210\u5E73\u53F0"))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6
    }
  }, isAgentPage && /*#__PURE__*/React.createElement("a", {
    href: "/ui/",
    style: {
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
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(I.sparkles, {
    size: 12
  }), /*#__PURE__*/React.createElement("span", null, "\u4E3B\u5DE5\u4F5C\u53F0")), user && /*#__PURE__*/React.createElement("div", {
    className: "inspiration-flow",
    style: {
      height: 30,
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onOpenInspiration,
    title: "\u7075\u611F",
    className: "inspiration-flow__inner"
  }, /*#__PURE__*/React.createElement(InspirationCurveIcon, null), /*#__PURE__*/React.createElement("span", {
    className: "inspiration-flow__text"
  }, "\u7075\u611F"))), user && user.role === 'admin' && onNavigate && /*#__PURE__*/React.createElement("button", {
    onClick: () => onNavigate('#/admin'),
    title: "\u7BA1\u7406\u540E\u53F0",
    style: {
      height: 28,
      padding: '0 10px',
      borderRadius: 7,
      background: 'var(--panel-2)',
      border: '1px solid var(--line-2)',
      color: 'var(--ink-2)',
      fontSize: 11.5,
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "12",
    height: "12",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
  })), /*#__PURE__*/React.createElement("span", null, "\u7BA1\u7406")), user && React.createElement('div', {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginLeft: 6,
      padding: '4px 8px',
      borderRadius: 6,
      background: 'var(--panel-2)',
      border: '1px solid var(--line-2)'
    }
  }, React.createElement(I.user, {
    size: 12,
    style: {
      color: 'var(--ink-3)'
    }
  }), React.createElement('span', {
    style: {
      fontSize: 11.5,
      color: 'var(--ink)'
    }
  }, user.username), React.createElement('button', {
    onClick: onSwitchUser,
    title: '切换身份',
    style: {
      width: 22,
      height: 22,
      borderRadius: 5,
      background: 'var(--panel)',
      border: '1px solid var(--line)',
      color: 'var(--ink-3)',
      display: 'grid',
      placeItems: 'center',
      cursor: 'pointer'
    }
  }, React.createElement(I.refresh, {
    size: 11
  })))));
};
window.TopBar = TopBar;
window.StatusIcon = StatusIcon;

// src/TemplatePanel.jsx
const CATS = ['All', 'Social', 'E-commerce', 'Brand', 'Print', 'Web', 'Packaging'];
function formatAiModelName(model) {
  if (!model) return 'AI 生图';
  var map = {
    'gpt-image-2': 'Gpt image 2',
    'gemini-3-pro-image-preview': 'Nano Banano pro'
  };
  return map[model] || model;
}

// 从后端 TemplateInfo 推导显示用的 cat / ratio / tone / tag
function deriveTemplateMeta(t) {
  const {
    width = 400,
    height = 400,
    slots = []
  } = t;
  const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
  const g = gcd(Math.round(width), Math.round(height));
  const ratio = width / g + '/' + height / g;
  const productSlots = (slots || []).filter(function (s) {
    return (s.name || '').replace(/ /g, '').startsWith('slot/product_');
  });
  const uniqGroups = new Set(productSlots.map(function (s) {
    return (s.name || '').split('/')[1];
  })).size;
  return {
    ratio: ratio,
    tone: 'neutral',
    tag: uniqGroups > 0 ? uniqGroups + '格' : ratio,
    cat: 'E-commerce'
  };
}

// 初始为空，API返回后填充（见 useEffect）
const TEMPLATES = [];

// 懒加载真实缩略图，进入视口后才请求
function LazyThumb(_ref2) {
  var t = _ref2.t;
  var ref = React.useRef(null);
  var _React$useState = React.useState(null),
    src = _React$useState[0],
    setSrc = _React$useState[1];
  var _React$useState2 = React.useState(false),
    failed = _React$useState2[0],
    setFailed = _React$useState2[1];
  React.useEffect(function () {
    var el = ref.current;
    if (!el) return;
    var observer = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) {
        observer.disconnect();
        setSrc(window.API.getTemplateThumbnailUrl(t.id, t.page_id, t.file_id));
      }
    }, {
      rootMargin: '120px'
    });
    observer.observe(el);
    return function () {
      observer.disconnect();
    };
  }, [t.id, t.page_id, t.file_id]);
  return React.createElement('div', {
    ref: ref,
    style: {
      aspectRatio: t.ratio || '1/1',
      position: 'relative',
      borderRadius: 8,
      overflow: 'hidden',
      background: 'var(--panel-2)',
      border: '1px solid var(--line-2)'
    }
  }, src && !failed && React.createElement('img', {
    src: src,
    alt: t.name,
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    },
    onError: function () {
      setFailed(true);
    }
  }), (!src || failed) && React.createElement(Stripe, {
    label: t.name.split(' ')[0],
    ratio: t.ratio || '1/1',
    tone: t.tone || 'neutral',
    seed: t.id,
    tag: t.tag || t.name
  }));
}
const TemplateCard = function (_ref) {
  var t = _ref.t,
    active = _ref.active,
    onClick = _ref.onClick;
  return React.createElement('button', {
    onClick: onClick,
    style: {
      display: 'block',
      textAlign: 'left',
      padding: 6,
      borderRadius: 10,
      border: active ? '1.5px solid var(--accent)' : '1px solid transparent',
      background: active ? 'var(--accent-soft)' : 'transparent',
      transition: 'all 120ms ease',
      position: 'relative'
    },
    onMouseEnter: function (e) {
      if (!active) e.currentTarget.style.background = 'var(--panel-2)';
    },
    onMouseLeave: function (e) {
      if (!active) e.currentTarget.style.background = 'transparent';
    }
  }, React.createElement(LazyThumb, {
    t: t
  }), React.createElement('div', {
    style: {
      padding: '6px 2px 2px',
      display: 'flex',
      alignItems: 'center',
      gap: 5
    }
  }, React.createElement('div', {
    style: {
      fontSize: 11.5,
      fontWeight: 500,
      color: 'var(--ink)',
      flex: 1,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, t.name), t.frames && t.frames.length > 1 && React.createElement('span', {
    className: 'mono',
    style: {
      fontSize: 8,
      color: 'var(--accent-ink)',
      background: 'var(--accent-soft)',
      padding: '1px 4px',
      borderRadius: 3,
      letterSpacing: '0.04em'
    }
  }, t.frames.length + '板'), t.pro && React.createElement('span', {
    className: 'mono',
    style: {
      fontSize: 8,
      color: 'var(--accent-ink)',
      background: 'var(--accent-soft)',
      padding: '1px 4px',
      borderRadius: 3,
      letterSpacing: '0.04em'
    }
  }, 'PRO')), active && React.createElement('div', {
    style: {
      position: 'absolute',
      top: 10,
      right: 10,
      width: 18,
      height: 18,
      borderRadius: 99,
      background: 'var(--accent)',
      color: 'white',
      display: 'grid',
      placeItems: 'center',
      boxShadow: '0 2px 6px oklch(0.55 0.22 275 / 0.35)'
    }
  }, React.createElement(I.check, {
    size: 11,
    stroke: 3
  })));
};

// 已用时计时器，每秒刷新，仅在 running 状态使用
var ElapsedTimer = function (props) {
  var createdAt = props.createdAt; // unix timestamp (seconds)
  var _s = React.useState(Math.max(0, Math.floor(Date.now() / 1000 - createdAt)));
  var elapsed = _s[0],
    setElapsed = _s[1];
  React.useEffect(function () {
    var id = setInterval(function () {
      setElapsed(Math.max(0, Math.floor(Date.now() / 1000 - createdAt)));
    }, 1000);
    return function () {
      clearInterval(id);
    };
  }, [createdAt]);
  var m = Math.floor(elapsed / 60),
    s = elapsed % 60;
  var label = m > 0 ? m + 'm ' + String(s).padStart(2, '0') + 's' : s + 's';
  return React.createElement('span', {
    className: 'mono',
    style: {
      fontSize: 10,
      color: 'var(--accent)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, label);
};
var PANEL_TABS = [{
  id: 'templates',
  label: '模板'
}, {
  id: 'history',
  label: '历史记录'
}, {
  id: 'mcp',
  label: 'MCP',
  soon: true
}];
var TemplatePanel = function (_ref2) {
  var activeId = _ref2.activeId,
    onSelect = _ref2.onSelect,
    collapsed = _ref2.collapsed;
  var _useState = React.useState('templates'),
    tab = _useState[0],
    setTab = _useState[1];
  var _useState2 = React.useState({
      general: true,
      special: true
    }),
    collapsedSections = _useState2[0],
    setCollapsedSections = _useState2[1];
  var _useState3 = React.useState(''),
    q = _useState3[0],
    setQ = _useState3[1];
  var _useState4 = React.useState([]),
    templates = _useState4[0],
    setTemplates = _useState4[1];
  var _useState5 = React.useState(true),
    loading = _useState5[0],
    setLoading = _useState5[1];
  var _useState6 = React.useState(null),
    loadErr = _useState6[0],
    setLoadErr = _useState6[1];
  var _useState7 = React.useState([]),
    historyJobs = _useState7[0],
    setHistoryJobs = _useState7[1];
  var _useState8 = React.useState(false),
    historyLoading = _useState8[0],
    setHistoryLoading = _useState8[1];
  React.useEffect(function () {
    if (tab !== 'templates') return;
    setLoading(true);
    setLoadErr(null);
    window.API.fetchTemplates().then(function (data) {
      var raw = (data || []).map(function (t) {
        return Object.assign({}, t, deriveTemplateMeta(t));
      });

      // ── 按 file_id + group_name 聚合，跨文件同名 page 不互相干扰 ──────────
      var groupMap = {};
      var groupOrder = [];
      raw.forEach(function (t) {
        var gname = t.group_name || t.name;
        // 分组 key 带 file_id，防止不同文件的同名 page 被错误合并
        var gkey = (t.file_id || '') + ':' + gname;
        if (!groupMap[gkey]) {
          groupMap[gkey] = {
            id: t.id,
            name: gname,
            group_name: gname,
            page_id: t.page_id,
            file_id: t.file_id,
            width: t.width,
            height: t.height,
            ratio: t.ratio,
            tone: t.tone,
            tag: t.tag,
            cat: t.cat,
            slots: t.slots,
            is_special: t.is_special || false,
            is_special_full: t.is_special_full || false,
            frames: []
          };
          groupOrder.push(gkey);
        }
        groupMap[gkey].frames.push(t);
        if (t.slots && t.slots.length > groupMap[gkey].slots.length) {
          groupMap[gkey].slots = t.slots;
        }
      });
      var groups = groupOrder.map(function (gkey) {
        return groupMap[gkey];
      });
      setTemplates(groups);
      window.TEMPLATES = groups;
    }).catch(function (err) {
      console.error('[TemplatePanel] fetchTemplates failed:', err);
      setLoadErr(String(err));
    }).finally(function () {
      setLoading(false);
    });
  }, [tab]);
  React.useEffect(function () {
    if (tab !== 'history') return;
    console.log('[TemplatePanel] Loading history...');
    setHistoryLoading(true);
    Promise.all([window.API.listComposes(50).catch(function () {
      return [];
    }), window.API.listSpecialComposes(50).catch(function () {
      return [];
    }), window.API.listAiImages(50).catch(function () {
      return [];
    })]).then(function (results) {
      var normal = (results[0] || []).map(function (j) {
        return Object.assign({}, j, {
          _type: 'normal'
        });
      });
      var special = (results[1] || []).map(function (j) {
        return Object.assign({}, j, {
          _type: 'special'
        });
      });
      var aiImages = (results[2] || []).map(function (j) {
        return Object.assign({}, j, {
          _type: 'ai-image'
        });
      });
      var merged = normal.concat(special, aiImages).sort(function (a, b) {
        return (b.created_at || 0) - (a.created_at || 0);
      });
      console.log('[TemplatePanel] History merged:', merged.length, 'jobs');
      setHistoryJobs(merged);
    }).catch(function (err) {
      console.error('[TemplatePanel] History load failed:', err);
    }).finally(function () {
      setHistoryLoading(false);
    });
  }, [tab]);

  // 分组为文件夹
  var sections = [{
    key: 'general',
    label: '通用模板',
    items: templates.filter(function (t) {
      return !t.is_special && !t.is_special_full;
    })
  }, {
    key: 'special',
    label: '特殊品',
    items: templates.filter(function (t) {
      return t.is_special || t.is_special_full;
    })
  }];

  // 搜索过滤
  var filteredSections = sections.map(function (s) {
    if (!q) return s;
    return {
      key: s.key,
      label: s.label,
      items: s.items.filter(function (t) {
        return t.name.toLowerCase().includes(q.toLowerCase());
      })
    };
  });
  var toggleSection = function (key) {
    setCollapsedSections(function (prev) {
      var next = Object.assign({}, prev);
      next[key] = !prev[key];
      return next;
    });
  };
  var isCollapsed = function (key) {
    return !!collapsedSections[key];
  };
  return React.createElement('div', {
    style: {
      position: 'relative',
      width: 260,
      flex: '0 0 260px',
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--panel)',
      borderRight: '1px solid var(--line)',
      transform: collapsed ? 'translateX(-260px)' : 'translateX(0)',
      transition: 'transform 180ms ease',
      pointerEvents: collapsed ? 'none' : 'auto'
    }
  }, React.createElement('div', {
    style: {
      display: 'flex',
      flexShrink: 0,
      height: 44,
      borderBottom: '1px solid var(--line)',
      padding: '0 10px',
      gap: 2,
      alignItems: 'center'
    }
  }, PANEL_TABS.map(function (t) {
    return React.createElement('button', {
      key: t.id,
      onClick: function () {
        if (!t.soon) setTab(t.id);
      },
      style: {
        height: '100%',
        padding: '0 10px',
        fontSize: 12,
        fontWeight: tab === t.id ? 600 : 400,
        color: t.soon ? 'var(--ink-3)' : tab === t.id ? 'var(--ink)' : 'var(--ink-2)',
        borderBottom: tab === t.id ? '2px solid var(--ink)' : '2px solid transparent',
        marginBottom: -1,
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        cursor: t.soon ? 'default' : 'pointer',
        transition: 'color 120ms'
      }
    }, t.label, t.soon && React.createElement('span', {
      className: 'mono',
      style: {
        fontSize: 8,
        padding: '1px 4px',
        borderRadius: 3,
        background: 'var(--panel-2)',
        border: '1px solid var(--line)',
        color: 'var(--ink-3)',
        letterSpacing: '0.03em'
      }
    }, 'soon'));
  })), tab === 'templates' && React.createElement('div', {
    style: {
      flex: 1,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    }
  }, React.createElement('div', {
    style: {
      padding: '10px 14px 8px',
      flexShrink: 0
    }
  }, React.createElement('div', {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 7,
      padding: '7px 10px',
      borderRadius: 7,
      background: 'var(--panel-2)',
      border: '1px solid var(--line-2)'
    }
  }, React.createElement(I.search, {
    size: 13,
    style: {
      color: 'var(--ink-3)'
    }
  }), React.createElement('input', {
    value: q,
    onChange: function (e) {
      setQ(e.target.value);
    },
    placeholder: '搜索模板…',
    style: {
      flex: 1,
      border: 'none',
      outline: 'none',
      background: 'transparent',
      fontSize: 12,
      color: 'var(--ink)'
    }
  }), React.createElement('button', {
    title: '刷新模板（清除缩略图缓存）',
    onClick: function () {
      setLoading(true);
      setLoadErr(null);
      window.API.clearTemplateCache().catch(function () {}).finally(function () {
        setTab('history');
        setTimeout(function () {
          setTab('templates');
        }, 50);
      });
    },
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 22,
      height: 22,
      borderRadius: 5,
      flexShrink: 0,
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      color: 'var(--ink-3)',
      transition: 'color 120ms'
    },
    onMouseEnter: function (e) {
      e.currentTarget.style.color = 'var(--ink)';
    },
    onMouseLeave: function (e) {
      e.currentTarget.style.color = 'var(--ink-3)';
    }
  }, React.createElement(I.refresh, {
    size: 13
  })))), loading && React.createElement('div', {
    style: {
      flex: 1,
      minHeight: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      color: 'var(--ink-3)',
      fontSize: 12
    }
  }, React.createElement('span', {
    style: {
      animation: 'spin 1s linear infinite',
      display: 'inline-block'
    }
  }, '⟳'), '加载模板…'), !loading && loadErr && React.createElement('div', {
    style: {
      flex: 1,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      color: '#e53',
      fontSize: 11,
      padding: 16,
      textAlign: 'center'
    }
  }, React.createElement('div', null, '加载失败'), React.createElement('div', {
    style: {
      color: 'var(--ink-3)',
      fontSize: 10
    }
  }, String(loadErr))), !loading && !loadErr && React.createElement('div', {
    style: {
      flex: 1,
      minHeight: 0,
      overflowY: 'auto',
      padding: '0 14px 56px'
    }
  }, filteredSections.map(function (section) {
    var colA = section.items.filter(function (_, i) {
      return i % 2 === 0;
    });
    var colB = section.items.filter(function (_, i) {
      return i % 2 === 1;
    });
    var collapsed = isCollapsed(section.key);
    return React.createElement('div', {
      key: section.key,
      style: {
        marginBottom: 8
      }
    }, React.createElement('div', {
      onClick: function () {
        toggleSection(section.key);
      },
      style: {
        padding: '8px 10px',
        margin: '0 0 8px',
        fontSize: 12,
        fontWeight: 650,
        color: 'var(--ink)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        cursor: 'pointer',
        userSelect: 'none',
        borderRadius: 7,
        background: collapsed ? 'transparent' : 'var(--panel-2)',
        border: '1px solid var(--line-2)',
        transition: 'background 120ms, border-color 120ms, transform 120ms'
      },
      onMouseEnter: function (e) {
        e.currentTarget.style.background = collapsed ? 'var(--panel-2)' : 'var(--panel)';
        e.currentTarget.style.borderColor = 'var(--line)';
        e.currentTarget.style.transform = 'translateY(-1px)';
      },
      onMouseLeave: function (e) {
        e.currentTarget.style.background = collapsed ? 'transparent' : 'var(--panel-2)';
        e.currentTarget.style.borderColor = 'var(--line-2)';
        e.currentTarget.style.transform = 'translateY(0)';
      }
    }, React.createElement('span', {
      style: {
        width: 12,
        color: 'var(--ink-3)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 13,
        fontWeight: 500,
        lineHeight: 1,
        transition: 'transform 150ms, color 120ms',
        transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
        flexShrink: 0
      }
    }, '>'), React.createElement('span', {
      style: {
        flex: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }
    }, section.label), React.createElement('span', {
      className: 'mono',
      style: {
        color: 'var(--ink-3)',
        fontSize: 10,
        fontWeight: 600,
        lineHeight: 1
      }
    }, section.items.length)), !collapsed && (section.items.length > 0 ? React.createElement('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 4
      }
    }, React.createElement('div', {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 4
      }
    }, colA.map(function (t) {
      var tkey = (t.file_id || '') + ':' + (t.group_name || t.id);
      return React.createElement(TemplateCard, {
        key: tkey,
        t: t,
        active: activeId === tkey,
        onClick: function () {
          return onSelect(t);
        }
      });
    })), React.createElement('div', {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 4
      }
    }, colB.map(function (t) {
      var tkey = (t.file_id || '') + ':' + (t.group_name || t.id);
      return React.createElement(TemplateCard, {
        key: tkey,
        t: t,
        active: activeId === tkey,
        onClick: function () {
          return onSelect(t);
        }
      });
    }))) : React.createElement('div', {
      style: {
        padding: '8px 12px',
        fontSize: 11,
        color: 'var(--ink-3)'
      }
    }, '暂无模板')));
  }))), tab === 'history' && React.createElement('div', {
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      overflow: 'hidden'
    }
  }, historyLoading && React.createElement('div', {
    style: {
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      color: 'var(--ink-3)',
      fontSize: 12
    }
  }, React.createElement('span', {
    style: {
      animation: 'spin 1s linear infinite',
      display: 'inline-block'
    }
  }, '⟳'), '加载中…'), !historyLoading && historyJobs.length === 0 && React.createElement('div', {
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      color: 'var(--ink-3)'
    }
  }, React.createElement(I.layers, {
    size: 24,
    style: {
      opacity: 0.3
    }
  }), React.createElement('div', {
    style: {
      fontSize: 12
    }
  }, '暂无历史记录')), !historyLoading && historyJobs.length > 0 && React.createElement('div', {
    style: {
      flex: 1,
      minHeight: 0,
      overflowY: 'auto',
      padding: '12px 10px'
    }
  }, historyJobs.map(function (job, idx) {
    var isSpecial = job._type === 'special';
    var isAiImage = job._type === 'ai-image';
    var statusColor = job.status === 'done' ? 'var(--ok)' : job.status === 'failed' ? '#e53' : 'var(--accent)';
    var timeStr = job.created_at ? new Date(job.created_at * 1000).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }) : '';
    // 缩略图：特殊品取第一帧 url，普通合成取 getImageUrl
    var thumbUrl = null;
    if (job.status === 'done') {
      if (isAiImage) {
        var apiBaseAi = window.API_BASE || window.location.origin;
        thumbUrl = job.image_url ? apiBaseAi + job.image_url : null;
      } else if (isSpecial) {
        var firstFrame = job.frames && job.frames.find(function (f) {
          return f.url;
        });
        var apiBase = window.API_BASE || window.location.origin;
        thumbUrl = firstFrame ? apiBase + firstFrame.url : null;
      } else {
        thumbUrl = window.API.getImageUrl(job.id);
      }
    }
    var subtitle = isAiImage ? (formatAiModelName(job.model) || 'AI 生图') + (job.has_reference ? '  图生图' : '  文生图') + (job.size ? '  ' + job.size : '') : isSpecial ? (job.sku ? 'SKU: ' + job.sku : '特殊品') + (job.frames ? '  ' + job.frames.length + ' 张' : '') : job.request && job.request.slots ? Object.keys(job.request.slots).length + ' 个产品' : '';
    var titleText = isAiImage ? 'AI 生图 · ' + (job.status === 'done' ? '已完成' : job.status === 'failed' ? '失败' : '生成中') : (job.sku ? job.sku + '_特殊品' : isSpecial ? '特殊品' : '合成') + ' · ' + (job.status === 'done' ? '已完成' : job.status === 'failed' ? '失败' : '生成中');
    return React.createElement('div', {
      key: job.id || idx,
      style: {
        padding: '10px 12px',
        borderRadius: 8,
        border: '1px solid var(--line)',
        background: 'var(--panel-2)',
        marginBottom: 8,
        cursor: 'pointer'
      },
      onClick: function () {
        console.log('[History] Clicked job:', job.id, 'penpot:', job.penpot_edit_url);
        if (isAiImage && job.status === 'done' && thumbUrl) {
          window.open(thumbUrl, '_blank');
        } else if (job.status === 'done' && job.penpot_edit_url) {
          window.open(job.penpot_edit_url, '_blank');
        }
      }
    }, React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: thumbUrl ? 8 : 0
      }
    }, thumbUrl && React.createElement('img', {
      src: thumbUrl,
      style: {
        width: 48,
        height: 48,
        objectFit: 'cover',
        borderRadius: 6,
        flexShrink: 0,
        background: 'var(--panel)'
      },
      onError: function (e) {
        e.target.style.display = 'none';
      }
    }), React.createElement('div', {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 2
      }
    }, job.status !== 'done' && job.status !== 'failed' ? React.createElement('span', {
      style: {
        width: 10,
        height: 10,
        borderRadius: 99,
        flexShrink: 0,
        boxSizing: 'border-box',
        border: '1.5px solid oklch(0.85 0.04 275)',
        borderTopColor: 'var(--accent)',
        animation: 'spin 0.75s linear infinite',
        display: 'inline-block'
      }
    }) : React.createElement('span', {
      style: {
        width: 6,
        height: 6,
        borderRadius: 99,
        background: statusColor,
        flexShrink: 0
      }
    }), React.createElement('span', {
      style: {
        flex: 1,
        fontSize: 12,
        fontWeight: 500,
        color: 'var(--ink)'
      }
    }, titleText), job.status !== 'done' && job.status !== 'failed' && job.created_at ? React.createElement(ElapsedTimer, {
      createdAt: job.created_at
    }) : React.createElement('span', {
      style: {
        fontSize: 10,
        color: 'var(--ink-3)'
      }
    }, timeStr)), subtitle && React.createElement('div', {
      style: {
        fontSize: 11,
        color: 'var(--ink-2)',
        paddingLeft: 14
      }
    }, subtitle), isAiImage && job.prompt && React.createElement('div', {
      style: {
        fontSize: 10.5,
        color: 'var(--ink-3)',
        paddingLeft: 14,
        marginTop: 4,
        lineHeight: 1.45,
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden'
      }
    }, job.prompt))));
  }))), React.createElement(StatusFooter, {
    count: templates.length,
    collapsed: collapsed
  }));
};
var StatusFooter = function (_ref3) {
  var count = _ref3.count,
    collapsed = _ref3.collapsed;
  return React.createElement('div', {
    style: {
      position: 'fixed',
      bottom: 0,
      left: 0,
      width: 260,
      zIndex: 100,
      transform: collapsed ? 'translateX(-260px)' : 'translateX(0)',
      transition: 'transform 180ms ease',
      pointerEvents: collapsed ? 'none' : 'auto',
      borderTop: '1px solid var(--line)',
      background: 'var(--panel-2)',
      padding: '8px 10px',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      boxSizing: 'border-box'
    }
  }, React.createElement(I.layers, {
    size: 11,
    style: {
      color: 'var(--ink-3)'
    }
  }), React.createElement('span', {
    className: 'mono',
    style: {
      fontSize: 11,
      color: 'var(--ink-3)',
      flex: 1
    }
  }, count + ' 个模板'), React.createElement(window.StatusIcon, {
    title: '后端服务',
    fetchUrl: '/health',
    icon: I.settings,
    placement: 'top'
  }), React.createElement(window.StatusIcon, {
    title: '素材库',
    fetchUrl: '/health',
    okKey: 'library',
    icon: I.folder,
    placement: 'top'
  }), React.createElement(window.StatusIcon, {
    title: 'AI 服务商',
    fetchUrl: '/health/deep',
    okKey: 'ai_provider',
    icon: I.sparkles,
    renderDetail: window.renderAiProviderDetail,
    placement: 'top'
  }));
};
window.TemplatePanel = TemplatePanel;
window.TEMPLATES = TEMPLATES;

// src/Canvas.jsx
// Main canvas — now simplified to just show the selected template preview.

const Canvas = ({
  template,
  resultTemplate,
  editorCommand,
  onUseReferenceImages,
  userId
}) => {
  const t = template;
  const hasResult = resultTemplate != null;
  const iframeRef = React.useRef(null);
  const editorReadyRef = React.useRef(false);
  const pendingMessageRef = React.useRef(null);
  const [iframeNonce, setIframeNonce] = React.useState(0);
  const [editorInsertState, setEditorInsertState] = React.useState(null);
  const editorSrc = React.useMemo(() => {
    const params = new URLSearchParams({
      v: String(Date.now())
    });
    if (userId) params.set('user_id', String(userId));
    return `/editor-beta/index.html?${params.toString()}`;
  }, [userId]);
  const postToEditor = React.useCallback(message => {
    const win = iframeRef.current && iframeRef.current.contentWindow;
    if (!win) return false;
    win.postMessage(message, '*');
    return true;
  }, []);
  const markEditorReady = React.useCallback(() => {
    editorReadyRef.current = true;
    if (pendingMessageRef.current) {
      postToEditor(pendingMessageRef.current);
      pendingMessageRef.current = null;
    }
  }, [postToEditor]);

  // 接收编辑器的 ready 信号，用于命令就绪判定（不控制 UI 可见性）
  React.useEffect(() => {
    const handleMessage = event => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'designflow:editor-ready') {
        markEditorReady();
      } else if (data.type === 'designflow:editor-inserted') {
        setEditorInsertState({
          status: 'done',
          message: '已放入画布'
        });
      } else if (data.type === 'designflow:editor-error') {
        setEditorInsertState({
          status: 'failed',
          message: data.message || '放入画布失败'
        });
      } else if (data.type === 'designflow:use-as-reference') {
        const images = Array.isArray(data.images) ? data.images.filter(function (item) {
          return item && typeof item.src === 'string' && item.src.trim();
        }) : [];
        if (onUseReferenceImages) {
          onUseReferenceImages(images);
        }
      }
    };
    window.addEventListener('message', handleMessage);

    // 主动 ping iframe，解决缓存加载时序导致的 ready 消息丢失
    let pingCount = 0;
    const ping = () => {
      pingCount++;
      postToEditor({
        type: 'designflow:ping'
      });
      if (pingCount < 30 && !editorReadyRef.current) {
        setTimeout(ping, 400);
      }
    };
    setTimeout(ping, 200);
    return () => window.removeEventListener('message', handleMessage);
  }, [markEditorReady, onUseReferenceImages, postToEditor]);
  React.useEffect(() => {
    editorReadyRef.current = false;
  }, [iframeNonce, t && t.id]);
  React.useEffect(() => {
    if (!editorCommand) return;
    const normalizeAssetUrl = rawUrl => {
      const value = String(rawUrl || '').trim();
      if (!value) return '';
      const publicPrefixes = ['/ai-images/', '/results/', '/output/', '/avatars/'];
      const isPublicPath = pathname => publicPrefixes.some(prefix => pathname.startsWith(prefix)) || /^\/compose\/[^/]+\/image\/?$/.test(pathname) || pathname.startsWith('/export/grid/');
      try {
        const parsed = new URL(value, window.location.origin);
        if (isPublicPath(parsed.pathname)) {
          return parsed.pathname + parsed.search + parsed.hash;
        }
        return parsed.toString();
      } catch (e) {
        return value;
      }
    };
    const message = editorCommand.type === 'insert-images' ? {
      type: 'designflow:insert-image',
      urls: (editorCommand.urls || []).map(normalizeAssetUrl).filter(Boolean),
      mode: editorCommand.mode,
      name: editorCommand.name
    } : {
      type: 'designflow:new-canvas',
      pageName: editorCommand.pageName || t?.name || '画板 1'
    };
    if (editorCommand.type === 'insert-images') {
      setEditorInsertState({
        status: 'running',
        message: '正在放入画布'
      });
    }
    if (editorReadyRef.current) {
      postToEditor(message);
    } else {
      pendingMessageRef.current = message;
      postToEditor({
        type: 'designflow:ping'
      });
    }
    if (editorCommand.type === 'insert-images') {
      const timer = setTimeout(() => {
        setEditorInsertState(prev => {
          if (!prev || prev.status !== 'running') return prev;
          return {
            status: 'failed',
            message: '放入画布超时，请刷新后重试'
          };
        });
      }, 60000);
      return () => clearTimeout(timer);
    }
  }, [editorCommand, postToEditor, t]);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0,
      minHeight: 0,
      overflow: 'hidden',
      background: 'var(--panel-2)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 44,
      flexShrink: 0,
      borderBottom: '1px solid var(--line)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 16px',
      gap: 10,
      background: 'var(--panel)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      color: 'var(--ink-3)',
      fontSize: 10,
      textTransform: 'uppercase',
      letterSpacing: '0.06em'
    }
  }, "\u7F16\u8F91\u5668"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--ink)',
      fontWeight: 500
    }
  }, t?.name || '空白画布'), hasResult && /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      fontSize: 10,
      color: 'var(--ok)',
      padding: '2px 6px',
      borderRadius: 4,
      background: 'rgba(0,128,96,0.08)',
      border: '1px solid rgba(0,128,96,0.16)'
    }
  }, "\u5DF2\u63A5\u6536\u7ED3\u679C\u56FE"), editorInsertState && /*#__PURE__*/React.createElement("span", {
    className: "mono",
    title: editorInsertState.message,
    style: {
      fontSize: 10,
      color: editorInsertState.status === 'failed' ? 'var(--warn)' : editorInsertState.status === 'done' ? 'var(--ok)' : 'var(--ink-3)',
      padding: '2px 6px',
      borderRadius: 4,
      background: editorInsertState.status === 'failed' ? 'rgba(180,35,24,0.08)' : 'rgba(0,128,96,0.08)',
      border: editorInsertState.status === 'failed' ? '1px solid rgba(180,35,24,0.16)' : '1px solid rgba(0,128,96,0.16)'
    }
  }, editorInsertState.message)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, window.lastComposeJobId && /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      const frames = resultTemplate && resultTemplate._frameNames || (resultTemplate?.frames || []).map(f => f.name || f.variant || '画板');
      const names = frames.join(',');
      const ep = window.lastComposeEndpoint || '/special-compose';
      window.open(`${ep}/${window.lastComposeJobId}/download-zip?names=${encodeURIComponent(names)}`, '_blank');
    },
    style: canvasActionSecondaryStyle
  }, "\u6253\u5305\u4E0B\u8F7D"), window.resultPenpotUrl && /*#__PURE__*/React.createElement("button", {
    onClick: () => window.open(window.resultPenpotUrl, '_blank'),
    style: canvasActionSecondaryStyle
  }, "Penpot"))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      position: 'relative',
      background: 'oklch(0.98 0.003 260)'
    }
  }, /*#__PURE__*/React.createElement("iframe", {
    key: iframeNonce,
    ref: iframeRef,
    src: editorSrc,
    title: "Designflow Editor",
    style: {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      border: 'none',
      background: 'transparent'
    }
  })));
};
const canvasActionPrimaryStyle = {
  fontSize: 12,
  padding: '6px 14px',
  borderRadius: 6,
  background: 'var(--ink)',
  color: 'white',
  border: '1px solid var(--ink)',
  cursor: 'pointer'
};
const canvasActionSecondaryStyle = {
  fontSize: 12,
  padding: '6px 14px',
  borderRadius: 6,
  background: 'var(--panel)',
  color: 'var(--ink)',
  border: '1px solid var(--line)',
  cursor: 'pointer'
};

// 结果展示：用 TemplatePreview 相同的 FrameThumb 布局渲染（结果看起来和模板预览完全一致）
const ResultPreview = ({
  t
}) => {
  const stageRef = React.useRef(null);
  const [box, setBox] = React.useState({
    w: 560,
    h: 480
  });
  React.useEffect(() => {
    if (!stageRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const {
          width,
          height
        } = e.contentRect;
        setBox({
          w: Math.max(200, width - 80),
          h: Math.max(200, height - 120)
        });
      }
    });
    ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, []);

  // 多画板：frames 数组；单画板：frames 为空，用 t 本身
  const frames = t.frames && t.frames.length > 0 ? t.frames : [t];
  const isMulti = frames.length > 1;
  const perMaxW = isMulti ? Math.floor((box.w - (frames.length - 1) * 24) / frames.length) : box.w;
  const perMaxH = isMulti ? box.h - 60 : box.h - 40;
  const cat = t.cat;
  return /*#__PURE__*/React.createElement("div", {
    ref: stageRef,
    style: {
      position: 'absolute',
      inset: 0,
      overflow: isMulti ? 'auto' : 'hidden',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'row',
      gap: 24,
      alignItems: 'flex-end',
      flexWrap: 'wrap',
      justifyContent: 'center'
    }
  }, frames.map((frame, i) => {
    const variantLabel = frame.variant || (isMulti ? frame.name : '');
    // 用 resultUrl 替代 thumbnail
    const resultUrl = frame.resultUrl;
    return React.createElement(FrameThumb, {
      key: frame.id,
      frame: Object.assign({}, frame, {
        ratio: frame.ratio || (frame.width && frame.height ? frame.width + '/' + frame.height : t.ratio || '1/1'),
        file_id: frame.file_id || t.file_id
      }),
      maxW: perMaxW,
      maxH: perMaxH,
      label: variantLabel,
      hd: false,
      resultUrl // 传给 FrameThumb：直接用结果 URL
    });
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      padding: '8px 12px',
      background: 'rgba(255,255,255,0.95)',
      borderRadius: 8,
      boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
      flexWrap: 'wrap',
      justifyContent: 'center'
    }
  }, window.lastComposeJobId && /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      const names = (t._frameNames || frames.map(f => f.name || f.variant || '')).join(',');
      const ep = window.lastComposeEndpoint || '/special-compose';
      window.open(`${ep}/${window.lastComposeJobId}/download-zip?names=${encodeURIComponent(names)}`, '_blank');
    },
    style: canvasActionPrimaryStyle
  }, "\u6253\u5305\u4E0B\u8F7D"), window.resultPenpotUrl && /*#__PURE__*/React.createElement("button", {
    onClick: () => window.open(window.resultPenpotUrl, '_blank'),
    style: canvasActionSecondaryStyle
  }, "\u5728Penpot\u4E2D\u7F16\u8F91"))));
};

// Translate ratio to pixel dimensions that fit nicely in the canvas area
const ratioToSize = (ratio, maxW, maxH) => {
  maxW = maxW || 560;
  maxH = maxH || 480;
  const [a, b] = ratio.split('/').map(Number);
  let w = maxW,
    h = b / a * maxW;
  if (h > maxH) {
    h = maxH;
    w = a / b * maxH;
  }
  return [Math.round(w), Math.round(h)];
};

// 从 API base url 推导 Penpot view URL
const getPenpotViewUrl = (fileId, pageId, frameId) => {
  // Penpot view-only 路由：/#/view/file-id/page-id?frame-id=xxx
  const base = window.API && window.API.BASE || window.location.origin;
  // Penpot 默认跑在 9001，API 跑在 8000，尝试从 hostname 拼出 penpot 地址
  let penpotOrigin;
  try {
    const u = new URL(base);
    penpotOrigin = u.protocol + '//' + u.hostname + ':9001';
  } catch (e) {
    penpotOrigin = window.location.protocol + '//' + window.location.hostname + ':9001';
  }
  return `${penpotOrigin}/#/view/${fileId}/${pageId}?frame-id=${frameId}&section=interactions&index=0`;
};

// 单个画板的预览卡片（主画布用 iframe 高清预览，缩略图模式用 img）
// resultUrl 存在时直接用该 URL（已缓存的结果图），不再调 API
const FrameThumb = ({
  frame,
  maxW,
  maxH,
  label,
  hd = false,
  resultUrl = null
}) => {
  const ratio = frame.ratio || (frame.width && frame.height ? frame.width + '/' + frame.height : '1/1');
  const [w, h] = ratioToSize(ratio, maxW, maxH);

  // hd 模式：嵌入 Penpot view iframe
  const [iframeReady, setIframeReady] = React.useState(false);
  const viewUrl = hd ? getPenpotViewUrl(frame.file_id, frame.page_id, frame.id) : null;

  // 非 hd：resultUrl 直接用；否则调 API 取缩略图
  const [src, setSrc] = React.useState(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    if (hd) return;
    setSrc(null);
    setFailed(false);
    if (resultUrl) {
      setSrc(resultUrl);
    } else {
      setSrc(window.API.getTemplateThumbnailUrl(frame.id, frame.page_id, frame.file_id));
    }
  }, [frame.id, frame.page_id, frame.file_id, hd, resultUrl]);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      width: w,
      height: h,
      background: 'white',
      borderRadius: 6,
      boxShadow: '0 30px 60px rgba(20,22,40,0.10), 0 4px 14px rgba(20,22,40,0.06), 0 0 0 1px var(--line)',
      overflow: 'hidden'
    }
  }, hd ? /*#__PURE__*/React.createElement(React.Fragment, null, !iframeReady && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      color: 'var(--ink-3)',
      fontSize: 11
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 20,
      height: 20,
      borderRadius: 99,
      border: '2px solid var(--line)',
      borderTopColor: 'var(--accent)',
      animation: 'spin 0.8s linear infinite'
    }
  }), /*#__PURE__*/React.createElement("span", null, "\u52A0\u8F7D\u9884\u89C8\u2026")), /*#__PURE__*/React.createElement("iframe", {
    src: viewUrl,
    style: {
      width: '100%',
      height: '100%',
      border: 'none',
      display: iframeReady ? 'block' : 'none'
    },
    onLoad: () => setIframeReady(true),
    title: label || frame.name,
    sandbox: "allow-scripts allow-same-origin"
  })) : src && !failed ? React.createElement('img', {
    src,
    alt: label,
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'contain',
      background: 'white'
    },
    onError: () => setFailed(true)
  }) : React.createElement(Stripe, {
    ratio: w + '/' + h,
    tone: 'neutral',
    seed: frame.id,
    label: label,
    tag: ratio.replace('/', ':')
  }), !hd && /*#__PURE__*/React.createElement(Handles, null)), label && /*#__PURE__*/React.createElement("div", {
    className: "mono",
    style: {
      fontSize: 10,
      color: 'var(--ink-3)',
      textTransform: 'uppercase',
      letterSpacing: '0.06em'
    }
  }, label));
};
const TemplatePreview = ({
  t
}) => {
  const stageRef = React.useRef(null);
  const [box, setBox] = React.useState({
    w: 560,
    h: 480
  });
  React.useEffect(() => {
    if (!stageRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const {
          width,
          height
        } = e.contentRect;
        setBox({
          w: Math.max(200, width - 80),
          h: Math.max(200, height - 120)
        });
      }
    });
    ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, []);

  // 多画板：frames 数组；单画板：frames 为空，用 t 本身
  const frames = t.frames && t.frames.length > 0 ? t.frames : [t];
  const isMulti = frames.length > 1;

  // 每个画板的最大尺寸：多画板时按数量缩小
  const perMaxW = isMulti ? Math.floor((box.w - (frames.length - 1) * 24) / frames.length) : box.w;
  const perMaxH = isMulti ? box.h - 60 : box.h - 40;
  const cat = t.cat;
  return /*#__PURE__*/React.createElement("div", {
    ref: stageRef,
    style: {
      position: 'absolute',
      inset: 0,
      overflow: isMulti ? 'auto' : 'hidden',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'row',
      gap: 24,
      alignItems: 'flex-end',
      flexWrap: 'wrap',
      justifyContent: 'center'
    }
  }, frames.map((frame, i) => {
    const variantLabel = frame.variant || (isMulti ? frame.name : '');
    return React.createElement(FrameThumb, {
      key: frame.id,
      frame: Object.assign({}, frame, {
        ratio: frame.ratio || (frame.width && frame.height ? frame.width + '/' + frame.height : t.ratio || '1/1'),
        file_id: frame.file_id || t.file_id
      }),
      maxW: perMaxW,
      maxH: perMaxH,
      label: variantLabel,
      hd: false
    });
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '6px 12px',
      borderRadius: 99,
      background: 'var(--panel)',
      border: '1px solid var(--line)',
      boxShadow: 'var(--shadow-1)',
      fontSize: 11,
      flexWrap: 'wrap',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      color: 'var(--ink-3)'
    }
  }, cat), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 3,
      height: 3,
      borderRadius: 99,
      background: 'var(--line)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      color: 'var(--ink-2)'
    }
  }, (t.ratio || '').replace('/', ':')), isMulti && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 3,
      height: 3,
      borderRadius: 99,
      background: 'var(--line)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      color: 'var(--ink-2)'
    }
  }, frames.length, " \u4E2A\u753B\u677F")), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 3,
      height: 3,
      borderRadius: 99,
      background: 'var(--line)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      color: 'var(--ink-2)'
    }
  }, Math.round(t.width), " \xD7 ", Math.round(t.height), " px"), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 3,
      height: 3,
      borderRadius: 99,
      background: 'var(--line)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--ink-2)'
    }
  }, "Ready for chat input"))));
};
const Handles = () => {
  const corners = [{
    top: -4,
    left: -4
  }, {
    top: -4,
    right: -4
  }, {
    bottom: -4,
    left: -4
  }, {
    bottom: -4,
    right: -4
  }];
  return /*#__PURE__*/React.createElement(React.Fragment, null, corners.map((c, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      position: 'absolute',
      ...c,
      width: 8,
      height: 8,
      background: 'white',
      border: '1.5px solid var(--accent)',
      borderRadius: 2
    }
  })));
};
const EmptyCanvas = () => /*#__PURE__*/React.createElement("div", {
  style: {
    textAlign: 'center',
    color: 'var(--ink-3)',
    fontSize: 13
  }
});
window.Canvas = Canvas;

// src/ChatExtras.jsx
// Slash commands, parse table, AI message list — additions to the chat surface.

const SLASH_COMMANDS = [{
  cmd: '/generate',
  cn: '开始生图',
  desc: 'Generate variations from current parameters',
  icon: 'zap',
  shortcut: '⌘⏎',
  group: 'Generation',
  available: false
}, {
  cmd: '/Nano Banana pro',
  cn: 'AI 生图',
  desc: '图生图超强一致性，改图更强',
  icon: 'image',
  group: 'Generation',
  available: true
}, {
  cmd: '/Gpt image 2',
  cn: 'AI 生图',
  desc: '文生图，超强中文渲染和语义理解',
  icon: 'image',
  group: 'Generation',
  available: true
}, {
  cmd: '/花瓣下载',
  cn: '花瓣下载',
  desc: '输入项目id即可解析素材完成下载',
  icon: 'download',
  group: 'Tools',
  available: true
}, {
  cmd: '/转PSD',
  cn: '图片分层',
  desc: '上传图片后按描述重绘透明图层并合成 PSD',
  icon: 'layers',
  group: 'Tools',
  available: false
}, {
  cmd: '/特殊品',
  cn: '特殊品合成',
  desc: '无素材特殊品模板',
  icon: 'grid',
  group: 'Generation',
  available: true
}, {
  cmd: '/特殊品（完整）',
  cn: '特殊品（完整）合成',
  desc: '支持场景图，发售时间和立即抢购等多版本',
  icon: 'layers',
  group: 'Generation',
  available: true
}, {
  cmd: '/analyze',
  cn: '分析素材',
  desc: 'Parse an uploaded image, brief, or CSV',
  icon: 'eye',
  group: 'Tools',
  available: false
}, {
  cmd: '/palette',
  cn: '提取配色',
  desc: 'Extract a palette from a reference',
  icon: 'palette',
  group: 'Tools',
  available: false
}, {
  cmd: '/resize',
  cn: '换尺寸',
  desc: 'Reflow the design into a new ratio',
  icon: 'dims',
  group: 'Tools',
  available: false
}, {
  cmd: '/copy',
  cn: '换文案',
  desc: 'Rewrite on-image copy',
  icon: 'type',
  group: 'Tools',
  available: false
}, {
  cmd: '/export-png',
  cn: '导出PNG',
  desc: 'Export selected option as PNG',
  icon: 'download',
  group: 'Export',
  available: false
}, {
  cmd: '/export-psd',
  cn: '导出PSD',
  desc: 'Export with editable layers',
  icon: 'download',
  group: 'Export',
  available: false
}, {
  cmd: '/share',
  cn: '分享链接',
  desc: 'Generate a review link',
  icon: 'share',
  group: 'Export',
  available: false
}];
const SlashMenu = ({
  query,
  onPick,
  onClose
}) => {
  const q = query.toLowerCase().replace(/^\//, '');
  const filtered = SLASH_COMMANDS.filter(c => !q || c.cmd.includes(q) || c.cn.includes(query.replace(/^\//, '')) || c.desc.toLowerCase().includes(q));
  const groups = filtered.reduce((acc, c) => {
    (acc[c.group] ||= []).push(c);
    return acc;
  }, {});
  const [hover, setHover] = React.useState(0);
  React.useEffect(() => setHover(0), [query]);
  React.useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHover(h => Math.min(filtered.length - 1, h + 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHover(h => Math.max(0, h - 1));
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (filtered[hover]?.available) {
          e.preventDefault();
          onPick(filtered[hover]);
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [filtered, hover, onPick, onClose]);
  if (filtered.length === 0) {
    return /*#__PURE__*/React.createElement("div", {
      style: slashMenuStyle
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        padding: 14,
        fontSize: 12,
        color: 'var(--ink-3)',
        textAlign: 'center'
      }
    }, "No command matches \"", query, "\""));
  }
  let idx = -1;
  return /*#__PURE__*/React.createElement("div", {
    style: slashMenuStyle
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '8px 12px 6px',
      fontSize: 10,
      color: 'var(--ink-3)',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      borderBottom: '1px solid var(--line-2)'
    },
    className: "mono"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      textTransform: 'uppercase',
      letterSpacing: '0.08em'
    }
  }, "Commands"), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("span", null, "\u2191\u2193 navigate \xB7 \u23CE pick \xB7 esc close")), /*#__PURE__*/React.createElement("div", {
    style: {
      maxHeight: 280,
      overflowY: 'auto',
      padding: 4
    }
  }, Object.entries(groups).map(([g, items]) => /*#__PURE__*/React.createElement("div", {
    key: g
  }, /*#__PURE__*/React.createElement("div", {
    className: "mono",
    style: {
      padding: '6px 10px 2px',
      fontSize: 9.5,
      color: 'var(--ink-3)',
      textTransform: 'uppercase',
      letterSpacing: '0.07em'
    }
  }, g), items.map(c => {
    idx++;
    const active = idx === hover;
    return /*#__PURE__*/React.createElement("button", {
      key: c.cmd,
      onMouseEnter: (i => () => setHover(i))(idx),
      disabled: !c.available,
      onClick: () => {
        if (c.available) onPick(c);
      },
      style: {
        width: '100%',
        textAlign: 'left',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '7px 10px',
        borderRadius: 6,
        background: active ? 'var(--accent-soft)' : 'transparent',
        opacity: c.available ? 1 : 0.52,
        cursor: c.available ? 'pointer' : 'not-allowed'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: 22,
        height: 22,
        borderRadius: 5,
        background: active ? 'var(--accent)' : 'var(--panel-2)',
        color: active ? 'white' : 'var(--ink-2)',
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0
      }
    }, I[c.icon] ? I[c.icon]({
      size: 12
    }) : /*#__PURE__*/React.createElement(I.bolt, {
      size: 12
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'baseline',
        gap: 6
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "mono",
      style: {
        fontSize: 11.5,
        fontWeight: 500,
        color: active ? 'var(--accent-ink)' : 'var(--ink)'
      }
    }, c.cmd), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 10.5,
        color: 'var(--ink-3)'
      }
    }, c.cn), c.available ? /*#__PURE__*/React.createElement("span", {
      title: "Available",
      style: {
        width: 6,
        height: 6,
        borderRadius: 99,
        background: '#22c55e',
        flexShrink: 0,
        marginLeft: 2
      }
    }) : /*#__PURE__*/React.createElement("span", {
      className: "mono",
      style: {
        fontSize: 9,
        color: 'var(--ink-3)',
        marginLeft: 2
      }
    }, "Soon")), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10.5,
        color: 'var(--ink-3)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }
    }, c.desc)), c.shortcut && /*#__PURE__*/React.createElement("kbd", {
      className: "mono",
      style: {
        fontSize: 9.5,
        color: 'var(--ink-3)',
        padding: '1px 5px',
        borderRadius: 3,
        border: '1px solid var(--line)'
      }
    }, c.shortcut));
  })))));
};
const slashMenuStyle = {
  position: 'absolute',
  bottom: 'calc(100% + 6px)',
  left: 0,
  right: 0,
  background: 'var(--panel)',
  border: '1px solid var(--line)',
  borderRadius: 10,
  boxShadow: '0 8px 32px rgba(20,22,40,0.10), 0 2px 6px rgba(20,22,40,0.04)',
  overflow: 'hidden',
  zIndex: 20
};

// ---------- Parse table (structured analysis output) ----------

const ParseTable = ({
  title,
  subtitle,
  rows,
  source
}) => {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%',
      borderRadius: 10,
      background: 'var(--panel)',
      border: '1px solid var(--line-2)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '9px 12px',
      borderBottom: '1px solid var(--line-2)',
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 20,
      height: 20,
      borderRadius: 5,
      background: 'var(--accent-soft)',
      color: 'var(--accent-ink)',
      display: 'grid',
      placeItems: 'center'
    }
  }, /*#__PURE__*/React.createElement(I.file, {
    size: 11
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      fontWeight: 600
    }
  }, title), subtitle && /*#__PURE__*/React.createElement("div", {
    className: "mono",
    style: {
      fontSize: 9.5,
      color: 'var(--ink-3)'
    }
  }, subtitle)), source && /*#__PURE__*/React.createElement("div", {
    className: "mono",
    style: {
      fontSize: 9.5,
      color: 'var(--ink-3)',
      padding: '2px 6px',
      borderRadius: 4,
      background: 'var(--panel-2)',
      border: '1px solid var(--line-2)'
    }
  }, source)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '92px 1fr 54px',
      fontSize: 11
    }
  }, /*#__PURE__*/React.createElement(HeadCell, null, "Field"), /*#__PURE__*/React.createElement(HeadCell, null, "Value"), /*#__PURE__*/React.createElement(HeadCell, {
    right: true
  }, "Conf."), rows.map((r, i) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: i
  }, /*#__PURE__*/React.createElement(Cell, {
    top: i > 0
  }, /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      color: 'var(--ink-3)',
      fontSize: 10,
      textTransform: 'uppercase',
      letterSpacing: '0.04em'
    }
  }, r.field)), /*#__PURE__*/React.createElement(Cell, {
    top: i > 0
  }, r.editable ? /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: '2px 6px',
      borderRadius: 4,
      background: 'var(--panel-2)',
      border: '1px dashed var(--line)',
      fontSize: 11,
      color: 'var(--ink)'
    }
  }, r.value, /*#__PURE__*/React.createElement(I.type, {
    size: 9,
    style: {
      color: 'var(--ink-3)'
    }
  })) : /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--ink)'
    }
  }, r.value), r.note && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: 'var(--ink-3)',
      marginTop: 2
    }
  }, r.note)), /*#__PURE__*/React.createElement(Cell, {
    top: i > 0,
    right: true
  }, /*#__PURE__*/React.createElement(ConfBadge, {
    conf: r.conf
  }))))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '8px 12px',
      borderTop: '1px solid var(--line-2)',
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      background: 'var(--panel-2)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      fontSize: 10,
      color: 'var(--ink-3)'
    }
  }, rows.length, " fields parsed"), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("button", {
    style: ghostBtn
  }, "Edit"), /*#__PURE__*/React.createElement("button", {
    style: {
      ...ghostBtn,
      background: 'var(--ink)',
      color: 'white',
      border: 'none'
    }
  }, "Apply to design")));
};
const HeadCell = ({
  children,
  right
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    padding: '6px 12px',
    fontSize: 9.5,
    color: 'var(--ink-3)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    fontFamily: 'JetBrains Mono, monospace',
    borderBottom: '1px solid var(--line-2)',
    background: 'var(--panel-2)',
    textAlign: right ? 'right' : 'left'
  }
}, children);
const Cell = ({
  children,
  right,
  top
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    padding: '8px 12px',
    borderTop: top ? '1px solid var(--line-2)' : 'none',
    textAlign: right ? 'right' : 'left',
    minWidth: 0
  }
}, children);
const ConfBadge = ({
  conf
}) => {
  const map = {
    high: {
      l: 'High',
      c: 'var(--ok)',
      bg: 'oklch(0.95 0.04 155)'
    },
    med: {
      l: 'Med',
      c: 'var(--warn)',
      bg: 'oklch(0.96 0.04 70)'
    },
    low: {
      l: 'Low',
      c: 'oklch(0.55 0.15 25)',
      bg: 'oklch(0.95 0.04 25)'
    }
  }[conf] || {
    l: '–',
    c: 'var(--ink-3)',
    bg: 'var(--panel-2)'
  };
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-block',
      fontSize: 9.5,
      fontWeight: 500,
      padding: '1px 6px',
      borderRadius: 99,
      color: map.c,
      background: map.bg
    }
  }, map.l);
};
const ghostBtn = {
  fontSize: 11,
  padding: '4px 9px',
  borderRadius: 5,
  border: '1px solid var(--line)',
  background: 'var(--panel)',
  color: 'var(--ink-2)'
};

// ---------- AI structured message list ----------

const MessageList = ({
  title,
  items
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    width: '100%',
    borderRadius: 10,
    background: 'var(--panel)',
    border: '1px solid var(--line-2)',
    overflow: 'hidden'
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    padding: '9px 12px',
    borderBottom: '1px solid var(--line-2)',
    display: 'flex',
    alignItems: 'center',
    gap: 7
  }
}, /*#__PURE__*/React.createElement(I.layers, {
  size: 12,
  style: {
    color: 'var(--ink-2)'
  }
}), /*#__PURE__*/React.createElement("span", {
  style: {
    fontSize: 11.5,
    fontWeight: 600
  }
}, title), /*#__PURE__*/React.createElement("div", {
  style: {
    flex: 1
  }
}), /*#__PURE__*/React.createElement("span", {
  className: "mono",
  style: {
    fontSize: 9.5,
    color: 'var(--ink-3)'
  }
}, items.length, " items")), /*#__PURE__*/React.createElement("div", null, items.map((it, i) => /*#__PURE__*/React.createElement("div", {
  key: i,
  style: {
    padding: '9px 12px',
    borderTop: i > 0 ? '1px solid var(--line-2)' : 'none',
    display: 'flex',
    gap: 10,
    alignItems: 'flex-start'
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    width: 18,
    height: 18,
    borderRadius: 5,
    flexShrink: 0,
    background: it.kind === 'warn' ? 'oklch(0.96 0.04 70)' : it.kind === 'ok' ? 'oklch(0.95 0.04 155)' : 'var(--accent-soft)',
    color: it.kind === 'warn' ? 'var(--warn)' : it.kind === 'ok' ? 'var(--ok)' : 'var(--accent-ink)',
    display: 'grid',
    placeItems: 'center'
  }
}, it.kind === 'warn' ? /*#__PURE__*/React.createElement(I.bolt, {
  size: 10
}) : it.kind === 'ok' ? /*#__PURE__*/React.createElement(I.check, {
  size: 11,
  stroke: 2.4
}) : /*#__PURE__*/React.createElement(I.dot, {
  size: 10
})), /*#__PURE__*/React.createElement("div", {
  style: {
    flex: 1,
    minWidth: 0
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    fontSize: 11.5,
    fontWeight: 500,
    color: 'var(--ink)'
  }
}, it.title), it.body && /*#__PURE__*/React.createElement("div", {
  style: {
    fontSize: 11,
    color: 'var(--ink-2)',
    marginTop: 2,
    lineHeight: 1.45
  }
}, it.body), it.action && /*#__PURE__*/React.createElement("button", {
  style: {
    marginTop: 6,
    fontSize: 10.5,
    padding: '3px 8px',
    borderRadius: 5,
    border: '1px solid var(--line)',
    color: 'var(--ink-2)',
    background: 'var(--panel-2)'
  }
}, it.action)), /*#__PURE__*/React.createElement("span", {
  className: "mono",
  style: {
    fontSize: 9.5,
    color: 'var(--ink-3)',
    flexShrink: 0
  }
}, String(i + 1).padStart(2, '0'))))));

// ---------- Slash command acknowledgement bubble ----------

const CommandEcho = ({
  cmd,
  cn
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 9px',
    borderRadius: 7,
    background: 'oklch(0.28 0.04 275)',
    color: 'white',
    fontSize: 11.5
  }
}, /*#__PURE__*/React.createElement(I.bolt, {
  size: 11,
  style: {
    color: 'oklch(0.85 0.15 275)'
  }
}), /*#__PURE__*/React.createElement("span", {
  className: "mono",
  style: {
    fontWeight: 500
  }
}, cmd), /*#__PURE__*/React.createElement("span", {
  style: {
    color: 'oklch(0.75 0.04 275)'
  }
}, cn));
window.SlashMenu = SlashMenu;
window.SLASH_COMMANDS = SLASH_COMMANDS;
window.ParseTable = ParseTable;
window.MessageList = MessageList;
window.CommandEcho = CommandEcho;

// src/Chat.jsx
// AI chat column. Three states: empty / generating / returned.
// Rich message types: text, option chips, file cards, action buttons, thinking trace, image results.

// ---------- Sub-components ----------

// 生图失败：用户可读原因
function formatAiImageError(raw, jobId, extras) {
  var msg = (raw == null ? '' : String(raw)).trim();
  if (!msg) {
    msg = '生成失败，没有返回具体原因，请稍后重试。';
  }
  // 去掉开发向尾巴
  msg = msg.replace(/请查后端日志[^\s。]*/g, '').replace(/请打开控制台[^\s。]*/g, '').replace(/并用 client 号对照后端日志[。]?/g, '').replace(/请复制反馈信息发给管理员[。]?/g, '').replace(/点下方「复制反馈信息」[^\s。]*/g, '').replace(/若多次失败，请复制反馈信息发给管理员[。]?/g, '').replace(/若反复出现，请复制反馈信息发给管理员[。]?/g, '').replace(/\s{2,}/g, ' ').replace(/[；;]\s*[。.]?\s*$/g, '。').trim();
  return msg || '生成失败，请稍后重试。';
}

// 出错直接弹窗，只显示错误本身
function alertAiImageError(raw, extras) {
  extras = extras || {};
  var msg = formatAiImageError(raw, extras.jobId, extras);
  var lines = ['生图失败', msg];
  if (extras.phaseLabel) lines.push('环节：' + extras.phaseLabel);
  if (extras.clientRequestId) lines.push('编号：' + extras.clientRequestId);
  if (extras.jobId) lines.push('任务：' + extras.jobId);
  try {
    window.alert(lines.join('\n'));
  } catch (_e) {}
}
function describeAiImageFailPhase(phase) {
  var map = {
    prepare: '提交前准备（素材/参考图）',
    network: '网络连接',
    timeout: '等待超时',
    submit: '提交任务',
    http: '服务响应',
    parse: '服务响应异常',
    poll: '查询进度',
    generate: '图片生成',
    download: '下载结果',
    poll_or_job: '生成或查询进度'
  };
  var key = String(phase || '').trim();
  return map[key] || (key ? key : '');
}

// 更新消息补丁：目标带 batchImageIndex 时落到批量卡对应那张图上，否则落到消息本身
function patchMessageOrImage(msgs, target, patch) {
  return msgs.map(function (m) {
    if (m.startedAt !== target.startedAt) return m;
    if (target.batchImageIndex == null || !Array.isArray(m.images)) return Object.assign({}, m, patch);
    return Object.assign({}, m, {
      images: m.images.map(function (im, i) {
        return i === target.batchImageIndex ? Object.assign({}, im, patch) : im;
      })
    });
  });
}

// 判断是否是「请求根本没到后端应用」类错误（浏览器网络层 / 连接被掐）
function isLikelyUnreachedServerError(err) {
  var name = err && err.name || '';
  var msg = String(err && err.message || err || '');
  if (name === 'AbortError') return true;
  if (err && err.phase === 'network') return true;
  if (err && err.unreached) return true;
  return /Failed to fetch|NetworkError|Load failed|network connection was lost|Internet connection appears to be offline|Could not connect|ECONNREFUSED|ENOTFOUND|ERR_CONNECTION|ERR_NETWORK|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|The request timed out|NS_ERROR_FAILURE|Network request failed/i.test(msg);
}
function isTerminalAiImagePollStatus(status) {
  return [400, 401, 403, 404].includes(Number(status));
}

// 把 fetch/提交异常翻译成用户可读中文（技术细节进反馈包，不堆在主文案）
function classifyAiImageSubmitError(err, meta) {
  meta = meta || {};
  var attempt = meta.attempt || 1;
  var online = typeof navigator !== 'undefined' ? navigator.onLine : true;
  var name = err && err.name || '';
  var raw = String(err && err.message || err || '').trim() || '网络异常';
  var retryHint = attempt > 1 ? '（已自动重试）' : '';

  // 服务端已返回 HTTP（有 status）
  if (err && err.httpStatus) {
    var status = err.httpStatus;
    if (status === 401) {
      return '登录已失效，请重新登录后再试。';
    }
    if (status === 413) {
      return '参考图或请求内容过大，请压缩图片后再试。';
    }
    if (status === 502 || status === 503 || status === 504) {
      return '服务暂时繁忙或维护中' + retryHint + '，请稍后再试。';
    }
    // 业务错误原文通常已是中文，直接展示
    if (raw && !/^HTTP\s*\d+/i.test(raw) && raw.length > 2) {
      return raw;
    }
    return '提交失败（错误码 ' + status + '），请稍后重试。';
  }

  // JSON 解析失败
  if (/Unexpected token|JSON\.parse|is not valid JSON|Failed to execute 'json'/i.test(raw)) {
    return '服务返回异常，请稍后重试。';
  }

  // 客户端超时
  if (name === 'AbortError' || /aborted|超时|timed out/i.test(raw)) {
    return '提交超时' + retryHint + '。可能是网络较慢或参考图较大，请检查网络后重试。';
  }

  // 典型「请求未到达」
  if (isLikelyUnreachedServerError(err)) {
    if (!online) {
      return '当前网络似乎已断开，请连上网络后重试。';
    }
    return '网络不稳定，请求可能没有成功发出' + retryHint + '。请检查网络后重试。';
  }
  return raw.indexOf('提交') === 0 || raw.indexOf('生成') === 0 || raw.indexOf('网络') === 0 ? raw : '提交失败：' + raw;
}
function newClientRequestId() {
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
var AI_IMAGE_CLIENT_EVENT_KEY = 'designflow.aiImageClientEvents';
var AI_IMAGE_CLIENT_EVENT_MAX = 30;
function readAiImageClientEvents() {
  try {
    var raw = sessionStorage.getItem(AI_IMAGE_CLIENT_EVENT_KEY);
    var list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (_e) {
    return [];
  }
}
function pushAiImageClientEvent(event) {
  var entry = Object.assign({
    ts: new Date().toISOString(),
    online: typeof navigator !== 'undefined' ? navigator.onLine : null,
    href: typeof location !== 'undefined' ? location.href : '',
    apiBase: typeof window !== 'undefined' ? window.API_BASE || window.location.origin : '',
    ua: typeof navigator !== 'undefined' ? String(navigator.userAgent || '').slice(0, 160) : ''
  }, event || {});
  try {
    var list = readAiImageClientEvents();
    list.push(entry);
    while (list.length > AI_IMAGE_CLIENT_EVENT_MAX) list.shift();
    sessionStorage.setItem(AI_IMAGE_CLIENT_EVENT_KEY, JSON.stringify(list));
  } catch (_e) {}
  try {
    console.info('[ai-image-event]', entry);
  } catch (_e2) {}
  return entry;
}

// 主请求失败时尽力上报一条轻量事件（主 POST 没到时，这条小 JSON 可能仍能到）
function reportAiImageClientEvent(event) {
  var entry = pushAiImageClientEvent(event);
  var apiBase = (typeof window !== 'undefined' ? window.API_BASE || window.location.origin : '') || '';
  var url = String(apiBase).replace(/\/$/, '') + '/ai-image/client-event';
  var body = JSON.stringify(entry);
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      var blob = new Blob([body], {
        type: 'application/json'
      });
      var ok = navigator.sendBeacon(url, blob);
      if (ok) return entry;
    }
  } catch (_e) {}
  try {
    fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Request-Id': entry.clientRequestId || entry.client || ''
      },
      body: body,
      keepalive: true
    }).catch(function () {});
  } catch (_e2) {}
  return entry;
}

// POST /ai-image：带 client 请求号、超时、网络失败自动重试 1 次
function postAiImageForm(apiBase, formData, options) {
  options = options || {};
  var maxAttempts = options.maxAttempts == null ? 2 : options.maxAttempts;
  var timeoutMs = options.timeoutMs || 120000;
  var clientRequestId = options.clientRequestId || newClientRequestId();
  var url = String(apiBase || '').replace(/\/$/, '') + '/ai-image';
  var attemptOnce = function (attempt) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = null;
    if (controller) {
      timer = setTimeout(function () {
        try {
          controller.abort();
        } catch (_e) {}
      }, timeoutMs);
    }
    var headers = {
      'X-Client-Request-Id': clientRequestId
    };
    if (attempt > 1) headers['X-Client-Retry'] = String(attempt - 1);
    return fetch(url, {
      method: 'POST',
      body: formData,
      credentials: 'include',
      signal: controller ? controller.signal : undefined,
      headers: headers
    }).then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) {
        return res.json().catch(function () {
          return {};
        }).then(function (errBody) {
          var detail = errBody && (errBody.detail || errBody.message || errBody.error);
          if (detail && typeof detail === 'object') {
            detail = detail.message || detail.error || JSON.stringify(detail);
          }
          var e = new Error(detail || 'HTTP ' + res.status);
          e.httpStatus = res.status;
          e.phase = 'http';
          e.clientRequestId = clientRequestId;
          e.body = errBody;
          throw e;
        });
      }
      return res.json().then(function (data) {
        if (data && typeof data === 'object') {
          data._clientRequestId = clientRequestId;
        }
        return data;
      }).catch(function (parseErr) {
        var e = new Error(parseErr && parseErr.message || '响应 JSON 解析失败');
        e.phase = 'parse';
        e.clientRequestId = clientRequestId;
        e.httpStatus = res.status;
        throw e;
      });
    }).catch(function (err) {
      if (timer) clearTimeout(timer);
      // 已经是我们包装过的 HTTP/解析错误：补中文分类后抛出（不重试业务错误）
      if (err && (err.httpStatus || err.phase === 'parse' || err.phase === 'http')) {
        err.clientRequestId = err.clientRequestId || clientRequestId;
        err.attempt = attempt;
        // 502/503/504 可视为瞬时故障，重试 1 次
        if (attempt < maxAttempts && err.httpStatus && [502, 503, 504].indexOf(err.httpStatus) >= 0) {
          console.warn('[ai-image] submit gateway fail, retry', {
            clientRequestId: clientRequestId,
            attempt: attempt,
            status: err.httpStatus
          });
          return new Promise(function (r) {
            setTimeout(r, 700 + Math.floor(Math.random() * 500));
          }).then(function () {
            return attemptOnce(attempt + 1);
          });
        }
        err.message = classifyAiImageSubmitError(err, {
          apiBase: apiBase,
          clientRequestId: clientRequestId,
          attempt: attempt
        });
        throw err;
      }
      var wrapped = err instanceof Error ? err : new Error(String(err || '网络错误'));
      if (wrapped.name === 'AbortError') {
        wrapped.phase = 'timeout';
        wrapped.unreached = true;
      } else if (!wrapped.phase) {
        wrapped.phase = 'network';
        wrapped.unreached = isLikelyUnreachedServerError(wrapped);
      }
      wrapped.clientRequestId = clientRequestId;
      wrapped.attempt = attempt;

      // 纯网络失败 / 超时：自动再试 1 次（FormData 可被多次序列化发送）
      if (attempt < maxAttempts && isLikelyUnreachedServerError(wrapped)) {
        console.warn('[ai-image] submit network fail, retry', {
          clientRequestId: clientRequestId,
          attempt: attempt,
          error: wrapped.message,
          apiBase: apiBase,
          online: typeof navigator !== 'undefined' ? navigator.onLine : null
        });
        return new Promise(function (r) {
          setTimeout(r, 600 + Math.floor(Math.random() * 400));
        }).then(function () {
          return attemptOnce(attempt + 1);
        });
      }
      wrapped.message = classifyAiImageSubmitError(wrapped, {
        apiBase: apiBase,
        clientRequestId: clientRequestId,
        attempt: attempt
      });
      throw wrapped;
    });
  };
  return attemptOnce(1);
}

// 生成耗时计时器，每秒刷新
const ChatTimer = ({
  startedAt
}) => {
  const [elapsed, setElapsed] = React.useState(Math.floor((Date.now() - startedAt) / 1000));
  React.useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  const m = Math.floor(elapsed / 60),
    s = elapsed % 60;
  return React.createElement('span', {
    className: 'mono',
    style: {
      fontSize: 11,
      color: 'var(--ink-3)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, m > 0 ? m + 'm ' + String(s).padStart(2, '0') + 's' : s + 's');
};
const Avatar = ({
  who,
  user
}) => {
  const [imgFailed, setImgFailed] = React.useState(false);
  const username = user && user.username ? user.username : '';
  const avatarUrl = username ? (window.API_BASE || window.location.origin) + '/avatars/' + encodeURIComponent(username) + '.png' : '';
  if (who === 'ai') {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        width: 24,
        height: 24,
        borderRadius: 7,
        flexShrink: 0,
        background: 'linear-gradient(135deg, var(--ink), oklch(0.3 0.08 275))',
        color: 'white',
        display: 'grid',
        placeItems: 'center'
      }
    }, /*#__PURE__*/React.createElement(I.sparkles, {
      size: 12,
      stroke: 2
    }));
  }
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: 24,
      height: 24,
      borderRadius: 7,
      flexShrink: 0,
      background: 'oklch(0.82 0.07 200)',
      color: 'oklch(0.3 0.05 200)',
      fontSize: 10,
      fontWeight: 600,
      display: 'grid',
      placeItems: 'center',
      overflow: 'hidden'
    }
  }, avatarUrl && !imgFailed ? /*#__PURE__*/React.createElement("img", {
    src: avatarUrl,
    alt: username,
    onError: () => setImgFailed(true),
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    }
  }) : username ? username[0] : '我');
};
const Bubble = ({
  who,
  children,
  meta,
  user
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    gap: 10,
    alignItems: 'flex-start',
    flexDirection: who === 'user' ? 'row-reverse' : 'row'
  }
}, /*#__PURE__*/React.createElement(Avatar, {
  who: who,
  user: user
}), /*#__PURE__*/React.createElement("div", {
  style: {
    maxWidth: 'calc(100% - 38px)',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    alignItems: who === 'user' ? 'flex-end' : 'flex-start'
  }
}, meta && /*#__PURE__*/React.createElement("div", {
  className: "mono",
  style: {
    fontSize: 9.5,
    color: 'var(--ink-3)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em'
  }
}, meta), children));

// 简易 Markdown → HTML 渲染（支持粗体、斜体、行内代码、列表、标题、链接）
const renderMarkdown = text => {
  if (!text) return '';
  let html = text;
  // 行内代码（优先，避免被后续规则干扰）
  html = html.replace(/`([^`]+)`/g, '<code style="background:var(--panel-2);padding:1px 5px;border-radius:4px;font-size:11.5px;font-family:monospace;">$1</code>');
  // 粗体
  html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  // 斜体
  html = html.replace(/\*(.+?)\*/g, '<i>$1</i>');
  // 链接
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color:var(--accent);">$1</a>');
  // 标题
  html = html.replace(/^### (.+)$/gm, '<h3 style="font-size:13px;font-weight:600;margin:4px 0 2px;">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 style="font-size:14px;font-weight:600;margin:6px 0 2px;">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 style="font-size:15px;font-weight:600;margin:6px 0 2px;">$1</h1>');
  // 无序列表
  html = html.replace(/^- (.+)$/gm, '<li style="margin-left:16px;">$1</li>');
  // 有序列表
  html = html.replace(/^\d+\. (.+)$/gm, '<li style="margin-left:16px;">$1</li>');
  // 换行
  html = html.replace(/\n/g, '<br/>');
  return html;
};
const TextBubble = ({
  who,
  children,
  markdown
}) => {
  const content = markdown && who === 'ai' ? renderMarkdown(children) : children;
  const renderUserSkillText = function (value) {
    const raw = String(value || '');
    const match = raw.match(/^(\$[A-Za-z0-9_-]+)(\s+)([\s\S]*)$/);
    if (!match) return raw;
    return React.createElement(React.Fragment, null, React.createElement('span', {
      style: {
        color: 'oklch(0.72 0.16 255)',
        fontWeight: 750
      }
    }, match[1]), match[2], React.createElement('span', null, match[3]));
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      lineHeight: 1.55,
      padding: '9px 12px',
      borderRadius: 10,
      background: who === 'user' ? 'var(--ink)' : 'var(--panel)',
      color: who === 'user' ? 'white' : 'var(--ink)',
      border: who === 'user' ? 'none' : '1px solid var(--line-2)',
      maxWidth: '100%'
    }
  }, who === 'ai' && markdown ? /*#__PURE__*/React.createElement("div", {
    dangerouslySetInnerHTML: {
      __html: content
    }
  }) : who === 'user' ? renderUserSkillText(content) : content);
};
const copyTextToClipboard = async text => {
  const value = String(text || '');
  if (!value) return false;
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return true;
  }
  const el = document.createElement('textarea');
  el.value = value;
  el.setAttribute('readonly', '');
  el.style.position = 'fixed';
  el.style.left = '-9999px';
  document.body.appendChild(el);
  el.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(el);
  return ok;
};
const CopyableTextBubble = ({
  who,
  text,
  markdown
}) => {
  const [hovered, setHovered] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const copyValue = String(text || '');
  const onCopy = React.useCallback(async function (e) {
    e.preventDefault();
    e.stopPropagation();
    try {
      const ok = await copyTextToClipboard(copyValue);
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1100);
      }
    } catch (err) {
      console.warn('copy message failed', err);
    }
  }, [copyValue]);
  return /*#__PURE__*/React.createElement("div", {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
    style: {
      maxWidth: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: who === 'user' ? 'flex-end' : 'flex-start',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement(TextBubble, {
    who: who,
    markdown: markdown
  }, copyValue), copyValue && /*#__PURE__*/React.createElement("button", {
    type: "button",
    title: copied ? '已复制' : '复制消息',
    "aria-label": copied ? '已复制' : '复制消息',
    onClick: onCopy,
    style: {
      height: 22,
      width: 22,
      padding: 0,
      borderRadius: 7,
      border: '1px solid var(--line-2)',
      background: who === 'user' ? 'var(--panel)' : 'transparent',
      color: copied ? 'var(--ok)' : 'var(--ink-2)',
      display: 'grid',
      placeItems: 'center',
      cursor: 'pointer',
      opacity: hovered || copied ? 1 : 0,
      transform: hovered || copied ? 'translateY(0)' : 'translateY(-2px)',
      pointerEvents: hovered || copied ? 'auto' : 'none',
      boxShadow: 'none',
      transition: 'opacity 120ms ease, transform 120ms ease, color 120ms ease',
      fontSize: 10.5,
      lineHeight: 1
    }
  }, copied ? /*#__PURE__*/React.createElement(I.check, {
    size: 11
  }) : /*#__PURE__*/React.createElement(I.copy, {
    size: 11
  })));
};

// 带反馈的复制按钮组件
var CopyButton2 = function (props) {
  var _useState = React.useState(false);
  var copied = _useState[0];
  var setCopied = _useState[1];
  var _errorState = React.useState(false);
  var copyFailed = _errorState[0];
  var setCopyFailed = _errorState[1];
  var value = String(props.jsonStr || '');
  return React.createElement('button', {
    type: 'button',
    disabled: !value,
    onClick: async function (e) {
      e.preventDefault();
      e.stopPropagation();
      try {
        var ok = await copyTextToClipboard(value);
        if (!ok) throw new Error('copy_failed');
        setCopyFailed(false);
        setCopied(true);
        setTimeout(function () {
          setCopied(false);
        }, 2000);
      } catch (err) {
        console.warn('copy json failed', err);
        setCopied(false);
        setCopyFailed(true);
        setTimeout(function () {
          setCopyFailed(false);
        }, 2000);
      }
    },
    style: {
      fontSize: 11,
      padding: '5px 14px',
      borderRadius: 5,
      background: copyFailed ? 'var(--warn)' : copied ? 'var(--ok)' : 'var(--ink)',
      color: 'white',
      border: 'none',
      cursor: value ? 'pointer' : 'default',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      opacity: value ? 1 : 0.45,
      transition: 'background 200ms'
    }
  }, React.createElement(copied ? I.check : I.copy, {
    size: 10
  }), copyFailed ? '复制失败' : copied ? '已复制 ' + (props.label || '') : '复制 ' + (props.label || 'JSON'));
};
const FileCard = ({
  name,
  size,
  type
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 12px',
    borderRadius: 8,
    background: 'var(--panel)',
    border: '1px solid var(--line-2)',
    fontSize: 12,
    minWidth: 200
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    width: 32,
    height: 40,
    borderRadius: 4,
    background: `repeating-linear-gradient(135deg, oklch(0.95 0.02 40) 0 4px, oklch(0.92 0.03 40) 4px 8px)`,
    border: '1px solid var(--line-2)',
    display: 'grid',
    placeItems: 'center',
    color: 'oklch(0.5 0.05 40)'
  }
}, /*#__PURE__*/React.createElement(I.image, {
  size: 14
})), /*#__PURE__*/React.createElement("div", {
  style: {
    flex: 1,
    minWidth: 0
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    fontWeight: 500,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  }
}, name), /*#__PURE__*/React.createElement("div", {
  className: "mono",
  style: {
    fontSize: 10,
    color: 'var(--ink-3)'
  }
}, type, " \xB7 ", size)));
const InlineRefStrip = ({
  items,
  compact
}) => {
  if (!Array.isArray(items) || items.length === 0) return null;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      flexWrap: 'wrap'
    }
  }, items.map((src, idx) => /*#__PURE__*/React.createElement("img", {
    key: idx,
    src: src,
    alt: '参考图 ' + (idx + 1),
    style: {
      width: compact ? 44 : 48,
      height: compact ? 44 : 48,
      borderRadius: 6,
      objectFit: 'cover',
      border: '1px solid var(--line-2)',
      background: 'white'
    }
  })));
};
const ThinkingTrace = ({
  steps,
  done
}) => {
  const [expanded, setExpanded] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      borderRadius: 10,
      border: '1px solid var(--line-2)',
      background: 'var(--panel-2)',
      overflow: 'hidden',
      width: '100%'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setExpanded(e => !e),
    style: {
      width: '100%',
      textAlign: 'left',
      padding: '8px 11px',
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(I.chevronRight, {
    size: 11,
    style: {
      transform: expanded ? 'rotate(90deg)' : 'none',
      transition: 'transform 120ms'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      fontWeight: 500
    }
  }, done ? 'Reasoned for 4 steps' : 'Thinking…'), /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      fontSize: 10,
      color: 'var(--ink-3)'
    }
  }, done ? '2.1s' : ''), !done && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: 99,
      background: 'var(--accent)',
      animation: 'pulse 1.2s ease-in-out infinite'
    }
  })), expanded && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '2px 11px 10px 28px',
      borderTop: '1px solid var(--line-2)'
    }
  }, steps.map((s, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      fontSize: 11.5,
      color: 'var(--ink-2)',
      padding: '5px 0',
      display: 'flex',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      color: 'var(--ink-3)',
      minWidth: 14
    }
  }, i + 1), /*#__PURE__*/React.createElement("span", null, s)))));
};
const OptionChips = ({
  title,
  options,
  multi
}) => {
  const [picked, setPicked] = React.useState(multi ? [options[0]] : options[0]);
  const isPicked = o => multi ? picked.includes(o) : picked === o;
  const toggle = o => {
    if (multi) setPicked(p => p.includes(o) ? p.filter(x => x !== o) : [...p, o]);else setPicked(o);
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      borderRadius: 10,
      padding: 12,
      width: '100%',
      background: 'var(--panel)',
      border: '1px solid var(--line-2)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      fontWeight: 500,
      color: 'var(--ink)',
      marginBottom: 8
    }
  }, title), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 5
    }
  }, options.map(o => /*#__PURE__*/React.createElement("button", {
    key: o,
    onClick: () => toggle(o),
    style: {
      fontSize: 11.5,
      padding: '4px 10px',
      borderRadius: 99,
      background: isPicked(o) ? 'var(--ink)' : 'var(--panel-2)',
      color: isPicked(o) ? 'white' : 'var(--ink-2)',
      border: '1px solid',
      borderColor: isPicked(o) ? 'var(--ink)' : 'var(--line-2)',
      transition: 'all 100ms'
    }
  }, o))));
};
const ColorPalette = ({
  palettes
}) => {
  const [picked, setPicked] = React.useState(0);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      borderRadius: 10,
      padding: 12,
      width: '100%',
      background: 'var(--panel)',
      border: '1px solid var(--line-2)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      fontWeight: 500,
      marginBottom: 8
    }
  }, "Pick a palette"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6
    }
  }, palettes.map((p, i) => /*#__PURE__*/React.createElement("button", {
    key: i,
    onClick: () => setPicked(i),
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: 6,
      borderRadius: 7,
      background: picked === i ? 'var(--accent-soft)' : 'transparent',
      border: picked === i ? '1px solid var(--accent)' : '1px solid transparent',
      textAlign: 'left'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      borderRadius: 5,
      overflow: 'hidden',
      border: '1px solid rgba(0,0,0,0.05)'
    }
  }, p.colors.map(c => /*#__PURE__*/React.createElement("div", {
    key: c,
    style: {
      width: 18,
      height: 22,
      background: c
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      fontWeight: 500
    }
  }, p.name), /*#__PURE__*/React.createElement("div", {
    className: "mono",
    style: {
      fontSize: 9.5,
      color: 'var(--ink-3)'
    }
  }, p.tag)), picked === i && /*#__PURE__*/React.createElement(I.check, {
    size: 13,
    stroke: 2.2,
    style: {
      color: 'var(--accent)'
    }
  })))));
};
const ActionRow = ({
  primary,
  secondary
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    gap: 6,
    width: '100%'
  }
}, /*#__PURE__*/React.createElement("button", {
  style: {
    flex: 1,
    fontSize: 12,
    fontWeight: 500,
    padding: '9px 12px',
    borderRadius: 8,
    background: 'var(--accent)',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    boxShadow: '0 1px 0 rgba(255,255,255,0.2) inset, 0 2px 8px oklch(0.55 0.22 275 / 0.25)'
  }
}, /*#__PURE__*/React.createElement(I.zap, {
  size: 13,
  fill: "white",
  stroke: 0
}), primary), secondary && /*#__PURE__*/React.createElement("button", {
  style: {
    fontSize: 12,
    padding: '9px 12px',
    borderRadius: 8,
    background: 'var(--panel)',
    color: 'var(--ink-2)',
    border: '1px solid var(--line)'
  }
}, secondary));
const actionBtnPrimaryStyle = {
  fontSize: 11.5,
  padding: '6px 12px',
  borderRadius: 6,
  background: 'var(--ink)',
  color: 'white',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  border: '1px solid var(--ink)'
};
const actionBtnSecondaryStyle = {
  fontSize: 11.5,
  padding: '6px 12px',
  borderRadius: 6,
  background: 'var(--panel)',
  color: 'var(--ink)',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  border: '1px solid var(--line)'
};
const AnalyzedSubject = () => /*#__PURE__*/React.createElement("div", {
  style: {
    borderRadius: 10,
    padding: 12,
    width: '100%',
    background: 'var(--panel)',
    border: '1px solid var(--line-2)'
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10
  }
}, /*#__PURE__*/React.createElement(I.eye, {
  size: 12,
  style: {
    color: 'var(--accent-ink)'
  }
}), /*#__PURE__*/React.createElement("span", {
  style: {
    fontSize: 11.5,
    fontWeight: 500
  }
}, "I identified")), /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    gap: '4px 10px',
    fontSize: 11.5
  }
}, [['Object', 'Ceramic vase, matte glaze'], ['Palette', 'Warm beige, clay, ivory'], ['Lighting', 'Soft side-light, studio'], ['Mood', 'Quiet, editorial, Japandi']].map(([k, v]) => /*#__PURE__*/React.createElement(React.Fragment, {
  key: k
}, /*#__PURE__*/React.createElement("span", {
  className: "mono",
  style: {
    color: 'var(--ink-3)',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    alignSelf: 'center'
  }
}, k), /*#__PURE__*/React.createElement("span", {
  style: {
    color: 'var(--ink)'
  }
}, v)))));

// ---------- BriefCard（Agent 模式 CONFIRM 阶段的创意方案卡片）----------

const BriefCard = ({
  brief,
  contract,
  completeness
}) => {
  if (!brief && !contract) return null;
  const rows = [];
  if (contract) {
    const task = contract.task || {};
    const subject = contract.subject || {};
    const composition = contract.composition || {};
    const visualStyle = contract.visualStyle || {};
    const copy = contract.copy || {};
    const mainTitle = copy.mainTitle || {};
    const subtitle = copy.subtitle || {};
    const constraints = contract.constraints || {};
    const acceptance = Array.isArray(contract.acceptanceCriteria) ? contract.acceptanceCriteria : [];
    const channels = Array.isArray(task.channel) ? task.channel.filter(Boolean) : [];
    const palette = Array.isArray(visualStyle.colorPalette) ? visualStyle.colorPalette.filter(Boolean) : [];
    const mustInclude = Array.isArray(constraints.mustInclude) ? constraints.mustInclude.filter(Boolean) : [];
    const avoid = Array.isArray(constraints.avoid) ? constraints.avoid.filter(Boolean) : [];
    if (task.purpose) rows.push(['任务目的', task.purpose]);
    if (subject.description || subject.category) rows.push(['主体内容', subject.description || subject.category]);
    if (composition.aspectRatio) rows.push(['画幅比例', composition.aspectRatio]);
    if (composition.layout) rows.push(['构图方式', composition.layout]);
    if (visualStyle.overall) rows.push(['整体风格', visualStyle.overall]);
    if (visualStyle.backgroundStyle) rows.push(['背景风格', visualStyle.backgroundStyle]);
    if (visualStyle.lighting) rows.push(['光线方向', visualStyle.lighting]);
    if (composition.safeArea) rows.push(['安全线', composition.safeArea]);
    if (mainTitle.text) rows.push(['主标题', mainTitle.text]);
    if (mainTitle.fontStyle) rows.push(['标题字体', mainTitle.fontStyle]);
    if (subtitle.text) rows.push(['副标题', subtitle.text]);
    if (subtitle.fontStyle) rows.push(['副标字体', subtitle.fontStyle]);
    if (channels.length) rows.push(['投放渠道', channels.join(' / ')]);
    if (palette.length) rows.push(['色彩方向', palette.join(' · ')]);
    if (mustInclude.length) rows.push(['必须包含', mustInclude.join(' · ')]);
    if (avoid.length) rows.push(['避免项', avoid.join(' · ')]);
    if (acceptance.length) rows.push(['验收标准', acceptance.join(' · ')]);
  } else {
    if (brief.concept) rows.push(['核心方案', brief.concept]);
    if (Array.isArray(brief.visualElements) && brief.visualElements.length > 0) {
      rows.push(['视觉要素', brief.visualElements.join(' · ')]);
    }
    if (brief.copyText) rows.push(['画面文案', brief.copyText]);
    if (brief.subtitleText) rows.push(['副标题', brief.subtitleText]);
    if (brief.aspectRatio) rows.push(['画幅比例', brief.aspectRatio]);
    if (brief.style) rows.push(['风格', brief.style]);
    if (brief.mood) rows.push(['氛围', brief.mood]);
    if (brief.colorDirection) rows.push(['色彩方向', brief.colorDirection]);
  }
  const score = completeness && typeof completeness.score === 'number' ? completeness.score : null;
  const isConfirmed = brief && brief.confirmedByUser;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      borderRadius: 10,
      padding: 12,
      width: '100%',
      background: isConfirmed ? 'var(--accent-soft)' : 'var(--panel)',
      border: '1px solid ' + (isConfirmed ? 'var(--accent)' : 'var(--line-2)'),
      transition: 'background 200ms, border-color 200ms'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(I.sparkles, {
    size: 12,
    style: {
      color: 'var(--accent)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      fontWeight: 600,
      color: 'var(--ink)'
    }
  }, "\u521B\u610F\u65B9\u6848 Brief"), isConfirmed && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      padding: '1px 6px',
      borderRadius: 99,
      background: 'var(--accent)',
      color: '#fff',
      fontWeight: 500
    }
  }, "\u5DF2\u786E\u8BA4")), score !== null && /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      fontSize: 10,
      color: 'var(--ink-3)',
      padding: '2px 6px',
      borderRadius: 4,
      background: 'var(--panel-2)'
    }
  }, "\u5B8C\u6574\u5EA6 ", score, "/100")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'auto 1fr',
      gap: '6px 12px',
      fontSize: 11.5
    }
  }, rows.map(([k, v]) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: k
  }, /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      color: 'var(--ink-3)',
      fontSize: 10,
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      alignSelf: 'flex-start',
      paddingTop: 2,
      whiteSpace: 'nowrap'
    }
  }, k), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--ink)',
      lineHeight: 1.5
    }
  }, v)))));
};

// ---------- ThinkingBlock（Agent 思考过程折叠展示）----------

const ThinkingBlock = ({
  text
}) => {
  var _s = React.useState(false);
  var open = _s[0];
  var setOpen = _s[1];
  if (!text || !text.trim()) return null;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      borderRadius: 8,
      border: '1px solid var(--line-2)',
      background: 'var(--panel-2)',
      overflow: 'hidden',
      marginBottom: 6
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: function () {
      setOpen(!open);
    },
    style: {
      padding: '7px 12px',
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      cursor: 'pointer',
      userSelect: 'none',
      borderBottom: open ? '1px solid var(--line-2)' : 'none'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "11",
    height: "11",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "var(--ink-3)",
    strokeWidth: "2",
    strokeLinecap: "round",
    style: {
      transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
      transition: 'transform 200ms'
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "m9 18 6-6-6-6"
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--ink-3)'
    }
  }, "\u601D\u8003\u8FC7\u7A0B")), open && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '10px 12px',
      fontSize: 11.5,
      lineHeight: 1.6,
      color: 'var(--ink-2)',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      maxHeight: 200,
      overflowY: 'auto'
    }
  }, text));
};
const PromptTraceBlock = ({
  title,
  text
}) => {
  var _s = React.useState(true);
  var open = _s[0];
  var setOpen = _s[1];
  const userToggledRef = React.useRef(false);
  const bodyRef = React.useRef(null);
  React.useEffect(function () {
    if (open && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [text, open]);
  if (!text || !String(text).trim()) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(String(text));
  } catch (e) {
    parsed = null;
  }
  const steps = parsed && Array.isArray(parsed.steps) ? parsed.steps : [];
  const rules = parsed && Array.isArray(parsed.applied_rules) ? parsed.applied_rules : [];
  const finalPrompt = parsed && parsed.final_prompt ? String(parsed.final_prompt) : String(text);
  const negativePrompt = parsed && parsed.negative_prompt ? String(parsed.negative_prompt) : '';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      borderRadius: 8,
      border: '1px solid var(--line-2)',
      background: 'var(--panel-2)',
      overflow: 'hidden',
      marginBottom: 6
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: function () {
      userToggledRef.current = true;
      setOpen(!open);
    },
    style: {
      padding: '7px 12px',
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      cursor: 'pointer',
      userSelect: 'none',
      borderBottom: open ? '1px solid var(--line-2)' : 'none'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "11",
    height: "11",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "var(--ink-3)",
    strokeWidth: "2",
    strokeLinecap: "round",
    style: {
      transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
      transition: 'transform 200ms'
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "m9 18 6-6-6-6"
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--ink-3)'
    }
  }, title || '生图 Prompt')), open && /*#__PURE__*/React.createElement("div", {
    ref: bodyRef,
    style: {
      padding: '10px 12px',
      fontSize: 11.5,
      lineHeight: 1.6,
      color: 'var(--ink-2)',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      maxHeight: 240,
      overflowY: 'auto'
    }
  }, parsed ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }
  }, steps.length > 0 ? /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "mono",
    style: {
      fontSize: 9.5,
      color: 'var(--ink-3)',
      marginBottom: 4
    }
  }, "\u89E3\u8BFB\u6B65\u9AA4"), steps.map(function (step, idx) {
    return /*#__PURE__*/React.createElement("div", {
      key: idx,
      style: {
        display: 'flex',
        gap: 7,
        padding: '2px 0'
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "mono",
      style: {
        color: 'var(--ink-3)',
        minWidth: 14
      }
    }, idx + 1), /*#__PURE__*/React.createElement("span", null, step));
  })) : null, rules.length > 0 ? /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "mono",
    style: {
      fontSize: 9.5,
      color: 'var(--ink-3)',
      marginBottom: 4
    }
  }, "\u91C7\u7528\u89C4\u5219"), rules.map(function (rule, idx) {
    return /*#__PURE__*/React.createElement("div", {
      key: idx,
      style: {
        padding: '2px 0'
      }
    }, "- ", rule);
  })) : null, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "mono",
    style: {
      fontSize: 9.5,
      color: 'var(--ink-3)',
      marginBottom: 4
    }
  }, "\u6700\u7EC8\u4F20\u9012\u7ED9\u751F\u56FE"), /*#__PURE__*/React.createElement("div", null, finalPrompt)), negativePrompt ? /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "mono",
    style: {
      fontSize: 9.5,
      color: 'var(--ink-3)',
      marginBottom: 4
    }
  }, "\u907F\u514D"), /*#__PURE__*/React.createElement("div", null, negativePrompt)) : null) : String(text)));
};
const getThinkingPreview = message => {
  return String(message || '').trim() || '正在连接 Agent...';
};

// ---------- LogBox（实时滚动日志）----------

const LogBox = ({
  logs,
  running
}) => {
  const bottomRef = React.useRef(null);
  React.useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({
        behavior: 'smooth'
      });
    }
  }, [logs && logs.length]);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      border: '1px solid var(--line)',
      borderRadius: 8,
      background: 'var(--panel)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '7px 12px',
      borderBottom: '1px solid var(--line-2)',
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--ink-3)',
      fontWeight: 500
    }
  }, "\u8FDB\u5EA6\u65E5\u5FD7"), running && /*#__PURE__*/React.createElement("div", {
    style: {
      width: 6,
      height: 6,
      borderRadius: 99,
      background: 'var(--accent)',
      animation: 'pulse 1.2s ease-in-out infinite'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      maxHeight: 140,
      overflowY: 'auto',
      padding: '6px 0'
    }
  }, logs.map((log, i) => {
    const isError = log.includes('失败') || log.includes('Error') || log.includes('error');
    const isOk = log.includes('完成') || log.includes('就绪') || log.includes('保存');
    const isPath = log.includes('/') && (log.includes('.png') || log.includes('.py') || log.includes('\\'));
    const display = isPath ? log.split(/[/\\]/).pop() : log;
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        padding: '3px 12px',
        fontSize: 11.5,
        fontFamily: 'JetBrains Mono, monospace',
        color: isError ? 'var(--warn)' : isOk ? 'var(--ok)' : 'var(--ink-2)',
        display: 'flex',
        gap: 8,
        alignItems: 'baseline'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: isError ? 'var(--warn)' : isOk ? 'var(--ok)' : 'var(--accent)',
        flexShrink: 0
      }
    }, "\u203A"), /*#__PURE__*/React.createElement("span", null, display));
  }), /*#__PURE__*/React.createElement("div", {
    ref: bottomRef
  })));
};

// ---------- States ----------

const GREETINGS = [{
  title: '今天想设计点什么？',
  sub: '上传产品图、参考图、品牌素材，或者直接输入描述。'
}, {
  title: '想要生成一张海报吗？',
  sub: '使用 Gpt-image 2 模型，直接描述你想要的画面。'
}, {
  title: '需要编辑图像？',
  sub: '使用 Nano Banana Pro，上传图片后描述修改需求。'
}, {
  title: '来合成特殊品吧',
  sub: '选中左侧特殊品模板，输入货号和文案即可一键合成。'
}, {
  title: '忘了怎么用？',
  sub: '试试直接在对话框提问，我会帮你找到答案。'
}];
const pickGreeting = () => GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
const ChatEmpty = ({
  greetingKey
}) => {
  const prompts = [{
    icon: /*#__PURE__*/React.createElement(I.image, {
      size: 13
    }),
    text: '上传产品图，描述想要的风格'
  }, {
    icon: /*#__PURE__*/React.createElement(I.palette, {
      size: 13
    }),
    text: '生成4张哑光色调的变体图'
  }, {
    icon: /*#__PURE__*/React.createElement(I.copy, {
      size: 13
    }),
    text: '复制当前模板的文案'
  }, {
    icon: /*#__PURE__*/React.createElement(I.dims, {
      size: 13
    }),
    text: '调整尺寸为9:16适配Instagram'
  }];
  const greeting = React.useMemo(() => pickGreeting(), [greetingKey]);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      padding: '20px 16px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '20px 4px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 40,
      height: 40,
      borderRadius: 11,
      background: 'linear-gradient(135deg, var(--ink), oklch(0.3 0.08 275))',
      color: 'white',
      display: 'grid',
      placeItems: 'center'
    }
  }, /*#__PURE__*/React.createElement(I.sparkles, {
    size: 18,
    stroke: 1.8
  })), /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 19,
      letterSpacing: '-0.01em'
    }
  }, greeting.title), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--ink-3)',
      textAlign: 'center',
      maxWidth: 240,
      lineHeight: 1.5
    }
  }, greeting.sub)), /*#__PURE__*/React.createElement("div", {
    className: "mono",
    style: {
      fontSize: 9.5,
      color: 'var(--ink-3)',
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      padding: '12px 4px 6px'
    }
  }, "\u8BD5\u8BD5"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 4
    }
  }, prompts.map((p, i) => /*#__PURE__*/React.createElement("button", {
    key: i,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '10px 12px',
      borderRadius: 8,
      background: 'var(--panel)',
      border: '1px solid var(--line-2)',
      fontSize: 12,
      color: 'var(--ink-2)',
      textAlign: 'left'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--ink-3)'
    }
  }, p.icon), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }, p.text), /*#__PURE__*/React.createElement(I.arrowRight, {
    size: 12,
    style: {
      color: 'var(--ink-3)'
    }
  })))));
};
const AgentWelcome = () => {
  // Agent 模式专属欢迎页（不随机轮播）—— 简约版
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 40,
      height: 40,
      borderRadius: 11,
      background: 'linear-gradient(135deg, var(--ink), oklch(0.3 0.08 275))',
      color: 'white',
      display: 'grid',
      placeItems: 'center'
    }
  }, /*#__PURE__*/React.createElement(I.sparkles, {
    size: 18,
    stroke: 1.8
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15,
      fontWeight: 500,
      color: 'var(--ink)'
    }
  }, "\u4F60\u60F3\u505A\u4E00\u5F20\u4EC0\u4E48\u6837\u7684\u56FE\uFF1F"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--ink-3)',
      textAlign: 'center',
      maxWidth: 240,
      lineHeight: 1.5
    }
  }, "\u63CF\u8FF0\u4F60\u7684\u9700\u6C42\uFF0CAgent \u4F1A\u5148\u548C\u4F60\u786E\u8BA4\u65B9\u5411\uFF0C\u518D\u5F00\u59CB\u751F\u6210\u3002")));
};
const ChatGenerating = () => /*#__PURE__*/React.createElement("div", {
  style: {
    flex: 1,
    overflowY: 'auto',
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 14
  }
}, /*#__PURE__*/React.createElement(Bubble, {
  who: "user",
  user: user
}, /*#__PURE__*/React.createElement(TextBubble, {
  who: "user"
}, "Make 4 studio shots of this vase for a homepage hero, warm and editorial. Add \"New in\" copy."), /*#__PURE__*/React.createElement(FileCard, {
  name: "vase-ref-01.jpg",
  size: "2.4 MB",
  type: "JPG"
})), /*#__PURE__*/React.createElement(Bubble, {
  who: "ai",
  meta: "Loom \xB7 generating",
  user: user
}, /*#__PURE__*/React.createElement(ThinkingTrace, {
  done: false,
  steps: ['Parsing reference image — detecting subject and lighting', 'Matching Japandi aesthetic from brand kit', 'Sampling 4 layout variants at 4:5']
}), /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 12px',
    borderRadius: 10,
    width: '100%',
    background: 'var(--panel)',
    border: '1px solid var(--line-2)'
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    position: 'relative',
    width: 24,
    height: 24
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    position: 'absolute',
    inset: 0,
    borderRadius: 99,
    border: '2px solid var(--line-2)'
  }
}), /*#__PURE__*/React.createElement("div", {
  style: {
    position: 'absolute',
    inset: 0,
    borderRadius: 99,
    border: '2px solid var(--accent)',
    borderRightColor: 'transparent',
    borderBottomColor: 'transparent',
    animation: 'spin 0.8s linear infinite'
  }
})), /*#__PURE__*/React.createElement("div", {
  style: {
    flex: 1
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    fontSize: 12,
    fontWeight: 500
  }
}, "Generating 4 options"), /*#__PURE__*/React.createElement("div", {
  className: "mono",
  style: {
    fontSize: 10,
    color: 'var(--ink-3)'
  }
}, "~18s remaining")), /*#__PURE__*/React.createElement("button", {
  style: {
    fontSize: 11,
    color: 'var(--ink-3)',
    padding: '4px 8px',
    borderRadius: 5,
    border: '1px solid var(--line)'
  }
}, "Stop"))), /*#__PURE__*/React.createElement("style", null, `@keyframes spin { to { transform: rotate(360deg); } }`));
const ChatSessionBar = ({
  messages,
  historyControl
}) => {
  const userMsgs = messages.filter(m => m.who === 'user').length;
  const turnCount = messages.length > 0 ? userMsgs + ' 条消息' : '暂无消息';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '14px 16px 10px',
      background: 'var(--panel)',
      position: 'relative',
      zIndex: 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      color: 'var(--ink-3)',
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      fontSize: 10
    }
  }, "\u5BF9\u8BDD"), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      color: 'var(--ink-3)',
      fontSize: 10
    }
  }, turnCount), historyControl);
};
const ChatReturned = ({
  messages,
  template,
  onCompose,
  isGenerating,
  user,
  greetingKey,
  onQuickReply,
  agentEnabled,
  onPublishInspiration,
  onUnpublishInspiration
}) => {
  const bottomRef = React.useRef(null);
  const greeting = React.useMemo(() => pickGreeting(), [greetingKey]);
  React.useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({
        behavior: 'smooth'
      });
    }
  }, [messages]);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 14
    }
  }, messages.length === 0 ?
  // Agent 模式用专属欢迎页，否则随机轮播
  agentEnabled ? /*#__PURE__*/React.createElement(AgentWelcome, null) : /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 40,
      height: 40,
      borderRadius: 11,
      background: 'linear-gradient(135deg, var(--ink), oklch(0.3 0.08 275))',
      color: 'white',
      display: 'grid',
      placeItems: 'center'
    }
  }, /*#__PURE__*/React.createElement(I.sparkles, {
    size: 18,
    stroke: 1.8
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15,
      fontWeight: 500,
      color: 'var(--ink)'
    }
  }, greeting.title), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--ink-3)',
      textAlign: 'center',
      maxWidth: 240,
      lineHeight: 1.5
    }
  }, greeting.sub)) : messages.map((m, i) => /*#__PURE__*/React.createElement(Bubble, {
    key: i,
    who: m.who,
    meta: m.meta,
    user: user
  }, m.type === 'ai-image-generating' ? (() => {
    const fmtSecs = s => {
      const mm = Math.floor(s / 60),
        ss = s % 60;
      return mm > 0 ? mm + 'm ' + String(ss).padStart(2, '0') + 's' : ss + 's';
    };
    const promptPayload = m.promptPayload || null;
    const promptInstruction = promptPayload && promptPayload.instruction ? promptPayload.instruction : promptPayload && promptPayload.positive ? promptPayload.positive : m.prompt;
    const promptNegative = promptPayload && promptPayload.negative ? promptPayload.negative : '';
    const promptParams = promptPayload && promptPayload.parameters ? promptPayload.parameters : null;
    const promptConstraints = promptPayload && promptPayload.constraints ? promptPayload.constraints : null;
    const promptReasoning = promptPayload && promptPayload.reasoningForUser ? promptPayload.reasoningForUser : '';
    const resolvedPromptText = m.resolvedPrompt || '';
    const promptTraceText = m.promptTrace || '';
    const showPromptTrace = promptTraceText || resolvedPromptText && resolvedPromptText !== m.prompt;
    const fullImageUrl = m.imageUrl || '';
    const displayImageUrlRaw = m.previewUrl || m.imagePreviewUrl || m.imageUrl || '';
    const displayImageUrl = displayImageUrlRaw && displayImageUrlRaw.startsWith('/') ? (window.API_BASE || window.location.origin) + displayImageUrlRaw : displayImageUrlRaw;
    const batchImages = Array.isArray(m.images) && m.images.length > 0 ? m.images : null;
    const batchOkCount = batchImages ? batchImages.filter(function (im) {
      return im.status === 'done' && (im.url || im.previewUrl);
    }).length : 0;
    return React.createElement('div', {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 10
      }
    }, React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8
      }
    }, m.status === 'done' ? React.createElement('div', {
      style: {
        width: 8,
        height: 8,
        borderRadius: 99,
        background: 'var(--ok)',
        flexShrink: 0
      }
    }) : m.status === 'failed' ? React.createElement('div', {
      style: {
        width: 8,
        height: 8,
        borderRadius: 99,
        background: 'var(--warn)',
        flexShrink: 0
      }
    }) : React.createElement('div', {
      style: {
        width: 14,
        height: 14,
        borderRadius: 99,
        border: '2px solid var(--line-2)',
        borderTopColor: 'var(--accent)',
        animation: 'spin 0.8s linear infinite',
        flexShrink: 0
      }
    }), React.createElement('span', {
      style: {
        fontSize: 12,
        fontWeight: 500,
        color: 'var(--ink)'
      }
    }, m.status === 'done' ? batchImages && batchOkCount < batchImages.length ? '生图完成（' + batchOkCount + '/' + batchImages.length + ' 成功）' : '生图完成' : m.status === 'failed' ? '生图失败' : m.status === 'skill-planning' ? '正在执行 Skill：$' + m.activeSkill + '…' : m.status === 'skill-parsed' ? 'Skill 已解析，正在提交到 Image 2…' : m.status === 'queued' ? '正在提交到「' + (m.model || 'AI') + '」…' : m.activeSkill && !m.promptTrace && (m.progress || 0) < 20 ? '正在解读需求并整理生图 Prompt…' : (m.progress || 0) < 20 ? '「' + (m.model || 'AI') + '」正在处理…' : (m.progress || 0) < 90 ? '「' + (m.model || 'AI') + '」生成中 ' + (m.progress || 0) + '%' : '处理完成，正在下载…'), m.finalElapsed != null ? React.createElement('span', {
      className: 'mono',
      style: {
        fontSize: 10,
        color: 'var(--ink-3)'
      }
    }, fmtSecs(m.finalElapsed)) : m.startedAt && m.status !== 'done' && m.status !== 'failed' ? React.createElement(ChatTimer, {
      startedAt: m.startedAt
    }) : null), m.status !== 'failed' && m.status !== 'done' && React.createElement(InlineRefStrip, {
      items: m.refPreviews
    }), m.providerSwitched && React.createElement('div', {
      style: {
        padding: '6px 10px',
        borderRadius: 6,
        background: 'var(--panel)',
        border: '1px solid var(--warn)',
        fontSize: 11,
        color: 'var(--warn)',
        marginBottom: 6
      }
    }, '已自动切换到「' + ({
      sub2api: '订阅',
      adobe2api: 'Adobe',
      apimart: 'APIMart'
    }[m.provider] || m.provider || '备用') + '」线路'), showPromptTrace && React.createElement(PromptTraceBlock, {
      title: m.activeSkill ? 'Skill 解析 · $' + m.activeSkill : '生图 Prompt',
      text: promptTraceText || resolvedPromptText
    }), agentEnabled && promptInstruction && React.createElement('div', {
      style: {
        padding: '9px 10px',
        borderRadius: 8,
        background: 'var(--panel)',
        border: '1px solid var(--line-2)',
        display: 'flex',
        flexDirection: 'column',
        gap: 5
      }
    }, React.createElement('div', {
      className: 'mono',
      style: {
        fontSize: 9.5,
        color: 'var(--ink-3)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em'
      }
    }, '执行标准'), React.createElement('div', {
      style: {
        fontSize: 11.2,
        color: 'var(--ink-2)',
        lineHeight: 1.45
      }
    }, String(promptInstruction).slice(0, 360), String(promptInstruction).length > 360 ? '...' : ''), promptReasoning ? React.createElement('div', {
      style: {
        fontSize: 10.5,
        color: 'var(--ink-3)',
        lineHeight: 1.4
      }
    }, '说明：', String(promptReasoning).slice(0, 180), String(promptReasoning).length > 180 ? '...' : '') : null, promptConstraints && Array.isArray(promptConstraints.mustInclude) && promptConstraints.mustInclude.length > 0 ? React.createElement('div', {
      style: {
        fontSize: 10.5,
        color: 'var(--ink-2)',
        lineHeight: 1.4
      }
    }, '必须包含：', promptConstraints.mustInclude.join('； ')) : null, promptConstraints && Array.isArray(promptConstraints.preserve) && promptConstraints.preserve.length > 0 ? React.createElement('div', {
      style: {
        fontSize: 10.5,
        color: 'var(--ink-2)',
        lineHeight: 1.4
      }
    }, '保留：', promptConstraints.preserve.join('； ')) : null, promptConstraints && Array.isArray(promptConstraints.avoid) && promptConstraints.avoid.length > 0 || promptNegative ? React.createElement('div', {
      style: {
        fontSize: 10.5,
        color: 'var(--ink-3)',
        lineHeight: 1.4
      }
    }, '避免：', promptConstraints && Array.isArray(promptConstraints.avoid) && promptConstraints.avoid.length > 0 ? promptConstraints.avoid.join('； ') : String(promptNegative).slice(0, 220) + (String(promptNegative).length > 220 ? '...' : '')) : null, promptParams ? React.createElement('div', {
      className: 'mono',
      style: {
        fontSize: 10,
        color: 'var(--ink-3)'
      }
    }, 'ratio=', promptParams.aspectRatio || promptParams.size || 'auto', ' · size=', promptParams.size || 'auto', ' · resolution=', promptParams.resolution || '默认') : null), m.status === 'done' && fullImageUrl && !batchImages && React.createElement('div', null, React.createElement('img', {
      src: displayImageUrl || fullImageUrl,
      alt: m.prompt,
      style: {
        width: '100%',
        borderRadius: 10,
        display: 'block',
        border: '1px solid var(--line-2)',
        cursor: 'pointer'
      },
      onClick: () => window.open(fullImageUrl, '_blank')
    }), React.createElement('div', {
      style: {
        marginTop: 6,
        display: 'flex',
        gap: 6,
        flexWrap: 'wrap'
      }
    }, React.createElement('a', {
      href: fullImageUrl,
      download: true,
      style: {
        fontSize: 11,
        padding: '4px 10px',
        borderRadius: 5,
        background: 'var(--ink)',
        color: 'white',
        textDecoration: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4
      }
    }, React.createElement(I.download, {
      size: 10
    }), '下载'), m.inspirationPostId ? React.createElement('button', {
      onClick: function () {
        onUnpublishInspiration(m);
      },
      style: {
        fontSize: 11,
        padding: '4px 10px',
        borderRadius: 5,
        background: 'var(--panel)',
        color: 'var(--ok)',
        border: '1px solid var(--ok)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        cursor: 'pointer'
      }
    }, React.createElement(I.check, {
      size: 10
    }), '已发布 · 取消') : React.createElement('button', {
      onClick: function () {
        onPublishInspiration(m);
      },
      style: {
        fontSize: 11,
        padding: '4px 10px',
        borderRadius: 5,
        background: 'var(--panel)',
        color: 'var(--ink-2)',
        border: '1px solid var(--line)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        cursor: 'pointer'
      }
    }, React.createElement(I.sparkles, {
      size: 10
    }), '发布到灵感'))),
    // 批量卡：n 张图的网格，生成中/失败/完成分别渲染
    batchImages && React.createElement('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 8
      }
    }, batchImages.map(function (im, bi) {
      var imFull = im.url || '';
      var imShownRaw = im.previewUrl || im.url || '';
      var imShown = imShownRaw && imShownRaw.startsWith('/') ? (window.API_BASE || window.location.origin) + imShownRaw : imShownRaw;
      if (im.status === 'done' && imFull) {
        return React.createElement('div', {
          key: im.jobId || bi,
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: 4
          }
        }, React.createElement('img', {
          src: imShown || imFull,
          alt: (m.prompt || '') + ' #' + (bi + 1),
          style: {
            width: '100%',
            borderRadius: 8,
            display: 'block',
            border: '1px solid var(--line-2)',
            cursor: 'pointer'
          },
          onClick: function () {
            window.open(imFull, '_blank');
          }
        }), React.createElement('div', {
          style: {
            display: 'flex',
            gap: 4,
            flexWrap: 'wrap'
          }
        }, React.createElement('a', {
          href: imFull,
          download: true,
          style: {
            fontSize: 10,
            padding: '3px 8px',
            borderRadius: 5,
            background: 'var(--ink)',
            color: 'white',
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3
          }
        }, React.createElement(I.download, {
          size: 9
        }), '下载'), im.inspirationPostId ? React.createElement('button', {
          onClick: function () {
            onUnpublishInspiration(Object.assign({}, m, {
              jobId: im.jobId,
              imageUrl: imFull,
              inspirationPostId: im.inspirationPostId,
              batchImageIndex: bi
            }));
          },
          style: {
            fontSize: 10,
            padding: '3px 8px',
            borderRadius: 5,
            background: 'var(--panel)',
            color: 'var(--ok)',
            border: '1px solid var(--ok)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            cursor: 'pointer'
          }
        }, React.createElement(I.check, {
          size: 9
        }), '已发布') : React.createElement('button', {
          onClick: function () {
            onPublishInspiration(Object.assign({}, m, {
              jobId: im.jobId,
              imageUrl: imFull,
              previewUrl: im.previewUrl || imFull,
              inspirationPostId: null,
              batchImageIndex: bi
            }));
          },
          style: {
            fontSize: 10,
            padding: '3px 8px',
            borderRadius: 5,
            background: 'var(--panel)',
            color: 'var(--ink-2)',
            border: '1px solid var(--line)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            cursor: 'pointer'
          }
        }, React.createElement(I.sparkles, {
          size: 9
        }), '发布')));
      }
      if (im.status === 'failed') {
        return React.createElement('div', {
          key: im.jobId || bi,
          style: {
            minHeight: 110,
            borderRadius: 8,
            border: '1px solid var(--warn)',
            background: 'var(--panel)',
            padding: '8px 9px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            justifyContent: 'center'
          }
        }, React.createElement('div', {
          style: {
            fontSize: 10.5,
            color: 'var(--warn)',
            lineHeight: 1.4,
            wordBreak: 'break-word'
          }
        }, '第 ' + (bi + 1) + ' 张失败：' + formatAiImageError(im.error, im.jobId)));
      }
      return React.createElement('div', {
        key: im.jobId || bi,
        style: {
          minHeight: 110,
          borderRadius: 8,
          border: '1px dashed var(--line-2)',
          background: 'var(--panel)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6
        }
      }, React.createElement('div', {
        style: {
          width: 14,
          height: 14,
          borderRadius: 99,
          border: '2px solid var(--line-2)',
          borderTopColor: 'var(--accent)',
          animation: 'spin 0.8s linear infinite'
        }
      }), React.createElement('div', {
        className: 'mono',
        style: {
          fontSize: 10,
          color: 'var(--ink-3)'
        }
      }, (im.progress || 0) + '%'));
    })), m.status === 'done' && m.vlmPending && React.createElement('div', {
      style: {
        marginTop: 8,
        padding: '10px 12px',
        borderRadius: 8,
        background: 'var(--panel)',
        border: '1px solid var(--line-2)'
      }
    }, React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 6
      }
    }, React.createElement(I.eye, {
      size: 11,
      style: {
        color: 'var(--ink-3)'
      }
    }), React.createElement('span', {
      style: {
        fontSize: 11,
        color: 'var(--ink-2)'
      }
    }, '图片已生成，VLM 质检中...'))),
    // VLM 质检反馈
    m.status === 'done' && m.vlm && m.vlm.status === 'checked' && React.createElement('div', {
      style: {
        marginTop: 8,
        padding: '10px 12px',
        borderRadius: 8,
        background: 'var(--panel)',
        border: '1px solid var(--line-2)'
      }
    }, React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        marginBottom: 6
      }
    }, React.createElement(I.eye, {
      size: 11,
      style: {
        color: 'var(--accent)'
      }
    }), React.createElement('span', {
      style: {
        fontSize: 11,
        fontWeight: 500,
        color: 'var(--ink)'
      }
    }, 'VLM 质检')), React.createElement('div', {
      style: {
        display: 'flex',
        gap: 12,
        fontSize: 11,
        color: 'var(--ink-2)',
        marginBottom: 6
      }
    }, React.createElement('span', null, '质量 ', React.createElement('span', {
      style: {
        color: m.vlm.qualityScore >= 80 ? 'var(--ok)' : m.vlm.qualityScore >= 50 ? 'var(--warn)' : '#dc2626',
        fontWeight: 500
      }
    }, m.vlm.qualityScore)), React.createElement('span', null, '匹配度 ', React.createElement('span', {
      style: {
        color: m.vlm.intentMatch >= 80 ? 'var(--ok)' : m.vlm.intentMatch >= 50 ? 'var(--warn)' : '#dc2626',
        fontWeight: 500
      }
    }, m.vlm.intentMatch))), m.vlm.userFacingSummary && React.createElement('div', {
      style: {
        fontSize: 11,
        color: 'var(--ink-2)',
        lineHeight: 1.5
      }
    }, m.vlm.userFacingSummary), m.vlm.problemElements && m.vlm.problemElements.length > 0 && React.createElement('div', {
      style: {
        fontSize: 10.5,
        color: '#dc2626',
        marginTop: 4,
        lineHeight: 1.5
      }
    }, '问题: ' + m.vlm.problemElements.join('; ')), m.vlm.nextStepSuggestion && React.createElement('div', {
      style: {
        fontSize: 10.5,
        color: 'var(--ok)',
        marginTop: 4,
        lineHeight: 1.5
      }
    }, '建议: ' + m.vlm.nextStepSuggestion)), m.status === 'failed' && !batchImages && React.createElement('div', {
      style: {
        padding: '8px 10px',
        borderRadius: 6,
        background: 'var(--panel)',
        border: '1px solid var(--warn)',
        fontSize: 11,
        color: 'var(--warn)',
        lineHeight: 1.45,
        wordBreak: 'break-word'
      }
    }, formatAiImageError(m.error, m.jobId || m.job_id)));
  })() : m.type === 'parse-result' ? (() => {
    const matchedCount = m.data.products.filter(p => p.image_path).length;
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 8
      }
    }, /*#__PURE__*/React.createElement(TextBubble, {
      who: "ai"
    }, "\u627E\u5230 ", m.data.products.length, " \u4E2A\u4EA7\u54C1\uFF0C\u5176\u4E2D ", matchedCount, " \u4E2A\u5DF2\u5339\u914D\u56FE\u7247\uFF0C\u5EFA\u8BAE\u6A21\u677F\u7C7B\u578B\uFF1A", /*#__PURE__*/React.createElement("b", null, m.data.suggested_template_type)), /*#__PURE__*/React.createElement("div", {
      style: {
        width: '100%',
        borderRadius: 10,
        background: 'var(--panel)',
        border: '1px solid var(--line-2)',
        overflow: 'hidden'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '9px 12px',
        borderBottom: '1px solid var(--line-2)',
        display: 'flex',
        alignItems: 'center',
        gap: 8
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: 20,
        height: 20,
        borderRadius: 5,
        background: 'var(--accent-soft)',
        color: 'var(--accent-ink)',
        display: 'grid',
        placeItems: 'center'
      }
    }, /*#__PURE__*/React.createElement(I.file, {
      size: 11
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11.5,
        fontWeight: 600
      }
    }, m.data.products.length, " \u4E2A\u4EA7\u54C1"), /*#__PURE__*/React.createElement("div", {
      className: "mono",
      style: {
        fontSize: 9.5,
        color: 'var(--ink-3)'
      }
    }, "CSV \xB7 ", m.data.suggested_template_type))), m.fields && m.fields.length > 0 && /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: '1fr '.repeat(m.fields.length).trim() + ' 60px',
        fontSize: 11
      }
    }, m.fields.map((f, fi) => /*#__PURE__*/React.createElement(HeadCell, {
      key: f
    }, f === 'image' ? '图片' : f === 'name' ? '产品名' : f === 'price' ? '价格' : f === 'tag' ? '标签' : f === 'spec' ? '规格' : f)), /*#__PURE__*/React.createElement(HeadCell, {
      right: true
    }, "\u5339\u914D"), m.data.products.map((p, j) => /*#__PURE__*/React.createElement(React.Fragment, {
      key: j
    }, m.fields.map(f => {
      const val = p[f === 'image' ? 'image_path' : f];
      return /*#__PURE__*/React.createElement(Cell, {
        key: f,
        top: j > 0
      }, f === 'image' ? val ? /*#__PURE__*/React.createElement("span", {
        style: {
          color: 'var(--ok)',
          fontSize: 10
        }
      }, "\u5DF2\u5339\u914D") : /*#__PURE__*/React.createElement("span", {
        style: {
          color: 'var(--ink-3)',
          fontSize: 10
        }
      }, "\u672A\u5339\u914D") : /*#__PURE__*/React.createElement("span", {
        style: {
          fontWeight: f === 'name' ? 500 : 400
        }
      }, val || '—'));
    }), /*#__PURE__*/React.createElement(Cell, {
      top: j > 0,
      right: true
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: p.image_path ? 'var(--ok)' : 'var(--warn)',
        fontSize: 10
      }
    }, p.image_path ? '✓' : '—'))))), matchedCount > 0 && !isGenerating && /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '10px 12px',
        borderTop: '1px solid var(--line-2)',
        display: 'flex',
        justifyContent: 'center'
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => onCompose && onCompose(template, m.data),
      style: {
        fontSize: 12,
        padding: '6px 20px',
        borderRadius: 6,
        background: 'var(--ink)',
        color: 'white',
        border: 'none',
        cursor: 'pointer'
      }
    }, "\u5F00\u59CB\u751F\u56FE"))));
  })() : m.type === 'smart-distribute-loading' ? /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '10px 12px',
      borderRadius: 10,
      background: 'var(--panel)',
      border: '1px solid var(--line-2)',
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 18,
      height: 18,
      borderRadius: 99,
      border: '2px solid var(--line-2)',
      borderTopColor: 'var(--accent)',
      animation: 'spin 0.8s linear infinite',
      flexShrink: 0
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0,
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: 'var(--ink)',
      fontWeight: 600
    }
  }, m.modeLabel || '智能铺货'), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10.5,
      color: 'var(--ink-3)',
      marginTop: 2
    }
  }, m.fileName ? '已接收 ' + m.fileName + '，正在解析 sheet 和替换字段…' : '正在解析 sheet 和替换字段…')), m.startedAt ? /*#__PURE__*/React.createElement(ChatTimer, {
    startedAt: m.startedAt
  }) : null) : m.type === 'smart-distribute' ? (() => {
    const data = m.data;
    const totalJobs = (data.jobs || []).length;
    const totalSlots = (data.jobs || []).reduce(function (acc, j) {
      return acc + (j.modules || []).reduce(function (a, m) {
        return a + (m.values || m.patches || []).length;
      }, 0);
    }, 0);
    const summary = data.summary || {};
    const formatCountMap = function (counts, opts) {
      opts = opts || {};
      return Object.keys(counts || {}).filter(function (k) {
        return !opts.exclude || opts.exclude.indexOf(k) < 0;
      }).map(function (k) {
        return k + ' ' + counts[k];
      }).join('，');
    };
    const specialText = formatCountMap(summary.typeCounts || {}, {
      exclude: ['海报']
    });
    const skippedText = summary.skippedRows ? '跳过 ' + summary.skippedRows + ' 行' + ((summary.typeCounts || {}).海报 ? '（海报 ' + (summary.typeCounts || {}).海报 + '）' : '') : '';
    const summaryText = '解析到 ' + (summary.templateCount || totalJobs) + ' 个模板，' + (summary.skuCount || 0) + ' 个 SKU × ' + (summary.fieldCount || 0) + ' 个字段，共 ' + (summary.totalSlots || totalSlots) + ' 个槽位' + (specialText ? '，特殊标记：' + specialText : '') + (skippedText ? '，' + skippedText : '');
    return React.createElement('div', {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 8
      }
    }, React.createElement(TextBubble, {
      who: 'ai'
    }, '已解析 ' + (data.source ? data.source.fileName : '') + '，' + summaryText + '。' + (m.copied ? '已自动复制第 1 个 JSON' : 'JSON 已生成')), data.warnings && data.warnings.length > 0 ? React.createElement('div', {
      style: {
        padding: '10px 12px',
        borderRadius: 8,
        background: 'var(--panel)',
        border: '1px solid var(--warn)',
        fontSize: 11.5,
        color: 'var(--warn)',
        lineHeight: 1.5
      }
    }, data.warnings.map(function (w, wi) {
      return React.createElement('div', {
        key: wi
      }, '⚠ ' + w);
    })) : null, React.createElement('div', {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 8
      }
    }, (data.jobs || []).map(function (job, ji) {
      var sheetJson = m.jobJsons && m.jobJsons[ji] || '';
      if (!sheetJson) {
        try {
          var source = Object.assign({}, data.source || {});
          if (job.batchType) source.batchType = job.batchType;
          if (job.batchLabel) source.batchLabel = job.batchLabel;
          sheetJson = JSON.stringify({
            schemaVersion: data.schemaVersion,
            mode: data.mode,
            source: source,
            defaults: data.defaults,
            summary: job.summary || {},
            jobs: [job]
          }, null, 2);
        } catch (e) {
          sheetJson = '';
        }
      }
      var jobSlots = (job.modules || []).reduce(function (a, mod) {
        return a + (mod.values || mod.patches || []).length;
      }, 0);
      var jobModules = (job.modules || []).length;
      var jobSummary = job.summary || {};
      var jobSpecialText = formatCountMap(jobSummary.typeCounts || {}, {
        exclude: ['海报']
      });
      var jobSkippedText = jobSummary.skippedRows ? '跳过 ' + jobSummary.skippedRows + ' 行' + ((jobSummary.typeCounts || {}).海报 ? '（海报 ' + (jobSummary.typeCounts || {}).海报 + '）' : '') : '';
      var jobSummaryText = jobModules + ' 个模块 · ' + (jobSummary.skuCount || 0) + ' 个 SKU × ' + (jobSummary.fieldCount || 0) + ' 个字段 · ' + (jobSummary.totalSlots || jobSlots) + ' 个槽位' + (jobSpecialText ? ' · 特殊标记：' + jobSpecialText : '') + (jobSkippedText ? ' · ' + jobSkippedText : '');
      var batchLabel = job.batchLabel || (data.mode === 'patch' ? '增量' : '全量');
      var title = (data.mode === 'patch' ? batchLabel + ' - ' : '') + (job.sheetName || job.templateName || 'Sheet ' + (ji + 1));
      var badgeStyle = job.batchType === 'red' ? {
        background: 'rgba(180,35,24,0.08)',
        color: 'var(--warn)'
      } : job.batchType === 'yellow' ? {
        background: 'var(--warn-soft)',
        color: 'var(--warn)'
      } : {
        background: 'var(--accent-soft)',
        color: 'var(--accent-ink)'
      };
      return React.createElement('div', {
        key: (job.batchType || 'full') + ':' + (job.sheetName || ji),
        style: {
          width: '100%',
          borderRadius: 10,
          background: 'var(--panel)',
          border: '1px solid var(--line-2)',
          overflow: 'hidden'
        }
      }, React.createElement('div', {
        style: {
          padding: '9px 12px',
          borderBottom: '1px solid var(--line-2)',
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }
      }, React.createElement('div', {
        style: Object.assign({
          width: 20,
          height: 20,
          borderRadius: 5,
          display: 'grid',
          placeItems: 'center'
        }, badgeStyle)
      }, React.createElement(I.file, {
        size: 11
      })), React.createElement('div', {
        style: {
          flex: 1,
          minWidth: 0
        }
      }, React.createElement('div', {
        style: {
          fontSize: 11.5,
          fontWeight: 600,
          color: 'var(--ink)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }
      }, title), React.createElement('div', {
        className: 'mono',
        style: {
          fontSize: 9.5,
          color: 'var(--ink-3)',
          lineHeight: 1.45
        }
      }, jobSummaryText))), React.createElement('div', {
        style: {
          padding: '8px 12px',
          display: 'flex',
          gap: 6
        }
      }, React.createElement(CopyButton2, {
        jsonStr: sheetJson
      })), React.createElement('pre', {
        style: {
          margin: 0,
          padding: '10px 12px',
          fontSize: 10,
          color: 'var(--ink-2)',
          overflow: 'auto',
          maxHeight: 180,
          borderTop: '1px solid var(--line-2)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          fontFamily: 'Menlo, Monaco, monospace'
        }
      }, sheetJson.slice(0, 1400) + (sheetJson.length > 1400 ? '\n/* ... 截断，完整 JSON 请复制 */' : '')));
    })));
  })() : m.type === 'generating' ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, (() => {
    var fmtSecs = function (s) {
      var mm = Math.floor(s / 60),
        ss = s % 60;
      return mm > 0 ? mm + 'm ' + String(ss).padStart(2, '0') + 's' : ss + 's';
    };
    if (m.status === 'done') return React.createElement(React.Fragment, null, React.createElement('div', {
      style: {
        width: 18,
        height: 18,
        borderRadius: 99,
        background: 'var(--ok)',
        flexShrink: 0
      }
    }), React.createElement('span', {
      style: {
        fontSize: 13,
        color: 'var(--ok)',
        fontWeight: 600
      }
    }, '生成完成'), m.finalElapsed != null && React.createElement('span', {
      className: 'mono',
      style: {
        fontSize: 11,
        color: 'var(--ink-3)'
      }
    }, fmtSecs(m.finalElapsed)));
    if (m.status === 'failed') return React.createElement(React.Fragment, null, React.createElement('div', {
      style: {
        width: 18,
        height: 18,
        borderRadius: 99,
        background: 'var(--warn)',
        flexShrink: 0
      }
    }), React.createElement('span', {
      style: {
        fontSize: 13,
        color: 'var(--warn)',
        fontWeight: 600
      }
    }, '生成失败'), m.finalElapsed != null && React.createElement('span', {
      className: 'mono',
      style: {
        fontSize: 11,
        color: 'var(--ink-3)'
      }
    }, fmtSecs(m.finalElapsed)));
    return React.createElement(React.Fragment, null, React.createElement('div', {
      style: {
        width: 18,
        height: 18,
        borderRadius: 99,
        border: '2px solid var(--line-2)',
        borderTopColor: 'var(--accent)',
        animation: 'spin 0.8s linear infinite',
        flexShrink: 0
      }
    }), React.createElement('span', {
      style: {
        fontSize: 13,
        color: 'var(--ink)',
        fontWeight: 500
      }
    }, '生成中'), m.startedAt && React.createElement(ChatTimer, {
      startedAt: m.startedAt
    }));
  })()), m.logs && m.logs.length > 0 && /*#__PURE__*/React.createElement(LogBox, {
    logs: m.logs,
    running: m.status !== 'done' && m.status !== 'failed'
  }), m.status === 'done' && m.specialUrls && m.specialUrls.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      flexWrap: 'wrap',
      marginTop: 2
    }
  }, m.zipUrl && /*#__PURE__*/React.createElement("a", {
    href: m.zipUrl,
    target: "_blank",
    rel: "noreferrer",
    style: actionBtnPrimaryStyle
  }, /*#__PURE__*/React.createElement(I.download, {
    size: 11
  }), "\u6253\u5305\u4E0B\u8F7D"), m.penpotUrl && /*#__PURE__*/React.createElement("a", {
    href: m.penpotUrl,
    target: "_blank",
    rel: "noreferrer",
    style: actionBtnSecondaryStyle
  }, /*#__PURE__*/React.createElement(I.edit, {
    size: 11
  }), "\u5728Penpot\u4E2D\u7F16\u8F91")), m.status === 'failed' && m.error && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '10px 12px',
      borderRadius: 6,
      background: 'var(--panel)',
      border: '1px solid var(--warn)',
      fontSize: 12,
      color: 'var(--warn)'
    }
  }, m.error)) : m.type === 'file-attach' ? /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '8px 10px',
      borderRadius: 8,
      background: 'var(--panel)',
      border: '1px solid var(--line-2)',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement(I.file, {
    size: 14,
    style: {
      color: 'var(--accent)',
      flexShrink: 0
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--ink)',
      fontWeight: 500
    }
  }, m.text || '文件'), /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      color: 'var(--ink-3)',
      fontSize: 10,
      marginLeft: 'auto'
    }
  }, "\u5DF2\u4E0A\u4F20")) : m.type === 'proxy-download-choice' ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--ink)'
    }
  }, m.text || '这个链接支持多种格式，请选择一种下载。'), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      flexWrap: 'wrap'
    }
  }, (m.formats || []).map(function (fmt) {
    return React.createElement('button', {
      key: fmt,
      onClick: function () {
        m.onChoose && m.onChoose(fmt);
      },
      style: {
        fontSize: 11,
        padding: '5px 10px',
        borderRadius: 6,
        border: '1px solid var(--line)',
        background: 'white',
        color: 'var(--ink)',
        cursor: 'pointer'
      }
    }, fmt);
  }))) : m.type === 'proxy-download-result' ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 18,
      height: 18,
      borderRadius: 99,
      background: 'var(--ok)',
      flexShrink: 0
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: 'var(--ok)',
      fontWeight: 600
    }
  }, "\u4E0B\u8F7D\u5B8C\u6210")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '10px 12px',
      borderRadius: 8,
      background: 'var(--panel)',
      border: '1px solid var(--line-2)',
      display: 'flex',
      flexDirection: 'column',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      fontWeight: 600,
      color: 'var(--ink)'
    }
  }, m.filename || '下载文件'), /*#__PURE__*/React.createElement("div", {
    className: "mono",
    style: {
      fontSize: 10,
      color: 'var(--ink-3)'
    }
  }, m.format ? m.format + ' · ' : '', m.sizeText || '')), m.downloadUrl && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("a", {
    href: m.downloadUrl,
    target: "_blank",
    rel: "noreferrer",
    style: actionBtnPrimaryStyle
  }, /*#__PURE__*/React.createElement(I.download, {
    size: 11
  }), "\u4E0B\u8F7D\u6587\u4EF6"))) : m.type === 'thinking' ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 6,
      height: 6,
      borderRadius: 99,
      background: 'var(--ink-3)',
      animation: 'pulse 1.2s ease-in-out infinite'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--ink-3)'
    }
  }, m.meta === 'Agent' ? getThinkingPreview(m.thinkingStatus || m.text) : m.text || '让我想想...')), m.thinking ? /*#__PURE__*/React.createElement(ThinkingBlock, {
    text: m.thinking
  }) : null) : /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8
    }
  }, m.thinking ? /*#__PURE__*/React.createElement(ThinkingBlock, {
    text: m.thinking
  }) : null, /*#__PURE__*/React.createElement(CopyableTextBubble, {
    who: m.who,
    text: m.text,
    markdown: true
  }), m.brief || m.contract ? /*#__PURE__*/React.createElement(BriefCard, {
    brief: m.brief,
    contract: m.contract,
    completeness: m.completeness
  }) : null, Array.isArray(m.choices) && m.choices.length > 0 || Array.isArray(m.quickActions) && m.quickActions.length > 0 ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 6
    }
  }, (m.choices || m.quickActions || []).map(function (opt, oi) {
    return React.createElement('button', {
      key: oi,
      onClick: function () {
        onQuickReply(opt.value);
      },
      disabled: isGenerating,
      style: {
        fontSize: 12,
        padding: '7px 14px',
        borderRadius: 18,
        border: '1px solid var(--line-2)',
        background: 'var(--panel)',
        color: 'var(--ink)',
        cursor: isGenerating ? 'default' : 'pointer',
        opacity: isGenerating ? 0.5 : 1
      }
    }, opt.label);
  })) : null, m.who === 'user' && Array.isArray(m.refPreviews) && m.refPreviews.length > 0 ? /*#__PURE__*/React.createElement("div", {
    style: {
      alignSelf: 'stretch',
      padding: '8px 10px',
      borderRadius: 10,
      background: 'var(--panel)',
      border: '1px solid var(--line-2)',
      display: 'flex',
      flexDirection: 'column',
      gap: 7
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "mono",
    style: {
      fontSize: 9.5,
      color: 'var(--ink-3)',
      textTransform: 'uppercase',
      letterSpacing: '0.06em'
    }
  }, "\u53C2\u8003\u56FE ", m.refPreviews.length, " \u5F20"), /*#__PURE__*/React.createElement(InlineRefStrip, {
    items: m.refPreviews,
    compact: true
  })) : null, m.who === 'user' && (!Array.isArray(m.refPreviews) || m.refPreviews.length === 0) && Array.isArray(m.refMeta) && m.refMeta.length > 0 ? /*#__PURE__*/React.createElement("div", {
    style: {
      alignSelf: 'stretch',
      padding: '8px 10px',
      borderRadius: 10,
      background: 'var(--panel)',
      border: '1px solid var(--line-2)',
      display: 'flex',
      flexDirection: 'column',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "mono",
    style: {
      fontSize: 9.5,
      color: 'var(--ink-3)',
      textTransform: 'uppercase',
      letterSpacing: '0.06em'
    }
  }, "\u53C2\u8003\u56FE ", m.refMeta.length, " \u5F20"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 4
    }
  }, m.refMeta.map(function (file, idx) {
    return /*#__PURE__*/React.createElement("div", {
      key: idx,
      style: {
        fontSize: 11.5,
        color: 'var(--ink-2)',
        display: 'flex',
        gap: 8,
        alignItems: 'center'
      }
    }, /*#__PURE__*/React.createElement(I.image, {
      size: 12
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }
    }, file.name || '参考图 ' + (idx + 1)));
  }))) : null))), /*#__PURE__*/React.createElement("style", null, `@keyframes pulse { 0%,100% { opacity:0.3; } 50% { opacity:1; } }`), /*#__PURE__*/React.createElement("div", {
    ref: bottomRef
  }));
};
const normalizeReferenceUrl = function (rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value, window.location.origin);
    const publicPrefixes = ['/ai-images/', '/results/', '/output/', '/avatars/'];
    if (publicPrefixes.some(function (prefix) {
      return parsed.pathname.indexOf(prefix) === 0;
    })) {
      return parsed.pathname + parsed.search + parsed.hash;
    }
    const localHosts = ['localhost', '127.0.0.1', '[::1]', '::1'];
    const parsedHost = String(parsed.hostname || '').toLowerCase();
    if (localHosts.includes(parsedHost)) {
      parsed.protocol = window.location.protocol;
      parsed.host = window.location.host;
      return parsed.toString();
    }
    return parsed.toString();
  } catch (e) {
    return value;
  }
};
const MAX_REFERENCE_IMAGES = 9;
const MAX_REFERENCE_IMAGE_BYTES = 5 * 1024 * 1024; // 单张参考图硬限制 5MB，只在发送时拦截

function referenceFileSize(item) {
  if (item && item.file && typeof item.file.size === 'number') return item.file.size;
  return 0;
}
function listOversizedReferences(items) {
  return (Array.isArray(items) ? items : []).filter(function (item) {
    return referenceFileSize(item) > MAX_REFERENCE_IMAGE_BYTES;
  });
}
function formatOversizedReferenceAlert(items) {
  const names = items.map(function (item) {
    const name = item && (item.name || item.file && item.file.name) || '参考图';
    const size = referenceFileSize(item);
    return size ? name + '（' + (size / (1024 * 1024)).toFixed(1) + 'MB）' : name;
  });
  return '单张参考图不能超过 5MB，请先去掉超限图片再发送：\n' + names.slice(0, 5).join('\n') + (names.length > 5 ? '\n…共 ' + names.length + ' 张' : '');
}
const CHAT_INSPIRATION_CATEGORIES = [{
  id: 'share_card',
  label: '分享卡片'
}, {
  id: 'moments',
  label: '朋友圈'
}, {
  id: 'poster',
  label: '海报'
}, {
  id: 'long_image',
  label: '长图文'
}, {
  id: 'detail_page',
  label: '详情页'
}, {
  id: 'main_image',
  label: '主图'
}, {
  id: 'scene_compose',
  label: '场景合成'
}, {
  id: 'ai_model',
  label: 'AI模特'
}, {
  id: 'ai_tryon',
  label: 'AI换装'
}, {
  id: 'ai_wearable',
  label: 'AI穿戴'
}, {
  id: 'ai_pose',
  label: 'AI裂变姿势'
}];

// ---------- Composer ----------

const DEFAULT_COMPOSER_COMMAND = '/Gpt image 2';
const Composer = ({
  onSend,
  onParseTable,
  onSmartDistribute,
  isLoading,
  slashTrigger,
  template,
  lastSubmittedMessage,
  agentEnabled,
  onToggleAgent,
  resetKey,
  onRequestSpecialTemplate,
  seedPrompt,
  onSeedConsumed,
  canvasReferenceSelection
}) => {
  const [text, setText] = React.useState('');
  const [lockedCommand, setLockedCommand] = React.useState(DEFAULT_COMPOSER_COMMAND);
  const [files, setFiles] = React.useState([]);
  const [imageType, setImageType] = React.useState('png');
  const [aiRatio, setAiRatio] = React.useState('auto');
  const [aiQuality, setAiQuality] = React.useState('1K');
  const [aiProvider, setAiProvider] = React.useState('auto');
  const [aiBatchCount, setAiBatchCount] = React.useState('1');
  const [smartDistributeMode, setSmartDistributeMode] = React.useState('full');
  const [manualRefImages, setManualRefImages] = React.useState([]);
  const [canvasRefImages, setCanvasRefImages] = React.useState([]);
  const [prototypePanel, setPrototypePanel] = React.useState('');
  const [selectedWorkflow, setSelectedWorkflow] = React.useState('chat');
  const [agentSkills, setAgentSkills] = React.useState([]);
  const [selectedSkill, setSelectedSkill] = React.useState('');
  const [skillMenuDismissed, setSkillMenuDismissed] = React.useState(false);
  const taRef = React.useRef(null);
  const fileInputRef = React.useRef(null);
  const [composerHeight, setComposerHeight] = React.useState(null); // null = 默认自动高度
  const composerRef = React.useRef(null);
  const dragRef = React.useRef({
    dragging: false,
    startY: 0,
    startH: 0
  });
  const revokePreviewUrl = React.useCallback(function (url) {
    if (typeof url === 'string' && url.indexOf('blob:') === 0) {
      URL.revokeObjectURL(url);
    }
  }, []);
  const COLLAPSED_COMPOSER_HEIGHT = 176;
  const STATUS_COMPOSER_HEIGHT = 208;
  const MAX_COMPOSER_HEIGHT = 500;
  const minComposerHeightRef = React.useRef(COLLAPSED_COMPOSER_HEIGHT);
  const COMMANDS = React.useMemo(() => ['/花瓣下载', '/特殊品（完整）', '/特殊品', '/Nano Banana pro', '/Gpt image 2'], []);
  const cmdToWorkflow = React.useCallback(function (cmd) {
    const clean = String(cmd || '').trim();
    if (clean === '/Gpt image 2' || clean === '/Nano Banana pro') return 'ai-image';
    if (clean === '/特殊品' || clean === '/特殊品（完整）') return 'special';
    if (clean === '/花瓣下载') return 'download';
    return 'chat';
  }, []);
  const normalizeBatchCount = React.useCallback(function (value) {
    const digits = String(value || '').replace(/\D+/g, '');
    if (!digits) return 1;
    const parsed = parseInt(digits, 10);
    if (!Number.isFinite(parsed)) return 1;
    return Math.max(1, Math.min(4, parsed));
  }, []);
  const parseSkillInvocation = React.useCallback(function (value) {
    const original = String(value || '');
    const trimmedLeft = original.trimStart();
    const match = trimmedLeft.match(/^\$([A-Za-z0-9_-]+)(?:\s+([\s\S]*))?$/);
    if (!match) return {
      skill: '',
      prompt: original
    };
    return {
      skill: match[1],
      prompt: String(match[2] || '').trimStart()
    };
  }, []);
  const activeSkillInfo = React.useMemo(function () {
    const parsed = parseSkillInvocation(text);
    const skillName = selectedSkill || parsed.skill;
    if (!skillName) return null;
    const found = agentSkills.find(function (skill) {
      return skill && skill.name === skillName;
    });
    return found || {
      name: skillName,
      title: skillName,
      description: ''
    };
  }, [agentSkills, parseSkillInvocation, selectedSkill, text]);
  const skillSearch = React.useMemo(function () {
    const raw = String(text || '').trimStart();
    if (!raw.startsWith('$')) return '';
    return raw.slice(1).split(/\s+/)[0].toLowerCase();
  }, [text]);
  const isTypingSkillName = React.useMemo(function () {
    const raw = String(text || '').trimStart();
    return raw === '$' || /^\$[^\s]*$/.test(raw);
  }, [text]);
  const skillMenuOpen = Boolean(isTypingSkillName && !skillMenuDismissed || prototypePanel === 'skills');
  const filteredAgentSkills = React.useMemo(function () {
    const q = skillSearch;
    return agentSkills.filter(function (skill) {
      if (!skill || !skill.name) return false;
      if (!q) return true;
      return String(skill.name).toLowerCase().indexOf(q) >= 0 || String(skill.title || '').toLowerCase().indexOf(q) >= 0 || String(skill.description || '').toLowerCase().indexOf(q) >= 0;
    }).slice(0, 8);
  }, [agentSkills, skillSearch]);
  const skillCardDescription = React.useCallback(function (skill) {
    if (skill && skill.name === 'text-art-design') return '创意中文字体设计';
    return String(skill && skill.description || '').trim();
  }, []);
  const truncateSkillText = React.useCallback(function (value, maxLength) {
    const chars = Array.from(String(value || '').trim());
    if (chars.length <= maxLength) return chars.join('');
    return chars.slice(0, Math.max(0, maxLength - 1)).join('') + '…';
  }, []);
  const selectAgentSkill = React.useCallback(function (skill) {
    if (!skill || !skill.name) return;
    setSelectedSkill(skill.name);
    setSkillMenuDismissed(true);
    setText(function (prev) {
      const raw = String(prev || '');
      if (!raw.trimStart().startsWith('$')) return raw;
      const parsed = parseSkillInvocation(raw);
      return parsed.skill === skill.name ? parsed.prompt : '';
    });
    setPrototypePanel('');
    setTimeout(function () {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }, 0);
  }, [parseSkillInvocation]);
  const [taskDefsKey, setTaskDefsKey] = React.useState(0);
  React.useEffect(() => {
    let alive = true;
    if (!window.API || !window.API.listAgentSkills) return function () {
      alive = false;
    };
    window.API.listAgentSkills().then(function (skills) {
      if (!alive) return;
      setAgentSkills(Array.isArray(skills) ? skills : []);
    }).catch(function (err) {
      console.warn('Load agent skills failed:', err);
    });
    return function () {
      alive = false;
    };
  }, []);

  // 检测花瓣登录状态，未登录则禁用 /花瓣下载 指令
  React.useEffect(() => {
    const apiBase = window.API_BASE || window.location.origin;
    fetch(apiBase + '/proxy-download/login-status', {
      credentials: 'include'
    }).then(r => r.json()).then(data => {
      const cmd = SLASH_COMMANDS.find(c => c.cmd === '/花瓣下载');
      if (cmd) cmd.available = !!data.logged_in;
      setTaskDefsKey(function (k) {
        return k + 1;
      });
    }).catch(() => {});
  }, []);
  const displayValue = text;
  const lockedPrefixLength = 0;
  React.useEffect(() => {
    if (!resetKey) return;
    setText('');
    setSelectedSkill('');
    setLockedCommand(DEFAULT_COMPOSER_COMMAND);
    setSelectedWorkflow('chat');
    setFiles([]);
    clearRefImages();
    setPrototypePanel('');
  }, [resetKey]);
  React.useEffect(() => {
    if (!canvasReferenceSelection || !Array.isArray(canvasReferenceSelection.images)) return;
    let alive = true;
    (async function () {
      try {
        if (!canvasReferenceSelection.images.length) {
          if (!alive) return;
          setCanvasRefImages(function (prev) {
            prev.forEach(function (entry) {
              if (entry && entry.previewUrl) revokePreviewUrl(entry.previewUrl);
            });
            return [];
          });
          return;
        }
        var immediateEntries = canvasReferenceSelection.images.slice(0, MAX_REFERENCE_IMAGES).map(function (item, idx) {
          const src = normalizeReferenceUrl(item && item.src ? item.src : '');
          if (!src) return null;
          return {
            file: null,
            name: String(item && item.name ? item.name : 'reference-' + (idx + 1) + '.png'),
            previewUrl: src,
            sourceUrl: src,
            pending: true,
            origin: 'canvas'
          };
        }).filter(Boolean);
        if (!alive) return;
        setCanvasRefImages(function (prev) {
          prev.forEach(function (entry) {
            if (entry && entry.previewUrl) revokePreviewUrl(entry.previewUrl);
          });
          return immediateEntries;
        });
        const loaded = await Promise.allSettled(immediateEntries.map(async function (item) {
          const response = await fetch(item.sourceUrl, {
            credentials: 'include'
          });
          if (!response.ok) throw new Error('load_reference_failed');
          const blob = await response.blob();
          const ext = blob.type && blob.type.indexOf('/') > -1 ? blob.type.split('/')[1] : 'png';
          const safeName = item.name && /\.[a-z0-9]+$/i.test(item.name) ? item.name : (item.name || 'reference') + '.' + ext;
          const file = new File([blob], safeName, {
            type: blob.type || 'image/png'
          });
          return Object.assign({}, item, {
            file: file,
            pending: false
          });
        }));
        if (!alive) {
          return;
        }
        setCanvasRefImages(function (prev) {
          return prev.map(function (entry) {
            if (!entry || !entry.sourceUrl) return entry;
            const match = loaded.find(function (result) {
              return result && result.status === 'fulfilled' && result.value && result.value.sourceUrl === entry.sourceUrl;
            });
            if (match && match.status === 'fulfilled') return match.value;
            return Object.assign({}, entry, {
              pending: false
            });
          });
        });
      } catch (err) {
        console.error('Load canvas reference images failed:', err);
      }
    })();
    return function () {
      alive = false;
    };
  }, [canvasReferenceSelection, revokePreviewUrl]);
  const refImages = React.useMemo(function () {
    return canvasRefImages.concat(manualRefImages).slice(0, MAX_REFERENCE_IMAGES);
  }, [canvasRefImages, manualRefImages]);

  // —— Composer 拖拽调整高度 ——
  const handleDragStart = React.useCallback(e => {
    e.preventDefault();
    const el = composerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = {
      dragging: true,
      startY: e.clientY,
      startH: rect.height,
      minH: minComposerHeightRef.current
    };
    document.body.style.cursor = 'ns-resize';
  }, []);
  React.useEffect(() => {
    const onMove = e => {
      if (!dragRef.current.dragging) return;
      const dy = dragRef.current.startY - e.clientY; // 向上拖 = 正
      const minH = dragRef.current.minH || COLLAPSED_COMPOSER_HEIGHT;
      const newH = Math.max(minH, Math.min(MAX_COMPOSER_HEIGHT, dragRef.current.startH + dy));
      setComposerHeight(newH);
    };
    const onUp = () => {
      if (!dragRef.current.dragging) return;
      dragRef.current.dragging = false;
      document.body.style.cursor = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);
  React.useEffect(() => {
    if (!prototypePanel && !skillMenuOpen) return;
    const onPointerDown = function (e) {
      if (!composerRef.current) return;
      if (!composerRef.current.contains(e.target)) {
        setPrototypePanel('');
        if (skillMenuOpen) setSkillMenuDismissed(true);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return function () {
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [prototypePanel, skillMenuOpen]);

  // 外部触发 slash 命令（选中特殊品模板时）
  React.useEffect(() => {
    if (agentEnabled) return;
    if (!slashTrigger) return;
    if (slashTrigger.clear) {
      setLockedCommand(function (prev) {
        if (cmdToWorkflow(prev) === 'special') {
          setSelectedWorkflow('chat');
          return '';
        }
        return prev;
      });
      return;
    }
    const nextCmd = '/' + slashTrigger.cmd;
    setLockedCommand(nextCmd);
    setSelectedSkill('');
    setSelectedWorkflow(cmdToWorkflow(nextCmd));
    setPrototypePanel('');
    setText('');
    setTimeout(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(0, 0);
    }, 0);
  }, [agentEnabled, slashTrigger?.key, cmdToWorkflow]);

  // 外部触发：从灵感页"生成同款"传过来，自动锁定 /Gpt image 2 并填入 prompt
  React.useEffect(() => {
    if (!seedPrompt) return;
    setLockedCommand('/Gpt image 2');
    setSelectedSkill('');
    setSelectedWorkflow('ai-image');
    setPrototypePanel('');
    setText(String(seedPrompt));
    setTimeout(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(0, 0);
    }, 0);
    if (onSeedConsumed) onSeedConsumed();
  }, [seedPrompt, onSeedConsumed]);
  React.useEffect(() => {
    if (agentEnabled) {
      setLockedCommand('');
      setSelectedSkill('');
      setSelectedWorkflow('chat');
    }
  }, [agentEnabled]);
  React.useEffect(() => {
    if (template && (template.is_special || template.is_special_full)) return;
    setLockedCommand(function (prev) {
      if (cmdToWorkflow(prev) === 'special') {
        setSelectedWorkflow('chat');
        return '';
      }
      return prev;
    });
  }, [template?.file_id, template?.group_name, template?.id, template?.is_special, template?.is_special_full, cmdToWorkflow]);
  React.useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  }, [displayValue]);

  // Image type options
  const IMAGE_TYPES = [{
    key: 'png',
    label: 'PNG'
  }, {
    key: 'white',
    label: '白底'
  }, {
    key: 'model',
    label: '模特'
  }, {
    key: 'shadow',
    label: '阴影'
  }, {
    key: 'white2x',
    label: '白底x2'
  }];
  const AI_QUALITIES = ['1K', '2K', '4K'];
  // 统一的尺寸选项，两个模型共用（取交集：二者均支持的比例）
  const AI_OPTIONS = {
    auto: {
      label: 'auto',
      qualities: ['1K', '2K', '4K'],
      preview: 'auto',
      px: {
        '1K': 'auto',
        '2K': 'auto',
        '4K': 'auto'
      }
    },
    '1:1': {
      label: '1:1',
      qualities: ['1K', '2K', '4K'],
      preview: '1024×1024',
      px: {
        '1K': '1024×1024',
        '2K': '2048×2048',
        '4K': '2880×2880'
      }
    },
    '3:2': {
      label: '3:2',
      qualities: ['1K', '2K', '4K'],
      preview: '1536×1024',
      px: {
        '1K': '1536×1024',
        '2K': '2048×1360',
        '4K': '3520×2336'
      }
    },
    '2:3': {
      label: '2:3',
      qualities: ['1K', '2K', '4K'],
      preview: '1024×1536',
      px: {
        '1K': '1024×1536',
        '2K': '1360×2048',
        '4K': '2336×3520'
      }
    },
    '4:3': {
      label: '4:3',
      qualities: ['1K', '2K', '4K'],
      preview: '1024×768',
      px: {
        '1K': '1024×768',
        '2K': '2048×1536',
        '4K': '3312×2480'
      }
    },
    '3:4': {
      label: '3:4',
      qualities: ['1K', '2K', '4K'],
      preview: '768×1024',
      px: {
        '1K': '768×1024',
        '2K': '1536×2048',
        '4K': '2480×3312'
      }
    },
    '5:4': {
      label: '5:4',
      qualities: ['1K', '2K', '4K'],
      preview: '1280×1024',
      px: {
        '1K': '1280×1024',
        '2K': '2560×2048',
        '4K': '3216×2576'
      }
    },
    '16:9': {
      label: '16:9',
      qualities: ['1K', '2K', '4K'],
      preview: '1536×864',
      px: {
        '1K': '1536×864',
        '2K': '2048×1152',
        '4K': '3840×2160'
      }
    },
    '9:16': {
      label: '9:16',
      qualities: ['1K', '2K', '4K'],
      preview: '864×1536',
      px: {
        '1K': '864×1536',
        '2K': '1152×2048',
        '4K': '2160×3840'
      }
    }
  };

  // 从文本内容检测当前模式
  // trimmed = 用户实际打的内容（剥去 lockedCommand 锁定的前缀）
  const _t = (() => {
    const raw = String(text || '').trimStart();
    if (lockedCommand && raw.toLowerCase().startsWith(lockedCommand.toLowerCase())) {
      return raw.slice(lockedCommand.length).trimStart();
    }
    return raw;
  })();
  // activeAiModel: 只看 lockedCommand (UI 选的任务, 用户不再手动打前缀)
  const activeAiModel = lockedCommand === '/Gpt image 2' ? 'gpt-image-2' : lockedCommand === '/Nano Banana pro' ? 'nano-banana-pro' : '';
  const activeMode = lockedCommand === '/Gpt image 2' || lockedCommand === '/Nano Banana pro' ? 'ai-image' : lockedCommand === '/特殊品（完整）' ? 'special_full' : lockedCommand === '/特殊品' ? 'special' : selectedWorkflow === 'distribute' ? 'distribute' : selectedWorkflow === 'compose' ? 'compose' : 'chat';
  const isSpecialTemplate = Boolean(template && (template.is_special || template.is_special_full));
  const isImageTypeLocked = activeMode === 'ai-image' || activeMode === 'special' || activeMode === 'special_full' || isSpecialTemplate;
  const aiOptionMap = AI_OPTIONS;
  const AI_RATIOS = Object.keys(aiOptionMap);
  const currentAiRatioMeta = aiOptionMap[aiRatio] || aiOptionMap[AI_RATIOS[0]];
  const _rawQualities = currentAiRatioMeta ? currentAiRatioMeta.qualities : AI_QUALITIES;
  const allowedAiQualities = _rawQualities;
  const currentAiPx = currentAiRatioMeta && currentAiRatioMeta.px ? currentAiRatioMeta.px[aiQuality] || currentAiRatioMeta.preview : '';
  const aiImageSize = aiRatio;
  React.useEffect(() => {
    if (activeAiModel) {
      if (!AI_OPTIONS[aiRatio]) {
        setAiRatio('auto');
        return;
      }
      if (!AI_OPTIONS[aiRatio].qualities.includes(aiQuality)) {
        setAiQuality(AI_OPTIONS[aiRatio].qualities[0]);
      }
      // 渠道选择已移除，统一走智能路由
      if (aiProvider !== 'auto') {
        setAiProvider('auto');
      }
    }
  }, [activeAiModel, aiQuality, aiRatio, aiProvider]);
  const selectWorkflow = React.useCallback(function (next) {
    if (agentEnabled) return;
    const cmd = next && next.cmd ? next.cmd : '';
    if (cmd) {
      setLockedCommand(cmd);
      setSelectedSkill('');
      setSelectedWorkflow(cmdToWorkflow(cmd));
      setPrototypePanel('');
      setTimeout(() => {
        const el = taRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(0, 0);
      }, 0);
      return;
    }
    setLockedCommand('');
    setSelectedSkill('');
    setSelectedWorkflow(next && next.workflow ? next.workflow : 'chat');
    setPrototypePanel('');
    setTimeout(() => {
      const el = taRef.current;
      if (el) el.focus();
    }, 0);
  }, [agentEnabled, cmdToWorkflow]);
  const restoreMessage = React.useCallback(message => {
    const raw = String(message || '');
    const matched = COMMANDS.find(function (cmd) {
      return raw === cmd || raw.startsWith(cmd + ' ');
    });
    if (matched) {
      setLockedCommand(matched);
      setSelectedSkill('');
      setSelectedWorkflow(cmdToWorkflow(matched));
      setText(raw.slice(matched.length).trimStart());
    } else if (raw.trimStart().startsWith('$')) {
      const parsed = parseSkillInvocation(raw);
      setLockedCommand('');
      setSelectedWorkflow('chat');
      setSelectedSkill(parsed.skill || '');
      setText(parsed.prompt || '');
    } else {
      setLockedCommand('');
      setSelectedSkill('');
      setSelectedWorkflow('chat');
      setText(raw);
    }
    setTimeout(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }, 0);
  }, [COMMANDS, cmdToWorkflow, parseSkillInvocation]);
  const handleSend = () => {
    const body = text.trim();
    const smartFile = files.find(function (item) {
      return item.kind === 'smart-distribute' && item.file;
    });
    if (smartFile) {
      if (isLoading) return;
      if (onSmartDistribute) {
        onSmartDistribute(smartFile.file, smartFile.name, smartDistributeMode).catch(function (err) {
          console.error('Smart distribute send error:', err);
        });
      }
      setFiles(function (prev) {
        return prev.filter(function (item) {
          return item !== smartFile;
        });
      });
      setText('');
      return;
    }
    const message = selectedSkill ? '$' + selectedSkill + (body ? ' ' + body : '') : lockedCommand ? lockedCommand + (body ? ' ' + body : '') : body;
    const skillInvocation = parseSkillInvocation(message);
    const sendMessage = message;
    const executionMessage = skillInvocation.skill ? skillInvocation.prompt : message;
    if (!executionMessage || isLoading) return;
    if (refImages.some(function (item) {
      return item && item.pending;
    })) {
      window.alert('参考图还在加载，请稍候再发送');
      return;
    }
    const oversizedRefs = listOversizedReferences(refImages);
    if (oversizedRefs.length) {
      window.alert(formatOversizedReferenceAlert(oversizedRefs));
      return;
    }
    const imagesToSend = [...refImages];
    const normalizedBatchCount = normalizeBatchCount(aiBatchCount);
    // 先发消息再清空输入，避免 isLoading=true 时消息丢失
    onSend(sendMessage, imagesToSend, {
      size: aiImageSize,
      resolution: aiQuality,
      provider: aiProvider,
      workflow: selectedWorkflow,
      lockedCommand: lockedCommand,
      batchCount: selectedWorkflow === 'ai-image' ? normalizedBatchCount : 1,
      skill: skillInvocation.skill || '',
      skillPrompt: executionMessage
    });
    setAiBatchCount(String(normalizedBatchCount));
    setText('');
    setSelectedSkill('');
    clearRefImages();
  };
  const overlayRef = React.useRef(null);
  const hasRefTag = React.useMemo(() => /([@＃#](?:图片|图)?\d+|(?:图|图片)\d+)/.test(text), [text]);
  const handleScrollSync = React.useCallback(e => {
    if (overlayRef.current) {
      overlayRef.current.scrollTop = e.target.scrollTop;
    }
  }, []);
  const renderFormattedOverlayText = React.useCallback(function (rawText) {
    if (!rawText) return null;
    const regex = /([@＃#](?:图片|图)?\d+|(?:图|图片)\d+)/g;
    const parts = String(rawText).split(regex);
    return parts.map(function (part, i) {
      const isTag = /^([@＃#](?:图片|图)?\d+|(?:图|图片)\d+)$/.test(part);
      if (isTag) {
        return /*#__PURE__*/React.createElement("mark", {
          key: i,
          style: {
            background: 'rgba(99, 102, 241, 0.12)',
            color: 'transparent',
            borderRadius: 3,
            boxShadow: '0 0 0 2px rgba(99, 102, 241, 0.12)',
            padding: 0,
            margin: 0,
            font: 'inherit'
          }
        }, part);
      }
      return /*#__PURE__*/React.createElement("span", {
        key: i,
        style: {
          color: 'transparent'
        }
      }, part);
    });
  }, []);
  const insertRefTag = React.useCallback(idx => {
    const tag = `@图片${idx + 1} `;
    setText(function (prev) {
      const current = String(prev || '');
      const input = taRef.current;
      if (!input) return current + tag;
      const start = input.selectionStart ?? current.length;
      const end = input.selectionEnd ?? current.length;
      const next = current.slice(0, start) + tag + current.slice(end);
      setTimeout(function () {
        if (!taRef.current) return;
        taRef.current.focus();
        const newPos = start + tag.length;
        taRef.current.setSelectionRange(newPos, newPos);
      }, 0);
      return next;
    });
  }, []);
  const handleKeyDown = e => {
    const el = taRef.current;
    const start = el ? el.selectionStart : 0;
    const end = el ? el.selectionEnd : 0;
    const currentMessage = lockedCommand ? text.trim() || lockedCommand : text.trim();
    if (e.key === 'Escape' && skillMenuOpen) {
      e.preventDefault();
      setPrototypePanel('');
      setSkillMenuDismissed(true);
      return;
    }
    if (e.key === 'Backspace' && start === end) {
      const rawText = String(text || '');
      const regex = /([@＃#](?:图片|图)?\d+|(?:图|图片)\d+)/g;
      let match;
      while ((match = regex.exec(rawText)) !== null) {
        const mStart = match.index;
        const mEnd = match.index + match[0].length;
        if (start > mStart && start <= mEnd) {
          e.preventDefault();
          const nextText = rawText.slice(0, mStart) + rawText.slice(mEnd);
          setText(nextText);
          setTimeout(() => {
            if (taRef.current) {
              taRef.current.focus();
              taRef.current.setSelectionRange(mStart, mStart);
            }
          }, 0);
          return;
        }
      }
    }
    if (e.key === 'Backspace' && String(text || '').trimStart().startsWith('$') && start <= String(text || '').indexOf('$') + 1 && end <= String(text || '').indexOf('$') + 1) {
      e.preventDefault();
      setText('');
      setSelectedSkill('');
      setSkillMenuDismissed(true);
      setPrototypePanel('');
      return;
    }
    if (e.key === 'Backspace' && activeSkillInfo && start === 0 && end === 0) {
      e.preventDefault();
      setSelectedSkill('');
      setSkillMenuDismissed(true);
      return;
    }
    if (e.key === 'ArrowDown' && files.length === 0 && refImages.length === 0 && lastSubmittedMessage && currentMessage === lastSubmittedMessage) {
      e.preventDefault();
      clearComposer();
      return;
    }
    if (e.key === 'ArrowUp' && !lockedCommand && !text.trim() && files.length === 0 && refImages.length === 0 && lastSubmittedMessage) {
      e.preventDefault();
      restoreMessage(lastSubmittedMessage);
      return;
    }
    if (lockedCommand) {
      if (e.key === 'ArrowUp' && !text.trim() && files.length === 0 && refImages.length === 0 && lastSubmittedMessage) {
        e.preventDefault();
        restoreMessage(lastSubmittedMessage);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };
  const handleTextChange = e => {
    const next = e.target.value;
    if (selectedSkill) {
      setPrototypePanel('');
      setSkillMenuDismissed(true);
      const parsed = parseSkillInvocation(next);
      setText(parsed.skill ? parsed.prompt : next);
      return;
    }
    if (next.trimStart().startsWith('$')) {
      setPrototypePanel('');
      setSelectedSkill('');
      setSkillMenuDismissed(false);
    } else {
      setSkillMenuDismissed(false);
    }
    if (agentEnabled) {
      setText(next);
      return;
    }
    if (lockedCommand) {
      if (next.startsWith(lockedCommand + ' ')) {
        setText(next.slice(lockedCommand.length).trimStart());
        return;
      }
      if (next === lockedCommand) {
        setText('');
        return;
      }
      setText(next);
      return;
    }
    if (!lockedCommand) {
      const matched = COMMANDS.find(function (cmd) {
        return next.startsWith(cmd + ' ');
      });
      if (matched) {
        setLockedCommand(matched);
        setSelectedWorkflow(cmdToWorkflow(matched));
        setText(next.slice(matched.length).trimStart());
        return;
      }
    }
    setText(next);
  };
  const clampSelection = () => {
    return;
  };
  const handleFileSelect = e => {
    const fileList = Array.from(e.target.files || []);
    if (!fileList.length) return;
    const images = fileList.filter(f => f.type.startsWith('image/'));
    const others = fileList.filter(f => !f.type.startsWith('image/'));
    if (images.length) addImageFiles(images);
    if (others.length && !agentEnabled) {
      const file = others[0];
      if (selectedWorkflow === 'distribute' && isSmartDistributeFile(file)) {
        addSmartDistributeFile(file);
      } else {
        const fileObj = {
          name: file.name,
          size: formatFileSize(file.size),
          file,
          imageType
        };
        setFiles(prev => [...prev, fileObj]);
        if (onParseTable) {
          onParseTable(file, file.name, imageType).catch(err => console.error('Parse table error:', err));
        }
      }
    }
    e.target.value = '';
  };
  const handlePaste = e => {
    const items = Array.from(e.clipboardData?.items || []);
    const fileItems = items.filter(it => it.kind === 'file');
    if (!fileItems.length) return;
    e.preventDefault();
    const files = fileItems.map(it => it.getAsFile()).filter(Boolean);
    const images = files.filter(f => f && f.type.startsWith('image/'));
    const excels = files.filter(f => f && /\.(xlsx|xlsm)$/i.test(f.name));
    if (excels.length && selectedWorkflow === 'distribute') {
      addSmartDistributeFile(excels[0]);
    } else if (images.length) {
      addImageFiles(images);
    }
  };
  const removeRefImage = idx => {
    const target = refImages[idx];
    if (!target) return;
    if (target.origin === 'canvas') {
      setCanvasRefImages(function (prev) {
        const hitIndex = prev.findIndex(function (item) {
          return item && target && item.sourceUrl === target.sourceUrl && item.previewUrl === target.previewUrl;
        });
        if (hitIndex >= 0) revokePreviewUrl(prev[hitIndex]?.previewUrl);
        return prev.filter(function (_, i) {
          return i !== hitIndex;
        });
      });
      return;
    }
    setManualRefImages(function (prev) {
      const hitIndex = prev.findIndex(function (item) {
        return item && target && item.previewUrl === target.previewUrl;
      });
      if (hitIndex >= 0) revokePreviewUrl(prev[hitIndex]?.previewUrl);
      return prev.filter(function (_, i) {
        return i !== hitIndex;
      });
    });
  };
  const clearRefImages = () => {
    setCanvasRefImages(function (prev) {
      prev.forEach(function (r) {
        revokePreviewUrl(r.previewUrl);
      });
      return [];
    });
    setManualRefImages(function (prev) {
      prev.forEach(function (r) {
        revokePreviewUrl(r.previewUrl);
      });
      return [];
    });
  };

  // ---------- 拖拽上传图片 ----------
  const [isDraggingOver, setIsDraggingOver] = React.useState(false);
  const dragCounterRef = React.useRef(0);

  // 提取通用的添加图片函数，被拖拽/粘贴/文件选择共用
  const addImageFiles = React.useCallback(files => {
    const images = Array.from(files || []).filter(f => f && f.type && f.type.startsWith('image/'));
    if (!images.length) return 0;
    setManualRefImages(prev => {
      const remaining = Math.max(0, MAX_REFERENCE_IMAGES - canvasRefImages.length - prev.length);
      if (remaining <= 0) return prev;
      const toAdd = images.slice(0, remaining).map(file => ({
        file,
        name: file.name,
        previewUrl: URL.createObjectURL(file),
        sourceUrl: '',
        pending: false,
        origin: 'manual'
      }));
      return [...prev, ...toAdd];
    });
    return Math.min(images.length, Math.max(0, MAX_REFERENCE_IMAGES - canvasRefImages.length - manualRefImages.length));
  }, [canvasRefImages.length, manualRefImages.length]);
  const handleDragEnter = e => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    setIsDraggingOver(true);
  };
  const handleDragOver = e => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const handleDragLeave = e => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
    e.preventDefault();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDraggingOver(false);
  };
  const handleDrop = e => {
    if (!e.dataTransfer) return;
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDraggingOver(false);
    var files = e.dataTransfer.files;
    if (selectedWorkflow === 'distribute') {
      // 智能铺货模式支持 Excel 拖入
      var excels = Array.from(files || []).filter(function (f) {
        return /\.(xlsx|xlsm)$/i.test(f.name);
      });
      if (excels.length) {
        addSmartDistributeFile(excels[0]);
      } else {
        if (files && files.length) addImageFiles(files);
      }
    } else {
      if (files && files.length) addImageFiles(files);
    }
  };
  const clearComposer = React.useCallback(() => {
    setText('');
    setSelectedSkill('');
    setLockedCommand(DEFAULT_COMPOSER_COMMAND);
    setSelectedWorkflow('chat');
    setFiles([]);
    clearRefImages();
    setTimeout(() => {
      const el = taRef.current;
      if (el) el.focus();
    }, 0);
  }, []);
  const formatFileSize = bytes => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };
  const isSmartDistributeFile = function (file) {
    return file && /\.(xlsx|xlsm)$/i.test(file.name || '');
  };
  const addSmartDistributeFile = function (file) {
    if (!isSmartDistributeFile(file)) return false;
    const fileObj = {
      name: file.name,
      size: formatFileSize(file.size),
      file,
      kind: 'smart-distribute'
    };
    setFiles(function (prev) {
      return prev.filter(function (item) {
        return item.kind !== 'smart-distribute';
      }).concat(fileObj);
    });
    return true;
  };
  const canSend = Boolean((lockedCommand ? (lockedCommand + ' ' + text.trim()).trim() : text.trim()) || files.length) && !isLoading;
  const getTaskDefinitions = React.useCallback(function () {
    var slashMap = {};
    try {
      var cmds = window.SLASH_COMMANDS || [];
      cmds.forEach(function (c) {
        slashMap[c.cmd] = c.available !== false;
      });
    } catch (e) {}
    function available(cmd) {
      if (!cmd) return true; // 无 cmd 的卡片始终可用
      return slashMap[cmd] !== false;
    }
    return [{
      id: 'chat',
      label: '默认',
      desc: '询问流程、模板、素材规则',
      iconKey: 'sparkles',
      workflow: 'chat'
    }, {
      id: 'gpt-image',
      label: 'GPT Image 2',
      desc: '文生图，中文语义和文字更强',
      iconKey: 'image',
      iconSrc: 'src/icon/openai.png',
      cmd: '/Gpt image 2',
      available: available('/Gpt image 2')
    }, {
      id: 'nano-banana',
      label: 'Nano Banana Pro',
      desc: '图生图/改图，参考图一致性更强',
      iconKey: 'image',
      iconSrc: 'src/icon/gemini-color.png',
      cmd: '/Nano Banana pro',
      available: available('/Nano Banana pro')
    }, {
      id: 'distribute',
      label: '智能铺货',
      desc: '上传表格，自动解析为铺货 JSON',
      iconKey: 'grid',
      workflow: 'distribute'
    }, {
      id: 'special',
      label: '特殊品',
      desc: '使用特殊品模板合成结果',
      iconKey: 'layers',
      cmd: template && template.is_special_full ? '/特殊品（完整）' : '/特殊品',
      available: available(template && template.is_special_full ? '/特殊品（完整）' : '/特殊品')
    }, {
      id: 'download',
      label: '花瓣下载',
      desc: '输入花瓣 ID，自动识别可下载格式',
      iconKey: 'download',
      cmd: '/花瓣下载',
      available: available('/花瓣下载')
    }];
  }, [template && template.is_special_full, taskDefsKey]);
  const getTaskIcon = React.useCallback(function (iconKey) {
    return I[iconKey] || I.sparkles;
  }, []);
  const activeTaskLabel = activeMode === 'ai-image' ? activeAiModel === 'nano-banana-pro' ? 'Nano Banana Pro' : 'GPT Image 2' : activeMode === 'special_full' ? '完整特殊品' : activeMode === 'special' ? '特殊品' : selectedWorkflow === 'compose' ? '智能铺品' : selectedWorkflow === 'distribute' ? '智能铺货' : selectedWorkflow === 'download' ? '花瓣下载' : '默认';
  const activeTaskIconKey = activeMode === 'ai-image' ? 'image' : activeMode === 'special' || activeMode === 'special_full' ? 'layers' : selectedWorkflow === 'compose' || selectedWorkflow === 'distribute' ? 'grid' : selectedWorkflow === 'download' ? 'download' : 'sparkles';
  const activeTaskIcon = getTaskIcon(activeTaskIconKey);
  const activeTaskIconSrc = activeMode === 'ai-image' ? activeAiModel === 'nano-banana-pro' ? 'src/icon/gemini-color.png' : 'src/icon/openai.png' : null;
  const modeParamLabel = activeMode === 'ai-image' ? aiRatio + ' · ' + aiQuality : activeMode === 'special_full' ? '线路 完整' : activeMode === 'special' ? '线路 普通' : selectedWorkflow === 'compose' ? imageType ? '素材 ' + (IMAGE_TYPES.find(t => t.key === imageType)?.label || imageType) : '' : selectedWorkflow === 'distribute' ? smartDistributeMode === 'patch' ? '方式 增量' : '方式 全量' : '';
  const selectedSettingBits = [activeSkillInfo ? '$' + activeSkillInfo.name : '', activeSkillInfo ? '' : agentEnabled ? 'Agent' : activeTaskLabel, agentEnabled ? '沉浸创作' : activeMode === 'ai-image' ? '⚡ 智能' : '', agentEnabled ? '' : modeParamLabel, activeMode === 'ai-image' && normalizeBatchCount(aiBatchCount) > 1 ? 'x' + normalizeBatchCount(aiBatchCount) : '', refImages.length > 0 ? 'ref ' + refImages.length + '/' + MAX_REFERENCE_IMAGES : '', files.length > 0 ? '文件 ' + files.length : ''].filter(Boolean);
  const composerPlaceholder = agentEnabled ? '描述你的创作目标，或回复 Agent 的问题（也可点选项快速回答）' : activeMode === 'ai-image' ? activeAiModel === 'nano-banana-pro' ? '描述要怎么编辑参考图，例如：保留鞋型，换成雨天街拍背景' : '描述想生成的画面，例如：电商主图，白色跑鞋，清爽科技感' : activeMode === 'special_full' ? 'ABAW023-6，飓风2 极限之力 雷暴篮球专业比赛鞋，5月20日 10点发售' : activeMode === 'special' ? 'ABAW023-6，飓风2 极限之力 雷暴篮球专业比赛鞋，5月20日 10点发售' : selectedWorkflow === 'compose' ? '上传表格后补充合成要求，例如：优先使用白底图，文案保持简洁' : selectedWorkflow === 'distribute' ? '上传或拖入 Excel（.xlsx / .xlsm），确认参数后发送生成铺货 JSON' : selectedWorkflow === 'download' ? '输入花瓣项目 ID 或链接，格式会自动识别' : '忘了怎么用？试试直接提问吧';
  const statusBarVisible = Boolean(text.trim() || lockedCommand || modeParamLabel || refImages.length > 0 || files.length > 0 || activeSkillInfo || skillMenuOpen || !agentEnabled && prototypePanel);
  const minComposerHeight = statusBarVisible ? STATUS_COMPOSER_HEIGHT : COLLAPSED_COMPOSER_HEIGHT;
  minComposerHeightRef.current = minComposerHeight;
  const prototypeToolButton = function (panel, title, icon, label, options) {
    const open = prototypePanel === panel;
    return React.createElement('button', Object.assign({
      type: 'button',
      onClick: function () {
        setPrototypePanel(open ? '' : panel);
      },
      title: title,
      style: Object.assign({
        height: 36,
        minWidth: label ? 74 : 36,
        padding: label ? '0 12px' : 0,
        borderRadius: 10,
        border: '1px solid ' + (open ? 'var(--ink-3)' : 'var(--line-2)'),
        background: open ? 'var(--panel-2)' : 'transparent',
        color: open ? 'var(--ink)' : 'var(--ink-2)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        cursor: 'pointer',
        boxShadow: 'none',
        transition: 'background 140ms, border-color 140ms, transform 140ms, box-shadow 140ms',
        flexShrink: 0
      }, options || {})
    }), icon, label ? React.createElement('span', {
      style: {
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: 'nowrap'
      }
    }, label) : null);
  };
  const renderSkillMenu = function () {
    if (!skillMenuOpen || !agentSkills.length) return null;
    return React.createElement('div', {
      style: {
        position: 'absolute',
        left: 12,
        right: 12,
        bottom: 92,
        zIndex: 20,
        border: 'none',
        borderRadius: 16,
        background: 'color-mix(in oklab, var(--panel) 96%, transparent)',
        boxShadow: '0 18px 42px rgba(15, 23, 42, 0.07)',
        padding: 6,
        display: 'grid',
        gap: 6,
        maxHeight: 248,
        overflow: 'auto',
        backdropFilter: 'blur(14px)'
      }
    }, filteredAgentSkills.length ? filteredAgentSkills.map(function (skill) {
      const active = activeSkillInfo && activeSkillInfo.name === skill.name;
      const cardDescription = skillCardDescription(skill);
      return React.createElement('button', {
        key: skill.name,
        type: 'button',
        onMouseDown: function (e) {
          e.preventDefault();
          selectAgentSkill(skill);
        },
        onClick: function (e) {
          e.preventDefault();
        },
        style: {
          border: '1px solid ' + (active ? 'var(--accent)' : 'var(--line-2)'),
          background: active ? 'color-mix(in oklab, var(--accent) 10%, var(--panel))' : 'var(--panel)',
          borderRadius: 14,
          padding: '9px 11px',
          textAlign: 'left',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minWidth: 0,
          position: 'relative',
          boxShadow: 'none',
          transition: 'background 140ms, border-color 140ms, transform 140ms'
        }
      }, React.createElement('span', {
        style: {
          width: 18,
          height: 18,
          borderRadius: 7,
          border: '1px solid var(--line-2)',
          color: 'var(--accent)',
          fontSize: 12,
          fontWeight: 800,
          lineHeight: '17px',
          textAlign: 'center',
          flexShrink: 0,
          background: 'var(--panel-2)'
        }
      }, '✦'), React.createElement('span', {
        style: {
          fontSize: 13,
          fontWeight: 750,
          color: 'var(--ink)',
          flexShrink: 0,
          maxWidth: 150,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }
      }, truncateSkillText(skill.name, 24)), cardDescription ? React.createElement('span', {
        style: {
          fontSize: 11,
          color: 'var(--ink-3)',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        },
        title: cardDescription
      }, truncateSkillText(cardDescription, 18)) : null);
    }) : React.createElement('div', {
      style: {
        padding: 12,
        fontSize: 12,
        color: 'var(--ink-3)'
      }
    }, '没有匹配的 Skill'));
  };
  const protoChipStyle = function (active) {
    return {
      border: '1px solid ' + (active ? 'var(--ink)' : 'var(--line-2)'),
      background: active ? 'var(--ink)' : 'var(--panel)',
      color: active ? 'var(--panel)' : 'var(--ink-2)',
      borderRadius: 999,
      padding: '6px 8px',
      fontSize: 10.5,
      fontWeight: 600,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      cursor: 'default',
      minHeight: 30
    };
  };
  const protoPanelShell = function (children, width) {
    // width:
    // - 'fluid'  → 贴父容器左右，略缩进
    // - 'fill'   → 贴满父容器内容区（用于生图参数，对齐输入框）
    // - number   → 固定宽度
    const fluid = width === 'fluid';
    const fill = width === 'fill';
    return React.createElement(React.Fragment, null,
    // 透明 backdrop：点击面板外任意位置自动关闭
    React.createElement('div', {
      key: 'backdrop',
      onClick: function () {
        setPrototypePanel('');
      },
      style: {
        position: 'fixed',
        inset: 0,
        zIndex: 19
      }
    }), React.createElement('div', {
      key: 'panel',
      style: {
        position: 'absolute',
        left: fill ? 0 : fluid ? 8 : 0,
        right: fill ? 0 : fluid ? 8 : 'auto',
        bottom: 58,
        width: fill || fluid ? 'auto' : width || 360,
        maxWidth: fill || fluid ? 'none' : 'calc(100vw - 36px)',
        borderRadius: 14,
        border: '1px solid var(--line)',
        background: 'var(--panel)',
        boxShadow: '0 12px 28px rgba(25,24,20,0.08)',
        padding: fill ? '12px 12px 10px' : 14,
        zIndex: 20,
        overflow: 'hidden',
        boxSizing: 'border-box'
      }
    }, children));
  };
  const protoSectionLabel = function (text) {
    return React.createElement('div', {
      className: 'mono',
      style: {
        fontSize: 9.5,
        color: 'var(--ink-3)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        margin: '12px 0 7px'
      }
    }, text);
  };
  const renderPrototypePanel = function () {
    if (!prototypePanel) return null;
    if (prototypePanel === 'task') {
      const tasks = getTaskDefinitions();
      return protoPanelShell(React.createElement(React.Fragment, null, React.createElement('div', {
        style: {
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12
        }
      }, React.createElement('div', {
        style: {
          fontSize: 16,
          fontWeight: 700,
          letterSpacing: '-0.01em',
          color: 'var(--ink)'
        }
      }, '选择功能'), React.createElement('div', {
        className: 'mono',
        style: {
          fontSize: 10,
          color: 'var(--ink-3)'
        }
      }, 'live')), React.createElement('div', {
        style: {
          marginTop: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 6
        }
      }, tasks.map(function (item) {
        const isAvailable = item.available !== false;
        const active = item.cmd ? lockedCommand === item.cmd : !lockedCommand && selectedWorkflow === item.workflow;
        const IconComp = getTaskIcon(item.iconKey);
        return React.createElement('button', {
          key: item.label,
          type: 'button',
          disabled: !isAvailable,
          onClick: function () {
            if (isAvailable) selectWorkflow(item);
          },
          style: {
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 11,
            padding: '10px 11px',
            borderRadius: 13,
            background: active ? 'var(--panel-2)' : 'transparent',
            border: '1px solid ' + (active ? 'var(--line)' : 'transparent'),
            textAlign: 'left',
            cursor: isAvailable ? 'pointer' : 'not-allowed',
            opacity: isAvailable ? 1 : 0.4
          }
        }, item.iconSrc ? React.createElement('img', {
          src: item.iconSrc,
          alt: item.label,
          style: {
            width: 30,
            height: 30,
            borderRadius: 999,
            objectFit: 'cover',
            opacity: isAvailable ? 1 : 0.5
          }
        }) : React.createElement('div', {
          style: {
            width: 30,
            height: 30,
            borderRadius: 999,
            background: active ? 'var(--ink)' : 'var(--panel-2)',
            color: active ? 'var(--panel)' : 'var(--ink-3)',
            display: 'grid',
            placeItems: 'center'
          }
        }, React.createElement(IconComp, {
          size: 14
        })), React.createElement('div', {
          style: {
            flex: 1,
            minWidth: 0
          }
        }, React.createElement('div', {
          style: {
            fontSize: 13,
            fontWeight: 700,
            color: 'var(--ink)'
          }
        }, item.label), React.createElement('div', {
          style: {
            fontSize: 11,
            color: 'var(--ink-3)',
            marginTop: 2
          }
        }, item.desc)));
      }))), 344);
    }
    if (prototypePanel === 'params') {
      const sizeItems = [['auto', '自动'], ['1:1', '1:1'], ['3:2', '3:2'], ['2:3', '2:3'], ['4:3', '4:3'], ['3:4', '3:4'], ['5:4', '5:4'], ['16:9', '16:9'], ['9:16', '9:16']];
      const ratioIconSize = function (key) {
        const base = 10;
        if (key === 'auto') return {
          w: base,
          h: base
        };
        const parts = String(key).split(':');
        const rw = parseFloat(parts[0]) || 1;
        const rh = parseFloat(parts[1]) || 1;
        if (rw >= rh) {
          return {
            w: base + 3,
            h: Math.max(6, Math.round((base + 3) * rh / rw))
          };
        }
        return {
          w: Math.max(6, Math.round((base + 3) * rw / rh)),
          h: base + 3
        };
      };
      const isImageParams = activeMode === 'ai-image';
      const isSpecialParams = activeMode === 'special' || activeMode === 'special_full';
      const isComposeParams = activeMode === 'compose';
      const isDistributeParams = activeMode === 'distribute';
      const paramsTitle = isImageParams ? '生图参数' : isSpecialParams ? '特殊品参数' : isComposeParams ? '合成参数' : isDistributeParams ? '铺货参数' : '问答参数';
      const batchCountValue = normalizeBatchCount(aiBatchCount);
      const imageFieldLabel = function (text, extraStyle) {
        return React.createElement('div', {
          style: Object.assign({
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--ink-2)',
            letterSpacing: '-0.01em',
            marginBottom: 8
          }, extraStyle || {})
        }, text);
      };
      return protoPanelShell(React.createElement(React.Fragment, null, !isImageParams && React.createElement('div', {
        style: {
          fontSize: 16,
          fontWeight: 700,
          letterSpacing: '-0.01em',
          color: 'var(--ink)'
        }
      }, paramsTitle), isImageParams && React.createElement(React.Fragment, null, imageFieldLabel('尺寸'), React.createElement('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
          gap: 6
        }
      }, sizeItems.map(function (item) {
        const active = aiRatio === item[0];
        const dims = ratioIconSize(item[0]);
        return React.createElement('button', {
          key: item[0],
          type: 'button',
          onClick: function () {
            setAiRatio(item[0]);
          },
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
            width: '100%',
            height: 30,
            padding: '0 4px',
            borderRadius: 9,
            background: active ? 'var(--accent-soft)' : 'var(--panel)',
            border: '1px solid ' + (active ? 'color-mix(in oklch, var(--accent) 45%, white)' : 'var(--line)'),
            color: active ? 'var(--accent-ink)' : 'var(--ink-2)',
            boxShadow: 'none',
            cursor: 'pointer',
            fontSize: 11.5,
            fontWeight: active ? 650 : 500,
            letterSpacing: '-0.01em',
            minWidth: 0
          }
        }, item[0] === 'auto' ? active ? React.createElement(I.check, {
          size: 12,
          stroke: 2.2
        }) : React.createElement('div', {
          style: {
            width: 10,
            height: 10,
            borderRadius: 2.5,
            border: '1.5px solid currentColor',
            opacity: 0.7,
            flexShrink: 0
          }
        }) : React.createElement('div', {
          style: {
            width: dims.w,
            height: dims.h,
            borderRadius: 2,
            border: '1.5px solid currentColor',
            opacity: active ? 0.95 : 0.7,
            flexShrink: 0
          }
        }), React.createElement('span', {
          style: {
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }
        }, item[1]));
      })), React.createElement('div', {
        style: {
          height: 1,
          background: 'var(--line)',
          margin: '12px 0 12px'
        }
      }), React.createElement('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 16,
          alignItems: 'start'
        }
      }, React.createElement('div', null, imageFieldLabel('清晰度'), React.createElement('div', {
        style: {
          display: 'flex',
          width: '100%',
          alignItems: 'stretch',
          border: '1px solid var(--line)',
          borderRadius: 9,
          overflow: 'hidden',
          background: 'var(--panel)'
        }
      }, ['1K', '2K', '4K'].map(function (q, idx) {
        const disabled = !allowedAiQualities.includes(q);
        const active = aiQuality === q;
        return React.createElement('button', {
          key: q,
          type: 'button',
          disabled: disabled,
          onClick: function () {
            if (!disabled) setAiQuality(q);
          },
          style: {
            flex: 1,
            height: 30,
            padding: 0,
            border: 'none',
            borderLeft: idx === 0 ? 'none' : '1px solid var(--line)',
            background: active ? 'var(--ink)' : 'transparent',
            color: active ? 'var(--panel)' : 'var(--ink-2)',
            fontSize: 12,
            fontWeight: active ? 700 : 550,
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.4 : 1,
            letterSpacing: '-0.01em'
          }
        }, q);
      }))), React.createElement('div', null, imageFieldLabel('并发数 1-4 张'), React.createElement('div', {
        style: {
          display: 'flex',
          width: '100%',
          alignItems: 'center',
          height: 30,
          border: '1px solid var(--line)',
          borderRadius: 9,
          overflow: 'hidden',
          background: 'var(--panel)'
        }
      }, React.createElement('button', {
        type: 'button',
        disabled: batchCountValue <= 1,
        onClick: function () {
          setAiBatchCount(String(Math.max(1, batchCountValue - 1)));
        },
        style: {
          width: 34,
          height: '100%',
          display: 'grid',
          placeItems: 'center',
          color: batchCountValue <= 1 ? 'var(--ink-3)' : 'var(--ink-2)',
          cursor: batchCountValue <= 1 ? 'not-allowed' : 'pointer',
          fontSize: 15,
          fontWeight: 500,
          lineHeight: 1,
          borderRight: '1px solid var(--line)',
          background: 'transparent',
          flexShrink: 0
        }
      }, '−'), React.createElement('div', {
        style: {
          flex: 1,
          textAlign: 'center',
          fontSize: 12.5,
          fontWeight: 650,
          color: 'var(--ink)',
          letterSpacing: '-0.01em'
        }
      }, String(batchCountValue)), React.createElement('button', {
        type: 'button',
        disabled: batchCountValue >= 4,
        onClick: function () {
          setAiBatchCount(String(Math.min(4, batchCountValue + 1)));
        },
        style: {
          width: 34,
          height: '100%',
          display: 'grid',
          placeItems: 'center',
          color: batchCountValue >= 4 ? 'var(--ink-3)' : 'var(--ink-2)',
          cursor: batchCountValue >= 4 ? 'not-allowed' : 'pointer',
          fontSize: 15,
          fontWeight: 500,
          lineHeight: 1,
          borderLeft: '1px solid var(--line)',
          background: 'transparent',
          flexShrink: 0
        }
      }, '+'))))), activeMode === 'chat' && React.createElement('div', {
        style: {
          marginTop: 12,
          padding: '12px',
          borderRadius: 12,
          background: 'var(--panel-2)',
          color: 'var(--ink-3)',
          fontSize: 12,
          lineHeight: 1.5
        }
      }, '问答模式暂无额外参数，直接输入问题即可。'), isDistributeParams && React.createElement(React.Fragment, null, protoSectionLabel('铺货方式'), React.createElement('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8
        }
      }, [{
        key: 'full',
        label: '全量',
        desc: '按 Sheet 依次返回'
      }, {
        key: 'patch',
        label: '增量',
        desc: '仅黄/红标记内容'
      }].map(function (item) {
        const active = smartDistributeMode === item.key;
        return React.createElement('button', {
          key: item.key,
          type: 'button',
          onClick: function () {
            setSmartDistributeMode(item.key);
          },
          style: {
            cursor: 'pointer',
            minHeight: 44,
            padding: '8px 10px',
            borderRadius: 12,
            border: '1px solid ' + (active ? 'var(--ink)' : 'var(--line-2)'),
            background: active ? 'var(--ink)' : 'var(--panel)',
            color: active ? 'var(--panel)' : 'var(--ink)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            justifyContent: 'center',
            gap: 2,
            textAlign: 'left',
            boxShadow: 'none'
          }
        }, React.createElement('span', {
          style: {
            fontSize: 12,
            fontWeight: 700,
            lineHeight: 1.1
          }
        }, item.label), React.createElement('span', {
          style: {
            fontSize: 10.5,
            lineHeight: 1.2,
            color: active ? 'rgba(255,255,255,0.68)' : 'var(--ink-3)',
            fontWeight: 500
          }
        }, item.desc));
      }))), isSpecialParams && React.createElement(React.Fragment, null, protoSectionLabel('模板线路'), React.createElement('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 7
        }
      }, [{
        cmd: '/特殊品',
        label: '普通'
      }, {
        cmd: '/特殊品（完整）',
        label: '完整'
      }].map(function (item) {
        const active = lockedCommand === item.cmd;
        return React.createElement('button', {
          key: item.cmd,
          type: 'button',
          onClick: function () {
            setLockedCommand(item.cmd);
            setSelectedSkill('');
            setSelectedWorkflow(cmdToWorkflow(item.cmd));
            if (onRequestSpecialTemplate) {
              onRequestSpecialTemplate(item.cmd === '/特殊品（完整）' ? 'full' : 'normal');
            }
            setPrototypePanel('');
            setTimeout(function () {
              const el = taRef.current;
              if (el) el.focus();
            }, 0);
          },
          style: Object.assign({}, protoChipStyle(active), {
            cursor: 'pointer',
            borderRadius: 10,
            minHeight: 36
          })
        }, item.label);
      }))), !isImageParams && !isSpecialParams && !isDistributeParams && activeMode !== 'chat' && React.createElement(React.Fragment, null, protoSectionLabel(isSpecialParams ? '特殊品输入' : '素材类型'), React.createElement('div', {
        style: {
          display: 'flex',
          gap: 7,
          flexWrap: 'wrap'
        }
      }, IMAGE_TYPES.map(function (t) {
        return React.createElement('button', {
          key: t.key,
          type: 'button',
          onClick: function () {
            setImageType(t.key);
          },
          style: Object.assign({}, protoChipStyle(imageType === t.key), {
            cursor: 'pointer'
          })
        }, t.label);
      })), protoSectionLabel('执行方式'), React.createElement('div', {
        style: {
          display: 'flex',
          gap: 7,
          flexWrap: 'wrap'
        }
      }, React.createElement('div', {
        style: protoChipStyle(true)
      }, '当前模板'), React.createElement('div', {
        style: protoChipStyle(false)
      }, '自动匹配素材')))), isImageParams ? 'fill' : 'fluid');
    }
    return null;
  };
  return /*#__PURE__*/React.createElement("div", {
    ref: composerRef,
    onDragEnter: handleDragEnter,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
    style: {
      flexShrink: 0,
      borderTop: 'none',
      background: 'var(--panel)',
      position: 'relative',
      height: composerHeight || 'auto',
      minHeight: composerHeight ? minComposerHeight : undefined,
      display: 'flex',
      flexDirection: 'column'
    }
  }, isDraggingOver && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      zIndex: 50,
      background: 'rgba(79, 70, 229, 0.08)',
      border: '2px dashed var(--accent)',
      borderRadius: 12,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      pointerEvents: 'none'
    }
  }, /*#__PURE__*/React.createElement(I.file, {
    size: 28,
    style: {
      color: 'var(--accent)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      color: 'var(--accent)'
    }
  }, "\u677E\u624B\u6DFB\u52A0\u6587\u4EF6"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: 'var(--ink-3)'
    }
  }, "\u652F\u6301\u56FE\u7247\u548C Excel\uFF08.xlsx / .xlsm\uFF09")), /*#__PURE__*/React.createElement("div", {
    onMouseDown: handleDragStart,
    title: "\u4E0A\u4E0B\u62D6\u62FD\u8C03\u6574\u8F93\u5165\u6846\u9AD8\u5EA6",
    style: {
      height: 8,
      flexShrink: 0,
      cursor: 'ns-resize',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'transparent',
      userSelect: 'none'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 28,
      height: 3,
      borderRadius: 999,
      background: 'var(--line)',
      transition: 'background 150ms'
    },
    onMouseEnter: e => {
      e.currentTarget.style.background = 'var(--ink-3)';
    },
    onMouseLeave: e => {
      e.currentTarget.style.background = 'var(--line)';
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      margin: statusBarVisible ? '4px 31px -1px' : '0 31px 0',
      minHeight: statusBarVisible ? 36 : 0,
      maxHeight: statusBarVisible ? 36 : 0,
      borderRadius: '14px 14px 0 0',
      border: '1px solid ' + (statusBarVisible ? 'var(--line)' : 'transparent'),
      borderBottomColor: statusBarVisible ? 'var(--line)' : 'transparent',
      background: 'var(--panel)',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '0 12px',
      flexShrink: 0,
      position: 'relative',
      zIndex: 2,
      opacity: statusBarVisible ? 1 : 0,
      overflow: 'hidden',
      pointerEvents: statusBarVisible ? 'auto' : 'none',
      transform: statusBarVisible ? 'translateY(0)' : 'translateY(6px)',
      transition: 'opacity 160ms ease, max-height 160ms ease, min-height 160ms ease, margin 160ms ease, transform 160ms ease, border-color 160ms ease'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 6,
      height: 6,
      borderRadius: 999,
      background: agentEnabled ? 'var(--ink)' : 'var(--accent)',
      flexShrink: 0
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      alignItems: 'center',
      flexWrap: 'nowrap',
      minWidth: 0,
      flex: 1,
      overflow: 'hidden',
      whiteSpace: 'nowrap'
    }
  }, selectedSettingBits.map(function (bit, idx) {
    const isSkillBit = typeof bit === 'string' && bit.startsWith('$');
    return /*#__PURE__*/React.createElement("span", {
      key: idx,
      style: {
        fontSize: 12,
        fontWeight: isSkillBit ? 750 : idx === 0 ? 600 : 400,
        color: isSkillBit ? 'var(--accent)' : idx === 0 ? 'var(--ink)' : 'var(--ink-3)',
        whiteSpace: 'nowrap',
        flexShrink: 0
      }
    }, bit);
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      margin: '0 12px 12px',
      borderRadius: 18,
      border: '1px solid var(--line)',
      background: 'var(--panel)',
      padding: statusBarVisible ? '18px 10px 10px' : '10px',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      boxShadow: 'none',
      transition: 'box-shadow 150ms, border-color 150ms, transform 150ms',
      position: 'relative'
    }
  }, renderPrototypePanel(), renderSkillMenu(), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      width: '100%',
      flex: composerHeight ? 1 : undefined,
      minHeight: composerHeight ? 56 : 92,
      maxHeight: composerHeight ? undefined : 180
    }
  }, hasRefTag && /*#__PURE__*/React.createElement("div", {
    ref: overlayRef,
    style: {
      position: 'absolute',
      inset: 0,
      boxSizing: 'border-box',
      fontSize: 13,
      lineHeight: 1.45,
      fontFamily: 'inherit',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      margin: 0,
      padding: '2px 2px 0',
      pointerEvents: 'none',
      overflowY: 'auto',
      zIndex: 0
    }
  }, renderFormattedOverlayText(displayValue)), /*#__PURE__*/React.createElement("textarea", {
    className: "composer-textarea",
    ref: taRef,
    value: displayValue,
    onChange: handleTextChange,
    onKeyDown: handleKeyDown,
    onScroll: handleScrollSync,
    onPaste: handlePaste,
    onClick: clampSelection,
    onSelect: clampSelection,
    onFocus: clampSelection,
    placeholder: composerPlaceholder,
    rows: 2,
    style: {
      width: '100%',
      height: '100%',
      minHeight: 'inherit',
      maxHeight: 'inherit',
      boxSizing: 'border-box',
      fontSize: 13,
      lineHeight: 1.45,
      fontFamily: 'inherit',
      color: 'var(--ink)',
      caretColor: 'var(--ink)',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      border: 'none',
      outline: 'none',
      resize: 'none',
      overflowY: 'auto',
      background: 'transparent',
      margin: 0,
      padding: '2px 2px 0',
      position: 'relative',
      zIndex: 1
    }
  })), /*#__PURE__*/React.createElement("style", null, `
          .composer-textarea::placeholder {
            color: oklch(0.62 0.02 80);
            font-style: normal;
            font-size: 13px;
            opacity: 1;
          }
        `), /*#__PURE__*/React.createElement("input", {
    type: "file",
    ref: fileInputRef,
    onChange: handleFileSelect,
    accept: "image/*,.xlsx,.xlsm",
    multiple: true,
    style: {
      display: 'none'
    }
  }), refImages.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      flexWrap: 'wrap'
    }
  }, refImages.map((img, idx) => /*#__PURE__*/React.createElement("div", {
    key: idx,
    style: {
      position: 'relative',
      display: 'inline-flex'
    },
    title: referenceFileSize(img) > MAX_REFERENCE_IMAGE_BYTES ? '超过 5MB，发送前需去掉' : undefined
  }, /*#__PURE__*/React.createElement("img", {
    src: img.previewUrl,
    alt: `参考图${idx + 1}`,
    style: {
      width: 44,
      height: 44,
      objectFit: 'cover',
      borderRadius: 6,
      border: referenceFileSize(img) > MAX_REFERENCE_IMAGE_BYTES ? '1px solid #d14343' : '1px solid var(--line)'
    }
  }), referenceFileSize(img) > MAX_REFERENCE_IMAGE_BYTES && /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: 2,
      left: 2,
      padding: '1px 3px',
      borderRadius: 3,
      background: 'rgba(209, 67, 67, 0.92)',
      color: 'white',
      fontSize: 8,
      fontWeight: 700,
      lineHeight: 1,
      pointerEvents: 'none'
    }
  }, "5MB"), /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: () => insertRefTag(idx),
    title: `点击在 Prompt 中插入 @图片${idx + 1}`,
    style: {
      position: 'absolute',
      bottom: 2,
      left: 2,
      padding: '1px 3px',
      borderRadius: 4,
      background: 'rgba(20, 22, 40, 0.72)',
      color: 'white',
      fontSize: 9,
      fontWeight: 600,
      lineHeight: 1,
      cursor: 'pointer',
      backdropFilter: 'blur(4px)',
      border: 'none'
    }
  }, "@", idx + 1), /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: () => removeRefImage(idx),
    style: {
      position: 'absolute',
      top: 0,
      right: 0,
      transform: 'translate(50%, -50%)',
      width: 16,
      height: 16,
      padding: 0,
      borderRadius: 99,
      background: 'var(--ink)',
      color: 'white',
      display: 'grid',
      placeItems: 'center',
      cursor: 'pointer',
      border: 'none'
    }
  }, /*#__PURE__*/React.createElement(I.close, {
    size: 9,
    stroke: 2.4
  })))), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      color: 'var(--ink-3)'
    }
  }, refImages.length, "/", MAX_REFERENCE_IMAGES)), files.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      flexWrap: 'wrap'
    }
  }, files.map(function (item, idx) {
    return /*#__PURE__*/React.createElement("div", {
      key: idx,
      style: {
        minWidth: 0,
        maxWidth: '100%',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        padding: '6px 8px',
        borderRadius: 10,
        border: '1px solid var(--line)',
        background: 'var(--panel-2)',
        color: 'var(--ink)'
      }
    }, /*#__PURE__*/React.createElement(I.file, {
      size: 13
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        fontWeight: 600,
        maxWidth: 160,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }
    }, item.name), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 10.5,
        color: 'var(--ink-3)',
        whiteSpace: 'nowrap'
      }
    }, item.kind === 'smart-distribute' ? '待铺货' : item.size), /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: function () {
        setFiles(function (prev) {
          return prev.filter(function (_, i) {
            return i !== idx;
          });
        });
      },
      style: {
        width: 16,
        height: 16,
        borderRadius: 999,
        background: 'transparent',
        color: 'var(--ink-3)',
        display: 'grid',
        placeItems: 'center',
        fontSize: 12,
        lineHeight: 1,
        cursor: 'pointer'
      }
    }, "\xD7"));
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      position: 'relative',
      marginBottom: 4,
      flexShrink: 0
    }
  }, !agentEnabled && prototypeToolButton('task', '功能/模型选择：' + activeTaskLabel, activeTaskIconSrc ? React.createElement('img', {
    src: activeTaskIconSrc,
    alt: '',
    style: {
      width: 16,
      height: 16,
      borderRadius: 3,
      objectFit: 'contain'
    }
  }) : React.createElement(activeTaskIcon, {
    size: 14
  }), null, {
    width: 34,
    minWidth: 34,
    height: 34,
    background: 'transparent',
    color: 'var(--ink-2)'
  }), !agentEnabled && prototypeToolButton('params', '参数设置', React.createElement(I.settings, {
    size: 14
  }), null, {
    width: 34,
    minWidth: 34,
    height: 34
  }), /*#__PURE__*/React.createElement("button", {
    onClick: () => fileInputRef.current?.click(),
    style: {
      height: 34,
      width: 34,
      minWidth: 34,
      padding: 0,
      borderRadius: 10,
      border: '1px solid var(--line-2)',
      background: 'transparent',
      color: refImages.length > 0 ? 'var(--ink)' : 'var(--ink-2)',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      flexShrink: 0
    },
    title: refImages.length > 0 ? `已附加 ${refImages.length} 张参考图` : agentEnabled ? '附加参考图给 Agent' : '附加图片或文件'
  }, /*#__PURE__*/React.createElement(I.paperclip, {
    size: 14
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("button", {
    onClick: handleSend,
    style: {
      width: 34,
      height: 34,
      borderRadius: 10,
      background: canSend ? 'var(--ink)' : 'var(--line)',
      color: canSend ? 'white' : 'var(--ink-3)',
      display: 'grid',
      placeItems: 'center',
      cursor: canSend ? 'pointer' : 'default',
      boxShadow: 'none'
    }
  }, isLoading ? /*#__PURE__*/React.createElement("div", {
    style: {
      width: 14,
      height: 14,
      borderRadius: 99,
      border: '2px solid var(--ink-3)',
      borderRightColor: 'transparent',
      animation: 'spin 0.7s linear infinite'
    }
  }) : /*#__PURE__*/React.createElement(I.arrowUp, {
    size: 14,
    stroke: 2.2
  })))));
};

// ---------- Main ----------

const AGENT_MODE_KEY = 'designflow_agent_mode_enabled';
const AGENT_PROJECT_ID_KEY = 'designflow_agent_project_id';
const mapAgentProjectMessages = function (project, images) {
  const base = Array.isArray(project && project.messages) ? project.messages.map(function (item) {
    var payload = item && item.payload ? item.payload : {};
    var refMeta = Array.isArray(payload.reference_images) ? payload.reference_images : [];
    var decision = payload && payload.decision || {};
    var intentPatch = payload && (payload.intent_patch || payload.action_intent) || {};
    var msg = {
      who: item && item.role === 'user' ? 'user' : 'ai',
      text: item && item.text || '',
      meta: item && item.role === 'assistant' ? 'Agent' : undefined,
      refMeta: refMeta,
      intentPatch: intentPatch
    };
    // 恢复 CONFIRM 的 Brief 卡片 + 快捷按钮
    if (decision && decision.type === 'CONFIRM') {
      if (decision.brief) msg.brief = decision.brief;
      if (decision.contract) msg.contract = decision.contract;
      if (decision.completeness) msg.completeness = decision.completeness;
      if (Array.isArray(decision.quickActions) && decision.quickActions.length > 0) {
        msg.quickActions = decision.quickActions;
      }
      msg.decisionType = 'CONFIRM';
    } else if (decision && decision.type === 'ASK') {
      if (decision.brief) msg.brief = decision.brief;
      if (decision.contract) msg.contract = decision.contract;
      if (decision.completeness) msg.completeness = decision.completeness;
      if (Array.isArray(decision.choices) && decision.choices.length > 0) {
        msg.choices = decision.choices;
      }
      msg.decisionType = 'ASK';
    }
    return msg;
  }) : [];
  const items = Array.isArray(images) ? images : [];
  if (!items.length) return base;
  return base.concat(items.map(function (image) {
    var promptPayload = image && image.prompt ? image.prompt : null;
    return {
      who: 'ai',
      type: 'ai-image-generating',
      model: image && image.model || 'agent',
      prompt: promptPayload ? promptPayload.instruction || promptPayload.positive || '' : '',
      promptPayload: promptPayload,
      status: 'done',
      imageUrl: image && image.image_url ? (window.API_BASE || window.location.origin) + image.image_url : '',
      finalElapsed: null,
      progress: 100,
      meta: 'Agent',
      vlm: image && image.vlm_analysis ? image.vlm_analysis : null
    };
  }));
};
const Chat = ({
  state,
  template,
  onComposeComplete,
  slashTrigger,
  user,
  onRequestSpecialTemplate,
  seedPrompt,
  onSeedConsumed,
  canvasReferenceSelection
}) => {
  const [messages, setMessages] = React.useState([]);
  const [defaultMessages, setDefaultMessages] = React.useState([]);
  const [agentMessages, setAgentMessages] = React.useState([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [lastSubmittedMessage, setLastSubmittedMessage] = React.useState('');
  const [currentAiChatId, setCurrentAiChatId] = React.useState('');
  const [composerResetKey, setComposerResetKey] = React.useState(0);
  const [greetingResetKey, setGreetingResetKey] = React.useState(0);
  const [agentEnabled, setAgentEnabled] = React.useState(false);
  const [agentProjectId, setAgentProjectId] = React.useState('');
  const [agentProject, setAgentProject] = React.useState(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const [historySessions, setHistorySessions] = React.useState([]);
  const [hoveredHistoryId, setHoveredHistoryId] = React.useState('');
  const [publishDialog, setPublishDialog] = React.useState(null);
  const historyWrapRef = React.useRef(null);
  const creatingAgentProjectRef = React.useRef(null);

  // Extract required fields from template slots (e.g., "slot/product_1/name" -> "name")
  const getTemplateFields = React.useCallback(t => {
    if (!t || !t.slots || t.slots.length === 0) return ['name'];
    const fields = new Set();
    t.slots.forEach(s => {
      const parts = (s.name || '').split('/');
      if (parts.length >= 3) {
        fields.add(parts[2]); // e.g., "name" from "slot/product_1/name"
      }
    });
    const result = Array.from(fields);
    return result.length > 0 ? result : ['name'];
  }, []);
  const templateFields = getTemplateFields(template);
  const loadAgentProject = React.useCallback(async function (projectId) {
    if (!projectId) return null;
    const data = await window.API.getAgentProject(projectId);
    const imgs = await window.API.listAgentProjectImages(projectId);
    const mapped = mapAgentProjectMessages(data, imgs);
    setAgentProject(data);
    setAgentProjectId(projectId);
    setAgentMessages(mapped);
    if (agentEnabled) setMessages(mapped);
    if (onComposeComplete && data) {
      onComposeComplete(null, null, data.currentImageUrl ? [data.currentImageUrl] : [], null);
    }
    return data;
  }, [agentEnabled, onComposeComplete]);
  const ensureAgentProject = React.useCallback(async function () {
    // 如果有保存的 ID，先尝试加载；加载失败则重新创建
    if (agentProjectId) {
      try {
        const data = await window.API.getAgentProject(agentProjectId);
        if (data && data.id) return agentProjectId;
      } catch (e) {
        // 项目已不存在（404），清除旧 ID，继续创建新项目
        setAgentProjectId('');
        try {
          localStorage.removeItem(AGENT_PROJECT_ID_KEY);
        } catch (ex) {}
      }
    }
    if (creatingAgentProjectRef.current) return creatingAgentProjectRef.current;
    creatingAgentProjectRef.current = window.API.createAgentProject().then(function (created) {
      setAgentProject(created);
      setAgentProjectId(created.id);
      return created.id;
    }).finally(function () {
      creatingAgentProjectRef.current = null;
    });
    return creatingAgentProjectRef.current;
  }, [agentProjectId]);
  React.useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async function () {
      if (!agentEnabled) {
        setMessages(defaultMessages);
        return;
      }
      try {
        const projectId = await ensureAgentProject();
        if (cancelled) return;
        const data = await window.API.getAgentProject(projectId);
        const imgs = await window.API.listAgentProjectImages(projectId);
        if (cancelled) return;
        const mapped = mapAgentProjectMessages(data, imgs);
        setAgentProject(data);
        setAgentProjectId(projectId);
        setAgentMessages(mapped);
        setMessages(mapped);
      } catch (e) {
        if (!cancelled) {
          setAgentMessages([{
            who: 'ai',
            text: 'Agent 初始化失败：' + (e && e.message || '未知错误'),
            meta: 'Agent'
          }]);
          setMessages([{
            who: 'ai',
            text: 'Agent 初始化失败：' + (e && e.message || '未知错误'),
            meta: 'Agent'
          }]);
        }
      }
    })();
    return function () {
      cancelled = true;
    };
  }, [agentEnabled, ensureAgentProject, user]);
  React.useEffect(() => {
    if (agentEnabled) setAgentMessages(messages);else setDefaultMessages(messages);
  }, [agentEnabled, messages]);
  const loadAiChatHistory = React.useCallback(async () => {
    setHistoryLoading(true);
    try {
      const sessions = await window.API.listAiChats(20);
      setHistorySessions(sessions || []);
    } catch (e) {
      console.error('load ai chat history failed:', e);
      setHistorySessions([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);
  const loadAgentProjectHistory = React.useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await window.API.listAgentProjects(1, 20);
      setHistorySessions(res && res.data || []);
    } catch (e) {
      console.error('load agent project history failed:', e);
      setHistorySessions([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);
  const openHistory = React.useCallback(() => {
    setHistoryOpen(function (prev) {
      const next = !prev;
      if (!prev) {
        if (agentEnabled) loadAgentProjectHistory();else loadAiChatHistory();
      }
      return next;
    });
  }, [agentEnabled, loadAgentProjectHistory, loadAiChatHistory]);
  const restoreAiChatSession = React.useCallback(async sessionId => {
    try {
      const data = await window.API.getAiChat(sessionId);
      setMessages(Array.isArray(data.messages) ? data.messages : []);
      setCurrentAiChatId(sessionId);
      setHistoryOpen(false);
      const lastUser = (data.messages || []).filter(function (m) {
        return m && m.who === 'user' && m.text;
      }).slice(-1)[0];
      setLastSubmittedMessage(lastUser ? lastUser.text : '');
    } catch (e) {
      console.error('restore ai chat session failed:', e);
    }
  }, []);
  const restoreAgentProjectSession = React.useCallback(async projectId => {
    try {
      await loadAgentProject(projectId);
      setHistoryOpen(false);
    } catch (e) {
      console.error('restore agent project failed:', e);
      window.alert(e && e.message ? e.message : '恢复 Agent 对话失败');
    }
  }, [loadAgentProject]);
  const deleteAiChatHistory = React.useCallback(async sessionId => {
    if (!sessionId) return;
    if (!window.confirm('删除这条历史对话？')) return;
    try {
      await window.API.deleteAiChat(sessionId);
      setHistorySessions(function (prev) {
        return prev.filter(function (session) {
          return session.id !== sessionId;
        });
      });
      if (currentAiChatId === sessionId) {
        setMessages([]);
        setCurrentAiChatId('');
        setComposerResetKey(function (prev) {
          return prev + 1;
        });
      }
    } catch (e) {
      console.error('delete ai chat history failed:', e);
      window.alert(e && e.message ? e.message : '删除失败，请稍后重试');
    }
  }, [currentAiChatId]);
  const deleteAgentProjectHistory = React.useCallback(async projectId => {
    if (!projectId) return;
    if (!window.confirm('删除这条 Agent 对话？')) return;
    try {
      await window.API.deleteAgentProject(projectId);
      setHistorySessions(function (prev) {
        return prev.filter(function (project) {
          return project.id !== projectId;
        });
      });
      if (agentProjectId === projectId) {
        setAgentProjectId('');
        setAgentProject(null);
        setAgentMessages([]);
        setMessages([]);
        setComposerResetKey(function (prev) {
          return prev + 1;
        });
        if (onComposeComplete) onComposeComplete(null, null, [], null);
      }
    } catch (e) {
      console.error('delete agent project failed:', e);
      window.alert(e && e.message ? e.message : '删除失败，请稍后重试');
    }
  }, [agentProjectId, onComposeComplete]);
  const startNewAiChat = React.useCallback(() => {
    if (isLoading) return;
    if (agentEnabled) {
      (async function () {
        setIsLoading(true);
        try {
          creatingAgentProjectRef.current = null;
          setAgentProject(null);
          setAgentProjectId('');
          try {
            localStorage.removeItem(AGENT_PROJECT_ID_KEY);
          } catch (ex) {}
          const created = await window.API.createAgentProject();
          setAgentProject(created);
          setAgentProjectId(created.id);
          setAgentMessages([]);
          setMessages([]);
          setHistoryOpen(false);
          setComposerResetKey(function (prev) {
            return prev + 1;
          });
          setGreetingResetKey(function (prev) {
            return prev + 1;
          });
          if (onComposeComplete) onComposeComplete(null, null, [], null);
        } catch (e) {
          setMessages([{
            who: 'ai',
            text: '新建 Agent 对话失败：' + (e && e.message || '未知错误'),
            meta: 'Agent'
          }]);
        } finally {
          setIsLoading(false);
        }
      })();
      return;
    }
    setMessages([]);
    setDefaultMessages([]);
    setCurrentAiChatId('');
    setHistoryOpen(false);
    setComposerResetKey(function (prev) {
      return prev + 1;
    });
    setGreetingResetKey(function (prev) {
      return prev + 1;
    });
  }, [agentEnabled, isLoading, onComposeComplete]);
  React.useEffect(() => {
    if (!historyOpen) return;
    const handlePointerDown = function (event) {
      if (!historyWrapRef.current) return;
      if (!historyWrapRef.current.contains(event.target)) {
        setHistoryOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return function () {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [historyOpen]);
  const parseProductRefs = React.useCallback(function (message) {
    var refs = [];
    var text = String(message || '');
    var pattern = /\[([^\[\]]+)\]/g;
    var match;
    while ((match = pattern.exec(text)) !== null) {
      var rawInner = (match[1] || '').trim();
      if (!rawInner) continue;
      var normalized = rawInner.replace(/\s+/g, '');
      var isAngle = /一双鞋角度$/i.test(normalized);
      var sku = isAngle ? normalized.replace(/一双鞋角度$/i, '') : normalized;
      if (!sku) continue;
      refs.push({
        raw: match[0],
        sku: sku,
        asset_type: isAngle ? 'white2x' : 'white'
      });
    }
    return refs;
  }, []);
  const loadResolvedRefFiles = React.useCallback(async function (resolvedRefs) {
    var files = [];
    for (var i = 0; i < resolvedRefs.length; i++) {
      var ref = resolvedRefs[i];
      if (!ref || !ref.matched) continue;
      var blob = null;
      if (ref.content_base64) {
        var binary = atob(ref.content_base64);
        var bytes = new Uint8Array(binary.length);
        for (var j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
        blob = new Blob([bytes], {
          type: ref.mime_type || 'image/png'
        });
      } else if (ref.url) {
        var apiBase = window.API_BASE || window.location.origin;
        var resp = await fetch(apiBase + ref.url, {
          credentials: 'include'
        });
        if (!resp.ok) throw new Error('素材图下载失败: ' + (ref.sku || 'unknown'));
        blob = await resp.blob();
      }
      if (!blob) throw new Error('素材图下载失败: ' + (ref.sku || 'unknown'));
      files.push({
        file: new File([blob], ref.filename || (ref.sku || 'product') + '.png', {
          type: blob.type || ref.mime_type || 'image/png'
        }),
        previewUrl: URL.createObjectURL(blob),
        _resolvedRef: ref
      });
    }
    return files;
  }, []);
  const materializeReferenceImages = React.useCallback(async function (refImages) {
    var refs = Array.isArray(refImages) ? refImages : [];
    return Promise.all(refs.map(async function (item, idx) {
      if (item && item.file) return item;
      var src = normalizeReferenceUrl(item && item.sourceUrl ? item.sourceUrl : item && item.previewUrl ? item.previewUrl : '');
      if (!src) throw new Error('参考图缺少可读取地址');
      var response = await fetch(src, {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('参考图读取失败: HTTP ' + response.status);
      var blob = await response.blob();
      var ext = blob.type && blob.type.indexOf('/') > -1 ? blob.type.split('/')[1] : 'png';
      var name = String(item && item.name ? item.name : 'reference-' + (idx + 1) + '.' + ext);
      if (!/\.[a-z0-9]+$/i.test(name)) name = name + '.' + ext;
      return Object.assign({}, item || {}, {
        file: new File([blob], name, {
          type: blob.type || 'image/png'
        }),
        name: name,
        pending: false
      });
    }));
  }, [normalizeReferenceUrl]);
  const enhancePromptWithProductRefs = React.useCallback(function (prompt, resolvedRefs, hasSceneReference) {
    var cleanPrompt = String(prompt || '');
    resolvedRefs.forEach(function (ref, index) {
      var replacement = resolvedRefs.length > 1 ? '这个白底产品图' + (index + 1) : '这个白底产品图';
      cleanPrompt = cleanPrompt.split(ref.raw).join(replacement);
    });
    var instructions = [cleanPrompt, '', hasSceneReference ? '同时参考用户上传的场景图，除非用户另有要求，否则尽量保持原有构图、机位、透视关系、光影和版式。' : '除非用户另有要求，否则尽量保持原有构图、机位、透视关系、光影和版式。', '把白底产品图作为商品外观参考，严格参考它的款式、配色、材质、轮廓和细节，不要自行改动商品外观。'];
    return instructions.join('\n').trim();
  }, []);

  // 从当前消息列表中找出上一个 AI 生图使用的模型、尺寸、分辨率
  const getLastAiImageOptions = React.useCallback(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m && m.type === 'ai-image-generating' && m.model) {
        return {
          model: m.model,
          size: m.size,
          resolution: m.resolution,
          provider: m.provider
        };
      }
    }
    return null;
  }, [messages]);
  const normalizeAiImageModel = React.useCallback(function (model) {
    const value = String(model || '').trim().toLowerCase();
    if (!value) return '';
    if (value.includes('nano') || value.includes('banana') || value.includes('gemini')) return 'nano-banana-pro';
    if (value.includes('gpt') || value.includes('image')) return 'gpt-image-2';
    return value;
  }, []);
  const hasDoneAiImageInCurrentThread = React.useCallback(function () {
    return messages.some(function (m) {
      return m && m.type === 'ai-image-generating' && m.status === 'done' && (m.imageUrl || m.previewUrl);
    });
  }, [messages]);
  const isLikelyAiImageFollowup = React.useCallback(function (value) {
    const s = String(value || '').trim();
    if (!s) return false;
    if (s.startsWith('/')) return false;
    if (/^(为什么|怎么|如何|什么|吗|是不是|能不能解释|帮我分析)/.test(s)) return false;
    if (s.length <= 80 && /(改|换|调|变成|去掉|删除|加上|增加|减少|保留|不要|更|再|继续|上一张|这张|这个|背景|颜色|色调|风格|构图|比例|尺寸|文案|字体|清晰|高级|简约|真实|产品|人物|模特|重新生成|重画|出一版|来一版)/.test(s)) {
      return true;
    }
    return /(基于上一张|参考上一张|在上一版基础上|沿用上一版|保持.*改|只把.*改|其他不变)/.test(s);
  }, []);

  // 将 File / Blob 转为 data URL（缩略图，最长边 200px）
  const fileToThumbDataUrl = file => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxSize = 200;
      let w = img.width,
        h = img.height;
      if (w > h && w > maxSize) {
        h = Math.round(h * maxSize / w);
        w = maxSize;
      } else if (h > maxSize) {
        w = Math.round(w * maxSize / h);
        h = maxSize;
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });

  // —— 发布/取消发布灵感 ——
  const handlePublishInspiration = React.useCallback(async msg => {
    if (!msg) return;
    setPublishDialog({
      msg: msg,
      category: 'share_card',
      tags: '',
      submitting: false
    });
  }, []);
  const confirmPublishInspiration = React.useCallback(async () => {
    const dialog = publishDialog;
    const msg = dialog && dialog.msg;
    if (!msg) return;
    // 优先用 jobId（生图时记录在消息上）；历史消息恢复后没有 jobId，回退到用 image_url
    const payload = msg.jobId ? {
      job_id: msg.jobId
    } : msg.imageUrl ? {
      image_url: msg.imageUrl
    } : null;
    if (!payload) {
      window.alert('这条消息无法发布（缺少 job_id 和 image_url）');
      return;
    }
    payload.category = dialog.category || 'share_card';
    payload.tags = String(dialog.tags || '').split(/[,，、\s]+/).map(function (t) {
      return t.trim().replace(/^#/, '');
    }).filter(Boolean);
    setPublishDialog(function (prev) {
      return prev ? Object.assign({}, prev, {
        submitting: true
      }) : prev;
    });
    // 乐观更新（批量卡按 batchImageIndex 落到对应那张图）
    setMessages(function (msgs) {
      return patchMessageOrImage(msgs, msg, {
        inspirationPublishing: true
      });
    });
    try {
      const res = await window.API.publishInspiration(payload);
      const post = res && res.post;
      setMessages(function (msgs) {
        return patchMessageOrImage(msgs, msg, {
          inspirationPostId: post ? post.id : null,
          inspirationPublishing: false
        });
      });
      setPublishDialog(null);
    } catch (e) {
      setMessages(function (msgs) {
        return patchMessageOrImage(msgs, msg, {
          inspirationPublishing: false
        });
      });
      setPublishDialog(function (prev) {
        return prev ? Object.assign({}, prev, {
          submitting: false
        }) : prev;
      });
      window.alert('发布失败：' + (e.message || '未知错误'));
    }
  }, [publishDialog]);
  const handleUnpublishInspiration = React.useCallback(async msg => {
    if (!msg || !msg.inspirationPostId) return;
    if (!window.confirm('下架这条灵感？')) return;
    const postId = msg.inspirationPostId;
    setMessages(function (msgs) {
      return patchMessageOrImage(msgs, msg, {
        inspirationPublishing: true
      });
    });
    try {
      await window.API.unpublishInspiration(postId);
      setMessages(function (msgs) {
        return patchMessageOrImage(msgs, msg, {
          inspirationPostId: null,
          inspirationPublishing: false
        });
      });
    } catch (e) {
      setMessages(function (msgs) {
        return patchMessageOrImage(msgs, msg, {
          inspirationPublishing: false
        });
      });
      window.alert('下架失败：' + (e.message || '未知错误'));
    }
  }, []);

  // —— AI 生图核心流程（共享）——
  const runAiImageGeneration = React.useCallback(async (model, prompt, displayText, refImages, aiOptions) => {
    const batchCount = Math.max(1, Math.min(parseInt(aiOptions.batchCount) || 1, 4));
    setIsLoading(true);
    var finalPrompt = prompt;
    var finalRefImages = Array.isArray(refImages) ? refImages.slice() : [];
    var refPreviews = [];
    var lastSize = aiOptions.size || '1024x1024';
    var lastResolution = aiOptions.resolution || '1K';
    var provider = aiOptions.provider || 'auto';
    var activeSkill = String(aiOptions.skill || '').trim();
    var plannedPrompt = String(aiOptions.plannedPrompt || '').trim();
    var plannedPromptTrace = String(aiOptions.promptTrace || '').trim();

    // 预解析 product refs（一次，多 job 共享）
    try {
      var productRefs = parseProductRefs(prompt);
      if (productRefs.length > 0) {
        var resolvedRefs = await window.API.resolveProductRefs(productRefs);
        var missingRefs = resolvedRefs.filter(function (ref) {
          return !ref.matched;
        });
        if (missingRefs.length > 0) {
          throw new Error('未找到素材图：' + missingRefs.map(function (ref) {
            return (ref.sku || '') + (ref.asset_type === 'white2x' ? ' 一双鞋角度' : '');
          }).join('，'));
        }
        var productRefFiles = await loadResolvedRefFiles(resolvedRefs);
        finalRefImages = finalRefImages.concat(productRefFiles);
        finalPrompt = enhancePromptWithProductRefs(prompt, resolvedRefs, refImages.length > 0);
      }
      var oversizedFinalRefs = listOversizedReferences(finalRefImages);
      if (oversizedFinalRefs.length) {
        throw new Error(formatOversizedReferenceAlert(oversizedFinalRefs));
      }
      try {
        refPreviews = await Promise.all(finalRefImages.map(r => fileToThumbDataUrl(r.file)));
      } catch (e) {
        refPreviews = [];
      }
    } catch (e) {
      const failedAt = Date.now();
      var prepClientId = newClientRequestId();
      var prepErr = formatAiImageError('准备参考图/素材时出错：' + (e && e.message || '未知原因'), null);
      reportAiImageClientEvent({
        type: 'prepare_failed',
        phase: 'prepare',
        clientRequestId: prepClientId,
        model: model,
        provider: provider,
        error: e && e.message || String(e || ''),
        reachedServer: false
      });
      alertAiImageError(prepErr, {
        phaseLabel: describeAiImageFailPhase('prepare'),
        clientRequestId: prepClientId
      });
      setMessages(msgs => [...msgs, {
        who: 'ai',
        type: 'ai-image-generating',
        model,
        provider,
        prompt,
        size: lastSize,
        resolution: lastResolution,
        status: 'failed',
        failPhase: 'prepare',
        clientRequestId: prepClientId,
        error: prepErr,
        finalElapsed: 0,
        startedAt: failedAt,
        activeSkill: activeSkill,
        meta: 'Loom',
        hasReference: refImages.length > 0,
        refCount: refImages.length,
        refPreviews: []
      }]);
      setIsLoading(false);
      return;
    }

    // 批量也只建一张卡：n 张图渲染在这张卡的 images 网格里
    const slots = [];
    const baseAt = Date.now();
    slots.push(baseAt);
    setMessages(msgs => [...msgs, {
      who: 'ai',
      type: 'ai-image-generating',
      model,
      provider,
      prompt,
      size: lastSize,
      resolution: lastResolution,
      status: activeSkill ? 'skill-planning' : 'running',
      startedAt: baseAt,
      progress: 0,
      activeSkill: activeSkill,
      meta: batchCount > 1 ? 'Loom · ×' + batchCount : 'Loom',
      hasReference: refImages.length > 0,
      refCount: refImages.length,
      refPreviews: [],
      batchCount: batchCount,
      images: batchCount > 1 ? [] : undefined
    }]);
    if (activeSkill && !plannedPrompt && window.API && window.API.streamSkillPlan) {
      const primarySlotAt = slots[0];
      var streamedTrace = '';
      var plannerRefImages = (Array.isArray(finalRefImages) ? finalRefImages : []).slice(0, 3).map(function (r) {
        return r && r.file;
      }).filter(Boolean);
      try {
        await window.API.streamSkillPlan(activeSkill, finalPrompt, plannerRefImages, {
          onDelta: function (payload) {
            var delta = String(payload && payload.text || '');
            if (!delta) return;
            streamedTrace += delta;
            setMessages(msgs => msgs.map(m => m.type === 'ai-image-generating' && m.startedAt === primarySlotAt ? Object.assign({}, m, {
              status: 'skill-planning',
              promptTrace: streamedTrace,
              progress: Math.max(m.progress || 0, 8)
            }) : m));
          },
          onDone: function (payload) {
            plannedPrompt = String(payload && payload.final_prompt || '').trim();
            plannedPromptTrace = String(payload && payload.prompt_trace || streamedTrace || '').trim();
            if (plannedPrompt) finalPrompt = plannedPrompt;
            setMessages(msgs => msgs.map(m => m.type === 'ai-image-generating' && m.startedAt === primarySlotAt ? Object.assign({}, m, {
              status: 'skill-parsed',
              resolvedPrompt: plannedPrompt || m.resolvedPrompt,
              promptTrace: plannedPromptTrace || m.promptTrace,
              progress: Math.max(m.progress || 0, 15)
            }) : m));
          },
          onError: function (payload) {
            plannedPrompt = String(payload && payload.fallback_prompt || '').trim();
            plannedPromptTrace = String(payload && payload.prompt_trace || streamedTrace || '').trim();
            if (plannedPrompt) finalPrompt = plannedPrompt;
            setMessages(msgs => msgs.map(m => m.type === 'ai-image-generating' && m.startedAt === primarySlotAt ? Object.assign({}, m, {
              status: 'skill-parsed',
              resolvedPrompt: plannedPrompt || m.resolvedPrompt,
              promptTrace: plannedPromptTrace || m.promptTrace,
              progress: Math.max(m.progress || 0, 15)
            }) : m));
          }
        });
      } catch (e) {
        console.warn('Skill planner stream failed, falling back to backend planner:', e);
      }
    }
    const apiBase = window.API_BASE || window.location.origin;
    const collected = [];
    var doneCount = 0;
    const tryFlushCollected = function () {
      doneCount++;
      if (doneCount === batchCount && onComposeComplete && collected.length > 0) {
        const sortedUrls = collected.slice().sort(function (a, b) {
          return a.index - b.index;
        }).map(function (x) {
          return x.url;
        });
        onComposeComplete(null, null, sortedUrls, null);
      }
    };
    const submitOne = function (slotAt, index) {
      return new Promise(function (resolve) {
        const clientRequestId = newClientRequestId();
        // 提交前就把 client 号写到卡片上，即使请求没到后端也能对照控制台
        setMessages(msgs => msgs.map(m => m.type === 'ai-image-generating' && m.startedAt === slotAt ? Object.assign({}, m, {
          clientRequestId: clientRequestId,
          status: m.status === 'skill-planning' ? m.status : 'queued',
          progress: Math.max(m.progress || 0, 5)
        }) : m));
        const fd = new FormData();
        fd.append('model', model);
        fd.append('provider', provider);
        fd.append('prompt', finalPrompt);
        fd.append('size', aiOptions.size || '1024x1024');
        fd.append('resolution', aiOptions.resolution || '1K');
        if (activeSkill) fd.append('skill', activeSkill);
        if (plannedPrompt) fd.append('planned_prompt', plannedPrompt);
        if (plannedPromptTrace) fd.append('prompt_trace', plannedPromptTrace);
        if (currentAiChatId && !aiOptions.skipContext) fd.append('chat_session_id', currentAiChatId);
        fd.append('ref_previews', JSON.stringify(refPreviews));
        fd.append('client_request_id', clientRequestId);
        finalRefImages.forEach(r => fd.append('image', r.file));
        fd.append('batch_count', '1');
        pushAiImageClientEvent({
          type: 'submit_start',
          phase: 'submit',
          clientRequestId: clientRequestId,
          model: model,
          provider: provider,
          refCount: finalRefImages.length
        });
        postAiImageForm(apiBase, fd, {
          clientRequestId: clientRequestId,
          maxAttempts: 2,
          timeoutMs: 120000
        }).then(function (data) {
          if (data.chat_session_id) setCurrentAiChatId(data.chat_session_id);
          const jobId = data.job_id;
          if (!jobId) {
            const finalElapsed = Math.floor((Date.now() - slotAt) / 1000);
            var noJobErr = '服务器返回异常，没有生成任务编号，请稍后重试。';
            reportAiImageClientEvent({
              type: 'submit_no_job_id',
              phase: 'submit',
              clientRequestId: clientRequestId,
              model: model,
              provider: provider,
              reachedServer: true,
              error: 'response missing job_id'
            });
            alertAiImageError(noJobErr, {
              phaseLabel: describeAiImageFailPhase('submit'),
              clientRequestId: clientRequestId
            });
            setMessages(msgs => msgs.map(m => m.type === 'ai-image-generating' && m.startedAt === slotAt ? Object.assign({}, m, {
              status: 'failed',
              failPhase: 'submit',
              error: formatAiImageError(noJobErr, null),
              finalElapsed: finalElapsed,
              clientRequestId: clientRequestId
            }) : m));
            tryFlushCollected();
            resolve();
            return;
          }
          pushAiImageClientEvent({
            type: 'submit_accepted',
            phase: 'submit',
            clientRequestId: clientRequestId,
            jobId: jobId,
            reachedServer: true
          });
          setMessages(msgs => msgs.map(m => m.type === 'ai-image-generating' && m.startedAt === slotAt ? Object.assign({}, m, {
            jobId: jobId,
            clientRequestId: clientRequestId,
            status: activeSkill ? 'skill-parsed' : 'processing',
            resolvedPrompt: data.resolved_prompt || m.resolvedPrompt,
            promptTrace: data.prompt_trace || m.promptTrace,
            progress: Math.max(m.progress || 0, 12)
          }) : m));
          var pollFails = 0;
          const failSlot = function (errorText, extra) {
            clearInterval(pollInterval);
            const finalElapsed = Math.floor((Date.now() - slotAt) / 1000);
            var phase = extra && extra.phase || 'poll_or_job';
            var errText = formatAiImageError(errorText, jobId, Object.assign({
              clientRequestId: clientRequestId
            }, extra || {}));
            reportAiImageClientEvent({
              type: 'job_failed',
              phase: phase,
              clientRequestId: clientRequestId,
              jobId: jobId,
              taskId: extra && extra.taskId,
              httpStatus: extra && extra.httpStatus,
              error: String(errorText || '').slice(0, 400),
              reachedServer: true
            });
            alertAiImageError(errText, {
              phaseLabel: describeAiImageFailPhase(phase),
              clientRequestId: clientRequestId,
              jobId: jobId
            });
            setMessages(msgs => msgs.map(m => m.type === 'ai-image-generating' && m.startedAt === slotAt ? Object.assign({}, m, {
              status: 'failed',
              failPhase: phase,
              error: errText,
              finalElapsed: finalElapsed,
              jobId: jobId,
              clientRequestId: clientRequestId,
              taskId: extra && extra.taskId || m.taskId,
              refPreviews: refPreviews.length ? refPreviews : m.refPreviews
            }) : m));
            loadAiChatHistory();
            tryFlushCollected();
            resolve();
          };
          const pollInterval = setInterval(function () {
            fetch(apiBase + '/ai-image/' + jobId, {
              credentials: 'include',
              headers: {
                'X-Client-Request-Id': clientRequestId
              }
            }).then(function (r) {
              if (!r.ok) {
                pollFails += 1;
                return r.json().catch(function () {
                  return {};
                }).then(function (errBody) {
                  var detail = errBody && (errBody.detail || errBody.message || errBody.error) || '';
                  if (typeof detail === 'object' && detail) detail = detail.message || JSON.stringify(detail);
                  if (isTerminalAiImagePollStatus(r.status)) {
                    failSlot(detail || '查询任务状态失败 HTTP ' + r.status, {
                      httpStatus: r.status
                    });
                  }
                  return null;
                });
              }
              pollFails = 0;
              return r.json();
            }).then(function (statusData) {
              if (!statusData) return;
              setMessages(msgs => msgs.map(m => m.type === 'ai-image-generating' && m.startedAt === slotAt ? Object.assign({}, m, {
                status: statusData.status === 'failed' || statusData.status === 'done' ? statusData.status : statusData.status || m.status,
                progress: statusData.progress || m.progress,
                originalPrompt: statusData.original_prompt || m.originalPrompt,
                resolvedPrompt: statusData.resolved_prompt || m.resolvedPrompt,
                promptTrace: statusData.prompt_trace || m.promptTrace,
                provider: statusData.provider || m.provider,
                providerSwitched: statusData.providerSwitched || m.providerSwitched,
                taskId: statusData.task_id || m.taskId,
                jobId: jobId,
                clientRequestId: clientRequestId
              }) : m));
              if (statusData.status === 'done' && statusData.image_url) {
                clearInterval(pollInterval);
                const finalElapsed = Math.floor((Date.now() - slotAt) / 1000);
                setMessages(msgs => msgs.map(m => m.type === 'ai-image-generating' && m.startedAt === slotAt ? Object.assign({}, m, {
                  status: 'done',
                  imageUrl: statusData.image_url,
                  previewUrl: statusData.preview_url || statusData.image_url,
                  finalElapsed: finalElapsed,
                  progress: 100,
                  refPreviews: refPreviews.length ? refPreviews : m.refPreviews,
                  originalPrompt: statusData.original_prompt || m.originalPrompt,
                  resolvedPrompt: statusData.resolved_prompt || m.resolvedPrompt,
                  promptTrace: statusData.prompt_trace || m.promptTrace,
                  jobId: jobId,
                  taskId: statusData.task_id || m.taskId,
                  clientRequestId: clientRequestId
                }) : m));
                loadAiChatHistory();
                collected.push({
                  url: statusData.image_url,
                  index: index
                });
                tryFlushCollected();
                resolve();
              } else if (statusData.status === 'done' && !statusData.image_url) {
                // done 但无图：当失败处理，避免卡片卡在完成态空白
                failSlot('任务标记完成但未返回图片地址', {
                  taskId: statusData.task_id,
                  phase: 'download'
                });
              } else if (statusData.status === 'failed') {
                failSlot(statusData.error, {
                  taskId: statusData.task_id,
                  phase: 'generate'
                });
              }
            }).catch(function (pollErr) {
              pollFails += 1;
              console.warn('[ai-image] poll error job=' + jobId + ' client=' + clientRequestId, pollErr);
            });
          }, 2000);
        }).catch(function (err) {
          const finalElapsed = Math.floor((Date.now() - slotAt) / 1000);
          var failPhase = err && err.phase || (err && err.unreached ? 'network' : 'submit');
          var submitErr = formatAiImageError(err && err.message || '提交失败', null, {
            clientRequestId: clientRequestId,
            httpStatus: err && err.httpStatus
          });
          reportAiImageClientEvent({
            type: 'submit_failed',
            phase: failPhase,
            clientRequestId: clientRequestId,
            model: model,
            provider: provider,
            httpStatus: err && err.httpStatus,
            attempt: err && err.attempt,
            unreached: !!(err && (err.unreached || isLikelyUnreachedServerError(err))),
            reachedServer: !!(err && err.httpStatus),
            error: String(err && err.message || '').slice(0, 500),
            refCount: finalRefImages.length
          });
          alertAiImageError(submitErr, {
            phaseLabel: describeAiImageFailPhase(failPhase),
            clientRequestId: clientRequestId
          });
          setMessages(msgs => msgs.map(m => m.type === 'ai-image-generating' && m.startedAt === slotAt ? Object.assign({}, m, {
            status: 'failed',
            failPhase: failPhase,
            error: submitErr,
            finalElapsed: finalElapsed,
            clientRequestId: clientRequestId
          }) : m));
          tryFlushCollected();
          resolve();
        });
      });
    };

    // 批量提交：一次 POST batch_count=n（一条用户消息、一次改写、一个会话），
    // 返回 n 个 job_id 后并行轮询，全部更新到同一张卡的 images 网格
    const submitBatch = function (slotAt) {
      return new Promise(function (resolve) {
        const clientRequestId = newClientRequestId();
        setMessages(msgs => msgs.map(m => m.type === 'ai-image-generating' && m.startedAt === slotAt ? Object.assign({}, m, {
          clientRequestId: clientRequestId,
          status: m.status === 'skill-planning' ? m.status : 'queued',
          progress: Math.max(m.progress || 0, 5)
        }) : m));
        const fd = new FormData();
        fd.append('model', model);
        fd.append('provider', provider);
        fd.append('prompt', finalPrompt);
        fd.append('size', aiOptions.size || '1024x1024');
        fd.append('resolution', aiOptions.resolution || '1K');
        if (activeSkill) fd.append('skill', activeSkill);
        if (plannedPrompt) fd.append('planned_prompt', plannedPrompt);
        if (plannedPromptTrace) fd.append('prompt_trace', plannedPromptTrace);
        if (currentAiChatId && !aiOptions.skipContext) fd.append('chat_session_id', currentAiChatId);
        fd.append('ref_previews', JSON.stringify(refPreviews));
        fd.append('client_request_id', clientRequestId);
        finalRefImages.forEach(r => fd.append('image', r.file));
        fd.append('batch_count', String(batchCount));
        pushAiImageClientEvent({
          type: 'submit_start',
          phase: 'submit',
          clientRequestId: clientRequestId,
          model: model,
          provider: provider,
          refCount: finalRefImages.length,
          batchCount: batchCount
        });
        postAiImageForm(apiBase, fd, {
          clientRequestId: clientRequestId,
          maxAttempts: 2,
          timeoutMs: 120000
        }).then(function (data) {
          if (data.chat_session_id) setCurrentAiChatId(data.chat_session_id);
          var jobIds = Array.isArray(data.job_ids) && data.job_ids.length ? data.job_ids : data.job_id ? [data.job_id] : [];
          if (!jobIds.length) {
            const finalElapsed = Math.floor((Date.now() - slotAt) / 1000);
            var noJobErr = '服务器返回异常，没有生成任务编号，请稍后重试。';
            reportAiImageClientEvent({
              type: 'submit_no_job_id',
              phase: 'submit',
              clientRequestId: clientRequestId,
              model: model,
              provider: provider,
              reachedServer: true,
              error: 'response missing job_ids'
            });
            alertAiImageError(noJobErr, {
              phaseLabel: describeAiImageFailPhase('submit'),
              clientRequestId: clientRequestId
            });
            setMessages(msgs => msgs.map(m => m.type === 'ai-image-generating' && m.startedAt === slotAt ? Object.assign({}, m, {
              status: 'failed',
              failPhase: 'submit',
              error: formatAiImageError(noJobErr, null),
              finalElapsed: finalElapsed,
              clientRequestId: clientRequestId
            }) : m));
            resolve();
            return;
          }
          pushAiImageClientEvent({
            type: 'submit_accepted',
            phase: 'submit',
            clientRequestId: clientRequestId,
            jobId: jobIds.join(','),
            reachedServer: true
          });
          setMessages(msgs => msgs.map(m => m.type === 'ai-image-generating' && m.startedAt === slotAt ? Object.assign({}, m, {
            jobId: jobIds[0],
            batchId: data.batch_id || '',
            clientRequestId: clientRequestId,
            status: activeSkill ? 'skill-parsed' : 'processing',
            resolvedPrompt: data.resolved_prompt || m.resolvedPrompt,
            promptTrace: data.prompt_trace || m.promptTrace,
            progress: Math.max(m.progress || 0, 12),
            refPreviews: refPreviews.length ? refPreviews : m.refPreviews,
            images: jobIds.map(function (jid) {
              return {
                jobId: jid,
                status: 'processing',
                progress: 0
              };
            })
          }) : m));
          var terminal = {}; // jobId -> {status, url, previewUrl, error}
          var pollFails = {}; // jobId -> 连续查询失败次数
          var finished = false;
          const patchImage = function (jid, patch) {
            if (finished) return;
            setMessages(msgs => msgs.map(m => {
              if (!(m.type === 'ai-image-generating' && m.startedAt === slotAt)) return m;
              var images = (m.images || []).map(function (im) {
                return im.jobId === jid ? Object.assign({}, im, patch) : im;
              });
              var total = 0;
              images.forEach(function (im) {
                total += im.status === 'done' || im.status === 'failed' ? 100 : im.progress || 0;
              });
              var agg = images.length ? Math.floor(total / images.length) : m.progress || 0;
              return Object.assign({}, m, {
                images: images,
                progress: Math.max(m.progress || 0, Math.min(agg, 99)),
                status: m.status === 'skill-parsed' ? m.status : 'processing',
                provider: patch.provider || m.provider,
                providerSwitched: patch.providerSwitched || m.providerSwitched
              });
            }));
          };
          const finishIfAllTerminal = function () {
            if (finished) return;
            if (jobIds.some(function (jid) {
              return !terminal[jid];
            })) return;
            finished = true;
            clearInterval(pollInterval);
            const finalElapsed = Math.floor((Date.now() - slotAt) / 1000);
            var okOrdered = [];
            jobIds.forEach(function (jid, i) {
              var t = terminal[jid];
              if (t.status === 'done' && t.url) okOrdered.push({
                url: t.url,
                index: i
              });
            });
            var failCount = jobIds.length - okOrdered.length;
            var firstErr = null;
            jobIds.some(function (jid) {
              var t = terminal[jid];
              if (t.status === 'failed' && t.error) {
                firstErr = t.error;
                return true;
              }
              return false;
            });
            var cardStatus = okOrdered.length ? 'done' : 'failed';
            setMessages(msgs => msgs.map(m => m.type === 'ai-image-generating' && m.startedAt === slotAt ? Object.assign({}, m, {
              status: cardStatus,
              progress: 100,
              finalElapsed: finalElapsed,
              error: cardStatus === 'failed' ? formatAiImageError(firstErr || '生图失败', jobIds[0]) : null,
              imageUrl: okOrdered.length ? okOrdered[0].url : m.imageUrl
            }) : m));
            if (failCount > 0) {
              var summary = okOrdered.length ? '本次 ' + jobIds.length + ' 张中有 ' + failCount + ' 张失败：' + formatAiImageError(firstErr || '未知原因', null) : formatAiImageError(firstErr || '生图失败', jobIds[0]);
              reportAiImageClientEvent({
                type: 'job_failed',
                phase: 'generate',
                clientRequestId: clientRequestId,
                jobId: jobIds.join(','),
                error: String(firstErr || '').slice(0, 400),
                reachedServer: true
              });
              alertAiImageError(summary, {
                phaseLabel: describeAiImageFailPhase('generate'),
                clientRequestId: clientRequestId
              });
            }
            loadAiChatHistory();
            if (okOrdered.length && onComposeComplete) {
              onComposeComplete(null, null, okOrdered.map(function (x) {
                return x.url;
              }), null);
            }
            resolve();
          };
          const markTerminal = function (jid, t) {
            if (terminal[jid]) return;
            terminal[jid] = t;
            patchImage(jid, t.status === 'done' ? {
              status: 'done',
              url: t.url,
              previewUrl: t.previewUrl,
              progress: 100,
              provider: t.provider,
              providerSwitched: t.providerSwitched
            } : {
              status: 'failed',
              error: t.error,
              progress: 100,
              provider: t.provider,
              providerSwitched: t.providerSwitched
            });
            finishIfAllTerminal();
          };
          const pollInterval = setInterval(function () {
            jobIds.forEach(function (jid) {
              if (terminal[jid]) return;
              fetch(apiBase + '/ai-image/' + jid, {
                credentials: 'include',
                headers: {
                  'X-Client-Request-Id': clientRequestId
                }
              }).then(function (r) {
                if (!r.ok) {
                  pollFails[jid] = (pollFails[jid] || 0) + 1;
                  return r.json().catch(function () {
                    return {};
                  }).then(function (errBody) {
                    var detail = errBody && (errBody.detail || errBody.message || errBody.error) || '';
                    if (typeof detail === 'object' && detail) detail = detail.message || JSON.stringify(detail);
                    if (isTerminalAiImagePollStatus(r.status)) {
                      markTerminal(jid, {
                        status: 'failed',
                        error: formatAiImageError(detail || '查询任务状态失败 HTTP ' + r.status, jid)
                      });
                    }
                    return null;
                  });
                }
                pollFails[jid] = 0;
                return r.json();
              }).then(function (sd) {
                if (!sd) return;
                if (sd.status === 'done' && sd.image_url) {
                  markTerminal(jid, {
                    status: 'done',
                    url: sd.image_url,
                    previewUrl: sd.preview_url || sd.image_url,
                    provider: sd.provider,
                    providerSwitched: sd.providerSwitched
                  });
                } else if (sd.status === 'done' && !sd.image_url) {
                  markTerminal(jid, {
                    status: 'failed',
                    error: formatAiImageError('任务标记完成但未返回图片地址', jid),
                    provider: sd.provider,
                    providerSwitched: sd.providerSwitched
                  });
                } else if (sd.status === 'failed') {
                  markTerminal(jid, {
                    status: 'failed',
                    error: formatAiImageError(sd.error || '生图失败', jid),
                    provider: sd.provider,
                    providerSwitched: sd.providerSwitched
                  });
                } else {
                  patchImage(jid, {
                    progress: sd.progress || 0,
                    provider: sd.provider,
                    providerSwitched: sd.providerSwitched
                  });
                }
              }).catch(function (pollErr) {
                pollFails[jid] = (pollFails[jid] || 0) + 1;
                console.warn('[ai-image] batch poll error job=' + jid + ' client=' + clientRequestId, pollErr);
              });
            });
          }, 2000);
        }).catch(function (err) {
          const finalElapsed = Math.floor((Date.now() - slotAt) / 1000);
          var failPhase = err && err.phase || (err && err.unreached ? 'network' : 'submit');
          var submitErr = formatAiImageError(err && err.message || '提交失败', null, {
            clientRequestId: clientRequestId,
            httpStatus: err && err.httpStatus
          });
          reportAiImageClientEvent({
            type: 'submit_failed',
            phase: failPhase,
            clientRequestId: clientRequestId,
            model: model,
            provider: provider,
            httpStatus: err && err.httpStatus,
            attempt: err && err.attempt,
            unreached: !!(err && (err.unreached || isLikelyUnreachedServerError(err))),
            reachedServer: !!(err && err.httpStatus),
            error: String(err && err.message || '').slice(0, 500),
            refCount: finalRefImages.length,
            batchCount: batchCount
          });
          alertAiImageError(submitErr, {
            phaseLabel: describeAiImageFailPhase(failPhase),
            clientRequestId: clientRequestId
          });
          setMessages(msgs => msgs.map(m => m.type === 'ai-image-generating' && m.startedAt === slotAt ? Object.assign({}, m, {
            status: 'failed',
            failPhase: failPhase,
            error: submitErr,
            finalElapsed: finalElapsed,
            clientRequestId: clientRequestId
          }) : m));
          resolve();
        });
      });
    };
    try {
      if (batchCount > 1) await submitBatch(slots[0]);else await submitOne(slots[0], 0);
    } finally {
      setIsLoading(false);
    }
  }, [currentAiChatId, enhancePromptWithProductRefs, loadAiChatHistory, loadResolvedRefFiles, onComposeComplete, parseProductRefs]);
  const handleSend = React.useCallback(async (text, refImages = [], aiOptions = {}) => {
    if (!text.trim() || isLoading) return;
    const activeSkill = String(aiOptions.skill || '').trim();
    const executionText = String(aiOptions.skillPrompt || text).trim();
    setLastSubmittedMessage(text);
    refImages = await materializeReferenceImages(refImages);
    const oversizedRefs = listOversizedReferences(refImages);
    if (oversizedRefs.length) {
      window.alert(formatOversizedReferenceAlert(oversizedRefs));
      return;
    }

    // 计算用户消息中的参考图预览
    var userRefPreviews = [];
    var userRefMeta = [];
    if (refImages.length > 0) {
      try {
        userRefPreviews = await Promise.all(refImages.map(function (item) {
          return fileToThumbDataUrl(item.file);
        }));
      } catch (e) {
        userRefPreviews = [];
      }
      userRefMeta = refImages.map(function (item) {
        return {
          name: item.name || item.file && item.file.name || ''
        };
      });
    }
    if (agentEnabled) {
      setIsLoading(true);
      var projectId = '';
      var assistantIdx = null;
      var imageIdx = null;
      var thinkingText = '';
      var thinkingStatus = '正在连接 Agent...';
      var thinkingPhaseLabels = {
        analyzing_reference: '正在分析参考图，提取主体、风格和构图线索...',
        understanding_intent: '正在理解需求，并整理可以确认的创意方向...',
        llm_waiting: '正在组织回复，先把需求拆成可执行的视觉要点...'
      };
      var applyThinkingEvent = function (payload) {
        var delta = payload && payload.delta ? String(payload.delta) : '';
        var message = payload && payload.message ? String(payload.message) : '';
        var phaseMessage = payload && payload.phase ? thinkingPhaseLabels[payload.phase] : '';
        if (delta) {
          thinkingText += delta;
          thinkingStatus = '正在输出思考过程...';
          return {
            thinking: thinkingText,
            thinkingStatus: thinkingStatus
          };
        }
        var nextStatus = message || phaseMessage || '正在处理...';
        if (nextStatus) {
          thinkingStatus = nextStatus;
        }
        return {
          thinking: thinkingText,
          thinkingStatus: thinkingStatus
        };
      };
      setMessages(function (msgs) {
        assistantIdx = msgs.length + 1;
        return msgs.concat([{
          who: 'user',
          text: text,
          refPreviews: userRefPreviews,
          refMeta: userRefMeta,
          activeSkill: activeSkill
        }, {
          who: 'ai',
          type: 'thinking',
          text: '正在连接 Agent...',
          thinkingStatus: thinkingStatus,
          meta: 'Agent'
        }]);
      });
      try {
        projectId = await ensureAgentProject();
        await window.API.streamAgentChat(projectId, executionText, {
          onEvent: function (eventName, payload) {
            if (eventName === 'agent_thinking') {
              var thinkingPatch = applyThinkingEvent(payload || {});
              setMessages(function (msgs) {
                return msgs.map(function (m, i) {
                  if (i !== assistantIdx) return m;
                  var patch = {
                    thinkingStatus: thinkingPatch.thinkingStatus
                  };
                  if (thinkingPatch.thinking) {
                    patch.thinking = thinkingPatch.thinking;
                  }
                  return Object.assign({}, m, patch);
                });
              });
              return;
            }
            if (eventName === 'agent_text') {
              setMessages(function (msgs) {
                return msgs.map(function (m, i) {
                  if (i !== assistantIdx) return m;
                  return {
                    who: 'ai',
                    text: (m.text || '') + (payload.delta || ''),
                    meta: 'Agent',
                    thinking: m.thinking,
                    thinkingStatus: m.thinkingStatus
                  };
                });
              });
              return;
            }
            if (eventName === 'decision') {
              if (payload && (payload.type === 'ASK' || payload.type === 'CONFIRM')) {
                var opts = payload.type === 'ASK' ? payload.choices : payload.quickActions;
                setMessages(function (msgs) {
                  return msgs.map(function (m, i) {
                    if (i !== assistantIdx) return m;
                    var patch = {
                      choices: payload.type === 'ASK' ? [] : undefined,
                      quickActions: payload.type === 'CONFIRM' ? [] : undefined
                    };
                    if (Array.isArray(opts) && opts.length > 0) {
                      patch[payload.type === 'ASK' ? 'choices' : 'quickActions'] = opts;
                    }
                    // CONFIRM 阶段附带 Creative Brief 卡片数据
                    if (payload.type === 'CONFIRM' && payload.brief) {
                      patch.brief = payload.brief;
                    }
                    if (payload.type === 'ASK' && payload.brief) {
                      patch.brief = payload.brief;
                    }
                    if (payload.contract) {
                      patch.contract = payload.contract;
                    }
                    if (payload.completeness) {
                      patch.completeness = payload.completeness;
                    }
                    patch.decisionType = payload.type;
                    return Object.assign({}, m, patch);
                  });
                });
              }
              if (payload && (payload.type === 'GENERATE' || payload.type === 'REFINE')) {
                var promptModel = payload.prompt && payload.prompt.model ? payload.prompt.model : 'agent';
                var modelLabel = promptModel === 'nano banana pro' ? 'Nano Banana' : promptModel === 'gpt image 2' ? 'GPT Image 2' : promptModel;
                var actionLabel = payload.type === 'REFINE' ? '修改' : '生成';
                setMessages(function (msgs) {
                  if (imageIdx == null) imageIdx = msgs.length;
                  return msgs.concat([{
                    who: 'ai',
                    type: 'ai-image-generating',
                    model: modelLabel,
                    prompt: payload.prompt && (payload.prompt.instruction || payload.prompt.positive) ? payload.prompt.instruction || payload.prompt.positive : text,
                    promptPayload: payload.prompt || null,
                    size: payload.prompt && payload.prompt.parameters ? payload.prompt.parameters.size : 'auto',
                    resolution: payload.prompt && payload.prompt.parameters ? payload.prompt.parameters.resolution : '1K',
                    status: 'running',
                    startedAt: Date.now(),
                    progress: 0,
                    meta: 'Agent · ' + actionLabel,
                    refPreviews: userRefPreviews
                  }]);
                });
              }
              return;
            }
            if (eventName === 'generation_progress') {
              setMessages(function (msgs) {
                return msgs.map(function (m, i) {
                  if (i !== imageIdx) return m;
                  return {
                    ...m,
                    status: 'running',
                    progress: payload.progress || m.progress || 0
                  };
                });
              });
              return;
            }
            if (eventName === 'generation_completed') {
              var generatedImage = payload && payload.image ? payload.image : null;
              var generatedUrl = generatedImage && generatedImage.url ? (window.API_BASE || window.location.origin) + generatedImage.url : '';
              setMessages(function (msgs) {
                return msgs.map(function (m, i) {
                  if (i !== imageIdx) return m;
                  return Object.assign({}, m, {
                    status: 'done',
                    imageUrl: generatedUrl || m.imageUrl || '',
                    previewUrl: generatedUrl || m.previewUrl || '',
                    progress: 100,
                    finalElapsed: m.startedAt ? Math.floor((Date.now() - m.startedAt) / 1000) : m.finalElapsed,
                    vlmPending: true
                  });
                });
              });
              return;
            }
            if (eventName === 'error') {
              setMessages(function (msgs) {
                return msgs.map(function (m, i) {
                  if (i !== assistantIdx) return m;
                  return {
                    who: 'ai',
                    text: payload && payload.message || 'Agent 执行失败',
                    meta: 'Agent'
                  };
                });
              });
            }
          },
          onDone: async function (payload) {
            if (payload && payload.project) setAgentProject(payload.project);
            if (payload && payload.image) {
              var imageUrl = (window.API_BASE || window.location.origin) + payload.image.image_url;
              var vlm = payload.vlmAnalysis || null;
              setMessages(function (msgs) {
                return msgs.map(function (m, i) {
                  if (i !== imageIdx) return m;
                  return {
                    ...m,
                    status: 'done',
                    imageUrl: imageUrl,
                    progress: 100,
                    finalElapsed: m.startedAt ? Math.floor((Date.now() - m.startedAt) / 1000) : null,
                    vlm: vlm,
                    vlmPending: false,
                    promptPayload: payload && payload.generationInstruction ? Object.assign({}, m.promptPayload || {}, payload.generationInstruction) : m.promptPayload
                  };
                });
              });
              if (onComposeComplete) {
                onComposeComplete(null, null, [payload.image.image_url], null);
              }
            }
            if (projectId) {
              const latest = await window.API.getAgentProject(projectId);
              const imgs = await window.API.listAgentProjectImages(projectId);
              const mapped = mapAgentProjectMessages(latest, imgs);
              // 保留流式过程中累积的 thinking/status 字段（服务端不存储）
              setMessages(function (msgs) {
                return mapped.map(function (mm, i) {
                  var cm = msgs[i];
                  if (cm && (cm.thinking || cm.thinkingStatus)) {
                    return Object.assign({}, mm, {
                      thinking: cm.thinking,
                      thinkingStatus: cm.thinkingStatus
                    });
                  }
                  return mm;
                });
              });
              setAgentProject(latest);
              setAgentMessages(mapped);
            }
            setIsLoading(false);
          },
          onError: function (payload) {
            setMessages(function (msgs) {
              return msgs.map(function (m, i) {
                if (i !== assistantIdx) return m;
                return {
                  who: 'ai',
                  text: payload && payload.message || 'Agent 执行失败',
                  meta: 'Agent'
                };
              });
            });
            setIsLoading(false);
          },
          onClose: function () {
            setIsLoading(false);
          }
        }, refImages, {
          skill: activeSkill
        });
      } catch (e) {
        setMessages(function (msgs) {
          return msgs.map(function (m, i) {
            if (i !== assistantIdx) return m;
            return {
              who: 'ai',
              text: 'Agent 执行失败：' + (e && e.message || '未知错误'),
              meta: 'Agent'
            };
          });
        });
        setIsLoading(false);
      }
      return;
    }

    // ── 设为头像 ──────────────────────────────────────────────────────────────
    const trimmed = text.trimStart();
    if ((trimmed === '设为头像' || trimmed === '設置頭像') && refImages.length > 0) {
      setMessages(msgs => [...msgs, {
        who: 'user',
        text,
        refPreviews: userRefPreviews,
        refMeta: userRefMeta
      }]);
      setIsLoading(true);
      try {
        const apiBase = window.API_BASE || window.location.origin;
        const fd = new FormData();
        fd.append('image', refImages[0].file);
        const res = await fetch(apiBase + '/auth/avatar', {
          method: 'POST',
          body: fd,
          credentials: 'include'
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || '设置头像失败');
        }
        const data = await res.json();
        setMessages(msgs => [...msgs, {
          who: 'ai',
          text: '头像设置成功！刷新页面后生效。'
        }]);
      } catch (e) {
        setMessages(msgs => [...msgs, {
          who: 'ai',
          text: '设置头像失败: ' + (e.message || '未知错误')
        }]);
      }
      setIsLoading(false);
      return;
    }

    // ── 花瓣下载 ─────────────────────────────────────────────────────────────
    // 新交互: 用户通过功能按钮选择“花瓣下载”，输入框只填写 URL/ID。
    // 旧的 /花瓣下载 文本仍兼容，但不再要求用户输入斜杠指令。
    const isHuabanDownloadMode = aiOptions.workflow === 'download' || aiOptions.lockedCommand === '/花瓣下载' || trimmed.startsWith('/花瓣下载');
    if (isHuabanDownloadMode) {
      const args = trimmed.startsWith('/花瓣下载') ? trimmed.replace(/^\/花瓣下载\s*/, '').trim() : trimmed.trim();
      const match = args.match(/^(\S+)(?:\s+([A-Za-z0-9._-]+))?$/);
      setMessages(msgs => [...msgs, {
        who: 'user',
        text: args || text,
        refPreviews: userRefPreviews,
        refMeta: userRefMeta
      }]);
      if (!match) {
        setMessages(msgs => [...msgs, {
          who: 'ai',
          text: '请直接输入花瓣链接或项目 ID；如果素材有多个格式，我会让你点击选择。',
          meta: '花瓣下载'
        }]);
        return;
      }
      const normalizeHuabanSource = function (value) {
        const raw = (value || '').trim();
        if (!raw) return raw;
        if (/^https?:\/\//i.test(raw)) return raw;
        if (/^\d+$/.test(raw)) return 'https://huaban.com/pins/' + raw;
        return 'https://huaban.com/pins/' + raw.replace(/^\/+|\/+$/g, '');
      };
      const sourceUrl = normalizeHuabanSource(match[1]);
      const selectedFormat = match[2] || '';
      const fmtBytes = function (bytes) {
        var n = Number(bytes || 0);
        if (!n) return '';
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(1).replace(/\\.0$/, '') + ' KB';
        return (n / (1024 * 1024)).toFixed(1).replace(/\\.0$/, '') + ' MB';
      };
      const runProxyDownload = async function (url, format, replaceIndex) {
        setIsLoading(true);
        const isFirstCall = replaceIndex == null;
        let pendingIdx = replaceIndex;
        if (isFirstCall) {
          setMessages(msgs => {
            pendingIdx = msgs.length;
            return [...msgs, {
              who: 'ai',
              type: 'thinking',
              text: '正在打开花瓣页面…',
              meta: '花瓣下载'
            }];
          });
        } else {
          setMessages(msgs => msgs.map((m, idx) => idx === pendingIdx ? {
            who: 'ai',
            type: 'thinking',
            text: '正在下载文件…',
            meta: '花瓣下载'
          } : m));
        }
        // 轮换提示文字，让用户感知进度
        const stages = isFirstCall ? [{
          after: 6000,
          text: '正在查找下载按钮…'
        }, {
          after: 15000,
          text: '页面加载较慢，请耐心等待…'
        }, {
          after: 30000,
          text: '还在等待花瓣页面响应，若账号失效会自动报错…'
        }, {
          after: 60000,
          text: '下载代理仍在处理，稍后会给出成功或失败结果…'
        }] : [{
          after: 8000,
          text: '文件较大，仍在下载中…'
        }, {
          after: 20000,
          text: '网络较慢，请耐心等待…'
        }, {
          after: 45000,
          text: '仍在等待文件流返回…'
        }];
        let stageIdx = 0;
        let progressTimer = null;
        const scheduleNext = () => {
          if (stageIdx >= stages.length) return;
          const delay = stages[stageIdx].after - (Date.now() - startedAt);
          progressTimer = setTimeout(() => {
            const s = stages[stageIdx];
            if (s && typeof pendingIdx === 'number') {
              setMessages(msgs => msgs.map((m, idx) => idx === pendingIdx ? Object.assign({}, m, {
                text: s.text
              }) : m));
            }
            stageIdx++;
            scheduleNext();
          }, Math.max(delay, 500));
        };
        const startedAt = Date.now();
        scheduleNext();
        try {
          const res = await window.API.proxyDownload(url, format || null);
          clearTimeout(progressTimer);
          if (res.status === 'choose_format') {
            setMessages(msgs => msgs.map((m, idx) => idx === pendingIdx ? {
              who: 'ai',
              type: 'proxy-download-choice',
              meta: '花瓣下载',
              text: res.message || '请选择下载格式',
              formats: res.formats || [],
              onChoose: function (fmt) {
                runProxyDownload(url, fmt, pendingIdx);
              }
            } : m));
          } else {
            setMessages(msgs => msgs.map((m, idx) => idx === pendingIdx ? {
              who: 'ai',
              type: 'proxy-download-result',
              meta: '花瓣下载',
              filename: res.filename,
              format: res.format,
              sizeText: fmtBytes(res.size),
              downloadUrl: (window.API_BASE || window.location.origin) + res.download_url
            } : m));
          }
        } catch (e) {
          clearTimeout(progressTimer);
          setMessages(msgs => msgs.map((m, idx) => idx === pendingIdx ? {
            who: 'ai',
            text: '下载失败: ' + (e.message || '未知错误'),
            meta: '花瓣下载'
          } : m));
        }
        setIsLoading(false);
      };
      await runProxyDownload(sourceUrl, selectedFormat, null);
      return;
    }

    // ── AI 生图指令匹配 ────────────────────────────────────────────────────────
    // 用户心智: 只通过 UI 选模型 (lockedCommand), 不再手动打 / 指令.
    // aiCmd 直接从 lockedCommand 解析, 永远 implicit.
    const AI_IMAGE_CMDS = [{
      prefix: '/Nano Banana pro',
      model: 'nano-banana-pro'
    }, {
      prefix: '/Gpt image 2',
      model: 'gpt-image-2'
    }];
    const FRESH_KEYWORDS = ['重新生成', '重新生图', '全新生成'];
    const lockedAiCmd = AI_IMAGE_CMDS.find(function (c) {
      return String(aiOptions.lockedCommand || '').trim().toLowerCase() === c.prefix.toLowerCase();
    });
    const textAiCmd = AI_IMAGE_CMDS.find(function (c) {
      return text.trimStart().toLowerCase().startsWith(c.prefix.toLowerCase());
    });
    const aiCmd = lockedAiCmd ? Object.assign({}, lockedAiCmd, {
      implicit: true,
      fromLockedCommand: true
    }) : textAiCmd ? Object.assign({}, textAiCmd, {
      implicit: true,
      fromLockedCommand: false
    }) : null;
    if (activeSkill && !aiCmd && aiOptions.workflow !== 'download') {
      const skillImageOptions = Object.assign({}, aiOptions, {
        provider: 'auto',
        size: 'auto',
        resolution: aiOptions.resolution || '1K',
        batchCount: 1,
        skill: activeSkill
      });
      setMessages(msgs => [...msgs, {
        who: 'user',
        text,
        refPreviews: userRefPreviews,
        refMeta: userRefMeta,
        activeSkill: activeSkill
      }]);
      await runAiImageGeneration('gpt-image-2', executionText, text.trim(), refImages, skillImageOptions);
      return;
    }

    // 检测"重新生成"关键词
    const rawPrompt = text.trim();
    const freshMatch = FRESH_KEYWORDS.find(kw => rawPrompt.startsWith(kw));
    if (freshMatch) {
      const rest = rawPrompt.slice(freshMatch.length).trim();
      const freshPrompt = rest || '重新生成';
      const lastOpts = getLastAiImageOptions();
      const model = aiCmd ? aiCmd.model : lastOpts?.model || 'gpt-image-2';
      const opts = aiCmd ? aiOptions : {
        ...aiOptions,
        size: lastOpts?.size || aiOptions.size,
        resolution: lastOpts?.resolution || aiOptions.resolution,
        provider: aiOptions.provider
      };
      setMessages(msgs => [...msgs, {
        who: 'user',
        text: aiCmd && !aiCmd.implicit ? rawPrompt : text,
        refPreviews: userRefPreviews,
        refMeta: userRefMeta
      }]);
      await runAiImageGeneration(model, freshPrompt, freshPrompt, refImages, opts);
      return;
    }
    if (aiCmd) {
      const rawAiText = text.trim();
      const plainText = rawAiText.toLowerCase().startsWith(aiCmd.prefix.toLowerCase()) ? rawAiText.slice(aiCmd.prefix.length).trimStart() : rawAiText;
      if (!plainText) {
        const prefixLabel = aiCmd.implicit ? '（复用上次模型）' : aiCmd.prefix;
        setMessages(msgs => [...msgs, {
          who: 'user',
          text,
          refPreviews: userRefPreviews,
          refMeta: userRefMeta
        }, {
          who: 'ai',
          text: `请在 ${prefixLabel} 后输入图片描述`
        }]);
        return;
      }
      setMessages(msgs => [...msgs, {
        who: 'user',
        text: plainText,
        refPreviews: userRefPreviews,
        refMeta: userRefMeta
      }]);
      await runAiImageGeneration(aiCmd.model, plainText, plainText, refImages, aiOptions);
      return;
    }

    // ── 当前生图会话的自然语言修改 ───────────────────────────────────────────
    // 用户说“改成红色 / 背景换白色 / 更高级一点”时，必须继续走 /ai-image，
    // 后端会结合 chat_session_id 的历史 prompt，并自动把上一张结果图作为参考图。
    if (currentAiChatId && hasDoneAiImageInCurrentThread() && isLikelyAiImageFollowup(text)) {
      const lastOpts = getLastAiImageOptions();
      const model = normalizeAiImageModel(lastOpts?.model) || 'gpt-image-2';
      const opts = {
        ...aiOptions,
        size: lastOpts?.size || aiOptions.size,
        resolution: lastOpts?.resolution || aiOptions.resolution,
        provider: aiOptions.provider
      };
      setMessages(msgs => [...msgs, {
        who: 'user',
        text,
        refPreviews: userRefPreviews,
        refMeta: userRefMeta
      }]);
      await runAiImageGeneration(model, text.trim(), text.trim(), refImages, opts);
      return;
    }

    // ── 特殊品（完整）流程 ────────────────────────────────────────────────────
    const _isSpecialFull = text.trimStart().startsWith('/特殊品（完整）');
    const _isSpecial = !_isSpecialFull && text.trimStart().startsWith('/特殊品');
    if (_isSpecial || _isSpecialFull) {
      const _cmdLabel = _isSpecialFull ? '特殊品（完整）' : '特殊品';
      const _endpoint = _isSpecialFull ? '/special-compose-full' : '/special-compose';
      const _pollBase = _isSpecialFull ? '/special-compose-full' : '/special-compose';
      const _argRegex = _isSpecialFull ? /^\/特殊品（完整）\s*/ : /^\/特殊品\s*/;
      const _errHint = _isSpecialFull ? '请提供 SKU，格式：/特殊品（完整） SKU，文案，时间文案' : '请提供 SKU，格式：/特殊品 SKU，文案，时间文案';
      const _tplHint = _isSpecialFull ? '请先在左侧选择特殊品（完整）模板' : '请先在左侧选择特殊品模板';
      const displayText = text.replace(_argRegex, '').trim() || text;
      setMessages(msgs => [...msgs, {
        who: 'user',
        text: displayText,
        refPreviews: userRefPreviews,
        refMeta: userRefMeta
      }]);
      setIsLoading(true);
      // 先插入 generating 消息占位
      let specialMsgIdx = null;
      setMessages(msgs => {
        specialMsgIdx = msgs.length;
        return [...msgs, {
          who: 'ai',
          type: 'generating',
          logs: [`正在启动${_cmdLabel}合成…`],
          status: 'running',
          meta: `Loom · ${_cmdLabel}`,
          startedAt: Date.now()
        }];
      });
      try {
        const args = text.replace(_argRegex, '').trim();
        const parts = args.split('，').map(s => s.trim());
        const sku = parts[0] || '';
        const fields = {
          name: parts[1] || '',
          time: parts[2] || ''
        };
        if (!sku) throw new Error(_errHint);
        if (!template) throw new Error(_tplHint);
        const frameIds = template.frames ? template.frames.map(f => f.id) : [template.id];
        const fileId = template.file_id || template.frames && template.frames[0]?.file_id;
        const pageId = template.page_id || template.frames && template.frames[0]?.page_id;
        const resp = await fetch(_endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            file_id: fileId,
            page_id: pageId,
            frame_ids: frameIds,
            sku,
            fields,
            export_scale: 2.0
          })
        });
        if (!resp.ok) {
          const e = await resp.json().catch(() => ({}));
          throw new Error(e.detail || resp.status);
        }
        const job = await resp.json();

        // 轮询 + 实时更新日志
        let done = false;
        for (let i = 0; i < 120 && !done; i++) {
          await new Promise(r => setTimeout(r, 1500));
          const s = await fetch(`${_pollBase}/${job.id}`).then(r => r.json());
          setMessages(msgs => msgs.map((m, idx) => {
            if (idx !== specialMsgIdx) return m;
            const finishing = s.status === 'done' || s.status === 'failed';
            return {
              ...m,
              logs: s.progress || [],
              status: s.status,
              ...(finishing && m.startedAt ? {
                finalElapsed: Math.floor((Date.now() - m.startedAt) / 1000)
              } : {})
            };
          }));
          if (s.status === 'done') {
            // 优先用后端记录的 result_paths（支持变体 _v1/_v2 命名），降级到旧模式
            const buildUrls = () => {
              if (s.result_paths && s.result_paths.length > 0) {
                // result_paths 是绝对路径，提取 {job_id}/frame_xxx.png 部分
                return s.result_paths.map(p => {
                  const m = p.replace(/\\/g, '/').match(/results\/(.+)$/);
                  return m ? `/results/${m[1]}` : null;
                }).filter(Boolean);
              }
              // 降级：旧命名 frame_{i}.png
              const frameIds = s.result_frame_ids || [];
              return frameIds.map((_, i) => `/results/${job['id']}/frame_${i}.png`);
            };
            const urls = buildUrls();
            const frameNames = (template.frames && template.frames.length > 0 ? template.frames : [template]).map(f => f.name || f.variant || '画板');
            const zipUrl = `${_pollBase}/${job['id']}/download-zip?names=${encodeURIComponent(frameNames.join(','))}`;
            setMessages(msgs => msgs.map((m, idx) => {
              if (idx !== specialMsgIdx) return m;
              return {
                ...m,
                status: 'done',
                specialUrls: urls,
                penpotUrl: s.penpot_edit_url,
                zipUrl
              };
            }));
            // 构建 resultTpl 供画布预览
            if (onComposeComplete && urls.length > 0 && template) {
              const base = structuredClone(template);
              const baseFrames = base.frames && base.frames.length > 0 ? base.frames : [base];
              base.frames = urls.map((url, i) => ({
                ...(baseFrames[i % baseFrames.length] || baseFrames[0]),
                resultUrl: url
              }));
              base._frameNames = frameNames;
              window.lastComposeJobId = job['id'];
              window.lastComposeEndpoint = _pollBase;
              window.lastComposeFrameNames = frameNames;
              onComposeComplete(null, s.penpot_edit_url, urls, base);
            }
            done = true;
          } else if (s.status === 'failed') {
            throw new Error(s.error || '合成失败');
          }
        }
        if (!done) throw new Error('合成超时，请检查后端日志');
      } catch (e) {
        setMessages(msgs => msgs.map((m, idx) => {
          if (idx !== specialMsgIdx) return m;
          return {
            ...m,
            status: 'failed',
            error: e.message
          };
        }));
      }
      setIsLoading(false);
      return;
    }

    // ── 普通消息 ─────────────────────────────────────────────────────────────
    setIsLoading(true);
    let thinkingIdx = null;
    setMessages(msgs => {
      thinkingIdx = msgs.length + 1; // +1 跳过用户消息，定位到 thinking 占位
      return [...msgs, {
        who: 'user',
        text,
        refPreviews: userRefPreviews,
        refMeta: userRefMeta,
        activeSkill: activeSkill
      }, {
        who: 'ai',
        type: 'thinking',
        text: '...'
      }];
    });
    try {
      const reply = await window.API.chatWithAI([{
        role: 'user',
        content: executionText
      }], {
        skill: activeSkill
      });
      setMessages(msgs => msgs.map((m, i) => i === thinkingIdx ? {
        who: 'ai',
        text: reply || '...',
        meta: 'Loom'
      } : m));
    } catch (e) {
      setMessages(msgs => msgs.map((m, i) => i === thinkingIdx ? {
        who: 'ai',
        text: '错误: ' + (e.message || '未知错误'),
        meta: '错误'
      } : m));
    }
    setIsLoading(false);
  }, [agentEnabled, currentAiChatId, ensureAgentProject, enhancePromptWithProductRefs, getLastAiImageOptions, hasDoneAiImageInCurrentThread, isLikelyAiImageFollowup, isLoading, loadAiChatHistory, loadResolvedRefFiles, materializeReferenceImages, normalizeAiImageModel, onComposeComplete, parseProductRefs, runAiImageGeneration, template]);

  // ── 快捷回复：点击选项按钮触发 ──────────────────────────────────────────────
  const handleQuickReply = React.useCallback(function (value) {
    handleSend(value, [], {});
  }, [handleSend]);
  const handleParseTable = React.useCallback(async (file, filename, imageType) => {
    // Add user message showing file was uploaded
    setMessages(msgs => [...msgs, {
      who: 'user',
      text: '已上传 ' + filename,
      file: filename,
      imageType: imageType
    }]);
    setIsLoading(true);
    try {
      const result = await window.API.parseTable(file, templateFields, imageType);
      // Add AI message with parse result
      setMessages(msgs => [...msgs, {
        who: 'ai',
        type: 'parse-result',
        data: result,
        meta: '解析了 ' + result.products.length + ' 个产品',
        fields: templateFields
      }]);
    } catch (e) {
      setMessages(msgs => [...msgs, {
        who: 'ai',
        text: '解析错误: ' + (e.message || '未知错误'),
        meta: '错误'
      }]);
    }
    setIsLoading(false);
  }, [isLoading, templateFields]);
  const handleSmartDistribute = React.useCallback(async (file, filename, mode) => {
    const distributeMode = mode === 'patch' ? 'patch' : 'full';
    const modeLabel = distributeMode === 'patch' ? '增量铺货' : '全量铺货';
    const pendingId = 'smart-distribute-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    setMessages(msgs => [...msgs, {
      who: 'user',
      type: 'file-attach',
      text: filename,
      file: filename
    }, {
      who: 'ai',
      type: 'smart-distribute-loading',
      id: pendingId,
      fileName: filename,
      meta: modeLabel,
      modeLabel: modeLabel,
      startedAt: Date.now()
    }]);
    setIsLoading(true);
    try {
      const result = await window.API.smartDistribute(file, {
        mode: distributeMode
      });
      // 每个 job 组装独立 JSON（只包该 job），自动复制第一个
      var jobJsons = (result.jobs || []).map(function (job) {
        var source = Object.assign({}, result.source || {});
        if (job.batchType) source.batchType = job.batchType;
        if (job.batchLabel) source.batchLabel = job.batchLabel;
        var single = {
          schemaVersion: result.schemaVersion,
          mode: result.mode,
          source: source,
          defaults: result.defaults,
          summary: job.summary || {},
          jobs: [job]
        };
        var str = '';
        try {
          str = JSON.stringify(single, null, 2);
        } catch (e) {
          str = '';
        }
        return str;
      });
      var autoCopied = false;
      if (jobJsons.length > 0 && jobJsons[0]) {
        try {
          autoCopied = await copyTextToClipboard(jobJsons[0]);
        } catch (e) {
          autoCopied = false;
        }
      }
      setMessages(msgs => msgs.map(function (m) {
        return m.id === pendingId ? {
          who: 'ai',
          type: 'smart-distribute',
          data: result,
          jobJsons: jobJsons,
          meta: '智能铺货',
          copied: autoCopied
        } : m;
      }));
    } catch (e) {
      setMessages(msgs => msgs.map(function (m) {
        return m.id === pendingId ? {
          who: 'ai',
          text: '解析错误: ' + (e.message || '未知错误'),
          meta: '错误'
        } : m;
      }));
    }
    setIsLoading(false);
  }, [isLoading]);
  const handleCompose = React.useCallback(async (template, parseResult) => {
    if (!template || !parseResult) return;
    // Build slots from products with image_path
    const slots = {};
    parseResult.products.forEach((p, i) => {
      if (p.image_path) {
        slots['product_' + (i + 1)] = {
          image_path: p.image_path,
          name: p.name || null,
          price: p.price || null,
          tag: p.tag || null,
          spec: p.spec || null
        };
      }
    });
    if (Object.keys(slots).length === 0) return;
    setIsLoading(true);
    // Add generating message
    let msgId = null;
    setMessages(msgs => {
      msgId = msgs.length;
      return [...msgs, {
        who: 'ai',
        type: 'generating',
        jobId: null,
        logs: ['正在启动合成任务...'],
        meta: '生成中',
        startedAt: Date.now()
      }];
    });
    try {
      const job = await window.API.createCompose({
        file_id: template.file_id,
        template_frame_id: template.id,
        page_id: template.page_id,
        slots: slots,
        export_scale: 2.0
      });
      // Poll for status
      const pollInterval = setInterval(async () => {
        try {
          const status = await window.API.getCompose(job.id);
          // Update logs
          setMessages(msgs => msgs.map((m, i) => {
            if (i !== msgId) return m;
            const finishing = status.status === 'done' || status.status === 'failed';
            return {
              ...m,
              jobId: job.id,
              status: status.status,
              logs: status.progress || [],
              resultPath: status.result_path,
              error: status.error,
              ...(finishing && m.startedAt ? {
                finalElapsed: Math.floor((Date.now() - m.startedAt) / 1000)
              } : {})
            };
          }));
          // Stop polling if done or failed
          if (status.status === 'done' || status.status === 'failed') {
            clearInterval(pollInterval);
            setIsLoading(false);
            if (status.status === 'done' && onComposeComplete) {
              onComposeComplete(job.id, status.penpot_edit_url);
            }
          }
        } catch (e) {
          clearInterval(pollInterval);
          setIsLoading(false);
          setMessages(msgs => msgs.map((m, i) => {
            if (i !== msgId) return m;
            return {
              ...m,
              status: 'failed',
              error: e.message
            };
          }));
        }
      }, 1000);
    } catch (e) {
      setMessages(msgs => msgs.map((m, i) => {
        if (i !== msgId) return m;
        return {
          ...m,
          status: 'failed',
          error: e.message
        };
      }));
      setIsLoading(false);
    }
  }, [templateFields]);
  const toggleAgentMode = React.useCallback(function () {
    if (isLoading) return;
    setHistoryOpen(false);
    setAgentEnabled(function (prev) {
      if (prev) {
        setMessages(defaultMessages);
      }
      return !prev;
    });
  }, [defaultMessages, isLoading]);
  const historyControl = /*#__PURE__*/React.createElement("div", {
    ref: historyWrapRef,
    style: {
      position: 'relative',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: openHistory,
    title: agentEnabled ? 'Agent 对话历史' : '历史对话',
    style: {
      height: 24,
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: '0 7px',
      borderRadius: 7,
      background: historyOpen ? 'var(--panel-2)' : 'transparent',
      border: '1px solid ' + (historyOpen ? 'var(--line)' : 'transparent'),
      color: historyOpen ? 'var(--ink)' : 'var(--ink-3)',
      cursor: 'pointer',
      fontSize: 10.5
    }
  }, /*#__PURE__*/React.createElement(I.file, {
    size: 11
  }), /*#__PURE__*/React.createElement("span", null, "\u5386\u53F2")), historyOpen && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 30,
      right: 0,
      width: 196,
      maxHeight: 288,
      overflowY: 'auto',
      borderRadius: 12,
      background: 'var(--panel)',
      border: '1px solid var(--line)',
      boxShadow: '0 10px 24px rgba(15, 23, 42, 0.08)',
      zIndex: 30,
      padding: 6
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "mono",
    style: {
      padding: '6px 8px 7px',
      fontSize: 9.5,
      color: 'var(--ink-3)',
      textTransform: 'uppercase',
      letterSpacing: '0.06em'
    }
  }, agentEnabled ? 'Agent chats' : 'AI chats'), historyLoading && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '8px',
      fontSize: 11,
      color: 'var(--ink-3)'
    }
  }, "\u52A0\u8F7D\u4E2D..."), !historyLoading && historySessions.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '8px',
      fontSize: 11,
      color: 'var(--ink-3)'
    }
  }, "\u6682\u65E0\u5386\u53F2\u5BF9\u8BDD"), !historyLoading && historySessions.map(function (session) {
    var activeId = agentEnabled ? agentProjectId : currentAiChatId;
    var title = session.title || '未命名对话';
    var metaLine = agentEnabled ? (session.totalGenerations || 0) > 0 ? '已生成 ' + session.totalGenerations + ' 张' : '仅对话' : '';
    return /*#__PURE__*/React.createElement("div", {
      key: session.id,
      onMouseEnter: () => setHoveredHistoryId(session.id),
      onMouseLeave: () => setHoveredHistoryId(function (prev) {
        return prev === session.id ? '' : prev;
      }),
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 0'
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: e => {
        e.preventDefault();
        e.stopPropagation();
        if (agentEnabled) deleteAgentProjectHistory(session.id);else deleteAiChatHistory(session.id);
      },
      title: "\u5220\u9664",
      style: {
        width: 18,
        height: 18,
        flexShrink: 0,
        display: 'grid',
        placeItems: 'center',
        borderRadius: 6,
        background: 'transparent',
        border: 'none',
        color: 'var(--ink-3)',
        cursor: 'pointer',
        padding: 0,
        opacity: hoveredHistoryId === session.id ? 1 : 0,
        pointerEvents: hoveredHistoryId === session.id ? 'auto' : 'none',
        transition: 'opacity 120ms ease'
      }
    }, /*#__PURE__*/React.createElement(I.close, {
      size: 10
    })), /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        if (agentEnabled) restoreAgentProjectSession(session.id);else restoreAiChatSession(session.id);
      },
      style: {
        flex: 1,
        minWidth: 0,
        textAlign: 'left',
        padding: '8px 9px',
        borderRadius: 8,
        background: activeId === session.id ? 'var(--panel-2)' : 'transparent',
        border: '1px solid ' + (activeId === session.id ? 'var(--line-2)' : 'transparent'),
        color: activeId === session.id ? 'var(--ink)' : 'var(--ink-2)',
        fontSize: 11.5,
        cursor: 'pointer'
      },
      title: title
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }
    }, title), metaLine && /*#__PURE__*/React.createElement("div", {
      className: "mono",
      style: {
        fontSize: 9.5,
        color: 'var(--ink-3)',
        marginTop: 3
      }
    }, metaLine)));
  })));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: 'var(--panel)',
      borderLeft: '1px solid var(--line)',
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 44,
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      padding: '0 14px',
      gap: 8,
      borderBottom: '1px solid var(--line)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 7
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 7,
      height: 7,
      borderRadius: 99,
      background: isLoading ? 'var(--accent)' : 'var(--ok)',
      animation: isLoading ? 'pulse 1.2s ease-in-out infinite' : 'none'
    }
  }), /*#__PURE__*/React.createElement("button", {
    onClick: startNewAiChat,
    title: isLoading ? '生成中暂不可新建对话' : agentEnabled ? '开启新的 Agent 对话' : '开启新对话',
    style: {
      fontSize: 13,
      fontWeight: 600,
      letterSpacing: '-0.01em',
      color: 'var(--ink)',
      background: 'transparent',
      border: 'none',
      padding: 0,
      cursor: isLoading ? 'not-allowed' : 'pointer'
    }
  }, agentEnabled ? 'Agent助手' : 'Ai助手'), agentEnabled && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10.5,
      color: 'var(--accent-ink)',
      background: 'var(--accent-soft)',
      border: '1px solid transparent',
      borderRadius: 999,
      padding: '2px 6px',
      lineHeight: 1
    }
  }, "Agent"), /*#__PURE__*/React.createElement("span", {
    className: "mono",
    style: {
      fontSize: 10,
      color: 'var(--ink-3)'
    }
  }, isLoading ? 'working…' : messages.length === 0 ? 'ready' : messages.length + ' messages')), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 2,
      padding: 2,
      borderRadius: 8,
      background: 'var(--panel-2)'
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: () => {
      if (agentEnabled) toggleAgentMode();
    },
    style: {
      height: 26,
      padding: '0 10px',
      borderRadius: 6,
      border: 'none',
      background: agentEnabled ? 'transparent' : 'var(--panel)',
      color: agentEnabled ? 'var(--ink-3)' : 'var(--ink)',
      fontSize: 12,
      fontWeight: agentEnabled ? 500 : 700,
      cursor: agentEnabled ? 'pointer' : 'default',
      boxShadow: agentEnabled ? 'none' : '0 0 0 1px var(--line)'
    }
  }, "Chat"), /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: () => {
      if (!agentEnabled) toggleAgentMode();
    },
    style: {
      height: 26,
      padding: '0 10px',
      borderRadius: 6,
      border: 'none',
      background: agentEnabled ? 'var(--panel)' : 'transparent',
      color: agentEnabled ? 'var(--ink)' : 'var(--ink-3)',
      fontSize: 12,
      fontWeight: agentEnabled ? 700 : 500,
      cursor: agentEnabled ? 'default' : 'pointer',
      boxShadow: agentEnabled ? '0 0 0 1px var(--line)' : 'none'
    }
  }, "Agent"))), /*#__PURE__*/React.createElement(ChatSessionBar, {
    messages: messages,
    historyControl: historyControl
  }), publishDialog && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 90,
      background: 'rgba(15,23,42,0.24)',
      display: 'grid',
      placeItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 360,
      maxWidth: 'calc(100vw - 32px)',
      borderRadius: 14,
      background: 'var(--panel)',
      border: '1px solid var(--line-2)',
      boxShadow: '0 18px 50px rgba(15,23,42,0.18)',
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 28,
      height: 28,
      borderRadius: 8,
      background: 'var(--accent-soft)',
      color: 'var(--accent-ink)',
      display: 'grid',
      placeItems: 'center'
    }
  }, /*#__PURE__*/React.createElement(I.sparkles, {
    size: 14
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 700,
      color: 'var(--ink)'
    }
  }, "\u53D1\u5E03\u5230\u7075\u611F"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: 'var(--ink-3)',
      marginTop: 2
    }
  }, "\u9009\u62E9\u5206\u7C7B\uFF0C\u6807\u7B7E\u53EF\u9009\uFF0C\u65B9\u4FBF\u540E\u7EED\u68C0\u7D22\u3002"))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: 'var(--ink-3)',
      marginBottom: 7
    }
  }, "\u5206\u7C7B"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 6
    }
  }, CHAT_INSPIRATION_CATEGORIES.map(function (cat) {
    const active = publishDialog.category === cat.id;
    return /*#__PURE__*/React.createElement("button", {
      key: cat.id,
      type: "button",
      disabled: publishDialog.submitting,
      onClick: function () {
        setPublishDialog(function (prev) {
          return prev ? Object.assign({}, prev, {
            category: cat.id
          }) : prev;
        });
      },
      style: {
        height: 28,
        padding: '0 10px',
        borderRadius: 999,
        border: '1px solid ' + (active ? 'var(--ink)' : 'var(--line-2)'),
        background: active ? 'var(--ink)' : 'var(--panel-2)',
        color: active ? 'white' : 'var(--ink-2)',
        fontSize: 11,
        cursor: publishDialog.submitting ? 'default' : 'pointer'
      }
    }, cat.label);
  }))), /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 7
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--ink-3)'
    }
  }, "\u6807\u7B7E\uFF08\u53EF\u9009\uFF09"), /*#__PURE__*/React.createElement("input", {
    value: publishDialog.tags,
    disabled: publishDialog.submitting,
    placeholder: "\u4F8B\u5982\uFF1A\u978B\u7C7B, \u5C0F\u7EA2\u4E66, \u590F\u5B63\u6D3B\u52A8",
    onChange: function (e) {
      setPublishDialog(function (prev) {
        return prev ? Object.assign({}, prev, {
          tags: e.target.value
        }) : prev;
      });
    },
    style: {
      height: 34,
      borderRadius: 9,
      border: '1px solid var(--line-2)',
      background: 'var(--panel-2)',
      color: 'var(--ink)',
      outline: 'none',
      padding: '0 10px',
      fontSize: 12
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: 8,
      marginTop: 2
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    disabled: publishDialog.submitting,
    onClick: function () {
      setPublishDialog(null);
    },
    style: {
      height: 32,
      padding: '0 13px',
      borderRadius: 8,
      border: '1px solid var(--line-2)',
      background: 'var(--panel)',
      color: 'var(--ink-2)',
      fontSize: 12,
      cursor: publishDialog.submitting ? 'default' : 'pointer'
    }
  }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement("button", {
    type: "button",
    disabled: publishDialog.submitting,
    onClick: confirmPublishInspiration,
    style: {
      height: 32,
      padding: '0 15px',
      borderRadius: 8,
      border: '1px solid var(--ink)',
      background: 'var(--ink)',
      color: 'white',
      fontSize: 12,
      fontWeight: 600,
      cursor: publishDialog.submitting ? 'default' : 'pointer',
      opacity: publishDialog.submitting ? 0.7 : 1
    }
  }, publishDialog.submitting ? '发布中…' : '确认发布')))), state === 'empty' && messages.length === 0 && /*#__PURE__*/React.createElement(ChatEmpty, {
    greetingKey: greetingResetKey
  }), state === 'empty' && messages.length > 0 && /*#__PURE__*/React.createElement(ChatReturned, {
    messages: messages,
    template: template,
    onCompose: handleCompose,
    isGenerating: isLoading,
    user: user,
    greetingKey: greetingResetKey,
    onQuickReply: handleQuickReply,
    agentEnabled: agentEnabled,
    onPublishInspiration: handlePublishInspiration,
    onUnpublishInspiration: handleUnpublishInspiration
  }), state === 'generating' && /*#__PURE__*/React.createElement(ChatGenerating, null), state === 'returned' && /*#__PURE__*/React.createElement(ChatReturned, {
    messages: messages,
    template: template,
    onCompose: handleCompose,
    isGenerating: isLoading,
    user: user,
    greetingKey: greetingResetKey,
    onQuickReply: handleQuickReply,
    agentEnabled: agentEnabled,
    onPublishInspiration: handlePublishInspiration,
    onUnpublishInspiration: handleUnpublishInspiration
  }), /*#__PURE__*/React.createElement(Composer, {
    onSend: handleSend,
    onParseTable: handleParseTable,
    onSmartDistribute: handleSmartDistribute,
    isLoading: isLoading,
    slashTrigger: slashTrigger,
    template: template,
    lastSubmittedMessage: lastSubmittedMessage,
    agentEnabled: agentEnabled,
    onToggleAgent: toggleAgentMode,
    resetKey: composerResetKey,
    onRequestSpecialTemplate: onRequestSpecialTemplate,
    seedPrompt: seedPrompt,
    onSeedConsumed: onSeedConsumed,
    canvasReferenceSelection: canvasReferenceSelection
  }));
};
window.Chat = Chat;

// src/Tweaks.jsx
// Tweaks panel — toggle between chat/canvas states

const Tweaks = ({
  visible,
  tweaks,
  onChange,
  onClose
}) => {
  if (!visible) return null;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      bottom: 16,
      right: 16,
      zIndex: 50,
      width: 260,
      borderRadius: 12,
      background: 'var(--panel)',
      border: '1px solid var(--line)',
      boxShadow: '0 10px 40px rgba(20,22,40,0.14), 0 2px 8px rgba(20,22,40,0.05)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '10px 12px',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      borderBottom: '1px solid var(--line-2)'
    }
  }, /*#__PURE__*/React.createElement(I.settings, {
    size: 13,
    style: {
      color: 'var(--ink-2)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      fontSize: 12,
      fontWeight: 600
    }
  }, "Tweaks"), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    style: {
      padding: 3,
      color: 'var(--ink-3)',
      borderRadius: 4
    }
  }, /*#__PURE__*/React.createElement(I.close, {
    size: 12
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 12,
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(TweakRow, {
    label: "Chat state",
    sub: "Empty \xB7 Generating \xB7 Returned",
    value: tweaks.chatState,
    options: [{
      k: 'empty',
      l: 'Empty'
    }, {
      k: 'generating',
      l: 'Generating'
    }, {
      k: 'returned',
      l: 'Returned'
    }],
    onChange: v => onChange({
      chatState: v
    })
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '8px 12px',
      borderTop: '1px solid var(--line-2)',
      fontSize: 10,
      color: 'var(--ink-3)'
    },
    className: "mono"
  }, "Changes persist via host"));
};
const TweakRow = ({
  label,
  sub,
  value,
  options,
  onChange
}) => /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
  style: {
    fontSize: 11,
    fontWeight: 500,
    color: 'var(--ink)',
    marginBottom: 2
  }
}, label), sub && /*#__PURE__*/React.createElement("div", {
  className: "mono",
  style: {
    fontSize: 9.5,
    color: 'var(--ink-3)',
    marginBottom: 6
  }
}, sub), /*#__PURE__*/React.createElement("div", {
  style: {
    display: 'flex',
    background: 'var(--panel-2)',
    borderRadius: 6,
    padding: 2,
    border: '1px solid var(--line-2)'
  }
}, options.map(o => /*#__PURE__*/React.createElement("button", {
  key: o.k,
  onClick: () => onChange(o.k),
  style: {
    flex: 1,
    fontSize: 11,
    padding: '5px 6px',
    borderRadius: 4,
    background: value === o.k ? 'var(--panel)' : 'transparent',
    color: value === o.k ? 'var(--ink)' : 'var(--ink-3)',
    fontWeight: value === o.k ? 500 : 400,
    boxShadow: value === o.k ? 'var(--shadow-1)' : 'none'
  }
}, o.l))));
window.Tweaks = Tweaks;

// src/AdminPage.jsx
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// Admin operations console. This page is only rendered for admin users.

const ADMIN_ACTIONS = {
  login: ['登录', '#16a36a'],
  compose: ['模板合成', '#4f5ee8'],
  special_compose: ['特殊品合成', '#4f5ee8'],
  ai_image: ['AI 生图', '#db7b20'],
  agent_chat: ['Agent 对话', '#2878d0'],
  inspiration_publish: ['发布灵感', '#0f8b78'],
  inspiration_unpublish: ['下架灵感', '#d64545'],
  inspiration_describe: ['灵感反推', '#0891b2'],
  ai_image_layer_extract: ['智能分层', '#7c4fd4'],
  ai_image_vectorize: ['图片矢量化', '#2563bd'],
  ai_image_upscale: ['高清放大', '#c45b21'],
  grid_promotional: ['智能铺货', '#4f46c8'],
  admin_alert_acknowledge: ['确认异常', '#bd741d']
};
const ADMIN_TASK_TYPES = {
  ai_image: 'AI 生图',
  agent_image: 'Agent 生图',
  compose: '模板合成',
  special: '特殊品'
};
const ADMIN_PROVIDERS = {
  auto: '智能路由',
  apimart: '默认线路 (APIMart)',
  sub2api: '订阅线路 (Sub2API)',
  adobe2api: 'Adobe 线路 (Firefly)',
  penpot: 'Penpot',
  local: '本地处理'
};
const ADMIN_STATUS = {
  pending: ['等待中', 'neutral'],
  queued: ['排队中', 'neutral'],
  processing: ['处理中', 'active'],
  running: ['运行中', 'active'],
  done: ['已完成', 'success'],
  failed: ['失败', 'danger'],
  active: ['进行中', 'active']
};
const ADMIN_CSS = `
  .df-admin, .df-admin * { box-sizing: border-box; }
  .df-admin {
    --admin-bg: #f5f5f2;
    --admin-surface: #ffffff;
    --admin-ink: #171916;
    --admin-muted: #73786f;
    --admin-faint: #a7aba4;
    --admin-line: #e3e5df;
    --admin-line-strong: #d4d7cf;
    --admin-green: #1ca66a;
    --admin-green-soft: #eaf7f0;
    --admin-red: #d44747;
    --admin-red-soft: #fff0ef;
    --admin-amber: #bd741d;
    --admin-amber-soft: #fff6e8;
    height: 100vh;
    display: grid;
    grid-template-columns: 218px minmax(0, 1fr);
    overflow: hidden;
    color: var(--admin-ink);
    background: var(--admin-bg);
    font-family: Inter, "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  .df-admin button, .df-admin input, .df-admin select { font: inherit; }
  .df-admin-sidebar {
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 18px 12px 14px;
    background: #1a1c19;
    color: #f8f8f5;
  }
  .df-admin-brand { padding: 4px 10px 22px; }
  .df-admin-brandmark { width: 30px; height: 30px; margin-bottom: 12px; }
  .df-admin-brandname { font-size: 16px; font-weight: 700; letter-spacing: -.025em; }
  .df-admin-brandmeta { margin-top: 3px; font-size: 10px; color: #8e938a; letter-spacing: .14em; text-transform: uppercase; }
  .df-admin-navlabel { padding: 0 10px 7px; color: #777c73; font-size: 9px; letter-spacing: .16em; text-transform: uppercase; }
  .df-admin-nav { display: flex; flex-direction: column; gap: 3px; }
  .df-admin-navbutton {
    width: 100%; height: 38px; display: flex; align-items: center; gap: 10px;
    padding: 0 10px; border: 0; border-radius: 7px; color: #aeb3aa;
    background: transparent; cursor: pointer; text-align: left; font-size: 12px;
    transition: color 120ms, background 120ms;
  }
  .df-admin-navbutton:hover { color: #fff; background: #242723; }
  .df-admin-navbutton.is-active { color: #fff; background: #2b2e2a; }
  .df-admin-navbutton.is-active::after {
    content: ""; width: 5px; height: 5px; margin-left: auto; border-radius: 50%; background: #d7ff60;
  }
  .df-admin-navbutton svg { flex: 0 0 auto; }
  .df-admin-sidebarfoot { margin-top: auto; padding: 12px 8px 0; border-top: 1px solid #2d302c; }
  .df-admin-userline { display: flex; align-items: center; gap: 9px; margin-bottom: 10px; }
  .df-admin-avatar {
    width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center;
    color: #151714; background: #d7ff60; font-size: 11px; font-weight: 700;
  }
  .df-admin-username { min-width: 0; font-size: 11.5px; color: #f5f5f2; overflow: hidden; text-overflow: ellipsis; }
  .df-admin-role { margin-top: 1px; color: #7f847b; font-size: 9px; text-transform: uppercase; letter-spacing: .08em; }
  .df-admin-back {
    width: 100%; height: 32px; border: 1px solid #343733; border-radius: 7px;
    color: #aeb3aa; background: transparent; cursor: pointer; font-size: 10.5px;
  }
  .df-admin-back:hover { color: #fff; border-color: #555a52; }
  .df-admin-main { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
  .df-admin-header {
    height: 66px; flex: 0 0 auto; display: flex; align-items: center; gap: 16px;
    padding: 0 26px; background: rgba(255,255,255,.88); border-bottom: 1px solid var(--admin-line);
    backdrop-filter: blur(12px);
  }
  .df-admin-title { font-size: 18px; font-weight: 680; letter-spacing: -.03em; }
  .df-admin-subtitle { margin-top: 2px; color: var(--admin-muted); font-size: 10.5px; }
  .df-admin-headtools { margin-left: auto; display: flex; align-items: center; gap: 8px; }
  .df-admin-control {
    height: 32px; padding: 0 10px; border: 1px solid var(--admin-line);
    border-radius: 7px; background: #fff; color: var(--admin-ink); outline: none; font-size: 11px;
  }
  button.df-admin-control { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  button.df-admin-control:hover { border-color: var(--admin-line-strong); background: #fafaf8; }
  .df-admin-updated { color: var(--admin-faint); font-size: 9.5px; }
  .df-admin-scroll { flex: 1; min-height: 0; overflow: auto; padding: 22px 26px 42px; }
  .df-admin-content { width: min(1460px, 100%); margin: 0 auto; }
  .df-admin-alert {
    display: flex; align-items: center; gap: 10px; min-height: 42px; margin-bottom: 14px;
    padding: 8px 12px; border-radius: 8px; color: #814515;
    background: var(--admin-amber-soft); border: 1px solid #f0d7b4; font-size: 11.5px;
  }
  .df-admin-alertdot { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: #dc8529; }
  .df-admin-alertclose {
    width: 26px; height: 26px; flex: 0 0 auto; display: grid; place-items: center;
    padding: 0; border: 0; border-radius: 6px; color: #9a6b3d; background: transparent; cursor: pointer;
  }
  .df-admin-alertclose:hover { color: #69431f; background: rgba(189,116,29,.09); }
  .df-admin-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
  .df-admin-metric {
    min-height: 126px; padding: 17px 18px; border: 1px solid var(--admin-line);
    border-radius: 10px; background: var(--admin-surface);
  }
  .df-admin-metrichead { display: flex; align-items: center; justify-content: space-between; color: var(--admin-muted); font-size: 10.5px; }
  .df-admin-metricdot { width: 7px; height: 7px; border-radius: 50%; background: var(--metric-color, #9b9f98); }
  .df-admin-metricvalue { margin-top: 18px; font-size: 33px; font-weight: 680; line-height: 1; letter-spacing: -.055em; font-variant-numeric: tabular-nums; }
  .df-admin-metricfoot { margin-top: 10px; color: var(--admin-faint); font-size: 9.5px; }
  .df-admin-metricfoot strong { color: var(--admin-muted); font-weight: 550; }
  .df-admin-health {
    margin-top: 10px; padding: 16px 18px 17px; border: 1px solid var(--admin-line);
    border-radius: 10px; background: var(--admin-surface);
  }
  .df-admin-healthtop { display: flex; align-items: center; gap: 10px; }
  .df-admin-healthmark {
    width: 8px; height: 8px; flex: 0 0 auto;
    border-radius: 50%; background: var(--admin-green);
    box-shadow: 0 0 0 3px var(--admin-green-soft);
  }
  .df-admin-healthmark.is-warning { background: var(--admin-amber); box-shadow: 0 0 0 3px var(--admin-amber-soft); }
  .df-admin-healthmark.is-degraded { background: var(--admin-red); box-shadow: 0 0 0 3px var(--admin-red-soft); }
  .df-admin-healthmark.is-unknown { background: #b9bdb6; box-shadow: 0 0 0 3px #f0f1ed; }
  .df-admin-healthname { font-size: 12px; font-weight: 650; }
  .df-admin-healthmeta { color: var(--admin-faint); font-size: 9.5px; }
  .df-admin-healthrate { margin-left: auto; color: var(--admin-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
  .df-admin-healthrail {
    display: grid; grid-template-columns: repeat(72, minmax(2px, 1fr)); gap: 3px;
    height: 27px; margin-top: 14px;
  }
  .df-admin-healthbar { min-width: 2px; border-radius: 2px; background: #dfe2dc; }
  .df-admin-healthbar.is-healthy { background: #55bc91; }
  .df-admin-healthbar.is-warning { background: #e7ad42; }
  .df-admin-healthbar.is-degraded { background: #df6b59; }
  .df-admin-healthfoot { display: flex; align-items: center; gap: 12px; margin-top: 9px; color: var(--admin-faint); font-size: 8.5px; }
  .df-admin-healthfoot span { display: inline-flex; align-items: center; gap: 4px; }
  .df-admin-healthfoot i { width: 5px; height: 5px; border-radius: 50%; background: #dfe2dc; }
  .df-admin-healthfoot .is-healthy i { background: #55bc91; }
  .df-admin-healthfoot .is-warning i { background: #e7ad42; }
  .df-admin-healthfoot .is-degraded i { background: #df6b59; }
  .df-admin-grid { display: grid; grid-template-columns: minmax(0, 1.8fr) minmax(270px, .8fr); gap: 10px; margin-top: 10px; }
  .df-admin-card {
    min-width: 0; border: 1px solid var(--admin-line); border-radius: 10px;
    background: var(--admin-surface); overflow: hidden;
  }
  .df-admin-cardhead { min-height: 48px; display: flex; align-items: center; gap: 10px; padding: 0 16px; border-bottom: 1px solid var(--admin-line); }
  .df-admin-cardtitle { font-size: 12px; font-weight: 630; }
  .df-admin-cardmeta { color: var(--admin-faint); font-size: 9.5px; }
  .df-admin-cardaction { margin-left: auto; color: var(--admin-muted); border: 0; background: none; cursor: pointer; font-size: 10px; }
  .df-admin-chart { height: 218px; display: flex; align-items: stretch; gap: 8px; padding: 22px 18px 12px; }
  .df-admin-baritem { min-width: 0; flex: 1; display: flex; flex-direction: column; justify-content: flex-end; align-items: stretch; gap: 6px; }
  .df-admin-bartrack { height: 158px; display: flex; flex-direction: column; justify-content: flex-end; overflow: hidden; border-radius: 4px 4px 2px 2px; background: #f0f1ed; }
  .df-admin-bar { background: #20231f; transition: height 180ms; }
  .df-admin-bar.is-agent { background: #5f6fe8; }
  .df-admin-bar.is-compose { background: #55bc91; }
  .df-admin-bar.is-special { background: #e7ad42; }
  .df-admin-barlabel { color: var(--admin-faint); text-align: center; font-size: 8.5px; white-space: nowrap; }
  .df-admin-legend { display: inline-flex; align-items: center; gap: 9px; }
  .df-admin-legend span { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
  .df-admin-legend i { width: 5px; height: 5px; border-radius: 50%; background: #20231f; }
  .df-admin-legend .is-agent i { background: #5f6fe8; }
  .df-admin-legend .is-compose i { background: #55bc91; }
  .df-admin-legend .is-special i { background: #e7ad42; }
  .df-admin-breakdown { padding: 7px 16px 13px; }
  .df-admin-breakrow { padding: 11px 0; border-bottom: 1px solid #eff0ec; }
  .df-admin-breakrow:last-child { border-bottom: 0; }
  .df-admin-breaktop { display: flex; align-items: center; justify-content: space-between; font-size: 11px; }
  .df-admin-breakvalue { font-weight: 650; font-variant-numeric: tabular-nums; }
  .df-admin-progress { height: 3px; margin-top: 8px; border-radius: 9px; overflow: hidden; background: #eeefeb; }
  .df-admin-progress > span { display: block; height: 100%; background: #292c28; }
  .df-admin-section { margin-top: 10px; }
  .df-admin-split { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; }
  .df-admin-overviewtriple { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-top: 10px; }
  .df-admin-ranking { padding: 7px 16px 12px; }
  .df-admin-rankrow { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; align-items: center; gap: 9px; min-height: 45px; border-bottom: 1px solid #eff0ec; }
  .df-admin-rankrow:last-child { border-bottom: 0; }
  .df-admin-rankno { color: var(--admin-faint); font: 9.5px "JetBrains Mono", monospace; }
  .df-admin-rankname { overflow: hidden; font-size: 10.5px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .df-admin-rankmeta { margin-top: 2px; color: var(--admin-faint); font-size: 8.5px; }
  .df-admin-rankvalue { font-size: 15px; font-weight: 680; font-variant-numeric: tabular-nums; }
  .df-admin-rankunit { margin-left: 3px; color: var(--admin-faint); font-size: 8px; font-weight: 400; }
  .df-admin-tablewrap { overflow: auto; }
  .df-admin-table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  .df-admin-table th {
    height: 38px; padding: 0 12px; color: var(--admin-muted); background: #fafaf8;
    border-bottom: 1px solid var(--admin-line); text-align: left; font-size: 9.5px; font-weight: 550; white-space: nowrap;
  }
  .df-admin-table td { height: 45px; padding: 7px 12px; border-bottom: 1px solid #eff0ec; vertical-align: middle; }
  .df-admin-table tbody tr:last-child td { border-bottom: 0; }
  .df-admin-table tbody tr.is-clickable { cursor: pointer; }
  .df-admin-table tbody tr.is-clickable:hover { background: #fafaf8; }
  .df-admin-status {
    display: inline-flex; align-items: center; gap: 5px; height: 21px; padding: 0 7px;
    border-radius: 99px; color: #666c63; background: #f1f2ef; white-space: nowrap; font-size: 9.5px;
  }
  .df-admin-status::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: #9ba097; }
  .df-admin-status.is-success { color: #157a4e; background: var(--admin-green-soft); }
  .df-admin-status.is-success::before { background: var(--admin-green); }
  .df-admin-status.is-danger { color: #a73535; background: var(--admin-red-soft); }
  .df-admin-status.is-danger::before { background: var(--admin-red); }
  .df-admin-status.is-active { color: #976018; background: var(--admin-amber-soft); }
  .df-admin-status.is-active::before { background: var(--admin-amber); animation: adminPulse 1.4s infinite; }
  @keyframes adminPulse { 50% { opacity: .35; } }
  .df-admin-mono { font-family: "JetBrains Mono", "SFMono-Regular", Consolas, monospace; font-size: 9.5px; }
  .df-admin-muted { color: var(--admin-muted); }
  .df-admin-faint { color: var(--admin-faint); }
  .df-admin-ellipsis { max-width: 330px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .df-admin-empty { min-height: 150px; display: grid; place-items: center; color: var(--admin-faint); font-size: 11px; }
  .df-admin-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 10px; }
  .df-admin-search { position: relative; min-width: 220px; flex: 1; max-width: 400px; }
  .df-admin-search svg { position: absolute; left: 10px; top: 9px; color: var(--admin-faint); pointer-events: none; }
  .df-admin-search input { width: 100%; padding-left: 31px; }
  .df-admin-pageinfo { margin-left: auto; color: var(--admin-faint); font-size: 9.5px; }
  .df-admin-pagebutton { width: 32px; padding: 0; justify-content: center; }
  .df-admin-servicegrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
  .df-admin-service { min-height: 146px; padding: 16px; border: 1px solid var(--admin-line); border-radius: 10px; background: #fff; }
  .df-admin-servicetop { display: flex; align-items: flex-start; gap: 10px; }
  .df-admin-serviceicon { width: 31px; height: 31px; display: grid; place-items: center; border-radius: 8px; color: #555b53; background: #f1f2ee; }
  .df-admin-servicename { font-size: 11.5px; font-weight: 620; }
  .df-admin-servicedesc { margin-top: 3px; color: var(--admin-faint); font-size: 9px; }
  .df-admin-servicestate { margin-left: auto; width: 8px; height: 8px; border-radius: 50%; background: #a7aba4; }
  .df-admin-servicestate.is-up { background: var(--admin-green); box-shadow: 0 0 0 4px var(--admin-green-soft); }
  .df-admin-servicestate.is-down { background: var(--admin-red); box-shadow: 0 0 0 4px var(--admin-red-soft); }
  .df-admin-servicestate.is-warn { background: var(--admin-amber); box-shadow: 0 0 0 4px var(--admin-amber-soft); }
  .df-admin-servicebody { margin-top: 18px; color: var(--admin-muted); font-size: 9.5px; line-height: 1.65; word-break: break-all; }
  .df-admin-probelist { max-height: 410px; overflow: auto; padding: 0 16px; }
  .df-admin-probe {
    min-height: 54px; display: grid; grid-template-columns: 10px minmax(120px, 1fr) 110px 82px 38px;
    align-items: center; gap: 10px; border-bottom: 1px solid #eff0ec;
  }
  .df-admin-probe:last-child { border-bottom: 0; }
  .df-admin-probedot { width: 7px; height: 7px; border-radius: 50%; background: #a7aba4; }
  .df-admin-probedot.is-done { background: var(--admin-green); box-shadow: 0 0 0 3px var(--admin-green-soft); }
  .df-admin-probedot.is-failed { background: var(--admin-red); box-shadow: 0 0 0 3px var(--admin-red-soft); }
  .df-admin-probedot.is-running { background: var(--admin-amber); box-shadow: 0 0 0 3px var(--admin-amber-soft); }
  .df-admin-probetime { font-size: 10.5px; font-weight: 610; font-variant-numeric: tabular-nums; }
  .df-admin-probemeta { color: var(--admin-faint); font-size: 9px; font-variant-numeric: tabular-nums; }
  .df-admin-probethumb {
    width: 36px; height: 36px; display: block; overflow: hidden;
    border: 1px solid var(--admin-line); border-radius: 6px; background: #eff0ec;
  }
  .df-admin-probethumb img { width: 100%; height: 100%; display: block; object-fit: cover; }
  .df-admin-probenoimage { width: 36px; height: 36px; border-radius: 6px; background: #f1f2ee; }
  .df-admin-probeerror {
    margin-top: 3px; overflow: hidden; color: #a73535; font-size: 8.5px;
    text-overflow: ellipsis; white-space: nowrap;
  }
  .df-admin-form {
    display: grid; grid-template-columns: 1fr 1fr 1fr 110px auto auto; gap: 8px; align-items: center;
    padding: 14px; border-bottom: 1px solid var(--admin-line); background: #fafaf8;
  }
  .df-admin-useridentity strong { display: block; font-size: 10.5px; }
  .df-admin-useridentity span { display: block; margin-top: 3px; color: var(--admin-faint); font: 8.5px "JetBrains Mono", monospace; }
  .df-admin-primary { color: #fff; background: #1c1e1b; border-color: #1c1e1b; cursor: pointer; }
  .df-admin-primary:hover { color: #fff; background: #2a2d29; }
  .df-admin-linkbutton { border: 0; background: none; color: #4f5ee8; cursor: pointer; font-size: 9.5px; }
  .df-admin-dangerbutton { color: var(--admin-red); }
  .df-admin-error { padding: 10px 12px; margin-bottom: 10px; border-radius: 7px; color: #a73535; background: var(--admin-red-soft); font-size: 10.5px; }
  .df-admin-drawerbackdrop { position: fixed; inset: 0; z-index: 90; background: rgba(18,20,17,.16); }
  .df-admin-drawer {
    position: fixed; z-index: 91; top: 0; right: 0; bottom: 0; width: min(620px, 94vw);
    padding: 22px; overflow: auto; background: #fff; box-shadow: -18px 0 50px rgba(20,22,19,.12);
  }
  .df-admin-drawerhead { display: flex; align-items: center; gap: 10px; padding-bottom: 17px; border-bottom: 1px solid var(--admin-line); }
  .df-admin-drawertitle { font-size: 15px; font-weight: 680; }
  .df-admin-drawerclose { margin-left: auto; width: 30px; padding: 0; justify-content: center; }
  .df-admin-detailgrid { display: grid; grid-template-columns: 110px 1fr; gap: 12px; padding: 17px 0; font-size: 10.5px; border-bottom: 1px solid var(--admin-line); }
  .df-admin-detailgrid dt { color: var(--admin-faint); }
  .df-admin-detailgrid dd { margin: 0; color: var(--admin-ink); word-break: break-word; }
  .df-admin-detailsection { padding: 17px 0; border-bottom: 1px solid var(--admin-line); }
  .df-admin-detailsection:last-child { border-bottom: 0; }
  .df-admin-detailtitle { margin-bottom: 10px; color: var(--admin-muted); font-size: 9px; font-weight: 650; letter-spacing: .12em; text-transform: uppercase; }
  .df-admin-detailcards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; }
  .df-admin-detailcard { min-width: 0; padding: 10px; border: 1px solid var(--admin-line); border-radius: 8px; background: #fafaf8; }
  .df-admin-detailcard span { display: block; color: var(--admin-faint); font-size: 8.5px; }
  .df-admin-detailcard strong { display: block; margin-top: 5px; overflow: hidden; color: var(--admin-ink); font-size: 10.5px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .df-admin-prompt { margin-top: 8px; padding: 11px 12px; border: 1px solid var(--admin-line); border-radius: 8px; background: #fafaf8; }
  .df-admin-prompt:first-of-type { margin-top: 0; }
  .df-admin-promptlabel { margin-bottom: 6px; color: var(--admin-faint); font-size: 8.5px; }
  .df-admin-prompttext { color: var(--admin-ink); font-size: 11px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
  .df-admin-resultimage { display: block; width: 100%; max-height: 320px; object-fit: contain; border: 1px solid var(--admin-line); border-radius: 8px; background: #f5f5f2; }
  .df-admin-detailactions { display: flex; gap: 7px; margin-top: 9px; }
  .df-admin-raw summary { margin-top: 12px; color: var(--admin-muted); cursor: pointer; font-size: 10px; }
  .df-admin-code { margin-top: 14px; padding: 12px; border-radius: 8px; color: #d8ddd4; background: #20231f; font: 9.5px/1.6 "JetBrains Mono", monospace; white-space: pre-wrap; word-break: break-all; }
  @media (max-width: 1050px) {
    .df-admin { grid-template-columns: 74px minmax(0, 1fr); }
    .df-admin-brandname, .df-admin-brandmeta, .df-admin-navlabel, .df-admin-navbutton span, .df-admin-userline > div:last-child, .df-admin-back span { display: none; }
    .df-admin-brand { padding-left: 10px; }
    .df-admin-navbutton { justify-content: center; }
    .df-admin-navbutton.is-active::after { display: none; }
    .df-admin-back { display: grid; place-items: center; }
    .df-admin-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .df-admin-servicegrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-width: 760px) {
    .df-admin { grid-template-columns: 1fr; grid-template-rows: 52px minmax(0, 1fr); }
    .df-admin-sidebar {
      min-width: 0; flex-direction: row; align-items: center; gap: 6px;
      padding: 6px 8px; overflow: hidden; border-bottom: 1px solid #2d302c;
    }
    .df-admin-brand, .df-admin-navlabel, .df-admin-userline { display: none; }
    .df-admin-nav { min-width: 0; flex: 1; flex-direction: row; overflow-x: auto; scrollbar-width: none; }
    .df-admin-nav::-webkit-scrollbar { display: none; }
    .df-admin-navbutton { width: auto; min-width: max-content; height: 38px; padding: 0 10px; }
    .df-admin-navbutton span { display: inline; }
    .df-admin-sidebarfoot { margin: 0; padding: 0; border: 0; }
    .df-admin-back { width: auto; min-width: max-content; padding: 0 10px; }
    .df-admin-back span { display: inline; }
    .df-admin-header { height: auto; min-height: 66px; flex-wrap: wrap; padding: 10px 14px; }
    .df-admin-headtools { gap: 5px; }
    .df-admin-updated { display: none; }
    .df-admin-scroll { padding: 14px; }
    .df-admin-grid, .df-admin-split, .df-admin-overviewtriple { grid-template-columns: 1fr; }
    .df-admin-servicegrid { grid-template-columns: 1fr; }
    .df-admin-probe { grid-template-columns: 10px minmax(100px, 1fr) 74px 38px; }
    .df-admin-probecompleted { display: none; }
    .df-admin-form { grid-template-columns: 1fr; }
    .df-admin-toolbar { flex-wrap: wrap; }
    .df-admin-search { min-width: 100%; max-width: none; }
    .df-admin-detailcards { grid-template-columns: 1fr 1fr; }
  }
  @media (max-width: 520px) {
    .df-admin-metrics { grid-template-columns: 1fr; }
    .df-admin-title { font-size: 16px; }
    .df-admin-subtitle { display: none; }
    .df-admin-headtools { margin-left: 0; }
    .df-admin-healthtop {
      display: grid; grid-template-columns: 24px minmax(0, 1fr) auto;
      column-gap: 9px; row-gap: 3px;
    }
    .df-admin-healthmark { grid-row: 1 / 3; }
    .df-admin-healthname, .df-admin-healthrate { white-space: nowrap; }
    .df-admin-healthrate { margin-left: 0; }
    .df-admin-healthmeta { grid-column: 2 / 4; }
    .df-admin-healthrail { gap: 2px; }
    .df-admin-healthfoot > span:last-child { display: none; }
  }
`;
function adminFormatTime(ts, includeSeconds) {
  if (!ts) return '-';
  var d = new Date(Number(ts) * 1000);
  var pad = function (n) {
    return n < 10 ? '0' + n : '' + n;
  };
  var date = pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  var time = pad(d.getHours()) + ':' + pad(d.getMinutes());
  if (includeSeconds) time += ':' + pad(d.getSeconds());
  return date + ' ' + time;
}
function adminFormatAge(seconds) {
  var value = Math.max(0, Number(seconds || 0));
  if (value < 60) return Math.round(value) + ' 秒';
  if (value < 3600) return Math.floor(value / 60) + ' 分钟';
  if (value < 86400) return (value / 3600).toFixed(value < 7200 ? 1 : 0) + ' 小时';
  return Math.floor(value / 86400) + ' 天';
}
function adminActionMeta(action) {
  return ADMIN_ACTIONS[action] || [action || '未知操作', '#777d74'];
}
function adminProviderLabel(provider) {
  return ADMIN_PROVIDERS[provider] || provider || '历史数据未记录';
}
function adminUserLabel(item) {
  return item && (item.display_name || item.username || item.user_id || item.id) || '未知用户';
}
function adminRangeLabel(hours) {
  if (Number(hours) === 0) return '所有时间';
  if (Number(hours) <= 24) return '1 天内';
  if (Number(hours) <= 168) return '近 7 天';
  return '近 30 天';
}
function adminJsonText(value) {
  if (value == null || value === '') return '-';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch (e) {
    return String(value);
  }
}
function adminPromptText(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') return value;
  return adminJsonText(value);
}
function adminHasContent(value) {
  if (value == null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}
function adminCanPreviewImage(url) {
  if (!url) return false;
  var clean = String(url).split('?')[0].split('#')[0].toLowerCase();
  return /\.(png|jpe?g|webp|gif|svg|avif)$/.test(clean);
}
function AdminStatusBadge({
  status
}) {
  var meta = ADMIN_STATUS[status] || [status || '未知', 'neutral'];
  return /*#__PURE__*/React.createElement("span", {
    className: 'df-admin-status is-' + meta[1]
  }, meta[0]);
}
function adminStatusText(status) {
  return (ADMIN_STATUS[status] || [status || '未知'])[0];
}
function AdminMetric({
  label,
  value,
  foot,
  color
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "df-admin-metric",
    style: {
      '--metric-color': color || '#92978e'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "df-admin-metrichead"
  }, /*#__PURE__*/React.createElement("span", null, label), /*#__PURE__*/React.createElement("span", {
    className: "df-admin-metricdot"
  })), /*#__PURE__*/React.createElement("div", {
    className: "df-admin-metricvalue"
  }, value), /*#__PURE__*/React.createElement("div", {
    className: "df-admin-metricfoot"
  }, foot));
}
function AdminEmpty({
  text
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "df-admin-empty"
  }, text || '暂无数据');
}
function AdminTrendChart({
  series,
  hours
}) {
  var list = series || [];
  var max = Math.max.apply(null, [1].concat(list.map(function (item) {
    return item.total || 0;
  })));
  return /*#__PURE__*/React.createElement("div", {
    className: "df-admin-chart"
  }, list.map(function (item, index) {
    var imageHeight = Math.max(item.ai_image ? 3 : 0, Math.round((item.ai_image || 0) * 142 / max));
    var agentHeight = Math.max(item.agent_image ? 3 : 0, Math.round((item.agent_image || 0) * 142 / max));
    var composeHeight = Math.max(item.compose ? 3 : 0, Math.round((item.compose || 0) * 142 / max));
    var specialHeight = Math.max(item.special ? 3 : 0, Math.round((item.special || 0) * 142 / max));
    var d = new Date(item.timestamp * 1000);
    var label = hours !== 0 && hours <= 48 ? String(d.getHours()).padStart(2, '0') + ':00' : d.getMonth() + 1 + '/' + d.getDate();
    return /*#__PURE__*/React.createElement("div", {
      className: "df-admin-baritem",
      key: index,
      title: '共 ' + item.total + ' · AI 生图 ' + item.ai_image + ' · Agent 生图 ' + item.agent_image + ' · 模板合成 ' + item.compose + ' · 特殊品 ' + item.special
    }, /*#__PURE__*/React.createElement("div", {
      className: "df-admin-bartrack"
    }, /*#__PURE__*/React.createElement("span", {
      className: "df-admin-bar is-special",
      style: {
        height: specialHeight
      }
    }), /*#__PURE__*/React.createElement("span", {
      className: "df-admin-bar is-compose",
      style: {
        height: composeHeight
      }
    }), /*#__PURE__*/React.createElement("span", {
      className: "df-admin-bar is-agent",
      style: {
        height: agentHeight
      }
    }), /*#__PURE__*/React.createElement("span", {
      className: "df-admin-bar",
      style: {
        height: imageHeight
      }
    })), /*#__PURE__*/React.createElement("div", {
      className: "df-admin-barlabel"
    }, label));
  }));
}
function AdminHealthTimeline({
  timeline,
  summary,
  breakdown,
  hours
}) {
  var list = timeline || [];
  var rate = summary && summary.success_rate;
  var activeTypes = (breakdown || []).filter(function (item) {
    return item.total > 0;
  }).length;
  var overallState = 'unknown';
  if (summary && summary.total) {
    if (summary.failed > 0 && Number(rate || 0) < 90) overallState = 'degraded';else if (summary.failed > 0 || summary.active > 0) overallState = 'warning';else overallState = 'healthy';
  }
  var allTime = Number(hours) === 0;
  var start = list.length ? new Date(Number(list[0].timestamp) * 1000) : new Date(Date.now() - Number(hours || 24) * 3600 * 1000);
  var end = new Date();
  var dateLabel = (allTime ? '全部历史 · ' : '') + (start.getMonth() + 1) + '月' + start.getDate() + '日 - ' + (end.getMonth() + 1) + '月' + end.getDate() + '日';
  return /*#__PURE__*/React.createElement("section", {
    className: "df-admin-health"
  }, /*#__PURE__*/React.createElement("div", {
    className: "df-admin-healthtop"
  }, /*#__PURE__*/React.createElement("span", {
    className: 'df-admin-healthmark is-' + overallState,
    "aria-label": '健康状态：' + overallState
  }), /*#__PURE__*/React.createElement("span", {
    className: "df-admin-healthname"
  }, "\u4EFB\u52A1\u5065\u5EB7\u8F68\u8FF9"), /*#__PURE__*/React.createElement("span", {
    className: "df-admin-healthmeta"
  }, activeTypes, " \u7C7B\u4E1A\u52A1 \xB7 ", dateLabel), /*#__PURE__*/React.createElement("span", {
    className: "df-admin-healthrate"
  }, rate == null ? '暂无已结束任务' : rate + '% 健康率')), /*#__PURE__*/React.createElement("div", {
    className: "df-admin-healthrail"
  }, list.map(function (item, index) {
    var d = new Date(item.timestamp * 1000);
    var title = d.getMonth() + 1 + '-' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ' · 共 ' + item.total + ' · 成功 ' + item.done + ' · 失败 ' + item.failed + ' · 处理中 ' + item.active;
    return /*#__PURE__*/React.createElement("span", {
      className: 'df-admin-healthbar is-' + item.state,
      key: index,
      title: title
    });
  })), /*#__PURE__*/React.createElement("div", {
    className: "df-admin-healthfoot"
  }, /*#__PURE__*/React.createElement("span", {
    className: "is-healthy"
  }, /*#__PURE__*/React.createElement("i", null), "\u6B63\u5E38"), /*#__PURE__*/React.createElement("span", {
    className: "is-warning"
  }, /*#__PURE__*/React.createElement("i", null), "\u6CE2\u52A8"), /*#__PURE__*/React.createElement("span", {
    className: "is-degraded"
  }, /*#__PURE__*/React.createElement("i", null), "\u5F02\u5E38"), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("i", null), "\u65E0\u4EFB\u52A1"), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 'auto'
    }
  }, "\u57FA\u4E8E\u6301\u4E45\u5316\u4EFB\u52A1\u7ED3\u679C\uFF0C\u4E0D\u4EE3\u8868\u670D\u52A1\u5546 SLA")));
}
function AdminUserRanking({
  items,
  hours
}) {
  var ranking = items || [];
  return /*#__PURE__*/React.createElement("section", {
    className: "df-admin-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "df-admin-cardhead"
  }, /*#__PURE__*/React.createElement("span", {
    className: "df-admin-cardtitle"
  }, "\u7528\u6237\u751F\u56FE\u6392\u884C"), /*#__PURE__*/React.createElement("span", {
    className: "df-admin-cardmeta"
  }, adminRangeLabel(hours), " \xB7 Top 5")), ranking.length ? /*#__PURE__*/React.createElement("div", {
    className: "df-admin-ranking"
  }, ranking.map(function (item, index) {
    return /*#__PURE__*/React.createElement("div", {
      className: "df-admin-rankrow",
      key: item.user_id
    }, /*#__PURE__*/React.createElement("span", {
      className: "df-admin-rankno"
    }, String(index + 1).padStart(2, '0')), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      className: "df-admin-rankname"
    }, adminUserLabel(item)), /*#__PURE__*/React.createElement("div", {
      className: "df-admin-rankmeta"
    }, item.username || item.user_id, " \xB7 \u5408\u6210 ", item.compose_count || 0)), /*#__PURE__*/React.createElement("strong", {
      className: "df-admin-rankvalue"
    }, item.image_count || 0, /*#__PURE__*/React.createElement("span", {
      className: "df-admin-rankunit"
    }, "\u6B21")));
  })) : /*#__PURE__*/React.createElement(AdminEmpty, {
    text: "\u5F53\u524D\u5468\u671F\u6682\u65E0\u751F\u56FE\u4EFB\u52A1"
  }));
}
function AdminServiceCard({
  name,
  desc,
  connected,
  configured,
  probing,
  throttled,
  detail,
  icon
}) {
  var stateClass = '';
  var stateText = '连接异常';
  if (configured === false) {
    stateClass = '';
    stateText = '未配置';
  } else if (probing) {
    stateClass = '';
    stateText = '正在探测';
  } else if (throttled) {
    stateClass = 'is-warn';
    stateText = '受限/限流';
  } else if (connected) {
    stateClass = 'is-up';
    stateText = '运行正常';
  } else {
    stateClass = 'is-down';
    stateText = '连接异常';
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "df-admin-service"
  }, /*#__PURE__*/React.createElement("div", {
    className: "df-admin-servicetop"
  }, /*#__PURE__*/React.createElement("span", {
    className: "df-admin-serviceicon"
  }, icon || /*#__PURE__*/React.createElement(I.settings, {
    size: 15
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "df-admin-servicename"
  }, name), /*#__PURE__*/React.createElement("div", {
    className: "df-admin-servicedesc"
  }, desc)), /*#__PURE__*/React.createElement("span", {
    className: 'df-admin-servicestate ' + stateClass
  })), /*#__PURE__*/React.createElement("div", {
    className: "df-admin-servicebody"
  }, stateText, detail ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("br", null), detail) : null));
}
function AdminUserManagement({
  currentUser,
  users,
  onReload,
  showTestUsers,
  onToggleShowTest
}) {
  var [form, setForm] = React.useState({
    username: '',
    displayName: '',
    role: 'user',
    password: '',
    isTest: false
  });
  var [busy, setBusy] = React.useState(false);
  var [error, setError] = React.useState('');
  var createUser = function () {
    if (!form.username.trim() || !form.password.trim() || busy) return;
    setBusy(true);
    setError('');
    window.API.createAdminUser(form.username.trim(), form.role, form.password.trim(), form.displayName.trim(), form.isTest).then(function () {
      setForm({
        username: '',
        displayName: '',
        role: 'user',
        password: '',
        isTest: false
      });
      return onReload();
    }).catch(function (err) {
      setError(err.message || '创建失败');
    }).finally(function () {
      setBusy(false);
    });
  };
  var updateRole = function (item) {
    if (busy || item.id === currentUser.id) return;
    var role = item.role === 'admin' ? 'user' : 'admin';
    if (!window.confirm('将「' + adminUserLabel(item) + '」调整为' + (role === 'admin' ? '管理员' : '普通用户') + '？')) return;
    setBusy(true);
    setError('');
    window.API.updateAdminUser(item.id, {
      role: role
    }).then(onReload).catch(function (err) {
      setError(err.message || '更新失败');
    }).finally(function () {
      setBusy(false);
    });
  };
  var toggleTestStatus = function (item) {
    if (busy) return;
    var nextState = !item.is_test;
    if (!window.confirm('将「' + adminUserLabel(item) + '」' + (nextState ? '标记为测试账号（将不计入后台统计与任务列表）' : '恢复为正常账号（将计入后台统计与任务列表）') + '？')) return;
    setBusy(true);
    setError('');
    window.API.updateAdminUser(item.id, {
      is_test: nextState
    }).then(onReload).catch(function (err) {
      setError(err.message || '测试标记更新失败');
    }).finally(function () {
      setBusy(false);
    });
  };
  var resetPassword = function (item) {
    if (busy || !window.confirm('重置「' + adminUserLabel(item) + '」的密码？')) return;
    setBusy(true);
    setError('');
    window.API.resetAdminUserPassword(item.id).then(function () {
      window.alert('密码已重置。该用户下次登录时会设置新密码。');
    }).catch(function (err) {
      setError(err.message || '重置失败');
    }).finally(function () {
      setBusy(false);
    });
  };
  var updateDisplayName = function (item) {
    if (busy) return;
    var nextName = window.prompt('设置后台展示的真实姓名或昵称。留空则恢复显示登录用户名。', item.display_name || '');
    if (nextName == null) return;
    setBusy(true);
    setError('');
    window.API.updateAdminUser(item.id, {
      display_name: nextName.trim()
    }).then(onReload).catch(function (err) {
      setError(err.message || '展示名称更新失败');
    }).finally(function () {
      setBusy(false);
    });
  };
  var deleteUser = function (item) {
    if (busy || item.id === currentUser.id) return;
    if (!window.confirm('删除用户「' + adminUserLabel(item) + '」？该操作不会删除其历史任务。')) return;
    setBusy(true);
    setError('');
    window.API.deleteAdminUser(item.id).then(onReload).catch(function (err) {
      setError(err.message || '删除失败');
    }).finally(function () {
      setBusy(false);
    });
  };
  return /*#__PURE__*/React.createElement("div", null, error ? /*#__PURE__*/React.createElement("div", {
    className: "df-admin-error"
  }, error) : null, /*#__PURE__*/React.createElement("div", {
    className: "df-admin-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "df-admin-cardhead"
  }, /*#__PURE__*/React.createElement("span", {
    className: "df-admin-cardtitle"
  }, "\u8D26\u53F7\u4E0E\u6743\u9650"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '14px'
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '5px',
      fontSize: '11px',
      color: 'var(--admin-muted)',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: !!showTestUsers,
    onChange: function (e) {
      if (onToggleShowTest) onToggleShowTest(e.target.checked);
    }
  }), "\u663E\u793A\u6D4B\u8BD5\u8D26\u53F7"), /*#__PURE__*/React.createElement("span", {
    className: "df-admin-cardmeta"
  }, users.length, " \u4E2A\u8D26\u53F7"))), /*#__PURE__*/React.createElement("div", {
    className: "df-admin-form"
  }, /*#__PURE__*/React.createElement("input", {
    className: "df-admin-control",
    value: form.username,
    placeholder: "\u767B\u5F55\u7528\u6237\u540D",
    onChange: function (e) {
      setForm(Object.assign({}, form, {
        username: e.target.value
      }));
    }
  }), /*#__PURE__*/React.createElement("input", {
    className: "df-admin-control",
    value: form.displayName,
    placeholder: "\u771F\u5B9E\u59D3\u540D / \u6635\u79F0\uFF08\u53EF\u9009\uFF09",
    onChange: function (e) {
      setForm(Object.assign({}, form, {
        displayName: e.target.value
      }));
    }
  }), /*#__PURE__*/React.createElement("input", {
    className: "df-admin-control",
    type: "password",
    value: form.password,
    placeholder: "\u521D\u59CB\u5BC6\u7801",
    onChange: function (e) {
      setForm(Object.assign({}, form, {
        password: e.target.value
      }));
    }
  }), /*#__PURE__*/React.createElement("select", {
    className: "df-admin-control",
    value: form.role,
    onChange: function (e) {
      setForm(Object.assign({}, form, {
        role: e.target.value
      }));
    }
  }, /*#__PURE__*/React.createElement("option", {
    value: "user"
  }, "\u666E\u901A\u7528\u6237"), /*#__PURE__*/React.createElement("option", {
    value: "admin"
  }, "\u7BA1\u7406\u5458")), /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '5px',
      fontSize: '11px',
      color: 'var(--admin-muted)',
      cursor: 'pointer',
      whiteSpace: 'nowrap'
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: form.isTest,
    onChange: function (e) {
      setForm(Object.assign({}, form, {
        isTest: e.target.checked
      }));
    }
  }), "\u6D4B\u8BD5\u8D26\u53F7\uFF08\u4E0D\u5165\u7EDF\u8BA1\uFF09"), /*#__PURE__*/React.createElement("button", {
    className: "df-admin-control df-admin-primary",
    disabled: busy,
    onClick: createUser
  }, "\u65B0\u589E\u8D26\u53F7")), /*#__PURE__*/React.createElement("div", {
    className: "df-admin-tablewrap"
  }, /*#__PURE__*/React.createElement("table", {
    className: "df-admin-table"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "\u5C55\u793A\u540D\u79F0"), /*#__PURE__*/React.createElement("th", null, "\u89D2\u8272 / \u6807\u8BB0"), /*#__PURE__*/React.createElement("th", null, "\u4EFB\u52A1"), /*#__PURE__*/React.createElement("th", null, "AI \u751F\u56FE"), /*#__PURE__*/React.createElement("th", null, "\u6700\u8FD1\u6D3B\u52A8"), /*#__PURE__*/React.createElement("th", null, "\u52A0\u5165\u65F6\u95F4"), /*#__PURE__*/React.createElement("th", null, "\u64CD\u4F5C"))), /*#__PURE__*/React.createElement("tbody", null, users.map(function (item) {
    var isSelf = item.id === currentUser.id;
    return /*#__PURE__*/React.createElement("tr", {
      key: item.id
    }, /*#__PURE__*/React.createElement("td", {
      className: "df-admin-useridentity"
    }, /*#__PURE__*/React.createElement("strong", null, adminUserLabel(item), isSelf ? ' · 当前' : ''), /*#__PURE__*/React.createElement("span", null, item.username, " \xB7 ", item.id)), /*#__PURE__*/React.createElement("td", null, item.role === 'admin' ? '管理员' : '普通用户', item.is_test ? /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: '6px',
        color: '#d97706',
        background: '#fef3c7',
        padding: '1px 5px',
        borderRadius: '3px',
        fontSize: '10px',
        fontWeight: 600
      }
    }, "\u6D4B\u8BD5") : null), /*#__PURE__*/React.createElement("td", null, item.total_jobs || 0), /*#__PURE__*/React.createElement("td", null, item.total_ai_images || 0), /*#__PURE__*/React.createElement("td", {
      className: "df-admin-muted"
    }, item.last_action ? adminActionMeta(item.last_action.action)[0] + ' · ' + adminFormatTime(item.last_action.created_at) : '-'), /*#__PURE__*/React.createElement("td", {
      className: "df-admin-muted"
    }, adminFormatTime(item.created_at)), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("button", {
      className: "df-admin-linkbutton",
      disabled: busy,
      onClick: function () {
        updateDisplayName(item);
      }
    }, "\u7F16\u8F91\u540D\u79F0"), /*#__PURE__*/React.createElement("button", {
      className: "df-admin-linkbutton",
      disabled: isSelf || busy,
      onClick: function () {
        toggleTestStatus(item);
      }
    }, item.is_test ? '设为正常' : '设为测试'), /*#__PURE__*/React.createElement("button", {
      className: "df-admin-linkbutton",
      disabled: isSelf || busy,
      onClick: function () {
        updateRole(item);
      }
    }, "\u5207\u89D2\u8272"), /*#__PURE__*/React.createElement("button", {
      className: "df-admin-linkbutton",
      disabled: busy,
      onClick: function () {
        resetPassword(item);
      }
    }, "\u91CD\u7F6E\u5BC6\u7801"), /*#__PURE__*/React.createElement("button", {
      className: "df-admin-linkbutton df-admin-dangerbutton",
      disabled: isSelf || busy,
      onClick: function () {
        deleteUser(item);
      }
    }, "\u5220\u9664")));
  }))))));
}
function AdminTaskDrawer({
  task,
  detail,
  loading,
  error,
  onClose
}) {
  if (!task) return null;
  var data = detail || task;
  var request = data.request || {};
  var prompts = data.prompts || {};
  var result = data.result || {};
  var referenceCount = data.reference_count;
  if (referenceCount == null && data.has_reference) referenceCount = '已使用，历史数量未记录';
  if (referenceCount == null) referenceCount = 0;
  var duration = Number(data.updated_at || data.created_at || 0) - Number(data.created_at || 0);
  var promptEntries = [['用户原始 Prompt', prompts.original], ['模型最终 Prompt', prompts.resolved], ['实际提交 Prompt', prompts.submitted]].filter(function (entry) {
    return adminHasContent(entry[1]);
  });
  var referenceNames = Array.isArray(request.reference_names) ? request.reference_names : [];
  var referencePreviews = Array.isArray(request.reference_previews) ? request.reference_previews : [];
  var resultUrl = result.image_url || data.image_url || '';
  var canPreviewResult = adminCanPreviewImage(resultUrl);
  var penpotUrl = data.penpot_edit_url || result.penpot_edit_url || '';
  var hasResultActions = !!resultUrl && !canPreviewResult || !!penpotUrl;
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "df-admin-drawerbackdrop",
    onClick: onClose
  }), /*#__PURE__*/React.createElement("aside", {
    className: "df-admin-drawer"
  }, /*#__PURE__*/React.createElement("div", {
    className: "df-admin-drawerhead"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "df-admin-drawertitle"
  }, "\u4EFB\u52A1\u8BE6\u60C5"), /*#__PURE__*/React.createElement("div", {
    className: "df-admin-cardmeta"
  }, ADMIN_TASK_TYPES[task.task_type] || task.task_type)), /*#__PURE__*/React.createElement("button", {
    className: "df-admin-control df-admin-drawerclose",
    "aria-label": "\u5173\u95ED\u4EFB\u52A1\u8BE6\u60C5",
    title: "\u5173\u95ED",
    onClick: onClose
  }, /*#__PURE__*/React.createElement(I.close, {
    size: 14
  }))), /*#__PURE__*/React.createElement("dl", {
    className: "df-admin-detailgrid"
  }, /*#__PURE__*/React.createElement("dt", null, "\u4EFB\u52A1 ID"), /*#__PURE__*/React.createElement("dd", {
    className: "df-admin-mono"
  }, data.id), /*#__PURE__*/React.createElement("dt", null, "\u72B6\u6001"), /*#__PURE__*/React.createElement("dd", null, /*#__PURE__*/React.createElement(AdminStatusBadge, {
    status: data.status
  })), /*#__PURE__*/React.createElement("dt", null, "\u7528\u6237"), /*#__PURE__*/React.createElement("dd", null, adminUserLabel(data), " ", /*#__PURE__*/React.createElement("span", {
    className: "df-admin-faint"
  }, "\xB7 ", data.user_id || '-')), /*#__PURE__*/React.createElement("dt", null, "\u521B\u5EFA\u65F6\u95F4"), /*#__PURE__*/React.createElement("dd", null, adminFormatTime(data.created_at, true)), /*#__PURE__*/React.createElement("dt", null, "\u6700\u540E\u66F4\u65B0"), /*#__PURE__*/React.createElement("dd", null, adminFormatTime(data.updated_at || data.created_at, true)), /*#__PURE__*/React.createElement("dt", null, "\u8FD0\u884C\u8017\u65F6"), /*#__PURE__*/React.createElement("dd", null, duration > 0 ? adminFormatAge(duration) : '-')), loading ? /*#__PURE__*/React.createElement(AdminEmpty, {
    text: "\u6B63\u5728\u8BFB\u53D6\u5B8C\u6574\u4EFB\u52A1\u5FEB\u7167\u2026"
  }) : null, error ? /*#__PURE__*/React.createElement("div", {
    className: "df-admin-error"
  }, error) : null, !loading && !error ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("section", {
    className: "df-admin-detailsection"
  }, /*#__PURE__*/React.createElement("div", {
    className: "df-admin-detailtitle"
  }, "\u6267\u884C\u914D\u7F6E"), /*#__PURE__*/React.createElement("div", {
    className: "df-admin-detailcards"
  }, /*#__PURE__*/React.createElement("div", {
    className: "df-admin-detailcard"
  }, /*#__PURE__*/React.createElement("span", null, "\u6E20\u9053"), /*#__PURE__*/React.createElement("strong", null, adminProviderLabel(data.provider || request.provider))), /*#__PURE__*/React.createElement("div", {
    className: "df-admin-detailcard"
  }, /*#__PURE__*/React.createElement("span", null, "\u6A21\u578B"), /*#__PURE__*/React.createElement("strong", null, data.model || request.model || '-')), /*#__PURE__*/React.createElement("div", {
    className: "df-admin-detailcard"
  }, /*#__PURE__*/React.createElement("span", null, "\u5C3A\u5BF8 / \u6E05\u6670\u5EA6"), /*#__PURE__*/React.createElement("strong", null, [data.size || request.size, data.resolution || request.resolution].filter(Boolean).join(' · ') || '-')), /*#__PURE__*/React.createElement("div", {
    className: "df-admin-detailcard"
  }, /*#__PURE__*/React.createElement("span", null, "\u53C2\u8003\u56FE"), /*#__PURE__*/React.createElement("strong", null, referenceCount ? referenceCount + (typeof referenceCount === 'number' ? ' 张' : '') : '未使用')), /*#__PURE__*/React.createElement("div", {
    className: "df-admin-detailcard"
  }, /*#__PURE__*/React.createElement("span", null, "\u6279\u6B21"), /*#__PURE__*/React.createElement("strong", null, request.batch_count ? Number(request.batch_index || 0) + 1 + ' / ' + request.batch_count : '-')), /*#__PURE__*/React.createElement("div", {
    className: "df-admin-detailcard"
  }, /*#__PURE__*/React.createElement("span", null, "Skill"), /*#__PURE__*/React.createElement("strong", null, request.skill || '-')))), promptEntries.length ? /*#__PURE__*/React.createElement("section", {
    className: "df-admin-detailsection"
  }, /*#__PURE__*/React.createElement("div", {
    className: "df-admin-detailtitle"
  }, "Prompt \u94FE\u8DEF"), promptEntries.map(function (entry) {
    return /*#__PURE__*/React.createElement("div", {
      className: "df-admin-prompt",
      key: entry[0]
    }, /*#__PURE__*/React.createElement("div", {
      className: "df-admin-promptlabel"
    }, entry[0]), /*#__PURE__*/React.createElement("div", {
      className: "df-admin-prompttext"
    }, adminPromptText(entry[1])));
  }), adminHasContent(prompts.trace) ? /*#__PURE__*/React.createElement("details", {
    className: "df-admin-raw"
  }, /*#__PURE__*/React.createElement("summary", null, "\u67E5\u770B Prompt \u89C4\u5212\u8FC7\u7A0B"), /*#__PURE__*/React.createElement("div", {
    className: "df-admin-code"
  }, adminJsonText(prompts.trace))) : null) : null, data.has_reference || referenceNames.length || referencePreviews.length ? /*#__PURE__*/React.createElement("section", {
    className: "df-admin-detailsection"
  }, /*#__PURE__*/React.createElement("div", {
    className: "df-admin-detailtitle"
  }, "\u53C2\u8003\u56FE\u4FE1\u606F"), /*#__PURE__*/React.createElement("dl", {
    className: "df-admin-detailgrid",
    style: {
      paddingTop: 0
    }
  }, /*#__PURE__*/React.createElement("dt", null, "\u624B\u52A8\u9644\u52A0"), /*#__PURE__*/React.createElement("dd", null, request.manual_reference_count == null ? '历史数据未记录' : request.manual_reference_count + ' 张'), /*#__PURE__*/React.createElement("dt", null, "\u4E0A\u4E0B\u6587\u7EE7\u627F"), /*#__PURE__*/React.createElement("dd", null, request.context_reference_count == null ? '历史数据未记录' : request.context_reference_count + ' 张'), /*#__PURE__*/React.createElement("dt", null, "\u6587\u4EF6"), /*#__PURE__*/React.createElement("dd", null, referenceNames.length ? referenceNames.join('、') : '历史数据未记录')), referencePreviews.map(function (url, index) {
    return /*#__PURE__*/React.createElement("img", {
      className: "df-admin-resultimage",
      src: url,
      alt: '参考图 ' + (index + 1),
      key: url + index
    });
  })) : null, /*#__PURE__*/React.createElement("section", {
    className: "df-admin-detailsection"
  }, /*#__PURE__*/React.createElement("div", {
    className: "df-admin-detailtitle"
  }, "\u7ED3\u679C\u4E0E\u8BCA\u65AD"), canPreviewResult ? /*#__PURE__*/React.createElement("img", {
    className: "df-admin-resultimage",
    src: resultUrl,
    alt: "\u4EFB\u52A1\u7ED3\u679C"
  }) : null, hasResultActions ? /*#__PURE__*/React.createElement("div", {
    className: "df-admin-detailactions"
  }, resultUrl && !canPreviewResult ? /*#__PURE__*/React.createElement("a", {
    className: "df-admin-control",
    href: resultUrl,
    target: "_blank",
    rel: "noreferrer"
  }, "\u6253\u5F00\u7ED3\u679C") : null, penpotUrl ? /*#__PURE__*/React.createElement("a", {
    className: "df-admin-control",
    href: penpotUrl,
    target: "_blank",
    rel: "noreferrer"
  }, "\u6253\u5F00 Penpot") : null) : null, data.error ? /*#__PURE__*/React.createElement("div", {
    className: "df-admin-code"
  }, data.error) : null, data.progress_log && data.progress_log.length ? /*#__PURE__*/React.createElement("div", {
    className: "df-admin-code"
  }, adminJsonText(data.progress_log)) : null, /*#__PURE__*/React.createElement("details", {
    className: "df-admin-raw"
  }, /*#__PURE__*/React.createElement("summary", null, "\u67E5\u770B\u5B8C\u6574\u8BF7\u6C42\u4E0E\u843D\u5E93\u5FEB\u7167"), /*#__PURE__*/React.createElement("div", {
    className: "df-admin-code"
  }, adminJsonText(data))))) : null));
}
function AdminPage({
  user,
  onBack
}) {
  var [view, setView] = React.useState('overview');
  var [rangeHours, setRangeHours] = React.useState(720);
  var [overview, setOverview] = React.useState(null);
  var [health, setHealth] = React.useState(null);
  var [serviceProbes, setServiceProbes] = React.useState([]);
  var [users, setUsers] = React.useState([]);
  var [tasks, setTasks] = React.useState([]);
  var [taskTotal, setTaskTotal] = React.useState(0);
  var [taskOffset, setTaskOffset] = React.useState(0);
  var [taskFilters, setTaskFilters] = React.useState({
    search: '',
    taskType: '',
    status: '',
    userId: '',
    provider: '',
    reference: ''
  });
  var [selectedTask, setSelectedTask] = React.useState(null);
  var [taskDetail, setTaskDetail] = React.useState(null);
  var [taskDetailLoading, setTaskDetailLoading] = React.useState(false);
  var [taskDetailError, setTaskDetailError] = React.useState('');
  var [operations, setOperations] = React.useState([]);
  var [operationTotal, setOperationTotal] = React.useState(0);
  var [operationOffset, setOperationOffset] = React.useState(0);
  var [operationFilters, setOperationFilters] = React.useState({
    action: '',
    userId: ''
  });
  var [expandedOperations, setExpandedOperations] = React.useState({});
  var [loading, setLoading] = React.useState(false);
  var [error, setError] = React.useState('');
  var [updatedAt, setUpdatedAt] = React.useState(null);
  var [showTestUsers, setShowTestUsers] = React.useState(false);
  var loadUsers = React.useCallback(function (includeTest) {
    var queryInclude = includeTest !== undefined ? includeTest : showTestUsers;
    return window.API.getAdminUsers(queryInclude).then(function (data) {
      setUsers(data.users || []);
      return data.users || [];
    });
  }, [showTestUsers]);
  var handleToggleShowTestUsers = function (nextVal) {
    setShowTestUsers(nextVal);
    loadUsers(nextVal);
  };
  var loadOverview = React.useCallback(function (silent) {
    if (!silent) setLoading(true);
    setError('');
    return Promise.all([window.API.getAdminOverview(rangeHours), silent ? Promise.resolve(null) : window.API.fetchDeepHealth().catch(function () {
      return null;
    })]).then(function (result) {
      setOverview(result[0]);
      if (result[1]) setHealth(result[1]);
      setUpdatedAt(Date.now());
    }).catch(function (err) {
      setError(err.message || '运营数据加载失败');
    }).finally(function () {
      if (!silent) setLoading(false);
    });
  }, [rangeHours]);
  var loadServiceProbes = React.useCallback(function () {
    return window.API.getAdminServiceProbes('sub2api', 48).then(function (data) {
      setServiceProbes(data.probes || []);
    }).catch(function (err) {
      setError(err.message || '服务探测记录加载失败');
    });
  }, []);
  var loadTasks = React.useCallback(function () {
    setLoading(true);
    setError('');
    return window.API.getAdminTasks({
      limit: 50,
      offset: taskOffset,
      search: taskFilters.search,
      taskType: taskFilters.taskType,
      status: taskFilters.status,
      userId: taskFilters.userId,
      provider: taskFilters.provider,
      reference: taskFilters.reference
    }).then(function (data) {
      setTasks(data.tasks || []);
      setTaskTotal(data.total || 0);
      setUpdatedAt(Date.now());
    }).catch(function (err) {
      setError(err.message || '任务加载失败');
    }).finally(function () {
      setLoading(false);
    });
  }, [taskOffset, taskFilters]);
  var loadOperations = React.useCallback(function () {
    setLoading(true);
    setError('');
    return window.API.getAdminOperations(100, operationOffset, operationFilters.action, operationFilters.userId).then(function (data) {
      setOperations(data.operations || []);
      setOperationTotal(data.total || 0);
      setUpdatedAt(Date.now());
    }).catch(function (err) {
      setError(err.message || '审计日志加载失败');
    }).finally(function () {
      setLoading(false);
    });
  }, [operationOffset, operationFilters]);
  React.useEffect(function () {
    loadUsers().catch(function () {});
  }, [loadUsers]);
  React.useEffect(function () {
    if (view === 'overview' || view === 'services') loadOverview(false);
  }, [view, loadOverview]);
  React.useEffect(function () {
    if (view === 'services') loadServiceProbes();
  }, [view, loadServiceProbes]);
  React.useEffect(function () {
    if (view !== 'tasks') return;
    var timer = window.setTimeout(loadTasks, 220);
    return function () {
      window.clearTimeout(timer);
    };
  }, [view, loadTasks]);
  React.useEffect(function () {
    if (view === 'audit') loadOperations();
  }, [view, loadOperations]);
  React.useEffect(function () {
    if (!selectedTask) {
      setTaskDetail(null);
      setTaskDetailError('');
      setTaskDetailLoading(false);
      return;
    }
    var cancelled = false;
    setTaskDetail(null);
    setTaskDetailError('');
    setTaskDetailLoading(true);
    window.API.getAdminTaskDetail(selectedTask.task_type, selectedTask.id).then(function (data) {
      if (!cancelled) setTaskDetail(data.task || null);
    }).catch(function (err) {
      if (!cancelled) setTaskDetailError(err.message || '任务详情加载失败');
    }).finally(function () {
      if (!cancelled) setTaskDetailLoading(false);
    });
    return function () {
      cancelled = true;
    };
  }, [selectedTask]);
  React.useEffect(function () {
    if (view !== 'overview') return;
    var timer = window.setInterval(function () {
      loadOverview(true);
    }, 30000);
    return function () {
      window.clearInterval(timer);
    };
  }, [view, loadOverview]);
  var setTaskFilter = function (key, value) {
    setTaskOffset(0);
    setTaskFilters(function (prev) {
      return Object.assign({}, prev, {
        [key]: value
      });
    });
  };
  var navItems = [['overview', '运营总览', I.grid], ['tasks', '任务中心', I.layers], ['services', '服务状态', I.zap], ['users', '用户权限', I.user], ['audit', '审计日志', I.file]];
  var viewTitles = {
    overview: ['运营总览', '任务健康、异常和使用趋势'],
    tasks: ['任务中心', '跨业务查询所有持久化任务'],
    services: ['服务状态', '本机资源与外部依赖连通性'],
    users: ['用户权限', '账号、角色和使用情况'],
    audit: ['审计日志', '关键操作与请求上下文']
  };
  var doRefresh = function () {
    if (view === 'tasks') return loadTasks();
    if (view === 'audit') return loadOperations();
    if (view === 'users') return loadUsers();
    if (view === 'services') return Promise.all([loadOverview(false), loadServiceProbes()]);
    return loadOverview(false);
  };
  var summary = overview && overview.summary || {};
  var previous = overview && overview.previous_summary || {};
  var currentAdminUser = users.find(function (item) {
    return item.id === (user && user.id);
  }) || user || {};
  var successRate = summary.success_rate == null ? '-' : summary.success_rate + '%';
  var volumeFoot = summary.volume_change == null ? '上一周期暂无可比数据' : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("strong", null, summary.volume_change >= 0 ? '+' : '', summary.volume_change, "%"), " \u8F83\u4E0A\u4E00\u5468\u671F");
  var successFoot = summary.success_rate_change == null ? '仅统计已结束任务' : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("strong", null, summary.success_rate_change >= 0 ? '+' : '', summary.success_rate_change, "pp"), " \u8F83\u4E0A\u4E00\u5468\u671F");
  var aiProvider = health && health.ai_provider || {};
  var apimartProvider = aiProvider.apimart || aiProvider;
  var services = [{
    name: 'DesignFlow 后端',
    desc: 'FastAPI 应用',
    connected: !!(health && health.status === 'ok'),
    detail: health && health.version,
    icon: /*#__PURE__*/React.createElement(I.logo, {
      size: 13,
      style: {
        width: 20,
        height: 20
      }
    })
  }, {
    name: 'Penpot',
    desc: '模板与合成引擎',
    connected: !!(health && health.penpot && health.penpot.connected),
    detail: health && health.penpot && health.penpot.url,
    icon: /*#__PURE__*/React.createElement(I.layers, {
      size: 15
    })
  }, {
    name: '产品素材库',
    desc: '本地产品图资源',
    connected: !!(health && health.library && health.library.connected),
    detail: health && health.library && (health.library.folders || []).length + ' 个目录 · ' + health.library.path,
    icon: /*#__PURE__*/React.createElement(I.folder, {
      size: 15
    })
  }, {
    name: '默认生图线路',
    desc: 'APIMart',
    connected: !!apimartProvider.connected,
    configured: !!apimartProvider.configured,
    detail: apimartProvider.message || apimartProvider.url,
    icon: /*#__PURE__*/React.createElement(I.image, {
      size: 15
    })
  }, {
    name: '订阅生图线路',
    desc: 'CLIProxyAPI · 每小时生图探测',
    connected: !!(aiProvider.sub2api && aiProvider.sub2api.connected),
    configured: !!(aiProvider.sub2api && aiProvider.sub2api.configured),
    probing: !!(aiProvider.sub2api && aiProvider.sub2api.last_probe && aiProvider.sub2api.last_probe.status === 'running'),
    detail: aiProvider.sub2api && (aiProvider.sub2api.message || aiProvider.sub2api.url),
    icon: /*#__PURE__*/React.createElement(I.zap, {
      size: 15
    })
  }, {
    name: 'Adobe 生图线路',
    desc: 'adobe2api · Firefly',
    connected: !!(aiProvider.adobe2api && aiProvider.adobe2api.connected),
    configured: !!(aiProvider.adobe2api && aiProvider.adobe2api.configured),
    throttled: !!(aiProvider.adobe2api && aiProvider.adobe2api.throttled),
    detail: aiProvider.adobe2api && (aiProvider.adobe2api.message || aiProvider.adobe2api.url),
    icon: /*#__PURE__*/React.createElement(I.image, {
      size: 15
    })
  }];
  var renderOverview = function () {
    if (!overview) return /*#__PURE__*/React.createElement(AdminEmpty, {
      text: loading ? '正在加载运营数据…' : '运营数据暂不可用'
    });
    var stale = overview && overview.stale_tasks || [];
    var staleAlertKey = overview && overview.stale_alert_key || '';
    var showStaleAlert = stale.length > 0 && !overview.stale_alert_acknowledged;
    var maxBreakdown = Math.max.apply(null, [1].concat((overview && overview.breakdown || []).map(function (item) {
      return item.total || 0;
    })));
    return /*#__PURE__*/React.createElement(React.Fragment, null, showStaleAlert ? /*#__PURE__*/React.createElement("div", {
      className: "df-admin-alert"
    }, /*#__PURE__*/React.createElement("span", {
      className: "df-admin-alertdot"
    }), "\u68C0\u6D4B\u5230 ", stale.length, " \u4E2A\u4EFB\u52A1\u8D85\u8FC7 10 \u5206\u949F\u4ECD\u672A\u7ED3\u675F\uFF0C\u5EFA\u8BAE\u5148\u8FDB\u5165\u4EFB\u52A1\u4E2D\u5FC3\u6838\u5BF9\u3002", /*#__PURE__*/React.createElement("button", {
      className: "df-admin-cardaction",
      onClick: function () {
        setTaskFilter('status', 'active');
        setView('tasks');
      }
    }, "\u67E5\u770B\u4EFB\u52A1 \u2192"), /*#__PURE__*/React.createElement("button", {
      className: "df-admin-alertclose",
      "aria-label": "\u5173\u95ED\u5F02\u5E38\u63D0\u793A",
      title: "\u5173\u95ED",
      onClick: function () {
        window.API.acknowledgeAdminStaleAlert(staleAlertKey).then(function () {
          setOverview(function (prev) {
            return Object.assign({}, prev, {
              stale_alert_acknowledged: true
            });
          });
        }).catch(function (err) {
          setError(err.message || '异常确认失败');
        });
      }
    }, /*#__PURE__*/React.createElement(I.close, {
      size: 13
    }))) : null, /*#__PURE__*/React.createElement("div", {
      className: "df-admin-metrics"
    }, /*#__PURE__*/React.createElement(AdminMetric, {
      label: "\u4EFB\u52A1\u6210\u529F\u7387",
      value: successRate,
      foot: successFoot,
      color: "#1ca66a"
    }), /*#__PURE__*/React.createElement(AdminMetric, {
      label: "\u4EFB\u52A1\u603B\u91CF",
      value: summary.total || 0,
      foot: volumeFoot,
      color: "#20231f"
    }), /*#__PURE__*/React.createElement(AdminMetric, {
      label: "\u6B63\u5728\u5904\u7406",
      value: summary.active || 0,
      foot: '上一周期 ' + (previous.active || 0),
      color: "#bd741d"
    }), /*#__PURE__*/React.createElement(AdminMetric, {
      label: "\u5931\u8D25\u4EFB\u52A1",
      value: summary.failed || 0,
      foot: '上一周期 ' + (previous.failed || 0),
      color: "#d44747"
    })), /*#__PURE__*/React.createElement(AdminHealthTimeline, {
      timeline: overview.health_timeline,
      summary: summary,
      breakdown: overview.breakdown,
      hours: overview.range_hours
    }), /*#__PURE__*/React.createElement("div", {
      className: "df-admin-grid"
    }, /*#__PURE__*/React.createElement("section", {
      className: "df-admin-card"
    }, /*#__PURE__*/React.createElement("div", {
      className: "df-admin-cardhead"
    }, /*#__PURE__*/React.createElement("span", {
      className: "df-admin-cardtitle"
    }, "\u4F7F\u7528\u8D8B\u52BF"), /*#__PURE__*/React.createElement("span", {
      className: "df-admin-cardmeta df-admin-legend"
    }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("i", null), "AI \u751F\u56FE"), /*#__PURE__*/React.createElement("span", {
      className: "is-agent"
    }, /*#__PURE__*/React.createElement("i", null), "Agent"), /*#__PURE__*/React.createElement("span", {
      className: "is-compose"
    }, /*#__PURE__*/React.createElement("i", null), "\u6A21\u677F\u5408\u6210"), /*#__PURE__*/React.createElement("span", {
      className: "is-special"
    }, /*#__PURE__*/React.createElement("i", null), "\u7279\u6B8A\u54C1"))), /*#__PURE__*/React.createElement(AdminTrendChart, {
      series: overview.series,
      hours: overview.range_hours
    })), /*#__PURE__*/React.createElement("section", {
      className: "df-admin-card"
    }, /*#__PURE__*/React.createElement("div", {
      className: "df-admin-cardhead"
    }, /*#__PURE__*/React.createElement("span", {
      className: "df-admin-cardtitle"
    }, "\u4E1A\u52A1\u6784\u6210"), /*#__PURE__*/React.createElement("span", {
      className: "df-admin-cardmeta"
    }, overview.active_users || 0, " \u4F4D\u6D3B\u8DC3\u7528\u6237")), /*#__PURE__*/React.createElement("div", {
      className: "df-admin-breakdown"
    }, (overview.breakdown || []).map(function (item) {
      return /*#__PURE__*/React.createElement("div", {
        className: "df-admin-breakrow",
        key: item.type
      }, /*#__PURE__*/React.createElement("div", {
        className: "df-admin-breaktop"
      }, /*#__PURE__*/React.createElement("span", null, ADMIN_TASK_TYPES[item.type] || item.type), /*#__PURE__*/React.createElement("span", {
        className: "df-admin-breakvalue"
      }, item.total)), /*#__PURE__*/React.createElement("div", {
        className: "df-admin-progress"
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          width: Math.round(item.total * 100 / maxBreakdown) + '%'
        }
      })));
    })))), /*#__PURE__*/React.createElement("div", {
      className: "df-admin-overviewtriple"
    }, /*#__PURE__*/React.createElement(AdminUserRanking, {
      items: overview.user_ranking,
      hours: overview.range_hours
    }), /*#__PURE__*/React.createElement("section", {
      className: "df-admin-card"
    }, /*#__PURE__*/React.createElement("div", {
      className: "df-admin-cardhead"
    }, /*#__PURE__*/React.createElement("span", {
      className: "df-admin-cardtitle"
    }, "\u6700\u8FD1\u5931\u8D25"), /*#__PURE__*/React.createElement("button", {
      className: "df-admin-cardaction",
      onClick: function () {
        setTaskFilter('status', 'failed');
        setView('tasks');
      }
    }, "\u5168\u90E8\u5931\u8D25 \u2192")), (overview.recent_failures || []).length ? /*#__PURE__*/React.createElement("div", {
      className: "df-admin-tablewrap"
    }, /*#__PURE__*/React.createElement("table", {
      className: "df-admin-table"
    }, /*#__PURE__*/React.createElement("tbody", null, overview.recent_failures.slice(0, 5).map(function (item) {
      return /*#__PURE__*/React.createElement("tr", {
        key: item.id
      }, /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(AdminStatusBadge, {
        status: "failed"
      })), /*#__PURE__*/React.createElement("td", {
        className: "df-admin-mono"
      }, String(item.id).slice(0, 8)), /*#__PURE__*/React.createElement("td", {
        className: "df-admin-ellipsis df-admin-muted"
      }, item.error), /*#__PURE__*/React.createElement("td", {
        className: "df-admin-faint"
      }, adminFormatTime(item.created_at)));
    })))) : /*#__PURE__*/React.createElement(AdminEmpty, {
      text: "\u5F53\u524D\u5468\u671F\u6CA1\u6709\u5931\u8D25\u4EFB\u52A1"
    })), /*#__PURE__*/React.createElement("section", {
      className: "df-admin-card"
    }, /*#__PURE__*/React.createElement("div", {
      className: "df-admin-cardhead"
    }, /*#__PURE__*/React.createElement("span", {
      className: "df-admin-cardtitle"
    }, "\u670D\u52A1\u6982\u51B5"), /*#__PURE__*/React.createElement("button", {
      className: "df-admin-cardaction",
      onClick: function () {
        setView('services');
      }
    }, "\u67E5\u770B\u8BE6\u60C5 \u2192")), /*#__PURE__*/React.createElement("div", {
      className: "df-admin-breakdown"
    }, services.slice(0, 5).map(function (item) {
      return /*#__PURE__*/React.createElement("div", {
        className: "df-admin-breakrow",
        key: item.name
      }, /*#__PURE__*/React.createElement("div", {
        className: "df-admin-breaktop"
      }, /*#__PURE__*/React.createElement("span", null, item.name), /*#__PURE__*/React.createElement(AdminStatusBadge, {
        status: item.probing ? 'active' : item.connected ? 'done' : 'failed'
      })));
    })))));
  };
  var renderTasks = function () {
    return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
      className: "df-admin-toolbar"
    }, /*#__PURE__*/React.createElement("div", {
      className: "df-admin-search"
    }, /*#__PURE__*/React.createElement(I.search, {
      size: 13
    }), /*#__PURE__*/React.createElement("input", {
      className: "df-admin-control",
      value: taskFilters.search,
      placeholder: "\u641C\u7D22\u4EFB\u52A1 ID\u3001\u7528\u6237\u3001\u6A21\u578B\u6216\u5185\u5BB9",
      onChange: function (e) {
        setTaskFilter('search', e.target.value);
      }
    })), /*#__PURE__*/React.createElement("select", {
      className: "df-admin-control",
      value: taskFilters.taskType,
      onChange: function (e) {
        setTaskFilter('taskType', e.target.value);
      }
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "\u5168\u90E8\u4E1A\u52A1"), /*#__PURE__*/React.createElement("option", {
      value: "ai_image"
    }, "AI \u751F\u56FE"), /*#__PURE__*/React.createElement("option", {
      value: "agent_image"
    }, "Agent \u751F\u56FE"), /*#__PURE__*/React.createElement("option", {
      value: "compose"
    }, "\u6A21\u677F\u5408\u6210"), /*#__PURE__*/React.createElement("option", {
      value: "special"
    }, "\u7279\u6B8A\u54C1")), /*#__PURE__*/React.createElement("select", {
      className: "df-admin-control",
      value: taskFilters.status,
      onChange: function (e) {
        setTaskFilter('status', e.target.value);
      }
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "\u5168\u90E8\u72B6\u6001"), /*#__PURE__*/React.createElement("option", {
      value: "active"
    }, "\u8FDB\u884C\u4E2D"), /*#__PURE__*/React.createElement("option", {
      value: "done"
    }, "\u5DF2\u5B8C\u6210"), /*#__PURE__*/React.createElement("option", {
      value: "failed"
    }, "\u5931\u8D25")), /*#__PURE__*/React.createElement("select", {
      className: "df-admin-control",
      value: taskFilters.userId,
      onChange: function (e) {
        setTaskFilter('userId', e.target.value);
      }
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "\u5168\u90E8\u7528\u6237"), users.map(function (item) {
      return /*#__PURE__*/React.createElement("option", {
        value: item.id,
        key: item.id
      }, adminUserLabel(item));
    })), /*#__PURE__*/React.createElement("select", {
      className: "df-admin-control",
      value: taskFilters.provider,
      onChange: function (e) {
        setTaskFilter('provider', e.target.value);
      }
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "\u5168\u90E8\u6E20\u9053"), /*#__PURE__*/React.createElement("option", {
      value: "apimart"
    }, "\u9ED8\u8BA4\u7EBF\u8DEF"), /*#__PURE__*/React.createElement("option", {
      value: "sub2api"
    }, "\u8BA2\u9605\u7EBF\u8DEF"), /*#__PURE__*/React.createElement("option", {
      value: "adobe2api"
    }, "Adobe \u7EBF\u8DEF"), /*#__PURE__*/React.createElement("option", {
      value: "penpot"
    }, "Penpot"), /*#__PURE__*/React.createElement("option", {
      value: "local"
    }, "\u672C\u5730\u5904\u7406")), /*#__PURE__*/React.createElement("select", {
      className: "df-admin-control",
      value: taskFilters.reference,
      onChange: function (e) {
        setTaskFilter('reference', e.target.value);
      }
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "\u53C2\u8003\u56FE\u4E0D\u9650"), /*#__PURE__*/React.createElement("option", {
      value: "yes"
    }, "\u4F7F\u7528\u53C2\u8003\u56FE"), /*#__PURE__*/React.createElement("option", {
      value: "no"
    }, "\u672A\u7528\u53C2\u8003\u56FE")), /*#__PURE__*/React.createElement("span", {
      className: "df-admin-pageinfo"
    }, "\u5171 ", taskTotal, " \u6761"), /*#__PURE__*/React.createElement("button", {
      className: "df-admin-control df-admin-pagebutton",
      disabled: !taskOffset,
      onClick: function () {
        setTaskOffset(Math.max(0, taskOffset - 50));
      }
    }, "\u2039"), /*#__PURE__*/React.createElement("button", {
      className: "df-admin-control df-admin-pagebutton",
      disabled: taskOffset + 50 >= taskTotal,
      onClick: function () {
        setTaskOffset(taskOffset + 50);
      }
    }, "\u203A")), /*#__PURE__*/React.createElement("div", {
      className: "df-admin-card"
    }, tasks.length ? /*#__PURE__*/React.createElement("div", {
      className: "df-admin-tablewrap"
    }, /*#__PURE__*/React.createElement("table", {
      className: "df-admin-table"
    }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "\u72B6\u6001"), /*#__PURE__*/React.createElement("th", null, "\u4E1A\u52A1"), /*#__PURE__*/React.createElement("th", null, "\u4EFB\u52A1 ID"), /*#__PURE__*/React.createElement("th", null, "\u7528\u6237"), /*#__PURE__*/React.createElement("th", null, "\u6A21\u578B / \u5185\u5BB9"), /*#__PURE__*/React.createElement("th", null, "\u6E20\u9053"), /*#__PURE__*/React.createElement("th", null, "\u53C2\u8003\u56FE"), /*#__PURE__*/React.createElement("th", null, "\u8FDB\u5EA6"), /*#__PURE__*/React.createElement("th", null, "\u521B\u5EFA\u65F6\u95F4"))), /*#__PURE__*/React.createElement("tbody", null, tasks.map(function (item) {
      return /*#__PURE__*/React.createElement("tr", {
        className: "is-clickable",
        key: item.task_type + ':' + item.id,
        onClick: function () {
          setSelectedTask(item);
        }
      }, /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(AdminStatusBadge, {
        status: item.status
      })), /*#__PURE__*/React.createElement("td", null, ADMIN_TASK_TYPES[item.task_type] || item.task_type), /*#__PURE__*/React.createElement("td", {
        className: "df-admin-mono"
      }, String(item.id).slice(0, 12)), /*#__PURE__*/React.createElement("td", null, adminUserLabel(item)), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("div", null, item.model || '-'), /*#__PURE__*/React.createElement("div", {
        className: "df-admin-ellipsis df-admin-faint"
      }, item.summary || item.error || '-')), /*#__PURE__*/React.createElement("td", null, adminProviderLabel(item.provider)), /*#__PURE__*/React.createElement("td", null, item.has_reference ? item.reference_count == null ? '有' : item.reference_count + ' 张' : '无'), /*#__PURE__*/React.createElement("td", null, Number(item.progress || 0), "%"), /*#__PURE__*/React.createElement("td", {
        className: "df-admin-muted"
      }, adminFormatTime(item.created_at, true)));
    })))) : /*#__PURE__*/React.createElement(AdminEmpty, {
      text: loading ? '正在加载任务…' : '没有匹配的任务'
    })));
  };
  var renderServices = function () {
    if (!health) return /*#__PURE__*/React.createElement(AdminEmpty, {
      text: loading ? '正在探测服务状态…' : '服务状态暂不可用'
    });
    return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
      className: "df-admin-servicegrid"
    }, services.map(function (item) {
      return /*#__PURE__*/React.createElement(AdminServiceCard, _extends({
        key: item.name
      }, item));
    })), /*#__PURE__*/React.createElement("section", {
      className: "df-admin-card df-admin-section"
    }, /*#__PURE__*/React.createElement("div", {
      className: "df-admin-cardhead"
    }, /*#__PURE__*/React.createElement("span", {
      className: "df-admin-cardtitle"
    }, "\u8BA2\u9605\u7EBF\u8DEF\u63A2\u6D4B\u8BB0\u5F55"), /*#__PURE__*/React.createElement("span", {
      className: "df-admin-cardmeta"
    }, "\u6700\u8FD1 48 \u6B21 \xB7 \u6BCF\u5C0F\u65F6\u771F\u5B9E\u751F\u56FE")), serviceProbes.length ? /*#__PURE__*/React.createElement("div", {
      className: "df-admin-probelist"
    }, serviceProbes.map(function (item) {
      var result = item.result || {};
      var imageUrl = result.image_url || '';
      var scheduledLabel = String(item.scheduled_slot || '').slice(5, 16).replace('T', ' ');
      return /*#__PURE__*/React.createElement("article", {
        className: "df-admin-probe",
        key: item.id || item.scheduled_slot
      }, /*#__PURE__*/React.createElement("span", {
        className: 'df-admin-probedot is-' + item.status,
        title: adminStatusText(item.status)
      }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
        className: "df-admin-probetime"
      }, adminFormatTime(item.created_at, true), " \xB7 ", adminStatusText(item.status)), item.error ? /*#__PURE__*/React.createElement("div", {
        className: "df-admin-probeerror",
        title: item.error
      }, item.error) : null), /*#__PURE__*/React.createElement("span", {
        className: "df-admin-probemeta df-admin-probecompleted"
      }, item.completed_at ? adminFormatTime(item.completed_at, true) : '等待完成'), /*#__PURE__*/React.createElement("span", {
        className: "df-admin-probemeta"
      }, item.latency_ms != null ? (Number(item.latency_ms) / 1000).toFixed(1) + ' 秒' : '—'), imageUrl ? /*#__PURE__*/React.createElement("a", {
        className: "df-admin-probethumb",
        href: imageUrl,
        target: "_blank",
        rel: "noreferrer",
        title: "\u67E5\u770B\u6D4B\u8BD5\u7ED3\u679C"
      }, /*#__PURE__*/React.createElement("img", {
        src: imageUrl,
        alt: '订阅线路探测 ' + scheduledLabel,
        loading: "lazy"
      })) : /*#__PURE__*/React.createElement("span", {
        className: "df-admin-probenoimage",
        title: item.status === 'running' ? '正在生成测试图' : '没有返回图片'
      }));
    })) : /*#__PURE__*/React.createElement(AdminEmpty, {
      text: "\u6682\u65E0\u8BA2\u9605\u7EBF\u8DEF\u63A2\u6D4B\u8BB0\u5F55"
    })), /*#__PURE__*/React.createElement("div", {
      className: "df-admin-card df-admin-section"
    }, /*#__PURE__*/React.createElement("div", {
      className: "df-admin-cardhead"
    }, /*#__PURE__*/React.createElement("span", {
      className: "df-admin-cardtitle"
    }, "\u8FD0\u884C\u8BF4\u660E")), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: 16,
        color: 'var(--admin-muted)',
        fontSize: 10.5,
        lineHeight: 1.8
      }
    }, "\u57FA\u7840\u670D\u52A1\u4F1A\u5728\u5237\u65B0\u65F6\u6267\u884C\u5B9E\u65F6\u63A2\u6D4B\u3002\u8BA2\u9605\u751F\u56FE\u7EBF\u8DEF\u5728\u6BCF\u65E5 09:00 \u81F3 21:00 \u6BCF\u5C0F\u65F6\u63D0\u4EA4\u4E00\u6B21\u771F\u5B9E\u751F\u56FE\u4EFB\u52A1\uFF0C \u53EA\u6709\u6210\u529F\u751F\u6210\u5E76\u53D6\u56DE\u56FE\u7247\u624D\u4F1A\u6807\u8BB0\u4E3A\u53EF\u7528\uFF1B\u63A2\u6D4B\u7ED3\u679C\u4E0D\u4F1A\u8BA1\u5165\u7528\u6237\u4EFB\u52A1\u4E0E\u4E1A\u52A1\u7EDF\u8BA1\u3002")));
  };
  var renderAudit = function () {
    return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
      className: "df-admin-toolbar"
    }, /*#__PURE__*/React.createElement("select", {
      className: "df-admin-control",
      value: operationFilters.userId,
      onChange: function (e) {
        setOperationOffset(0);
        setOperationFilters(Object.assign({}, operationFilters, {
          userId: e.target.value
        }));
      }
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "\u5168\u90E8\u7528\u6237"), users.map(function (item) {
      return /*#__PURE__*/React.createElement("option", {
        value: item.id,
        key: item.id
      }, adminUserLabel(item));
    })), /*#__PURE__*/React.createElement("select", {
      className: "df-admin-control",
      value: operationFilters.action,
      onChange: function (e) {
        setOperationOffset(0);
        setOperationFilters(Object.assign({}, operationFilters, {
          action: e.target.value
        }));
      }
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "\u5168\u90E8\u64CD\u4F5C"), Object.keys(ADMIN_ACTIONS).map(function (key) {
      return /*#__PURE__*/React.createElement("option", {
        value: key,
        key: key
      }, ADMIN_ACTIONS[key][0]);
    })), /*#__PURE__*/React.createElement("span", {
      className: "df-admin-pageinfo"
    }, "\u5171 ", operationTotal, " \u6761"), /*#__PURE__*/React.createElement("button", {
      className: "df-admin-control df-admin-pagebutton",
      disabled: !operationOffset,
      onClick: function () {
        setOperationOffset(Math.max(0, operationOffset - 100));
      }
    }, "\u2039"), /*#__PURE__*/React.createElement("button", {
      className: "df-admin-control df-admin-pagebutton",
      disabled: operationOffset + 100 >= operationTotal,
      onClick: function () {
        setOperationOffset(operationOffset + 100);
      }
    }, "\u203A")), /*#__PURE__*/React.createElement("div", {
      className: "df-admin-card"
    }, operations.length ? /*#__PURE__*/React.createElement("div", {
      className: "df-admin-tablewrap"
    }, /*#__PURE__*/React.createElement("table", {
      className: "df-admin-table"
    }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "\u65F6\u95F4"), /*#__PURE__*/React.createElement("th", null, "\u7528\u6237"), /*#__PURE__*/React.createElement("th", null, "\u64CD\u4F5C"), /*#__PURE__*/React.createElement("th", null, "\u8BE6\u60C5"), /*#__PURE__*/React.createElement("th", null, "\u4E0A\u4E0B\u6587"))), /*#__PURE__*/React.createElement("tbody", null, operations.map(function (item) {
      var meta = adminActionMeta(item.action);
      var expanded = !!expandedOperations[item.id];
      return /*#__PURE__*/React.createElement(React.Fragment, {
        key: item.id
      }, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
        className: "df-admin-muted"
      }, adminFormatTime(item.created_at, true)), /*#__PURE__*/React.createElement("td", null, adminUserLabel(item)), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
        style: {
          color: meta[1]
        }
      }, meta[0])), /*#__PURE__*/React.createElement("td", {
        className: "df-admin-ellipsis df-admin-muted"
      }, item.detail || '-'), /*#__PURE__*/React.createElement("td", null, item.payload ? /*#__PURE__*/React.createElement("button", {
        className: "df-admin-linkbutton",
        onClick: function () {
          setExpandedOperations(function (prev) {
            var next = Object.assign({}, prev);
            next[item.id] = !next[item.id];
            return next;
          });
        }
      }, expanded ? '收起' : '查看 JSON') : '-')), expanded ? /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
        colSpan: "5"
      }, /*#__PURE__*/React.createElement("div", {
        className: "df-admin-code"
      }, function () {
        try {
          return JSON.stringify(JSON.parse(item.payload), null, 2);
        } catch (e) {
          return item.payload;
        }
      }()))) : null);
    })))) : /*#__PURE__*/React.createElement(AdminEmpty, {
      text: loading ? '正在加载日志…' : '暂无操作记录'
    })));
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "df-admin"
  }, /*#__PURE__*/React.createElement("style", null, ADMIN_CSS), /*#__PURE__*/React.createElement("aside", {
    className: "df-admin-sidebar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "df-admin-brand"
  }, /*#__PURE__*/React.createElement("div", {
    className: "df-admin-brandmark"
  }, /*#__PURE__*/React.createElement(I.logo, {
    size: 15,
    style: {
      width: 30,
      height: 30,
      borderRadius: 8
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "df-admin-brandname"
  }, "DesignFlow"), /*#__PURE__*/React.createElement("div", {
    className: "df-admin-brandmeta"
  }, "Operations")), /*#__PURE__*/React.createElement("div", {
    className: "df-admin-navlabel"
  }, "Workspace"), /*#__PURE__*/React.createElement("nav", {
    className: "df-admin-nav"
  }, navItems.map(function (item) {
    var NavIcon = item[2];
    return /*#__PURE__*/React.createElement("button", {
      key: item[0],
      className: 'df-admin-navbutton ' + (view === item[0] ? 'is-active' : ''),
      onClick: function () {
        setView(item[0]);
      }
    }, /*#__PURE__*/React.createElement(NavIcon, {
      size: 14
    }), /*#__PURE__*/React.createElement("span", null, item[1]));
  })), /*#__PURE__*/React.createElement("div", {
    className: "df-admin-sidebarfoot"
  }, /*#__PURE__*/React.createElement("div", {
    className: "df-admin-userline"
  }, /*#__PURE__*/React.createElement("span", {
    className: "df-admin-avatar"
  }, String(adminUserLabel(currentAdminUser)).slice(0, 1).toUpperCase()), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "df-admin-username"
  }, adminUserLabel(currentAdminUser)), /*#__PURE__*/React.createElement("div", {
    className: "df-admin-role"
  }, "Administrator"))), /*#__PURE__*/React.createElement("button", {
    className: "df-admin-back",
    onClick: onBack
  }, /*#__PURE__*/React.createElement("span", null, "\u8FD4\u56DE\u5DE5\u4F5C\u53F0")))), /*#__PURE__*/React.createElement("main", {
    className: "df-admin-main"
  }, /*#__PURE__*/React.createElement("header", {
    className: "df-admin-header"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "df-admin-title"
  }, viewTitles[view][0]), /*#__PURE__*/React.createElement("div", {
    className: "df-admin-subtitle"
  }, viewTitles[view][1])), /*#__PURE__*/React.createElement("div", {
    className: "df-admin-headtools"
  }, view === 'overview' ? /*#__PURE__*/React.createElement("select", {
    className: "df-admin-control",
    value: rangeHours,
    onChange: function (e) {
      setRangeHours(Number(e.target.value));
    }
  }, /*#__PURE__*/React.createElement("option", {
    value: "24"
  }, "1 \u5929\u5185"), /*#__PURE__*/React.createElement("option", {
    value: "168"
  }, "\u6700\u8FD1 7 \u5929"), /*#__PURE__*/React.createElement("option", {
    value: "720"
  }, "\u6700\u8FD1 30 \u5929"), /*#__PURE__*/React.createElement("option", {
    value: "0"
  }, "\u6240\u6709\u65F6\u95F4")) : null, updatedAt ? /*#__PURE__*/React.createElement("span", {
    className: "df-admin-updated"
  }, "\u66F4\u65B0\u4E8E ", new Date(updatedAt).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  })) : null, /*#__PURE__*/React.createElement("button", {
    className: "df-admin-control",
    onClick: doRefresh,
    disabled: loading
  }, /*#__PURE__*/React.createElement(I.refresh, {
    size: 12
  }), "\u5237\u65B0"))), /*#__PURE__*/React.createElement("div", {
    className: "df-admin-scroll"
  }, /*#__PURE__*/React.createElement("div", {
    className: "df-admin-content"
  }, error ? /*#__PURE__*/React.createElement("div", {
    className: "df-admin-error"
  }, error) : null, view === 'overview' ? renderOverview() : null, view === 'tasks' ? renderTasks() : null, view === 'services' ? renderServices() : null, view === 'users' ? /*#__PURE__*/React.createElement(AdminUserManagement, {
    currentUser: user,
    users: users,
    onReload: function () {
      return loadUsers(showTestUsers);
    },
    showTestUsers: showTestUsers,
    onToggleShowTest: handleToggleShowTestUsers
  }) : null, view === 'audit' ? renderAudit() : null))), /*#__PURE__*/React.createElement(AdminTaskDrawer, {
    task: selectedTask,
    detail: taskDetail,
    loading: taskDetailLoading,
    error: taskDetailError,
    onClose: function () {
      setSelectedTask(null);
    }
  }));
}
window.AdminPage = AdminPage;

// src/InspirationPanel.jsx
// 灵感面板：覆盖在画布区域的浮层
// 布局：顶部栏（tab + 搜索 + 关闭） + 主体瀑布流（4 列） + 详情抽屉（点击图片展开）

const COLUMN_COUNT_DESKTOP = 4;
const COLUMN_GAP = 12;
const COLUMN_MIN_WIDTH = 200;
const PANEL_INSPIRATION_CATEGORIES = [{
  id: 'share_card',
  label: '分享卡片'
}, {
  id: 'moments',
  label: '朋友圈'
}, {
  id: 'poster',
  label: '海报'
}, {
  id: 'long_image',
  label: '长图文'
}, {
  id: 'detail_page',
  label: '详情页'
}, {
  id: 'main_image',
  label: '主图'
}, {
  id: 'scene_compose',
  label: '场景合成'
}, {
  id: 'ai_model',
  label: 'AI模特'
}, {
  id: 'ai_tryon',
  label: 'AI换装'
}, {
  id: 'ai_wearable',
  label: 'AI穿戴'
}, {
  id: 'ai_pose',
  label: 'AI裂变姿势'
}];
const PANEL_INSPIRATION_TABS = [{
  id: 'all',
  label: '全部'
}, {
  id: 'mine',
  label: '我发布的'
}, {
  id: 'favorite',
  label: '我收藏的'
}].concat(PANEL_INSPIRATION_CATEGORIES);
const InspirationPanel = ({
  onClose,
  onUsePrompt
}) => {
  const [tab, setTab] = React.useState('all');
  const [search, setSearch] = React.useState('');
  const [posts, setPosts] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [detailPost, setDetailPost] = React.useState(null);
  const [canvasRect, setCanvasRect] = React.useState(null);
  const [ratios, setRatios] = React.useState({}); // postId -> width/height
  const containerRef = React.useRef(null);
  const [containerWidth, setContainerWidth] = React.useState(0);
  const loadIdRef = React.useRef(0);

  // 跟踪画布位置，让浮层只覆盖画布区
  React.useEffect(function () {
    const iframe = document.querySelector('iframe[src*="editor-beta"]');
    if (!iframe) return;
    const update = function () {
      const r = iframe.getBoundingClientRect();
      setCanvasRect({
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(iframe);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return function () {
      ro.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, []);

  // 跟踪主区域宽度
  React.useEffect(function () {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(function (entries) {
      for (const e of entries) setContainerWidth(e.contentRect.width);
    });
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return function () {
      ro.disconnect();
    };
  }, []);

  // 加载列表
  const loadPosts = React.useCallback(function () {
    const myLoadId = ++loadIdRef.current;
    setLoading(true);
    setError(null);
    var options = {
      mine: tab === 'mine',
      favorite: tab === 'favorite',
      category: PANEL_INSPIRATION_CATEGORIES.some(function (c) {
        return c.id === tab;
      }) ? tab : '',
      search: search.trim()
    };
    window.API.listInspiration(80, 0, options).then(function (rows) {
      if (myLoadId !== loadIdRef.current) return;
      setPosts(rows || []);
    }).catch(function (e) {
      if (myLoadId !== loadIdRef.current) return;
      setError(e.message || '加载失败');
      setPosts([]);
    }).finally(function () {
      if (myLoadId === loadIdRef.current) setLoading(false);
    });
  }, [tab, search]);
  React.useEffect(function () {
    loadPosts();
  }, [loadPosts]);

  // 搜索过滤
  const setRatio = React.useCallback(function (postId, ratio) {
    setRatios(function (prev) {
      if (prev[postId] === ratio) return prev;
      return Object.assign({}, prev, {
        [postId]: ratio
      });
    });
  }, []);
  const filtered = React.useMemo(function () {
    if (!search.trim()) return posts;
    const q = search.trim().toLowerCase();
    return posts.filter(function (p) {
      return (p.prompt || '').toLowerCase().includes(q) || (p.vlm_prompt || '').toLowerCase().includes(q) || (p.vlm_description || '').toLowerCase().includes(q) || Array.isArray(p.tags) && p.tags.join(' ').toLowerCase().includes(q);
    });
  }, [posts, search]);

  // 瀑布流分列（按图片宽高比，优先后端返回的尺寸）
  const waterFallCols = React.useMemo(function () {
    const colCount = containerWidth ? Math.max(1, Math.min(COLUMN_COUNT_DESKTOP, Math.floor((containerWidth + COLUMN_GAP) / (COLUMN_MIN_WIDTH + COLUMN_GAP)))) : COLUMN_COUNT_DESKTOP;
    const colWidth = containerWidth ? Math.floor((containerWidth - COLUMN_GAP * (colCount - 1)) / colCount) : 0;
    const cols = Array.from({
      length: colCount
    }, function () {
      return {
        items: [],
        height: 0
      };
    });
    filtered.forEach(function (post) {
      const ratio = post.width && post.height ? post.width / post.height : ratios[post.id] || 1;
      const itemHeight = colWidth > 0 ? colWidth / ratio : colWidth;
      let minIdx = 0;
      for (let i = 1; i < colCount; i++) {
        if (cols[i].height < cols[minIdx].height) minIdx = i;
      }
      cols[minIdx].items.push({
        post: post,
        height: itemHeight
      });
      cols[minIdx].height += itemHeight + COLUMN_GAP;
    });
    return {
      colCount: colCount,
      cols: cols
    };
  }, [filtered, containerWidth, ratios]);

  // 关闭详情
  const closeDetail = React.useCallback(function () {
    setDetailPost(null);
  }, []);

  // 下架自己的
  const handleUnpublish = React.useCallback(function (post) {
    if (!window.confirm('下架这条灵感？')) return;
    window.API.unpublishInspiration(post.id).then(function () {
      setPosts(function (prev) {
        return prev.filter(function (p) {
          return p.id !== post.id;
        });
      });
      if (detailPost && detailPost.id === post.id) closeDetail();
    }).catch(function (e) {
      window.alert('下架失败：' + (e.message || '未知错误'));
    });
  }, [detailPost, closeDetail]);
  const toggleFavorite = React.useCallback(function (post) {
    if (!post || !post.id) return;
    const next = !post.favorited;
    const apiCall = next ? window.API.favoriteInspiration : window.API.unfavoriteInspiration;
    setPosts(function (prev) {
      if (!next && tab === 'favorite') {
        return prev.filter(function (p) {
          return p.id !== post.id;
        });
      }
      return prev.map(function (p) {
        return p.id === post.id ? Object.assign({}, p, {
          favorited: next
        }) : p;
      });
    });
    if (detailPost && detailPost.id === post.id) {
      setDetailPost(Object.assign({}, detailPost, {
        favorited: next
      }));
    }
    apiCall(post.id).catch(function (e) {
      setPosts(function (prev) {
        if (!next && tab === 'favorite') {
          return [Object.assign({}, post, {
            favorited: !next
          })].concat(prev);
        }
        return prev.map(function (p) {
          return p.id === post.id ? Object.assign({}, p, {
            favorited: !next
          }) : p;
        });
      });
      if (detailPost && detailPost.id === post.id) {
        setDetailPost(Object.assign({}, detailPost, {
          favorited: !next
        }));
      }
      window.alert((next ? '收藏' : '取消收藏') + '失败：' + (e.message || '未知错误'));
    });
  }, [detailPost, tab]);

  // 点击图片 → 加载完整详情
  const openDetail = React.useCallback(function (post) {
    window.API.getInspiration(post.id).then(function (full) {
      setDetailPost(full || post);
    }).catch(function () {
      setDetailPost(post);
    });
  }, []);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      top: canvasRect ? canvasRect.top : 0,
      left: canvasRect ? canvasRect.left : 0,
      width: canvasRect ? canvasRect.width : '100vw',
      height: canvasRect ? canvasRect.height : '100vh',
      zIndex: 50,
      background: 'var(--panel-2)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 44,
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '0 16px',
      background: 'var(--panel)',
      borderBottom: '1px solid var(--line)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 15,
      overflowX: 'auto',
      flex: '1 1 auto',
      minWidth: 0,
      alignSelf: 'stretch',
      alignItems: 'center'
    },
    className: "inspiration-tab-scroll"
  }, PANEL_INSPIRATION_TABS.map(function (t) {
    const active = tab === t.id;
    return React.createElement('button', {
      key: t.id,
      onClick: function () {
        setTab(t.id);
      },
      style: {
        height: '100%',
        padding: '0 1px',
        borderRadius: 0,
        border: 'none',
        borderBottom: '2px solid ' + (active ? 'var(--ink)' : 'transparent'),
        background: 'transparent',
        color: active ? 'var(--ink)' : 'var(--ink-2)',
        fontSize: 11.5,
        fontWeight: active ? 600 : 400,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transform: 'translateY(1px)'
      }
    }, t.label);
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '5px 10px',
      borderRadius: 6,
      background: 'var(--panel-2)',
      border: '1px solid var(--line-2)',
      width: 170,
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(I.search, {
    size: 12,
    style: {
      color: 'var(--ink-3)'
    }
  }), /*#__PURE__*/React.createElement("input", {
    value: search,
    placeholder: "\u641C\u7D22 prompt / \u6807\u7B7E\u2026",
    style: {
      flex: 1,
      border: 'none',
      outline: 'none',
      background: 'transparent',
      fontSize: 11.5,
      color: 'var(--ink)'
    },
    onChange: function (e) {
      setSearch(e.target.value);
    }
  })), /*#__PURE__*/React.createElement("button", {
    onClick: function () {
      loadPosts();
    },
    title: "\u5237\u65B0",
    style: {
      width: 28,
      height: 28,
      borderRadius: 6,
      background: 'var(--panel-2)',
      border: '1px solid var(--line-2)',
      color: 'var(--ink-2)',
      display: 'grid',
      placeItems: 'center',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement(I.refresh, {
    size: 12
  })), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    title: "\u5173\u95ED\u7075\u611F",
    style: {
      width: 28,
      height: 28,
      borderRadius: 6,
      background: 'var(--panel-2)',
      border: '1px solid var(--line-2)',
      color: 'var(--ink-2)',
      display: 'grid',
      placeItems: 'center',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement(I.close, {
    size: 12
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      overflowY: 'auto',
      padding: 16
    }
  }, error && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 12,
      color: 'var(--warn)',
      fontSize: 12
    }
  }, "\u52A0\u8F7D\u5931\u8D25\uFF1A", error), !error && loading && filtered.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 24,
      color: 'var(--ink-3)',
      fontSize: 12,
      textAlign: 'center'
    }
  }, "\u52A0\u8F7D\u4E2D\u2026"), !error && !loading && filtered.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 40,
      color: 'var(--ink-3)',
      fontSize: 12,
      textAlign: 'center'
    }
  }, tab === 'mine' ? '你还没有发布过灵感' : tab === 'favorite' ? '你还没有收藏灵感' : '还没有灵感，去生张图试试吧'), filtered.length > 0 && (() => {
    // cols 已经在 useMemo 中算好
    return React.createElement('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(' + waterFallCols.colCount + ', minmax(0, 1fr))',
        gap: COLUMN_GAP,
        alignItems: 'flex-start'
      }
    }, waterFallCols.cols.map(function (col, ci) {
      return React.createElement('div', {
        key: ci,
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: COLUMN_GAP,
          minWidth: 0
        }
      }, col.items.map(function (item) {
        return React.createElement(InspirationCard, {
          key: item.post.id,
          post: item.post,
          height: item.height,
          onRatioLoad: setRatio,
          onOpen: function () {
            openDetail(item.post);
          },
          onToggleFavorite: toggleFavorite
        });
      }));
    }));
  })()), detailPost && /*#__PURE__*/React.createElement(InspirationDetail, {
    post: detailPost,
    onClose: closeDetail,
    onUsePrompt: onUsePrompt,
    onToggleFavorite: toggleFavorite,
    onUnpublish: detailPost.can_manage ? handleUnpublish : null
  }));
};
const InspirationCard = ({
  post,
  height,
  onRatioLoad,
  onOpen,
  onToggleFavorite
}) => {
  return React.createElement('div', {
    role: 'button',
    tabIndex: 0,
    onClick: onOpen,
    onKeyDown: function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onOpen && onOpen();
      }
    },
    style: {
      width: '100%',
      display: 'block',
      padding: 0,
      border: '1px solid var(--line-2)',
      borderRadius: 10,
      background: 'var(--panel)',
      cursor: 'pointer',
      overflow: 'hidden',
      textAlign: 'left',
      transition: 'transform 120ms, box-shadow 120ms',
      position: 'relative'
    },
    onMouseEnter: function (e) {
      e.currentTarget.style.transform = 'translateY(-2px)';
      e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.08)';
    },
    onMouseLeave: function (e) {
      e.currentTarget.style.transform = 'none';
      e.currentTarget.style.boxShadow = 'none';
    }
  }, React.createElement('div', {
    style: {
      position: 'relative'
    }
  }, React.createElement('img', {
    src: post.image_url,
    alt: post.prompt,
    loading: 'lazy',
    onLoad: function (e) {
      const img = e.currentTarget;
      if (img.naturalWidth && img.naturalHeight && onRatioLoad) {
        onRatioLoad(post.id, img.naturalWidth / img.naturalHeight);
      }
    },
    style: height ? {
      width: '100%',
      height: height + 'px',
      objectFit: 'cover',
      display: 'block',
      background: 'var(--panel-2)'
    } : {
      width: '100%',
      display: 'block',
      background: 'var(--panel-2)'
    }
  }), React.createElement('button', {
    type: 'button',
    title: post.favorited ? '取消收藏这张图' : '收藏这张图',
    'aria-label': post.favorited ? '取消收藏这张图' : '收藏这张图',
    onClick: function (e) {
      e.preventDefault();
      e.stopPropagation();
      onToggleFavorite && onToggleFavorite(post);
    },
    onMouseEnter: function (e) {
      e.currentTarget.style.transform = post.favorited ? 'scale(1.08)' : 'scale(1.06)';
    },
    onMouseLeave: function (e) {
      e.currentTarget.style.transform = post.favorited ? 'scale(1.04)' : 'scale(1)';
    },
    onMouseDown: function (e) {
      e.currentTarget.style.transform = 'scale(0.94)';
    },
    onMouseUp: function (e) {
      e.currentTarget.style.transform = post.favorited ? 'scale(1.08)' : 'scale(1.06)';
    },
    style: {
      position: 'absolute',
      right: 8,
      top: 8,
      width: 28,
      height: 28,
      borderRadius: 999,
      border: post.favorited ? '1px solid oklch(0.74 0.16 35)' : '1px solid rgba(255,255,255,0.72)',
      background: post.favorited ? 'oklch(0.62 0.18 35)' : 'rgba(255,255,255,0.84)',
      color: post.favorited ? '#fff' : 'var(--ink-2)',
      display: 'grid',
      placeItems: 'center',
      cursor: 'pointer',
      backdropFilter: 'blur(8px)',
      boxShadow: post.favorited ? '0 8px 18px rgba(190,72,45,0.28)' : '0 4px 12px rgba(15,23,42,0.10)',
      transform: post.favorited ? 'scale(1.04)' : 'scale(1)',
      transition: 'background 140ms, color 140ms, border-color 140ms, box-shadow 140ms, transform 140ms'
    }
  }, React.createElement(I.heart, {
    size: post.favorited ? 14 : 13
  }))));
};
const InspirationDetail = ({
  post,
  onClose,
  onUsePrompt,
  onToggleFavorite,
  onUnpublish
}) => {
  const [describing, setDescribing] = React.useState(false);
  const [describeError, setDescribeError] = React.useState('');
  const [localPost, setLocalPost] = React.useState(post);
  React.useEffect(function () {
    setLocalPost(post);
    setDescribeError('');
  }, [post]);
  const activePost = localPost || post;
  const handleDescribe = React.useCallback(function () {
    if (!activePost || !activePost.id) return;
    setDescribeError('');
    setDescribing(true);
    window.API.describeInspiration(activePost.id).then(function (res) {
      setLocalPost(function (prev) {
        return Object.assign({}, prev || activePost, {
          vlm_prompt: res.prompt || '',
          vlm_description: res.description || ''
        });
      });
    }).catch(function (e) {
      setDescribeError(e.message || '未知错误');
    }).finally(function () {
      setDescribing(false);
    });
  }, [activePost]);
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    onClick: onClose,
    style: {
      position: 'absolute',
      inset: 0,
      background: 'rgba(0,0,0,0.32)',
      zIndex: 20
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      width: 420,
      zIndex: 21,
      background: 'var(--panel)',
      borderLeft: '1px solid var(--line)',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '-8px 0 24px rgba(0,0,0,0.12)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 44,
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      padding: '0 14px',
      gap: 8,
      borderBottom: '1px solid var(--line)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      fontWeight: 500,
      color: 'var(--ink)'
    }
  }, "\u7075\u611F\u8BE6\u60C5"), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("button", {
    onClick: function () {
      onToggleFavorite && onToggleFavorite(activePost);
      setLocalPost(Object.assign({}, activePost, {
        favorited: !activePost.favorited
      }));
    },
    style: {
      height: 28,
      padding: '0 9px',
      borderRadius: 6,
      background: activePost.favorited ? 'oklch(0.96 0.04 35)' : 'var(--panel-2)',
      border: '1px solid var(--line-2)',
      color: activePost.favorited ? 'var(--warn)' : 'var(--ink-2)',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      cursor: 'pointer',
      fontSize: 11
    }
  }, /*#__PURE__*/React.createElement(I.heart, {
    size: 12
  }), activePost.favorited ? '已收藏' : '收藏'), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    style: {
      width: 28,
      height: 28,
      borderRadius: 6,
      background: 'var(--panel-2)',
      border: '1px solid var(--line-2)',
      color: 'var(--ink-2)',
      display: 'grid',
      placeItems: 'center',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement(I.close, {
    size: 12
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 14,
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: activePost.full_image_url || activePost.image_url,
    alt: activePost.prompt,
    style: {
      width: '100%',
      maxHeight: 360,
      objectFit: 'contain',
      borderRadius: 8,
      background: 'var(--panel-2)',
      border: '1px solid var(--line-2)',
      display: 'block'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      padding: '0 14px 14px'
    }
  }, activePost.original_prompt && activePost.original_prompt !== activePost.prompt ? /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: 'var(--ink-3)',
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      marginBottom: 4
    },
    className: "mono"
  }, "\u539F\u59CB\u8F93\u5165"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--ink-2)',
      lineHeight: 1.55,
      padding: '8px 10px',
      borderRadius: 6,
      background: 'var(--panel-2)',
      border: '1px solid var(--line-2)',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word'
    }
  }, activePost.original_prompt)) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: 'var(--ink-3)',
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      marginBottom: 4
    },
    className: "mono"
  }, "\u751F\u6210 Prompt"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--ink)',
      lineHeight: 1.55,
      padding: '8px 10px',
      borderRadius: 6,
      background: 'var(--panel-2)',
      border: '1px solid var(--line-2)',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word'
    }
  }, activePost.resolved_prompt || activePost.prompt || '（无）')), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      marginBottom: 4
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: 'var(--ink-3)',
      textTransform: 'uppercase',
      letterSpacing: '0.06em'
    },
    className: "mono"
  }, "VLM \u53CD\u63A8 Prompt"), /*#__PURE__*/React.createElement("button", {
    onClick: handleDescribe,
    disabled: describing,
    style: {
      height: 22,
      padding: '0 8px',
      borderRadius: 999,
      background: 'var(--panel)',
      color: 'var(--ink-2)',
      border: '1px solid var(--line)',
      fontSize: 10.5,
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      cursor: describing ? 'default' : 'pointer',
      opacity: describing ? 0.65 : 1
    }
  }, /*#__PURE__*/React.createElement(I.eye, {
    size: 11
  }), describing ? '分析中' : activePost.vlm_prompt ? '重新反推' : '反推')), describeError ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: 'var(--warn)',
      lineHeight: 1.45,
      padding: '7px 9px',
      borderRadius: 6,
      background: 'oklch(0.97 0.025 35)',
      border: '1px solid oklch(0.9 0.05 35)',
      marginBottom: 6
    }
  }, "\u53CD\u63A8\u5931\u8D25\uFF1A", describeError) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: activePost.vlm_prompt ? 'var(--ink)' : 'var(--ink-3)',
      lineHeight: 1.55,
      padding: '8px 10px',
      borderRadius: 6,
      background: 'var(--panel-2)',
      border: '1px solid var(--line-2)',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      minHeight: 42
    }
  }, activePost.vlm_prompt || (describing ? '正在分析图片并生成可复用 prompt…' : '尚未反推。点击右上角“反推”，用 VLM 从图片生成更详细的复刻 prompt。'))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 6,
      marginBottom: 12
    }
  }, [['分类', activePost.category_label || '分享卡片'], ['模型', activePost.model], ['尺寸', activePost.size], ['分辨率', activePost.resolution || '默认'], activePost.has_ref ? ['参考图', '有'] : null].filter(Boolean).map(function (item, i) {
    return React.createElement('span', {
      key: i,
      className: 'mono',
      style: {
        fontSize: 10,
        padding: '3px 8px',
        borderRadius: 4,
        background: 'var(--panel-2)',
        border: '1px solid var(--line-2)',
        color: 'var(--ink-2)'
      }
    }, item[0] + '：' + item[1]);
  })), Array.isArray(activePost.tags) && activePost.tags.length > 0 ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 5,
      marginBottom: 12
    }
  }, activePost.tags.map(function (tag) {
    return React.createElement('span', {
      key: tag,
      style: {
        fontSize: 10.5,
        color: 'var(--ink-2)',
        padding: '3px 8px',
        borderRadius: 999,
        background: 'var(--panel-2)',
        border: '1px solid var(--line-2)'
      }
    }, '#' + tag);
  })) : null), /*#__PURE__*/React.createElement("div", {
    style: {
      flexShrink: 0,
      padding: 12,
      borderTop: '1px solid var(--line)',
      display: 'flex',
      flexDirection: 'column',
      gap: 7
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: function () {
      const finalPrompt = activePost.vlm_prompt || activePost.resolved_prompt || activePost.prompt || activePost.original_prompt || '';
      const promptSource = activePost.vlm_prompt ? 'vlm' : activePost.resolved_prompt ? 'resolved' : 'original';
      onUsePrompt(Object.assign({}, activePost, {
        prompt: finalPrompt,
        prompt_source: promptSource
      }));
    },
    style: {
      flex: 1,
      height: 36,
      padding: '0 14px',
      borderRadius: 6,
      background: 'var(--ink)',
      color: 'white',
      border: '1px solid var(--ink)',
      fontSize: 12,
      fontWeight: 500,
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(I.sparkles, {
    size: 12
  }), activePost.vlm_prompt ? '用反推 Prompt 生成同款' : activePost.resolved_prompt ? '用生成 Prompt 生成同款' : '用原始 Prompt 生成同款'), onUnpublish && /*#__PURE__*/React.createElement("button", {
    onClick: function () {
      onUnpublish(post);
    },
    style: {
      height: 36,
      padding: '0 12px',
      borderRadius: 6,
      background: 'var(--panel)',
      color: 'var(--warn)',
      border: '1px solid var(--line)',
      fontSize: 12,
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      cursor: 'pointer'
    }
  }, "\u4E0B\u67B6")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10.5,
      color: 'var(--ink-3)',
      lineHeight: 1.4
    }
  }, "\u5F53\u524D\u4F18\u5148\u4F7F\u7528 VLM \u53CD\u63A8 Prompt\uFF1B\u6CA1\u6709\u53CD\u63A8\u7ED3\u679C\u65F6\u4F7F\u7528\u751F\u6210\u65F6\u7684\u5B8C\u6574 Prompt\uFF0C\u518D\u515C\u5E95\u539F\u59CB\u8F93\u5165\u3002"))));
};
window.InspirationPanel = InspirationPanel;

// src/WhatsNewModal.jsx
// What's New update card — each release version shows once after login

const WHATS_NEW_SEEN_KEY = 'designflow_whats_new_seen';
const markWhatsNewSeen = function (version) {
  const value = String(version || '').trim();
  if (!value) return;
  try {
    localStorage.setItem(WHATS_NEW_SEEN_KEY, value);
  } catch (e) {}
};
const getSeenWhatsNewVersion = function () {
  try {
    return String(localStorage.getItem(WHATS_NEW_SEEN_KEY) || '').trim();
  } catch (e) {
    return '';
  }
};
const WhatsNewFeatureIcon = ({
  type
}) => {
  const wrap = {
    width: 36,
    height: 36,
    borderRadius: 10,
    background: 'var(--accent-soft)',
    color: 'var(--accent-ink)',
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0
  };
  let glyph = null;
  if (type === 'image') {
    glyph = React.createElement(I.image, {
      size: 16,
      stroke: 1.7
    });
  } else if (type === 'agent') {
    glyph = React.createElement(I.user, {
      size: 16,
      stroke: 1.7
    });
  } else if (type === 'pages') {
    glyph = React.createElement(I.grid, {
      size: 16,
      stroke: 1.7
    });
  } else if (type === 'sparkles') {
    glyph = React.createElement(I.sparkles, {
      size: 16,
      stroke: 1.7
    });
  } else {
    glyph = React.createElement(I.zap, {
      size: 16,
      stroke: 1.7
    });
  }
  return React.createElement('div', {
    style: wrap
  }, glyph);
};
const WhatsNewModal = ({
  release,
  onClose
}) => {
  if (!release) return null;
  const features = Array.isArray(release.features) ? release.features : [];
  const versionLabel = [release.version, release.date].filter(Boolean).join(' · ');

  // 用户确认后写入当前版本；同一 version 之后不再弹出
  const dismiss = function () {
    markWhatsNewSeen(release.version);
    if (onClose) onClose();
  };
  const openChangelog = function () {
    const raw = String(release.changelogUrl || 'changelog.html').trim() || 'changelog.html';
    try {
      // 相对路径基于当前页面（通常 /ui/），确保站内 changelog.html 可正确解析
      const url = new URL(raw, window.location.href).toString();
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      window.open(raw, '_blank', 'noopener,noreferrer');
    }
  };
  return React.createElement('div', {
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 240,
      display: 'grid',
      placeItems: 'center',
      padding: 20,
      background: 'rgba(40, 42, 48, 0.48)'
    },
    onClick: function (e) {
      if (e.target === e.currentTarget) dismiss();
    }
  }, React.createElement('div', {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': release.title || '更新提示',
    style: {
      width: 'min(420px, calc(100vw - 40px))',
      background: 'var(--panel)',
      borderRadius: 20,
      boxShadow: '0 24px 64px rgba(20, 22, 40, 0.18), 0 2px 8px rgba(20, 22, 40, 0.06)',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column'
    },
    onClick: function (e) {
      e.stopPropagation();
    }
  }, React.createElement('div', {
    style: {
      padding: '22px 22px 8px',
      position: 'relative'
    }
  }, React.createElement('div', {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginBottom: 18
    }
  }, React.createElement('div', {
    style: {
      width: 40,
      height: 40,
      borderRadius: 12,
      background: 'var(--ink)',
      color: 'var(--panel)',
      display: 'grid',
      placeItems: 'center'
    }
  }, React.createElement(I.sparkles, {
    size: 18,
    stroke: 1.8
  })), React.createElement('button', {
    type: 'button',
    onClick: dismiss,
    'aria-label': '关闭',
    style: {
      width: 28,
      height: 28,
      borderRadius: 8,
      display: 'grid',
      placeItems: 'center',
      color: 'var(--ink-3)',
      cursor: 'pointer',
      marginTop: -2,
      marginRight: -4
    }
  }, React.createElement(I.close, {
    size: 15,
    stroke: 1.8
  }))), React.createElement('div', {
    style: {
      fontSize: 20,
      fontWeight: 700,
      letterSpacing: '-0.02em',
      color: 'var(--ink)',
      lineHeight: 1.25,
      marginBottom: 6
    }
  }, release.title || 'Designflow 更新了'), versionLabel ? React.createElement('div', {
    style: {
      fontSize: 12.5,
      color: 'var(--ink-3)',
      letterSpacing: '-0.01em',
      marginBottom: 18
    }
  }, versionLabel) : null, React.createElement('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      paddingBottom: 8
    }
  }, features.map(function (item, idx) {
    return React.createElement('div', {
      key: item.title || idx,
      style: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12
      }
    }, React.createElement(WhatsNewFeatureIcon, {
      type: item.icon
    }), React.createElement('div', {
      style: {
        minWidth: 0,
        flex: 1,
        paddingTop: 1
      }
    }, React.createElement('div', {
      style: {
        fontSize: 13.5,
        fontWeight: 650,
        color: 'var(--ink)',
        letterSpacing: '-0.01em',
        lineHeight: 1.3,
        marginBottom: 3
      }
    }, item.title || ''), React.createElement('div', {
      style: {
        fontSize: 12.5,
        color: 'var(--ink-2)',
        lineHeight: 1.55,
        letterSpacing: '-0.005em'
      }
    }, item.desc || '')));
  }))), React.createElement('div', {
    style: {
      borderTop: '1px solid var(--line)',
      padding: '14px 18px 16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 8,
      background: 'var(--panel)'
    }
  }, React.createElement('button', {
    type: 'button',
    onClick: openChangelog,
    style: {
      height: 34,
      padding: '0 14px',
      borderRadius: 10,
      border: '1px solid var(--line)',
      background: 'var(--panel)',
      color: 'var(--ink-2)',
      fontSize: 12.5,
      fontWeight: 550,
      cursor: 'pointer',
      letterSpacing: '-0.01em'
    }
  }, '更新日志'), React.createElement('button', {
    type: 'button',
    onClick: dismiss,
    style: {
      height: 34,
      padding: '0 16px',
      borderRadius: 10,
      border: '1px solid var(--ink)',
      background: 'var(--ink)',
      color: 'var(--panel)',
      fontSize: 12.5,
      fontWeight: 650,
      cursor: 'pointer',
      letterSpacing: '-0.01em'
    }
  }, '我知道了'))));
};

// 仅当 whats-new.json 的 version 与本地已确认版本不同时弹出
const shouldShowWhatsNew = function (release) {
  if (!release) return false;
  const version = String(release.version || '').trim();
  if (!version) return false;
  return getSeenWhatsNewVersion() !== version;
};
const loadWhatsNewRelease = function () {
  return fetch('whats-new.json', {
    cache: 'no-cache'
  }).then(function (res) {
    if (!res.ok) throw new Error('whats-new fetch failed');
    return res.json();
  }).catch(function () {
    return null;
  });
};
window.WhatsNewModal = WhatsNewModal;
window.shouldShowWhatsNew = shouldShowWhatsNew;
window.loadWhatsNewRelease = loadWhatsNewRelease;
window.markWhatsNewSeen = markWhatsNewSeen;
window.WHATS_NEW_SEEN_KEY = WHATS_NEW_SEEN_KEY;

// src/app.jsx
// App root - wires panels + tweaks + host communication

const LAST_USERNAME_KEY = 'designflow_last_username';
const LiteLoginGate = ({
  onLogin,
  loading,
  error,
  initialName
}) => {
  const [name, setName] = React.useState(initialName || '');
  const [password, setPassword] = React.useState('');
  React.useEffect(() => {
    setName(initialName || '');
  }, [initialName]);
  const submit = async () => {
    const clean = name.trim();
    if (!clean || !password.trim() || loading) return;
    await onLogin(clean, password.trim());
  };
  const inputStyle = {
    width: '100%',
    boxSizing: 'border-box',
    borderRadius: 8,
    border: '1px solid var(--line)',
    background: 'var(--panel-2)',
    color: 'var(--ink)',
    padding: '10px 12px',
    fontSize: 13,
    outline: 'none'
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 200,
      display: 'grid',
      placeItems: 'center',
      background: 'rgba(245, 245, 248, 0.78)',
      backdropFilter: 'blur(6px)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 'min(360px, calc(100vw - 32px))',
      padding: 20,
      borderRadius: 10,
      background: 'var(--panel)',
      border: '1px solid var(--line)',
      boxShadow: '0 10px 30px rgba(0,0,0,0.08)',
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "serif",
    style: {
      fontSize: 21,
      color: 'var(--ink)'
    }
  }, "\u8FDB\u5165 Designflow"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--ink-3)',
      lineHeight: 1.5
    }
  }, "\u8BF7\u8F93\u5165\u7528\u6237\u540D\u548C\u5BC6\u7801\u767B\u5F55\u3002")), /*#__PURE__*/React.createElement("input", {
    value: name,
    onChange: e => setName(e.target.value),
    onKeyDown: e => {
      if (e.key === 'Enter') submit();
    },
    placeholder: "\u7528\u6237\u540D",
    autoFocus: true,
    style: inputStyle
  }), /*#__PURE__*/React.createElement("input", {
    type: "password",
    value: password,
    onChange: e => setPassword(e.target.value),
    onKeyDown: e => {
      if (e.key === 'Enter') submit();
    },
    placeholder: "\u5BC6\u7801",
    style: inputStyle
  }), error && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: 'var(--warn)'
    }
  }, error), /*#__PURE__*/React.createElement("button", {
    onClick: submit,
    disabled: !name.trim() || !password.trim() || loading,
    style: {
      height: 36,
      borderRadius: 8,
      background: !name.trim() || !password.trim() || loading ? 'var(--line)' : 'var(--ink)',
      color: 'white',
      fontSize: 12.5,
      fontWeight: 500,
      cursor: !name.trim() || !password.trim() || loading ? 'default' : 'pointer'
    }
  }, loading ? '进入中...' : '进入工作台')));
};
const App = () => {
  const DEFAULT_TWEAKS = {
    chatState: 'returned',
    canvasState: 'candidates',
    theme: 'light'
  };
  const [tweaks, setTweaks] = React.useState(window.TWEAKS || DEFAULT_TWEAKS);
  const [tweaksVisible, setTweaksVisible] = React.useState(false);
  const [activeTemplate, setActiveTemplate] = React.useState(TEMPLATES[0]);
  const [resultTemplate, setResultTemplate] = React.useState(null);
  const [editorCommand, setEditorCommand] = React.useState(null);
  const [slashTrigger, setSlashTrigger] = React.useState(null);
  const [currentUser, setCurrentUser] = React.useState(null);
  const currentUserIdRef = React.useRef('');
  currentUserIdRef.current = currentUser && currentUser.id ? String(currentUser.id) : '';
  const [authLoading, setAuthLoading] = React.useState(true);
  const [authError, setAuthError] = React.useState('');
  const [inspirationOpen, setInspirationOpen] = React.useState(false);
  const [seedPrompt, setSeedPrompt] = React.useState('');
  const [canvasReferenceSelection, setCanvasReferenceSelection] = React.useState(null);
  const [templatePanelCollapsed, setTemplatePanelCollapsed] = React.useState(true);
  const [templateRevealHovered, setTemplateRevealHovered] = React.useState(false);
  const [whatsNewRelease, setWhatsNewRelease] = React.useState(null);
  const handleUseInspirationPrompt = React.useCallback(function (post) {
    setInspirationOpen(false);
    setSeedPrompt(post.vlm_prompt || post.resolved_prompt || post.prompt || post.original_prompt || '');
    const refUrl = post.full_image_url || post.image_url || '';
    if (refUrl) {
      setCanvasReferenceSelection({
        key: Date.now() + Math.random(),
        images: [{
          src: refUrl,
          name: 'inspiration-' + (post.id || Date.now()) + '.png'
        }]
      });
    }
  }, []);
  const handleSeedConsumed = React.useCallback(function () {
    setSeedPrompt('');
  }, []);
  const handleUseCanvasReferences = React.useCallback(function (images) {
    if (!Array.isArray(images)) return;
    setCanvasReferenceSelection({
      key: Date.now() + Math.random(),
      images: images.slice(0, 9)
    });
  }, []);
  const normalizeDesignflowAssetUrl = React.useCallback(function (rawUrl) {
    const value = String(rawUrl || '').trim();
    if (!value) return '';
    const publicPrefixes = ['/ai-images/', '/results/', '/output/', '/avatars/'];
    const isPublicPath = function (pathname) {
      return publicPrefixes.some(function (prefix) {
        return pathname.indexOf(prefix) === 0;
      }) || /^\/compose\/[^/]+\/image\/?$/.test(pathname) || pathname.indexOf('/export/grid/') === 0;
    };
    try {
      const parsed = new URL(value, window.location.origin);
      if (isPublicPath(parsed.pathname)) {
        return parsed.pathname + parsed.search + parsed.hash;
      }
      return parsed.toString();
    } catch (e) {
      return value;
    }
  }, []);
  const getViewFromHash = () => window.location.hash === '#/admin' ? 'admin' : 'workbench';
  const [currentView, setCurrentView] = React.useState(getViewFromHash);
  const navigateTo = React.useCallback(function (hash) {
    window.location.hash = hash;
  }, []);
  const [lastUsername, setLastUsername] = React.useState(() => {
    try {
      return localStorage.getItem(LAST_USERNAME_KEY) || '';
    } catch (e) {
      return '';
    }
  });
  const updateTweaks = partial => {
    const next = {
      ...tweaks,
      ...partial
    };
    setTweaks(next);
    try {
      window.parent.postMessage({
        type: '__edit_mode_set_keys',
        edits: partial
      }, '*');
    } catch (e) {}
  };
  const rememberUser = React.useCallback(user => {
    const username = user && user.username ? String(user.username).trim() : '';
    setCurrentUser(user || null);
    if (!username) return;
    setLastUsername(username);
    try {
      localStorage.setItem(LAST_USERNAME_KEY, username);
    } catch (e) {}
  }, []);
  const handleComposeComplete = React.useCallback((jobId, penpotEditUrl, directImageUrls, resultTpl, sourceUserId) => {
    if (!sourceUserId || String(sourceUserId) !== currentUserIdRef.current) return;
    const explicitClear = !jobId && !resultTpl && Array.isArray(directImageUrls) && directImageUrls.length === 0;
    const rawUrls = Array.isArray(directImageUrls) ? directImageUrls.filter(Boolean) : directImageUrls ? [directImageUrls] : [];
    const urls = (rawUrls.length ? rawUrls : jobId ? ['/compose/' + encodeURIComponent(jobId) + '/image'] : []).map(normalizeDesignflowAssetUrl).filter(Boolean);
    if (explicitClear) {
      setResultTemplate(null);
      setEditorCommand({
        key: Date.now() + Math.random(),
        type: 'new-canvas',
        pageName: activeTemplate?.name || '画板 1'
      });
      if (penpotEditUrl) {
        window.resultPenpotUrl = penpotEditUrl;
      }
      return;
    }
    if (resultTpl) {
      setResultTemplate(resultTpl);
    } else if (urls.length > 0) {
      setResultTemplate(function (prev) {
        const templateId = jobId || prev && prev.id || 'generated_' + Date.now();
        const sameBatch = !!(prev && prev.id && jobId && prev.id === jobId);
        const nextFrames = urls.map(function (url, i) {
          return {
            id: `${templateId}_${Date.now()}_${i}`,
            resultUrl: url
          };
        });
        if (sameBatch && prev && Array.isArray(prev.frames)) {
          return Object.assign({}, prev, {
            frames: prev.frames.concat(nextFrames)
          });
        }
        return {
          id: templateId,
          name: '生成结果',
          frames: nextFrames
        };
      });
    }
    if (urls.length > 0) {
      setEditorCommand({
        key: Date.now() + Math.random(),
        type: 'insert-images',
        mode: 'image',
        urls,
        name: resultTpl && resultTpl.name || '生成结果'
      });
    }
    if (penpotEditUrl) {
      window.resultPenpotUrl = penpotEditUrl;
    }
  }, [activeTemplate, normalizeDesignflowAssetUrl]);
  React.useEffect(() => {
    setResultTemplate(null);
    setEditorCommand({
      key: Date.now() + Math.random(),
      type: 'new-canvas',
      pageName: activeTemplate?.name || '画板 1'
    });
  }, [activeTemplate]);
  React.useEffect(() => {
    const handler = e => {
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === '__activate_edit_mode') setTweaksVisible(true);
      if (d.type === '__deactivate_edit_mode') setTweaksVisible(false);
    };
    window.addEventListener('message', handler);
    try {
      window.parent.postMessage({
        type: '__edit_mode_available'
      }, '*');
    } catch (e) {}
    return () => window.removeEventListener('message', handler);
  }, []);
  React.useEffect(() => {
    const handleAuthRequired = () => {
      setCurrentUser(null);
      setResultTemplate(null);
      setAuthLoading(false);
      setAuthError('登录状态已失效，请重新输入用户名和密码。');
    };
    window.addEventListener('designflow-auth-required', handleAuthRequired);
    return () => window.removeEventListener('designflow-auth-required', handleAuthRequired);
  }, []);
  React.useEffect(() => {
    const onHashChange = () => setCurrentView(getViewFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  React.useEffect(() => {
    let alive = true;
    window.API.getCurrentUser().then(function (user) {
      if (!alive) return;
      rememberUser(user);
      setAuthError('');
    }).catch(function () {
      if (!alive) return;
      setCurrentUser(null);
    }).finally(function () {
      if (alive) setAuthLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [rememberUser]);
  React.useEffect(() => {
    if (!currentUser) {
      setWhatsNewRelease(null);
      return;
    }
    let alive = true;
    const loader = window.loadWhatsNewRelease;
    if (typeof loader !== 'function') return;
    loader().then(function (release) {
      if (!alive) return;
      if (release && window.shouldShowWhatsNew && window.shouldShowWhatsNew(release)) {
        setWhatsNewRelease(release);
      } else {
        setWhatsNewRelease(null);
      }
    });
    return () => {
      alive = false;
    };
  }, [currentUser]);
  const handleLogin = React.useCallback(async (username, password) => {
    setAuthLoading(true);
    setAuthError('');
    try {
      const user = await window.API.loginLite(username, password);
      rememberUser(user);
      setResultTemplate(null);
      setEditorCommand(null);
    } catch (err) {
      setAuthError(err && err.message ? err.message : '进入失败，请重试');
    } finally {
      setAuthLoading(false);
    }
  }, [rememberUser]);
  const handleSwitchUser = React.useCallback(async () => {
    try {
      await window.API.logout();
    } catch (e) {}
    setCurrentUser(null);
    setResultTemplate(null);
    setEditorCommand(null);
    setAuthError('');
  }, []);
  const selectTemplate = React.useCallback(t => {
    if (!t) return;
    setActiveTemplate(t);
    if (t.is_special_full) setSlashTrigger({
      cmd: '特殊品（完整）',
      key: Date.now()
    });else if (t.is_special) setSlashTrigger({
      cmd: '特殊品',
      key: Date.now()
    });else setSlashTrigger({
      clear: true,
      key: Date.now()
    });
  }, []);
  const handleRequestSpecialTemplate = React.useCallback(kind => {
    const templates = Array.isArray(window.TEMPLATES) ? window.TEMPLATES : [];
    const target = templates.find(function (t) {
      return kind === 'full' ? t.is_special_full : t.is_special && !t.is_special_full;
    });
    if (target) selectTemplate(target);
  }, [selectTemplate]);
  const showAdmin = currentView === 'admin' && currentUser && currentUser.role === 'admin';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    }
  }, !currentUser && /*#__PURE__*/React.createElement(LiteLoginGate, {
    onLogin: handleLogin,
    loading: authLoading,
    error: authError,
    initialName: lastUsername
  }), currentUser && showAdmin && /*#__PURE__*/React.createElement(AdminPage, {
    user: currentUser,
    onBack: () => navigateTo('')
  }), currentUser && !showAdmin && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(TopBar, {
    user: currentUser,
    onSwitchUser: handleSwitchUser,
    currentView: "workbench",
    onNavigate: navigateTo,
    onOpenInspiration: function () {
      setInspirationOpen(function (v) {
        return !v;
      });
    },
    inspirationOpen: inspirationOpen
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      position: 'relative',
      display: 'grid',
      gridTemplateColumns: templatePanelCollapsed ? '0px minmax(0, 1fr) 360px' : '260px minmax(0, 1fr) 360px',
      gridTemplateRows: 'minmax(0, 1fr)',
      minHeight: 0,
      transition: 'grid-template-columns 180ms ease'
    }
  }, /*#__PURE__*/React.createElement(TemplatePanel, {
    key: 'templates:' + currentUser.id,
    activeId: activeTemplate ? (activeTemplate.file_id || '') + ':' + (activeTemplate.group_name || activeTemplate.id) : null,
    onSelect: selectTemplate,
    collapsed: templatePanelCollapsed
  }), /*#__PURE__*/React.createElement("div", {
    onMouseEnter: function () {
      setTemplateRevealHovered(true);
    },
    onMouseLeave: function () {
      setTemplateRevealHovered(false);
    },
    style: {
      position: 'absolute',
      left: templatePanelCollapsed ? 0 : 260,
      top: 0,
      bottom: 0,
      width: 14,
      zIndex: 30,
      pointerEvents: 'auto',
      transition: 'left 180ms ease'
    }
  }, /*#__PURE__*/React.createElement("button", {
    title: templatePanelCollapsed ? '展开模板栏' : '收起模板栏',
    onClick: function () {
      setTemplatePanelCollapsed(function (v) {
        return !v;
      });
    },
    style: {
      position: 'absolute',
      left: 0,
      top: '50%',
      transform: 'translateY(-50%)',
      width: 26,
      height: 76,
      borderRadius: '0 999px 999px 0',
      border: '1px solid rgba(20,22,40,0.28)',
      borderLeft: 'none',
      background: templateRevealHovered ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.54)',
      boxShadow: templateRevealHovered ? '0 10px 28px rgba(20,22,40,0.14), inset 1px 0 0 rgba(20,22,40,0.18)' : '0 4px 14px rgba(20,22,40,0.06)',
      color: 'var(--ink-2)',
      cursor: 'pointer',
      opacity: templateRevealHovered ? 0.7 : 0,
      transition: 'opacity 160ms ease, background 160ms ease, box-shadow 160ms ease',
      backdropFilter: 'blur(10px)',
      display: 'grid',
      placeItems: 'center',
      fontSize: 18,
      fontWeight: 500,
      lineHeight: 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      transform: 'translateX(-1px)',
      opacity: templateRevealHovered ? 0.9 : 0.55
    }
  }, templatePanelCollapsed ? '›' : '‹'))), /*#__PURE__*/React.createElement(Canvas, {
    key: 'canvas:' + currentUser.id,
    template: activeTemplate,
    resultTemplate: resultTemplate,
    editorCommand: editorCommand,
    onUseReferenceImages: handleUseCanvasReferences,
    userId: currentUser.id
  }), /*#__PURE__*/React.createElement(Chat, {
    key: 'chat:' + currentUser.id,
    state: tweaks.chatState,
    template: activeTemplate,
    onComposeComplete: function (jobId, penpotEditUrl, directImageUrls, resultTpl) {
      handleComposeComplete(jobId, penpotEditUrl, directImageUrls, resultTpl, currentUser.id);
    },
    slashTrigger: slashTrigger,
    user: currentUser,
    onRequestSpecialTemplate: handleRequestSpecialTemplate,
    seedPrompt: seedPrompt,
    onSeedConsumed: handleSeedConsumed,
    canvasReferenceSelection: canvasReferenceSelection
  })), inspirationOpen && /*#__PURE__*/React.createElement(InspirationPanel, {
    onClose: function () {
      setInspirationOpen(false);
    },
    onUsePrompt: handleUseInspirationPrompt
  }), /*#__PURE__*/React.createElement(Tweaks, {
    visible: tweaksVisible,
    tweaks: tweaks,
    onChange: updateTweaks,
    onClose: () => setTweaksVisible(false)
  })), currentUser && whatsNewRelease && window.WhatsNewModal && React.createElement(window.WhatsNewModal, {
    release: whatsNewRelease,
    onClose: function () {
      setWhatsNewRelease(null);
    }
  }));
};
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));

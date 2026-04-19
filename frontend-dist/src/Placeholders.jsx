// Striped / gradient placeholder imagery. No hand-drawn illustrations.

const hashHue = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
};

const Stripe = ({ label, ratio = '4/5', tone = 'neutral', seed = 'x', tag }) => {
  const hue = tone === 'accent' ? 275 : tone === 'warm' ? 40 : hashHue(seed);
  const light = tone === 'accent' ? 0.92 : 0.96;
  const light2 = tone === 'accent' ? 0.88 : 0.93;
  return (
    <div style={{
      aspectRatio: ratio,
      position: 'relative',
      borderRadius: 8,
      overflow: 'hidden',
      background: `repeating-linear-gradient(135deg, oklch(${light} 0.02 ${hue}) 0 8px, oklch(${light2} 0.025 ${hue}) 8px 16px)`,
      border: '1px solid var(--line-2)',
    }}>
      {label && (
        <div className="mono" style={{
          position: 'absolute', left: 8, top: 8,
          fontSize: 9, letterSpacing: '0.02em',
          color: `oklch(0.45 0.05 ${hue})`,
          textTransform: 'uppercase',
        }}>{label}</div>
      )}
      {tag && (
        <div style={{
          position: 'absolute', right: 8, bottom: 8,
          fontSize: 10, color: `oklch(0.35 0.05 ${hue})`,
          background: 'rgba(255,255,255,0.85)',
          backdropFilter: 'blur(4px)',
          padding: '2px 6px', borderRadius: 4,
        }}>{tag}</div>
      )}
    </div>
  );
};

const Swatch = ({ color, label }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
    <div style={{ height: 28, borderRadius: 6, background: color, border: '1px solid rgba(0,0,0,0.05)' }}/>
    <div className="mono" style={{ fontSize: 9, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
  </div>
);

window.Stripe = Stripe;
window.Swatch = Swatch;

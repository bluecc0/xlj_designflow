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

// 从后端 TemplateInfo 推导显示用的 cat / ratio / tone / tag
function deriveTemplateMeta(t) {
  if (!t) return {};
  const { width = 400, height = 400, slots = [] } = t;
  const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
  const g = gcd(Math.round(width), Math.round(height)) || 1;
  const ratio = (width / g) + '/' + (height / g);
  const productSlots = (slots || []).filter(function(s) {
    return (s.name || '').replace(/ /g, '').startsWith('slot/product_');
  });
  const uniqGroups = new Set(productSlots.map(function(s) { return (s.name || '').split('/')[1]; })).size;
  return {
    ratio: ratio,
    tone: 'neutral',
    tag: uniqGroups > 0 ? uniqGroups + '格' : ratio,
    cat: 'E-commerce',
  };
}

// 统一将后端返回的扁平画板列表聚合为带 frames 的模板组
function aggregateTemplates(data) {
  if (!Array.isArray(data)) return [];
  const raw = data.map(function(t) {
    return Object.assign({}, t, deriveTemplateMeta(t));
  });

  const groupMap = {};
  const groupOrder = [];
  raw.forEach(function(t) {
    const gname = t.group_name || t.name;
    const gkey = (t.file_id || '') + ':' + gname;
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
        frames: [],
      };
      groupOrder.push(gkey);
    }
    groupMap[gkey].frames.push(t);
    if (t.slots && (!groupMap[gkey].slots || t.slots.length > groupMap[gkey].slots.length)) {
      groupMap[gkey].slots = t.slots;
    }
  });

  return groupOrder.map(function(gkey) { return groupMap[gkey]; });
}

window.Stripe = Stripe;
window.Swatch = Swatch;
window.deriveTemplateMeta = deriveTemplateMeta;
window.aggregateTemplates = aggregateTemplates;

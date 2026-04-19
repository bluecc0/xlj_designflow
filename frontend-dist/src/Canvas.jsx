// Main canvas — now simplified to just show the selected template preview.

const Canvas = ({ template }) => {
  const t = template;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0,
      overflow: 'hidden',
      background: 'var(--panel-2)',
    }}>
      {/* Minimal toolbar */}
      <div style={{
        height: 44, flexShrink: 0,
        borderBottom: '1px solid var(--line)',
        display: 'flex', alignItems: 'center',
        padding: '0 16px', gap: 10,
        background: 'var(--panel)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Template</span>
          <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{t?.name || 'None selected'}</span>
          {t && (
            <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)', padding: '2px 6px', borderRadius: 4, background: 'var(--panel-2)', border: '1px solid var(--line-2)' }}>{t.tag}</span>
          )}
        </div>

        <div style={{ flex: 1 }}/>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--ink-3)' }}>
          <button style={iconBtnStyle} title="Zoom out"><I.close size={12}/></button>
          <span className="mono">100%</span>
          <button style={iconBtnStyle} title="Zoom in"><I.plus size={12}/></button>
          <div style={{ width: 1, height: 16, background: 'var(--line)', margin: '0 4px' }}/>
          <button style={iconBtnStyle} title="Fit"><I.dims size={12}/></button>
        </div>
      </div>

      {/* Canvas stage */}
      <div style={{
        flex: 1, minHeight: 0, overflow: 'hidden',
        position: 'relative',
        background: `
          radial-gradient(circle at 1px 1px, oklch(0.9 0.005 260) 1px, transparent 0)
        `,
        backgroundSize: '20px 20px',
        backgroundColor: 'oklch(0.98 0.003 260)',
      }}>
        {t ? <TemplatePreview t={t}/> : <EmptyCanvas/>}
      </div>
    </div>
  );
};

const iconBtnStyle = {
  width: 24, height: 24, borderRadius: 5,
  display: 'grid', placeItems: 'center',
  color: 'var(--ink-2)',
};

const TemplatePreview = ({ t }) => {
  const stageRef = React.useRef(null);
  const [box, setBox] = React.useState({ w: 560, h: 480 });
  React.useEffect(() => {
    if (!stageRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        setBox({ w: Math.max(200, width - 80), h: Math.max(200, height - 120) });
      }
    });
    ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, []);
  const [w, h] = ratioToSize(t.ratio, box.w, box.h);
  const cat = t.cat;

  return (
    <div ref={stageRef} style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 24 }}>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      <div style={{
        position: 'relative',
        width: w, height: h,
        background: 'var(--panel)',
        borderRadius: 6,
        boxShadow: '0 30px 60px rgba(20,22,40,0.10), 0 4px 14px rgba(20,22,40,0.06), 0 0 0 1px var(--line)',
        overflow: 'hidden',
      }}>
        <Stripe ratio={`${w}/${h}`} tone={t.tone} seed={t.id} label={t.name.split(' ')[0]} tag={t.tag}/>
        {/* ruler handles */}
        <Handles/>
      </div>

      {/* Meta strip */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '6px 12px', borderRadius: 99,
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        boxShadow: 'var(--shadow-1)',
        fontSize: 11,
      }}>
        <span className="mono" style={{ color: 'var(--ink-3)' }}>{cat}</span>
        <span style={{ width: 3, height: 3, borderRadius: 99, background: 'var(--line)' }}/>
        <span className="mono" style={{ color: 'var(--ink-2)' }}>{t.ratio.replace('/', ':')}</span>
        <span style={{ width: 3, height: 3, borderRadius: 99, background: 'var(--line)' }}/>
        <span className="mono" style={{ color: 'var(--ink-2)' }}>1280 × 1600 px</span>
        <span style={{ width: 3, height: 3, borderRadius: 99, background: 'var(--line)' }}/>
        <span style={{ color: 'var(--ink-2)' }}>Ready for chat input →</span>
      </div>
    </div>
    </div>
  );
};

const Handles = () => {
  const corners = [
    { top: -4, left: -4 }, { top: -4, right: -4 },
    { bottom: -4, left: -4 }, { bottom: -4, right: -4 },
  ];
  return (
    <>
      {corners.map((c, i) => (
        <div key={i} style={{
          position: 'absolute', ...c,
          width: 8, height: 8,
          background: 'white',
          border: '1.5px solid var(--accent)',
          borderRadius: 2,
        }}/>
      ))}
    </>
  );
};

const EmptyCanvas = () => (
  <div style={{ textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
    Pick a template from the left rail to begin.
  </div>
);

// Translate ratio to pixel dimensions that fit nicely in the canvas area
const ratioToSize = (ratio, maxW = 560, maxH = 480) => {
  const [a, b] = ratio.split('/').map(Number);
  let w = maxW, h = (b / a) * maxW;
  if (h > maxH) { h = maxH; w = (a / b) * maxH; }
  return [Math.round(w), Math.round(h)];
};

window.Canvas = Canvas;

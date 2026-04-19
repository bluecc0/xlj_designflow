// Left panel — template library, backed by GET /templates

const TEMPLATE_CATS = ['All', 'Social', 'E-commerce', 'Brand', 'Print', 'Web', 'Packaging'];

// Map template name keywords → category (best-effort)
function inferCat(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('social') || n.includes('xiaohongshu') || n.includes('小红书') || n.includes('weibo') || n.includes('微博') || n.includes('story')) return 'Social';
  if (n.includes('product') || n.includes('产品') || n.includes('ecom') || n.includes('detail') || n.includes('主图')) return 'E-commerce';
  if (n.includes('brand') || n.includes('品牌') || n.includes('card')) return 'Brand';
  if (n.includes('print') || n.includes('poster') || n.includes('海报') || n.includes('editorial') || n.includes('catalog')) return 'Print';
  if (n.includes('web') || n.includes('banner') || n.includes('launch')) return 'Web';
  if (n.includes('pack') || n.includes('packaging') || n.includes('label') || n.includes('sticker')) return 'Packaging';
  return 'E-commerce'; // 默认归 E-commerce
}

function inferRatio(w, h) {
  if (!w || !h) return '1/1';
  const g = (a, b) => b === 0 ? a : g(b, a % b);
  const d = g(w, h);
  return `${w / d}/${h / d}`;
}

const TemplateCard = ({ t, active, onClick }) => {
  const [imgError, setImgError] = React.useState(false);
  const ratio = inferRatio(t.width, t.height);
  const tone = inferCat(t.name) === 'Social' ? 'accent' : inferCat(t.name) === 'Brand' ? 'warm' : 'neutral';

  return (
    <button onClick={onClick} style={{
      display: 'block', textAlign: 'left',
      padding: 6, borderRadius: 10,
      border: active ? '1.5px solid var(--accent)' : '1px solid transparent',
      background: active ? 'var(--accent-soft)' : 'transparent',
      transition: 'all 120ms ease',
      position: 'relative',
      width: '100%',
    }}
    onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--panel-2)'; }}
    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = active ? 'var(--accent-soft)' : 'transparent'; }}>

      {/* Thumbnail or fallback stripe */}
      {t.thumbnail_url && !imgError ? (
        <div style={{ aspectRatio: ratio, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--line-2)', position: 'relative' }}>
          <img
            src={t.thumbnail_url}
            alt={t.name}
            onError={() => setImgError(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        </div>
      ) : (
        <Stripe label={t.name.split(' ')[0]} ratio={ratio} tone={tone} seed={t.id} tag={`${t.width}×${t.height}`}/>
      )}

      <div style={{ padding: '6px 2px 2px', display: 'flex', alignItems: 'center', gap: 5 }}>
        <div style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--ink)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
        <span className="mono" style={{ fontSize: 9, color: 'var(--ink-3)', flexShrink: 0 }}>{t.slots?.length || 0} slots</span>
      </div>

      {active && (
        <div style={{
          position: 'absolute', top: 10, right: 10,
          width: 18, height: 18, borderRadius: 99,
          background: 'var(--accent)', color: 'white',
          display: 'grid', placeItems: 'center',
          boxShadow: '0 2px 6px oklch(0.55 0.22 275 / 0.35)',
        }}>
          <I.check size={11} stroke={3}/>
        </div>
      )}
    </button>
  );
};

const TemplatePanel = ({ activeId, onSelect }) => {
  const [cat, setCat] = React.useState('All');
  const [q, setQ] = React.useState('');
  const [templates, setTemplates] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);

  // Load templates from backend
  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    API.fetchTemplates()
      .then(data => { if (alive) { setTemplates(data); setLoading(false); } })
      .catch(e => { if (alive) { setError(e.message); setLoading(false); } });
    return () => { alive = false; };
  }, []);

  const filtered = templates.filter(t => {
    const tcat = inferCat(t.name);
    return (cat === 'All' || tcat === cat) &&
      (!q || t.name.toLowerCase().includes(q.toLowerCase()));
  });

  // Masonry: two columns, distribute by index
  const colA = filtered.filter((_, i) => i % 2 === 0);
  const colB = filtered.filter((_, i) => i % 2 === 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--panel)', borderRight: '1px solid var(--line)' }}>
      {/* Header */}
      <div style={{ padding: '14px 14px 10px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em' }}>Templates</div>
          {/* Refresh button */}
          <button
            onClick={() => {
              setLoading(true); setError(null);
              API.fetchTemplates()
                .then(setTemplates)
                .catch(e => setError(e.message))
                .finally(() => setLoading(false));
            }}
            style={{ padding: 4, borderRadius: 5, color: 'var(--ink-3)' }}
            title="Refresh templates"
          >
            <I.refresh size={12}/>
          </button>
        </div>

        {/* Search */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 7,
          padding: '7px 10px', borderRadius: 7,
          background: 'var(--panel-2)',
          border: '1px solid var(--line-2)',
        }}>
          <I.search size={13} style={{ color: 'var(--ink-3)' }}/>
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="搜索模板…"
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent',
              fontSize: 12, color: 'var(--ink)',
            }}
          />
        </div>
      </div>

      {/* Category chips */}
      <div style={{
        padding: '0 14px 10px',
        display: 'flex', gap: 4, flexShrink: 0,
        overflowX: 'auto', scrollbarWidth: 'none',
      }}>
        {TEMPLATE_CATS.map(c => (
          <button key={c} onClick={() => setCat(c)} style={{
            fontSize: 11, padding: '4px 9px', borderRadius: 99,
            background: cat === c ? 'var(--ink)' : 'transparent',
            color: cat === c ? 'white' : 'var(--ink-2)',
            fontWeight: cat === c ? 500 : 400,
            whiteSpace: 'nowrap',
            border: cat === c ? 'none' : '1px solid var(--line)',
            transition: 'all 120ms',
          }}>{c}</button>
        ))}
      </div>

      {/* Main list area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 10px 14px' }}>
        {loading && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)', fontSize: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 16, height: 16, borderRadius: 99, border: '2px solid var(--line-2)', borderTopColor: 'var(--accent)', animation: 'spin 0.8s linear infinite' }}/>
            Loading templates…
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {error && !loading && (
          <div style={{ padding: '16px 12px', fontSize: 12 }}>
            <div style={{ color: 'oklch(0.55 0.15 25)', fontWeight: 500, marginBottom: 4 }}>Failed to load</div>
            <div style={{ color: 'var(--ink-3)', fontSize: 11, marginBottom: 10, lineHeight: 1.45 }}>{error}</div>
            <button
              onClick={() => {
                setLoading(true); setError(null);
                API.fetchTemplates().then(setTemplates).catch(e => setError(e.message)).finally(() => setLoading(false));
              }}
              style={{ fontSize: 11, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--line)', color: 'var(--ink-2)', background: 'var(--panel)' }}
            >Retry</button>
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)', fontSize: 12 }}>
            {templates.length === 0 ? 'No templates found in Penpot' : `No templates match "${q}"`}
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {colA.map(t => <TemplateCard key={t.id} t={t} active={activeId === t.id} onClick={() => onSelect(t)}/>)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {colB.map(t => <TemplateCard key={t.id} t={t} active={activeId === t.id} onClick={() => onSelect(t)}/>)}
            </div>
          </div>
        )}
      </div>

      {/* Footer — 开发进度入口 */}
      <div style={{
        flexShrink: 0, borderTop: '1px solid var(--line)',
        background: 'var(--panel-2)',
        padding: '8px 10px',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <I.layers size={11} style={{ color: 'var(--ink-3)' }}/>
        <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{templates.length} 个模板</span>
        <div style={{ flex: 1 }}/>
        <a
          href="/ui/PROGRESS.html"
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            fontSize: 11, color: 'var(--ink-2)',
            padding: '4px 8px', borderRadius: 6,
            border: '1px solid var(--line)',
            background: 'var(--panel)',
            textDecoration: 'none',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--panel-2)'}
          onMouseLeave={e => e.currentTarget.style.background = 'var(--panel)'}
        >
          <I.film size={11}/>
          开发进度
        </a>
      </div>
    </div>
  );
};

window.TemplatePanel = TemplatePanel;
// Keep TEMPLATES as empty array for backward compat; app.jsx uses activeTemplate state
window.TEMPLATES = [];

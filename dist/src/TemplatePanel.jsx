const TEMPLATE_CATS = ['All', 'Social', 'E-commerce', 'Brand', 'Print', 'Web', 'Packaging'];

const TEMPLATES = [
  { id: 't1', name: 'Product Hero',      cat: 'E-commerce', ratio: '4/5', tone: 'warm',    tag: '4:5' },
  { id: 't2', name: 'Xiaohongshu Cover', cat: 'Social',     ratio: '3/4', tone: 'accent',  tag: '3:4', pro: true },
  { id: 't3', name: 'Minimal Poster',    cat: 'Print',      ratio: '2/3', tone: 'neutral', tag: 'A3' },
  { id: 't4', name: 'Weibo Banner',      cat: 'Social',     ratio: '16/9',tone: 'neutral', tag: '16:9' },
  { id: 't5', name: 'Packaging Mockup',  cat: 'Packaging',  ratio: '1/1', tone: 'warm',    tag: '1:1' },
  { id: 't6', name: 'Editorial Split',   cat: 'Print',      ratio: '3/4', tone: 'neutral', tag: '3:4' },
  { id: 't7', name: 'Story Vertical',    cat: 'Social',     ratio: '9/16',tone: 'accent',  tag: '9:16' },
  { id: 't8', name: 'Launch Banner',     cat: 'Web',        ratio: '16/9',tone: 'neutral', tag: '16:9' },
  { id: 't9', name: 'Catalog Spread',    cat: 'Print',      ratio: '4/3', tone: 'warm',    tag: '4:3' },
  { id: 't10', name: 'Brand Card',       cat: 'Brand',      ratio: '1/1', tone: 'accent',  tag: '1:1' },
  { id: 't11', name: 'Detail Page',      cat: 'E-commerce', ratio: '3/4', tone: 'neutral', tag: '3:4', pro: true },
  { id: 't12', name: 'Label Sticker',    cat: 'Packaging',  ratio: '1/1', tone: 'warm',    tag: '1:1' },
];

const TemplateCard = ({ t, active, onClick }) => (
  <button onClick={onClick} style={{
    display: 'block', textAlign: 'left',
    padding: 6, borderRadius: 10,
    border: active ? '1.5px solid var(--accent)' : '1px solid transparent',
    background: active ? 'var(--accent-soft)' : 'transparent',
    transition: 'all 120ms ease',
    position: 'relative',
  }}
  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--panel-2)'; }}
  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
    <Stripe label={t.name.split(' ')[0]} ratio={t.ratio} tone={t.tone} seed={t.id} tag={t.tag}/>
    <div style={{ padding: '6px 2px 2px', display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--ink)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
      {t.pro && <span className="mono" style={{ fontSize: 8, color: 'var(--accent-ink)', background: 'var(--accent-soft)', padding: '1px 4px', borderRadius: 3, letterSpacing: '0.04em' }}>PRO</span>}
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

const TemplatePanel = ({ activeId, onSelect }) => {
  const [cat, setCat] = React.useState('All');
  const [q, setQ] = React.useState('');

  const filtered = TEMPLATES.filter(t =>
    (cat === 'All' || t.cat === cat) &&
    (!q || t.name.toLowerCase().includes(q.toLowerCase()))
  );

  // Masonry: two columns, distribute by index
  const colA = filtered.filter((_, i) => i % 2 === 0);
  const colB = filtered.filter((_, i) => i % 2 === 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--panel)', borderRight: '1px solid var(--line)' }}>
      {/* Header */}
      <div style={{ padding: '14px 14px 10px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em' }}>Templates</div>

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
            placeholder="Search templates…"
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent',
              fontSize: 12, color: 'var(--ink)',
            }}
          />
          <kbd className="mono" style={{ fontSize: 9, color: 'var(--ink-3)', padding: '1px 4px', borderRadius: 3, border: '1px solid var(--line)' }}>⌘K</kbd>
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

      {/* Masonry grid */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 10px 14px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {colA.map(t => <TemplateCard key={t.id} t={t} active={activeId === t.id} onClick={() => onSelect(t)}/>)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {colB.map(t => <TemplateCard key={t.id} t={t} active={activeId === t.id} onClick={() => onSelect(t)}/>)}
          </div>
        </div>

        {filtered.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)', fontSize: 12 }}>
            No templates match "{q}"
          </div>
        )}
      </div>

      {/* Status footer */}
      <StatusFooter count={filtered.length}/>
    </div>
  );
};

const StatusFooter = ({ count }) => {
  const [progressOpen, setProgressOpen] = React.useState(false);

  return (
    <div style={{
      flexShrink: 0,
      borderTop: '1px solid var(--line)',
      background: 'var(--panel-2)',
      position: 'relative',
    }}>
      <div style={{
        padding: '8px 10px',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        <button onClick={() => setProgressOpen(o => !o)} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 8px', borderRadius: 6,
          border: '1px solid var(--line)',
          background: 'var(--panel)',
          fontSize: 11, color: 'var(--ink-2)',
        }}>
          <I.film size={11} style={{ color: 'var(--ink-3)' }}/>
          <span style={{ flex: 1, textAlign: 'left' }}>Dev progress</span>
          <span className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)' }}>v0.4.2 · 7/12</span>
          <I.chevronDown size={10} style={{ transform: progressOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms', color: 'var(--ink-3)' }}/>
        </button>

        {progressOpen && <DevProgressPanel/>}
      </div>
    </div>
  );
};

const StatusRow = ({ label, sub, state }) => {
  const stateMap = {
    ok:   { c: 'var(--ok)',   l: 'Connected',    pulse: false },
    warn: { c: 'var(--warn)', l: 'Degraded',      pulse: true  },
    err:  { c: 'oklch(0.6 0.18 25)', l: 'Offline', pulse: true },
  };
  const m = stateMap[state];
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '4px 8px', borderRadius: 6,
      background: 'var(--panel)',
      border: '1px solid var(--line-2)',
      fontSize: 11,
    }}>
      <span style={{ position: 'relative', width: 8, height: 8 }}>
        <span style={{
          position: 'absolute', inset: 0, borderRadius: 99,
          background: m.c,
        }}/>
        {m.pulse && (
          <span style={{
            position: 'absolute', inset: -2, borderRadius: 99,
            background: m.c, opacity: 0.3,
            animation: 'statusPulse 1.6s ease-in-out infinite',
          }}/>
        )}
      </span>
      <span style={{ fontWeight: 500, color: 'var(--ink)' }}>{label}</span>
      <span className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)' }}>{sub}</span>
      <div style={{ flex: 1 }}/>
      <span style={{ fontSize: 10, color: m.c, fontWeight: 500 }}>{m.l}</span>
      <style>{`@keyframes statusPulse { 0%, 100% { transform: scale(1); opacity: 0.3; } 50% { transform: scale(1.8); opacity: 0; } }`}</style>
    </div>
  );
};

const DevProgressPanel = () => {
  const milestones = [
    { k: 'Template ingestion',   pct: 100, done: true  },
    { k: 'Chat command parser',  pct: 100, done: true  },
    { k: 'Generation pipeline',  pct: 72,  done: false },
    { k: 'Export (PNG / PSD)',   pct: 40,  done: false },
    { k: 'Collaboration',        pct: 0,   done: false },
  ];
  return (
    <div style={{
      padding: 10, borderRadius: 7,
      background: 'var(--panel)',
      border: '1px solid var(--line-2)',
      display: 'flex', flexDirection: 'column', gap: 7,
    }}>
      {milestones.map(m => (
        <div key={m.k}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <span style={{
              width: 12, height: 12, borderRadius: 99,
              background: m.done ? 'var(--ok)' : m.pct > 0 ? 'var(--accent)' : 'var(--line)',
              color: 'white', display: 'grid', placeItems: 'center', flexShrink: 0,
            }}>
              {m.done && <I.check size={8} stroke={3.5}/>}
            </span>
            <span style={{ flex: 1, fontSize: 11, color: 'var(--ink-2)' }}>{m.k}</span>
            <span className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)' }}>{m.pct}%</span>
          </div>
          <div style={{ height: 3, borderRadius: 99, background: 'var(--line-2)', overflow: 'hidden', marginLeft: 18 }}>
            <div style={{
              height: '100%', width: `${m.pct}%`,
              background: m.done ? 'var(--ok)' : 'var(--accent)',
              borderRadius: 99,
            }}/>
          </div>
        </div>
      ))}
    </div>
  );
};

window.TemplatePanel = TemplatePanel;
window.TEMPLATES = TEMPLATES;

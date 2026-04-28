// Slash commands, parse table, AI message list — additions to the chat surface.

const SLASH_COMMANDS = [
  { cmd: '/generate',   cn: '开始生图',   desc: 'Generate variations from current parameters', icon: 'zap',     shortcut: '⌘⏎',  group: 'Generation' },
  { cmd: '/regenerate', cn: '重新生成',   desc: 'Re-run the last prompt with a new seed',       icon: 'refresh', group: 'Generation' },
  { cmd: '/upscale',    cn: '放大',       desc: 'Upscale selected option to 2K / 4K',           icon: 'layers',  group: 'Generation' },
  { cmd: '/variations', cn: '出更多版本', desc: 'Produce 4 more variants of the selected one',  icon: 'grid',    group: 'Generation' },

  { cmd: '/analyze',    cn: '分析素材',   desc: 'Parse an uploaded image, brief, or CSV',       icon: 'eye',     group: 'Tools' },
  { cmd: '/palette',    cn: '提取配色',   desc: 'Extract a palette from a reference',            icon: 'palette', group: 'Tools' },
  { cmd: '/resize',     cn: '换尺寸',     desc: 'Reflow the design into a new ratio',            icon: 'dims',    group: 'Tools' },
  { cmd: '/copy',       cn: '换文案',     desc: 'Rewrite on-image copy',                         icon: 'type',    group: 'Tools' },

  { cmd: '/export-png', cn: '导出PNG',    desc: 'Export selected option as PNG',                 icon: 'download', group: 'Export' },
  { cmd: '/export-psd', cn: '导出PSD',    desc: 'Export with editable layers',                   icon: 'download', group: 'Export' },
  { cmd: '/share',      cn: '分享链接',   desc: 'Generate a review link',                        icon: 'share',    group: 'Export' },
];

const SlashMenu = ({ query, onPick, onClose }) => {
  const q = query.toLowerCase().replace(/^\//, '');
  const filtered = SLASH_COMMANDS.filter(c =>
    !q || c.cmd.includes(q) || c.cn.includes(query.replace(/^\//, '')) || c.desc.toLowerCase().includes(q)
  );

  const groups = filtered.reduce((acc, c) => {
    (acc[c.group] ||= []).push(c); return acc;
  }, {});

  const [hover, setHover] = React.useState(0);
  React.useEffect(() => setHover(0), [query]);

  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setHover(h => Math.min(filtered.length - 1, h + 1)); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setHover(h => Math.max(0, h - 1)); }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (filtered[hover]) { e.preventDefault(); onPick(filtered[hover]); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [filtered, hover, onPick, onClose]);

  if (filtered.length === 0) {
    return (
      <div style={slashMenuStyle}>
        <div style={{ padding: 14, fontSize: 12, color: 'var(--ink-3)', textAlign: 'center' }}>
          No command matches "{query}"
        </div>
      </div>
    );
  }

  let idx = -1;
  return (
    <div style={slashMenuStyle}>
      <div style={{
        padding: '8px 12px 6px', fontSize: 10, color: 'var(--ink-3)',
        display: 'flex', alignItems: 'center', gap: 8,
        borderBottom: '1px solid var(--line-2)',
      }} className="mono">
        <span style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>Commands</span>
        <div style={{ flex: 1 }}/>
        <span>↑↓ navigate · ⏎ pick · esc close</span>
      </div>

      <div style={{ maxHeight: 280, overflowY: 'auto', padding: 4 }}>
        {Object.entries(groups).map(([g, items]) => (
          <div key={g}>
            <div className="mono" style={{ padding: '6px 10px 2px', fontSize: 9.5, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{g}</div>
            {items.map(c => {
              idx++;
              const active = idx === hover;
              return (
                <button
                  key={c.cmd}
                  onMouseEnter={((i) => () => setHover(i))(idx)}
                  onClick={() => onPick(c)}
                  style={{
                    width: '100%', textAlign: 'left',
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '7px 10px', borderRadius: 6,
                    background: active ? 'var(--accent-soft)' : 'transparent',
                  }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: 5,
                    background: active ? 'var(--accent)' : 'var(--panel-2)',
                    color: active ? 'white' : 'var(--ink-2)',
                    display: 'grid', placeItems: 'center', flexShrink: 0,
                  }}>
                    {I[c.icon] ? I[c.icon]({ size: 12 }) : <I.bolt size={12}/>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <span className="mono" style={{ fontSize: 11.5, fontWeight: 500, color: active ? 'var(--accent-ink)' : 'var(--ink)' }}>{c.cmd}</span>
                      <span style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{c.cn}</span>
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.desc}</div>
                  </div>
                  {c.shortcut && (
                    <kbd className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)', padding: '1px 5px', borderRadius: 3, border: '1px solid var(--line)' }}>{c.shortcut}</kbd>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

const slashMenuStyle = {
  position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, right: 0,
  background: 'var(--panel)',
  border: '1px solid var(--line)',
  borderRadius: 10,
  boxShadow: '0 8px 32px rgba(20,22,40,0.10), 0 2px 6px rgba(20,22,40,0.04)',
  overflow: 'hidden',
  zIndex: 20,
};

// ---------- Parse table (structured analysis output) ----------

const ParseTable = ({ title, subtitle, rows, source }) => {
  return (
    <div style={{
      width: '100%', borderRadius: 10,
      background: 'var(--panel)', border: '1px solid var(--line-2)',
      overflow: 'hidden',
    }}>
      <div style={{ padding: '9px 12px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 20, height: 20, borderRadius: 5, background: 'var(--accent-soft)', color: 'var(--accent-ink)', display: 'grid', placeItems: 'center' }}>
          <I.file size={11}/>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600 }}>{title}</div>
          {subtitle && <div className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)' }}>{subtitle}</div>}
        </div>
        {source && (
          <div className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)', padding: '2px 6px', borderRadius: 4, background: 'var(--panel-2)', border: '1px solid var(--line-2)' }}>
            {source}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '92px 1fr 54px', fontSize: 11 }}>
        <HeadCell>Field</HeadCell>
        <HeadCell>Value</HeadCell>
        <HeadCell right>Conf.</HeadCell>

        {rows.map((r, i) => (
          <React.Fragment key={i}>
            <Cell top={i > 0}>
              <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{r.field}</span>
            </Cell>
            <Cell top={i > 0}>
              {r.editable ? (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '2px 6px', borderRadius: 4,
                  background: 'var(--panel-2)', border: '1px dashed var(--line)',
                  fontSize: 11, color: 'var(--ink)',
                }}>
                  {r.value}
                  <I.type size={9} style={{ color: 'var(--ink-3)' }}/>
                </span>
              ) : (
                <span style={{ color: 'var(--ink)' }}>{r.value}</span>
              )}
              {r.note && <div style={{ fontSize: 10, color: 'var(--ink-3)', marginTop: 2 }}>{r.note}</div>}
            </Cell>
            <Cell top={i > 0} right>
              <ConfBadge conf={r.conf}/>
            </Cell>
          </React.Fragment>
        ))}
      </div>

      <div style={{
        padding: '8px 12px', borderTop: '1px solid var(--line-2)',
        display: 'flex', alignItems: 'center', gap: 6,
        background: 'var(--panel-2)',
      }}>
        <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>{rows.length} fields parsed</span>
        <div style={{ flex: 1 }}/>
        <button style={ghostBtn}>Edit</button>
        <button style={{ ...ghostBtn, background: 'var(--ink)', color: 'white', border: 'none' }}>
          Apply to design
        </button>
      </div>
    </div>
  );
};

const HeadCell = ({ children, right }) => (
  <div style={{
    padding: '6px 12px',
    fontSize: 9.5, color: 'var(--ink-3)',
    textTransform: 'uppercase', letterSpacing: '0.06em',
    fontFamily: 'JetBrains Mono, monospace',
    borderBottom: '1px solid var(--line-2)',
    background: 'var(--panel-2)',
    textAlign: right ? 'right' : 'left',
  }}>{children}</div>
);

const Cell = ({ children, right, top }) => (
  <div style={{
    padding: '8px 12px',
    borderTop: top ? '1px solid var(--line-2)' : 'none',
    textAlign: right ? 'right' : 'left',
    minWidth: 0,
  }}>{children}</div>
);

const ConfBadge = ({ conf }) => {
  const map = {
    high:   { l: 'High', c: 'var(--ok)',    bg: 'oklch(0.95 0.04 155)' },
    med:    { l: 'Med',  c: 'var(--warn)',  bg: 'oklch(0.96 0.04 70)' },
    low:    { l: 'Low',  c: 'oklch(0.55 0.15 25)', bg: 'oklch(0.95 0.04 25)' },
  }[conf] || { l: '–', c: 'var(--ink-3)', bg: 'var(--panel-2)' };
  return (
    <span style={{
      display: 'inline-block',
      fontSize: 9.5, fontWeight: 500,
      padding: '1px 6px', borderRadius: 99,
      color: map.c, background: map.bg,
    }}>{map.l}</span>
  );
};

const ghostBtn = {
  fontSize: 11, padding: '4px 9px', borderRadius: 5,
  border: '1px solid var(--line)', background: 'var(--panel)',
  color: 'var(--ink-2)',
};

// ---------- AI structured message list ----------

const MessageList = ({ title, items }) => (
  <div style={{
    width: '100%', borderRadius: 10,
    background: 'var(--panel)', border: '1px solid var(--line-2)',
    overflow: 'hidden',
  }}>
    <div style={{ padding: '9px 12px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 7 }}>
      <I.layers size={12} style={{ color: 'var(--ink-2)' }}/>
      <span style={{ fontSize: 11.5, fontWeight: 600 }}>{title}</span>
      <div style={{ flex: 1 }}/>
      <span className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)' }}>{items.length} items</span>
    </div>
    <div>
      {items.map((it, i) => (
        <div key={i} style={{
          padding: '9px 12px',
          borderTop: i > 0 ? '1px solid var(--line-2)' : 'none',
          display: 'flex', gap: 10, alignItems: 'flex-start',
        }}>
          <div style={{
            width: 18, height: 18, borderRadius: 5, flexShrink: 0,
            background: it.kind === 'warn' ? 'oklch(0.96 0.04 70)' : it.kind === 'ok' ? 'oklch(0.95 0.04 155)' : 'var(--accent-soft)',
            color: it.kind === 'warn' ? 'var(--warn)' : it.kind === 'ok' ? 'var(--ok)' : 'var(--accent-ink)',
            display: 'grid', placeItems: 'center',
          }}>
            {it.kind === 'warn' ? <I.bolt size={10}/> : it.kind === 'ok' ? <I.check size={11} stroke={2.4}/> : <I.dot size={10}/>}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--ink)' }}>{it.title}</div>
            {it.body && <div style={{ fontSize: 11, color: 'var(--ink-2)', marginTop: 2, lineHeight: 1.45 }}>{it.body}</div>}
            {it.action && (
              <button style={{
                marginTop: 6, fontSize: 10.5, padding: '3px 8px', borderRadius: 5,
                border: '1px solid var(--line)', color: 'var(--ink-2)', background: 'var(--panel-2)',
              }}>{it.action}</button>
            )}
          </div>
          <span className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)', flexShrink: 0 }}>{String(i + 1).padStart(2, '0')}</span>
        </div>
      ))}
    </div>
  </div>
);

// ---------- Slash command acknowledgement bubble ----------

const CommandEcho = ({ cmd, cn }) => (
  <div style={{
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '4px 9px', borderRadius: 7,
    background: 'oklch(0.28 0.04 275)', color: 'white',
    fontSize: 11.5,
  }}>
    <I.bolt size={11} style={{ color: 'oklch(0.85 0.15 275)' }}/>
    <span className="mono" style={{ fontWeight: 500 }}>{cmd}</span>
    <span style={{ color: 'oklch(0.75 0.04 275)' }}>{cn}</span>
  </div>
);

window.SlashMenu = SlashMenu;
window.SLASH_COMMANDS = SLASH_COMMANDS;
window.ParseTable = ParseTable;
window.MessageList = MessageList;
window.CommandEcho = CommandEcho;

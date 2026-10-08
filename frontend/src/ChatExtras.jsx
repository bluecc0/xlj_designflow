// Parse table, AI message list — additions to the chat surface.

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

window.ParseTable = ParseTable;
window.MessageList = MessageList;

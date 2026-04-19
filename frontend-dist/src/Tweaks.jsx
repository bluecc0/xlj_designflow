// Tweaks panel — toggle between chat/canvas states

const Tweaks = ({ visible, tweaks, onChange, onClose }) => {
  if (!visible) return null;
  return (
    <div style={{
      position: 'fixed', bottom: 16, right: 16, zIndex: 50,
      width: 260, borderRadius: 12,
      background: 'var(--panel)',
      border: '1px solid var(--line)',
      boxShadow: '0 10px 40px rgba(20,22,40,0.14), 0 2px 8px rgba(20,22,40,0.05)',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '10px 12px',
        display: 'flex', alignItems: 'center', gap: 8,
        borderBottom: '1px solid var(--line-2)',
      }}>
        <I.settings size={13} style={{ color: 'var(--ink-2)' }}/>
        <div style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>Tweaks</div>
        <button onClick={onClose} style={{ padding: 3, color: 'var(--ink-3)', borderRadius: 4 }}>
          <I.close size={12}/>
        </button>
      </div>
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <TweakRow
          label="Chat state"
          sub="Empty · Generating · Returned"
          value={tweaks.chatState}
          options={[
            { k: 'empty', l: 'Empty' },
            { k: 'generating', l: 'Generating' },
            { k: 'returned', l: 'Returned' },
          ]}
          onChange={(v) => onChange({ chatState: v })}
        />
      </div>
      <div style={{
        padding: '8px 12px', borderTop: '1px solid var(--line-2)',
        fontSize: 10, color: 'var(--ink-3)',
      }} className="mono">
        Changes persist via host
      </div>
    </div>
  );
};

const TweakRow = ({ label, sub, value, options, onChange }) => (
  <div>
    <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--ink)', marginBottom: 2 }}>{label}</div>
    {sub && <div className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)', marginBottom: 6 }}>{sub}</div>}
    <div style={{ display: 'flex', background: 'var(--panel-2)', borderRadius: 6, padding: 2, border: '1px solid var(--line-2)' }}>
      {options.map(o => (
        <button key={o.k} onClick={() => onChange(o.k)} style={{
          flex: 1, fontSize: 11, padding: '5px 6px', borderRadius: 4,
          background: value === o.k ? 'var(--panel)' : 'transparent',
          color: value === o.k ? 'var(--ink)' : 'var(--ink-3)',
          fontWeight: value === o.k ? 500 : 400,
          boxShadow: value === o.k ? 'var(--shadow-1)' : 'none',
        }}>{o.l}</button>
      ))}
    </div>
  </div>
);

window.Tweaks = Tweaks;

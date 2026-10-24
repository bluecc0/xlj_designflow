// Global feedback overlays: toast, confirm dialog, image lightbox.
// Usage: window.dfToast(msg, { tone }), await window.dfConfirm({ title, message, danger }),
//        window.dfOpenLightbox({ src, downloadUrl, title, actions })

var overlayState = { toasts: [], confirm: null, lightbox: null };
var overlayListeners = [];
var toastSeq = 0;

function setOverlayState(patch) {
  overlayState = Object.assign({}, overlayState, patch);
  overlayListeners.forEach(function(fn) { fn(overlayState); });
}

function dismissToast(id) {
  setOverlayState({ toasts: overlayState.toasts.filter(function(t) { return t.id !== id; }) });
}

window.dfToast = function(message, opts) {
  opts = opts || {};
  var tone = opts.tone || 'info';
  var id = ++toastSeq;
  var duration = opts.duration || (tone === 'danger' ? 6000 : 3200);
  setOverlayState({ toasts: overlayState.toasts.concat([{ id: id, message: String(message || ''), tone: tone }]).slice(-4) });
  setTimeout(function() { dismissToast(id); }, duration);
};

window.dfConfirm = function(opts) {
  opts = typeof opts === 'string' ? { message: opts } : (opts || {});
  if (overlayState.confirm) overlayState.confirm.resolve(false);
  return new Promise(function(resolve) {
    setOverlayState({ confirm: Object.assign({}, opts, { resolve: resolve }) });
  });
};

window.dfOpenLightbox = function(opts) {
  if (!opts || !opts.src) return;
  setOverlayState({ lightbox: opts });
};

const TOAST_TONES = {
  info: { dot: 'var(--ink-3)' },
  ok: { dot: 'var(--ok)' },
  warn: { dot: 'var(--warn)' },
  danger: { dot: 'var(--danger)' },
};

const overlayBtn = function(primary, danger) {
  return {
    height: 32, padding: '0 14px', borderRadius: 8, fontSize: 12, fontWeight: primary ? 600 : 400,
    border: '1px solid ' + (primary ? (danger ? 'var(--danger)' : 'var(--ink)') : 'var(--line)'),
    background: primary ? (danger ? 'var(--danger)' : 'var(--ink)') : 'var(--panel)',
    color: primary ? 'white' : 'var(--ink-2)',
    display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', textDecoration: 'none',
  };
};

const ConfirmDialog = ({ confirm }) => {
  const okRef = React.useRef(null);
  const close = React.useCallback(function(result) {
    confirm.resolve(result);
    setOverlayState({ confirm: null });
  }, [confirm]);
  React.useEffect(function() {
    if (okRef.current) okRef.current.focus();
    const onKey = function(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
    };
    window.addEventListener('keydown', onKey);
    return function() { window.removeEventListener('keydown', onKey); };
  }, [close]);
  return (
    <div onMouseDown={function(e) { if (e.target === e.currentTarget) close(false); }} style={{
      position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(15,23,42,0.24)',
      display: 'grid', placeItems: 'center',
    }}>
      <div role="alertdialog" aria-modal="true" style={{
        width: 360, maxWidth: 'calc(100vw - 32px)', borderRadius: 14, padding: 18,
        background: 'var(--panel)', border: '1px solid var(--line-2)',
        boxShadow: '0 18px 50px rgba(15,23,42,0.18)', display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{confirm.title || '请确认'}</div>
        {confirm.message && <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.6, whiteSpace: 'pre-line' }}>{confirm.message}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
          <button type="button" onClick={function() { close(false); }} style={overlayBtn(false)}>{confirm.cancelText || '取消'}</button>
          <button type="button" ref={okRef} onClick={function() { close(true); }} style={overlayBtn(true, confirm.danger)}>{confirm.confirmText || '确定'}</button>
        </div>
      </div>
    </div>
  );
};

const Lightbox = ({ box, onInsertToCanvas, onUseAsReference }) => {
  const close = function() { setOverlayState({ lightbox: null }); };
  React.useEffect(function() {
    const onKey = function(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    window.addEventListener('keydown', onKey);
    return function() { window.removeEventListener('keydown', onKey); };
  }, []);
  const fullUrl = box.downloadUrl || box.src;
  // 先用传入的缩略图占位，原图加载完成后替换；原图失败则保留缩略图
  const hasPreview = !!box.src && box.src !== fullUrl;
  const [fullState, setFullState] = React.useState('loading');
  React.useEffect(function() { setFullState('loading'); }, [fullUrl]);
  const showFull = fullState === 'loaded' || !hasPreview;
  const run = function(fn) { return function() { close(); fn(); }; };
  const actions = [];
  if (onInsertToCanvas) actions.push({ label: '放入画布', icon: I.layers, onClick: function() { onInsertToCanvas(fullUrl, box.title); } });
  if (onUseAsReference) actions.push({ label: '作为参考图', icon: I.image, onClick: function() { onUseAsReference(fullUrl, box.title); } });
  (box.actions || []).forEach(function(a) { actions.push(a); });
  return (
    <div onMouseDown={function(e) { if (e.target === e.currentTarget) close(); }} style={{
      position: 'fixed', inset: 0, zIndex: 350, background: 'rgba(10,12,20,0.78)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24,
    }}>
      <button type="button" onClick={close} aria-label="关闭预览" title="关闭（Esc）" style={{
        position: 'absolute', top: 16, right: 16, width: 34, height: 34, borderRadius: 10,
        background: 'rgba(255,255,255,0.12)', color: 'white', display: 'grid', placeItems: 'center',
      }}><I.close size={14}/></button>
      <img src={fullUrl} alt={box.title || '预览'}
        onLoad={function() { setFullState('loaded'); }}
        onError={function() { setFullState('failed'); }}
        style={{
          display: showFull ? 'block' : 'none',
          maxWidth: '100%', maxHeight: 'calc(100vh - 140px)', objectFit: 'contain', borderRadius: 8,
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)', background: 'white',
        }}/>
      {!showFull && (
        <img src={box.src} alt={box.title || '预览'} style={{
          maxWidth: '100%', maxHeight: 'calc(100vh - 140px)', objectFit: 'contain', borderRadius: 8,
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)', background: 'white',
        }}/>
      )}
      {hasPreview && fullState !== 'loaded' && (
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.72)' }}>
          {fullState === 'failed' ? '原图加载失败，当前显示的是缩略图' : '正在加载原图…'}
        </div>
      )}
      {box.title && <div style={{ maxWidth: 640, fontSize: 12, color: 'rgba(255,255,255,0.72)', textAlign: 'center', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{box.title}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        <a href={fullUrl} download style={overlayBtn(true)}><I.download size={12}/>下载</a>
        {actions.map(function(a) {
          const Icon = a.icon;
          return <button key={a.label} type="button" onClick={run(a.onClick)} style={overlayBtn(false)}>{Icon && <Icon size={12}/>}{a.label}</button>;
        })}
        <a href={fullUrl} target="_blank" rel="noopener" style={overlayBtn(false)}><I.externalLink size={12}/>新标签打开</a>
      </div>
    </div>
  );
};

const OverlayHost = ({ onInsertToCanvas, onUseAsReference }) => {
  const [state, setState] = React.useState(overlayState);
  React.useEffect(function() {
    overlayListeners.push(setState);
    return function() { overlayListeners = overlayListeners.filter(function(fn) { return fn !== setState; }); };
  }, []);
  return (
    <>
      {state.toasts.length > 0 && (
        <div role="status" aria-live="polite" style={{
          position: 'fixed', top: 58, left: '50%', transform: 'translateX(-50%)', zIndex: 420,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, pointerEvents: 'none',
        }}>
          {state.toasts.map(function(t) {
            return (
              <div key={t.id} style={{
                pointerEvents: 'auto', display: 'flex', alignItems: 'flex-start', gap: 8, maxWidth: 'min(460px, calc(100vw - 32px))',
                padding: '9px 10px 9px 14px', borderRadius: 12, background: 'var(--panel)', color: 'var(--ink)',
                border: '1px solid ' + (t.tone === 'danger' ? 'var(--danger-line)' : 'var(--line)'),
                boxShadow: '0 6px 22px rgba(0,0,0,0.10)', fontSize: 12, lineHeight: 1.5,
                animation: 'dfToastIn 160ms ease-out',
              }}>
                <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 99, marginTop: 7, flexShrink: 0, background: (TOAST_TONES[t.tone] || TOAST_TONES.info).dot }}/>
                <span style={{ flex: 1, whiteSpace: 'pre-line', wordBreak: 'break-word' }}>{t.message}</span>
                <button type="button" aria-label="关闭提示" onClick={function() { dismissToast(t.id); }} style={{ width: 20, height: 20, borderRadius: 6, color: 'var(--ink-3)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><I.close size={10}/></button>
              </div>
            );
          })}
        </div>
      )}
      {state.confirm && <ConfirmDialog confirm={state.confirm}/>}
      {state.lightbox && <Lightbox box={state.lightbox} onInsertToCanvas={onInsertToCanvas} onUseAsReference={onUseAsReference}/>}
      <style>{`@keyframes dfToastIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }`}</style>
    </>
  );
};

window.OverlayHost = OverlayHost;

// Confirmation dialogs and image previews. Lightweight notifications live in feedback.js.
// Usage: window.dfToast(msg, { tone }), await window.dfConfirm({ title, message, danger }),
//        window.dfOpenLightbox({ src, downloadUrl, title, actions })
//        同一批次多张图：window.dfOpenLightbox({ items: [{ src, downloadUrl, title }], index })

var overlayState = { confirm: null, lightbox: null };
var overlayListeners = [];
var lightboxLoaded = new Set(); // 已加载过的原图，切换回来时直接显示，不再经过缩略图

function setOverlayState(patch) {
  overlayState = Object.assign({}, overlayState, patch);
  overlayListeners.forEach(function(fn) { fn(overlayState); });
}

window.dfConfirm = function(opts) {
  opts = typeof opts === 'string' ? { message: opts } : (opts || {});
  if (overlayState.confirm) overlayState.confirm.resolve(false);
  return new Promise(function(resolve) {
    setOverlayState({ confirm: Object.assign({}, opts, { resolve: resolve }) });
  });
};

window.dfOpenLightbox = function(opts) {
  if (!opts || !(opts.src || (opts.items && opts.items.length))) return;
  setOverlayState({ lightbox: opts });
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
  const items = box.items && box.items.length ? box.items : [box];
  const count = items.length;
  const [index, setIndex] = React.useState(Math.min(Math.max(box.index || 0, 0), count - 1));
  const [fullState, setFullState] = React.useState({ url: '', status: 'loading' });
  const go = function(step) {
    if (count < 2) return;
    setIndex(function(i) { return (i + step + count) % count; });
  };
  React.useEffect(function() {
    const onKey = function(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    };
    window.addEventListener('keydown', onKey);
    return function() { window.removeEventListener('keydown', onKey); };
  }, [count]);
  const touchRef = React.useRef(null);
  const onTouchStart = function(e) { const t = e.touches[0]; touchRef.current = { x: t.clientX, y: t.clientY }; };
  const onTouchEnd = function(e) {
    const start = touchRef.current;
    touchRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(t.clientY - start.y)) go(dx < 0 ? 1 : -1);
  };
  const cur = items[index];
  const fullUrl = cur.downloadUrl || cur.src;
  // 先用传入的缩略图占位，原图加载完成后替换；原图失败则保留缩略图
  const hasPreview = !!cur.src && cur.src !== fullUrl;
  const fullStatus = fullState.url === fullUrl ? fullState.status : (lightboxLoaded.has(fullUrl) ? 'loaded' : 'loading');
  const showFull = fullStatus === 'loaded' || !hasPreview;
  // 预加载前后两张原图，切换时直接显示
  React.useEffect(function() {
    if (count < 2) return;
    [index - 1, index + 1].forEach(function(i) {
      const it = items[(i + count) % count];
      const url = it.downloadUrl || it.src;
      if (lightboxLoaded.has(url)) return;
      const img = new Image();
      img.onload = function() { lightboxLoaded.add(url); };
      img.src = url;
    });
  }, [index, count]);
  const run = function(fn) { return function() { close(); fn(); }; };
  const actions = [];
  if (onInsertToCanvas) actions.push({ label: '放入画布', icon: I.layers, onClick: function() { onInsertToCanvas(fullUrl, cur.title); } });
  if (onUseAsReference) actions.push({ label: '作为参考图', icon: I.image, onClick: function() { onUseAsReference(fullUrl, cur.title); } });
  (box.actions || []).forEach(function(a) { actions.push(a); });
  const navBtn = function(side) {
    return {
      position: 'absolute', top: '50%', [side]: 16, transform: 'translateY(-50%)', width: 40, height: 40, borderRadius: 99,
      background: 'rgba(255,255,255,0.14)', color: 'white', display: 'grid', placeItems: 'center', cursor: 'pointer',
    };
  };
  return (
    <div onMouseDown={function(e) { if (e.target === e.currentTarget) close(); }} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} style={{
      position: 'fixed', inset: 0, zIndex: 350, background: 'rgba(10,12,20,0.78)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: count > 1 ? '56px 64px 24px' : 24,
    }}>
      <button type="button" onClick={close} aria-label="关闭预览" title="关闭（Esc）" style={{
        position: 'absolute', top: 16, right: 16, width: 34, height: 34, borderRadius: 10,
        background: 'rgba(255,255,255,0.12)', color: 'white', display: 'grid', placeItems: 'center',
      }}><I.close size={14}/></button>
      {count > 1 && (
        <div className="mono" style={{ position: 'absolute', top: 24, left: '50%', transform: 'translateX(-50%)', fontSize: 12, color: 'rgba(255,255,255,0.85)' }}>
          {'第 ' + (index + 1) + ' 张 / 共 ' + count + ' 张'}
        </div>
      )}
      {count > 1 && (
        <button type="button" onClick={function() { go(-1); }} aria-label="上一张" title="上一张（←）" style={navBtn('left')}>
          <span style={{ display: 'grid', transform: 'scaleX(-1)' }}><I.chevronRight size={18}/></span>
        </button>
      )}
      {count > 1 && (
        <button type="button" onClick={function() { go(1); }} aria-label="下一张" title="下一张（→）" style={navBtn('right')}>
          <I.chevronRight size={18}/>
        </button>
      )}
      <img src={fullUrl} alt={cur.title || '预览'}
        onLoad={function() { lightboxLoaded.add(fullUrl); setFullState({ url: fullUrl, status: 'loaded' }); }}
        onError={function() { setFullState({ url: fullUrl, status: 'failed' }); window.dfError('原图加载失败，当前显示的是缩略图，请稍后重新打开。'); }}
        style={{
          display: showFull ? 'block' : 'none',
          maxWidth: '100%', maxHeight: 'calc(100vh - 140px)', objectFit: 'contain', borderRadius: 8,
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)', background: 'white',
        }}/>
      {!showFull && (
        <img src={cur.src} alt={cur.title || '预览'} style={{
          maxWidth: '100%', maxHeight: 'calc(100vh - 140px)', objectFit: 'contain', borderRadius: 8,
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)', background: 'white',
        }}/>
      )}
      {hasPreview && fullStatus !== 'loaded' && (
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.72)' }}>
          {fullStatus === 'failed' ? '缩略图预览' : '正在加载原图…'}
        </div>
      )}
      {cur.title && <div style={{ maxWidth: 640, fontSize: 12, color: 'rgba(255,255,255,0.72)', textAlign: 'center', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{cur.title}</div>}
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
      {state.confirm && <ConfirmDialog confirm={state.confirm}/>}
      {state.lightbox && <Lightbox box={state.lightbox} onInsertToCanvas={onInsertToCanvas} onUseAsReference={onUseAsReference}/>}
    </>
  );
};

window.OverlayHost = OverlayHost;

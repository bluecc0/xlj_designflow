// Main canvas — now simplified to just show the selected template preview.

const Canvas = ({ template, resultTemplate, editorCommand, onUseReferenceImages, userId }) => {
  const t = template;
  const hasResult = resultTemplate != null;
  const iframeRef = React.useRef(null);
  const editorReadyRef = React.useRef(false);
  const pendingMessageRef = React.useRef(null);
  const [iframeNonce, setIframeNonce] = React.useState(0);
  const [editorInsertState, setEditorInsertState] = React.useState(null);

  // 清除 URL 中的历史遗留参数与 localStorage 残留
  React.useEffect(() => {
    try {
      localStorage.removeItem('designflow_canvas_engine');
      const url = new URL(window.location.href);
      if (url.searchParams.has('canvas')) {
        url.searchParams.delete('canvas');
        const cleanPath = url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : '') + url.hash;
        window.history.replaceState({}, '', cleanPath);
      }
    } catch (e) {}
  }, []);

  const editorSrc = React.useMemo(() => {
    const params = new URLSearchParams({ v: String(Date.now()) });
    if (userId) params.set('user_id', String(userId));
    return `/editor-canvas/index.html?${params.toString()}`;
  }, [userId]);

  const postToEditor = React.useCallback((message) => {
    const win = iframeRef.current && iframeRef.current.contentWindow;
    if (!win) return false;
    win.postMessage(message, '*');
    return true;
  }, []);

  const markEditorReady = React.useCallback(() => {
    editorReadyRef.current = true;
    if (pendingMessageRef.current) {
      postToEditor(pendingMessageRef.current);
      pendingMessageRef.current = null;
    }
  }, [postToEditor]);

  // 接收编辑器的 ready 信号，用于命令就绪判定（不控制 UI 可见性）
  React.useEffect(() => {
    const handleMessage = (event) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'designflow:editor-ready') {
        markEditorReady();
      } else if (data.type === 'designflow:editor-inserted') {
        setEditorInsertState({ status: 'done', message: '已放入画布' });
      } else if (data.type === 'designflow:editor-error') {
        setEditorInsertState({ status: 'failed', message: data.message || '放入画布失败' });
      } else if (data.type === 'designflow:use-as-reference') {
        const images = Array.isArray(data.images) ? data.images.filter(function(item) {
          return item && typeof item.src === 'string' && item.src.trim();
        }) : [];
        if (onUseReferenceImages) {
          onUseReferenceImages(images);
        }
      }
    };
    window.addEventListener('message', handleMessage);

    // 主动 ping iframe，解决缓存加载时序导致的 ready 消息丢失
    let pingCount = 0;
    const ping = () => {
      pingCount++;
      postToEditor({ type: 'designflow:ping' });
      if (pingCount < 30 && !editorReadyRef.current) {
        setTimeout(ping, 400);
      }
    };
    setTimeout(ping, 200);

    return () => window.removeEventListener('message', handleMessage);
  }, [markEditorReady, onUseReferenceImages, postToEditor]);

  React.useEffect(() => {
    editorReadyRef.current = false;
  }, [iframeNonce, t && t.id]);

  React.useEffect(() => {
    if (!editorCommand) return;
    const normalizeAssetUrl = (rawUrl) => {
      const value = String(rawUrl || '').trim();
      if (!value) return '';
      const publicPrefixes = ['/ai-images/', '/results/', '/output/', '/avatars/'];
      const isPublicPath = (pathname) => publicPrefixes.some(prefix => pathname.startsWith(prefix))
        || /^\/compose\/[^/]+\/image\/?$/.test(pathname)
        || pathname.startsWith('/export/grid/');
      try {
        const parsed = new URL(value, window.location.origin);
        if (isPublicPath(parsed.pathname)) {
          return parsed.pathname + parsed.search + parsed.hash;
        }
        return parsed.toString();
      } catch (e) {
        return value;
      }
    };
    const message = editorCommand.type === 'insert-images'
      ? {
          type: 'designflow:insert-image',
          urls: (editorCommand.urls || []).map(normalizeAssetUrl).filter(Boolean),
          mode: editorCommand.mode,
          name: editorCommand.name,
        }
      : {
          type: 'designflow:new-canvas',
          pageName: editorCommand.pageName || t?.name || '画板 1',
        };

    if (editorCommand.type === 'insert-images') {
      setEditorInsertState({ status: 'running', message: '正在放入画布' });
    }

    if (editorReadyRef.current) {
      postToEditor(message);
    } else {
      pendingMessageRef.current = message;
      postToEditor({ type: 'designflow:ping' });
    }

    if (editorCommand.type === 'insert-images') {
      const timer = setTimeout(() => {
        setEditorInsertState((prev) => {
          if (!prev || prev.status !== 'running') return prev;
          return { status: 'failed', message: '放入画布超时，请刷新后重试' };
        });
      }, 60000);
      return () => clearTimeout(timer);
    }
  }, [editorCommand, postToEditor, t]);

  return (
    <div
      id="designflow-canvas-container"
      style={{
        position: 'relative',
        minWidth: 0,
        minHeight: 0,
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: 'oklch(0.98 0.003 260)',
      }}
    >
      <iframe
        key={iframeNonce}
        ref={iframeRef}
        src={editorSrc}
        title="Designflow Editor"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          border: 'none',
          background: 'transparent',
        }}
      />
    </div>
  );
};

const canvasActionPrimaryStyle = {
  fontSize: 12,
  padding: '6px 14px',
  borderRadius: 6,
  background: 'var(--ink)',
  color: 'white',
  border: '1px solid var(--ink)',
  cursor: 'pointer',
};

const canvasActionSecondaryStyle = {
  fontSize: 12,
  padding: '6px 14px',
  borderRadius: 6,
  background: 'var(--panel)',
  color: 'var(--ink)',
  border: '1px solid var(--line)',
  cursor: 'pointer',
};

// 结果展示：用 TemplatePreview 相同的 FrameThumb 布局渲染（结果看起来和模板预览完全一致）
const ResultPreview = ({ t }) => {
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

  // 多画板：frames 数组；单画板：frames 为空，用 t 本身
  const frames = (t.frames && t.frames.length > 0) ? t.frames : [t];
  const isMulti = frames.length > 1;
  const perMaxW = isMulti ? Math.floor((box.w - (frames.length - 1) * 24) / frames.length) : box.w;
  const perMaxH = isMulti ? box.h - 60 : box.h - 40;
  const cat = t.cat;

  return (
    <div ref={stageRef} style={{ position: 'absolute', inset: 0, overflow: isMulti ? 'auto' : 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      {/* 画板区：与 TemplatePreview 完全一致的布局 */}
      <div style={{ display: 'flex', flexDirection: 'row', gap: 24, alignItems: 'flex-end', flexWrap: 'wrap', justifyContent: 'center' }}>
        {frames.map((frame, i) => {
          const variantLabel = frame.variant || (isMulti ? frame.name : '');
          // 用 resultUrl 替代 thumbnail
          const resultUrl = frame.resultUrl;
          return React.createElement(FrameThumb, {
            key: frame.id,
            frame: Object.assign({}, frame, {
              ratio: frame.ratio || (frame.width && frame.height ? (frame.width + '/' + frame.height) : (t.ratio || '1/1')),
              file_id: frame.file_id || t.file_id,
            }),
            maxW: perMaxW,
            maxH: perMaxH,
            label: variantLabel,
            hd: false,
            resultUrl,  // 传给 FrameThumb：直接用结果 URL
          });
        })}
      </div>

      {/* 操作栏 */}
        <div style={{
          display: 'flex', gap: 8, padding: '8px 12px',
          background: 'rgba(255,255,255,0.95)',
          borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          flexWrap: 'wrap', justifyContent: 'center',
        }}>
        {window.lastComposeJobId && (
          <button
            onClick={() => {
              const names = (t._frameNames || frames.map(f => f.name || f.variant || '')).join(',');
              const ep = window.lastComposeEndpoint || '/special-compose';
              window.open(`${ep}/${window.lastComposeJobId}/download-zip?names=${encodeURIComponent(names)}`, '_blank');
            }}
            style={canvasActionPrimaryStyle}
          >
            打包下载
          </button>
        )}
        {window.resultPenpotUrl && (
          <button
            onClick={() => window.open(window.resultPenpotUrl, '_blank')}
            style={canvasActionSecondaryStyle}
          >
            在Penpot中编辑
          </button>
        )}
      </div>
    </div>
    </div>
  );
};

// Translate ratio to pixel dimensions that fit nicely in the canvas area
const ratioToSize = (ratio, maxW, maxH) => {
  maxW = maxW || 560; maxH = maxH || 480;
  const [a, b] = ratio.split('/').map(Number);
  let w = maxW, h = (b / a) * maxW;
  if (h > maxH) { h = maxH; w = (a / b) * maxH; }
  return [Math.round(w), Math.round(h)];
};

// 从 API base url 推导 Penpot view URL
const getPenpotViewUrl = (fileId, pageId, frameId) => {
  // Penpot view-only 路由：/#/view/file-id/page-id?frame-id=xxx
  const base = (window.API && window.API.BASE) || window.location.origin;
  // Penpot 默认跑在 9001，API 跑在 8000，尝试从 hostname 拼出 penpot 地址
  let penpotOrigin;
  try {
    const u = new URL(base);
    penpotOrigin = u.protocol + '//' + u.hostname + ':9001';
  } catch(e) {
    penpotOrigin = window.location.protocol + '//' + window.location.hostname + ':9001';
  }
  return `${penpotOrigin}/#/view/${fileId}/${pageId}?frame-id=${frameId}&section=interactions&index=0`;
};

// 单个画板的预览卡片（主画布用 iframe 高清预览，缩略图模式用 img）
// resultUrl 存在时直接用该 URL（已缓存的结果图），不再调 API
const FrameThumb = ({ frame, maxW, maxH, label, hd = false, resultUrl = null }) => {
  const ratio = frame.ratio || (frame.width && frame.height ? (frame.width + '/' + frame.height) : '1/1');
  const [w, h] = ratioToSize(ratio, maxW, maxH);

  // hd 模式：嵌入 Penpot view iframe
  const [iframeReady, setIframeReady] = React.useState(false);
  const viewUrl = hd ? getPenpotViewUrl(frame.file_id, frame.page_id, frame.id) : null;

  // 非 hd：resultUrl 直接用；否则调 API 取缩略图
  const [src, setSrc] = React.useState(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    if (hd) return;
    setSrc(null); setFailed(false);
    if (resultUrl) {
      setSrc(resultUrl);
    } else {
      setSrc(window.API.getTemplateThumbnailUrl(frame.id, frame.page_id, frame.file_id));
    }
  }, [frame.id, frame.page_id, frame.file_id, hd, resultUrl]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div style={{
        position: 'relative', width: w, height: h,
        background: 'white', borderRadius: 6,
        boxShadow: '0 30px 60px rgba(20,22,40,0.10), 0 4px 14px rgba(20,22,40,0.06), 0 0 0 1px var(--line)',
        overflow: 'hidden',
      }}>
        {hd ? (
          <>
            {!iframeReady && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--ink-3)', fontSize: 11 }}>
                <div style={{ width: 20, height: 20, borderRadius: 99, border: '2px solid var(--line)', borderTopColor: 'var(--accent)', animation: 'spin 0.8s linear infinite' }}/>
                <span>加载预览…</span>
              </div>
            )}
            <iframe
              src={viewUrl}
              style={{ width: '100%', height: '100%', border: 'none', display: iframeReady ? 'block' : 'none' }}
              onLoad={() => setIframeReady(true)}
              title={label || frame.name}
              sandbox="allow-scripts allow-same-origin"
            />
          </>
        ) : (
          src && !failed
            ? React.createElement('img', { src, alt: label, style: { width: '100%', height: '100%', objectFit: 'contain', background: 'white' }, onError: () => setFailed(true) })
            : React.createElement(Stripe, { ratio: w + '/' + h, tone: 'neutral', seed: frame.id, label: label, tag: ratio.replace('/', ':') })
        )}
        {!hd && <Handles/>}
      </div>
      {label && (
        <div className="mono" style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {label}
        </div>
      )}
    </div>
  );
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

  // 多画板：frames 数组；单画板：frames 为空，用 t 本身
  const frames = (t.frames && t.frames.length > 0) ? t.frames : [t];
  const isMulti = frames.length > 1;

  // 每个画板的最大尺寸：多画板时按数量缩小
  const perMaxW = isMulti ? Math.floor((box.w - (frames.length - 1) * 24) / frames.length) : box.w;
  const perMaxH = isMulti ? box.h - 60 : box.h - 40;

  const cat = t.cat;

  return (
    <div ref={stageRef} style={{ position: 'absolute', inset: 0, overflow: isMulti ? 'auto' : 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      {/* 画板区：单画板居中，多画板横排 */}
      <div style={{ display: 'flex', flexDirection: 'row', gap: 24, alignItems: 'flex-end', flexWrap: 'wrap', justifyContent: 'center' }}>
        {frames.map((frame, i) => {
          const variantLabel = frame.variant || (isMulti ? frame.name : '');
          return React.createElement(FrameThumb, {
            key: frame.id,
            frame: Object.assign({}, frame, {
              ratio: frame.ratio || (frame.width && frame.height ? (frame.width + '/' + frame.height) : (t.ratio || '1/1')),
              file_id: frame.file_id || t.file_id,
            }),
            maxW: perMaxW,
            maxH: perMaxH,
            label: variantLabel,
            hd: false,
          });
        })}
      </div>

      {/* Meta strip */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '6px 12px', borderRadius: 99,
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        boxShadow: 'var(--shadow-1)',
        fontSize: 11,
        flexWrap: 'wrap', justifyContent: 'center',
      }}>
        <span className="mono" style={{ color: 'var(--ink-3)' }}>{cat}</span>
        <span style={{ width: 3, height: 3, borderRadius: 99, background: 'var(--line)' }}/>
        <span className="mono" style={{ color: 'var(--ink-2)' }}>{(t.ratio || '').replace('/', ':')}</span>
        {isMulti && <>
          <span style={{ width: 3, height: 3, borderRadius: 99, background: 'var(--line)' }}/>
          <span className="mono" style={{ color: 'var(--ink-2)' }}>{frames.length} 个画板</span>
        </>}
        <span style={{ width: 3, height: 3, borderRadius: 99, background: 'var(--line)' }}/>
        <span className="mono" style={{ color: 'var(--ink-2)' }}>{Math.round(t.width)} × {Math.round(t.height)} px</span>
        <span style={{ width: 3, height: 3, borderRadius: 99, background: 'var(--line)' }}/>
        <span style={{ color: 'var(--ink-2)' }}>Ready for chat input</span>
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
  </div>
);

window.Canvas = Canvas;

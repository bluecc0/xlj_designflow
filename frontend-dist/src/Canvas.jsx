// Main canvas — now simplified to just show the selected template preview.

const Canvas = ({ template, resultImages }) => {
  const t = template;
  // resultImages: null | string[] — array of image URLs to display
  const hasResult = resultImages && resultImages.length > 0;

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
          {hasResult ? (
            <>
              <span className="mono" style={{ color: 'var(--ok)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Result</span>
              <span style={{ color: 'var(--ink)', fontWeight: 500 }}>生成完成</span>
              {resultImages.length > 1 && (
                <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)', padding: '2px 6px', borderRadius: 4, background: 'var(--panel-2)', border: '1px solid var(--line-2)' }}>{resultImages.length}张</span>
              )}
            </>
          ) : (
            <>
              <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Template</span>
              <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{t?.name || 'None selected'}</span>
              {t && (
                <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)', padding: '2px 6px', borderRadius: 4, background: 'var(--panel-2)', border: '1px solid var(--line-2)' }}>{t.tag}</span>
              )}
            </>
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
        flex: 1, minHeight: 0, overflow: hasResult ? 'auto' : 'hidden',
        position: 'relative',
        background: `radial-gradient(circle at 1px 1px, oklch(0.9 0.005 260) 1px, transparent 0)`,
        backgroundSize: '20px 20px',
        backgroundColor: 'oklch(0.98 0.003 260)',
      }}>
        {hasResult ? (
          <ResultGrid images={resultImages}/>
        ) : t ? <TemplatePreview t={t}/> : <EmptyCanvas/>}
      </div>
    </div>
  );
};

// 结果展示：多张图横排，底部操作栏
const ResultGrid = ({ images }) => {
  const single = images.length === 1;
  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: single ? 'center' : 'flex-start', padding: 24, gap: 16 }}>
      {/* 图片区 */}
      <div style={{
        display: 'flex', flexDirection: 'row', gap: 16,
        flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-start',
      }}>
        {images.map((url, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <img
              src={url}
              alt={'Result ' + (i + 1)}
              style={{
                maxWidth: single ? 560 : 280,
                maxHeight: single ? 560 : 360,
                width: 'auto', height: 'auto',
                borderRadius: 8,
                boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                display: 'block',
              }}
            />
            {!single && (
              <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>画板 {i + 1}</span>
            )}
          </div>
        ))}
      </div>
      {/* 操作栏 */}
      <div style={{
        display: 'flex', gap: 8, padding: '8px 12px',
        background: 'rgba(255,255,255,0.95)',
        borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
        flexWrap: 'wrap', justifyContent: 'center',
      }}>
        {window.resultPenpotUrl && (
          <button
            onClick={() => window.open(window.resultPenpotUrl, '_blank')}
            style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, background: 'var(--accent)', color: 'white', border: 'none', cursor: 'pointer' }}
          >
            在Penpot中编辑
          </button>
        )}
        {images.map((url, i) => (
          <button
            key={i}
            onClick={() => window.open(url, '_blank')}
            style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, background: 'var(--ink)', color: 'white', border: 'none', cursor: 'pointer' }}
          >
            {images.length === 1 ? '下载图片' : `下载图${i + 1}`}
          </button>
        ))}
      </div>
    </div>
  );
};

const iconBtnStyle = {
  width: 24, height: 24, borderRadius: 5,
  display: 'grid', placeItems: 'center',
  color: 'var(--ink-2)',
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
  const base = (window.API && window.API.BASE) || 'http://localhost:8000';
  // Penpot 默认跑在 9001，API 跑在 8000，尝试从 hostname 拼出 penpot 地址
  let penpotOrigin;
  try {
    const u = new URL(base);
    penpotOrigin = u.protocol + '//' + u.hostname + ':9001';
  } catch(e) {
    penpotOrigin = 'http://localhost:9001';
  }
  return `${penpotOrigin}/#/view/${fileId}/${pageId}?frame-id=${frameId}&section=interactions&index=0`;
};

// 单个画板的预览卡片（主画布用 iframe 高清预览，缩略图模式用 img）
const FrameThumb = ({ frame, maxW, maxH, label, hd = false }) => {
  const ratio = frame.ratio || (frame.width && frame.height ? (frame.width + '/' + frame.height) : '1/1');
  const [w, h] = ratioToSize(ratio, maxW, maxH);

  // hd 模式：嵌入 Penpot view iframe
  const [iframeReady, setIframeReady] = React.useState(false);
  const viewUrl = hd ? getPenpotViewUrl(frame.file_id, frame.page_id, frame.id) : null;

  // 非 hd：用缩略图 img
  const [src, setSrc] = React.useState(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    if (hd) return;
    setSrc(null); setFailed(false);
    setSrc(window.API.getTemplateThumbnailUrl(frame.id, frame.page_id, frame.file_id));
  }, [frame.id, frame.page_id, frame.file_id, hd]);

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
  </div>
);

window.Canvas = Canvas;
// Middle canvas — shows selected template preview, compose progress, and result image.

const Canvas = ({ template, job, resultImageUrl, onJobUpdate }) => {
  const t = template;
  const isRunning = job && (job.status === 'pending' || job.status === 'running');
  const isDone = job && job.status === 'done';
  const isFailed = job && job.status === 'failed';

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0,
      overflow: 'hidden',
      background: 'var(--panel-2)',
    }}>
      {/* Toolbar */}
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
            <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)', padding: '2px 6px', borderRadius: 4, background: 'var(--panel-2)', border: '1px solid var(--line-2)' }}>
              {t.width}×{t.height}
            </span>
          )}
        </div>

        <div style={{ flex: 1 }}/>

        {/* Status badge */}
        {isRunning && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--accent-ink)' }}>
            <div style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--accent)', animation: 'pulse 1.2s ease-in-out infinite' }}/>
            AI 生图中…
          </div>
        )}
        {isDone && resultImageUrl && (
          <a href={resultImageUrl} download style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 6, background: 'var(--ink)', color: 'white', textDecoration: 'none' }}>
            <I.download size={11}/>
            下载 PNG
          </a>
        )}
        {t?.slots && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--ink-3)' }}>
            <span className="mono">{t.slots.length} slots</span>
          </div>
        )}
        <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
      </div>

      {/* Stage */}
      <div style={{
        flex: 1, minHeight: 0, overflow: 'hidden',
        position: 'relative',
        background: `radial-gradient(circle at 1px 1px, oklch(0.9 0.005 260) 1px, transparent 0)`,
        backgroundSize: '20px 20px',
        backgroundColor: 'oklch(0.98 0.003 260)',
      }}>
        {!t && <EmptyCanvas/>}
        {t && isRunning && <ComposeProgress job={job}/>}
        {t && isDone && resultImageUrl && <ResultImage url={resultImageUrl} job={job}/>}
        {t && isFailed && <FailedState error={job.error}/>}
        {t && !isRunning && !isDone && !isFailed && <TemplatePreview t={t}/>}
      </div>
    </div>
  );
};

// ── Empty state ───────────────────────────────────────────────────────────────

const EmptyCanvas = () => (
  <div style={{
    position: 'absolute', inset: 0,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 10, color: 'var(--ink-3)',
  }}>
    <div style={{
      width: 48, height: 48, borderRadius: 12,
      background: 'var(--panel)', border: '1px solid var(--line)',
      display: 'grid', placeItems: 'center',
    }}>
      <I.layers size={20} style={{ color: 'var(--ink-3)' }}/>
    </div>
    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-2)' }}>从左侧选择模板</div>
    <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>选择后在此预览，然后通过 AI 对话开始生图</div>
  </div>
);

// ── Template preview (slot layout) ───────────────────────────────────────────

const TemplatePreview = ({ t }) => {
  const stageRef = React.useRef(null);
  const [box, setBox] = React.useState({ w: 560, h: 480 });
  const [thumbError, setThumbError] = React.useState(false);

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

  const tw = t.width || 1200;
  const th = t.height || 1200;
  const scale = Math.min(box.w / tw, box.h / th, 1);
  const pw = Math.round(tw * scale);
  const ph = Math.round(th * scale);

  const thumbUrl = t.thumbnail_url || API.getTemplateThumbnailUrl(t.id, t.page_id, t.file_id);
  const frameX = t.x || 0;
  const frameY = t.y || 0;

  return (
    <div ref={stageRef} style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        {/* Template frame */}
        <div style={{
          position: 'relative',
          width: pw, height: ph,
          background: 'var(--panel)',
          borderRadius: 6,
          boxShadow: '0 30px 60px rgba(20,22,40,0.10), 0 4px 14px rgba(20,22,40,0.06), 0 0 0 1px var(--line)',
          overflow: 'hidden',
        }}>
          {/* Thumbnail */}
          {!thumbError && (
            <img
              src={thumbUrl}
              alt={t.name}
              onError={() => setThumbError(true)}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            />
          )}

          {/* Slot overlay SVG */}
          {t.slots && t.slots.length > 0 && (
            <svg
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
              viewBox={`0 0 ${tw} ${th}`}
              preserveAspectRatio="none"
            >
              {t.slots.map(s => {
                const rx = s.x - frameX;
                const ry = s.y - frameY;
                const field = s.name.split('/')[2];
                const isImage = s.type === 'rect' || field === 'image';
                const isText = s.type === 'text';
                const stroke = isImage ? '#22c55e' : isText ? '#3b82f6' : '#eab308';
                const fill = isImage ? '#22c55e18' : isText ? '#3b82f618' : '#eab30818';
                return (
                  <g key={s.id}>
                    <rect x={rx} y={ry} width={s.width} height={s.height}
                      fill={fill} stroke={stroke} strokeWidth={2} strokeDasharray="6 4" rx={4}/>
                    <text x={rx + s.width / 2} y={ry + s.height / 2 + 4}
                      textAnchor="middle" fontSize={Math.min(14, s.height * 0.25)}
                      fill={stroke} fontFamily="monospace" opacity={0.9}>
                      {field || s.name}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}

          {/* Fallback stripe if no thumbnail */}
          {thumbError && (
            <Stripe ratio={`${tw}/${th}`} tone="neutral" seed={t.id} label={t.name.split(' ')[0]}/>
          )}

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
          <span className="mono" style={{ color: 'var(--ink-3)' }}>{tw} × {th}</span>
          <span style={{ width: 3, height: 3, borderRadius: 99, background: 'var(--line)' }}/>
          <span className="mono" style={{ color: 'var(--ink-2)' }}>{t.slots?.length || 0} slots</span>
          <span style={{ width: 3, height: 3, borderRadius: 99, background: 'var(--line)' }}/>
          <span style={{ color: 'var(--ink-2)' }}>通过对话开始填充 →</span>
        </div>
      </div>
    </div>
  );
};

// ── Compose progress ──────────────────────────────────────────────────────────

function friendlyProgress(msg) {
  if (!msg) return null;
  if (msg.includes('等待合成队列')) return '等待生图队列…';
  if (msg.includes('复制模板文件')) return '正在创建独立副本…';
  if (msg.includes('副本就绪')) return '副本创建完成';
  if (msg.includes('读取模板图层')) return '读取模板结构';
  if (msg.includes('上传图片')) {
    const m = msg.match(/上传图片.*?→\s*(slot\/.+)/);
    return m ? `上传图片 → ${m[1].replace('slot/', '').replace('/image', '')}` : '上传产品图片';
  }
  if (msg.includes('写入文字')) {
    const m = msg.match(/「(.+?)」/);
    return m ? `写入文字：${m[1]}` : '写入文字内容';
  }
  if (msg.includes('隐藏空图层')) return null;
  if (msg.includes('提交') && msg.includes('变更')) {
    const m = msg.match(/(\d+)/);
    return m ? `提交 ${m[1]} 处变更` : '提交变更';
  }
  if (msg.includes('无变更')) return '无需变更，直接导出';
  if (msg.includes('导出 PNG')) return '正在渲染导出图片…';
  if (msg.includes('完成') && msg.includes('输出')) return '导出完成';
  if (msg.includes('Penpot 编辑链接')) return null;
  if (msg.includes('失败')) return null;
  return msg;
}

const ComposeProgress = ({ job }) => {
  const logRef = React.useRef(null);
  const lines = (job.progress || []).map(friendlyProgress).filter(Boolean);

  React.useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines.length]);

  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 40,
    }}>
      <div style={{
        width: '100%', maxWidth: 480,
        background: 'var(--panel)', border: '1px solid var(--line)',
        borderRadius: 12, overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(20,22,40,0.08)',
      }}>
        {/* Header */}
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--line-2)',
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'var(--panel-2)',
        }}>
          <div style={{ width: 16, height: 16, borderRadius: 99, border: '2px solid var(--line-2)', borderTopColor: 'var(--accent)', animation: 'spin 0.8s linear infinite' }}/>
          <span style={{ fontSize: 13, fontWeight: 600 }}>AI 生图中</span>
          <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>job · {job.id?.slice(0, 8)}</span>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>

        {/* Log */}
        <div ref={logRef} style={{
          padding: '10px 0', maxHeight: 260, overflowY: 'auto',
          fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5,
        }}>
          {lines.length === 0 && (
            <div style={{ padding: '6px 16px', color: 'var(--ink-3)', display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ color: 'var(--accent)' }}>·</span>
              <span>正在启动…</span>
            </div>
          )}
          {lines.map((line, i) => {
            const isActive = i === lines.length - 1;
            return (
              <div key={i} style={{
                padding: '5px 16px',
                display: 'flex', gap: 10, alignItems: 'center',
                color: isActive ? 'var(--ink)' : 'var(--ink-3)',
              }}>
                {isActive
                  ? <span style={{ color: 'var(--accent)', fontWeight: 700, width: 14, textAlign: 'center' }}>·</span>
                  : <span style={{ color: 'var(--ok)', width: 14, textAlign: 'center' }}>✓</span>
                }
                <span>{line}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ── Result image ──────────────────────────────────────────────────────────────

const ResultImage = ({ url, job }) => (
  <div style={{
    position: 'absolute', inset: 0,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: 24, gap: 14,
  }}>
    <div style={{
      maxHeight: 'calc(100% - 60px)',
      borderRadius: 8,
      overflow: 'hidden',
      boxShadow: '0 20px 60px rgba(20,22,40,0.15), 0 0 0 1px var(--line)',
    }}>
      <img src={url} alt="合成结果" style={{ display: 'block', maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}/>
    </div>
    <div style={{ display: 'flex', gap: 8 }}>
      <a href={url} download style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 12, fontWeight: 500,
        padding: '7px 14px', borderRadius: 8,
        background: 'var(--ink)', color: 'white', textDecoration: 'none',
      }}>
        <I.download size={13}/>
        下载 PNG
      </a>
      {job?.penpot_edit_url && (
        <a href={job.penpot_edit_url} target="_blank" rel="noreferrer" style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 12, padding: '7px 14px', borderRadius: 8,
          background: 'var(--panel)', color: 'var(--ink-2)',
          border: '1px solid var(--line)', textDecoration: 'none',
        }}>
          在 Penpot 中修改
        </a>
      )}
    </div>
  </div>
);

// ── Failed state ──────────────────────────────────────────────────────────────

const FailedState = ({ error }) => (
  <div style={{
    position: 'absolute', inset: 0,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: 40, gap: 12,
  }}>
    <div style={{ fontSize: 13, fontWeight: 600, color: 'oklch(0.55 0.15 25)' }}>生图失败</div>
    {error && (
      <pre style={{
        fontSize: 11, color: 'var(--ink-3)', background: 'var(--panel)',
        border: '1px solid var(--line)', borderRadius: 8,
        padding: '10px 14px', maxWidth: 480, overflowX: 'auto',
        whiteSpace: 'pre-wrap', wordBreak: 'break-all',
      }}>{error}</pre>
    )}
  </div>
);

// ── Corner handles ────────────────────────────────────────────────────────────

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

window.Canvas = Canvas;

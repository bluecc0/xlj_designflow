// AI chat panel
// Logic: mirrors original ChatPanel.tsx 1:1
// UI: Loom Design Studio style (oklch tokens, Inter/JetBrains Mono, bubble layout)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function deriveRequiredFields(template) {
  if (!template) return [];
  const fields = new Set();
  for (const slot of (template.slots || [])) {
    const field = slot.name.split('/')[2];
    if (!field) continue;
    if (field === 'image' || slot.type === 'rect') continue;
    fields.add(field);
  }
  return Array.from(fields);
}

// ─── UI primitives ────────────────────────────────────────────────────────────

const Avatar = ({ who }) => (
  who === 'ai'
    ? <div style={{
        width: 24, height: 24, borderRadius: 7, flexShrink: 0,
        background: 'linear-gradient(135deg, var(--ink), oklch(0.3 0.08 275))',
        color: 'white', display: 'grid', placeItems: 'center',
      }}><I.sparkles size={12} stroke={2}/></div>
    : <div style={{
        width: 24, height: 24, borderRadius: 7, flexShrink: 0,
        background: 'oklch(0.82 0.07 200)', color: 'oklch(0.3 0.05 200)',
        fontSize: 10, fontWeight: 600, display: 'grid', placeItems: 'center',
      }}>U</div>
);

const Bubble = ({ who, children, meta }) => (
  <div style={{
    display: 'flex', gap: 10, alignItems: 'flex-start',
    flexDirection: who === 'user' ? 'row-reverse' : 'row',
  }}>
    <Avatar who={who}/>
    <div style={{
      maxWidth: 'calc(100% - 38px)', display: 'flex', flexDirection: 'column', gap: 6,
      alignItems: who === 'user' ? 'flex-end' : 'flex-start',
    }}>
      {meta && <div className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{meta}</div>}
      {children}
    </div>
  </div>
);

const TextBubble = ({ who, text }) => (
  <div style={{
    fontSize: 12.5, lineHeight: 1.55, padding: '9px 12px', borderRadius: 10,
    background: who === 'user' ? 'var(--ink)' : 'var(--panel)',
    color: who === 'user' ? 'white' : 'var(--ink)',
    border: who === 'user' ? 'none' : '1px solid var(--line-2)',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxWidth: '100%',
  }}>{text}</div>
);

const TypingDots = () => (
  <div style={{
    fontSize: 12.5, padding: '9px 12px', borderRadius: 10,
    background: 'var(--panel)', border: '1px solid var(--line-2)',
    display: 'flex', alignItems: 'center', gap: 4,
  }}>
    {[0,1,2].map(i => (
      <span key={i} style={{
        width: 5, height: 5, borderRadius: 99, background: 'var(--ink-3)',
        animation: `tdot 1.2s ease-in-out ${i*0.2}s infinite`,
      }}/>
    ))}
    <style>{`@keyframes tdot{0%,80%,100%{opacity:.25}40%{opacity:1}}`}</style>
  </div>
);

// Parse result card — shows all products with image match status
const ParseCard = ({ products, imgMatched, imgMissed }) => (
  <div style={{
    width: '100%', borderRadius: 10,
    background: 'var(--panel)', border: '1px solid var(--line-2)', overflow: 'hidden',
  }}>
    <div style={{
      padding: '8px 12px', borderBottom: '1px solid var(--line-2)',
      display: 'flex', alignItems: 'center', gap: 7, background: 'var(--panel-2)',
    }}>
      <div style={{ width: 18, height: 18, borderRadius: 4, background: 'var(--accent-soft)', color: 'var(--accent-ink)', display: 'grid', placeItems: 'center' }}>
        <I.file size={10}/>
      </div>
      <span style={{ fontSize: 11.5, fontWeight: 600 }}>产品解析结果</span>
      <span className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)', marginLeft: 'auto' }}>{products.length} 款</span>
    </div>
    {products.map((p, i) => (
      <div key={i} style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px',
        borderTop: i > 0 ? '1px solid var(--line-2)' : 'none', fontSize: 11.5,
      }}>
        <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 10, minWidth: 16 }}>{i+1}</span>
        <span style={{ flex: 1, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name || '—'}</span>
        {p.price && <span style={{ color: 'var(--ink-3)', fontSize: 10.5 }}>{p.price}</span>}
        <span style={{
          fontSize: 10, padding: '1px 7px', borderRadius: 99, fontWeight: 500,
          background: p.image_path ? 'oklch(0.95 0.04 155)' : 'oklch(0.96 0.04 70)',
          color: p.image_path ? 'var(--ok)' : 'var(--warn)',
        }}>{p.image_path ? '图 ✓' : '无图'}</span>
      </div>
    ))}
    <div style={{
      padding: '7px 12px', borderTop: '1px solid var(--line-2)',
      display: 'flex', alignItems: 'center', gap: 6, background: 'var(--panel-2)',
    }}>
      <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>
        {imgMissed === 0 ? `全部 ${imgMatched} 张图片已匹配` : `${imgMatched} 张已匹配 · ${imgMissed} 张缺失`}
      </span>
    </div>
  </div>
);

// Image type selector chips
const ImageTypeSelector = ({ types, selected, onSelect }) => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
    {types.map(t => (
      <button key={t.key} onClick={() => onSelect(t.key)} style={{
        fontSize: 11.5, padding: '4px 10px', borderRadius: 99,
        background: selected === t.key ? 'var(--ink)' : 'var(--panel)',
        color: selected === t.key ? 'white' : t.exists ? 'var(--ink-2)' : 'var(--ink-3)',
        border: '1px solid', borderColor: selected === t.key ? 'var(--ink)' : 'var(--line)',
        opacity: t.exists ? 1 : 0.55, transition: 'all 100ms',
      }} title={t.exists ? t.folder : `文件夹不存在：${t.folder}`}>
        {t.folder}{!t.exists && ' !'}
      </button>
    ))}
  </div>
);

// Action buttons row
const ActionRow = ({ actions }) => (
  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
    {actions.map((a, i) => (
      <button key={i} onClick={a.handler} style={{
        fontSize: 12, fontWeight: a.primary ? 500 : 400,
        padding: '7px 13px', borderRadius: 8,
        background: a.primary ? 'var(--accent)' : 'var(--panel)',
        color: a.primary ? 'white' : 'var(--ink-2)',
        border: a.primary ? 'none' : '1px solid var(--line)',
        boxShadow: a.primary ? '0 1px 0 rgba(255,255,255,0.15) inset, 0 2px 6px oklch(0.55 0.22 275 / 0.2)' : 'none',
        display: 'flex', alignItems: 'center', gap: 5,
      }}>
        {a.primary && <I.zap size={12} fill="white" stroke={0}/>}
        {a.label}
      </button>
    ))}
  </div>
);

// Slash command popup
const SLASH_COMMANDS_LIST = [
  { cmd: '/开始生图', desc: '启动 AI 生图任务',    icon: 'zap' },
  { cmd: '/导出PNG',  desc: '下载生图结果图片',    icon: 'download' },
  { cmd: '/切九宫格', desc: '将结果裁切为九宫格',  icon: 'grid' },
];

const SlashPopup = ({ input, onPick }) => {
  const filtered = SLASH_COMMANDS_LIST.filter(c =>
    input === '/' || c.cmd.includes(input.slice(1))
  );
  if (!filtered.length) return null;
  return (
    <div style={{
      position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, right: 0,
      background: 'var(--panel)', border: '1px solid var(--line)',
      borderRadius: 10, overflow: 'hidden',
      boxShadow: '0 8px 32px rgba(20,22,40,0.10)', zIndex: 20,
    }}>
      <div className="mono" style={{
        padding: '7px 12px 5px', fontSize: 9.5, color: 'var(--ink-3)',
        textTransform: 'uppercase', letterSpacing: '0.08em',
        borderBottom: '1px solid var(--line-2)',
        display: 'flex', justifyContent: 'space-between',
      }}>
        <span>指令</span>
        <span>↑↓ 选择 · ⏎ 确认</span>
      </div>
      {filtered.map(c => (
        <button key={c.cmd} onMouseDown={e => { e.preventDefault(); onPick(c.cmd); }} style={{
          width: '100%', textAlign: 'left',
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 12px', borderBottom: '1px solid var(--line-2)',
          transition: 'background 80ms',
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-soft)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
          <div style={{
            width: 22, height: 22, borderRadius: 5, background: 'var(--panel-2)',
            color: 'var(--ink-2)', display: 'grid', placeItems: 'center', flexShrink: 0,
          }}>
            {I[c.icon]({ size: 12 })}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
              <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-ink)' }}>{c.cmd}</span>
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{c.desc}</div>
          </div>
        </button>
      ))}
    </div>
  );
};

// ─── Main ─────────────────────────────────────────────────────────────────────

let _mid = 100;
const nid = () => String(++_mid);

const WELCOME = `你好！我是 AI 助手，可以帮你操作生图流程。

快速开始：
1. 在左侧选择模板
2. 点击 ⌀ 上传产品需求表格（Excel / CSV）
3. 输入 /开始生图 或点击「开始生图」按钮

快捷指令：/开始生图  /导出PNG  /切九宫格`;

const Chat = ({ template, onJobUpdate, onResultUrl }) => {
  const [messages, setMessages] = React.useState([
    { id: '0', role: 'ai', content: WELCOME },
  ]);
  const [input, setInput] = React.useState('');
  const [uploading, setUploading] = React.useState(false);
  const [showSlash, setShowSlash] = React.useState(false);
  const [imageTypes, setImageTypes] = React.useState([]);
  const [selectedImageType, setSelectedImageType] = React.useState('');
  const [currentJob, setCurrentJob] = React.useState(null);
  const [parsedProducts, setParsedProducts] = React.useState(null);

  const selectedTypeRef = React.useRef('');
  const pendingFileRef = React.useRef(null);
  const bottomRef = React.useRef(null);
  const fileRef = React.useRef(null);
  const pollRef = React.useRef(null);
  const prevStatusRef = React.useRef(undefined);

  // Load image types
  React.useEffect(() => {
    API.fetchImageTypes().then(types => {
      setImageTypes(types);
      const first = types.find(t => t.exists);
      if (first) { setSelectedImageType(first.key); selectedTypeRef.current = first.key; }
    }).catch(() => {});
  }, []);

  const setType = (k) => { setSelectedImageType(k); selectedTypeRef.current = k; };

  const push = (msg) => {
    const m = { id: nid(), ...msg };
    setMessages(prev => [...prev, m]);
    return m.id;
  };
  const patch = (id, delta) => setMessages(prev => prev.map(m => m.id === id ? { ...m, ...delta } : m));
  const scrollBottom = () => setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);

  // Poll job
  React.useEffect(() => {
    if (!currentJob || currentJob.status === 'done' || currentJob.status === 'failed') {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const updated = await API.getCompose(currentJob.id);
        setCurrentJob(updated);
        if (onJobUpdate) onJobUpdate(updated);
      } catch {}
    }, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [currentJob?.id, currentJob?.status]);

  // Job status → chat messages
  React.useEffect(() => {
    const status = currentJob?.status;
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (status === 'done' && prev !== 'done') {
      const imgUrl = API.getImageUrl(currentJob.id);
      if (onResultUrl) onResultUrl(imgUrl);
      const editUrl = currentJob.penpot_edit_url;
      push({
        role: 'ai',
        content: '✅ 生图完成！结果已显示在预览区。',
        actions: [
          { label: '导出 PNG', primary: true, handler: () => { push({ role: 'user', content: '导出 PNG' }); doExportPng(imgUrl, currentJob.id); scrollBottom(); } },
          { label: '切九宫格', handler: () => { push({ role: 'user', content: '切九宫格' }); doExportGrid(currentJob.id); scrollBottom(); } },
          ...(editUrl ? [{ label: '在 Penpot 中修改', handler: () => window.open(editUrl, '_blank') }] : []),
        ],
      });
      scrollBottom();
    } else if (status === 'failed' && prev !== 'failed') {
      push({ role: 'ai', content: `❌ 生图失败：${currentJob.error || '未知错误'}` });
      scrollBottom();
    }
  }, [currentJob?.status]);

  // Send text
  async function handleSend() {
    const text = input.trim();
    if (!text) return;
    setInput(''); setShowSlash(false);
    push({ role: 'user', content: text });
    scrollBottom();
    if (text.startsWith('/')) {
      const cmd = text.split(' ')[0].toLowerCase();
      if (cmd === '/开始生图') await doCompose();
      else if (cmd === '/导出png') doExportPng();
      else if (cmd === '/切九宫格') await doExportGrid();
      else push({ role: 'ai', content: `未知指令：${text}\n\n可用指令：/开始生图、/导出PNG、/切九宫格` });
      scrollBottom(); return;
    }
    await handleText(text);
    scrollBottom();
  }

  async function handleText(text) {
    const lower = text.toLowerCase();
    if (lower.includes('导出') && lower.includes('九宫格')) { await doExportGrid(); return; }
    if (lower.includes('导出') || lower.includes('png')) { doExportPng(); return; }
    if (lower.includes('生图') || lower.includes('合成') || lower.includes('生成') || lower.includes('开始')) { await doCompose(); return; }
    // AI chat
    const history = messages.filter(m => m.content && (m.role === 'user' || m.role === 'ai')).slice(-10)
      .map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content }));
    history.push({ role: 'user', content: text });
    const ctx = { templateName: template?.name, templateSlotCount: template?.slots?.length, productCount: parsedProducts?.length, jobStatus: currentJob?.status, hasResult: currentJob?.status === 'done' };
    const tid = push({ role: 'ai', content: null, typing: true });
    scrollBottom();
    try {
      const reply = await API.chatWithAI(history, ctx);
      patch(tid, { content: reply, typing: false });
    } catch {
      patch(tid, { content: 'AI 暂时不可用，请检查后端是否启动或 API Key 是否配置。', typing: false });
    }
  }

  // File upload
  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    push({ role: 'user', content: `上传了表格：${file.name}` });
    scrollBottom();
    if (imageTypes.length > 0) {
      pendingFileRef.current = file;
      push({
        role: 'ai',
        content: '请选择本次生图使用的图片类型，系统将从对应素材文件夹匹配产品图：',
        actions: [{ label: '确认解析', primary: true, handler: () => doParseWithType(pendingFileRef.current) }],
        extra: { type: 'image-type-selector' },
      });
      scrollBottom();
    } else {
      await doParseWithType(file);
    }
  }

  async function doParseWithType(file) {
    setUploading(true);
    const requiredFields = deriveRequiredFields(template);
    const currentType = selectedTypeRef.current;
    const tid = push({ role: 'ai', content: '正在读取表格…' });
    scrollBottom();
    try {
      const result = await API.parseTable(file, requiredFields.length ? requiredFields : undefined, currentType || undefined);
      patch(tid, { content: '正在匹配产品图库…' });
      await new Promise(r => setTimeout(r, 600));
      patch(tid, { content: null }); // hide
      await handleParseResult(result);
    } catch (err) {
      patch(tid, { content: `解析失败：${String(err)}` });
    } finally {
      setUploading(false);
      scrollBottom();
    }
  }

  async function handleParseResult(result) {
    const products = result.products;
    setParsedProducts(products);
    const imgMatched = products.filter(p => p.image_path).length;
    const imgMissed = products.length - imgMatched;
    const total = products.length;
    const tplCount = template
      ? new Set((template.slots || []).map(s => s.name.split('/')[1]).filter(Boolean)).size : 0;
    let lead = '';
    if (!template) {
      lead = `分析完成，识别到 ${total} 款产品，图片匹配了 ${imgMatched} 张。记得在左侧选一个模板，然后就可以生图了。`;
    } else if (tplCount === total && imgMissed === 0) {
      lead = `好的，${total} 款产品和「${template.name}」完全匹配，图片也全部找到了，可以直接生图。`;
    } else if (tplCount === total) {
      lead = `${total} 款产品和模板数量吻合，不过有 ${imgMissed} 张图没找到，生图时那几个位置会留空。`;
    } else {
      const diff = total - tplCount;
      lead = diff > 0
        ? `表格有 ${total} 款，模板只有 ${tplCount} 个位置，我会用前 ${tplCount} 款来生图。`
        : `模板需要 ${tplCount} 款产品，表格只提供了 ${total} 款，剩余位置留空处理。`;
    }
    push({
      role: 'ai', content: lead,
      actions: [{ label: '开始生图', primary: true, handler: () => { push({ role: 'user', content: '开始生图' }); doCompose(products); scrollBottom(); } }],
      extra: { type: 'parse-result', products, imgMatched, imgMissed },
    });
  }

  // Compose
  async function doCompose(products) {
    const prods = products || parsedProducts;
    if (!template) { push({ role: 'ai', content: '请先在左侧选择一个模板。' }); return; }
    if (!prods || !prods.length) { push({ role: 'ai', content: '还没有填入产品信息，请先上传需求表格。' }); return; }
    const slots = {};
    prods.forEach((p, i) => { slots[`product_${i+1}`] = { image_path: p.image_path ?? null, name: p.name ?? null, price: p.price ?? null, tag: p.tag ?? null, spec: p.spec ?? null }; });
    push({ role: 'ai', content: '✨ AI 正在生图，请稍候…\n\n中间预览区实时显示进度。' });
    scrollBottom();
    try {
      const job = await API.createCompose({ file_id: template.file_id, template_frame_id: template.id, page_id: template.page_id, slots, export_scale: 2 });
      setCurrentJob(job);
      if (onJobUpdate) onJobUpdate(job);
      push({ role: 'ai', content: `⚡ 生图任务已启动\n\n任务 ID：${job.id.slice(0, 8)}，完成后自动显示结果。` });
    } catch (err) {
      push({ role: 'ai', content: `生图启动失败：${String(err)}` });
    }
    scrollBottom();
  }

  // Export PNG
  function doExportPng(urlOverride, jobIdOverride) {
    const url = urlOverride || (currentJob?.status === 'done' ? API.getImageUrl(currentJob.id) : null);
    if (!url) { push({ role: 'ai', content: '还没有完成的生图结果，请先生图。' }); return; }
    const a = document.createElement('a');
    a.href = url; a.download = `result_${(jobIdOverride || currentJob?.id || 'img').slice(0, 8)}.png`; a.click();
    push({ role: 'ai', content: 'PNG 下载已开始。' });
  }

  // Export grid
  async function doExportGrid(jobIdOverride) {
    const jobId = jobIdOverride || currentJob?.id;
    const isDone = jobIdOverride ? true : currentJob?.status === 'done';
    if (!jobId || !isDone) { push({ role: 'ai', content: '请先完成生图，再切九宫格。' }); return; }
    push({ role: 'ai', content: '正在切九宫格…' });
    scrollBottom();
    try {
      const result = await API.exportGrid(jobId, 3, 3);
      const urls = (result.files || []).map((_, i) => API.getGridCellUrl(result.job_id || jobId, i));
      push({
        role: 'ai',
        content: `九宫格已生成，共 ${urls.length} 张，可在中栏预览或点击下载。`,
        actions: urls.map((url, i) => ({
          label: `下载第 ${i+1} 格`,
          handler: () => { const a = document.createElement('a'); a.href = url; a.download = `grid_${i+1}.png`; a.click(); },
        })),
      });
    } catch (err) {
      push({ role: 'ai', content: `切图失败：${String(err)}` });
    }
    scrollBottom();
  }

  const isWorking = uploading || currentJob?.status === 'running' || currentJob?.status === 'pending';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--panel)', borderLeft: '1px solid var(--line)' }}>

      {/* Header */}
      <div style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 14px', gap: 8, borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{
            width: 7, height: 7, borderRadius: 99,
            background: isWorking ? 'var(--accent)' : 'var(--ok)',
            animation: isWorking ? 'pulse 1.2s ease-in-out infinite' : 'none',
          }}/>
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em' }}>Loom</span>
          <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>
            {uploading ? '解析中…' : currentJob?.status === 'running' ? '生图中…' : parsedProducts ? `${parsedProducts.length} 款产品` : '就绪'}
          </span>
        </div>
        <div style={{ flex: 1 }}/>
        {parsedProducts && (
          <span className="mono" style={{ fontSize: 9.5, color: 'var(--ok)', padding: '2px 6px', borderRadius: 4, background: 'oklch(0.95 0.04 155)', border: '1px solid oklch(0.88 0.06 155)' }}>
            {parsedProducts.length} 款已载入
          </span>
        )}
        <button onClick={() => { setMessages([{ id: '0', role: 'ai', content: WELCOME }]); setParsedProducts(null); setCurrentJob(null); setInput(''); }} style={{ padding: 5, borderRadius: 5, color: 'var(--ink-3)' }} title="清空对话">
          <I.refresh size={13}/>
        </button>
        <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 14px 10px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {messages.map(msg => {
          if (msg.content === null && !msg.typing && !msg.extra && !msg.actions) return null;
          const who = msg.role === 'ai' ? 'ai' : 'user';
          return (
            <Bubble key={msg.id} who={who} meta={who === 'ai' && msg.meta ? msg.meta : undefined}>
              {msg.typing
                ? <TypingDots/>
                : msg.content && <TextBubble who={who} text={msg.content}/>
              }
              {msg.extra?.type === 'parse-result' && (
                <ParseCard products={msg.extra.products} imgMatched={msg.extra.imgMatched} imgMissed={msg.extra.imgMissed}/>
              )}
              {msg.extra?.type === 'image-type-selector' && (
                <ImageTypeSelector types={imageTypes} selected={selectedImageType} onSelect={setType}/>
              )}
              {msg.actions?.length > 0 && <ActionRow actions={msg.actions}/>}
            </Bubble>
          );
        })}
        <div ref={bottomRef}/>
      </div>

      {/* Composer */}
      <div style={{ flexShrink: 0, padding: 12, borderTop: '1px solid var(--line)', background: 'var(--panel)', position: 'relative' }}>
        {/* Quick command pills */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
          {['/开始生图', '/导出PNG', '/切九宫格'].map(s => (
            <button key={s} onClick={() => { setInput(s); }} style={{
              fontSize: 10.5, padding: '2px 8px', borderRadius: 99,
              color: 'var(--accent-ink)', background: 'var(--accent-soft)',
              fontFamily: 'JetBrains Mono, monospace',
            }}>{s}</button>
          ))}
        </div>

        {/* Input box */}
        <div style={{
          borderRadius: 12,
          border: showSlash ? '1px solid var(--accent)' : '1px solid var(--line)',
          background: 'var(--panel-2)', padding: 10,
          display: 'flex', alignItems: 'center', gap: 6,
          boxShadow: showSlash ? '0 0 0 4px var(--accent-soft)' : 'var(--shadow-1)',
          transition: 'box-shadow 150ms, border-color 150ms',
          position: 'relative',
        }}>
          {showSlash && <SlashPopup input={input} onPick={cmd => { setInput(cmd); setShowSlash(false); }}/>}

          {/* Attach */}
          <button onClick={() => fileRef.current?.click()} disabled={uploading} title="上传需求表格" style={{ padding: 6, borderRadius: 6, color: 'var(--ink-2)', opacity: uploading ? 0.5 : 1 }}>
            {uploading
              ? <div style={{ width: 14, height: 14, borderRadius: 99, border: '2px solid var(--line-2)', borderTopColor: 'var(--accent)', animation: 'spin 0.8s linear infinite' }}/>
              : <I.paperclip size={14}/>
            }
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleFileChange}/>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

          {/* Text */}
          <input value={input} onChange={e => { setInput(e.target.value); setShowSlash(e.target.value.startsWith('/')); }}
            onKeyDown={e => { if (e.key === 'Escape') setShowSlash(false); if (e.key === 'Enter') { e.preventDefault(); handleSend(); } }}
            onBlur={() => setTimeout(() => setShowSlash(false), 150)}
            placeholder="输入指令或 / 触发快捷命令…"
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, lineHeight: 1.45, color: 'var(--ink)', fontFamily: 'inherit' }}
          />

          {/* Send */}
          <button onClick={handleSend} disabled={!input.trim()} style={{
            width: 30, height: 30, borderRadius: 8,
            background: input.trim() ? 'var(--ink)' : 'var(--line)',
            color: input.trim() ? 'white' : 'var(--ink-3)',
            display: 'grid', placeItems: 'center', transition: 'background 120ms',
          }}>
            <I.arrowUp size={14} stroke={2.2}/>
          </button>
        </div>
      </div>
    </div>
  );
};

window.Chat = Chat;

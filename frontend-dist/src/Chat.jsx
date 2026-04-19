// AI chat panel — mirrors original ChatPanel.tsx logic 1:1
// Features: file upload → parse → confirm → compose → export PNG / grid

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

// Pick best-matching template by product slot count
function findBestTemplate(templates, productCount) {
  if (!templates || templates.length === 0) return null;
  const scored = templates.map(t => {
    const keys = new Set(
      (t.slots || [])
        .filter(s => s.name && s.name.startsWith('slot/product_'))
        .map(s => s.name.split('/')[1])
    );
    return { t, diff: Math.abs(keys.size - productCount) };
  });
  scored.sort((a, b) => a.diff - b.diff);
  return scored[0]?.t ?? null;
}

// Derive required text fields from template slots (exclude image/rect)
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

// ─── Message rendering ────────────────────────────────────────────────────────

const TypingDots = () => (
  <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
    {[0, 1, 2].map(i => (
      <span key={i} style={{
        width: 5, height: 5, borderRadius: 99,
        background: 'var(--ink-3)',
        animation: `typingDot 1.2s ease-in-out ${i * 0.2}s infinite`,
      }}/>
    ))}
    <style>{`@keyframes typingDot { 0%,80%,100%{opacity:0.3} 40%{opacity:1} }`}</style>
  </span>
);

const ParseCard = ({ products, imgMatched, imgMissed }) => (
  <div style={{
    marginTop: 6, borderRadius: 8,
    border: '1px solid var(--line-2)',
    background: 'var(--panel-2)',
    overflow: 'hidden', fontSize: 11.5,
  }}>
    {products.map((p, i) => (
      <div key={i} style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 10px',
        borderTop: i > 0 ? '1px solid var(--line-2)' : 'none',
      }}>
        <span className="mono" style={{ color: 'var(--ink-3)', minWidth: 16, fontSize: 10 }}>{i + 1}</span>
        <span style={{ flex: 1, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name || '—'}</span>
        {p.price && <span style={{ color: 'var(--ink-3)', fontSize: 10.5 }}>{p.price}</span>}
        <span style={{
          fontSize: 10, padding: '1px 6px', borderRadius: 99,
          background: p.image_path ? 'oklch(0.95 0.04 155)' : 'oklch(0.96 0.04 70)',
          color: p.image_path ? 'var(--ok)' : 'var(--warn)',
          fontWeight: 500,
        }}>{p.image_path ? '图✓' : '无图'}</span>
      </div>
    ))}
    <div style={{
      padding: '6px 10px', borderTop: '1px solid var(--line-2)',
      background: 'var(--panel)', fontSize: 10.5, color: 'var(--ink-3)',
    }}>
      {imgMissed === 0
        ? `全部 ${imgMatched} 张图片已匹配`
        : `${imgMatched} 张已匹配 · ${imgMissed} 张缺失`}
    </div>
  </div>
);

const ImageTypeSelector = ({ types, selected, onSelect }) => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
    {types.map(t => (
      <button key={t.key} onClick={() => onSelect(t.key)} style={{
        fontSize: 11, padding: '4px 10px', borderRadius: 99,
        background: selected === t.key ? 'var(--ink)' : 'var(--panel)',
        color: selected === t.key ? 'white' : t.exists ? 'var(--ink-2)' : 'var(--ink-3)',
        border: '1px solid',
        borderColor: selected === t.key ? 'var(--ink)' : 'var(--line)',
        opacity: t.exists ? 1 : 0.5,
      }} title={t.exists ? t.folder : `文件夹不存在：${t.folder}`}>
        {t.folder}{!t.exists && ' !'}
      </button>
    ))}
  </div>
);

const MsgBubble = ({ msg, imageTypes, selectedImageType, onSelectImageType }) => {
  const isAI = msg.role === 'assistant';
  return (
    <div style={{
      display: 'flex', gap: 8, alignItems: 'flex-start',
      flexDirection: isAI ? 'row' : 'row-reverse',
      padding: '2px 0',
    }}>
      {/* Avatar */}
      <div style={{
        width: 24, height: 24, borderRadius: 7, flexShrink: 0,
        background: isAI
          ? 'linear-gradient(135deg, var(--ink), oklch(0.3 0.08 275))'
          : 'oklch(0.82 0.07 200)',
        color: isAI ? 'white' : 'oklch(0.3 0.05 200)',
        fontSize: 10, fontWeight: 600,
        display: 'grid', placeItems: 'center',
      }}>
        {isAI ? <I.sparkles size={12} stroke={2}/> : 'U'}
      </div>

      <div style={{
        maxWidth: 'calc(100% - 36px)',
        display: 'flex', flexDirection: 'column', gap: 5,
        alignItems: isAI ? 'flex-start' : 'flex-end',
      }}>
        {/* Text bubble */}
        {msg.content !== null && msg.content !== undefined && (
          <div style={{
            fontSize: 12.5, lineHeight: 1.55,
            padding: '8px 12px', borderRadius: 10,
            background: isAI ? 'var(--panel)' : 'var(--ink)',
            color: isAI ? 'var(--ink)' : 'white',
            border: isAI ? '1px solid var(--line-2)' : 'none',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {msg.content === '…' ? <TypingDots/> : msg.content}
          </div>
        )}

        {/* Parse result card */}
        {msg.extra?.type === 'parse-result' && (
          <ParseCard
            products={msg.extra.products}
            imgMatched={msg.extra.imgMatched}
            imgMissed={msg.extra.imgMissed}
          />
        )}

        {/* Image type selector */}
        {msg.extra?.type === 'image-type-selector' && (
          <ImageTypeSelector
            types={imageTypes}
            selected={selectedImageType}
            onSelect={onSelectImageType}
          />
        )}

        {/* Action buttons */}
        {msg.actions && msg.actions.length > 0 && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {msg.actions.map((a, i) => (
              <button key={i} onClick={a.handler} style={{
                fontSize: 11.5, padding: '6px 12px', borderRadius: 7,
                background: a.primary ? 'var(--accent)' : 'var(--panel)',
                color: a.primary ? 'white' : 'var(--ink-2)',
                border: a.primary ? 'none' : '1px solid var(--line)',
                fontWeight: a.primary ? 500 : 400,
                boxShadow: a.primary ? '0 1px 0 rgba(255,255,255,0.15) inset' : 'none',
              }}>{a.label}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Slash menu ───────────────────────────────────────────────────────────────

const SLASH_COMMANDS = [
  { cmd: '/开始生图', desc: '启动 AI 生图任务' },
  { cmd: '/导出PNG',  desc: '下载生图结果图片' },
  { cmd: '/切九宫格', desc: '将结果裁切为九宫格' },
];

const SlashMenuInline = ({ input, onPick }) => {
  const filtered = SLASH_COMMANDS.filter(c =>
    input === '/' || c.cmd.toLowerCase().includes(input.toLowerCase().slice(1))
  );
  if (filtered.length === 0) return null;
  return (
    <div style={{
      position: 'absolute', bottom: 'calc(100% + 4px)', left: 0, right: 0,
      background: 'var(--panel)', border: '1px solid var(--line)',
      borderRadius: 10, overflow: 'hidden',
      boxShadow: '0 8px 24px rgba(20,22,40,0.10)',
      zIndex: 20,
    }}>
      {filtered.map(c => (
        <button key={c.cmd} onMouseDown={e => { e.preventDefault(); onPick(c.cmd); }} style={{
          width: '100%', textAlign: 'left',
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '9px 12px',
          borderBottom: '1px solid var(--line-2)',
          fontSize: 12,
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-soft)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <span className="mono" style={{ color: 'var(--accent-ink)', fontWeight: 600 }}>{c.cmd}</span>
          <span style={{ color: 'var(--ink-3)' }}>{c.desc}</span>
        </button>
      ))}
    </div>
  );
};

// ─── Main Chat component ──────────────────────────────────────────────────────

let _msgId = 100;
const nextId = () => String(++_msgId);

const WELCOME = `你好！我是 AI 助手，可以帮你操作生图流程。

**快速开始：**
1. 在左侧选择模板
2. 点击上传按钮，上传产品需求表格（Excel / CSV）
3. 输入 /开始生图 或点击「开始生图」按钮

快捷指令：\`/开始生图\` \`/导出PNG\` \`/切九宫格\``;

const Chat = ({ template, onJobUpdate, onResultUrl }) => {
  const [messages, setMessages] = React.useState([
    { id: '0', role: 'assistant', content: WELCOME },
  ]);
  const [input, setInput] = React.useState('');
  const [uploading, setUploading] = React.useState(false);
  const [showSlashMenu, setShowSlashMenu] = React.useState(false);
  const [imageTypes, setImageTypes] = React.useState([]);
  const [selectedImageType, setSelectedImageType] = React.useState('');
  const [currentJob, setCurrentJob] = React.useState(null);
  const [parsedProducts, setParsedProducts] = React.useState(null);

  const selectedImageTypeRef = React.useRef('');
  const pendingFileRef = React.useRef(null);
  const bottomRef = React.useRef(null);
  const fileInputRef = React.useRef(null);
  const pollRef = React.useRef(null);
  const prevJobStatusRef = React.useRef(undefined);

  // Load image types on mount
  React.useEffect(() => {
    API.fetchImageTypes()
      .then(types => {
        setImageTypes(types);
        const first = types.find(t => t.exists);
        if (first) {
          setSelectedImageType(first.key);
          selectedImageTypeRef.current = first.key;
        }
      })
      .catch(() => {});
  }, []);

  const selectImageType = (key) => {
    setSelectedImageType(key);
    selectedImageTypeRef.current = key;
  };

  const addMsg = (msg) => {
    const m = { id: nextId(), ...msg };
    setMessages(prev => [...prev, m]);
    return m.id;
  };

  const replaceMsg = (id, patch) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, ...patch } : m));
  };

  const scrollBottom = () => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  // ── Poll compose job ───────────────────────────────────────────────────────
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

  // ── React to job status changes ────────────────────────────────────────────
  React.useEffect(() => {
    const status = currentJob?.status;
    const prev = prevJobStatusRef.current;
    prevJobStatusRef.current = status;

    if (status === 'done' && prev !== 'done') {
      const imgUrl = API.getImageUrl(currentJob.id);
      if (onResultUrl) onResultUrl(imgUrl);
      const editUrl = currentJob.penpot_edit_url;
      addMsg({
        role: 'assistant',
        content: '生图完成！结果已显示在预览区。',
        actions: [
          { label: '导出 PNG', handler: () => { addMsg({ role: 'user', content: '导出 PNG' }); doExportPng(imgUrl, currentJob.id); scrollBottom(); } },
          { label: '切九宫格', handler: () => { addMsg({ role: 'user', content: '切九宫格' }); doExportGrid(currentJob.id); scrollBottom(); } },
          ...(editUrl ? [{ label: '在 Penpot 中修改', handler: () => { window.open(editUrl, '_blank'); } }] : []),
        ],
      });
      scrollBottom();
    } else if (status === 'failed' && prev !== 'failed') {
      addMsg({ role: 'assistant', content: `生图失败：${currentJob.error || '未知错误'}` });
      scrollBottom();
    }
  }, [currentJob?.status]);

  // ── Send text ──────────────────────────────────────────────────────────────
  async function handleSend() {
    const text = input.trim();
    if (!text) return;
    setInput('');
    setShowSlashMenu(false);
    addMsg({ role: 'user', content: text });
    scrollBottom();

    if (text.startsWith('/')) {
      const cmd = text.split(' ')[0].toLowerCase();
      if (cmd === '/开始生图') { await doCompose(); }
      else if (cmd === '/导出png') { doExportPng(); }
      else if (cmd === '/切九宫格') { await doExportGrid(); }
      else {
        addMsg({ role: 'assistant', content: `未知指令：\`${text}\`\n\n可用指令：/开始生图、/导出PNG、/切九宫格` });
      }
      scrollBottom();
      return;
    }

    await handleTextCommand(text);
    scrollBottom();
  }

  async function handleTextCommand(text) {
    const lower = text.toLowerCase();
    if (lower.includes('导出') && lower.includes('九宫格')) { await doExportGrid(); return; }
    if (lower.includes('导出') || lower.includes('png'))   { doExportPng(); return; }
    if (lower.includes('生图') || lower.includes('合成') || lower.includes('生成') || lower.includes('开始')) { await doCompose(); return; }

    // General AI chat
    const history = messages
      .filter(m => m.content && (m.role === 'user' || m.role === 'assistant'))
      .slice(-10)
      .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
    history.push({ role: 'user', content: text });

    const ctx = {
      templateName: template?.name,
      templateSlotCount: template?.slots?.length,
      productCount: parsedProducts?.length,
      jobStatus: currentJob?.status,
      hasResult: currentJob?.status === 'done',
    };

    const thinkingId = addMsg({ role: 'assistant', content: '…' });
    scrollBottom();

    try {
      const reply = await API.chatWithAI(history, ctx);
      replaceMsg(thinkingId, { content: reply });
    } catch (e) {
      replaceMsg(thinkingId, { content: 'AI 暂时不可用，请检查后端是否启动或 API Key 是否配置。' });
    }
  }

  // ── File upload ────────────────────────────────────────────────────────────
  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    addMsg({ role: 'user', content: `上传了表格：${file.name}` });
    scrollBottom();

    if (imageTypes.length > 0) {
      pendingFileRef.current = file;
      addMsg({
        role: 'assistant',
        content: '请选择本次生图使用的**图片类型**，系统将从对应素材文件夹匹配产品图：',
        actions: [{
          label: '确认解析',
          primary: true,
          handler: () => doParseWithType(pendingFileRef.current),
        }],
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
    const currentType = selectedImageTypeRef.current;

    const thinkingId = addMsg({ role: 'assistant', content: '正在读取表格…' });
    scrollBottom();

    try {
      const result = await API.parseTable(
        file,
        requiredFields.length > 0 ? requiredFields : undefined,
        currentType || undefined,
      );
      replaceMsg(thinkingId, { content: '正在匹配产品图库…' });
      scrollBottom();
      await new Promise(r => setTimeout(r, 600));
      await handleParseResult(result);
      replaceMsg(thinkingId, { content: null }); // hide loading msg
    } catch (err) {
      replaceMsg(thinkingId, { content: `解析失败：${String(err)}` });
    } finally {
      setUploading(false);
      scrollBottom();
    }
  }

  async function handleParseResult(result) {
    const products = result.products;
    setParsedProducts(products);

    // Put products into slot format
    products.forEach((p, i) => {
      // store locally for compose step
    });

    const imgMatched = products.filter(p => p.image_path).length;
    const imgMissed = products.length - imgMatched;
    const total = products.length;

    const templateProductCount = template
      ? new Set((template.slots || []).map(s => s.name.split('/')[1]).filter(Boolean)).size
      : 0;

    let lead = '';
    if (!template) {
      lead = `分析完成，识别到 ${total} 款产品，图片匹配了 ${imgMatched} 张。记得在左侧选一个模板，然后就可以生图了。`;
    } else {
      const countMatch = templateProductCount === total;
      const allImg = imgMissed === 0;
      if (countMatch && allImg) {
        lead = `好的，${total} 款产品和「${template.name}」完全匹配，图片也全部找到了，可以直接生图。`;
      } else if (countMatch && !allImg) {
        lead = `${total} 款产品和模板数量吻合，不过有 ${imgMissed} 张图没找到，生图时那几个位置会留空。`;
      } else {
        const diff = total - templateProductCount;
        lead = diff > 0
          ? `表格有 ${total} 款，模板只有 ${templateProductCount} 个位置，我会用前 ${templateProductCount} 款来生图。`
          : `模板需要 ${templateProductCount} 款产品，表格只提供了 ${total} 款，剩余位置留空处理。`;
      }
    }

    addMsg({
      role: 'assistant',
      content: lead,
      actions: [{
        label: '开始生图',
        primary: true,
        handler: () => {
          addMsg({ role: 'user', content: '开始生图' });
          doCompose(products);
          scrollBottom();
        },
      }],
      extra: { type: 'parse-result', products, imgMatched, imgMissed },
    });
  }

  // ── Compose ────────────────────────────────────────────────────────────────
  async function doCompose(products) {
    const prods = products || parsedProducts;

    if (!template) {
      addMsg({ role: 'assistant', content: '请先在左侧选择一个模板。' });
      return;
    }
    if (!prods || prods.length === 0) {
      addMsg({ role: 'assistant', content: '还没有填入产品信息，请先上传需求表格。' });
      return;
    }

    const slots = {};
    prods.forEach((p, i) => {
      slots[`product_${i + 1}`] = {
        image_path: p.image_path ?? null,
        name: p.name ?? null,
        price: p.price ?? null,
        tag: p.tag ?? null,
        spec: p.spec ?? null,
      };
    });

    const req = {
      file_id: template.file_id,
      template_frame_id: template.id,
      page_id: template.page_id,
      slots,
      export_scale: 2,
    };

    addMsg({ role: 'assistant', content: 'AI 正在生图，请稍候…\n\n中间预览区实时显示进度。' });
    scrollBottom();

    try {
      const job = await API.createCompose(req);
      setCurrentJob(job);
      if (onJobUpdate) onJobUpdate(job);
      addMsg({
        role: 'assistant',
        content: `生图任务已启动\n\n任务 ID：\`${job.id.slice(0, 8)}\`，完成后自动显示结果。`,
      });
    } catch (err) {
      addMsg({ role: 'assistant', content: `生图启动失败：${String(err)}` });
    }
    scrollBottom();
  }

  // ── Export PNG ─────────────────────────────────────────────────────────────
  function doExportPng(urlOverride, jobIdOverride) {
    const url = urlOverride || (currentJob?.status === 'done' ? API.getImageUrl(currentJob.id) : null);
    const jobId = jobIdOverride || currentJob?.id;
    if (!url) {
      addMsg({ role: 'assistant', content: '还没有完成的生图结果，请先生图。' });
      return;
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = `result_${(jobId || 'img').slice(0, 8)}.png`;
    a.click();
    addMsg({ role: 'assistant', content: 'PNG 下载已开始。' });
  }

  // ── Export grid ────────────────────────────────────────────────────────────
  async function doExportGrid(jobIdOverride) {
    const jobId = jobIdOverride || currentJob?.id;
    const jobStatus = jobIdOverride ? 'done' : currentJob?.status;
    if (!jobId || jobStatus !== 'done') {
      addMsg({ role: 'assistant', content: '请先完成生图，再切九宫格。' });
      return;
    }
    addMsg({ role: 'assistant', content: '正在切九宫格…' });
    scrollBottom();
    try {
      const result = await API.exportGrid(jobId, 3, 3);
      const urls = (result.files || []).map((_, i) => API.getGridCellUrl(result.job_id || jobId, i));
      addMsg({
        role: 'assistant',
        content: `九宫格已生成，共 ${urls.length} 张，可在中栏预览或点击下载。`,
        actions: urls.map((url, i) => ({
          label: `下载第${i + 1}格`,
          handler: () => {
            const a = document.createElement('a');
            a.href = url;
            a.download = `grid_${i + 1}.png`;
            a.click();
          },
        })),
      });
    } catch (err) {
      addMsg({ role: 'assistant', content: `切图失败：${String(err)}` });
    }
    scrollBottom();
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--panel)', borderLeft: '1px solid var(--line)',
    }}>
      {/* Header */}
      <div style={{
        height: 44, flexShrink: 0,
        display: 'flex', alignItems: 'center',
        padding: '0 14px', gap: 8,
        borderBottom: '1px solid var(--line)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{
            width: 7, height: 7, borderRadius: 99,
            background: uploading || (currentJob?.status === 'pending' || currentJob?.status === 'running')
              ? 'var(--accent)' : 'var(--ok)',
            animation: (uploading || currentJob?.status === 'running') ? 'pulse 1.2s ease-in-out infinite' : 'none',
          }}/>
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em' }}>AI 助手</span>
          <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>
            {uploading ? '解析中…'
              : currentJob?.status === 'running' ? '生图中…'
              : parsedProducts ? `${parsedProducts.length} 款产品`
              : '就绪'}
          </span>
        </div>
        <div style={{ flex: 1 }}/>
        {parsedProducts && (
          <span className="mono" style={{
            fontSize: 9.5, color: 'var(--ok)',
            padding: '2px 6px', borderRadius: 4,
            background: 'oklch(0.95 0.04 155)',
            border: '1px solid oklch(0.88 0.06 155)',
          }}>{parsedProducts.length} 款产品已载入</span>
        )}
        <button onClick={() => {
          setMessages([{ id: '0', role: 'assistant', content: WELCOME }]);
          setParsedProducts(null);
          setCurrentJob(null);
          setInput('');
        }} style={{ padding: 5, borderRadius: 5, color: 'var(--ink-3)' }} title="清空对话">
          <I.refresh size={13}/>
        </button>
        <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 8px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.filter(m => m.content !== null).map(msg => (
          <MsgBubble
            key={msg.id}
            msg={msg}
            imageTypes={imageTypes}
            selectedImageType={selectedImageType}
            onSelectImageType={selectImageType}
          />
        ))}
        <div ref={bottomRef}/>
      </div>

      {/* Input area */}
      <div style={{
        flexShrink: 0, padding: '10px 12px',
        borderTop: '1px solid var(--line)',
        background: 'var(--panel)',
        position: 'relative',
      }}>
        {/* Slash menu */}
        {showSlashMenu && (
          <SlashMenuInline
            input={input}
            onPick={(cmd) => { setInput(cmd); setShowSlashMenu(false); }}
          />
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          {/* Upload button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            title="上传需求表格 (.xlsx / .csv)"
            style={{
              width: 32, height: 32, borderRadius: 7, flexShrink: 0,
              background: 'var(--panel-2)', border: '1px solid var(--line)',
              color: 'var(--ink-2)', display: 'grid', placeItems: 'center',
              opacity: uploading ? 0.5 : 1,
            }}
          >
            {uploading
              ? <div style={{ width: 14, height: 14, borderRadius: 99, border: '2px solid var(--line-2)', borderTopColor: 'var(--accent)', animation: 'spin 0.8s linear infinite' }}/>
              : <I.paperclip size={14}/>
            }
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

          {/* Text input */}
          <input
            value={input}
            onChange={e => {
              const v = e.target.value;
              setInput(v);
              setShowSlashMenu(v.startsWith('/'));
            }}
            onKeyDown={e => {
              if (e.key === 'Escape') { setShowSlashMenu(false); return; }
              if (e.key === 'Enter') { e.preventDefault(); handleSend(); }
            }}
            onBlur={() => setTimeout(() => setShowSlashMenu(false), 150)}
            placeholder="输入指令或 / 触发快捷命令…"
            style={{
              flex: 1, height: 32,
              padding: '0 10px', borderRadius: 7,
              border: '1px solid var(--line)',
              background: 'var(--panel-2)',
              fontSize: 12.5, color: 'var(--ink)',
              outline: 'none',
            }}
          />

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            style={{
              height: 32, padding: '0 14px', borderRadius: 7, flexShrink: 0,
              background: input.trim() ? 'var(--ink)' : 'var(--line)',
              color: input.trim() ? 'white' : 'var(--ink-3)',
              fontSize: 12.5, fontWeight: 500,
              transition: 'background 120ms',
            }}
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
};

window.Chat = Chat;

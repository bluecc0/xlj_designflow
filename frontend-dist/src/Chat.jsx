// AI chat panel
// UI: 原版 Loom Design Studio 风格（ChatEmpty, MessageList, Composer, ProgressBadge, FileChip）
// Logic: 完整 ChatPanel.tsx 逻辑（parseTable → imageType → compose → poll → export）

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

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

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

// ─── UI primitives ────────────────────────────────────────────────────────────

const Avatar = ({ who }) => (
  who === 'ai' ? (
    <div style={{
      width: 24, height: 24, borderRadius: 7, flexShrink: 0,
      background: 'linear-gradient(135deg, var(--ink), oklch(0.3 0.08 275))',
      color: 'white', display: 'grid', placeItems: 'center',
    }}>
      <I.sparkles size={12} stroke={2}/>
    </div>
  ) : (
    <div style={{
      width: 24, height: 24, borderRadius: 7, flexShrink: 0,
      background: 'oklch(0.82 0.07 200)', color: 'oklch(0.3 0.05 200)',
      fontSize: 10, fontWeight: 600,
      display: 'grid', placeItems: 'center',
    }}>U</div>
  )
);

const Bubble = ({ who, children, meta }) => (
  <div style={{
    display: 'flex', gap: 10, alignItems: 'flex-start',
    flexDirection: who === 'user' ? 'row-reverse' : 'row',
  }}>
    <Avatar who={who}/>
    <div style={{ maxWidth: 'calc(100% - 38px)', display: 'flex', flexDirection: 'column', gap: 6, alignItems: who === 'user' ? 'flex-end' : 'flex-start' }}>
      {meta && <div className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{meta}</div>}
      {children}
    </div>
  </div>
);

const TextBubble = ({ who, children }) => (
  <div style={{
    fontSize: 12.5, lineHeight: 1.55,
    padding: '9px 12px', borderRadius: 10,
    background: who === 'user' ? 'var(--ink)' : 'var(--panel)',
    color: who === 'user' ? 'white' : 'var(--ink)',
    border: who === 'user' ? 'none' : '1px solid var(--line-2)',
    maxWidth: '100%', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  }}>{children}</div>
);

const FileChip = ({ name, size, onRemove }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '4px 6px 4px 8px', borderRadius: 6,
    background: 'var(--panel)', border: '1px solid var(--line-2)',
    fontSize: 11,
  }}>
    <I.file size={11} style={{ color: 'var(--ink-3)' }}/>
    <span style={{ fontWeight: 500 }}>{name}</span>
    <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 9.5 }}>{size}</span>
    {onRemove && (
      <button onClick={onRemove} style={{ padding: 2, color: 'var(--ink-3)' }}>
        <I.close size={11}/>
      </button>
    )}
  </div>
);

const ProgressBadge = ({ lines }) => {
  const last = lines[lines.length - 1] || '正在启动…';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 12px', borderRadius: 10, width: '100%',
      background: 'var(--panel)', border: '1px solid var(--line-2)',
      fontSize: 12,
    }}>
      <div style={{ width: 14, height: 14, borderRadius: 99, border: '2px solid var(--line-2)', borderTopColor: 'var(--accent)', animation: 'spin 0.8s linear infinite', flexShrink: 0 }}/>
      <span style={{ flex: 1, color: 'var(--ink-2)', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{last}</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

// Parse result card
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

// ─── Empty state ──────────────────────────────────────────────────────────────

const ChatEmpty = ({ onQuickAction }) => {
  const prompts = [
    { icon: <I.image size={13}/>, text: '上传产品需求表格（Excel/CSV）' },
    { icon: <I.zap size={13}/>,   text: '/开始生图' },
    { icon: <I.download size={13}/>, text: '/导出PNG' },
    { icon: <I.grid size={13}/>,  text: '/切九宫格' },
  ];
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px' }}>
      <div style={{ padding: '20px 4px 16px', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
        <div style={{
          width: 40, height: 40, borderRadius: 11,
          background: 'linear-gradient(135deg, var(--ink), oklch(0.3 0.08 275))',
          color: 'white', display: 'grid', placeItems: 'center',
        }}>
          <I.sparkles size={18} stroke={1.8}/>
        </div>
        <div className="serif" style={{ fontSize: 19, letterSpacing: '-0.01em' }}>AI 生图助手</div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'center', maxWidth: 240, lineHeight: 1.5 }}>
          选择模板，上传产品表格，或直接对话
        </div>
      </div>
      <div className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '12px 4px 6px' }}>快捷操作</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {prompts.map((p, i) => (
          <button key={i} onClick={() => onQuickAction && onQuickAction(p.text)} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 12px', borderRadius: 8,
            background: 'var(--panel)', border: '1px solid var(--line-2)',
            fontSize: 12, color: 'var(--ink-2)', textAlign: 'left',
          }}>
            <span style={{ color: 'var(--ink-3)' }}>{p.icon}</span>
            <span style={{ flex: 1 }}>{p.text}</span>
            <I.arrowRight size={12} style={{ color: 'var(--ink-3)' }}/>
          </button>
        ))}
      </div>
    </div>
  );
};

// ─── Message list ─────────────────────────────────────────────────────────────

const MessageList = ({ messages }) => {
  const bottomRef = React.useRef(null);
  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, messages[messages.length - 1]?.content]);

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {messages.map((msg) => {
        const who = msg.role === 'ai' ? 'ai' : 'user';
        return (
          <Bubble key={msg.id} who={who} meta={msg.meta}>
            {msg.file && <FileChip name={msg.file.name} size={formatSize(msg.file.size)}/>}
            {msg.content && <TextBubble who={who}>{msg.content}</TextBubble>}
            {msg.progress && <ProgressBadge lines={msg.progress}/>}
            {msg.extra?.type === 'parse-result' && (
              <ParseCard products={msg.extra.products} imgMatched={msg.extra.imgMatched} imgMissed={msg.extra.imgMissed}/>
            )}
            {msg.extra?.type === 'image-type-selector' && msg._imageTypesMeta && (
              <ImageTypeSelector
                types={msg._imageTypesMeta.types}
                selected={msg._imageTypesMeta.selected}
                onSelect={msg._imageTypesMeta.onSelect}
              />
            )}
            {msg.resultUrl && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
                <img src={msg.resultUrl} alt="合成结果" style={{ borderRadius: 8, maxWidth: '100%', border: '1px solid var(--line-2)' }}/>
                <div style={{ display: 'flex', gap: 6 }}>
                  <a href={msg.resultUrl} download style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                    fontSize: 11, fontWeight: 500, padding: '7px', borderRadius: 7,
                    background: 'var(--ink)', color: 'white', textDecoration: 'none',
                  }}>
                    <I.download size={12}/>下载 PNG
                  </a>
                  {msg.penpotUrl && (
                    <a href={msg.penpotUrl} target="_blank" rel="noreferrer" style={{
                      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                      fontSize: 11, padding: '7px', borderRadius: 7,
                      background: 'var(--panel)', color: 'var(--ink-2)',
                      border: '1px solid var(--line)', textDecoration: 'none',
                    }}>
                      在 Penpot 中修改
                    </a>
                  )}
                </div>
              </div>
            )}
            {msg.actions && msg.actions.length > 0 && (
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {msg.actions.map((a, i) => (
                  <button key={i} onClick={a.handler} style={{
                    fontSize: 11, padding: '4px 10px', borderRadius: 99,
                    color: a.primary ? 'white' : 'var(--ink-2)',
                    background: a.primary ? 'var(--accent)' : 'var(--panel)',
                    border: a.primary ? 'none' : '1px solid var(--line)',
                    fontWeight: a.primary ? 500 : 400,
                  }}>{a.label}</button>
                ))}
              </div>
            )}
          </Bubble>
        );
      })}
      <div ref={bottomRef}/>
    </div>
  );
};

// ─── Slash menu (inside Composer) ─────────────────────────────────────────────

const SLASH_COMMANDS_COMPOSER = [
  { cmd: '/开始生图',  desc: '启动 AI 生图任务' },
  { cmd: '/导出PNG',   desc: '下载生图结果图片' },
  { cmd: '/切九宫格',  desc: '将结果裁切为九宫格' },
];

const SlashMenu = ({ query, onPick, onClose }) => {
  const q = (query || '').slice(1).toLowerCase();
  const filtered = SLASH_COMMANDS_COMPOSER.filter(c =>
    !q || c.cmd.slice(1).toLowerCase().includes(q)
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
        <span>↑↓ 选择 · ⏎ 确认 · esc 关闭</span>
      </div>
      {filtered.map(c => (
        <button key={c.cmd} onMouseDown={e => { e.preventDefault(); onPick(c); }} style={{
          width: '100%', textAlign: 'left',
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 12px', borderBottom: '1px solid var(--line-2)',
          transition: 'background 80ms',
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-soft)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
          <div>
            <div className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-ink)' }}>{c.cmd}</div>
            <div style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{c.desc}</div>
          </div>
        </button>
      ))}
    </div>
  );
};

// ─── Composer ─────────────────────────────────────────────────────────────────

const Composer = ({ onSend, onFileUpload, disabled }) => {
  const [text, setText] = React.useState('');
  const [files, setFiles] = React.useState([]);
  const taRef = React.useRef(null);
  const fileInputRef = React.useRef(null);

  const slashQuery = React.useMemo(() => {
    const m = text.match(/^\/\S*/);
    return m ? m[0] : null;
  }, [text]);

  const pickCommand = (c) => {
    setText(c.cmd + ' ');
    setTimeout(() => taRef.current?.focus(), 0);
  };

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed && files.length === 0) return;
    onSend(trimmed, files);
    setText('');
    setFiles([]);
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    if (e.key === 'Escape') setText('');
  };

  const handleFileChange = (e) => {
    const picked = Array.from(e.target.files || []);
    setFiles(prev => [...prev, ...picked]);
    if (onFileUpload) onFileUpload(picked);
    e.target.value = '';
  };

  return (
    <div style={{
      flexShrink: 0, padding: 12,
      borderTop: '1px solid var(--line)',
      background: 'var(--panel)',
      position: 'relative',
    }}>
      <div style={{
        borderRadius: 12,
        border: slashQuery ? '1px solid var(--accent)' : '1px solid var(--line)',
        background: 'var(--panel-2)',
        padding: 10,
        display: 'flex', flexDirection: 'column', gap: 8,
        boxShadow: slashQuery ? '0 0 0 4px var(--accent-soft), var(--shadow-1)' : 'var(--shadow-1)',
        transition: 'box-shadow 150ms, border-color 150ms',
        position: 'relative',
      }}>
        {slashQuery && (
          <SlashMenu query={slashQuery} onPick={pickCommand} onClose={() => setText('')}/>
        )}

        {files.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {files.map((f, i) => (
              <FileChip key={i} name={f.name} size={formatSize(f.size)}
                onRemove={() => setFiles(fs => fs.filter((_, j) => j !== i))}/>
            ))}
          </div>
        )}

        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKey}
          placeholder="对话，或输入 / 使用指令…"
          rows={2}
          disabled={disabled}
          style={{
            border: 'none', outline: 'none', resize: 'none',
            background: 'transparent',
            fontSize: 13, lineHeight: 1.45, color: 'var(--ink)',
            fontFamily: 'inherit',
            opacity: disabled ? 0.5 : 1,
          }}
        />

        {!slashQuery && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: -2 }}>
            {['/开始生图', '/导出PNG', '/切九宫格'].map(s => (
              <button key={s} onClick={() => setText(s + ' ')} style={{
                fontSize: 10, padding: '2px 7px', borderRadius: 99,
                color: 'var(--accent-ink)', background: 'var(--accent-soft)',
                fontFamily: 'JetBrains Mono, monospace',
              }}>{s}</button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            style={{ padding: 6, borderRadius: 6, color: 'var(--ink-2)', opacity: disabled ? 0.5 : 1 }}
            title="上传文件"
          >
            <I.paperclip size={14}/>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            multiple
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />

          <div style={{ flex: 1 }}/>

          <button
            onClick={handleSend}
            disabled={disabled || (!text.trim() && files.length === 0)}
            style={{
              width: 30, height: 30, borderRadius: 8,
              background: (!disabled && (text.trim() || files.length)) ? 'var(--ink)' : 'var(--line)',
              color: (!disabled && (text.trim() || files.length)) ? 'white' : 'var(--ink-3)',
              display: 'grid', placeItems: 'center',
              transition: 'background 120ms',
            }}
          >
            <I.arrowUp size={14} stroke={2.2}/>
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Main Chat component ──────────────────────────────────────────────────────

let msgIdCounter = 1;
const nextId = () => String(msgIdCounter++);

const Chat = ({ template, onJobUpdate, onResultUrl }) => {
  const [messages, setMessages] = React.useState([]);
  const [sending, setSending] = React.useState(false);
  const [parsedProducts, setParsedProducts] = React.useState(null);
  const [currentJob, setCurrentJob] = React.useState(null);
  const [imageTypes, setImageTypes] = React.useState([]);
  const [selectedImageType, setSelectedImageType] = React.useState('');

  const selectedTypeRef = React.useRef('');
  const pendingFileRef = React.useRef(null);
  const pollRef = React.useRef(null);

  const addMsg = (msg) => {
    const m = { id: nextId(), ...msg };
    setMessages(prev => [...prev, m]);
    return m.id;
  };
  const updateMsg = (id, patch) => setMessages(prev => prev.map(m => m.id === id ? { ...m, ...patch } : m));

  // Load image types on mount
  React.useEffect(() => {
    API.fetchImageTypes().then(types => {
      setImageTypes(types);
      const first = types.find(t => t.exists);
      if (first) { setSelectedImageType(first.key); selectedTypeRef.current = first.key; }
    }).catch(() => {});
  }, []);

  const setType = (k) => { setSelectedImageType(k); selectedTypeRef.current = k; };

  // ── Poll job status ────────────────────────────────────────────────────────
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

        // Update progress bubble
        const friendlyLines = (updated.progress || []).map(friendlyProgress).filter(Boolean);
        setMessages(prev => prev.map(m =>
          m.jobId === updated.id ? { ...m, progress: friendlyLines } : m
        ));

        if (updated.status === 'done') {
          const imgUrl = API.getImageUrl(updated.id);
          if (onResultUrl) onResultUrl(imgUrl);
          clearInterval(pollRef.current);
          setMessages(prev => prev.map(m =>
            m.jobId === updated.id
              ? { ...m, progress: null, content: '生图完成！', resultUrl: imgUrl, penpotUrl: updated.penpot_edit_url }
              : m
          ));
          setSending(false);
        } else if (updated.status === 'failed') {
          clearInterval(pollRef.current);
          setMessages(prev => prev.map(m =>
            m.jobId === updated.id
              ? { ...m, progress: null, content: `生图失败：${updated.error || '未知错误'}` }
              : m
          ));
          setSending(false);
        }
      } catch { /* network blip */ }
    }, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [currentJob?.id, currentJob?.status]);

  // ── Handle /开始生图 ────────────────────────────────────────────────────────
  const handleGenerate = async (products) => {
    const prods = products || parsedProducts;
    if (!template) {
      addMsg({ role: 'ai', content: '请先在左侧选择一个模板。' });
      return;
    }
    if (!prods || prods.length === 0) {
      addMsg({ role: 'ai', content: '请先上传产品需求表格（Excel 或 CSV），解析后再生图。' });
      return;
    }

    setSending(true);

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

    try {
      const job = await API.createCompose(req);
      setCurrentJob(job);
      if (onJobUpdate) onJobUpdate(job);
      addMsg({ role: 'ai', content: null, progress: ['正在启动…'], jobId: job.id, meta: 'Loom · generating' });
    } catch (e) {
      addMsg({ role: 'ai', content: `启动失败：${e.message}` });
      setSending(false);
    }
  };

  // ── Handle /导出PNG ─────────────────────────────────────────────────────────
  const handleExportPng = () => {
    if (!currentJob || currentJob.status !== 'done') {
      addMsg({ role: 'ai', content: '还没有完成的生图任务，请先运行 /开始生图。' });
      return;
    }
    const url = API.getImageUrl(currentJob.id);
    const a = document.createElement('a');
    a.href = url;
    a.download = `result_${currentJob.id.slice(0, 8)}.png`;
    a.click();
    addMsg({ role: 'ai', content: 'PNG 下载已开始。' });
  };

  // ── Handle /切九宫格 ────────────────────────────────────────────────────────
  const handleGrid = async (rows = 3, cols = 3) => {
    if (!currentJob || currentJob.status !== 'done') {
      addMsg({ role: 'ai', content: '请先完成生图（/开始生图），再切九宫格。' });
      return;
    }
    setSending(true);
    addMsg({ role: 'ai', content: `正在切 ${rows}×${cols} 九宫格…` });
    try {
      const res = await API.exportGrid(currentJob.id, rows, cols);
      const urls = (res.files || []).map((_, i) => API.getGridCellUrl(res.job_id || currentJob.id, i));
      addMsg({
        role: 'ai',
        content: `切好了，共 ${urls.length} 格：`,
        actions: urls.map((url, i) => ({
          label: `下载第 ${i + 1} 格`,
          handler: () => { const a = document.createElement('a'); a.href = url; a.download = `grid_${i+1}.png`; a.click(); },
        })),
      });
    } catch (e) {
      addMsg({ role: 'ai', content: `切图失败：${e.message}` });
    } finally {
      setSending(false);
    }
  };

  // ── File upload (CSV/Excel) ─────────────────────────────────────────────────
  const handleFileUpload = async (files) => {
    const tableFile = files.find(f => /\.(xlsx|xls|csv)$/i.test(f.name));
    if (!tableFile) return;

    pendingFileRef.current = tableFile;

    if (imageTypes.length > 0) {
      // Ask user to pick image type first
      const msgId = addMsg({
        role: 'ai',
        content: '请选择本次生图使用的图片类型，系统将从对应素材文件夹匹配产品图：',
        extra: {
          type: 'image-type-selector',
        },
        _imageTypesMeta: {
          types: imageTypes,
          selected: selectedImageType,
          onSelect: setType,
        },
        actions: [{
          label: '确认解析',
          primary: true,
          handler: () => doParseWithType(pendingFileRef.current),
        }],
      });
    } else {
      // No image types configured, parse directly
      await doParseWithType(tableFile);
    }
  };

  const doParseWithType = async (file) => {
    setSending(true);
    const requiredFields = deriveRequiredFields(template);
    const currentType = selectedTypeRef.current;
    const thinkingId = addMsg({ role: 'ai', content: '正在解析表格…' });

    try {
      const result = await API.parseTable(
        file,
        requiredFields.length ? requiredFields : undefined,
        currentType || undefined
      );
      updateMsg(thinkingId, { content: '正在匹配产品图库…' });
      await new Promise(r => setTimeout(r, 600));

      const products = result.products;
      setParsedProducts(products);

      const imgMatched = products.filter(p => p.image_path).length;
      const imgMissed = products.length - imgMatched;
      const total = products.length;
      const tplCount = template
        ? new Set((template.slots || []).map(s => s.name.split('/')[1]).filter(Boolean)).size
        : 0;

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

      updateMsg(thinkingId, {
        content: lead,
        extra: { type: 'parse-result', products, imgMatched, imgMissed },
        actions: [{
          label: '/开始生图',
          primary: true,
          handler: () => {
            addMsg({ role: 'user', content: '/开始生图' });
            handleGenerate(products);
          },
        }],
      });
    } catch (e) {
      updateMsg(thinkingId, { content: `解析失败：${e.message}` });
    } finally {
      setSending(false);
    }
  };

  // ── Handle text + slash commands ────────────────────────────────────────────
  const handleSend = async (text, files) => {
    // File uploads from Composer
    if (files && files.length > 0) {
      await handleFileUpload(files);
      if (!text.trim()) return;
    }

    if (!text.trim()) return;

    const lower = text.trim().toLowerCase();

    if (lower.startsWith('/开始生图') || lower.startsWith('/generate')) {
      addMsg({ role: 'user', content: text });
      await handleGenerate();
      return;
    }
    if (lower.startsWith('/导出png') || lower.startsWith('/export')) {
      addMsg({ role: 'user', content: text });
      handleExportPng();
      return;
    }
    if (lower.startsWith('/切九宫格') || lower.startsWith('/grid')) {
      addMsg({ role: 'user', content: text });
      const m = text.match(/(\d+)\s*[x×]\s*(\d+)/);
      await handleGrid(m ? parseInt(m[1]) : 3, m ? parseInt(m[2]) : 3);
      return;
    }

    // Keyword shortcuts
    if (lower.includes('生图') || lower.includes('合成') || lower.includes('开始')) {
      addMsg({ role: 'user', content: text });
      await handleGenerate();
      return;
    }
    if (lower.includes('导出') && lower.includes('九宫格')) {
      addMsg({ role: 'user', content: text });
      await handleGrid();
      return;
    }
    if (lower.includes('导出') || lower.includes('png')) {
      addMsg({ role: 'user', content: text });
      handleExportPng();
      return;
    }

    // Regular AI chat
    addMsg({ role: 'user', content: text });
    setSending(true);
    const thinkingId = addMsg({ role: 'ai', content: '…' });

    try {
      const history = messages
        .filter(m => m.content && (m.role === 'user' || m.role === 'ai'))
        .slice(-10)
        .map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content }));
      history.push({ role: 'user', content: text });

      const context = {
        templateName: template?.name,
        templateSlotCount: template?.slots?.length,
        productCount: parsedProducts?.length,
        jobStatus: currentJob?.status,
        hasResult: currentJob?.status === 'done',
      };
      const reply = await API.chatWithAI(history, context);
      updateMsg(thinkingId, { content: reply });
    } catch (e) {
      updateMsg(thinkingId, { content: `出错了：${e.message}` });
    } finally {
      setSending(false);
    }
  };

  const isEmpty = messages.length === 0;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--panel)',
      borderLeft: '1px solid var(--line)',
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
            background: sending ? 'var(--accent)' : 'var(--ok)',
            animation: sending ? 'pulse 1.2s ease-in-out infinite' : 'none',
          }}/>
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em' }}>Loom</span>
          <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>
            {sending ? 'working…' : parsedProducts ? `${parsedProducts.length} products` : 'ready'}
          </span>
        </div>
        <div style={{ flex: 1 }}/>
        {parsedProducts && (
          <span className="mono" style={{
            fontSize: 9.5, color: 'var(--ok)',
            padding: '2px 6px', borderRadius: 4,
            background: 'oklch(0.95 0.04 155)', border: '1px solid oklch(0.88 0.06 155)',
          }}>{parsedProducts.length} products loaded</span>
        )}
        <button
          onClick={() => { setMessages([]); setParsedProducts(null); setCurrentJob(null); }}
          style={{ padding: 5, borderRadius: 5, color: 'var(--ink-3)' }}
          title="清空对话"
        ><I.refresh size={13}/></button>
        <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
      </div>

      {/* Body */}
      {isEmpty
        ? <ChatEmpty onQuickAction={(t) => {
            if (t.startsWith('/')) {
              handleSend(t, []);
            } else {
              // file upload prompt — focus composer
            }
          }}/>
        : <MessageList messages={messages}/>
      }

      {/* Composer */}
      <Composer
        onSend={handleSend}
        onFileUpload={handleFileUpload}
        disabled={sending}
      />
    </div>
  );
};

window.Chat = Chat;

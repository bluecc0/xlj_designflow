// AI chat column. Three states: empty / generating / returned.
// UI: 原版 dist/src/Chat.jsx 完整保留（所有组件不改）
// Logic: 真实后端接入（parseTable, compose, poll, export）

// ---------- Sub-components ----------

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
    maxWidth: '100%',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  }}>{children}</div>
);

const FileCard = ({ name, size, type }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '8px 12px', borderRadius: 8,
    background: 'var(--panel)', border: '1px solid var(--line-2)',
    fontSize: 12, minWidth: 200,
  }}>
    <div style={{
      width: 32, height: 40, borderRadius: 4,
      background: `repeating-linear-gradient(135deg, oklch(0.95 0.02 40) 0 4px, oklch(0.92 0.03 40) 4px 8px)`,
      border: '1px solid var(--line-2)',
      display: 'grid', placeItems: 'center',
      color: 'oklch(0.5 0.05 40)',
    }}>
      <I.image size={14}/>
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
      <div className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>{type} · {size}</div>
    </div>
  </div>
);

const ThinkingTrace = ({ steps, done }) => {
  const [expanded, setExpanded] = React.useState(false);
  return (
    <div style={{
      borderRadius: 10, border: '1px solid var(--line-2)',
      background: 'var(--panel-2)',
      overflow: 'hidden',
      width: '100%',
    }}>
      <button onClick={() => setExpanded(e => !e)} style={{
        width: '100%', textAlign: 'left',
        padding: '8px 11px',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <I.chevronRight size={11} style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }}/>
        <span style={{ fontSize: 11.5, fontWeight: 500 }}>{done ? `已完成 ${steps.length} 步` : '处理中…'}</span>
        {!done && <span style={{ width: 6, height: 6, borderRadius: 99, background: 'var(--accent)', animation: 'pulse 1.2s ease-in-out infinite' }}/>}
      </button>
      {expanded && (
        <div style={{ padding: '2px 11px 10px 28px', borderTop: '1px solid var(--line-2)' }}>
          {steps.map((s, i) => (
            <div key={i} style={{ fontSize: 11.5, color: 'var(--ink-2)', padding: '5px 0', display: 'flex', gap: 8 }}>
              <span className="mono" style={{ color: 'var(--ink-3)', minWidth: 14 }}>{i + 1}</span>
              <span>{s}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const OptionChips = ({ title, options, multi }) => {
  const [picked, setPicked] = React.useState(multi ? [options[0]] : options[0]);
  const isPicked = (o) => multi ? picked.includes(o) : picked === o;
  const toggle = (o) => {
    if (multi) setPicked(p => p.includes(o) ? p.filter(x => x !== o) : [...p, o]);
    else setPicked(o);
  };
  return (
    <div style={{
      borderRadius: 10, padding: 12, width: '100%',
      background: 'var(--panel)', border: '1px solid var(--line-2)',
    }}>
      <div style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--ink)', marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {options.map(o => (
          <button key={o} onClick={() => toggle(o)} style={{
            fontSize: 11.5, padding: '4px 10px', borderRadius: 99,
            background: isPicked(o) ? 'var(--ink)' : 'var(--panel-2)',
            color: isPicked(o) ? 'white' : 'var(--ink-2)',
            border: '1px solid',
            borderColor: isPicked(o) ? 'var(--ink)' : 'var(--line-2)',
            transition: 'all 100ms',
          }}>{o}</button>
        ))}
      </div>
    </div>
  );
};

const ColorPalette = ({ palettes }) => {
  const [picked, setPicked] = React.useState(0);
  return (
    <div style={{
      borderRadius: 10, padding: 12, width: '100%',
      background: 'var(--panel)', border: '1px solid var(--line-2)',
    }}>
      <div style={{ fontSize: 11.5, fontWeight: 500, marginBottom: 8 }}>选择配色方案</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {palettes.map((p, i) => (
          <button key={i} onClick={() => setPicked(i)} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: 6, borderRadius: 7,
            background: picked === i ? 'var(--accent-soft)' : 'transparent',
            border: picked === i ? '1px solid var(--accent)' : '1px solid transparent',
            textAlign: 'left',
          }}>
            <div style={{ display: 'flex', borderRadius: 5, overflow: 'hidden', border: '1px solid rgba(0,0,0,0.05)' }}>
              {p.colors.map(c => (
                <div key={c} style={{ width: 18, height: 22, background: c }}/>
              ))}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11.5, fontWeight: 500 }}>{p.name}</div>
              <div className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)' }}>{p.tag}</div>
            </div>
            {picked === i && <I.check size={13} stroke={2.2} style={{ color: 'var(--accent)' }}/>}
          </button>
        ))}
      </div>
    </div>
  );
};

const ActionBtns = ({ primary, secondary, onPrimary, onSecondary }) => (
  <div style={{ display: 'flex', gap: 6, width: '100%' }}>
    <button onClick={onPrimary} style={{
      flex: 1, fontSize: 12, fontWeight: 500,
      padding: '9px 12px', borderRadius: 8,
      background: 'var(--accent)', color: 'white',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      boxShadow: '0 1px 0 rgba(255,255,255,0.2) inset, 0 2px 8px oklch(0.55 0.22 275 / 0.25)',
    }}>
      <I.zap size={13} fill="white" stroke={0}/>
      {primary}
    </button>
    {secondary && (
      <button onClick={onSecondary} style={{
        fontSize: 12, padding: '9px 12px', borderRadius: 8,
        background: 'var(--panel)', color: 'var(--ink-2)',
        border: '1px solid var(--line)',
      }}>{secondary}</button>
    )}
  </div>
);

// Progress spinner row (while job is running)
const GeneratingRow = ({ steps }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
    <ThinkingTrace done={false} steps={steps}/>
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 12px', borderRadius: 10, width: '100%',
      background: 'var(--panel)', border: '1px solid var(--line-2)',
    }}>
      <div style={{ position: 'relative', width: 24, height: 24, flexShrink: 0 }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: 99, border: '2px solid var(--line-2)' }}/>
        <div style={{ position: 'absolute', inset: 0, borderRadius: 99, border: '2px solid var(--accent)', borderRightColor: 'transparent', borderBottomColor: 'transparent', animation: 'spin 0.8s linear infinite' }}/>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 500 }}>正在生图…</div>
        <div className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>{steps[steps.length - 1] || '启动中'}</div>
      </div>
    </div>
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
  </div>
);

// Result image with download + penpot link
const ResultCard = ({ url, penpotUrl, onExportGrid }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
    <img src={url} alt="生图结果" style={{ borderRadius: 8, maxWidth: '100%', border: '1px solid var(--line-2)', display: 'block' }}/>
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
      <a href={url} download style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
        fontSize: 11, fontWeight: 500, padding: '7px', borderRadius: 7,
        background: 'var(--ink)', color: 'white', textDecoration: 'none',
      }}>
        <I.download size={12}/>下载 PNG
      </a>
      {onExportGrid && (
        <button onClick={onExportGrid} style={{
          fontSize: 11, padding: '7px 12px', borderRadius: 7,
          background: 'var(--panel)', color: 'var(--ink-2)',
          border: '1px solid var(--line)',
        }}>切九宫格</button>
      )}
      {penpotUrl && (
        <a href={penpotUrl} target="_blank" rel="noreferrer" style={{
          fontSize: 11, padding: '7px 12px', borderRadius: 7,
          background: 'var(--panel)', color: 'var(--ink-2)',
          border: '1px solid var(--line)', textDecoration: 'none',
          display: 'flex', alignItems: 'center', gap: 5,
        }}>在 Penpot 中修改</a>
      )}
    </div>
  </div>
);

// Product parse result card (using the original ParseTable from ChatExtras)
const ProductParseCard = ({ products, imgMatched, imgMissed }) => {
  const rows = products.map(p => ({
    field: p.name || '—',
    value: [p.price, p.spec, p.tag].filter(Boolean).join(' · ') || '—',
    conf: p.image_path ? 'high' : 'low',
    note: p.image_path ? null : '未找到匹配图片',
  }));
  return (
    <ParseTable
      title="产品解析结果"
      subtitle={`${products.length} 款产品 · ${imgMatched} 张图已匹配${imgMissed > 0 ? ` · ${imgMissed} 张缺失` : ''}`}
      source="表格"
      rows={rows}
    />
  );
};

// Image type selector (before parse)
const ImageTypePicker = ({ types, selected, onSelect, onConfirm }) => (
  <div style={{
    borderRadius: 10, padding: 12, width: '100%',
    background: 'var(--panel)', border: '1px solid var(--line-2)',
    display: 'flex', flexDirection: 'column', gap: 10,
  }}>
    <div style={{ fontSize: 11.5, fontWeight: 500 }}>选择图片类型</div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      {types.map(t => (
        <button key={t.key} onClick={() => onSelect(t.key)} style={{
          fontSize: 11.5, padding: '4px 10px', borderRadius: 99,
          background: selected === t.key ? 'var(--ink)' : 'var(--panel-2)',
          color: selected === t.key ? 'white' : t.exists ? 'var(--ink-2)' : 'var(--ink-3)',
          border: '1px solid', borderColor: selected === t.key ? 'var(--ink)' : 'var(--line-2)',
          opacity: t.exists ? 1 : 0.55, transition: 'all 100ms',
        }} title={t.exists ? t.folder : `文件夹不存在：${t.folder}`}>
          {t.folder}{!t.exists && ' !'}
        </button>
      ))}
    </div>
    <button onClick={onConfirm} style={{
      alignSelf: 'flex-start', fontSize: 11.5, fontWeight: 500,
      padding: '6px 14px', borderRadius: 7,
      background: 'var(--accent)', color: 'white',
    }}>确认解析</button>
  </div>
);

// ---------- States ----------

const ChatEmpty = ({ onQuickAction }) => {
  const prompts = [
    { icon: <I.image size={13}/>,    text: '上传产品需求表格（Excel / CSV）' },
    { icon: <I.zap size={13}/>,      text: '/generate · 开始生图' },
    { icon: <I.download size={13}/>, text: '/export-png · 导出图片' },
    { icon: <I.grid size={13}/>,     text: '/grid · 切九宫格' },
  ];
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px' }}>
      <div style={{
        padding: '20px 4px 16px', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center',
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: 11,
          background: 'linear-gradient(135deg, var(--ink), oklch(0.3 0.08 275))',
          color: 'white', display: 'grid', placeItems: 'center',
        }}>
          <I.sparkles size={18} stroke={1.8}/>
        </div>
        <div className="serif" style={{ fontSize: 19, letterSpacing: '-0.01em' }}>AI 生图助手</div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'center', maxWidth: 240, lineHeight: 1.5 }}>
          选择模板，上传产品表格，或直接开始对话
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

// ---------- Live message list ----------

const LiveMessages = ({ messages, imageTypes, selectedImageType, onSelectType, onConfirmType, onAction }) => {
  const bottomRef = React.useRef(null);
  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, messages[messages.length - 1]]);

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {messages.map((msg) => {
        const who = msg.role === 'ai' ? 'ai' : 'user';
        return (
          <Bubble key={msg.id} who={who} meta={msg.meta}>
            {/* File card */}
            {msg.file && <FileCard name={msg.file.name} size={formatFileSize(msg.file.size)} type={msg.file.name.split('.').pop().toUpperCase()}/>}

            {/* Text */}
            {msg.content && <TextBubble who={who}>{msg.content}</TextBubble>}

            {/* Command echo */}
            {msg.cmd && <CommandEcho cmd={msg.cmd} cn={msg.cmdCn || ''}/>}

            {/* Image type picker */}
            {msg.showTypePicker && imageTypes.length > 0 && (
              <ImageTypePicker
                types={imageTypes}
                selected={selectedImageType}
                onSelect={onSelectType}
                onConfirm={onConfirmType}
              />
            )}

            {/* Parse result */}
            {msg.parseResult && (
              <ProductParseCard
                products={msg.parseResult.products}
                imgMatched={msg.parseResult.imgMatched}
                imgMissed={msg.parseResult.imgMissed}
              />
            )}

            {/* AI structured message list (warnings/info) */}
            {msg.notices && msg.notices.length > 0 && (
              <MessageList title="注意事项" items={msg.notices}/>
            )}

            {/* Generating progress */}
            {msg.generating && msg.progressSteps && (
              <GeneratingRow steps={msg.progressSteps}/>
            )}

            {/* Result image */}
            {msg.resultUrl && (
              <ResultCard
                url={msg.resultUrl}
                penpotUrl={msg.penpotUrl}
                onExportGrid={msg.onExportGrid}
              />
            )}

            {/* Grid download links */}
            {msg.gridUrls && msg.gridUrls.length > 0 && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {msg.gridUrls.map((url, i) => (
                  <a key={i} href={url} download={`grid_${i+1}.png`} style={{
                    fontSize: 11, padding: '4px 9px', borderRadius: 99,
                    color: 'var(--ink-2)', border: '1px solid var(--line)',
                    background: 'var(--panel)', textDecoration: 'none',
                  }}>第 {i+1} 格</a>
                ))}
              </div>
            )}

            {/* Action chips */}
            {msg.chips && msg.chips.length > 0 && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {msg.chips.map((t, i) => (
                  <button key={i} onClick={() => onAction && onAction(t)} style={{
                    fontSize: 11, padding: '4px 9px', borderRadius: 99,
                    color: t.startsWith('/') ? 'var(--accent-ink)' : 'var(--ink-2)',
                    border: '1px solid',
                    borderColor: t.startsWith('/') ? 'transparent' : 'var(--line)',
                    background: t.startsWith('/') ? 'var(--accent-soft)' : 'var(--panel)',
                    fontFamily: t.startsWith('/') ? 'JetBrains Mono, monospace' : 'inherit',
                  }}>{t}</button>
                ))}
              </div>
            )}

            {/* Primary action button */}
            {msg.primaryAction && (
              <ActionBtns
                primary={msg.primaryAction.label}
                secondary={msg.secondaryAction?.label}
                onPrimary={msg.primaryAction.handler}
                onSecondary={msg.secondaryAction?.handler}
              />
            )}
          </Bubble>
        );
      })}
      <div ref={bottomRef}/>
    </div>
  );
};

// ---------- Composer ----------

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
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 6px 4px 8px', borderRadius: 6,
                background: 'var(--panel)', border: '1px solid var(--line-2)',
                fontSize: 11,
              }}>
                <I.file size={11} style={{ color: 'var(--ink-3)' }}/>
                <span style={{ fontWeight: 500 }}>{f.name}</span>
                <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 9.5 }}>{formatFileSize(f.size)}</span>
                <button onClick={() => setFiles(fs => fs.filter((_, j) => j !== i))} style={{ padding: 2, color: 'var(--ink-3)' }}>
                  <I.close size={11}/>
                </button>
              </div>
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
            {['/generate', '/export-png', '/grid'].map(s => {
              const c = SLASH_COMMANDS.find(x => x.cmd === s);
              return (
                <button key={s} onClick={() => c && pickCommand(c)} style={{
                  fontSize: 10, padding: '2px 7px', borderRadius: 99,
                  color: 'var(--accent-ink)', background: 'var(--accent-soft)',
                  fontFamily: 'JetBrains Mono, monospace',
                }}>{s}</button>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            style={{ padding: 6, borderRadius: 6, color: 'var(--ink-2)', opacity: disabled ? 0.5 : 1 }}
            title="上传表格"
          >
            <I.paperclip size={14}/>
          </button>
          <button style={{ padding: 6, borderRadius: 6, color: 'var(--ink-2)' }} title="插入图片">
            <I.image size={14}/>
          </button>
          <button style={{ padding: 6, borderRadius: 6, color: 'var(--ink-2)' }} title="配色">
            <I.palette size={14}/>
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

// ---------- Helpers ----------

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function friendlyStep(msg) {
  if (!msg) return null;
  if (msg.includes('等待合成队列')) return '等待生图队列…';
  if (msg.includes('复制模板文件')) return '正在创建独立副本…';
  if (msg.includes('副本就绪')) return '副本创建完成';
  if (msg.includes('读取模板图层')) return '读取模板结构';
  if (msg.includes('上传图片')) return '上传产品图片';
  if (msg.includes('写入文字')) { const m = msg.match(/「(.+?)」/); return m ? `写入文字：${m[1]}` : '写入文字内容'; }
  if (msg.includes('隐藏空图层')) return null;
  if (msg.includes('提交') && msg.includes('变更')) { const m = msg.match(/(\d+)/); return m ? `提交 ${m[1]} 处变更` : '提交变更'; }
  if (msg.includes('无变更')) return '无需变更，直接导出';
  if (msg.includes('导出 PNG')) return '正在渲染导出图片…';
  if (msg.includes('完成') && msg.includes('输出')) return '导出完成';
  if (msg.includes('Penpot 编辑链接') || msg.includes('失败')) return null;
  return msg;
}

function deriveRequiredFields(template) {
  if (!template) return [];
  const fields = new Set();
  for (const slot of (template.slots || [])) {
    const field = slot.name.split('/')[2];
    if (!field || field === 'image' || slot.type === 'rect') continue;
    fields.add(field);
  }
  return Array.from(fields);
}

let _mid = 0;
const nid = () => String(++_mid);

// ---------- Main ----------

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

  // Poll compose job
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

        const steps = (updated.progress || []).map(friendlyStep).filter(Boolean);
        setMessages(prev => prev.map(m =>
          m.jobId === updated.id ? { ...m, progressSteps: steps } : m
        ));

        if (updated.status === 'done') {
          clearInterval(pollRef.current);
          const imgUrl = API.getImageUrl(updated.id);
          if (onResultUrl) onResultUrl(imgUrl);
          const jobId = updated.id;
          setMessages(prev => prev.map(m =>
            m.jobId === updated.id ? {
              ...m,
              generating: false,
              content: '生图完成！',
              resultUrl: imgUrl,
              penpotUrl: updated.penpot_edit_url,
              onExportGrid: () => doExportGrid(jobId),
              chips: null,
            } : m
          ));
          setSending(false);
        } else if (updated.status === 'failed') {
          clearInterval(pollRef.current);
          setMessages(prev => prev.map(m =>
            m.jobId === updated.id ? { ...m, generating: false, content: `生图失败：${updated.error || '未知错误'}` } : m
          ));
          setSending(false);
        }
      } catch {}
    }, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [currentJob?.id, currentJob?.status]);

  // ── /generate ──────────────────────────────────────────────────────────────
  const doGenerate = async (products) => {
    const prods = products || parsedProducts;
    if (!template) { push({ role: 'ai', content: '请先在左侧选择一个模板。' }); return; }
    if (!prods || !prods.length) { push({ role: 'ai', content: '请先上传产品需求表格，解析后再生图。' }); return; }

    setSending(true);
    const slots = {};
    prods.forEach((p, i) => {
      slots[`product_${i + 1}`] = { image_path: p.image_path ?? null, name: p.name ?? null, price: p.price ?? null, tag: p.tag ?? null, spec: p.spec ?? null };
    });

    try {
      const job = await API.createCompose({ file_id: template.file_id, template_frame_id: template.id, page_id: template.page_id, slots, export_scale: 2 });
      setCurrentJob(job);
      if (onJobUpdate) onJobUpdate(job);
      push({ role: 'ai', content: '已启动生图任务，中间区域实时显示进度。', meta: 'Loom · generating', generating: true, progressSteps: ['正在启动…'], jobId: job.id });
    } catch (e) {
      push({ role: 'ai', content: `启动失败：${e.message}` });
      setSending(false);
    }
  };

  // ── /export-png ────────────────────────────────────────────────────────────
  const doExportPng = () => {
    if (!currentJob || currentJob.status !== 'done') {
      push({ role: 'ai', content: '还没有完成的生图任务，请先运行 /generate。' });
      return;
    }
    const url = API.getImageUrl(currentJob.id);
    const a = document.createElement('a');
    a.href = url; a.download = `result_${currentJob.id.slice(0, 8)}.png`; a.click();
    push({ role: 'ai', content: 'PNG 下载已开始。' });
  };

  // ── /grid ──────────────────────────────────────────────────────────────────
  const doExportGrid = async (jobIdOverride) => {
    const jobId = jobIdOverride || currentJob?.id;
    const isDone = jobIdOverride ? true : currentJob?.status === 'done';
    if (!jobId || !isDone) { push({ role: 'ai', content: '请先完成生图，再切九宫格。' }); return; }
    setSending(true);
    push({ role: 'ai', content: '正在切九宫格…' });
    try {
      const res = await API.exportGrid(jobId, 3, 3);
      const urls = (res.files || []).map((_, i) => API.getGridCellUrl(res.job_id || jobId, i));
      push({ role: 'ai', content: `九宫格已生成，共 ${urls.length} 格：`, gridUrls: urls });
    } catch (e) {
      push({ role: 'ai', content: `切图失败：${e.message}` });
    } finally {
      setSending(false);
    }
  };

  // ── File upload ────────────────────────────────────────────────────────────
  const handleFileUpload = async (files) => {
    const tableFile = files.find(f => /\.(xlsx|xls|csv)$/i.test(f.name));
    if (!tableFile) return;
    pendingFileRef.current = tableFile;

    if (imageTypes.length > 0) {
      push({
        role: 'ai',
        content: '请选择本次使用的图片类型，系统将从对应素材文件夹匹配产品图：',
        showTypePicker: true,
      });
    } else {
      await doParse(tableFile);
    }
  };

  const confirmTypePicker = async () => {
    if (pendingFileRef.current) await doParse(pendingFileRef.current);
  };

  const doParse = async (file) => {
    setSending(true);
    const requiredFields = deriveRequiredFields(template);
    const currentType = selectedTypeRef.current;
    const tid = push({ role: 'ai', content: '正在解析表格…' });
    try {
      const result = await API.parseTable(
        file,
        requiredFields.length ? requiredFields : undefined,
        currentType || undefined
      );
      const products = result.products;
      setParsedProducts(products);
      const imgMatched = products.filter(p => p.image_path).length;
      const imgMissed = products.length - imgMatched;
      const total = products.length;
      const tplCount = template
        ? new Set((template.slots || []).map(s => s.name.split('/')[1]).filter(Boolean)).size : 0;

      let lead = '';
      const notices = [];
      if (!template) {
        lead = `解析完成，找到 ${total} 款产品，图片匹配 ${imgMatched} 张。请先在左侧选择模板。`;
      } else if (tplCount === total && imgMissed === 0) {
        lead = `${total} 款产品和「${template.name}」完全匹配，图片全部找到，可以直接生图。`;
      } else {
        lead = `解析完成，找到 ${total} 款产品。`;
        if (imgMissed > 0) notices.push({ kind: 'warn', title: `${imgMissed} 张图片缺失`, body: '生图时对应位置留空处理。' });
        if (tplCount !== total) notices.push({ kind: 'info', title: `模板需要 ${tplCount} 款，表格提供了 ${total} 款`, body: tplCount < total ? `将使用前 ${tplCount} 款产品生图。` : '剩余位置留空处理。' });
      }

      patch(tid, {
        content: lead,
        parseResult: { products, imgMatched, imgMissed },
        notices: notices.length ? notices : null,
        primaryAction: {
          label: '开始生图',
          handler: () => {
            push({ role: 'user', content: '/generate · 开始生图', cmd: '/generate', cmdCn: '开始生图' });
            doGenerate(products);
          },
        },
        chips: ['/regenerate', '/analyze'],
      });
    } catch (e) {
      patch(tid, { content: `解析失败：${e.message}` });
    } finally {
      setSending(false);
    }
  };

  // ── Text / slash commands ──────────────────────────────────────────────────
  const handleSend = async (text, files) => {
    if (files && files.length > 0) {
      push({ role: 'user', file: files.find(f => /\.(xlsx|xls|csv)$/i.test(f.name)) || files[0], content: `上传了 ${files[0].name}` });
      await handleFileUpload(files);
      if (!text.trim()) return;
    }
    if (!text.trim()) return;

    const lower = text.trim().toLowerCase();

    if (lower.startsWith('/generate') || lower.includes('开始生图') || lower.includes('生图')) {
      push({ role: 'user', content: text, cmd: '/generate', cmdCn: '开始生图' });
      await doGenerate(); return;
    }
    if (lower.startsWith('/export-png') || lower.startsWith('/export') || (lower.includes('导出') && lower.includes('png'))) {
      push({ role: 'user', content: text, cmd: '/export-png', cmdCn: '导出PNG' });
      doExportPng(); return;
    }
    if (lower.startsWith('/grid') || lower.includes('九宫格')) {
      push({ role: 'user', content: text, cmd: '/grid', cmdCn: '切九宫格' });
      await doExportGrid(); return;
    }

    // AI chat fallback
    push({ role: 'user', content: text });
    setSending(true);
    const thinkId = push({ role: 'ai', content: '…' });
    try {
      const history = messages
        .filter(m => m.content && (m.role === 'user' || m.role === 'ai'))
        .slice(-10)
        .map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content }));
      history.push({ role: 'user', content: text });
      const ctx = { templateName: template?.name, productCount: parsedProducts?.length, jobStatus: currentJob?.status };
      const reply = await API.chatWithAI(history, ctx);
      patch(thinkId, { content: reply });
    } catch (e) {
      patch(thinkId, { content: `出错了：${e.message}` });
    } finally {
      setSending(false);
    }
  };

  const isEmpty = messages.length === 0;
  const isWorking = sending || (currentJob && (currentJob.status === 'running' || currentJob.status === 'pending'));

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
            background: isWorking ? 'var(--accent)' : 'var(--ok)',
            animation: isWorking ? 'pulse 1.2s ease-in-out infinite' : 'none',
          }}/>
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em' }}>Loom</span>
          <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>
            {isWorking ? 'working…' : parsedProducts ? `${parsedProducts.length} products` : 'ready'}
          </span>
        </div>
        <div style={{ flex: 1 }}/>
        <button style={{ padding: 5, borderRadius: 5, color: 'var(--ink-3)' }} title="历史记录"><I.layers size={13}/></button>
        <button
          onClick={() => { setMessages([]); setParsedProducts(null); setCurrentJob(null); }}
          style={{ padding: 5, borderRadius: 5, color: 'var(--ink-3)' }}
          title="清空对话"
        ><I.refresh size={13}/></button>
        <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
      </div>

      {/* Body */}
      {isEmpty
        ? <ChatEmpty onQuickAction={(t) => handleSend(t, [])}/>
        : <LiveMessages
            messages={messages}
            imageTypes={imageTypes}
            selectedImageType={selectedImageType}
            onSelectType={setType}
            onConfirmType={confirmTypePicker}
            onAction={(t) => handleSend(t, [])}
          />
      }

      {/* Composer */}
      <Composer
        onSend={handleSend}
        onFileUpload={handleFileUpload}
        disabled={isWorking}
      />
    </div>
  );
};

window.Chat = Chat;

// AI chat column. Three states: empty / generating / returned.
// Rich message types: text, option chips, file cards, action buttons, thinking trace, image results.

// ---------- Sub-components ----------

// 生成耗时计时器，每秒刷新
const ChatTimer = ({ startedAt }) => {
  const [elapsed, setElapsed] = React.useState(Math.floor((Date.now() - startedAt) / 1000));
  React.useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  const m = Math.floor(elapsed / 60), s = elapsed % 60;
  return React.createElement('span', {
    className: 'mono',
    style: { fontSize: 11, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' },
  }, m > 0 ? m + 'm ' + String(s).padStart(2, '0') + 's' : s + 's');
};

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
    }}>JR</div>
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
        <span style={{ fontSize: 11.5, fontWeight: 500 }}>{done ? 'Reasoned for 4 steps' : 'Thinking…'}</span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>{done ? '2.1s' : ''}</span>
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
      <div style={{ fontSize: 11.5, fontWeight: 500, marginBottom: 8 }}>Pick a palette</div>
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

const ActionRow = ({ primary, secondary }) => (
  <div style={{ display: 'flex', gap: 6, width: '100%' }}>
    <button style={{
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
      <button style={{
        fontSize: 12, padding: '9px 12px', borderRadius: 8,
        background: 'var(--panel)', color: 'var(--ink-2)',
        border: '1px solid var(--line)',
      }}>{secondary}</button>
    )}
  </div>
);

const AnalyzedSubject = () => (
  <div style={{
    borderRadius: 10, padding: 12, width: '100%',
    background: 'var(--panel)', border: '1px solid var(--line-2)',
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
      <I.eye size={12} style={{ color: 'var(--accent-ink)' }}/>
      <span style={{ fontSize: 11.5, fontWeight: 500 }}>I identified</span>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 10px', fontSize: 11.5 }}>
      {[
        ['Object', 'Ceramic vase, matte glaze'],
        ['Palette', 'Warm beige, clay, ivory'],
        ['Lighting', 'Soft side-light, studio'],
        ['Mood', 'Quiet, editorial, Japandi'],
      ].map(([k, v]) => (
        <React.Fragment key={k}>
          <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', alignSelf: 'center' }}>{k}</span>
          <span style={{ color: 'var(--ink)' }}>{v}</span>
        </React.Fragment>
      ))}
    </div>
  </div>
);

// ---------- LogBox（实时滚动日志）----------

const LogBox = ({ logs, running }) => {
  const bottomRef = React.useRef(null);
  React.useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs && logs.length]);

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, background: 'var(--panel)', overflow: 'hidden' }}>
      <div style={{ padding: '7px 12px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 500 }}>进度日志</span>
        {running && <div style={{ width: 6, height: 6, borderRadius: 99, background: 'var(--accent)', animation: 'pulse 1.2s ease-in-out infinite' }}/>}
      </div>
      <div style={{ maxHeight: 140, overflowY: 'auto', padding: '6px 0' }}>
        {logs.map((log, i) => {
          const isError = log.includes('失败') || log.includes('Error') || log.includes('error');
          const isOk = log.includes('完成') || log.includes('就绪') || log.includes('保存');
          const isPath = log.includes('/') && (log.includes('.png') || log.includes('.py') || log.includes('\\'));
          const display = isPath ? log.split(/[/\\]/).pop() : log;
          return (
            <div key={i} style={{
              padding: '3px 12px',
              fontSize: 11.5,
              fontFamily: 'JetBrains Mono, monospace',
              color: isError ? 'var(--warn)' : isOk ? 'var(--ok)' : 'var(--ink-2)',
              display: 'flex', gap: 8, alignItems: 'baseline',
            }}>
              <span style={{ color: isError ? 'var(--warn)' : isOk ? 'var(--ok)' : 'var(--accent)', flexShrink: 0 }}>›</span>
              <span>{display}</span>
            </div>
          );
        })}
        <div ref={bottomRef}/>
      </div>
    </div>
  );
};

// ---------- States ----------

const ChatEmpty = () => {
  const prompts = [
    { icon: <I.image size={13}/>,    text: '上传产品图，描述想要的风格' },
    { icon: <I.palette size={13}/>,  text: '生成4张哑光色调的变体图' },
    { icon: <I.copy size={13}/>,     text: '复制当前模板的文案' },
    { icon: <I.dims size={13}/>,     text: '调整尺寸为9:16适配Instagram' },
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
        <div className="serif" style={{ fontSize: 19, letterSpacing: '-0.01em' }}>今天想设计点什么？</div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'center', maxWidth: 240, lineHeight: 1.5 }}>
          上传产品图、参考图、品牌素材，或者直接输入描述。
        </div>
      </div>

      <div className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '12px 4px 6px' }}>试试</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {prompts.map((p, i) => (
          <button key={i} style={{
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

const ChatGenerating = () => (
  <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
    <Bubble who="user">
      <TextBubble who="user">Make 4 studio shots of this vase for a homepage hero, warm and editorial. Add "New in" copy.</TextBubble>
      <FileCard name="vase-ref-01.jpg" size="2.4 MB" type="JPG"/>
    </Bubble>

    <Bubble who="ai" meta="Loom · generating">
      <ThinkingTrace done={false} steps={[
        'Parsing reference image — detecting subject and lighting',
        'Matching Japandi aesthetic from brand kit',
        'Sampling 4 layout variants at 4:5',
      ]}/>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 12px', borderRadius: 10, width: '100%',
        background: 'var(--panel)', border: '1px solid var(--line-2)',
      }}>
        <div style={{ position: 'relative', width: 24, height: 24 }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: 99, border: '2px solid var(--line-2)' }}/>
          <div style={{ position: 'absolute', inset: 0, borderRadius: 99, border: '2px solid var(--accent)', borderRightColor: 'transparent', borderBottomColor: 'transparent', animation: 'spin 0.8s linear infinite' }}/>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 500 }}>Generating 4 options</div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>~18s remaining</div>
        </div>
        <button style={{ fontSize: 11, color: 'var(--ink-3)', padding: '4px 8px', borderRadius: 5, border: '1px solid var(--line)' }}>Stop</button>
      </div>
    </Bubble>
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
  </div>
);

const ChatReturned = ({ messages, template, onCompose, isGenerating }) => {
  const userMsgs = messages.filter(m => m.who === 'user').length;
  const turnCount = messages.length > 0 ? userMsgs + ' 条消息' : '暂无消息';

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Session header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 0', fontSize: 10,
      }}>
        <span className="mono" style={{ color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>对话</span>
        <div style={{ flex: 1, height: 1, background: 'var(--line-2)' }}/>
        <span className="mono" style={{ color: 'var(--ink-3)' }}>{turnCount}</span>
      </div>

      {messages.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 11,
            background: 'linear-gradient(135deg, var(--ink), oklch(0.3 0.08 275))',
            color: 'white', display: 'grid', placeItems: 'center',
          }}>
            <I.sparkles size={18} stroke={1.8}/>
          </div>
          <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>今天想设计点什么？</div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'center', maxWidth: 240, lineHeight: 1.5 }}>
            上传产品图、参考图、品牌素材，或者直接输入描述。
          </div>
        </div>
      ) : (
        messages.map((m, i) => (
          <Bubble key={i} who={m.who} meta={m.meta}>
            {m.type === 'ai-image-generating' ? (() => {
            const fmtSecs = s => { const mm = Math.floor(s/60), ss = s%60; return mm > 0 ? mm+'m '+String(ss).padStart(2,'0')+'s' : ss+'s'; };
            return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                m.status === 'done'
                  ? React.createElement('div', { style: { width: 8, height: 8, borderRadius: 99, background: 'var(--ok)', flexShrink: 0 } })
                  : m.status === 'failed'
                    ? React.createElement('div', { style: { width: 8, height: 8, borderRadius: 99, background: 'var(--warn)', flexShrink: 0 } })
                    : React.createElement('div', { style: { width: 14, height: 14, borderRadius: 99, border: '2px solid var(--line-2)', borderTopColor: 'var(--accent)', animation: 'spin 0.8s linear infinite', flexShrink: 0 } }),
                React.createElement('span', { style: { fontSize: 12, fontWeight: 500, color: 'var(--ink)' } },
                  m.status === 'done' ? '生图完成' : m.status === 'failed' ? '生图失败' : '生图中…'
                ),
                m.finalElapsed != null
                  ? React.createElement('span', { className: 'mono', style: { fontSize: 10, color: 'var(--ink-3)' } }, fmtSecs(m.finalElapsed))
                  : m.startedAt && m.status === 'running'
                    ? React.createElement(ChatTimer, { startedAt: m.startedAt })
                    : null
              ),
              m.status === 'done' && m.imageUrl && React.createElement('div', null,
                React.createElement('img', {
                  src: m.imageUrl,
                  alt: m.prompt,
                  style: { width: '100%', borderRadius: 10, display: 'block', border: '1px solid var(--line-2)', cursor: 'pointer' },
                  onClick: () => window.open(m.imageUrl, '_blank'),
                }),
                React.createElement('div', { style: { marginTop: 6, display: 'flex', gap: 6 } },
                  React.createElement('a', {
                    href: m.imageUrl, download: true,
                    style: { fontSize: 11, padding: '4px 10px', borderRadius: 5, background: 'var(--ink)', color: 'white', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 },
                  }, React.createElement(I.download, { size: 10 }), '下载')
                )
              ),
              m.status === 'failed' && m.error && React.createElement('div', {
                style: { padding: '8px 10px', borderRadius: 6, background: 'var(--panel)', border: '1px solid var(--warn)', fontSize: 11, color: 'var(--warn)' }
              }, m.error)
            );
          })() : m.type === 'parse-result' ? (() => {
                const matchedCount = m.data.products.filter(p => p.image_path).length;
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <TextBubble who="ai">找到 {m.data.products.length} 个产品，其中 {matchedCount} 个已匹配图片，建议模板类型：<b>{m.data.suggested_template_type}</b></TextBubble>
                    <div style={{
                      width: '100%', borderRadius: 10,
                      background: 'var(--panel)', border: '1px solid var(--line-2)',
                      overflow: 'hidden',
                    }}>
                      <div style={{ padding: '9px 12px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 20, height: 20, borderRadius: 5, background: 'var(--accent-soft)', color: 'var(--accent-ink)', display: 'grid', placeItems: 'center' }}>
                          <I.file size={11}/>
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 11.5, fontWeight: 600 }}>{m.data.products.length} 个产品</div>
                          <div className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)' }}>CSV · {m.data.suggested_template_type}</div>
                        </div>
                      </div>
                      {m.fields && m.fields.length > 0 && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr '.repeat(m.fields.length).trim() + ' 60px', fontSize: 11 }}>
                          {m.fields.map((f, fi) => (
                            <HeadCell key={f}>{f === 'image' ? '图片' : f === 'name' ? '产品名' : f === 'price' ? '价格' : f === 'tag' ? '标签' : f === 'spec' ? '规格' : f}</HeadCell>
                          ))}
                          <HeadCell right>匹配</HeadCell>
                          {m.data.products.map((p, j) => (
                            <React.Fragment key={j}>
                              {m.fields.map((f) => {
                                const val = p[f === 'image' ? 'image_path' : f];
                                return (
                                  <Cell key={f} top={j > 0}>
                                    {f === 'image' ? (
                                      val ? <span style={{ color: 'var(--ok)', fontSize: 10 }}>已匹配</span> : <span style={{ color: 'var(--ink-3)', fontSize: 10 }}>未匹配</span>
                                    ) : (
                                      <span style={{ fontWeight: f === 'name' ? 500 : 400 }}>{val || '—'}</span>
                                    )}
                                  </Cell>
                                );
                              })}
                              <Cell top={j > 0} right>
                                <span style={{ color: p.image_path ? 'var(--ok)' : 'var(--warn)', fontSize: 10 }}>
                                  {p.image_path ? '✓' : '—'}
                                </span>
                              </Cell>
                            </React.Fragment>
                          ))}
                        </div>
                      )}
                      {matchedCount > 0 && !isGenerating && (
                        <div style={{ padding: '10px 12px', borderTop: '1px solid var(--line-2)', display: 'flex', justifyContent: 'center' }}>
                          <button
                            onClick={() => onCompose && onCompose(template, m.data)}
                            style={{
                              fontSize: 12,
                              padding: '6px 20px',
                              borderRadius: 6,
                              background: 'var(--ink)',
                              color: 'white',
                              border: 'none',
                              cursor: 'pointer',
                            }}
                          >
                            开始生图
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })() : m.type === 'generating' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {(() => {
                    var fmtSecs = function(s) {
                      var mm = Math.floor(s / 60), ss = s % 60;
                      return mm > 0 ? mm + 'm ' + String(ss).padStart(2, '0') + 's' : ss + 's';
                    };
                    if (m.status === 'done') return React.createElement(React.Fragment, null,
                      React.createElement('div', { style: { width: 18, height: 18, borderRadius: 99, background: 'var(--ok)', flexShrink: 0 } }),
                      React.createElement('span', { style: { fontSize: 13, color: 'var(--ok)', fontWeight: 600 } }, '生成完成'),
                      m.finalElapsed != null && React.createElement('span', { className: 'mono', style: { fontSize: 11, color: 'var(--ink-3)' } }, fmtSecs(m.finalElapsed))
                    );
                    if (m.status === 'failed') return React.createElement(React.Fragment, null,
                      React.createElement('div', { style: { width: 18, height: 18, borderRadius: 99, background: 'var(--warn)', flexShrink: 0 } }),
                      React.createElement('span', { style: { fontSize: 13, color: 'var(--warn)', fontWeight: 600 } }, '生成失败'),
                      m.finalElapsed != null && React.createElement('span', { className: 'mono', style: { fontSize: 11, color: 'var(--ink-3)' } }, fmtSecs(m.finalElapsed))
                    );
                    return React.createElement(React.Fragment, null,
                      React.createElement('div', { style: { width: 18, height: 18, borderRadius: 99, border: '2px solid var(--line-2)', borderTopColor: 'var(--accent)', animation: 'spin 0.8s linear infinite', flexShrink: 0 } }),
                      React.createElement('span', { style: { fontSize: 13, color: 'var(--ink)', fontWeight: 500 } }, '生成中'),
                      m.startedAt && React.createElement(ChatTimer, { startedAt: m.startedAt })
                    );
                  })()}
                </div>
                {m.logs && m.logs.length > 0 && (
                  <LogBox logs={m.logs} running={m.status !== 'done' && m.status !== 'failed'}/>
                )}
                {m.status === 'done' && m.specialUrls && m.specialUrls.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                    {m.penpotUrl && (
                      <a href={m.penpotUrl} target="_blank" rel="noreferrer" style={{
                        fontSize: 11.5, padding: '5px 12px', borderRadius: 6,
                        background: 'var(--accent)', color: 'white',
                        textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5,
                      }}>
                        <I.edit size={11}/>在Penpot中编辑
                      </a>
                    )}
                    {m.specialUrls.map((url, si) => (
                      <a key={si} href={url} target="_blank" rel="noreferrer" style={{
                        fontSize: 11.5, padding: '5px 12px', borderRadius: 6,
                        background: 'var(--ink)', color: 'white',
                        textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5,
                      }}>
                        <I.download size={11}/>图{si + 1}
                      </a>
                    ))}
                  </div>
                )}
                {m.status === 'failed' && m.error && (
                  <div style={{ padding: '10px 12px', borderRadius: 6, background: 'var(--panel)', border: '1px solid var(--warn)', fontSize: 12, color: 'var(--warn)' }}>
                    {m.error}
                  </div>
                )}
              </div>
            ) : (
              <TextBubble who={m.who}>{m.text}</TextBubble>
            )}
          </Bubble>
        ))
      )}
    </div>
  );
};

// ---------- Composer ----------

const Composer = ({ onSend, onParseTable, isLoading, slashTrigger, template, lastSubmittedMessage }) => {
  const [text, setText] = React.useState('');
  const [lockedCommand, setLockedCommand] = React.useState('');
  const [files, setFiles] = React.useState([]);
  const [imageType, setImageType] = React.useState('png');
  const [aiRatio, setAiRatio] = React.useState('auto');
  const [aiQuality, setAiQuality] = React.useState('1K');
  const [refImages, setRefImages] = React.useState([]); // [{ file, previewUrl }, ...] 最多 4 张
  const taRef = React.useRef(null);
  const fileInputRef = React.useRef(null);
  const COMMANDS = React.useMemo(() => ['/特殊品（完整）', '/特殊品', '/Nano Banana pro', '/Gpt image 2'], []);
  const displayValue = lockedCommand ? (text ? (lockedCommand + ' ' + text) : (lockedCommand + ' ')) : text;
  const lockedPrefixLength = lockedCommand ? (lockedCommand.length + 1) : 0;

  // 外部触发 slash 命令（选中特殊品模板时）
  React.useEffect(() => {
    if (!slashTrigger) return;
    if (slashTrigger.clear) {
      setLockedCommand(prev => (prev === '/特殊品' || prev === '/特殊品（完整）') ? '' : prev);
      return;
    }
    setLockedCommand('/' + slashTrigger.cmd);
    setText('');
    setMenuOpen(false);
    setTimeout(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(lockedPrefixLength, lockedPrefixLength);
    }, 0);
  }, [slashTrigger?.key, lockedPrefixLength]);

  React.useEffect(() => {
    if (template && (template.is_special || template.is_special_full)) return;
    setLockedCommand(prev => (prev === '/特殊品' || prev === '/特殊品（完整）') ? '' : prev);
  }, [template?.file_id, template?.group_name, template?.id, template?.is_special, template?.is_special_full]);

  React.useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  }, [displayValue]);

  // Image type options
  const IMAGE_TYPES = [
    { key: 'png', label: 'PNG' },
    { key: 'white', label: '白底' },
    { key: 'model', label: '模特' },
    { key: 'shadow', label: '阴影' },
    { key: 'white2x', label: '白底x2' },
  ];

  const AI_QUALITIES = ['1K', '2K', '4K'];
  const GPT_IMAGE2_OPTIONS = {
    auto: { label: 'auto', qualities: ['1K', '2K', '4K'], preview: 'auto', px: { '1K': 'auto', '2K': 'auto', '4K': 'auto' } },
    '1:1': { label: '1:1', qualities: ['1K', '2K'], preview: '1:1', px: { '1K': '1024×1024', '2K': '2048×2048' } },
    '3:4': { label: '3:4', qualities: ['1K', '2K'], preview: '3:4', px: { '1K': '768×1024', '2K': '1536×2048' } },
    '5:4': { label: '5:4', qualities: ['1K', '2K'], preview: '5:4', px: { '1K': '1280×1024', '2K': '2560×2048' } },
    '9:16': { label: '9:16', qualities: ['1K', '2K', '4K'], preview: '9:16', px: { '1K': '1080×1920', '2K': '1152×2048', '4K': '2160×3840' } },
  };
  const DEFAULT_AI_OPTIONS = {
    auto:   { label: 'auto', qualities: ['1K', '2K', '4K'], preview: 'auto', px: { '1K': 'auto', '2K': 'auto', '4K': 'auto' } },
    '1:1':  { label: '1:1', qualities: ['1K', '2K', '4K'], preview: '1024×1024', px: { '1K': '1024×1024', '2K': '2048×2048', '4K': '4096×4096' } },
    '3:4':  { label: '3:4', qualities: ['1K', '2K', '4K'], preview: '768×1024', px: { '1K': '768×1024', '2K': '1536×2048', '4K': '2448×3264' } },
    '9:16': { label: '9:16', qualities: ['1K', '2K', '4K'], preview: '1080×1920', px: { '1K': '1080×1920', '2K': '1152×2048', '4K': '2160×3840' } },
  };

  // 从文本内容检测当前模式
  const _t = (lockedCommand || text).trimStart();
  const activeAiModel =
    /^\/Gpt image 2/i.test(_t) ? 'gpt-image-2' :
    /^\/Nano Banana pro/i.test(_t) ? 'nano-banana-pro' :
    '';
  const activeMode =
    /^\/(Nano Banana pro|Gpt image 2)/i.test(_t) ? 'ai-image' :
    _t.startsWith('/特殊品（完整）') ? 'special_full' :
    _t.startsWith('/特殊品') ? 'special' :
    'compose';
  const isSpecialTemplate = Boolean(template && (template.is_special || template.is_special_full));
  const isImageTypeLocked = activeMode === 'ai-image' || activeMode === 'special' || activeMode === 'special_full' || isSpecialTemplate;
  const aiOptionMap = activeAiModel === 'gpt-image-2' ? GPT_IMAGE2_OPTIONS : DEFAULT_AI_OPTIONS;
  const AI_RATIOS = Object.keys(aiOptionMap);
  const currentAiRatioMeta = aiOptionMap[aiRatio] || aiOptionMap[AI_RATIOS[0]];
  const allowedAiQualities = currentAiRatioMeta ? currentAiRatioMeta.qualities : AI_QUALITIES;
  const currentAiPx = currentAiRatioMeta && currentAiRatioMeta.px ? (currentAiRatioMeta.px[aiQuality] || currentAiRatioMeta.preview) : '';
  const aiImageSize = aiRatio;

  React.useEffect(() => {
    if (activeAiModel === 'gpt-image-2') {
      if (!GPT_IMAGE2_OPTIONS[aiRatio]) {
        setAiRatio('auto');
        return;
      }
      if (!GPT_IMAGE2_OPTIONS[aiRatio].qualities.includes(aiQuality)) {
        setAiQuality(GPT_IMAGE2_OPTIONS[aiRatio].qualities[0]);
      }
      return;
    }
    if (activeAiModel === 'nano-banana-pro' && !DEFAULT_AI_OPTIONS[aiRatio]) {
      setAiRatio('auto');
    }
  }, [activeAiModel, aiQuality, aiRatio]);

  const [menuOpen, setMenuOpen] = React.useState(false);
  React.useEffect(() => {
    setMenuOpen(!lockedCommand && /^\/\S*$/.test(text));
  }, [text, lockedCommand]);

  const slashQuery = menuOpen ? (text.match(/^\/\S*/) || [null])[0] : null;

  const pickCommand = (c) => {
    setLockedCommand(c.cmd);
    setText('');
    setMenuOpen(false);
    setTimeout(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(c.cmd.length + 1, c.cmd.length + 1);
    }, 0);
  };

  const restoreMessage = React.useCallback((message) => {
    const raw = String(message || '');
    const matched = COMMANDS.find(function(cmd) {
      return raw === cmd || raw.startsWith(cmd + ' ');
    });
    if (matched) {
      setLockedCommand(matched);
      setText(raw.slice(matched.length).trimStart());
    } else {
      setLockedCommand('');
      setText(raw);
    }
    setMenuOpen(false);
    setTimeout(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      const len = raw.length;
      el.setSelectionRange(len, len);
    }, 0);
  }, [COMMANDS]);

  const handleSend = () => {
    const body = text.trim();
    const message = lockedCommand ? (body ? lockedCommand + ' ' + body : lockedCommand) : body;
    if (!message || isLoading) return;
    const imagesToSend = [...refImages];
    setText('');
    setLockedCommand('');
    clearRefImages();
    onSend(message, imagesToSend, { size: aiImageSize, resolution: aiQuality });
  };

  const handleKeyDown = (e) => {
    const el = taRef.current;
    const start = el ? el.selectionStart : 0;
    const end = el ? el.selectionEnd : 0;
    const currentMessage = lockedCommand ? (text ? (lockedCommand + ' ' + text) : lockedCommand) : text.trim();
    if (
      e.key === 'ArrowDown' &&
      files.length === 0 &&
      refImages.length === 0 &&
      lastSubmittedMessage &&
      currentMessage === lastSubmittedMessage
    ) {
      e.preventDefault();
      clearComposer();
      return;
    }
    if (
      e.key === 'ArrowUp' &&
      !lockedCommand &&
      !text.trim() &&
      files.length === 0 &&
      refImages.length === 0 &&
      lastSubmittedMessage
    ) {
      e.preventDefault();
      restoreMessage(lastSubmittedMessage);
      return;
    }
    if (lockedCommand) {
      const hasSelectionInPrefix = start < lockedPrefixLength || end < lockedPrefixLength;
      if (
        e.key === 'ArrowUp' &&
        !text.trim() &&
        files.length === 0 &&
        refImages.length === 0 &&
        lastSubmittedMessage
      ) {
        e.preventDefault();
        restoreMessage(lastSubmittedMessage);
        return;
      }
      if (e.key === 'Backspace' && !text && start <= lockedPrefixLength && end <= lockedPrefixLength) {
        e.preventDefault();
        setLockedCommand('');
        return;
      }
      if (hasSelectionInPrefix) {
        if (
          e.key === 'Backspace' || e.key === 'Delete' ||
          e.key === 'Enter' || e.key === 'Tab' ||
          (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey)
        ) {
          e.preventDefault();
          requestAnimationFrame(() => {
            const input = taRef.current;
            if (input) input.setSelectionRange(lockedPrefixLength, lockedPrefixLength);
          });
          return;
        }
        if (e.key === 'Home' || e.key === 'ArrowLeft') {
          e.preventDefault();
          requestAnimationFrame(() => {
            const input = taRef.current;
            if (input) input.setSelectionRange(lockedPrefixLength, lockedPrefixLength);
          });
          return;
        }
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextChange = (e) => {
    const next = e.target.value;
    if (lockedCommand) {
      if (next.startsWith(lockedCommand + ' ')) {
        setText(next.slice(lockedPrefixLength));
        return;
      }
      if (next === lockedCommand || next === lockedCommand + '') {
        setText('');
        return;
      }
      if (next.startsWith(lockedCommand)) {
        setText(next.slice(lockedCommand.length).replace(/^\s+/, ''));
        return;
      }
      setText(next.slice(Math.min(next.length, lockedPrefixLength)).replace(/^\s+/, ''));
      return;
    }
    if (!lockedCommand) {
      const matched = COMMANDS.find(function(cmd) {
        return next.startsWith(cmd + ' ');
      });
      if (matched) {
        setLockedCommand(matched);
        setText(next.slice(matched.length).trimStart());
        return;
      }
    }
    setText(next);
  };

  const clampSelection = () => {
    if (!lockedCommand) return;
    const el = taRef.current;
    if (!el) return;
    if (el.selectionStart < lockedPrefixLength || el.selectionEnd < lockedPrefixLength) {
      const pos = Math.max(lockedPrefixLength, el.selectionEnd, el.selectionStart);
      requestAnimationFrame(() => {
        const input = taRef.current;
        if (input) input.setSelectionRange(pos, pos);
      });
    }
  };

  const handleFileSelect = (e) => {
    const fileList = Array.from(e.target.files || []);
    if (!fileList.length) return;
    const images = fileList.filter(f => f.type.startsWith('image/'));
    const others = fileList.filter(f => !f.type.startsWith('image/'));
    if (images.length) {
      setRefImages(prev => {
        const remaining = 4 - prev.length;
        const toAdd = images.slice(0, remaining).map(file => ({ file, previewUrl: URL.createObjectURL(file) }));
        return [...prev, ...toAdd];
      });
    }
    if (others.length) {
      const file = others[0];
      const fileObj = { name: file.name, size: formatFileSize(file.size), file, imageType };
      setFiles(prev => [...prev, fileObj]);
      if (onParseTable) {
        onParseTable(file, file.name, imageType).catch(err => console.error('Parse table error:', err));
      }
    }
    e.target.value = '';
  };

  const handlePaste = (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter(it => it.kind === 'file' && it.type.startsWith('image/'));
    if (!imageItems.length) return;
    e.preventDefault();
    setRefImages(prev => {
      const remaining = 4 - prev.length;
      const toAdd = imageItems.slice(0, remaining).map(it => {
        const file = it.getAsFile();
        return { file, previewUrl: URL.createObjectURL(file) };
      });
      return [...prev, ...toAdd];
    });
  };

  const removeRefImage = (idx) => {
    setRefImages(prev => {
      URL.revokeObjectURL(prev[idx]?.previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const clearRefImages = () => {
    setRefImages(prev => { prev.forEach(r => URL.revokeObjectURL(r.previewUrl)); return []; });
  };

  const clearComposer = React.useCallback(() => {
    setText('');
    setLockedCommand('');
    setFiles([]);
    clearRefImages();
    setMenuOpen(false);
    setTimeout(() => {
      const el = taRef.current;
      if (el) el.focus();
    }, 0);
  }, []);

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };
  const canSend = Boolean((lockedCommand ? (lockedCommand + ' ' + text.trim()).trim() : text.trim()) || files.length) && !isLoading;

  return (
    <div style={{
      flexShrink: 0, padding: 12,
      borderTop: '1px solid var(--line)',
      background: 'var(--panel)',
      position: 'relative',
    }}>
      <div style={{
        borderRadius: 12,
        border: menuOpen ? '1px solid var(--accent)' : '1px solid var(--line)',
        background: 'var(--panel-2)',
        padding: 10,
        display: 'flex', flexDirection: 'column', gap: 8,
        boxShadow: menuOpen ? '0 0 0 4px var(--accent-soft), var(--shadow-1)' : 'var(--shadow-1)',
        transition: 'box-shadow 150ms, border-color 150ms',
        position: 'relative',
      }}>
        {menuOpen && slashQuery && (
          <SlashMenu query={slashQuery} onPick={pickCommand} onClose={() => { setText(''); setMenuOpen(false); }}/>
        )}

        {/* Contextual toolbar — switches based on active command */}
        {activeMode !== 'ai-image' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, opacity: isImageTypeLocked ? 0.35 : 1, pointerEvents: isImageTypeLocked ? 'none' : 'auto' }}>
            {IMAGE_TYPES.map(t => (
              <button
                key={t.key}
                onClick={() => setImageType(t.key)}
                style={{
                  fontSize: 11, padding: '3px 0',
                  background: 'transparent', border: 'none',
                  color: imageType === t.key ? 'var(--ink)' : 'var(--ink-3)',
                  cursor: 'pointer', position: 'relative',
                }}
              >
                {t.label}
                {!isImageTypeLocked && imageType === t.key && (
                  <div style={{ position: 'absolute', bottom: -2, left: 0, right: 0, height: 2, background: 'var(--accent)', borderRadius: 1 }}/>
                )}
              </button>
            ))}
          </div>
        )}
        {activeMode === 'ai-image' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {AI_RATIOS.map(r => (
              <button key={r} onClick={() => setAiRatio(r)} style={{
                fontSize: 11, padding: '3px 0',
                background: 'transparent', border: 'none',
                color: aiRatio === r ? 'var(--ink)' : 'var(--ink-3)',
                cursor: 'pointer', position: 'relative',
              }} title={aiOptionMap[r] ? Object.entries(aiOptionMap[r].px || {}).map(function(entry) { return entry[1]; }).join(' / ') : ''}>
                {aiOptionMap[r].label}
                {aiRatio === r && (
                  <div style={{ position: 'absolute', bottom: -2, left: 0, right: 0, height: 2, background: 'var(--accent)', borderRadius: 1 }}/>
                )}
              </button>
            ))}
            <div style={{ width: 1, height: 12, background: 'var(--line)', flexShrink: 0 }}/>
            {AI_QUALITIES.map(q => {
              const disabled = !allowedAiQualities.includes(q);
              return (
                <button key={q} onClick={() => !disabled && setAiQuality(q)} style={{
                  fontSize: 11, padding: '3px 0',
                  background: 'transparent', border: 'none',
                  color: disabled ? 'var(--ink-3)' : aiQuality === q ? 'var(--ink)' : 'var(--ink-3)',
                  cursor: disabled ? 'not-allowed' : 'pointer', position: 'relative',
                  opacity: disabled ? 0.75 : 1,
                  textDecoration: disabled ? 'line-through' : 'none',
                  textDecorationThickness: disabled ? '1.5px' : 'initial',
                }}>
                  {q}
                  {!disabled && aiQuality === q && (
                    <div style={{ position: 'absolute', bottom: -2, left: 0, right: 0, height: 2, background: 'var(--accent)', borderRadius: 1 }}/>
                  )}
                </button>
              );
            })}
            <div
              title={currentAiPx || ''}
              style={{
                marginLeft: 'auto',
                minWidth: 34,
                height: 20,
                padding: '0 8px',
                borderRadius: 999,
                border: '1px solid var(--line-2)',
                color: 'var(--ink-3)',
                fontSize: 10,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--panel)',
                flexShrink: 0,
              }}
            >
              {aiRatio}
            </div>
          </div>
        )}
        <textarea
          className="composer-textarea"
          ref={taRef}
          value={displayValue}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onClick={clampSelection}
          onSelect={clampSelection}
          onFocus={clampSelection}
          placeholder="在这里开启对话吧，或者按 / 唤起指令菜单"
          rows={2}
          style={{
            width: '100%',
            minHeight: 44,
            maxHeight: 180,
            boxSizing: 'border-box',
            fontSize: 13,
            lineHeight: 1.45,
            fontFamily: 'inherit',
            color: 'var(--ink)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            border: 'none',
            outline: 'none',
            resize: 'none',
            overflowY: 'auto',
            background: 'transparent',
            margin: 0,
            padding: 0,
          }}
        />
        <style>{`.composer-textarea::placeholder { color: var(--ink-3); font-style: italic; font-size: 12px; opacity: 1; }`}</style>

        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          accept="image/*,.csv,.xlsx,.xls"
          multiple
          style={{ display: 'none' }}
        />

        {/* Reference images preview */}
        {refImages.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {refImages.map((img, idx) => (
              <div key={idx} style={{ position: 'relative', display: 'inline-flex' }}>
                <img
                  src={img.previewUrl}
                  alt={`参考图${idx + 1}`}
                  style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--line)' }}
                />
                <button
                  onClick={() => removeRefImage(idx)}
                  style={{
                    position: 'absolute', top: -5, right: -5,
                    width: 15, height: 15, borderRadius: 99,
                    background: 'var(--ink-2)', color: 'white',
                    display: 'grid', placeItems: 'center',
                    fontSize: 10, lineHeight: 1, cursor: 'pointer',
                  }}
                >×</button>
              </div>
            ))}
            <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>{refImages.length}/4</span>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{ padding: 6, borderRadius: 6, color: refImages.length > 0 ? 'var(--accent)' : 'var(--ink-2)', cursor: 'pointer' }}
            title={refImages.length > 0 ? `已附加 ${refImages.length} 张参考图` : '附加图片或文件'}
          >
            <I.paperclip size={14}/>
          </button>

          <div style={{ flex: 1 }}/>

          <button
            onClick={handleSend}
            style={{
              width: 30, height: 30, borderRadius: 8,
              background: canSend ? 'var(--ink)' : 'var(--line)',
              color: canSend ? 'white' : 'var(--ink-3)',
              display: 'grid', placeItems: 'center',
              cursor: canSend ? 'pointer' : 'default',
            }}>
            {isLoading ? (
              <div style={{ width: 14, height: 14, borderRadius: 99, border: '2px solid var(--ink-3)', borderRightColor: 'transparent', animation: 'spin 0.7s linear infinite' }}/>
            ) : (
              <I.arrowUp size={14} stroke={2.2}/>
            )}
          </button>
        </div>
      </div>


    </div>
  );
};

// ---------- Main ----------

console.log('[Main] Chat component definition');
const Chat = ({ state, template, onComposeComplete, slashTrigger }) => {
  const [messages, setMessages] = React.useState([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [lastSubmittedMessage, setLastSubmittedMessage] = React.useState('');
  const [currentAiChatId, setCurrentAiChatId] = React.useState('');
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const [historySessions, setHistorySessions] = React.useState([]);
  const [hoveredHistoryId, setHoveredHistoryId] = React.useState('');
  const historyWrapRef = React.useRef(null);

  // Extract required fields from template slots (e.g., "slot/product_1/name" -> "name")
  const getTemplateFields = React.useCallback((t) => {
    if (!t || !t.slots || t.slots.length === 0) return ['name'];
    const fields = new Set();
    t.slots.forEach(s => {
      const parts = (s.name || '').split('/');
      if (parts.length >= 3) {
        fields.add(parts[2]); // e.g., "name" from "slot/product_1/name"
      }
    });
    const result = Array.from(fields);
    return result.length > 0 ? result : ['name'];
  }, []);

  const templateFields = getTemplateFields(template);

  const loadAiChatHistory = React.useCallback(async () => {
    setHistoryLoading(true);
    try {
      const sessions = await window.API.listAiChats(20);
      setHistorySessions(sessions || []);
    } catch (e) {
      console.error('load ai chat history failed:', e);
      setHistorySessions([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const openHistory = React.useCallback(() => {
    setHistoryOpen(function(prev) {
      const next = !prev;
      if (!prev) loadAiChatHistory();
      return next;
    });
  }, [loadAiChatHistory]);

  const restoreAiChatSession = React.useCallback(async (sessionId) => {
    try {
      const data = await window.API.getAiChat(sessionId);
      setMessages(Array.isArray(data.messages) ? data.messages : []);
      setCurrentAiChatId(sessionId);
      setHistoryOpen(false);
      const lastUser = (data.messages || []).filter(function(m) { return m && m.who === 'user' && m.text; }).slice(-1)[0];
      setLastSubmittedMessage(lastUser ? lastUser.text : '');
    } catch (e) {
      console.error('restore ai chat session failed:', e);
    }
  }, []);

  const deleteAiChatHistory = React.useCallback(async (sessionId) => {
    if (!sessionId) return;
    if (!window.confirm('删除这条历史对话？')) return;
    try {
      await window.API.deleteAiChat(sessionId);
      setHistorySessions(function(prev) {
        return prev.filter(function(session) { return session.id !== sessionId; });
      });
      if (currentAiChatId === sessionId) {
        setMessages([]);
        setCurrentAiChatId('');
      }
    } catch (e) {
      console.error('delete ai chat history failed:', e);
      window.alert((e && e.message) ? e.message : '删除失败，请稍后重试');
    }
  }, [currentAiChatId]);

  const startNewAiChat = React.useCallback(() => {
    if (isLoading) return;
    setMessages([]);
    setCurrentAiChatId('');
    setHistoryOpen(false);
  }, [isLoading]);

  React.useEffect(() => {
    if (!historyOpen) return;
    const handlePointerDown = function(event) {
      if (!historyWrapRef.current) return;
      if (!historyWrapRef.current.contains(event.target)) {
        setHistoryOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return function() {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [historyOpen]);

  const parseProductRefs = React.useCallback(function(message) {
    var refs = [];
    var text = String(message || '');
    var pattern = /\[([^\[\]]+)\]/g;
    var match;
    while ((match = pattern.exec(text)) !== null) {
      var rawInner = (match[1] || '').trim();
      if (!rawInner) continue;
      var normalized = rawInner.replace(/\s+/g, '');
      var isAngle = /一双鞋角度$/i.test(normalized);
      var sku = isAngle ? normalized.replace(/一双鞋角度$/i, '') : normalized;
      if (!sku) continue;
      refs.push({
        raw: match[0],
        sku: sku,
        asset_type: isAngle ? 'white2x' : 'white',
      });
    }
    return refs;
  }, []);

  const loadResolvedRefFiles = React.useCallback(async function(resolvedRefs) {
    var files = [];
    for (var i = 0; i < resolvedRefs.length; i++) {
      var ref = resolvedRefs[i];
      if (!ref || !ref.matched) continue;
      var blob = null;
      if (ref.content_base64) {
        var binary = atob(ref.content_base64);
        var bytes = new Uint8Array(binary.length);
        for (var j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
        blob = new Blob([bytes], { type: ref.mime_type || 'image/png' });
      } else if (ref.url) {
        var apiBase = window.API_BASE || window.location.origin;
        var resp = await fetch(apiBase + ref.url, { credentials: 'include' });
        if (!resp.ok) throw new Error('素材图下载失败: ' + (ref.sku || 'unknown'));
        blob = await resp.blob();
      }
      if (!blob) throw new Error('素材图下载失败: ' + (ref.sku || 'unknown'));
      files.push({
        file: new File([blob], ref.filename || ((ref.sku || 'product') + '.png'), { type: blob.type || ref.mime_type || 'image/png' }),
        previewUrl: URL.createObjectURL(blob),
        _resolvedRef: ref,
      });
    }
    return files;
  }, []);

  const enhancePromptWithProductRefs = React.useCallback(function(prompt, resolvedRefs, hasSceneReference) {
    var cleanPrompt = String(prompt || '');
    resolvedRefs.forEach(function(ref, index) {
      var replacement = resolvedRefs.length > 1 ? ('这个白底产品图' + (index + 1)) : '这个白底产品图';
      cleanPrompt = cleanPrompt.split(ref.raw).join(replacement);
    });
    var instructions = [
      cleanPrompt,
      '',
      hasSceneReference
        ? '同时参考用户上传的场景图，除非用户另有要求，否则尽量保持原有构图、机位、透视关系、光影和版式。'
        : '除非用户另有要求，否则尽量保持原有构图、机位、透视关系、光影和版式。',
      '把白底产品图作为商品外观参考，严格参考它的款式、配色、材质、轮廓和细节，不要自行改动商品外观。'
    ];
    return instructions.join('\n').trim();
  }, []);

  const handleSend = React.useCallback(async (text, refImages = [], aiOptions = {}) => {
    if (!text.trim() || isLoading) return;
    setLastSubmittedMessage(text);

    // ── AI 生图流程（前端友好名，后端映射到服务商模型名）────────────────────────
    const AI_IMAGE_CMDS = [
      { prefix: '/Nano Banana pro', model: 'nano-banana-pro' },
      { prefix: '/Gpt image 2',     model: 'gpt-image-2' },
    ];
    const trimmed = text.trimStart();
    const aiCmd = AI_IMAGE_CMDS.find(c => trimmed.toLowerCase().startsWith(c.prefix.toLowerCase()));
    if (aiCmd) {
      const prompt = trimmed.slice(aiCmd.prefix.length).trim();
      if (!prompt) {
        setMessages(msgs => [...msgs,
          { who: 'user', text },
          { who: 'ai', text: `请在 ${aiCmd.prefix} 后输入图片描述，例如：${aiCmd.prefix} 一只在草地上奔跑的柴犬` },
        ]);
        return;
      }
      setMessages(msgs => [...msgs, { who: 'user', text }]);
      setIsLoading(true);
      const startedAt = Date.now();
      var finalPrompt = prompt;
      var finalRefImages = Array.isArray(refImages) ? refImages.slice() : [];
      setMessages(msgs => [...msgs, {
        who: 'ai', type: 'ai-image-generating',
        model: aiCmd.model, prompt,
        status: 'running', startedAt,
        meta: aiCmd.model,
        hasReference: refImages.length > 0,
        refCount: refImages.length,
      }]);
      try {
        var productRefs = parseProductRefs(prompt);
        if (productRefs.length > 0) {
          var resolvedRefs = await window.API.resolveProductRefs(productRefs);
          var missingRefs = resolvedRefs.filter(function(ref) { return !ref.matched; });
          if (missingRefs.length > 0) {
            throw new Error('未找到素材图：' + missingRefs.map(function(ref) {
              return (ref.sku || '') + (ref.asset_type === 'white2x' ? ' 一双鞋角度' : '');
            }).join('，'));
          }
          var productRefFiles = await loadResolvedRefFiles(resolvedRefs);
          finalRefImages = finalRefImages.concat(productRefFiles);
          finalPrompt = enhancePromptWithProductRefs(prompt, resolvedRefs, refImages.length > 0);
        }
        const apiBase = window.API_BASE || window.location.origin;
        const fd = new FormData();
        fd.append('model', aiCmd.model);
        fd.append('prompt', finalPrompt);
        fd.append('size', aiOptions.size || '1024x1024');
        fd.append('resolution', aiOptions.resolution || '1K');
        if (currentAiChatId) fd.append('chat_session_id', currentAiChatId);
        finalRefImages.forEach(r => fd.append('image', r.file));
        const res = await fetch(apiBase + '/ai-image', { method: 'POST', body: fd, credentials: 'include' });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          if (err.detail && typeof err.detail === 'object' && err.detail.chat_session_id) {
            setCurrentAiChatId(err.detail.chat_session_id);
          }
          throw new Error(
            (err.detail && typeof err.detail === 'object' ? err.detail.message : err.detail) || `HTTP ${res.status}`
          );
        }
        const data = await res.json();
        if (data.chat_session_id) setCurrentAiChatId(data.chat_session_id);
        const finalElapsed = Math.floor((Date.now() - startedAt) / 1000);
        setMessages(msgs => msgs.map(m =>
          m.type === 'ai-image-generating' && m.startedAt === startedAt
            ? { ...m, status: 'done', imageUrl: apiBase + data.url, finalElapsed }
            : m
        ));
        loadAiChatHistory();
      } catch (e) {
        const finalElapsed = Math.floor((Date.now() - startedAt) / 1000);
        setMessages(msgs => msgs.map(m =>
          m.type === 'ai-image-generating' && m.startedAt === startedAt
            ? { ...m, status: 'failed', error: e.message, finalElapsed }
            : m
        ));
        loadAiChatHistory();
      }
      setIsLoading(false);
      return;
    }

    // ── 特殊品（完整）流程 ────────────────────────────────────────────────────
    const _isSpecialFull = text.trimStart().startsWith('/特殊品（完整）');
    const _isSpecial     = !_isSpecialFull && text.trimStart().startsWith('/特殊品');
    if (_isSpecial || _isSpecialFull) {
      const _cmdLabel  = _isSpecialFull ? '特殊品（完整）' : '特殊品';
      const _endpoint  = _isSpecialFull ? '/special-compose-full' : '/special-compose';
      const _pollBase  = _isSpecialFull ? '/special-compose-full' : '/special-compose';
      const _argRegex  = _isSpecialFull ? /^\/特殊品（完整）\s*/ : /^\/特殊品\s*/;
      const _errHint   = _isSpecialFull
        ? '请提供 SKU，格式：/特殊品（完整） SKU，文案，时间文案'
        : '请提供 SKU，格式：/特殊品 SKU，文案，时间文案';
      const _tplHint   = _isSpecialFull ? '请先在左侧选择特殊品（完整）模板' : '请先在左侧选择特殊品模板';

      setMessages(msgs => [...msgs, { who: 'user', text }]);
      setIsLoading(true);
      // 先插入 generating 消息占位
      let specialMsgIdx = null;
      setMessages(msgs => {
        specialMsgIdx = msgs.length;
        return [...msgs, {
          who: 'ai', type: 'generating',
          logs: [`正在启动${_cmdLabel}合成…`],
          status: 'running', meta: `Loom · ${_cmdLabel}`,
          startedAt: Date.now(),
        }];
      });
      try {
        const args = text.replace(_argRegex, '').trim();
        const parts = args.split('，').map(s => s.trim());
        const sku = parts[0] || '';
        const fields = { name: parts[1] || '', time: parts[2] || '' };
        if (!sku) throw new Error(_errHint);
        if (!template) throw new Error(_tplHint);

        const frameIds = template.frames ? template.frames.map(f => f.id) : [template.id];
        const fileId = template.file_id || (template.frames && template.frames[0]?.file_id);
        const pageId = template.page_id || (template.frames && template.frames[0]?.page_id);

        const resp = await fetch(_endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_id: fileId, page_id: pageId, frame_ids: frameIds, sku, fields, export_scale: 2.0 }),
        });
        if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.detail || resp.status); }
        const job = await resp.json();

        // 轮询 + 实时更新日志
        let done = false;
        for (let i = 0; i < 120 && !done; i++) {
          await new Promise(r => setTimeout(r, 1500));
          const s = await fetch(`${_pollBase}/${job.id}`).then(r => r.json());
          setMessages(msgs => msgs.map((m, idx) => {
            if (idx !== specialMsgIdx) return m;
            const finishing = s.status === 'done' || s.status === 'failed';
            return { ...m, logs: s.progress || [], status: s.status,
              ...(finishing && m.startedAt ? { finalElapsed: Math.floor((Date.now() - m.startedAt) / 1000) } : {}),
            };
          }));
          if (s.status === 'done') {
            const workFileId = s.penpot_file_id;
            // 优先用后端记录的 result_paths（支持变体 _v1/_v2 命名），降级到旧模式
            const buildUrls = () => {
              if (s.result_paths && s.result_paths.length > 0) {
                // result_paths 是绝对路径，提取 {job_id}/frame_xxx.png 部分
                return s.result_paths.map(p => {
                  const m = p.replace(/\\/g, '/').match(/results\/(.+)$/);
                  return m ? `/results/${m[1]}` : null;
                }).filter(Boolean);
              }
              // 降级：旧命名 frame_{i}.png
              const frameIds = s.result_frame_ids || [];
              return frameIds.map((_, i) => `/results/${job['id']}/frame_${i}.png`);
            };
            const urls = buildUrls();
            setMessages(msgs => msgs.map((m, idx) => {
              if (idx !== specialMsgIdx) return m;
              return { ...m, status: 'done', specialUrls: urls, penpotUrl: s.penpot_edit_url };
            }));
            // 构建 resultTpl 供画布预览
            if (onComposeComplete && urls.length > 0 && workFileId && template) {
              const base = structuredClone(template);
              const baseFrames = base.frames && base.frames.length > 0 ? base.frames : [base];
              const tplFrames = template.frames && template.frames.length > 0 ? template.frames : [template];
              const frameNames = tplFrames.map(f => f.name || f.variant || '画板');
              base.frames = urls.map((url, i) => ({ ...(baseFrames[i % baseFrames.length] || baseFrames[0]), resultUrl: url }));
              base._frameNames = frameNames;
              window.lastComposeJobId = job['id'];
              window.lastComposeEndpoint = _pollBase;
              window.lastComposeFrameNames = frameNames;
              onComposeComplete(null, s.penpot_edit_url, null, base);
            }
            done = true;
          } else if (s.status === 'failed') {
            throw new Error(s.error || '合成失败');
          }
        }
        if (!done) throw new Error('合成超时，请检查后端日志');
      } catch (e) {
        setMessages(msgs => msgs.map((m, idx) => {
          if (idx !== specialMsgIdx) return m;
          return { ...m, status: 'failed', error: e.message };
        }));
      }
      setIsLoading(false);
      return;
    }

    // ── 普通消息 ─────────────────────────────────────────────────────────────
    setIsLoading(true);
    // Add user message
    setMessages(msgs => [...msgs, { who: 'user', text }]);
    try {
      const reply = await window.API.chatWithAI(
        [{ role: 'user', content: text }],
        {}
      );
      setMessages(msgs => [...msgs, { who: 'ai', text: reply || '...', meta: 'Loom' }]);
    } catch (e) {
      setMessages(msgs => [...msgs, { who: 'ai', text: '错误: ' + (e.message || '未知错误'), meta: '错误' }]);
    }
    setIsLoading(false);
  }, [currentAiChatId, enhancePromptWithProductRefs, isLoading, loadAiChatHistory, loadResolvedRefFiles, parseProductRefs, template]);

  const handleParseTable = React.useCallback(async (file, filename, imageType) => {
    // Add user message showing file was uploaded
    setMessages(msgs => [...msgs, { who: 'user', text: '已上传 ' + filename, file: filename, imageType: imageType }]);
    setIsLoading(true);
    try {
      const result = await window.API.parseTable(file, templateFields, imageType);
      // Add AI message with parse result
      setMessages(msgs => [...msgs, {
        who: 'ai',
        type: 'parse-result',
        data: result,
        meta: '解析了 ' + result.products.length + ' 个产品',
        fields: templateFields
      }]);
    } catch (e) {
      setMessages(msgs => [...msgs, { who: 'ai', text: '解析错误: ' + (e.message || '未知错误'), meta: '错误' }]);
    }
    setIsLoading(false);
  }, [isLoading, templateFields]);

  const handleCompose = React.useCallback(async (template, parseResult) => {
    if (!template || !parseResult) return;
    // Build slots from products with image_path
    const slots = {};
    parseResult.products.forEach((p, i) => {
      if (p.image_path) {
        slots['product_' + (i + 1)] = {
          image_path: p.image_path,
          name: p.name || null,
          price: p.price || null,
          tag: p.tag || null,
          spec: p.spec || null,
        };
      }
    });
    if (Object.keys(slots).length === 0) return;
    setIsLoading(true);
    // Add generating message
    let msgId = null;
    setMessages(msgs => {
      msgId = msgs.length;
      return [...msgs, {
        who: 'ai',
        type: 'generating',
        jobId: null,
        logs: ['正在启动合成任务...'],
        meta: '生成中',
        startedAt: Date.now(),
      }];
    });
    try {
      const job = await window.API.createCompose({
        file_id: template.file_id,
        template_frame_id: template.id,
        page_id: template.page_id,
        slots: slots,
        export_scale: 2.0,
      });
      // Poll for status
      const pollInterval = setInterval(async () => {
        try {
          const status = await window.API.getCompose(job.id);
          // Update logs
          setMessages(msgs => msgs.map((m, i) => {
            if (i !== msgId) return m;
            const finishing = status.status === 'done' || status.status === 'failed';
            return {
              ...m,
              jobId: job.id,
              status: status.status,
              logs: status.progress || [],
              resultPath: status.result_path,
              error: status.error,
              ...(finishing && m.startedAt ? { finalElapsed: Math.floor((Date.now() - m.startedAt) / 1000) } : {}),
            };
          }));
          // Stop polling if done or failed
          if (status.status === 'done' || status.status === 'failed') {
            clearInterval(pollInterval);
            setIsLoading(false);
            if (status.status === 'done' && onComposeComplete) {
              onComposeComplete(job.id, status.penpot_edit_url);
            }
          }
        } catch (e) {
          clearInterval(pollInterval);
          setIsLoading(false);
          setMessages(msgs => msgs.map((m, i) => {
            if (i !== msgId) return m;
            return { ...m, status: 'failed', error: e.message };
          }));
        }
      }, 1000);
    } catch (e) {
      setMessages(msgs => msgs.map((m, i) => {
        if (i !== msgId) return m;
        return { ...m, status: 'failed', error: e.message };
      }));
      setIsLoading(false);
    }
  }, [templateFields]);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--panel)',
      borderLeft: '1px solid var(--line)',
      position: 'relative',
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
            background: isLoading ? 'var(--accent)' : 'var(--ok)',
            animation: isLoading ? 'pulse 1.2s ease-in-out infinite' : 'none',
          }}/>
          <button
            onClick={startNewAiChat}
            title={isLoading ? '生成中暂不可新建对话' : '开启新对话'}
            style={{
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '-0.01em',
              color: 'var(--ink)',
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: isLoading ? 'not-allowed' : 'pointer',
            }}
          >
            Ai助手
          </button>
          <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>
            {isLoading ? 'working…' : messages.length === 0 ? 'ready' : messages.length + ' messages'}
          </span>
        </div>
        <div style={{ flex: 1 }}/>
        <div ref={historyWrapRef} style={{ position: 'relative' }}>
          <button
            onClick={openHistory}
            title="历史对话"
            style={{
              width: 28,
              height: 28,
              display: 'grid',
              placeItems: 'center',
              padding: 0,
              borderRadius: 8,
              background: historyOpen ? 'var(--panel)' : 'transparent',
              border: '1px solid ' + (historyOpen ? 'var(--line)' : 'transparent'),
              color: historyOpen ? 'var(--ink)' : 'var(--ink-3)',
              cursor: 'pointer',
            }}
          >
            <I.file size={12}/>
          </button>

          {historyOpen && (
            <div style={{
              position: 'absolute',
              top: 34,
              right: 0,
              width: 196,
              maxHeight: 288,
              overflowY: 'auto',
              borderRadius: 12,
              background: 'var(--panel)',
              border: '1px solid var(--line)',
              boxShadow: '0 10px 24px rgba(15, 23, 42, 0.08)',
              zIndex: 20,
              padding: 6,
            }}>
              <div className="mono" style={{
                padding: '6px 8px 7px',
                fontSize: 9.5,
                color: 'var(--ink-3)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}>AI chats</div>
              {historyLoading && (
                <div style={{ padding: '8px', fontSize: 11, color: 'var(--ink-3)' }}>加载中...</div>
              )}
              {!historyLoading && historySessions.length === 0 && (
                <div style={{ padding: '8px', fontSize: 11, color: 'var(--ink-3)' }}>暂无历史对话</div>
              )}
              {!historyLoading && historySessions.map(function(session) {
                return (
                  <div
                    key={session.id}
                    onMouseEnter={() => setHoveredHistoryId(session.id)}
                    onMouseLeave={() => setHoveredHistoryId(function(prev) { return prev === session.id ? '' : prev; })}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '2px 0',
                    }}
                  >
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        deleteAiChatHistory(session.id);
                      }}
                      title="删除"
                      style={{
                        width: 18,
                        height: 18,
                        flexShrink: 0,
                        display: 'grid',
                        placeItems: 'center',
                        borderRadius: 6,
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--ink-3)',
                        cursor: 'pointer',
                        padding: 0,
                        opacity: hoveredHistoryId === session.id ? 1 : 0,
                        pointerEvents: hoveredHistoryId === session.id ? 'auto' : 'none',
                        transition: 'opacity 120ms ease',
                      }}
                    >
                      <I.close size={10}/>
                    </button>
                    <button
                      onClick={() => restoreAiChatSession(session.id)}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        textAlign: 'left',
                        padding: '8px 9px',
                        borderRadius: 8,
                        background: currentAiChatId === session.id ? 'var(--panel-2)' : 'transparent',
                        border: '1px solid ' + (currentAiChatId === session.id ? 'var(--line-2)' : 'transparent'),
                        color: currentAiChatId === session.id ? 'var(--ink)' : 'var(--ink-2)',
                        fontSize: 11.5,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        cursor: 'pointer',
                      }}
                      title={session.title}
                    >
                      {session.title}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {state === 'empty' && messages.length === 0 && <ChatEmpty/>}
      {state === 'empty' && messages.length > 0 && <ChatReturned messages={messages} template={template} onCompose={handleCompose} isGenerating={isLoading}/>}
      {state === 'generating' && <ChatGenerating/>}
      {state === 'returned' && <ChatReturned messages={messages} template={template} onCompose={handleCompose} isGenerating={isLoading}/>}

      <Composer onSend={handleSend} onParseTable={handleParseTable} isLoading={isLoading} slashTrigger={slashTrigger} template={template} lastSubmittedMessage={lastSubmittedMessage}/>
    </div>
  );
};

window.Chat = Chat;

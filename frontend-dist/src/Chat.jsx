// AI chat column. Three states: empty / generating / returned.
// Rich message types: text, option chips, file cards, action buttons, thinking trace, image results.

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
            {m.type === 'parse-result' ? (() => {
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
                  {m.status === 'done' ? (
                    <>
                      <div style={{ width: 18, height: 18, borderRadius: 99, background: 'var(--ok)' }}/>
                      <span style={{ fontSize: 13, color: 'var(--ok)', fontWeight: 600 }}>生成完成</span>
                    </>
                  ) : m.status === 'failed' ? (
                    <>
                      <div style={{ width: 18, height: 18, borderRadius: 99, background: 'var(--warn)' }}/>
                      <span style={{ fontSize: 13, color: 'var(--warn)', fontWeight: 600 }}>生成失败</span>
                    </>
                  ) : (
                    <>
                      <div style={{ width: 18, height: 18, borderRadius: 99, border: '2px solid var(--line)', borderRightColor: 'transparent', animation: 'spin 0.8s linear infinite' }}/>
                      <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>生成中...</span>
                    </>
                  )}
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

const Composer = ({ onSend, onParseTable, isLoading, slashTrigger }) => {
  const [text, setText] = React.useState('');
  const [files, setFiles] = React.useState([]);
  const [imageType, setImageType] = React.useState('png');
  const taRef = React.useRef(null);
  const fileInputRef = React.useRef(null);

  // 外部触发 slash 命令（选中特殊品模板时）
  React.useEffect(() => {
    if (!slashTrigger) return;
    const val = '/' + slashTrigger.cmd + ' ';
    setText(val);
    setMenuOpen(false);
    setTimeout(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(val.length, val.length);
    }, 0);
  }, [slashTrigger?.key]);

  // Image type options
  const IMAGE_TYPES = [
    { key: 'png', label: 'PNG' },
    { key: 'white', label: '白底' },
    { key: 'model', label: '模特' },
    { key: 'shadow', label: '阴影' },
    { key: 'white2x', label: '白底x2' },
  ];

  // menuOpen: 独立控制菜单显示，选完命令后关闭，避免继续匹配 text
  const [menuOpen, setMenuOpen] = React.useState(false);

  // 当 text 重新以 / 开头且没有空格时自动打开菜单
  React.useEffect(() => {
    if (/^\/\S*$/.test(text)) {
      setMenuOpen(true);
    } else {
      setMenuOpen(false);
    }
  }, [text]);

  // slashQuery 只在菜单打开时有效
  const slashQuery = menuOpen ? (text.match(/^\/\S*/) || [null])[0] : null;

  // 特殊品流程不使用图片类型选项
  const imageTypeDisabled = text.trimStart().startsWith('/特殊品');

  const pickCommand = (c) => {
    const val = c.cmd + ' ';
    setText(val);
    setMenuOpen(false);  // 选完立刻关闭菜单
    // 等 React 更新 DOM 后，把光标移到末尾
    setTimeout(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(val.length, val.length);
    }, 0);
  };

  const handleSend = () => {
    if (!text.trim() || isLoading) return;
    const msg = text.trim();
    setText('');
    onSend(msg);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelect = (e) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];
    const fileObj = { name: file.name, size: formatFileSize(file.size), file: file, imageType };
    setFiles(prev => [...prev, fileObj]);
    // Call onParseTable if provided
    if (onParseTable) {
      onParseTable(file, file.name, imageType).catch(err => {
        console.error('Parse table error:', err);
      });
    }
    // Reset input
    e.target.value = '';
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
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

        {/* Image type selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, opacity: imageTypeDisabled ? 0.35 : 1, transition: 'opacity 150ms' }}>
          {IMAGE_TYPES.map(t => (
            <button
              key={t.key}
              onClick={() => !imageTypeDisabled && setImageType(t.key)}
              disabled={imageTypeDisabled}
              style={{
                fontSize: 11,
                padding: '3px 0',
                background: 'transparent',
                border: 'none',
                color: imageType === t.key && !imageTypeDisabled ? 'var(--ink)' : 'var(--ink-3)',
                cursor: imageTypeDisabled ? 'not-allowed' : 'pointer',
                position: 'relative',
              }}
            >
              {t.label}
              {imageType === t.key && !imageTypeDisabled && (
                <div style={{
                  position: 'absolute',
                  bottom: -2,
                  left: 0,
                  right: 0,
                  height: 2,
                  background: 'var(--accent)',
                  borderRadius: 1,
                }}/>
              )}
            </button>
          ))}
        </div>

        <textarea
          className="composer-textarea"
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="在这里开启对话吧，或者按/唤起指令菜单"
          rows={2}
          style={{
            border: 'none', outline: 'none', resize: 'none',
            background: 'transparent',
            fontSize: 13, lineHeight: 1.45, color: 'var(--ink)',
            fontFamily: 'inherit',
          }}
        />
        <style>{`.composer-textarea::placeholder { color: var(--ink-3); font-style: italic; font-size: 12px; opacity: 1; }`}</style>

        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          accept=".csv,.xlsx,.xls"
          style={{ display: 'none' }}
        />


        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{ padding: 6, borderRadius: 6, color: 'var(--ink-2)', cursor: 'pointer' }}
            title="Attach file"
          >
            <I.paperclip size={14}/>
          </button>
          <button style={{ padding: 6, borderRadius: 6, color: 'var(--ink-2)' }} title="Insert image">
            <I.image size={14}/>
          </button>
          <button style={{ padding: 6, borderRadius: 6, color: 'var(--ink-2)' }} title="Style">
            <I.palette size={14}/>
          </button>

          <div style={{ flex: 1 }}/>


          <button
            onClick={handleSend}
            style={{
              width: 30, height: 30, borderRadius: 8,
              background: (text || files.length) && !isLoading ? 'var(--ink)' : 'var(--line)',
              color: (text || files.length) && !isLoading ? 'white' : 'var(--ink-3)',
              display: 'grid', placeItems: 'center',
              cursor: (text || files.length) && !isLoading ? 'pointer' : 'default',
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

  const handleSend = React.useCallback(async (text) => {
    if (!text.trim() || isLoading) return;

    // ── 特殊品流程 ────────────────────────────────────────────────────────────
    if (text.trimStart().startsWith('/特殊品')) {
      setMessages(msgs => [...msgs, { who: 'user', text }]);
      setIsLoading(true);
      // 先插入 generating 消息占位
      let specialMsgIdx = null;
      setMessages(msgs => {
        specialMsgIdx = msgs.length;
        return [...msgs, {
          who: 'ai', type: 'generating',
          logs: ['正在启动特殊品合成…'],
          status: 'running', meta: 'Loom · 特殊品',
        }];
      });
      try {
        const args = text.replace(/^\/特殊品\s*/, '').trim();
        const parts = args.split('，').map(s => s.trim());
        const sku = parts[0] || '';
        const fields = { name: parts[1] || '', time: parts[2] || '' };
        if (!sku) throw new Error('请提供 SKU，格式：/特殊品 SKU，文案，时间文案');
        if (!template) throw new Error('请先在左侧选择特殊品模板');

        const frameIds = template.frames ? template.frames.map(f => f.id) : [template.id];
        const fileId = template.file_id || (template.frames && template.frames[0]?.file_id);
        const pageId = template.page_id || (template.frames && template.frames[0]?.page_id);

        const resp = await fetch('/special-compose', {
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
          const s = await fetch(`/special-compose/${job.id}`).then(r => r.json());
          setMessages(msgs => msgs.map((m, idx) => {
            if (idx !== specialMsgIdx) return m;
            return { ...m, logs: s.progress || [], status: s.status };
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
  }, [isLoading, template]);

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
        meta: '生成中'
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
            return {
              ...m,
              jobId: job.id,
              status: status.status,
              logs: status.progress || [],
              resultPath: status.result_path,
              error: status.error,
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
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em' }}>Ai助手</span>
          <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>
            {isLoading ? 'working…' : messages.length === 0 ? 'ready' : messages.length + ' messages'}
          </span>
        </div>
        <div style={{ flex: 1 }}/>
      </div>

      {state === 'empty' && messages.length === 0 && <ChatEmpty/>}
      {state === 'empty' && messages.length > 0 && <ChatReturned messages={messages} template={template} onCompose={handleCompose} isGenerating={isLoading}/>}
      {state === 'generating' && <ChatGenerating/>}
      {state === 'returned' && <ChatReturned messages={messages} template={template} onCompose={handleCompose} isGenerating={isLoading}/>}

      <Composer onSend={handleSend} onParseTable={handleParseTable} isLoading={isLoading} slashTrigger={slashTrigger}/>
    </div>
  );
};

window.Chat = Chat;

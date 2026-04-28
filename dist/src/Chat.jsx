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

// ---------- States ----------

const ChatEmpty = () => {
  const prompts = [
    { icon: <I.image size={13}/>,    text: 'Upload product photos and describe the vibe' },
    { icon: <I.type size={13}/>,     text: 'Paste brand guidelines from a PDF' },
    { icon: <I.palette size={13}/>,  text: 'Generate 4 variations in a muted palette' },
    { icon: <I.dims size={13}/>,     text: 'Resize this to 9:16 for Instagram Stories' },
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
        <div className="serif" style={{ fontSize: 19, letterSpacing: '-0.01em' }}>How can I help design today?</div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'center', maxWidth: 240, lineHeight: 1.5 }}>
          Upload anything — product shots, references, brand kits — or just start typing.
        </div>
      </div>

      <div className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '12px 4px 6px' }}>Try</div>
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

const ChatReturned = () => (
  <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
    {/* Session header */}
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '4px 0', fontSize: 10,
    }}>
      <span className="mono" style={{ color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Session · Product Hero</span>
      <div style={{ flex: 1, height: 1, background: 'var(--line-2)' }}/>
      <span className="mono" style={{ color: 'var(--ink-3)' }}>5 turns</span>
    </div>

    <Bubble who="user">
      <FileCard name="autumn-brief.csv" size="3.1 KB" type="CSV"/>
      <FileCard name="vase-shelf-ref.jpg" size="2.4 MB" type="JPG"/>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
        <CommandEcho cmd="/analyze" cn="分析素材"/>
      </div>
    </Bubble>

    <Bubble who="ai" meta="Loom · parsed 2 files">
      <TextBubble who="ai">
        I pulled the brief and the reference. Here's what I got — anything with <b>Med</b> or <b>Low</b> confidence is worth a quick look.
      </TextBubble>
      <ParseTable
        title="Brief parsed"
        subtitle="autumn-brief.csv"
        source="CSV"
        rows={[
          { field: 'Campaign', value: 'Autumn \'26 — ceramic drop',           conf: 'high' },
          { field: 'Audience', value: 'Japandi home, 28–40, design-forward',  conf: 'high' },
          { field: 'Channel',  value: 'Homepage hero + social',                conf: 'high' },
          { field: 'Ratio',    value: '4:5 (primary), 9:16 (story)',           conf: 'high', editable: true },
          { field: 'Copy',     value: '"New in · Autumn \'26"',                 conf: 'med', editable: true, note: 'CSV listed two variants — picked the shorter one.' },
          { field: 'Palette',  value: 'Clay, ivory, muted olive',              conf: 'med' },
          { field: 'Deadline', value: 'Oct 14 (estimated)',                    conf: 'low', note: 'Not explicit in brief — inferred from campaign name.' },
        ]}
      />
      <MessageList
        title="Before we generate"
        items={[
          { kind: 'warn', title: 'Copy length risks overflowing 9:16',  body: '"New in · Autumn \'26" at 48pt will cut on narrow aspect. Shorten to "New in" for stories.', action: 'Auto-shorten for 9:16' },
          { kind: 'info', title: 'Brand kit not linked yet',             body: 'Without it I\'ll use inferred palette. Link the kit to lock exact tokens.', action: 'Link brand kit' },
          { kind: 'ok',   title: 'Reference image clean and high-res',   body: '2400 × 3000, no visible compression, subject centered.' },
        ]}
      />
    </Bubble>

    <Bubble who="user">
      <TextBubble who="user">Looks right. Shorten the copy for 9:16, keep Clay & ivory, and generate.</TextBubble>
      <CommandEcho cmd="/generate" cn="开始生图"/>
    </Bubble>

    <Bubble who="ai" meta="Loom · 2.1s">
      <ThinkingTrace done steps={[
        'Locked parameters from parse table + user edits',
        'Shortened copy variant for 9:16 output',
        'Sampled 4 layout variants within Japandi reference space',
        'Synthesized at 1280×1600, delivered to canvas',
      ]}/>
      <TextBubble who="ai">
        Here are 4 directions in the canvas. <b>Option B (Minimal)</b> has the cleanest copy hierarchy — that's my pick. Want me to iterate on any of them?
      </TextBubble>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {['/upscale', '/variations', '/resize 9:16', '/export-png', 'Compare A vs B'].map(t => (
          <button key={t} style={{
            fontSize: 11, padding: '4px 9px', borderRadius: 99,
            color: t.startsWith('/') ? 'var(--accent-ink)' : 'var(--ink-2)',
            border: '1px solid',
            borderColor: t.startsWith('/') ? 'transparent' : 'var(--line)',
            background: t.startsWith('/') ? 'var(--accent-soft)' : 'var(--panel)',
            fontFamily: t.startsWith('/') ? 'JetBrains Mono, monospace' : 'inherit',
          }}>{t}</button>
        ))}
      </div>
    </Bubble>
  </div>
);

// ---------- Composer ----------

const Composer = () => {
  const [text, setText] = React.useState('/');
  const [files, setFiles] = React.useState([
    { name: 'moodboard.pdf', size: '1.8 MB', type: 'PDF' },
  ]);
  const taRef = React.useRef(null);

  // Detect the current /slash token at the start of the input (simple model: line starts with /)
  const slashQuery = React.useMemo(() => {
    const m = text.match(/^\/\S*/);
    return m ? m[0] : null;
  }, [text]);

  const pickCommand = (c) => {
    setText(c.cmd + ' ');
    setTimeout(() => taRef.current?.focus(), 0);
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
                <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 9.5 }}>{f.size}</span>
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
          placeholder="Ask Loom, or type / for commands…"
          rows={2}
          style={{
            border: 'none', outline: 'none', resize: 'none',
            background: 'transparent',
            fontSize: 13, lineHeight: 1.45, color: 'var(--ink)',
            fontFamily: 'inherit',
          }}
        />

        {!slashQuery && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: -2 }}>
            {['/开始生图', '/分析素材', '/导出PNG'].map(s => (
              <button key={s} onClick={() => { const c = SLASH_COMMANDS.find(x => x.cn === s.slice(1) || x.cmd === s); if (c) pickCommand(c); }} style={{
                fontSize: 10, padding: '2px 7px', borderRadius: 99,
                color: 'var(--accent-ink)', background: 'var(--accent-soft)',
                fontFamily: 'JetBrains Mono, monospace',
              }}>{s}</button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button style={{ padding: 6, borderRadius: 6, color: 'var(--ink-2)' }} title="Attach file">
            <I.paperclip size={14}/>
          </button>
          <button style={{ padding: 6, borderRadius: 6, color: 'var(--ink-2)' }} title="Insert image">
            <I.image size={14}/>
          </button>
          <button style={{ padding: 6, borderRadius: 6, color: 'var(--ink-2)' }} title="Style">
            <I.palette size={14}/>
          </button>

          <div style={{ flex: 1 }}/>


          <button style={{
            width: 30, height: 30, borderRadius: 8,
            background: text || files.length ? 'var(--ink)' : 'var(--line)',
            color: text || files.length ? 'white' : 'var(--ink-3)',
            display: 'grid', placeItems: 'center',
          }}>
            <I.arrowUp size={14} stroke={2.2}/>
          </button>
        </div>
      </div>


    </div>
  );
};

// ---------- Main ----------

const Chat = ({ state }) => {
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
            background: state === 'generating' ? 'var(--accent)' : 'var(--ok)',
            animation: state === 'generating' ? 'pulse 1.2s ease-in-out infinite' : 'none',
          }}/>
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em' }}>Loom</span>
          <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>
            {state === 'generating' ? 'working…' : state === 'empty' ? 'ready' : 'suggested direction'}
          </span>
        </div>
        <div style={{ flex: 1 }}/>
        <button style={{ padding: 5, borderRadius: 5, color: 'var(--ink-3)' }} title="History"><I.layers size={13}/></button>
        <button style={{ padding: 5, borderRadius: 5, color: 'var(--ink-3)' }} title="More"><I.more size={13}/></button>
      </div>

      {state === 'empty' && <ChatEmpty/>}
      {state === 'generating' && <ChatGenerating/>}
      {state === 'returned' && <ChatReturned/>}

      <Composer/>
    </div>
  );
};

window.Chat = Chat;

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

const Avatar = ({ who, user }) => {
  const [imgFailed, setImgFailed] = React.useState(false);
  const username = user && user.username ? user.username : '';
  const avatarUrl = username ? (window.API_BASE || window.location.origin) + '/avatars/' + encodeURIComponent(username) + '.png' : '';

  if (who === 'ai') {
    return (
      <div style={{
        width: 24, height: 24, borderRadius: 7, flexShrink: 0,
        background: 'linear-gradient(135deg, var(--ink), oklch(0.3 0.08 275))',
        color: 'white', display: 'grid', placeItems: 'center',
      }}>
        <I.sparkles size={12} stroke={2}/>
      </div>
    );
  }
  return (
    <div style={{
      width: 24, height: 24, borderRadius: 7, flexShrink: 0,
      background: 'oklch(0.82 0.07 200)', color: 'oklch(0.3 0.05 200)',
      fontSize: 10, fontWeight: 600,
      display: 'grid', placeItems: 'center',
      overflow: 'hidden',
    }}>
      {avatarUrl && !imgFailed ? (
        <img
          src={avatarUrl}
          alt={username}
          onError={() => setImgFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        username ? username[0] : '我'
      )}
    </div>
  );
};

const Bubble = ({ who, children, meta, user }) => (
  <div style={{
    display: 'flex', gap: 10, alignItems: 'flex-start',
    flexDirection: who === 'user' ? 'row-reverse' : 'row',
  }}>
    <Avatar who={who} user={user}/>
    <div style={{ maxWidth: 'calc(100% - 38px)', display: 'flex', flexDirection: 'column', gap: 6, alignItems: who === 'user' ? 'flex-end' : 'flex-start' }}>
      {meta && <div className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{meta}</div>}
      {children}
    </div>
  </div>
);

// 简易 Markdown → HTML 渲染（支持粗体、斜体、行内代码、列表、标题、链接）
const renderMarkdown = (text) => {
  if (!text) return '';
  let html = text;
  // 行内代码（优先，避免被后续规则干扰）
  html = html.replace(/`([^`]+)`/g, '<code style="background:var(--panel-2);padding:1px 5px;border-radius:4px;font-size:11.5px;font-family:monospace;">$1</code>');
  // 粗体
  html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  // 斜体
  html = html.replace(/\*(.+?)\*/g, '<i>$1</i>');
  // 链接
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color:var(--accent);">$1</a>');
  // 标题
  html = html.replace(/^### (.+)$/gm, '<h3 style="font-size:13px;font-weight:600;margin:4px 0 2px;">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 style="font-size:14px;font-weight:600;margin:6px 0 2px;">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 style="font-size:15px;font-weight:600;margin:6px 0 2px;">$1</h1>');
  // 无序列表
  html = html.replace(/^- (.+)$/gm, '<li style="margin-left:16px;">$1</li>');
  // 有序列表
  html = html.replace(/^\d+\. (.+)$/gm, '<li style="margin-left:16px;">$1</li>');
  // 换行
  html = html.replace(/\n/g, '<br/>');
  return html;
};

const TextBubble = ({ who, children, markdown }) => {
  const content = markdown && who === 'ai' ? renderMarkdown(children) : children;
  return (
    <div style={{
      fontSize: 12.5, lineHeight: 1.55,
      padding: '9px 12px', borderRadius: 10,
      background: who === 'user' ? 'var(--ink)' : 'var(--panel)',
      color: who === 'user' ? 'white' : 'var(--ink)',
      border: who === 'user' ? 'none' : '1px solid var(--line-2)',
      maxWidth: '100%',
    }}>
      {who === 'ai' && markdown ? (
        <div dangerouslySetInnerHTML={{ __html: content }}/>
      ) : (
        content
      )}
    </div>
  );
};

const copyTextToClipboard = async (text) => {
  const value = String(text || '');
  if (!value) return false;
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return true;
  }
  const el = document.createElement('textarea');
  el.value = value;
  el.setAttribute('readonly', '');
  el.style.position = 'fixed';
  el.style.left = '-9999px';
  document.body.appendChild(el);
  el.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(el);
  return ok;
};

const CopyableTextBubble = ({ who, text, markdown }) => {
  const [hovered, setHovered] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const copyValue = String(text || '');
  const onCopy = React.useCallback(async function(e) {
    e.preventDefault();
    e.stopPropagation();
    try {
      const ok = await copyTextToClipboard(copyValue);
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1100);
      }
    } catch (err) {
      console.warn('copy message failed', err);
    }
  }, [copyValue]);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ maxWidth: '100%', display: 'flex', flexDirection: 'column', alignItems: who === 'user' ? 'flex-end' : 'flex-start', gap: 4 }}
    >
      <TextBubble who={who} markdown={markdown}>{copyValue}</TextBubble>
      {copyValue && (
        <button
          type="button"
          title={copied ? '已复制' : '复制消息'}
          aria-label={copied ? '已复制' : '复制消息'}
          onClick={onCopy}
          style={{
            height: 22,
            width: 22,
            padding: 0,
            borderRadius: 7,
            border: '1px solid var(--line-2)',
            background: who === 'user' ? 'var(--panel)' : 'transparent',
            color: copied ? 'var(--ok)' : 'var(--ink-2)',
            display: 'grid',
            placeItems: 'center',
            cursor: 'pointer',
            opacity: hovered || copied ? 1 : 0,
            transform: hovered || copied ? 'translateY(0)' : 'translateY(-2px)',
            pointerEvents: hovered || copied ? 'auto' : 'none',
            boxShadow: 'none',
            transition: 'opacity 120ms ease, transform 120ms ease, color 120ms ease',
            fontSize: 10.5,
            lineHeight: 1,
          }}
        >
          {copied ? <I.check size={11}/> : <I.copy size={11}/>}
        </button>
      )}
    </div>
  );
};

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

const InlineRefStrip = ({ items, compact }) => {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {items.map((src, idx) => (
        <img
          key={idx}
          src={src}
          alt={'参考图 ' + (idx + 1)}
          style={{
            width: compact ? 44 : 48,
            height: compact ? 44 : 48,
            borderRadius: 6,
            objectFit: 'cover',
            border: '1px solid var(--line-2)',
            background: 'white',
          }}
        />
      ))}
    </div>
  );
};

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

const actionBtnPrimaryStyle = {
  fontSize: 11.5,
  padding: '6px 12px',
  borderRadius: 6,
  background: 'var(--ink)',
  color: 'white',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  border: '1px solid var(--ink)',
};

const actionBtnSecondaryStyle = {
  fontSize: 11.5,
  padding: '6px 12px',
  borderRadius: 6,
  background: 'var(--panel)',
  color: 'var(--ink)',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  border: '1px solid var(--line)',
};

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

// ---------- BriefCard（Agent 模式 CONFIRM 阶段的创意方案卡片）----------

const BriefCard = ({ brief, completeness }) => {
  if (!brief) return null;
  const rows = [];
  if (brief.concept) rows.push(['核心方案', brief.concept]);
  if (Array.isArray(brief.visualElements) && brief.visualElements.length > 0) {
    rows.push(['视觉要素', brief.visualElements.join(' · ')]);
  }
  if (brief.copyText) rows.push(['画面文案', brief.copyText]);
  if (brief.aspectRatio) rows.push(['画幅比例', brief.aspectRatio]);
  if (brief.style) rows.push(['风格', brief.style]);
  if (brief.mood) rows.push(['氛围', brief.mood]);
  if (brief.colorDirection) rows.push(['色彩方向', brief.colorDirection]);

  const score = completeness && typeof completeness.score === 'number' ? completeness.score : null;
  const isConfirmed = brief.confirmedByUser;

  return (
    <div style={{
      borderRadius: 10, padding: 12, width: '100%',
      background: isConfirmed ? 'var(--accent-soft)' : 'var(--panel)',
      border: '1px solid ' + (isConfirmed ? 'var(--accent)' : 'var(--line-2)'),
      transition: 'background 200ms, border-color 200ms',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <I.sparkles size={12} style={{ color: 'var(--accent)' }}/>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink)' }}>
            创意方案 Brief
          </span>
          {isConfirmed && (
            <span style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 99,
              background: 'var(--accent)', color: '#fff', fontWeight: 500,
            }}>已确认</span>
          )}
        </div>
        {score !== null && (
          <span className="mono" style={{
            fontSize: 10, color: 'var(--ink-3)',
            padding: '2px 6px', borderRadius: 4, background: 'var(--panel-2)',
          }}>
            完整度 {score}/100
          </span>
        )}
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'auto 1fr',
        gap: '6px 12px', fontSize: 11.5,
      }}>
        {rows.map(([k, v]) => (
          <React.Fragment key={k}>
            <span className="mono" style={{
              color: 'var(--ink-3)', fontSize: 10,
              textTransform: 'uppercase', letterSpacing: '0.05em',
              alignSelf: 'flex-start', paddingTop: 2, whiteSpace: 'nowrap',
            }}>{k}</span>
            <span style={{ color: 'var(--ink)', lineHeight: 1.5 }}>{v}</span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

// ---------- ThinkingBlock（Agent 思考过程折叠展示）----------

const ThinkingBlock = ({ text }) => {
  var _s = React.useState(false);
  var open = _s[0]; var setOpen = _s[1];
  if (!text || !text.trim()) return null;
  return (
    <div style={{ borderRadius: 8, border: '1px solid var(--line-2)', background: 'var(--panel-2)', overflow: 'hidden', marginBottom: 6 }}>
      <div
        onClick={function() { setOpen(!open); }}
        style={{
          padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 6,
          cursor: 'pointer', userSelect: 'none',
          borderBottom: open ? '1px solid var(--line-2)' : 'none',
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 200ms' }}>
          <path d="m9 18 6-6-6-6"/>
        </svg>
        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>思考过程</span>
      </div>
      {open && (
        <div style={{
          padding: '10px 12px', fontSize: 11.5, lineHeight: 1.6,
          color: 'var(--ink-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          maxHeight: 200, overflowY: 'auto',
        }}>
          {text}
        </div>
      )}
    </div>
  );
};

const getThinkingPreview = (message) => {
  return String(message || '').trim() || '正在连接 Agent...';
};

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

const GREETINGS = [
  { title: '今天想设计点什么？', sub: '上传产品图、参考图、品牌素材，或者直接输入描述。' },
  { title: '想要生成一张海报吗？', sub: '使用 Gpt-image 2 模型，直接描述你想要的画面。' },
  { title: '需要编辑图像？', sub: '使用 Nano Banana Pro，上传图片后描述修改需求。' },
  { title: '来合成特殊品吧', sub: '选中左侧特殊品模板，输入货号和文案即可一键合成。' },
  { title: '忘了怎么用？', sub: '试试直接在对话框提问，我会帮你找到答案。' },
];

const pickGreeting = () => GREETINGS[Math.floor(Math.random() * GREETINGS.length)];

const ChatEmpty = ({ greetingKey }) => {
  const prompts = [
    { icon: <I.image size={13}/>,    text: '上传产品图，描述想要的风格' },
    { icon: <I.palette size={13}/>,  text: '生成4张哑光色调的变体图' },
    { icon: <I.copy size={13}/>,     text: '复制当前模板的文案' },
    { icon: <I.dims size={13}/>,     text: '调整尺寸为9:16适配Instagram' },
  ];
  const greeting = React.useMemo(() => pickGreeting(), [greetingKey]);
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
        <div className="serif" style={{ fontSize: 19, letterSpacing: '-0.01em' }}>{greeting.title}</div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'center', maxWidth: 240, lineHeight: 1.5 }}>
          {greeting.sub}
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

const AgentWelcome = () => {
  // Agent 模式专属欢迎页（不随机轮播）—— 简约版
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 11,
          background: 'linear-gradient(135deg, var(--ink), oklch(0.3 0.08 275))',
          color: 'white', display: 'grid', placeItems: 'center',
        }}>
          <I.sparkles size={18} stroke={1.8}/>
        </div>
        <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>
          你想做一张什么样的图？
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'center', maxWidth: 240, lineHeight: 1.5 }}>
          描述你的需求，Agent 会先和你确认方向，再开始生成。
        </div>
      </div>
    </div>
  );
};

const ChatGenerating = () => (
  <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
    <Bubble who="user" user={user}>
      <TextBubble who="user">Make 4 studio shots of this vase for a homepage hero, warm and editorial. Add "New in" copy.</TextBubble>
      <FileCard name="vase-ref-01.jpg" size="2.4 MB" type="JPG"/>
    </Bubble>

    <Bubble who="ai" meta="Loom · generating" user={user}>
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

const ChatSessionBar = ({ messages, historyControl }) => {
  const userMsgs = messages.filter(m => m.who === 'user').length;
  const turnCount = messages.length > 0 ? userMsgs + ' 条消息' : '暂无消息';

  return (
    <div style={{
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '14px 16px 10px',
      background: 'var(--panel)',
      position: 'relative',
      zIndex: 1,
    }}>
      <span className="mono" style={{ color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: 10 }}>对话</span>
      <div style={{ flex: 1 }}/>
      <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 10 }}>{turnCount}</span>
      {historyControl}
    </div>
  );
};

const ChatReturned = ({ messages, template, onCompose, isGenerating, user, greetingKey, onQuickReply, agentEnabled, onRetryWithZenmux, onPublishInspiration, onUnpublishInspiration }) => {
  const bottomRef = React.useRef(null);
  const greeting = React.useMemo(() => pickGreeting(), [greetingKey]);

  React.useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {messages.length === 0 ? (
        // Agent 模式用专属欢迎页，否则随机轮播
        agentEnabled ? <AgentWelcome /> : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 11,
              background: 'linear-gradient(135deg, var(--ink), oklch(0.3 0.08 275))',
              color: 'white', display: 'grid', placeItems: 'center',
            }}>
              <I.sparkles size={18} stroke={1.8}/>
            </div>
            <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)' }}>{greeting.title}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'center', maxWidth: 240, lineHeight: 1.5 }}>
              {greeting.sub}
            </div>
          </div>
        )
      ) : (
        messages.map((m, i) => (
          <Bubble key={i} who={m.who} meta={m.meta} user={user}>
            {m.type === 'ai-image-generating' ? (() => {
            const fmtSecs = s => { const mm = Math.floor(s/60), ss = s%60; return mm > 0 ? mm+'m '+String(ss).padStart(2,'0')+'s' : ss+'s'; };
            const promptPayload = m.promptPayload || null;
            const promptPositive = promptPayload && promptPayload.positive ? promptPayload.positive : m.prompt;
            const promptNegative = promptPayload && promptPayload.negative ? promptPayload.negative : '';
            const promptParams = promptPayload && promptPayload.parameters ? promptPayload.parameters : null;
            const fullImageUrl = m.imageUrl || '';
            const displayImageUrlRaw = m.previewUrl || m.imagePreviewUrl || m.imageUrl || '';
            const displayImageUrl = displayImageUrlRaw && displayImageUrlRaw.startsWith('/')
              ? ((window.API_BASE || window.location.origin) + displayImageUrlRaw)
              : displayImageUrlRaw;
            return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                m.status === 'done'
                  ? React.createElement('div', { style: { width: 8, height: 8, borderRadius: 99, background: 'var(--ok)', flexShrink: 0 } })
                  : m.status === 'failed'
                    ? React.createElement('div', { style: { width: 8, height: 8, borderRadius: 99, background: 'var(--warn)', flexShrink: 0 } })
                    : React.createElement('div', { style: { width: 14, height: 14, borderRadius: 99, border: '2px solid var(--line-2)', borderTopColor: 'var(--accent)', animation: 'spin 0.8s linear infinite', flexShrink: 0 } }),
                React.createElement('span', { style: { fontSize: 12, fontWeight: 500, color: 'var(--ink)' } },
                  m.status === 'done' ? '生图完成'
                  : m.status === 'failed' ? '生图失败'
                  : m.status === 'queued' ? '正在提交到「' + (m.model || 'AI') + '」…'
                  : (m.progress || 0) < 20 ? '「' + (m.model || 'AI') + '」正在处理…'
                  : (m.progress || 0) < 90 ? '「' + (m.model || 'AI') + '」生成中 ' + (m.progress || 0) + '%'
                  : '处理完成，正在下载…'
                ),
                m.finalElapsed != null
                  ? React.createElement('span', { className: 'mono', style: { fontSize: 10, color: 'var(--ink-3)' } }, fmtSecs(m.finalElapsed))
                  : m.startedAt && m.status !== 'done' && m.status !== 'failed'
                    ? React.createElement(ChatTimer, { startedAt: m.startedAt })
                    : null
              ),
              m.status !== 'failed' && m.status !== 'done' && React.createElement(InlineRefStrip, { items: m.refPreviews }),
              agentEnabled && promptPositive && React.createElement('div', {
                style: {
                  padding: '9px 10px',
                  borderRadius: 8,
                  background: 'var(--panel)',
                  border: '1px solid var(--line-2)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 5,
                }
              },
                React.createElement('div', {
                  className: 'mono',
                  style: { fontSize: 9.5, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }
                }, 'Prompt 标准'),
                React.createElement('div', { style: { fontSize: 11.2, color: 'var(--ink-2)', lineHeight: 1.45 } },
                  String(promptPositive).slice(0, 360),
                  String(promptPositive).length > 360 ? '...' : ''
                ),
                promptNegative ? React.createElement('div', { style: { fontSize: 10.5, color: 'var(--ink-3)', lineHeight: 1.4 } },
                  '避免：', String(promptNegative).slice(0, 220), String(promptNegative).length > 220 ? '...' : ''
                ) : null,
                promptParams ? React.createElement('div', { className: 'mono', style: { fontSize: 10, color: 'var(--ink-3)' } },
                  'size=', promptParams.size || 'auto', ' · resolution=', promptParams.resolution || '默认'
                ) : null
              ),
              m.status === 'done' && fullImageUrl && React.createElement('div', null,
                React.createElement('img', {
                  src: displayImageUrl || fullImageUrl,
                  alt: m.prompt,
                  style: { width: '100%', borderRadius: 10, display: 'block', border: '1px solid var(--line-2)', cursor: 'pointer' },
                  onClick: () => window.open(fullImageUrl, '_blank'),
                }),
                React.createElement('div', { style: { marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' } },
                  React.createElement('a', {
                    href: fullImageUrl, download: true,
                    style: { fontSize: 11, padding: '4px 10px', borderRadius: 5, background: 'var(--ink)', color: 'white', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 },
                  }, React.createElement(I.download, { size: 10 }), '下载'),
                  m.inspirationPostId
                    ? React.createElement('button', {
                        onClick: function() { onUnpublishInspiration(m); },
                        style: { fontSize: 11, padding: '4px 10px', borderRadius: 5, background: 'var(--panel)', color: 'var(--ok)', border: '1px solid var(--ok)', display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' },
                      }, React.createElement(I.check, { size: 10 }), '已发布 · 取消')
                    : React.createElement('button', {
                        onClick: function() { onPublishInspiration(m); },
                        style: { fontSize: 11, padding: '4px 10px', borderRadius: 5, background: 'var(--panel)', color: 'var(--ink-2)', border: '1px solid var(--line)', display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' },
                      }, React.createElement(I.sparkles, { size: 10 }), '发布到灵感')
                )
              ),
              // VLM 质检反馈
              m.status === 'done' && m.vlm && m.vlm.status === 'checked' && React.createElement('div', {
                style: { marginTop: 8, padding: '10px 12px', borderRadius: 8, background: 'var(--panel)', border: '1px solid var(--line-2)' }
              },
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 } },
                  React.createElement(I.eye, { size: 11, style: { color: 'var(--accent)' } }),
                  React.createElement('span', { style: { fontSize: 11, fontWeight: 500, color: 'var(--ink)' } }, 'VLM 质检')
                ),
                React.createElement('div', { style: { display: 'flex', gap: 12, fontSize: 11, color: 'var(--ink-2)', marginBottom: 6 } },
                  React.createElement('span', null, '质量 ', React.createElement('span', { style: { color: m.vlm.qualityScore >= 80 ? 'var(--ok)' : (m.vlm.qualityScore >= 50 ? 'var(--warn)' : '#dc2626'), fontWeight: 500 } }, m.vlm.qualityScore)),
                  React.createElement('span', null, '匹配度 ', React.createElement('span', { style: { color: m.vlm.intentMatch >= 80 ? 'var(--ok)' : (m.vlm.intentMatch >= 50 ? 'var(--warn)' : '#dc2626'), fontWeight: 500 } }, m.vlm.intentMatch))
                ),
                m.vlm.userFacingSummary && React.createElement('div', { style: { fontSize: 11, color: 'var(--ink-2)', lineHeight: 1.5 } }, m.vlm.userFacingSummary),
                m.vlm.problemElements && m.vlm.problemElements.length > 0 && React.createElement('div', { style: { fontSize: 10.5, color: '#dc2626', marginTop: 4, lineHeight: 1.5 } }, '问题: ' + m.vlm.problemElements.join('; ')),
                m.vlm.nextStepSuggestion && React.createElement('div', { style: { fontSize: 10.5, color: 'var(--ok)', marginTop: 4, lineHeight: 1.5 } }, '建议: ' + m.vlm.nextStepSuggestion)
              ),
              m.status === 'failed' && m.error && React.createElement('div', {
                style: { padding: '8px 10px', borderRadius: 6, background: 'var(--panel)', border: '1px solid var(--warn)', fontSize: 11, color: 'var(--warn)' }
              }, m.error),
              m.status === 'failed' && m.provider !== 'zenmux' && React.createElement('button', {
                onClick: function() { onRetryWithZenmux(m); },
                style: {
                  marginTop: 6, padding: '5px 12px', borderRadius: 6,
                  border: '1px solid var(--accent)', background: 'var(--panel)',
                  color: 'var(--accent)', fontSize: 11, cursor: 'pointer',
                }
              }, '切换到官方线路重试')
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
                    {m.zipUrl && (
                      <a href={m.zipUrl} target="_blank" rel="noreferrer" style={actionBtnPrimaryStyle}>
                        <I.download size={11}/>打包下载
                      </a>
                    )}
                    {m.penpotUrl && (
                      <a href={m.penpotUrl} target="_blank" rel="noreferrer" style={actionBtnSecondaryStyle}>
                        <I.edit size={11}/>在Penpot中编辑
                      </a>
                    )}
                  </div>
                )}
                {m.status === 'failed' && m.error && (
                  <div style={{ padding: '10px 12px', borderRadius: 6, background: 'var(--panel)', border: '1px solid var(--warn)', fontSize: 12, color: 'var(--warn)' }}>
                    {m.error}
                  </div>
                )}
              </div>
            ) : m.type === 'proxy-download-choice' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 12, color: 'var(--ink)' }}>{m.text || '这个链接支持多种格式，请选择一种下载。'}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(m.formats || []).map(function(fmt) {
                    return React.createElement('button', {
                      key: fmt,
                      onClick: function() { m.onChoose && m.onChoose(fmt); },
                      style: {
                        fontSize: 11,
                        padding: '5px 10px',
                        borderRadius: 6,
                        border: '1px solid var(--line)',
                        background: 'white',
                        color: 'var(--ink)',
                        cursor: 'pointer',
                      }
                    }, fmt);
                  })}
                </div>
              </div>
            ) : m.type === 'proxy-download-result' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 18, height: 18, borderRadius: 99, background: 'var(--ok)', flexShrink: 0 }}/>
                  <span style={{ fontSize: 13, color: 'var(--ok)', fontWeight: 600 }}>下载完成</span>
                </div>
                <div style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: 'var(--panel)',
                  border: '1px solid var(--line-2)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{m.filename || '下载文件'}</div>
                  <div className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>
                    {m.format ? (m.format + ' · ') : ''}{m.sizeText || ''}
                  </div>
                </div>
                {m.downloadUrl && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <a
                      href={m.downloadUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={actionBtnPrimaryStyle}
                    >
                      <I.download size={11}/>下载文件
                    </a>
                  </div>
                )}
              </div>
            ) : m.type === 'thinking' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{
                    width: 6, height: 6, borderRadius: 99,
                    background: 'var(--ink-3)',
                    animation: 'pulse 1.2s ease-in-out infinite',
                  }}/>
                  <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                    {m.meta === 'Agent' ? getThinkingPreview(m.thinkingStatus || m.text) : (m.text || '让我想想...')}
                  </span>
                </div>
                {m.thinking ? <ThinkingBlock text={m.thinking}/> : null}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {/* Agent 思考过程（可折叠） */}
                {m.thinking ? (
                  <ThinkingBlock text={m.thinking}/>
                ) : null}
                <CopyableTextBubble who={m.who} text={m.text} markdown/>
                {/* Agent CONFIRM 阶段的创意方案卡片 */}
                {m.brief ? (
                  <BriefCard brief={m.brief} completeness={m.completeness}/>
                ) : null}
                {/* 快捷选项按钮：ASK 的 choices 或 CONFIRM 的 quickActions */}
                {(Array.isArray(m.choices) && m.choices.length > 0) || (Array.isArray(m.quickActions) && m.quickActions.length > 0) ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {(m.choices || m.quickActions || []).map(function(opt, oi) {
                      return React.createElement('button', {
                        key: oi,
                        onClick: function() { onQuickReply(opt.value); },
                        disabled: isGenerating,
                        style: {
                          fontSize: 12, padding: '7px 14px', borderRadius: 18,
                          border: '1px solid var(--line-2)', background: 'var(--panel)',
                          color: 'var(--ink)', cursor: isGenerating ? 'default' : 'pointer',
                          opacity: isGenerating ? 0.5 : 1,
                        },
                      }, opt.label);
                    })}
                  </div>
                ) : null}
                {m.who === 'user' && Array.isArray(m.refPreviews) && m.refPreviews.length > 0 ? (
                  <div style={{
                    alignSelf: 'stretch',
                    padding: '8px 10px',
                    borderRadius: 10,
                    background: 'var(--panel)',
                    border: '1px solid var(--line-2)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 7,
                  }}>
                    <div className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      参考图 {m.refPreviews.length} 张
                    </div>
                    <InlineRefStrip items={m.refPreviews} compact/>
                  </div>
                ) : null}
                {m.who === 'user' && (!Array.isArray(m.refPreviews) || m.refPreviews.length === 0) && Array.isArray(m.refMeta) && m.refMeta.length > 0 ? (
                  <div style={{
                    alignSelf: 'stretch',
                    padding: '8px 10px',
                    borderRadius: 10,
                    background: 'var(--panel)',
                    border: '1px solid var(--line-2)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}>
                    <div className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      参考图 {m.refMeta.length} 张
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {m.refMeta.map(function(file, idx) {
                        return (
                          <div key={idx} style={{ fontSize: 11.5, color: 'var(--ink-2)', display: 'flex', gap: 8, alignItems: 'center' }}>
                            <I.image size={12}/>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name || ('参考图 ' + (idx + 1))}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </Bubble>
        ))
      )}
      <style>{`@keyframes pulse { 0%,100% { opacity:0.3; } 50% { opacity:1; } }`}</style>
      <div ref={bottomRef}/>
    </div>
  );
};

const normalizeReferenceUrl = function(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value, window.location.origin);
    const localHosts = ['localhost', '127.0.0.1', '[::1]', '::1'];
    const parsedHost = String(parsed.hostname || '').toLowerCase();
    if (localHosts.includes(parsedHost)) {
      parsed.protocol = window.location.protocol;
      parsed.host = window.location.host;
      return parsed.toString();
    }
    return parsed.toString();
  } catch (e) {
    return value;
  }
};

const MAX_REFERENCE_IMAGES = 9;
const CHAT_INSPIRATION_CATEGORIES = [
  { id: 'share_card', label: '分享卡片' },
  { id: 'moments', label: '朋友圈' },
  { id: 'poster', label: '海报' },
  { id: 'long_image', label: '长图文' },
  { id: 'detail_page', label: '详情页' },
  { id: 'main_image', label: '主图' },
  { id: 'scene_compose', label: '场景合成' },
  { id: 'ai_model', label: 'AI模特' },
  { id: 'ai_tryon', label: 'AI换装' },
  { id: 'ai_wearable', label: 'AI穿戴' },
  { id: 'ai_pose', label: 'AI裂变姿势' },
];

// ---------- Composer ----------

const Composer = ({ onSend, onParseTable, isLoading, slashTrigger, template, lastSubmittedMessage, agentEnabled, onToggleAgent, resetKey, onRequestSpecialTemplate, seedPrompt, onSeedConsumed, canvasReferenceSelection }) => {
  const [text, setText] = React.useState('');
  const [lockedCommand, setLockedCommand] = React.useState('');
  const [files, setFiles] = React.useState([]);
  const [imageType, setImageType] = React.useState('png');
  const [aiRatio, setAiRatio] = React.useState('auto');
  const [aiQuality, setAiQuality] = React.useState('1K');
  const [aiProvider, setAiProvider] = React.useState('apimart');
  const [manualRefImages, setManualRefImages] = React.useState([]);
  const [canvasRefImages, setCanvasRefImages] = React.useState([]);
  const [prototypePanel, setPrototypePanel] = React.useState('');
  const [selectedWorkflow, setSelectedWorkflow] = React.useState('chat');
  const taRef = React.useRef(null);
  const fileInputRef = React.useRef(null);
  const [composerHeight, setComposerHeight] = React.useState(null); // null = 默认自动高度
  const composerRef = React.useRef(null);
  const dragRef = React.useRef({ dragging: false, startY: 0, startH: 0 });
  const revokePreviewUrl = React.useCallback(function(url) {
    if (typeof url === 'string' && url.indexOf('blob:') === 0) {
      URL.revokeObjectURL(url);
    }
  }, []);
  const COLLAPSED_COMPOSER_HEIGHT = 176;
  const STATUS_COMPOSER_HEIGHT = 208;
  const MAX_COMPOSER_HEIGHT = 500;
  const minComposerHeightRef = React.useRef(COLLAPSED_COMPOSER_HEIGHT);
  const COMMANDS = React.useMemo(() => ['/花瓣下载', '/特殊品（完整）', '/特殊品', '/Nano Banana pro', '/Gpt image 2'], []);
  const cmdToWorkflow = React.useCallback(function(cmd) {
    const clean = String(cmd || '').trim();
    if (clean === '/Gpt image 2' || clean === '/Nano Banana pro') return 'ai-image';
    if (clean === '/特殊品' || clean === '/特殊品（完整）') return 'special';
    if (clean === '/花瓣下载') return 'download';
    return 'chat';
  }, []);

  const [taskDefsKey, setTaskDefsKey] = React.useState(0);

  // 检测花瓣登录状态，未登录则禁用 /花瓣下载 指令
  React.useEffect(() => {
    const apiBase = window.API_BASE || window.location.origin;
    fetch(apiBase + '/proxy-download/login-status', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        const cmd = SLASH_COMMANDS.find(c => c.cmd === '/花瓣下载');
        if (cmd) cmd.available = !!data.logged_in;
        setTaskDefsKey(function(k) { return k + 1; });
      })
      .catch(() => {});
  }, []);
  const displayValue = text;
  const lockedPrefixLength = 0;

  React.useEffect(() => {
    if (!resetKey) return;
    setText('');
    setLockedCommand('');
    setSelectedWorkflow('chat');
    setFiles([]);
    clearRefImages();
    setPrototypePanel('');
  }, [resetKey]);

  React.useEffect(() => {
    if (!canvasReferenceSelection || !Array.isArray(canvasReferenceSelection.images)) return;
    let alive = true;
    (async function() {
      try {
        if (!canvasReferenceSelection.images.length) {
          if (!alive) return;
          setCanvasRefImages(function(prev) {
            prev.forEach(function(entry) {
              if (entry && entry.previewUrl) revokePreviewUrl(entry.previewUrl);
            });
            return [];
          });
          return;
        }
        var immediateEntries = canvasReferenceSelection.images.slice(0, MAX_REFERENCE_IMAGES).map(function(item, idx) {
          const src = normalizeReferenceUrl(item && item.src ? item.src : '');
          if (!src) return null;
          return {
            file: null,
            name: String(item && item.name ? item.name : ('reference-' + (idx + 1) + '.png')),
            previewUrl: src,
            sourceUrl: src,
            pending: true,
            origin: 'canvas',
          };
        }).filter(Boolean);
        if (!alive) return;
        setCanvasRefImages(function(prev) {
          prev.forEach(function(entry) {
            if (entry && entry.previewUrl) revokePreviewUrl(entry.previewUrl);
          });
          return immediateEntries;
        });
        const loaded = await Promise.allSettled(
          immediateEntries.map(async function(item) {
            const response = await fetch(item.sourceUrl, { credentials: 'include' });
            if (!response.ok) throw new Error('load_reference_failed');
            const blob = await response.blob();
            const ext = blob.type && blob.type.indexOf('/') > -1 ? blob.type.split('/')[1] : 'png';
            const safeName = item.name && /\.[a-z0-9]+$/i.test(item.name) ? item.name : ((item.name || 'reference') + '.' + ext);
            const file = new File([blob], safeName, { type: blob.type || 'image/png' });
            return Object.assign({}, item, { file: file, pending: false });
          })
        );
        if (!alive) {
          return;
        }
        setCanvasRefImages(function(prev) {
          return prev.map(function(entry) {
            if (!entry || !entry.sourceUrl) return entry;
            const match = loaded.find(function(result) {
              return result && result.status === 'fulfilled' && result.value && result.value.sourceUrl === entry.sourceUrl;
            });
            if (match && match.status === 'fulfilled') return match.value;
            return Object.assign({}, entry, { pending: false });
          });
        });
      } catch (err) {
        console.error('Load canvas reference images failed:', err);
      }
    })();
    return function() {
      alive = false;
    };
  }, [canvasReferenceSelection, revokePreviewUrl]);

  const refImages = React.useMemo(function() {
    return canvasRefImages.concat(manualRefImages).slice(0, MAX_REFERENCE_IMAGES);
  }, [canvasRefImages, manualRefImages]);

  // —— Composer 拖拽调整高度 ——
  const handleDragStart = React.useCallback((e) => {
    e.preventDefault();
    const el = composerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = { dragging: true, startY: e.clientY, startH: rect.height, minH: minComposerHeightRef.current };
    document.body.style.cursor = 'ns-resize';
  }, []);

  React.useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current.dragging) return;
      const dy = dragRef.current.startY - e.clientY; // 向上拖 = 正
      const minH = dragRef.current.minH || COLLAPSED_COMPOSER_HEIGHT;
      const newH = Math.max(minH, Math.min(MAX_COMPOSER_HEIGHT, dragRef.current.startH + dy));
      setComposerHeight(newH);
    };
    const onUp = () => {
      if (!dragRef.current.dragging) return;
      dragRef.current.dragging = false;
      document.body.style.cursor = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  React.useEffect(() => {
    if (!prototypePanel) return;
    const onPointerDown = function(e) {
      if (!composerRef.current) return;
      if (!composerRef.current.contains(e.target)) {
        setPrototypePanel('');
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return function() {
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [prototypePanel]);

  // 外部触发 slash 命令（选中特殊品模板时）
  React.useEffect(() => {
    if (agentEnabled) return;
    if (!slashTrigger) return;
    if (slashTrigger.clear) {
      setLockedCommand(function(prev) {
        if (cmdToWorkflow(prev) === 'special') {
          setSelectedWorkflow('chat');
          return '';
        }
        return prev;
      });
      return;
    }
    const nextCmd = '/' + slashTrigger.cmd;
    setLockedCommand(nextCmd);
    setSelectedWorkflow(cmdToWorkflow(nextCmd));
    setPrototypePanel('');
    setText('');
    setTimeout(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(0, 0);
    }, 0);
  }, [agentEnabled, slashTrigger?.key, cmdToWorkflow]);

  // 外部触发：从灵感页"生成同款"传过来，自动锁定 /Gpt image 2 并填入 prompt
  React.useEffect(() => {
    if (!seedPrompt) return;
    setLockedCommand('/Gpt image 2');
    setSelectedWorkflow('ai-image');
    setPrototypePanel('');
    setText(String(seedPrompt));
    setTimeout(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(0, 0);
    }, 0);
    if (onSeedConsumed) onSeedConsumed();
  }, [seedPrompt, onSeedConsumed]);

  React.useEffect(() => {
    if (agentEnabled) {
      setLockedCommand('');
      setSelectedWorkflow('chat');
      }
  }, [agentEnabled]);

  React.useEffect(() => {
    if (template && (template.is_special || template.is_special_full)) return;
    setLockedCommand(function(prev) {
      if (cmdToWorkflow(prev) === 'special') {
        setSelectedWorkflow('chat');
        return '';
      }
      return prev;
    });
  }, [template?.file_id, template?.group_name, template?.id, template?.is_special, template?.is_special_full, cmdToWorkflow]);

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
  // 统一的尺寸选项，两个模型共用（取交集：二者均支持的比例）
  const AI_OPTIONS = {
    auto:  { label: 'auto', qualities: ['1K', '2K', '4K'], preview: 'auto', px: { '1K': 'auto', '2K': 'auto', '4K': 'auto' } },
    '1:1': { label: '1:1', qualities: ['1K', '2K', '4K'], preview: '1024×1024', px: { '1K': '1024×1024', '2K': '2048×2048', '4K': '2880×2880' } },
    '3:2': { label: '3:2', qualities: ['1K', '2K', '4K'], preview: '1536×1024', px: { '1K': '1536×1024', '2K': '2048×1360', '4K': '3520×2336' } },
    '2:3': { label: '2:3', qualities: ['1K', '2K', '4K'], preview: '1024×1536', px: { '1K': '1024×1536', '2K': '1360×2048', '4K': '2336×3520' } },
    '4:3': { label: '4:3', qualities: ['1K', '2K', '4K'], preview: '1024×768', px: { '1K': '1024×768', '2K': '2048×1536', '4K': '3312×2480' } },
    '3:4': { label: '3:4', qualities: ['1K', '2K', '4K'], preview: '768×1024', px: { '1K': '768×1024', '2K': '1536×2048', '4K': '2480×3312' } },
    '5:4': { label: '5:4', qualities: ['1K', '2K', '4K'], preview: '1280×1024', px: { '1K': '1280×1024', '2K': '2560×2048', '4K': '3216×2576' } },
    '16:9':{ label: '16:9', qualities: ['1K', '2K', '4K'], preview: '1536×864', px: { '1K': '1536×864', '2K': '2048×1152', '4K': '3840×2160' } },
    '9:16':{ label: '9:16', qualities: ['1K', '2K', '4K'], preview: '864×1536', px: { '1K': '864×1536', '2K': '1152×2048', '4K': '2160×3840' } },
  };

  // 从文本内容检测当前模式
  // trimmed = 用户实际打的内容（剥去 lockedCommand 锁定的前缀）
  const _t = (() => {
    const raw = String(text || '').trimStart();
    if (lockedCommand && raw.toLowerCase().startsWith(lockedCommand.toLowerCase())) {
      return raw.slice(lockedCommand.length).trimStart();
    }
    return raw;
  })();
  // activeAiModel: 只看 lockedCommand (UI 选的任务, 用户不再手动打前缀)
  const activeAiModel =
    lockedCommand === '/Gpt image 2' ? 'gpt-image-2' :
    lockedCommand === '/Nano Banana pro' ? 'nano-banana-pro' :
    '';
  const activeMode =
    (lockedCommand === '/Gpt image 2' || lockedCommand === '/Nano Banana pro') ? 'ai-image' :
    lockedCommand === '/特殊品（完整）' ? 'special_full' :
    lockedCommand === '/特殊品' ? 'special' :
    selectedWorkflow === 'compose' ? 'compose' : 'chat';
  const isSpecialTemplate = Boolean(template && (template.is_special || template.is_special_full));
  const isImageTypeLocked = activeMode === 'ai-image' || activeMode === 'special' || activeMode === 'special_full' || isSpecialTemplate;
  const aiOptionMap = AI_OPTIONS;
  const AI_RATIOS = Object.keys(aiOptionMap);
  const currentAiRatioMeta = aiOptionMap[aiRatio] || aiOptionMap[AI_RATIOS[0]];
  const allowedAiQualities = currentAiRatioMeta ? currentAiRatioMeta.qualities : AI_QUALITIES;
  const currentAiPx = currentAiRatioMeta && currentAiRatioMeta.px ? (currentAiRatioMeta.px[aiQuality] || currentAiRatioMeta.preview) : '';
  const aiImageSize = aiRatio;

  React.useEffect(() => {
    if (activeAiModel) {
      if (!AI_OPTIONS[aiRatio]) {
        setAiRatio('auto');
        return;
      }
      if (!AI_OPTIONS[aiRatio].qualities.includes(aiQuality)) {
        setAiQuality(AI_OPTIONS[aiRatio].qualities[0]);
      }
    }
  }, [activeAiModel, aiQuality, aiRatio]);

  const selectWorkflow = React.useCallback(function(next) {
    if (agentEnabled) return;
    const cmd = next && next.cmd ? next.cmd : '';
    if (cmd) {
      setLockedCommand(cmd);
      setSelectedWorkflow(cmdToWorkflow(cmd));
        setPrototypePanel('');
      setTimeout(() => {
        const el = taRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(0, 0);
      }, 0);
      return;
    }
    setLockedCommand('');
    setSelectedWorkflow(next && next.workflow ? next.workflow : 'chat');
    setPrototypePanel('');
    setTimeout(() => {
      const el = taRef.current;
      if (el) el.focus();
    }, 0);
  }, [agentEnabled, cmdToWorkflow]);

  const restoreMessage = React.useCallback((message) => {
    const raw = String(message || '');
    const matched = COMMANDS.find(function(cmd) {
      return raw === cmd || raw.startsWith(cmd + ' ');
    });
    if (matched) {
      setLockedCommand(matched);
      setSelectedWorkflow(cmdToWorkflow(matched));
      setText(raw.slice(matched.length).trimStart());
    } else {
      setLockedCommand('');
      setSelectedWorkflow('chat');
      setText(raw);
    }
    setTimeout(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }, 0);
  }, [COMMANDS, cmdToWorkflow]);

  const handleSend = () => {
    const body = text.trim();
    const message = lockedCommand ? (lockedCommand + (body ? ' ' + body : '')) : body;
    if (!message || isLoading) return;
    const imagesToSend = [...refImages];
    // 先发消息再清空输入，避免 isLoading=true 时消息丢失
    onSend(message, imagesToSend, {
      size: aiImageSize,
      resolution: aiQuality,
      provider: aiProvider,
      workflow: selectedWorkflow,
      lockedCommand: lockedCommand,
    });
    setText('');
    clearRefImages();
  };

  const handleKeyDown = (e) => {
    const el = taRef.current;
    const start = el ? el.selectionStart : 0;
    const end = el ? el.selectionEnd : 0;
    const currentMessage = lockedCommand ? (text.trim() || lockedCommand) : text.trim();
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
        setSelectedWorkflow('chat');
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
    if (agentEnabled) {
      setText(next);
      return;
    }
    if (lockedCommand) {
      if (next.startsWith(lockedCommand + ' ')) {
        setText(next.slice(lockedCommand.length).trimStart());
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
      setText(next);
      return;
    }
    if (!lockedCommand) {
      const matched = COMMANDS.find(function(cmd) {
        return next.startsWith(cmd + ' ');
      });
      if (matched) {
        setLockedCommand(matched);
        setSelectedWorkflow(cmdToWorkflow(matched));
        setText(next.slice(matched.length).trimStart());
        return;
      }
    }
    setText(next);
  };

  const clampSelection = () => {
    return;
  };

  const handleFileSelect = (e) => {
    const fileList = Array.from(e.target.files || []);
    if (!fileList.length) return;
    const images = fileList.filter(f => f.type.startsWith('image/'));
    const others = fileList.filter(f => !f.type.startsWith('image/'));
    if (images.length) addImageFiles(images);
    if (others.length && !agentEnabled) {
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
    const files = imageItems.map(it => it.getAsFile()).filter(Boolean);
    addImageFiles(files);
  };

  const removeRefImage = (idx) => {
    const target = refImages[idx];
    if (!target) return;
    if (target.origin === 'canvas') {
      setCanvasRefImages(function(prev) {
        const hitIndex = prev.findIndex(function(item) {
          return item && target && item.sourceUrl === target.sourceUrl && item.previewUrl === target.previewUrl;
        });
        if (hitIndex >= 0) revokePreviewUrl(prev[hitIndex]?.previewUrl);
        return prev.filter(function(_, i) { return i !== hitIndex; });
      });
      return;
    }
    setManualRefImages(function(prev) {
      const hitIndex = prev.findIndex(function(item) {
        return item && target && item.previewUrl === target.previewUrl;
      });
      if (hitIndex >= 0) revokePreviewUrl(prev[hitIndex]?.previewUrl);
      return prev.filter(function(_, i) { return i !== hitIndex; });
    });
  };

  const clearRefImages = () => {
    setCanvasRefImages(function(prev) {
      prev.forEach(function(r) { revokePreviewUrl(r.previewUrl); });
      return [];
    });
    setManualRefImages(function(prev) {
      prev.forEach(function(r) { revokePreviewUrl(r.previewUrl); });
      return [];
    });
  };

  // ---------- 拖拽上传图片 ----------
  const [isDraggingOver, setIsDraggingOver] = React.useState(false);
  const dragCounterRef = React.useRef(0);

  // 提取通用的添加图片函数，被拖拽/粘贴/文件选择共用
  const addImageFiles = React.useCallback((files) => {
    const images = Array.from(files || []).filter(f => f && f.type && f.type.startsWith('image/'));
    if (!images.length) return 0;
    setManualRefImages(prev => {
      const remaining = Math.max(0, MAX_REFERENCE_IMAGES - canvasRefImages.length - prev.length);
      if (remaining <= 0) return prev;
      const toAdd = images.slice(0, remaining).map(file => ({ file, name: file.name, previewUrl: URL.createObjectURL(file), sourceUrl: '', pending: false, origin: 'manual' }));
      return [...prev, ...toAdd];
    });
    return Math.min(images.length, Math.max(0, MAX_REFERENCE_IMAGES - canvasRefImages.length - manualRefImages.length));
  }, [canvasRefImages.length, manualRefImages.length]);

  const handleDragEnter = (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    setIsDraggingOver(true);
  };

  const handleDragOver = (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
    e.preventDefault();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDraggingOver(false);
  };

  const handleDrop = (e) => {
    if (!e.dataTransfer) return;
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDraggingOver(false);
    const files = e.dataTransfer.files;
    if (files && files.length) addImageFiles(files);
  };

  const clearComposer = React.useCallback(() => {
    setText('');
    setLockedCommand('');
    setSelectedWorkflow('chat');
    setFiles([]);
    clearRefImages();
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
  const getTaskDefinitions = React.useCallback(function() {
    var slashMap = {};
    try {
      var cmds = window.SLASH_COMMANDS || [];
      cmds.forEach(function(c) { slashMap[c.cmd] = c.available !== false; });
    } catch (e) {}
    function available(cmd) {
      if (!cmd) return true; // 无 cmd 的卡片始终可用
      return slashMap[cmd] !== false;
    }
    return [
      { id: 'chat', label: '默认', desc: '询问流程、模板、素材规则', iconKey: 'sparkles', workflow: 'chat' },
      { id: 'gpt-image', label: 'GPT Image 2', desc: '文生图，中文语义和文字更强', iconKey: 'image', iconSrc: 'src/icon/openai.png', cmd: '/Gpt image 2', available: available('/Gpt image 2') },
      { id: 'nano-banana', label: 'Nano Banana Pro', desc: '图生图/改图，参考图一致性更强', iconKey: 'image', iconSrc: 'src/icon/gemini-color.png', cmd: '/Nano Banana pro', available: available('/Nano Banana pro') },
      { id: 'compose', label: '智能铺品', desc: '上传表格并匹配本地图库', iconKey: 'grid', workflow: 'compose' },
      { id: 'special', label: '特殊品', desc: '使用特殊品模板合成结果', iconKey: 'layers', cmd: template && template.is_special_full ? '/特殊品（完整）' : '/特殊品', available: available(template && template.is_special_full ? '/特殊品（完整）' : '/特殊品') },
      { id: 'download', label: '花瓣下载', desc: '下载花瓣素材或指定格式', iconKey: 'download', cmd: '/花瓣下载', available: available('/花瓣下载') },
    ];
  }, [template && template.is_special_full, taskDefsKey]);
  const getTaskIcon = React.useCallback(function(iconKey) {
    return I[iconKey] || I.sparkles;
  }, []);
  const activeTaskLabel = activeMode === 'ai-image'
    ? (activeAiModel === 'nano-banana-pro' ? 'Nano Banana Pro' : 'GPT Image 2')
    : activeMode === 'special_full'
      ? '完整特殊品'
      : activeMode === 'special'
        ? '特殊品'
        : selectedWorkflow === 'compose'
          ? '智能铺品'
          : selectedWorkflow === 'download'
            ? '花瓣下载'
            : '默认';
  const activeTaskIconKey = activeMode === 'ai-image'
    ? 'image'
    : activeMode === 'special' || activeMode === 'special_full'
      ? 'layers'
      : selectedWorkflow === 'compose'
        ? 'grid'
        : selectedWorkflow === 'download'
          ? 'download'
          : 'sparkles';
  const activeTaskIcon = getTaskIcon(activeTaskIconKey);
  const activeTaskIconSrc = activeMode === 'ai-image'
    ? (activeAiModel === 'nano-banana-pro' ? 'src/icon/gemini-color.png' : 'src/icon/openai.png')
    : null;
  const providerLabel = aiProvider === 'zenmux' ? '官方' : '默认';
  const modeParamLabel = activeMode === 'ai-image'
    ? (aiRatio + ' · ' + aiQuality)
    : activeMode === 'special_full'
      ? '线路 完整'
      : activeMode === 'special'
        ? '线路 普通'
        : selectedWorkflow === 'compose'
          ? (imageType ? ('素材 ' + (IMAGE_TYPES.find(t => t.key === imageType)?.label || imageType)) : '')
          : '';
  const selectedSettingBits = [
    agentEnabled ? 'Agent' : activeTaskLabel,
    agentEnabled ? '沉浸创作' : (activeMode === 'ai-image' ? providerLabel : ''),
    agentEnabled ? '' : modeParamLabel,
    refImages.length > 0 ? ('参考图 ' + refImages.length + '/' + MAX_REFERENCE_IMAGES) : '',
    files.length > 0 ? ('文件 ' + files.length) : '',
  ].filter(Boolean);
  const composerPlaceholder = agentEnabled
    ? '描述你的创作目标，或回复 Agent 的问题（也可点选项快速回答）'
    : activeMode === 'ai-image'
      ? (activeAiModel === 'nano-banana-pro'
        ? '描述要怎么编辑参考图，例如：保留鞋型，换成雨天街拍背景'
        : '描述想生成的画面，例如：电商主图，白色跑鞋，清爽科技感')
      : activeMode === 'special_full'
        ? 'ABAW023-6，飓风2 极限之力 雷暴篮球专业比赛鞋，5月20日 10点发售'
        : activeMode === 'special'
          ? 'ABAW023-6，飓风2 极限之力 雷暴篮球专业比赛鞋，5月20日 10点发售'
          : selectedWorkflow === 'compose'
            ? '上传表格后补充合成要求，例如：优先使用白底图，文案保持简洁'
            : selectedWorkflow === 'download'
              ? '输入花瓣项目 ID 或下载要求'
              : '忘了怎么用？试试直接提问吧';
  const statusBarVisible = Boolean(
    text.trim() ||
    lockedCommand ||
    refImages.length > 0 ||
    files.length > 0 ||
    (!agentEnabled && prototypePanel)
  );
  const minComposerHeight = statusBarVisible ? STATUS_COMPOSER_HEIGHT : COLLAPSED_COMPOSER_HEIGHT;
  minComposerHeightRef.current = minComposerHeight;
  const prototypeToolButton = function(panel, title, icon, label, options) {
    const open = prototypePanel === panel;
    return React.createElement('button', Object.assign({
      type: 'button',
      onClick: function() { setPrototypePanel(open ? '' : panel); },
      title: title,
      style: Object.assign({
        height: 36,
        minWidth: label ? 74 : 36,
        padding: label ? '0 12px' : 0,
        borderRadius: 10,
        border: '1px solid ' + (open ? 'var(--ink-3)' : 'var(--line-2)'),
        background: open ? 'var(--panel-2)' : 'transparent',
        color: open ? 'var(--ink)' : 'var(--ink-2)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        cursor: 'pointer',
        boxShadow: 'none',
        transition: 'background 140ms, border-color 140ms, transform 140ms, box-shadow 140ms',
        flexShrink: 0,
      }, options || {})
    }), icon, label ? React.createElement('span', { style: { fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' } }, label) : null);
  };
  const protoChipStyle = function(active) {
    return {
      border: '1px solid ' + (active ? 'var(--ink)' : 'var(--line-2)'),
      background: active ? 'var(--ink)' : 'var(--panel)',
      color: active ? 'var(--panel)' : 'var(--ink-2)',
      borderRadius: 999,
      padding: '7px 10px',
      fontSize: 11.5,
      fontWeight: 600,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      cursor: 'default',
      minHeight: 30,
    };
  };
  const protoPanelShell = function(children, width) {
    const fluid = width === 'fluid';
    return React.createElement(React.Fragment, null,
      // 透明 backdrop：点击面板外任意位置自动关闭提交
      React.createElement('div', {
        key: 'backdrop',
        onClick: function() { setPrototypePanel(''); },
        style: {
          position: 'fixed', inset: 0, zIndex: 19,
        }
      }),
      React.createElement('div', {
        key: 'panel',
        style: {
          position: 'absolute',
          left: fluid ? 8 : 0,
          right: fluid ? 8 : 'auto',
          bottom: 58,
          width: fluid ? 'auto' : (width || 360),
          maxWidth: fluid ? 'none' : 'calc(100vw - 36px)',
          borderRadius: 14,
          border: '1px solid var(--line)',
          background: 'var(--panel)',
          boxShadow: '0 12px 28px rgba(25,24,20,0.08)',
          padding: 14,
          zIndex: 20,
          overflow: 'hidden',
        }
      }, children)
    );
  };
  const protoSectionLabel = function(text) {
    return React.createElement('div', {
      className: 'mono',
      style: {
        fontSize: 9.5,
        color: 'var(--ink-3)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        margin: '12px 0 7px',
      }
    }, text);
  };
  const renderPrototypePanel = function() {
    if (!prototypePanel) return null;
    if (prototypePanel === 'task') {
      const tasks = getTaskDefinitions();
      return protoPanelShell(React.createElement(React.Fragment, null,
        React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 } },
          React.createElement('div', { style: { fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--ink)' } }, '选择功能'),
          React.createElement('div', { className: 'mono', style: { fontSize: 10, color: 'var(--ink-3)' } }, 'live')
        ),
        React.createElement('div', { style: { marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 } },
          tasks.map(function(item) {
            const isAvailable = item.available !== false;
            const active = item.cmd
              ? lockedCommand === item.cmd
              : (!lockedCommand && selectedWorkflow === item.workflow);
            const IconComp = getTaskIcon(item.iconKey);
            return React.createElement('button', {
              key: item.label,
              type: 'button',
              disabled: !isAvailable,
              onClick: function() { if (isAvailable) selectWorkflow(item); },
              style: {
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 11,
                padding: '10px 11px',
                borderRadius: 13,
                background: active ? 'var(--panel-2)' : 'transparent',
                border: '1px solid ' + (active ? 'var(--line)' : 'transparent'),
                textAlign: 'left',
                cursor: isAvailable ? 'pointer' : 'not-allowed',
                opacity: isAvailable ? 1 : 0.4,
              }
            },
              item.iconSrc
                ? React.createElement('img', { src: item.iconSrc, alt: item.label, style: { width: 30, height: 30, borderRadius: 999, objectFit: 'cover', opacity: isAvailable ? 1 : 0.5 } })
                : React.createElement('div', {
                    style: {
                      width: 30,
                      height: 30,
                      borderRadius: 999,
                      background: active ? 'var(--ink)' : 'var(--panel-2)',
                      color: active ? 'var(--panel)' : 'var(--ink-3)',
                      display: 'grid',
                      placeItems: 'center',
                    }
                  }, React.createElement(IconComp, { size: 14 })),
              React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                React.createElement('div', { style: { fontSize: 13, fontWeight: 700, color: 'var(--ink)' } }, item.label),
                React.createElement('div', { style: { fontSize: 11, color: 'var(--ink-3)', marginTop: 2 } }, item.desc)
              )
            );
          })
        )
      ), 344);
    }
    if (prototypePanel === 'params') {
      const sizeItems = [
        ['auto', 'auto'],
        ['1:1', '1:1'],
        ['3:2', '3:2'],
        ['2:3', '2:3'],
        ['4:3', '4:3'],
        ['3:4', '3:4'],
        ['5:4', '5:4'],
        ['16:9', '16:9'],
        ['9:16', '9:16'],
      ];
      const isImageParams = activeMode === 'ai-image';
      const isSpecialParams = activeMode === 'special' || activeMode === 'special_full';
      const isComposeParams = activeMode === 'compose';
      const paramsTitle = isImageParams ? '生图参数' : isSpecialParams ? '特殊品参数' : isComposeParams ? '合成参数' : '问答参数';
      return protoPanelShell(React.createElement(React.Fragment, null,
        React.createElement('div', { style: { fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--ink)' } }, paramsTitle),
        isImageParams && React.createElement(React.Fragment, null,
          protoSectionLabel('尺寸'),
          React.createElement('div', {
            style: {
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 7,
              padding: 9,
              borderRadius: 15,
              background: 'var(--panel-2)',
            }
          },
            sizeItems.map(function(item) {
              const active = aiRatio === item[0];
              return React.createElement('button', {
                key: item[0],
                type: 'button',
                onClick: function() { setAiRatio(item[0]); },
                style: {
                  width: '100%',
                  minHeight: 58,
                  borderRadius: 12,
                  background: active ? 'white' : 'transparent',
                  border: '1px solid ' + (active ? 'var(--line)' : 'transparent'),
                  boxShadow: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                  cursor: 'pointer',
                }
              },
                React.createElement('div', {
                  style: {
                    width: item[0] === '16:9' ? 22 : item[0] === '9:16' ? 10 : 16,
                    height: item[0] === '9:16' ? 22 : item[0] === '16:9' ? 10 : 16,
                    border: '2px dashed ' + (active ? 'var(--ink)' : 'var(--ink-3)'),
                    borderRadius: 4,
                  }
                }),
                React.createElement('div', { style: { fontSize: 11.5, color: active ? 'var(--ink)' : 'var(--ink-3)', fontWeight: active ? 700 : 500 } }, item[1])
              );
            })
          ),
          protoSectionLabel('清晰度 / 渠道'),
          React.createElement('div', { style: { display: 'flex', gap: 7, flexWrap: 'wrap' } },
            ['1K', '2K', '4K'].map(function(q) {
              const disabled = !allowedAiQualities.includes(q);
              return React.createElement('button', {
                key: q,
                type: 'button',
                disabled: disabled,
                onClick: function() { if (!disabled) setAiQuality(q); },
                style: Object.assign({}, protoChipStyle(aiQuality === q), {
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled ? 0.45 : 1,
                })
              }, q);
            }),
            React.createElement('div', { style: { width: 1, height: 30, background: 'var(--line)', margin: '0 1px' } }),
            React.createElement('button', {
              type: 'button',
              onClick: function() { setAiProvider('apimart'); },
              style: Object.assign({}, protoChipStyle(aiProvider === 'apimart'), { cursor: 'pointer' })
            }, '默认'),
            React.createElement('button', {
              type: 'button',
              onClick: function() { setAiProvider('zenmux'); },
              style: Object.assign({}, protoChipStyle(aiProvider === 'zenmux'), { cursor: 'pointer' })
            }, '官方')
          )
        ),
        activeMode === 'chat' && React.createElement('div', {
          style: {
            marginTop: 12,
            padding: '12px',
            borderRadius: 12,
            background: 'var(--panel-2)',
            color: 'var(--ink-3)',
            fontSize: 12,
            lineHeight: 1.5,
          }
        }, '问答模式暂无额外参数，直接输入问题即可。'),
        isSpecialParams && React.createElement(React.Fragment, null,
          protoSectionLabel('模板线路'),
          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 } },
            [
              { cmd: '/特殊品', label: '普通' },
              { cmd: '/特殊品（完整）', label: '完整' },
            ].map(function(item) {
              const active = lockedCommand === item.cmd;
              return React.createElement('button', {
                key: item.cmd,
                type: 'button',
                onClick: function() {
                  setLockedCommand(item.cmd);
                  setSelectedWorkflow(cmdToWorkflow(item.cmd));
                  if (onRequestSpecialTemplate) {
                    onRequestSpecialTemplate(item.cmd === '/特殊品（完整）' ? 'full' : 'normal');
                  }
                  setPrototypePanel('');
                  setTimeout(function() {
                    const el = taRef.current;
                    if (el) el.focus();
                  }, 0);
                },
                style: Object.assign({}, protoChipStyle(active), {
                  cursor: 'pointer',
                  borderRadius: 10,
                  minHeight: 36,
                })
              }, item.label);
            })
          )
        ),
        !isImageParams && !isSpecialParams && activeMode !== 'chat' && React.createElement(React.Fragment, null,
          protoSectionLabel(isSpecialParams ? '特殊品输入' : '素材类型'),
          React.createElement('div', { style: { display: 'flex', gap: 7, flexWrap: 'wrap' } },
            IMAGE_TYPES.map(function(t) {
              return React.createElement('button', {
                key: t.key,
                type: 'button',
                onClick: function() { setImageType(t.key); },
                style: Object.assign({}, protoChipStyle(imageType === t.key), { cursor: 'pointer' })
              }, t.label);
            })
          ),
          protoSectionLabel('执行方式'),
          React.createElement('div', { style: { display: 'flex', gap: 7, flexWrap: 'wrap' } },
            React.createElement('div', { style: protoChipStyle(true) }, '当前模板'),
            React.createElement('div', { style: protoChipStyle(false) }, '自动匹配素材')
          )
        )
      ), 'fluid');
    }
    return null;
  };

  return (
    <div
      ref={composerRef}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        flexShrink: 0,
        borderTop: 'none',
        background: 'var(--panel)',
        position: 'relative',
        height: composerHeight || 'auto',
        minHeight: composerHeight ? minComposerHeight : undefined,
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* 拖拽上传遮罩 */}
      {isDraggingOver && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 50,
          background: 'rgba(79, 70, 229, 0.08)',
          border: '2px dashed var(--accent)',
          borderRadius: 12,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 8, pointerEvents: 'none',
        }}>
          <I.image size={28} style={{ color: 'var(--accent)' }}/>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>
            松手添加图片
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
            最多 {MAX_REFERENCE_IMAGES} 张参考图（当前 {refImages.length}/{MAX_REFERENCE_IMAGES}）
          </div>
        </div>
      )}
      {/* 拖拽手柄 */}
      <div
        onMouseDown={handleDragStart}
        title="上下拖拽调整输入框高度"
        style={{
          height: 8,
          flexShrink: 0,
          cursor: 'ns-resize',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'transparent',
          userSelect: 'none',
        }}
      >
        <div style={{
          width: 28, height: 3, borderRadius: 999,
          background: 'var(--line)',
          transition: 'background 150ms',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--ink-3)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'var(--line)'; }}
        />
      </div>
      <div style={{
        margin: statusBarVisible ? '4px 31px -1px' : '0 31px 0',
        minHeight: statusBarVisible ? 36 : 0,
        maxHeight: statusBarVisible ? 36 : 0,
        borderRadius: '14px 14px 0 0',
        border: '1px solid ' + (statusBarVisible ? 'var(--line)' : 'transparent'),
        borderBottomColor: statusBarVisible ? 'var(--line)' : 'transparent',
        background: 'var(--panel)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 12px',
        flexShrink: 0,
        position: 'relative',
        zIndex: 2,
        opacity: statusBarVisible ? 1 : 0,
        overflow: 'hidden',
        pointerEvents: statusBarVisible ? 'auto' : 'none',
        transform: statusBarVisible ? 'translateY(0)' : 'translateY(6px)',
        transition: 'opacity 160ms ease, max-height 160ms ease, min-height 160ms ease, margin 160ms ease, transform 160ms ease, border-color 160ms ease',
      }}>
        <div style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: agentEnabled ? 'var(--ink)' : 'var(--accent)',
          flexShrink: 0,
        }}/>
        <div style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap',
          minWidth: 0,
          flex: 1,
          overflow: 'hidden',
        }}>
          {selectedSettingBits.map(function(bit, idx) {
            return (
              <span key={idx} style={{
                fontSize: 12,
                fontWeight: idx === 0 ? 600 : 400,
                color: idx === 0 ? 'var(--ink)' : 'var(--ink-3)',
                whiteSpace: 'nowrap',
              }}>
                {bit}
              </span>
            );
          })}
        </div>
      </div>
      <div style={{
        flex: 1,
        margin: '0 12px 12px',
        borderRadius: 18,
        border: '1px solid var(--line)',
        background: 'var(--panel)',
        padding: statusBarVisible ? '18px 10px 10px' : '10px',
        display: 'flex', flexDirection: 'column', gap: 10,
        boxShadow: 'none',
        transition: 'box-shadow 150ms, border-color 150ms, transform 150ms',
        position: 'relative',
      }}>
        {renderPrototypePanel()}

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
          placeholder={composerPlaceholder}
          rows={2}
          style={{
            width: '100%',
            flex: composerHeight ? 1 : undefined,
            minHeight: composerHeight ? 56 : 92,
            maxHeight: composerHeight ? undefined : 180,
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
            padding: '2px 2px 0',
          }}
        />
        <style>{`
          .composer-textarea::placeholder {
            color: oklch(0.62 0.02 80);
            font-style: normal;
            font-size: 13px;
            opacity: 1;
          }
        `}</style>

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
            <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>{refImages.length}/{MAX_REFERENCE_IMAGES}</span>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative', marginBottom: 4, flexShrink: 0 }}>
          {!agentEnabled && prototypeToolButton('task', '功能/模型选择：' + activeTaskLabel,
            activeTaskIconSrc
              ? React.createElement('img', { src: activeTaskIconSrc, alt: '', style: { width: 16, height: 16, borderRadius: 3, objectFit: 'contain' } })
              : React.createElement(activeTaskIcon, { size: 14 }),
            null, {
            width: 34,
            minWidth: 34,
            height: 34,
            background: 'transparent',
            color: 'var(--ink-2)',
          })}
          {!agentEnabled && prototypeToolButton('params', '参数设置', React.createElement(I.settings, { size: 14 }), null, {
            width: 34,
            minWidth: 34,
            height: 34,
          })}
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              height: 34,
              width: 34,
              minWidth: 34,
              padding: 0,
              borderRadius: 10,
              border: '1px solid var(--line-2)',
              background: 'transparent',
              color: refImages.length > 0 ? 'var(--ink)' : 'var(--ink-2)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
              flexShrink: 0,
            }}
            title={refImages.length > 0 ? `已附加 ${refImages.length} 张参考图` : (agentEnabled ? '附加参考图给 Agent' : '附加图片或文件')}
          >
            <I.paperclip size={14}/>
          </button>
          <div style={{ flex: 1 }}/>
          <button
            onClick={handleSend}
            style={{
              width: 34, height: 34, borderRadius: 10,
              background: canSend ? 'var(--ink)' : 'var(--line)',
              color: canSend ? 'white' : 'var(--ink-3)',
              display: 'grid', placeItems: 'center',
              cursor: canSend ? 'pointer' : 'default',
              boxShadow: 'none',
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

const AGENT_MODE_KEY = 'designflow_agent_mode_enabled';
const AGENT_PROJECT_ID_KEY = 'designflow_agent_project_id';
const mapAgentProjectMessages = function(project, images) {
  const base = Array.isArray(project && project.messages) ? project.messages.map(function(item) {
    var payload = item && item.payload ? item.payload : {};
    var refMeta = Array.isArray(payload.reference_images) ? payload.reference_images : [];
    var decision = (payload && payload.decision) || {};
    var msg = {
      who: item && item.role === 'user' ? 'user' : 'ai',
      text: (item && item.text) || '',
      meta: item && item.role === 'assistant' ? 'Agent' : undefined,
      refMeta: refMeta,
    };
    // 恢复 CONFIRM 的 Brief 卡片 + 快捷按钮
    if (decision && decision.type === 'CONFIRM') {
      if (decision.brief) msg.brief = decision.brief;
      if (decision.completeness) msg.completeness = decision.completeness;
      if (Array.isArray(decision.quickActions) && decision.quickActions.length > 0) {
        msg.quickActions = decision.quickActions;
      }
      msg.decisionType = 'CONFIRM';
    } else if (decision && decision.type === 'ASK') {
      if (Array.isArray(decision.choices) && decision.choices.length > 0) {
        msg.choices = decision.choices;
      }
      msg.decisionType = 'ASK';
    }
    return msg;
  }) : [];
  const items = Array.isArray(images) ? images : [];
  if (!items.length) return base;
  return base.concat(items.map(function(image) {
    return {
      who: 'ai',
      type: 'ai-image-generating',
      model: (image && image.model) || 'agent',
      prompt: image && image.prompt ? (image.prompt.positive || '') : '',
      promptPayload: image && image.prompt ? image.prompt : null,
      status: 'done',
      imageUrl: image && image.image_url ? ((window.API_BASE || window.location.origin) + image.image_url) : '',
      finalElapsed: null,
      progress: 100,
      meta: 'Agent',
    };
  }));
};

const Chat = ({ state, template, onComposeComplete, slashTrigger, user, onRequestSpecialTemplate, seedPrompt, onSeedConsumed, canvasReferenceSelection }) => {
  const [messages, setMessages] = React.useState([]);
  const [defaultMessages, setDefaultMessages] = React.useState([]);
  const [agentMessages, setAgentMessages] = React.useState([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [lastSubmittedMessage, setLastSubmittedMessage] = React.useState('');
  const [currentAiChatId, setCurrentAiChatId] = React.useState('');
  const [composerResetKey, setComposerResetKey] = React.useState(0);
  const [greetingResetKey, setGreetingResetKey] = React.useState(0);
  const [agentEnabled, setAgentEnabled] = React.useState(false);
  const [agentProjectId, setAgentProjectId] = React.useState('');
  const [agentProject, setAgentProject] = React.useState(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const [historySessions, setHistorySessions] = React.useState([]);
  const [hoveredHistoryId, setHoveredHistoryId] = React.useState('');
  const [publishDialog, setPublishDialog] = React.useState(null);
  const historyWrapRef = React.useRef(null);
  const creatingAgentProjectRef = React.useRef(null);

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

  const loadAgentProject = React.useCallback(async function(projectId) {
    if (!projectId) return null;
    const data = await window.API.getAgentProject(projectId);
    const imgs = await window.API.listAgentProjectImages(projectId);
    const mapped = mapAgentProjectMessages(data, imgs);
    setAgentProject(data);
    setAgentProjectId(projectId);
    setAgentMessages(mapped);
    if (agentEnabled) setMessages(mapped);
    if (onComposeComplete && data) {
      onComposeComplete(null, null, data.currentImageUrl ? [data.currentImageUrl] : [], null);
    }
    return data;
  }, [agentEnabled, onComposeComplete]);

  const ensureAgentProject = React.useCallback(async function() {
    // 如果有保存的 ID，先尝试加载；加载失败则重新创建
    if (agentProjectId) {
      try {
        const data = await window.API.getAgentProject(agentProjectId);
        if (data && data.id) return agentProjectId;
      } catch (e) {
        // 项目已不存在（404），清除旧 ID，继续创建新项目
        setAgentProjectId('');
        try { localStorage.removeItem(AGENT_PROJECT_ID_KEY); } catch (ex) {}
      }
    }
    if (creatingAgentProjectRef.current) return creatingAgentProjectRef.current;
    creatingAgentProjectRef.current = window.API.createAgentProject()
      .then(function(created) {
        setAgentProject(created);
        setAgentProjectId(created.id);
        return created.id;
      })
      .finally(function() {
        creatingAgentProjectRef.current = null;
      });
    return creatingAgentProjectRef.current;
  }, [agentProjectId]);

  React.useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async function() {
      if (!agentEnabled) {
        setMessages(defaultMessages);
        return;
      }
      try {
        const projectId = await ensureAgentProject();
        if (cancelled) return;
        const data = await window.API.getAgentProject(projectId);
        const imgs = await window.API.listAgentProjectImages(projectId);
        if (cancelled) return;
        const mapped = mapAgentProjectMessages(data, imgs);
        setAgentProject(data);
        setAgentProjectId(projectId);
        setAgentMessages(mapped);
        setMessages(mapped);
      } catch (e) {
        if (!cancelled) {
          setAgentMessages([{ who: 'ai', text: 'Agent 初始化失败：' + ((e && e.message) || '未知错误'), meta: 'Agent' }]);
          setMessages([{ who: 'ai', text: 'Agent 初始化失败：' + ((e && e.message) || '未知错误'), meta: 'Agent' }]);
        }
      }
    })();
    return function() { cancelled = true; };
  }, [agentEnabled, ensureAgentProject, user]);

  React.useEffect(() => {
    if (agentEnabled) setAgentMessages(messages);
    else setDefaultMessages(messages);
  }, [agentEnabled, messages]);

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

  const loadAgentProjectHistory = React.useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await window.API.listAgentProjects(1, 20);
      setHistorySessions((res && res.data) || []);
    } catch (e) {
      console.error('load agent project history failed:', e);
      setHistorySessions([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const openHistory = React.useCallback(() => {
    setHistoryOpen(function(prev) {
      const next = !prev;
      if (!prev) {
        if (agentEnabled) loadAgentProjectHistory();
        else loadAiChatHistory();
      }
      return next;
    });
  }, [agentEnabled, loadAgentProjectHistory, loadAiChatHistory]);

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

  const restoreAgentProjectSession = React.useCallback(async (projectId) => {
    try {
      await loadAgentProject(projectId);
      setHistoryOpen(false);
    } catch (e) {
      console.error('restore agent project failed:', e);
      window.alert((e && e.message) ? e.message : '恢复 Agent 对话失败');
    }
  }, [loadAgentProject]);

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
        setComposerResetKey(function(prev) { return prev + 1; });
      }
    } catch (e) {
      console.error('delete ai chat history failed:', e);
      window.alert((e && e.message) ? e.message : '删除失败，请稍后重试');
    }
  }, [currentAiChatId]);

  const deleteAgentProjectHistory = React.useCallback(async (projectId) => {
    if (!projectId) return;
    if (!window.confirm('删除这条 Agent 对话？')) return;
    try {
      await window.API.deleteAgentProject(projectId);
      setHistorySessions(function(prev) {
        return prev.filter(function(project) { return project.id !== projectId; });
      });
      if (agentProjectId === projectId) {
        setAgentProjectId('');
        setAgentProject(null);
        setAgentMessages([]);
        setMessages([]);
        setComposerResetKey(function(prev) { return prev + 1; });
        if (onComposeComplete) onComposeComplete(null, null, [], null);
      }
    } catch (e) {
      console.error('delete agent project failed:', e);
      window.alert((e && e.message) ? e.message : '删除失败，请稍后重试');
    }
  }, [agentProjectId, onComposeComplete]);

  const startNewAiChat = React.useCallback(() => {
    if (isLoading) return;
    if (agentEnabled) {
      (async function() {
        setIsLoading(true);
        try {
          creatingAgentProjectRef.current = null;
          setAgentProject(null);
          setAgentProjectId('');
          try { localStorage.removeItem(AGENT_PROJECT_ID_KEY); } catch (ex) {}
          const created = await window.API.createAgentProject();
          setAgentProject(created);
          setAgentProjectId(created.id);
          setAgentMessages([]);
          setMessages([]);
          setHistoryOpen(false);
          setComposerResetKey(function(prev) { return prev + 1; });
          setGreetingResetKey(function(prev) { return prev + 1; });
          if (onComposeComplete) onComposeComplete(null, null, [], null);
        } catch (e) {
          setMessages([{ who: 'ai', text: '新建 Agent 对话失败：' + ((e && e.message) || '未知错误'), meta: 'Agent' }]);
        } finally {
          setIsLoading(false);
        }
      })();
      return;
    }
    setMessages([]);
    setDefaultMessages([]);
    setCurrentAiChatId('');
    setHistoryOpen(false);
    setComposerResetKey(function(prev) { return prev + 1; });
    setGreetingResetKey(function(prev) { return prev + 1; });
  }, [agentEnabled, isLoading, onComposeComplete]);

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

  const materializeReferenceImages = React.useCallback(async function(refImages) {
    var refs = Array.isArray(refImages) ? refImages : [];
    return Promise.all(refs.map(async function(item, idx) {
      if (item && item.file) return item;
      var src = normalizeReferenceUrl(item && item.sourceUrl ? item.sourceUrl : item && item.previewUrl ? item.previewUrl : '');
      if (!src) throw new Error('参考图缺少可读取地址');
      var response = await fetch(src, { credentials: 'include' });
      if (!response.ok) throw new Error('参考图读取失败: HTTP ' + response.status);
      var blob = await response.blob();
      var ext = blob.type && blob.type.indexOf('/') > -1 ? blob.type.split('/')[1] : 'png';
      var name = String(item && item.name ? item.name : ('reference-' + (idx + 1) + '.' + ext));
      if (!/\.[a-z0-9]+$/i.test(name)) name = name + '.' + ext;
      return Object.assign({}, item || {}, {
        file: new File([blob], name, { type: blob.type || 'image/png' }),
        name: name,
        pending: false,
      });
    }));
  }, [normalizeReferenceUrl]);

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

  // 从当前消息列表中找出上一个 AI 生图使用的模型、尺寸、分辨率
  const getLastAiImageOptions = React.useCallback(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m && m.type === 'ai-image-generating' && m.model) {
        return { model: m.model, size: m.size, resolution: m.resolution, provider: m.provider };
      }
    }
    return null;
  }, [messages]);

  // 将 File / Blob 转为 data URL（缩略图，最长边 200px）
  const fileToThumbDataUrl = (file) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxSize = 200;
      let w = img.width, h = img.height;
      if (w > h && w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize; }
      else if (h > maxSize) { w = Math.round(w * maxSize / h); h = maxSize; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
    img.src = url;
  });

  // —— 官方线路重试 ——
  const handleRetryWithZenmux = React.useCallback(async (failedMsg) => {
    const jobId = failedMsg.jobId;
    if (!jobId || !currentAiChatId) return;

    const startedAt = Date.now();
    setMessages(msgs => [...msgs, {
      who: 'ai', type: 'ai-image-generating',
      model: failedMsg.model || 'gpt-image-2',
      provider: 'zenmux',
      prompt: failedMsg.prompt || '',
      size: failedMsg.size || '1024x1024',
      resolution: failedMsg.resolution || '',
      status: 'running', startedAt,
      progress: 0,
      hasReference: true,
      refCount: 0,
      refPreviews: [],
      jobId: null,
    }]);

    try {
      const apiBase = window.API_BASE || window.location.origin;
      const retryRes = await window.API.retryAiImage(jobId, currentAiChatId);
      const newJobId = retryRes.job_id;

      setMessages(msgs => msgs.map(m =>
        m.type === 'ai-image-generating' && m.startedAt === startedAt
          ? { ...m, jobId: newJobId }
          : m
      ));

      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch(apiBase + '/ai-image/' + newJobId, { credentials: 'include' });
          if (!statusRes.ok) return;
          const sd = await statusRes.json();
          setMessages(msgs => msgs.map(m =>
            m.type === 'ai-image-generating' && m.startedAt === startedAt
              ? { ...m, status: sd.status, progress: sd.progress || m.progress }
              : m
          ));
          if (sd.status === 'done' && sd.image_url) {
            clearInterval(pollInterval);
            const fe = Math.floor((Date.now() - startedAt) / 1000);
            setMessages(msgs => msgs.map(m =>
              m.type === 'ai-image-generating' && m.startedAt === startedAt
                ? { ...m, status: 'done', imageUrl: sd.image_url, previewUrl: sd.preview_url || sd.image_url, finalElapsed: fe, progress: 100 }
                : m
            ));
            loadAiChatHistory();
          } else if (sd.status === 'failed') {
            clearInterval(pollInterval);
            const fe = Math.floor((Date.now() - startedAt) / 1000);
            setMessages(msgs => msgs.map(m =>
              m.type === 'ai-image-generating' && m.startedAt === startedAt
                ? { ...m, status: 'failed', error: sd.error || '重试失败', finalElapsed: fe }
                : m
            ));
            loadAiChatHistory();
          }
        } catch (e) { /* ignore polling errors */ }
      }, 2000);
    } catch (e) {
      const fe = Math.floor((Date.now() - startedAt) / 1000);
      setMessages(msgs => msgs.map(m =>
        m.type === 'ai-image-generating' && m.startedAt === startedAt
          ? { ...m, status: 'failed', error: e.message || '重试失败', finalElapsed: fe }
          : m
      ));
    }
  }, [currentAiChatId, loadAiChatHistory]);

  // —— 发布/取消发布灵感 ——
  const handlePublishInspiration = React.useCallback(async (msg) => {
    if (!msg) return;
    setPublishDialog({ msg: msg, category: 'share_card', tags: '', submitting: false });
  }, []);

  const confirmPublishInspiration = React.useCallback(async () => {
    const dialog = publishDialog;
    const msg = dialog && dialog.msg;
    if (!msg) return;
    // 优先用 jobId（生图时记录在消息上）；历史消息恢复后没有 jobId，回退到用 image_url
    const payload = msg.jobId
      ? { job_id: msg.jobId }
      : (msg.imageUrl ? { image_url: msg.imageUrl } : null);
    if (!payload) {
      window.alert('这条消息无法发布（缺少 job_id 和 image_url）');
      return;
    }
    payload.category = dialog.category || 'share_card';
    payload.tags = String(dialog.tags || '')
      .split(/[,，、\s]+/)
      .map(function(t) { return t.trim().replace(/^#/, ''); })
      .filter(Boolean);
    setPublishDialog(function(prev) { return prev ? Object.assign({}, prev, { submitting: true }) : prev; });
    // 乐观更新
    setMessages(function(msgs) {
      return msgs.map(function(m) {
        return m.startedAt === msg.startedAt ? Object.assign({}, m, { inspirationPublishing: true }) : m;
      });
    });
    try {
      const res = await window.API.publishInspiration(payload);
      const post = res && res.post;
      setMessages(function(msgs) {
        return msgs.map(function(m) {
          return m.startedAt === msg.startedAt
            ? Object.assign({}, m, { inspirationPostId: post ? post.id : null, inspirationPublishing: false })
            : m;
        });
      });
      setPublishDialog(null);
    } catch (e) {
      setMessages(function(msgs) {
        return msgs.map(function(m) {
          return m.startedAt === msg.startedAt ? Object.assign({}, m, { inspirationPublishing: false }) : m;
        });
      });
      setPublishDialog(function(prev) { return prev ? Object.assign({}, prev, { submitting: false }) : prev; });
      window.alert('发布失败：' + (e.message || '未知错误'));
    }
  }, [publishDialog]);

  const handleUnpublishInspiration = React.useCallback(async (msg) => {
    if (!msg || !msg.inspirationPostId) return;
    if (!window.confirm('下架这条灵感？')) return;
    const postId = msg.inspirationPostId;
    setMessages(function(msgs) {
      return msgs.map(function(m) {
        return m.startedAt === msg.startedAt ? Object.assign({}, m, { inspirationPublishing: true }) : m;
      });
    });
    try {
      await window.API.unpublishInspiration(postId);
      setMessages(function(msgs) {
        return msgs.map(function(m) {
          return m.startedAt === msg.startedAt
            ? Object.assign({}, m, { inspirationPostId: null, inspirationPublishing: false })
            : m;
        });
      });
    } catch (e) {
      setMessages(function(msgs) {
        return msgs.map(function(m) {
          return m.startedAt === msg.startedAt ? Object.assign({}, m, { inspirationPublishing: false }) : m;
        });
      });
      window.alert('下架失败：' + (e.message || '未知错误'));
    }
  }, []);

  // —— AI 生图核心流程（共享）——
  const runAiImageGeneration = React.useCallback(async (model, prompt, displayText, refImages, aiOptions) => {
    setIsLoading(true);
    const startedAt = Date.now();
    var finalPrompt = prompt;
    var finalRefImages = Array.isArray(refImages) ? refImages.slice() : [];

    var refPreviews = [];
    var lastSize = aiOptions.size || '1024x1024';
    var lastResolution = aiOptions.resolution || '1K';
    var provider = aiOptions.provider || 'apimart';
    setMessages(msgs => [...msgs, {
      who: 'ai', type: 'ai-image-generating',
      model, provider, prompt, size: lastSize, resolution: lastResolution,
      status: 'running', startedAt,
      progress: 0,
      meta: 'Loom',
      hasReference: refImages.length > 0,
      refCount: refImages.length,
      refPreviews: [],
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

      // 将所有参考图（用户上传 + 产品图）转为缩略图 data URL
      try {
        refPreviews = await Promise.all(finalRefImages.map(r => fileToThumbDataUrl(r.file)));
      } catch (e) { refPreviews = []; }

      const apiBase = window.API_BASE || window.location.origin;
      const fd = new FormData();
      fd.append('model', model);
      fd.append('provider', provider);
      fd.append('prompt', finalPrompt);
      fd.append('size', aiOptions.size || '1024x1024');
      fd.append('resolution', aiOptions.resolution || '1K');
      if (currentAiChatId && !aiOptions.skipContext) fd.append('chat_session_id', currentAiChatId);
      fd.append('ref_previews', JSON.stringify(refPreviews));
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
      const jobId = data.job_id;
      setMessages(msgs => msgs.map(m =>
        m.type === 'ai-image-generating' && m.startedAt === startedAt
          ? { ...m, jobId }
          : m
      ));

      // 轮询任务状态
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch(apiBase + '/ai-image/' + jobId, { credentials: 'include' });
          if (!statusRes.ok) return;
          const statusData = await statusRes.json();
          setMessages(msgs => msgs.map(m =>
            m.type === 'ai-image-generating' && m.startedAt === startedAt
              ? { ...m, status: statusData.status, progress: statusData.progress || m.progress }
              : m
          ));
          if (statusData.status === 'done' && statusData.image_url) {
            clearInterval(pollInterval);
            const finalElapsed = Math.floor((Date.now() - startedAt) / 1000);
            setMessages(msgs => msgs.map(m =>
              m.type === 'ai-image-generating' && m.startedAt === startedAt
                ? { ...m, status: 'done', imageUrl: statusData.image_url, previewUrl: statusData.preview_url || statusData.image_url, finalElapsed, progress: 100, refPreviews: [] }
                : m
            ));
            if (onComposeComplete) {
              onComposeComplete(null, null, [statusData.image_url], null);
            }
            loadAiChatHistory();
            setIsLoading(false);
          } else if (statusData.status === 'failed') {
            clearInterval(pollInterval);
            const finalElapsed = Math.floor((Date.now() - startedAt) / 1000);
            setMessages(msgs => msgs.map(m =>
              m.type === 'ai-image-generating' && m.startedAt === startedAt
                ? { ...m, status: 'failed', error: statusData.error || '未知错误', finalElapsed, refPreviews: refPreviews.length ? refPreviews : m.refPreviews }
                : m
            ));
            loadAiChatHistory();
            setIsLoading(false);
          }
        } catch (e) {
          // 轮询网络异常，忽略，下次重试
        }
      }, 2000);
    } catch (e) {
      const finalElapsed = Math.floor((Date.now() - startedAt) / 1000);
      setMessages(msgs => msgs.map(m =>
        m.type === 'ai-image-generating' && m.startedAt === startedAt
          ? { ...m, status: 'failed', error: e.message, finalElapsed }
          : m
      ));
      loadAiChatHistory();
      setIsLoading(false);
    }
  }, [currentAiChatId, enhancePromptWithProductRefs, loadAiChatHistory, loadResolvedRefFiles, onComposeComplete, parseProductRefs]);

  const handleSend = React.useCallback(async (text, refImages = [], aiOptions = {}) => {
    if (!text.trim() || isLoading) return;
    setLastSubmittedMessage(text);
    refImages = await materializeReferenceImages(refImages);

    // 计算用户消息中的参考图预览
    var userRefPreviews = [];
    var userRefMeta = [];
    if (refImages.length > 0) {
      try {
      userRefPreviews = await Promise.all(refImages.map(function(item) {
          return fileToThumbDataUrl(item.file);
        }));
      } catch (e) {
        userRefPreviews = [];
      }
      userRefMeta = refImages.map(function(item) {
        return { name: item.name || (item.file && item.file.name) || '' };
      });
    }

    if (agentEnabled) {
      setIsLoading(true);
      var projectId = '';
      var assistantIdx = null;
      var imageIdx = null;
      var thinkingText = '';
      var thinkingStatus = '正在连接 Agent...';
      var thinkingPhaseLabels = {
        analyzing_reference: '正在分析参考图，提取主体、风格和构图线索...',
        understanding_intent: '正在理解需求，并整理可以确认的创意方向...',
        llm_waiting: '正在组织回复，先把需求拆成可执行的视觉要点...',
      };
      var applyThinkingEvent = function(payload) {
        var delta = payload && payload.delta ? String(payload.delta) : '';
        var message = payload && payload.message ? String(payload.message) : '';
        var phaseMessage = payload && payload.phase ? thinkingPhaseLabels[payload.phase] : '';
        if (delta) {
          thinkingText += delta;
          thinkingStatus = '正在输出思考过程...';
          return { thinking: thinkingText, thinkingStatus: thinkingStatus };
        }
        var nextStatus = message || phaseMessage || '正在处理...';
        if (nextStatus) {
          thinkingStatus = nextStatus;
        }
        return { thinking: thinkingText, thinkingStatus: thinkingStatus };
      };
      setMessages(function(msgs) {
        assistantIdx = msgs.length + 1;
        return msgs.concat([
          { who: 'user', text: text, refPreviews: userRefPreviews, refMeta: userRefMeta },
          { who: 'ai', type: 'thinking', text: '正在连接 Agent...', thinkingStatus: thinkingStatus, meta: 'Agent' },
        ]);
      });
      try {
        projectId = await ensureAgentProject();
        await window.API.streamAgentChat(projectId, text, {
          onEvent: function(eventName, payload) {
            if (eventName === 'agent_thinking') {
              var thinkingPatch = applyThinkingEvent(payload || {});
              setMessages(function(msgs) {
                return msgs.map(function(m, i) {
                  if (i !== assistantIdx) return m;
                  var patch = { thinkingStatus: thinkingPatch.thinkingStatus };
                  if (thinkingPatch.thinking) {
                    patch.thinking = thinkingPatch.thinking;
                  }
                  return Object.assign({}, m, patch);
                });
              });
              return;
            }
            if (eventName === 'agent_text') {
              setMessages(function(msgs) {
                return msgs.map(function(m, i) {
                  if (i !== assistantIdx) return m;
                  return { who: 'ai', text: (m.text || '') + (payload.delta || ''), meta: 'Agent', thinking: m.thinking, thinkingStatus: m.thinkingStatus };
                });
              });
              return;
            }
            if (eventName === 'decision') {
              if (payload && (payload.type === 'ASK' || payload.type === 'CONFIRM')) {
                var opts = payload.type === 'ASK' ? payload.choices : payload.quickActions;
                setMessages(function(msgs) {
                  return msgs.map(function(m, i) {
                    if (i !== assistantIdx) return m;
                    var patch = {};
                    if (Array.isArray(opts) && opts.length > 0) {
                      patch[payload.type === 'ASK' ? 'choices' : 'quickActions'] = opts;
                    }
                    // CONFIRM 阶段附带 Creative Brief 卡片数据
                    if (payload.type === 'CONFIRM' && payload.brief) {
                      patch.brief = payload.brief;
                    }
                    if (payload.completeness) {
                      patch.completeness = payload.completeness;
                    }
                    patch.decisionType = payload.type;
                    return Object.assign({}, m, patch);
                  });
                });
              }
              if (payload && (payload.type === 'GENERATE' || payload.type === 'REFINE')) {
                var promptModel = payload.prompt && payload.prompt.model ? payload.prompt.model : 'agent';
                var modelLabel = promptModel === 'nano banana pro' ? 'Nano Banana' : (promptModel === 'gpt image 2' ? 'GPT Image 2' : promptModel);
                var actionLabel = payload.type === 'REFINE' ? '修改' : '生成';
                setMessages(function(msgs) {
                  if (imageIdx == null) imageIdx = msgs.length;
                  return msgs.concat([{
                    who: 'ai',
                    type: 'ai-image-generating',
                    model: modelLabel,
                    prompt: payload.prompt && payload.prompt.positive ? payload.prompt.positive : text,
                    promptPayload: payload.prompt || null,
                    size: payload.prompt && payload.prompt.parameters ? payload.prompt.parameters.size : 'auto',
                    resolution: payload.prompt && payload.prompt.parameters ? payload.prompt.parameters.resolution : '1K',
                    status: 'running',
                    startedAt: Date.now(),
                    progress: 0,
                    meta: 'Agent · ' + actionLabel,
                    refPreviews: userRefPreviews,
                  }]);
                });
              }
              return;
            }
            if (eventName === 'generation_progress') {
              setMessages(function(msgs) {
                return msgs.map(function(m, i) {
                  if (i !== imageIdx) return m;
                  return { ...m, status: 'running', progress: payload.progress || m.progress || 0 };
                });
              });
              return;
            }
            if (eventName === 'error') {
              setMessages(function(msgs) {
                return msgs.map(function(m, i) {
                  if (i !== assistantIdx) return m;
                  return { who: 'ai', text: (payload && payload.message) || 'Agent 执行失败', meta: 'Agent' };
                });
              });
            }
          },
          onDone: async function(payload) {
            if (payload && payload.project) setAgentProject(payload.project);
            if (payload && payload.image) {
              var imageUrl = (window.API_BASE || window.location.origin) + payload.image.image_url;
              var vlm = payload.vlmAnalysis || null;
              setMessages(function(msgs) {
                return msgs.map(function(m, i) {
                  if (i !== imageIdx) return m;
                  return {
                    ...m,
                    status: 'done',
                    imageUrl: imageUrl,
                    progress: 100,
                    finalElapsed: m.startedAt ? Math.floor((Date.now() - m.startedAt) / 1000) : null,
                    vlm: vlm,
                  };
                });
              });
              if (onComposeComplete) {
                onComposeComplete(null, null, [payload.image.image_url], null);
              }
            }
            if (projectId) {
              const latest = await window.API.getAgentProject(projectId);
              const imgs = await window.API.listAgentProjectImages(projectId);
              const mapped = mapAgentProjectMessages(latest, imgs);
              // 保留流式过程中累积的 thinking/status 字段（服务端不存储）
              setMessages(function(msgs) {
                return mapped.map(function(mm, i) {
                  var cm = msgs[i];
                  if (cm && (cm.thinking || cm.thinkingStatus)) {
                    return Object.assign({}, mm, { thinking: cm.thinking, thinkingStatus: cm.thinkingStatus });
                  }
                  return mm;
                });
              });
              setAgentProject(latest);
              setAgentMessages(mapped);
            }
            setIsLoading(false);
          },
          onError: function(payload) {
            setMessages(function(msgs) {
              return msgs.map(function(m, i) {
                if (i !== assistantIdx) return m;
                return { who: 'ai', text: (payload && payload.message) || 'Agent 执行失败', meta: 'Agent' };
              });
            });
            setIsLoading(false);
          },
          onClose: function() {
            setIsLoading(false);
          },
        }, refImages);
      } catch (e) {
        setMessages(function(msgs) {
          return msgs.map(function(m, i) {
            if (i !== assistantIdx) return m;
            return { who: 'ai', text: 'Agent 执行失败：' + ((e && e.message) || '未知错误'), meta: 'Agent' };
          });
        });
        setIsLoading(false);
      }
      return;
    }

    // ── 设为头像 ──────────────────────────────────────────────────────────────
    const trimmed = text.trimStart();
    if ((trimmed === '设为头像' || trimmed === '設置頭像') && refImages.length > 0) {
      setMessages(msgs => [...msgs, { who: 'user', text, refPreviews: userRefPreviews, refMeta: userRefMeta }]);
      setIsLoading(true);
      try {
        const apiBase = window.API_BASE || window.location.origin;
        const fd = new FormData();
        fd.append('image', refImages[0].file);
        const res = await fetch(apiBase + '/auth/avatar', { method: 'POST', body: fd, credentials: 'include' });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || '设置头像失败');
        }
        const data = await res.json();
        setMessages(msgs => [...msgs, { who: 'ai', text: '头像设置成功！刷新页面后生效。' }]);
      } catch (e) {
        setMessages(msgs => [...msgs, { who: 'ai', text: '设置头像失败: ' + (e.message || '未知错误') }]);
      }
      setIsLoading(false);
      return;
    }

    // ── 花瓣下载 ─────────────────────────────────────────────────────────────
    // 新交互: 用户通过功能按钮选择“花瓣下载”，输入框只填写 URL/ID/格式。
    // 旧的 /花瓣下载 文本仍兼容，但不再要求用户输入斜杠指令。
    const isHuabanDownloadMode = aiOptions.workflow === 'download' || aiOptions.lockedCommand === '/花瓣下载' || trimmed.startsWith('/花瓣下载');
    if (isHuabanDownloadMode) {
      const args = trimmed.startsWith('/花瓣下载')
        ? trimmed.replace(/^\/花瓣下载\s*/, '').trim()
        : trimmed.trim();
      const match = args.match(/^(\S+)(?:\s+([A-Za-z0-9._-]+))?$/);
      setMessages(msgs => [...msgs, { who: 'user', text: args || text, refPreviews: userRefPreviews, refMeta: userRefMeta }]);
      if (!match) {
        setMessages(msgs => [...msgs, { who: 'ai', text: '请直接输入花瓣链接/项目 ID；如需指定格式，可写：链接 PSD', meta: '花瓣下载' }]);
        return;
      }
      const normalizeHuabanSource = function(value) {
        const raw = (value || '').trim();
        if (!raw) return raw;
        if (/^https?:\/\//i.test(raw)) return raw;
        if (/^\d+$/.test(raw)) return 'https://huaban.com/pins/' + raw;
        return 'https://huaban.com/pins/' + raw.replace(/^\/+|\/+$/g, '');
      };
      const sourceUrl = normalizeHuabanSource(match[1]);
      const selectedFormat = match[2] || '';
      const fmtBytes = function(bytes) {
        var n = Number(bytes || 0);
        if (!n) return '';
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(1).replace(/\\.0$/, '') + ' KB';
        return (n / (1024 * 1024)).toFixed(1).replace(/\\.0$/, '') + ' MB';
      };
      const runProxyDownload = async function(url, format, replaceIndex) {
        setIsLoading(true);
        const isFirstCall = replaceIndex == null;
        let pendingIdx = replaceIndex;
        if (isFirstCall) {
          setMessages(msgs => {
            pendingIdx = msgs.length;
            return [...msgs, { who: 'ai', type: 'thinking', text: '正在打开花瓣页面…', meta: '花瓣下载' }];
          });
        } else {
          setMessages(msgs => msgs.map((m, idx) => idx === pendingIdx ? { who: 'ai', type: 'thinking', text: '正在下载文件…', meta: '花瓣下载' } : m));
        }
        // 轮换提示文字，让用户感知进度
        const stages = isFirstCall
          ? [
              { after: 6000, text: '正在查找下载按钮…' },
              { after: 15000, text: '页面加载较慢，请耐心等待…' },
              { after: 30000, text: '还在等待花瓣页面响应，若账号失效会自动报错…' },
              { after: 60000, text: '下载代理仍在处理，稍后会给出成功或失败结果…' },
            ]
          : [
              { after: 8000, text: '文件较大，仍在下载中…' },
              { after: 20000, text: '网络较慢，请耐心等待…' },
              { after: 45000, text: '仍在等待文件流返回…' },
            ];
        let stageIdx = 0;
        let progressTimer = null;
        const scheduleNext = () => {
          if (stageIdx >= stages.length) return;
          const delay = stages[stageIdx].after - (Date.now() - startedAt);
          progressTimer = setTimeout(() => {
            const s = stages[stageIdx];
            if (s && typeof pendingIdx === 'number') {
              setMessages(msgs => msgs.map((m, idx) => idx === pendingIdx
                ? Object.assign({}, m, { text: s.text })
                : m));
            }
            stageIdx++;
            scheduleNext();
          }, Math.max(delay, 500));
        };
        const startedAt = Date.now();
        scheduleNext();
        try {
          const res = await window.API.proxyDownload(url, format || null);
          clearTimeout(progressTimer);
          if (res.status === 'choose_format') {
            setMessages(msgs => msgs.map((m, idx) => idx === pendingIdx ? {
              who: 'ai',
              type: 'proxy-download-choice',
              meta: '花瓣下载',
              text: res.message || '请选择下载格式',
              formats: res.formats || [],
              onChoose: function(fmt) { runProxyDownload(url, fmt, pendingIdx); },
            } : m));
          } else {
            setMessages(msgs => msgs.map((m, idx) => idx === pendingIdx ? {
              who: 'ai',
              type: 'proxy-download-result',
              meta: '花瓣下载',
              filename: res.filename,
              format: res.format,
              sizeText: fmtBytes(res.size),
              downloadUrl: (window.API_BASE || window.location.origin) + res.download_url,
            } : m));
          }
        } catch (e) {
          clearTimeout(progressTimer);
          setMessages(msgs => msgs.map((m, idx) => idx === pendingIdx ? {
            who: 'ai',
            text: '下载失败: ' + (e.message || '未知错误'),
            meta: '花瓣下载',
          } : m));
        }
        setIsLoading(false);
      };
      await runProxyDownload(sourceUrl, selectedFormat, null);
      return;
    }

    // ── AI 生图指令匹配 ────────────────────────────────────────────────────────
    // 用户心智: 只通过 UI 选模型 (lockedCommand), 不再手动打 / 指令.
    // aiCmd 直接从 lockedCommand 解析, 永远 implicit.
    const AI_IMAGE_CMDS = [
      { prefix: '/Nano Banana pro', model: 'nano-banana-pro' },
      { prefix: '/Gpt image 2',     model: 'gpt-image-2' },
    ];
    const FRESH_KEYWORDS = ['重新生成', '重新生图', '全新生成'];
    const aiCmd = AI_IMAGE_CMDS.find(c => text.trimStart().toLowerCase().startsWith(c.prefix.toLowerCase()))
      ? Object.assign({}, AI_IMAGE_CMDS.find(c => text.trimStart().toLowerCase().startsWith(c.prefix.toLowerCase())), { implicit: true })
      : null;

    // 检测"重新生成"关键词
    const rawPrompt = text.trim();
    const freshMatch = FRESH_KEYWORDS.find(kw => rawPrompt.startsWith(kw));
    if (freshMatch) {
      const rest = rawPrompt.slice(freshMatch.length).trim();
      const freshPrompt = rest || '重新生成';
      const lastOpts = getLastAiImageOptions();
      const model = aiCmd ? aiCmd.model : (lastOpts?.model || 'gpt-image-2');
      const opts = aiCmd ? aiOptions : { ...aiOptions, size: lastOpts?.size || aiOptions.size, resolution: lastOpts?.resolution || aiOptions.resolution, provider: aiOptions.provider };
      setMessages(msgs => [...msgs, { who: 'user', text: aiCmd && !aiCmd.implicit ? rawPrompt : text, refPreviews: userRefPreviews, refMeta: userRefMeta }]);
      await runAiImageGeneration(model, freshPrompt, freshPrompt, refImages, opts);
      return;
    }

    if (aiCmd) {
      const plainText = text.trim().slice(aiCmd.prefix.length).trimStart();
      if (!plainText) {
        const prefixLabel = aiCmd.implicit ? '（复用上次模型）' : aiCmd.prefix;
        setMessages(msgs => [...msgs,
          { who: 'user', text, refPreviews: userRefPreviews, refMeta: userRefMeta },
          { who: 'ai', text: `请在 ${prefixLabel} 后输入图片描述` },
        ]);
        return;
      }
      setMessages(msgs => [...msgs, { who: 'user', text: plainText, refPreviews: userRefPreviews, refMeta: userRefMeta }]);
      await runAiImageGeneration(aiCmd.model, plainText, plainText, refImages, aiOptions);
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

      const displayText = text.replace(_argRegex, '').trim() || text;
      setMessages(msgs => [...msgs, { who: 'user', text: displayText, refPreviews: userRefPreviews, refMeta: userRefMeta }]);
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
            const frameNames = (template.frames && template.frames.length > 0 ? template.frames : [template]).map(f => f.name || f.variant || '画板');
            const zipUrl = `${_pollBase}/${job['id']}/download-zip?names=${encodeURIComponent(frameNames.join(','))}`;
            setMessages(msgs => msgs.map((m, idx) => {
              if (idx !== specialMsgIdx) return m;
              return { ...m, status: 'done', specialUrls: urls, penpotUrl: s.penpot_edit_url, zipUrl };
            }));
            // 构建 resultTpl 供画布预览
            if (onComposeComplete && urls.length > 0 && template) {
              const base = structuredClone(template);
              const baseFrames = base.frames && base.frames.length > 0 ? base.frames : [base];
              base.frames = urls.map((url, i) => ({ ...(baseFrames[i % baseFrames.length] || baseFrames[0]), resultUrl: url }));
              base._frameNames = frameNames;
              window.lastComposeJobId = job['id'];
              window.lastComposeEndpoint = _pollBase;
              window.lastComposeFrameNames = frameNames;
              onComposeComplete(null, s.penpot_edit_url, urls, base);
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
    let thinkingIdx = null;
    setMessages(msgs => {
      thinkingIdx = msgs.length + 1; // +1 跳过用户消息，定位到 thinking 占位
      return [...msgs,
        { who: 'user', text, refPreviews: userRefPreviews, refMeta: userRefMeta },
        { who: 'ai', type: 'thinking', text: '...' },
      ];
    });
    try {
      const reply = await window.API.chatWithAI(
        [{ role: 'user', content: text }],
        {}
      );
      setMessages(msgs => msgs.map((m, i) =>
        i === thinkingIdx ? { who: 'ai', text: reply || '...', meta: 'Loom' } : m
      ));
    } catch (e) {
      setMessages(msgs => msgs.map((m, i) =>
        i === thinkingIdx ? { who: 'ai', text: '错误: ' + (e.message || '未知错误'), meta: '错误' } : m
      ));
    }
    setIsLoading(false);
  }, [agentEnabled, currentAiChatId, ensureAgentProject, enhancePromptWithProductRefs, getLastAiImageOptions, isLoading, loadAiChatHistory, loadResolvedRefFiles, materializeReferenceImages, onComposeComplete, parseProductRefs, runAiImageGeneration, template]);

  // ── 快捷回复：点击选项按钮触发 ──────────────────────────────────────────────
  const handleQuickReply = React.useCallback(function(value) {
    handleSend(value, [], {});
  }, [handleSend]);

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

  const toggleAgentMode = React.useCallback(function() {
    if (isLoading) return;
    setHistoryOpen(false);
    setAgentEnabled(function(prev) {
      if (prev) {
        setMessages(defaultMessages);
      }
      return !prev;
    });
  }, [defaultMessages, isLoading]);

  const historyControl = (
    <div ref={historyWrapRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={openHistory}
        title={agentEnabled ? 'Agent 对话历史' : '历史对话'}
        style={{
          height: 24,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '0 7px',
          borderRadius: 7,
          background: historyOpen ? 'var(--panel-2)' : 'transparent',
          border: '1px solid ' + (historyOpen ? 'var(--line)' : 'transparent'),
          color: historyOpen ? 'var(--ink)' : 'var(--ink-3)',
          cursor: 'pointer',
          fontSize: 10.5,
        }}
      >
        <I.file size={11}/>
        <span>历史</span>
      </button>

      {historyOpen && (
        <div style={{
          position: 'absolute',
          top: 30,
          right: 0,
          width: 196,
          maxHeight: 288,
          overflowY: 'auto',
          borderRadius: 12,
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          boxShadow: '0 10px 24px rgba(15, 23, 42, 0.08)',
          zIndex: 30,
          padding: 6,
        }}>
          <div className="mono" style={{
            padding: '6px 8px 7px',
            fontSize: 9.5,
            color: 'var(--ink-3)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}>{agentEnabled ? 'Agent chats' : 'AI chats'}</div>
          {historyLoading && (
            <div style={{ padding: '8px', fontSize: 11, color: 'var(--ink-3)' }}>加载中...</div>
          )}
          {!historyLoading && historySessions.length === 0 && (
            <div style={{ padding: '8px', fontSize: 11, color: 'var(--ink-3)' }}>暂无历史对话</div>
          )}
          {!historyLoading && historySessions.map(function(session) {
            var activeId = agentEnabled ? agentProjectId : currentAiChatId;
            var title = session.title || '未命名对话';
            var metaLine = agentEnabled
              ? ((session.totalGenerations || 0) > 0 ? ('已生成 ' + session.totalGenerations + ' 张') : '仅对话')
              : '';
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
                    if (agentEnabled) deleteAgentProjectHistory(session.id);
                    else deleteAiChatHistory(session.id);
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
                  onClick={() => {
                    if (agentEnabled) restoreAgentProjectSession(session.id);
                    else restoreAiChatSession(session.id);
                  }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    textAlign: 'left',
                    padding: '8px 9px',
                    borderRadius: 8,
                    background: activeId === session.id ? 'var(--panel-2)' : 'transparent',
                    border: '1px solid ' + (activeId === session.id ? 'var(--line-2)' : 'transparent'),
                    color: activeId === session.id ? 'var(--ink)' : 'var(--ink-2)',
                    fontSize: 11.5,
                    cursor: 'pointer',
                  }}
                  title={title}
                >
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
                  {metaLine && (
                    <div className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)', marginTop: 3 }}>
                      {metaLine}
                    </div>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

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
            title={isLoading ? '生成中暂不可新建对话' : (agentEnabled ? '开启新的 Agent 对话' : '开启新对话')}
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
            {agentEnabled ? 'Agent助手' : 'Ai助手'}
          </button>
          {agentEnabled && (
            <span style={{
              fontSize: 10.5,
              color: 'var(--accent-ink)',
              background: 'var(--accent-soft)',
              border: '1px solid transparent',
              borderRadius: 999,
              padding: '2px 6px',
              lineHeight: 1,
            }}>
              Agent
            </span>
          )}
          <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>
            {isLoading ? 'working…' : messages.length === 0 ? 'ready' : messages.length + ' messages'}
          </span>
        </div>
        <div style={{ flex: 1 }}/>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 2,
          padding: 2,
          borderRadius: 8,
          background: 'var(--panel-2)',
        }}>
          <button
            type="button"
            onClick={() => { if (agentEnabled) toggleAgentMode(); }}
            style={{
              height: 26,
              padding: '0 10px',
              borderRadius: 6,
              border: 'none',
              background: agentEnabled ? 'transparent' : 'var(--panel)',
              color: agentEnabled ? 'var(--ink-3)' : 'var(--ink)',
              fontSize: 12,
              fontWeight: agentEnabled ? 500 : 700,
              cursor: agentEnabled ? 'pointer' : 'default',
              boxShadow: agentEnabled ? 'none' : '0 0 0 1px var(--line)',
            }}
          >
            Chat
          </button>
          <button
            type="button"
            onClick={() => { if (!agentEnabled) toggleAgentMode(); }}
            style={{
              height: 26,
              padding: '0 10px',
              borderRadius: 6,
              border: 'none',
              background: agentEnabled ? 'var(--panel)' : 'transparent',
              color: agentEnabled ? 'var(--ink)' : 'var(--ink-3)',
              fontSize: 12,
              fontWeight: agentEnabled ? 700 : 500,
              cursor: agentEnabled ? 'default' : 'pointer',
              boxShadow: agentEnabled ? '0 0 0 1px var(--line)' : 'none',
            }}
          >
            Agent
          </button>
        </div>
      </div>

      <ChatSessionBar messages={messages} historyControl={historyControl}/>

      {publishDialog && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 90,
          background: 'rgba(15,23,42,0.24)',
          display: 'grid',
          placeItems: 'center',
        }}>
          <div style={{
            width: 360,
            maxWidth: 'calc(100vw - 32px)',
            borderRadius: 14,
            background: 'var(--panel)',
            border: '1px solid var(--line-2)',
            boxShadow: '0 18px 50px rgba(15,23,42,0.18)',
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--accent-ink)', display: 'grid', placeItems: 'center' }}>
                <I.sparkles size={14}/>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>发布到灵感</div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>选择分类，标签可选，方便后续检索。</div>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 7 }}>分类</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {CHAT_INSPIRATION_CATEGORIES.map(function(cat) {
                  const active = publishDialog.category === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      disabled={publishDialog.submitting}
                      onClick={function() { setPublishDialog(function(prev) { return prev ? Object.assign({}, prev, { category: cat.id }) : prev; }); }}
                      style={{
                        height: 28,
                        padding: '0 10px',
                        borderRadius: 999,
                        border: '1px solid ' + (active ? 'var(--ink)' : 'var(--line-2)'),
                        background: active ? 'var(--ink)' : 'var(--panel-2)',
                        color: active ? 'white' : 'var(--ink-2)',
                        fontSize: 11,
                        cursor: publishDialog.submitting ? 'default' : 'pointer',
                      }}
                    >{cat.label}</button>
                  );
                })}
              </div>
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>标签（可选）</span>
              <input
                value={publishDialog.tags}
                disabled={publishDialog.submitting}
                placeholder="例如：鞋类, 小红书, 夏季活动"
                onChange={function(e) { setPublishDialog(function(prev) { return prev ? Object.assign({}, prev, { tags: e.target.value }) : prev; }); }}
                style={{
                  height: 34,
                  borderRadius: 9,
                  border: '1px solid var(--line-2)',
                  background: 'var(--panel-2)',
                  color: 'var(--ink)',
                  outline: 'none',
                  padding: '0 10px',
                  fontSize: 12,
                }}
              />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 2 }}>
              <button
                type="button"
                disabled={publishDialog.submitting}
                onClick={function() { setPublishDialog(null); }}
                style={{ height: 32, padding: '0 13px', borderRadius: 8, border: '1px solid var(--line-2)', background: 'var(--panel)', color: 'var(--ink-2)', fontSize: 12, cursor: publishDialog.submitting ? 'default' : 'pointer' }}
              >取消</button>
              <button
                type="button"
                disabled={publishDialog.submitting}
                onClick={confirmPublishInspiration}
                style={{ height: 32, padding: '0 15px', borderRadius: 8, border: '1px solid var(--ink)', background: 'var(--ink)', color: 'white', fontSize: 12, fontWeight: 600, cursor: publishDialog.submitting ? 'default' : 'pointer', opacity: publishDialog.submitting ? 0.7 : 1 }}
              >{publishDialog.submitting ? '发布中…' : '确认发布'}</button>
            </div>
          </div>
        </div>
      )}

      {state === 'empty' && messages.length === 0 && <ChatEmpty greetingKey={greetingResetKey}/>}
      {state === 'empty' && messages.length > 0 && <ChatReturned messages={messages} template={template} onCompose={handleCompose} isGenerating={isLoading} user={user} greetingKey={greetingResetKey} onQuickReply={handleQuickReply} agentEnabled={agentEnabled} onRetryWithZenmux={handleRetryWithZenmux} onPublishInspiration={handlePublishInspiration} onUnpublishInspiration={handleUnpublishInspiration}/>}
      {state === 'generating' && <ChatGenerating/>}
      {state === 'returned' && <ChatReturned messages={messages} template={template} onCompose={handleCompose} isGenerating={isLoading} user={user} greetingKey={greetingResetKey} onQuickReply={handleQuickReply} agentEnabled={agentEnabled} onRetryWithZenmux={handleRetryWithZenmux} onPublishInspiration={handlePublishInspiration} onUnpublishInspiration={handleUnpublishInspiration}/>}

      <Composer
        onSend={handleSend}
        onParseTable={handleParseTable}
        isLoading={isLoading}
        slashTrigger={slashTrigger}
        template={template}
        lastSubmittedMessage={lastSubmittedMessage}
        agentEnabled={agentEnabled}
        onToggleAgent={toggleAgentMode}
        resetKey={composerResetKey}
        onRequestSpecialTemplate={onRequestSpecialTemplate}
        seedPrompt={seedPrompt}
        onSeedConsumed={onSeedConsumed}
        canvasReferenceSelection={canvasReferenceSelection}
      />
    </div>
  );
};

window.Chat = Chat;

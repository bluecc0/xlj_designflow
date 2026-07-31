// AI chat column. Three states: empty / generating / returned.
// Rich message types: text, option chips, file cards, action buttons, thinking trace, image results.

// ---------- Sub-components ----------

// 生图失败：用户可读原因
function formatAiImageError(raw, jobId, extras) {
  var msg = (raw == null ? '' : String(raw)).trim();
  if (!msg) {
    msg = '生成失败，没有返回具体原因，请稍后重试。';
  }
  // 去掉开发向尾巴
  msg = msg
    .replace(/请查后端日志[^\s。]*/g, '')
    .replace(/请打开控制台[^\s。]*/g, '')
    .replace(/并用 client 号对照后端日志[。]?/g, '')
    .replace(/请复制反馈信息发给管理员[。]?/g, '')
    .replace(/点下方「复制反馈信息」[^\s。]*/g, '')
    .replace(/若多次失败，请复制反馈信息发给管理员[。]?/g, '')
    .replace(/若反复出现，请复制反馈信息发给管理员[。]?/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[；;]\s*[。.]?\s*$/g, '。')
    .trim();
  return msg || '生成失败，请稍后重试。';
}

// 出错直接弹窗，只显示错误本身
function alertAiImageError(raw, extras) {
  extras = extras || {};
  var msg = formatAiImageError(raw, extras.jobId, extras);
  var lines = ['生图失败', msg];
  if (extras.phaseLabel) lines.push('环节：' + extras.phaseLabel);
  if (extras.clientRequestId) lines.push('编号：' + extras.clientRequestId);
  if (extras.jobId) lines.push('任务：' + extras.jobId);
  try {
    window.alert(lines.join('\n'));
  } catch (_e) {}
}

function describeAiImageFailPhase(phase) {
  var map = {
    prepare: '提交前准备（素材/参考图）',
    network: '网络连接',
    timeout: '等待超时',
    submit: '提交任务',
    http: '服务响应',
    parse: '服务响应异常',
    poll: '查询进度',
    generate: '图片生成',
    download: '下载结果',
    poll_or_job: '生成或查询进度',
  };
  var key = String(phase || '').trim();
  return map[key] || (key ? key : '');
}

// 更新消息补丁：目标带 batchImageIndex 时落到批量卡对应那张图上，否则落到消息本身
function patchMessageOrImage(msgs, target, patch) {
  return msgs.map(function(m) {
    if (m.startedAt !== target.startedAt) return m;
    if (target.batchImageIndex == null || !Array.isArray(m.images)) return Object.assign({}, m, patch);
    return Object.assign({}, m, {
      images: m.images.map(function(im, i) {
        return i === target.batchImageIndex ? Object.assign({}, im, patch) : im;
      }),
    });
  });
}

// 判断是否是「请求根本没到后端应用」类错误（浏览器网络层 / 连接被掐）
function isLikelyUnreachedServerError(err) {
  var name = (err && err.name) || '';
  var msg = String((err && err.message) || err || '');
  if (name === 'AbortError') return true;
  if (err && err.phase === 'network') return true;
  if (err && err.unreached) return true;
  return /Failed to fetch|NetworkError|Load failed|network connection was lost|Internet connection appears to be offline|Could not connect|ECONNREFUSED|ENOTFOUND|ERR_CONNECTION|ERR_NETWORK|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|The request timed out|NS_ERROR_FAILURE|Network request failed/i.test(msg);
}

function isTerminalAiImagePollStatus(status) {
  return [400, 401, 403, 404].includes(Number(status));
}

// 把 fetch/提交异常翻译成用户可读中文（技术细节进反馈包，不堆在主文案）
function classifyAiImageSubmitError(err, meta) {
  meta = meta || {};
  var attempt = meta.attempt || 1;
  var online = (typeof navigator !== 'undefined') ? navigator.onLine : true;
  var name = (err && err.name) || '';
  var raw = String((err && err.message) || err || '').trim() || '网络异常';
  var retryHint = attempt > 1 ? '（已自动重试）' : '';

  // 服务端已返回 HTTP（有 status）
  if (err && err.httpStatus) {
    var status = err.httpStatus;
    if (status === 401) {
      return '登录已失效，请重新登录后再试。';
    }
    if (status === 413) {
      return '参考图或请求内容过大，请压缩图片后再试。';
    }
    if (status === 502 || status === 503 || status === 504) {
      return '服务暂时繁忙或维护中' + retryHint + '，请稍后再试。';
    }
    // 业务错误原文通常已是中文，直接展示
    if (raw && !/^HTTP\s*\d+/i.test(raw) && raw.length > 2) {
      return raw;
    }
    return '提交失败（错误码 ' + status + '），请稍后重试。';
  }

  // JSON 解析失败
  if (/Unexpected token|JSON\.parse|is not valid JSON|Failed to execute 'json'/i.test(raw)) {
    return '服务返回异常，请稍后重试。';
  }

  // 客户端超时
  if (name === 'AbortError' || /aborted|超时|timed out/i.test(raw)) {
    return '提交超时' + retryHint + '。可能是网络较慢或参考图较大，请检查网络后重试。';
  }

  // 典型「请求未到达」
  if (isLikelyUnreachedServerError(err)) {
    if (!online) {
      return '当前网络似乎已断开，请连上网络后重试。';
    }
    return '网络不稳定，请求可能没有成功发出' + retryHint + '。请检查网络后重试。';
  }

  return (raw.indexOf('提交') === 0 || raw.indexOf('生成') === 0 || raw.indexOf('网络') === 0)
    ? raw
    : ('提交失败：' + raw);
}

function newClientRequestId() {
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

var AI_IMAGE_CLIENT_EVENT_KEY = 'designflow.aiImageClientEvents';
var AI_IMAGE_CLIENT_EVENT_MAX = 30;

function readAiImageClientEvents() {
  try {
    var raw = sessionStorage.getItem(AI_IMAGE_CLIENT_EVENT_KEY);
    var list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (_e) {
    return [];
  }
}

function pushAiImageClientEvent(event) {
  var entry = Object.assign({
    ts: new Date().toISOString(),
    online: typeof navigator !== 'undefined' ? navigator.onLine : null,
    href: typeof location !== 'undefined' ? location.href : '',
    apiBase: typeof window !== 'undefined' ? (window.API_BASE || window.location.origin) : '',
    ua: typeof navigator !== 'undefined' ? String(navigator.userAgent || '').slice(0, 160) : '',
  }, event || {});
  try {
    var list = readAiImageClientEvents();
    list.push(entry);
    while (list.length > AI_IMAGE_CLIENT_EVENT_MAX) list.shift();
    sessionStorage.setItem(AI_IMAGE_CLIENT_EVENT_KEY, JSON.stringify(list));
  } catch (_e) {}
  try {
    console.info('[ai-image-event]', entry);
  } catch (_e2) {}
  return entry;
}

// 主请求失败时尽力上报一条轻量事件（主 POST 没到时，这条小 JSON 可能仍能到）
function reportAiImageClientEvent(event) {
  var entry = pushAiImageClientEvent(event);
  var apiBase = (typeof window !== 'undefined' ? (window.API_BASE || window.location.origin) : '') || '';
  var url = String(apiBase).replace(/\/$/, '') + '/ai-image/client-event';
  var body = JSON.stringify(entry);
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      var blob = new Blob([body], { type: 'application/json' });
      var ok = navigator.sendBeacon(url, blob);
      if (ok) return entry;
    }
  } catch (_e) {}
  try {
    fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Request-Id': entry.clientRequestId || entry.client || '',
      },
      body: body,
      keepalive: true,
    }).catch(function() {});
  } catch (_e2) {}
  return entry;
}

// POST /ai-image：带 client 请求号、超时、网络失败自动重试 1 次
function postAiImageForm(apiBase, formData, options) {
  options = options || {};
  var maxAttempts = options.maxAttempts == null ? 2 : options.maxAttempts;
  var timeoutMs = options.timeoutMs || 120000;
  var clientRequestId = options.clientRequestId || newClientRequestId();
  var url = String(apiBase || '').replace(/\/$/, '') + '/ai-image';

  var attemptOnce = function(attempt) {
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = null;
    if (controller) {
      timer = setTimeout(function() {
        try { controller.abort(); } catch (_e) {}
      }, timeoutMs);
    }
    var headers = { 'X-Client-Request-Id': clientRequestId };
    if (attempt > 1) headers['X-Client-Retry'] = String(attempt - 1);

    return fetch(url, {
      method: 'POST',
      body: formData,
      credentials: 'include',
      signal: controller ? controller.signal : undefined,
      headers: headers,
    }).then(function(res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) {
        return res.json().catch(function() { return {}; }).then(function(errBody) {
          var detail = errBody && (errBody.detail || errBody.message || errBody.error);
          if (detail && typeof detail === 'object') {
            detail = detail.message || detail.error || JSON.stringify(detail);
          }
          var e = new Error(detail || ('HTTP ' + res.status));
          e.httpStatus = res.status;
          e.phase = 'http';
          e.clientRequestId = clientRequestId;
          e.body = errBody;
          throw e;
        });
      }
      return res.json().then(function(data) {
        if (data && typeof data === 'object') {
          data._clientRequestId = clientRequestId;
        }
        return data;
      }).catch(function(parseErr) {
        var e = new Error((parseErr && parseErr.message) || '响应 JSON 解析失败');
        e.phase = 'parse';
        e.clientRequestId = clientRequestId;
        e.httpStatus = res.status;
        throw e;
      });
    }).catch(function(err) {
      if (timer) clearTimeout(timer);
      // 已经是我们包装过的 HTTP/解析错误：补中文分类后抛出（不重试业务错误）
      if (err && (err.httpStatus || err.phase === 'parse' || err.phase === 'http')) {
        err.clientRequestId = err.clientRequestId || clientRequestId;
        err.attempt = attempt;
        // 502/503/504 可视为瞬时故障，重试 1 次
        if (attempt < maxAttempts && err.httpStatus && [502, 503, 504].indexOf(err.httpStatus) >= 0) {
          console.warn('[ai-image] submit gateway fail, retry', {
            clientRequestId: clientRequestId, attempt: attempt, status: err.httpStatus,
          });
          return new Promise(function(r) { setTimeout(r, 700 + Math.floor(Math.random() * 500)); })
            .then(function() { return attemptOnce(attempt + 1); });
        }
        err.message = classifyAiImageSubmitError(err, {
          apiBase: apiBase,
          clientRequestId: clientRequestId,
          attempt: attempt,
        });
        throw err;
      }
      var wrapped = err instanceof Error ? err : new Error(String(err || '网络错误'));
      if (wrapped.name === 'AbortError') {
        wrapped.phase = 'timeout';
        wrapped.unreached = true;
      } else if (!wrapped.phase) {
        wrapped.phase = 'network';
        wrapped.unreached = isLikelyUnreachedServerError(wrapped);
      }
      wrapped.clientRequestId = clientRequestId;
      wrapped.attempt = attempt;

      // 纯网络失败 / 超时：自动再试 1 次（FormData 可被多次序列化发送）
      if (attempt < maxAttempts && isLikelyUnreachedServerError(wrapped)) {
        console.warn('[ai-image] submit network fail, retry', {
          clientRequestId: clientRequestId,
          attempt: attempt,
          error: wrapped.message,
          apiBase: apiBase,
          online: typeof navigator !== 'undefined' ? navigator.onLine : null,
        });
        return new Promise(function(r) { setTimeout(r, 600 + Math.floor(Math.random() * 400)); })
          .then(function() { return attemptOnce(attempt + 1); });
      }

      wrapped.message = classifyAiImageSubmitError(wrapped, {
        apiBase: apiBase,
        clientRequestId: clientRequestId,
        attempt: attempt,
      });
      throw wrapped;
    });
  };

  return attemptOnce(1);
}

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
  const renderUserSkillText = function(value) {
    const raw = String(value || '');
    const match = raw.match(/^(\$[A-Za-z0-9_-]+)(\s+)([\s\S]*)$/);
    if (!match) return raw;
    return React.createElement(React.Fragment, null,
      React.createElement('span', { style: { color: 'oklch(0.72 0.16 255)', fontWeight: 750 } }, match[1]),
      match[2],
      React.createElement('span', null, match[3])
    );
  };
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
        who === 'user' ? renderUserSkillText(content) : content
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

// 带反馈的复制按钮组件
var CopyButton2 = function(props) {
  var _useState = React.useState(false);
  var copied = _useState[0];
  var setCopied = _useState[1];
  var _errorState = React.useState(false);
  var copyFailed = _errorState[0];
  var setCopyFailed = _errorState[1];
  var value = String(props.jsonStr || '');
  return React.createElement('button', {
    type: 'button',
    disabled: !value,
    onClick: async function(e) {
      e.preventDefault();
      e.stopPropagation();
      try {
        var ok = await copyTextToClipboard(value);
        if (!ok) throw new Error('copy_failed');
        setCopyFailed(false);
        setCopied(true);
        setTimeout(function() { setCopied(false); }, 2000);
      } catch(err) {
        console.warn('copy json failed', err);
        setCopied(false);
        setCopyFailed(true);
        setTimeout(function() { setCopyFailed(false); }, 2000);
      }
    },
    style: {
      fontSize: 11, padding: '5px 14px', borderRadius: 5,
      background: copyFailed ? 'var(--warn)' : (copied ? 'var(--ok)' : 'var(--ink)'),
      color: 'white', border: 'none',
      cursor: value ? 'pointer' : 'default', display: 'inline-flex', alignItems: 'center', gap: 4,
      opacity: value ? 1 : 0.45,
      transition: 'background 200ms',
    }
  }, React.createElement(copied ? I.check : I.copy, { size: 10 }), copyFailed ? '复制失败' : (copied ? ('已复制 ' + (props.label || '')) : ('复制 ' + (props.label || 'JSON'))));
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

const BriefCard = ({ brief, contract, completeness }) => {
  if (!brief && !contract) return null;
  const rows = [];
  if (contract) {
    const task = contract.task || {};
    const subject = contract.subject || {};
    const composition = contract.composition || {};
    const visualStyle = contract.visualStyle || {};
    const copy = contract.copy || {};
    const mainTitle = copy.mainTitle || {};
    const subtitle = copy.subtitle || {};
    const constraints = contract.constraints || {};
    const acceptance = Array.isArray(contract.acceptanceCriteria) ? contract.acceptanceCriteria : [];
    const channels = Array.isArray(task.channel) ? task.channel.filter(Boolean) : [];
    const palette = Array.isArray(visualStyle.colorPalette) ? visualStyle.colorPalette.filter(Boolean) : [];
    const mustInclude = Array.isArray(constraints.mustInclude) ? constraints.mustInclude.filter(Boolean) : [];
    const avoid = Array.isArray(constraints.avoid) ? constraints.avoid.filter(Boolean) : [];
    if (task.purpose) rows.push(['任务目的', task.purpose]);
    if (subject.description || subject.category) rows.push(['主体内容', subject.description || subject.category]);
    if (composition.aspectRatio) rows.push(['画幅比例', composition.aspectRatio]);
    if (composition.layout) rows.push(['构图方式', composition.layout]);
    if (visualStyle.overall) rows.push(['整体风格', visualStyle.overall]);
    if (visualStyle.backgroundStyle) rows.push(['背景风格', visualStyle.backgroundStyle]);
    if (visualStyle.lighting) rows.push(['光线方向', visualStyle.lighting]);
    if (composition.safeArea) rows.push(['安全线', composition.safeArea]);
    if (mainTitle.text) rows.push(['主标题', mainTitle.text]);
    if (mainTitle.fontStyle) rows.push(['标题字体', mainTitle.fontStyle]);
    if (subtitle.text) rows.push(['副标题', subtitle.text]);
    if (subtitle.fontStyle) rows.push(['副标字体', subtitle.fontStyle]);
    if (channels.length) rows.push(['投放渠道', channels.join(' / ')]);
    if (palette.length) rows.push(['色彩方向', palette.join(' · ')]);
    if (mustInclude.length) rows.push(['必须包含', mustInclude.join(' · ')]);
    if (avoid.length) rows.push(['避免项', avoid.join(' · ')]);
    if (acceptance.length) rows.push(['验收标准', acceptance.join(' · ')]);
  } else {
    if (brief.concept) rows.push(['核心方案', brief.concept]);
    if (Array.isArray(brief.visualElements) && brief.visualElements.length > 0) {
      rows.push(['视觉要素', brief.visualElements.join(' · ')]);
    }
    if (brief.copyText) rows.push(['画面文案', brief.copyText]);
    if (brief.subtitleText) rows.push(['副标题', brief.subtitleText]);
    if (brief.aspectRatio) rows.push(['画幅比例', brief.aspectRatio]);
    if (brief.style) rows.push(['风格', brief.style]);
    if (brief.mood) rows.push(['氛围', brief.mood]);
    if (brief.colorDirection) rows.push(['色彩方向', brief.colorDirection]);
  }

  const score = completeness && typeof completeness.score === 'number' ? completeness.score : null;
  const isConfirmed = brief && brief.confirmedByUser;

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

const PromptTraceBlock = ({ title, text }) => {
  var _s = React.useState(true);
  var open = _s[0]; var setOpen = _s[1];
  const userToggledRef = React.useRef(false);
  const bodyRef = React.useRef(null);
  React.useEffect(function() {
    if (open && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [text, open]);
  if (!text || !String(text).trim()) return null;
  let parsed = null;
  try { parsed = JSON.parse(String(text)); } catch (e) { parsed = null; }
  const steps = parsed && Array.isArray(parsed.steps) ? parsed.steps : [];
  const rules = parsed && Array.isArray(parsed.applied_rules) ? parsed.applied_rules : [];
  const finalPrompt = parsed && parsed.final_prompt ? String(parsed.final_prompt) : String(text);
  const negativePrompt = parsed && parsed.negative_prompt ? String(parsed.negative_prompt) : '';
  return (
    <div style={{ borderRadius: 8, border: '1px solid var(--line-2)', background: 'var(--panel-2)', overflow: 'hidden', marginBottom: 6 }}>
      <div
        onClick={function() { userToggledRef.current = true; setOpen(!open); }}
        style={{
          padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 6,
          cursor: 'pointer', userSelect: 'none',
          borderBottom: open ? '1px solid var(--line-2)' : 'none',
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 200ms' }}>
          <path d="m9 18 6-6-6-6"/>
        </svg>
        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{title || '生图 Prompt'}</span>
      </div>
      {open && (
        <div ref={bodyRef} style={{
          padding: '10px 12px', fontSize: 11.5, lineHeight: 1.6,
          color: 'var(--ink-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          maxHeight: 240, overflowY: 'auto',
        }}>
          {parsed ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {steps.length > 0 ? <div>
                <div className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)', marginBottom: 4 }}>解读步骤</div>
                {steps.map(function(step, idx) {
                  return <div key={idx} style={{ display: 'flex', gap: 7, padding: '2px 0' }}>
                    <span className="mono" style={{ color: 'var(--ink-3)', minWidth: 14 }}>{idx + 1}</span>
                    <span>{step}</span>
                  </div>;
                })}
              </div> : null}
              {rules.length > 0 ? <div>
                <div className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)', marginBottom: 4 }}>采用规则</div>
                {rules.map(function(rule, idx) {
                  return <div key={idx} style={{ padding: '2px 0' }}>- {rule}</div>;
                })}
              </div> : null}
              <div>
                <div className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)', marginBottom: 4 }}>最终传递给生图</div>
                <div>{finalPrompt}</div>
              </div>
              {negativePrompt ? <div>
                <div className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)', marginBottom: 4 }}>避免</div>
                <div>{negativePrompt}</div>
              </div> : null}
            </div>
          ) : String(text)}
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

const ChatReturned = ({ messages, template, onCompose, isGenerating, user, greetingKey, onQuickReply, agentEnabled, onPublishInspiration, onUnpublishInspiration }) => {
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
            const promptInstruction = promptPayload && promptPayload.instruction ? promptPayload.instruction : (promptPayload && promptPayload.positive ? promptPayload.positive : m.prompt);
            const promptNegative = promptPayload && promptPayload.negative ? promptPayload.negative : '';
            const promptParams = promptPayload && promptPayload.parameters ? promptPayload.parameters : null;
            const promptConstraints = promptPayload && promptPayload.constraints ? promptPayload.constraints : null;
            const promptReasoning = promptPayload && promptPayload.reasoningForUser ? promptPayload.reasoningForUser : '';
            const resolvedPromptText = m.resolvedPrompt || '';
            const promptTraceText = m.promptTrace || '';
            const showPromptTrace = promptTraceText || (resolvedPromptText && resolvedPromptText !== m.prompt);
            const fullImageUrl = m.imageUrl || '';
            const displayImageUrlRaw = m.previewUrl || m.imagePreviewUrl || m.imageUrl || '';
            const displayImageUrl = displayImageUrlRaw && displayImageUrlRaw.startsWith('/')
              ? ((window.API_BASE || window.location.origin) + displayImageUrlRaw)
              : displayImageUrlRaw;
            const batchImages = Array.isArray(m.images) && m.images.length > 0 ? m.images : null;
            const batchOkCount = batchImages ? batchImages.filter(function(im) { return im.status === 'done' && (im.url || im.previewUrl); }).length : 0;
            return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                m.status === 'done'
                  ? React.createElement('div', { style: { width: 8, height: 8, borderRadius: 99, background: 'var(--ok)', flexShrink: 0 } })
                  : m.status === 'failed'
                    ? React.createElement('div', { style: { width: 8, height: 8, borderRadius: 99, background: 'var(--warn)', flexShrink: 0 } })
                    : React.createElement('div', { style: { width: 14, height: 14, borderRadius: 99, border: '2px solid var(--line-2)', borderTopColor: 'var(--accent)', animation: 'spin 0.8s linear infinite', flexShrink: 0 } }),
                React.createElement('span', { style: { fontSize: 12, fontWeight: 500, color: 'var(--ink)' } },
                  m.status === 'done' ? (batchImages && batchOkCount < batchImages.length ? '生图完成（' + batchOkCount + '/' + batchImages.length + ' 成功）' : '生图完成')
                  : m.status === 'failed' ? '生图失败'
                  : m.status === 'skill-planning' ? '正在执行 Skill：$' + m.activeSkill + '…'
                  : m.status === 'skill-parsed' ? 'Skill 已解析，正在提交到 Image 2…'
                  : m.status === 'queued' ? '正在提交到「' + (m.model || 'AI') + '」…'
                  : m.activeSkill && !m.promptTrace && (m.progress || 0) < 20 ? '正在解读需求并整理生图 Prompt…'
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
              m.providerSwitched && React.createElement('div', {
                style: { padding: '6px 10px', borderRadius: 6, background: 'var(--panel)', border: '1px solid var(--warn)', fontSize: 11, color: 'var(--warn)', marginBottom: 6 }
              }, '已自动切换到「' + ({
                sub2api: '订阅',
                adobe2api: 'Adobe',
                apimart: 'APIMart',
              }[m.provider] || m.provider || '备用') + '」线路'),
              showPromptTrace && React.createElement(PromptTraceBlock, {
                title: m.activeSkill ? ('Skill 解析 · $' + m.activeSkill) : '生图 Prompt',
                text: promptTraceText || resolvedPromptText,
              }),
              agentEnabled && promptInstruction && React.createElement('div', {
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
                }, '执行标准'),
                React.createElement('div', { style: { fontSize: 11.2, color: 'var(--ink-2)', lineHeight: 1.45 } },
                  String(promptInstruction).slice(0, 360),
                  String(promptInstruction).length > 360 ? '...' : ''
                ),
                promptReasoning ? React.createElement('div', { style: { fontSize: 10.5, color: 'var(--ink-3)', lineHeight: 1.4 } },
                  '说明：', String(promptReasoning).slice(0, 180), String(promptReasoning).length > 180 ? '...' : ''
                ) : null,
                promptConstraints && Array.isArray(promptConstraints.mustInclude) && promptConstraints.mustInclude.length > 0 ? React.createElement('div', { style: { fontSize: 10.5, color: 'var(--ink-2)', lineHeight: 1.4 } },
                  '必须包含：', promptConstraints.mustInclude.join('； ')
                ) : null,
                promptConstraints && Array.isArray(promptConstraints.preserve) && promptConstraints.preserve.length > 0 ? React.createElement('div', { style: { fontSize: 10.5, color: 'var(--ink-2)', lineHeight: 1.4 } },
                  '保留：', promptConstraints.preserve.join('； ')
                ) : null,
                ((promptConstraints && Array.isArray(promptConstraints.avoid) && promptConstraints.avoid.length > 0) || promptNegative) ? React.createElement('div', { style: { fontSize: 10.5, color: 'var(--ink-3)', lineHeight: 1.4 } },
                  '避免：',
                  promptConstraints && Array.isArray(promptConstraints.avoid) && promptConstraints.avoid.length > 0
                    ? promptConstraints.avoid.join('； ')
                    : (String(promptNegative).slice(0, 220) + (String(promptNegative).length > 220 ? '...' : ''))
                ) : null,
                promptParams ? React.createElement('div', { className: 'mono', style: { fontSize: 10, color: 'var(--ink-3)' } },
                  'ratio=', promptParams.aspectRatio || promptParams.size || 'auto', ' · size=', promptParams.size || 'auto', ' · resolution=', promptParams.resolution || '默认'
                ) : null
              ),
              m.status === 'done' && fullImageUrl && !batchImages && React.createElement('div', null,
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
              // 批量卡：n 张图的网格，生成中/失败/完成分别渲染
              batchImages && React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 } },
                batchImages.map(function(im, bi) {
                  var imFull = im.url || '';
                  var imShownRaw = im.previewUrl || im.url || '';
                  var imShown = imShownRaw && imShownRaw.startsWith('/')
                    ? ((window.API_BASE || window.location.origin) + imShownRaw)
                    : imShownRaw;
                  if (im.status === 'done' && imFull) {
                    return React.createElement('div', { key: im.jobId || bi, style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                      React.createElement('img', {
                        src: imShown || imFull,
                        alt: (m.prompt || '') + ' #' + (bi + 1),
                        style: { width: '100%', borderRadius: 8, display: 'block', border: '1px solid var(--line-2)', cursor: 'pointer' },
                        onClick: function() { window.open(imFull, '_blank'); },
                      }),
                      React.createElement('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap' } },
                        React.createElement('a', {
                          href: imFull, download: true,
                          style: { fontSize: 10, padding: '3px 8px', borderRadius: 5, background: 'var(--ink)', color: 'white', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 },
                        }, React.createElement(I.download, { size: 9 }), '下载'),
                        im.inspirationPostId
                          ? React.createElement('button', {
                              onClick: function() { onUnpublishInspiration(Object.assign({}, m, { jobId: im.jobId, imageUrl: imFull, inspirationPostId: im.inspirationPostId, batchImageIndex: bi })); },
                              style: { fontSize: 10, padding: '3px 8px', borderRadius: 5, background: 'var(--panel)', color: 'var(--ok)', border: '1px solid var(--ok)', display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer' },
                            }, React.createElement(I.check, { size: 9 }), '已发布')
                          : React.createElement('button', {
                              onClick: function() { onPublishInspiration(Object.assign({}, m, { jobId: im.jobId, imageUrl: imFull, previewUrl: im.previewUrl || imFull, inspirationPostId: null, batchImageIndex: bi })); },
                              style: { fontSize: 10, padding: '3px 8px', borderRadius: 5, background: 'var(--panel)', color: 'var(--ink-2)', border: '1px solid var(--line)', display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer' },
                            }, React.createElement(I.sparkles, { size: 9 }), '发布')
                      )
                    );
                  }
                  if (im.status === 'failed') {
                    return React.createElement('div', { key: im.jobId || bi, style: { minHeight: 110, borderRadius: 8, border: '1px solid var(--warn)', background: 'var(--panel)', padding: '8px 9px', display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center' } },
                      React.createElement('div', { style: { fontSize: 10.5, color: 'var(--warn)', lineHeight: 1.4, wordBreak: 'break-word' } },
                        '第 ' + (bi + 1) + ' 张失败：' + formatAiImageError(im.error, im.jobId))
                    );
                  }
                  return React.createElement('div', { key: im.jobId || bi, style: { minHeight: 110, borderRadius: 8, border: '1px dashed var(--line-2)', background: 'var(--panel)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 } },
                    React.createElement('div', { style: { width: 14, height: 14, borderRadius: 99, border: '2px solid var(--line-2)', borderTopColor: 'var(--accent)', animation: 'spin 0.8s linear infinite' } }),
                    React.createElement('div', { className: 'mono', style: { fontSize: 10, color: 'var(--ink-3)' } }, (im.progress || 0) + '%')
                  );
                })
              ),
              m.status === 'done' && m.vlmPending && React.createElement('div', {
                style: { marginTop: 8, padding: '10px 12px', borderRadius: 8, background: 'var(--panel)', border: '1px solid var(--line-2)' }
              },
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                  React.createElement(I.eye, { size: 11, style: { color: 'var(--ink-3)' } }),
                  React.createElement('span', { style: { fontSize: 11, color: 'var(--ink-2)' } }, '图片已生成，VLM 质检中...')
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
              m.status === 'failed' && !batchImages && React.createElement('div', {
                style: {
                  padding: '8px 10px', borderRadius: 6, background: 'var(--panel)',
                  border: '1px solid var(--warn)', fontSize: 11, color: 'var(--warn)',
                  lineHeight: 1.45, wordBreak: 'break-word',
                }
              },
                formatAiImageError(m.error, m.jobId || m.job_id)
              ),
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
              })() : m.type === 'smart-distribute-loading' ? (
                <div style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: 'var(--panel)',
                  border: '1px solid var(--line-2)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}>
                  <div style={{
                    width: 18, height: 18, borderRadius: 99,
                    border: '2px solid var(--line-2)',
                    borderTopColor: 'var(--accent)',
                    animation: 'spin 0.8s linear infinite',
                    flexShrink: 0,
                  }}/>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12.5, color: 'var(--ink)', fontWeight: 600 }}>{m.modeLabel || '智能铺货'}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: 2 }}>
                      {m.fileName ? ('已接收 ' + m.fileName + '，正在解析 sheet 和替换字段…') : '正在解析 sheet 和替换字段…'}
                    </div>
                  </div>
                  {m.startedAt ? <ChatTimer startedAt={m.startedAt}/> : null}
                </div>
              ) : m.type === 'smart-distribute' ? (() => {
                const data = m.data;
                const totalJobs = (data.jobs || []).length;
                const totalSlots = (data.jobs || []).reduce(function(acc, j) {
                  return acc + (j.modules || []).reduce(function(a, m) {
                    return a + (m.values || m.patches || []).length;
                  }, 0);
                }, 0);
                const summary = data.summary || {};
                const formatCountMap = function(counts, opts) {
                  opts = opts || {};
                  return Object.keys(counts || {}).filter(function(k) {
                    return !opts.exclude || opts.exclude.indexOf(k) < 0;
                  }).map(function(k) {
                    return k + ' ' + counts[k];
                  }).join('，');
                };
                const specialText = formatCountMap(summary.typeCounts || {}, { exclude: ['海报'] });
                const skippedText = summary.skippedRows ? ('跳过 ' + summary.skippedRows + ' 行' + ((summary.typeCounts || {}).海报 ? '（海报 ' + (summary.typeCounts || {}).海报 + '）' : '')) : '';
                const summaryText = '解析到 ' + (summary.templateCount || totalJobs) + ' 个模板，'
                  + (summary.skuCount || 0) + ' 个 SKU × ' + (summary.fieldCount || 0) + ' 个字段，共 '
                  + (summary.totalSlots || totalSlots) + ' 个槽位'
                  + (specialText ? '，特殊标记：' + specialText : '')
                  + (skippedText ? '，' + skippedText : '');
                return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                  React.createElement(TextBubble, { who: 'ai' }, '已解析 ' + (data.source ? data.source.fileName : '') + '，' + summaryText + '。' + (m.copied ? '已自动复制第 1 个 JSON' : 'JSON 已生成')),
                  data.warnings && data.warnings.length > 0 ? React.createElement('div', {
                    style: { padding: '10px 12px', borderRadius: 8, background: 'var(--panel)', border: '1px solid var(--warn)', fontSize: 11.5, color: 'var(--warn)', lineHeight: 1.5 }
                  }, data.warnings.map(function(w, wi) { return React.createElement('div', { key: wi }, '⚠ ' + w); })) : null,
                  React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                    (data.jobs || []).map(function(job, ji) {
                      var sheetJson = (m.jobJsons && m.jobJsons[ji]) || '';
                      if (!sheetJson) {
                        try {
                          var source = Object.assign({}, data.source || {});
                          if (job.batchType) source.batchType = job.batchType;
                          if (job.batchLabel) source.batchLabel = job.batchLabel;
                          sheetJson = JSON.stringify({
                            schemaVersion: data.schemaVersion,
                            mode: data.mode,
                            source: source,
                            defaults: data.defaults,
                            summary: job.summary || {},
                            jobs: [job],
                          }, null, 2);
                        } catch(e) { sheetJson = ''; }
                      }
                      var jobSlots = (job.modules || []).reduce(function(a, mod) {
                        return a + (mod.values || mod.patches || []).length;
                      }, 0);
                      var jobModules = (job.modules || []).length;
                      var jobSummary = job.summary || {};
                      var jobSpecialText = formatCountMap(jobSummary.typeCounts || {}, { exclude: ['海报'] });
                      var jobSkippedText = jobSummary.skippedRows ? ('跳过 ' + jobSummary.skippedRows + ' 行' + ((jobSummary.typeCounts || {}).海报 ? '（海报 ' + (jobSummary.typeCounts || {}).海报 + '）' : '')) : '';
                      var jobSummaryText = jobModules + ' 个模块 · '
                        + (jobSummary.skuCount || 0) + ' 个 SKU × ' + (jobSummary.fieldCount || 0) + ' 个字段 · '
                        + (jobSummary.totalSlots || jobSlots) + ' 个槽位'
                        + (jobSpecialText ? ' · 特殊标记：' + jobSpecialText : '')
                        + (jobSkippedText ? ' · ' + jobSkippedText : '');
                      var batchLabel = job.batchLabel || (data.mode === 'patch' ? '增量' : '全量');
                      var title = (data.mode === 'patch' ? batchLabel + ' - ' : '') + (job.sheetName || job.templateName || ('Sheet ' + (ji + 1)));
                      var badgeStyle = job.batchType === 'red'
                        ? { background: 'rgba(180,35,24,0.08)', color: 'var(--warn)' }
                        : job.batchType === 'yellow'
                          ? { background: 'var(--warn-soft)', color: 'var(--warn)' }
                          : { background: 'var(--accent-soft)', color: 'var(--accent-ink)' };
                      return React.createElement('div', {
                        key: (job.batchType || 'full') + ':' + (job.sheetName || ji),
                        style: { width: '100%', borderRadius: 10, background: 'var(--panel)', border: '1px solid var(--line-2)', overflow: 'hidden' }
                      },
                        React.createElement('div', { style: { padding: '9px 12px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 8 } },
                          React.createElement('div', { style: Object.assign({ width: 20, height: 20, borderRadius: 5, display: 'grid', placeItems: 'center' }, badgeStyle) },
                            React.createElement(I.file, { size: 11 })
                          ),
                          React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                            React.createElement('div', { style: { fontSize: 11.5, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, title),
                            React.createElement('div', { className: 'mono', style: { fontSize: 9.5, color: 'var(--ink-3)', lineHeight: 1.45 } }, jobSummaryText)
                          )
                        ),
                        React.createElement('div', { style: { padding: '8px 12px', display: 'flex', gap: 6 } },
                          React.createElement(CopyButton2, { jsonStr: sheetJson })
                        ),
                        React.createElement('pre', {
                          style: {
                            margin: 0, padding: '10px 12px', fontSize: 10,
                            color: 'var(--ink-2)', overflow: 'auto', maxHeight: 180,
                            borderTop: '1px solid var(--line-2)',
                            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                            fontFamily: 'Menlo, Monaco, monospace',
                          }
                        }, sheetJson.slice(0, 1400) + (sheetJson.length > 1400 ? '\n/* ... 截断，完整 JSON 请复制 */' : ''))
                      );
                    })
                  )
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
            ) : m.type === 'file-attach' ? (
              <div style={{
                padding: '8px 10px', borderRadius: 8,
                background: 'var(--panel)', border: '1px solid var(--line-2)',
                display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
              }}>
                <I.file size={14} style={{ color: 'var(--accent)', flexShrink: 0 }}/>
                <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{m.text || '文件'}</span>
                <span className="mono" style={{ color: 'var(--ink-3)', fontSize: 10, marginLeft: 'auto' }}>
                  已上传
                </span>
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
                {m.brief || m.contract ? (
                  <BriefCard brief={m.brief} contract={m.contract} completeness={m.completeness}/>
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
    const publicPrefixes = ['/ai-images/', '/results/', '/output/', '/avatars/'];
    if (publicPrefixes.some(function(prefix) { return parsed.pathname.indexOf(prefix) === 0; })) {
      return parsed.pathname + parsed.search + parsed.hash;
    }
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
const MAX_REFERENCE_IMAGE_BYTES = 5 * 1024 * 1024; // 单张参考图硬限制 5MB
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

const Composer = ({ onSend, onParseTable, onSmartDistribute, isLoading, slashTrigger, template, lastSubmittedMessage, agentEnabled, onToggleAgent, resetKey, onRequestSpecialTemplate, seedPrompt, onSeedConsumed, canvasReferenceSelection }) => {
  const [text, setText] = React.useState('');
  const [lockedCommand, setLockedCommand] = React.useState('');
  const [files, setFiles] = React.useState([]);
  const [imageType, setImageType] = React.useState('png');
  const [aiRatio, setAiRatio] = React.useState('auto');
  const [aiQuality, setAiQuality] = React.useState('1K');
  const [aiProvider, setAiProvider] = React.useState('auto');
  const [aiBatchCount, setAiBatchCount] = React.useState('1');
  const [smartDistributeMode, setSmartDistributeMode] = React.useState('full');
  const [manualRefImages, setManualRefImages] = React.useState([]);
  const [canvasRefImages, setCanvasRefImages] = React.useState([]);
  const [prototypePanel, setPrototypePanel] = React.useState('');
  const [selectedWorkflow, setSelectedWorkflow] = React.useState('chat');
  const [agentSkills, setAgentSkills] = React.useState([]);
  const [selectedSkill, setSelectedSkill] = React.useState('');
  const [skillMenuDismissed, setSkillMenuDismissed] = React.useState(false);
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
  const normalizeBatchCount = React.useCallback(function(value) {
    const digits = String(value || '').replace(/\D+/g, '');
    if (!digits) return 1;
    const parsed = parseInt(digits, 10);
    if (!Number.isFinite(parsed)) return 1;
    return Math.max(1, Math.min(4, parsed));
  }, []);

  const parseSkillInvocation = React.useCallback(function(value) {
    const original = String(value || '');
    const trimmedLeft = original.trimStart();
    const match = trimmedLeft.match(/^\$([A-Za-z0-9_-]+)(?:\s+([\s\S]*))?$/);
    if (!match) return { skill: '', prompt: original };
    return { skill: match[1], prompt: String(match[2] || '').trimStart() };
  }, []);

  const activeSkillInfo = React.useMemo(function() {
    const parsed = parseSkillInvocation(text);
    const skillName = selectedSkill || parsed.skill;
    if (!skillName) return null;
    const found = agentSkills.find(function(skill) { return skill && skill.name === skillName; });
    return found || { name: skillName, title: skillName, description: '' };
  }, [agentSkills, parseSkillInvocation, selectedSkill, text]);

  const skillSearch = React.useMemo(function() {
    const raw = String(text || '').trimStart();
    if (!raw.startsWith('$')) return '';
    return raw.slice(1).split(/\s+/)[0].toLowerCase();
  }, [text]);

  const isTypingSkillName = React.useMemo(function() {
    const raw = String(text || '').trimStart();
    return raw === '$' || /^\$[^\s]*$/.test(raw);
  }, [text]);

  const skillMenuOpen = Boolean(
    (isTypingSkillName && !skillMenuDismissed) ||
    prototypePanel === 'skills'
  );

  const filteredAgentSkills = React.useMemo(function() {
    const q = skillSearch;
    return agentSkills.filter(function(skill) {
      if (!skill || !skill.name) return false;
      if (!q) return true;
      return String(skill.name).toLowerCase().indexOf(q) >= 0 ||
        String(skill.title || '').toLowerCase().indexOf(q) >= 0 ||
        String(skill.description || '').toLowerCase().indexOf(q) >= 0;
    }).slice(0, 8);
  }, [agentSkills, skillSearch]);

  const skillCardDescription = React.useCallback(function(skill) {
    if (skill && skill.name === 'text-art-design') return '创意中文字体设计';
    return String((skill && skill.description) || '').trim();
  }, []);

  const truncateSkillText = React.useCallback(function(value, maxLength) {
    const chars = Array.from(String(value || '').trim());
    if (chars.length <= maxLength) return chars.join('');
    return chars.slice(0, Math.max(0, maxLength - 1)).join('') + '…';
  }, []);

  const selectAgentSkill = React.useCallback(function(skill) {
    if (!skill || !skill.name) return;
    setSelectedSkill(skill.name);
    setSkillMenuDismissed(true);
    setText(function(prev) {
      const raw = String(prev || '');
      if (!raw.trimStart().startsWith('$')) return raw;
      const parsed = parseSkillInvocation(raw);
      return parsed.skill === skill.name ? parsed.prompt : '';
    });
    setPrototypePanel('');
    setTimeout(function() {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }, 0);
  }, [parseSkillInvocation]);

  const [taskDefsKey, setTaskDefsKey] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    if (!window.API || !window.API.listAgentSkills) return function() { alive = false; };
    window.API.listAgentSkills()
      .then(function(skills) {
        if (!alive) return;
        setAgentSkills(Array.isArray(skills) ? skills : []);
      })
      .catch(function(err) { console.warn('Load agent skills failed:', err); });
    return function() { alive = false; };
  }, []);

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
    setSelectedSkill('');
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
            if (blob.size > MAX_REFERENCE_IMAGE_BYTES) {
              const err = new Error('reference_too_large');
              err.fileName = item.name;
              err.sourceUrl = item.sourceUrl;
              err.fileSize = blob.size;
              throw err;
            }
            const ext = blob.type && blob.type.indexOf('/') > -1 ? blob.type.split('/')[1] : 'png';
            const safeName = item.name && /\.[a-z0-9]+$/i.test(item.name) ? item.name : ((item.name || 'reference') + '.' + ext);
            const file = new File([blob], safeName, { type: blob.type || 'image/png' });
            return Object.assign({}, item, { file: file, pending: false });
          })
        );
        if (!alive) {
          return;
        }
        const oversizedNames = [];
        loaded.forEach(function(result) {
          if (result && result.status === 'rejected' && result.reason && result.reason.message === 'reference_too_large') {
            oversizedNames.push(result.reason.fileName || '参考图');
          }
        });
        if (oversizedNames.length) {
          window.alert(
            '以下参考图超过 5MB，已跳过：\n'
            + oversizedNames.slice(0, 5).join('\n')
            + (oversizedNames.length > 5 ? '\n…共 ' + oversizedNames.length + ' 张' : '')
          );
        }
        setCanvasRefImages(function(prev) {
          return prev.map(function(entry) {
            if (!entry || !entry.sourceUrl) return entry;
            const match = loaded.find(function(result) {
              return result && result.status === 'fulfilled' && result.value && result.value.sourceUrl === entry.sourceUrl;
            });
            if (match && match.status === 'fulfilled') return match.value;
            const oversized = loaded.find(function(result) {
              return result && result.status === 'rejected' && result.reason
                && result.reason.message === 'reference_too_large'
                && result.reason.sourceUrl === entry.sourceUrl;
            });
            if (oversized) return null;
            return Object.assign({}, entry, { pending: false });
          }).filter(Boolean);
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
    if (!prototypePanel && !skillMenuOpen) return;
    const onPointerDown = function(e) {
      if (!composerRef.current) return;
      if (!composerRef.current.contains(e.target)) {
        setPrototypePanel('');
        if (skillMenuOpen) setSkillMenuDismissed(true);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return function() {
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [prototypePanel, skillMenuOpen]);

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
    setSelectedSkill('');
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
    setSelectedSkill('');
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
      setSelectedSkill('');
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
  const activeCommandChip = lockedCommand || (selectedSkill ? ('$' + selectedSkill) : '');
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
    selectedWorkflow === 'distribute' ? 'distribute' : selectedWorkflow === 'compose' ? 'compose' : 'chat';
  const isSpecialTemplate = Boolean(template && (template.is_special || template.is_special_full));
  const isImageTypeLocked = activeMode === 'ai-image' || activeMode === 'special' || activeMode === 'special_full' || isSpecialTemplate;
  const aiOptionMap = AI_OPTIONS;
  const AI_RATIOS = Object.keys(aiOptionMap);
  const currentAiRatioMeta = aiOptionMap[aiRatio] || aiOptionMap[AI_RATIOS[0]];
  const _rawQualities = currentAiRatioMeta ? currentAiRatioMeta.qualities : AI_QUALITIES;
  const allowedAiQualities = _rawQualities;
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
      // 渠道选择已移除，统一走智能路由
      if (aiProvider !== 'auto') {
        setAiProvider('auto');
      }
    }
  }, [activeAiModel, aiQuality, aiRatio, aiProvider]);

  const selectWorkflow = React.useCallback(function(next) {
    if (agentEnabled) return;
    const cmd = next && next.cmd ? next.cmd : '';
    if (cmd) {
      setLockedCommand(cmd);
      setSelectedSkill('');
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
    setSelectedSkill('');
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
      setSelectedSkill('');
      setSelectedWorkflow(cmdToWorkflow(matched));
      setText(raw.slice(matched.length).trimStart());
    } else if (raw.trimStart().startsWith('$')) {
      const parsed = parseSkillInvocation(raw);
      setLockedCommand('');
      setSelectedWorkflow('chat');
      setSelectedSkill(parsed.skill || '');
      setText(parsed.prompt || '');
    } else {
      setLockedCommand('');
      setSelectedSkill('');
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
  }, [COMMANDS, cmdToWorkflow, parseSkillInvocation]);

  const handleSend = () => {
    const body = text.trim();
    const smartFile = files.find(function(item) { return item.kind === 'smart-distribute' && item.file; });
    if (smartFile) {
      if (isLoading) return;
      if (onSmartDistribute) {
        onSmartDistribute(smartFile.file, smartFile.name, smartDistributeMode).catch(function(err) { console.error('Smart distribute send error:', err); });
      }
      setFiles(function(prev) { return prev.filter(function(item) { return item !== smartFile; }); });
      setText('');
      return;
    }
    const message = selectedSkill
      ? ('$' + selectedSkill + (body ? ' ' + body : ''))
      : (lockedCommand ? (lockedCommand + (body ? ' ' + body : '')) : body);
    const skillInvocation = parseSkillInvocation(message);
    const sendMessage = message;
    const executionMessage = skillInvocation.skill ? skillInvocation.prompt : message;
    if (!executionMessage || isLoading) return;
    const imagesToSend = [...refImages];
    const normalizedBatchCount = normalizeBatchCount(aiBatchCount);
    // 先发消息再清空输入，避免 isLoading=true 时消息丢失
    onSend(sendMessage, imagesToSend, {
      size: aiImageSize,
      resolution: aiQuality,
      provider: aiProvider,
      workflow: selectedWorkflow,
      lockedCommand: lockedCommand,
      batchCount: selectedWorkflow === 'ai-image' ? normalizedBatchCount : 1,
      skill: skillInvocation.skill || '',
      skillPrompt: executionMessage,
    });
    setAiBatchCount(String(normalizedBatchCount));
    setText('');
    setSelectedSkill('');
    clearRefImages();
  };

  const insertRefTag = React.useCallback((idx) => {
    const tag = `@图片${idx + 1} `;
    setText(function(prev) {
      const current = String(prev || '');
      const input = taRef.current;
      if (!input) return current + tag;
      const start = input.selectionStart ?? current.length;
      const end = input.selectionEnd ?? current.length;
      const next = current.slice(0, start) + tag + current.slice(end);
      setTimeout(function() {
        if (!taRef.current) return;
        taRef.current.focus();
        const newPos = start + tag.length;
        taRef.current.setSelectionRange(newPos, newPos);
      }, 0);
      return next;
    });
  }, []);

  const handleKeyDown = (e) => {
    const el = taRef.current;
    const start = el ? el.selectionStart : 0;
    const end = el ? el.selectionEnd : 0;
    const currentMessage = lockedCommand ? (text.trim() || lockedCommand) : text.trim();
    if (e.key === 'Escape' && skillMenuOpen) {
      e.preventDefault();
      setPrototypePanel('');
      setSkillMenuDismissed(true);
      return;
    }
    if (
      e.key === 'Backspace' &&
      String(text || '').trimStart().startsWith('$') &&
      start <= String(text || '').indexOf('$') + 1 &&
      end <= String(text || '').indexOf('$') + 1
    ) {
      e.preventDefault();
      setText('');
      setSelectedSkill('');
      setSkillMenuDismissed(true);
      setPrototypePanel('');
      return;
    }
    if (
      e.key === 'Backspace' &&
      activeSkillInfo &&
      start === 0 &&
      end === 0
    ) {
      e.preventDefault();
      setSelectedSkill('');
      setSkillMenuDismissed(true);
      return;
    }
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
    if (selectedSkill) {
      setPrototypePanel('');
      setSkillMenuDismissed(true);
      const parsed = parseSkillInvocation(next);
      setText(parsed.skill ? parsed.prompt : next);
      return;
    }
    if (next.trimStart().startsWith('$')) {
      setPrototypePanel('');
      setSelectedSkill('');
      setSkillMenuDismissed(false);
    } else {
      setSkillMenuDismissed(false);
    }
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
      if (selectedWorkflow === 'distribute' && isSmartDistributeFile(file)) {
        addSmartDistributeFile(file);
      } else {
        const fileObj = { name: file.name, size: formatFileSize(file.size), file, imageType };
        setFiles(prev => [...prev, fileObj]);
        if (onParseTable) {
          onParseTable(file, file.name, imageType).catch(err => console.error('Parse table error:', err));
        }
      }
    }
    e.target.value = '';
  };

  const handlePaste = (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const fileItems = items.filter(it => it.kind === 'file');
    if (!fileItems.length) return;
    e.preventDefault();
    const files = fileItems.map(it => it.getAsFile()).filter(Boolean);
    const images = files.filter(f => f && f.type.startsWith('image/'));
    const excels = files.filter(f => f && /\.(xlsx|xlsm)$/i.test(f.name));
    if (excels.length && selectedWorkflow === 'distribute') {
      addSmartDistributeFile(excels[0]);
    } else if (images.length) {
      addImageFiles(images);
    }
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
    const accepted = [];
    const oversized = [];
    images.forEach(function(file) {
      if (file && typeof file.size === 'number' && file.size > MAX_REFERENCE_IMAGE_BYTES) {
        oversized.push(file);
      } else {
        accepted.push(file);
      }
    });
    if (oversized.length) {
      const names = oversized.map(function(f) {
        const sizeMb = (f.size / (1024 * 1024)).toFixed(1);
        return (f.name || '未命名图片') + '（' + sizeMb + 'MB）';
      });
      window.alert(
        '单张参考图不能超过 5MB，以下文件已跳过：\n'
        + names.slice(0, 5).join('\n')
        + (names.length > 5 ? '\n…共 ' + names.length + ' 张' : '')
      );
    }
    if (!accepted.length) return 0;
    setManualRefImages(prev => {
      const remaining = Math.max(0, MAX_REFERENCE_IMAGES - canvasRefImages.length - prev.length);
      if (remaining <= 0) return prev;
      const toAdd = accepted.slice(0, remaining).map(file => ({ file, name: file.name, previewUrl: URL.createObjectURL(file), sourceUrl: '', pending: false, origin: 'manual' }));
      return [...prev, ...toAdd];
    });
    return Math.min(accepted.length, Math.max(0, MAX_REFERENCE_IMAGES - canvasRefImages.length - manualRefImages.length));
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
    var files = e.dataTransfer.files;
    if (selectedWorkflow === 'distribute') {
      // 智能铺货模式支持 Excel 拖入
      var excels = Array.from(files || []).filter(function(f) {
        return /\.(xlsx|xlsm)$/i.test(f.name);
      });
      if (excels.length) {
        addSmartDistributeFile(excels[0]);
      } else {
        if (files && files.length) addImageFiles(files);
      }
    } else {
      if (files && files.length) addImageFiles(files);
    }
  };

  const clearComposer = React.useCallback(() => {
    setText('');
    setSelectedSkill('');
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
  const isSmartDistributeFile = function(file) {
    return file && /\.(xlsx|xlsm)$/i.test(file.name || '');
  };
  const addSmartDistributeFile = function(file) {
    if (!isSmartDistributeFile(file)) return false;
    const fileObj = { name: file.name, size: formatFileSize(file.size), file, kind: 'smart-distribute' };
    setFiles(function(prev) {
      return prev.filter(function(item) { return item.kind !== 'smart-distribute'; }).concat(fileObj);
    });
    return true;
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
      { id: 'distribute', label: '智能铺货', desc: '上传表格，自动解析为铺货 JSON', iconKey: 'grid', workflow: 'distribute' },
      { id: 'special', label: '特殊品', desc: '使用特殊品模板合成结果', iconKey: 'layers', cmd: template && template.is_special_full ? '/特殊品（完整）' : '/特殊品', available: available(template && template.is_special_full ? '/特殊品（完整）' : '/特殊品') },
      { id: 'download', label: '花瓣下载', desc: '输入花瓣 ID，自动识别可下载格式', iconKey: 'download', cmd: '/花瓣下载', available: available('/花瓣下载') },
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
          : selectedWorkflow === 'distribute'
            ? '智能铺货'
          : selectedWorkflow === 'download'
            ? '花瓣下载'
            : '默认';
  const activeTaskIconKey = activeMode === 'ai-image'
    ? 'image'
    : activeMode === 'special' || activeMode === 'special_full'
      ? 'layers'
      : selectedWorkflow === 'compose' || selectedWorkflow === 'distribute'
        ? 'grid'
        : selectedWorkflow === 'download'
          ? 'download'
          : 'sparkles';
  const activeTaskIcon = getTaskIcon(activeTaskIconKey);
  const activeTaskIconSrc = activeMode === 'ai-image'
    ? (activeAiModel === 'nano-banana-pro' ? 'src/icon/gemini-color.png' : 'src/icon/openai.png')
    : null;
  const modeParamLabel = activeMode === 'ai-image'
    ? (aiRatio + ' · ' + aiQuality)
    : activeMode === 'special_full'
      ? '线路 完整'
      : activeMode === 'special'
        ? '线路 普通'
        : selectedWorkflow === 'compose'
          ? (imageType ? ('素材 ' + (IMAGE_TYPES.find(t => t.key === imageType)?.label || imageType)) : '')
          : selectedWorkflow === 'distribute'
            ? (smartDistributeMode === 'patch' ? '方式 增量' : '方式 全量')
            : '';
  const selectedSettingBits = [
    activeSkillInfo ? ('$' + activeSkillInfo.name) : '',
    activeSkillInfo ? '' : (agentEnabled ? 'Agent' : activeTaskLabel),
    agentEnabled ? '沉浸创作' : (activeMode === 'ai-image' ? '⚡ 智能路由' : ''),
    agentEnabled ? '' : modeParamLabel,
    (activeMode === 'ai-image' && normalizeBatchCount(aiBatchCount) > 1) ? ('x' + normalizeBatchCount(aiBatchCount)) : '',
    refImages.length > 0 ? ('ref ' + refImages.length + '/' + MAX_REFERENCE_IMAGES) : '',
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
            : selectedWorkflow === 'distribute'
              ? '上传或拖入 Excel（.xlsx / .xlsm），确认参数后发送生成铺货 JSON'
              : selectedWorkflow === 'download'
              ? '输入花瓣项目 ID 或链接，格式会自动识别'
              : '忘了怎么用？试试直接提问吧';
  const statusBarVisible = Boolean(
    text.trim() ||
    lockedCommand ||
    modeParamLabel ||
    refImages.length > 0 ||
    files.length > 0 ||
    activeSkillInfo ||
    skillMenuOpen ||
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
  const renderSkillMenu = function() {
    if (!skillMenuOpen || !agentSkills.length) return null;
    return React.createElement('div', {
      style: {
        position: 'absolute',
        left: 12,
        right: 12,
        bottom: 92,
        zIndex: 20,
        border: 'none',
        borderRadius: 16,
        background: 'color-mix(in oklab, var(--panel) 96%, transparent)',
        boxShadow: '0 18px 42px rgba(15, 23, 42, 0.07)',
        padding: 6,
        display: 'grid',
        gap: 6,
        maxHeight: 248,
        overflow: 'auto',
        backdropFilter: 'blur(14px)',
      }
    },
      filteredAgentSkills.length ? filteredAgentSkills.map(function(skill) {
        const active = activeSkillInfo && activeSkillInfo.name === skill.name;
        const cardDescription = skillCardDescription(skill);
        return React.createElement('button', {
          key: skill.name,
          type: 'button',
          onMouseDown: function(e) {
            e.preventDefault();
            selectAgentSkill(skill);
          },
          onClick: function(e) { e.preventDefault(); },
          style: {
            border: '1px solid ' + (active ? 'var(--accent)' : 'var(--line-2)'),
            background: active ? 'color-mix(in oklab, var(--accent) 10%, var(--panel))' : 'var(--panel)',
            borderRadius: 14,
            padding: '9px 11px',
            textAlign: 'left',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minWidth: 0,
            position: 'relative',
            boxShadow: 'none',
            transition: 'background 140ms, border-color 140ms, transform 140ms',
          }
        },
          React.createElement('span', {
            style: {
              width: 18,
              height: 18,
              borderRadius: 7,
              border: '1px solid var(--line-2)',
              color: 'var(--accent)',
              fontSize: 12,
              fontWeight: 800,
              lineHeight: '17px',
              textAlign: 'center',
              flexShrink: 0,
              background: 'var(--panel-2)',
            }
          }, '✦'),
          React.createElement('span', { style: { fontSize: 13, fontWeight: 750, color: 'var(--ink)', flexShrink: 0, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, truncateSkillText(skill.name, 24)),
          cardDescription ? React.createElement('span', {
            style: {
              fontSize: 11,
              color: 'var(--ink-3)',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            },
            title: cardDescription,
          }, truncateSkillText(cardDescription, 18)) : null
        );
      }) : React.createElement('div', { style: { padding: 12, fontSize: 12, color: 'var(--ink-3)' } }, '没有匹配的 Skill')
    );
  };
  const protoChipStyle = function(active) {
    return {
      border: '1px solid ' + (active ? 'var(--ink)' : 'var(--line-2)'),
      background: active ? 'var(--ink)' : 'var(--panel)',
      color: active ? 'var(--panel)' : 'var(--ink-2)',
      borderRadius: 999,
      padding: '6px 8px',
      fontSize: 10.5,
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
    // width:
    // - 'fluid'  → 贴父容器左右，略缩进
    // - 'fill'   → 贴满父容器内容区（用于生图参数，对齐输入框）
    // - number   → 固定宽度
    const fluid = width === 'fluid';
    const fill = width === 'fill';
    return React.createElement(React.Fragment, null,
      // 透明 backdrop：点击面板外任意位置自动关闭
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
          left: fill ? 0 : (fluid ? 8 : 0),
          right: fill ? 0 : (fluid ? 8 : 'auto'),
          bottom: 58,
          width: fill || fluid ? 'auto' : (width || 360),
          maxWidth: fill || fluid ? 'none' : 'calc(100vw - 36px)',
          borderRadius: 14,
          border: '1px solid var(--line)',
          background: 'var(--panel)',
          boxShadow: '0 12px 28px rgba(25,24,20,0.08)',
          padding: fill ? '12px 12px 10px' : 14,
          zIndex: 20,
          overflow: 'hidden',
          boxSizing: 'border-box',
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
        ['auto', '自动'],
        ['1:1', '1:1'],
        ['3:2', '3:2'],
        ['2:3', '2:3'],
        ['4:3', '4:3'],
        ['3:4', '3:4'],
        ['5:4', '5:4'],
        ['16:9', '16:9'],
        ['9:16', '9:16'],
      ];
      const ratioIconSize = function(key) {
        const base = 10;
        if (key === 'auto') return { w: base, h: base };
        const parts = String(key).split(':');
        const rw = parseFloat(parts[0]) || 1;
        const rh = parseFloat(parts[1]) || 1;
        if (rw >= rh) {
          return { w: base + 3, h: Math.max(6, Math.round((base + 3) * rh / rw)) };
        }
        return { w: Math.max(6, Math.round((base + 3) * rw / rh)), h: base + 3 };
      };
      const isImageParams = activeMode === 'ai-image';
      const isSpecialParams = activeMode === 'special' || activeMode === 'special_full';
      const isComposeParams = activeMode === 'compose';
      const isDistributeParams = activeMode === 'distribute';
      const paramsTitle = isImageParams ? '生图参数' : isSpecialParams ? '特殊品参数' : isComposeParams ? '合成参数' : isDistributeParams ? '铺货参数' : '问答参数';
      const batchCountValue = normalizeBatchCount(aiBatchCount);
      const imageFieldLabel = function(text, extraStyle) {
        return React.createElement('div', {
          style: Object.assign({
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--ink-2)',
            letterSpacing: '-0.01em',
            marginBottom: 8,
          }, extraStyle || {})
        }, text);
      };
      return protoPanelShell(React.createElement(React.Fragment, null,
        !isImageParams && React.createElement('div', { style: { fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--ink)' } }, paramsTitle),
        isImageParams && React.createElement(React.Fragment, null,
          imageFieldLabel('尺寸'),
          React.createElement('div', {
            style: {
              display: 'grid',
              gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
              gap: 6,
            }
          },
            sizeItems.map(function(item) {
              const active = aiRatio === item[0];
              const dims = ratioIconSize(item[0]);
              return React.createElement('button', {
                key: item[0],
                type: 'button',
                onClick: function() { setAiRatio(item[0]); },
                style: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                  width: '100%',
                  height: 30,
                  padding: '0 4px',
                  borderRadius: 9,
                  background: active ? 'var(--accent-soft)' : 'var(--panel)',
                  border: '1px solid ' + (active ? 'color-mix(in oklch, var(--accent) 45%, white)' : 'var(--line)'),
                  color: active ? 'var(--accent-ink)' : 'var(--ink-2)',
                  boxShadow: 'none',
                  cursor: 'pointer',
                  fontSize: 11.5,
                  fontWeight: active ? 650 : 500,
                  letterSpacing: '-0.01em',
                  minWidth: 0,
                }
              },
                item[0] === 'auto'
                  ? (active
                      ? React.createElement(I.check, { size: 12, stroke: 2.2 })
                      : React.createElement('div', {
                          style: {
                            width: 10,
                            height: 10,
                            borderRadius: 2.5,
                            border: '1.5px solid currentColor',
                            opacity: 0.7,
                            flexShrink: 0,
                          }
                        }))
                  : React.createElement('div', {
                      style: {
                        width: dims.w,
                        height: dims.h,
                        borderRadius: 2,
                        border: '1.5px solid currentColor',
                        opacity: active ? 0.95 : 0.7,
                        flexShrink: 0,
                      }
                    }),
                React.createElement('span', {
                  style: {
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }
                }, item[1])
              );
            })
          ),
          React.createElement('div', {
            style: {
              height: 1,
              background: 'var(--line)',
              margin: '12px 0 12px',
            }
          }),
          React.createElement('div', {
            style: {
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 16,
              alignItems: 'start',
            }
          },
            React.createElement('div', null,
              imageFieldLabel('清晰度'),
              React.createElement('div', {
                style: {
                  display: 'flex',
                  width: '100%',
                  alignItems: 'stretch',
                  border: '1px solid var(--line)',
                  borderRadius: 9,
                  overflow: 'hidden',
                  background: 'var(--panel)',
                }
              },
                ['1K', '2K', '4K'].map(function(q, idx) {
                  const disabled = !allowedAiQualities.includes(q);
                  const active = aiQuality === q;
                  return React.createElement('button', {
                    key: q,
                    type: 'button',
                    disabled: disabled,
                    onClick: function() { if (!disabled) setAiQuality(q); },
                    style: {
                      flex: 1,
                      height: 30,
                      padding: 0,
                      border: 'none',
                      borderLeft: idx === 0 ? 'none' : '1px solid var(--line)',
                      background: active ? 'var(--ink)' : 'transparent',
                      color: active ? 'var(--panel)' : 'var(--ink-2)',
                      fontSize: 12,
                      fontWeight: active ? 700 : 550,
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      opacity: disabled ? 0.4 : 1,
                      letterSpacing: '-0.01em',
                    }
                  }, q);
                })
              )
            ),
            React.createElement('div', null,
              imageFieldLabel('并发数 1-4 张'),
              React.createElement('div', {
                style: {
                  display: 'flex',
                  width: '100%',
                  alignItems: 'center',
                  height: 30,
                  border: '1px solid var(--line)',
                  borderRadius: 9,
                  overflow: 'hidden',
                  background: 'var(--panel)',
                }
              },
                React.createElement('button', {
                  type: 'button',
                  disabled: batchCountValue <= 1,
                  onClick: function() {
                    setAiBatchCount(String(Math.max(1, batchCountValue - 1)));
                  },
                  style: {
                    width: 34,
                    height: '100%',
                    display: 'grid',
                    placeItems: 'center',
                    color: batchCountValue <= 1 ? 'var(--ink-3)' : 'var(--ink-2)',
                    cursor: batchCountValue <= 1 ? 'not-allowed' : 'pointer',
                    fontSize: 15,
                    fontWeight: 500,
                    lineHeight: 1,
                    borderRight: '1px solid var(--line)',
                    background: 'transparent',
                    flexShrink: 0,
                  }
                }, '−'),
                React.createElement('div', {
                  style: {
                    flex: 1,
                    textAlign: 'center',
                    fontSize: 12.5,
                    fontWeight: 650,
                    color: 'var(--ink)',
                    letterSpacing: '-0.01em',
                  }
                }, String(batchCountValue)),
                React.createElement('button', {
                  type: 'button',
                  disabled: batchCountValue >= 4,
                  onClick: function() {
                    setAiBatchCount(String(Math.min(4, batchCountValue + 1)));
                  },
                  style: {
                    width: 34,
                    height: '100%',
                    display: 'grid',
                    placeItems: 'center',
                    color: batchCountValue >= 4 ? 'var(--ink-3)' : 'var(--ink-2)',
                    cursor: batchCountValue >= 4 ? 'not-allowed' : 'pointer',
                    fontSize: 15,
                    fontWeight: 500,
                    lineHeight: 1,
                    borderLeft: '1px solid var(--line)',
                    background: 'transparent',
                    flexShrink: 0,
                  }
                }, '+')
              )
            )
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
        isDistributeParams && React.createElement(React.Fragment, null,
          protoSectionLabel('铺货方式'),
          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 } },
            [
              { key: 'full', label: '全量', desc: '按 Sheet 依次返回' },
              { key: 'patch', label: '增量', desc: '仅黄/红标记内容' },
            ].map(function(item) {
              const active = smartDistributeMode === item.key;
              return React.createElement('button', {
                key: item.key,
                type: 'button',
                onClick: function() { setSmartDistributeMode(item.key); },
                style: {
                  cursor: 'pointer',
                  minHeight: 44,
                  padding: '8px 10px',
                  borderRadius: 12,
                  border: '1px solid ' + (active ? 'var(--ink)' : 'var(--line-2)'),
                  background: active ? 'var(--ink)' : 'var(--panel)',
                  color: active ? 'var(--panel)' : 'var(--ink)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  justifyContent: 'center',
                  gap: 2,
                  textAlign: 'left',
                  boxShadow: 'none',
                }
              },
                React.createElement('span', { style: { fontSize: 12, fontWeight: 700, lineHeight: 1.1 } }, item.label),
                React.createElement('span', { style: { fontSize: 10.5, lineHeight: 1.2, color: active ? 'rgba(255,255,255,0.68)' : 'var(--ink-3)', fontWeight: 500 } }, item.desc)
              );
            })
          )
        ),
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
                  setSelectedSkill('');
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
        !isImageParams && !isSpecialParams && !isDistributeParams && activeMode !== 'chat' && React.createElement(React.Fragment, null,
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
      ), isImageParams ? 'fill' : 'fluid');
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
          <I.file size={28} style={{ color: 'var(--accent)' }}/>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>
            松手添加文件
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
            支持图片和 Excel（.xlsx / .xlsm）
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
            const isSkillBit = typeof bit === 'string' && bit.startsWith('$');
            return (
              <span key={idx} style={{
                fontSize: 12,
                fontWeight: isSkillBit ? 750 : (idx === 0 ? 600 : 400),
                color: isSkillBit ? 'var(--accent)' : (idx === 0 ? 'var(--ink)' : 'var(--ink-3)'),
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
        {renderSkillMenu()}

        <div style={{
          position: 'relative',
          width: '100%',
          flex: composerHeight ? 1 : undefined,
          minHeight: composerHeight ? 56 : 92,
          maxHeight: composerHeight ? undefined : 180,
          display: 'flex',
          flexDirection: 'column',
        }}>
          {activeCommandChip && (
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6, userSelect: 'none' }}>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 8px',
                borderRadius: 6,
                background: selectedSkill ? 'var(--accent-soft)' : 'var(--panel-2)',
                border: '1px solid ' + (selectedSkill ? 'var(--accent)' : 'var(--line)'),
                color: selectedSkill ? 'var(--accent-ink)' : 'var(--ink)',
                fontSize: 11.5,
                fontWeight: 650,
                lineHeight: 1.2,
                letterSpacing: '-0.01em',
              }}>
                <span>{activeCommandChip}</span>
                <button
                  type="button"
                  onClick={function() {
                    setLockedCommand('');
                    setSelectedSkill('');
                    setSelectedWorkflow('chat');
                    if (taRef.current) taRef.current.focus();
                  }}
                  title="移除指令标记"
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'inherit',
                    opacity: 0.6,
                    cursor: 'pointer',
                    fontSize: 12,
                    lineHeight: 1,
                    padding: 0,
                    marginRight: -2,
                    display: 'grid',
                    placeItems: 'center',
                  }}
                >×</button>
              </span>
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
            placeholder={composerPlaceholder}
            rows={2}
            style={{
              width: '100%',
              height: '100%',
              minHeight: 'inherit',
              maxHeight: 'inherit',
              boxSizing: 'border-box',
              fontSize: 13,
              lineHeight: 1.45,
              fontFamily: 'inherit',
              color: 'var(--ink)',
              caretColor: 'var(--ink)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              border: 'none',
              outline: 'none',
              resize: 'none',
              overflowY: 'auto',
              background: 'transparent',
              margin: 0,
              padding: '2px 2px 0',
              position: 'relative',
              zIndex: 1,
            }}
          />
        </div>
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
          accept="image/*,.xlsx,.xlsm"
          multiple
          style={{ display: 'none' }}
        />

        {/* Reference images preview */ }
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
                  type="button"
                  onClick={() => insertRefTag(idx)}
                  title={`点击在 Prompt 中插入 @图片${idx + 1}`}
                  style={{
                    position: 'absolute', bottom: 2, left: 2,
                    padding: '1px 3px', borderRadius: 4,
                    background: 'rgba(20, 22, 40, 0.72)', color: 'white',
                    fontSize: 9, fontWeight: 600, lineHeight: 1, cursor: 'pointer',
                    backdropFilter: 'blur(4px)', border: 'none',
                  }}
                >@{idx + 1}</button>
                <button
                  type="button"
                  onClick={() => removeRefImage(idx)}
                  style={{
                    position: 'absolute', top: -5, right: -5,
                    width: 15, height: 15, borderRadius: 99,
                    background: 'var(--ink-2)', color: 'white',
                    display: 'grid', placeItems: 'center',
                    fontSize: 10, lineHeight: 1, cursor: 'pointer', border: 'none',
                  }}
                >×</button>
              </div>
            ))}
            <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>{refImages.length}/{MAX_REFERENCE_IMAGES}</span>
          </div>
        )}

        {files.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {files.map(function(item, idx) {
              return (
                <div key={idx} style={{
                  minWidth: 0,
                  maxWidth: '100%',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  padding: '6px 8px',
                  borderRadius: 10,
                  border: '1px solid var(--line)',
                  background: 'var(--panel-2)',
                  color: 'var(--ink)',
                }}>
                  <I.file size={13}/>
                  <span style={{ fontSize: 12, fontWeight: 600, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{item.kind === 'smart-distribute' ? '待铺货' : item.size}</span>
                  <button
                    type="button"
                    onClick={function() { setFiles(function(prev) { return prev.filter(function(_, i) { return i !== idx; }); }); }}
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 999,
                      background: 'transparent',
                      color: 'var(--ink-3)',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 12,
                      lineHeight: 1,
                      cursor: 'pointer',
                    }}
                  >×</button>
                </div>
              );
            })}
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
    var intentPatch = (payload && (payload.intent_patch || payload.action_intent)) || {};
    var msg = {
      who: item && item.role === 'user' ? 'user' : 'ai',
      text: (item && item.text) || '',
      meta: item && item.role === 'assistant' ? 'Agent' : undefined,
      refMeta: refMeta,
      intentPatch: intentPatch,
    };
    // 恢复 CONFIRM 的 Brief 卡片 + 快捷按钮
    if (decision && decision.type === 'CONFIRM') {
      if (decision.brief) msg.brief = decision.brief;
      if (decision.contract) msg.contract = decision.contract;
      if (decision.completeness) msg.completeness = decision.completeness;
      if (Array.isArray(decision.quickActions) && decision.quickActions.length > 0) {
        msg.quickActions = decision.quickActions;
      }
      msg.decisionType = 'CONFIRM';
    } else if (decision && decision.type === 'ASK') {
      if (decision.brief) msg.brief = decision.brief;
      if (decision.contract) msg.contract = decision.contract;
      if (decision.completeness) msg.completeness = decision.completeness;
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
    var promptPayload = image && image.prompt ? image.prompt : null;
    return {
      who: 'ai',
      type: 'ai-image-generating',
      model: (image && image.model) || 'agent',
      prompt: promptPayload ? (promptPayload.instruction || promptPayload.positive || '') : '',
      promptPayload: promptPayload,
      status: 'done',
      imageUrl: image && image.image_url ? ((window.API_BASE || window.location.origin) + image.image_url) : '',
      finalElapsed: null,
      progress: 100,
      meta: 'Agent',
      vlm: image && image.vlm_analysis ? image.vlm_analysis : null,
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

  const normalizeAiImageModel = React.useCallback(function(model) {
    const value = String(model || '').trim().toLowerCase();
    if (!value) return '';
    if (value.includes('nano') || value.includes('banana') || value.includes('gemini')) return 'nano-banana-pro';
    if (value.includes('gpt') || value.includes('image')) return 'gpt-image-2';
    return value;
  }, []);

  const hasDoneAiImageInCurrentThread = React.useCallback(function() {
    return messages.some(function(m) {
      return m && m.type === 'ai-image-generating' && m.status === 'done' && (m.imageUrl || m.previewUrl);
    });
  }, [messages]);

  const isLikelyAiImageFollowup = React.useCallback(function(value) {
    const s = String(value || '').trim();
    if (!s) return false;
    if (s.startsWith('/')) return false;
    if (/^(为什么|怎么|如何|什么|吗|是不是|能不能解释|帮我分析)/.test(s)) return false;
    if (s.length <= 80 && /(改|换|调|变成|去掉|删除|加上|增加|减少|保留|不要|更|再|继续|上一张|这张|这个|背景|颜色|色调|风格|构图|比例|尺寸|文案|字体|清晰|高级|简约|真实|产品|人物|模特|重新生成|重画|出一版|来一版)/.test(s)) {
      return true;
    }
    return /(基于上一张|参考上一张|在上一版基础上|沿用上一版|保持.*改|只把.*改|其他不变)/.test(s);
  }, []);

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
    // 乐观更新（批量卡按 batchImageIndex 落到对应那张图）
    setMessages(function(msgs) { return patchMessageOrImage(msgs, msg, { inspirationPublishing: true }); });
    try {
      const res = await window.API.publishInspiration(payload);
      const post = res && res.post;
      setMessages(function(msgs) {
        return patchMessageOrImage(msgs, msg, { inspirationPostId: post ? post.id : null, inspirationPublishing: false });
      });
      setPublishDialog(null);
    } catch (e) {
      setMessages(function(msgs) { return patchMessageOrImage(msgs, msg, { inspirationPublishing: false }); });
      setPublishDialog(function(prev) { return prev ? Object.assign({}, prev, { submitting: false }) : prev; });
      window.alert('发布失败：' + (e.message || '未知错误'));
    }
  }, [publishDialog]);

  const handleUnpublishInspiration = React.useCallback(async (msg) => {
    if (!msg || !msg.inspirationPostId) return;
    if (!window.confirm('下架这条灵感？')) return;
    const postId = msg.inspirationPostId;
    setMessages(function(msgs) { return patchMessageOrImage(msgs, msg, { inspirationPublishing: true }); });
    try {
      await window.API.unpublishInspiration(postId);
      setMessages(function(msgs) {
        return patchMessageOrImage(msgs, msg, { inspirationPostId: null, inspirationPublishing: false });
      });
    } catch (e) {
      setMessages(function(msgs) { return patchMessageOrImage(msgs, msg, { inspirationPublishing: false }); });
      window.alert('下架失败：' + (e.message || '未知错误'));
    }
  }, []);

  // —— AI 生图核心流程（共享）——
  const runAiImageGeneration = React.useCallback(async (model, prompt, displayText, refImages, aiOptions) => {
    const batchCount = Math.max(1, Math.min(parseInt(aiOptions.batchCount) || 1, 4));
    setIsLoading(true);
    var finalPrompt = prompt;
    var finalRefImages = Array.isArray(refImages) ? refImages.slice() : [];

    var refPreviews = [];
    var lastSize = aiOptions.size || '1024x1024';
    var lastResolution = aiOptions.resolution || '1K';
    var provider = aiOptions.provider || 'auto';
    var activeSkill = String(aiOptions.skill || '').trim();
    var plannedPrompt = String(aiOptions.plannedPrompt || '').trim();
    var plannedPromptTrace = String(aiOptions.promptTrace || '').trim();

    // 预解析 product refs（一次，多 job 共享）
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
      try {
        refPreviews = await Promise.all(finalRefImages.map(r => fileToThumbDataUrl(r.file)));
      } catch (e) { refPreviews = []; }
    } catch (e) {
      const failedAt = Date.now();
      var prepClientId = newClientRequestId();
      var prepErr = formatAiImageError(
        '准备参考图/素材时出错：' + ((e && e.message) || '未知原因'),
        null
      );
      reportAiImageClientEvent({
        type: 'prepare_failed',
        phase: 'prepare',
        clientRequestId: prepClientId,
        model: model,
        provider: provider,
        error: (e && e.message) || String(e || ''),
        reachedServer: false,
      });
      alertAiImageError(prepErr, {
        phaseLabel: describeAiImageFailPhase('prepare'),
        clientRequestId: prepClientId,
      });
      setMessages(msgs => [...msgs, {
        who: 'ai', type: 'ai-image-generating',
        model, provider, prompt, size: lastSize, resolution: lastResolution,
        status: 'failed',
        failPhase: 'prepare',
        clientRequestId: prepClientId,
        error: prepErr,
        finalElapsed: 0, startedAt: failedAt,
        activeSkill: activeSkill,
        meta: 'Loom', hasReference: refImages.length > 0, refCount: refImages.length, refPreviews: [],
      }]);
      setIsLoading(false);
      return;
    }

    // 批量也只建一张卡：n 张图渲染在这张卡的 images 网格里
    const slots = [];
    const baseAt = Date.now();
    slots.push(baseAt);
    setMessages(msgs => [...msgs, {
      who: 'ai', type: 'ai-image-generating',
      model, provider, prompt, size: lastSize, resolution: lastResolution,
      status: activeSkill ? 'skill-planning' : 'running', startedAt: baseAt, progress: 0,
      activeSkill: activeSkill,
      meta: batchCount > 1 ? 'Loom · ×' + batchCount : 'Loom',
      hasReference: refImages.length > 0, refCount: refImages.length, refPreviews: [],
      batchCount: batchCount,
      images: batchCount > 1 ? [] : undefined,
    }]);

    if (activeSkill && !plannedPrompt && window.API && window.API.streamSkillPlan) {
      const primarySlotAt = slots[0];
      var streamedTrace = '';
      var plannerRefImages = (Array.isArray(finalRefImages) ? finalRefImages : []).slice(0, 3).map(function(r) { return r && r.file; }).filter(Boolean);
      try {
        await window.API.streamSkillPlan(activeSkill, finalPrompt, plannerRefImages, {
          onDelta: function(payload) {
            var delta = String((payload && payload.text) || '');
            if (!delta) return;
            streamedTrace += delta;
            setMessages(msgs => msgs.map(m =>
              m.type === 'ai-image-generating' && m.startedAt === primarySlotAt
                ? Object.assign({}, m, {
                    status: 'skill-planning',
                    promptTrace: streamedTrace,
                    progress: Math.max(m.progress || 0, 8),
                  })
                : m
            ));
          },
          onDone: function(payload) {
            plannedPrompt = String((payload && payload.final_prompt) || '').trim();
            plannedPromptTrace = String((payload && payload.prompt_trace) || streamedTrace || '').trim();
            if (plannedPrompt) finalPrompt = plannedPrompt;
            setMessages(msgs => msgs.map(m =>
              m.type === 'ai-image-generating' && m.startedAt === primarySlotAt
                ? Object.assign({}, m, {
                    status: 'skill-parsed',
                    resolvedPrompt: plannedPrompt || m.resolvedPrompt,
                    promptTrace: plannedPromptTrace || m.promptTrace,
                    progress: Math.max(m.progress || 0, 15),
                  })
                : m
            ));
          },
          onError: function(payload) {
            plannedPrompt = String((payload && payload.fallback_prompt) || '').trim();
            plannedPromptTrace = String((payload && payload.prompt_trace) || streamedTrace || '').trim();
            if (plannedPrompt) finalPrompt = plannedPrompt;
            setMessages(msgs => msgs.map(m =>
              m.type === 'ai-image-generating' && m.startedAt === primarySlotAt
                ? Object.assign({}, m, {
                    status: 'skill-parsed',
                    resolvedPrompt: plannedPrompt || m.resolvedPrompt,
                    promptTrace: plannedPromptTrace || m.promptTrace,
                    progress: Math.max(m.progress || 0, 15),
                  })
                : m
            ));
          },
        });
      } catch (e) {
        console.warn('Skill planner stream failed, falling back to backend planner:', e);
      }
    }

    const apiBase = window.API_BASE || window.location.origin;
    const collected = [];
    var doneCount = 0;
    const tryFlushCollected = function() {
      doneCount++;
      if (doneCount === batchCount && onComposeComplete && collected.length > 0) {
        const sortedUrls = collected.slice().sort(function(a, b) { return a.index - b.index; }).map(function(x) { return x.url; });
        onComposeComplete(null, null, sortedUrls, null);
      }
    };
    const submitOne = function(slotAt, index) {
      return new Promise(function(resolve) {
        const clientRequestId = newClientRequestId();
        // 提交前就把 client 号写到卡片上，即使请求没到后端也能对照控制台
        setMessages(msgs => msgs.map(m =>
          m.type === 'ai-image-generating' && m.startedAt === slotAt
            ? Object.assign({}, m, {
                clientRequestId: clientRequestId,
                status: m.status === 'skill-planning' ? m.status : 'queued',
                progress: Math.max(m.progress || 0, 5),
              })
            : m
        ));
        const fd = new FormData();
        fd.append('model', model);
        fd.append('provider', provider);
        fd.append('prompt', finalPrompt);
        fd.append('size', aiOptions.size || '1024x1024');
        fd.append('resolution', aiOptions.resolution || '1K');
        if (activeSkill) fd.append('skill', activeSkill);
        if (plannedPrompt) fd.append('planned_prompt', plannedPrompt);
        if (plannedPromptTrace) fd.append('prompt_trace', plannedPromptTrace);
        if (currentAiChatId && !aiOptions.skipContext) fd.append('chat_session_id', currentAiChatId);
        fd.append('ref_previews', JSON.stringify(refPreviews));
        fd.append('client_request_id', clientRequestId);
        finalRefImages.forEach(r => fd.append('image', r.file));
        fd.append('batch_count', '1');

        pushAiImageClientEvent({
          type: 'submit_start',
          phase: 'submit',
          clientRequestId: clientRequestId,
          model: model,
          provider: provider,
          refCount: finalRefImages.length,
        });

        postAiImageForm(apiBase, fd, { clientRequestId: clientRequestId, maxAttempts: 2, timeoutMs: 120000 })
          .then(function(data) {
            if (data.chat_session_id) setCurrentAiChatId(data.chat_session_id);
            const jobId = data.job_id;
            if (!jobId) {
              const finalElapsed = Math.floor((Date.now() - slotAt) / 1000);
              var noJobErr = '服务器返回异常，没有生成任务编号，请稍后重试。';
              reportAiImageClientEvent({
                type: 'submit_no_job_id',
                phase: 'submit',
                clientRequestId: clientRequestId,
                model: model,
                provider: provider,
                reachedServer: true,
                error: 'response missing job_id',
              });
              alertAiImageError(noJobErr, {
                phaseLabel: describeAiImageFailPhase('submit'),
                clientRequestId: clientRequestId,
              });
              setMessages(msgs => msgs.map(m =>
                m.type === 'ai-image-generating' && m.startedAt === slotAt
                  ? Object.assign({}, m, {
                      status: 'failed',
                      failPhase: 'submit',
                      error: formatAiImageError(noJobErr, null),
                      finalElapsed: finalElapsed,
                      clientRequestId: clientRequestId,
                    })
                  : m
              ));
              tryFlushCollected();
              resolve();
              return;
            }
            pushAiImageClientEvent({
              type: 'submit_accepted',
              phase: 'submit',
              clientRequestId: clientRequestId,
              jobId: jobId,
              reachedServer: true,
            });
            setMessages(msgs => msgs.map(m =>
              m.type === 'ai-image-generating' && m.startedAt === slotAt
                ? Object.assign({}, m, {
                    jobId: jobId,
                    clientRequestId: clientRequestId,
                    status: activeSkill ? 'skill-parsed' : 'processing',
                    resolvedPrompt: data.resolved_prompt || m.resolvedPrompt,
                    promptTrace: data.prompt_trace || m.promptTrace,
                    progress: Math.max(m.progress || 0, 12),
                  })
                : m
            ));
            var pollFails = 0;
            const failSlot = function(errorText, extra) {
              clearInterval(pollInterval);
              const finalElapsed = Math.floor((Date.now() - slotAt) / 1000);
              var phase = (extra && extra.phase) || 'poll_or_job';
              var errText = formatAiImageError(errorText, jobId, Object.assign({ clientRequestId: clientRequestId }, extra || {}));
              reportAiImageClientEvent({
                type: 'job_failed',
                phase: phase,
                clientRequestId: clientRequestId,
                jobId: jobId,
                taskId: extra && extra.taskId,
                httpStatus: extra && extra.httpStatus,
                error: String(errorText || '').slice(0, 400),
                reachedServer: true,
              });
              alertAiImageError(errText, {
                phaseLabel: describeAiImageFailPhase(phase),
                clientRequestId: clientRequestId,
                jobId: jobId,
              });
              setMessages(msgs => msgs.map(m =>
                m.type === 'ai-image-generating' && m.startedAt === slotAt
                  ? Object.assign({}, m, {
                      status: 'failed',
                      failPhase: phase,
                      error: errText,
                      finalElapsed: finalElapsed,
                      jobId: jobId,
                      clientRequestId: clientRequestId,
                      taskId: (extra && extra.taskId) || m.taskId,
                      refPreviews: refPreviews.length ? refPreviews : m.refPreviews,
                    })
                  : m
              ));
              loadAiChatHistory();
              tryFlushCollected();
              resolve();
            };
            const pollInterval = setInterval(function() {
              fetch(apiBase + '/ai-image/' + jobId, {
                credentials: 'include',
                headers: { 'X-Client-Request-Id': clientRequestId },
              })
                .then(function(r) {
                  if (!r.ok) {
                    pollFails += 1;
                    return r.json().catch(function() { return {}; }).then(function(errBody) {
                      var detail = (errBody && (errBody.detail || errBody.message || errBody.error)) || '';
                      if (typeof detail === 'object' && detail) detail = detail.message || JSON.stringify(detail);
                      if (isTerminalAiImagePollStatus(r.status)) {
                        failSlot(detail || ('查询任务状态失败 HTTP ' + r.status), { httpStatus: r.status });
                      }
                      return null;
                    });
                  }
                  pollFails = 0;
                  return r.json();
                })
                .then(function(statusData) {
                  if (!statusData) return;
                  setMessages(msgs => msgs.map(m =>
                    m.type === 'ai-image-generating' && m.startedAt === slotAt
                      ? Object.assign({}, m, {
                          status: statusData.status === 'failed' || statusData.status === 'done' ? statusData.status : (statusData.status || m.status),
                          progress: statusData.progress || m.progress,
                          originalPrompt: statusData.original_prompt || m.originalPrompt,
                          resolvedPrompt: statusData.resolved_prompt || m.resolvedPrompt,
                          promptTrace: statusData.prompt_trace || m.promptTrace,
                          provider: statusData.provider || m.provider,
                          providerSwitched: statusData.providerSwitched || m.providerSwitched,
                          taskId: statusData.task_id || m.taskId,
                          jobId: jobId,
                          clientRequestId: clientRequestId,
                        })
                      : m
                  ));
                  if (statusData.status === 'done' && statusData.image_url) {
                    clearInterval(pollInterval);
                    const finalElapsed = Math.floor((Date.now() - slotAt) / 1000);
                    setMessages(msgs => msgs.map(m =>
                      m.type === 'ai-image-generating' && m.startedAt === slotAt
                        ? Object.assign({}, m, { status: 'done', imageUrl: statusData.image_url, previewUrl: statusData.preview_url || statusData.image_url, finalElapsed: finalElapsed, progress: 100, refPreviews: refPreviews.length ? refPreviews : m.refPreviews, originalPrompt: statusData.original_prompt || m.originalPrompt, resolvedPrompt: statusData.resolved_prompt || m.resolvedPrompt, promptTrace: statusData.prompt_trace || m.promptTrace, jobId: jobId, taskId: statusData.task_id || m.taskId, clientRequestId: clientRequestId })
                        : m
                    ));
                    loadAiChatHistory();
                    collected.push({ url: statusData.image_url, index: index });
                    tryFlushCollected();
                    resolve();
                  } else if (statusData.status === 'done' && !statusData.image_url) {
                    // done 但无图：当失败处理，避免卡片卡在完成态空白
                    failSlot('任务标记完成但未返回图片地址', { taskId: statusData.task_id, phase: 'download' });
                  } else if (statusData.status === 'failed') {
                    failSlot(statusData.error, { taskId: statusData.task_id, phase: 'generate' });
                  }
                })
                .catch(function(pollErr) {
                  pollFails += 1;
                  console.warn('[ai-image] poll error job=' + jobId + ' client=' + clientRequestId, pollErr);
                });
            }, 2000);
          })
          .catch(function(err) {
            const finalElapsed = Math.floor((Date.now() - slotAt) / 1000);
            var failPhase = (err && err.phase) || (err && err.unreached ? 'network' : 'submit');
            var submitErr = formatAiImageError(
              (err && err.message) || '提交失败',
              null,
              { clientRequestId: clientRequestId, httpStatus: err && err.httpStatus }
            );
            reportAiImageClientEvent({
              type: 'submit_failed',
              phase: failPhase,
              clientRequestId: clientRequestId,
              model: model,
              provider: provider,
              httpStatus: err && err.httpStatus,
              attempt: err && err.attempt,
              unreached: !!(err && (err.unreached || isLikelyUnreachedServerError(err))),
              reachedServer: !!(err && err.httpStatus),
              error: String((err && err.message) || '').slice(0, 500),
              refCount: finalRefImages.length,
            });
            alertAiImageError(submitErr, {
              phaseLabel: describeAiImageFailPhase(failPhase),
              clientRequestId: clientRequestId,
            });
            setMessages(msgs => msgs.map(m =>
              m.type === 'ai-image-generating' && m.startedAt === slotAt
                ? Object.assign({}, m, {
                    status: 'failed',
                    failPhase: failPhase,
                    error: submitErr,
                    finalElapsed: finalElapsed,
                    clientRequestId: clientRequestId,
                  })
                : m
            ));
            tryFlushCollected();
            resolve();
          });
      });
    };

    // 批量提交：一次 POST batch_count=n（一条用户消息、一次改写、一个会话），
    // 返回 n 个 job_id 后并行轮询，全部更新到同一张卡的 images 网格
    const submitBatch = function(slotAt) {
      return new Promise(function(resolve) {
        const clientRequestId = newClientRequestId();
        setMessages(msgs => msgs.map(m =>
          m.type === 'ai-image-generating' && m.startedAt === slotAt
            ? Object.assign({}, m, {
                clientRequestId: clientRequestId,
                status: m.status === 'skill-planning' ? m.status : 'queued',
                progress: Math.max(m.progress || 0, 5),
              })
            : m
        ));
        const fd = new FormData();
        fd.append('model', model);
        fd.append('provider', provider);
        fd.append('prompt', finalPrompt);
        fd.append('size', aiOptions.size || '1024x1024');
        fd.append('resolution', aiOptions.resolution || '1K');
        if (activeSkill) fd.append('skill', activeSkill);
        if (plannedPrompt) fd.append('planned_prompt', plannedPrompt);
        if (plannedPromptTrace) fd.append('prompt_trace', plannedPromptTrace);
        if (currentAiChatId && !aiOptions.skipContext) fd.append('chat_session_id', currentAiChatId);
        fd.append('ref_previews', JSON.stringify(refPreviews));
        fd.append('client_request_id', clientRequestId);
        finalRefImages.forEach(r => fd.append('image', r.file));
        fd.append('batch_count', String(batchCount));

        pushAiImageClientEvent({
          type: 'submit_start',
          phase: 'submit',
          clientRequestId: clientRequestId,
          model: model,
          provider: provider,
          refCount: finalRefImages.length,
          batchCount: batchCount,
        });

        postAiImageForm(apiBase, fd, { clientRequestId: clientRequestId, maxAttempts: 2, timeoutMs: 120000 })
          .then(function(data) {
            if (data.chat_session_id) setCurrentAiChatId(data.chat_session_id);
            var jobIds = Array.isArray(data.job_ids) && data.job_ids.length
              ? data.job_ids
              : (data.job_id ? [data.job_id] : []);
            if (!jobIds.length) {
              const finalElapsed = Math.floor((Date.now() - slotAt) / 1000);
              var noJobErr = '服务器返回异常，没有生成任务编号，请稍后重试。';
              reportAiImageClientEvent({
                type: 'submit_no_job_id',
                phase: 'submit',
                clientRequestId: clientRequestId,
                model: model,
                provider: provider,
                reachedServer: true,
                error: 'response missing job_ids',
              });
              alertAiImageError(noJobErr, {
                phaseLabel: describeAiImageFailPhase('submit'),
                clientRequestId: clientRequestId,
              });
              setMessages(msgs => msgs.map(m =>
                m.type === 'ai-image-generating' && m.startedAt === slotAt
                  ? Object.assign({}, m, {
                      status: 'failed',
                      failPhase: 'submit',
                      error: formatAiImageError(noJobErr, null),
                      finalElapsed: finalElapsed,
                      clientRequestId: clientRequestId,
                    })
                  : m
              ));
              resolve();
              return;
            }
            pushAiImageClientEvent({
              type: 'submit_accepted',
              phase: 'submit',
              clientRequestId: clientRequestId,
              jobId: jobIds.join(','),
              reachedServer: true,
            });
            setMessages(msgs => msgs.map(m =>
              m.type === 'ai-image-generating' && m.startedAt === slotAt
                ? Object.assign({}, m, {
                    jobId: jobIds[0],
                    batchId: data.batch_id || '',
                    clientRequestId: clientRequestId,
                    status: activeSkill ? 'skill-parsed' : 'processing',
                    resolvedPrompt: data.resolved_prompt || m.resolvedPrompt,
                    promptTrace: data.prompt_trace || m.promptTrace,
                    progress: Math.max(m.progress || 0, 12),
                    refPreviews: refPreviews.length ? refPreviews : m.refPreviews,
                    images: jobIds.map(function(jid) { return { jobId: jid, status: 'processing', progress: 0 }; }),
                  })
                : m
            ));

            var terminal = {};   // jobId -> {status, url, previewUrl, error}
            var pollFails = {};  // jobId -> 连续查询失败次数
            var finished = false;

            const patchImage = function(jid, patch) {
              if (finished) return;
              setMessages(msgs => msgs.map(m => {
                if (!(m.type === 'ai-image-generating' && m.startedAt === slotAt)) return m;
                var images = (m.images || []).map(function(im) {
                  return im.jobId === jid ? Object.assign({}, im, patch) : im;
                });
                var total = 0;
                images.forEach(function(im) {
                  total += (im.status === 'done' || im.status === 'failed') ? 100 : (im.progress || 0);
                });
                var agg = images.length ? Math.floor(total / images.length) : (m.progress || 0);
                return Object.assign({}, m, {
                  images: images,
                  progress: Math.max(m.progress || 0, Math.min(agg, 99)),
                  status: m.status === 'skill-parsed' ? m.status : 'processing',
                  provider: patch.provider || m.provider,
                  providerSwitched: patch.providerSwitched || m.providerSwitched,
                });
              }));
            };

            const finishIfAllTerminal = function() {
              if (finished) return;
              if (jobIds.some(function(jid) { return !terminal[jid]; })) return;
              finished = true;
              clearInterval(pollInterval);
              const finalElapsed = Math.floor((Date.now() - slotAt) / 1000);
              var okOrdered = [];
              jobIds.forEach(function(jid, i) {
                var t = terminal[jid];
                if (t.status === 'done' && t.url) okOrdered.push({ url: t.url, index: i });
              });
              var failCount = jobIds.length - okOrdered.length;
              var firstErr = null;
              jobIds.some(function(jid) {
                var t = terminal[jid];
                if (t.status === 'failed' && t.error) { firstErr = t.error; return true; }
                return false;
              });
              var cardStatus = okOrdered.length ? 'done' : 'failed';
              setMessages(msgs => msgs.map(m =>
                m.type === 'ai-image-generating' && m.startedAt === slotAt
                  ? Object.assign({}, m, {
                      status: cardStatus,
                      progress: 100,
                      finalElapsed: finalElapsed,
                      error: cardStatus === 'failed' ? formatAiImageError(firstErr || '生图失败', jobIds[0]) : null,
                      imageUrl: okOrdered.length ? okOrdered[0].url : m.imageUrl,
                    })
                  : m
              ));
              if (failCount > 0) {
                var summary = okOrdered.length
                  ? ('本次 ' + jobIds.length + ' 张中有 ' + failCount + ' 张失败：' + formatAiImageError(firstErr || '未知原因', null))
                  : formatAiImageError(firstErr || '生图失败', jobIds[0]);
                reportAiImageClientEvent({
                  type: 'job_failed',
                  phase: 'generate',
                  clientRequestId: clientRequestId,
                  jobId: jobIds.join(','),
                  error: String(firstErr || '').slice(0, 400),
                  reachedServer: true,
                });
                alertAiImageError(summary, {
                  phaseLabel: describeAiImageFailPhase('generate'),
                  clientRequestId: clientRequestId,
                });
              }
              loadAiChatHistory();
              if (okOrdered.length && onComposeComplete) {
                onComposeComplete(null, null, okOrdered.map(function(x) { return x.url; }), null);
              }
              resolve();
            };

            const markTerminal = function(jid, t) {
              if (terminal[jid]) return;
              terminal[jid] = t;
              patchImage(jid, t.status === 'done'
                ? { status: 'done', url: t.url, previewUrl: t.previewUrl, progress: 100, provider: t.provider, providerSwitched: t.providerSwitched }
                : { status: 'failed', error: t.error, progress: 100, provider: t.provider, providerSwitched: t.providerSwitched });
              finishIfAllTerminal();
            };

            const pollInterval = setInterval(function() {
              jobIds.forEach(function(jid) {
                if (terminal[jid]) return;
                fetch(apiBase + '/ai-image/' + jid, {
                  credentials: 'include',
                  headers: { 'X-Client-Request-Id': clientRequestId },
                })
                  .then(function(r) {
                    if (!r.ok) {
                      pollFails[jid] = (pollFails[jid] || 0) + 1;
                      return r.json().catch(function() { return {}; }).then(function(errBody) {
                        var detail = (errBody && (errBody.detail || errBody.message || errBody.error)) || '';
                        if (typeof detail === 'object' && detail) detail = detail.message || JSON.stringify(detail);
                        if (isTerminalAiImagePollStatus(r.status)) {
                          markTerminal(jid, { status: 'failed', error: formatAiImageError(detail || ('查询任务状态失败 HTTP ' + r.status), jid) });
                        }
                        return null;
                      });
                    }
                    pollFails[jid] = 0;
                    return r.json();
                  })
                  .then(function(sd) {
                    if (!sd) return;
                    if (sd.status === 'done' && sd.image_url) {
                      markTerminal(jid, { status: 'done', url: sd.image_url, previewUrl: sd.preview_url || sd.image_url, provider: sd.provider, providerSwitched: sd.providerSwitched });
                    } else if (sd.status === 'done' && !sd.image_url) {
                      markTerminal(jid, { status: 'failed', error: formatAiImageError('任务标记完成但未返回图片地址', jid), provider: sd.provider, providerSwitched: sd.providerSwitched });
                    } else if (sd.status === 'failed') {
                      markTerminal(jid, { status: 'failed', error: formatAiImageError(sd.error || '生图失败', jid), provider: sd.provider, providerSwitched: sd.providerSwitched });
                    } else {
                      patchImage(jid, { progress: sd.progress || 0, provider: sd.provider, providerSwitched: sd.providerSwitched });
                    }
                  })
                  .catch(function(pollErr) {
                    pollFails[jid] = (pollFails[jid] || 0) + 1;
                    console.warn('[ai-image] batch poll error job=' + jid + ' client=' + clientRequestId, pollErr);
                  });
              });
            }, 2000);
          })
          .catch(function(err) {
            const finalElapsed = Math.floor((Date.now() - slotAt) / 1000);
            var failPhase = (err && err.phase) || (err && err.unreached ? 'network' : 'submit');
            var submitErr = formatAiImageError(
              (err && err.message) || '提交失败',
              null,
              { clientRequestId: clientRequestId, httpStatus: err && err.httpStatus }
            );
            reportAiImageClientEvent({
              type: 'submit_failed',
              phase: failPhase,
              clientRequestId: clientRequestId,
              model: model,
              provider: provider,
              httpStatus: err && err.httpStatus,
              attempt: err && err.attempt,
              unreached: !!(err && (err.unreached || isLikelyUnreachedServerError(err))),
              reachedServer: !!(err && err.httpStatus),
              error: String((err && err.message) || '').slice(0, 500),
              refCount: finalRefImages.length,
              batchCount: batchCount,
            });
            alertAiImageError(submitErr, {
              phaseLabel: describeAiImageFailPhase(failPhase),
              clientRequestId: clientRequestId,
            });
            setMessages(msgs => msgs.map(m =>
              m.type === 'ai-image-generating' && m.startedAt === slotAt
                ? Object.assign({}, m, {
                    status: 'failed',
                    failPhase: failPhase,
                    error: submitErr,
                    finalElapsed: finalElapsed,
                    clientRequestId: clientRequestId,
                  })
                : m
            ));
            resolve();
          });
      });
    };

    try {
      if (batchCount > 1) await submitBatch(slots[0]);
      else await submitOne(slots[0], 0);
    } finally {
      setIsLoading(false);
    }
  }, [currentAiChatId, enhancePromptWithProductRefs, loadAiChatHistory, loadResolvedRefFiles, onComposeComplete, parseProductRefs]);

  const handleSend = React.useCallback(async (text, refImages = [], aiOptions = {}) => {
    if (!text.trim() || isLoading) return;
    const activeSkill = String(aiOptions.skill || '').trim();
    const executionText = String(aiOptions.skillPrompt || text).trim();
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
          { who: 'user', text: text, refPreviews: userRefPreviews, refMeta: userRefMeta, activeSkill: activeSkill },
          { who: 'ai', type: 'thinking', text: '正在连接 Agent...', thinkingStatus: thinkingStatus, meta: 'Agent' },
        ]);
      });
      try {
        projectId = await ensureAgentProject();
        await window.API.streamAgentChat(projectId, executionText, {
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
                    var patch = {
                      choices: payload.type === 'ASK' ? [] : undefined,
                      quickActions: payload.type === 'CONFIRM' ? [] : undefined,
                    };
                    if (Array.isArray(opts) && opts.length > 0) {
                      patch[payload.type === 'ASK' ? 'choices' : 'quickActions'] = opts;
                    }
                    // CONFIRM 阶段附带 Creative Brief 卡片数据
                    if (payload.type === 'CONFIRM' && payload.brief) {
                      patch.brief = payload.brief;
                    }
                    if (payload.type === 'ASK' && payload.brief) {
                      patch.brief = payload.brief;
                    }
                    if (payload.contract) {
                      patch.contract = payload.contract;
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
                    prompt: payload.prompt && (payload.prompt.instruction || payload.prompt.positive) ? (payload.prompt.instruction || payload.prompt.positive) : text,
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
            if (eventName === 'generation_completed') {
              var generatedImage = payload && payload.image ? payload.image : null;
              var generatedUrl = generatedImage && generatedImage.url
                ? ((window.API_BASE || window.location.origin) + generatedImage.url)
                : '';
              setMessages(function(msgs) {
                return msgs.map(function(m, i) {
                  if (i !== imageIdx) return m;
                  return Object.assign({}, m, {
                    status: 'done',
                    imageUrl: generatedUrl || m.imageUrl || '',
                    previewUrl: generatedUrl || m.previewUrl || '',
                    progress: 100,
                    finalElapsed: m.startedAt ? Math.floor((Date.now() - m.startedAt) / 1000) : m.finalElapsed,
                    vlmPending: true,
                  });
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
                    vlmPending: false,
                    promptPayload: (payload && payload.generationInstruction)
                      ? Object.assign({}, m.promptPayload || {}, payload.generationInstruction)
                      : m.promptPayload,
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
        }, refImages, { skill: activeSkill });
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
    // 新交互: 用户通过功能按钮选择“花瓣下载”，输入框只填写 URL/ID。
    // 旧的 /花瓣下载 文本仍兼容，但不再要求用户输入斜杠指令。
    const isHuabanDownloadMode = aiOptions.workflow === 'download' || aiOptions.lockedCommand === '/花瓣下载' || trimmed.startsWith('/花瓣下载');
    if (isHuabanDownloadMode) {
      const args = trimmed.startsWith('/花瓣下载')
        ? trimmed.replace(/^\/花瓣下载\s*/, '').trim()
        : trimmed.trim();
      const match = args.match(/^(\S+)(?:\s+([A-Za-z0-9._-]+))?$/);
      setMessages(msgs => [...msgs, { who: 'user', text: args || text, refPreviews: userRefPreviews, refMeta: userRefMeta }]);
      if (!match) {
        setMessages(msgs => [...msgs, { who: 'ai', text: '请直接输入花瓣链接或项目 ID；如果素材有多个格式，我会让你点击选择。', meta: '花瓣下载' }]);
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
    const lockedAiCmd = AI_IMAGE_CMDS.find(function(c) {
      return String(aiOptions.lockedCommand || '').trim().toLowerCase() === c.prefix.toLowerCase();
    });
    const textAiCmd = AI_IMAGE_CMDS.find(function(c) {
      return text.trimStart().toLowerCase().startsWith(c.prefix.toLowerCase());
    });
    const aiCmd = lockedAiCmd
      ? Object.assign({}, lockedAiCmd, { implicit: true, fromLockedCommand: true })
      : (textAiCmd ? Object.assign({}, textAiCmd, { implicit: true, fromLockedCommand: false }) : null);

    if (activeSkill && !aiCmd && aiOptions.workflow !== 'download') {
      const skillImageOptions = Object.assign({}, aiOptions, {
        provider: 'auto',
        size: 'auto',
        resolution: aiOptions.resolution || '1K',
        batchCount: 1,
        skill: activeSkill,
      });
      setMessages(msgs => [...msgs, { who: 'user', text, refPreviews: userRefPreviews, refMeta: userRefMeta, activeSkill: activeSkill }]);
      await runAiImageGeneration('gpt-image-2', executionText, text.trim(), refImages, skillImageOptions);
      return;
    }

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
      const rawAiText = text.trim();
      const plainText = rawAiText.toLowerCase().startsWith(aiCmd.prefix.toLowerCase())
        ? rawAiText.slice(aiCmd.prefix.length).trimStart()
        : rawAiText;
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

    // ── 当前生图会话的自然语言修改 ───────────────────────────────────────────
    // 用户说“改成红色 / 背景换白色 / 更高级一点”时，必须继续走 /ai-image，
    // 后端会结合 chat_session_id 的历史 prompt，并自动把上一张结果图作为参考图。
    if (currentAiChatId && hasDoneAiImageInCurrentThread() && isLikelyAiImageFollowup(text)) {
      const lastOpts = getLastAiImageOptions();
      const model = normalizeAiImageModel(lastOpts?.model) || 'gpt-image-2';
      const opts = {
        ...aiOptions,
        size: lastOpts?.size || aiOptions.size,
        resolution: lastOpts?.resolution || aiOptions.resolution,
        provider: aiOptions.provider,
      };
      setMessages(msgs => [...msgs, { who: 'user', text, refPreviews: userRefPreviews, refMeta: userRefMeta }]);
      await runAiImageGeneration(model, text.trim(), text.trim(), refImages, opts);
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
        { who: 'user', text, refPreviews: userRefPreviews, refMeta: userRefMeta, activeSkill: activeSkill },
        { who: 'ai', type: 'thinking', text: '...' },
      ];
    });
    try {
      const reply = await window.API.chatWithAI(
        [{ role: 'user', content: executionText }],
        { skill: activeSkill }
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
  }, [agentEnabled, currentAiChatId, ensureAgentProject, enhancePromptWithProductRefs, getLastAiImageOptions, hasDoneAiImageInCurrentThread, isLikelyAiImageFollowup, isLoading, loadAiChatHistory, loadResolvedRefFiles, materializeReferenceImages, normalizeAiImageModel, onComposeComplete, parseProductRefs, runAiImageGeneration, template]);

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

  const handleSmartDistribute = React.useCallback(async (file, filename, mode) => {
    const distributeMode = mode === 'patch' ? 'patch' : 'full';
    const modeLabel = distributeMode === 'patch' ? '增量铺货' : '全量铺货';
    const pendingId = 'smart-distribute-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    setMessages(msgs => [
      ...msgs,
      { who: 'user', type: 'file-attach', text: filename, file: filename },
      { who: 'ai', type: 'smart-distribute-loading', id: pendingId, fileName: filename, meta: modeLabel, modeLabel: modeLabel, startedAt: Date.now() }
    ]);
    setIsLoading(true);
    try {
      const result = await window.API.smartDistribute(file, { mode: distributeMode });
      // 每个 job 组装独立 JSON（只包该 job），自动复制第一个
      var jobJsons = (result.jobs || []).map(function(job) {
        var source = Object.assign({}, result.source || {});
        if (job.batchType) source.batchType = job.batchType;
        if (job.batchLabel) source.batchLabel = job.batchLabel;
        var single = {
          schemaVersion: result.schemaVersion,
          mode: result.mode,
          source: source,
          defaults: result.defaults,
          summary: job.summary || {},
          jobs: [job],
        };
        var str = '';
        try { str = JSON.stringify(single, null, 2); } catch(e) { str = ''; }
        return str;
      });
      var autoCopied = false;
      if (jobJsons.length > 0 && jobJsons[0]) {
        try {
          autoCopied = await copyTextToClipboard(jobJsons[0]);
        } catch(e) {
          autoCopied = false;
        }
      }
      setMessages(msgs => msgs.map(function(m) {
        return m.id === pendingId ? {
          who: 'ai',
          type: 'smart-distribute',
          data: result,
          jobJsons: jobJsons,
          meta: '智能铺货',
          copied: autoCopied,
        } : m;
      }));
    } catch (e) {
      setMessages(msgs => msgs.map(function(m) {
        return m.id === pendingId ? { who: 'ai', text: '解析错误: ' + (e.message || '未知错误'), meta: '错误' } : m;
      }));
    }
    setIsLoading(false);
  }, [isLoading]);

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
      {state === 'empty' && messages.length > 0 && <ChatReturned messages={messages} template={template} onCompose={handleCompose} isGenerating={isLoading} user={user} greetingKey={greetingResetKey} onQuickReply={handleQuickReply} agentEnabled={agentEnabled} onPublishInspiration={handlePublishInspiration} onUnpublishInspiration={handleUnpublishInspiration}/>}
      {state === 'generating' && <ChatGenerating/>}
      {state === 'returned' && <ChatReturned messages={messages} template={template} onCompose={handleCompose} isGenerating={isLoading} user={user} greetingKey={greetingResetKey} onQuickReply={handleQuickReply} agentEnabled={agentEnabled} onPublishInspiration={handlePublishInspiration} onUnpublishInspiration={handleUnpublishInspiration}/>}

      <Composer
        onSend={handleSend}
        onParseTable={handleParseTable}
        onSmartDistribute={handleSmartDistribute}
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

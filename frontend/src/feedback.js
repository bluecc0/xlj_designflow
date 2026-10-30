// Shared by the main UI and canvas. Presentation never submits or retries a task.
(function(root) {
  'use strict';
  if (root.DesignflowFeedback) return;

  function detailOf(value) {
    if (value == null) return '';
    if (typeof value === 'object') {
      if (Array.isArray(value)) return value.map(detailOf).filter(Boolean).join('；');
      if (Array.isArray(value.loc) && value.msg) {
        var names = { prompt: '提示词', size: '尺寸', resolution: '分辨率', images: '参考图', image: '图片', username: '用户名', password: '密码' };
        return '请检查' + (names[value.loc[value.loc.length - 1]] || '输入内容') + '是否完整、有效。';
      }
      return detailOf(value.detail || value.public_message || value.message || value.error || '');
    }
    var text = String(value).trim();
    var json = text.replace(/^[\s\S]*?HTTP\s*\d+\s*:\s*/i, '');
    if (/^[{[]/.test(json)) {
      try { return detailOf(JSON.parse(json)); } catch (_) { return ''; }
    }
    return text;
  }

  function message(error, fallback) {
    var raw = detailOf(error && error.diagnostic != null ? error.diagnostic : error);
    var status = Number(error && (error.httpStatus || error.status)) || Number((raw.match(/HTTP\s*(\d+)/i) || [])[1]);
    var otherwise = fallback || '操作未完成，暂时无法确认原因，请稍后再试。';
    // These phases must never suggest another paid generation.
    if (/本地修改|尚未保存/.test(raw)) return raw.replace(/\s*[（(]\d+[）)]/g, '');
    if (/受理状态|是否受理|重复.*扣费|ambiguous/i.test(raw)) return '暂时无法确认任务是否已提交，请先查看任务记录，避免重复提交。';
    if (/已生成|已出图|图片已.*保存|结果已.*保存/.test(raw) && /失败|异常|未|耗尽/.test(raw)) return '图片已生成，结果暂未完整保存。请保留当前页面，稍后查看任务记录。';
    if (/轮询.*超时|查询.*超时|等待.*结果.*超时|任务超时/.test(raw)) return '暂时未能取得任务结果，任务可能仍在处理，请稍后查看任务记录。';
    if (/安全审核|内容审核|safety|moderation|content.?policy|nsfw/i.test(raw)) return '提示词或参考图未通过内容审核，请调整内容后再试。';
    if (/无权限或余额|余额或权限/.test(raw)) return '图片服务暂不可用，请联系管理员检查服务权限和额度。';
    if (/余额不足|额度不足|配额.*(用尽|不足)|insufficient|quota|payment|required.*billing/i.test(raw) || status === 402) return '图片服务额度不足，请联系管理员处理后再试。';
    if (/API.?KEY|密钥|token.*invalid|invalid.*token|供应商.*认证|上游.*认证/i.test(raw)) return '图片服务暂不可用，请联系管理员检查服务配置。';
    if (/用户名|密码.*错误|密码.*不正确|账号.*不存在/.test(raw)) return '用户名或密码不正确，请检查后重新输入。';
    if (status === 401 || /登录.*(失效|过期)|请先.*(登录|输入名字)/.test(raw)) return '登录已失效，请重新登录后继续，当前编辑内容会保留。';
    if (/unauthorized|服务.*未配置|未配置.*服务|未安装/i.test(raw)) return '此功能暂不可用，请联系管理员检查服务配置。';
    if (status === 413 || /too large|payload.*large/i.test(raw)) return '图片或文件过大，请减小文件后再试。';
    if (status === 429 || /rate.?limit|too many requests/i.test(raw)) return '当前使用人数较多，请稍后再试。';
    if (/Failed to fetch|NetworkError|Load failed|ECONN|ENOTFOUND|ERR_NETWORK|网络.*(异常|断开|不稳定)/i.test(raw)) return '连接暂时中断，请检查网络。已提交的任务可稍后在任务记录中查看。';
    if (/AbortError|aborted|timed out|timeout|请求超时/i.test(raw)) return '暂时没有收到响应，请稍后查看任务状态，避免重复提交。';
    if (/结果.*下载失败|下载.*结果.*失败|FinalImageDownloadError/i.test(raw)) return '图片已生成，暂时无法取回结果，请稍后查看任务记录。';
    if (status === 403) return '当前账号无法执行此操作，请联系管理员。';
    if (status === 404) return fallback || '内容已不存在或无法访问，请重新选择。';
    if (/未返回.*(任务|图片地址)|没有返回任务/.test(raw)) return '暂时无法确认任务结果，请稍后查看任务记录，避免重复提交。';
    if (/路由|线路|轮询|上游|provider|APIMart|Sub2API|Traceback|Exception|Error:|HTTP\s*\d+|JSON|Canvas|Blob|SSE|VLM|LLM|[A-Z]+_[A-Z_]{3,}|[a-z]:[\\/]|请.*(日志|控制台)|pip install|localhost|127\.0\.0\.1|https?:\/\//i.test(raw)) return otherwise;
    if (status >= 500 && !/[\u3400-\u9fff]/.test(raw)) return '服务暂时无法完成操作，请稍后再试。';
    if (/^(生成失败|生图失败|任务处理失败|操作失败|未知错误|未知原因)[。！!]?$/i.test(raw)) return otherwise;
    if (!/[\u3400-\u9fff]/.test(raw) || raw.length > 180 || /[{}<>]/.test(raw)) return otherwise;
    return raw;
  }

  function responseError(status, body) {
    var diagnostic = detailOf(body);
    var error = new Error(message({ message: diagnostic, httpStatus: status }));
    error.httpStatus = status;
    error.diagnostic = body;
    return error;
  }

  function createStore(onChange, schedule, cancel) {
    var items = [], timers = {}, seq = 0, recent = new Map();
    schedule = schedule || setTimeout;
    cancel = cancel || clearTimeout;
    function publish() { onChange(items.slice()); }
    function resolve(key) {
      if (timers[key]) cancel(timers[key]);
      delete timers[key];
      items = items.filter(function(item) { return item.key !== key; });
      publish();
    }
    function show(value, options) {
      var opts = options || {}, tone = opts.tone || 'danger';
      var text = tone === 'danger' || tone === 'warn' ? message(value, opts.fallback) : String(value || '');
      if (!text) return;
      var key = opts.key || tone + ':' + text;
      var existing = items.find(function(item) { return item.key === key; });
      // Polling the same failure must not continually extend a toast or resurrect a dismissed one.
      if (existing && existing.message === text) return key;
      if (!opts.key && recent.has(key) && Date.now() - recent.get(key) < 8000) return key;
      recent.set(key, Date.now());
      if (recent.size > 200) recent.delete(recent.keys().next().value);
      if (timers[key]) cancel(timers[key]);
      var persistent = opts.persistent == null ? tone === 'danger' && /无法确认任务|本地修改|尚未保存/.test(text) : !!opts.persistent;
      var item = { key: key, id: ++seq, message: text, tone: tone, persistent: persistent };
      items = items.filter(function(entry) { return entry.key !== key; });
      items.push(item);
      // Keep persistent conditions until resolved or explicitly dismissed.
      var transient = items.filter(function(entry) { return !entry.persistent; });
      if (transient.length > 10) resolve(transient[0].key);
      if (!item.persistent) timers[key] = schedule(function() { resolve(key); }, opts.duration || (tone === 'danger' ? 10000 : 4500));
      publish();
      return key;
    }
    return { show: show, resolve: resolve, clear: function() { Object.keys(timers).forEach(function(key) { cancel(timers[key]); }); timers = {}; items = []; recent.clear(); publish(); }, snapshot: function() { return items.slice(); } };
  }

  var host, selected, newest = 0;
  function render(items) {
    if (!root.document) return;
    if (!root.document.body) { root.document.addEventListener('DOMContentLoaded', function() { render(store.snapshot()); }, { once: true }); return; }
    if (!host) {
      host = root.document.createElement('div');
      host.id = 'designflow-feedback';
      host.setAttribute('role', 'status');
      host.setAttribute('aria-live', 'polite');
      host.setAttribute('aria-atomic', 'true');
      host.style.cssText = 'position:fixed;top:58px;left:50%;transform:translateX(-50%);z-index:2147483000;max-width:calc(100vw - 32px);width:max-content;box-sizing:border-box;display:none;align-items:center;gap:10px;padding:9px 12px;border-radius:8px;background:var(--panel,#fff);color:var(--ink,#26272b);box-shadow:0 2px 14px #00000012;font:12px/1.6 system-ui,sans-serif;';
      root.document.body.appendChild(host);
    }
    host.replaceChildren();
    host.style.display = items.length ? 'flex' : 'none';
    if (!items.length) { selected = undefined; return; }
    if (items[items.length - 1].id > newest) { newest = items[items.length - 1].id; selected = undefined; }
    var item = items.find(function(entry) { return entry.key === selected; }) || items[items.length - 1];
    selected = item.key;
    var dot = root.document.createElement('span');
    dot.setAttribute('aria-hidden', 'true');
    dot.style.cssText = 'width:5px;height:5px;border-radius:50%;flex:none;background:' + ({ danger: '#c05b4c', warn: '#b48a40', ok: '#45845a', info: '#85858e' }[item.tone] || '#85858e');
    host.appendChild(dot);
    var text = root.document.createElement('span');
    text.style.cssText = 'max-width:560px;overflow-wrap:anywhere;';
    text.textContent = item.message;
    host.appendChild(text);
    function button(label, title, action) {
      var btn = root.document.createElement('button');
      btn.type = 'button'; btn.textContent = label; btn.title = title; btn.setAttribute('aria-label', title);
      btn.style.cssText = 'border:0;background:transparent;color:#85858e;cursor:pointer;padding:2px 4px;font:inherit;flex:none;';
      btn.onclick = action;
      host.appendChild(btn);
    }
    if (items.length > 1) button((items.indexOf(item) + 1) + '/' + items.length, '查看下一条提示', function() { selected = items[(items.indexOf(item) + 1) % items.length].key; render(items); });
    button('×', '关闭提示', function() { store.resolve(item.key); });
  }

  var store = createStore(render);
  var api = {
    message: message, responseError: responseError, createStore: createStore,
    show: function(value, opts) { return target().showLocal(value, opts); },
    resolve: function(key) { target().resolveLocal(key); },
    clear: function() { target().clearLocal(); },
    showLocal: store.show, resolveLocal: store.resolve, clearLocal: store.clear,
  };
  // The canvas is same-origin. Calling the parent shares one host, including above modals.
  function target() {
    try { if (root.parent && root.parent !== root && root.parent.location.origin === root.location.origin && root.parent.DesignflowFeedback) return root.parent.DesignflowFeedback; } catch (_) {}
    return api;
  }
  root.DesignflowFeedback = api;
  root.dfToast = function(value, opts) { return api.show(value, Object.assign({ tone: 'info' }, opts || {})); };
  root.dfError = function(value, fallback, opts) { return api.show(value, Object.assign({ tone: 'danger', fallback: fallback }, opts || {})); };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

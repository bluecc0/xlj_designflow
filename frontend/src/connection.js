// One connection/session monitor shared by the workbench and its canvas iframe.
(function(root, create) {
  if (typeof module === 'object' && module.exports) module.exports = create;
  if (root) {
    root.DesignflowConnection = create(root);
    root.DesignflowConnection.install(root);
  }
})(typeof window === 'undefined' ? null : window, function(root) {
  const api = new URL(root.API_BASE || root.location.origin, root.location.origin);
  const nativeFetch = root.fetch.bind(root);
  const listeners = new Set();
  const installed = new WeakSet();
  const recoveringJobs = new Set();
  let userId = '', epoch = 0, sessionVersion = 0, authExpired = false;
  let connection = root.navigator.onLine === false ? 'offline' : 'online';
  let waiting = 0, probe = null, timer = null, restoredTimer = null;
  let snapshot = { status: connection, authExpired: false };

  function publish() {
    const status = !authExpired && ['online', 'restored'].includes(connection) && (waiting || recoveringJobs.size) ? 'recovering' : connection;
    if (snapshot.status === status && snapshot.authExpired === authExpired) return;
    snapshot = { status: status, authExpired: authExpired };
    listeners.forEach(function(listener) { listener(snapshot); });
  }

  function schedule() {
    root.clearTimeout(timer);
    if (!userId && connection === 'online') return;
    timer = root.setTimeout(check, connection === 'online' ? 15000 : 2000);
  }

  function expire() {
    if (!userId || authExpired) return;
    authExpired = true;
    publish();
    root.dispatchEvent(new root.CustomEvent('designflow-auth-required'));
  }

  function unavailable() {
    root.clearTimeout(restoredTimer);
    connection = root.navigator.onLine === false ? 'offline' : 'reconnecting';
    publish();
    schedule();
  }

  function restored() {
    const wasDisconnected = connection === 'offline' || connection === 'reconnecting';
    connection = wasDisconnected ? 'restored' : connection;
    publish();
    if (wasDisconnected) {
      root.clearTimeout(restoredTimer);
      restoredTimer = root.setTimeout(function() { connection = 'online'; publish(); }, 2000);
    }
  }

  async function check() {
    if (probe) return probe;
    if (root.navigator.onLine === false) { unavailable(); return; }
    const checkedUser = userId, checkedEpoch = epoch, checkedSession = sessionVersion;
    probe = (async function() {
      const controller = new root.AbortController();
      const timeout = root.setTimeout(function() { controller.abort(); }, 5000);
      try {
        const response = await nativeFetch(new URL('/auth/session', api).href, {
          credentials: 'include', cache: 'no-store', signal: controller.signal,
        });
        if (response.status === 401 && checkedSession === sessionVersion) { expire(); restored(); return; }
        if (!response.ok) throw new Error('Session check unavailable');
        const data = await response.json();
        if (checkedEpoch !== epoch || checkedUser !== userId || checkedSession !== sessionVersion) return;
        if (userId && (!data.user || String(data.user.id) !== userId)) expire();
        else if (userId && authExpired) {
          authExpired = false;
          root.dispatchEvent(new root.CustomEvent('designflow-auth-restored'));
        }
        restored();
      } catch (error) {
        if (checkedEpoch === epoch) unavailable();
      } finally {
        root.clearTimeout(timeout);
        probe = null;
        publish();
        schedule();
      }
    })();
    return probe;
  }

  function requestInfo(input, init) {
    try {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, root.location.href);
      const method = String((init && init.method) || input.method || 'GET').toUpperCase();
      const path = url.pathname;
      const monitored = url.origin === api.origin && /^\/(auth|ai-image|compose|special-compose(?:-full)?|editor|templates|history|parse-table|smart-distribute|chat|agent-skills|api|inspiration|products|product-library|export|psd|admin|proxy-download)(\/|$)/.test(path);
      // Only status reads of existing jobs may be retried automatically.
      const task = method === 'GET' && /^\/(ai-image|compose|special-compose(?:-full)?)\/[a-zA-Z0-9_-]+$/.test(path)
        && !/\/(config|history|detect|providers|models)$/.test(path);
      return { monitored: monitored, task: task && monitored, url: url.href, path: path, method: method };
    } catch (error) { return { monitored: false }; }
  }

  function aborted() { return new root.DOMException('请求已取消或账号已切换', 'AbortError'); }

  function pause(signal) {
    return new Promise(function(resolve, reject) {
      if (signal && signal.aborted) { reject(aborted()); return; }
      const id = root.setTimeout(finish, 1000);
      function finish() { if (signal) signal.removeEventListener('abort', cancel); resolve(); }
      function cancel() { root.clearTimeout(id); signal.removeEventListener('abort', cancel); reject(aborted()); }
      if (signal) signal.addEventListener('abort', cancel, { once: true });
    });
  }

  async function observe(response, info, requestEpoch, requestSession) {
    if (requestEpoch !== epoch) return;
    if (response.status === 401 && requestSession === sessionVersion && !info.path.startsWith('/auth/')) expire();
    if ([502, 503, 504].includes(response.status)) { unavailable(); return; }
    if (!response.ok) return;
    if (info.task || info.path === '/auth/session') {
      const data = await response.clone().json().catch(function() { return null; });
      if (requestEpoch !== epoch || !data) return;
      if (info.path === '/auth/session' && requestSession === sessionVersion && userId && (!data.user || String(data.user.id) !== userId)) expire();
      if (info.task) {
        if (!['done', 'failed'].includes(data.status) && ['recovering', 'interrupted'].includes(data.outpainting && data.outpainting.phase)) recoveringJobs.add(info.url);
        else recoveringJobs.delete(info.url);
        publish();
      }
    }
    // A successful image/config request does not prove the login session is valid.
    if (connection === 'offline' || connection === 'reconnecting') void check();
  }

  function install(target) {
    if (installed.has(target)) return;
    installed.add(target);
    const fetch = target.fetch.bind(target), pending = new Map();
    target.fetch = function(input, init) {
      const info = requestInfo(input, init);
      if (!info.monitored) return fetch(input, init);
      const requestEpoch = epoch;
      const signal = (init && init.signal) || input.signal;
      // Deduplicate overlapping interval polls while a disconnected request waits.
      const key = info.task && !signal ? info.url : null;
      if (key && pending.has(key)) return pending.get(key).then(function(response) { return response.clone(); });
      const work = (async function() {
        let recovering = false;
        const deadline = Date.now() + 300000;
        try {
          while (true) {
            if (signal && signal.aborted || requestEpoch !== epoch) throw aborted();
            if (authExpired && !['GET', 'HEAD', 'OPTIONS'].includes(info.method) && !info.path.startsWith('/auth/')) {
              return new root.Response(JSON.stringify({ detail: '登录已失效，请重新登录后继续' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
            }
            let response, failure;
            const requestSession = sessionVersion;
            try {
              if (info.task && authExpired) {
                response = new root.Response('', { status: 401 });
              } else {
                response = await fetch(input, init);
                if (requestEpoch !== epoch) throw aborted();
                await observe(response, info, requestEpoch, requestSession);
              }
            } catch (error) {
              if (error.name === 'AbortError') throw error;
              failure = error;
              unavailable();
            }
            const retry = info.task && (failure || response.status === 401 || [502, 503, 504].includes(response.status));
            if (!retry || Date.now() >= deadline) {
              if (failure) throw failure;
              return response;
            }
            if (!recovering) { recovering = true; waiting++; publish(); }
            if (!authExpired) void check();
            await pause(signal);
          }
        } finally {
          if (recovering) { waiting--; publish(); }
        }
      })();
      if (key) {
        pending.set(key, work);
        work.then(function() { pending.delete(key); }, function() { pending.delete(key); });
      }
      return work.then(function(response) { return key ? response.clone() : response; });
    };
  }

  root.addEventListener('offline', unavailable);
  root.addEventListener('online', check);
  root.addEventListener('focus', function() { if (userId) void check(); });
  root.document.addEventListener('visibilitychange', function() {
    if (!root.document.hidden && userId) void check();
  });

  return {
    install: install,
    check: check,
    getSnapshot: function() { return snapshot; },
    subscribe: function(listener) { listeners.add(listener); return function() { listeners.delete(listener); }; },
    setUser: function(user) {
      const next = user && user.id ? String(user.id) : '';
      if (next !== userId) { epoch++; recoveringJobs.clear(); }
      userId = next;
      sessionVersion++;
      authExpired = false;
      publish();
      schedule();
    },
  };
});

// App root - wires panels + tweaks + host communication

const LAST_USERNAME_KEY = 'designflow_last_username';

const LiteLoginGate = ({ onLogin, loading, error, initialName }) => {
  const [name, setName] = React.useState(initialName || '');
  const [password, setPassword] = React.useState('');

  React.useEffect(() => {
    setName(initialName || '');
  }, [initialName]);

  const submit = async () => {
    const clean = name.trim();
    if (!clean || !password.trim() || loading) return;
    await onLogin(clean, password.trim());
  };

  const [showPwd, setShowPwd] = React.useState(false);
  const canSubmit = !!name.trim() && !!password.trim() && !loading;

  return (
    <div className="lg-root">
      <style>{`
        .lg-root { position: fixed; inset: 0; z-index: 200; display: grid; place-items: center; overflow: hidden;
          font-family: 'Inter', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', system-ui, sans-serif;
          -webkit-font-smoothing: antialiased; background: var(--bg); }
        .lg-root::before { content: ''; position: absolute; inset: 0; pointer-events: none;
          background-image: radial-gradient(oklch(0.18 0.01 260 / .09) 1px, transparent 1px); background-size: 22px 22px;
          -webkit-mask-image: radial-gradient(ellipse 60% 55% at 50% 50%, #000 0%, transparent 100%);
                  mask-image: radial-gradient(ellipse 60% 55% at 50% 50%, #000 0%, transparent 100%); }
        @keyframes lg-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
        .lg-card { position: relative; width: min(400px, calc(100vw - 32px)); box-sizing: border-box; padding: 36px 32px 26px;
          border-radius: 18px; background: var(--panel); border: 1px solid var(--line);
          box-shadow: 0 1px 2px rgba(20,22,40,.04), 0 20px 48px rgba(20,22,40,.08);
          display: flex; flex-direction: column; gap: 16px; animation: lg-in .45s cubic-bezier(.2,.8,.2,1); }
        .lg-brand { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; }
        .lg-logo { width: 40px; height: 40px; border-radius: 11px; display: grid; place-items: center; color: #fff; flex: none;
          background: linear-gradient(135deg, var(--ink) 0%, oklch(0.28 0.04 275) 100%);
          box-shadow: 0 6px 16px rgba(20,22,40,.22); }
        .lg-brandname { font-size: 18px; font-weight: 600; letter-spacing: -0.01em; color: var(--ink); line-height: 1.2; }
        .lg-brandmeta { font-size: 11px; color: var(--ink-3); letter-spacing: .04em; margin-top: 2px; }
        .lg-title { font-size: 24px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.25; color: var(--ink); margin: 0; }
        .lg-sub { font-size: 13px; color: var(--ink-3); line-height: 1.6; margin-top: 6px; }
        .lg-field { position: relative; }
        .lg-input { width: 100%; box-sizing: border-box; height: 44px; border-radius: 10px; border: 1px solid var(--line);
          background: var(--panel-2); color: var(--ink); padding: 0 14px; font-size: 14px; font-family: inherit; outline: none;
          transition: border-color .15s, box-shadow .15s, background .15s; }
        .lg-input.has-eye { padding-right: 44px; }
        .lg-input::placeholder { color: var(--ink-3); }
        .lg-input:hover { border-color: oklch(0.85 0.006 260); }
        .lg-input:focus { border-color: var(--ink); background: var(--panel); box-shadow: 0 0 0 3px oklch(0.18 0.01 260 / .08); }
        .lg-eye { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); width: 32px; height: 32px; border-radius: 8px;
          display: grid; place-items: center; color: var(--ink-3); background: transparent; border: 0; cursor: pointer; }
        .lg-eye:hover { color: var(--ink); background: var(--line-2); }
        .lg-btn { height: 44px; border-radius: 10px; border: 0; color: #fff; font-size: 14px; font-weight: 600; font-family: inherit; letter-spacing: .02em;
          background: var(--ink); cursor: pointer; margin-top: 2px; transition: transform .12s, box-shadow .15s, background .15s; }
        .lg-btn:hover:not(:disabled) { background: oklch(0.26 0.02 260); transform: translateY(-1px); box-shadow: 0 8px 18px rgba(20,22,40,.2); }
        .lg-btn:active:not(:disabled) { transform: translateY(0); box-shadow: none; }
        .lg-btn:disabled { background: var(--line); color: rgba(255,255,255,.95); cursor: default; }
        .lg-err { font-size: 12.5px; color: oklch(0.5 0.17 45); background: oklch(0.97 0.03 70); border: 1px solid oklch(0.9 0.06 70);
          padding: 8px 12px; border-radius: 8px; }
        .lg-foot { text-align: center; font-size: 11.5px; color: var(--ink-3); letter-spacing: .02em; padding-top: 4px; }
      `}</style>
      <form className="lg-card" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="lg-brand">
          <div className="lg-logo">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M4 20 V6 M4 6 C10 6, 10 14, 16 14 C22 14, 22 6, 20 6"/>
            </svg>
          </div>
          <div>
            <div className="lg-brandname">XLJ Studio</div>
            <div className="lg-brandmeta">鑫乐纪AI视觉创作平台</div>
          </div>
        </div>
        <div>
          <h1 className="lg-title">欢迎回来</h1>
          <div className="lg-sub">登录后进入 AI 电商设计工作台。</div>
        </div>
        <div className="lg-field">
          <input
            className="lg-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="用户名"
            autoComplete="username"
            autoFocus
          />
        </div>
        <div className="lg-field">
          <input
            className="lg-input has-eye"
            type={showPwd ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="密码"
            autoComplete="current-password"
          />
          <button type="button" className="lg-eye" tabIndex={-1} onClick={() => setShowPwd(v => !v)} aria-label={showPwd ? '隐藏密码' : '显示密码'}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              {showPwd
                ? <><path d="M17.94 17.94A10.9 10.9 0 0 1 12 20c-7 0-11-8-11-8a19.8 19.8 0 0 1 5.06-5.94M9.9 4.24A10.9 10.9 0 0 1 12 4c7 0 11 8 11 8a19.7 19.7 0 0 1-3.17 4.19M1 1l22 22"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/></>
                : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>}
            </svg>
          </button>
        </div>
        {error && <div className="lg-err">{error}</div>}
        <button type="submit" className="lg-btn" disabled={!canSubmit}>
          {loading ? '进入中...' : '进入工作台'}
        </button>
        <div className="lg-foot">AI 驱动 · 批量生成电商海报</div>
      </form>
    </div>
  );
};

const FlipStage = ({ inspirationOpen, childrenA, childrenB }) => {
  const stageRef = React.useRef(null);
  const panelARef = React.useRef(null);
  const panelBRef = React.useRef(null);
  const currentRef = React.useRef(inspirationOpen ? 'B' : 'A');
  const isFirstMount = React.useRef(true);

  React.useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    const target = inspirationOpen ? 'B' : 'A';
    if (currentRef.current === target) return;

    const forward = target === 'B';
    const from = forward ? panelARef.current : panelBRef.current;
    const to = forward ? panelBRef.current : panelARef.current;

    const reduceMotion = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || !from || !to) {
      if (from) from.className = 'designflow-panel';
      if (to) to.className = 'designflow-panel active';
      currentRef.current = target;
      return;
    }

    if (stageRef.current) {
      stageRef.current.style.setProperty('--dir', forward ? '1' : '-1');
    }

    to.className = 'designflow-panel active entering';
    from.className = 'designflow-panel active leaving';

    const onAnimEnd = (e) => {
      if (e.target !== from) return;
      from.removeEventListener('animationend', onAnimEnd);
      from.className = 'designflow-panel';
      to.className = 'designflow-panel active';
      currentRef.current = target;
    };
    from.addEventListener('animationend', onAnimEnd);

    return () => {
      from.removeEventListener('animationend', onAnimEnd);
    };
  }, [inspirationOpen]);

  return (
    <div className="designflow-stage-wrap">
      <div className="designflow-stage" ref={stageRef}>
        <div ref={panelARef} className={`designflow-panel ${!inspirationOpen ? 'active' : ''}`}>
          {childrenA}
        </div>
        <div ref={panelBRef} className={`designflow-panel ${inspirationOpen ? 'active' : ''}`}>
          {childrenB}
        </div>
      </div>
    </div>
  );
};

const App = () => {
  const DEFAULT_TWEAKS = { chatState: 'returned', canvasState: 'candidates', theme: 'light' };
  const [tweaks, setTweaks] = React.useState(window.TWEAKS || DEFAULT_TWEAKS);
  const [tweaksVisible, setTweaksVisible] = React.useState(false);
  const [activeTemplate, setActiveTemplate] = React.useState(TEMPLATES[0]);
  const [resultTemplate, setResultTemplate] = React.useState(null);
  const [editorCommand, setEditorCommand] = React.useState(null);
  const [currentUser, setCurrentUser] = React.useState(null);
  const currentUserIdRef = React.useRef('');
  currentUserIdRef.current = currentUser && currentUser.id ? String(currentUser.id) : '';
  const [authLoading, setAuthLoading] = React.useState(true);
  const [authError, setAuthError] = React.useState('');
  const [inspirationOpen, setInspirationOpen] = React.useState(false);
  const [seedPrompt, setSeedPrompt] = React.useState('');
  const [canvasReferenceSelection, setCanvasReferenceSelection] = React.useState(null);
  const [templatePanelCollapsed, setTemplatePanelCollapsed] = React.useState(true);
  const [templateRevealHovered, setTemplateRevealHovered] = React.useState(false);
  const [whatsNewRelease, setWhatsNewRelease] = React.useState(null);
  const isFirstTemplateMountRef = React.useRef(true);

  const handleUseInspirationPrompt = React.useCallback(function(post) {
    setInspirationOpen(false);
    setSeedPrompt(post.vlm_prompt || post.resolved_prompt || post.prompt || post.original_prompt || '');
    const refUrl = post.full_image_url || post.image_url || '';
    if (refUrl) {
      setCanvasReferenceSelection({
        key: Date.now() + Math.random(),
        images: [{
          src: refUrl,
          name: 'inspiration-' + (post.id || Date.now()) + '.png',
        }],
      });
    }
  }, []);
  const handleSeedConsumed = React.useCallback(function() { setSeedPrompt(''); }, []);
  const handleUseCanvasReferences = React.useCallback(function(images) {
    if (!Array.isArray(images)) return;
    setCanvasReferenceSelection({
      key: Date.now() + Math.random(),
      images: images.slice(0, 9),
    });
  }, []);
  const [quickEditRequest, setQuickEditRequest] = React.useState(null);
  const handleQuickEditGenerate = React.useCallback(function(payload) {
    if (!payload || !payload.prompt) return;
    setQuickEditRequest({
      key: Date.now() + Math.random(),
      prompt: payload.prompt,
      image: payload.image,
    });
  }, []);

  const normalizeDesignflowAssetUrl = React.useCallback(function(rawUrl) {
    const value = String(rawUrl || '').trim();
    if (!value) return '';
    const publicPrefixes = ['/ai-images/', '/results/', '/output/', '/avatars/'];
    const isPublicPath = function(pathname) {
      return publicPrefixes.some(function(prefix) { return pathname.indexOf(prefix) === 0; })
        || /^\/compose\/[^/]+\/image\/?$/.test(pathname)
        || pathname.indexOf('/export/grid/') === 0;
    };
    try {
      const parsed = new URL(value, window.location.origin);
      if (isPublicPath(parsed.pathname)) {
        return parsed.pathname + parsed.search + parsed.hash;
      }
      return parsed.toString();
    } catch (e) {
      return value;
    }
  }, []);

  const getViewFromHash = () => (window.location.hash === '#/admin' ? 'admin' : 'workbench');
  const [currentView, setCurrentView] = React.useState(getViewFromHash);
  const navigateTo = React.useCallback(function(hash) {
    window.location.hash = hash;
  }, []);
  const [lastUsername, setLastUsername] = React.useState(() => {
    try {
      return localStorage.getItem(LAST_USERNAME_KEY) || '';
    } catch (e) {
      return '';
    }
  });
  const [reauthOpen, setReauthOpen] = React.useState(false);

  const updateTweaks = (partial) => {
    const next = { ...tweaks, ...partial };
    setTweaks(next);
    try {
      window.parent.postMessage({ type: '__edit_mode_set_keys', edits: partial }, '*');
    } catch (e) {}
  };

  const rememberUser = React.useCallback((user) => {
    const username = user && user.username ? String(user.username).trim() : '';
    setCurrentUser(user || null);
    if (!username) return;
    setLastUsername(username);
    try {
      localStorage.setItem(LAST_USERNAME_KEY, username);
    } catch (e) {}
  }, []);

  const handleComposeComplete = React.useCallback((jobId, penpotEditUrl, directImageUrls, resultTpl, sourceUserId) => {
    if (sourceUserId && currentUserIdRef.current && String(sourceUserId) !== currentUserIdRef.current) return;
    const explicitClear = !jobId && !resultTpl && Array.isArray(directImageUrls) && directImageUrls.length === 0;
    const rawItems = Array.isArray(directImageUrls) ? directImageUrls.filter(Boolean) : (directImageUrls ? [directImageUrls] : []);
    const normalizedItems = rawItems.map(function(item) {
      if (typeof item === 'string') {
        const u = normalizeDesignflowAssetUrl(item);
        return u ? { url: u } : null;
      }
      if (item && typeof item === 'object' && item.url) {
        const u = normalizeDesignflowAssetUrl(item.url);
        return u ? Object.assign({}, item, { url: u }) : null;
      }
      return null;
    }).filter(Boolean);

    const urls = (normalizedItems.length ? normalizedItems.map(function(x) { return x.url; }) : (jobId ? ['/compose/' + encodeURIComponent(jobId) + '/image'] : []))
      .map(normalizeDesignflowAssetUrl)
      .filter(Boolean);
    if (explicitClear) {
      setResultTemplate(null);
      setEditorCommand({
        key: Date.now() + Math.random(),
        type: 'new-canvas',
        pageName: activeTemplate?.name || '画板 1',
      });
      if (penpotEditUrl) {
        window.resultPenpotUrl = penpotEditUrl;
      }
      return;
    }
    if (resultTpl) {
      setResultTemplate(resultTpl);
    } else if (urls.length > 0) {
      setResultTemplate(function(prev) {
        const templateId = jobId || (prev && prev.id) || ('generated_' + Date.now());
        const sameBatch = !!(prev && prev.id && jobId && prev.id === jobId);
        const nextFrames = urls.map(function(url, i) {
          return {
            id: `${templateId}_${Date.now()}_${i}`,
            resultUrl: url,
          };
        });
        if (sameBatch && prev && Array.isArray(prev.frames)) {
          return Object.assign({}, prev, {
            frames: prev.frames.concat(nextFrames),
          });
        }
        return {
          id: templateId,
          name: '生成结果',
          frames: nextFrames,
        };
      });
    }
    if (urls.length > 0) {
      setInspirationOpen(false);
      setEditorCommand({
        key: Date.now() + Math.random(),
        type: 'insert-images',
        mode: 'image',
        urls,
        images: normalizedItems.length > 0 ? normalizedItems : urls.map(function(u) { return { url: u }; }),
        name: (resultTpl && resultTpl.name) || '生成结果',
      });
    }
    if (penpotEditUrl) {
      window.resultPenpotUrl = penpotEditUrl;
    }
  }, [activeTemplate, normalizeDesignflowAssetUrl]);

  React.useEffect(() => {
    if (isFirstTemplateMountRef.current) {
      isFirstTemplateMountRef.current = false;
      return;
    }
    setResultTemplate(null);
    setEditorCommand({
      key: Date.now() + Math.random(),
      type: 'new-canvas',
      pageName: activeTemplate?.name || '画板 1',
    });
  }, [activeTemplate]);

  React.useEffect(() => {
    const handler = (e) => {
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === '__activate_edit_mode') setTweaksVisible(true);
      if (d.type === '__deactivate_edit_mode') setTweaksVisible(false);
      if (d.type === 'designflow:auth-required') {
        window.dispatchEvent(new CustomEvent('designflow-auth-required'));
      }
    };
    window.addEventListener('message', handler);
    try {
      window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    } catch (e) {}
    return () => window.removeEventListener('message', handler);
  }, []);

  React.useEffect(() => {
    const handleAuthRequired = () => {
      setAuthLoading(false);
      setAuthError('登录状态已失效，请重新输入用户名和密码。');
      setReauthOpen(true);
    };
    window.addEventListener('designflow-auth-required', handleAuthRequired);
    return () => window.removeEventListener('designflow-auth-required', handleAuthRequired);
  }, []);

  React.useEffect(() => {
    const onHashChange = () => setCurrentView(getViewFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  React.useEffect(() => {
    let alive = true;
    window.API.getCurrentUser()
      .then(function(user) {
        if (!alive) return;
        rememberUser(user);
        setAuthError('');
      })
      .catch(function() {
        if (!alive) return;
        setCurrentUser(null);
      })
      .finally(function() {
        if (alive) setAuthLoading(false);
      });
    return () => { alive = false; };
  }, [rememberUser]);

  React.useEffect(() => {
    if (!currentUser) {
      setWhatsNewRelease(null);
      return;
    }
    let alive = true;
    const loader = window.loadWhatsNewRelease;
    if (typeof loader !== 'function') return;
    loader().then(function(release) {
      if (!alive) return;
      if (release && window.shouldShowWhatsNew && window.shouldShowWhatsNew(release)) {
        setWhatsNewRelease(release);
      } else {
        setWhatsNewRelease(null);
      }
    });
    return () => { alive = false; };
  }, [currentUser]);

  const handleLogin = React.useCallback(async (username, password) => {
    setAuthLoading(true);
    setAuthError('');
    try {
      const user = await window.API.loginLite(username, password);
      const isSameUser = currentUser && String(currentUser.id) === String(user.id);
      rememberUser(user);
      setReauthOpen(false);
      if (!isSameUser) {
        setResultTemplate(null);
        setEditorCommand(null);
      }
      setEditorCommand({
        key: Date.now() + Math.random(),
        type: 'auth-restored',
        user,
      });
    } catch (err) {
      setAuthError(err && err.message ? err.message : '进入失败，请重试');
    } finally {
      setAuthLoading(false);
    }
  }, [rememberUser, currentUser]);

  const handleSwitchUser = React.useCallback(async () => {
    try {
      await window.API.logout();
    } catch (e) {}
    setCurrentUser(null);
    setReauthOpen(false);
    setResultTemplate(null);
    setEditorCommand(null);
    setAuthError('');
  }, []);

  const selectTemplate = React.useCallback((t) => {
    if (!t) return;
    setActiveTemplate(t);
  }, []);

  const handleRequestSpecialTemplate = React.useCallback((kind) => {
    const templates = Array.isArray(window.TEMPLATES) ? window.TEMPLATES : [];
    const target = templates.find(function(t) {
      return kind === 'full' ? t.is_special_full : (t.is_special && !t.is_special_full);
    });
    if (target) {
      setActiveTemplate(target);
    }
  }, []);

  const showAdmin = currentView === 'admin' && currentUser && currentUser.role === 'admin';

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {(!currentUser || reauthOpen) && (
        <LiteLoginGate
          onLogin={handleLogin}
          loading={authLoading}
          error={authError}
          initialName={lastUsername || (currentUser ? currentUser.username : '')}
        />
      )}
      {currentUser && showAdmin && (
        <AdminPage user={currentUser} onBack={() => navigateTo('')} />
      )}
      {currentUser && !showAdmin && (
        <>
          <TopBar user={currentUser} onSwitchUser={handleSwitchUser} currentView="workbench" onNavigate={navigateTo} onOpenInspiration={function() { setInspirationOpen(function(v) { return !v; }); }} inspirationOpen={inspirationOpen} />
          <div style={{
            flex: 1,
            position: 'relative',
            display: 'grid',
            gridTemplateColumns: templatePanelCollapsed ? '0px minmax(0, 1fr) 360px' : '260px minmax(0, 1fr) 360px',
            gridTemplateRows: 'minmax(0, 1fr)',
            minHeight: 0,
            transition: 'grid-template-columns 180ms ease',
          }}>
            <TemplatePanel
              key={'templates:' + currentUser.id}
              activeId={activeTemplate ? (activeTemplate.file_id || '') + ':' + (activeTemplate.group_name || activeTemplate.id) : null}
              onSelect={selectTemplate}
              collapsed={templatePanelCollapsed}
            />
            <div
              onMouseEnter={function() { setTemplateRevealHovered(true); }}
              onMouseLeave={function() { setTemplateRevealHovered(false); }}
              style={{
                position: 'absolute',
                left: templatePanelCollapsed ? 0 : 260,
                top: 0,
                bottom: 0,
                width: 14,
                zIndex: 30,
                pointerEvents: 'auto',
                transition: 'left 180ms ease',
              }}
            >
              <button
                title={templatePanelCollapsed ? '展开模板栏' : '收起模板栏'}
                onClick={function() { setTemplatePanelCollapsed(function(v) { return !v; }); }}
                style={{
                  position: 'absolute',
                  left: 0,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 26,
                  height: 76,
                  borderRadius: '0 999px 999px 0',
                  border: '1px solid rgba(20,22,40,0.28)',
                  borderLeft: 'none',
                  background: templateRevealHovered ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.54)',
                  boxShadow: templateRevealHovered ? '0 10px 28px rgba(20,22,40,0.14), inset 1px 0 0 rgba(20,22,40,0.18)' : '0 4px 14px rgba(20,22,40,0.06)',
                  color: 'var(--ink-2)',
                  cursor: 'pointer',
                  opacity: templateRevealHovered ? 0.7 : 0,
                  transition: 'opacity 160ms ease, background 160ms ease, box-shadow 160ms ease',
                  backdropFilter: 'blur(10px)',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 18,
                  fontWeight: 500,
                  lineHeight: 1,
                }}
              >
                <span style={{ transform: 'translateX(-1px)', opacity: templateRevealHovered ? 0.9 : 0.55 }}>{templatePanelCollapsed ? '›' : '‹'}</span>
              </button>
            </div>
            <FlipStage
              inspirationOpen={inspirationOpen}
              childrenA={
                <Canvas
                  key={'canvas:' + currentUser.id}
                  template={activeTemplate}
                  resultTemplate={resultTemplate}
                  editorCommand={editorCommand}
                  onUseReferenceImages={handleUseCanvasReferences}
                  onQuickEditGenerate={handleQuickEditGenerate}
                  userId={currentUser.id}
                />
              }
              childrenB={
                <InspirationPanel
                  open={inspirationOpen}
                  onClose={function() { setInspirationOpen(false); }}
                  onUsePrompt={handleUseInspirationPrompt}
                />
              }
            />
            <Chat
              key={'chat:' + currentUser.id}
              state={tweaks.chatState}
              template={activeTemplate}
              onComposeComplete={function(jobId, penpotEditUrl, directImageUrls, resultTpl) {
                handleComposeComplete(jobId, penpotEditUrl, directImageUrls, resultTpl, currentUser.id);
              }}
              user={currentUser}
              onRequestSpecialTemplate={handleRequestSpecialTemplate}
              seedPrompt={seedPrompt}
              onSeedConsumed={handleSeedConsumed}
              canvasReferenceSelection={canvasReferenceSelection}
              quickEditRequest={quickEditRequest}
            />
          </div>
          <Tweaks
            visible={tweaksVisible}
            tweaks={tweaks}
            onChange={updateTweaks}
            onClose={() => setTweaksVisible(false)}
          />
        </>
      )}
      {currentUser && whatsNewRelease && window.WhatsNewModal && React.createElement(window.WhatsNewModal, {
        release: whatsNewRelease,
        onClose: function() { setWhatsNewRelease(null); },
      })}
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);

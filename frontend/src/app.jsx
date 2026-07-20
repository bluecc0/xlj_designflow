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

  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    borderRadius: 8, border: '1px solid var(--line)',
    background: 'var(--panel-2)', color: 'var(--ink)',
    padding: '10px 12px', fontSize: 13, outline: 'none',
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      display: 'grid', placeItems: 'center',
      background: 'rgba(245, 245, 248, 0.78)',
      backdropFilter: 'blur(6px)',
    }}>
      <div style={{
        width: 'min(360px, calc(100vw - 32px))',
        padding: 20, borderRadius: 10,
        background: 'var(--panel)', border: '1px solid var(--line)',
        boxShadow: '0 10px 30px rgba(0,0,0,0.08)',
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="serif" style={{ fontSize: 21, color: 'var(--ink)' }}>进入 Designflow</div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
            请输入用户名和密码登录。
          </div>
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="用户名"
          autoFocus
          style={inputStyle}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="密码"
          style={inputStyle}
        />
        {error && <div style={{ fontSize: 11.5, color: 'var(--warn)' }}>{error}</div>}
        <button
          onClick={submit}
          disabled={!name.trim() || !password.trim() || loading}
          style={{
            height: 36, borderRadius: 8,
            background: !name.trim() || !password.trim() || loading ? 'var(--line)' : 'var(--ink)',
            color: 'white', fontSize: 12.5, fontWeight: 500,
            cursor: !name.trim() || !password.trim() || loading ? 'default' : 'pointer',
          }}
        >
          {loading ? '进入中...' : '进入工作台'}
        </button>
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
  const [slashTrigger, setSlashTrigger] = React.useState(null);
  const [currentUser, setCurrentUser] = React.useState(null);
  const [authLoading, setAuthLoading] = React.useState(true);
  const [authError, setAuthError] = React.useState('');
  const [inspirationOpen, setInspirationOpen] = React.useState(false);
  const [seedPrompt, setSeedPrompt] = React.useState('');
  const [canvasReferenceSelection, setCanvasReferenceSelection] = React.useState(null);
  const [templatePanelCollapsed, setTemplatePanelCollapsed] = React.useState(true);
  const [templateRevealHovered, setTemplateRevealHovered] = React.useState(false);

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

  const handleComposeComplete = React.useCallback((jobId, penpotEditUrl, directImageUrls, resultTpl) => {
    const explicitClear = !jobId && !resultTpl && Array.isArray(directImageUrls) && directImageUrls.length === 0;
    const rawUrls = Array.isArray(directImageUrls) ? directImageUrls.filter(Boolean) : (directImageUrls ? [directImageUrls] : []);
    const urls = (rawUrls.length ? rawUrls : (jobId ? ['/compose/' + encodeURIComponent(jobId) + '/image'] : []))
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
      setEditorCommand({
        key: Date.now() + Math.random(),
        type: 'insert-images',
        mode: 'image',
        urls,
        name: (resultTpl && resultTpl.name) || '生成结果',
      });
    }
    if (penpotEditUrl) {
      window.resultPenpotUrl = penpotEditUrl;
    }
  }, [activeTemplate, normalizeDesignflowAssetUrl]);

  React.useEffect(() => {
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
    };
    window.addEventListener('message', handler);
    try {
      window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    } catch (e) {}
    return () => window.removeEventListener('message', handler);
  }, []);

  React.useEffect(() => {
    const handleAuthRequired = () => {
      setCurrentUser(null);
      setResultTemplate(null);
      setAuthLoading(false);
      setAuthError('登录状态已失效，请重新输入用户名和密码。');
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

  const handleLogin = React.useCallback(async (username, password) => {
    setAuthLoading(true);
    setAuthError('');
    try {
      const user = await window.API.loginLite(username, password);
      rememberUser(user);
      setResultTemplate(null);
    } catch (err) {
      setAuthError(err && err.message ? err.message : '进入失败，请重试');
    } finally {
      setAuthLoading(false);
    }
  }, [rememberUser]);

  const handleSwitchUser = React.useCallback(async () => {
    try {
      await window.API.logout();
    } catch (e) {}
    setCurrentUser(null);
    setResultTemplate(null);
    setAuthError('');
  }, []);

  const selectTemplate = React.useCallback((t) => {
    if (!t) return;
    setActiveTemplate(t);
    if (t.is_special_full) setSlashTrigger({ cmd: '特殊品（完整）', key: Date.now() });
    else if (t.is_special) setSlashTrigger({ cmd: '特殊品', key: Date.now() });
    else setSlashTrigger({ clear: true, key: Date.now() });
  }, []);

  const handleRequestSpecialTemplate = React.useCallback((kind) => {
    const templates = Array.isArray(window.TEMPLATES) ? window.TEMPLATES : [];
    const target = templates.find(function(t) {
      return kind === 'full' ? t.is_special_full : (t.is_special && !t.is_special_full);
    });
    if (target) selectTemplate(target);
  }, [selectTemplate]);

  const showAdmin = currentView === 'admin' && currentUser && currentUser.role === 'admin';

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {!currentUser && (
        <LiteLoginGate
          onLogin={handleLogin}
          loading={authLoading}
          error={authError}
          initialName={lastUsername}
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
            <Canvas
              template={activeTemplate}
              resultTemplate={resultTemplate}
              editorCommand={editorCommand}
              onUseReferenceImages={handleUseCanvasReferences}
            />
            <Chat
              key={'chat:' + currentUser.id}
              state={tweaks.chatState}
              template={activeTemplate}
              onComposeComplete={handleComposeComplete}
              slashTrigger={slashTrigger}
              user={currentUser}
              onRequestSpecialTemplate={handleRequestSpecialTemplate}
              seedPrompt={seedPrompt}
              onSeedConsumed={handleSeedConsumed}
              canvasReferenceSelection={canvasReferenceSelection}
            />
          </div>
          {inspirationOpen && (
            <InspirationPanel
              onClose={function() { setInspirationOpen(false); }}
              onUsePrompt={handleUseInspirationPrompt}
            />
          )}
          <Tweaks
            visible={tweaksVisible}
            tweaks={tweaks}
            onChange={updateTweaks}
            onClose={() => setTweaksVisible(false)}
          />
        </>
      )}
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);

// App root - wires panels + tweaks + host communication

const LAST_USERNAME_KEY = 'designflow_last_username';

const LiteLoginGate = ({ onLogin, loading, error, initialName }) => {
  const [name, setName] = React.useState(initialName || '');

  React.useEffect(() => {
    setName(initialName || '');
  }, [initialName]);

  const submit = async () => {
    const clean = name.trim();
    if (!clean || loading) return;
    await onLogin(clean);
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
            请输入用户名登录。
          </div>
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="请输入身份名称"
          autoFocus
          style={{
            width: '100%', boxSizing: 'border-box',
            borderRadius: 8, border: '1px solid var(--line)',
            background: 'var(--panel-2)', color: 'var(--ink)',
            padding: '10px 12px', fontSize: 13, outline: 'none',
          }}
        />
        {error && <div style={{ fontSize: 11.5, color: 'var(--warn)' }}>{error}</div>}
        <button
          onClick={submit}
          disabled={!name.trim() || loading}
          style={{
            height: 36, borderRadius: 8,
            background: !name.trim() || loading ? 'var(--line)' : 'var(--ink)',
            color: 'white', fontSize: 12.5, fontWeight: 500,
            cursor: !name.trim() || loading ? 'default' : 'pointer',
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
    } else if (jobId && directImageUrls) {
      const tpl = {
        id: jobId,
        name: '生成结果',
        frames: Array.isArray(directImageUrls)
          ? directImageUrls.map((url, i) => ({ id: `${jobId}_${i}`, resultUrl: url }))
          : [{ id: jobId, resultUrl: directImageUrls }],
      };
      setResultTemplate(tpl);
    }
    const urls = Array.isArray(directImageUrls) ? directImageUrls.filter(Boolean) : (directImageUrls ? [directImageUrls] : []);
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
  }, [activeTemplate]);

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
      setAuthError('登录状态已失效，请重新输入身份名称。');
    };
    window.addEventListener('designflow-auth-required', handleAuthRequired);
    return () => window.removeEventListener('designflow-auth-required', handleAuthRequired);
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

  const handleLogin = React.useCallback(async (username) => {
    setAuthLoading(true);
    setAuthError('');
    try {
      const user = await window.API.loginLite(username);
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

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <TopBar user={currentUser} onSwitchUser={handleSwitchUser}/>
      {currentUser && (
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '260px minmax(0, 1fr) 360px', gridTemplateRows: 'minmax(0, 1fr)', minHeight: 0 }}>
          <TemplatePanel
            key={'templates:' + currentUser.id}
            activeId={activeTemplate ? (activeTemplate.file_id || '') + ':' + (activeTemplate.group_name || activeTemplate.id) : null}
            onSelect={(t) => {
              setActiveTemplate(t);
              if (t.is_special_full) setSlashTrigger({ cmd: '特殊品（完整）', key: Date.now() });
              else if (t.is_special) setSlashTrigger({ cmd: '特殊品', key: Date.now() });
              else setSlashTrigger({ clear: true, key: Date.now() });
            }}
          />
          <Canvas template={activeTemplate} resultTemplate={resultTemplate} editorCommand={editorCommand}/>
          <Chat
            key={'chat:' + currentUser.id}
            state={tweaks.chatState}
            template={activeTemplate}
            onComposeComplete={handleComposeComplete}
            slashTrigger={slashTrigger}
            user={currentUser}
          />
        </div>
      )}
      <Tweaks
        visible={tweaksVisible}
        tweaks={tweaks}
        onChange={updateTweaks}
        onClose={() => setTweaksVisible(false)}
      />
      {!currentUser && (
        <LiteLoginGate
          onLogin={handleLogin}
          loading={authLoading}
          error={authError}
          initialName={lastUsername}
        />
      )}
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);

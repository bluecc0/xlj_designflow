// App root — wires panels + tweaks + host communication

const App = () => {
  const DEFAULT_TWEAKS = { chatState: 'returned', canvasState: 'candidates', theme: 'light' };
  const [tweaks, setTweaks] = React.useState(window.TWEAKS || DEFAULT_TWEAKS);
  const [tweaksVisible, setTweaksVisible] = React.useState(false);
  const [activeTemplate, setActiveTemplate] = React.useState(TEMPLATES[0]);
  const [resultTemplate, setResultTemplate] = React.useState(null); // null=无结果, object=结果模板（frames含结果URL）
  // slashTrigger: 选中特殊品模板时触发，key 每次变化确保 effect 重新执行
  const [slashTrigger, setSlashTrigger] = React.useState(null);

  const updateTweaks = (partial) => {
    const next = { ...tweaks, ...partial };
    setTweaks(next);
    try {
      window.parent.postMessage({ type: '__edit_mode_set_keys', edits: partial }, '*');
    } catch (e) {}
  };

  // resultTemplate 格式: { ...template, frames: [{...frame, resultUrl: string}] }
  // Chat.jsx 源头已做 structuredClone 深拷贝，原始 template 不受影响
  const handleComposeComplete = React.useCallback((jobId, penpotEditUrl, directImageUrls, resultTpl) => {
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
    if (penpotEditUrl) {
      window.resultPenpotUrl = penpotEditUrl;
    }
  }, []);

  // activeTemplate 变化时清除上一次合成结果，避免旧结果占用 canvas
  React.useEffect(() => {
    setResultTemplate(null);
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

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <TopBar/>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '260px 1fr 360px', gridTemplateRows: 'minmax(0, 1fr)', minHeight: 0 }}>
        <TemplatePanel activeId={activeTemplate?.group_name || activeTemplate?.id} onSelect={(t) => {
          setActiveTemplate(t);
          if (t.is_special) setSlashTrigger({ cmd: '特殊品', key: Date.now() });
        }}/>
        <Canvas template={activeTemplate} resultTemplate={resultTemplate}/>
        <Chat state={tweaks.chatState} template={activeTemplate} onComposeComplete={handleComposeComplete} slashTrigger={slashTrigger}/>
      </div>
      <Tweaks
        visible={tweaksVisible}
        tweaks={tweaks}
        onChange={updateTweaks}
        onClose={() => setTweaksVisible(false)}
      />
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);

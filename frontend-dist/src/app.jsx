// App root — wires panels + tweaks + host communication

const App = () => {
  const DEFAULT_TWEAKS = { chatState: 'returned', canvasState: 'candidates', theme: 'light' };
  const [tweaks, setTweaks] = React.useState(window.TWEAKS || DEFAULT_TWEAKS);
  const [tweaksVisible, setTweaksVisible] = React.useState(false);
  const [activeTemplate, setActiveTemplate] = React.useState(TEMPLATES[0]);

  const updateTweaks = (partial) => {
    const next = { ...tweaks, ...partial };
    setTweaks(next);
    try {
      window.parent.postMessage({ type: '__edit_mode_set_keys', edits: partial }, '*');
    } catch (e) {}
  };

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
        <TemplatePanel activeId={activeTemplate?.id} onSelect={setActiveTemplate}/>
        <Canvas template={activeTemplate}/>
        <Chat state={tweaks.chatState}/>
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

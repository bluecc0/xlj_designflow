// App root — wires panels together, shares job/result state between Canvas and Chat

const App = () => {
  const [activeTemplate, setActiveTemplate] = React.useState(null);
  const [currentJob, setCurrentJob] = React.useState(null);
  const [resultImageUrl, setResultImageUrl] = React.useState(null);

  // When template changes, reset job + result
  const handleSelectTemplate = (t) => {
    setActiveTemplate(t);
    setCurrentJob(null);
    setResultImageUrl(null);
  };

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <TopBar/>
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: '260px 1fr 360px',
        gridTemplateRows: 'minmax(0, 1fr)',
        minHeight: 0,
      }}>
        <TemplatePanel
          activeId={activeTemplate?.id}
          onSelect={handleSelectTemplate}
        />
        <Canvas
          template={activeTemplate}
          job={currentJob}
          resultImageUrl={resultImageUrl}
          onJobUpdate={setCurrentJob}
        />
        <Chat
          template={activeTemplate}
          onJobUpdate={(job) => {
            setCurrentJob(job);
            if (job?.status === 'done') {
              setResultImageUrl(API.getImageUrl(job.id));
            }
          }}
          onResultUrl={setResultImageUrl}
        />
      </div>
    </div>
  );
};

document.addEventListener('DOMContentLoaded', () => {
  ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
});

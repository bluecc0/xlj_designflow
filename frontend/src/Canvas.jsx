// Main canvas — hosts the editor-canvas iframe and relays commands to it.

const Canvas = ({ template, resultTemplate, editorCommand, onUseReferenceImages, onQuickEditGenerate, userId }) => {
  const t = template;
  const hasResult = resultTemplate != null;
  const iframeRef = React.useRef(null);
  const editorReadyRef = React.useRef(false);
  const pendingMessagesRef = React.useRef([]);
  const [iframeNonce, setIframeNonce] = React.useState(0);
  const [editorInsertState, setEditorInsertState] = React.useState(null);

  React.useEffect(() => {
    if (editorInsertState?.status === 'failed') window.dfError(editorInsertState.message, '图片未能放入画布，请重新选择后再试。');
  }, [editorInsertState]);

  // 清除 URL 中的历史遗留参数与 localStorage 残留
  React.useEffect(() => {
    try {
      localStorage.removeItem('designflow_canvas_engine');
      const url = new URL(window.location.href);
      if (url.searchParams.has('canvas')) {
        url.searchParams.delete('canvas');
        const cleanPath = url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : '') + url.hash;
        window.history.replaceState({}, '', cleanPath);
      }
    } catch (e) {}
  }, []);

  const editorSrc = React.useMemo(() => {
    const params = new URLSearchParams({ v: String(Date.now()) });
    if (userId) params.set('user_id', String(userId));
    return `/editor-canvas/index.html?${params.toString()}`;
  }, [userId]);

  const postToEditor = React.useCallback((message) => {
    const win = iframeRef.current && iframeRef.current.contentWindow;
    if (!win) return false;
    win.postMessage(message, '*');
    return true;
  }, []);

  const markEditorReady = React.useCallback(() => {
    editorReadyRef.current = true;
    if (pendingMessagesRef.current && pendingMessagesRef.current.length > 0) {
      pendingMessagesRef.current.forEach((msg) => {
        postToEditor(msg);
      });
      pendingMessagesRef.current = [];
    }
  }, [postToEditor]);

  // 接收编辑器的 ready 信号，用于命令就绪判定（不控制 UI 可见性）
  React.useEffect(() => {
    const handleMessage = (event) => {
      if (event.origin !== window.location.origin || event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'designflow:editor-ready') {
        markEditorReady();
      } else if (data.type === 'designflow:auth-required') {
        window.dispatchEvent(new CustomEvent('designflow-auth-required'));
      } else if (data.type === 'designflow:editor-inserted') {
        setEditorInsertState({ status: 'done', message: '已放入画布' });
      } else if (data.type === 'designflow:editor-error') {
        setEditorInsertState({ status: 'failed', message: data.message || '放入画布失败' });
      } else if (data.type === 'designflow:use-as-reference') {
        const images = Array.isArray(data.images) ? data.images.filter(function(item) {
          return item && typeof item.src === 'string' && item.src.trim();
        }) : [];
        if (onUseReferenceImages) {
          onUseReferenceImages(images);
        }
      } else if (data.type === 'designflow:quick-edit-generate') {
        if (onQuickEditGenerate) {
          onQuickEditGenerate(data);
        }
      }
    };
    window.addEventListener('message', handleMessage);

    // 主动 ping iframe，解决缓存加载时序导致的 ready 消息丢失
    let pingCount = 0;
    const ping = () => {
      pingCount++;
      postToEditor({ type: 'designflow:ping' });
      if (pingCount < 30 && !editorReadyRef.current) {
        setTimeout(ping, 400);
      }
    };
    setTimeout(ping, 200);

    return () => window.removeEventListener('message', handleMessage);
  }, [markEditorReady, onUseReferenceImages, onQuickEditGenerate, postToEditor]);

  // 宿主全局快捷键穿透中继（当焦点不在输入框时，透传 Cmd/Ctrl+Z 撤销与重做到画布）
  React.useEffect(() => {
    const handleHostKeyDown = (e) => {
      const activeTag = document.activeElement ? document.activeElement.tagName : '';
      const isInput = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || (document.activeElement && document.activeElement.isContentEditable);
      if (isInput) return;

      const isMetaOrCtrl = e.metaKey || e.ctrlKey;
      if (isMetaOrCtrl && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        postToEditor({ type: 'designflow:undo' });
      } else if (
        isMetaOrCtrl &&
        ((e.shiftKey && (e.key === 'z' || e.key === 'Z')) || e.key === 'y' || e.key === 'Y')
      ) {
        e.preventDefault();
        postToEditor({ type: 'designflow:redo' });
      }
    };
    window.addEventListener('keydown', handleHostKeyDown);
    return () => window.removeEventListener('keydown', handleHostKeyDown);
  }, [postToEditor]);

  React.useEffect(() => {
    editorReadyRef.current = false;
  }, [iframeNonce]);

  React.useEffect(() => {
    if (!editorCommand) return;
    const normalizeAssetUrl = (rawUrl) => {
      const value = String(rawUrl || '').trim();
      if (!value) return '';
      const publicPrefixes = ['/ai-images/', '/results/', '/output/', '/avatars/'];
      const isPublicPath = (pathname) => publicPrefixes.some(prefix => pathname.startsWith(prefix))
        || /^\/compose\/[^/]+\/image\/?$/.test(pathname)
        || pathname.startsWith('/export/grid/');
      try {
        const parsed = new URL(value, window.location.origin);
        if (isPublicPath(parsed.pathname)) {
          return parsed.pathname + parsed.search + parsed.hash;
        }
        return parsed.toString();
      } catch (e) {
        return value;
      }
    };
    let message = null;
    if (editorCommand.type === 'insert-images') {
      message = {
        type: 'designflow:insert-image',
        urls: (editorCommand.urls || []).map(normalizeAssetUrl).filter(Boolean),
        images: (editorCommand.images || []).map(function(img) {
          if (typeof img === 'object' && img !== null && img.url) {
            return Object.assign({}, img, { url: normalizeAssetUrl(img.url) });
          }
          return { url: normalizeAssetUrl(img) };
        }).filter(function(x) { return Boolean(x.url); }),
        mode: editorCommand.mode,
        name: editorCommand.name,
      };
      setEditorInsertState({ status: 'running', message: '正在放入画布' });
    } else if (editorCommand.type === 'auth-restored') {
      message = {
        type: 'designflow:auth-restored',
        user: editorCommand.user,
      };
    } else if (editorCommand.type === 'new-canvas') {
      message = {
        type: 'designflow:new-canvas',
        pageName: editorCommand.pageName || t?.name || '画板 1',
      };
    }

    if (editorReadyRef.current) {
      postToEditor(message);
    } else {
      pendingMessagesRef.current.push(message);
      postToEditor({ type: 'designflow:ping' });
    }

    if (editorCommand.type === 'insert-images') {
      const timer = setTimeout(() => {
        setEditorInsertState((prev) => {
          if (!prev || prev.status !== 'running') return prev;
          return { status: 'failed', message: '图片暂未放入画布，请检查当前画布，稍后再试。' };
        });
      }, 60000);
      return () => clearTimeout(timer);
    }
  }, [editorCommand, postToEditor, t]);

  return (
    <div
      id="designflow-canvas-container"
      style={{
        position: 'relative',
        minWidth: 0,
        minHeight: 0,
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: 'oklch(0.98 0.003 260)',
      }}
    >
      <iframe
        key={iframeNonce}
        ref={iframeRef}
        src={editorSrc}
        title="Designflow Editor"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          border: 'none',
          background: 'transparent',
        }}
      />
    </div>
  );
};

window.Canvas = Canvas;

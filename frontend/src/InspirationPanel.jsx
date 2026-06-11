// 灵感面板：覆盖在画布区域的浮层
// 布局：顶部栏（tab + 搜索 + 关闭） + 主体瀑布流（4 列） + 详情抽屉（点击图片展开）

const COLUMN_COUNT_DESKTOP = 4;
const COLUMN_GAP = 12;
const COLUMN_MIN_WIDTH = 200;

const InspirationPanel = ({ onClose, onUsePrompt }) => {
  const [tab, setTab] = React.useState('all'); // 'all' | 'mine'
  const [search, setSearch] = React.useState('');
  const [posts, setPosts] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [detailPost, setDetailPost] = React.useState(null);
  const [canvasRect, setCanvasRect] = React.useState(null);
  const [ratios, setRatios] = React.useState({}); // postId -> width/height
  const containerRef = React.useRef(null);
  const [containerWidth, setContainerWidth] = React.useState(0);
  const loadIdRef = React.useRef(0);

  // 跟踪画布位置，让浮层只覆盖画布区
  React.useEffect(function() {
    const iframe = document.querySelector('iframe[src*="editor-beta"]');
    if (!iframe) return;
    const update = function() {
      const r = iframe.getBoundingClientRect();
      setCanvasRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(iframe);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return function() {
      ro.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, []);

  // 跟踪主区域宽度
  React.useEffect(function() {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(function(entries) {
      for (const e of entries) setContainerWidth(e.contentRect.width);
    });
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return function() { ro.disconnect(); };
  }, []);

  // 加载列表
  const loadPosts = React.useCallback(function() {
    const myLoadId = ++loadIdRef.current;
    setLoading(true);
    setError(null);
    window.API.listInspiration(50, 0, tab === 'mine')
      .then(function(rows) {
        if (myLoadId !== loadIdRef.current) return;
        setPosts(rows || []);
      })
      .catch(function(e) {
        if (myLoadId !== loadIdRef.current) return;
        setError(e.message || '加载失败');
        setPosts([]);
      })
      .finally(function() {
        if (myLoadId === loadIdRef.current) setLoading(false);
      });
  }, [tab]);

  React.useEffect(function() { loadPosts(); }, [loadPosts]);

  // 搜索过滤
  const setRatio = React.useCallback(function(postId, ratio) {
    setRatios(function(prev) {
      if (prev[postId] === ratio) return prev;
      return Object.assign({}, prev, { [postId]: ratio });
    });
  }, []);

  const filtered = React.useMemo(function() {
    if (!search.trim()) return posts;
    const q = search.trim().toLowerCase();
    return posts.filter(function(p) {
      return (p.prompt || '').toLowerCase().includes(q);
    });
  }, [posts, search]);

  // 瀑布流分列（按图片宽高比，优先后端返回的尺寸）
  const waterFallCols = React.useMemo(function() {
    const colCount = containerWidth
      ? Math.max(1, Math.min(COLUMN_COUNT_DESKTOP,
          Math.floor((containerWidth + COLUMN_GAP) / (COLUMN_MIN_WIDTH + COLUMN_GAP))))
      : COLUMN_COUNT_DESKTOP;
    const colWidth = containerWidth
      ? Math.floor((containerWidth - COLUMN_GAP * (colCount - 1)) / colCount)
      : 0;
    const cols = Array.from({ length: colCount }, function() { return { items: [], height: 0 }; });
    filtered.forEach(function(post) {
      const ratio = (post.width && post.height) ? post.width / post.height : (ratios[post.id] || 1);
      const itemHeight = colWidth > 0 ? colWidth / ratio : colWidth;
      let minIdx = 0;
      for (let i = 1; i < colCount; i++) {
        if (cols[i].height < cols[minIdx].height) minIdx = i;
      }
      cols[minIdx].items.push({ post: post, height: itemHeight });
      cols[minIdx].height += itemHeight + COLUMN_GAP;
    });
    return { colCount: colCount, cols: cols };
  }, [filtered, containerWidth, ratios]);

  // 关闭详情
  const closeDetail = React.useCallback(function() { setDetailPost(null); }, []);

  // 下架自己的
  const handleUnpublish = React.useCallback(function(post) {
    if (!window.confirm('下架这条灵感？')) return;
    window.API.unpublishInspiration(post.id)
      .then(function() {
        setPosts(function(prev) { return prev.filter(function(p) { return p.id !== post.id; }); });
        if (detailPost && detailPost.id === post.id) closeDetail();
      })
      .catch(function(e) {
        window.alert('下架失败：' + (e.message || '未知错误'));
      });
  }, [detailPost, closeDetail]);

  // 点击图片 → 加载完整详情
  const openDetail = React.useCallback(function(post) {
    window.API.getInspiration(post.id)
      .then(function(full) { setDetailPost(full || post); })
      .catch(function() { setDetailPost(post); });
  }, []);

  return (
    <div style={{
      position: 'fixed',
      top: canvasRect ? canvasRect.top : 0,
      left: canvasRect ? canvasRect.left : 0,
      width: canvasRect ? canvasRect.width : '100vw',
      height: canvasRect ? canvasRect.height : '100vh',
      zIndex: 50,
      background: 'var(--panel-2)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* 顶部栏 */}
      <div style={{
        height: 44, flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '0 16px',
        background: 'var(--panel)',
        borderBottom: '1px solid var(--line)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500 }}>
          <I.sparkles size={13} style={{ color: 'var(--accent)' }}/>
          灵感
        </div>
        <div style={{ display: 'flex', gap: 2, marginLeft: 8 }}>
          {[
            { id: 'all', label: '全部' },
            { id: 'mine', label: '我发布的' },
          ].map(function(t) {
            const active = tab === t.id;
            return React.createElement('button', {
              key: t.id,
              onClick: function() { setTab(t.id); },
              style: {
                height: 28, padding: '0 12px',
                borderRadius: 6, border: 'none',
                background: active ? 'var(--panel-2)' : 'transparent',
                color: active ? 'var(--ink)' : 'var(--ink-2)',
                fontSize: 11.5, fontWeight: active ? 600 : 400,
                cursor: 'pointer',
              }
            }, t.label);
          })}
        </div>
        <div style={{ flex: 1 }}/>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 10px', borderRadius: 6,
          background: 'var(--panel-2)', border: '1px solid var(--line-2)',
          width: 220,
        }}>
          <I.search size={12} style={{ color: 'var(--ink-3)' }}/>
          <input
            value={search}
            placeholder="搜索 prompt 关键词…"
            style={{
              flex: 1, border: 'none', outline: 'none',
              background: 'transparent', fontSize: 11.5, color: 'var(--ink)',
            }}
            onChange={function(e) { setSearch(e.target.value); }}
          />
        </div>
        <button
          onClick={function() { loadPosts(); }}
          title="刷新"
          style={{
            width: 28, height: 28, borderRadius: 6,
            background: 'var(--panel-2)', border: '1px solid var(--line-2)',
            color: 'var(--ink-2)', display: 'grid', placeItems: 'center', cursor: 'pointer',
          }}
        >
          <I.refresh size={12}/>
        </button>
        <button
          onClick={onClose}
          title="关闭灵感"
          style={{
            width: 28, height: 28, borderRadius: 6,
            background: 'var(--panel-2)', border: '1px solid var(--line-2)',
            color: 'var(--ink-2)', display: 'grid', placeItems: 'center', cursor: 'pointer',
          }}
        >
          <I.close size={12}/>
        </button>
      </div>

      {/* 主体 */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16 }}>
        {error && (
          <div style={{ padding: 12, color: 'var(--warn)', fontSize: 12 }}>加载失败：{error}</div>
        )}
        {!error && loading && filtered.length === 0 && (
          <div style={{ padding: 24, color: 'var(--ink-3)', fontSize: 12, textAlign: 'center' }}>加载中…</div>
        )}
        {!error && !loading && filtered.length === 0 && (
          <div style={{ padding: 40, color: 'var(--ink-3)', fontSize: 12, textAlign: 'center' }}>
            {tab === 'mine' ? '你还没有发布过灵感' : '还没有灵感，去生张图试试吧'}
          </div>
        )}
        {filtered.length > 0 && (() => {
          // cols 已经在 useMemo 中算好
          return React.createElement('div', {
            style: {
              display: 'grid',
              gridTemplateColumns: 'repeat(' + waterFallCols.colCount + ', minmax(0, 1fr))',
              gap: COLUMN_GAP,
              alignItems: 'flex-start',
            }
          }, waterFallCols.cols.map(function(col, ci) {
            return React.createElement('div', {
              key: ci,
              style: { display: 'flex', flexDirection: 'column', gap: COLUMN_GAP, minWidth: 0 }
            }, col.items.map(function(item) {
              return React.createElement(InspirationCard, {
                key: item.post.id, post: item.post,
                height: item.height,
                onRatioLoad: setRatio,
                onOpen: function() { openDetail(item.post); },
              });
            }));
          }));
        })()}
      </div>

      {/* 详情抽屉 */}
      {detailPost && (
        <InspirationDetail
          post={detailPost}
          onClose={closeDetail}
          onUsePrompt={onUsePrompt}
          onUnpublish={detailPost.can_manage ? handleUnpublish : null}
        />
      )}
    </div>
  );
};

const InspirationCard = ({ post, height, onRatioLoad, onOpen }) => {
  return React.createElement('button', {
    onClick: onOpen,
    style: {
      width: '100%',
      display: 'block',
      padding: 0,
      border: '1px solid var(--line-2)',
      borderRadius: 10,
      background: 'var(--panel)',
      cursor: 'pointer',
      overflow: 'hidden',
      textAlign: 'left',
      transition: 'transform 120ms, box-shadow 120ms',
    },
    onMouseEnter: function(e) {
      e.currentTarget.style.transform = 'translateY(-2px)';
      e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.08)';
    },
    onMouseLeave: function(e) {
      e.currentTarget.style.transform = 'none';
      e.currentTarget.style.boxShadow = 'none';
    },
  },
    React.createElement('img', {
      src: post.image_url,
      alt: post.prompt,
      loading: 'lazy',
      onLoad: function(e) {
        const img = e.currentTarget;
        if (img.naturalWidth && img.naturalHeight && onRatioLoad) {
          onRatioLoad(post.id, img.naturalWidth / img.naturalHeight);
        }
      },
      style: height ? { width: '100%', height: height + 'px', objectFit: 'cover', display: 'block', background: 'var(--panel-2)' } : { width: '100%', display: 'block', background: 'var(--panel-2)' },
    })
  );
};

const InspirationDetail = ({ post, onClose, onUsePrompt, onUnpublish }) => {
  return (
    <>
      <div onClick={onClose} style={{
        position: 'absolute', inset: 0,
        background: 'rgba(0,0,0,0.32)',
        zIndex: 20,
      }}/>
      <div style={{
        position: 'absolute', top: 0, right: 0, bottom: 0,
        width: 420, zIndex: 21,
        background: 'var(--panel)',
        borderLeft: '1px solid var(--line)',
        display: 'flex', flexDirection: 'column',
        boxShadow: '-8px 0 24px rgba(0,0,0,0.12)',
      }}>
        {/* 抽屉头 */}
        <div style={{
          height: 44, flexShrink: 0,
          display: 'flex', alignItems: 'center',
          padding: '0 14px', gap: 8,
          borderBottom: '1px solid var(--line)',
        }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>灵感详情</div>
          <div style={{ flex: 1 }}/>
          <button onClick={onClose} style={{
            width: 28, height: 28, borderRadius: 6,
            background: 'var(--panel-2)', border: '1px solid var(--line-2)',
            color: 'var(--ink-2)', display: 'grid', placeItems: 'center', cursor: 'pointer',
          }}>
            <I.close size={12}/>
          </button>
        </div>

        {/* 大图 */}
        <div style={{ padding: 14, flexShrink: 0 }}>
          <img src={post.image_url} alt={post.prompt} style={{
            width: '100%', maxHeight: 360, objectFit: 'contain',
            borderRadius: 8, background: 'var(--panel-2)',
            border: '1px solid var(--line-2)', display: 'block',
          }}/>
        </div>

        {/* 信息 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 14px 14px' }}>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }} className="mono">Prompt</div>
            <div style={{
              fontSize: 12, color: 'var(--ink)', lineHeight: 1.55,
              padding: '8px 10px', borderRadius: 6,
              background: 'var(--panel-2)', border: '1px solid var(--line-2)',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>{post.prompt || '（无）'}</div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {[
              ['模型', post.model],
              ['尺寸', post.size],
              ['分辨率', post.resolution || '默认'],
              post.has_ref ? ['参考图', '有'] : null,
            ].filter(Boolean).map(function(item, i) {
              return React.createElement('span', {
                key: i,
                className: 'mono',
                style: {
                  fontSize: 10, padding: '3px 8px', borderRadius: 4,
                  background: 'var(--panel-2)', border: '1px solid var(--line-2)',
                  color: 'var(--ink-2)',
                }
              }, item[0] + '：' + item[1]);
            })}
          </div>
        </div>

        {/* 操作 */}
        <div style={{
          flexShrink: 0,
          padding: 12, borderTop: '1px solid var(--line)',
          display: 'flex', gap: 8,
        }}>
          <button
            onClick={function() { onUsePrompt(post); }}
            style={{
              flex: 1, height: 36, padding: '0 14px', borderRadius: 6,
              background: 'var(--ink)', color: 'white', border: '1px solid var(--ink)',
              fontSize: 12, fontWeight: 500, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            <I.sparkles size={12}/>生成同款
          </button>
          {onUnpublish && (
            <button
              onClick={function() { onUnpublish(post); }}
              style={{
                height: 36, padding: '0 12px', borderRadius: 6,
                background: 'var(--panel)', color: 'var(--warn)',
                border: '1px solid var(--line)', fontSize: 12,
                display: 'inline-flex', alignItems: 'center', gap: 5,
                cursor: 'pointer',
              }}
            >
              下架
            </button>
          )}
        </div>
      </div>
    </>
  );
};

window.InspirationPanel = InspirationPanel;

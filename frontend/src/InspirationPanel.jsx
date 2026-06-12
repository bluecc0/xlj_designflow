// 灵感面板：覆盖在画布区域的浮层
// 布局：顶部栏（tab + 搜索 + 关闭） + 主体瀑布流（4 列） + 详情抽屉（点击图片展开）

const COLUMN_COUNT_DESKTOP = 4;
const COLUMN_GAP = 12;
const COLUMN_MIN_WIDTH = 200;
const PANEL_INSPIRATION_CATEGORIES = [
  { id: 'share_card', label: '分享卡片' },
  { id: 'moments', label: '朋友圈' },
  { id: 'poster', label: '海报' },
  { id: 'long_image', label: '长图文' },
  { id: 'detail_page', label: '详情页' },
  { id: 'main_image', label: '主图' },
  { id: 'scene_compose', label: '场景合成' },
  { id: 'ai_model', label: 'AI模特' },
  { id: 'ai_tryon', label: 'AI换装' },
  { id: 'ai_wearable', label: 'AI穿戴' },
  { id: 'ai_pose', label: 'AI裂变姿势' },
];
const PANEL_INSPIRATION_TABS = [
  { id: 'all', label: '全部' },
  { id: 'mine', label: '我发布的' },
  { id: 'favorite', label: '我收藏的' },
].concat(PANEL_INSPIRATION_CATEGORIES);

const InspirationPanel = ({ onClose, onUsePrompt }) => {
  const [tab, setTab] = React.useState('all');
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
    var options = {
      mine: tab === 'mine',
      favorite: tab === 'favorite',
      category: PANEL_INSPIRATION_CATEGORIES.some(function(c) { return c.id === tab; }) ? tab : '',
      search: search.trim(),
    };
    window.API.listInspiration(80, 0, options)
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
  }, [tab, search]);

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
      return (p.prompt || '').toLowerCase().includes(q)
        || (p.vlm_prompt || '').toLowerCase().includes(q)
        || (p.vlm_description || '').toLowerCase().includes(q)
        || (Array.isArray(p.tags) && p.tags.join(' ').toLowerCase().includes(q));
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

  const toggleFavorite = React.useCallback(function(post) {
    if (!post || !post.id) return;
    const next = !post.favorited;
    const apiCall = next ? window.API.favoriteInspiration : window.API.unfavoriteInspiration;
    setPosts(function(prev) {
      return prev.map(function(p) { return p.id === post.id ? Object.assign({}, p, { favorited: next }) : p; });
    });
    if (detailPost && detailPost.id === post.id) {
      setDetailPost(Object.assign({}, detailPost, { favorited: next }));
    }
    apiCall(post.id).catch(function(e) {
      setPosts(function(prev) {
        return prev.map(function(p) { return p.id === post.id ? Object.assign({}, p, { favorited: !next }) : p; });
      });
      if (detailPost && detailPost.id === post.id) {
        setDetailPost(Object.assign({}, detailPost, { favorited: !next }));
      }
      window.alert((next ? '收藏' : '取消收藏') + '失败：' + (e.message || '未知错误'));
    });
  }, [detailPost]);

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
        <div style={{
          display: 'flex', gap: 18,
          overflowX: 'auto', maxWidth: 'min(680px, 54vw)',
          alignSelf: 'stretch', alignItems: 'center',
        }} className="inspiration-tab-scroll">
          {PANEL_INSPIRATION_TABS.map(function(t) {
            const active = tab === t.id;
            return React.createElement('button', {
              key: t.id,
              onClick: function() { setTab(t.id); },
              style: {
                height: '100%', padding: '0 1px',
                borderRadius: 0,
                border: 'none',
                borderBottom: '2px solid ' + (active ? 'var(--ink)' : 'transparent'),
                background: 'transparent',
                color: active ? 'var(--ink)' : 'var(--ink-2)',
                fontSize: 11.5, fontWeight: active ? 600 : 400,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transform: 'translateY(1px)',
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
            placeholder="搜索 prompt / 标签…"
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
            {tab === 'mine' ? '你还没有发布过灵感' : tab === 'favorite' ? '你还没有收藏灵感' : '还没有灵感，去生张图试试吧'}
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
                onToggleFavorite: toggleFavorite,
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
          onToggleFavorite={toggleFavorite}
          onUnpublish={detailPost.can_manage ? handleUnpublish : null}
        />
      )}
    </div>
  );
};

const InspirationCard = ({ post, height, onRatioLoad, onOpen, onToggleFavorite }) => {
  return React.createElement('div', {
    role: 'button',
    tabIndex: 0,
    onClick: onOpen,
    onKeyDown: function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onOpen && onOpen();
      }
    },
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
      position: 'relative',
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
    React.createElement('div', { style: { position: 'relative' } },
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
    }),
      React.createElement('button', {
        type: 'button',
        title: post.favorited ? '取消收藏这张图' : '收藏这张图',
        'aria-label': post.favorited ? '取消收藏这张图' : '收藏这张图',
        onClick: function(e) {
          e.preventDefault();
          e.stopPropagation();
          onToggleFavorite && onToggleFavorite(post);
        },
        onMouseEnter: function(e) {
          e.currentTarget.style.transform = post.favorited ? 'scale(1.08)' : 'scale(1.06)';
        },
        onMouseLeave: function(e) {
          e.currentTarget.style.transform = post.favorited ? 'scale(1.04)' : 'scale(1)';
        },
        onMouseDown: function(e) {
          e.currentTarget.style.transform = 'scale(0.94)';
        },
        onMouseUp: function(e) {
          e.currentTarget.style.transform = post.favorited ? 'scale(1.08)' : 'scale(1.06)';
        },
        style: {
          position: 'absolute', right: 8, top: 8,
          width: 28, height: 28, borderRadius: 999,
          border: post.favorited ? '1px solid oklch(0.74 0.16 35)' : '1px solid rgba(255,255,255,0.72)',
          background: post.favorited ? 'oklch(0.62 0.18 35)' : 'rgba(255,255,255,0.84)',
          color: post.favorited ? '#fff' : 'var(--ink-2)',
          display: 'grid', placeItems: 'center',
          cursor: 'pointer',
          backdropFilter: 'blur(8px)',
          boxShadow: post.favorited ? '0 8px 18px rgba(190,72,45,0.28)' : '0 4px 12px rgba(15,23,42,0.10)',
          transform: post.favorited ? 'scale(1.04)' : 'scale(1)',
          transition: 'background 140ms, color 140ms, border-color 140ms, box-shadow 140ms, transform 140ms',
        }
      }, React.createElement(I.heart, { size: post.favorited ? 14 : 13 }))
    )
  );
};

const InspirationDetail = ({ post, onClose, onUsePrompt, onToggleFavorite, onUnpublish }) => {
  const [describing, setDescribing] = React.useState(false);
  const [describeError, setDescribeError] = React.useState('');
  const [localPost, setLocalPost] = React.useState(post);
  React.useEffect(function() { setLocalPost(post); setDescribeError(''); }, [post]);
  const activePost = localPost || post;
  const handleDescribe = React.useCallback(function() {
    if (!activePost || !activePost.id) return;
    setDescribeError('');
    setDescribing(true);
    window.API.describeInspiration(activePost.id)
      .then(function(res) {
        setLocalPost(function(prev) {
          return Object.assign({}, prev || activePost, {
            vlm_prompt: res.prompt || '',
            vlm_description: res.description || '',
          });
        });
      })
      .catch(function(e) { setDescribeError(e.message || '未知错误'); })
      .finally(function() { setDescribing(false); });
  }, [activePost]);
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
	          <button onClick={function() { onToggleFavorite && onToggleFavorite(activePost); setLocalPost(Object.assign({}, activePost, { favorited: !activePost.favorited })); }} style={{
	            height: 28, padding: '0 9px', borderRadius: 6,
	            background: activePost.favorited ? 'oklch(0.96 0.04 35)' : 'var(--panel-2)',
	            border: '1px solid var(--line-2)',
	            color: activePost.favorited ? 'var(--warn)' : 'var(--ink-2)',
	            display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 11,
	          }}>
	            <I.heart size={12}/>{activePost.favorited ? '已收藏' : '收藏'}
	          </button>
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
	          <img src={activePost.full_image_url || activePost.image_url} alt={activePost.prompt} style={{
            width: '100%', maxHeight: 360, objectFit: 'contain',
            borderRadius: 8, background: 'var(--panel-2)',
            border: '1px solid var(--line-2)', display: 'block',
          }}/>
        </div>

        {/* 信息 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 14px 14px' }}>
          {activePost.original_prompt && activePost.original_prompt !== activePost.prompt ? (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }} className="mono">原始输入</div>
              <div style={{
                fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.55,
                padding: '8px 10px', borderRadius: 6,
                background: 'var(--panel-2)', border: '1px solid var(--line-2)',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>{activePost.original_prompt}</div>
            </div>
          ) : null}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }} className="mono">生成 Prompt</div>
	            <div style={{
	              fontSize: 12, color: 'var(--ink)', lineHeight: 1.55,
	              padding: '8px 10px', borderRadius: 6,
	              background: 'var(--panel-2)', border: '1px solid var(--line-2)',
	              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
	            }}>{activePost.resolved_prompt || activePost.prompt || '（无）'}</div>
	          </div>
	          <div style={{ marginBottom: 10 }}>
	            <div style={{
	              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
	              gap: 8, marginBottom: 4,
	            }}>
	              <div style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }} className="mono">VLM 反推 Prompt</div>
	              <button
	                onClick={handleDescribe}
	                disabled={describing}
	                style={{
	                  height: 22, padding: '0 8px', borderRadius: 999,
	                  background: 'var(--panel)', color: 'var(--ink-2)',
	                  border: '1px solid var(--line)', fontSize: 10.5,
	                  display: 'inline-flex', alignItems: 'center', gap: 4,
	                  cursor: describing ? 'default' : 'pointer',
	                  opacity: describing ? 0.65 : 1,
	                }}
	              >
	                <I.eye size={11}/>{describing ? '分析中' : (activePost.vlm_prompt ? '重新反推' : '反推')}
	              </button>
	            </div>
	            {describeError ? <div style={{
	              fontSize: 11, color: 'var(--warn)', lineHeight: 1.45,
	              padding: '7px 9px', borderRadius: 6,
	              background: 'oklch(0.97 0.025 35)', border: '1px solid oklch(0.9 0.05 35)',
	              marginBottom: 6,
	            }}>反推失败：{describeError}</div> : null}
	            <div style={{
	              fontSize: 12, color: activePost.vlm_prompt ? 'var(--ink)' : 'var(--ink-3)', lineHeight: 1.55,
	              padding: '8px 10px', borderRadius: 6,
	              background: 'var(--panel-2)', border: '1px solid var(--line-2)',
	              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
	              minHeight: 42,
	            }}>{activePost.vlm_prompt || (describing ? '正在分析图片并生成可复用 prompt…' : '尚未反推。点击右上角“反推”，用 VLM 从图片生成更详细的复刻 prompt。')}</div>
	          </div>
	          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
	            {[
	              ['分类', activePost.category_label || '分享卡片'],
	              ['模型', activePost.model],
	              ['尺寸', activePost.size],
	              ['分辨率', activePost.resolution || '默认'],
	              activePost.has_ref ? ['参考图', '有'] : null,
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
	          {Array.isArray(activePost.tags) && activePost.tags.length > 0 ? (
	            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12 }}>
	              {activePost.tags.map(function(tag) {
	                return React.createElement('span', { key: tag, style: { fontSize: 10.5, color: 'var(--ink-2)', padding: '3px 8px', borderRadius: 999, background: 'var(--panel-2)', border: '1px solid var(--line-2)' } }, '#' + tag);
	              })}
	            </div>
	          ) : null}
	        </div>

        {/* 操作 */}
        <div style={{
          flexShrink: 0,
          padding: 12, borderTop: '1px solid var(--line)',
          display: 'flex', flexDirection: 'column', gap: 7,
        }}>
          <div style={{ display: 'flex', gap: 8 }}>
	          <button
	            onClick={function() {
	              const finalPrompt = activePost.vlm_prompt || activePost.resolved_prompt || activePost.prompt || activePost.original_prompt || '';
	              const promptSource = activePost.vlm_prompt ? 'vlm' : (activePost.resolved_prompt ? 'resolved' : 'original');
	              onUsePrompt(Object.assign({}, activePost, {
	                prompt: finalPrompt,
	                prompt_source: promptSource,
	              }));
	            }}
	            style={{
	              flex: 1, height: 36, padding: '0 14px', borderRadius: 6,
	              background: 'var(--ink)', color: 'white', border: '1px solid var(--ink)',
	              fontSize: 12, fontWeight: 500, cursor: 'pointer',
	              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
	            }}
	          >
	            <I.sparkles size={12}/>{activePost.vlm_prompt ? '用反推 Prompt 生成同款' : (activePost.resolved_prompt ? '用生成 Prompt 生成同款' : '用原始 Prompt 生成同款')}
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
          <div style={{ fontSize: 10.5, color: 'var(--ink-3)', lineHeight: 1.4 }}>
            当前优先使用 VLM 反推 Prompt；没有反推结果时使用生成时的完整 Prompt，再兜底原始输入。
          </div>
        </div>
      </div>
    </>
  );
};

window.InspirationPanel = InspirationPanel;

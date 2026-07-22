const CATS = ['All', 'Social', 'E-commerce', 'Brand', 'Print', 'Web', 'Packaging'];

function formatAiModelName(model) {
  if (!model) return 'AI 生图';
  var map = {
    'gpt-image-2': 'Gpt image 2',
    'gemini-3-pro-image-preview': 'Nano Banano pro',
  };
  return map[model] || model;
}

// 从后端 TemplateInfo 推导显示用的 cat / ratio / tone / tag
function deriveTemplateMeta(t) {
  const { width = 400, height = 400, slots = [] } = t;
  const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
  const g = gcd(Math.round(width), Math.round(height));
  const ratio = (width / g) + '/' + (height / g);
  const productSlots = (slots || []).filter(function(s) {
    return (s.name || '').replace(/ /g, '').startsWith('slot/product_');
  });
  const uniqGroups = new Set(productSlots.map(function(s) { return (s.name || '').split('/')[1]; })).size;
  return {
    ratio: ratio,
    tone: 'neutral',
    tag: uniqGroups > 0 ? uniqGroups + '格' : ratio,
    cat: 'E-commerce',
  };
}

// 初始为空，API返回后填充（见 useEffect）
const TEMPLATES = [];

// 懒加载真实缩略图，进入视口后才请求
function LazyThumb(_ref2) {
  var t = _ref2.t;
  var ref = React.useRef(null);
  var _React$useState = React.useState(null), src = _React$useState[0], setSrc = _React$useState[1];
  var _React$useState2 = React.useState(false), failed = _React$useState2[0], setFailed = _React$useState2[1];
  React.useEffect(function() {
    var el = ref.current;
    if (!el) return;
    var observer = new IntersectionObserver(function(entries) {
      if (entries[0].isIntersecting) {
        observer.disconnect();
        setSrc(window.API.getTemplateThumbnailUrl(t.id, t.page_id, t.file_id));
      }
    }, { rootMargin: '120px' });
    observer.observe(el);
    return function() { observer.disconnect(); };
  }, [t.id, t.page_id, t.file_id]);
  return React.createElement('div', { ref: ref, style: { aspectRatio: t.ratio || '1/1', position: 'relative', borderRadius: 8, overflow: 'hidden', background: 'var(--panel-2)', border: '1px solid var(--line-2)' } },
    src && !failed && React.createElement('img', { src: src, alt: t.name, style: { width: '100%', height: '100%', objectFit: 'cover' }, onError: function() { setFailed(true); } }),
    (!src || failed) && React.createElement(Stripe, { label: t.name.split(' ')[0], ratio: t.ratio || '1/1', tone: t.tone || 'neutral', seed: t.id, tag: t.tag || t.name })
  );
}

const TemplateCard = function(_ref) {
  var t = _ref.t, active = _ref.active, onClick = _ref.onClick;
  return (
    React.createElement('button', {
      onClick: onClick,
      style: {
        display: 'block', textAlign: 'left',
        padding: 6, borderRadius: 10,
        border: active ? '1.5px solid var(--accent)' : '1px solid transparent',
        background: active ? 'var(--accent-soft)' : 'transparent',
        transition: 'all 120ms ease',
        position: 'relative',
      },
      onMouseEnter: function(e) { if (!active) e.currentTarget.style.background = 'var(--panel-2)'; },
      onMouseLeave: function(e) { if (!active) e.currentTarget.style.background = 'transparent'; }
    },
      React.createElement(LazyThumb, { t: t }),
      React.createElement('div', { style: { padding: '6px 2px 2px', display: 'flex', alignItems: 'center', gap: 5 } },
        React.createElement('div', { style: { fontSize: 11.5, fontWeight: 500, color: 'var(--ink)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, t.name),
        t.frames && t.frames.length > 1 && React.createElement('span', { className: 'mono', style: { fontSize: 8, color: 'var(--accent-ink)', background: 'var(--accent-soft)', padding: '1px 4px', borderRadius: 3, letterSpacing: '0.04em' } }, t.frames.length + '板'),
        t.pro && React.createElement('span', { className: 'mono', style: { fontSize: 8, color: 'var(--accent-ink)', background: 'var(--accent-soft)', padding: '1px 4px', borderRadius: 3, letterSpacing: '0.04em' } }, 'PRO')
      ),
      active && React.createElement('div', {
        style: {
          position: 'absolute', top: 10, right: 10,
          width: 18, height: 18, borderRadius: 99,
          background: 'var(--accent)', color: 'white',
          display: 'grid', placeItems: 'center',
          boxShadow: '0 2px 6px oklch(0.55 0.22 275 / 0.35)',
        }
      }, React.createElement(I.check, { size: 11, stroke: 3 }))
    )
  );
};

// 已用时计时器，每秒刷新，仅在 running 状态使用
var ElapsedTimer = function(props) {
  var createdAt = props.createdAt; // unix timestamp (seconds)
  var _s = React.useState(Math.max(0, Math.floor(Date.now() / 1000 - createdAt)));
  var elapsed = _s[0], setElapsed = _s[1];
  React.useEffect(function() {
    var id = setInterval(function() {
      setElapsed(Math.max(0, Math.floor(Date.now() / 1000 - createdAt)));
    }, 1000);
    return function() { clearInterval(id); };
  }, [createdAt]);
  var m = Math.floor(elapsed / 60), s = elapsed % 60;
  var label = m > 0 ? m + 'm ' + String(s).padStart(2, '0') + 's' : s + 's';
  return React.createElement('span', {
    className: 'mono',
    style: { fontSize: 10, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' },
  }, label);
};

var PANEL_TABS = [
  { id: 'templates', label: '模板' },
  { id: 'history',   label: '历史记录' },
  { id: 'mcp',       label: 'MCP', soon: true },
];

var TemplatePanel = function(_ref2) {
  var activeId = _ref2.activeId, onSelect = _ref2.onSelect, collapsed = _ref2.collapsed;
  var _useState = React.useState('templates'), tab = _useState[0], setTab = _useState[1];
  var _useState2 = React.useState({ general: true, special: true }), collapsedSections = _useState2[0], setCollapsedSections = _useState2[1];
  var _useState3 = React.useState(''), q = _useState3[0], setQ = _useState3[1];
  var _useState4 = React.useState([]), templates = _useState4[0], setTemplates = _useState4[1];
  var _useState5 = React.useState(true), loading = _useState5[0], setLoading = _useState5[1];
  var _useState6 = React.useState(null), loadErr = _useState6[0], setLoadErr = _useState6[1];
  var _useState7 = React.useState([]), historyJobs = _useState7[0], setHistoryJobs = _useState7[1];
  var _useState8 = React.useState(false), historyLoading = _useState8[0], setHistoryLoading = _useState8[1];

  React.useEffect(function() {
    if (tab !== 'templates') return;
    setLoading(true);
    setLoadErr(null);
    window.API.fetchTemplates()
      .then(function(data) {
        var raw = (data || []).map(function(t) {
          return Object.assign({}, t, deriveTemplateMeta(t));
        });

        // ── 按 file_id + group_name 聚合，跨文件同名 page 不互相干扰 ──────────
        var groupMap = {};
        var groupOrder = [];
        raw.forEach(function(t) {
          var gname = t.group_name || t.name;
          // 分组 key 带 file_id，防止不同文件的同名 page 被错误合并
          var gkey = (t.file_id || '') + ':' + gname;
          if (!groupMap[gkey]) {
            groupMap[gkey] = {
              id: t.id,
              name: gname,
              group_name: gname,
              page_id: t.page_id,
              file_id: t.file_id,
              width: t.width,
              height: t.height,
              ratio: t.ratio,
              tone: t.tone,
              tag: t.tag,
              cat: t.cat,
              slots: t.slots,
              is_special: t.is_special || false,
              is_special_full: t.is_special_full || false,
              frames: [],
            };
            groupOrder.push(gkey);
          }
          groupMap[gkey].frames.push(t);
          if (t.slots && t.slots.length > groupMap[gkey].slots.length) {
            groupMap[gkey].slots = t.slots;
          }
        });

        var groups = groupOrder.map(function(gkey) { return groupMap[gkey]; });
        setTemplates(groups);
        window.TEMPLATES = groups;
      })
      .catch(function(err) {
        console.error('[TemplatePanel] fetchTemplates failed:', err);
        setLoadErr(String(err));
      })
      .finally(function() { setLoading(false); });
  }, [tab]);

  React.useEffect(function() {
    if (tab !== 'history') return;
    console.log('[TemplatePanel] Loading history...');
    setHistoryLoading(true);
    Promise.all([
      window.API.listComposes(50).catch(function() { return []; }),
      window.API.listSpecialComposes(50).catch(function() { return []; }),
      window.API.listAiImages(50).catch(function() { return []; }),
    ]).then(function(results) {
      var normal = (results[0] || []).map(function(j) { return Object.assign({}, j, { _type: 'normal' }); });
      var special = (results[1] || []).map(function(j) { return Object.assign({}, j, { _type: 'special' }); });
      var aiImages = (results[2] || []).map(function(j) { return Object.assign({}, j, { _type: 'ai-image' }); });
      var merged = normal.concat(special, aiImages).sort(function(a, b) { return (b.created_at || 0) - (a.created_at || 0); });
      console.log('[TemplatePanel] History merged:', merged.length, 'jobs');
      setHistoryJobs(merged);
    }).catch(function(err) {
      console.error('[TemplatePanel] History load failed:', err);
    }).finally(function() { setHistoryLoading(false); });
  }, [tab]);

  // 分组为文件夹
  var sections = [
    { key: 'general', label: '通用模板', items: templates.filter(function(t) { return !t.is_special && !t.is_special_full; }) },
    { key: 'special', label: '特殊品', items: templates.filter(function(t) { return t.is_special || t.is_special_full; }) },
  ];

  // 搜索过滤
  var filteredSections = sections.map(function(s) {
    if (!q) return s;
    return { key: s.key, label: s.label, items: s.items.filter(function(t) { return t.name.toLowerCase().includes(q.toLowerCase()); }) };
  });

  var toggleSection = function(key) {
    setCollapsedSections(function(prev) {
      var next = Object.assign({}, prev);
      next[key] = !prev[key];
      return next;
    });
  };
  var isCollapsed = function(key) { return !!collapsedSections[key]; };

  return (
    React.createElement('div', { style: {
      position: 'relative',
      width: 260,
      flex: '0 0 260px',
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--panel)',
      borderRight: '1px solid var(--line)',
      transform: collapsed ? 'translateX(-260px)' : 'translateX(0)',
      transition: 'transform 180ms ease',
      pointerEvents: collapsed ? 'none' : 'auto',
    } },
      React.createElement('div', { style: { display: 'flex', flexShrink: 0, height: 44, borderBottom: '1px solid var(--line)', padding: '0 10px', gap: 2, alignItems: 'center' } },
        PANEL_TABS.map(function(t) {
          return React.createElement('button', {
            key: t.id,
            onClick: function() { if (!t.soon) setTab(t.id); },
            style: {
              height: '100%',
              padding: '0 10px',
              fontSize: 12, fontWeight: tab === t.id ? 600 : 400,
              color: t.soon ? 'var(--ink-3)' : tab === t.id ? 'var(--ink)' : 'var(--ink-2)',
              borderBottom: tab === t.id ? '2px solid var(--ink)' : '2px solid transparent',
              marginBottom: -1,
              display: 'flex', alignItems: 'center', gap: 5,
              cursor: t.soon ? 'default' : 'pointer',
              transition: 'color 120ms',
            }
          }, t.label, t.soon && React.createElement('span', {
            className: 'mono',
            style: { fontSize: 8, padding: '1px 4px', borderRadius: 3, background: 'var(--panel-2)', border: '1px solid var(--line)', color: 'var(--ink-3)', letterSpacing: '0.03em' }
          }, 'soon'));
        })
      ),
      tab === 'templates' && React.createElement('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
        React.createElement('div', { style: { padding: '10px 14px 8px', flexShrink: 0 } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 7, padding: '7px 10px', borderRadius: 7, background: 'var(--panel-2)', border: '1px solid var(--line-2)' } },
            React.createElement(I.search, { size: 13, style: { color: 'var(--ink-3)' } }),
            React.createElement('input', {
              value: q, onChange: function(e) { setQ(e.target.value); },
              placeholder: '搜索模板…',
              style: { flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 12, color: 'var(--ink)' }
            }),
            React.createElement('button', {
              title: '刷新模板（清除缩略图缓存）',
              onClick: function() {
                setLoading(true);
                setLoadErr(null);
                window.API.clearTemplateCache().catch(function() {}).finally(function() {
                  setTab('history');
                  setTimeout(function() { setTab('templates'); }, 50);
                });
              },
              style: {
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 22, height: 22, borderRadius: 5, flexShrink: 0,
                border: 'none', background: 'transparent',
                cursor: 'pointer', color: 'var(--ink-3)',
                transition: 'color 120ms',
              },
              onMouseEnter: function(e) { e.currentTarget.style.color = 'var(--ink)'; },
              onMouseLeave: function(e) { e.currentTarget.style.color = 'var(--ink-3)'; },
            }, React.createElement(I.refresh, { size: 13 }))
          )
        ),
        loading && React.createElement('div', { style: { flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--ink-3)', fontSize: 12 } },
          React.createElement('span', { style: { animation: 'spin 1s linear infinite', display: 'inline-block' } }, '⟳'),
          '加载模板…'
        ),
        !loading && loadErr && React.createElement('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#e53', fontSize: 11, padding: 16, textAlign: 'center' } },
          React.createElement('div', null, '加载失败'),
          React.createElement('div', { style: { color: 'var(--ink-3)', fontSize: 10 } }, String(loadErr))
        ),
        !loading && !loadErr && React.createElement('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 14px 56px' } },
          filteredSections.map(function(section) {
            var colA = section.items.filter(function(_, i) { return i % 2 === 0; });
            var colB = section.items.filter(function(_, i) { return i % 2 === 1; });
            var collapsed = isCollapsed(section.key);
            return React.createElement('div', { key: section.key, style: { marginBottom: 8 } },
              React.createElement('div', {
                onClick: function() { toggleSection(section.key); },
                style: {
                  padding: '8px 10px',
                  margin: '0 0 8px',
                  fontSize: 12,
                  fontWeight: 650,
                  color: 'var(--ink)',
                  display: 'flex', alignItems: 'center', gap: 6,
                  cursor: 'pointer', userSelect: 'none',
                  borderRadius: 7,
                  background: collapsed ? 'transparent' : 'var(--panel-2)',
                  border: '1px solid var(--line-2)',
                  transition: 'background 120ms, border-color 120ms, transform 120ms',
                },
                onMouseEnter: function(e) {
                  e.currentTarget.style.background = collapsed ? 'var(--panel-2)' : 'var(--panel)';
                  e.currentTarget.style.borderColor = 'var(--line)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                },
                onMouseLeave: function(e) {
                  e.currentTarget.style.background = collapsed ? 'transparent' : 'var(--panel-2)';
                  e.currentTarget.style.borderColor = 'var(--line-2)';
                  e.currentTarget.style.transform = 'translateY(0)';
                },
              },
                React.createElement('span', {
                  style: {
                    width: 12,
                    color: 'var(--ink-3)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 13,
                    fontWeight: 500,
                    lineHeight: 1,
                    transition: 'transform 150ms, color 120ms',
                    transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                    flexShrink: 0,
                  }
                }, '>'),
                React.createElement('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, section.label),
                React.createElement('span', {
                  className: 'mono',
                  style: {
                    color: 'var(--ink-3)',
                    fontSize: 10,
                    fontWeight: 600,
                    lineHeight: 1,
                  }
                }, section.items.length)
              ),
              !collapsed && (section.items.length > 0
                ? React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 } },
                    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                      colA.map(function(t) { var tkey = (t.file_id||'')+':'+(t.group_name||t.id); return React.createElement(TemplateCard, { key: tkey, t: t, active: activeId === tkey, onClick: function() { return onSelect(t); } }); })
                    ),
                    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                      colB.map(function(t) { var tkey = (t.file_id||'')+':'+(t.group_name||t.id); return React.createElement(TemplateCard, { key: tkey, t: t, active: activeId === tkey, onClick: function() { return onSelect(t); } }); })
                    )
                  )
                : React.createElement('div', { style: { padding: '8px 12px', fontSize: 11, color: 'var(--ink-3)' } }, '暂无模板')
              )
            );
          })
        )
      ),
      tab === 'history' && React.createElement('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' } },
        historyLoading && React.createElement('div', { style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--ink-3)', fontSize: 12 } },
          React.createElement('span', { style: { animation: 'spin 1s linear infinite', display: 'inline-block' } }, '⟳'),
          '加载中…'
        ),
        !historyLoading && historyJobs.length === 0 && React.createElement('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--ink-3)' } },
          React.createElement(I.layers, { size: 24, style: { opacity: 0.3 } }),
          React.createElement('div', { style: { fontSize: 12 } }, '暂无历史记录')
        ),
        !historyLoading && historyJobs.length > 0 && React.createElement('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 10px' } },
          historyJobs.map(function(job, idx) {
            var isSpecial = job._type === 'special';
            var isAiImage = job._type === 'ai-image';
            var statusColor = job.status === 'done' ? 'var(--ok)' : job.status === 'failed' ? '#e53' : 'var(--accent)';
            var timeStr = job.created_at ? new Date(job.created_at * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
            // 缩略图：特殊品取第一帧 url，普通合成取 getImageUrl
            var thumbUrl = null;
            if (job.status === 'done') {
              if (isAiImage) {
                var apiBaseAi = window.API_BASE || window.location.origin;
                thumbUrl = job.image_url ? apiBaseAi + job.image_url : null;
              } else if (isSpecial) {
                var firstFrame = job.frames && job.frames.find(function(f) { return f.url; });
                var apiBase = window.API_BASE || window.location.origin;
                thumbUrl = firstFrame ? apiBase + firstFrame.url : null;
              } else {
                thumbUrl = window.API.getImageUrl(job.id);
              }
            }
            var subtitle = isAiImage
              ? ((formatAiModelName(job.model) || 'AI 生图') + (job.has_reference ? '  图生图' : '  文生图') + (job.size ? '  ' + job.size : ''))
              : isSpecial
              ? (job.sku ? 'SKU: ' + job.sku : '特殊品') + (job.frames ? '  ' + job.frames.length + ' 张' : '')
              : (job.request && job.request.slots ? Object.keys(job.request.slots).length + ' 个产品' : '');
            var titleText = isAiImage
              ? ('AI 生图 · ' + (job.status === 'done' ? '已完成' : job.status === 'failed' ? '失败' : '生成中'))
              : ((job.sku ? job.sku + '_特殊品' : (isSpecial ? '特殊品' : '合成')) + ' · ' + (job.status === 'done' ? '已完成' : job.status === 'failed' ? '失败' : '生成中'));
            return React.createElement('div', {
              key: job.id || idx,
              style: {
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--line)',
                background: 'var(--panel-2)',
                marginBottom: 8,
                cursor: 'pointer'
              },
              onClick: function() {
                console.log('[History] Clicked job:', job.id, 'penpot:', job.penpot_edit_url);
                if (isAiImage && job.status === 'done' && thumbUrl) {
                  window.open(thumbUrl, '_blank');
                } else if (job.status === 'done' && job.penpot_edit_url) {
                  window.open(job.penpot_edit_url, '_blank');
                }
              }
            },
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: thumbUrl ? 8 : 0 } },
                thumbUrl && React.createElement('img', {
                  src: thumbUrl,
                  style: { width: 48, height: 48, objectFit: 'cover', borderRadius: 6, flexShrink: 0, background: 'var(--panel)' },
                  onError: function(e) { e.target.style.display = 'none'; }
                }),
                React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                  React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 } },
                    job.status !== 'done' && job.status !== 'failed'
                      ? React.createElement('span', { style: {
                          width: 10, height: 10, borderRadius: 99, flexShrink: 0, boxSizing: 'border-box',
                          border: '1.5px solid oklch(0.85 0.04 275)',
                          borderTopColor: 'var(--accent)',
                          animation: 'spin 0.75s linear infinite',
                          display: 'inline-block',
                        } })
                      : React.createElement('span', { style: { width: 6, height: 6, borderRadius: 99, background: statusColor, flexShrink: 0 } }),
                    React.createElement('span', { style: { flex: 1, fontSize: 12, fontWeight: 500, color: 'var(--ink)' } }, titleText),
                    job.status !== 'done' && job.status !== 'failed' && job.created_at
                      ? React.createElement(ElapsedTimer, { createdAt: job.created_at })
                      : React.createElement('span', { style: { fontSize: 10, color: 'var(--ink-3)' } }, timeStr)
                  ),
                  subtitle && React.createElement('div', { style: { fontSize: 11, color: 'var(--ink-2)', paddingLeft: 14 } }, subtitle),
                  isAiImage && job.prompt && React.createElement('div', { style: {
                    fontSize: 10.5,
                    color: 'var(--ink-3)',
                    paddingLeft: 14,
                    marginTop: 4,
                    lineHeight: 1.45,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  } }, job.prompt)
                )
              )
            );
          })
        )
      ),
      React.createElement(StatusFooter, { count: templates.length, collapsed: collapsed })
    )
  );
};

var StatusFooter = function(_ref3) {
  var count = _ref3.count, collapsed = _ref3.collapsed;
  return React.createElement('div', {
    style: {
      position: 'fixed',
      bottom: 0,
      left: 0,
      width: 260,
      zIndex: 100,
      transform: collapsed ? 'translateX(-260px)' : 'translateX(0)',
      transition: 'transform 180ms ease',
      pointerEvents: collapsed ? 'none' : 'auto',
      borderTop: '1px solid var(--line)',
      background: 'var(--panel-2)',
      padding: '8px 10px',
      display: 'flex', alignItems: 'center', gap: 8,
      boxSizing: 'border-box',
    }
  },
    React.createElement(I.layers, { size: 11, style: { color: 'var(--ink-3)' } }),
    React.createElement('span', { className: 'mono', style: { fontSize: 11, color: 'var(--ink-3)', flex: 1 } }, count + ' 个模板'),
    React.createElement(window.StatusIcon, { title: '后端服务', fetchUrl: '/health', icon: I.settings, placement: 'top' }),
    React.createElement(window.StatusIcon, { title: '素材库', fetchUrl: '/health', okKey: 'library', icon: I.folder, placement: 'top' }),
    React.createElement(window.StatusIcon, { title: 'AI 服务商', fetchUrl: '/health/deep', okKey: 'ai_provider', icon: I.sparkles, renderDetail: window.renderAiProviderDetail, placement: 'top' })
  );
};

window.TemplatePanel = TemplatePanel;
window.TEMPLATES = TEMPLATES;

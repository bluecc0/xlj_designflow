const CATS = ['All', 'Social', 'E-commerce', 'Brand', 'Print', 'Web', 'Packaging'];

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

var PANEL_TABS = [
  { id: 'templates', label: '模板' },
  { id: 'history',   label: '历史记录' },
  { id: 'mcp',       label: 'MCP', soon: true },
];

var TemplatePanel = function(_ref2) {
  var activeId = _ref2.activeId, onSelect = _ref2.onSelect;
  var _useState = React.useState('templates'), tab = _useState[0], setTab = _useState[1];
  var _useState2 = React.useState('All'), cat = _useState2[0], setCat = _useState2[1];
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

        // ── 按 group_name 聚合，同名画板合并为一个模板组 ────────────────────
        // group_name 由后端 parse_frames 填充：名称含 "/" 取左边，否则等于 name
        var groupMap = {};
        var groupOrder = [];
        raw.forEach(function(t) {
          var gname = t.group_name || t.name;
          if (!groupMap[gname]) {
            groupMap[gname] = {
              // 代表画板用第一个 frame 的属性（缩略图、id 兼容）
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
              // frames 数组含该组所有画板，供特殊品合成等多画板场景使用
              frames: [],
            };
            groupOrder.push(gname);
          }
          groupMap[gname].frames.push(t);
          // 累加所有 slots 以便正确计算格数
          if (t.slots && t.slots.length > groupMap[gname].slots.length) {
            groupMap[gname].slots = t.slots;
          }
        });

        var groups = groupOrder.map(function(gname) { return groupMap[gname]; });
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
    window.API.listComposes(50)
      .then(function(data) {
        console.log('[TemplatePanel] History data:', data);
        setHistoryJobs(data || []);
      })
      .catch(function(err) {
        console.error('[TemplatePanel] History load failed:', err);
      })
      .finally(function() { setHistoryLoading(false); });
  }, [tab]);

  var filtered = templates.filter(function(t) {
    return (cat === 'All' || t.cat === cat) &&
      (!q || t.name.toLowerCase().includes(q.toLowerCase()));
  });

  var colA = filtered.filter(function(_, i) { return i % 2 === 0; });
  var colB = filtered.filter(function(_, i) { return i % 2 === 1; });

  return (
    React.createElement('div', { style: { position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--panel)', borderRight: '1px solid var(--line)' } },
      React.createElement('div', { style: { display: 'flex', flexShrink: 0, borderBottom: '1px solid var(--line)', padding: '0 10px', gap: 2 } },
        PANEL_TABS.map(function(t) {
          return React.createElement('button', {
            key: t.id,
            onClick: function() { if (!t.soon) setTab(t.id); },
            style: {
              padding: '10px 10px 9px',
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
            React.createElement('kbd', { className: 'mono', style: { fontSize: 9, color: 'var(--ink-3)', padding: '1px 4px', borderRadius: 3, border: '1px solid var(--line)' } }, '⌘K')
          )
        ),
        cat !== 'All' && React.createElement('div', { style: { padding: '0 14px 10px', display: 'flex', gap: 4, flexShrink: 0, overflowX: 'auto', scrollbarWidth: 'none' } },
          ['All', 'E-commerce'].map(function(c) {
            return React.createElement('button', {
              key: c, onClick: function() { setCat(c); },
              style: {
                fontSize: 11, padding: '4px 9px', borderRadius: 99,
                background: cat === c ? 'var(--ink)' : 'transparent',
                color: cat === c ? 'white' : 'var(--ink-2)',
                fontWeight: cat === c ? 500 : 400,
                whiteSpace: 'nowrap',
                border: cat === c ? 'none' : '1px solid var(--line)',
                transition: 'all 120ms',
              }
            }, c);
          })
        ),
        loading && React.createElement('div', { style: { flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--ink-3)', fontSize: 12 } },
          React.createElement('span', { style: { animation: 'spin 1s linear infinite', display: 'inline-block' } }, '⟳'),
          '加载模板…'
        ),
        !loading && loadErr && React.createElement('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#e53', fontSize: 11, padding: 16, textAlign: 'center' } },
          React.createElement('div', null, '加载失败'),
          React.createElement('div', { style: { color: 'var(--ink-3)', fontSize: 10 } }, String(loadErr))
        ),
        !loading && !loadErr && filtered.length === 0 && React.createElement('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--ink-3)', fontSize: 12 } },
          React.createElement(I.layers, { size: 24, style: { opacity: 0.3 } }),
          React.createElement('div', null, q ? '没有匹配的模板「' + q + '」' : '暂没有可用模板')
        ),
        !loading && !loadErr && filtered.length > 0 && React.createElement('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 10px 56px' } },
          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 } },
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
              colA.map(function(t) { return React.createElement(TemplateCard, { key: t.group_name || t.id, t: t, active: activeId === (t.group_name || t.id), onClick: function() { return onSelect(t); } }); })
            ),
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
              colB.map(function(t) { return React.createElement(TemplateCard, { key: t.group_name || t.id, t: t, active: activeId === (t.group_name || t.id), onClick: function() { return onSelect(t); } }); })
            )
          )
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
            var statusColor = job.status === 'done' ? 'var(--ok)' : job.status === 'failed' ? '#e53' : 'var(--accent)';
            var timeStr = job.created_at ? new Date(job.created_at * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
            var imageUrl = job.status === 'done' && job.id ? window.API.getImageUrl(job.id) : null;
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
                if (job.status === 'done' && job.penpot_edit_url) {
                  window.open(job.penpot_edit_url, '_blank');
                }
              }
            },
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: imageUrl ? 8 : 4 } },
                imageUrl && React.createElement('img', {
                  src: imageUrl,
                  style: { width: 48, height: 48, objectFit: 'cover', borderRadius: 6, flexShrink: 0, background: 'var(--panel)' },
                  onError: function(e) { e.target.style.display = 'none'; }
                }),
                React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                  React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 } },
                    React.createElement('span', { style: { width: 6, height: 6, borderRadius: 99, background: statusColor, flexShrink: 0 } }),
                    React.createElement('span', { style: { flex: 1, fontSize: 12, fontWeight: 500, color: 'var(--ink)' } }, job.status === 'done' ? '已完成' : job.status === 'failed' ? '失败' : '生成中'),
                    React.createElement('span', { style: { fontSize: 10, color: 'var(--ink-3)' } }, timeStr)
                  ),
                  job.request && job.request.slots && React.createElement('div', { style: { fontSize: 11, color: 'var(--ink-2)', paddingLeft: 14 } },
                    Object.keys(job.request.slots).length + ' 个产品'
                  )
                )
              )
            );
          })
        )
      ),
      React.createElement(StatusFooter, { count: filtered.length })
    )
  );
};

var StatusFooter = function(_ref3) {
  var count = _ref3.count;
  return React.createElement('div', {
    style: {
      position: 'fixed',
      bottom: 0,
      left: 0,
      width: 260,
      zIndex: 100,
      borderTop: '1px solid var(--line)',
      background: 'var(--panel-2)',
      padding: '8px 10px',
      display: 'flex', alignItems: 'center', gap: 6,
      boxSizing: 'border-box',
    }
  },
    React.createElement(I.layers, { size: 11, style: { color: 'var(--ink-3)' } }),
    React.createElement('span', { className: 'mono', style: { fontSize: 11, color: 'var(--ink-3)', flex: 1 } }, count + ' 个模板'),
    React.createElement('a', {
      href: '/ui/PROGRESS.html',
      target: '_blank',
      rel: 'noreferrer',
      style: {
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '4px 9px', borderRadius: 6,
        border: '1px solid var(--line)',
        background: 'var(--panel)',
        fontSize: 11, color: 'var(--ink-2)',
        textDecoration: 'none',
      }
    },
      React.createElement(I.film, { size: 11 }),
      '开发进度'
    )
  );
};

window.TemplatePanel = TemplatePanel;
window.TEMPLATES = TEMPLATES;
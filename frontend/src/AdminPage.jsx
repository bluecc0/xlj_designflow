// AdminPage — 管理后台 Dashboard（仅 admin 角色可访问）

const ACTION_COLORS = {
  login: 'var(--ok)',
  compose: 'var(--accent)',
  special_compose: 'var(--accent)',
  ai_image: 'var(--warn)',
  agent_chat: '#3b82f6',
};

const ACTION_LABELS = {
  login: '登录',
  compose: '合成',
  special_compose: '特殊品合成',
  ai_image: 'AI 生图',
  agent_chat: 'Agent 对话',
};

function formatTime(ts) {
  if (!ts) return '-';
  var d = new Date(ts * 1000);
  var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

function formatDuration(ts) {
  if (!ts) return '-';
  var diff = (Date.now() / 1000) - ts;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
  return Math.floor(diff / 86400) + ' 天前';
}

var StatCard = function(props) {
  return React.createElement('div', {
    style: {
      flex: '1 1 160px', minWidth: 140,
      background: 'var(--panel)', border: '1px solid var(--line)',
      borderRadius: 8, padding: '16px 18px',
    }
  },
    React.createElement('div', { style: { fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 4 } }, props.label),
    React.createElement('div', { style: { fontSize: 26, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.02em' } }, props.value),
    props.sub ? React.createElement('div', { style: { fontSize: 11, color: 'var(--ink-3)', marginTop: 4 } }, props.sub) : null
  );
};

// 下拉选择器小组件
var FilterSelect = function(props) {
  return React.createElement('select', {
    value: props.value || '',
    onChange: function(e) { props.onChange(e.target.value || ''); },
    style: {
      height: 28, padding: '0 8px', borderRadius: 6,
      background: 'var(--panel)', border: '1px solid var(--line)',
      color: 'var(--ink)', fontSize: 11.5, outline: 'none',
      cursor: 'pointer', minWidth: 100,
    }
  },
    React.createElement('option', { value: '' }, props.placeholder || '全部'),
    (props.options || []).map(function(opt) {
      return React.createElement('option', { key: opt.value, value: opt.value }, opt.label);
    })
  );
};

var thStyle = {
  textAlign: 'left', padding: '10px 14px',
  fontSize: 11, fontWeight: 600, color: 'var(--ink-2)',
};

var tdStyle = {
  padding: '9px 14px', color: 'var(--ink)', fontSize: 12,
};

var AdminPage = function(props) {
  var user = props.user;
  var onBack = props.onBack;

  var _useState = React.useState;
  var _useEffect = React.useEffect;
  var _useCallback = React.useCallback;

  var _s = _useState(null);
  var stats = _s[0]; var setStats = _s[1];

  var _u = _useState([]);
  var users = _u[0]; var setUsers = _u[1];

  var _o = _useState([]);
  var operations = _o[0]; var setOperations = _o[1];

  var _opTotal = _useState(0);
  var opTotal = _opTotal[0]; var setOpTotal = _opTotal[1];

  var _l = _useState(true);
  var loading = _l[0]; var setLoading = _l[1];

  var _e = _useState('');
  var error = _e[0]; var setError = _e[1];

  // 筛选状态
  var _fUser = _useState('');
  var filterUser = _fUser[0]; var setFilterUser = _fUser[1];

  var _fAction = _useState('');
  var filterAction = _fAction[0]; var setFilterAction = _fAction[1];

  var _exp = _useState({});
  var expandedPayloads = _exp[0]; var setExpandedPayloads = _exp[1];

  // 加载统计 + 用户列表（不依赖筛选）
  var loadStatsAndUsers = _useCallback(function() {
    Promise.all([
      window.API.getAdminStats().catch(function() { return null; }),
      window.API.getAdminUsers().catch(function() { return null; }),
    ]).then(function(results) {
      var s = results[0];
      var u = results[1];
      if (s) setStats(s);
      if (u && u.users) setUsers(u.users);
      if (!s && !u) {
        setError('加载失败，请确认你拥有管理员权限');
      } else {
        setError('');
      }
      setLoading(false);
    }).catch(function() {
      setError('加载失败');
      setLoading(false);
    });
  }, []);

  // 加载操作日志（依赖筛选）
  var loadOperations = _useCallback(function() {
    window.API.getAdminOperations(100, 0, filterAction, filterUser)
      .then(function(o) {
        setOperations(o.operations || []);
        setOpTotal(o.total || 0);
      })
      .catch(function() {});
  }, [filterUser, filterAction]);

  // 初始加载
  _useEffect(function() {
    loadStatsAndUsers();
    loadOperations();
  }, [loadStatsAndUsers, loadOperations]);

  // 30 秒自动刷新
  _useEffect(function() {
    var iv = setInterval(function() {
      loadStatsAndUsers();
      loadOperations();
    }, 30000);
    return function() { clearInterval(iv); };
  }, [loadStatsAndUsers, loadOperations]);

  // 点用户行 → 筛选该用户
  var handleUserClick = _useCallback(function(uid) {
    if (filterUser === uid) {
      setFilterUser(''); // 再次点击取消筛选
    } else {
      setFilterUser(uid);
      setFilterAction('');
    }
  }, [filterUser]);

  // 操作类型选项
  var actionOptions = Object.keys(ACTION_LABELS).map(function(k) {
    return { value: k, label: ACTION_LABELS[k] };
  });

  // 清空筛选
  var hasFilter = filterUser || filterAction;

  return React.createElement('div', {
    style: { height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }
  },
    // ── 顶部栏 ──
    React.createElement('div', {
      style: { height: 48, flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12, background: 'var(--panel)', borderBottom: '1px solid var(--line)' }
    },
      React.createElement('span', { style: { fontSize: 16, fontWeight: 650, color: 'var(--ink)', letterSpacing: '-0.01em' } }, '管理后台'),
      React.createElement('span', { style: { fontSize: 10, color: 'var(--ink-3)', padding: '2px 6px', borderRadius: 3, background: 'var(--panel-2)', border: '1px solid var(--line)' } }, 'ADMIN'),
      React.createElement('div', { style: { flex: 1 } }),
      React.createElement('span', { style: { fontSize: 11.5, color: 'var(--ink-3)' } }, '当前用户：' + (user && user.username || '')),
      React.createElement('button', {
        onClick: onBack,
        style: { height: 28, padding: '0 12px', borderRadius: 7, background: 'var(--panel-2)', border: '1px solid var(--line-2)', color: 'var(--ink-2)', fontSize: 11.5, cursor: 'pointer' }
      }, '← 返回工作台')
    ),

    // ── 主体内容区 ──
    React.createElement('div', {
      style: { flex: 1, overflow: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }
    },
      error ? React.createElement('div', {
        style: { padding: '12px 16px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', fontSize: 13 }
      }, error) : null,

      loading ? React.createElement('div', {
        style: { textAlign: 'center', padding: 40, color: 'var(--ink-3)', fontSize: 13 }
      }, '加载中...') : null,

      // ── 统计卡片 ──
      stats ? React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 12 } },
        React.createElement(StatCard, { label: '用户数', value: stats.users, sub: '活跃会话 ' + stats.active_sessions }),
        React.createElement(StatCard, { label: '合成任务', value: stats.jobs && stats.jobs.total || 0, sub: (stats.jobs && stats.jobs.done || 0) + ' 完成 / ' + (stats.jobs && stats.jobs.failed || 0) + ' 失败' }),
        React.createElement(StatCard, { label: 'AI 生图', value: stats.ai_images && stats.ai_images.total || 0, sub: (stats.ai_images && stats.ai_images.done || 0) + ' 完成' }),
        React.createElement(StatCard, { label: '特殊品合成', value: stats.special_jobs || 0 }),
        React.createElement(StatCard, { label: 'Agent 项目', value: stats.agent_projects || 0, sub: '对话 ' + (stats.ai_chat_sessions || 0) + ' 次' }),
        React.createElement(StatCard, { label: '操作日志', value: stats.operations_logged || 0 })
      ) : null,

      // ── 用户活动表（可点击筛选）──
      users.length > 0 ? React.createElement('div', null,
        React.createElement('div', { style: { fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 10 } }, '用户活动'),
        React.createElement('div', { style: { borderRadius: 8, border: '1px solid var(--line)', overflow: 'hidden', background: 'var(--panel)' } },
          React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
            React.createElement('thead', null,
              React.createElement('tr', { style: { background: 'var(--panel-2)', borderBottom: '1px solid var(--line)' } },
                React.createElement('th', { style: thStyle }, '用户名'),
                React.createElement('th', { style: thStyle }, '合成任务'),
                React.createElement('th', { style: thStyle }, 'AI 生图'),
                React.createElement('th', { style: thStyle }, 'Agent 项目'),
                React.createElement('th', { style: thStyle }, '操作次数'),
                React.createElement('th', { style: thStyle }, '最近操作'),
                React.createElement('th', { style: thStyle }, '加入时间'),
              )
            ),
            React.createElement('tbody', null,
              users.map(function(u) {
                var isActive = filterUser === u.id;
                return React.createElement('tr', {
                  key: u.id,
                  onClick: function() { handleUserClick(u.id); },
                  style: {
                    borderBottom: '1px solid var(--line)',
                    cursor: 'pointer',
                    background: isActive ? 'var(--accent-soft)' : 'transparent',
                    transition: 'background 150ms',
                  }
                },
                  React.createElement('td', { style: Object.assign({}, tdStyle, { fontWeight: 500 }) }, u.username),
                  React.createElement('td', { style: tdStyle }, u.total_jobs),
                  React.createElement('td', { style: tdStyle }, u.total_ai_images),
                  React.createElement('td', { style: tdStyle }, u.total_agent_projects),
                  React.createElement('td', { style: tdStyle }, u.total_operations),
                  React.createElement('td', { style: tdStyle },
                    u.last_action
                      ? (ACTION_LABELS[u.last_action.action] || u.last_action.action) + ' · ' + formatDuration(u.last_action.created_at)
                      : '-'
                  ),
                  React.createElement('td', { style: tdStyle }, formatTime(u.created_at)),
                );
              })
            )
          )
        )
      ) : null,

      // ── 操作日志表（带筛选）──
      React.createElement('div', null,
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }
        },
          React.createElement('span', { style: { fontSize: 14, fontWeight: 600, color: 'var(--ink)' } },
            '操作日志' + (hasFilter ? '（已筛选）' : '') + ' — 共 ' + opTotal + ' 条'
          ),
          React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
            React.createElement(FilterSelect, {
              value: filterUser,
              onChange: function(v) { setFilterUser(v); setFilterAction(''); },
              placeholder: '全部用户',
              options: users.map(function(u) { return { value: u.id, label: u.username }; }),
            }),
            React.createElement(FilterSelect, {
              value: filterAction,
              onChange: function(v) { setFilterAction(v); },
              placeholder: '全部操作',
              options: actionOptions,
            }),
            hasFilter ? React.createElement('button', {
              onClick: function() { setFilterUser(''); setFilterAction(''); },
              style: {
                height: 28, padding: '0 10px', borderRadius: 6,
                background: 'var(--panel)', border: '1px solid var(--line)',
                color: 'var(--ink-2)', fontSize: 11, cursor: 'pointer',
              }
            }, '清除筛选') : null
          )
        ),
        operations.length > 0 ? React.createElement('div', {
          style: { borderRadius: 8, border: '1px solid var(--line)', overflow: 'hidden', background: 'var(--panel)' }
        },
          React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
            React.createElement('thead', null,
              React.createElement('tr', { style: { background: 'var(--panel-2)', borderBottom: '1px solid var(--line)' } },
                React.createElement('th', { style: thStyle }, '时间'),
                React.createElement('th', { style: thStyle }, '用户'),
                React.createElement('th', { style: thStyle }, '操作'),
                React.createElement('th', { style: thStyle }, '详情'),
React.createElement('th', { style: Object.assign({}, thStyle, { width: 50, textAlign: 'center' }) }, 'JSON'),

              )
            ),
            React.createElement('tbody', null,
              operations.map(function(op) {
                var hasPayload = op.payload && op.payload.trim();
                var isExpanded = !!expandedPayloads[op.id];
                var mainRow = React.createElement('tr', { key: op.id, style: { borderBottom: (isExpanded && hasPayload) ? 'none' : '1px solid var(--line)' } },
                  React.createElement('td', { style: Object.assign({}, tdStyle, { whiteSpace: 'nowrap' }) }, formatTime(op.created_at)),
                  React.createElement('td', { style: tdStyle }, op.username),
                  React.createElement('td', { style: tdStyle },
                    React.createElement('span', {
                      style: {
                        display: 'inline-block', padding: '2px 8px', borderRadius: 99, fontSize: 10.5, fontWeight: 500,
                        background: (ACTION_COLORS[op.action] || 'var(--ink-3)') + '18',
                        color: ACTION_COLORS[op.action] || 'var(--ink-3)',
                      }
                    }, ACTION_LABELS[op.action] || op.action)
                  ),
                  React.createElement('td', {
                    style: Object.assign({}, tdStyle, { color: 'var(--ink-2)', maxWidth: 350, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
                  }, op.detail || '-'),
  (hasPayload
    ? React.createElement('td', { style: Object.assign({}, tdStyle, { textAlign: 'center' }) },
        React.createElement('button', {
          onClick: function(e) { e.stopPropagation(); setExpandedPayloads(function(prev) { var n = Object.assign({}, prev); if (n[op.id]) delete n[op.id]; else n[op.id] = true; return n; }); },
          style: { padding: '2px 8px', borderRadius: 4, border: '1px solid var(--line-2)', background: isExpanded ? 'var(--accent-soft)' : 'var(--panel)', color: isExpanded ? 'var(--accent)' : 'var(--ink-3)', fontSize: 10, cursor: 'pointer', fontFamily: 'monospace' }
        }, isExpanded ? '收起' : '{...}'))
    : React.createElement('td', { style: Object.assign({}, tdStyle, { textAlign: 'center' }) }, React.createElement('span', { style: { color: 'var(--ink-3)', fontSize: 10 } }, '-'))
  )
);
var payloadRow = (hasPayload && isExpanded) ? React.createElement('tr', { key: op.id + '-p', style: { borderBottom: '1px solid var(--line)' } },
  React.createElement('td', { colSpan: 6, style: { padding: '8px 14px', background: '#f8f9fb' } },
    React.createElement('pre', { style: { margin: 0, fontSize: 10.5, lineHeight: 1.5, color: 'var(--ink-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 300, overflowY: 'auto', fontFamily: 'SF Mono, Fira Code, monospace' } },
      (function() { try { return JSON.stringify(JSON.parse(op.payload), null, 2); } catch(e) { return op.payload; } })()
    )
  )
) : null;
return (hasPayload && isExpanded) ? React.createElement(React.Fragment, { key: op.id + '-g' }, mainRow, payloadRow) : mainRow;
}),
          )
        )) : React.createElement('div', {
          style: { padding: '24px 0', textAlign: 'center', color: 'var(--ink-3)', fontSize: 12.5, background: 'var(--panel)', borderRadius: 8, border: '1px solid var(--line)' }
        }, hasFilter ? '没有匹配的操作记录' : '暂无操作记录')
      )
    )
  );
};

window.AdminPage = AdminPage;

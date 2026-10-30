// Agent 会话的事件游标：实时推送和续接轮询共用。
// - 按会话隔离：游标绑定一个会话，切换会话时换新游标，迟到的其它会话事件直接丢弃；
// - 按 seq 去重：记录已应用的 seq，floor 是连续已应用的最大 seq（轮询从这里补拉），
//   后台补图等插在中间的事件也能被补上；
// - 画布交付幂等：同一个工具调用或图片只交付一次。
(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Agent2Cursor = api;
})(typeof window !== 'undefined' ? window : null, function() {
  function create(sessionId) {
    return { sessionId: sessionId || '', floor: 0, seen: {}, delivered: {} };
  }

  // 返回 true 表示这个事件需要应用；不属于本会话或已应用过的返回 false
  function accept(cursor, ev) {
    if (!ev) return false;
    if (cursor.sessionId && ev.session_id && ev.session_id !== cursor.sessionId) return false;
    if (!ev.seq) return true;
    if (ev.seq <= cursor.floor || cursor.seen[ev.seq]) return false;
    cursor.seen[ev.seq] = true;
    while (cursor.seen[cursor.floor + 1]) {
      cursor.floor += 1;
      delete cursor.seen[cursor.floor];
    }
    return true;
  }

  function deliverOnce(cursor, key) {
    if (!key || cursor.delivered[key]) return false;
    cursor.delivered[key] = true;
    return true;
  }

  return { create: create, accept: accept, deliverOnce: deliverOnce };
});

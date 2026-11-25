const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const Cursor = require('../src/agent2Cursor.js');

test('incremental artifacts and tool completion deliver each image once', () => {
  const source = fs.readFileSync(require.resolve('../src/Chat.jsx'), 'utf8');
  const start = source.indexOf('const applyAgentEvent = React.useCallback(function(ev) {');
  const end = source.indexOf('}, [pushAgentImagesToCanvas]);', start);
  assert.ok(start >= 0 && end > start);
  const delivered = [];
  const context = {
    React: { useCallback: fn => fn }, window: { Agent2Cursor: Cursor },
    agentStreamRef: { current: { cursor: Cursor.create('s') } },
    agentTurnRef: { current: {} }, AGENT2_TERMINAL: {},
    setMessages: () => {}, agent2Reduce: () => {},
    pushAgentImagesToCanvas: result => delivered.push(...result.images),
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + '}, [pushAgentImagesToCanvas]); globalThis.apply = applyAgentEvent;', context);
  const emit = (seq, type, payload) => context.apply({ session_id: 's', turn_id: 't', seq, type, payload });
  const a = { id: 'a', kind: 'image', url: '/a.png' };
  const b = { id: 'b', kind: 'image', url: '/b.png' };
  emit(1, 'artifact.created', { artifact: a });
  assert.deepEqual(delivered.map(i => i.id), ['a']);
  emit(2, 'tool.finished', { ok: true, call_id: 'c', result: { images: [a, b] } });
  emit(3, 'artifact.created', { recovered: true, artifact: b });
  emit(4, 'artifact.created', { artifact: { id: 'psd', kind: 'file', url: '/a.psd' } });
  emit(2, 'tool.finished', { ok: true, call_id: 'c', result: { images: [a, b] } });
  assert.deepEqual(delivered.map(i => i.id), ['a', 'b']);
});

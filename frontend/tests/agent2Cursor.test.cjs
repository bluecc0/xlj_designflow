const assert = require('node:assert/strict')
const { test } = require('node:test')
const Cursor = require('../src/agent2Cursor.js')

const ev = (session, seq, type = 'message.delta', payload = {}) => ({ session_id: session, seq, type, payload })
const run = (cursor, events) => events.filter((e) => Cursor.accept(cursor, e))

test('连续新建两个会话：新会话从 seq 1 开始的事件全部被应用', () => {
  const a = Cursor.create('A')
  assert.equal(run(a, Array.from({ length: 20 }, (_, i) => ev('A', i + 1))).length, 20)
  const b = Cursor.create('B')
  const accepted = run(b, [ev('B', 1, 'turn.started'), ev('B', 2, 'tool.started'), ev('B', 3, 'tool.finished'), ev('B', 4, 'turn.finished')])
  assert.deepEqual(accepted.map((e) => e.type), ['turn.started', 'tool.started', 'tool.finished', 'turn.finished'])
  const c = Cursor.create('C')
  assert.equal(run(c, [ev('C', 1), ev('C', 2)]).length, 2)
})

test('迟到的其它会话事件被丢弃', () => {
  const b = Cursor.create('B')
  assert.equal(run(b, [ev('A', 21), ev('A', 1), ev('B', 1)]).length, 1)
})

test('插在中间的事件可以补拉，重复的被去重', () => {
  const c = Cursor.create('A')
  run(c, [ev('A', 1), ev('A', 2), ev('A', 4)])
  assert.equal(c.floor, 2) // 轮询从 floor 补拉，能拿到 seq 3
  assert.deepEqual(run(c, [ev('A', 3), ev('A', 4), ev('A', 5)]).map((e) => e.seq), [3, 5])
  assert.equal(c.floor, 5)
})

test('服务重启后补回的图片：轮次失败后的 artifact.created 被应用，画布只交付一次', () => {
  const c = Cursor.create('A')
  run(c, Array.from({ length: 9 }, (_, i) => ev('A', i + 1)))
  const recovered = ev('A', 11, 'artifact.created', { recovered: true, artifact: { id: 'img_1' } })
  const accepted = run(c, [ev('A', 10, 'turn.failed'), recovered, recovered])
  assert.deepEqual(accepted.map((e) => e.type), ['turn.failed', 'artifact.created'])
  assert.equal(Cursor.deliverOnce(c, 'img:img_1'), true)
  assert.equal(Cursor.deliverOnce(c, 'img:img_1'), false)
})

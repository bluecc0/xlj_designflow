const assert = require('node:assert/strict')
const { test } = require('node:test')
const createMonitor = require('../src/connection.js')

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
})
const session = () => json({ user: { id: 'user-1' } })
const done = () => json({ status: 'done', image_url: '/result.png' })
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate) }

function harness(handler) {
  let time = 0, nextId = 0
  const timers = new Map(), calls = [], events = []
  const root = new EventTarget()
  Object.assign(root, {
    location: { origin: 'http://design.test', href: 'http://design.test/ui/' },
    navigator: { onLine: true }, document: new EventTarget(),
    Response, DOMException, AbortController,
    CustomEvent: class extends Event { constructor(name) { super(name) } },
    setTimeout(fn, delay) { const id = ++nextId; timers.set(id, { at: time + delay, fn }); return id },
    clearTimeout(id) { timers.delete(id) },
    fetch: async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url, root.location.href)
      const call = { path: url.pathname, method: init.method || 'GET', init }
      calls.push(call)
      return handler(call)
    },
  })
  root.addEventListener('designflow-auth-required', () => events.push('expired'))
  root.addEventListener('designflow-auth-restored', () => events.push('restored'))
  const nativeFetch = root.fetch
  const monitor = createMonitor(root)
  monitor.install(root)
  monitor.setUser({ id: 'user-1' })
  return {
    root, monitor, calls, events, nativeFetch,
    async advance(ms) {
      const end = time + ms
      while (true) {
        const next = [...timers].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) break
        time = next[1].at
        timers.delete(next[0]); next[1].fn()
        await flush()
      }
      time = end
      await flush()
    },
  }
}

test('raw canvas requests expire the shared session once and block new submissions until login', async () => {
  const h = harness(() => json({ detail: 'expired' }, 401))
  const canvas = { fetch: h.nativeFetch }
  h.monitor.install(canvas)
  await canvas.fetch('/ai-image', { method: 'POST' })
  await h.root.fetch('/compose', { method: 'POST' })
  assert.deepEqual(h.events, ['expired'])
  assert.equal(h.calls.length, 1)
  h.monitor.setUser({ id: 'user-1' })
  assert.equal(h.monitor.getSnapshot().authExpired, false)
  assert.equal(h.calls.length, 1, 'login must not replay paid submissions')
})

test('a successful session response with user=null is recognized as expiry', async () => {
  const h = harness(() => json({ user: null }))
  await h.monitor.check()
  assert.equal(h.monitor.getSnapshot().authExpired, true)
  assert.equal(h.monitor.getSnapshot().status, 'online')
  assert.deepEqual(h.events, ['expired'])
})

test('periodic heartbeat and returning to the page check the cookie before another task is submitted', async () => {
  const h = harness(() => json({ user: null }))
  await h.advance(15000)
  assert.deepEqual(h.events, ['expired'])
  assert.equal(h.calls[0].path, '/auth/session')
  h.root.dispatchEvent(new Event('focus'))
  await flush()
  assert.equal(h.calls.length, 2)
})

test('wrong passwords, permission errors, and external requests do not expire the workbench session', async () => {
  const h = harness(call => json({}, call.path === '/auth/login-lite' ? 401 : 403))
  await h.root.fetch('/auth/login-lite', { method: 'POST' })
  await h.root.fetch('/admin/stats')
  await h.root.fetch('https://external.test/image')
  assert.deepEqual(h.events, [])
})

test('disconnected status reads resume the original task and show recovery without resubmitting', async () => {
  let polls = 0
  const h = harness(call => {
    if (call.path === '/auth/session') return session()
    polls++
    if (polls === 1) throw new TypeError('Failed to fetch')
    if (polls === 2) return json({}, 503)
    return done()
  })
  const states = []
  h.monitor.subscribe(state => states.push(state.status))
  const pending = h.root.fetch('/ai-image/original-job')
  await flush()
  await h.advance(2000)
  assert.equal((await (await pending).json()).status, 'done')
  assert.ok(states.includes('reconnecting'))
  assert.ok(states.includes('recovering'))
  assert.equal(h.calls.filter(call => call.method === 'POST').length, 0)
  assert.deepEqual(h.calls.filter(call => call.path !== '/auth/session').map(call => call.path), Array(3).fill('/ai-image/original-job'))
})

test('overlapping interval polls are coalesced during reconnection', async () => {
  let polls = 0
  const h = harness(call => {
    if (call.path === '/auth/session') return session()
    if (++polls === 1) throw new TypeError('Failed to fetch')
    return done()
  })
  const pending = Array.from({ length: 10 }, () => h.root.fetch('/ai-image/original-job'))
  await flush()
  assert.equal(polls, 1)
  await h.advance(1000)
  const responses = await Promise.all(pending)
  for (const response of responses) assert.equal((await response.json()).image_url, '/result.png')
  assert.equal(polls, 2)
})

test('a task status read waits for reauthentication and continues using the same job', async () => {
  let loggedIn = false
  const h = harness(call => call.path === '/auth/session'
    ? json({ user: loggedIn ? { id: 'user-1' } : null })
    : loggedIn ? done() : json({}, 401))
  const pending = h.root.fetch('/special-compose/original-job')
  await flush()
  await h.advance(1000)
  assert.equal(h.calls.filter(call => call.path === '/special-compose/original-job').length, 1)
  loggedIn = true
  h.monitor.setUser({ id: 'user-1' })
  await h.advance(1000)
  assert.equal((await (await pending).json()).status, 'done')
  assert.deepEqual(h.events, ['expired'])
})

test('a late 401 from the old cookie does not invalidate a renewed session', async () => {
  let complete
  const h = harness(() => new Promise(resolve => { complete = resolve }))
  const pending = h.root.fetch('/templates')
  h.monitor.setUser({ id: 'user-1' })
  complete(json({}, 401))
  await pending
  assert.deepEqual(h.events, [])
})

test('switching accounts rejects in-flight task results belonging to the previous account', async () => {
  let complete
  const h = harness(() => new Promise(resolve => { complete = resolve }))
  const pending = h.root.fetch('/ai-image/previous-user-job')
  h.monitor.setUser({ id: 'user-2' })
  complete(done())
  await assert.rejects(pending, { name: 'AbortError' })
})

test('cancelled requests do not show a network outage or trigger retries', async () => {
  const h = harness(() => { throw new DOMException('cancelled', 'AbortError') })
  await assert.rejects(h.root.fetch('/ai-image/original-job'), { name: 'AbortError' })
  assert.equal(h.monitor.getSnapshot().status, 'online')
  assert.equal(h.calls.length, 1)
})

test('a failed submission is never automatically repeated', async () => {
  const h = harness(() => { throw new TypeError('Failed to fetch') })
  await assert.rejects(h.root.fetch('/ai-image', { method: 'POST' }))
  assert.equal(h.calls.length, 1)
  assert.equal(h.monitor.getSnapshot().status, 'reconnecting')
})

test('backend recovery is displayed until the original task leaves its recovery phase', async () => {
  let completed = false
  const h = harness(() => completed ? done() : json({ status: 'processing', outpainting: { phase: 'recovering' } }))
  await h.root.fetch('/ai-image/original-job')
  assert.equal(h.monitor.getSnapshot().status, 'recovering')
  completed = true
  await h.root.fetch('/ai-image/original-job')
  assert.equal(h.monitor.getSnapshot().status, 'online')
})

test('offline events give immediate feedback and a successful session check confirms reconnection', async () => {
  const h = harness(() => session())
  h.root.navigator.onLine = false
  h.root.dispatchEvent(new Event('offline'))
  assert.equal(h.monitor.getSnapshot().status, 'offline')
  assert.equal(h.calls.length, 0)
  h.root.navigator.onLine = true
  h.root.dispatchEvent(new Event('online'))
  await flush()
  assert.equal(h.monitor.getSnapshot().status, 'restored')
  await h.advance(2000)
  assert.equal(h.monitor.getSnapshot().status, 'online')
})

test('cancelling while waiting for reconnection stops further task queries', async () => {
  const h = harness(call => call.path === '/auth/session' ? session() : json({}, 503))
  const controller = new AbortController()
  const pending = h.root.fetch('/ai-image/original-job', { signal: controller.signal })
  await flush()
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  await h.advance(3000)
  assert.equal(h.calls.filter(call => call.path === '/ai-image/original-job').length, 1)
  assert.notEqual(h.monitor.getSnapshot().status, 'recovering')
})

test('a business error returned by a working server does not trigger reconnection retries', async () => {
  const h = harness(() => json({ detail: 'Task rejected' }, 400))
  const response = await h.root.fetch('/ai-image/original-job')
  assert.equal(response.status, 400)
  assert.equal(h.calls.length, 1)
  assert.equal(h.monitor.getSnapshot().status, 'online')
})

test('cookie renewal in another tab closes the expired-session state', async () => {
  let loggedIn = false
  const h = harness(() => loggedIn ? session() : json({ user: null }))
  await h.monitor.check()
  loggedIn = true
  await h.monitor.check()
  assert.equal(h.monitor.getSnapshot().authExpired, false)
  assert.deepEqual(h.events, ['expired', 'restored'])
})

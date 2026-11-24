const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')

const chatSrc = fs.readFileSync(require.resolve('../src/Chat.jsx'), 'utf8')
const helperMatch = chatSrc.match(
  /const REVEAL_RETRY_DELAYS = \[[^\]]+\];[\s\S]*?function buildRevealRetryUrl[\s\S]*?\n\}/
)
assert.ok(helperMatch, 'Chat.jsx should define REVEAL_RETRY_DELAYS and buildRevealRetryUrl')

const context = {
  URL,
  window: { location: { origin: 'http://localhost:8000' } },
}
vm.runInNewContext(
  helperMatch[0] + '\nthis._exports = { REVEAL_RETRY_DELAYS, REVEAL_LOAD_TIMEOUT, buildRevealRetryUrl };',
  context
)
const { REVEAL_RETRY_DELAYS, REVEAL_LOAD_TIMEOUT, buildRevealRetryUrl } = context._exports

test('首次加载保持原始地址不变', () => {
  assert.equal(buildRevealRetryUrl('/output/a.png', 0, 0), '/output/a.png')
  assert.equal(buildRevealRetryUrl('http://localhost:8000/output/a.png', 0, 0), 'http://localhost:8000/output/a.png')
})

test('同源与相对路径重试时附加防缓存参数且保留既有 query 和 hash', () => {
  assert.equal(
    buildRevealRetryUrl('/output/a.png?v=1#top', 1, 0),
    '/output/a.png?v=1&_imgRetry=1-0#top'
  )
  assert.equal(
    buildRevealRetryUrl('/output/a.png?_imgRetry=1-0', 2, 1),
    '/output/a.png?_imgRetry=2-1'
  )
  assert.equal(
    buildRevealRetryUrl('http://localhost:8000/output/a.png', 1, 0),
    'http://localhost:8000/output/a.png?_imgRetry=1-0'
  )
})

test('绝不篡改外链签名地址、data URL 或 blob URL', () => {
  for (const u of [
    'https://cdn.example.com/a.png?sig=abc',
    'data:image/png;base64,AAA',
    'blob:http://localhost:8000/123',
  ]) {
    assert.equal(buildRevealRetryUrl(u, 2, 1), u)
  }
})

test('重试次数有界且具备超时保护与失败可重试 UI', () => {
  assert.deepEqual(Array.from(REVEAL_RETRY_DELAYS), [1000, 3000, 8000])
  assert.ok(REVEAL_LOAD_TIMEOUT >= 10000 && REVEAL_LOAD_TIMEOUT <= 60000)
  assert.match(chatSrc, /const RevealImage =[\s\S]*?onError:/, 'RevealImage must handle onError')
  assert.match(chatSrc, /const RevealImage =[\s\S]*?addEventListener\('online'/, 'RevealImage must auto-retry on network online')
  assert.match(chatSrc, /const RevealImage =[\s\S]*?加载失败，点击重试/, 'RevealImage must expose clickable retry fallback')
})

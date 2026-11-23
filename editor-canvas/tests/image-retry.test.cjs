const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')

const compiled = ts.transpileModule(fs.readFileSync(require.resolve('../src/utils/imageRetry.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const context = { exports: {}, URL, window: { location: { origin: 'http://localhost:8000' } } }
vm.runInNewContext(compiled, context)
const { retryImageUrl, IMAGE_RETRY_DELAYS } = context.exports

test('first request retains the persisted source', () => {
  assert.equal(retryImageUrl('/ai-images/u/a.png', 0), '/ai-images/u/a.png')
})

test('local retries bypass a failed cached response without losing query or hash', () => {
  assert.equal(retryImageUrl('/ai-images/u/a.png?size=2#image', 1),
    '/ai-images/u/a.png?size=2&_canvasRetry=1#image')
  assert.equal(retryImageUrl('/ai-images/u/a.png?_canvasRetry=1', 2),
    '/ai-images/u/a.png?_canvasRetry=2')
})

test('never mutate external signed URLs, data URLs or blob URLs', () => {
  for (const url of ['https://example.com/a?signature=x', '//example.com/a', 'data:image/png;base64,a', 'blob:local']) {
    assert.equal(retryImageUrl(url, 1), url)
  }
})

test('retry budget is bounded and uses backoff', () => {
  assert.deepEqual(Array.from(IMAGE_RETRY_DELAYS), [1000, 3000, 8000])
})

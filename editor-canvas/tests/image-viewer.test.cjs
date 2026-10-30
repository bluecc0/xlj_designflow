const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')

const html = fs.readFileSync(path.join(__dirname, '../public/image-viewer.html'), 'utf8')
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1]

async function loadViewer(src, response = { ok: true, json: async () => ({ url: '/image-copy/original.png?token=test' }) }) {
  const elements = Object.fromEntries(['image', 'status', 'original', 'hint'].map(id => [id, { hidden: true }]))
  const calls = []
  const errors = []
  const url = new URL('http://designflow.test/editor-canvas/image-viewer.html')
  url.searchParams.set('src', src)
  await vm.runInNewContext(script, {
    URL, URLSearchParams, location: url, window: { dfError: error => errors.push(error) },
    document: { getElementById: id => elements[id] },
    fetch: async (...args) => { calls.push(args); return response },
  })
  return { elements, calls, errors }
}

test('protected originals use the granted URL as the actual image source copied by the browser', async () => {
  const src = '/results/job/%E5%8E%9F%E5%9B%BE%20%23.png'
  const { elements, calls } = await loadViewer(src)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], '/image-copy/link')
  assert.equal(calls[0][1].credentials, 'same-origin')
  assert.equal(JSON.parse(calls[0][1].body).src, src)
  assert.equal(elements.image.src, 'http://designflow.test/image-copy/original.png?token=test')
  assert.equal(elements.original.href, 'http://designflow.test' + src)
  elements.image.onload()
  assert.equal(elements.image.hidden, false)
  assert.equal(elements.hint.hidden, false)
})

test('login failures stay visible and do not silently copy an inaccessible original URL', async () => {
  const { elements, errors } = await loadViewer('/ai-images/user/file.png', { ok: false, status: 401 })
  assert.equal(elements.image.src, undefined)
  assert.match(String(errors[0]), /登录/)
  assert.equal(elements.status.hidden, true)
})

test('public, external and embedded images keep their original loading behavior', async () => {
  for (const src of ['https://external.test/image.png', '/product-library/image.png', 'data:image/png;base64,AA==', 'blob:http://designflow.test/test']) {
    const { calls, elements } = await loadViewer(src)
    assert.equal(calls.length, 0)
    assert.equal(elements.image.src, new URL(src, 'http://designflow.test').href)
  }
})

test('rejects unsupported source protocols and unexpected grant origins', async () => {
  const invalid = await loadViewer('javascript:alert(1)')
  assert.equal(invalid.elements.image.src, undefined)
  const externalGrant = await loadViewer('/output/file.png', { ok: true, json: async () => ({ url: 'https://external.test/image-copy' }) })
  assert.equal(externalGrant.elements.image.src, undefined)
})

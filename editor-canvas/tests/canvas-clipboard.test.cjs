const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')

const source = ts.transpileModule(fs.readFileSync(require.resolve('../src/utils/canvasClipboard.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const context = { exports: {}, require: () => ({}), Math, JSON, Number, Array }
vm.runInNewContext(source, context)
const cb = context.exports

const img = (id, x, y, extra = {}) => ({
  id, pageId: 'p1', frameId: 'f1', x, y, width: 100, height: 50, rotation: 0, url: `/ai-images/u/${id}.png`, ...extra,
})

test('复制后粘贴保持多张图的相对位置，整组居中到粘贴点', () => {
  const text = cb.encodeCanvasImages([img('a', 100, 200), img('b', 300, 260, { rotation: 15, name: '图B' })])
  const decoded = cb.decodeCanvasImages(text)
  let n = 0
  const out = cb.layoutPastedImages(decoded, { x: 1000, y: 1000 }, () => `new-${++n}`)
  assert.equal(out.length, 2)
  // 整组 300×110，中心对准 (1000, 1000)
  assert.deepEqual(out.map((o) => [o.x, o.y]), [[850, 945], [1050, 1005]])
  assert.equal(out[1].rotation, 15)
  assert.equal(out[1].name, '图B')
  assert.equal(out[0].frameId, null)
  assert.deepEqual(out.map((o) => o.id), ['new-1', 'new-2'])
})

test('blob 地址的图片不复制；其他文本不当成画布图片', () => {
  assert.equal(cb.encodeCanvasImages([img('a', 0, 0, { url: 'blob:http://x/1' })]), null)
  assert.equal(cb.decodeCanvasImages('https://example.com/a.png'), null)
  assert.equal(cb.decodeCanvasImages('{"type":"other"}'), null)
  assert.equal(cb.decodeCanvasImages('{"type":"designflow-canvas-images","images":[{"url":"","dx":0}]}'), null)
})

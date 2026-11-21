const assert = require('node:assert/strict')
const fs = require('node:fs')
const { test } = require('node:test')
const ts = require('typescript')

const previousLoader = require.extensions['.ts']
const previousTsxLoader = require.extensions['.tsx']

const compileTs = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  module._compile(outputText, filename)
}

require.extensions['.ts'] = compileTs
require.extensions['.tsx'] = compileTs

if (!globalThis.window) {
  globalThis.window = {
    location: { search: '?user_id=test-user' },
    addEventListener() {},
    removeEventListener() {},
    localStorage: {
      _data: new Map(),
      getItem(k) { return this._data.has(k) ? this._data.get(k) : null },
      setItem(k, v) { this._data.set(k, String(v)) },
      removeItem(k) { this._data.delete(k) },
    },
  }
}
if (!globalThis.localStorage) {
  globalThis.localStorage = globalThis.window.localStorage
}

const { sortPersonalPagesByPin, sortTeamCanvasesByPin } = require('../src/components/PageDropdown.tsx')
const { useCanvasStore } = require('../src/store/canvasStore.ts')

if (previousLoader) require.extensions['.ts'] = previousLoader
else delete require.extensions['.ts']
if (previousTsxLoader) require.extensions['.tsx'] = previousTsxLoader
else delete require.extensions['.tsx']

test('置顶的个人画布排在前面，新置顶的排在旧置顶前面，未置顶画布保持原有顺序', () => {
  const pages = [
    { id: 'p1', name: '画布 1', order: 0 },
    { id: 'p2', name: '画布 2', order: 1, pinned: true, pinnedAt: 100 },
    { id: 'p3', name: '画布 3', order: 2 },
    { id: 'p4', name: '画布 4', order: 3, pinned: true, pinnedAt: 200 },
  ]
  const sorted = sortPersonalPagesByPin(pages)
  assert.deepEqual(sorted.map((p) => p.id), ['p4', 'p2', 'p1', 'p3'])
})

test('置顶的团队共享画布排在前面，按置顶时间倒序，未置顶保持原有顺序', () => {
  const canvases = [
    { id: 't1', name: '共享 1' },
    { id: 't2', name: '共享 2' },
    { id: 't3', name: '共享 3' },
  ]
  const pins = { t2: 1000, t3: 2000 }
  const sorted = sortTeamCanvasesByPin(canvases, pins)
  assert.deepEqual(sorted.map((c) => c.id), ['t3', 't2', 't1'])
})

test('togglePinPage 切换个人画布的置顶状态并记录 pinnedAt', () => {
  const store = useCanvasStore.getState()
  store.loadDocument({
    version: 2,
    pages: [
      { id: 'page-1', name: '画布 1', order: 0 },
      { id: 'page-2', name: '画布 2', order: 1 },
    ],
    activePageId: 'page-1',
    frames: [],
    images: [],
    texts: [],
  }, 1)

  store.togglePinPage('page-2')
  let p2 = useCanvasStore.getState().pages.find((p) => p.id === 'page-2')
  assert.equal(p2.pinned, true)
  assert.equal(typeof p2.pinnedAt, 'number')

  store.togglePinPage('page-2')
  p2 = useCanvasStore.getState().pages.find((p) => p.id === 'page-2')
  assert.equal(p2.pinned, false)
  assert.equal(p2.pinnedAt, undefined)
})

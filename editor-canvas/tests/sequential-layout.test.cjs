const assert = require('node:assert/strict')
const fs = require('node:fs')
const { beforeEach, test } = require('node:test')
const ts = require('typescript')

// Exercise the real Zustand actions without a browser or another test dependency.
const previousLoader = require.extensions['.ts']
require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  })
  module._compile(outputText, filename)
}
const { useCanvasStore, getSortedSequentialImages, getNextGridSlot } = require('../src/store/canvasStore.ts')
const { useHistoryStore } = require('../src/store/historyStore.ts')
if (previousLoader) require.extensions['.ts'] = previousLoader
else delete require.extensions['.ts']

const initialState = useCanvasStore.getInitialState()
const state = () => useCanvasStore.getState()
const orderedIds = () => getSortedSequentialImages(state().images, 'page-1').map((im) => im.id)
const image = (id, x, y, order, patch = {}) => ({
  id, pageId: 'page-1', x, y, width: 420, height: 560, rotation: 0,
  url: `/fixture/${id}.png`, naturalWidth: 420, naturalHeight: 560,
  meta: { designflowLayoutOrder: order, designflowLayoutAnchorX: 100, designflowLayoutAnchorY: 200 },
  ...patch,
})
const movedImages = () => [
  image('A', 560, 190, 1),
  image('B', 100, 205, 2),
  image('C', 1020, 198, 3),
  image('D', 100, 800, 4),
]

beforeEach(() => {
  useCanvasStore.setState({ ...initialState, frames: [], images: [] }, true)
  useHistoryStore.getState().clear()
})

test('manual tidy keeps the dragged order despite stale indices and slight row misalignment', () => {
  useCanvasStore.setState({ images: movedImages() })
  state().reflowSequentialImages('page-1', 'visual')
  assert.deepEqual(orderedIds(), ['B', 'A', 'C', 'D'])
  const byId = Object.fromEntries(state().images.map((im) => [im.id, im]))
  assert.equal(byId.B.x, 100)
  assert.equal(byId.A.x, 560)
  assert.equal(byId.A.y, byId.B.y)
  assert.equal(byId.D.x, 1480)
  assert.equal(byId.D.y, byId.B.y)
  assert.equal(byId.B.meta.designflowLayoutOrder, 1)
})

test('moving an image to a different row updates the reading order', () => {
  useCanvasStore.setState({ images: [image('A', 100, 800, 1), image('B', 560, 200, 2), image('C', 100, 200, 3)] })
  state().reflowSequentialImages('page-1', 'visual')
  assert.deepEqual(orderedIds(), ['C', 'B', 'A'])
})

test('automatic reflow still follows stored indices', () => {
  useCanvasStore.setState({ images: movedImages() })
  state().reflowSequentialImages('page-1')
  assert.deepEqual(orderedIds(), ['A', 'B', 'C', 'D'])
  assert.equal(state().images.find((im) => im.id === 'A').x, 100)
  assert.equal(useHistoryStore.getState().past.length, 0)
})

test('imported images append after the newly confirmed manual order', () => {
  useCanvasStore.setState({ images: movedImages() })
  state().reflowSequentialImages('page-1', 'visual')
  const added = state().insertImagesAuto([{ url: '/fixture/new.png', width: 420, height: 560 }])
  assert.deepEqual(orderedIds(), ['B', 'A', 'C', 'D', added[0].id])
  state().reflowSequentialImages('page-1')
  assert.deepEqual(orderedIds(), ['B', 'A', 'C', 'D', added[0].id])
})

test('locked, framed, extracted, excluded and other-page images stay untouched', () => {
  const excluded = [
    image('locked', -1000, -1000, 1, { locked: true }),
    image('framed', -900, -1000, 2, { frameId: 'frame-1' }),
    image('extracted', -800, -1000, 3, { meta: { layerExtractFrom: 'source' } }),
    image('excluded', -700, -1000, 4, { meta: { designflowLayoutExcluded: true } }),
    image('other-page', -600, -1000, 5, { pageId: 'page-2' }),
  ]
  useCanvasStore.setState({ images: [...excluded, ...movedImages()] })
  state().reflowSequentialImages('page-1', 'visual')
  assert.deepEqual(state().images.slice(0, excluded.length), excluded)
  assert.deepEqual(orderedIds(), ['B', 'A', 'C', 'D'])
})

test('one undo restores the exact arrangement before manual tidy', () => {
  const before = movedImages()
  useCanvasStore.setState({ images: before })
  state().reflowSequentialImages('page-1', 'visual')
  assert.equal(useHistoryStore.getState().past.length, 1)
  const snapshot = useHistoryStore.getState().undo(state().getDocument())
  state().restoreHistoryDocument(snapshot)
  assert.deepEqual(state().images, before)
})

test('repeated tidy preserves the order across multiple 80-image blocks', () => {
  const images = Array.from({ length: 165 }, (_, i) => {
    const block = Math.floor(i / 80)
    const col = i % 4
    const row = Math.floor((i % 80) / 4)
    const width = i % 2 === 0 ? 420 : 280
    return image(`image-${i}`, 100 + block * 1840 + col * 460 + (420 - width) / 2, 200 + row * 600, i + 1, { width, naturalWidth: width })
  })
  // Swap two items in the second block while keeping their old metadata.
  const firstX = images[80].x
  images[80] = { ...images[80], x: images[81].x - 70 }
  images[81] = { ...images[81], x: firstX + 70, y: images[81].y + 12 }
  useCanvasStore.setState({ images: images.slice().reverse() })
  const expected = images.map((im) => im.id)
  ;[expected[80], expected[81]] = [expected[81], expected[80]]
  state().reflowSequentialImages('page-1', 'visual')
  assert.deepEqual(orderedIds(), expected)
  const once = structuredClone(state().images)
  state().reflowSequentialImages('page-1', 'visual')
  assert.deepEqual(state().images, once)
})

test('an empty eligible set does not dirty the document or add undo history', () => {
  useCanvasStore.setState({ images: [image('locked', 0, 0, 1, { locked: true })] })
  state().reflowSequentialImages('page-1', 'visual')
  assert.equal(state().isDirty, false)
  assert.equal(useHistoryStore.getState().past.length, 0)
})

// 网格格子：锚点 (100, 200)，格子 420×560，间距 40
const cell = (col, row) => ({ x: 100 + col * 460, y: 200 + row * 600 })
const gridImage = (id, order) => {
  const { x, y } = cell((order - 1) % 4, Math.floor((order - 1) / 4))
  return image(id, x, y, order)
}

test('生成结果排到网格最后：第 4 张放在第一行末尾，第 5 张换行', () => {
  const three = [gridImage('A', 1), gridImage('B', 2), gridImage('C', 3)]
  const fourth = getNextGridSlot(three, [], 'page-1', 420, 560)
  assert.deepEqual({ x: fourth.x, y: fourth.y, order: fourth.order }, { ...cell(3, 0), order: 4 })

  const four = [...three, gridImage('D', 4)]
  const fifth = getNextGridSlot(four, [], 'page-1', 420, 560)
  assert.deepEqual({ x: fifth.x, y: fifth.y, order: fifth.order }, { ...cell(0, 1), order: 5 })
})

test('生成结果只算新图位置，不移动已有图片；格子被拖过来的图占住时顺延', () => {
  // 用户把 X 拖到了第 5 格的位置（没有排布序号）
  const images = [gridImage('A', 1), gridImage('B', 2), gridImage('C', 3), gridImage('D', 4),
    image('X', cell(0, 1).x + 30, cell(0, 1).y + 20, undefined, { meta: {} })]
  const before = JSON.stringify(images)
  const slot = getNextGridSlot(images, [], 'page-1', 420, 560)
  assert.deepEqual({ x: slot.x, y: slot.y, order: slot.order }, { ...cell(1, 1), order: 6 })
  assert.equal(JSON.stringify(images), before)
})

test('横图按格子等比缩小并水平居中，连续追加的视角依次排开', () => {
  let images = [gridImage('A', 1)]
  const slots = []
  for (const id of ['L', 'R', 'B']) {
    const slot = getNextGridSlot(images, [], 'page-1', 1536, 1024)
    slots.push(slot)
    images = [...images, image(id, slot.x, slot.y, slot.order, { width: slot.width, height: slot.height })]
  }
  assert.deepEqual(slots.map((s) => [s.order, s.width, s.height]), [[2, 420, 280], [3, 420, 280], [4, 420, 280]])
  assert.deepEqual(slots.map((s) => s.x), [cell(1, 0).x, cell(2, 0).x, cell(3, 0).x])
})


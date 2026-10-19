const assert = require('node:assert/strict')
const fs = require('node:fs')
const { test } = require('node:test')
const ts = require('typescript')

const filename = require.resolve('../src/utils/outpainting.ts')
const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const loaded = { exports: {} }
new Function('module', 'exports', source)(loaded, loaded.exports)
const { getOutpaintingPlan: plan, DEFAULT_OUTPAINTING_LIMITS: limits } = loaded.exports

const image = (width = 512, height = 512) => ({ width, height, naturalWidth: width, naturalHeight: height })
const margins = (patch = {}) => ({ top: 0, right: 10, bottom: 0, left: 0, ...patch })

test('uses physical pixels for both the displayed result and request margins', () => {
  const initial = { ...image(320, 320), naturalWidth: 1024, naturalHeight: 1024 }
  const result = plan({ ...initial, width: 160, height: 160 }, initial, margins({ top: 20 }))
  assert.equal(result.error, null)
  assert.deepEqual([result.processingWidth, result.processingHeight, result.outputWidth, result.outputHeight], [512, 512, 544, 576])
  assert.deepEqual(result.margins, { top: 64, right: 32, bottom: 0, left: 0 })
})

test('does not independently clamp source dimensions and distort its aspect ratio', () => {
  const initial = image(100, 50)
  const result = plan({ ...initial, width: 50, height: 25 }, initial, margins({ right: 20, bottom: 40 }))
  assert.deepEqual([result.processingWidth, result.processingHeight], [50, 25])
  assert.match(result.error, /每边至少 64px/)
  assert.equal(plan({ ...initial, width: 50, height: 25 }, initial, margins({ right: 20, bottom: 40 }), 'high').error, null)
})

test('fast rejects references above 8:1 while high accepts valid output geometry', () => {
  assert.match(plan(image(1025, 128), null, margins()).error, /8:1/)
  assert.equal(plan(image(1024, 128), null, margins()).error, null)
  assert.equal(plan(image(1025, 128), null, margins(), 'high').error, null)
})

test('fast reserves padding headroom and high retains the full output budget', () => {
  assert.equal(plan(image(1900, 1900), null, margins({ right: 100 })).error, null)
  assert.match(plan(image(1900, 1900), null, margins({ right: 101 })).error, /安全上限 3.80MP/)
  assert.equal(plan(image(1900, 1900), null, margins({ right: 101 }), 'high').error, null)
  assert.equal(plan(image(1920, 1920), null, margins({ top: 64, right: 64, bottom: 64, left: 64 }), 'high').error, null)
})

test('both modes reject excessive physical dimensions and total pixels', () => {
  for (const mode of ['fast', 'high']) {
    assert.match(plan(image(4096, 512), null, margins(), mode).error, /4096/)
    assert.match(plan(image(2048, 2048), null, margins(), mode).error, /4.19MP/)
  }
})

test('both modes block empty or rounded-away expansion', () => {
  assert.match(plan(image(), null, margins({ right: 0 })).error, /至少扩展 1px/)
  const initial = { ...image(1000, 1000), naturalWidth: 100, naturalHeight: 100 }
  assert.match(plan(initial, initial, margins({ right: 1 })).error, /至少扩展 1px/)
})

test('rejects invalid dimensions and margins before a request can be built', () => {
  for (const value of [NaN, Infinity, -1]) {
    assert.ok(plan(image(), null, margins({ right: value })).error)
  }
  for (const value of [NaN, Infinity, 0, -1]) {
    assert.ok(plan({ ...image(), width: value }, null, margins()).error)
  }
})

test('respects stricter configured output limits', () => {
  assert.match(plan(image(), null, margins(), 'high', { ...limits, maxWidth: 520 }).error, /520/)
  assert.match(plan(image(), null, margins(), 'high', { ...limits, maxAreaPixels: 260_000 }).error, /0.26MP/)
})

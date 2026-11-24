const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')

const source = ts.transpileModule(fs.readFileSync(require.resolve('../src/utils/detailRepair.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const context = { exports: {}, require: () => ({}), Math }
vm.runInNewContext(source, context)
const dr = context.exports

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`)
const src = { url: 'blob:x', file: null, sourceUrl: '/ai-images/u/p.png' }

test('新图层放在原图中心，长边约为原图短边的 35%', () => {
  const p = dr.createPatch({ width: 400, height: 600 }, { width: 200, height: 100 }, src)
  near(p.cx, 200)
  near(p.cy, 300)
  near(p.crop.width * p.scale, 140)
  assert.deepEqual({ ...p.crop }, { x: 0, y: 0, width: 200, height: 100 })
  const at = dr.createPatch({ width: 400, height: 600 }, { width: 200, height: 100 }, src, { x: 10, y: 20 })
  near(at.cx, 10)
  near(at.cy, 20)
})

test('画布坐标转局部坐标会抵消原图旋转', () => {
  const target = { x: 100, y: 100, width: 200, height: 100, rotation: 90 }
  // 旋转 90° 后，原图左上角在画布上位于 (250, 50)
  const local = dr.canvasToLocal({ x: 250, y: 50 }, target)
  near(local.x, 0)
  near(local.y, 0)
  assert.equal(dr.isInsideTarget(dr.canvasToLocal({ x: 200, y: 150 }, target), target), true)
  assert.equal(dr.isInsideTarget(dr.canvasToLocal({ x: 0, y: 0 }, target), target), false)
})

test('裁切时图案内容在原图上的位置不变', () => {
  const p = { ...dr.createPatch({ width: 400, height: 400 }, { width: 100, height: 100 }, src), rotation: 90, scale: 2 }
  // 裁掉左半边：裁切中心在图案坐标里右移 25px，图案顺时针转 90° 后在原图上是向下 50
  const cropped = dr.applyCrop(p, { x: 50, y: 0, width: 50, height: 100 })
  near(cropped.cx, p.cx)
  near(cropped.cy, p.cy + 50)
  assert.deepEqual({ ...cropped.crop }, { x: 50, y: 0, width: 50, height: 100 })
})

test('裁切框不越界，也不小于最小尺寸', () => {
  assert.deepEqual({ ...dr.clampCrop({ x: -10, y: 90, width: 500, height: 2 }, { width: 100, height: 100 }) },
    { x: 0, y: 90, width: 100, height: 8 })
})

test('局部位移换算到图案像素', () => {
  const p = { ...dr.createPatch({ width: 400, height: 400 }, { width: 100, height: 100 }, src), rotation: 90, scale: 2 }
  const d = dr.localDeltaToPatch(0, 20, p)
  near(d.x, 10)
  near(d.y, 0)
})

test('提交参数换算成原图像素', () => {
  const p = { ...dr.createPatch({ width: 400, height: 300 }, { width: 100, height: 50 }, src), cx: 100, cy: 150, scale: 1.5, rotation: 30 }
  const out = dr.toSourcePlacement(p, { width: 400, height: 300 }, { width: 1600, height: 1200 })
  near(out.center_x, 400)
  near(out.center_y, 600)
  near(out.width, 600)
  near(out.height, 300)
  assert.equal(out.rotation, 30)
})

test('角度归一与是否有涂抹', () => {
  assert.equal(dr.normalizeAngle(270), -90)
  assert.equal(dr.normalizeAngle(-190), 170)
  assert.equal(dr.hasPaint([{ points: [{ x: 1, y: 1 }], size: 4, erase: true }]), false)
  assert.equal(dr.hasPaint([{ points: [{ x: 1, y: 1 }], size: 4, erase: false }]), true)
})

test('笔迹按倍数画出，擦除用 destination-out', () => {
  const calls = []
  const ctx = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : (...args) => calls.push([k, ...args])),
    set: (t, k, v) => { t[k] = v; if (k === 'globalCompositeOperation') calls.push(['op', v]); return true },
  })
  dr.drawStrokes(ctx, [
    { points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], size: 5, erase: false },
    { points: [{ x: 1, y: 1 }], size: 2, erase: true },
  ], 2, '#fff')
  assert.deepEqual(calls.filter((c) => c[0] === 'moveTo' || c[0] === 'lineTo'), [['moveTo', 2, 4], ['lineTo', 6, 8]])
  assert.deepEqual(calls.filter((c) => c[0] === 'op').map((c) => c[1]), ['source-over', 'destination-out', 'source-over'])
  assert.deepEqual(calls.find((c) => c[0] === 'arc').slice(1, 4), [2, 2, 2])
})

test('缩放比例受最小和最大上限约束', () => {
  const crop = { width: 100, height: 50 }
  const target = { width: 400, height: 600 }
  // 最大边长 = 600 * 3 = 1800 -> maxScale = 1800 / 100 = 18
  near(dr.clampPatchScale(999, crop, target), 18)
  near(dr.clampPatchScale(0.0001, crop, target), 0.04)
  near(dr.clampPatchScale(Number.NaN, crop, target), 0.04)
  near(dr.clampPatchScale(2.5, crop, target), 2.5)
})

test('修复模式保留快捷编辑标记坐标，无标记时保持原样', () => {
  assert.equal(dr.formatRepairPromptWithMarkers('  颜色偏亮  ', []), '颜色偏亮')
  const out = dr.formatRepairPromptWithMarkers('<标记1> 改红，<标记2> 去污', [
    {
      id: 'm2',
      number: 2,
      type: 'point',
      ratioX: 0.25,
      ratioY: 0.5,
      pixelX: 250,
      pixelY: 500,
    },
    {
      id: 'm1',
      number: 1,
      type: 'rect',
      ratioX: 0.1,
      ratioY: 0.2,
      ratioWidth: 0.3,
      ratioHeight: 0.4,
      pixelX: 100,
      pixelY: 200,
      pixelWidth: 300,
      pixelHeight: 400,
    },
  ])
  assert.ok(out.startsWith('<标记1> 改红，<标记2> 去污\n\n[参考图标记位置'))
  const i1 = out.indexOf('- <标记1> [选框区域]: 左上角 (x: 10%, y: 20%), 宽高 (w: 30%, h: 40%), 归一化选框 [ymin: 200, xmin: 100, ymax: 600, xmax: 400]')
  const i2 = out.indexOf('- <标记2> [坐标点]: 坐标 (x: 25%, y: 50%), 归一化坐标 (250, 500)')
  assert.ok(i1 > 0 && i2 > i1, out)
})

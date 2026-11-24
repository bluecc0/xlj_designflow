const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')

const compiled = ts.transpileModule(
  fs.readFileSync(require.resolve('../src/utils/pendingPlaceholders.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText
const context = { exports: {} }
vm.runInNewContext(compiled, context)
const { applyPendingImagesUpdate, applyInsertImagesToPending } = context.exports

test('并发任务 A 完成并交付 insert-image 时，保留仍在运行的任务 B 占位', () => {
  const bItems = [
    { id: 'agent-b-0', label: 'B1', aspectRatio: '1:1' },
    { id: 'agent-b-1', label: 'B2', aspectRatio: '1:1' },
  ]
  // 主界面先同步只剩 B 的 pending 列表，随后交付 A 的 insert-image
  const afterPending = applyPendingImagesUpdate(
    [{ id: 'agent-a-0', previewUrl: '/output/a0.png' }, ...bItems],
    bItems,
    1000,
    0
  )
  assert.equal(afterPending.scheduleClear, false)
  assert.deepEqual(afterPending.nextItems.map((x) => x.id), ['agent-b-0', 'agent-b-1'])

  const afterInsert = applyInsertImagesToPending(afterPending.nextItems, ['/output/a0.png'], false)
  assert.deepEqual(afterInsert.nextItems.map((x) => x.id), ['agent-b-0', 'agent-b-1'])
  assert.equal(afterInsert.resetAnchor, true)
})

test('等待生图期间插入其他来源图片，不会清空正在运行的生图占位', () => {
  const running = [{ id: 'ai-1-0', label: 'gpt-image-2.6', aspectRatio: '1:1' }]
  const afterInsert = applyInsertImagesToPending(running, ['/products/sku-123.png'], false)
  assert.deepEqual(afterInsert.nextItems, running)
  assert.equal(afterInsert.resetAnchor, true)
})

test('insert-image 若先于 pending 同步到达，只移除匹配 previewUrl 的槽位并保留其余任务', () => {
  const mixed = [
    { id: 'agent-a-0', previewUrl: '/output/a0.png' },
    { id: 'agent-b-0', label: 'B1' },
  ]
  const afterInsert = applyInsertImagesToPending(mixed, ['/output/a0.png'], false)
  assert.deepEqual(afterInsert.nextItems.map((x) => x.id), ['agent-b-0'])
})

test('最后一个任务完成：pending 先清空进入缓冲，紧随其后的 insert-image 立即无缝清空', () => {
  const running = [{ id: 'ai-1-0', label: 'gpt-image-2.6' }]
  const afterEmpty = applyPendingImagesUpdate(running, [], 2000, 0)
  assert.equal(afterEmpty.scheduleClear, true)
  assert.deepEqual(afterEmpty.nextItems, running)

  const afterInsert = applyInsertImagesToPending(afterEmpty.nextItems, ['/output/final.png'], true)
  assert.deepEqual(Array.from(afterInsert.nextItems), [])
  assert.equal(afterInsert.cancelClearTimer, true)
  assert.equal(afterInsert.resetAnchor, true)
})

test('最后一个任务完成：insert-image 先到达，随后 pending 空列表到达时立即清空不再延迟', () => {
  const running = [{ id: 'ai-1-0', label: 'gpt-image-2.6' }]
  const afterEmpty = applyPendingImagesUpdate(running, [], 2050, 2000)
  assert.deepEqual(Array.from(afterEmpty.nextItems), [])
  assert.equal(afterEmpty.scheduleClear, false)
  assert.equal(afterEmpty.resetAnchor, true)
})

const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')

const source = ts.transpileModule(fs.readFileSync(require.resolve('../src/utils/canvasTask.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const context = { exports: {}, require: () => ({}) }
vm.runInNewContext(source, context)
const { sameCanvasSource, submitWithPlaceholder } = context.exports

// 和 App 里一样：任务列表里有运行中的任务就不允许切换画布
function harness() {
  const tasks = []
  let source = { kind: 'personal' }
  return {
    tasks,
    get source() { return source },
    busy: () => tasks.some((t) => t.status === 'running'),
    switchTo(next) { if (this.busy()) return false; source = next; return true },
    forceSwitch(next) { source = next },  // 团队画布被取消分享时会强制回到个人画布
    register: (id) => () => tasks.push({ id, status: 'running' }),
    release: (id) => () => tasks.splice(tasks.findIndex((t) => t.id === id), 1),
  }
}

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

test('提交还没返回时已占用画布，不能切换到另一份画布', async () => {
  const h = harness()
  const submit = deferred()
  const pending = submitWithPlaceholder(h.register('t1'), h.release('t1'), () => submit.promise)
  assert.equal(h.tasks.length, 1)
  assert.equal(h.switchTo({ kind: 'team', id: 'shared' }), false)
  assert.deepEqual(h.source, { kind: 'personal' })
  submit.resolve({ jobIds: ['j1'] })
  assert.deepEqual(await pending, { jobIds: ['j1'] })
  assert.equal(h.tasks.length, 1)  // 提交成功后任务继续运行，直到结果放回画布
})

test('提交失败释放占位任务，错误照常抛给弹窗', async () => {
  const h = harness()
  await assert.rejects(
    submitWithPlaceholder(h.register('t1'), h.release('t1'), async () => { throw new Error('上传失败') }),
    /上传失败/,
  )
  assert.equal(h.tasks.length, 0)
  assert.equal(h.switchTo({ kind: 'team', id: 'shared' }), true)
})

test('结果只放回发起任务时的那份画布', () => {
  const personal = { kind: 'personal' }
  assert.equal(sameCanvasSource(personal, { kind: 'personal' }), true)
  assert.equal(sameCanvasSource({ kind: 'team', id: 'a' }, { kind: 'team', id: 'a' }), true)
  assert.equal(sameCanvasSource({ kind: 'team', id: 'a' }, { kind: 'team', id: 'b' }), false)
  assert.equal(sameCanvasSource(personal, { kind: 'team', id: 'a' }), false)
  assert.equal(sameCanvasSource({ kind: 'team', id: 'a' }, personal), false)

  // 忙碌检查拦不住的强制切换：结果回来时画布已不同，不能放进当前画布
  const h = harness()
  const origin = { kind: 'team', id: 'shared' }
  h.forceSwitch(origin)
  const startedOn = h.source
  h.forceSwitch({ kind: 'personal' })
  assert.equal(sameCanvasSource(startedOn, h.source), false)
})

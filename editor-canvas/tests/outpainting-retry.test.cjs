const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')

const source = ts.transpileModule(fs.readFileSync(require.resolve('../src/services/aiImageService.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

const response = (data, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => data,
  text: async () => typeof data === 'string' ? data : JSON.stringify(data),
})
const done = () => response({ status: 'done', image_url: '/original-result.png' })
const failed = (retryAction = 'resubmit') => response({
  status: 'failed', error: '扩图服务连接失败', outpainting: { retry_action: retryAction },
})

function harness(handler, { imageFailures = 0, abortSubmissions = false, abortPolls = false } = {}) {
  const calls = [], messages = [], imageUrls = [], delays = [], timers = new Map()
  let clock = 0, nextTimer = 0, uuid = 0
  const context = {
    exports: {}, Error, AbortController,
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}` },
    Date: class extends Date { static now() { return clock } },
    setTimeout(callback, delay) {
      const id = ++nextTimer
      timers.set(id, callback)
      if (delay < 30_000 || (abortSubmissions && delay === 120_000) || (abortPolls && delay === 30_000)) {
        delays.push(delay)
        queueMicrotask(() => {
          if (!timers.delete(id)) return
          clock += delay
          callback()
        })
      }
      return id
    },
    clearTimeout(id) { timers.delete(id) },
    fetch: async (url, options = {}) => {
      const call = { url, ...options }
      calls.push(call)
      return handler(call, calls)
    },
    Image: class {
      naturalWidth = 1200
      naturalHeight = 800
      set src(url) {
        imageUrls.push(url)
        queueMicrotask(() => imageUrls.length <= imageFailures ? this.onerror() : this.onload())
      }
    },
  }
  vm.runInNewContext(source, context)
  return {
    calls, messages, imageUrls, delays,
    posts: () => calls.filter(call => call.method === 'POST'),
    polls: () => calls.filter(call => !call.method),
    poll: (timeoutSeconds) => context.exports.pollJob('job-original', timeoutSeconds),
    run: (mode = 'fast') => context.exports.runOutpainting(
      '/source.png', 512, 512, { top: 64, right: 96, bottom: 0, left: 0 },
      (message) => messages.push(message), mode,
    ),
  }
}

test('提交断网两次后第三次成功，复用请求号并保留 high 模式和扩图参数', async () => {
  let submits = 0
  const h = harness(call => {
    if (call.method !== 'POST') return done()
    if (++submits < 3) throw new TypeError('Failed to fetch')
    return response({ job_id: 'job-original' })
  })
  const result = await h.run('high')
  assert.equal(result.width, 1200)
  assert.equal(result.height, 800)
  assert.equal(h.posts().length, 3)
  const bodies = h.posts().map(call => JSON.parse(call.body))
  assert.equal(new Set(bodies.map(body => body.client_request_id)).size, 1)
  bodies.forEach(body => {
    assert.equal(body.mode, 'high')
    assert.deepEqual(body.outpaint, { top: 64, right: 96, bottom: 0, left: 0 })
    assert.deepEqual([body.processing_width, body.processing_height], [512, 512])
  })
  h.posts().forEach(call => assert.equal(call.headers['X-Client-Request-Id'], bodies[0].client_request_id))
  assert.ok(h.messages.some(message => message.includes('2/3')))
  assert.ok(h.messages.some(message => message.includes('3/3')))
})

test('提交连续失败只请求三次，最后保留失败原因', async () => {
  const h = harness(() => { throw new TypeError('网络断开') })
  await assert.rejects(h.run(), /已尝试 3 次仍未成功：网络断开/)
  assert.equal(h.posts().length, 3)
  assert.equal(h.polls().length, 0)
})

test('提交暂时性 HTTP 错误复用幂等号重试', async () => {
  let submits = 0
  const h = harness(call => call.method !== 'POST' ? done()
    : ++submits < 3 ? response('网关暂时不可用', 503) : response({ job_id: 'job-original' }))
  await h.run()
  assert.equal(h.posts().length, 3)
  assert.equal(new Set(h.posts().map(call => JSON.parse(call.body).client_request_id)).size, 1)
})

test('提交超时会中止请求并重试，共三次', async () => {
  const h = harness(call => new Promise((resolve, reject) => {
    call.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  }), { abortSubmissions: true })
  await assert.rejects(h.run(), /已尝试 3 次仍未成功：扩图提交超时/)
  assert.equal(h.posts().length, 3)
  assert.ok(h.posts().every(call => call.signal.aborted))
})

test('轮询断网后继续原任务，不重复生成', async () => {
  let polls = 0
  const h = harness(call => {
    if (call.method === 'POST') return response({ job_id: 'job-original' })
    if (++polls < 3) throw new TypeError('Failed to fetch')
    return done()
  })
  await h.run()
  assert.equal(h.posts().length, 1)
  assert.equal(h.polls().length, 3)
  assert.ok(h.polls().every(call => call.url === '/ai-image/job-original'))
})

test('轮询连续网关错误达到三次后报错，不新建任务', async () => {
  const h = harness(call => call.method === 'POST' ? response({ job_id: 'job-original' }) : response('Bad gateway', 502))
  await assert.rejects(h.run(), /已尝试 3 次仍未成功.*HTTP 502/)
  assert.equal(h.posts().length, 1)
  assert.equal(h.polls().length, 3)
})

test('轮询请求或响应体超时都会中止，共尝试三次并保留原任务', async () => {
  for (const stalledBody of [false, true]) {
    const h = harness(call => {
      if (call.method === 'POST') return response({ job_id: 'job-original' })
      const pending = () => new Promise((resolve, reject) => {
        if (call.signal.aborted) return reject(new Error('aborted'))
        call.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
      return stalledBody ? { ok: true, json: pending } : pending()
    }, { abortPolls: true })
    await assert.rejects(h.run(), /已尝试 3 次仍未成功：查询扩图任务超时/)
    assert.equal(h.posts().length, 1)
    assert.equal(h.polls().length, 3)
    assert.ok(h.polls().every(call => call.signal.aborted))
  }
})

test('服务端明确允许重新生成时，第三次可成功', async () => {
  let submits = 0
  const h = harness(call => call.method === 'POST' ? response({ job_id: `job-${++submits}` })
    : submits < 3 ? failed() : done())
  await h.run()
  assert.equal(h.posts().length, 3)
  assert.equal(new Set(h.posts().map(call => JSON.parse(call.body).client_request_id)).size, 3)
  assert.deepEqual(h.polls().map(call => call.url), ['/ai-image/job-1', '/ai-image/job-2', '/ai-image/job-3'])
})

test('连续三个任务失败后报错，不发起第四个任务', async () => {
  let submits = 0
  const h = harness(call => call.method === 'POST' ? response({ job_id: `job-${++submits}` }) : failed())
  await assert.rejects(h.run(), /已尝试 3 次仍未成功：扩图服务连接失败/)
  assert.equal(h.posts().length, 3)
  assert.equal(h.polls().length, 3)
})

test('网络失败和任务失败共用三次尝试上限', async () => {
  let submits = 0
  const h = harness(call => {
    if (call.method === 'POST') {
      if (++submits === 1) throw new TypeError('网络断开')
      return response({ job_id: `job-${submits}` })
    }
    return failed()
  })
  await assert.rejects(h.run(), /已尝试 3 次仍未成功/)
  assert.equal(h.posts().length, 3)
  const ids = h.posts().map(call => JSON.parse(call.body).client_request_id)
  assert.equal(ids[0], ids[1])
  assert.notEqual(ids[1], ids[2])
})

test('参数、鉴权等永久性错误立即报错', async () => {
  for (const status of [400, 401, 402, 403, 422]) {
    const h = harness(() => response('请求需要调整', status))
    await assert.rejects(h.run(), /请求需要调整/)
    assert.equal(h.posts().length, 1)
  }
  const h = harness(call => call.method === 'POST' ? response({ job_id: 'job-original' }) : failed('none'))
  await assert.rejects(h.run(), /扩图服务连接失败/)
  assert.equal(h.posts().length, 1)
})

test('受理未知、原任务轮询或下载失败，以及旧版 retryable 均不重新生成', async () => {
  for (const metadata of [
    { retry_action: 'submission_unknown', retryable: true },
    { retry_action: 'poll', retryable: true },
    { retry_action: 'download', retryable: true },
    { retry_action: 'none', retryable: true },
    { retryable: true },
    {},
  ]) {
    const h = harness(call => call.method === 'POST' ? response({ job_id: 'job-original' }) : response({
      status: 'failed', error: '保留原任务，请核查状态', outpainting: metadata,
    }))
    await assert.rejects(h.run(), /保留原任务，请核查状态/)
    assert.equal(h.posts().length, 1)
    assert.equal(h.polls().length, 1)
  }
})

test('后台恢复原任务时持续轮询，展示恢复次数并保留任务号', async () => {
  let polls = 0
  const h = harness(call => call.method === 'POST' ? response({ job_id: 'job-original' })
    : ++polls < 3 ? response({ status: 'processing', message: `正在恢复原扩图任务（第 ${polls + 1}/3 次尝试）` }) : done())
  await h.run()
  assert.equal(h.posts().length, 1)
  assert.ok(h.polls().every(call => call.url === '/ai-image/job-original'))
  assert.ok(h.messages.some(message => message.includes('恢复原扩图任务（第 3/3')))
})

test('恢复期间延长原任务的查询等待，不因原先的前端计时中断', async () => {
  let polls = 0
  const h = harness(() => ++polls < 6
    ? response({ status: 'processing', recovering: true, message: '正在恢复任务…' }) : done())
  const result = await h.poll(2)
  assert.equal(result.image_url, '/original-result.png')
  assert.equal(h.posts().length, 0)
  assert.equal(h.polls().length, 6)
})

test('恢复等待保留总时限，始终只查询原任务', async () => {
  const h = harness(() => response({ status: 'processing', recovering: true }))
  await assert.rejects(h.poll(2), /任务超时/)
  assert.equal(h.posts().length, 0)
  assert.equal(h.polls().length, 3600)
})

test('结果图读取失败仅重试加载原结果，不重复提交或轮询', async () => {
  const h = harness(call => call.method === 'POST' ? response({ job_id: 'job-original' }) : done(), { imageFailures: 2 })
  await h.run()
  assert.equal(h.posts().length, 1)
  assert.equal(h.polls().length, 1)
  assert.deepEqual(h.imageUrls, ['/original-result.png', '/original-result.png', '/original-result.png'])
})

test('处理中任务轮询超时后继续查询原任务，三次后停止', async () => {
  const h = harness(call => call.method === 'POST' ? response({ job_id: 'job-original' }) : response({ status: 'processing' }))
  await assert.rejects(h.run(), /已尝试 3 次仍未成功：任务超时/)
  assert.equal(h.posts().length, 1)
  assert.equal(h.polls().length, 900)
})

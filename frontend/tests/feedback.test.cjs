const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const feedback = require('../src/feedback.js');

test('HTTP and nested validation responses explain a cause without exposing response bodies', () => {
  assert.match(feedback.responseError(401, '{"detail":"Unauthorized"}').message, /登录已失效/);
  assert.match(feedback.responseError(413, '<html>Payload Too Large</html>').message, /过大/);
  assert.match(feedback.responseError(422, JSON.stringify({ detail: [{ loc: ['body', 'prompt'], msg: 'Field required' }] })).message, /请检查提示词/);
  assert.equal(feedback.message('HTTP 400: {"detail":{"message":"请选择有效的图片比例"}}'), '请选择有效的图片比例');
  const error = feedback.responseError(503, 'upstream password=secret stack trace');
  assert.equal(error.httpStatus, 503);
  assert.equal(error.diagnostic, 'upstream password=secret stack trace');
  assert.doesNotMatch(error.message, /secret|503|upstream/i);
});

test('known service causes have distinct guidance and never imply the user is logged out', () => {
  for (const [raw, expected] of [
    ['HTTP 401 invalid API_KEY', /服务配置/],
    ['APIMart insufficient quota', /额度不足/],
    ['content_policy_violation', /内容审核/],
    ['HTTP 429 too many requests', /人数较多/],
    ['Failed to fetch', /连接暂时中断/],
  ]) assert.match(feedback.message(raw), expected);
  assert.doesNotMatch(feedback.message('HTTP 403 permission denied。请检查账户余额或权限'), /额度不足/);
});

test('uncertain acceptance and completed images never advise another generation', () => {
  for (const raw of ['提交后受理状态暂无法确认，避免重复扣费', '轮询总时限超时', '图片已生成，但结果写入失败', '结果下载失败：FinalImageDownloadError']) {
    const message = feedback.message(raw);
    assert.match(message, /任务记录/);
    assert.doesNotMatch(message, /路由|轮询|上游|重新生成|重新提交|重试/);
  }
});

test('partial batch failures preserve counts and the actual cause through notification rendering', () => {
  const cases = [
    ['APIMart insufficient quota', '图片服务额度不足，请联系管理员处理后再试。'],
    ['content_policy_violation', '提示词或参考图未通过内容审核，请调整内容后再试。'],
    ['HTTP 429 too many requests', '当前使用人数较多，请稍后再试。'],
    ['提交后受理状态暂无法确认，避免重复扣费', '暂时无法确认任务是否已提交，请先查看任务记录，避免重复提交。'],
    ['图片已生成，但结果写入失败', '图片已生成，结果暂未完整保存。请保留当前页面，稍后查看任务记录。'],
    ['upstream Exception: secret', '操作未完成，暂时无法确认原因，请稍后再试。'],
  ];
  for (const [cause, reason] of cases) {
    const expected = '已生成 1 张，1 张未完成。' + reason;
    const batch = { kind: 'batch-generation', successCount: 1, failureCount: 1, cause };
    assert.equal(feedback.message(batch), expected);
    // Formatting the displayed summary again must preserve both counts and reason.
    assert.equal(feedback.message(expected), expected);
    const { root, hosts } = browserHarness();
    root.dfError(batch);
    assert.equal(hosts[0].children[1].textContent, expected);
  }
  assert.equal(
    feedback.message('已生成 2 张，3 张未完成。APIMart insufficient quota'),
    '已生成 2 张，3 张未完成。图片服务额度不足，请联系管理员处理后再试。'
  );
});

test('safe validation and unsaved work guidance are preserved', () => {
  assert.equal(feedback.message('请选择 PNG、JPG 或 WebP 图片。'), '请选择 PNG、JPG 或 WebP 图片。');
  assert.match(feedback.message('画布暂时无法保存，本地修改已保留，请勿刷新或关闭页面'), /本地修改已保留.*请勿刷新/);
  assert.equal(feedback.message('HTTP 500: {"detail":"internal VLM error"}', '图片暂时无法分析，请稍后重试。'), '图片暂时无法分析，请稍后重试。');
});

function storeHarness() {
  let id = 0;
  const scheduled = new Map();
  const store = feedback.createStore(() => {}, (fn) => { scheduled.set(++id, fn); return id; }, key => scheduled.delete(key));
  return { store, scheduled };
}

test('repeated polling errors are coalesced and do not extend their expiry', () => {
  const { store, scheduled } = storeHarness();
  const key = store.show('图片暂时无法读取，请稍后再试。');
  for (let i = 0; i < 20; i++) store.show('图片暂时无法读取，请稍后再试。');
  assert.equal(store.snapshot().length, 1);
  assert.equal(scheduled.size, 1);
  store.resolve(key);
  store.show('图片暂时无法读取，请稍后再试。');
  assert.equal(store.snapshot().length, 0);
});

test('persistent conditions survive other feedback, update in place, and resolve on recovery', () => {
  const { store, scheduled } = storeHarness();
  store.show('网络已断开，正在等待重连…', { key: 'connection', tone: 'info', persistent: true });
  store.show('画布尚未保存，请保留当前页面', { key: 'save', persistent: true });
  store.show('已完成', { tone: 'ok' });
  for (const fn of scheduled.values()) fn();
  assert.equal(store.snapshot().length, 2);
  store.show('正在恢复任务状态…', { key: 'connection', tone: 'info', persistent: true });
  assert.equal(store.snapshot().length, 2);
  store.resolve('connection');
  assert.deepEqual(store.snapshot().map(item => item.key), ['save']);
  store.clear();
  assert.equal(store.snapshot().length, 0);
});

test('uncertain submissions stay visible until dismissed', () => {
  const { store, scheduled } = storeHarness();
  store.show('暂时无法确认任务是否已提交，请先查看任务记录，避免重复提交。');
  assert.equal(scheduled.size, 0);
  assert.equal(store.snapshot()[0].persistent, true);
});

function browserHarness(parentOrigin) {
  const hosts = [];
  function element(tag) {
    return { tag, style: {}, children: [], setAttribute() {}, appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; } };
  }
  const root = {
    location: { origin: 'http://designflow.test' },
    document: { body: { appendChild(host) { hosts.push(host); } }, createElement: element },
  };
  const parentCalls = [];
  root.parent = parentOrigin ? {
    location: { origin: parentOrigin },
    DesignflowFeedback: { showLocal: (...args) => parentCalls.push(args), resolveLocal() {}, clearLocal() {} },
  } : root;
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/feedback.js'), 'utf8'), { window: root, setTimeout() { return 1; }, clearTimeout() {} });
  return { root, hosts, parentCalls };
}

test('same-origin canvas forwards feedback to the parent without a second host', () => {
  const { root, hosts, parentCalls } = browserHarness('http://designflow.test');
  root.dfError('图片暂时无法处理，请稍后再试。');
  assert.equal(parentCalls.length, 1);
  assert.equal(hosts.length, 0);
});

test('standalone and cross-origin canvases render one local strip with safe text', () => {
  for (const origin of [null, 'https://other.test']) {
    const { root, hosts, parentCalls } = browserHarness(origin);
    root.dfError('图片暂时无法处理，请稍后再试。');
    root.dfError('请选择一张参考图。');
    assert.equal(hosts.length, 1);
    assert.equal(parentCalls.length, 0);
    assert.equal(hosts[0].children[1].textContent, '请选择一张参考图。');
    assert.equal(hosts[0].children[2].textContent, '2/2');
    hosts[0].children[2].onclick();
    assert.match(hosts[0].children[1].textContent, /暂时无法处理/);
    root.DesignflowFeedback.clear();
    assert.equal(hosts[0].style.display, 'none');
  }
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const source = ts.transpileModule(fs.readFileSync(require.resolve('../src/utils/zipDownload.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness(successfulUrls) {
  const notices = [], files = [], downloads = [];
  let archives = 0;
  const context = {
    exports: {}, console: { error() {} }, Blob, Date, Map, queueMicrotask,
    setTimeout() {},
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    document: {
      createElement: () => ({ click() { downloads.push(this.download); } }),
      body: { appendChild() {}, removeChild() {} },
    },
    fetch: async (url) => ({ ok: successfulUrls.includes(url), blob: async () => new Blob(['image'], { type: 'image/png' }) }),
    Image: class { set src(_) { queueMicrotask(() => this.onerror()); } },
    require: (name) => name === 'jszip' ? { default: class {
      file(name) { files.push(name); }
      async generateAsync() { archives++; return new Blob(['archive']); }
    } } : { notifyError: message => notices.push(message) },
  };
  vm.runInNewContext(source, context);
  return { run: context.exports.downloadImagesAsZip, notices, files, downloads, archives: () => archives };
}

test('all images failing produces an error instead of a successful empty archive', async () => {
  const h = harness([]);
  await assert.rejects(h.run([{ url: '/missing.png' }]), /暂时无法下载/);
  assert.equal(h.archives(), 0);
  assert.equal(h.downloads.length, 0);
});

test('partial downloads preserve successful images and report missing counts once', async () => {
  const h = harness(['/ok.png']);
  await h.run([{ url: '/ok.png', name: '商品.png' }, { url: '/missing.png' }]);
  assert.deepEqual(h.files, ['商品.png']);
  assert.equal(h.downloads.length, 1);
  assert.equal(h.notices.length, 1);
  assert.match(h.notices[0], /已下载 1 张，1 张未能下载/);
});

test('successful downloads do not generate failure feedback', async () => {
  const h = harness(['/ok.png']);
  await h.run([{ url: '/ok.png' }]);
  assert.equal(h.downloads.length, 1);
  assert.equal(h.notices.length, 0);
});

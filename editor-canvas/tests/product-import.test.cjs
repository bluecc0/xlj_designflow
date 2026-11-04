const assert = require('node:assert/strict')
const fs = require('node:fs')
const { test, after } = require('node:test')
const ts = require('typescript')

const previousLoader = require.extensions['.ts']
require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  })
  module._compile(outputText, filename)
}
global.window = global
const { searchSkuFolders, importSkuFolderImages } = require('../src/services/productImportService.ts')
if (previousLoader) require.extensions['.ts'] = previousLoader
else delete require.extensions['.ts']
const originalFetch = global.fetch
after(() => { global.fetch = originalFetch; delete global.window })

test('folder search carries the exact SKU batch, login cookies and abort signal', async () => {
  const controller = new AbortController()
  const result = { folders: [], missing_skus: ['款号-1'], library_exists: true }
  global.fetch = async (url, options) => {
    assert.equal(new URL(url, 'http://local').searchParams.get('sku'), '款号-1,YKCW196')
    assert.equal(options.credentials, 'include')
    assert.equal(options.signal, controller.signal)
    return Response.json(result)
  }
  assert.deepEqual(await searchSkuFolders(['款号-1', 'YKCW196'], controller.signal), result)
})

test('import submits only selected file identities and returns original canvas sources', async () => {
  const selected = { library: 'sku', sku: 'YKCW196-16', path: '02 产品库/YKCW196/YKCW196-16/a.jpg', preview_url: '/thumbnail.webp', url: '/preview', id: 'selected' }
  const original = { url: '/ai-images/user/product-import/id/0/a.jpg', name: 'a.jpg', naturalWidth: 1200, naturalHeight: 1800 }
  global.fetch = async (url, options) => {
    assert.equal(url, '/products/import-sku-images')
    assert.equal(options.credentials, 'include')
    assert.equal(options.method, 'POST')
    assert.deepEqual(JSON.parse(options.body), { items: [{ library: selected.library, sku: selected.sku, path: selected.path }] })
    return Response.json({ items: [original] })
  }
  assert.deepEqual(await importSkuFolderImages([selected]), [original])
})

test('failed search and import reject without automatically repeating the operation', async () => {
  for (const operation of [() => searchSkuFolders(['YKCW196'], new AbortController().signal), () => importSkuFolderImages([])]) {
    let calls = 0
    global.fetch = async () => {
      calls++
      return Response.json({ detail: '商品素材库暂时无法读取，请稍后再试。' }, { status: 503 })
    }
    await assert.rejects(operation)
    assert.equal(calls, 1)
  }
})

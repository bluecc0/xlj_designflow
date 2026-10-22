const assert = require('node:assert/strict')
const fs = require('node:fs')
const { test } = require('node:test')
const ts = require('typescript')

const previousLoader = require.extensions['.ts']
require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  })
  module._compile(outputText, filename)
}
const { getImageDownloadTarget } = require('../src/utils/imageDownload.ts')
const { useCanvasStore } = require('../src/store/canvasStore.ts')
if (previousLoader) require.extensions['.ts'] = previousLoader
else delete require.extensions['.ts']

const specialImage = {
  url: '/results/job/frame_1_v2.png',
  name: '横幅-SKU-123_版本2',
  meta: {
    specialComposeSourceUrl: '/results/job/frame_1_v2.png',
    specialComposeDownloadUrl: '/special-compose/job/download-image/frame_1_v2.png',
  },
}

test('canvas insertion retains canonical per-image names and download metadata', () => {
  useCanvasStore.setState(useCanvasStore.getInitialState(), true)
  const [image] = useCanvasStore.getState().insertImagesAuto([specialImage], 'image', '生成结果')
  assert.equal(image.name, specialImage.name)
  assert.equal(image.meta.specialComposeDownloadUrl, specialImage.meta.specialComposeDownloadUrl)
  assert.deepEqual(getImageDownloadTarget(image), {
    url: specialImage.meta.specialComposeDownloadUrl,
    filename: specialImage.name,
  })
})

test('edited and regenerated images download their current image rather than the old special export', () => {
  const edited = { ...specialImage, url: '/ai-images/user/edited.jpg', name: '横幅-编辑' }
  assert.deepEqual(getImageDownloadTarget(edited), { url: edited.url, filename: '横幅-编辑.jpg' })
})

test('only same-site special export routes can replace the source download URL', () => {
  for (const url of ['https://other.test/export', 'javascript:alert(1)', '/auth/options']) {
    const image = { ...specialImage, meta: { ...specialImage.meta, specialComposeDownloadUrl: url } }
    assert.equal(getImageDownloadTarget(image).url, image.url)
  }
})

test('ordinary images use their actual format without duplicate file extensions', () => {
  assert.equal(getImageDownloadTarget({ url: '/images/product.png', name: '商品.png' }).filename, '商品.png')
  assert.equal(getImageDownloadTarget({ url: '/images/product.jpg?size=original', name: '商品.png' }).filename, '商品.jpg')
  assert.equal(getImageDownloadTarget({ url: 'data:image/webp;base64,AA==', name: '商品' }).filename, '商品.webp')
  assert.equal(getImageDownloadTarget({ url: '/images/file.png', name: '详情页/sku:1' }).filename, '详情页_sku_1.png')
})

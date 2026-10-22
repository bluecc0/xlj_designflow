const assert = require('node:assert/strict')
const fs = require('node:fs')
const { test } = require('node:test')
const ts = require('typescript')
const previousLoader = require.extensions['.ts']
require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  module._compile(outputText, filename)
}
const { buildSnapshotSavePayload, isStaleSnapshotConflict, requestSnapshot } = require('../src/utils/snapshotSave.ts')
const { useCanvasStore } = require('../src/store/canvasStore.ts')
if (previousLoader) require.extensions['.ts'] = previousLoader
else delete require.extensions['.ts']

test('explicit deletes declare precisely removed page and content IDs, not groups', () => {
  const base = { version: 2, pages: [{ id: 'p1' }, { id: 'p2' }],
    frames: [{ id: 'f1' }], images: [{ id: 'i1' }, { id: 'i2' }],
    texts: [{ id: 't1' }], groups: [{ id: 'g1' }] }
  const doc = { version: 2, pages: [{ id: 'p1' }], frames: [], images: [{ id: 'i2' }], texts: [] }
  const payload = buildSnapshotSavePayload(doc, base, 495, 'user_delete')
  assert.deepEqual(payload.deleted_record_ids, ['p2', 'f1', 'i1', 't1'])
  assert.equal(payload.base_revision, 495)
  assert.deepEqual(JSON.parse(payload.snapshot), doc)
  assert.deepEqual(buildSnapshotSavePayload(doc, base, 495, 'update').deleted_record_ids, [])
  assert.deepEqual(buildSnapshotSavePayload(doc, null, 495, 'user_delete').deleted_record_ids, [])
})

test('only a stale revision triggers conflict merging', () => {
  assert.equal(isStaleSnapshotConflict({ detail: { reason: 'stale_revision' } }), true)
  for (const body of [null, {}, { detail: 'user changed' },
    { detail: { reason: 'uninitialized_overwrite_rejected' } },
    { detail: { reason: 'invalid_snapshot_structure' } }]) {
    assert.equal(isStaleSnapshotConflict(body), false)
  }
})

test('snapshot deadline covers stalled headers and stalled response bodies', async () => {
  const originalFetch = global.fetch
  try {
    for (const stalledBody of [false, true]) {
      global.fetch = async (_url, { signal }) => {
        const pending = () => new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
        return stalledBody ? { ok: true, status: 200, json: pending } : pending()
      }
      await assert.rejects(requestSnapshot('/snapshot', undefined, 10), /aborted/)
    }
    global.fetch = async () => ({ ok: false, status: 409, json: async () => { throw new Error('not JSON') } })
    assert.deepEqual(await requestSnapshot('/snapshot'), { ok: false, status: 409, body: null })
  } finally {
    global.fetch = originalFetch
  }
})

const fixture = () => ({ version: 2, pages: [{ id: 'p1', name: 'Page', order: 0 }],
  activePageId: 'p1', frames: [], texts: [], groups: [],
  images: [{ id: 'i1', pageId: 'p1', url: '/a.png', x: 0, y: 0, width: 100, height: 100 }] })
const state = () => useCanvasStore.getState()
function reset(doc = fixture()) {
  useCanvasStore.setState(useCanvasStore.getInitialState(), true)
  state().loadDocument(doc, 10)
}

test('edits during a save remain dirty and the next payload uses the acknowledged base', () => {
  reset()
  state().updateImages([{ id: 'i1', patch: { x: 10 } }])
  const submitted = state().getDocument()
  const seq = state().editSequence
  state().updateImages([{ id: 'i1', patch: { x: 20 } }])
  state().markSaved(11, seq, submitted)
  assert.equal(state().isDirty, true)
  assert.equal(state().images[0].x, 20)
  assert.equal(state().baseDocument.images[0].x, 10)
  state().markSaved(12, state().editSequence, state().getDocument())
  assert.equal(state().isDirty, false)
})

test('conflict merge retains remote additions and local deletions without resurrecting unchanged images', () => {
  reset()
  state().setSelected(['i1'], 'image')
  state().deleteSelected()
  const server = fixture()
  server.images.push({ ...server.images[0], id: 'i2', url: '/b.png' })
  state().mergeConflictDocument(server, 11)
  assert.deepEqual(state().images.map((im) => im.id), ['i2'])
  const payload = buildSnapshotSavePayload(state().getDocument(), state().baseDocument, 11, state().lastSaveIntent)
  assert.deepEqual(payload.deleted_record_ids, ['i1'])
})

test('remote deletion of unchanged content leaves a clean merged document', () => {
  reset()
  const server = { ...fixture(), images: [] }
  state().mergeConflictDocument(server, 11)
  assert.equal(state().isDirty, false)
  assert.deepEqual(state().images, [])
})

test('undoing insertion declares deletion and redoing it restores content', () => {
  reset({ ...fixture(), images: [] })
  const empty = state().getDocument()
  state().restoreHistoryDocument(fixture())
  state().markSaved(11, state().editSequence, state().getDocument())
  state().restoreHistoryDocument(empty)
  assert.deepEqual(buildSnapshotSavePayload(state().getDocument(), state().baseDocument, 11,
    state().lastSaveIntent).deleted_record_ids, ['i1'])
  state().restoreHistoryDocument(fixture())
  assert.deepEqual(state().images.map((im) => im.id), ['i1'])
})

test('conflict relationship repair does not mutate the input document', () => {
  reset({ ...fixture(), images: [] })
  const server = fixture()
  server.images[0].frameId = 'missing-frame'
  state().mergeConflictDocument(server, 11)
  assert.equal(state().images[0].frameId, null)
  assert.equal(server.images[0].frameId, 'missing-frame')
  assert.equal(state().baseDocument.images[0].frameId, 'missing-frame')
})

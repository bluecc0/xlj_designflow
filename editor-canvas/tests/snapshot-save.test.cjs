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
const { buildSnapshotSavePayload, isStaleSnapshotConflict } = require('../src/utils/snapshotSave.ts')
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

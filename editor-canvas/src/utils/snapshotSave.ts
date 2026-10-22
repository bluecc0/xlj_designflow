import type { CanvasDocument } from '../types'

export function buildSnapshotSavePayload(
  doc: CanvasDocument,
  base: CanvasDocument | null,
  revision: number,
  intent: 'update' | 'user_delete',
) {
  const recordIds = (document: CanvasDocument) =>
    ['pages', 'frames', 'images', 'texts'].flatMap((key) =>
      (document[key as 'pages' | 'frames' | 'images' | 'texts'] || []).map((item) => item.id),
    )
  const currentIds = new Set(recordIds(doc))
  return {
    snapshot: JSON.stringify(doc),
    base_revision: revision,
    intent,
    deleted_record_ids: intent === 'user_delete' && base
      ? recordIds(base).filter((id) => !currentIds.has(id))
      : [],
  }
}

export function isStaleSnapshotConflict(body: unknown): boolean {
  return !!body && typeof body === 'object'
    && 'detail' in body && !!body.detail && typeof body.detail === 'object'
    && 'reason' in body.detail && body.detail.reason === 'stale_revision'
}

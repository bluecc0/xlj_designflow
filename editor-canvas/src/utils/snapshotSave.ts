import type { CanvasDocument } from '../types'

// Include response-body reads in the deadline, not only the initial headers.
export async function requestSnapshot(url: string, init?: RequestInit, timeoutMs = 15000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const body = await response.json().catch((error) => {
      if (response.ok || controller.signal.aborted) throw error
      return null
    })
    return { ok: response.ok, status: response.status, body }
  } finally {
    clearTimeout(timer)
  }
}

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

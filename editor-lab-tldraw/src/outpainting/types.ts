import type {
  IndexKey,
  TLAssetId,
  TLImageShape,
  TLPageId,
  TLParentId,
  TLShapeCrop,
  TLShapeId,
} from 'tldraw'

export type OutpaintEdge = 'top' | 'right' | 'bottom' | 'left'

export type OutpaintCorner =
  | 'top-left'
  | 'top-right'
  | 'bottom-right'
  | 'bottom-left'

export type OutpaintHandle =
  | { kind: 'edge'; edge: OutpaintEdge; edges: readonly [OutpaintEdge] }
  | {
      kind: 'corner'
      corner: OutpaintCorner
      edges: readonly [OutpaintEdge, OutpaintEdge]
    }

export type OutpaintMargins = Record<OutpaintEdge, number>

export type OutpaintingConfig = {
  enabled: boolean
  providerMarginAlignment: number
  maxWidth: number
  maxHeight: number
  maxAreaPixels: number
  recommendedAreaPixels: number
  maxSourceBytes: number
  timeoutSeconds: number
  minProcessingSide: number
  isFallback: boolean
}

export type OutpaintingEligibility = {
  shapeId: TLShapeId | null
  eligible: boolean
  reason: string
  processingWidth: number
  processingHeight: number
}

export type OutpaintingDraft = {
  sourceShapeId: TLImageShape['id']
  margins: OutpaintMargins
}

export type OutpaintingStage =
  | 'idle'
  | 'submitting'
  | 'queued'
  | 'processing'
  | 'downloading'
  | 'inserting'
  | 'done'
  | 'error'

export type OutpaintingOperationState = {
  stage: OutpaintingStage
  message: string
  progress: number | null
  processing: boolean
  sourceShapeId: TLShapeId | null
}

export type MatrixSnapshot = {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export type BoundsSnapshot = {
  x: number
  y: number
  w: number
  h: number
}

export type OutpaintingSourceCapture = {
  operationToken: string
  sourceShapeId: TLImageShape['id']
  sourceAssetId: TLAssetId
  sourceUrl: string
  sourceName: string
  sourceMimeType: string
  sourcePageId: TLPageId
  sourceParentId: TLParentId
  sourceIndex: IndexKey
  sourceX: number
  sourceY: number
  sourceRotation: number
  initialPageBounds: BoundsSnapshot
  sourcePageTransform: MatrixSnapshot
  sourceParentPageTransform: MatrixSnapshot
  displayWidth: number
  displayHeight: number
  processingWidth: number
  processingHeight: number
  crop: TLShapeCrop | null
  flipX: boolean
  flipY: boolean
  margins: OutpaintMargins
  sequentialOrder: number | null
}

export type SequentialLayoutAdapter = {
  getSourceOrder: (shape: TLImageShape, pageId: TLPageId) => number | null
  reflow: (pageId: TLPageId) => void
}

export const ZERO_OUTPAINT_MARGINS: OutpaintMargins = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
}

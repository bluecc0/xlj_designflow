import React from 'react'
import {
  useEditor,
  useValue,
  SelectionForegroundOverlayUtil,
  type Editor,
  type TLImageShape,
  type TLPageId,
  type TLShape,
} from 'tldraw'
import {
  getMarginsFromLocalDrag,
  getMaximumMarginForEdge,
  hasOutpaintMargins,
  marginPixelsToLocal,
  normalizeVector,
  type Point,
} from './geometry'
import {
  getExpectedSizeForDraft,
  getOutpaintingEligibility,
  useOutpaintingController,
} from './hook'
import { isOutpaintingComposing, setOutpaintingComposing } from './state'
import {
  ZERO_OUTPAINT_MARGINS,
  type OutpaintCorner,
  type OutpaintEdge,
  type OutpaintHandle,
  type OutpaintMargins,
} from './types'

const EDGE_ORDER: OutpaintEdge[] = ['top', 'right', 'bottom', 'left']
const CORNER_ORDER: OutpaintCorner[] = [
  'top-left',
  'top-right',
  'bottom-right',
  'bottom-left',
]

const EDGE_OUTWARD_LOCAL: Record<OutpaintEdge, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
}

const EDGE_LABEL: Record<OutpaintEdge, string> = {
  top: '上方',
  right: '右侧',
  bottom: '下方',
  left: '左侧',
}

const CORNER_EDGES: Record<OutpaintCorner, readonly [OutpaintEdge, OutpaintEdge]> = {
  'top-left': ['top', 'left'],
  'top-right': ['top', 'right'],
  'bottom-right': ['bottom', 'right'],
  'bottom-left': ['bottom', 'left'],
}

const CORNER_OUTWARD_LOCAL: Record<OutpaintCorner, Point> = {
  'top-left': { x: -1, y: -1 },
  'top-right': { x: 1, y: -1 },
  'bottom-right': { x: 1, y: 1 },
  'bottom-left': { x: -1, y: 1 },
}

const CORNER_LABEL: Record<OutpaintCorner, string> = {
  'top-left': '左上角',
  'top-right': '右上角',
  'bottom-right': '右下角',
  'bottom-left': '左下角',
}

type OutpaintingOverlayProps = {
  getSequentialSourceOrder: (editor: Editor, shape: TLImageShape, pageId: TLPageId) => number | null
  reflowSequentialImages: (editor: Editor, pageId: TLPageId) => void
}

type EdgeGeometry = {
  start: Point
  end: Point
  center: Point
  length: number
  angle: number
  cursor: React.CSSProperties['cursor']
}

type CornerGeometry = {
  point: Point
  cursor: React.CSSProperties['cursor']
}

type OverlayGeometry = {
  source: Point[]
  outer: Point[]
  bands: Partial<Record<OutpaintEdge, Point[]>>
  edges: Record<OutpaintEdge, EdgeGeometry>
  corners: Record<OutpaintCorner, CornerGeometry>
  labels: Partial<Record<OutpaintEdge, Point>>
  expectedLabel: Point
}

type DragState = {
  handle: OutpaintHandle
  edges: readonly OutpaintEdge[]
  pointerId: number
  target: HTMLElement
  startLocal: Point
  startingMargins: OutpaintMargins
}

function toPointsAttribute(points: Point[]) {
  return points.map((point) => `${point.x},${point.y}`).join(' ')
}

function cursorForVector(vector: Point): React.CSSProperties['cursor'] {
  const angle = ((Math.atan2(vector.y, vector.x) * 180 / Math.PI) % 180 + 180) % 180
  const cursors: React.CSSProperties['cursor'][] = [
    'ew-resize',
    'nwse-resize',
    'ns-resize',
    'nesw-resize',
  ]
  return cursors[Math.round(angle / 45) % 4]
}

function getLocalEdgePoint(
  edge: OutpaintEdge,
  displayWidth: number,
  displayHeight: number,
  localMargins: OutpaintMargins,
  outer: boolean
): Point {
  if (edge === 'top') {
    return { x: displayWidth / 2, y: outer ? -localMargins.top : 0 }
  }
  if (edge === 'right') {
    return { x: outer ? displayWidth + localMargins.right : displayWidth, y: displayHeight / 2 }
  }
  if (edge === 'bottom') {
    return { x: displayWidth / 2, y: outer ? displayHeight + localMargins.bottom : displayHeight }
  }
  return { x: outer ? -localMargins.left : 0, y: displayHeight / 2 }
}

function createOverlayGeometry(
  editor: Editor,
  shape: TLImageShape,
  margins: OutpaintMargins,
  processingWidth: number,
  processingHeight: number
): OverlayGeometry {
  const displayWidth = Number(shape.props.w)
  const displayHeight = Number(shape.props.h)
  const localMargins = marginPixelsToLocal(
    margins,
    { w: displayWidth, h: displayHeight },
    { w: processingWidth, h: processingHeight }
  )
  const transform = editor.getShapePageTransform(shape)
  const toViewport = (point: Point) => editor.pageToViewport(transform.applyToPoint(point))
  const sourceLocal = [
    { x: 0, y: 0 },
    { x: displayWidth, y: 0 },
    { x: displayWidth, y: displayHeight },
    { x: 0, y: displayHeight },
  ]
  const outerLocal = [
    { x: -localMargins.left, y: -localMargins.top },
    { x: displayWidth + localMargins.right, y: -localMargins.top },
    { x: displayWidth + localMargins.right, y: displayHeight + localMargins.bottom },
    { x: -localMargins.left, y: displayHeight + localMargins.bottom },
  ]
  const outer = outerLocal.map(toViewport)
  const bands: Partial<Record<OutpaintEdge, Point[]>> = {}
  if (margins.top > 0) {
    bands.top = [
      outerLocal[0],
      outerLocal[1],
      { x: displayWidth + localMargins.right, y: 0 },
      { x: -localMargins.left, y: 0 },
    ].map(toViewport)
  }
  if (margins.right > 0) {
    bands.right = [
      { x: displayWidth, y: 0 },
      { x: displayWidth + localMargins.right, y: 0 },
      { x: displayWidth + localMargins.right, y: displayHeight },
      { x: displayWidth, y: displayHeight },
    ].map(toViewport)
  }
  if (margins.bottom > 0) {
    bands.bottom = [
      { x: -localMargins.left, y: displayHeight },
      { x: displayWidth + localMargins.right, y: displayHeight },
      outerLocal[2],
      outerLocal[3],
    ].map(toViewport)
  }
  if (margins.left > 0) {
    bands.left = [
      { x: -localMargins.left, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: displayHeight },
      { x: -localMargins.left, y: displayHeight },
    ].map(toViewport)
  }

  const edgeSegments: Record<OutpaintEdge, readonly [number, number]> = {
    top: [0, 1],
    right: [1, 2],
    bottom: [2, 3],
    left: [3, 0],
  }
  const edges = {} as Record<OutpaintEdge, EdgeGeometry>
  const labels: Partial<Record<OutpaintEdge, Point>> = {}
  EDGE_ORDER.forEach((edge) => {
    const [startIndex, endIndex] = edgeSegments[edge]
    const start = outer[startIndex]
    const end = outer[endIndex]
    const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
    const edgePoint = getLocalEdgePoint(edge, displayWidth, displayHeight, localMargins, true)
    const outwardPoint = {
      x: edgePoint.x + EDGE_OUTWARD_LOCAL[edge].x,
      y: edgePoint.y + EDGE_OUTWARD_LOCAL[edge].y,
    }
    const edgeViewport = toViewport(edgePoint)
    const outwardViewport = toViewport(outwardPoint)
    const outward = {
      x: outwardViewport.x - edgeViewport.x,
      y: outwardViewport.y - edgeViewport.y,
    }
    edges[edge] = {
      start,
      end,
      center,
      length: Math.hypot(end.x - start.x, end.y - start.y),
      angle: Math.atan2(end.y - start.y, end.x - start.x),
      cursor: cursorForVector(outward),
    }
    if (margins[edge] > 0) {
      const sourceEdge = getLocalEdgePoint(edge, displayWidth, displayHeight, localMargins, false)
      labels[edge] = toViewport({
        x: (sourceEdge.x + edgePoint.x) / 2,
        y: (sourceEdge.y + edgePoint.y) / 2,
      })
    }
  })

  const corners = {} as Record<OutpaintCorner, CornerGeometry>
  CORNER_ORDER.forEach((corner, index) => {
    const localPoint = outerLocal[index]
    const outwardLocal = CORNER_OUTWARD_LOCAL[corner]
    const point = outer[index]
    const outwardPoint = toViewport({
      x: localPoint.x + outwardLocal.x,
      y: localPoint.y + outwardLocal.y,
    })
    const outward = {
      x: outwardPoint.x - point.x,
      y: outwardPoint.y - point.y,
    }
    corners[corner] = {
      point,
      cursor: cursorForVector(outward),
    }
  })

  const bottomCenterX = (displayWidth + localMargins.right - localMargins.left) / 2
  const bottomMidpoint = toViewport({
    x: bottomCenterX,
    y: displayHeight + localMargins.bottom,
  })
  const bottomOutwardPoint = toViewport({
    x: bottomCenterX,
    y: displayHeight + localMargins.bottom + 1,
  })
  const bottomOutward = normalizeVector({
    x: bottomOutwardPoint.x - bottomMidpoint.x,
    y: bottomOutwardPoint.y - bottomMidpoint.y,
  })

  return {
    source: sourceLocal.map(toViewport),
    outer,
    bands,
    edges,
    corners,
    labels,
    expectedLabel: {
      x: bottomMidpoint.x + bottomOutward.x * 30,
      y: bottomMidpoint.y + bottomOutward.y * 30,
    },
  }
}

function selectedImageFromEditor(editor: Editor): TLImageShape | null {
  const selectedIds = editor.getSelectedShapeIds()
  if (selectedIds.length !== 1) return null
  const shape = editor.getShape(selectedIds[0])
  return shape?.type === 'image' ? shape : null
}

function releaseCapturedPointer(drag: DragState) {
  try {
    if (drag.target.hasPointerCapture(drag.pointerId)) {
      drag.target.releasePointerCapture(drag.pointerId)
    }
  } catch {}
}

function isTldrawChromeOpen() {
  return Boolean(document.querySelector([
    '.tlui-dialog',
    '.tlui-dialog__overlay',
    '[data-radix-menu-content]',
    '[data-radix-popper-content-wrapper]',
    '[role="menu"]',
    '[role="dialog"]',
    '[role="listbox"]',
  ].join(',')))
}

function isOutpaintingEscapeContext() {
  const activeElement = document.activeElement
  if (activeElement instanceof HTMLElement) {
    if (
      activeElement.closest('.designflow-outpainting-layer')
      || activeElement.closest('[data-testid="tool.image-outpaint"]')
    ) {
      return true
    }
  }
  if (isTldrawChromeOpen()) return false
  return !activeElement || activeElement === document.body
}

export class DesignflowSelectionForegroundOverlayUtil extends SelectionForegroundOverlayUtil {
  override isActive(): boolean {
    if (isOutpaintingComposing()) return false
    return super.isActive()
  }
}

export function OutpaintingOverlay({
  getSequentialSourceOrder,
  reflowSequentialImages,
}: OutpaintingOverlayProps) {
  const editor = useEditor()
  const sequentialLayout = React.useMemo(
    () => ({
      getSourceOrder: (shape: TLImageShape, pageId: TLPageId) => getSequentialSourceOrder(editor, shape, pageId),
      reflow: (pageId: TLPageId) => reflowSequentialImages(editor, pageId),
    }),
    [editor, getSequentialSourceOrder, reflowSequentialImages]
  )
  const outpainting = useOutpaintingController(editor, sequentialLayout)
  const selectedImage = useValue(
    'designflow-outpainting-selected-image',
    () => selectedImageFromEditor(editor),
    [editor]
  )
  const selectionKey = useValue(
    'designflow-outpainting-selection-key',
    () => editor.getSelectedShapeIds().map(String).sort().join('|'),
    [editor]
  )
  const eligibility = useValue(
    'designflow-outpainting-eligibility',
    () => getOutpaintingEligibility(editor, selectedImageFromEditor(editor) as TLShape | null, outpainting.config),
    [editor, outpainting.config]
  )

  React.useEffect(() => {
    outpainting.setEligibility(eligibility)
    const draftShapeId = outpainting.draft?.sourceShapeId
    if (
      draftShapeId &&
      (draftShapeId !== eligibility.shapeId || !eligibility.eligible) &&
      !outpainting.operation.processing
    ) {
      outpainting.clearDraft()
      outpainting.setEligibility(eligibility)
    }
  }, [
    eligibility,
    selectionKey,
    outpainting.draft?.sourceShapeId,
    outpainting.operation.processing,
    outpainting.clearDraft,
    outpainting.setEligibility,
  ])

  const draft = outpainting.draft
  const renderShape = selectedImage && draft?.sourceShapeId === selectedImage.id ? selectedImage : null
  const geometry = useValue(
    'designflow-outpainting-overlay-geometry',
    () => {
      if (!renderShape || !eligibility.eligible || !draft) return null
      return createOverlayGeometry(
        editor,
        renderShape,
        draft.margins,
        eligibility.processingWidth,
        eligibility.processingHeight
      )
    },
    [editor, renderShape, draft, eligibility]
  )
  const dragRef = React.useRef<DragState | null>(null)
  React.useEffect(() => {
    const composing = Boolean(renderShape && draft)
    setOutpaintingComposing(composing)
    editor.getContainer().classList.toggle('designflow-outpainting-composing', composing)
  }, [draft, editor, renderShape])
  React.useEffect(() => {
    const container = editor.getContainer()
    return () => {
      setOutpaintingComposing(false)
      container.classList.remove('designflow-outpainting-composing')
    }
  }, [editor])
  const patternId = React.useId().replace(/[^a-zA-Z0-9_-]/g, '') || 'outpaint-hatch'
  const handlesFrozen = outpainting.operation.processing || outpainting.externalOperationBusy

  const cancelCurrentDrag = React.useCallback((restoreMargins: boolean) => {
    const drag = dragRef.current
    if (!drag) return false
    dragRef.current = null
    if (restoreMargins && renderShape) {
      outpainting.setMargins(renderShape.id, { ...drag.startingMargins })
    }
    releaseCapturedPointer(drag)
    return true
  }, [outpainting.setMargins, renderShape])

  React.useEffect(() => {
    if (handlesFrozen) cancelCurrentDrag(true)
  }, [cancelCurrentDrag, handlesFrozen])

  React.useEffect(() => {
    cancelCurrentDrag(true)
  }, [cancelCurrentDrag, selectionKey])

  React.useEffect(() => () => {
    const drag = dragRef.current
    dragRef.current = null
    if (drag) releaseCapturedPointer(drag)
  }, [])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || outpainting.operation.processing) return
      if (cancelCurrentDrag(true)) {
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }
      if (!isOutpaintingEscapeContext()) return
      const currentDraft = outpainting.draft
      if (!currentDraft) return
      const hasDraftMargins = Object.values(currentDraft.margins).some((value) => value > 0)
      if (hasDraftMargins || outpainting.operation.stage === 'error') {
        outpainting.setMargins(currentDraft.sourceShapeId, { ...ZERO_OUTPAINT_MARGINS })
        outpainting.setOperation((current) => current.stage === 'error'
          ? { stage: 'idle', message: '', progress: null, processing: false, sourceShapeId: null }
          : current)
      } else {
        outpainting.clearDraft()
      }
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [cancelCurrentDrag, outpainting])

  const handlePointerDown = React.useCallback((
    handle: OutpaintHandle,
    event: React.PointerEvent<HTMLElement>
  ) => {
    if (
      handlesFrozen
      || !renderShape
      || !draft
      || !outpainting.config
      || !event.isPrimary
      || event.button !== 0
    ) return
    event.preventDefault()
    event.stopPropagation()
    editor.markEventAsHandled(event)
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      return
    }
    const pagePoint = editor.screenToPage({ x: event.clientX, y: event.clientY })
    const localPoint = editor.getPointInShapeSpace(renderShape, pagePoint)
    dragRef.current = {
      handle,
      edges: handle.edges,
      pointerId: event.pointerId,
      target: event.currentTarget,
      startLocal: { x: localPoint.x, y: localPoint.y },
      startingMargins: { ...draft.margins },
    }
    outpainting.setOperation((current) => current.stage === 'error'
      ? { stage: 'idle', message: '', progress: null, processing: false, sourceShapeId: null }
      : current)
  }, [draft, editor, handlesFrozen, outpainting, renderShape])

  const handlePointerMove = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (
      !drag
      || drag.pointerId !== event.pointerId
      || !renderShape
      || !outpainting.config
      || handlesFrozen
    ) return
    event.preventDefault()
    event.stopPropagation()
    editor.markEventAsHandled(event)
    const pagePoint = editor.screenToPage({ x: event.clientX, y: event.clientY })
    const localPoint = editor.getPointInShapeSpace(renderShape, pagePoint)
    const nextMargins = getMarginsFromLocalDrag(
      drag.edges,
      drag.startLocal,
      { x: localPoint.x, y: localPoint.y },
      drag.startingMargins,
      { w: Number(renderShape.props.w), h: Number(renderShape.props.h) },
      { w: eligibility.processingWidth, h: eligibility.processingHeight },
      outpainting.config
    )
    outpainting.setMargins(renderShape.id, nextMargins)
  }, [editor, eligibility.processingHeight, eligibility.processingWidth, handlesFrozen, outpainting, renderShape])

  const finishPointerDrag = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    editor.markEventAsHandled(event)
    dragRef.current = null
    releaseCapturedPointer(drag)
  }, [editor])

  const cancelPointerDrag = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    editor.markEventAsHandled(event)
    cancelCurrentDrag(true)
  }, [cancelCurrentDrag, editor])

  const handleEdgeKeyDown = React.useCallback((
    edge: OutpaintEdge,
    event: React.KeyboardEvent<HTMLButtonElement>
  ) => {
    if (handlesFrozen || !renderShape || !draft || !outpainting.config) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    const currentValue = draft.margins[edge]
    const maxValue = getMaximumMarginForEdge(
      { w: eligibility.processingWidth, h: eligibility.processingHeight },
      draft.margins,
      edge,
      outpainting.config
    )
    const step = event.shiftKey ? 10 : 1
    let nextValue: number | null = null
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      nextValue = currentValue + step
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      nextValue = currentValue - step
    } else if (event.key === 'Home') {
      nextValue = 0
    } else if (event.key === 'End') {
      nextValue = maxValue
    }
    if (nextValue === null) return

    event.preventDefault()
    event.stopPropagation()
    nextValue = Math.max(0, Math.min(maxValue, nextValue))
    if (nextValue === currentValue) return
    outpainting.setMargins(renderShape.id, { ...draft.margins, [edge]: nextValue })
    outpainting.setOperation((current) => current.stage === 'error'
      ? { stage: 'idle', message: '', progress: null, processing: false, sourceShapeId: null }
      : current)
  }, [draft, eligibility.processingHeight, eligibility.processingWidth, handlesFrozen, outpainting, renderShape])

  const expected = draft ? getExpectedSizeForDraft(eligibility, draft.margins) : null
  const recommendedWarning = expected && outpainting.config &&
    expected.w * expected.h > outpainting.config.recommendedAreaPixels
      ? '，尺寸较大，处理时间可能更久'
      : ''
  const showOperationStatus = outpainting.operation.stage !== 'idle'

  if (!outpainting.config?.enabled) return null

  return (
    <div
      className="designflow-outpainting-layer"
      data-outpainting-composing={geometry && draft ? 'true' : 'false'}
    >
      {geometry && draft && (
        <>
          <svg className="designflow-outpainting-svg" aria-hidden="true">
            <defs>
              <pattern id={patternId} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="8" height="8" fill="rgba(99, 102, 241, 0.08)" />
                <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(79, 70, 229, 0.24)" strokeWidth="2" />
              </pattern>
            </defs>
            {EDGE_ORDER.map((edge) => geometry.bands[edge] ? (
              <polygon
                key={edge}
                points={toPointsAttribute(geometry.bands[edge]!)}
                fill={`url(#${patternId})`}
                className="designflow-outpainting-band"
              />
            ) : null)}
            <polygon
              points={toPointsAttribute(geometry.outer)}
              className="designflow-outpainting-outline"
            />
          </svg>

          {EDGE_ORDER.map((edge) => {
            const edgeGeometry = geometry.edges[edge]
            const handle: OutpaintHandle = { kind: 'edge', edge, edges: [edge] }
            const horizontal = edge === 'left' || edge === 'right'
            const maxValue = outpainting.config
              ? getMaximumMarginForEdge(
                { w: eligibility.processingWidth, h: eligibility.processingHeight },
                draft.margins,
                edge,
                outpainting.config
              )
              : 0
            return (
              <button
                key={edge}
                type="button"
                role="slider"
                data-testid={`outpaint-edge-${edge}`}
                className="designflow-outpainting-edge-control"
                style={{
                  left: edgeGeometry.center.x,
                  top: edgeGeometry.center.y,
                  width: Math.max(1, edgeGeometry.length),
                  transform: `translate(-50%, -50%) rotate(${edgeGeometry.angle}rad)`,
                  cursor: handlesFrozen ? 'wait' : edgeGeometry.cursor,
                }}
                aria-label={`调整${EDGE_LABEL[edge]}扩图范围`}
                aria-orientation={horizontal ? 'horizontal' : 'vertical'}
                aria-valuemin={0}
                aria-valuemax={maxValue}
                aria-valuenow={draft.margins[edge]}
                aria-valuetext={`${EDGE_LABEL[edge]}扩展 ${draft.margins[edge]} 像素`}
                title={handlesFrozen ? '其他图片任务进行中，请稍候' : `拖动或用方向键调整${EDGE_LABEL[edge]}扩图范围`}
                disabled={handlesFrozen}
                onKeyDown={(event) => handleEdgeKeyDown(edge, event)}
                onPointerDown={(event) => handlePointerDown(handle, event)}
                onPointerMove={handlePointerMove}
                onPointerUp={finishPointerDrag}
                onPointerCancel={cancelPointerDrag}
                onLostPointerCapture={(event) => {
                  if (dragRef.current?.target === event.currentTarget) dragRef.current = null
                }}
              />
            )
          })}

          {CORNER_ORDER.map((corner) => {
            const cornerGeometry = geometry.corners[corner]
            const handle: OutpaintHandle = {
              kind: 'corner',
              corner,
              edges: CORNER_EDGES[corner],
            }
            return (
              <button
                key={corner}
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                data-testid={`outpaint-corner-${corner}`}
                className="designflow-outpainting-corner-control"
                style={{
                  left: cornerGeometry.point.x,
                  top: cornerGeometry.point.y,
                  cursor: handlesFrozen ? 'wait' : cornerGeometry.cursor,
                }}
                title={handlesFrozen ? '其他图片任务进行中，请稍候' : `拖动调整${CORNER_LABEL[corner]}扩图范围`}
                disabled={handlesFrozen}
                onPointerDown={(event) => handlePointerDown(handle, event)}
                onPointerMove={handlePointerMove}
                onPointerUp={finishPointerDrag}
                onPointerCancel={cancelPointerDrag}
                onLostPointerCapture={(event) => {
                  if (dragRef.current?.target === event.currentTarget) dragRef.current = null
                }}
              >
                <span aria-hidden="true" />
              </button>
            )
          })}

          {EDGE_ORDER.map((edge) => geometry.labels[edge] ? (
            <span
              key={edge}
              className="designflow-outpainting-margin-label"
              style={{ left: geometry.labels[edge]!.x, top: geometry.labels[edge]!.y }}
            >
              +{draft.margins[edge]} px
            </span>
          ) : null)}

          {expected && hasOutpaintMargins(draft.margins) && (
            <span
              className="designflow-outpainting-size-label"
              style={{ left: geometry.expectedLabel.x, top: geometry.expectedLabel.y }}
              title={`预计输出 ${expected.w} × ${expected.h}${recommendedWarning}`}
            >
              预计 {expected.w} × {expected.h}
            </span>
          )}
        </>
      )}

      {showOperationStatus && (
        <div
          className={`designflow-outpainting-operation designflow-outpainting-operation-${outpainting.operation.stage}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          title={outpainting.operation.message}
        >
          {outpainting.operation.processing && <span className="designflow-upscale-spinner" aria-hidden="true" />}
          <span>{outpainting.operation.message}</span>
          {outpainting.operation.progress !== null && (
            <span className="designflow-outpainting-progress">{outpainting.operation.progress}%</span>
          )}
        </div>
      )}
    </div>
  )
}

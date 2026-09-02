import type { OutpaintEdge, OutpaintMargins, OutpaintingConfig } from './types'

export type Point = { x: number; y: number }
export type Size = { w: number; h: number }

export function hasOutpaintMargins(margins: OutpaintMargins) {
  return margins.top > 0 || margins.right > 0 || margins.bottom > 0 || margins.left > 0
}

export function getExpectedOutpaintSize(input: Size, margins: OutpaintMargins): Size {
  return {
    w: input.w + margins.left + margins.right,
    h: input.h + margins.top + margins.bottom,
  }
}

export function alignMarginForProvider(margin: number, alignment: number) {
  const normalizedMargin = Math.max(0, Math.round(margin))
  if (!normalizedMargin) return 0
  const normalizedAlignment = Math.max(1, Math.round(alignment))
  return Math.ceil(normalizedMargin / normalizedAlignment) * normalizedAlignment
}

export function getProviderMargins(
  margins: OutpaintMargins,
  alignment: number
): OutpaintMargins {
  return {
    top: alignMarginForProvider(margins.top, alignment),
    right: alignMarginForProvider(margins.right, alignment),
    bottom: alignMarginForProvider(margins.bottom, alignment),
    left: alignMarginForProvider(margins.left, alignment),
  }
}

export function getProviderOutpaintSize(
  input: Size,
  margins: OutpaintMargins,
  alignment: number
) {
  return getExpectedOutpaintSize(input, getProviderMargins(margins, alignment))
}

export function isWithinOutpaintingLimits(
  input: Size,
  margins: OutpaintMargins,
  config: OutpaintingConfig
) {
  const output = getProviderOutpaintSize(
    input,
    margins,
    config.providerMarginAlignment
  )
  return (
    output.w <= config.maxWidth &&
    output.h <= config.maxHeight &&
    output.w * output.h <= config.maxAreaPixels
  )
}

export function getProcessingSizeForOutpainting(
  sourceWidth: number,
  sourceHeight: number,
  config: OutpaintingConfig
): Size {
  const width = Math.max(1, Math.round(sourceWidth))
  const height = Math.max(1, Math.round(sourceHeight))
  const alignment = Math.max(1, Math.round(config.providerMarginAlignment))
  const maxBaseWidth = Math.max(1, config.maxWidth - alignment)
  const maxBaseHeight = Math.max(1, config.maxHeight - alignment)
  const area = width * height
  const quadraticA = area
  const quadraticB = alignment * (width + height)
  const quadraticC = alignment * alignment - config.maxAreaPixels
  let areaScale = 1
  if (quadraticA > 0) {
    const discriminant = quadraticB * quadraticB - 4 * quadraticA * quadraticC
    if (discriminant >= 0) {
      const root = (-quadraticB + Math.sqrt(discriminant)) / (2 * quadraticA)
      areaScale = Number.isFinite(root) ? Math.max(0, root) : 0
    } else {
      areaScale = 0
    }
  }
  const scale = Math.min(
    1,
    maxBaseWidth / width,
    maxBaseHeight / height,
    areaScale
  )
  let nextWidth = Math.max(1, Math.min(width, Math.round(width * scale)))
  let nextHeight = Math.max(1, Math.min(height, Math.round(height * scale)))
  const fits = (candidateWidth: number, candidateHeight: number) => {
    const envelopeWidth = candidateWidth + alignment
    const envelopeHeight = candidateHeight + alignment
    return (
      envelopeWidth <= config.maxWidth &&
      envelopeHeight <= config.maxHeight &&
      envelopeWidth * envelopeHeight <= config.maxAreaPixels
    )
  }
  while ((nextWidth > 1 || nextHeight > 1) && !fits(nextWidth, nextHeight)) {
    if (nextWidth > nextHeight && nextWidth > 1) nextWidth -= 1
    else if (nextHeight > 1) nextHeight -= 1
    else nextWidth -= 1
  }
  return { w: nextWidth, h: nextHeight }
}

export function getMaximumMarginForEdge(
  input: Size,
  margins: OutpaintMargins,
  edge: OutpaintEdge,
  config: OutpaintingConfig
) {
  const horizontal = edge === 'left' || edge === 'right'
  let low = 0
  let high = Math.max(0, Math.floor(
    (horizontal ? config.maxWidth - input.w : config.maxHeight - input.h)
  ))
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    const candidate = { ...margins, [edge]: middle }
    if (isWithinOutpaintingLimits(input, candidate, config)) low = middle
    else high = middle - 1
  }
  return low
}

export function getOutwardLocalDelta(edge: OutpaintEdge, start: Point, current: Point) {
  if (edge === 'left') return start.x - current.x
  if (edge === 'right') return current.x - start.x
  if (edge === 'top') return start.y - current.y
  return current.y - start.y
}

function candidateAtStep(
  base: OutpaintMargins,
  outward: OutpaintMargins,
  step: number,
  maxStep: number
): OutpaintMargins {
  if (maxStep <= 0) return { ...base }
  return {
    top: base.top + Math.floor(outward.top * step / maxStep),
    right: base.right + Math.floor(outward.right * step / maxStep),
    bottom: base.bottom + Math.floor(outward.bottom * step / maxStep),
    left: base.left + Math.floor(outward.left * step / maxStep),
  }
}

function clampAxisMargins(
  desired: OutpaintMargins,
  startingMargins: OutpaintMargins,
  edges: readonly OutpaintEdge[],
  fits: (margins: OutpaintMargins) => boolean
) {
  if (fits(desired)) return desired
  const base = { ...desired }
  const outward = { top: 0, right: 0, bottom: 0, left: 0 }
  edges.forEach((edge) => {
    if (desired[edge] < startingMargins[edge]) {
      base[edge] = desired[edge]
      return
    }
    base[edge] = startingMargins[edge]
    outward[edge] = desired[edge] - startingMargins[edge]
  })
  const maxStep = Math.max(...edges.map((edge) => outward[edge]))
  if (!maxStep || !fits(base)) return base

  let low = 0
  let high = maxStep
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    const candidate = { ...desired }
    edges.forEach((edge) => {
      candidate[edge] = base[edge] + Math.floor(outward[edge] * middle / maxStep)
    })
    if (fits(candidate)) low = middle
    else high = middle - 1
  }
  const result = { ...desired }
  edges.forEach((edge) => {
    result[edge] = base[edge] + Math.floor(outward[edge] * low / maxStep)
  })
  return result
}

function constrainMargins(
  desired: OutpaintMargins,
  startingMargins: OutpaintMargins,
  processingSize: Size,
  config: OutpaintingConfig
) {
  if (isWithinOutpaintingLimits(processingSize, desired, config)) return desired

  const alignment = config.providerMarginAlignment
  const widthClamped = clampAxisMargins(
    desired,
    startingMargins,
    ['left', 'right'],
    (margins) => getProviderOutpaintSize(processingSize, margins, alignment).w <= config.maxWidth
  )
  const axisClamped = clampAxisMargins(
    widthClamped,
    startingMargins,
    ['top', 'bottom'],
    (margins) => getProviderOutpaintSize(processingSize, margins, alignment).h <= config.maxHeight
  )
  if (isWithinOutpaintingLimits(processingSize, axisClamped, config)) return axisClamped

  const base = { ...startingMargins }
  const outward = { top: 0, right: 0, bottom: 0, left: 0 }
  const edges: OutpaintEdge[] = ['top', 'right', 'bottom', 'left']
  edges.forEach((edge) => {
    if (axisClamped[edge] < startingMargins[edge]) base[edge] = axisClamped[edge]
    else outward[edge] = axisClamped[edge] - base[edge]
  })
  const maxStep = Math.max(outward.top, outward.right, outward.bottom, outward.left)
  if (!maxStep || !isWithinOutpaintingLimits(processingSize, base, config)) return base

  let low = 0
  let high = maxStep
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    const candidate = candidateAtStep(base, outward, middle, maxStep)
    if (isWithinOutpaintingLimits(processingSize, candidate, config)) low = middle
    else high = middle - 1
  }
  return candidateAtStep(base, outward, low, maxStep)
}

export function getMarginsFromLocalDrag(
  edges: readonly OutpaintEdge[],
  start: Point,
  current: Point,
  startingMargins: OutpaintMargins,
  displaySize: Size,
  processingSize: Size,
  config: OutpaintingConfig
) {
  const desired = { ...startingMargins }
  edges.forEach((edge) => {
    const horizontal = edge === 'left' || edge === 'right'
    const displayPrimary = horizontal ? displaySize.w : displaySize.h
    const processingPrimary = horizontal ? processingSize.w : processingSize.h
    const pixelsPerLocalUnit = processingPrimary / Math.max(1, displayPrimary)
    desired[edge] = Math.round(Math.max(
      0,
      startingMargins[edge]
        + getOutwardLocalDelta(edge, start, current) * pixelsPerLocalUnit
    ))
  })
  return constrainMargins(desired, startingMargins, processingSize, config)
}

export function marginPixelsToLocal(
  margins: OutpaintMargins,
  displaySize: Size,
  processingSize: Size
): OutpaintMargins {
  const localPerPixelX = displaySize.w / Math.max(1, processingSize.w)
  const localPerPixelY = displaySize.h / Math.max(1, processingSize.h)
  return {
    top: margins.top * localPerPixelY,
    right: margins.right * localPerPixelX,
    bottom: margins.bottom * localPerPixelY,
    left: margins.left * localPerPixelX,
  }
}

export function applyMatrix(
  matrix: { a: number; b: number; c: number; d: number; e: number; f: number },
  point: Point
): Point {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  }
}

export function invertMatrix(matrix: {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}) {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c
  if (Math.abs(determinant) < 1e-9) return null
  return {
    a: matrix.d / determinant,
    b: -matrix.b / determinant,
    c: -matrix.c / determinant,
    d: matrix.a / determinant,
    e: (matrix.c * matrix.f - matrix.d * matrix.e) / determinant,
    f: (matrix.b * matrix.e - matrix.a * matrix.f) / determinant,
  }
}

export function getBoundsForTransformedSize(
  linearMatrix: Pick<{ a: number; b: number; c: number; d: number }, 'a' | 'b' | 'c' | 'd'>,
  size: Size
) {
  const points = [
    { x: 0, y: 0 },
    { x: size.w, y: 0 },
    { x: size.w, y: size.h },
    { x: 0, y: size.h },
  ].map((point) => ({
    x: linearMatrix.a * point.x + linearMatrix.c * point.y,
    y: linearMatrix.b * point.x + linearMatrix.d * point.y,
  }))
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  }
}

export function normalizeVector(vector: Point): Point {
  const length = Math.hypot(vector.x, vector.y)
  if (!length) return { x: 0, y: 0 }
  return { x: vector.x / length, y: vector.y / length }
}

export function offsetPoint(origin: Point, direction: Point, distance: number): Point {
  const unit = normalizeVector(direction)
  return {
    x: origin.x + unit.x * distance,
    y: origin.y + unit.y * distance,
  }
}

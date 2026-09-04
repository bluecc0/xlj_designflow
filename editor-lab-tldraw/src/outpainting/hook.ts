import React from 'react'
import {
  AssetRecordType,
  createShapeId,
  type Editor,
  type TLImageAsset,
  type TLImageShape,
  type TLParentId,
  type TLShape,
} from 'tldraw'
import {
  applyMatrix,
  getExpectedOutpaintSize,
  getProcessingSizeForOutpainting,
  getWorkingSizeForOutpainting,
  hasOutpaintMargins,
  invertMatrix,
  isWithinOutpaintingLimits,
  marginPixelsToLocal,
  MIN_PROCESSING_SIDE,
} from './geometry'
import { useOutpainting } from './state'
import type {
  MatrixSnapshot,
  OutpaintMargins,
  OutpaintingConfig,
  OutpaintingEligibility,
  OutpaintingSourceCapture,
  SequentialLayoutAdapter,
} from './types'

const SUPPORTED_RASTER_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

function cloneMargins(margins: OutpaintMargins): OutpaintMargins {
  return { top: margins.top, right: margins.right, bottom: margins.bottom, left: margins.left }
}

function matrixSnapshot(matrix: MatrixSnapshot): MatrixSnapshot {
  return {
    a: matrix.a,
    b: matrix.b,
    c: matrix.c,
    d: matrix.d,
    e: matrix.e,
    f: matrix.f,
  }
}

function isFullCrop(crop: TLImageShape['props']['crop']) {
  if (!crop) return true
  const epsilon = 1e-6
  return (
    !crop.isCircle &&
    Math.abs(crop.topLeft.x) <= epsilon &&
    Math.abs(crop.topLeft.y) <= epsilon &&
    Math.abs(crop.bottomRight.x - 1) <= epsilon &&
    Math.abs(crop.bottomRight.y - 1) <= epsilon
  )
}

function inferMimeType(rawMime: string, name: string, src: string) {
  const mime = rawMime.trim().toLowerCase().split(';')[0]
  if (mime) return mime
  const candidate = `${name} ${src}`.toLowerCase().split(/[?#]/)[0]
  if (/\.png(?:\s|$)/.test(candidate)) return 'image/png'
  if (/\.jpe?g(?:\s|$)/.test(candidate)) return 'image/jpeg'
  if (/\.webp(?:\s|$)/.test(candidate)) return 'image/webp'
  return ''
}

function isInternalOrInlineSource(src: string) {
  if (src.startsWith('/') || src.startsWith('blob:') || src.startsWith('data:image/')) return true
  try {
    return new URL(src, window.location.origin).origin === window.location.origin
  } catch {
    return false
  }
}

export function getOutpaintingEligibility(
  editor: Editor,
  shape: TLShape | null,
  config: OutpaintingConfig | null
): OutpaintingEligibility {
  if (!shape || shape.type !== 'image') {
    return { shapeId: shape?.id || null, eligible: false, reason: '', processingWidth: 0, processingHeight: 0 }
  }
  if (!config || !config.enabled) {
    return { shapeId: shape.id, eligible: false, reason: '', processingWidth: 0, processingHeight: 0 }
  }
  if (shape.isLocked) {
    return { shapeId: shape.id, eligible: false, reason: '当前图片已锁定，解锁后才能扩图', processingWidth: 0, processingHeight: 0 }
  }
  if (shape.props.flipX || shape.props.flipY) {
    return { shapeId: shape.id, eligible: false, reason: '翻转后的图片暂不支持扩图，请先取消翻转', processingWidth: 0, processingHeight: 0 }
  }
  if (!isFullCrop(shape.props.crop)) {
    return { shapeId: shape.id, eligible: false, reason: '裁剪后的图片暂不支持扩图，请先恢复完整裁剪', processingWidth: 0, processingHeight: 0 }
  }
  if (!shape.props.assetId) {
    return { shapeId: shape.id, eligible: false, reason: '当前图片缺少原始素材，无法扩图', processingWidth: 0, processingHeight: 0 }
  }
  const asset = editor.getAsset(shape.props.assetId)
  if (!asset || asset.type !== 'image') {
    return { shapeId: shape.id, eligible: false, reason: '当前图片缺少可用的图片素材', processingWidth: 0, processingHeight: 0 }
  }
  if (asset.props.isAnimated) {
    return { shapeId: shape.id, eligible: false, reason: '动态图片暂不支持扩图，请使用静态 PNG、JPEG 或 WebP', processingWidth: 0, processingHeight: 0 }
  }
  const src = String(asset.props.src || '').trim()
  if (!src) {
    return { shapeId: shape.id, eligible: false, reason: '当前图片没有可用地址', processingWidth: 0, processingHeight: 0 }
  }
  if (!isInternalOrInlineSource(src)) {
    return { shapeId: shape.id, eligible: false, reason: '站外图片暂不支持扩图，请先上传到画布', processingWidth: 0, processingHeight: 0 }
  }
  const sourceFileSize = Number(asset.props.fileSize || 0)
  if (Number.isFinite(sourceFileSize) && sourceFileSize > config.maxSourceBytes) {
    const limitMb = Math.max(1, Math.floor(config.maxSourceBytes / (1024 * 1024)))
    return { shapeId: shape.id, eligible: false, reason: `原图文件超过 ${limitMb} MB，暂时不能扩图`, processingWidth: 0, processingHeight: 0 }
  }
  const mimeType = inferMimeType(String(asset.props.mimeType || ''), String(asset.props.name || ''), src)
  if (!SUPPORTED_RASTER_MIME_TYPES.has(mimeType)) {
    return { shapeId: shape.id, eligible: false, reason: '仅支持静态 PNG、JPEG 或 WebP 图片扩图', processingWidth: 0, processingHeight: 0 }
  }
  const meta = (shape.meta || {}) as Record<string, unknown>
  const naturalWidth = Math.round(Number(asset.props.w || meta.designflowOriginalWidth || 0))
  const naturalHeight = Math.round(Number(asset.props.h || meta.designflowOriginalHeight || 0))
  if (naturalWidth <= 0 || naturalHeight <= 0) {
    return { shapeId: shape.id, eligible: false, reason: '无法读取原图尺寸，暂时不能扩图', processingWidth: 0, processingHeight: 0 }
  }
  const workingSize = getWorkingSizeForOutpainting(
    { w: naturalWidth, h: naturalHeight },
    { w: Number(shape.props.w), h: Number(shape.props.h) }
  )
  const processingSize = getProcessingSizeForOutpainting(workingSize.w, workingSize.h, config)
  const processingWidth = processingSize.w
  const processingHeight = processingSize.h
  if (processingWidth < MIN_PROCESSING_SIDE || processingHeight < MIN_PROCESSING_SIDE) {
    return {
      shapeId: shape.id,
      eligible: false,
      reason: `扩图需要每边至少 ${MIN_PROCESSING_SIDE}px`,
      processingWidth,
      processingHeight,
    }
  }
  const canExpand = [
    { top: 1, right: 0, bottom: 0, left: 0 },
    { top: 0, right: 1, bottom: 0, left: 0 },
    { top: 0, right: 0, bottom: 1, left: 0 },
    { top: 0, right: 0, bottom: 0, left: 1 },
  ].some((margins) => isWithinOutpaintingLimits(
    { w: processingWidth, h: processingHeight },
    margins,
    config
  ))
  if (!canExpand) {
    return {
      shapeId: shape.id,
      eligible: false,
      reason: '原图尺寸已达到扩图上限',
      processingWidth,
      processingHeight,
    }
  }
  return { shapeId: shape.id, eligible: true, reason: '', processingWidth, processingHeight }
}

async function resolveSourceUrl(rawUrl: string) {
  const value = String(rawUrl || '').trim()
  if (!value) return ''
  if (value.startsWith('blob:')) {
    const response = await fetch(value)
    if (!response.ok) throw new Error(`无法读取本地图片: HTTP ${response.status}`)
    const blob = await response.blob()
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error('无法读取本地图片'))
      reader.readAsDataURL(blob)
    })
  }
  if (value.startsWith('/') || value.startsWith('data:image/')) return value
  try {
    const parsed = new URL(value, window.location.origin)
    if (parsed.origin === window.location.origin) return parsed.pathname + parsed.search + parsed.hash
    return parsed.toString()
  } catch {
    return value
  }
}

function normalizeResultUrl(rawUrl: string) {
  const value = String(rawUrl || '').trim()
  if (!value) return ''
  try {
    const parsed = new URL(value, window.location.origin)
    if (parsed.origin === window.location.origin) return parsed.pathname + parsed.search + parsed.hash
    return parsed.toString()
  } catch {
    return value
  }
}

function createOperationToken() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16)
    const value = character === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

const EDITOR_USER_ID = new URLSearchParams(window.location.search).get('user_id') || ''
const EDITOR_CANVAS_ID = 'editor'
const PENDING_STORAGE_KEY = `designflow:outpainting-pending:${EDITOR_USER_ID || 'anonymous'}:${EDITOR_CANVAS_ID}`
const PENDING_TTL_MS = 24 * 60 * 60 * 1000

type PendingOutpaintingJob = {
  jobId: string
  token: string
  fingerprint: string
  capture: OutpaintingSourceCapture
  createdAt: number
}

function persistableCapture(capture: OutpaintingSourceCapture): OutpaintingSourceCapture {
  const sourceUrl = String(capture.sourceUrl || '')
  if (sourceUrl.startsWith('data:') || sourceUrl.startsWith('blob:')) {
    return { ...capture, sourceUrl: '' }
  }
  return { ...capture }
}

function readPendingOutpaintingJob(): PendingOutpaintingJob | null {
  try {
    const raw = window.localStorage.getItem(PENDING_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PendingOutpaintingJob>
    if (!parsed || typeof parsed.jobId !== 'string' || !parsed.jobId) return null
    if (typeof parsed.token !== 'string' || !parsed.token) return null
    const capture = parsed.capture
    if (!capture || typeof capture !== 'object') return null
    if (!capture.sourceShapeId || !capture.sourcePageId || !capture.margins) return null
    if (!(Number(capture.processingWidth) > 0) || !(Number(capture.processingHeight) > 0)) return null
    const createdAt = Number(parsed.createdAt) || 0
    if (createdAt > 0 && Date.now() - createdAt > PENDING_TTL_MS) {
      window.localStorage.removeItem(PENDING_STORAGE_KEY)
      return null
    }
    return {
      jobId: parsed.jobId,
      token: parsed.token,
      fingerprint: typeof parsed.fingerprint === 'string' ? parsed.fingerprint : '',
      capture: { ...capture, operationToken: parsed.token },
      createdAt,
    }
  } catch {
    return null
  }
}

function writePendingOutpaintingJob(job: PendingOutpaintingJob) {
  try {
    window.localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify({
      jobId: job.jobId,
      token: job.token,
      fingerprint: job.fingerprint,
      capture: persistableCapture(job.capture),
      createdAt: job.createdAt,
    }))
  } catch {}
}

function clearPendingOutpaintingJob() {
  try {
    window.localStorage.removeItem(PENDING_STORAGE_KEY)
  } catch {}
}

function hasInsertedOutpaintingResult(editor: Editor, token: string) {
  if (!token) return false
  for (const asset of editor.getAssets()) {
    const meta = (asset.meta || {}) as Record<string, unknown>
    if (meta.outpaintingOperationToken === token) return true
  }
  for (const page of editor.getPages()) {
    for (const shapeId of editor.getPageShapeIds(page.id)) {
      const shape = editor.getShape(shapeId)
      const meta = (shape?.meta || {}) as Record<string, unknown>
      if (meta.outpaintingOperationToken === token) return true
    }
  }
  return false
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function abortIfStale(isCurrentOperation: () => boolean) {
  if (!isCurrentOperation()) throw new DOMException('aborted', 'AbortError')
}

async function pollOutpaintingJob(
  jobId: string,
  timeoutMs: number,
  isCurrentOperation: () => boolean,
  onProgress: (result: Record<string, unknown>, status: string) => void,
) {
  const pollIntervalMs = 1000
  const deadline = Date.now() + timeoutMs
  for (let attempt = 0; Date.now() < deadline; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => window.setTimeout(resolve, pollIntervalMs))
    abortIfStale(isCurrentOperation)
    const statusResponse = await fetch(`/ai-image/${encodeURIComponent(jobId)}`, { credentials: 'include' })
    if (!statusResponse.ok) {
      throw new Error(await readErrorResponse(statusResponse, `扩图状态读取失败: HTTP ${statusResponse.status}`))
    }
    const result = await statusResponse.json() as Record<string, unknown>
    const status = String(result.status || '').toLowerCase()
    if (status === 'failed' || status === 'error') {
      const error = new Error(String(result.error || '扩图失败'))
      ;(error as Error & { terminalJobFailure?: boolean }).terminalJobFailure = true
      throw error
    }
    if (status === 'done' || status === 'completed' || status === 'success') {
      return result
    }
    onProgress(result, status)
  }
  throw new Error('扩图任务超时，请稍后重试')
}

async function readErrorResponse(response: Response, fallback: string) {
  try {
    const text = await response.text()
    if (!text) return fallback
    try {
      const data = JSON.parse(text)
      if (data?.detail) return String(data.detail)
      if (data?.error) return String(data.error)
    } catch {}
    return text
  } catch {
    return fallback
  }
}

function formatError(error: unknown) {
  const raw = String((error as { message?: string })?.message || error || '扩图失败').trim()
  if (!raw) return '扩图失败，请稍后重试'
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.detail) return String(parsed.detail)
  } catch {}
  return raw.replace(/^\{"detail":"?|"?\}$/g, '').slice(0, 120)
}

function providerProgress(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  const percent = parsed >= 0 && parsed <= 1 ? parsed * 100 : parsed
  return Math.max(0, Math.min(100, Math.round(percent)))
}

function stageMessage(result: Record<string, unknown>) {
  const outpainting = result.outpainting && typeof result.outpainting === 'object'
    ? result.outpainting as Record<string, unknown>
    : null
  const providerStage = String(outpainting?.phase || result.stage || result.operation || '').toLowerCase()
  if (/upload/.test(providerStage)) return '正在上传原图'
  if (/queue|pending|waiting/.test(providerStage)) return '扩图任务排队中'
  if (/download/.test(providerStage)) return '正在下载扩图结果'
  if (/generate|outpaint|process|running|poll/.test(providerStage)) return 'AI 正在扩展画面'
  if (/save|final/.test(providerStage)) return '正在保存扩图结果'
  return 'AI 正在扩展画面'
}

async function fetchImageDetails(url: string) {
  const response = await fetch(url, { credentials: 'include' })
  if (!response.ok) throw new Error(`扩图结果读取失败: HTTP ${response.status}`)
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  try {
    const size = await new Promise<{ w: number; h: number }>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve({
        w: image.naturalWidth || image.width || 1,
        h: image.naturalHeight || image.height || 1,
      })
      image.onerror = () => reject(new Error('扩图结果无法解码'))
      image.src = objectUrl
    })
    return {
      size,
      fileSize: blob.size,
      mimeType: blob.type || 'image/png',
    }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

function getPageRotation(matrix: MatrixSnapshot) {
  return Math.atan2(matrix.b, matrix.a)
}

function getOverlayOrigin(capture: OutpaintingSourceCapture, displayWidth: number, displayHeight: number) {
  const localMargins = marginPixelsToLocal(
    capture.margins,
    { w: displayWidth, h: displayHeight },
    { w: capture.processingWidth, h: capture.processingHeight },
  )
  return { x: -localMargins.left, y: -localMargins.top }
}

function getResultPlacement(
  editor: Editor,
  capture: OutpaintingSourceCapture,
) {
  const live = editor.getShape<TLImageShape>(capture.sourceShapeId)
  const livePageId = live ? editor.getAncestorPageId(live) : null
  const displayWidth = live ? Number(live.props.w) : capture.displayWidth
  const displayHeight = live ? Number(live.props.h) : capture.displayHeight
  const localOrigin = getOverlayOrigin(capture, displayWidth, displayHeight)

  if (live && livePageId === capture.sourcePageId) {
    const pageTransform = matrixSnapshot(editor.getShapePageTransform(live))
    const pageOrigin = applyMatrix(pageTransform, localOrigin)
    const parentId = live.parentId
    if (parentId === capture.sourcePageId) {
      return {
        parentId,
        x: pageOrigin.x,
        y: pageOrigin.y,
        rotation: getPageRotation(pageTransform),
        displayWidth,
        displayHeight,
      }
    }
    const inverseParent = invertMatrix(matrixSnapshot(editor.getShapeParentTransform(live)))
    const local = inverseParent ? applyMatrix(inverseParent, pageOrigin) : pageOrigin
    return {
      parentId,
      x: local.x,
      y: local.y,
      rotation: live.rotation,
      displayWidth,
      displayHeight,
    }
  }

  const pageOrigin = applyMatrix(capture.sourcePageTransform, localOrigin)
  return {
    parentId: capture.sourcePageId as TLParentId,
    x: pageOrigin.x,
    y: pageOrigin.y,
    rotation: getPageRotation(capture.sourcePageTransform),
    displayWidth,
    displayHeight,
  }
}

function captureSource(
  editor: Editor,
  shape: TLImageShape,
  margins: OutpaintMargins,
  processingSize: { w: number; h: number },
  sequentialLayout: SequentialLayoutAdapter,
  operationToken: string
): OutpaintingSourceCapture {
  const asset = shape.props.assetId ? editor.getAsset(shape.props.assetId) : null
  if (!asset || asset.type !== 'image' || !shape.props.assetId) throw new Error('当前图片缺少可用素材')
  const pageId = editor.getAncestorPageId(shape)
  const bounds = editor.getShapePageBounds(shape)
  if (!pageId || !bounds) throw new Error('无法读取原图在画板中的位置')
  const sourcePageTransform = editor.getShapePageTransform(shape)
  const sourceParentPageTransform = editor.getShapeParentTransform(shape)
  return {
    operationToken,
    sourceShapeId: shape.id,
    sourceAssetId: shape.props.assetId,
    sourceUrl: String(asset.props.src || ''),
    sourceName: String(asset.props.name || 'outpaint-source'),
    sourceMimeType: inferMimeType(
      String(asset.props.mimeType || ''),
      String(asset.props.name || ''),
      String(asset.props.src || '')
    ),
    sourcePageId: pageId,
    sourceParentId: shape.parentId,
    sourceIndex: shape.index,
    sourceX: shape.x,
    sourceY: shape.y,
    sourceRotation: shape.rotation,
    initialPageBounds: { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h },
    sourcePageTransform: matrixSnapshot(sourcePageTransform),
    sourceParentPageTransform: matrixSnapshot(sourceParentPageTransform),
    displayWidth: Number(shape.props.w),
    displayHeight: Number(shape.props.h),
    processingWidth: processingSize.w,
    processingHeight: processingSize.h,
    crop: shape.props.crop ? JSON.parse(JSON.stringify(shape.props.crop)) : null,
    flipX: shape.props.flipX,
    flipY: shape.props.flipY,
    margins: cloneMargins(margins),
    sequentialOrder: sequentialLayout.getSourceOrder(shape, pageId),
  }
}

function insertOutpaintingResult(
  editor: Editor,
  capture: OutpaintingSourceCapture,
  resultUrl: string,
  naturalSize: { w: number; h: number },
  fileSize: number,
  mimeType: string,
) {
  if (hasInsertedOutpaintingResult(editor, capture.operationToken)) {
    return null
  }
  if (!editor.getPage(capture.sourcePageId)) {
    throw new Error('原图所在画板已删除，扩图结果未插入')
  }
  const placement = getResultPlacement(editor, capture)
  const outputDisplayWidth = Math.max(
    1,
    naturalSize.w * (placement.displayWidth / capture.processingWidth)
  )
  const outputDisplayHeight = Math.max(
    1,
    naturalSize.h * (placement.displayHeight / capture.processingHeight)
  )
  const assetId = AssetRecordType.createId()
  const shapeId = createShapeId() as TLImageShape['id']
  const assetRecord: TLImageAsset = {
    id: assetId,
    typeName: 'asset',
    type: 'image',
    props: {
      w: naturalSize.w,
      h: naturalSize.h,
      name: `outpainted-${capture.sourceName.replace(/^outpainted-/, '')}`,
      isAnimated: false,
      mimeType,
      src: resultUrl,
      fileSize,
    },
    meta: {
      outpaintedFrom: capture.sourceUrl,
      outpaintingOperationToken: capture.operationToken,
      naturalWidth: naturalSize.w,
      naturalHeight: naturalSize.h,
    },
  }

  editor.markHistoryStoppingPoint('insert-outpainted-image')
  editor.run(() => {
    if (hasInsertedOutpaintingResult(editor, capture.operationToken)) return
    editor.createAssets([assetRecord])
    editor.createShape({
      id: shapeId,
      type: 'image',
      parentId: placement.parentId,
      x: placement.x,
      y: placement.y,
      rotation: placement.rotation,
      props: {
        w: outputDisplayWidth,
        h: outputDisplayHeight,
        assetId,
        playing: true,
        url: '',
        crop: null,
        flipX: false,
        flipY: false,
        altText: assetRecord.props.name,
      },
      meta: {
        designflowInserted: true,
        designflowLayoutExcluded: true,
        outpaintedFrom: capture.sourceUrl,
        outpaintingOperationToken: capture.operationToken,
        outpaintingSourceShapeId: capture.sourceShapeId,
        outpaintingSourceAssetId: capture.sourceAssetId,
        outpaintingSourceParentId: capture.sourceParentId,
        outpaintingSourceIndex: String(capture.sourceIndex),
        outpaintingMargins: cloneMargins(capture.margins),
        designflowOriginalWidth: naturalSize.w,
        designflowOriginalHeight: naturalSize.h,
        naturalWidth: naturalSize.w,
        naturalHeight: naturalSize.h,
      },
    })
    editor.bringToFront([shapeId])
    if (editor.getCurrentPageId() !== capture.sourcePageId) {
      editor.setCurrentPage(capture.sourcePageId)
    }
    editor.select(shapeId)
  })
  return shapeId
}

export function useOutpaintingController(editor: Editor, sequentialLayout: SequentialLayoutAdapter) {
  const outpainting = useOutpainting()
  const activeOperationRef = React.useRef<string | null>(null)
  const retryRequestRef = React.useRef<{ fingerprint: string; token: string } | null>(null)
  const restoreStartedRef = React.useRef(false)

  const finishInserted = React.useCallback((operationToken: string) => {
    retryRequestRef.current = null
    clearPendingOutpaintingJob()
    outpainting.clearDraft()
    outpainting.setOperation({
      stage: 'done',
      message: '扩图已填入拉出的范围',
      progress: null,
      processing: false,
      sourceShapeId: null,
    })
    window.setTimeout(() => {
      if (activeOperationRef.current !== operationToken) return
      outpainting.setOperation((current) => current.stage === 'done'
        ? { stage: 'idle', message: '', progress: null, processing: false, sourceShapeId: null }
        : current)
    }, 2200)
  }, [outpainting])

  const watchAndInsert = React.useCallback(async (
    jobId: string,
    capture: OutpaintingSourceCapture,
    timeoutSeconds: number,
  ) => {
    const operationToken = capture.operationToken
    const isCurrentOperation = () => activeOperationRef.current === operationToken
    abortIfStale(isCurrentOperation)
    outpainting.setOperation({
      stage: 'queued',
      message: '扩图任务排队中',
      progress: null,
      processing: true,
      sourceShapeId: capture.sourceShapeId,
    })
    const completed = await pollOutpaintingJob(
      jobId,
      Math.max(15_000, (timeoutSeconds + 30) * 1000),
      isCurrentOperation,
      (result, status) => {
        const progress = providerProgress(result.progress)
        outpainting.setOperation({
          stage: status === 'queued' || status === 'pending' ? 'queued' : 'processing',
          message: status === 'queued' || status === 'pending' ? '扩图任务排队中' : stageMessage(result),
          progress,
          processing: true,
          sourceShapeId: capture.sourceShapeId,
        })
      }
    )
    const imageUrl = normalizeResultUrl(String(completed.image_url || ''))
    if (!imageUrl) throw new Error('扩图完成，但服务没有返回结果图片')
    abortIfStale(isCurrentOperation)
    if (hasInsertedOutpaintingResult(editor, operationToken)) {
      finishInserted(operationToken)
      return
    }
    outpainting.setOperation({
      stage: 'downloading',
      message: '扩图完成，正在读取结果',
      progress: null,
      processing: true,
      sourceShapeId: capture.sourceShapeId,
    })
    const imageDetails = await fetchImageDetails(imageUrl)
    abortIfStale(isCurrentOperation)
    const expectedNaturalSize = getExpectedOutpaintSize(
      { w: capture.processingWidth, h: capture.processingHeight },
      capture.margins
    )
    if (
      imageDetails.size.w !== expectedNaturalSize.w
      || imageDetails.size.h !== expectedNaturalSize.h
    ) {
      throw new Error(
        `扩图结果尺寸不正确，预期 ${expectedNaturalSize.w} × ${expectedNaturalSize.h}`
      )
    }
    outpainting.setOperation({
      stage: 'inserting',
      message: '正在把扩图叠到原图上',
      progress: null,
      processing: true,
      sourceShapeId: capture.sourceShapeId,
    })
    insertOutpaintingResult(
      editor,
      capture,
      imageUrl,
      imageDetails.size,
      imageDetails.fileSize,
      imageDetails.mimeType,
    )
    abortIfStale(isCurrentOperation)
    finishInserted(operationToken)
  }, [editor, finishInserted, outpainting])

  const submit = React.useCallback(async () => {
    const { config, draft, eligibility, operation, externalOperationBusy } = outpainting
    if (!config?.enabled || !draft || operation.processing || externalOperationBusy) return
    if (!eligibility.eligible || eligibility.shapeId !== draft.sourceShapeId) return
    if (!hasOutpaintMargins(draft.margins)) return

    const sourceShape = editor.getShape<TLImageShape>(draft.sourceShapeId)
    if (!sourceShape || sourceShape.type !== 'image') {
      outpainting.setOperation({
        stage: 'error',
        message: '原图已被删除，请重新选择图片',
        progress: null,
        processing: false,
        sourceShapeId: draft.sourceShapeId,
      })
      return
    }
    const currentEligibility = getOutpaintingEligibility(editor, sourceShape, config)
    if (!currentEligibility.eligible) {
      outpainting.setEligibility(currentEligibility)
      outpainting.setOperation({
        stage: 'error',
        message: currentEligibility.reason || '当前图片暂不能扩图',
        progress: null,
        processing: false,
        sourceShapeId: sourceShape.id,
      })
      return
    }
    if (!isWithinOutpaintingLimits(
      { w: currentEligibility.processingWidth, h: currentEligibility.processingHeight },
      draft.margins,
      config
    )) {
      outpainting.setOperation({
        stage: 'error',
        message: '当前扩图尺寸超过服务上限，请缩小扩展范围',
        progress: null,
        processing: false,
        sourceShapeId: sourceShape.id,
      })
      return
    }

    const sourceAsset = sourceShape.props.assetId ? editor.getAsset(sourceShape.props.assetId) : null
    const requestFingerprint = JSON.stringify({
      shapeId: sourceShape.id,
      assetId: sourceShape.props.assetId,
      sourceUrl: sourceAsset?.type === 'image' ? sourceAsset.props.src : '',
      processingWidth: currentEligibility.processingWidth,
      processingHeight: currentEligibility.processingHeight,
      margins: cloneMargins(draft.margins),
    })
    const existingRetry = retryRequestRef.current
    const operationToken = existingRetry?.fingerprint === requestFingerprint
      ? existingRetry.token
      : createOperationToken()
    retryRequestRef.current = { fingerprint: requestFingerprint, token: operationToken }

    let capture: OutpaintingSourceCapture
    try {
      capture = captureSource(
        editor,
        sourceShape,
        draft.margins,
        { w: currentEligibility.processingWidth, h: currentEligibility.processingHeight },
        sequentialLayout,
        operationToken
      )
    } catch (error) {
      outpainting.setOperation({
        stage: 'error',
        message: formatError(error),
        progress: null,
        processing: false,
        sourceShapeId: sourceShape.id,
      })
      return
    }
    if (!outpainting.claimOperation('outpainting')) return

    activeOperationRef.current = operationToken
    const isCurrentOperation = () => activeOperationRef.current === operationToken
    outpainting.setOperation({
      stage: 'submitting',
      message: '正在提交扩图任务',
      progress: null,
      processing: true,
      sourceShapeId: capture.sourceShapeId,
    })

    try {
      capture.sourceUrl = await resolveSourceUrl(capture.sourceUrl)
      if (!capture.sourceUrl) throw new Error('当前图片没有可用地址')
      const createResponse = await fetch('/ai-image/outpainting', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: capture.sourceUrl,
          processing_width: capture.processingWidth,
          processing_height: capture.processingHeight,
          outpaint: cloneMargins(capture.margins),
          client_request_id: capture.operationToken,
        }),
      })
      if (!createResponse.ok) {
        throw new Error(await readErrorResponse(createResponse, `扩图任务创建失败: HTTP ${createResponse.status}`))
      }
      const created = await createResponse.json()
      const jobId = String(created?.job_id || '')
      if (!jobId) throw new Error('扩图服务没有返回任务 ID')
      abortIfStale(isCurrentOperation)
      writePendingOutpaintingJob({
        jobId,
        token: operationToken,
        fingerprint: requestFingerprint,
        capture,
        createdAt: Date.now(),
      })
      await watchAndInsert(jobId, capture, config.timeoutSeconds)
    } catch (error) {
      if (isAbortError(error) || !isCurrentOperation()) return
      const terminalJobFailure = Boolean((error as Error & { terminalJobFailure?: boolean }).terminalJobFailure)
      if (terminalJobFailure) {
        retryRequestRef.current = null
        clearPendingOutpaintingJob()
      }
      outpainting.setOperation({
        stage: 'error',
        message: formatError(error),
        progress: null,
        processing: false,
        sourceShapeId: capture.sourceShapeId,
      })
    } finally {
      outpainting.releaseOperation('outpainting')
    }
  }, [editor, outpainting, sequentialLayout, watchAndInsert])

  React.useEffect(() => {
    outpainting.registerExecutor(submit)
    return () => outpainting.registerExecutor(null)
  }, [outpainting.registerExecutor, submit])

  const watchAndInsertRef = React.useRef(watchAndInsert)
  watchAndInsertRef.current = watchAndInsert
  const configReady = Boolean(outpainting.config)
  const timeoutSeconds = outpainting.config?.timeoutSeconds || 600

  React.useEffect(() => {
    if (!configReady || restoreStartedRef.current) return
    const pending = readPendingOutpaintingJob()
    restoreStartedRef.current = true
    if (!pending) return
    if (hasInsertedOutpaintingResult(editor, pending.token)) {
      clearPendingOutpaintingJob()
      return
    }
    if (!outpainting.claimOperation('outpainting')) return
    const operationToken = pending.token
    activeOperationRef.current = operationToken
    retryRequestRef.current = { fingerprint: pending.fingerprint, token: operationToken }
    let cancelled = false
    void (async () => {
      try {
        await watchAndInsertRef.current(pending.jobId, pending.capture, timeoutSeconds)
      } catch (error) {
        if (cancelled || isAbortError(error) || activeOperationRef.current !== operationToken) return
        const terminalJobFailure = Boolean((error as Error & { terminalJobFailure?: boolean }).terminalJobFailure)
        if (terminalJobFailure) {
          retryRequestRef.current = null
          clearPendingOutpaintingJob()
        }
        outpainting.setOperation({
          stage: 'error',
          message: formatError(error),
          progress: null,
          processing: false,
          sourceShapeId: pending.capture.sourceShapeId,
        })
      } finally {
        outpainting.releaseOperation('outpainting')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [configReady, editor, outpainting.claimOperation, outpainting.releaseOperation, outpainting.setOperation, timeoutSeconds])

  return outpainting
}

export function getExpectedSizeForDraft(
  eligibility: OutpaintingEligibility,
  margins: OutpaintMargins
) {
  return getExpectedOutpaintSize(
    { w: eligibility.processingWidth, h: eligibility.processingHeight },
    margins
  )
}

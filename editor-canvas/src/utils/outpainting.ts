import type { CanvasImage, OutpaintMargins } from '../types'

export type OutpaintingMode = 'fast' | 'high'
export interface OutpaintingLimits {
  maxWidth: number
  maxHeight: number
  maxAreaPixels: number
  fastMaxAreaPixels: number
}

export const DEFAULT_OUTPAINTING_LIMITS: OutpaintingLimits = {
  maxWidth: 4096,
  maxHeight: 4096,
  maxAreaPixels: 4_194_304,
  // Product safety margin: BFL does not publish its fast latent padding formula.
  fastMaxAreaPixels: 3_800_000,
}

type SourceSize = Pick<CanvasImage, 'width' | 'height' | 'naturalWidth' | 'naturalHeight'>
export interface OutpaintingPlan {
  processingWidth: number
  processingHeight: number
  margins: OutpaintMargins
  outputWidth: number
  outputHeight: number
  error: string | null
}

/** The toolbar and submit handler must validate the exact same physical pixels. */
export function getOutpaintingPlan(
  image: SourceSize,
  initial: SourceSize | null,
  margins: OutpaintMargins,
  mode: OutpaintingMode = 'fast',
  limits = DEFAULT_OUTPAINTING_LIMITS,
): OutpaintingPlan {
  const naturalWidth = initial?.naturalWidth || image.naturalWidth || image.width
  const naturalHeight = initial?.naturalHeight || image.naturalHeight || image.height
  const initialWidth = initial?.width || image.width
  const multiplier = image.width / initialWidth
  const processingWidth = Math.round(naturalWidth * multiplier)
  const processingHeight = Math.round(naturalHeight * multiplier)
  const physicalMargins = {
    top: Math.round(margins.top * processingHeight / image.height),
    right: Math.round(margins.right * processingWidth / image.width),
    bottom: Math.round(margins.bottom * processingHeight / image.height),
    left: Math.round(margins.left * processingWidth / image.width),
  }
  const outputWidth = processingWidth + physicalMargins.left + physicalMargins.right
  const outputHeight = processingHeight + physicalMargins.top + physicalMargins.bottom
  let error: string | null = null
  if (![image.width, image.height, naturalWidth, naturalHeight, initialWidth, processingWidth, processingHeight]
    .every((value) => Number.isFinite(value) && value > 0)) {
    error = '原图尺寸无效，请重新选择图片或放大原图'
  } else if (![...Object.values(margins), ...Object.values(physicalMargins)]
    .every((value) => Number.isFinite(value) && value >= 0)) {
    error = '扩图边距必须是有效的非负数'
  } else if (!Object.values(physicalMargins).some((value) => value > 0)) {
    error = '请向外拖动扩图手柄，至少扩展 1px'
  } else if (processingWidth > limits.maxWidth || processingHeight > limits.maxHeight ||
    outputWidth > limits.maxWidth || outputHeight > limits.maxHeight) {
    error = `最终尺寸不能超过 ${limits.maxWidth}×${limits.maxHeight}px，请缩小原图或边距`
  } else if (outputWidth < 64 || outputHeight < 64) {
    error = '最终尺寸每边至少需要 64px，请放大原图或增加边距'
  } else if (outputWidth * outputHeight > limits.maxAreaPixels) {
    error = `最终尺寸不能超过 ${(limits.maxAreaPixels / 1_000_000).toFixed(2)}MP，请缩小原图或边距`
  } else if (mode === 'fast' && (processingWidth < 64 || processingHeight < 64)) {
    error = 'fast 模式要求原图每边至少 64px，请放大原图，或按住 Shift 使用 high'
  } else if (mode === 'fast' && Math.max(processingWidth, processingHeight) > Math.min(processingWidth, processingHeight) * 8) {
    error = 'fast 模式要求原图宽高比不超过 8:1，请更换图片，或按住 Shift 使用 high'
  } else if (mode === 'fast' && outputWidth * outputHeight > limits.fastMaxAreaPixels) {
    error = `fast 模式为内部补齐预留空间，安全上限 ${(limits.fastMaxAreaPixels / 1_000_000).toFixed(2)}MP；请缩小范围，或按住 Shift 使用 high`
  }
  return { processingWidth, processingHeight, margins: physicalMargins, outputWidth, outputHeight, error }
}

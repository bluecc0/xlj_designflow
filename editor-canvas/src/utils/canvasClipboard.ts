// 画布图片的复制粘贴：选中的图片写进系统剪贴板（纯文本里的 JSON），
// 换到别的画布（同一页面切换、或另一个标签页）粘贴时还原，保持多张图之间的相对位置。

import type { CanvasImage } from '../types'

const MARK = 'designflow-canvas-images'

export interface ClipboardImage {
  /** 相对选区左上角的偏移 */
  dx: number
  dy: number
  width: number
  height: number
  rotation: number
  url: string
  naturalWidth?: number
  naturalHeight?: number
  name?: string
  opacity?: number
  meta?: CanvasImage['meta']
}

interface Payload {
  type: typeof MARK
  version: 1
  images: ClipboardImage[]
}

/** 选中的图片 → 剪贴板文本；没有可复制的图片返回 null（blob: 地址换了页面就失效，跳过）。 */
export function encodeCanvasImages(images: CanvasImage[]): string | null {
  const list = images.filter((im) => im.url && !im.url.startsWith('blob:'))
  if (!list.length) return null
  const left = Math.min(...list.map((im) => im.x))
  const top = Math.min(...list.map((im) => im.y))
  const payload: Payload = {
    type: MARK,
    version: 1,
    images: list.map((im) => ({
      dx: im.x - left,
      dy: im.y - top,
      width: im.width,
      height: im.height,
      rotation: im.rotation || 0,
      url: im.url,
      naturalWidth: im.naturalWidth,
      naturalHeight: im.naturalHeight,
      name: im.name,
      opacity: im.opacity,
      meta: im.meta,
    })),
  }
  return JSON.stringify(payload)
}

/** 剪贴板文本 → 图片列表；不是画布复制的内容返回 null。 */
export function decodeCanvasImages(text: string): ClipboardImage[] | null {
  if (!text || !text.startsWith('{') || !text.includes(MARK)) return null
  try {
    const data = JSON.parse(text) as Partial<Payload>
    if (data?.type !== MARK || !Array.isArray(data.images)) return null
    const images = data.images.filter(
      (im) =>
        im &&
        typeof im.url === 'string' &&
        im.url &&
        [im.dx, im.dy, im.width, im.height].every((v) => typeof v === 'number' && Number.isFinite(v)) &&
        im.width > 0 &&
        im.height > 0
    )
    return images.length ? images : null
  } catch {
    return null
  }
}

/** 粘贴位置：整组的中心对准 center（画布坐标），生成新的图片数据。 */
export function layoutPastedImages(
  images: ClipboardImage[],
  center: { x: number; y: number },
  makeId: () => string
): Omit<CanvasImage, 'pageId'>[] {
  const groupW = Math.max(...images.map((im) => im.dx + im.width))
  const groupH = Math.max(...images.map((im) => im.dy + im.height))
  const left = Math.round(center.x - groupW / 2)
  const top = Math.round(center.y - groupH / 2)
  return images.map((im) => ({
    id: makeId(),
    frameId: null,
    x: left + im.dx,
    y: top + im.dy,
    width: im.width,
    height: im.height,
    rotation: im.rotation || 0,
    url: im.url,
    naturalWidth: im.naturalWidth,
    naturalHeight: im.naturalHeight,
    name: im.name,
    locked: false,
    opacity: im.opacity ?? 1,
    meta: im.meta,
  }))
}

import type { CanvasDocument, CanvasFrame, CanvasImage } from '../types'

/**
 * 将旧版 tldraw snapshot 转换为新版通用的 CanvasDocument
 */
export function convertLegacyTldrawSnapshot(raw: any): CanvasDocument | null {
  if (!raw || typeof raw !== 'object') return null

  // 1. 如果本身已经是新版格式
  if (raw.version === 2 && Array.isArray(raw.frames) && Array.isArray(raw.images)) {
    return raw as CanvasDocument
  }

  // 2. 检测 tldraw 结构
  const store = raw?.document?.store || raw?.store
  if (!store || typeof store !== 'object') return null

  const frames: CanvasFrame[] = []
  const images: CanvasImage[] = []
  const assets: Record<string, any> = {}

  // 提取 asset
  for (const item of Object.values(store) as any[]) {
    if (item && item.typeName === 'asset') {
      assets[item.id] = item.props?.src || ''
    }
  }

  // 提取 page -> frames
  let pageIndex = 0
  for (const item of Object.values(store) as any[]) {
    if (item && item.typeName === 'page') {
      frames.push({
        id: item.id,
        name: item.name || `画板 ${pageIndex + 1}`,
        x: pageIndex * 1200,
        y: 0,
        width: 1080,
        height: 1080,
      })
      pageIndex++
    }
  }

  if (frames.length === 0) {
    frames.push({
      id: 'frame-1',
      name: '画板 1',
      x: 0,
      y: 0,
      width: 1080,
      height: 1080,
    })
  }

  // 提取 shape:image
  for (const item of Object.values(store) as any[]) {
    if (item && item.typeName === 'shape' && item.type === 'image') {
      const assetId = item.props?.assetId
      const src = assets[assetId] || item.props?.url || ''
      if (!src) continue

      images.push({
        id: item.id,
        frameId: item.parentId || frames[0].id,
        x: item.x || 0,
        y: item.y || 0,
        width: item.props?.w || 400,
        height: item.props?.h || 400,
        rotation: item.rotation || 0,
        url: src,
        name: item.props?.name || '导入图片',
        locked: Boolean(item.isLocked),
        opacity: item.opacity ?? 1,
        meta: item.meta,
      })
    }
  }

  return {
    version: 2,
    frames,
    images,
  }
}

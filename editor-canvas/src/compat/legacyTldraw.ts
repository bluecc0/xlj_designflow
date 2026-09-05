import type { CanvasDocument, CanvasFrame, CanvasImage, CanvasPage, CanvasText } from '../types'

/**
 * 将旧版 tldraw snapshot 转换为新版通用的 CanvasDocument
 */
export function convertLegacyTldrawSnapshot(raw: any): CanvasDocument | null {
  if (!raw || typeof raw !== 'object') return null

  // 1. 如果本身已经是新版格式
  if (raw.version === 2 && Array.isArray(raw.images)) {
    const pages: CanvasPage[] = Array.isArray(raw.pages) && raw.pages.length
      ? raw.pages
      : [{ id: 'page-1', name: '画板 1', order: 0 }]
    const activePageId = raw.activePageId || pages[0].id
    const frames: CanvasFrame[] = (raw.frames || []).map((f: any) => ({
      ...f,
      pageId: f.pageId || activePageId,
    }))
    const images: CanvasImage[] = (raw.images || []).map((im: any) => ({
      ...im,
      pageId: im.pageId || activePageId,
    }))
    const texts: CanvasText[] = (raw.texts || []).map((txt: any) => ({
      ...txt,
      pageId: txt.pageId || activePageId,
    }))

    return {
      version: 2,
      pages,
      activePageId,
      frames,
      images,
      texts,
      viewport: raw.viewport,
    }
  }

  // 2. 检测 tldraw 结构
  const store = raw?.document?.store || raw?.store
  if (!store || typeof store !== 'object') return null

  const pages: CanvasPage[] = []
  const frames: CanvasFrame[] = []
  const images: CanvasImage[] = []
  const texts: CanvasText[] = []
  const assets: Record<string, any> = {}

  // 提取 asset
  for (const item of Object.values(store) as any[]) {
    if (item && item.typeName === 'asset') {
      assets[item.id] = item.props?.src || ''
    }
  }

  // 提取 page
  let pageIndex = 0
  for (const item of Object.values(store) as any[]) {
    if (item && item.typeName === 'page') {
      pages.push({
        id: item.id,
        name: item.name || `画板 ${pageIndex + 1}`,
        order: pageIndex,
      })
      pageIndex++
    }
  }

  if (pages.length === 0) {
    pages.push({
      id: 'page-1',
      name: '画板 1',
      order: 0,
    })
  }

  const activePageId = pages[0].id

  // 提取 shape:image & shape:text
  for (const item of Object.values(store) as any[]) {
    if (!item || item.typeName !== 'shape') continue
    const parentPageId = pages.some((p) => p.id === item.parentId) ? item.parentId : activePageId

    if (item.type === 'image') {
      const assetId = item.props?.assetId
      const src = assets[assetId] || item.props?.url || ''
      if (!src) continue

      images.push({
        id: item.id,
        pageId: parentPageId,
        frameId: null, // 默认作为自由图片
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
    } else if (item.type === 'text') {
      const content = item.props?.text || ''
      if (!content.trim()) continue
      texts.push({
        id: item.id,
        pageId: parentPageId,
        frameId: null,
        x: item.x || 0,
        y: item.y || 0,
        width: item.props?.w || 200,
        height: item.props?.h || 40,
        text: content,
        fontSize: item.props?.size === 's' ? 14 : item.props?.size === 'm' ? 18 : item.props?.size === 'xl' ? 32 : 24,
        color: '#1e293b',
        fontWeight: 'normal',
      })
    }
  }

  return {
    version: 2,
    pages,
    activePageId,
    frames,
    images,
    texts,
  }
}

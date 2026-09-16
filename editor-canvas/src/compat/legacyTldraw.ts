import type { CanvasDocument, CanvasFrame, CanvasImage, CanvasPage, CanvasText } from '../types'

// 2D 仿射变换矩阵
type Mat2D = {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

function identityMat(): Mat2D {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
}

function makeTransform(x: number, y: number, rotationRad: number): Mat2D {
  const cos = Math.cos(rotationRad)
  const sin = Math.sin(rotationRad)
  return {
    a: cos,
    b: sin,
    c: -sin,
    d: cos,
    e: x,
    f: y,
  }
}

function multiplyTransforms(m1: Mat2D, m2: Mat2D): Mat2D {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  }
}

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

  const pageIdSet = new Set(pages.map((p) => p.id))
  const activePageId = pages[0].id

  // 建立 shape 查找表
  const shapesById = new Map<string, any>()
  for (const item of Object.values(store) as any[]) {
    if (item && item.typeName === 'shape') {
      shapesById.set(item.id, item)
    }
  }

  // 解析 shape 的父级链条与组合 2D 仿射变换
  const resolveShapeHierarchy = (shapeId: string, width: number = 0, height: number = 0) => {
    const item = shapesById.get(shapeId)
    if (!item) {
      return {
        x: 0,
        y: 0,
        rotationDeg: 0,
        pageId: activePageId,
        frameId: null as string | null,
      }
    }

    const chain: any[] = []
    let curr = item
    const visited = new Set<string>()
    let pageId: string | null = null
    let frameId: string | null = null

    while (curr) {
      if (visited.has(curr.id)) break
      visited.add(curr.id)
      chain.unshift(curr) // 祖先在前，子元素在后

      const parentId = curr.parentId
      if (!parentId) break

      if (pageIdSet.has(parentId)) {
        pageId = parentId
        break
      }

      const parentShape = shapesById.get(parentId)
      if (!parentShape) break

      if (parentShape.type === 'frame' && !frameId) {
        frameId = parentShape.id
      }
      curr = parentShape
    }

    // 从顶层祖先开始逐级乘累积变换矩阵
    let M = identityMat()
    for (const node of chain) {
      const nodeMat = makeTransform(node.x || 0, node.y || 0, node.rotation || 0)
      M = multiplyTransforms(M, nodeMat)
    }

    // 在子元素局部坐标系中，中心点位于 (width / 2, height / 2)
    const localCenterX = width / 2
    const localCenterY = height / 2
    const worldCenterX = M.a * localCenterX + M.c * localCenterY + M.e
    const worldCenterY = M.b * localCenterX + M.d * localCenterY + M.f

    const worldRad = Math.atan2(M.b, M.a)
    const worldDeg = worldRad * (180 / Math.PI)
    const normalizedDeg = Number((((worldDeg % 360) + 360) % 360).toFixed(2))

    // 新 ImageShape 采用 CSS transform: rotate(...) 绕中心旋转 (transform-origin: center center)
    // 故其包围盒左上角应为 (worldCenterX - width / 2, worldCenterY - height / 2)
    const x = Math.round(worldCenterX - width / 2)
    const y = Math.round(worldCenterY - height / 2)

    return {
      x,
      y,
      rotationDeg: normalizedDeg,
      pageId: pageId || activePageId,
      frameId,
    }
  }

  // 1. 提取 frame（画板容器）
  let frameIdx = 0
  for (const item of shapesById.values()) {
    if (item.type === 'frame') {
      const w = item.props?.w || 800
      const h = item.props?.h || 600
      const { x, y, pageId } = resolveShapeHierarchy(item.id, w, h)
      frames.push({
        id: item.id,
        pageId,
        name: item.props?.name || `画板 ${frameIdx + 1}`,
        x,
        y,
        width: w,
        height: h,
      })
      frameIdx++
    }
  }

  // 2. 提取 shape:image & shape:text
  for (const item of shapesById.values()) {
    if (item.type === 'image') {
      const assetId = item.props?.assetId
      const src = assets[assetId] || item.props?.url || ''
      if (!src) continue

      const w = item.props?.w || 400
      const h = item.props?.h || 400
      const { x, y, rotationDeg, pageId, frameId } = resolveShapeHierarchy(item.id, w, h)

      images.push({
        id: item.id,
        pageId,
        frameId,
        x,
        y,
        width: w,
        height: h,
        rotation: rotationDeg,
        url: src,
        name: item.props?.name || '导入图片',
        locked: Boolean(item.isLocked),
        opacity: item.opacity ?? 1,
        meta: item.meta,
      })
    } else if (item.type === 'text') {
      const content = item.props?.text || ''
      if (!content.trim()) continue

      const w = item.props?.w || 200
      const h = item.props?.h || 40
      const { x, y, pageId, frameId } = resolveShapeHierarchy(item.id, w, h)

      texts.push({
        id: item.id,
        pageId,
        frameId,
        x,
        y,
        width: w,
        height: h,
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

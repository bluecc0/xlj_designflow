import { create } from 'zustand'
import type { CanvasDocument, CanvasFrame, CanvasImage, CanvasPage, CanvasText, CanvasTool } from '../types'
import { useHistoryStore } from './historyStore'
import { useViewportStore } from './viewportStore'

interface CanvasState {
  // 多页面
  pages: CanvasPage[]
  activePageId: string

  // 画板与图元
  frames: CanvasFrame[]
  images: CanvasImage[]
  texts: CanvasText[]

  // 选区与工具
  selectedIds: string[]
  selectedType: 'image' | 'frame' | 'text' | null
  activeTool: CanvasTool

  // 持久化与状态
  revision: number
  isDirty: boolean
  editSequence: number
  lastSavedSequence: number
  lastSaveIntent: 'update' | 'user_delete'
  baseDocument: CanvasDocument | null

  // 页面操作
  createPage: (name?: string) => string
  switchPage: (pageId: string) => void
  renamePage: (pageId: string, name: string) => void
  deletePage: (pageId: string) => void

  // 画板操作
  addFrame: (frame: Omit<CanvasFrame, 'pageId' | 'name'> & { name?: string }) => CanvasFrame
  updateFrame: (id: string, patch: Partial<CanvasFrame>, moveChildren?: boolean) => void
  deleteFrame: (id: string) => void

  // 图片操作
  addImage: (image: Omit<CanvasImage, 'pageId'>) => CanvasImage
  addImages: (images: Omit<CanvasImage, 'pageId'>[]) => CanvasImage[]
  updateImage: (id: string, patch: Partial<CanvasImage>) => void
  updateImages: (patches: { id: string; patch: Partial<CanvasImage> }[]) => void
  deleteImage: (id: string) => void

  // 文本操作
  addText: (text: Partial<CanvasText> & { x: number; y: number }) => CanvasText
  updateText: (id: string, patch: Partial<CanvasText>) => void
  deleteText: (id: string) => void

  deleteSelected: () => void
  duplicateSelected: () => void
  bringToFront: (id: string) => void
  bringForward: (id: string) => void
  sendBackward: (id: string) => void
  sendToBack: (id: string) => void
  alignSelected: (type: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => void
  distributeSelected: (type: 'horizontal' | 'vertical') => void
  tidyUpSelected: (mode: 'horizontal' | 'vertical' | 'grid', gap?: number) => void
  toggleLockSelected: () => void
  selectAll: () => void

  // 选区与工具
  setSelected: (ids: string[], type: 'image' | 'frame' | 'text' | null) => void
  toggleSelected: (id: string, type: 'image' | 'frame' | 'text') => void
  clearSelection: () => void
  setActiveTool: (tool: CanvasTool) => void
  recalcFrameAttachment: (type: 'image' | 'text', ids: string[]) => void

  // 自动排版与流式重排
  insertImagesAuto: (items: (string | { url: string; name?: string; [key: string]: any })[], mode?: string, name?: string) => CanvasImage[]
  reflowSequentialImages: (pageId?: string) => void

  // 快照与保存
  recordHistory: (snapshot?: CanvasDocument) => void
  loadDocument: (doc: any, rev?: number) => void
  restoreHistoryDocument: (doc: any) => void
  mergeConflictDocument: (serverDoc: any, serverRev: number) => void
  getDocument: () => CanvasDocument
  markSaved: (rev: number, savedSequence?: number, savedDoc?: CanvasDocument) => void
}

const DEFAULT_PAGE: CanvasPage = {
  id: 'page-1',
  name: '画布 1',
  order: 0,
}

const DEFAULT_FRAME: CanvasFrame = {
  id: 'frame-1',
  pageId: 'page-1',
  name: '画板 1',
  x: 0,
  y: 0,
  width: 1080,
  height: 1080,
}

// 2D 实体深度比较与三方合并
function isEntityEqual<T>(a: T | undefined | null, b: T | undefined | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

function arraysEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function threeWayMergeList<T extends { id: string }>(
  baseList: T[] = [],
  localList: T[] = [],
  serverList: T[] = []
): T[] {
  const baseMap = new Map(baseList.map((x) => [x.id, x]))
  const localMap = new Map(localList.map((x) => [x.id, x]))
  const serverMap = new Map(serverList.map((x) => [x.id, x]))

  const allIds = new Set([
    ...baseMap.keys(),
    ...localMap.keys(),
    ...serverMap.keys(),
  ])

  const mergedEntities = new Map<string, T>()

  for (const id of allIds) {
    const base = baseMap.get(id)
    const local = localMap.get(id)
    const server = serverMap.get(id)

    if (base && local && server) {
      const localChanged = !isEntityEqual(local, base)
      const serverChanged = !isEntityEqual(server, base)

      if (localChanged && !serverChanged) {
        // 本地修改了，服务端未变 -> 保留本地修改
        mergedEntities.set(id, local)
      } else if (!localChanged && serverChanged) {
        // 服务端修改了，本地未变 -> 保留服务端修改
        mergedEntities.set(id, server)
      } else if (localChanged && serverChanged) {
        // 两端均修改：优先保留本地当前编辑版本
        mergedEntities.set(id, local)
      } else {
        // 两端均无修改
        mergedEntities.set(id, server)
      }
    } else if (base && !local && server) {
      // 存在于基线，本地删除了
      const serverChanged = !isEntityEqual(server, base)
      if (serverChanged) {
        // 服务端在删除前有新修改 -> 保留服务端新版防丢
        mergedEntities.set(id, server)
      } else {
        // 服务端未变，本地明确删除 -> 保持删除
      }
    } else if (base && local && !server) {
      // 存在于基线，服务端删除了
      const localChanged = !isEntityEqual(local, base)
      if (localChanged) {
        // 本地在服务端删除后仍进行了主动修改 -> 保留本地修改
        mergedEntities.set(id, local)
      } else {
        // 本地未变，服务端删除了 -> 保持删除
      }
    } else if (!base && local && !server) {
      // 本地新增
      mergedEntities.set(id, local)
    } else if (!base && !local && server) {
      // 服务端新增
      mergedEntities.set(id, server)
    } else if (!base && local && server) {
      // 两端同时新增
      mergedEntities.set(id, local)
    }
  }

  // 顺序三方合并：检查单端是否主动调整了图层/元素顺序
  const baseOrder = baseList.map((x) => x.id)
  const localOrder = localList.map((x) => x.id)
  const serverOrder = serverList.map((x) => x.id)

  const baseCommonWithServer = baseOrder.filter((id) => serverMap.has(id))
  const serverCommonWithBase = serverOrder.filter((id) => baseMap.has(id))
  const serverReordered = !arraysEqual(baseCommonWithServer, serverCommonWithBase)

  const baseCommonWithLocal = baseOrder.filter((id) => localMap.has(id))
  const localCommonWithBase = localOrder.filter((id) => baseMap.has(id))
  const localReordered = !arraysEqual(baseCommonWithLocal, localCommonWithBase)

  let finalOrder: string[] = []

  if (serverReordered && !localReordered) {
    // 仅远端调整了顺序：优先按远端顺序排列
    const serverInMerged = serverOrder.filter((id) => mergedEntities.has(id))
    const localRemaining = localOrder.filter((id) => mergedEntities.has(id) && !serverOrder.includes(id))
    finalOrder = [...serverInMerged, ...localRemaining]
  } else {
    // 本地调整了顺序或双方均调整：优先保留本地视口当前的顺序
    const localInMerged = localOrder.filter((id) => mergedEntities.has(id))
    const serverRemaining = serverOrder.filter((id) => mergedEntities.has(id) && !localOrder.includes(id))
    finalOrder = [...localInMerged, ...serverRemaining]
  }

  // 确保所有存在于 mergedEntities 的 ID 都在 finalOrder 中
  const orderSet = new Set(finalOrder)
  for (const id of mergedEntities.keys()) {
    if (!orderSet.has(id)) {
      finalOrder.push(id)
    }
  }

  return finalOrder.map((id) => mergedEntities.get(id)!).filter(Boolean)
}

// ─── 4列流式网格排版规范与辅助算法（对齐旧版 Tldraw 规格） ───────────────────
export const DESIGNFLOW_GRID_COLUMNS = 4
export const DESIGNFLOW_GRID_ROWS_PER_BLOCK = 20
export const DESIGNFLOW_GRID_CELL_WIDTH = 420
export const DESIGNFLOW_GRID_CELL_HEIGHT = 560
export const DESIGNFLOW_GRID_GAP = 40

export function isSequentialLayoutImage(img: CanvasImage, pageId: string): boolean {
  if (img.pageId !== pageId) return false
  if (img.locked) return false
  if (img.frameId) return false // 画板内图层不参与无限画布自由流式重排
  const meta = img.meta || {}
  if (meta.designflowLayoutExcluded || meta.layerExtractFrom) return false
  return true
}

export function getVisualImageOrder(images: CanvasImage[]): CanvasImage[] {
  return images.slice().sort((a, b) => {
    const yDiff = a.y - b.y
    if (Math.abs(yDiff) > 1) return yDiff
    const xDiff = a.x - b.x
    if (Math.abs(xDiff) > 1) return xDiff
    return a.id.localeCompare(b.id)
  })
}

export function getSortedSequentialImages(images: CanvasImage[], pageId: string): CanvasImage[] {
  const targetImages = images.filter((img) => isSequentialLayoutImage(img, pageId))
  if (targetImages.length === 0) return []

  const visualOrder = getVisualImageOrder(targetImages)

  return targetImages.slice().sort((a, b) => {
    const aOrder = Number(a.meta?.designflowLayoutOrder)
    const bOrder = Number(b.meta?.designflowLayoutOrder)
    const aValid = Number.isFinite(aOrder) && aOrder > 0
    const bValid = Number.isFinite(bOrder) && bOrder > 0
    if (aValid && bValid && aOrder !== bOrder) return aOrder - bOrder
    if (aValid !== bValid) return aValid ? -1 : 1
    return visualOrder.indexOf(a) - visualOrder.indexOf(b)
  })
}

export function getSequentialLayoutContext(
  images: CanvasImage[],
  frames: CanvasFrame[],
  pageId: string
): { anchorX: number; anchorY: number; nextOrder: number } {
  const ordered = getSortedSequentialImages(images, pageId)

  if (ordered.length > 0) {
    const first = ordered[0]
    const firstMeta = first.meta || {}
    let anchorX = Number(firstMeta.designflowLayoutAnchorX)
    let anchorY = Number(firstMeta.designflowLayoutAnchorY)
    if (!Number.isFinite(anchorX) || !Number.isFinite(anchorY)) {
      const naturalW = Math.min(first.width, DESIGNFLOW_GRID_CELL_WIDTH)
      anchorX = Math.round(first.x - (DESIGNFLOW_GRID_CELL_WIDTH - naturalW) / 2)
      anchorY = Math.round(first.y)
    }
    const maxOrder = ordered.reduce((max, im) => {
      const ord = Number(im.meta?.designflowLayoutOrder)
      return Number.isFinite(ord) && ord > max ? ord : max
    }, 0)
    return {
      anchorX,
      anchorY,
      nextOrder: maxOrder + 1,
    }
  }

  // 若无已有流式图片，优先检查画板
  const pageFrames = frames.filter((f) => f.pageId === pageId)
  if (pageFrames.length > 0) {
    const minFrameY = Math.min(...pageFrames.map((f) => f.y))
    const maxFrameRight = Math.max(...pageFrames.map((f) => f.x + f.width))
    return {
      anchorX: maxFrameRight + 80,
      anchorY: minFrameY,
      nextOrder: 1,
    }
  }

  // 既无图片也无画板，取当前视口中心
  let anchorX = 0
  let anchorY = 0
  if (typeof window !== 'undefined') {
    const vp = useViewportStore.getState()
    const vpW = window.innerWidth || 1200
    const vpH = window.innerHeight || 800
    const centerX = (vpW / 2 - vp.panX) / vp.zoom
    const centerY = (vpH / 2 - vp.panY) / vp.zoom
    const totalGridW =
      DESIGNFLOW_GRID_COLUMNS * DESIGNFLOW_GRID_CELL_WIDTH +
      (DESIGNFLOW_GRID_COLUMNS - 1) * DESIGNFLOW_GRID_GAP
    anchorX = Math.round(centerX - totalGridW / 2)
    anchorY = Math.round(centerY - DESIGNFLOW_GRID_CELL_HEIGHT / 2)
  }

  return {
    anchorX,
    anchorY,
    nextOrder: 1,
  }
}

// 异步探测加载图片尺寸的防抖重排计时器
let autoReflowTimer: number | null = null

// 记录历史操作快照
function recordHistory(get: () => CanvasState) {
  const doc = get().getDocument()
  useHistoryStore.getState().record(doc)
}

function withMutation<T extends Partial<CanvasState>>(
  s: CanvasState,
  patch: T,
  intent: 'update' | 'user_delete' = 'update'
): T & { isDirty: boolean; editSequence: number; lastSaveIntent: 'update' | 'user_delete' } {
  return {
    ...patch,
    isDirty: true,
    editSequence: (s.editSequence || 0) + 1,
    lastSaveIntent: intent === 'user_delete' ? 'user_delete' : (patch.lastSaveIntent || s.lastSaveIntent || 'update'),
  }
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  pages: [DEFAULT_PAGE],
  activePageId: 'page-1',
  frames: [DEFAULT_FRAME],
  images: [],
  texts: [],
  selectedIds: [],
  selectedType: null,
  activeTool: 'select',
  revision: 1,
  isDirty: false,
  editSequence: 0,
  lastSavedSequence: 0,
  lastSaveIntent: 'update',

    baseDocument: null,

  // ─── 页面管理 ─────────────────────────────────────────────
  createPage: (name) => {
    recordHistory(get)
    const { pages } = get()
    const newPageId = 'page-' + Math.random().toString(36).slice(2, 9)
    const newPageName = name || `画布 ${pages.length + 1}`
    const newPage: CanvasPage = {
      id: newPageId,
      name: newPageName,
      order: pages.length,
    }
    set((s) => withMutation(s, {
      pages: [...s.pages, newPage],
      activePageId: newPageId,
      selectedIds: [],
      selectedType: null,
    }))
    if (typeof window !== 'undefined') {
      try {
        useViewportStore.getState().setPan(120, 80)
        useViewportStore.getState().setZoom(0.8)
      } catch (e) {}
    }
    return newPageId
  },

  switchPage: (pageId) => {
    set({
      activePageId: pageId,
      selectedIds: [],
      selectedType: null,
    })
  },

  renamePage: (pageId, name) => {
    recordHistory(get)
    set((s) => withMutation(s, {
      pages: s.pages.map((p) => (p.id === pageId ? { ...p, name: name.trim() || p.name } : p)),
    }))
  },

  deletePage: (pageId) => {
    const { pages, activePageId } = get()
    if (pages.length <= 1) return // 至少保留一个页面
    recordHistory(get)

    const remainingPages = pages.filter((p) => p.id !== pageId)
    const nextActive = activePageId === pageId ? remainingPages[0].id : activePageId

    set((s) => withMutation(s, {
      pages: remainingPages,
      activePageId: nextActive,
      frames: s.frames.filter((f) => f.pageId !== pageId),
      images: s.images.filter((im) => im.pageId !== pageId),
      selectedIds: [],
      selectedType: null,
    }, 'user_delete'))
  },

  // ─── 画板管理 ─────────────────────────────────────────────
  addFrame: (frameData) => {
    recordHistory(get)
    const { activePageId, frames } = get()
    let name = frameData.name
    if (!name || name === '画板') {
      const pageFrames = frames.filter((f) => f.pageId === activePageId)
      let maxNum = 0
      for (const f of pageFrames) {
        const m = (f.name || '').match(/^画板\s*(\d+)$/)
        if (m) {
          const n = parseInt(m[1], 10)
          if (n > maxNum) maxNum = n
        }
      }
      name = `画板 ${maxNum ? maxNum + 1 : pageFrames.length + 1}`
    }
    const newFrame: CanvasFrame = {
      ...frameData,
      name,
      pageId: activePageId,
    }
    set((s) => withMutation(s, {
      frames: [...s.frames, newFrame],
      selectedIds: [newFrame.id],
      selectedType: 'frame',
    }))
    return newFrame
  },

  updateFrame: (id, patch, moveChildren = false) => {
    const { frames, images, texts } = get()
    const oldFrame = frames.find((f) => f.id === id)
    if (!oldFrame) return

    let nextImages = images
    let nextTexts = texts
    if (moveChildren && (patch.x !== undefined || patch.y !== undefined)) {
      const dx = (patch.x ?? oldFrame.x) - oldFrame.x
      const dy = (patch.y ?? oldFrame.y) - oldFrame.y
      if (dx !== 0 || dy !== 0) {
        nextImages = images.map((im) =>
          im.frameId === id
            ? { ...im, x: im.x + dx, y: im.y + dy }
            : im
        )
        nextTexts = texts.map((t) =>
          t.frameId === id
            ? { ...t, x: t.x + dx, y: t.y + dy }
            : t
        )
      }
    }

    set((s) => withMutation(s, {
      frames: s.frames.map((f) => (f.id === id ? { ...f, ...patch } : f)),
      images: nextImages,
      texts: nextTexts,
    }))
  },

  deleteFrame: (id) => {
    recordHistory(get)
    set((s) => withMutation(s, {
      frames: s.frames.filter((f) => f.id !== id),
      // 画板删除后，原画板内部图片与文本解绑成为画布自由排版图元，不强制丢失
      images: s.images.map((im) => (im.frameId === id ? { ...im, frameId: null } : im)),
      texts: s.texts.map((t) => (t.frameId === id ? { ...t, frameId: null } : t)),
      selectedIds: s.selectedIds.filter((selId) => selId !== id),
      selectedType: s.selectedIds.includes(id) ? null : s.selectedType,
    }, 'user_delete'))
  },

  // ─── 图片管理 ─────────────────────────────────────────────
  addImage: (imageData) => {
    recordHistory(get)
    const { activePageId, frames } = get()
    let frameId = imageData.frameId ?? null
    if (frameId === null) {
      const pageFrames = frames.filter((f) => f.pageId === activePageId)
      const cx = imageData.x + imageData.width / 2
      const cy = imageData.y + imageData.height / 2
      for (let i = pageFrames.length - 1; i >= 0; i--) {
        const f = pageFrames[i]
        if (cx >= f.x && cx <= f.x + f.width && cy >= f.y && cy <= f.y + f.height) {
          frameId = f.id
          break
        }
      }
    }
    const newImg: CanvasImage = {
      ...imageData,
      frameId,
      pageId: activePageId,
    }
    set((s) => withMutation(s, {
      images: [...s.images, newImg],
      selectedIds: [newImg.id],
      selectedType: 'image',
    }))
    return newImg
  },

  addImages: (imagesData) => {
    if (imagesData.length === 0) return []
    recordHistory(get)
    const { activePageId, frames } = get()
    const pageFrames = frames.filter((f) => f.pageId === activePageId)

    const newImgs: CanvasImage[] = imagesData.map((img) => {
      let frameId = img.frameId ?? null
      if (frameId === null) {
        const cx = img.x + img.width / 2
        const cy = img.y + img.height / 2
        for (let i = pageFrames.length - 1; i >= 0; i--) {
          const f = pageFrames[i]
          if (cx >= f.x && cx <= f.x + f.width && cy >= f.y && cy <= f.y + f.height) {
            frameId = f.id
            break
          }
        }
      }
      return {
        ...img,
        frameId,
        pageId: activePageId,
      }
    })

    set((s) => withMutation(s, {
      images: [...s.images, ...newImgs],
      selectedIds: newImgs.map((im) => im.id),
      selectedType: 'image',
    }))
    return newImgs
  },

  updateImage: (id, patch) => {
    set((s) => withMutation(s, {
      images: s.images.map((im) => (im.id === id ? { ...im, ...patch } : im)),
    }))
  },

  updateImages: (patches) => {
    const patchMap = new Map(patches.map((p) => [p.id, p.patch]))
    set((s) => withMutation(s, {
      images: s.images.map((im) => {
        const patch = patchMap.get(im.id)
        return patch ? { ...im, ...patch } : im
      }),
    }))
  },

  deleteImage: (id) => {
    recordHistory(get)
    set((s) => withMutation(s, {
      images: s.images.filter((im) => im.id !== id),
      selectedIds: s.selectedIds.filter((selId) => selId !== id),
      selectedType: s.selectedIds.includes(id) && s.selectedIds.length === 1 ? null : s.selectedType,
    }, 'user_delete'))
  },

  // ─── 文本操作 ─────────────────────────────────────────────
  addText: (text) => {
    recordHistory(get)
    const { activePageId, frames } = get()
    const width = text.width || 200
    const height = text.height || 40
    let frameId = text.frameId ?? null
    if (frameId === null) {
      const pageFrames = frames.filter((f) => f.pageId === activePageId)
      const cx = text.x + width / 2
      const cy = text.y + height / 2
      for (let i = pageFrames.length - 1; i >= 0; i--) {
        const f = pageFrames[i]
        if (cx >= f.x && cx <= f.x + f.width && cy >= f.y && cy <= f.y + f.height) {
          frameId = f.id
          break
        }
      }
    }
    const newText: CanvasText = {
      id: text.id || 'txt-' + Math.random().toString(36).slice(2, 10),
      pageId: activePageId,
      frameId,
      x: text.x,
      y: text.y,
      width,
      height,
      text: text.text || '双击编辑文本',
      fontSize: text.fontSize || 24,
      color: text.color || '#0f172a',
      fontWeight: text.fontWeight || 'normal',
      textAlign: text.textAlign || 'left',
      locked: false,
    }
    set((s) => withMutation(s, {
      texts: [...s.texts, newText],
      selectedIds: [newText.id],
      selectedType: 'text',
    }))
    return newText
  },

  updateText: (id, patch) => {
    set((s) => withMutation(s, {
      texts: s.texts.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }))
  },

  deleteText: (id) => {
    recordHistory(get)
    set((s) => withMutation(s, {
      texts: s.texts.filter((t) => t.id !== id),
      selectedIds: s.selectedIds.filter((selId) => selId !== id),
      selectedType: s.selectedIds.includes(id) && s.selectedIds.length === 1 ? null : s.selectedType,
    }, 'user_delete'))
  },

  deleteSelected: () => {
    const { selectedIds, selectedType } = get()
    if (selectedIds.length === 0) return
    recordHistory(get)

    if (selectedType === 'frame') {
      const frameId = selectedIds[0]
      get().deleteFrame(frameId)
    } else if (selectedType === 'text') {
      const idSet = new Set(selectedIds)
      set((s) => withMutation(s, {
        texts: s.texts.filter((t) => !idSet.has(t.id)),
        selectedIds: [],
        selectedType: null,
      }, 'user_delete'))
    } else {
      const idSet = new Set(selectedIds)
      set((s) => withMutation(s, {
        images: s.images.filter((im) => !idSet.has(im.id)),
        selectedIds: [],
        selectedType: null,
      }, 'user_delete'))
    }
  },

  duplicateSelected: () => {
    const { selectedIds, selectedType, frames, images, texts, activePageId } = get()
    if (selectedIds.length === 0) return
    recordHistory(get)

    if (selectedType === 'frame') {
      const frameId = selectedIds[0]
      const targetFrame = frames.find((f) => f.id === frameId)
      if (!targetFrame) return
      const newFrameId = 'frame-' + Math.random().toString(36).slice(2, 10)
      const offset = 40
      const newFrame: CanvasFrame = {
        ...targetFrame,
        id: newFrameId,
        name: `${targetFrame.name} 副本`,
        x: targetFrame.x + offset,
        y: targetFrame.y + offset,
      }
      // 复制该画板内的所有图片与文本
      const frameImages = images.filter((im) => im.frameId === frameId)
      const frameTexts = texts.filter((t) => t.frameId === frameId)
      const newImages = frameImages.map((im) => ({
        ...im,
        id: 'img-' + Math.random().toString(36).slice(2, 10),
        frameId: newFrameId,
        x: im.x + offset,
        y: im.y + offset,
      }))
      const newTexts = frameTexts.map((t) => ({
        ...t,
        id: 'txt-' + Math.random().toString(36).slice(2, 10),
        frameId: newFrameId,
        x: t.x + offset,
        y: t.y + offset,
      }))

      set((s) => withMutation(s, {
        frames: [...s.frames, newFrame],
        images: [...s.images, ...newImages],
        texts: [...s.texts, ...newTexts],
        selectedIds: [newFrameId],
        selectedType: 'frame',
      }))
      return
    }

    if (selectedType === 'text') {
      const idSet = new Set(selectedIds)
      const targets = texts.filter((t) => idSet.has(t.id))
      const duplicates: CanvasText[] = targets.map((t) => ({
        ...t,
        id: 'txt-' + Math.random().toString(36).slice(2, 10),
        x: t.x + 20,
        y: t.y + 20,
        pageId: activePageId,
      }))
      set((s) => withMutation(s, {
        texts: [...s.texts, ...duplicates],
        selectedIds: duplicates.map((d) => d.id),
        selectedType: 'text',
      }))
      return
    }

    if (selectedType !== 'image') return

    const idSet = new Set(selectedIds)
    const targets = images.filter((im) => idSet.has(im.id))
    const duplicates: CanvasImage[] = targets.map((im) => ({
      ...im,
      id: 'img-' + Math.random().toString(36).slice(2, 10),
      x: im.x + 30,
      y: im.y + 30,
      pageId: activePageId,
    }))

    set((s) => withMutation(s, {
      images: [...s.images, ...duplicates],
      selectedIds: duplicates.map((d) => d.id),
      selectedType: 'image',
    }))
  },

  bringToFront: (id) => {
    recordHistory(get)
    set((s) => {
      const isImg = s.images.some((im) => im.id === id)
      if (isImg) {
        const idx = s.images.findIndex((im) => im.id === id)
        if (idx === -1 || idx === s.images.length - 1) return s
        const target = s.images[idx]
        return withMutation(s, {
          images: s.images.filter((im) => im.id !== id).concat(target),
        })
      }
      const isTxt = s.texts.some((t) => t.id === id)
      if (isTxt) {
        const idx = s.texts.findIndex((t) => t.id === id)
        if (idx === -1 || idx === s.texts.length - 1) return s
        const target = s.texts[idx]
        return withMutation(s, {
          texts: s.texts.filter((t) => t.id !== id).concat(target),
        })
      }
      return s
    })
  },

  bringForward: (id) => {
    recordHistory(get)
    set((s) => {
      const isImg = s.images.some((im) => im.id === id)
      if (isImg) {
        const idx = s.images.findIndex((im) => im.id === id)
        if (idx === -1 || idx === s.images.length - 1) return s
        const nextImages = [...s.images]
        const temp = nextImages[idx]
        nextImages[idx] = nextImages[idx + 1]
        nextImages[idx + 1] = temp
        return withMutation(s, { images: nextImages })
      }
      const isTxt = s.texts.some((t) => t.id === id)
      if (isTxt) {
        const idx = s.texts.findIndex((t) => t.id === id)
        if (idx === -1 || idx === s.texts.length - 1) return s
        const nextTexts = [...s.texts]
        const temp = nextTexts[idx]
        nextTexts[idx] = nextTexts[idx + 1]
        nextTexts[idx + 1] = temp
        return withMutation(s, { texts: nextTexts })
      }
      return s
    })
  },

  sendBackward: (id) => {
    recordHistory(get)
    set((s) => {
      const isImg = s.images.some((im) => im.id === id)
      if (isImg) {
        const idx = s.images.findIndex((im) => im.id === id)
        if (idx <= 0) return s
        const nextImages = [...s.images]
        const temp = nextImages[idx]
        nextImages[idx] = nextImages[idx - 1]
        nextImages[idx - 1] = temp
        return withMutation(s, { images: nextImages })
      }
      const isTxt = s.texts.some((t) => t.id === id)
      if (isTxt) {
        const idx = s.texts.findIndex((t) => t.id === id)
        if (idx <= 0) return s
        const nextTexts = [...s.texts]
        const temp = nextTexts[idx]
        nextTexts[idx] = nextTexts[idx - 1]
        nextTexts[idx - 1] = temp
        return withMutation(s, { texts: nextTexts })
      }
      return s
    })
  },

  sendToBack: (id) => {
    recordHistory(get)
    set((s) => {
      const isImg = s.images.some((im) => im.id === id)
      if (isImg) {
        const idx = s.images.findIndex((im) => im.id === id)
        if (idx === -1 || idx === 0) return s
        const target = s.images[idx]
        return withMutation(s, {
          images: [target].concat(s.images.filter((im) => im.id !== id)),
        })
      }
      const isTxt = s.texts.some((t) => t.id === id)
      if (isTxt) {
        const idx = s.texts.findIndex((t) => t.id === id)
        if (idx === -1 || idx === 0) return s
        const target = s.texts[idx]
        return withMutation(s, {
          texts: [target].concat(s.texts.filter((t) => t.id !== id)),
        })
      }
      return s
    })
  },

  alignSelected: (type) => {
    const { selectedIds, images } = get()
    if (selectedIds.length <= 1) return
    recordHistory(get)

    const idSet = new Set(selectedIds)
    const targets = images.filter((im) => idSet.has(im.id))

    const minX = Math.min(...targets.map((t) => t.x))
    const maxX = Math.max(...targets.map((t) => t.x + t.width))
    const minY = Math.min(...targets.map((t) => t.y))
    const maxY = Math.max(...targets.map((t) => t.y + t.height))

    const patches = targets.map((t) => {
      let nextX = t.x
      let nextY = t.y
      if (type === 'left') nextX = minX
      if (type === 'center') nextX = minX + (maxX - minX) / 2 - t.width / 2
      if (type === 'right') nextX = maxX - t.width
      if (type === 'top') nextY = minY
      if (type === 'middle') nextY = minY + (maxY - minY) / 2 - t.height / 2
      if (type === 'bottom') nextY = maxY - t.height
      return { id: t.id, patch: { x: nextX, y: nextY } }
    })

    get().updateImages(patches)
  },

  distributeSelected: (type) => {
    const { selectedIds, images } = get()
    if (selectedIds.length < 3) return
    recordHistory(get)

    const idSet = new Set(selectedIds)
    const targets = images.filter((im) => idSet.has(im.id))

    if (type === 'horizontal') {
      const sorted = [...targets].sort((a, b) => a.x - b.x)
      const first = sorted[0]
      const last = sorted[sorted.length - 1]
      const totalSpan = last.x + last.width - first.x
      const totalWidths = sorted.reduce((sum, item) => sum + item.width, 0)
      const gap = (totalSpan - totalWidths) / (sorted.length - 1)

      let currentX = first.x
      const patches = sorted.map((item) => {
        const patch = { id: item.id, patch: { x: Math.round(currentX) } }
        currentX += item.width + gap
        return patch
      })
      get().updateImages(patches)
    } else {
      const sorted = [...targets].sort((a, b) => a.y - b.y)
      const first = sorted[0]
      const last = sorted[sorted.length - 1]
      const totalSpan = last.y + last.height - first.y
      const totalHeights = sorted.reduce((sum, item) => sum + item.height, 0)
      const gap = (totalSpan - totalHeights) / (sorted.length - 1)

      let currentY = first.y
      const patches = sorted.map((item) => {
        const patch = { id: item.id, patch: { y: Math.round(currentY) } }
        currentY += item.height + gap
        return patch
      })
      get().updateImages(patches)
    }
  },

  tidyUpSelected: (mode, gap = 24) => {
    const { selectedIds, images } = get()
    if (selectedIds.length < 2) return
    recordHistory(get)

    const idSet = new Set(selectedIds)
    const targets = images.filter((im) => idSet.has(im.id))
    if (targets.length < 2) return

    const minX = Math.min(...targets.map((t) => t.x))
    const minY = Math.min(...targets.map((t) => t.y))

    if (mode === 'horizontal') {
      // 从左到右次序排列，顶端对齐，统一固定间距
      const sorted = [...targets].sort((a, b) => a.x + a.width / 2 - (b.x + b.width / 2))
      let currentX = minX
      const patches = sorted.map((item) => {
        const patch = { id: item.id, patch: { x: Math.round(currentX), y: minY } }
        currentX += item.width + gap
        return patch
      })
      get().updateImages(patches)
    } else if (mode === 'vertical') {
      // 从上到下次序排列，左侧对齐，统一固定间距
      const sorted = [...targets].sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2))
      let currentY = minY
      const patches = sorted.map((item) => {
        const patch = { id: item.id, patch: { x: minX, y: Math.round(currentY) } }
        currentY += item.height + gap
        return patch
      })
      get().updateImages(patches)
    } else if (mode === 'grid') {
      // 类似 Figma / Photoshop Tidy Up：网格矩阵排列
      const count = targets.length
      const cols = count === 4 ? 2 : Math.max(2, Math.ceil(Math.sqrt(count)))
      const sorted = [...targets].sort((a, b) => {
        const rowDiff = a.y - b.y
        if (Math.abs(rowDiff) > 80) return rowDiff
        return a.x - b.x
      })

      let currentX = minX
      let currentY = minY
      const patches: { id: string; patch: Partial<CanvasImage> }[] = []

      for (let r = 0; r < Math.ceil(count / cols); r++) {
        const rowItems = sorted.slice(r * cols, (r + 1) * cols)
        const maxRowH = Math.max(...rowItems.map((it) => it.height))
        currentX = minX

        for (const item of rowItems) {
          patches.push({
            id: item.id,
            patch: { x: Math.round(currentX), y: Math.round(currentY) },
          })
          currentX += item.width + gap
        }
        currentY += maxRowH + gap
      }

      get().updateImages(patches)
    }

    get().recalcFrameAttachment('image', targets.map((t) => t.id))
  },

  toggleLockSelected: () => {
    const { selectedIds, images } = get()
    if (selectedIds.length === 0) return
    recordHistory(get)
    const idSet = new Set(selectedIds)
    const targets = images.filter((im) => idSet.has(im.id))
    const anyUnlocked = targets.some((im) => !im.locked)
    const patches = targets.map((im) => ({
      id: im.id,
      patch: { locked: anyUnlocked },
    }))
    get().updateImages(patches)
  },

  selectAll: () => {
    const { activePageId, images, frames } = get()
    const pageImages = images.filter((im) => im.pageId === activePageId)
    if (pageImages.length > 0) {
      set({
        selectedIds: pageImages.map((im) => im.id),
        selectedType: 'image',
      })
    } else {
      const pageFrames = frames.filter((f) => f.pageId === activePageId)
      if (pageFrames.length > 0) {
        set({
          selectedIds: pageFrames.map((f) => f.id),
          selectedType: 'frame',
        })
      }
    }
  },

  // ─── 选区与工具 ───────────────────────────────────────────
  setSelected: (ids, type) =>
    set({
      selectedIds: ids,
      selectedType: type,
    }),

  toggleSelected: (id, type) =>
    set((s) => {
      const exists = s.selectedIds.includes(id)
      let nextIds = exists ? s.selectedIds.filter((i) => i !== id) : [...s.selectedIds, id]
      return {
        selectedIds: nextIds,
        selectedType: nextIds.length > 0 ? type : null,
      }
    }),

  clearSelection: () =>
    set({
      selectedIds: [],
      selectedType: null,
    }),

  setActiveTool: (tool) => set({ activeTool: tool }),

  // ─── 画板容器归属计算（类似 Figma Frame 放入与脱离） ───────
  recalcFrameAttachment: (type, ids) => {
    const { frames, activePageId } = get()
    const pageFrames = frames.filter((f) => f.pageId === activePageId)
    const idSet = new Set(ids)

    if (type === 'image') {
      let changed = false
      const nextImages = get().images.map((im) => {
        if (!idSet.has(im.id)) return im
        const cx = im.x + im.width / 2
        const cy = im.y + im.height / 2
        let matchedFrameId: string | null = null
        for (let i = pageFrames.length - 1; i >= 0; i--) {
          const f = pageFrames[i]
          if (cx >= f.x && cx <= f.x + f.width && cy >= f.y && cy <= f.y + f.height) {
            matchedFrameId = f.id
            break
          }
        }
        if (im.frameId !== matchedFrameId) changed = true
        return im.frameId !== matchedFrameId ? { ...im, frameId: matchedFrameId } : im
      })
      if (changed) {
        set((s) => withMutation(s, { images: nextImages }))
      }
    } else if (type === 'text') {
      let changed = false
      const nextTexts = get().texts.map((t) => {
        if (!idSet.has(t.id)) return t
        const cx = t.x + t.width / 2
        const cy = t.y + t.height / 2
        let matchedFrameId: string | null = null
        for (let i = pageFrames.length - 1; i >= 0; i--) {
          const f = pageFrames[i]
          if (cx >= f.x && cx <= f.x + f.width && cy >= f.y && cy <= f.y + f.height) {
            matchedFrameId = f.id
            break
          }
        }
        if (t.frameId !== matchedFrameId) changed = true
        return t.frameId !== matchedFrameId ? { ...t, frameId: matchedFrameId } : t
      })
      if (changed) {
        set((s) => withMutation(s, { texts: nextTexts }))
      }
    }
  },

  // ─── 4列流式网格自动排版引擎（对齐旧版 Tldraw 规格） ────────────
  reflowSequentialImages: (pageId?: string) => {
    const targetPageId = pageId || get().activePageId
    const { images, frames } = get()
    const ordered = getSortedSequentialImages(images, targetPageId)
    if (ordered.length === 0) return

    const context = getSequentialLayoutContext(images, frames, targetPageId)
    const itemsPerBlock = DESIGNFLOW_GRID_COLUMNS * DESIGNFLOW_GRID_ROWS_PER_BLOCK
    const blockWidth = DESIGNFLOW_GRID_COLUMNS * (DESIGNFLOW_GRID_CELL_WIDTH + DESIGNFLOW_GRID_GAP)

    const updatedImagesMap = new Map<string, Partial<CanvasImage>>()

    ordered.forEach((img, index) => {
      const meta = img.meta || {}
      const rawW = Math.max(1, Number(img.naturalWidth || meta.designflowOriginalWidth || img.width || 1))
      const rawH = Math.max(1, Number(img.naturalHeight || meta.designflowOriginalHeight || img.height || 1))

      const scale = Math.min(1, DESIGNFLOW_GRID_CELL_WIDTH / rawW, DESIGNFLOW_GRID_CELL_HEIGHT / rawH)
      const width = Math.max(1, Math.round(rawW * scale))
      const height = Math.max(1, Math.round(rawH * scale))

      const block = Math.floor(index / itemsPerBlock)
      const indexInBlock = index % itemsPerBlock
      const col = indexInBlock % DESIGNFLOW_GRID_COLUMNS
      const row = Math.floor(indexInBlock / DESIGNFLOW_GRID_COLUMNS)

      const cellX = context.anchorX + block * blockWidth + col * (DESIGNFLOW_GRID_CELL_WIDTH + DESIGNFLOW_GRID_GAP)
      const cellY = context.anchorY + row * (DESIGNFLOW_GRID_CELL_HEIGHT + DESIGNFLOW_GRID_GAP)

      // 420px 单元格内严格水平居中
      const x = cellX + Math.round((DESIGNFLOW_GRID_CELL_WIDTH - width) / 2)
      const y = cellY

      updatedImagesMap.set(img.id, {
        x,
        y,
        width,
        height,
        meta: {
          ...meta,
          designflowLayoutOrder: index + 1,
          designflowLayoutAnchorX: context.anchorX,
          designflowLayoutAnchorY: context.anchorY,
          designflowOriginalWidth: rawW,
          designflowOriginalHeight: rawH,
        },
      })
    })

    set((s) =>
      withMutation(s, {
        images: s.images.map((im) => {
          const patch = updatedImagesMap.get(im.id)
          return patch ? { ...im, ...patch } : im
        }),
      })
    )
  },

  insertImagesAuto: (items, mode, name) => {
    const { activePageId, frames, images, reflowSequentialImages } = get()
    const context = getSequentialLayoutContext(images, frames, activePageId)

    const createdImages: CanvasImage[] = []

    items.forEach((item, idx) => {
      const isObj = typeof item === 'object' && item !== null
      const url = isObj ? item.url : item
      if (!url) return
      const itemName = (isObj && item.name) || name
      const meta = isObj ? { ...item } : undefined
      if (meta) {
        delete (meta as any).url
        delete (meta as any).name
        delete (meta as any).index
      }

      const order = context.nextOrder + idx
      const imgId = 'img-' + Math.random().toString(36).slice(2, 10)

      // 提取初始真实宽高（若已有）
      const rawW = Number(isObj && (item.naturalWidth || item.naturalW || item.width)) || DESIGNFLOW_GRID_CELL_WIDTH
      const rawH = Number(isObj && (item.naturalHeight || item.naturalH || item.height)) || DESIGNFLOW_GRID_CELL_HEIGHT
      const scale = Math.min(1, DESIGNFLOW_GRID_CELL_WIDTH / rawW, DESIGNFLOW_GRID_CELL_HEIGHT / rawH)
      const w = Math.max(1, Math.round(rawW * scale))
      const h = Math.max(1, Math.round(rawH * scale))

      // 初始占位坐标（由紧接着的 reflow 统一定位）
      const itemsPerBlock = DESIGNFLOW_GRID_COLUMNS * DESIGNFLOW_GRID_ROWS_PER_BLOCK
      const blockWidth = DESIGNFLOW_GRID_COLUMNS * (DESIGNFLOW_GRID_CELL_WIDTH + DESIGNFLOW_GRID_GAP)
      const index = order - 1
      const block = Math.floor(index / itemsPerBlock)
      const indexInBlock = index % itemsPerBlock
      const col = indexInBlock % DESIGNFLOW_GRID_COLUMNS
      const row = Math.floor(indexInBlock / DESIGNFLOW_GRID_COLUMNS)
      const cellX = context.anchorX + block * blockWidth + col * (DESIGNFLOW_GRID_CELL_WIDTH + DESIGNFLOW_GRID_GAP)
      const cellY = context.anchorY + row * (DESIGNFLOW_GRID_CELL_HEIGHT + DESIGNFLOW_GRID_GAP)
      const x = cellX + Math.round((DESIGNFLOW_GRID_CELL_WIDTH - w) / 2)
      const y = cellY

      const img: CanvasImage = {
        id: imgId,
        pageId: activePageId,
        frameId: null, // 自由流式排版
        x,
        y,
        width: w,
        height: h,
        rotation: 0,
        url,
        name: itemName || `图片 ${order}`,
        locked: false,
        opacity: 1,
        naturalWidth: rawW !== DESIGNFLOW_GRID_CELL_WIDTH ? rawW : undefined,
        naturalHeight: rawH !== DESIGNFLOW_GRID_CELL_HEIGHT ? rawH : undefined,
        meta: {
          ...(meta || {}),
          designflowLayoutOrder: order,
          designflowLayoutAnchorX: context.anchorX,
          designflowLayoutAnchorY: context.anchorY,
          designflowOriginalWidth: rawW,
          designflowOriginalHeight: rawH,
        },
      }
      createdImages.push(img)

      // 异步探测图片天然尺寸，自适应保持真实比例并触发防抖重排
      if (typeof window !== 'undefined') {
        const probe = new Image()
        probe.crossOrigin = 'anonymous'
        probe.onload = () => {
          const nw = probe.naturalWidth || probe.width
          const nh = probe.naturalHeight || probe.height
          if (nw > 0 && nh > 0) {
            const currentImg = get().images.find((im) => im.id === imgId)
            if (currentImg) {
              get().updateImage(imgId, {
                naturalWidth: nw,
                naturalHeight: nh,
                meta: {
                  ...(currentImg.meta || {}),
                  designflowOriginalWidth: nw,
                  designflowOriginalHeight: nh,
                },
              })
              if (autoReflowTimer !== null) {
                window.clearTimeout(autoReflowTimer)
              }
              autoReflowTimer = window.setTimeout(() => {
                autoReflowTimer = null
                get().reflowSequentialImages(get().activePageId)
              }, 60)
            }
          }
        }
        probe.src = url
      }
    })

    if (createdImages.length === 0) return []

    recordHistory(get)
    set((s) =>
      withMutation(s, {
        images: [...s.images, ...createdImages],
        selectedIds: createdImages.map((im) => im.id),
        selectedType: 'image',
      })
    )

    // 立即执行一次全量网格重排，确保顺序和居中严丝合缝
    reflowSequentialImages(activePageId)

    // 自动平移视口并适度缩放，确保新插入的图片完整居中展示在可视区域内
    if (typeof window !== 'undefined') {
      try {
        const latestImages = get().images.filter((im) => createdImages.some((c) => c.id === im.id))
        const boxes = latestImages.length > 0 ? latestImages : createdImages
        const minX = Math.min(...boxes.map((im) => im.x))
        const minY = Math.min(...boxes.map((im) => im.y))
        const maxX = Math.max(...boxes.map((im) => im.x + im.width))
        const maxY = Math.max(...boxes.map((im) => im.y + im.height))
        const vp = useViewportStore.getState()
        const vpWidth = window.innerWidth || 1000
        const vpHeight = window.innerHeight || 800

        const sMinX = minX * vp.zoom + vp.panX
        const sMinY = minY * vp.zoom + vp.panY
        const sMaxX = maxX * vp.zoom + vp.panX
        const sMaxY = maxY * vp.zoom + vp.panY

        const isVisible =
          sMinX >= 80 &&
          sMinY >= 80 &&
          sMaxX <= vpWidth - 80 &&
          sMaxY <= vpHeight - 80

        if (!isVisible) {
          const boxW = Math.max(100, maxX - minX)
          const boxH = Math.max(100, maxY - minY)
          const availW = Math.max(200, vpWidth - 220)
          const availH = Math.max(200, vpHeight - 200)

          let targetZoom = vp.zoom
          if (boxW * targetZoom > availW || boxH * targetZoom > availH) {
            targetZoom = Math.max(0.12, Math.min(1.0, Math.min(availW / boxW, availH / boxH)))
          }

          const centerX = (minX + maxX) / 2
          const centerY = (minY + maxY) / 2
          const targetPanX = Math.round(vpWidth / 2 - centerX * targetZoom)
          const targetPanY = Math.round(vpHeight / 2 - centerY * targetZoom)

          vp.setZoom(targetZoom)
          vp.setPan(targetPanX, targetPanY)
        }
      } catch (err) {
        console.warn('Auto focus viewport failed:', err)
      }
    }

    return createdImages
  },

  // ─── 快照水合与持久化 ─────────────────────────────────────
  loadDocument: (doc, rev = 1) => {
    if (!doc || typeof doc !== 'object') return

    // 页面水合与兼容
    let pages: CanvasPage[] = Array.isArray(doc.pages) && doc.pages.length ? doc.pages : []
    if (pages.length === 0) {
      pages = [DEFAULT_PAGE]
    }
    let activePageId = doc.activePageId || pages[0].id

    // 画板水合（支持为空 []）
    const frames: CanvasFrame[] = (Array.isArray(doc.frames) ? doc.frames : []).map((f: any) => ({
      ...f,
      pageId: f.pageId || pages[0].id,
    }))

    // 图片水合
    const images: CanvasImage[] = (Array.isArray(doc.images) ? doc.images : []).map((im: any) => ({
      ...im,
      pageId: im.pageId || pages[0].id,
    }))

    // 文本水合
    const texts: CanvasText[] = (Array.isArray(doc.texts) ? doc.texts : []).map((t: any) => ({
      ...t,
      pageId: t.pageId || pages[0].id,
    }))

    // 视口水合恢复
    if (doc.viewport && typeof doc.viewport.zoom === 'number') {
      useViewportStore.getState().setZoom(doc.viewport.zoom)
      useViewportStore.getState().setPan(doc.viewport.panX, doc.viewport.panY)
    }

    set({
      pages,
      activePageId,
      frames,
      images,
      texts,
      selectedIds: [],
      selectedType: null,
      revision: rev,
      isDirty: false,
      editSequence: 0,
      lastSavedSequence: 0,
      lastSaveIntent: 'update',
      baseDocument: {
        version: 2,
        pages: JSON.parse(JSON.stringify(pages)),
        activePageId,
        frames: JSON.parse(JSON.stringify(frames)),
        images: JSON.parse(JSON.stringify(images)),
        texts: JSON.parse(JSON.stringify(texts)),
        viewport: doc.viewport,
      },
    })
  },

  recordHistory: (snapshot) => {
    if (snapshot) {
      useHistoryStore.getState().record(snapshot)
    } else {
      recordHistory(get)
    }
  },

  restoreHistoryDocument: (doc) => {
    if (!doc || typeof doc !== 'object') return
    const current = get()
    const { revision, editSequence } = current

    let pages: CanvasPage[] = Array.isArray(doc.pages) && doc.pages.length ? doc.pages : []
    if (pages.length === 0) {
      pages = [DEFAULT_PAGE]
    }
    const activePageId = doc.activePageId || pages[0].id

    const frames: CanvasFrame[] = (Array.isArray(doc.frames) ? doc.frames : []).map((f: any) => ({
      ...f,
      pageId: f.pageId || pages[0].id,
    }))

    const images: CanvasImage[] = (Array.isArray(doc.images) ? doc.images : []).map((im: any) => ({
      ...im,
      pageId: im.pageId || pages[0].id,
    }))

    const texts: CanvasText[] = (Array.isArray(doc.texts) ? doc.texts : []).map((t: any) => ({
      ...t,
      pageId: t.pageId || pages[0].id,
    }))

    // 仅在跨页面撤销或明确需要时恢复视口；同一页面内撤销保持用户当前视口缩放与平移稳定
    if (activePageId !== current.activePageId && doc.viewport && typeof doc.viewport.zoom === 'number') {
      useViewportStore.getState().setZoom(doc.viewport.zoom)
      useViewportStore.getState().setPan(doc.viewport.panX, doc.viewport.panY)
    }

    // 判断是否为减少/清空内容的撤销/重做
    const currentShapes = current.images.length + current.texts.length + current.frames.length
    const restoredShapes = images.length + texts.length + frames.length
    const currentPages = current.pages.length
    const restoredPages = pages.length

    const isContentDeleted =
      restoredShapes < currentShapes ||
      restoredPages < currentPages ||
      restoredShapes === 0 ||
      images.length === 0

    const intent: 'update' | 'user_delete' = isContentDeleted ? 'user_delete' : 'update'

    set({
      pages,
      activePageId,
      frames,
      images,
      texts,
      selectedIds: [],
      selectedType: null,
      revision, // 保留当前服务器版本号
      isDirty: true,
      editSequence: (editSequence || 0) + 1,
      lastSaveIntent: intent,
    })
  },

  mergeConflictDocument: (serverDoc, serverRev) => {
    if (!serverDoc || typeof serverDoc !== 'object') return
    const current = get()
    const baseDoc = current.baseDocument || {
      version: 2,
      pages: [DEFAULT_PAGE],
      activePageId: 'page-1',
      frames: [],
      images: [],
      texts: [],
    }

    // 1. 基于基线、本地和远端进行 3-Way Merge
    let mergedPages = threeWayMergeList(baseDoc.pages || [], current.pages, serverDoc.pages || [])
    const mergedFrames = threeWayMergeList(baseDoc.frames || [], current.frames, serverDoc.frames || [])
    const mergedImages = threeWayMergeList(baseDoc.images || [], current.images, serverDoc.images || [])
    const mergedTexts = threeWayMergeList(baseDoc.texts || [], current.texts || [], serverDoc.texts || [])

    // 2. 检查并修复页面容器关联完整性：如果保留的图元所属的 pageId 在 mergedPages 中不存在，恢复该页面（优先从 base/local/server 查找）
    const allKnownPages = new Map<string, CanvasPage>()
    for (const p of [...(baseDoc.pages || []), ...current.pages, ...(serverDoc.pages || [])]) {
      if (p && p.id && !allKnownPages.has(p.id)) {
        allKnownPages.set(p.id, p)
      }
    }

    let validPageIds = new Set(mergedPages.map((p) => p.id))
    const checkAndRestorePage = (pageId: string | undefined) => {
      if (!pageId) return
      if (!validPageIds.has(pageId)) {
        const pageToRestore = allKnownPages.get(pageId)
        if (pageToRestore) {
          mergedPages.push(pageToRestore)
          validPageIds.add(pageId)
        }
      }
    }

    for (const f of mergedFrames) checkAndRestorePage(f.pageId)
    for (const im of mergedImages) checkAndRestorePage(im.pageId)
    for (const t of mergedTexts) checkAndRestorePage(t.pageId)

    if (mergedPages.length === 0) {
      mergedPages = [DEFAULT_PAGE]
      validPageIds = new Set([DEFAULT_PAGE.id])
    }

    const fallbackPageId = mergedPages[0].id
    for (const f of mergedFrames) {
      if (!validPageIds.has(f.pageId)) f.pageId = fallbackPageId
    }
    for (const im of mergedImages) {
      if (!validPageIds.has(im.pageId)) im.pageId = fallbackPageId
    }
    for (const t of mergedTexts) {
      if (!validPageIds.has(t.pageId)) t.pageId = fallbackPageId
    }

    // 3. 检查并修复画板容器关联完整性：非空 frameId 必须指向当前有效的 mergedFrames
    const validFrameIds = new Set(mergedFrames.map((f) => f.id))
    for (const im of mergedImages) {
      if (im.frameId && !validFrameIds.has(im.frameId)) {
        im.frameId = null
      }
    }
    for (const t of mergedTexts) {
      if (t.frameId && !validFrameIds.has(t.frameId)) {
        t.frameId = null
      }
    }

    let activePageId = current.activePageId
    if (!mergedPages.some((p) => p.id === activePageId)) {
      activePageId = serverDoc.activePageId && mergedPages.some((p) => p.id === serverDoc.activePageId)
        ? serverDoc.activePageId
        : (mergedPages[0]?.id || 'page-1')
    }

    const mergedDoc: CanvasDocument = {
      version: 2,
      pages: mergedPages,
      activePageId,
      frames: mergedFrames,
      images: mergedImages,
      texts: mergedTexts,
      viewport: current.getDocument().viewport,
    }

    const isDirty = !isEntityEqual(mergedDoc.images, serverDoc.images)
      || !isEntityEqual(mergedDoc.frames, serverDoc.frames)
      || !isEntityEqual(mergedDoc.texts, serverDoc.texts)
      || !isEntityEqual(mergedDoc.pages, serverDoc.pages)

    const serverShapes = (serverDoc.images?.length || 0) + (serverDoc.texts?.length || 0) + (serverDoc.frames?.length || 0)
    const mergedShapes = (mergedDoc.images?.length || 0) + (mergedDoc.texts?.length || 0) + (mergedDoc.frames?.length || 0)
    const serverPages = serverDoc.pages?.length || 0
    const mergedPagesCount = mergedDoc.pages.length

    const isDeletingServerContent =
      current.lastSaveIntent === 'user_delete' ||
      (serverShapes >= 3 && mergedShapes === 0) ||
      ((serverDoc.images?.length || 0) > 0 && (mergedDoc.images?.length || 0) === 0) ||
      mergedShapes < serverShapes ||
      (serverPages > 1 && mergedPagesCount < serverPages)

    const nextIntent: 'update' | 'user_delete' = isDeletingServerContent ? 'user_delete' : 'update'

    set({
      pages: mergedDoc.pages,
      activePageId,
      frames: mergedDoc.frames,
      images: mergedDoc.images,
      texts: mergedDoc.texts,
      baseDocument: JSON.parse(JSON.stringify(serverDoc)),
      revision: serverRev,
      isDirty,
      editSequence: (current.editSequence || 0) + 1,
      lastSaveIntent: nextIntent,
    })
  },

  getDocument: () => {
    const { pages, activePageId, frames, images, texts } = get()
    const { zoom, panX, panY } = useViewportStore.getState()
    return {
      version: 2,
      pages,
      activePageId,
      frames,
      images,
      texts,
      viewport: {
        zoom: Number(zoom.toFixed(4)),
        panX: Math.round(panX),
        panY: Math.round(panY),
      },
    }
  },

  markSaved: (rev, savedSequence, savedDoc) => {
    const { editSequence } = get()
    const currentDoc = get().getDocument()
    const nextBase = savedDoc
      ? JSON.parse(JSON.stringify(savedDoc))
      : JSON.parse(JSON.stringify(currentDoc))

    if (savedSequence !== undefined && editSequence > savedSequence) {
      set({
        revision: rev,
        lastSavedSequence: savedSequence,
        baseDocument: nextBase,
      })
    } else {
      set({
        isDirty: false,
        revision: rev,
        lastSavedSequence: editSequence,
        lastSaveIntent: 'update',
        baseDocument: nextBase,
      })
    }
  },
}))

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

  // 自动排版插入
  insertImagesAuto: (urls: string[], mode?: string, name?: string) => CanvasImage[]

  // 快照与保存
  loadDocument: (doc: any, rev?: number) => void
  getDocument: () => CanvasDocument
  markSaved: (rev: number) => void
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

// 记录历史操作快照
function recordHistory(get: () => CanvasState) {
  const doc = get().getDocument()
  useHistoryStore.getState().record(doc)
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
    set((s) => ({
      pages: [...s.pages, newPage],
      activePageId: newPageId,
      selectedIds: [],
      selectedType: null,
      isDirty: true,
    }))
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
    set((s) => ({
      pages: s.pages.map((p) => (p.id === pageId ? { ...p, name: name.trim() || p.name } : p)),
      isDirty: true,
    }))
  },

  deletePage: (pageId) => {
    const { pages, activePageId } = get()
    if (pages.length <= 1) return // 至少保留一个页面
    recordHistory(get)

    const remainingPages = pages.filter((p) => p.id !== pageId)
    const nextActive = activePageId === pageId ? remainingPages[0].id : activePageId

    set((s) => ({
      pages: remainingPages,
      activePageId: nextActive,
      frames: s.frames.filter((f) => f.pageId !== pageId),
      images: s.images.filter((im) => im.pageId !== pageId),
      selectedIds: [],
      selectedType: null,
      isDirty: true,
    }))
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
    set((s) => ({
      frames: [...s.frames, newFrame],
      selectedIds: [newFrame.id],
      selectedType: 'frame',
      isDirty: true,
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

    set((s) => ({
      frames: s.frames.map((f) => (f.id === id ? { ...f, ...patch } : f)),
      images: nextImages,
      texts: nextTexts,
      isDirty: true,
    }))
  },

  deleteFrame: (id) => {
    recordHistory(get)
    set((s) => ({
      frames: s.frames.filter((f) => f.id !== id),
      // 画板删除后，原画板内部图片与文本解绑成为画布自由排版图元，不强制丢失
      images: s.images.map((im) => (im.frameId === id ? { ...im, frameId: null } : im)),
      texts: s.texts.map((t) => (t.frameId === id ? { ...t, frameId: null } : t)),
      selectedIds: s.selectedIds.filter((selId) => selId !== id),
      selectedType: s.selectedIds.includes(id) ? null : s.selectedType,
      isDirty: true,
    }))
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
    set((s) => ({
      images: [...s.images, newImg],
      selectedIds: [newImg.id],
      selectedType: 'image',
      isDirty: true,
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

    set((s) => ({
      images: [...s.images, ...newImgs],
      selectedIds: newImgs.map((im) => im.id),
      selectedType: 'image',
      isDirty: true,
    }))
    return newImgs
  },

  updateImage: (id, patch) => {
    set((s) => ({
      images: s.images.map((im) => (im.id === id ? { ...im, ...patch } : im)),
      isDirty: true,
    }))
  },

  updateImages: (patches) => {
    const patchMap = new Map(patches.map((p) => [p.id, p.patch]))
    set((s) => ({
      images: s.images.map((im) => {
        const patch = patchMap.get(im.id)
        return patch ? { ...im, ...patch } : im
      }),
      isDirty: true,
    }))
  },

  deleteImage: (id) => {
    recordHistory(get)
    set((s) => ({
      images: s.images.filter((im) => im.id !== id),
      selectedIds: s.selectedIds.filter((selId) => selId !== id),
      selectedType: s.selectedIds.includes(id) && s.selectedIds.length === 1 ? null : s.selectedType,
      isDirty: true,
    }))
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
    set((s) => ({
      texts: [...s.texts, newText],
      selectedIds: [newText.id],
      selectedType: 'text',
      isDirty: true,
    }))
    return newText
  },

  updateText: (id, patch) => {
    set((s) => ({
      texts: s.texts.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      isDirty: true,
    }))
  },

  deleteText: (id) => {
    recordHistory(get)
    set((s) => ({
      texts: s.texts.filter((t) => t.id !== id),
      selectedIds: s.selectedIds.filter((selId) => selId !== id),
      selectedType: s.selectedIds.includes(id) && s.selectedIds.length === 1 ? null : s.selectedType,
      isDirty: true,
    }))
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
      set((s) => ({
        texts: s.texts.filter((t) => !idSet.has(t.id)),
        selectedIds: [],
        selectedType: null,
        isDirty: true,
      }))
    } else {
      const idSet = new Set(selectedIds)
      set((s) => ({
        images: s.images.filter((im) => !idSet.has(im.id)),
        selectedIds: [],
        selectedType: null,
        isDirty: true,
      }))
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

      set((s) => ({
        frames: [...s.frames, newFrame],
        images: [...s.images, ...newImages],
        texts: [...s.texts, ...newTexts],
        selectedIds: [newFrameId],
        selectedType: 'frame',
        isDirty: true,
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
      set((s) => ({
        texts: [...s.texts, ...duplicates],
        selectedIds: duplicates.map((d) => d.id),
        selectedType: 'text',
        isDirty: true,
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

    set((s) => ({
      images: [...s.images, ...duplicates],
      selectedIds: duplicates.map((d) => d.id),
      selectedType: 'image',
      isDirty: true,
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
        return {
          images: s.images.filter((im) => im.id !== id).concat(target),
          isDirty: true,
        }
      }
      const isTxt = s.texts.some((t) => t.id === id)
      if (isTxt) {
        const idx = s.texts.findIndex((t) => t.id === id)
        if (idx === -1 || idx === s.texts.length - 1) return s
        const target = s.texts[idx]
        return {
          texts: s.texts.filter((t) => t.id !== id).concat(target),
          isDirty: true,
        }
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
        return { images: nextImages, isDirty: true }
      }
      const isTxt = s.texts.some((t) => t.id === id)
      if (isTxt) {
        const idx = s.texts.findIndex((t) => t.id === id)
        if (idx === -1 || idx === s.texts.length - 1) return s
        const nextTexts = [...s.texts]
        const temp = nextTexts[idx]
        nextTexts[idx] = nextTexts[idx + 1]
        nextTexts[idx + 1] = temp
        return { texts: nextTexts, isDirty: true }
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
        return { images: nextImages, isDirty: true }
      }
      const isTxt = s.texts.some((t) => t.id === id)
      if (isTxt) {
        const idx = s.texts.findIndex((t) => t.id === id)
        if (idx <= 0) return s
        const nextTexts = [...s.texts]
        const temp = nextTexts[idx]
        nextTexts[idx] = nextTexts[idx - 1]
        nextTexts[idx - 1] = temp
        return { texts: nextTexts, isDirty: true }
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
        return {
          images: [target].concat(s.images.filter((im) => im.id !== id)),
          isDirty: true,
        }
      }
      const isTxt = s.texts.some((t) => t.id === id)
      if (isTxt) {
        const idx = s.texts.findIndex((t) => t.id === id)
        if (idx === -1 || idx === 0) return s
        const target = s.texts[idx]
        return {
          texts: [target].concat(s.texts.filter((t) => t.id !== id)),
          isDirty: true,
        }
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
      set((s) => ({
        images: s.images.map((im) => {
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
          return im.frameId !== matchedFrameId ? { ...im, frameId: matchedFrameId } : im
        }),
        isDirty: true,
      }))
    } else if (type === 'text') {
      set((s) => ({
        texts: s.texts.map((t) => {
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
          return t.frameId !== matchedFrameId ? { ...t, frameId: matchedFrameId } : t
        }),
        isDirty: true,
      }))
    }
  },

  // ─── 自动排版插入（4列网格） ──────────────────────────────
  insertImagesAuto: (urls, mode, name) => {
    const { activePageId, frames, images } = get()
    const activeFrame = frames.find((f) => f.pageId === activePageId)

    const GRID_COLS = 4
    const CELL_W = 420
    const CELL_H = 560
    const GAP = 36

    // 确定起始排版基准位置
    const startX = activeFrame ? activeFrame.x + activeFrame.width + 80 : 0
    const startY = activeFrame ? activeFrame.y : 0

    // 计算已有自动排版图片的数量
    const existingAutoImgs = images.filter((im) => im.pageId === activePageId && !im.frameId)
    const startIndex = existingAutoImgs.length

    const createdImages: CanvasImage[] = []

    urls.forEach((url, idx) => {
      const currentIndex = startIndex + idx
      const col = currentIndex % GRID_COLS
      const row = Math.floor(currentIndex / GRID_COLS)

      const x = startX + col * (CELL_W + GAP)
      const y = startY + row * (CELL_H + GAP)

      const img: CanvasImage = {
        id: 'img-' + Math.random().toString(36).slice(2, 10),
        pageId: activePageId,
        frameId: null, // 默认按自由排版
        x,
        y,
        width: CELL_W,
        height: CELL_H,
        rotation: 0,
        url,
        name: name || `生成图片 ${currentIndex + 1}`,
        locked: false,
        opacity: 1,
      }
      createdImages.push(img)
    })

    recordHistory(get)
    set((s) => ({
      images: [...s.images, ...createdImages],
      selectedIds: createdImages.map((im) => im.id),
      selectedType: 'image',
      isDirty: true,
    }))

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
    const activePageId = doc.activePageId || pages[0].id

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

  markSaved: (rev) => set({ isDirty: false, revision: rev }),
}))

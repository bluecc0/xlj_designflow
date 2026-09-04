import { create } from 'zustand'
import type { CanvasDocument, CanvasFrame, CanvasImage } from '../types'

interface CanvasState {
  frames: CanvasFrame[]
  images: CanvasImage[]
  selectedId: string | null
  activeFrameId: string | null
  revision: number
  isDirty: boolean

  addFrame: (frame: CanvasFrame) => void
  addImage: (image: CanvasImage) => void
  updateImage: (id: string, patch: Partial<CanvasImage>) => void
  deleteImage: (id: string) => void
  setSelectedId: (id: string | null) => void
  setActiveFrameId: (id: string | null) => void
  bringToFront: (id: string) => void
  insertImageAuto: (url: string, name?: string) => CanvasImage
  loadDocument: (doc: CanvasDocument, rev?: number) => void
  getDocument: () => CanvasDocument
  markSaved: (rev: number) => void
}

const DEFAULT_FRAME: CanvasFrame = {
  id: 'frame-1',
  name: '画板 1',
  x: 0,
  y: 0,
  width: 1080,
  height: 1080,
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  frames: [DEFAULT_FRAME],
  images: [],
  selectedId: null,
  activeFrameId: 'frame-1',
  revision: 1,
  isDirty: false,

  addFrame: (frame) =>
    set((s) => ({
      frames: [...s.frames, frame],
      activeFrameId: frame.id,
      isDirty: true,
    })),

  addImage: (img) =>
    set((s) => ({
      images: [...s.images, img],
      selectedId: img.id,
      isDirty: true,
    })),

  updateImage: (id, patch) =>
    set((s) => ({
      images: s.images.map((im) => (im.id === id ? { ...im, ...patch } : im)),
      isDirty: true,
    })),

  deleteImage: (id) =>
    set((s) => ({
      images: s.images.filter((im) => im.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
      isDirty: true,
    })),

  setSelectedId: (id) => set({ selectedId: id }),
  setActiveFrameId: (id) => set({ activeFrameId: id }),

  bringToFront: (id) =>
    set((s) => {
      const idx = s.images.findIndex((im) => im.id === id)
      if (idx === -1 || idx === s.images.length - 1) return s
      const target = s.images[idx]
      const next = s.images.filter((im) => im.id !== id).concat(target)
      return { images: next, isDirty: true }
    }),

  insertImageAuto: (url, name) => {
    const { frames, activeFrameId, images } = get()
    const frame = frames.find((f) => f.id === activeFrameId) || frames[0] || DEFAULT_FRAME

    // 计算放置坐标（在画板内略微错开排布）
    const existingInFrame = images.filter((im) => im.frameId === frame.id)
    const offset = (existingInFrame.length % 6) * 40

    // 默认按照 512x512 放入
    const w = 512
    const h = 512
    const imgX = frame.x + Math.max(20, Math.round((frame.width - w) / 2) + offset - 100)
    const imgY = frame.y + Math.max(20, Math.round((frame.height - h) / 2) + offset - 100)

    const newImage: CanvasImage = {
      id: 'img-' + Math.random().toString(36).slice(2, 10),
      frameId: frame.id,
      x: Math.max(0, imgX),
      y: Math.max(0, imgY),
      width: w,
      height: h,
      rotation: 0,
      url,
      name: name || 'AI 生成图片',
      locked: false,
      opacity: 1,
    }

    set((s) => ({
      images: [...s.images, newImage],
      selectedId: newImage.id,
      isDirty: true,
    }))

    return newImage
  },

  loadDocument: (doc, rev = 1) =>
    set({
      frames: doc.frames && doc.frames.length ? doc.frames : [DEFAULT_FRAME],
      images: doc.images || [],
      selectedId: null,
      activeFrameId: doc.frames?.[0]?.id || 'frame-1',
      revision: rev,
      isDirty: false,
    }),

  getDocument: () => {
    const { frames, images } = get()
    return {
      version: 2,
      frames,
      images,
    }
  },

  markSaved: (rev) => set({ isDirty: false, revision: rev }),
}))

import { create } from 'zustand'
import type { CanvasDocument } from '../types'

interface HistoryStore {
  past: CanvasDocument[]
  future: CanvasDocument[]
  canUndo: boolean
  canRedo: boolean
  record: (doc: CanvasDocument) => void
  undo: (currentDoc: CanvasDocument) => CanvasDocument | null
  redo: (currentDoc: CanvasDocument) => CanvasDocument | null
  clear: () => void
}

const MAX_HISTORY = 30

export const useHistoryStore = create<HistoryStore>((set, get) => ({
  past: [],
  future: [],
  canUndo: false,
  canRedo: false,

  record: (doc) => {
    // 拷贝一份深拷贝
    const snapshot = JSON.parse(JSON.stringify(doc))
    set((state) => {
      const newPast = [...state.past, snapshot].slice(-MAX_HISTORY)
      return {
        past: newPast,
        future: [],
        canUndo: true,
        canRedo: false,
      }
    })
  },

  undo: (currentDoc) => {
    const { past, future } = get()
    if (past.length === 0) return null

    const previous = past[past.length - 1]
    const newPast = past.slice(0, -1)
    const newFuture = [JSON.parse(JSON.stringify(currentDoc)), ...future].slice(0, MAX_HISTORY)

    set({
      past: newPast,
      future: newFuture,
      canUndo: newPast.length > 0,
      canRedo: true,
    })

    return previous
  },

  redo: (currentDoc) => {
    const { past, future } = get()
    if (future.length === 0) return null

    const next = future[0]
    const newFuture = future.slice(1)
    const newPast = [...past, JSON.parse(JSON.stringify(currentDoc))].slice(-MAX_HISTORY)

    set({
      past: newPast,
      future: newFuture,
      canUndo: true,
      canRedo: newFuture.length > 0,
    })

    return next
  },

  clear: () => {
    set({ past: [], future: [], canUndo: false, canRedo: false })
  },
}))

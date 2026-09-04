import { create } from 'zustand'
import type { Point } from '../types'

interface ViewportState {
  zoom: number
  panX: number
  panY: number
  isSpacePressed: boolean
  isPanning: boolean

  setSpacePressed: (pressed: boolean) => void
  setIsPanning: (panning: boolean) => void
  panBy: (dx: number, dy: number) => void
  setPan: (x: number, y: number) => void
  setZoom: (zoom: number) => void
  zoomAt: (screenPoint: Point, factor: number) => void
  resetViewport: () => void
  screenToCanvas: (screen: Point) => Point
  canvasToScreen: (canvas: Point) => Point
}

const MIN_ZOOM = 0.05
const MAX_ZOOM = 6.0

export const useViewportStore = create<ViewportState>((set, get) => ({
  zoom: 0.8,
  panX: 100,
  panY: 80,
  isSpacePressed: false,
  isPanning: false,

  setSpacePressed: (pressed) => set({ isSpacePressed: pressed }),
  setIsPanning: (panning) => set({ isPanning: panning }),

  panBy: (dx, dy) => set((s) => ({ panX: s.panX + dx, panY: s.panY + dy })),
  setPan: (x, y) => set({ panX: x, panY: y }),
  setZoom: (z) => set({ zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z)) }),

  zoomAt: (screenPoint, factor) => {
    const { zoom, panX, panY } = get()
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor))
    if (nextZoom === zoom) return

    // 保持以当前指针所在点为锚点缩放
    const canvasX = (screenPoint.x - panX) / zoom
    const canvasY = (screenPoint.y - panY) / zoom

    const nextPanX = screenPoint.x - canvasX * nextZoom
    const nextPanY = screenPoint.y - canvasY * nextZoom

    set({ zoom: nextZoom, panX: nextPanX, panY: nextPanY })
  },

  resetViewport: () => set({ zoom: 1.0, panX: 120, panY: 80 }),

  screenToCanvas: (screen) => {
    const { zoom, panX, panY } = get()
    return {
      x: (screen.x - panX) / zoom,
      y: (screen.y - panY) / zoom,
    }
  },

  canvasToScreen: (canvas) => {
    const { zoom, panX, panY } = get()
    return {
      x: canvas.x * zoom + panX,
      y: canvas.y * zoom + panY,
    }
  },
}))

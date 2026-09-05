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

function getStorageKey() {
  const uid =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('user_id') || 'default'
      : 'default'
  return `designflow_canvas_viewport_${uid}`
}

function getInitialViewport() {
  try {
    const key = getStorageKey()
    const saved = localStorage.getItem(key)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (
        typeof parsed.zoom === 'number' &&
        typeof parsed.panX === 'number' &&
        typeof parsed.panY === 'number'
      ) {
        return {
          zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, parsed.zoom)),
          panX: parsed.panX,
          panY: parsed.panY,
        }
      }
    }
  } catch {}
  return {
    zoom: 0.8,
    panX: 100,
    panY: 80,
  }
}

let saveTimer: any = null
function persistViewport(zoom: number, panX: number, panY: number) {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(getStorageKey(), JSON.stringify({ zoom, panX, panY }))
    } catch {}
  }, 100)
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    try {
      const { zoom, panX, panY } = useViewportStore.getState()
      localStorage.setItem(getStorageKey(), JSON.stringify({ zoom, panX, panY }))
    } catch {}
  })
}

const initial = getInitialViewport()

export const useViewportStore = create<ViewportState>((set, get) => ({
  zoom: initial.zoom,
  panX: initial.panX,
  panY: initial.panY,
  isSpacePressed: false,
  isPanning: false,

  setSpacePressed: (pressed) => set({ isSpacePressed: pressed }),
  setIsPanning: (panning) => set({ isPanning: panning }),

  panBy: (dx, dy) => {
    set((s) => {
      const nextPanX = s.panX + dx
      const nextPanY = s.panY + dy
      persistViewport(s.zoom, nextPanX, nextPanY)
      return { panX: nextPanX, panY: nextPanY }
    })
  },

  setPan: (x, y) => {
    set((s) => {
      persistViewport(s.zoom, x, y)
      return { panX: x, panY: y }
    })
  },

  setZoom: (z) => {
    set((s) => {
      const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z))
      persistViewport(nextZoom, s.panX, s.panY)
      return { zoom: nextZoom }
    })
  },

  zoomAt: (screenPoint, factor) => {
    const { zoom, panX, panY } = get()
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor))
    if (nextZoom === zoom) return

    // 保持以当前指针所在点为锚点缩放
    const canvasX = (screenPoint.x - panX) / zoom
    const canvasY = (screenPoint.y - panY) / zoom

    const nextPanX = screenPoint.x - canvasX * nextZoom
    const nextPanY = screenPoint.y - canvasY * nextZoom

    persistViewport(nextZoom, nextPanX, nextPanY)
    set({ zoom: nextZoom, panX: nextPanX, panY: nextPanY })
  },

  resetViewport: () => {
    persistViewport(1.0, 120, 80)
    set({ zoom: 1.0, panX: 120, panY: 80 })
  },

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

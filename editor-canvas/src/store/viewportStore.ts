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
  setViewport: (zoom: number, panX: number, panY: number) => void
  zoomAt: (screenPoint: Point, factor: number) => void
  resetViewport: () => void
  screenToCanvas: (screen: Point) => Point
  canvasToScreen: (canvas: Point) => Point
  switchPageViewport: (newPageId: string) => void
}

const MIN_ZOOM = 0.05
const MAX_ZOOM = 6.0

function getUserId(): string {
  if (typeof window === 'undefined') return 'default'
  try {
    return new URLSearchParams(window.location.search).get('user_id') || 'default'
  } catch {
    return 'default'
  }
}

function getGlobalStorageKey(): string {
  return `designflow_canvas_viewport_${getUserId()}`
}

function getPageStorageKey(pageId?: string): string {
  const pid = pageId || 'default'
  return `designflow_canvas_page_viewport_${getUserId()}_${pid}`
}

function getInitialViewport() {
  try {
    const key = getGlobalStorageKey()
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

let activePageIdRef = 'page-1'
let saveTimer: any = null

function saveViewportToStorage(zoom: number, panX: number, panY: number) {
  try {
    const payload = JSON.stringify({ zoom, panX, panY, updatedAt: Date.now() })
    localStorage.setItem(getGlobalStorageKey(), payload)
    if (activePageIdRef) {
      localStorage.setItem(getPageStorageKey(activePageIdRef), payload)
    }
  } catch {}
}

function persistViewport(zoom: number, panX: number, panY: number) {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveViewportToStorage(zoom, panX, panY)
  }, 80)
}

export function hasLocalStoredViewport(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const key = getGlobalStorageKey()
    const saved = localStorage.getItem(key)
    if (!saved) return false
    const parsed = JSON.parse(saved)
    return (
      typeof parsed.zoom === 'number' &&
      typeof parsed.panX === 'number' &&
      typeof parsed.panY === 'number'
    )
  } catch {
    return false
  }
}

export function setActivePageForViewport(pageId: string) {
  activePageIdRef = pageId
}

export function getStoredPageViewport(pageId: string) {
  try {
    const pageSaved = localStorage.getItem(getPageStorageKey(pageId))
    if (pageSaved) {
      const parsed = JSON.parse(pageSaved)
      if (typeof parsed.zoom === 'number' && typeof parsed.panX === 'number' && typeof parsed.panY === 'number') {
        return {
          zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, parsed.zoom)),
          panX: parsed.panX,
          panY: parsed.panY,
        }
      }
    }
  } catch {}
  return null
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    try {
      const { zoom, panX, panY } = useViewportStore.getState()
      saveViewportToStorage(zoom, panX, panY)
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

  setViewport: (zoom, panX, panY) => {
    clearTimeout(saveTimer)
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom))
    set({ zoom: nextZoom, panX, panY })
    saveViewportToStorage(nextZoom, panX, panY)
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

  switchPageViewport: (newPageId: string) => {
    // 切换前清除待写入的旧视口，确保它不会被记到新画板。
    clearTimeout(saveTimer)
    const current = get()
    saveViewportToStorage(current.zoom, current.panX, current.panY)
    activePageIdRef = newPageId
    const saved = getStoredPageViewport(newPageId)
    const next = saved || { zoom: current.zoom, panX: current.panX, panY: current.panY }
    set(next)
    saveViewportToStorage(next.zoom, next.panX, next.panY)
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

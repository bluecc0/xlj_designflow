export type Point = {
  x: number
  y: number
}

export type Rect = {
  x: number
  y: number
  width: number
  height: number
}

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export interface CanvasFrame {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
}

export interface CanvasImage {
  id: string
  frameId?: string | null
  x: number
  y: number
  width: number
  height: number
  rotation: number
  url: string
  naturalWidth?: number
  naturalHeight?: number
  name?: string
  locked?: boolean
  opacity?: number
  meta?: Record<string, any>
}

export interface CanvasDocument {
  version: 2
  frames: CanvasFrame[]
  images: CanvasImage[]
  viewport?: {
    zoom: number
    panX: number
    panY: number
  }
}

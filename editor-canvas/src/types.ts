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

export type CanvasTool = 'select' | 'hand' | 'frame' | 'text'

export interface CanvasPage {
  id: string
  name: string
  order: number
  archived?: boolean
  archivedAt?: number
  groupId?: string | null
}

export interface CanvasPageGroup {
  id: string
  name: string
  order: number
  collapsed?: boolean
}

export interface CanvasFrame {
  id: string
  pageId: string
  name: string
  x: number
  y: number
  width: number
  height: number
  background?: string
}

export interface ReferenceImageItem {
  type?: 'manual' | 'context' | 'outpainting_source' | 'preview' | string
  name?: string
  url: string
  label?: string
  width?: number
  height?: number
}

export interface CanvasImageMeta {
  prompt?: string
  originalPrompt?: string
  resolvedPrompt?: string
  promptTrace?: string
  model?: string
  provider?: string
  jobId?: string
  clientRequestId?: string
  createdAt?: number | string
  size?: string
  resolution?: string
  variant?: string
  quality?: string
  skill?: string
  hasReference?: boolean
  referenceCount?: number
  referenceImages?: ReferenceImageItem[]
  fileSize?: number
  mimeType?: string
  requestMeta?: Record<string, any>
  [key: string]: any
}

export interface CanvasImage {
  id: string
  pageId: string
  frameId?: string | null // null 表示直接放置在画布上自由排版
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
  meta?: CanvasImageMeta
}

export interface CanvasText {
  id: string
  pageId: string
  frameId?: string | null
  x: number
  y: number
  width: number
  height: number
  text: string
  fontSize: number
  color: string
  lineHeight?: number
  fontWeight?: 'normal' | '500' | '600' | 'bold'
  fontStyle?: 'normal' | 'italic'
  textAlign?: 'left' | 'center' | 'right'
  locked?: boolean
}

export interface CanvasDocument {
  version: 2
  pages: CanvasPage[]
  groups?: CanvasPageGroup[]
  activePageId: string
  frames: CanvasFrame[]
  images: CanvasImage[]
  texts?: CanvasText[]
  viewport?: {
    zoom: number
    panX: number
    panY: number
  }
}

export interface OutpaintMargins {
  top: number
  right: number
  bottom: number
  left: number
}

export interface AIOperationState {
  type: 'outpainting' | 'upscale' | 'matting' | 'vectorize' | 'layer-extract' | 'quick-edit' | null
  status: 'idle' | 'running' | 'done' | 'error'
  jobId?: string
  progress?: number
  message?: string
  error?: string
}

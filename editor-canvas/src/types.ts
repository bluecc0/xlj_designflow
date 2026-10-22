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
  specialComposeSourceUrl?: string
  specialComposeDownloadUrl?: string
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

export interface QuickEditMarker {
  id: string
  number: number // 标记序号 1, 2, 3...
  type?: 'point' | 'rect' // 标记类型：单点标记 或 选框区域标记
  ratioX: number // 相对图片宽度比例 0 ~ 1 (单点坐标 或 矩形左上角)
  ratioY: number // 相对图片高度比例 0 ~ 1 (单点坐标 或 矩形左上角)
  ratioWidth?: number // 矩形选框宽度比例 0 ~ 1
  ratioHeight?: number // 矩形选框高度比例 0 ~ 1
  pixelX: number // 对应图片天然或当前尺寸像素横坐标
  pixelY: number // 对应图片天然或当前尺寸像素纵坐标
  pixelWidth?: number // 对应图片天然或当前尺寸像素宽度
  pixelHeight?: number // 对应图片天然或当前尺寸像素高度
}

export interface AIOperationState {
  type: 'outpainting' | 'upscale' | 'matting' | 'vectorize' | 'layer-extract' | 'quick-edit' | null
  status: 'idle' | 'running' | 'done' | 'error'
  jobId?: string
  progress?: number
  message?: string
  error?: string
}

// 细节修复：快捷编辑里叠在原图上的图案图层与涂抹笔迹。
// 所有“局部坐标”都是原图在画布上的未旋转坐标（左上角为原点，单位与 image.width 相同）。

export interface RepairCrop {
  x: number
  y: number
  width: number
  height: number
}

export interface RepairPatch {
  id: string
  /** 显示用地址（本地文件为 objectURL） */
  url: string
  /** 本地文件（粘贴 / 拖入的文件）；画布或聊天区的图片提交时再按 sourceUrl 读取 */
  file: Blob | null
  sourceUrl: string
  naturalWidth: number
  naturalHeight: number
  /** 图案原图上的裁切框（图案像素） */
  crop: RepairCrop
  /** 裁切后图案中心的局部坐标 */
  cx: number
  cy: number
  /** 每个图案像素对应的局部长度 */
  scale: number
  /** 顺时针角度 */
  rotation: number
  /** 只用于对齐，提交时按不透明处理 */
  opacity: number
}

export interface RepairStroke {
  points: { x: number; y: number }[]
  /** 局部坐标下的笔刷直径 */
  size: number
  erase: boolean
}

export interface TargetBox {
  x: number
  y: number
  width: number
  height: number
  rotation?: number
}

export const MIN_CROP_PX = 8
export const DEFAULT_PATCH_OPACITY = 0.7
/** 一次细节修复最多叠几个图案（与后端 MAX_PATTERNS 一致） */
export const MAX_PATCHES = 4

/** 新图案图层：长边约为原图短边的 35%，默认放在 at（局部坐标）或原图中心。 */
export function createPatch(
  target: { width: number; height: number },
  natural: { width: number; height: number },
  source: { url: string; file: Blob | null; sourceUrl: string },
  at?: { x: number; y: number } | null
): RepairPatch {
  const nw = Math.max(1, natural.width)
  const nh = Math.max(1, natural.height)
  const scale = (0.35 * Math.min(target.width, target.height)) / Math.max(nw, nh)
  return {
    id: 'patch-' + Math.random().toString(36).slice(2, 10),
    ...source,
    naturalWidth: nw,
    naturalHeight: nh,
    crop: { x: 0, y: 0, width: nw, height: nh },
    cx: at ? at.x : target.width / 2,
    cy: at ? at.y : target.height / 2,
    scale,
    rotation: 0,
    opacity: DEFAULT_PATCH_OPACITY,
  }
}

/** 画布坐标 → 原图局部坐标（抵消原图旋转）。 */
export function canvasToLocal(pt: { x: number; y: number }, target: TargetBox): { x: number; y: number } {
  const cx = target.x + target.width / 2
  const cy = target.y + target.height / 2
  const rad = (-(target.rotation || 0) * Math.PI) / 180
  const dx = pt.x - cx
  const dy = pt.y - cy
  return {
    x: dx * Math.cos(rad) - dy * Math.sin(rad) + target.width / 2,
    y: dx * Math.sin(rad) + dy * Math.cos(rad) + target.height / 2,
  }
}

export function isInsideTarget(local: { x: number; y: number }, target: { width: number; height: number }): boolean {
  return local.x >= 0 && local.y >= 0 && local.x <= target.width && local.y <= target.height
}

/** 局部位移转到图案自身坐标（抵消图案旋转、除以缩放），单位为图案像素。 */
export function localDeltaToPatch(dx: number, dy: number, patch: RepairPatch): { x: number; y: number } {
  const rad = (-patch.rotation * Math.PI) / 180
  return {
    x: (dx * Math.cos(rad) - dy * Math.sin(rad)) / patch.scale,
    y: (dx * Math.sin(rad) + dy * Math.cos(rad)) / patch.scale,
  }
}

export function clampCrop(crop: RepairCrop, natural: { width: number; height: number }): RepairCrop {
  const minW = Math.min(MIN_CROP_PX, natural.width)
  const minH = Math.min(MIN_CROP_PX, natural.height)
  const x = Math.max(0, Math.min(natural.width - minW, crop.x))
  const y = Math.max(0, Math.min(natural.height - minH, crop.y))
  const width = Math.max(minW, Math.min(natural.width - x, crop.width))
  const height = Math.max(minH, Math.min(natural.height - y, crop.height))
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}

/** 换裁切框时保持图案内容在原图上的位置不动，只移动图层中心。 */
export function applyCrop(patch: RepairPatch, nextCrop: RepairCrop): RepairPatch {
  const crop = clampCrop(nextCrop, { width: patch.naturalWidth, height: patch.naturalHeight })
  const oldCx = patch.crop.x + patch.crop.width / 2
  const oldCy = patch.crop.y + patch.crop.height / 2
  const newCx = crop.x + crop.width / 2
  const newCy = crop.y + crop.height / 2
  const dx = (newCx - oldCx) * patch.scale
  const dy = (newCy - oldCy) * patch.scale
  const rad = (patch.rotation * Math.PI) / 180
  return {
    ...patch,
    crop,
    cx: patch.cx + dx * Math.cos(rad) - dy * Math.sin(rad),
    cy: patch.cy + dx * Math.sin(rad) + dy * Math.cos(rad),
  }
}

/** 提交给后端的摆放参数：原图像素坐标。 */
export function toSourcePlacement(
  patch: RepairPatch,
  target: { width: number; height: number },
  natural: { width: number; height: number }
) {
  const kx = natural.width / target.width
  const ky = natural.height / target.height
  return {
    center_x: patch.cx * kx,
    center_y: patch.cy * ky,
    width: patch.crop.width * patch.scale * kx,
    height: patch.crop.height * patch.scale * ky,
    rotation: patch.rotation,
    crop: { ...patch.crop },
  }
}

/** 角度归一到 (-180, 180]。 */
export function normalizeAngle(deg: number): number {
  let a = deg % 360
  if (a > 180) a -= 360
  if (a <= -180) a += 360
  return a
}

interface StrokeContext {
  globalCompositeOperation: string
  strokeStyle: any
  fillStyle: any
  lineWidth: number
  lineCap: string
  lineJoin: string
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  arc(x: number, y: number, r: number, s: number, e: number): void
  stroke(): void
  fill(): void
}

/** 把笔迹画到 2D 画布上（k 为局部坐标 → 目标画布像素的倍数）；擦除笔迹挖掉已有内容。 */
export function drawStrokes(ctx: StrokeContext, strokes: RepairStroke[], k: number, color: string) {
  for (const stroke of strokes) {
    if (!stroke.points.length) continue
    ctx.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over'
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = stroke.size * k
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (stroke.points.length === 1) {
      const p = stroke.points[0]
      ctx.beginPath()
      ctx.arc(p.x * k, p.y * k, (stroke.size * k) / 2, 0, Math.PI * 2)
      ctx.fill()
      continue
    }
    ctx.beginPath()
    ctx.moveTo(stroke.points[0].x * k, stroke.points[0].y * k)
    for (const p of stroke.points.slice(1)) ctx.lineTo(p.x * k, p.y * k)
    ctx.stroke()
  }
  ctx.globalCompositeOperation = 'source-over'
}

export function hasPaint(strokes: RepairStroke[]): boolean {
  return strokes.some((s) => !s.erase && s.points.length > 0)
}

/** 涂抹遮罩：原图像素尺寸的透明 PNG，涂到的地方不透明（后端读透明通道）。 */
export function renderMaskBlob(
  strokes: RepairStroke[],
  target: { width: number; height: number },
  natural: { width: number; height: number }
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(natural.width))
  canvas.height = Math.max(1, Math.round(natural.height))
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('无法生成涂抹区域'))
  drawStrokes(ctx as any, strokes, natural.width / target.width, '#ffffff')
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('无法生成涂抹区域'))), 'image/png')
  })
}

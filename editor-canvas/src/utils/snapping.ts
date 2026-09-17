import type { ResizeHandle } from '../types'
import { useCanvasStore } from '../store/canvasStore'

export interface RectBox {
  id?: string
  x: number
  y: number
  width: number
  height: number
}

export interface SnapLine {
  id: string
  type: 'vertical' | 'horizontal'
  pos: number // 画布坐标中的固定轴坐标 (x 或 y)
  start: number // 另一轴的起点
  end: number // 另一轴的终点
}

export interface SnapResult {
  snappedX: number
  snappedY: number
  lines: SnapLine[]
}

const SNAP_THRESHOLD_SCREEN = 7 // 屏幕像素磁吸阈值（适中且精准）

/**
 * 获取当前页面可作为对齐参考的目标框集合（画板、其他图片、文本）
 */
export function getSnapTargets(excludeIds: string[] = [], pageId?: string): RectBox[] {
  const { frames, images, texts, activePageId } = useCanvasStore.getState()
  const targetPage = pageId || activePageId
  const excludeSet = new Set(excludeIds)

  const targets: RectBox[] = []

  // 1. 画板边框与中心（画板自身永不对齐子级）
  for (const f of frames) {
    if (f.pageId === targetPage && !excludeSet.has(f.id)) {
      targets.push({
        id: f.id,
        x: f.x,
        y: f.y,
        width: f.width,
        height: f.height,
      })
    }
  }

  // 2. 其他图片
  for (const im of images) {
    if (im.pageId === targetPage && !excludeSet.has(im.id)) {
      targets.push({
        id: im.id,
        x: im.x,
        y: im.y,
        width: im.width,
        height: im.height,
      })
    }
  }

  // 3. 文本元素
  for (const txt of texts) {
    if (txt.pageId === targetPage && !excludeSet.has(txt.id)) {
      const approxW = Math.max(40, (txt.text?.length || 2) * (txt.fontSize || 16) * 0.8)
      const approxH = Math.max(24, (txt.fontSize || 16) * (txt.lineHeight || 1.3))
      targets.push({
        id: txt.id,
        x: txt.x,
        y: txt.y,
        width: approxW,
        height: approxH,
      })
    }
  }

  return targets
}

/**
 * 计算平移拖拽时的智能吸附与参考线
 */
export function calculateSnap(
  dragBox: RectBox,
  targetBoxes: RectBox[],
  zoom: number
): SnapResult {
  const threshold = SNAP_THRESHOLD_SCREEN / zoom
  let snappedX = dragBox.x
  let snappedY = dragBox.y
  const lines: SnapLine[] = []

  let minDiffX = threshold
  let minDiffY = threshold
  let activeSnapX: { pos: number; start: number; end: number } | null = null
  let activeSnapY: { pos: number; start: number; end: number } | null = null

  // 待拖拽矩形在 X 轴上的关键点：左 (0)、中 (0.5)、右 (1.0)
  const dragXPoints = [
    { offset: 0, val: dragBox.x },
    { offset: dragBox.width / 2, val: dragBox.x + dragBox.width / 2 },
    { offset: dragBox.width, val: dragBox.x + dragBox.width },
  ]

  // 待拖拽矩形在 Y 轴上的关键点：上 (0)、中 (0.5)、下 (1.0)
  const dragYPoints = [
    { offset: 0, val: dragBox.y },
    { offset: dragBox.height / 2, val: dragBox.y + dragBox.height / 2 },
    { offset: dragBox.height, val: dragBox.y + dragBox.height },
  ]

  for (const target of targetBoxes) {
    if (target.id && target.id === dragBox.id) continue

    const targetXPoints = [
      target.x,
      target.x + target.width / 2,
      target.x + target.width,
    ]

    const targetYPoints = [
      target.y,
      target.y + target.height / 2,
      target.y + target.height,
    ]

    // 匹配 X 轴吸附
    for (const dp of dragXPoints) {
      for (const tp of targetXPoints) {
        const diff = Math.abs(dp.val - tp)
        if (diff < minDiffX) {
          minDiffX = diff
          snappedX = tp - dp.offset
          const startY = Math.min(dragBox.y, target.y) - 20
          const endY = Math.max(dragBox.y + dragBox.height, target.y + target.height) + 20
          activeSnapX = { pos: tp, start: startY, end: endY }
        } else if (activeSnapX && Math.abs(dp.val - tp) < 0.001) {
          // 贯通多目标
          activeSnapX.start = Math.min(activeSnapX.start, target.y - 20)
          activeSnapX.end = Math.max(activeSnapX.end, target.y + target.height + 20)
        }
      }
    }

    // 匹配 Y 轴吸附
    for (const dp of dragYPoints) {
      for (const tp of targetYPoints) {
        const diff = Math.abs(dp.val - tp)
        if (diff < minDiffY) {
          minDiffY = diff
          snappedY = tp - dp.offset
          const startX = Math.min(dragBox.x, target.x) - 20
          const endX = Math.max(dragBox.x + dragBox.width, target.x + target.width) + 20
          activeSnapY = { pos: tp, start: startX, end: endX }
        } else if (activeSnapY && Math.abs(dp.val - tp) < 0.001) {
          // 贯通多目标
          activeSnapY.start = Math.min(activeSnapY.start, target.x - 20)
          activeSnapY.end = Math.max(activeSnapY.end, target.x + target.width + 20)
        }
      }
    }
  }

  if (activeSnapX) {
    lines.push({
      id: `v-${Math.round(activeSnapX.pos)}`,
      type: 'vertical',
      pos: Math.round(activeSnapX.pos),
      start: Math.round(activeSnapX.start),
      end: Math.round(activeSnapX.end),
    })
  }

  if (activeSnapY) {
    lines.push({
      id: `h-${Math.round(activeSnapY.pos)}`,
      type: 'horizontal',
      pos: Math.round(activeSnapY.pos),
      start: Math.round(activeSnapY.start),
      end: Math.round(activeSnapY.end),
    })
  }

  return { snappedX, snappedY, lines }
}

/**
 * 拖拽调节尺寸（Resize）时的吸附对齐
 */
export function calculateResizeSnap(
  handle: ResizeHandle,
  rawBox: RectBox,
  targetBoxes: RectBox[],
  zoom: number,
  aspect?: number
): { box: RectBox; lines: SnapLine[] } {
  const threshold = SNAP_THRESHOLD_SCREEN / zoom
  let { x, y, width, height } = rawBox
  const lines: SnapLine[] = []

  let minDiffX = threshold
  let minDiffY = threshold
  let activeSnapX: { pos: number; start: number; end: number } | null = null
  let activeSnapY: { pos: number; start: number; end: number } | null = null

  // 待吸附的边缘坐标
  const left = x
  const right = x + width
  const top = y
  const bottom = y + height

  const checkEast = handle.includes('e')
  const checkWest = handle.includes('w')
  const checkSouth = handle.includes('s')
  const checkNorth = handle.includes('n')

  for (const target of targetBoxes) {
    if (target.id && target.id === rawBox.id) continue

    const targetXPoints = [target.x, target.x + target.width / 2, target.x + target.width]
    const targetYPoints = [target.y, target.y + target.height / 2, target.y + target.height]

    // X 轴（向东拉伸对齐右边缘，向西拉伸对齐左边缘）
    if (checkEast) {
      for (const tp of targetXPoints) {
        const diff = Math.abs(right - tp)
        if (diff < minDiffX) {
          minDiffX = diff
          const newW = Math.max(30, tp - x)
          width = newW
          const startY = Math.min(y, target.y) - 20
          const endY = Math.max(y + height, target.y + target.height) + 20
          activeSnapX = { pos: tp, start: startY, end: endY }
        }
      }
    } else if (checkWest) {
      for (const tp of targetXPoints) {
        const diff = Math.abs(left - tp)
        if (diff < minDiffX) {
          minDiffX = diff
          const newW = Math.max(30, right - tp)
          x = right - newW
          width = newW
          const startY = Math.min(y, target.y) - 20
          const endY = Math.max(y + height, target.y + target.height) + 20
          activeSnapX = { pos: tp, start: startY, end: endY }
        }
      }
    }

    // Y 轴（向南拉伸对齐下边缘，向北拉伸对齐上边缘）
    if (checkSouth) {
      for (const tp of targetYPoints) {
        const diff = Math.abs(bottom - tp)
        if (diff < minDiffY) {
          minDiffY = diff
          const newH = Math.max(30, tp - y)
          height = newH
          const startX = Math.min(x, target.x) - 20
          const endX = Math.max(x + width, target.x + target.width) + 20
          activeSnapY = { pos: tp, start: startX, end: endX }
        }
      }
    } else if (checkNorth) {
      for (const tp of targetYPoints) {
        const diff = Math.abs(top - tp)
        if (diff < minDiffY) {
          minDiffY = diff
          const newH = Math.max(30, bottom - tp)
          y = bottom - newH
          height = newH
          const startX = Math.min(x, target.x) - 20
          const endX = Math.max(x + width, target.x + target.width) + 20
          activeSnapY = { pos: tp, start: startX, end: endX }
        }
      }
    }
  }

  // 若需要等比约束且发生缩放
  if (aspect && aspect > 0) {
    if (checkEast || checkWest) {
      height = Math.round(width / aspect)
    } else if (checkSouth || checkNorth) {
      width = Math.round(height * aspect)
    }
  }

  if (activeSnapX) {
    lines.push({
      id: `resize-v-${Math.round(activeSnapX.pos)}`,
      type: 'vertical',
      pos: Math.round(activeSnapX.pos),
      start: Math.round(activeSnapX.start),
      end: Math.round(activeSnapX.end),
    })
  }

  if (activeSnapY) {
    lines.push({
      id: `resize-h-${Math.round(activeSnapY.pos)}`,
      type: 'horizontal',
      pos: Math.round(activeSnapY.pos),
      start: Math.round(activeSnapY.start),
      end: Math.round(activeSnapY.end),
    })
  }

  return {
    box: { x, y, width, height },
    lines,
  }
}

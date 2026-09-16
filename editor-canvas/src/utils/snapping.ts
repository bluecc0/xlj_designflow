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

const SNAP_THRESHOLD_SCREEN = 6 // 屏幕像素磁吸阈值

/**
 * 计算拖拽过程中的智能磁吸与参考线
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

  // 待拖拽矩形在 X 轴上的关键点：左、中、右
  const dragXPoints = [
    { offset: 0, val: dragBox.x },
    { offset: dragBox.width / 2, val: dragBox.x + dragBox.width / 2 },
    { offset: dragBox.width, val: dragBox.x + dragBox.width },
  ]

  // 待拖拽矩形在 Y 轴上的关键点：上、中、下
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
          const startY = Math.min(dragBox.y, target.y) - 16
          const endY = Math.max(dragBox.y + dragBox.height, target.y + target.height) + 16
          activeSnapX = { pos: tp, start: startY, end: endY }
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
          const startX = Math.min(dragBox.x, target.x) - 16
          const endX = Math.max(dragBox.x + dragBox.width, target.x + target.width) + 16
          activeSnapY = { pos: tp, start: startX, end: endX }
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

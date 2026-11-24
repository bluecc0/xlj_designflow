import type { PendingCanvasImage } from '../components/PendingImagePlaceholder'

export const PENDING_CLEAR_BUFFER_MS = 450
export const RECENT_INSERT_WINDOW_MS = 600

export interface PendingTransitionResult {
  nextItems: PendingCanvasImage[]
  scheduleClear: boolean
  cancelClearTimer: boolean
  resetAnchor: boolean
}

function normalizeUrl(url: string | undefined): string {
  return String(url || '').trim()
}

/**
 * 处理主界面同步的最新 pending 占位列表：
 * - 非空列表：始终以主界面最新列表为准，取消清空缓冲定时器；
 * - 空列表：如果刚刚收到过 insert-image，直接清空；否则延迟缓冲，等待紧随其后的 insert-image 无缝交棒。
 */
export function applyPendingImagesUpdate(
  currentItems: PendingCanvasImage[],
  incomingItems: PendingCanvasImage[],
  nowMs: number,
  lastInsertAtMs: number
): PendingTransitionResult {
  if (incomingItems.length > 0) {
    return {
      nextItems: incomingItems,
      scheduleClear: false,
      cancelClearTimer: true,
      resetAnchor: false,
    }
  }
  const recentlyInserted = lastInsertAtMs > 0 && nowMs - lastInsertAtMs <= RECENT_INSERT_WINDOW_MS
  if (recentlyInserted || currentItems.length === 0) {
    return {
      nextItems: [],
      scheduleClear: false,
      cancelClearTimer: true,
      resetAnchor: true,
    }
  }
  return {
    nextItems: currentItems,
    scheduleClear: true,
    cancelClearTimer: false,
    resetAnchor: false,
  }
}

/**
 * 处理画布收到 designflow:insert-image 时的占位协调：
 * - 仅在主界面已经清空 pending（正处于清空缓冲期）时才整体清空占位；
 * - 仍有其他并发任务在运行（或用户插入无关图片）时，保留其余运行中占位，只移除与本次插入 URL 精确匹配的预览占位，
 *   并重置排布锚点使剩余占位顺延到新图之后。
 */
export function applyInsertImagesToPending(
  currentItems: PendingCanvasImage[],
  insertedUrls: string[],
  hasPendingClearTimer: boolean
): PendingTransitionResult {
  if (hasPendingClearTimer) {
    return {
      nextItems: [],
      scheduleClear: false,
      cancelClearTimer: true,
      resetAnchor: true,
    }
  }
  if (currentItems.length === 0) {
    return {
      nextItems: [],
      scheduleClear: false,
      cancelClearTimer: false,
      resetAnchor: true,
    }
  }
  const urlSet = new Set(insertedUrls.map(normalizeUrl).filter(Boolean))
  const remaining = urlSet.size > 0
    ? currentItems.filter((item) => {
        const preview = normalizeUrl(item.previewUrl)
        return !preview || !urlSet.has(preview)
      })
    : currentItems
  return {
    nextItems: remaining,
    scheduleClear: false,
    cancelClearTimer: false,
    resetAnchor: true,
  }
}

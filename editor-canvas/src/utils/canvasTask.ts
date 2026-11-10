import type { CanvasSource } from '../store/teamStore'

/**
 * 画布内的后台生成任务（AI 换装、切换视角）：结果要放回发起任务时的那份画布。
 */

/** 结果没能放进画布时的说明（任务本身已完成，可在生图记录中找到） */
export const NOT_PLACED_MESSAGE = '画布已切换，结果没有放入当前画布，可在生图记录中查看'

/** 是否同一份画布：同为个人画布，或同一个团队画布 */
export function sameCanvasSource(a: CanvasSource, b: CanvasSource): boolean {
  return a.kind === b.kind && (a.kind === 'personal' || a.id === (b as { id: string }).id)
}

/**
 * 先登记占位任务再提交：提交过程（下载原图、上传、后端识别）可能持续数秒，
 * 期间切换画布的忙碌检查必须能看到这个任务；提交失败时撤掉占位任务，错误照常抛给调用方。
 */
export async function submitWithPlaceholder<T>(register: () => void, release: () => void, submit: () => Promise<T>): Promise<T> {
  register()
  try {
    return await submit()
  } catch (err) {
    release()
    throw err
  }
}

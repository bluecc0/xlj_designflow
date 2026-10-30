import '../../../frontend/src/feedback.js'
import type { FeedbackOptions } from '../../../frontend/src/feedback.js'

export const feedback = window.DesignflowFeedback
export function notifyError(error: unknown, fallback?: string, options?: FeedbackOptions) {
  return window.dfError(error, fallback, options)
}

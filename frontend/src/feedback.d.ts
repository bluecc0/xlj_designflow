export interface FeedbackOptions {
  tone?: 'info' | 'ok' | 'warn' | 'danger'
  key?: string
  persistent?: boolean
  duration?: number
  fallback?: string
}
interface DesignflowFeedbackApi {
  message(error: unknown, fallback?: string): string
  responseError(status: number, body: string): Error & { httpStatus: number; diagnostic: string }
  show(value: unknown, options?: FeedbackOptions): string | undefined
  resolve(key: string): void
  clear(): void
}
declare global {
  interface Window {
    DesignflowFeedback: DesignflowFeedbackApi
    dfError: (error: unknown, fallback?: string, options?: FeedbackOptions) => string | undefined
    dfToast: (message: string, options?: FeedbackOptions) => string | undefined
  }
}
export {}

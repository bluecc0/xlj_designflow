export const IMAGE_RETRY_DELAYS = [1000, 3000, 8000] as const
export const IMAGE_LOAD_TIMEOUT = 30000

export function retryImageUrl(source: string, attempt: number): string {
  if (!attempt || !source.startsWith('/') || source.startsWith('//')) return source
  const url = new URL(source, window.location.origin)
  url.searchParams.set('_canvasRetry', String(attempt))
  return `${url.pathname}${url.search}${url.hash}`
}

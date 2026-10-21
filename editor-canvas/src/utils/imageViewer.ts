export function getOriginalImageViewerUrl(src: string, name?: string): string {
  const params = new URLSearchParams({ src })
  if (name) params.set('name', name)
  return `./image-viewer.html?${params.toString()}`
}

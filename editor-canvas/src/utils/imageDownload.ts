import type { CanvasImage } from '../types'

type DownloadImage = Pick<CanvasImage, 'url' | 'name' | 'meta'>

export function getImageDownloadTarget(image: DownloadImage): { url: string; filename: string } {
  const name = (image.name || 'image').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim() || 'image'
  const exportUrl = image.meta?.specialComposeDownloadUrl
  if (
    image.meta?.specialComposeSourceUrl === image.url &&
    typeof exportUrl === 'string' &&
    /^\/special-compose(?:-full)?\/[^/?#]+\/download-image\/frame_\d+(?:_v\d+)?\.png$/.test(exportUrl)
  ) {
    // The backend chooses PNG/JPG and supplies the actual filename in Content-Disposition.
    return { url: exportUrl, filename: name }
  }

  const namedExtension = name.match(/\.(png|jpe?g|webp|gif|svg|avif)$/i)
  const base = namedExtension ? name.slice(0, -namedExtension[0].length) || 'image' : name
  const urlExtension = image.url.match(/\.(png|jpe?g|webp|gif|svg|avif)(?:[?#]|$)/i)?.[1]
  const mime = image.meta?.mimeType || image.url.match(/^data:([^;,]+)/i)?.[1]
  const mimeExtension: Record<string, string> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
    'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif',
  }
  const extension = (urlExtension || mimeExtension[String(mime).toLowerCase()] || namedExtension?.[1] || 'png').toLowerCase()
  return { url: image.url, filename: `${base}.${extension}` }
}

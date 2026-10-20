import { fetchImageBlob } from './zipDownload'

export function canCopyImageDirectly(): boolean {
  return Boolean(window.isSecureContext && typeof navigator.clipboard?.write === 'function' && typeof ClipboardItem !== 'undefined')
}

async function originalPng(url: string): Promise<Blob> {
  const blob = await fetchImageBlob(url)
  // Keep original PNG bytes, including alpha, rather than render the canvas thumbnail.
  if (blob.type.toLowerCase() === 'image/png') return blob

  const objectUrl = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.src = objectUrl
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (!context || !canvas.width || !canvas.height) throw new Error('无法读取原图')
    context.drawImage(image, 0, 0)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((png) => png ? resolve(png) : reject(new Error('无法转换原图')), 'image/png')
    })
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

/** Call directly in a click handler, before awaiting image downloads. */
export async function copyOriginalImage(url: string): Promise<void> {
  if (!canCopyImageDirectly()) throw new Error('浏览器不支持直接复制图片')
  // A promised PNG preserves the click activation while the full original loads.
  const png = originalPng(url)
  // Also consume a download rejection if clipboard permissions fail first.
  void png.catch(() => {})
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
}

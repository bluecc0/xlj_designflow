export interface LoadedImageItem {
  url: string
  name: string
  naturalWidth?: number
  naturalHeight?: number
  width?: number
  height?: number
  fileSize?: number
  mimeType?: string
}

const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

async function uploadEditorAsset(file: File): Promise<string> {
  const form = new FormData()
  form.append('image', file, file.name)
  const response = await fetch('/editor/assets', { method: 'POST', body: form })
  if (!response.ok) {
    let message = `图片上传失败 (${response.status})`
    try {
      const body = await response.json()
      message = body?.detail || message
    } catch {}
    throw new Error(message)
  }
  const body = await response.json()
  if (!body?.url) throw new Error('图片上传成功，但服务端未返回地址')
  return String(body.url)
}

function probeImage(file: File): Promise<{ width?: number; height?: number }> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file)
    const img = new Image()
    const finish = (dimensions: { width?: number; height?: number }) => {
      URL.revokeObjectURL(objectUrl)
      resolve(dimensions)
    }
    img.onload = () => finish({
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
    })
    img.onerror = () => finish({})
    img.src = objectUrl
  })
}

/** Persist local files first so snapshots only contain stable same-origin URLs. */
export async function loadImagesFromFiles(files: FileList | File[]): Promise<LoadedImageItem[]> {
  const fileArray = Array.from(files)
  const imageFiles = fileArray.filter((f) => {
    if (SUPPORTED_IMAGE_TYPES.has(f.type.toLowerCase())) return true
    return !f.type && /\.(png|jpe?g|webp|gif)$/i.test(f.name)
  })

  if (imageFiles.length === 0) return []

  const promises = imageFiles.map(async (file): Promise<LoadedImageItem | null> => {
    try {
      const [url, dimensions] = await Promise.all([uploadEditorAsset(file), probeImage(file)])
      return {
        url,
        name: file.name.replace(/\.[^/.]+$/, ''),
        naturalWidth: dimensions.width,
        naturalHeight: dimensions.height,
        width: dimensions.width,
        height: dimensions.height,
        fileSize: file.size,
        mimeType: file.type,
      }
    } catch (error) {
      console.warn(`[Canvas] ${file.name} 上传失败:`, error)
      return null
    }
  })

  const results = await Promise.all(promises)
  return results.filter((it): it is LoadedImageItem => it !== null && Boolean(it.url))
}

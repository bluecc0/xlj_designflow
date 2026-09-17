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

/**
 * 异步批量读取一组 File 对象（单图或多图），获取 DataURL 并探测天然物理尺寸
 */
export async function loadImagesFromFiles(files: FileList | File[]): Promise<LoadedImageItem[]> {
  const fileArray = Array.from(files)
  const imageFiles = fileArray.filter((f) => {
    if (f.type && f.type.startsWith('image/')) return true
    return /\.(png|jpe?g|webp|gif|svg|bmp|avif)$/i.test(f.name)
  })

  if (imageFiles.length === 0) return []

  const promises = imageFiles.map((file) => {
    return new Promise<LoadedImageItem | null>((resolve) => {
      const reader = new FileReader()
      reader.onload = (evt) => {
        const dataUrl = evt.target?.result as string
        if (!dataUrl) {
          resolve(null)
          return
        }
        const img = new Image()
        img.onload = () => {
          const nw = img.naturalWidth || img.width
          const nh = img.naturalHeight || img.height
          resolve({
            url: dataUrl,
            name: file.name.replace(/\.[^/.]+$/, ''),
            naturalWidth: nw,
            naturalHeight: nh,
            width: nw,
            height: nh,
            fileSize: file.size,
            mimeType: file.type,
          })
        }
        img.onerror = () => {
          resolve({
            url: dataUrl,
            name: file.name.replace(/\.[^/.]+$/, ''),
            fileSize: file.size,
            mimeType: file.type,
          })
        }
        img.src = dataUrl
      }
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(file)
    })
  })

  const results = await Promise.all(promises)
  return results.filter((it): it is LoadedImageItem => it !== null && Boolean(it.url))
}

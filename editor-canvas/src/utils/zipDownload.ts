import JSZip from 'jszip'

export interface DownloadImageTarget {
  url: string
  name?: string
}

export interface ZipDownloadOptions {
  zipName?: string
  onProgress?: (current: number, total: number) => void
}

/**
 * 根据 Blob MIME 类型或 URL 猜测图片文件扩展名
 */
function guessExtension(blob: Blob, url: string): string {
  const mime = blob.type.toLowerCase()
  if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg'
  if (mime.includes('webp')) return '.webp'
  if (mime.includes('svg')) return '.svg'
  if (mime.includes('gif')) return '.gif'
  if (mime.includes('png')) return '.png'

  const urlMatch = url.match(/\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i)
  if (urlMatch) {
    return '.' + urlMatch[1].toLowerCase()
  }

  return '.png'
}

/**
 * 清理文件名并去除可能重复的多余后缀
 */
function sanitizeBaseName(rawName: string): { base: string; ext?: string } {
  let name = (rawName || 'image').replace(/[\\/:*?"<>|]/g, '_').trim()
  if (!name) name = 'image'

  const extMatch = name.match(/^(.*?)\.(png|jpe?g|webp|gif|svg)$/i)
  if (extMatch) {
    return {
      base: extMatch[1] || 'image',
      ext: '.' + extMatch[2].toLowerCase(),
    }
  }

  return { base: name }
}

/**
 * 将图片 URL（支持 DataURL、Blob URL、相对/绝对 URL）转为 Blob
 */
export async function fetchImageBlob(url: string): Promise<Blob> {
  // 1. 尝试直接 fetch
  try {
    const res = await fetch(url)
    if (res.ok) {
      return await res.blob()
    }
  } catch {
    // ignore, 准备通过 Canvas 兜底
  }

  // 2. 通过 Image 与 Canvas 兜底转换（处理潜在的跨域资源）
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth || img.width
        canvas.height = img.naturalHeight || img.height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('无法创建 Canvas 2D 上下文'))
          return
        }
        ctx.drawImage(img, 0, 0)
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob)
          } else {
            reject(new Error('Canvas 转换 Blob 失败'))
          }
        }, 'image/png')
      } catch (err) {
        reject(err)
      }
    }
    img.onerror = () => reject(new Error(`加载图片资源失败: ${url.slice(0, 60)}`))
    img.src = url
  })
}

/**
 * 批量下载多张图片并打包为 zip 文件
 */
export async function downloadImagesAsZip(
  images: DownloadImageTarget[],
  options?: ZipDownloadOptions
): Promise<void> {
  if (!images || images.length === 0) return

  const zip = new JSZip()
  const nameCounts = new Map<string, number>()
  const total = images.length

  for (let i = 0; i < images.length; i++) {
    const item = images[i]
    if (options?.onProgress) {
      options.onProgress(i + 1, total)
    }

    try {
      const blob = await fetchImageBlob(item.url)
      const { base, ext: presetExt } = sanitizeBaseName(item.name || `image_${i + 1}`)
      const ext = presetExt || guessExtension(blob, item.url)

      // 文件名去重处理
      let filename = `${base}${ext}`
      const count = nameCounts.get(filename) || 0
      if (count > 0) {
        filename = `${base} (${count})${ext}`
        nameCounts.set(`${base}${ext}`, count + 1)
      } else {
        nameCounts.set(filename, 1)
      }

      zip.file(filename, blob)
    } catch (err) {
      console.error(`[zipDownload] 图片打包失败，跳过第 ${i + 1} 张:`, item, err)
    }
  }

  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })

  // 生成打包文件名，如 xlj_studio-images-2026-09-17-1045.zip
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10)
  const timeStr = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
  const defaultZipName = `xlj_studio-images-${dateStr}-${timeStr}.zip`

  const downloadUrl = URL.createObjectURL(zipBlob)
  const a = document.createElement('a')
  a.href = downloadUrl
  a.download = options?.zipName || defaultZipName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)

  setTimeout(() => {
    URL.revokeObjectURL(downloadUrl)
  }, 2000)
}

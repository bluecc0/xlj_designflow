import type { OutpaintMargins } from '../types'

export function normalizeAssetUrl(rawUrl: string): string {
  if (!rawUrl) return ''
  if (rawUrl.startsWith('data:') || rawUrl.startsWith('blob:')) return rawUrl
  if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) return rawUrl
  if (rawUrl.startsWith('/')) return rawUrl
  return `/${rawUrl}`
}

export function getImageDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height })
    }
    img.onerror = () => {
      reject(new Error('无法读取图片尺寸'))
    }
    img.src = url
  })
}

/**
 * 轮询任务状态通用函数
 */
export async function pollJob(
  jobId: string,
  timeoutSeconds = 300,
  onProgress?: (message: string, progress?: number) => void
): Promise<any> {
  const start = Date.now()
  while (Date.now() - start < timeoutSeconds * 1000) {
    await new Promise((res) => setTimeout(res, 1000))
    const resp = await fetch(`/ai-image/${encodeURIComponent(jobId)}`, {
      credentials: 'include',
    })
    if (!resp.ok) {
      throw new Error(`查询任务状态失败 (HTTP ${resp.status})`)
    }
    const data = await resp.json()
    if (data.status === 'done') {
      return data
    }
    if (data.status === 'failed') {
      throw new Error(data.error || '任务处理失败')
    }
    if (onProgress && data.message) {
      onProgress(data.message, data.progress)
    }
  }
  throw new Error('任务超时，请稍后重试')
}

/**
 * 智能抠图
 */
export async function runMatting(
  imageUrl: string,
  onProgress?: (msg: string) => void
): Promise<{ imageUrl: string; width: number; height: number }> {
  onProgress?.('正在提交智能抠图...')
  const resp = await fetch('/ai-image/matting', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl }),
  })
  if (!resp.ok) {
    const txt = await resp.text()
    throw new Error(txt || `HTTP ${resp.status}`)
  }
  const { job_id } = await resp.json()
  if (!job_id) throw new Error('没有返回任务 ID')

  onProgress?.('正在抠除背景...')
  const result = await pollJob(job_id, 180, onProgress)
  const finalUrl = normalizeAssetUrl(result.image_url)
  const dims = await getImageDimensions(finalUrl)
  return { imageUrl: finalUrl, ...dims }
}

/**
 * 2x 高清放大
 */
export async function runUpscale(
  imageUrl: string,
  scale = 2,
  onProgress?: (msg: string) => void
): Promise<{ imageUrl: string; width: number; height: number }> {
  onProgress?.('正在提交高清放大...')
  const resp = await fetch('/ai-image/upscale', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl, scale }),
  })
  if (!resp.ok) {
    const txt = await resp.text()
    throw new Error(txt || `HTTP ${resp.status}`)
  }
  const { job_id } = await resp.json()
  if (!job_id) throw new Error('没有返回任务 ID')

  onProgress?.('正在生成超分辨率高清图...')
  const result = await pollJob(job_id, 240, onProgress)
  const finalUrl = normalizeAssetUrl(result.image_url)
  const dims = await getImageDimensions(finalUrl)
  return { imageUrl: finalUrl, ...dims }
}

/**
 * 转矢量 SVG
 */
export async function runVectorize(
  imageUrl: string,
  onProgress?: (msg: string) => void
): Promise<{ imageUrl: string; svgUrl: string; width: number; height: number }> {
  onProgress?.('正在提交矢量化...')
  const resp = await fetch('/ai-image/vectorize', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl }),
  })
  if (!resp.ok) {
    const txt = await resp.text()
    throw new Error(txt || `HTTP ${resp.status}`)
  }
  const { job_id } = await resp.json()
  if (!job_id) throw new Error('没有返回任务 ID')

  onProgress?.('正在矢量化提取轮廓...')
  const result = await pollJob(job_id, 180, onProgress)
  const finalUrl = normalizeAssetUrl(result.image_url || result.svg_url)
  const dims = await getImageDimensions(finalUrl)
  return { imageUrl: finalUrl, svgUrl: finalUrl, ...dims }
}

/**
 * 智能扩图 (FLUX Outpainting)
 */
export async function runOutpainting(
  imageUrl: string,
  processingWidth: number,
  processingHeight: number,
  margins: OutpaintMargins,
  onProgress?: (msg: string, progress?: number) => void
): Promise<{ imageUrl: string; width: number; height: number }> {
  onProgress?.('正在提交扩图任务...')
  const resp = await fetch('/ai-image/outpainting', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: imageUrl,
      processing_width: processingWidth,
      processing_height: processingHeight,
      outpaint: margins,
    }),
  })
  if (!resp.ok) {
    const txt = await resp.text()
    throw new Error(txt || `HTTP ${resp.status}`)
  }
  const { job_id } = await resp.json()
  if (!job_id) throw new Error('没有返回任务 ID')

  onProgress?.('FLUX 正在扩散扩图...')
  const result = await pollJob(job_id, 300, onProgress)
  const finalUrl = normalizeAssetUrl(result.image_url)
  const dims = await getImageDimensions(finalUrl)
  return { imageUrl: finalUrl, ...dims }
}

/**
 * 分层 PSD 提取
 */
export async function runLayerExtract(
  imageUrl: string,
  onProgress?: (msg: string) => void
): Promise<{ psdUrl: string; layers?: Array<{ url: string; x: number; y: number; width: number; height: number }> }> {
  onProgress?.('正在提交图层分离任务...')
  const resp = await fetch('/ai-image/layer-extract', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl }),
  })
  if (!resp.ok) {
    const txt = await resp.text()
    throw new Error(txt || `HTTP ${resp.status}`)
  }
  const { job_id } = await resp.json()
  if (!job_id) throw new Error('没有返回任务 ID')

  onProgress?.('正在分解 PSD 图层...')
  const result = await pollJob(job_id, 300, onProgress)
  return {
    psdUrl: normalizeAssetUrl(result.psd_url || result.image_url),
    layers: result.layers,
  }
}

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

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
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
  const clientRequestId = generateUUID()
  onProgress?.('正在提交扩图任务...')
  const resp = await fetch('/ai-image/outpainting', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Request-Id': clientRequestId,
    },
    body: JSON.stringify({
      image_url: imageUrl,
      processing_width: processingWidth,
      processing_height: processingHeight,
      outpaint: margins,
      client_request_id: clientRequestId,
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
): Promise<{
  psdUrl: string
  layers?: Array<{ url: string; x: number; y: number; width: number; height: number; name?: string }>
}> {
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
  const extract = (result && typeof result.layer_extract === 'object' && result.layer_extract) || {}
  const psdUrl = normalizeAssetUrl(extract.psd_url || result.psd_url || result.image_url || '')
  const prefix = String(extract.layers_url_prefix || '').replace(/\/+$/, '')

  const rawLayers: any[] = Array.isArray(extract.layers)
    ? extract.layers
    : Array.isArray(result.layers)
    ? result.layers
    : []

  const formattedLayers = rawLayers
    .map((l: any) => {
      if (!l || typeof l !== 'object') return null
      let url = String(l.url || '').trim()
      if (!url && l.path && prefix) {
        url = `${prefix}/${String(l.path).replace(/^\/+/, '')}`
      }
      if (!url) return null
      return {
        url: normalizeAssetUrl(url),
        x: Number(l.x) || 0,
        y: Number(l.y) || 0,
        width: Number(l.width) || 0,
        height: Number(l.height) || 0,
        name: typeof l.name === 'string' ? l.name : undefined,
      }
    })
    .filter(Boolean) as Array<{ url: string; x: number; y: number; width: number; height: number; name?: string }>

  return {
    psdUrl,
    layers: formattedLayers,
  }
}

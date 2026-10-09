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

export interface ImageMetadataResponse {
  url: string
  fileName?: string
  fileSize?: number | null
  fileSizeFormatted?: string
  mimeType?: string
  isAiGenerated: boolean
  aiMetadata?: {
    jobId?: string
    clientRequestId?: string
    prompt?: string
    originalPrompt?: string
    resolvedPrompt?: string
    promptTrace?: string
    model?: string
    provider?: string
    size?: string
    resolution?: string
    variant?: string
    quality?: string
    skill?: string
    hasReference?: boolean
    referenceCount?: number
    referenceImages?: Array<{
      type?: string
      name?: string
      url: string
      label?: string
    }>
    createdAt?: number
    requestMeta?: Record<string, any>
  } | null
}

/**
 * 获取图片详细元数据及 AI 生图 Prompt 信息
 */
export async function fetchImageMetadata(imageUrl: string): Promise<ImageMetadataResponse | null> {
  const normalized = normalizeAssetUrl(imageUrl)
  if (!normalized) return null

  try {
    const resp = await fetch(`/ai-image/metadata?url=${encodeURIComponent(normalized)}`, {
      credentials: 'include',
    })
    if (resp.ok) {
      const data = await resp.json()
      return {
        url: data.url || normalized,
        fileName: data.file_name,
        fileSize: data.file_size,
        fileSizeFormatted: data.file_size_formatted,
        mimeType: data.mime_type,
        isAiGenerated: Boolean(data.is_ai_generated),
        aiMetadata: data.ai_metadata
          ? {
              jobId: data.ai_metadata.job_id,
              clientRequestId: data.ai_metadata.client_request_id,
              prompt: data.ai_metadata.prompt,
              originalPrompt: data.ai_metadata.original_prompt,
              resolvedPrompt: data.ai_metadata.resolved_prompt,
              promptTrace: data.ai_metadata.prompt_trace,
              model: data.ai_metadata.model,
              provider: data.ai_metadata.provider,
              size: data.ai_metadata.size,
              resolution: data.ai_metadata.resolution,
              variant: data.ai_metadata.variant,
              quality: data.ai_metadata.quality,
              skill: data.ai_metadata.skill,
              hasReference: Boolean(data.ai_metadata.has_reference),
              referenceCount: data.ai_metadata.reference_count || 0,
              referenceImages: Array.isArray(data.ai_metadata.reference_images)
                ? data.ai_metadata.reference_images
                : [],
              createdAt: data.ai_metadata.created_at,
              requestMeta: data.ai_metadata.request_meta,
            }
          : null,
      }
    }
  } catch (e) {
    // 忽略异常，降级通过 HEAD 请求探测
  }

  // 降级：通过 HEAD 请求探测文件大小
  try {
    const headResp = await fetch(normalized, { method: 'HEAD' })
    const lenHeader = headResp.headers.get('content-length')
    const mime = headResp.headers.get('content-type') || ''
    const size = lenHeader ? parseInt(lenHeader, 10) : null
    let sizeFormatted = ''
    if (size !== null && !isNaN(size)) {
      if (size < 1024) sizeFormatted = `${size} B`
      else if (size < 1024 * 1024) sizeFormatted = `${(size / 1024).toFixed(1)} KB`
      else sizeFormatted = `${(size / (1024 * 1024)).toFixed(2)} MB`
    }
    return {
      url: normalized,
      fileSize: size,
      fileSizeFormatted: sizeFormatted,
      mimeType: mime,
      isAiGenerated: false,
      aiMetadata: null,
    }
  } catch (e) {
    return null
  }
}

/**
 * 快捷编辑生图（模型 gpt-image-2.5，默认智能路由 auto，单参考图）
 */
export async function runQuickEdit(
  imageUrl: string,
  prompt: string,
  onProgress?: (msg: string, progress?: number) => void
): Promise<{ imageUrl: string; width: number; height: number }> {
  const cleanPrompt = (prompt || '').trim()
  if (!cleanPrompt) throw new Error('提示词不能为空')

  const normalized = normalizeAssetUrl(imageUrl)
  onProgress?.('正在准备参考图...')
  const imgResp = await fetch(normalized, { credentials: 'include' })
  if (!imgResp.ok) throw new Error(`无法获取参考图 (HTTP ${imgResp.status})`)
  const blob = await imgResp.blob()
  const ext = blob.type && blob.type.includes('/') ? blob.type.split('/')[1] : 'png'
  const file = new File([blob], `reference.${ext}`, { type: blob.type || 'image/png' })

  const clientRequestId = generateUUID()
  const fd = new FormData()
  fd.append('model', 'gpt-image-2.5')
  fd.append('provider', 'auto')
  fd.append('prompt', cleanPrompt)
  fd.append('size', 'auto')
  fd.append('resolution', '1K')
  fd.append('variant', 'flare')
  fd.append('quality', 'auto')
  fd.append('batch_count', '1')
  fd.append('client_request_id', clientRequestId)
  fd.append('image', file)

  onProgress?.('正在提交 gpt-image-2.5 任务...')
  const resp = await fetch('/ai-image', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'X-Client-Request-Id': clientRequestId,
    },
    body: fd,
  })

  if (!resp.ok) {
    const txt = await resp.text()
    throw new Error(txt || `HTTP ${resp.status}`)
  }

  const data = await resp.json()
  const jobId = data.job_id || (Array.isArray(data.job_ids) ? data.job_ids[0] : null)
  if (!jobId) throw new Error('没有返回任务编号')

  onProgress?.('gpt-image-2.5 正在生图...')
  const result = await pollJob(jobId, 300, onProgress)
  const finalUrl = normalizeAssetUrl(result.image_url)
  const dims = await getImageDimensions(finalUrl)
  return { imageUrl: finalUrl, ...dims }
}


// ─── AI 换装 ────────────────────────────────────────────────────────────────

const UPLOADABLE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const MAX_UPLOAD_BYTES = 18 * 1024 * 1024

async function readErrorMessage(resp: Response): Promise<string> {
  const txt = await resp.text()
  try {
    const data = JSON.parse(txt)
    const detail = data?.detail
    if (typeof detail === 'string') return detail
    if (detail && typeof detail === 'object') return detail.message || detail.error || txt
    return data?.message || txt
  } catch {
    return txt || `HTTP ${resp.status}`
  }
}

/**
 * 把画布图片转为可上传的 File：SVG/GIF 等格式或体积过大时经 canvas 栅格化为 PNG。
 */
export async function loadImageAsUploadFile(rawUrl: string, baseName = 'image'): Promise<File> {
  const url = normalizeAssetUrl(rawUrl)
  const resp = await fetch(url, { credentials: 'include' })
  if (!resp.ok) throw new Error(`无法读取图片 (HTTP ${resp.status})`)
  const blob = await resp.blob()
  const type = (blob.type || '').split(';')[0].trim()
  if (UPLOADABLE_IMAGE_TYPES.has(type) && blob.size <= MAX_UPLOAD_BYTES) {
    const ext = type.split('/')[1] === 'jpeg' ? 'jpg' : type.split('/')[1]
    return new File([blob], `${baseName}.${ext}`, { type })
  }

  const objectUrl = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('图片格式无法识别'))
      el.src = objectUrl
    })
    const natW = img.naturalWidth || img.width || 1024
    const natH = img.naturalHeight || img.height || 1024
    const scale = Math.min(1, 3072 / Math.max(natW, natH))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(natW * scale))
    canvas.height = Math.max(1, Math.round(natH * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('浏览器不支持图片转换')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!png) throw new Error('图片转换失败')
    return new File([png], `${baseName}.png`, { type: 'image/png' })
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export interface OutfitGarment {
  id: string
  slot: string
  slot_label: string
  name: string
  color?: string
  material?: string
  details?: string
  position?: string
}

export interface OutfitAnalysis {
  image_type: 'model' | 'mannequin' | 'product' | 'flatlay' | 'other'
  image_type_label: string
  summary: string
  subject: { gender?: string; pose?: string; framing?: string; view?: string }
  garments: OutfitGarment[]
  background?: string
  lighting?: string
  cached?: boolean
  elapsed_ms?: number
}

export interface OutfitAsset {
  id: string
  sku: string
  asset_type: string
  type_label: string
  folder: string
  path: string
  filename: string
  angle: string
  url: string
  thumb_url: string
}

export interface OutfitAssetSearchResult {
  library_exists: boolean
  max_references: number
  truncated?: boolean
  items: { sku: string; found: boolean; assets: OutfitAsset[] }[]
}

// 同一张图在一次会话内只分析一次（按图片 URL 缓存）
const outfitAnalysisCache = new Map<string, Promise<OutfitAnalysis>>()

/**
 * VLM 快速分析图片中的人物/商品与服饰
 */
export function analyzeOutfit(imageUrl: string): Promise<OutfitAnalysis> {
  const key = normalizeAssetUrl(imageUrl)
  const cached = outfitAnalysisCache.get(key)
  if (cached) return cached
  const task = (async () => {
    const file = await loadImageAsUploadFile(key, 'analyze')
    const fd = new FormData()
    fd.append('image', file)
    const resp = await fetch('/ai-image/outfit-analyze', {
      method: 'POST',
      credentials: 'include',
      body: fd,
    })
    if (!resp.ok) throw new Error(await readErrorMessage(resp))
    return (await resp.json()) as OutfitAnalysis
  })()
  outfitAnalysisCache.set(key, task)
  // 失败不缓存，允许重试
  task.catch(() => outfitAnalysisCache.delete(key))
  return task
}

/**
 * 按 SKU 检索素材库多角度素材
 */
export async function searchOutfitAssets(skus: string[]): Promise<OutfitAssetSearchResult> {
  const resp = await fetch(`/products/outfit-assets?sku=${encodeURIComponent(skus.join(','))}`, {
    credentials: 'include',
  })
  if (!resp.ok) throw new Error(await readErrorMessage(resp))
  return resp.json()
}

export interface OutfitChangeRequest {
  sourceUrl: string
  sourceName?: string
  assets: OutfitAsset[]
  uploads: File[]
  analysis: OutfitAnalysis | null
  targetGarmentIds: string[]
  extraPrompt: string
  model: 'gpt-image-2.5' | 'nano-banana-pro'
  resolution: '1K' | '2K'
  batchCount: number
}

/**
 * 提交 AI 换装任务（原图 + 勾选素材，参考图生图模式，后端内置 prompt）
 */
export async function submitOutfitChange(
  req: OutfitChangeRequest
): Promise<{ jobIds: string[]; resolvedPrompt: string; model: string; size: string }> {
  const sourceFile = await loadImageAsUploadFile(req.sourceUrl, 'source')
  const clientRequestId = generateUUID()
  const fd = new FormData()
  fd.append('image', sourceFile)
  fd.append(
    'assets',
    JSON.stringify(
      req.assets.map((a) => ({ sku: a.sku, asset_type: a.asset_type, path: a.path, angle: a.angle }))
    )
  )
  req.uploads.forEach((file) => fd.append('uploads', file))
  if (req.analysis) fd.append('analysis', JSON.stringify(req.analysis))
  fd.append('target_garments', JSON.stringify(req.targetGarmentIds))
  fd.append('extra_prompt', req.extraPrompt || '')
  fd.append('model', req.model)
  fd.append('resolution', req.resolution)
  fd.append('batch_count', String(req.batchCount))
  fd.append('source_name', req.sourceName || '')
  fd.append('client_request_id', clientRequestId)

  const resp = await fetch('/ai-image/outfit-change', {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-Client-Request-Id': clientRequestId },
    body: fd,
  })
  if (!resp.ok) throw new Error(await readErrorMessage(resp))
  const data = await resp.json()
  const jobIds: string[] = Array.isArray(data.job_ids) ? data.job_ids : data.job_id ? [data.job_id] : []
  if (jobIds.length === 0) throw new Error('没有返回任务编号')
  return { jobIds, resolvedPrompt: data.resolved_prompt || '', model: data.model || req.model, size: data.size || '' }
}

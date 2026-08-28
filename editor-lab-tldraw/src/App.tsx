import React from 'react'
import {
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultFillStyle,
  DefaultFontStyle,
  DefaultHorizontalAlignStyle,
  DefaultSizeStyle,
  DefaultTextAlignStyle,
  DefaultVerticalAlignStyle,
  AssetRecordType,
  Box,
  Tldraw,
  createShapeId,
  iconTypes,
  toRichText,
  type Editor,
  type TLComponents,
  type TLAssetStore,
  type TLGeoShape,
  type TLImageAsset,
  type TLImageShape,
  type TLShape,
  type TLTextShape,
  TldrawUiContextualToolbar,
  useEditor,
  useValue,
} from 'tldraw'

const editorUserId = new URLSearchParams(window.location.search).get('user_id') || ''
const editorSnapshotUrl = `/editor/snapshot?user_id=${encodeURIComponent(editorUserId)}`

type PendingLayerExtractJob = {
  jobId: string
  sourceUrl: string
  createdAt: number
}

const layerExtractStorageKey = `designflow:layer-extract-jobs:${editorUserId || 'anonymous'}`

function readPendingLayerExtractJobs(): PendingLayerExtractJob[] {
  try {
    const raw = window.localStorage.getItem(layerExtractStorageKey)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item) => item && typeof item.jobId === 'string' && typeof item.sourceUrl === 'string')
      .slice(-12)
  } catch {
    return []
  }
}

function writePendingLayerExtractJobs(jobs: PendingLayerExtractJob[]) {
  try {
    if (jobs.length) {
      window.localStorage.setItem(layerExtractStorageKey, JSON.stringify(jobs.slice(-12)))
    } else {
      window.localStorage.removeItem(layerExtractStorageKey)
    }
  } catch {}
}

function rememberPendingLayerExtractJob(job: PendingLayerExtractJob) {
  const jobs = readPendingLayerExtractJobs().filter((item) => item.jobId !== job.jobId)
  jobs.push(job)
  writePendingLayerExtractJobs(jobs)
}

function forgetPendingLayerExtractJob(jobId: string) {
  writePendingLayerExtractJobs(readPendingLayerExtractJobs().filter((item) => item.jobId !== jobId))
}

async function fetchLayerExtractJobStatus(jobId: string) {
  const response = await fetch(`/ai-image/${encodeURIComponent(jobId)}`, { credentials: 'include' })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `HTTP ${response.status}`)
  }
  return await response.json()
}

async function pollLayerExtractJobStatus(jobId: string) {
  for (let i = 0; i < 600; i++) {
    await new Promise((resolve) => window.setTimeout(resolve, 1000))
    const result = await fetchLayerExtractJobStatus(jobId)
    if (result.status === 'done' || result.status === 'failed') return result
  }
  throw new Error('分层 PSD 超时（超过 10 分钟）')
}

async function fetchImageAsFileWithRetry(url: string, name: string, retries = 2) {
  let lastError: unknown = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchImageAsFile(url, name, { timeoutMs: 15000 })
    } catch (error) {
      lastError = error
      if (attempt < retries) {
        await new Promise((resolve) => window.setTimeout(resolve, 400 * (attempt + 1)))
      }
    }
  }
  throw lastError || new Error('图层下载失败')
}

function triggerLayerExtractPsdDownload(psdUrl: string) {
  if (!psdUrl) return
  const link = document.createElement('a')
  link.href = psdUrl
  link.download = 'layered.psd'
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

async function uploadEditorAsset(file: File, abortSignal?: AbortSignal) {
  const form = new FormData()
  form.append('image', file, file.name || 'canvas-image')
  const response = await fetch('/editor/assets', {
    method: 'POST',
    body: form,
    credentials: 'include',
    signal: abortSignal,
  })
  if (!response.ok) {
    let message = `画板图片保存失败: HTTP ${response.status}`
    try {
      const data = await response.json()
      if (data?.detail) message = String(data.detail)
    } catch {}
    throw new Error(message)
  }
  const data = await response.json()
  if (!data?.url) throw new Error('画板图片保存失败：服务端未返回地址')
  return String(data.url)
}

const editorAssetStore: TLAssetStore = {
  async upload(_asset, file, abortSignal) {
    return { src: await uploadEditorAsset(file, abortSignal) }
  },
  resolve(asset) {
    return String((asset.props as any)?.src || '')
  },
}

async function dataUrlToImageFile(src: string, name: string, mimeType: string) {
  const response = await fetch(src)
  const blob = await response.blob()
  const type = blob.type || mimeType || 'image/png'
  const extension = type === 'image/jpeg' ? '.jpg' : `.${type.split('/')[1] || 'png'}`
  const filename = name && name.includes('.') ? name : `${name || 'canvas-image'}${extension}`
  return new File([blob], filename, { type })
}

async function compactAndPersistEditorAssets(editor: Editor) {
  const snapshot = editor.getSnapshot() as any
  const store = snapshot.store || snapshot.document?.store
  if (!store || typeof store !== 'object') return { changed: false, failed: 0 }

  const referencedAssetIds = new Set(
    Object.values(store)
      .filter((record: any) => record?.typeName === 'shape' && record?.props?.assetId)
      .map((record: any) => String(record.props.assetId))
  )
  const imageAssets = editor.getAssets().filter((asset: any) => asset?.type === 'image')
  const orphanAssets = imageAssets.filter((asset: any) => !referencedAssetIds.has(String(asset.id)))
  if (orphanAssets.length) editor.deleteAssets(orphanAssets.map((asset: any) => asset.id))

  let migrated = 0
  let failed = 0
  const embeddedAssets = imageAssets.filter((asset: any) => {
    const src = String(asset?.props?.src || '')
    return referencedAssetIds.has(String(asset.id)) && src.startsWith('data:image/')
  })
  for (const asset of embeddedAssets) {
    try {
      const file = await dataUrlToImageFile(
        String((asset.props as any).src),
        String((asset.props as any).name || 'canvas-image'),
        String((asset.props as any).mimeType || '')
      )
      const src = await uploadEditorAsset(file)
      editor.updateAssets([{
        ...asset,
        props: {
          ...asset.props,
          src,
          fileSize: file.size,
          mimeType: file.type || (asset.props as any).mimeType,
        },
      } as any])
      migrated += 1
    } catch (error) {
      failed += 1
      console.error('Failed to persist embedded canvas asset', error)
    }
  }
  return { changed: orphanAssets.length > 0 || migrated > 0, failed }
}

const COLOR_OPTIONS = [
  { value: 'black', label: '黑色' },
  { value: 'grey', label: '灰色' },
  { value: 'blue', label: '蓝色' },
  { value: 'green', label: '绿色' },
  { value: 'orange', label: '橙色' },
  { value: 'red', label: '红色' },
  { value: 'violet', label: '紫色' },
] as const

const TEXT_SIZE_OPTIONS = [
  { value: 's', label: '小' },
  { value: 'm', label: '中' },
  { value: 'l', label: '大' },
  { value: 'xl', label: '超大' },
] as const

const FONT_OPTIONS = [
  { value: 'sans', label: '无衬线' },
  { value: 'serif', label: '衬线' },
  { value: 'mono', label: '等宽' },
  { value: 'draw', label: '手绘' },
] as const

const TEXT_ALIGN_OPTIONS = [
  { value: 'start', label: '左对齐' },
  { value: 'middle', label: '居中' },
  { value: 'end', label: '右对齐' },
] as const

const FILL_OPTIONS = [
  { value: 'none', label: '无填充' },
  { value: 'semi', label: '柔和' },
  { value: 'solid', label: '纯色' },
] as const

const DASH_OPTIONS = [
  { value: 'draw', label: '手绘' },
  { value: 'solid', label: '实线' },
  { value: 'dashed', label: '虚线' },
  { value: 'dotted', label: '点线' },
] as const

const BOX_ALIGN_OPTIONS = [
  { value: 'start', label: '左对齐' },
  { value: 'middle', label: '居中' },
  { value: 'end', label: '右对齐' },
] as const

const VERTICAL_ALIGN_OPTIONS = [
  { value: 'start', label: '顶部' },
  { value: 'middle', label: '居中' },
  { value: 'end', label: '底部' },
] as const

function isTextShape(shape: TLShape | null): shape is TLTextShape {
  return !!shape && shape.type === 'text'
}

function isGeoShape(shape: TLShape | null): shape is TLGeoShape {
  return !!shape && shape.type === 'geo'
}

function PropertySelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: readonly { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <label className="lab-field">
      <span className="lab-field-label">{label}</span>
      <select className="lab-select" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function formatUpscaleError(error: any) {
  const raw = String(error?.message || error || '高清放大失败').trim()
  if (!raw) return '高清放大失败'
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.detail) return String(parsed.detail)
  } catch {}
  return raw.replace(/^\{\"detail\":\"?|\"?\}$/g, '').slice(0, 32)
}

async function blobUrlToDataUrl(url: string): Promise<string> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Failed to read local image: HTTP ${resp.status}`)
  const blob = await resp.blob()
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Failed to read local image'))
    reader.readAsDataURL(blob)
  })
}

async function resolveUpscaleSourceUrl(rawUrl: string) {
  const normalized = normalizeDesignflowAssetUrl(rawUrl)
  if (!normalized) return ''
  if (normalized.startsWith('/')) return normalized
  if (normalized.startsWith('data:image/')) return normalized
  if (normalized.startsWith('blob:')) return await blobUrlToDataUrl(normalized)
  try {
    const parsed = new URL(normalized, window.location.origin)
    if (parsed.origin === window.location.origin) {
      return parsed.pathname + parsed.search + parsed.hash
    }
  } catch {}
  return normalized
}

function useUpscaleSelectedImage() {
  const editor = useEditor()
  const [upscaleState, setUpscaleState] = React.useState<{ loading: boolean; status: 'idle' | 'done' | 'error'; message: string }>({ loading: false, status: 'idle', message: '' })
  const clearTimerRef = React.useRef<number | null>(null)

  const setTemporaryState = React.useCallback((status: 'done' | 'error', message: string, delay = 2600) => {
    if (clearTimerRef.current) {
      window.clearTimeout(clearTimerRef.current)
    }
    setUpscaleState({ loading: false, status, message })
    clearTimerRef.current = window.setTimeout(() => {
      setUpscaleState((prev) => (prev.loading ? prev : { loading: false, status: 'idle', message: '' }))
      clearTimerRef.current = null
    }, delay)
  }, [])

  const clearMessage = React.useCallback(() => {
    if (clearTimerRef.current) {
      window.clearTimeout(clearTimerRef.current)
      clearTimerRef.current = null
    }
    setUpscaleState((prev) => (prev.loading ? prev : { loading: false, status: 'idle', message: '' }))
  }, [])

  React.useEffect(() => {
    return () => {
      if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current)
    }
  }, [])

  const handleUpscaleSelectedImage = React.useCallback(async () => {
    if (clearTimerRef.current) {
      window.clearTimeout(clearTimerRef.current)
      clearTimerRef.current = null
    }
    const shape = editor.getOnlySelectedShape()
    if (!shape || shape.type !== 'image') return
    const asset = editor.getAsset((shape.props as any).assetId)
    const src = await resolveUpscaleSourceUrl(String((asset?.props as any)?.src || '').trim())
    if (!src) {
      setTemporaryState('error', '没有找到图片地址')
      return
    }

    setUpscaleState({ loading: true, status: 'idle', message: '正在高清放大' })
    try {
      const createResp = await fetch('/ai-image/upscale', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: src, scale: 2 }),
      })
      if (!createResp.ok) {
        const text = await createResp.text()
        throw new Error(text || `HTTP ${createResp.status}`)
      }
      const created = await createResp.json()
      const jobId = created.job_id
      if (!jobId) throw new Error('没有返回任务 ID')

      let result: any = null
      for (let i = 0; i < 180; i++) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000))
        const statusResp = await fetch(`/ai-image/${encodeURIComponent(jobId)}`, { credentials: 'include' })
        if (!statusResp.ok) {
          const text = await statusResp.text()
          throw new Error(text || `HTTP ${statusResp.status}`)
        }
        result = await statusResp.json()
        if (result.status === 'done') break
        if (result.status === 'failed') throw new Error(result.error || '高清放大失败')
      }
      if (!result || result.status !== 'done' || !result.image_url) {
        throw new Error('高清放大超时')
      }

      const imageUrl = normalizeDesignflowAssetUrl(result.image_url)
      const file = await fetchImageAsFile(imageUrl, 'upscaled.png')
      const previewUrl = window.URL.createObjectURL(file)
      let size: { w: number; h: number }
      try {
        size = await getImageSize(previewUrl)
      } finally {
        window.URL.revokeObjectURL(previewUrl)
      }
      const sourceShape = editor.getOnlySelectedShape()
      const sourceBounds = sourceShape ? editor.getShapePageBounds(sourceShape.id) : null
      const layout = getSequentialLayoutContext(editor)
      const assetId = AssetRecordType.createId()
      const shapeId = createShapeId() as TLImageShape['id']
      const assetRecord: TLImageAsset = {
        id: assetId,
        typeName: 'asset',
        type: 'image',
        props: {
          w: size.w,
          h: size.h,
          name: file.name || 'upscaled.png',
          isAnimated: false,
          mimeType: file.type || 'image/png',
          src: imageUrl,
          fileSize: file.size,
        },
        meta: { upscaledFrom: src },
      }
      editor.markHistoryStoppingPoint('insert-upscaled-image')
      editor.createAssets([assetRecord])
      editor.createShape({
        id: shapeId,
        type: 'image',
        x: sourceBounds ? sourceBounds.maxX + 40 : 0,
        y: sourceBounds ? sourceBounds.minY : 0,
        props: {
          w: size.w,
          h: size.h,
          assetId,
          playing: true,
          url: '',
          crop: null,
          flipX: false,
          flipY: false,
          altText: file.name || 'upscaled.png',
        },
        meta: {
          designflowInserted: true,
          designflowLayoutOrder: layout.nextOrder,
          designflowLayoutAnchorX: layout.anchorX,
          designflowLayoutAnchorY: layout.anchorY,
          designflowOriginalWidth: size.w,
          designflowOriginalHeight: size.h,
          upscaledFrom: src,
        },
      })
      editor.bringToFront([shapeId])
      setTemporaryState('done', '已插入高清图', 2200)
    } catch (error: any) {
      setTemporaryState('error', formatUpscaleError(error))
    }
  }, [editor, setTemporaryState])

  return { upscaleState, handleUpscaleSelectedImage, clearMessage }
}


function useVectorizeSelectedImage() {
  const editor = useEditor()
  const [vectorizeState, setVectorizeState] = React.useState<{ loading: boolean; status: 'idle' | 'done' | 'error'; message: string }>({ loading: false, status: 'idle', message: '' })
  const clearTimerRef = React.useRef<number | null>(null)

  const setTemporaryState = React.useCallback((status: 'done' | 'error', message: string, delay = 2600) => {
    if (clearTimerRef.current) {
      window.clearTimeout(clearTimerRef.current)
    }
    setVectorizeState({ loading: false, status, message })
    clearTimerRef.current = window.setTimeout(() => {
      setVectorizeState((prev) => (prev.loading ? prev : { loading: false, status: 'idle', message: '' }))
      clearTimerRef.current = null
    }, delay)
  }, [])

  const clearMessage = React.useCallback(() => {
    if (clearTimerRef.current) {
      window.clearTimeout(clearTimerRef.current)
      clearTimerRef.current = null
    }
    setVectorizeState((prev) => (prev.loading ? prev : { loading: false, status: 'idle', message: '' }))
  }, [])

  React.useEffect(() => {
    return () => {
      if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current)
    }
  }, [])

  const handleVectorizeSelectedImage = React.useCallback(async () => {
    if (clearTimerRef.current) {
      window.clearTimeout(clearTimerRef.current)
      clearTimerRef.current = null
    }
    const shape = editor.getOnlySelectedShape()
    if (!shape || shape.type !== 'image') return
    const asset = editor.getAsset((shape.props as any).assetId)
    const assetMime = String((asset?.props as any)?.mimeType || '').toLowerCase()
    if (assetMime === 'image/svg+xml') {
      setTemporaryState('error', '当前图片已经是 SVG')
      return
    }
    const src = await resolveUpscaleSourceUrl(String((asset?.props as any)?.src || '').trim())
    if (!src) {
      setTemporaryState('error', '没有找到图片地址')
      return
    }

    setVectorizeState({ loading: true, status: 'idle', message: '正在转为 SVG' })
    try {
      const createResp = await fetch('/ai-image/vectorize', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: src }),
      })
      if (!createResp.ok) {
        const text = await createResp.text()
        throw new Error(text || `HTTP ${createResp.status}`)
      }
      const created = await createResp.json()
      const jobId = created.job_id
      if (!jobId) throw new Error('没有返回任务 ID')

      let result: any = null
      for (let i = 0; i < 180; i++) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000))
        const statusResp = await fetch(`/ai-image/${encodeURIComponent(jobId)}`, { credentials: 'include' })
        if (!statusResp.ok) {
          const text = await statusResp.text()
          throw new Error(text || `HTTP ${statusResp.status}`)
        }
        result = await statusResp.json()
        if (result.status === 'done') break
        if (result.status === 'failed') throw new Error(result.error || '矢量化失败')
      }
      if (!result || result.status !== 'done' || !result.image_url) {
        throw new Error('矢量化超时')
      }

      const imageUrl = normalizeDesignflowAssetUrl(result.image_url)
      const file = await fetchImageAsFile(imageUrl, 'vectorized.svg')
      const previewUrl = window.URL.createObjectURL(file)
      let size: { w: number; h: number }
      try {
        size = await getImageSize(previewUrl)
      } finally {
        window.URL.revokeObjectURL(previewUrl)
      }
      const sourceShape = editor.getOnlySelectedShape()
      const sourceBounds = sourceShape ? editor.getShapePageBounds(sourceShape.id) : null
      const layout = getSequentialLayoutContext(editor)
      const assetId = AssetRecordType.createId()
      const shapeId = createShapeId() as TLImageShape['id']
      const assetRecord: TLImageAsset = {
        id: assetId,
        typeName: 'asset',
        type: 'image',
        props: {
          w: size.w,
          h: size.h,
          name: 'vectorized.svg',
          isAnimated: false,
          mimeType: 'image/svg+xml',
          src: imageUrl,
          fileSize: file.size,
        },
        meta: { vectorizedFrom: src },
      }
      editor.markHistoryStoppingPoint('insert-vectorized-image')
      editor.createAssets([assetRecord])
      editor.createShape({
        id: shapeId,
        type: 'image',
        x: sourceBounds ? sourceBounds.maxX + 40 : 0,
        y: sourceBounds ? sourceBounds.minY : 0,
        props: {
          w: size.w,
          h: size.h,
          assetId,
          playing: false,
          url: '',
          crop: null,
          flipX: false,
          flipY: false,
          altText: 'vectorized svg',
        },
        meta: {
          designflowInserted: true,
          designflowLayoutOrder: layout.nextOrder,
          designflowLayoutAnchorX: layout.anchorX,
          designflowLayoutAnchorY: layout.anchorY,
          designflowOriginalWidth: size.w,
          designflowOriginalHeight: size.h,
          vectorizedFrom: src,
        },
      })
      editor.bringToFront([shapeId])
      setTemporaryState('done', '已插入 SVG', 2200)
    } catch (error: any) {
      setTemporaryState('error', formatUpscaleError(error))
    }
  }, [editor, setTemporaryState])

  return { vectorizeState, handleVectorizeSelectedImage, clearMessage: clearMessage }
}


function useMattingSelectedImage() {
  const editor = useEditor()
  const [mattingState, setMattingState] = React.useState<{ loading: boolean; status: 'idle' | 'done' | 'error'; message: string }>({ loading: false, status: 'idle', message: '' })
  const clearTimerRef = React.useRef<number | null>(null)

  const setTemporaryState = React.useCallback((status: 'done' | 'error', message: string, delay = 2600) => {
    if (clearTimerRef.current) {
      window.clearTimeout(clearTimerRef.current)
    }
    setMattingState({ loading: false, status, message })
    clearTimerRef.current = window.setTimeout(() => {
      setMattingState((prev) => (prev.loading ? prev : { loading: false, status: 'idle', message: '' }))
      clearTimerRef.current = null
    }, delay)
  }, [])

  const clearMessage = React.useCallback(() => {
    if (clearTimerRef.current) {
      window.clearTimeout(clearTimerRef.current)
      clearTimerRef.current = null
    }
    setMattingState((prev) => (prev.loading ? prev : { loading: false, status: 'idle', message: '' }))
  }, [])

  React.useEffect(() => {
    return () => {
      if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current)
    }
  }, [])

  const handleMattingSelectedImage = React.useCallback(async () => {
    if (clearTimerRef.current) {
      window.clearTimeout(clearTimerRef.current)
      clearTimerRef.current = null
    }
    const initialSourceShape = editor.getOnlySelectedShape()
    if (!initialSourceShape || initialSourceShape.type !== 'image') return
    const sourceShapeId = initialSourceShape.id
    const sourceParentId = initialSourceShape.parentId || editor.getCurrentPageId()
    const initialSourceBounds = editor.getShapePageBounds(sourceShapeId)
    const initialTargetW = Number((initialSourceShape.props as any)?.w) || 0
    const initialTargetH = Number((initialSourceShape.props as any)?.h) || 0
    const asset = editor.getAsset((initialSourceShape.props as any).assetId)
    const src = await resolveUpscaleSourceUrl(String((asset?.props as any)?.src || '').trim())
    if (!src) {
      setTemporaryState('error', '没有找到图片地址')
      return
    }

    setMattingState({ loading: true, status: 'idle', message: '正在智能抠图' })
    try {
      const createResp = await fetch('/ai-image/matting', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: src }),
      })
      if (!createResp.ok) {
        const text = await createResp.text()
        throw new Error(text || `HTTP ${createResp.status}`)
      }
      const created = await createResp.json()
      const jobId = created.job_id
      if (!jobId) throw new Error('没有返回任务 ID')

      let result: any = null
      for (let i = 0; i < 180; i++) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000))
        const statusResp = await fetch(`/ai-image/${encodeURIComponent(jobId)}`, { credentials: 'include' })
        if (!statusResp.ok) {
          const text = await statusResp.text()
          throw new Error(text || `HTTP ${statusResp.status}`)
        }
        result = await statusResp.json()
        if (result.status === 'done') break
        if (result.status === 'failed') throw new Error(result.error || '抠图失败')
      }
      if (!result || result.status !== 'done' || !result.image_url) {
        throw new Error('抠图任务超时')
      }

      const imageUrl = normalizeDesignflowAssetUrl(result.image_url)
      const file = await fetchImageAsFile(imageUrl, 'matting.png')
      const previewUrl = window.URL.createObjectURL(file)
      let size: { w: number; h: number }
      try {
        size = await getImageSize(previewUrl)
      } finally {
        window.URL.revokeObjectURL(previewUrl)
      }

      // 无论轮询期间选区是否切换，均精准基于触发抠图的原图定位、缩放与所属画板页面
      const liveSourceShape = editor.getShape(sourceShapeId)
      const targetParentId = liveSourceShape?.parentId || sourceParentId || editor.getCurrentPageId()
      const liveBounds = liveSourceShape ? editor.getShapePageBounds(sourceShapeId) : null
      const bounds = liveBounds || initialSourceBounds
      const targetW = Number((liveSourceShape?.props as any)?.w) || initialTargetW || size.w
      const targetH = Number((liveSourceShape?.props as any)?.h) || initialTargetH || size.h
      const insertX = bounds ? bounds.maxX + 40 : 0
      const insertY = bounds ? bounds.minY : 0

      const layout = getSequentialLayoutContext(editor)
      const assetId = AssetRecordType.createId()
      const shapeId = createShapeId() as TLImageShape['id']
      const assetRecord: TLImageAsset = {
        id: assetId,
        typeName: 'asset',
        type: 'image',
        props: {
          w: size.w,
          h: size.h,
          name: file.name || 'matting.png',
          isAnimated: false,
          mimeType: file.type || 'image/png',
          src: imageUrl,
          fileSize: file.size,
        },
        meta: { mattingFrom: src },
      }
      editor.markHistoryStoppingPoint('insert-matting-image')
      editor.createAssets([assetRecord])
      editor.createShape({
        id: shapeId,
        type: 'image',
        parentId: targetParentId,
        x: insertX,
        y: insertY,
        props: {
          w: targetW,
          h: targetH,
          assetId,
          playing: true,
          url: '',
          crop: null,
          flipX: false,
          flipY: false,
          altText: file.name || 'matting.png',
        },
        meta: {
          designflowInserted: true,
          designflowLayoutOrder: layout.nextOrder,
          designflowLayoutAnchorX: layout.anchorX,
          designflowLayoutAnchorY: layout.anchorY,
          designflowOriginalWidth: size.w,
          designflowOriginalHeight: size.h,
          mattingFrom: src,
        },
      })
      editor.bringToFront([shapeId])
      setTemporaryState('done', '已插入抠图', 2200)
    } catch (error: any) {
      setTemporaryState('error', formatUpscaleError(error))
    }
  }, [editor, setTemporaryState])

  return { mattingState, handleMattingSelectedImage, clearMessage }
}


function useLayerExtractSelectedImage() {
  const editor = useEditor()
  const [layerExtractState, setLayerExtractState] = React.useState<{
    loading: boolean
    status: 'idle' | 'done' | 'error'
    message: string
    jobId?: string
    psdUrl?: string
  }>({ loading: false, status: 'idle', message: '' })
  const clearTimerRef = React.useRef<number | null>(null)
  const runningJobsRef = React.useRef(new Set<string>())

  const setTemporaryState = React.useCallback((status: 'done' | 'error', message: string, delay = 2600) => {
    if (clearTimerRef.current) {
      window.clearTimeout(clearTimerRef.current)
    }
    setLayerExtractState({ loading: false, status, message })
    clearTimerRef.current = window.setTimeout(() => {
      setLayerExtractState((prev) => (prev.loading ? prev : { loading: false, status: 'idle', message: '' }))
      clearTimerRef.current = null
    }, delay)
  }, [])

  const clearMessage = React.useCallback(() => {
    if (clearTimerRef.current) {
      window.clearTimeout(clearTimerRef.current)
      clearTimerRef.current = null
    }
    setLayerExtractState((prev) => (prev.loading ? prev : { loading: false, status: 'idle', message: '' }))
  }, [])

  const recoverLayerExtractResult = React.useCallback(async (job: PendingLayerExtractJob, result: any) => {
    const extra = result?.layer_extract
    const layers: any[] = Array.isArray(extra?.layers) ? extra.layers : []
    const psdUrl = normalizeDesignflowAssetUrl(String(extra?.psd_url || ''))
    if (!extra || !psdUrl || !Array.isArray(extra.layers)) {
      throw new Error('转 PSD 结果异常')
    }

    setLayerExtractState({
      loading: true,
      status: 'idle',
      message: `任务已完成，正在恢复画布（0/${layers.length}）`,
      jobId: job.jobId,
      psdUrl,
    })
    // 异步自动下载可能被浏览器拦截，工具栏会一直保留手动下载入口。
    triggerLayerExtractPsdDownload(psdUrl)

    const sourceUrl = normalizeDesignflowAssetUrl(job.sourceUrl)
    const sourceShape = editor
      .getCurrentPageShapes()
      .filter((candidate): candidate is TLImageShape => candidate.type === 'image')
      .find((candidate) => {
        const asset = editor.getAsset((candidate.props as any).assetId)
        const candidateUrl = normalizeDesignflowAssetUrl(String((asset?.props as any)?.src || ''))
        return candidateUrl === sourceUrl
      })
    const sourceBounds = sourceShape ? editor.getShapePageBounds(sourceShape.id) : null
    const sourceSize: [number, number] = Array.isArray(extra.source_size) ? extra.source_size : [0, 0]
    const layersUrlPrefix = normalizeDesignflowAssetUrl(String(extra.layers_url_prefix || '')).replace(/\/+$/, '')
    const scale = sourceBounds && sourceSize[0] ? sourceBounds.width / sourceSize[0] : 1
    const viewport = editor.getViewportPageBounds()
    const groupOffsetX = sourceBounds ? sourceBounds.maxX + 40 : viewport.center.x
    const groupOriginY = sourceBounds ? sourceBounds.minY : viewport.center.y

    const existingLayerIndices = new Set<number>()
    for (const candidate of editor.getCurrentPageShapes()) {
      if (candidate.type !== 'image') continue
      const meta = (candidate.meta || {}) as any
      const asset = editor.getAsset((candidate.props as any).assetId)
      const assetUrl = normalizeDesignflowAssetUrl(String((asset?.props as any)?.src || ''))
      const belongsToJob = String(meta.layerExtractJobId || '') === job.jobId ||
        (assetUrl && assetUrl.includes(`/layer-extract/${job.jobId}/`))
      if (!belongsToJob) continue
      const index = Number(meta.layerIndex)
      if (Number.isFinite(index)) existingLayerIndices.add(index)
    }

    const failedLayers: string[] = []
    let recoveredCount = existingLayerIndices.size
    if (layers.length) editor.markHistoryStoppingPoint('insert-layer-extract')

    for (let position = 0; position < layers.length; position++) {
      const layer = layers[position]
      const layerIndexValue = Number(layer?.index)
      const layerIndex = Number.isFinite(layerIndexValue) ? layerIndexValue : position
      if (existingLayerIndices.has(layerIndex)) continue

      const layerPath = String(layer?.path || '').replace(/^\/+/, '')
      if (!layerPath || !layersUrlPrefix) {
        failedLayers.push(String(layer?.name || layerIndex))
        continue
      }

      const layerUrl = `${layersUrlPrefix}/${layerPath}`
      try {
        const file = await fetchImageAsFileWithRetry(layerUrl, layerPath.split('/').pop() || 'layer.png')
        const previewUrl = window.URL.createObjectURL(file)
        let size: { w: number; h: number }
        try {
          size = await getImageSize(previewUrl)
        } finally {
          window.URL.revokeObjectURL(previewUrl)
        }

        const assetId = AssetRecordType.createId()
        const shapeId = createShapeId() as TLImageShape['id']
        const assetRecord: TLImageAsset = {
          id: assetId,
          typeName: 'asset',
          type: 'image',
          props: {
            w: size.w,
            h: size.h,
            name: layerPath.split('/').pop() || 'layer.png',
            isAnimated: false,
            mimeType: 'image/png',
            src: layerUrl,
            fileSize: file.size,
          },
          meta: {
            layerExtractFrom: sourceUrl,
            layerExtractJobId: job.jobId,
            layerIndex,
          },
        }
        const layerX = groupOffsetX + Number(layer?.x || 0) * scale
        const layerY = groupOriginY + Number(layer?.y || 0) * scale
        editor.createAssets([assetRecord])
        editor.createShape({
          id: shapeId,
          type: 'image',
          x: layerX,
          y: layerY,
          props: {
            w: size.w * scale,
            h: size.h * scale,
            assetId,
            playing: false,
            url: '',
            crop: null,
            flipX: false,
            flipY: false,
            altText: layer.name || 'layer',
          },
          meta: {
            designflowInserted: true,
            designflowLayoutExcluded: true,
            layerExtractFrom: sourceUrl,
            layerExtractJobId: job.jobId,
            layerIndex,
          },
        })
        editor.bringToFront([shapeId])
        existingLayerIndices.add(layerIndex)
        recoveredCount += 1
        setLayerExtractState((prev) => ({
          ...prev,
          loading: true,
          message: `正在恢复画布（${recoveredCount}/${layers.length}）`,
        }))
      } catch (error) {
        console.error('Failed to recover layer extract layer', { jobId: job.jobId, layerPath, error })
        failedLayers.push(String(layer?.name || layerPath))
      }
    }

    if (failedLayers.length) {
      setLayerExtractState({
        loading: false,
        status: 'error',
        message: `已恢复 ${recoveredCount}/${layers.length} 层，${failedLayers.length} 层待重试`,
        jobId: job.jobId,
        psdUrl,
      })
      return false
    }

    forgetPendingLayerExtractJob(job.jobId)
    setLayerExtractState({
      loading: false,
      status: 'done',
      message: layers.length ? `已恢复 ${layers.length} 层并生成 PSD` : '已生成 PSD',
      jobId: job.jobId,
      psdUrl,
    })
    return true
  }, [editor])

  const processLayerExtractJob = React.useCallback(async (job: PendingLayerExtractJob) => {
    if (runningJobsRef.current.has(job.jobId)) return false
    runningJobsRef.current.add(job.jobId)
    try {
      setLayerExtractState({ loading: true, status: 'idle', message: '正在等待分层 PSD', jobId: job.jobId })
      const result = await pollLayerExtractJobStatus(job.jobId)
      if (result.status === 'failed') {
        forgetPendingLayerExtractJob(job.jobId)
        throw new Error(result.error || '转 PSD 失败')
      }
      return await recoverLayerExtractResult(job, result)
    } catch (error: any) {
      setLayerExtractState((prev) => ({
        loading: false,
        status: 'error',
        message: formatUpscaleError(error),
        jobId: job.jobId,
        psdUrl: prev.psdUrl,
      }))
      return false
    } finally {
      runningJobsRef.current.delete(job.jobId)
    }
  }, [recoverLayerExtractResult])

  const processPendingLayerExtractJobs = React.useCallback(() => {
    const pending = readPendingLayerExtractJobs()
    pending.reduce(
      (chain, job) => chain.then(() => processLayerExtractJob(job)),
      Promise.resolve(false)
    ).catch((error) => console.error('Failed to recover pending layer extract jobs', error))
  }, [processLayerExtractJob])

  React.useEffect(() => {
    const recover = () => processPendingLayerExtractJobs()
    window.addEventListener('designflow:editor-hydrated', recover)
    if ((window as any).__designflowEditorHydrated) recover()
    return () => window.removeEventListener('designflow:editor-hydrated', recover)
  }, [processPendingLayerExtractJobs])

  React.useEffect(() => {
    return () => {
      if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current)
    }
  }, [])

  const handleLayerExtractSelectedImage = React.useCallback(async () => {
    if (clearTimerRef.current) {
      window.clearTimeout(clearTimerRef.current)
      clearTimerRef.current = null
    }
    const resumableJob = layerExtractState.jobId
      ? readPendingLayerExtractJobs().find((job) => job.jobId === layerExtractState.jobId)
      : null
    if (layerExtractState.status === 'error' && resumableJob) {
      await processLayerExtractJob(resumableJob)
      return
    }
    const shape = editor.getOnlySelectedShape()
    if (!shape || shape.type !== 'image') return
    const asset = editor.getAsset((shape.props as any).assetId)
    const assetMime = String((asset?.props as any)?.mimeType || '').toLowerCase()
    if (assetMime === 'image/svg+xml') {
      setTemporaryState('error', 'SVG 无法转 PSD')
      return
    }
    const src = await resolveUpscaleSourceUrl(String((asset?.props as any)?.src || '').trim())
    if (!src) {
      setTemporaryState('error', '没有找到图片地址')
      return
    }

    setLayerExtractState({ loading: true, status: 'idle', message: '正在创建分层 PSD 任务' })
    try {
      const createResp = await fetch('/ai-image/layer-extract', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: src }),
      })
      if (!createResp.ok) {
        const text = await createResp.text()
        throw new Error(text || `HTTP ${createResp.status}`)
      }
      const created = await createResp.json()
      const jobId = created.job_id
      if (!jobId) throw new Error('没有返回任务 ID')
      const job = { jobId: String(jobId), sourceUrl: src, createdAt: Date.now() }
      rememberPendingLayerExtractJob(job)
      await processLayerExtractJob(job)
    } catch (error: any) {
      if (clearTimerRef.current) {
        window.clearTimeout(clearTimerRef.current)
        clearTimerRef.current = null
      }
      setLayerExtractState({ loading: false, status: 'error', message: formatUpscaleError(error) })
    }
  }, [editor, layerExtractState.jobId, layerExtractState.status, processLayerExtractJob, setTemporaryState])

  const handleLayerExtractPsdDownload = React.useCallback(() => {
    if (layerExtractState.psdUrl) triggerLayerExtractPsdDownload(layerExtractState.psdUrl)
  }, [layerExtractState.psdUrl])

  return { layerExtractState, handleLayerExtractSelectedImage, handleLayerExtractPsdDownload, clearMessage }
}



type DesignflowToolbarIconName = 'download' | 'upscale' | 'vectorize' | 'matting' | 'layers'

type DesignflowToolbarButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  ariaLabel: string
}

function DesignflowToolbarButton({
  ariaLabel,
  className = '',
  children,
  ...props
}: DesignflowToolbarButtonProps) {
  return (
    <button
      {...props}
      type="button"
      draggable={false}
      aria-label={ariaLabel}
      className={`tlui-button tlui-button__icon designflow-toolbar-button ${className}`.trim()}
    >
      {children}
    </button>
  )
}

function DesignflowToolbarIcon({ name }: { name: DesignflowToolbarIconName }) {
  const commonProps = {
    viewBox: '0 0 24 24',
    width: 17,
    height: 17,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
  }

  if (name === 'download') {
    return (
      <svg {...commonProps}>
        <path d="M12 3v12" />
        <path d="M7 10l5 5 5-5" />
        <path d="M4 19h16" />
      </svg>
    )
  }

  if (name === 'upscale') {
    return (
      <svg {...commonProps}>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="M20 20l-4.35-4.35" />
        <path d="M10.5 8v5" />
        <path d="M8 10.5h5" />
      </svg>
    )
  }

  if (name === 'vectorize') {
    return (
      <svg {...commonProps}>
        <circle cx="5" cy="19" r="1.6" />
        <circle cx="19" cy="5" r="1.6" />
        <path d="M6.3 17.8C10 14 12 10 17.6 6.4" />
      </svg>
    )
  }

  if (name === 'matting') {
    return (
      <svg {...commonProps}>
        <circle cx="6" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M20 4L8.12 15.88" />
        <path d="M14.47 14.48L20 20" />
        <path d="M8.12 8.12L12 12" />
      </svg>
    )
  }

  if (name === 'layers') {
    return (
      <svg {...commonProps}>
        <path d="M12 3l8 4.5-8 4.5-8-4.5z" />
        <path d="M4 12.5l8 4.5 8-4.5" />
        <path d="M4 16.5l8 4.5 8-4.5" />
      </svg>
    )
  }

  return null
}

function DesignflowImageToolbar() {
  const editor = useEditor()
  const cameraZoom = useValue(
    'designflow-camera-zoom',
    () => editor.getZoomLevel(),
    [editor]
  )
  // Keep the positioning anchor stable, but scale the visual toolbar with the canvas.
  // The clamp prevents the toolbar from becoming unusably small or oversized at extremes.
  const toolbarScale = Math.min(
    1.08,
    Math.max(0.62, Math.pow(Math.max(cameraZoom, 0.01), 0.35))
  )

  React.useLayoutEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--designflow-toolbar-scale', String(toolbarScale))
    return () => {
      root.style.removeProperty('--designflow-toolbar-scale')
    }
  }, [toolbarScale])
  const selectedShapeIds = useValue(
    'designflow-selected-shape-ids',
    () => editor.getSelectedShapeIds() as string[],
    [editor]
  )
  const selectedImageIds = useValue(
    'designflow-selected-image-ids',
    () =>
      editor
        .getSelectedShapeIds()
        .filter((id) => editor.getShape(id)?.type === 'image') as TLImageShape['id'][],
    [editor]
  )
  const selectedCount = selectedShapeIds.length
  const imageCount = selectedImageIds.length
  // 仅当「唯一选中对象就是一张图片」时展示单图处理工具（高清/SVG/PSD）
  const isSingleImageOnly = selectedCount === 1 && imageCount === 1
  const imageShapeId = isSingleImageOnly ? selectedImageIds[0] : null
  // 多选（含：多图，或 1 图+其它对象）只提供下载
  const isDownloadOnlyMode = imageCount > 0 && !isSingleImageOnly
  const selectionKey = selectedShapeIds.slice().sort().join('|')
  const showToolbar = useValue(
    'designflow-upscale-toolbar-visible',
    () => editor.isInAny('select.idle', 'select.pointing_shape', 'select.brushing'),
    [editor]
  )
  const isLocked = useValue(
    'designflow-upscale-toolbar-locked',
    () => {
      if (imageCount === 0) return true
      // 有可下载的未锁定图片即可显示工具条
      return selectedImageIds.every((id) => editor.getShape<TLImageShape>(id)?.isLocked)
    },
    [editor, selectedImageIds, imageCount]
  )
  const { upscaleState, handleUpscaleSelectedImage, clearMessage } = useUpscaleSelectedImage()
  const { vectorizeState, handleVectorizeSelectedImage, clearMessage: clearVectorizeMessage } = useVectorizeSelectedImage()
  const { mattingState, handleMattingSelectedImage, clearMessage: clearMattingMessage } = useMattingSelectedImage()
  const {
    layerExtractState,
    handleLayerExtractSelectedImage,
    clearMessage: clearLayerExtractMessage,
  } = useLayerExtractSelectedImage()
  const [batchDownloadState, setBatchDownloadState] = React.useState<{
    loading: boolean
    message: string
  }>({ loading: false, message: '' })
  const downloadTokenRef = React.useRef(0)
  const downloadAbortRef = React.useRef<AbortController | null>(null)

  React.useEffect(() => {
    // 选区变化：作废 token 并 abort 当前 fetch，真正中止进行中的单张下载
    downloadTokenRef.current += 1
    downloadAbortRef.current?.abort()
    downloadAbortRef.current = null
    clearMessage()
    clearVectorizeMessage()
    clearMattingMessage()
    clearLayerExtractMessage()
    setBatchDownloadState({ loading: false, message: '' })
  }, [clearMessage, clearVectorizeMessage, clearMattingMessage, clearLayerExtractMessage, selectionKey])

  const handleDownloadOriginal = React.useCallback(async () => {
    if (!imageShapeId) return
    const items = collectImageAssetsFromShapeIds(editor, [imageShapeId])
    if (!items.length) {
      window.alert('无法下载：当前图片没有可用地址')
      return
    }
    try {
      await downloadOneImage(items[0])
    } catch (error: any) {
      if (isDownloadCancelledError(error)) return
      window.alert(String(error?.message || error || '下载失败'))
    }
  }, [editor, imageShapeId])

  const handleBatchDownload = React.useCallback(async () => {
    if (imageCount === 0 || batchDownloadState.loading) return
    const items = collectImageAssetsFromShapeIds(editor, selectedImageIds)
    if (!items.length) {
      window.alert('无法下载：选中的图片没有可用地址')
      return
    }
    // 新任务开始前中止旧 controller（若有）
    downloadAbortRef.current?.abort()
    const ac = new AbortController()
    downloadAbortRef.current = ac
    const token = ++downloadTokenRef.current
    const isCancelled = () => downloadTokenRef.current !== token || ac.signal.aborted
    setBatchDownloadState({ loading: true, message: `下载中 0/${items.length}` })
    try {
      await downloadImagesSequential(
        items,
        (done, total) => {
          if (isCancelled()) return
          setBatchDownloadState({
            loading: done < total,
            message: done < total ? `下载中 ${done + 1}/${total}` : `已下载 ${total} 张`,
          })
        },
        { isCancelled, signal: ac.signal }
      )
      if (isCancelled()) return
      setBatchDownloadState({ loading: false, message: `已下载 ${items.length} 张` })
      window.setTimeout(() => {
        if (isCancelled()) return
        setBatchDownloadState((prev) => (prev.loading ? prev : { loading: false, message: '' }))
      }, 2200)
    } catch (error: any) {
      if (isDownloadCancelledError(error) || isCancelled()) {
        // 选区变化等主动取消：不弹窗
        return
      }
      const msg = String(error?.message || error || '批量下载失败')
      setBatchDownloadState({ loading: false, message: msg })
      window.alert(msg)
    } finally {
      if (downloadAbortRef.current === ac) downloadAbortRef.current = null
    }
  }, [batchDownloadState.loading, editor, imageCount, selectedImageIds])

  const getSelectionBounds = React.useCallback(() => {
    const fullBounds = editor.getSelectionScreenBounds()
    if (!fullBounds) return undefined
    return new Box(fullBounds.x, fullBounds.y, fullBounds.width, fullBounds.height)
  }, [editor])

  if (imageCount === 0 || !showToolbar || isLocked) return null

  // 多选 / 混合多选：只提供图片下载，不暴露单图处理工具
  if (isDownloadOnlyMode) {
    return (
      <TldrawUiContextualToolbar
        className="tlui-media__toolbar tlui-image__toolbar designflow-upscale-toolbar designflow-upscale-toolbar-batch"
        getSelectionBounds={getSelectionBounds}
        label={imageCount > 1 ? `批量下载 ${imageCount} 张` : '下载图片'}
      >
        <DesignflowToolbarButton
          ariaLabel={
            batchDownloadState.loading
              ? batchDownloadState.message || '下载中'
              : batchDownloadState.message ||
                (imageCount > 1 ? `批量下载 ${imageCount} 张图片` : '下载选中图片')
          }
          data-testid="tool.image-batch-download"
          onClick={handleBatchDownload}
          disabled={batchDownloadState.loading}
        >
          {batchDownloadState.loading ? (
            <span className="designflow-upscale-spinner" />
          ) : (
            <DesignflowToolbarIcon name="download" />
          )}
          <span className="designflow-toolbar-label">下载图片</span>
        </DesignflowToolbarButton>
        {batchDownloadState.message && !batchDownloadState.loading && (
          <span className="designflow-batch-download-status" title={batchDownloadState.message}>
            {batchDownloadState.message}
          </span>
        )}
      </TldrawUiContextualToolbar>
    )
  }

  return (
    <TldrawUiContextualToolbar
      className="tlui-media__toolbar tlui-image__toolbar designflow-upscale-toolbar designflow-upscale-toolbar-single"
      getSelectionBounds={getSelectionBounds}
      label="高清放大"
    >
      <DesignflowToolbarButton
        ariaLabel="下载原图"
        data-testid="tool.image-download-original"
        onClick={handleDownloadOriginal}
      >
        <DesignflowToolbarIcon name="download" />
        <span className="designflow-toolbar-label">下载原图</span>
      </DesignflowToolbarButton>

      <span className="designflow-toolbar-divider" aria-hidden="true" />

      <DesignflowToolbarButton
        ariaLabel={upscaleState.loading ? '正在高清放大' : (upscaleState.message || '高清放大')}
        data-testid="tool.image-upscale"
        onClick={handleUpscaleSelectedImage}
        disabled={upscaleState.loading || vectorizeState.loading || mattingState.loading || layerExtractState.loading}
      >
        {upscaleState.loading ? (
          <span className="designflow-upscale-spinner" />
        ) : (
          <DesignflowToolbarIcon name="upscale" />
        )}
        <span className="designflow-toolbar-label">高清放大</span>
      </DesignflowToolbarButton>

      <span className="designflow-toolbar-divider" aria-hidden="true" />

      <DesignflowToolbarButton
        ariaLabel={vectorizeState.loading ? '正在转为 SVG' : (vectorizeState.message || '转为 SVG')}
        data-testid="tool.image-vectorize"
        onClick={handleVectorizeSelectedImage}
        disabled={vectorizeState.loading || upscaleState.loading || mattingState.loading || layerExtractState.loading}
      >
        {vectorizeState.loading ? (
          <span className="designflow-upscale-spinner" />
        ) : (
          <DesignflowToolbarIcon name="vectorize" />
        )}
        <span className="designflow-toolbar-label">转为 SVG</span>
      </DesignflowToolbarButton>

      <span className="designflow-toolbar-divider" aria-hidden="true" />

      <DesignflowToolbarButton
        className="designflow-toolbar-button-ai"
        ariaLabel={mattingState.loading ? '正在智能抠图' : (mattingState.message || '智能抠图')}
        data-testid="tool.image-matting"
        onClick={handleMattingSelectedImage}
        disabled={mattingState.loading || upscaleState.loading || vectorizeState.loading || layerExtractState.loading}
      >
        {mattingState.loading ? (
          <span className="designflow-upscale-spinner" />
        ) : (
          <DesignflowToolbarIcon name="matting" />
        )}
        <span className="designflow-toolbar-label">抠图</span>
        <span className="designflow-ai-dot" aria-hidden="true" />
      </DesignflowToolbarButton>

      <span className="designflow-toolbar-divider" aria-hidden="true" />

      <DesignflowToolbarButton
        className="designflow-toolbar-button-ai"
        ariaLabel={layerExtractState.loading ? '正在转分层 PSD' : (layerExtractState.message || (layerExtractState.status === 'error' ? '重试恢复分层 PSD' : '转 PSD'))}
        data-testid="tool.image-layer-extract"
        onClick={handleLayerExtractSelectedImage}
        disabled={layerExtractState.loading || upscaleState.loading || vectorizeState.loading || mattingState.loading}
      >
        {layerExtractState.loading ? (
          <span className="designflow-upscale-spinner" />
        ) : (
          <DesignflowToolbarIcon name="layers" />
        )}
        <span className="designflow-toolbar-label">图层分离</span>
        <span className="designflow-ai-dot" aria-hidden="true" />
      </DesignflowToolbarButton>

      {layerExtractState.status === 'error' && layerExtractState.message && (
        <span className="designflow-toolbar-status" role="status" title={layerExtractState.message}>
          {layerExtractState.message}
        </span>
      )}
      {mattingState.status === 'error' && mattingState.message && (
        <span className="designflow-toolbar-status" role="status" title={mattingState.message}>
          {mattingState.message}
        </span>
      )}
    </TldrawUiContextualToolbar>
  )
}

function TldrawPropertiesPanel() {
  const editor = useEditor()
  const selectedShape = useValue('only-selected-shape', () => editor.getOnlySelectedShape(), [editor])
  const selectedIds = useValue('selected-shape-ids', () => editor.getSelectedShapeIds(), [editor])
  const selectedCount = selectedIds.length
  const selectedImageCount = useValue('selected-image-count', () => {
    return editor.getSelectedShapeIds().filter((id) => editor.getShape(id)?.type === 'image').length
  }, [editor])
  const [textValue, setTextValue] = React.useState('')

  React.useEffect(() => {
    if (isTextShape(selectedShape)) {
      setTextValue(editor.getShapeUtil(selectedShape).getText(selectedShape) ?? '')
      return
    }
    if (isGeoShape(selectedShape)) {
      setTextValue(editor.getShapeUtil(selectedShape).getText(selectedShape) ?? '')
      return
    }
    setTextValue('')
  }, [editor, selectedShape])

  const applyStyle = React.useCallback(
    <T,>(style: { id: string }, value: T) => {
      editor.markHistoryStoppingPoint(`style:${style.id}`)
      editor.setStyleForSelectedShapes(style as any, value)
    },
    [editor]
  )

  const applyTextContent = React.useCallback(() => {
    const shape = editor.getOnlySelectedShape()
    if (!shape || !('richText' in (shape as any).props)) return
    editor.markHistoryStoppingPoint('update-text-content')
    editor.updateShapes([
      {
        id: shape.id,
        type: shape.type,
        props: {
          richText: toRichText(textValue),
        },
      } as any,
    ])
  }, [editor, textValue])

  const handleDuplicate = React.useCallback(() => {
    const ids = editor.getSelectedShapeIds()
    if (ids.length === 0) return
    ;(editor as any).duplicateShapes(ids)
  }, [editor])

  const handleDelete = React.useCallback(() => {
    const ids = editor.getSelectedShapeIds()
    if (ids.length === 0) return
    editor.deleteShapes(ids)
  }, [editor])

  const [batchDownloadState, setBatchDownloadState] = React.useState<{
    loading: boolean
    message: string
  }>({ loading: false, message: '' })
  const panelDownloadTokenRef = React.useRef(0)
  const panelDownloadAbortRef = React.useRef<AbortController | null>(null)
  const selectionKey = selectedIds.slice().map(String).sort().join('|')

  React.useEffect(() => {
    // 选区变化：token 作废 + abort 当前 fetch
    panelDownloadTokenRef.current += 1
    panelDownloadAbortRef.current?.abort()
    panelDownloadAbortRef.current = null
    setBatchDownloadState({ loading: false, message: '' })
  }, [selectionKey])

  const handleDownloadImages = React.useCallback(async () => {
    if (batchDownloadState.loading) return
    const items = collectImageAssetsFromShapeIds(editor, editor.getSelectedShapeIds())
    if (!items.length) {
      window.alert('没有可下载的图片')
      return
    }
    panelDownloadAbortRef.current?.abort()
    const ac = new AbortController()
    panelDownloadAbortRef.current = ac
    const token = ++panelDownloadTokenRef.current
    const isCancelled = () => panelDownloadTokenRef.current !== token || ac.signal.aborted
    setBatchDownloadState({ loading: true, message: `下载中 0/${items.length}` })
    try {
      await downloadImagesSequential(
        items,
        (done, total) => {
          if (isCancelled()) return
          setBatchDownloadState({
            loading: done < total,
            message: done < total ? `下载中 ${done + 1}/${total}` : `已下载 ${total} 张`,
          })
        },
        { isCancelled, signal: ac.signal }
      )
      if (isCancelled()) return
      setBatchDownloadState({ loading: false, message: `已下载 ${items.length} 张` })
      window.setTimeout(() => {
        if (isCancelled()) return
        setBatchDownloadState((prev) => (prev.loading ? prev : { loading: false, message: '' }))
      }, 2200)
    } catch (error: any) {
      if (isDownloadCancelledError(error) || isCancelled()) return
      const msg = String(error?.message || error || '批量下载失败')
      setBatchDownloadState({ loading: false, message: msg })
      window.alert(msg)
    } finally {
      if (panelDownloadAbortRef.current === ac) panelDownloadAbortRef.current = null
    }
  }, [batchDownloadState.loading, editor])

  const getSelectedImageAssets = React.useCallback(() => {
    return collectImageAssetsFromShapeIds(editor, editor.getSelectedShapeIds()).map((item, index) => ({
      src: item.src,
      name: item.name || `reference-${index + 1}.png`,
    }))
  }, [editor])

  React.useEffect(() => {
    const images = getSelectedImageAssets()
    window.parent.postMessage(
      {
        type: 'designflow:use-as-reference',
        images,
      },
      '*'
    )
  }, [getSelectedImageAssets, selectedIds])

  const textShape = isTextShape(selectedShape) ? selectedShape : null
  const geoShape = isGeoShape(selectedShape) ? selectedShape : null
  const isImageShape = selectedShape?.type === 'image'
  const bounds = selectedShape ? editor.getShapePageBounds(selectedShape) : null

  if (selectedCount === 0) {
    return null
  }

  const title =
    selectedCount > 1
      ? `已选择 ${selectedCount} 个对象`
      : textShape
      ? '文字属性'
      : geoShape
      ? '形状属性'
      : isImageShape
      ? '图片属性'
      : `${selectedShape?.type ?? '对象'} 属性`

  return (
    <aside className="lab-sidepanel">
      <div className="lab-sidepanel-head">
        <div>
          <div className="lab-sidepanel-title">{title}</div>
          <div className="lab-sidepanel-meta">
            {selectedCount > 1
              ? '当前是多选状态，建议先做移动、缩放、对齐。'
              : '这里的修改会直接作用到当前选中的对象。'}
          </div>
        </div>
      </div>

      {selectedCount > 1 && (
        <div className="lab-sidepanel-empty">
          <div className="lab-sidepanel-empty-title">多选模式</div>
          <div className="lab-sidepanel-empty-copy">
            已选择 {selectedCount} 个对象
            {selectedImageCount > 0 ? `（含 ${selectedImageCount} 张图片）` : ''}
          </div>
          <div className="lab-sidepanel-actions">
            <button type="button" className="lab-sidebtn" onClick={handleDuplicate}>
              复制所选
            </button>
            {selectedImageCount > 0 && (
              <button
                type="button"
                className="lab-sidebtn"
                onClick={handleDownloadImages}
                disabled={batchDownloadState.loading}
              >
                {batchDownloadState.loading
                  ? batchDownloadState.message || '下载中…'
                  : `批量下载图片 (${selectedImageCount})`}
              </button>
            )}
            {batchDownloadState.message && !batchDownloadState.loading && (
              <div className="lab-sidepanel-note">{batchDownloadState.message}</div>
            )}
            <button type="button" className="lab-sidebtn lab-sidebtn-danger" onClick={handleDelete}>
              删除所选
            </button>
          </div>
        </div>
      )}

      {selectedCount === 1 && bounds && (
        <div className="lab-sidepanel-section">
          <div className="lab-sidepanel-section-title">对象信息</div>
          <div className="lab-kv-grid">
            <div className="lab-kv-item">
              <span className="lab-kv-label">类型</span>
              <span className="lab-kv-value">{selectedShape?.type}</span>
            </div>
            <div className="lab-kv-item">
              <span className="lab-kv-label">位置</span>
              <span className="lab-kv-value">
                {Math.round(bounds.x)}, {Math.round(bounds.y)}
              </span>
            </div>
            <div className="lab-kv-item">
              <span className="lab-kv-label">尺寸</span>
              <span className="lab-kv-value">
                {Math.round(bounds.w)} × {Math.round(bounds.h)}
              </span>
            </div>
          </div>
          {isImageShape && (
            <div className="lab-sidepanel-actions" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="lab-sidebtn"
                onClick={handleDownloadImages}
                disabled={batchDownloadState.loading}
              >
                {batchDownloadState.loading ? batchDownloadState.message || '下载中…' : '下载图片'}
              </button>
            </div>
          )}
        </div>
      )}

      {(textShape || geoShape) && selectedCount === 1 && (
        <div className="lab-sidepanel-body">
          <div className="lab-sidepanel-section">
            <div className="lab-sidepanel-section-title">文本</div>
            <label className="lab-field">
              <span className="lab-field-label">文本内容</span>
              <textarea
                className="lab-textarea"
                rows={4}
                value={textValue}
                onChange={(event) => setTextValue(event.target.value)}
                onBlur={applyTextContent}
              />
            </label>
            <button type="button" className="lab-sidebtn" onClick={applyTextContent}>
              应用文本
            </button>
          </div>

          <div className="lab-sidepanel-section">
            <div className="lab-sidepanel-section-title">文字样式</div>
            <PropertySelect
              label="字体"
              value={(textShape ?? geoShape)!.props.font}
              options={FONT_OPTIONS}
              onChange={(value) => applyStyle(DefaultFontStyle, value)}
            />
            <PropertySelect
              label="字号"
              value={(textShape ?? geoShape)!.props.size}
              options={TEXT_SIZE_OPTIONS}
              onChange={(value) => applyStyle(DefaultSizeStyle, value)}
            />

            <PropertySelect
              label={textShape ? '文字颜色' : '描边颜色'}
              value={(textShape ?? geoShape)!.props.color}
              options={COLOR_OPTIONS}
              onChange={(value) => applyStyle(DefaultColorStyle, value)}
            />

            {textShape && (
              <PropertySelect
                label="对齐"
                value={textShape.props.textAlign}
                options={TEXT_ALIGN_OPTIONS}
                onChange={(value) => applyStyle(DefaultTextAlignStyle, value)}
              />
            )}
          </div>

          {geoShape && (
            <div className="lab-sidepanel-section">
              <div className="lab-sidepanel-section-title">形状样式</div>
              <PropertySelect
                label="填充"
                value={geoShape.props.fill}
                options={FILL_OPTIONS}
                onChange={(value) => applyStyle(DefaultFillStyle, value)}
              />
              <PropertySelect
                label="描边"
                value={geoShape.props.dash}
                options={DASH_OPTIONS}
                onChange={(value) => applyStyle(DefaultDashStyle, value)}
              />
              <PropertySelect
                label="水平对齐"
                value={geoShape.props.align}
                options={BOX_ALIGN_OPTIONS}
                onChange={(value) => applyStyle(DefaultHorizontalAlignStyle, value)}
              />
              <PropertySelect
                label="垂直对齐"
                value={geoShape.props.verticalAlign}
                options={VERTICAL_ALIGN_OPTIONS}
                onChange={(value) => applyStyle(DefaultVerticalAlignStyle, value)}
              />
            </div>
          )}

          <div className="lab-sidepanel-actions">
            <button type="button" className="lab-sidebtn" onClick={handleDuplicate}>
              复制对象
            </button>
            <button type="button" className="lab-sidebtn lab-sidebtn-danger" onClick={handleDelete}>
              删除对象
            </button>
          </div>

          <div className="lab-sidepanel-note">
            文本内容支持直接在这里改，也可以双击画布上的对象继续编辑。常用字体、颜色、对齐会实时生效。
          </div>
        </div>
      )}

      {selectedCount === 1 && !textShape && !geoShape && !isImageShape && selectedShape && (
        <div className="lab-sidepanel-empty">
          <div className="lab-sidepanel-empty-title">下一步再细化</div>
          <div className="lab-sidepanel-empty-copy">
            {selectedShape.type} 目前已经能选中和变换，后续我们可以再为这类对象补更细的检查器。
          </div>
        </div>
      )}
    </aside>
  )
}

function EditorSurface() {
  return (
    <>
      <TldrawHostBridge />
      <TldrawPropertiesPanel />
    </>
  )
}

class DownloadCancelledError extends Error {
  constructor() {
    super('DOWNLOAD_CANCELLED')
    this.name = 'DownloadCancelledError'
  }
}

function isDownloadCancelledError(error: unknown) {
  // 只认主动取消；内部 30s 超时的 AbortError 不能算取消
  if (!error) return false
  return (
    error instanceof DownloadCancelledError ||
    (error as any).name === 'DownloadCancelledError'
  )
}

function throwIfDownloadCancelled(options?: { signal?: AbortSignal; isCancelled?: () => boolean }) {
  if (options?.isCancelled?.() || options?.signal?.aborted) {
    throw new DownloadCancelledError()
  }
}

async function fetchImageAsFile(
  url: string,
  nameHint?: string,
  options?: { signal?: AbortSignal; timeoutMs?: number }
) {
  const timeoutMs = options?.timeoutMs ?? 30000
  const timeoutController = new AbortController()
  let timedOut = false
  const timer = window.setTimeout(() => {
    timedOut = true
    timeoutController.abort()
  }, timeoutMs)
  const external = options?.signal
  // 合并超时与外部取消：任一 abort 都中止 fetch / 正文读取
  if (external) {
    if (external.aborted) {
      timeoutController.abort()
    } else {
      external.addEventListener('abort', () => timeoutController.abort(), { once: true })
    }
  }

  try {
    // 整段覆盖 fetch + response.blob()，超时/取消在任一阶段都要正确转换
    const response = await fetch(url, { credentials: 'include', signal: timeoutController.signal })
    if (external?.aborted) throw new DownloadCancelledError()
    if (timedOut) throw new Error('图片读取超时，请稍后重试')
    if (!response.ok) {
      throw new Error(`图片读取失败: HTTP ${response.status}`)
    }
    const blob = await response.blob()
    if (external?.aborted) throw new DownloadCancelledError()
    if (timedOut) throw new Error('图片读取超时，请稍后重试')
    const mime = blob.type || 'image/png'
    const ext = mime.split('/')[1] || 'png'
    const fileName = (nameHint || `designflow-${Date.now()}.${ext}`).replace(/[\\/:*?"<>|]+/g, '_')
    return new File([blob], fileName, { type: mime })
  } catch (error) {
    if (isDownloadCancelledError(error)) throw error
    // 已是可读业务错误（含我们主动抛的超时）
    if (error instanceof Error && /图片读取超时|图片读取失败|图片读取已中断/.test(error.message)) {
      throw error
    }
    // 外部主动取消优先（含 blob 阶段被 abort 的 AbortError）
    if (external?.aborted) throw new DownloadCancelledError()
    // 内部超时（可能发生在 fetch 或 response.blob 阶段）
    if (timedOut) throw new Error('图片读取超时，请稍后重试')
    if ((error as any)?.name === 'AbortError') {
      throw new Error('图片读取已中断')
    }
    throw error
  } finally {
    window.clearTimeout(timer)
  }
}

type DownloadableImage = { src: string; name: string }

function sleepMs(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DownloadCancelledError())
      return
    }
    const timer = window.setTimeout(() => resolve(), ms)
    if (!signal) return
    const onAbort = () => {
      window.clearTimeout(timer)
      reject(new DownloadCancelledError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function sanitizeDownloadFileName(name: string, fallback = 'image.png') {
  let clean = String(name || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
  if (!clean) clean = fallback
  if (!/\.[a-z0-9]{1,8}$/i.test(clean)) clean = `${clean}.png`
  return clean.slice(0, 120)
}

function withUniqueDownloadNames(items: DownloadableImage[]): DownloadableImage[] {
  const used = new Map<string, number>()
  return items.map((item, index) => {
    const base = sanitizeDownloadFileName(item.name, `image-${index + 1}.png`)
    const count = used.get(base) || 0
    used.set(base, count + 1)
    if (count === 0) return { src: item.src, name: base }
    const match = base.match(/^(.*?)(\.[^.]+)?$/)
    const stem = match?.[1] || base
    const ext = match?.[2] || '.png'
    return { src: item.src, name: `${stem}-${count + 1}${ext}` }
  })
}

function collectImageAssetsFromShapeIds(editor: Editor, shapeIds: readonly string[]): DownloadableImage[] {
  const seen = new Set<string>()
  const items: DownloadableImage[] = []
  shapeIds.forEach((id, index) => {
    const shape = editor.getShape(id as TLImageShape['id'])
    if (!shape || shape.type !== 'image') return
    const assetId = (shape.props as any)?.assetId
    if (!assetId) return
    const asset = editor.getAsset(assetId)
    if (!asset) return
    const rawSrc = String((asset.props as any)?.src || '').trim()
    const src = normalizeDesignflowAssetUrl(rawSrc) || rawSrc
    if (!src || seen.has(src)) return
    seen.add(src)
    items.push({
      src,
      name: String((asset.props as any)?.name || (shape.props as any)?.altText || `image-${index + 1}.png`),
    })
  })
  return withUniqueDownloadNames(items)
}

/** 单张：优先 blob 本地下载；失败再打开原链。可传入 signal 立即中止 fetch */
async function downloadOneImage(
  item: DownloadableImage,
  options?: { signal?: AbortSignal; isCancelled?: () => boolean }
) {
  const src = item.src
  const fileName = sanitizeDownloadFileName(item.name)
  throwIfDownloadCancelled(options)
  // data URL 直接挂载
  if (src.startsWith('data:')) {
    throwIfDownloadCancelled(options)
    const link = document.createElement('a')
    link.href = src
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    return
  }
  try {
    const file = await fetchImageAsFile(src, fileName, { signal: options?.signal })
    // fetch 完成后、触发浏览器下载前再检查一次，避免取消后仍 link.click()
    throwIfDownloadCancelled(options)
    const objectUrl = URL.createObjectURL(file)
    try {
      throwIfDownloadCancelled(options)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = file.name || fileName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500)
    }
    return
  } catch (error) {
    // 主动取消：上抛让批量任务安静退出
    if (isDownloadCancelledError(error)) throw error
    // 超时/读取失败等：若此时用户也取消了，优先当取消
    if (options?.isCancelled?.() || options?.signal?.aborted) throw new DownloadCancelledError()
    // 读取超时等真实错误：继续抛出，不要静默 fallback 到新窗口（超时打开新页无意义）
    const msg = String((error as any)?.message || error || '')
    if (/超时|timeout|读取失败|HTTP\s*\d+/i.test(msg)) {
      throw error instanceof Error ? error : new Error(msg)
    }
    // 跨域或其它读失败：新窗口打开，用户可另存
    const link = document.createElement('a')
    link.href = src
    link.download = fileName
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }
}

/** 批量顺序下载，避免浏览器一次拦截多个下载；可通过 isCancelled / signal 中止 */
async function downloadImagesSequential(
  items: DownloadableImage[],
  onProgress?: (done: number, total: number) => void,
  options?: { isCancelled?: () => boolean; signal?: AbortSignal }
) {
  const list = withUniqueDownloadNames(items)
  if (!list.length) throw new Error('没有可下载的图片')
  const cancelled = () => !!options?.isCancelled?.() || !!options?.signal?.aborted
  for (let i = 0; i < list.length; i++) {
    if (cancelled()) throw new DownloadCancelledError()
    onProgress?.(i, list.length)
    await downloadOneImage(list[i], { signal: options?.signal, isCancelled: options?.isCancelled })
    if (cancelled()) throw new DownloadCancelledError()
    // 给浏览器留出接受下载的间隙
    if (i < list.length - 1) {
      try {
        await sleepMs(280, options?.signal)
      } catch (error) {
        if (isDownloadCancelledError(error) || cancelled()) throw new DownloadCancelledError()
        throw error
      }
      if (cancelled()) throw new DownloadCancelledError()
    }
  }
  if (cancelled()) throw new DownloadCancelledError()
  onProgress?.(list.length, list.length)
}

function getImageSize(src: string) {
  return new Promise<{ w: number; h: number }>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth || img.width || 1, h: img.naturalHeight || img.height || 1 })
    img.onerror = () => reject(new Error('image_decode_failed'))
    img.src = src
  })
}

const DESIGNFLOW_GRID_COLUMNS = 4
const DESIGNFLOW_GRID_ROWS_PER_BLOCK = 20
const DESIGNFLOW_GRID_CELL_WIDTH = 420
const DESIGNFLOW_GRID_CELL_HEIGHT = 560
const DESIGNFLOW_GRID_GAP = 40

function isSequentialLayoutImage(editor: Editor, shape: TLShape): shape is TLImageShape {
  if (shape.type !== 'image' || shape.isLocked || shape.parentId !== editor.getCurrentPageId()) return false
  const meta = (shape.meta || {}) as any
  // Layer extraction pieces intentionally overlap to reconstruct the source image.
  return !meta.designflowLayoutExcluded && !meta.layerExtractFrom
}

function getVisualImageOrder(editor: Editor, shapes: TLImageShape[]) {
  return shapes.slice().sort((a, b) => {
    const aBounds = editor.getShapePageBounds(a.id)
    const bBounds = editor.getShapePageBounds(b.id)
    const yDiff = Number(aBounds?.minY || 0) - Number(bBounds?.minY || 0)
    if (Math.abs(yDiff) > 1) return yDiff
    const xDiff = Number(aBounds?.minX || 0) - Number(bBounds?.minX || 0)
    if (Math.abs(xDiff) > 1) return xDiff
    return String(a.id).localeCompare(String(b.id))
  })
}

function getSequentialLayoutContext(editor: Editor) {
  const shapes = editor.getCurrentPageShapes().filter((shape) => isSequentialLayoutImage(editor, shape))
  const visualOrder = getVisualImageOrder(editor, shapes)
  const ordered = shapes.slice().sort((a, b) => {
    const aOrder = Number((a.meta as any)?.designflowLayoutOrder)
    const bOrder = Number((b.meta as any)?.designflowLayoutOrder)
    const aValid = Number.isFinite(aOrder) && aOrder > 0
    const bValid = Number.isFinite(bOrder) && bOrder > 0
    if (aValid && bValid && aOrder !== bOrder) return aOrder - bOrder
    if (aValid !== bValid) return aValid ? -1 : 1
    return visualOrder.indexOf(a) - visualOrder.indexOf(b)
  })

  const first = ordered[0]
  const firstMeta = (first?.meta || {}) as any
  let anchorX = Number(firstMeta.designflowLayoutAnchorX)
  let anchorY = Number(firstMeta.designflowLayoutAnchorY)
  if (!Number.isFinite(anchorX) || !Number.isFinite(anchorY)) {
    const firstBounds = first ? editor.getShapePageBounds(first.id) : null
    if (firstBounds) {
      anchorX = firstBounds.minX - (DESIGNFLOW_GRID_CELL_WIDTH - Math.min(firstBounds.width, DESIGNFLOW_GRID_CELL_WIDTH)) / 2
      anchorY = firstBounds.minY
    } else {
      const viewport = editor.getViewportPageBounds()
      anchorX = viewport.center.x - DESIGNFLOW_GRID_CELL_WIDTH / 2
      anchorY = viewport.center.y - DESIGNFLOW_GRID_CELL_HEIGHT / 2
    }
  }

  return {
    anchorX,
    anchorY,
    nextOrder: ordered.reduce((max, shape) => {
      const order = Number((shape.meta as any)?.designflowLayoutOrder)
      return Number.isFinite(order) && order > max ? order : max
    }, 0) + 1,
  }
}

function reflowSequentialImages(editor: Editor) {
  const shapes = editor.getCurrentPageShapes().filter((shape) => isSequentialLayoutImage(editor, shape))
  if (!shapes.length) return

  const visualOrder = getVisualImageOrder(editor, shapes)
  const ordered = shapes.slice().sort((a, b) => {
    const aOrder = Number((a.meta as any)?.designflowLayoutOrder)
    const bOrder = Number((b.meta as any)?.designflowLayoutOrder)
    const aValid = Number.isFinite(aOrder) && aOrder > 0
    const bValid = Number.isFinite(bOrder) && bOrder > 0
    if (aValid && bValid && aOrder !== bOrder) return aOrder - bOrder
    if (aValid !== bValid) return aValid ? -1 : 1
    return visualOrder.indexOf(a) - visualOrder.indexOf(b)
  })

  const context = getSequentialLayoutContext(editor)
  editor.updateShapes(
    ordered.map((shape, index) => {
      const meta = (shape.meta || {}) as any
      const rawW = Math.max(1, Number(meta.designflowOriginalWidth || (shape.props as any).w || 1))
      const rawH = Math.max(1, Number(meta.designflowOriginalHeight || (shape.props as any).h || 1))
      const scale = Math.min(1, DESIGNFLOW_GRID_CELL_WIDTH / rawW, DESIGNFLOW_GRID_CELL_HEIGHT / rawH)
      const width = Math.max(1, Math.round(rawW * scale))
      const height = Math.max(1, Math.round(rawH * scale))
      const itemsPerBlock = DESIGNFLOW_GRID_COLUMNS * DESIGNFLOW_GRID_ROWS_PER_BLOCK
      const block = Math.floor(index / itemsPerBlock)
      const indexInBlock = index % itemsPerBlock
      const col = indexInBlock % DESIGNFLOW_GRID_COLUMNS
      const row = Math.floor(indexInBlock / DESIGNFLOW_GRID_COLUMNS)
      const blockWidth = DESIGNFLOW_GRID_COLUMNS * (DESIGNFLOW_GRID_CELL_WIDTH + DESIGNFLOW_GRID_GAP)
      return {
        id: shape.id,
        type: shape.type,
        x:
          context.anchorX +
          block * blockWidth +
          col * (DESIGNFLOW_GRID_CELL_WIDTH + DESIGNFLOW_GRID_GAP) +
          (DESIGNFLOW_GRID_CELL_WIDTH - width) / 2,
        y: context.anchorY + row * (DESIGNFLOW_GRID_CELL_HEIGHT + DESIGNFLOW_GRID_GAP),
        props: {
          ...(shape.props as any),
          w: width,
          h: height,
        },
        meta: {
          ...meta,
          designflowLayoutOrder: index + 1,
          designflowLayoutAnchorX: context.anchorX,
          designflowLayoutAnchorY: context.anchorY,
          designflowOriginalWidth: rawW,
          designflowOriginalHeight: rawH,
          designflowLayoutDeferred: false,
        },
      } as any
    })
  )
}

function normalizeImageShapesInSnapshot(snapshot: any) {
  const store = snapshot?.store || snapshot?.document?.store
  if (!store || typeof store !== 'object') return snapshot

  Object.values(store).forEach((record: any) => {
    if (!record || record.typeName !== 'shape' || record.type !== 'image') return
    const props = record.props || {}
    record.props = {
      ...props,
      playing: typeof props.playing === 'boolean' ? props.playing : true,
      url: typeof props.url === 'string' ? props.url : '',
      crop: props.crop === undefined ? null : props.crop,
      flipX: typeof props.flipX === 'boolean' ? props.flipX : false,
      flipY: typeof props.flipY === 'boolean' ? props.flipY : false,
      altText: typeof props.altText === 'string' ? props.altText : '',
    }
  })
  return snapshot
}

function normalizeDesignflowAssetUrl(rawUrl: string) {
  const value = String(rawUrl || '').trim()
  if (!value) return ''
  const publicPrefixes = ['/ai-images/', '/results/', '/output/', '/avatars/']
  const isPublicPath = (pathname: string) =>
    publicPrefixes.some((prefix) => pathname.startsWith(prefix)) ||
    /^\/compose\/[^/]+\/image\/?$/.test(pathname) ||
    pathname.startsWith('/export/grid/')
  try {
    const parsed = new URL(value, window.location.origin)
    if (isPublicPath(parsed.pathname)) {
      return parsed.pathname + parsed.search + parsed.hash
    }
    return parsed.toString()
  } catch (error) {
    return value
  }
}

function normalizeDesignflowAssetUrlsInSnapshot(snapshot: any) {
  const store = snapshot?.store || snapshot?.document?.store
  if (!store || typeof store !== 'object') return snapshot

  Object.values(store).forEach((record: any) => {
    if (!record || record.typeName !== 'asset' || record.type !== 'image') return
    const props = record.props || {}
    const src = typeof props.src === 'string' ? props.src : ''
    const normalized = normalizeDesignflowAssetUrl(src)
    if (normalized && normalized !== src) {
      record.props = {
        ...props,
        src: normalized,
      }
    }
  })
  return snapshot
}

function pruneUnreferencedImageAssetsInSnapshot(snapshot: any) {
  const store = snapshot?.store || snapshot?.document?.store
  if (!store || typeof store !== 'object') return snapshot
  const referencedAssetIds = new Set(
    Object.values(store)
      .filter((record: any) => record?.typeName === 'shape' && record?.props?.assetId)
      .map((record: any) => String(record.props.assetId))
  )
  Object.entries(store).forEach(([recordId, record]: [string, any]) => {
    if (
      record?.typeName === 'asset' &&
      record?.type === 'image' &&
      !referencedAssetIds.has(recordId)
    ) {
      delete store[recordId]
    }
  })
  return snapshot
}

function cloneEditorSnapshot(snapshot: any) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot
  return JSON.parse(JSON.stringify(snapshot))
}

function recordsEqual(left: any, right: any) {
  if (left === undefined || right === undefined) return left === right
  return JSON.stringify(left) === JSON.stringify(right)
}

function getEditorSnapshotStore(snapshot: any): Record<string, any> {
  if (snapshot?.document?.store && typeof snapshot.document.store === 'object') {
    return snapshot.document.store
  }
  if (snapshot?.store && typeof snapshot.store === 'object') return snapshot.store
  return {}
}

function mergeEditorSnapshotStores(baseSnapshot: any, localSnapshot: any, remoteSnapshot: any) {
  const baseStore = getEditorSnapshotStore(baseSnapshot)
  const localStore = getEditorSnapshotStore(localSnapshot)
  const remoteStore = getEditorSnapshotStore(remoteSnapshot)
  const merged: Record<string, any> = {}
  const recordIds = new Set([
    ...Object.keys(baseStore),
    ...Object.keys(localStore),
    ...Object.keys(remoteStore),
  ])

  for (const recordId of recordIds) {
    const baseRecord = baseStore[recordId]
    const localRecord = localStore[recordId]
    const remoteRecord = remoteStore[recordId]
    const localChanged = !recordsEqual(localRecord, baseRecord)
    const remoteChanged = !recordsEqual(remoteRecord, baseRecord)
    let nextRecord: any

    if (localChanged && !remoteChanged) {
      nextRecord = localRecord
    } else if (!localChanged && remoteChanged) {
      nextRecord = remoteRecord
    } else if (localChanged && remoteChanged) {
      // 两边同时修改同一条记录时保留当前页面的修改；删除也视为明确的本地操作。
      nextRecord = localRecord
    } else {
      nextRecord = remoteRecord ?? localRecord ?? baseRecord
    }

    if (nextRecord !== undefined) merged[recordId] = cloneEditorSnapshot(nextRecord)
  }
  return merged
}

function mergeEditorSnapshots(baseSnapshot: any, localSnapshot: any, remoteSnapshot: any) {
  const merged = cloneEditorSnapshot(remoteSnapshot || localSnapshot)
  const mergedStore = mergeEditorSnapshotStores(baseSnapshot, localSnapshot, remoteSnapshot)
  if (merged?.document && typeof merged.document === 'object') {
    merged.document.store = mergedStore
  } else if (merged && typeof merged === 'object') {
    merged.store = mergedStore
  }

  const baseSession = baseSnapshot?.session
  const localSession = localSnapshot?.session
  if (localSession && !recordsEqual(localSession, baseSession)) {
    merged.session = cloneEditorSnapshot(localSession)
  }
  return merged
}

function TldrawHostBridge() {
  const editor = useEditor()

  const recentInsertsRef = React.useRef<Record<string, number>>({})
  const sequentialLayoutTimerRef = React.useRef<number | null>(null)
  const snapshotHydratedRef = React.useRef(false)
  const queuedHostMessagesRef = React.useRef<any[]>([])
  const notifyReadyRef = React.useRef<() => void>(() => {})
  const saveSnapshotNowRef = React.useRef<() => Promise<boolean>>(async () => true)

  React.useEffect(() => {
    const scheduleReflow = () => {
      if (sequentialLayoutTimerRef.current) {
        window.clearTimeout(sequentialLayoutTimerRef.current)
      }
      sequentialLayoutTimerRef.current = window.setTimeout(() => {
        sequentialLayoutTimerRef.current = null
        reflowSequentialImages(editor)
        editor.zoomToFit({ animation: { duration: 0 } })
      }, 0)
    }

    const disposeBeforeCreate = editor.sideEffects.registerBeforeCreateHandler('shape', (shape: any, source) => {
      if (source !== 'user') return shape
      if (!isSequentialLayoutImage(editor, shape)) return shape
      const meta = (shape.meta || {}) as any
      const layout = getSequentialLayoutContext(editor)
      return {
        ...shape,
        meta: {
          ...meta,
          designflowLayoutOrder: layout.nextOrder,
          designflowLayoutAnchorX: layout.anchorX,
          designflowLayoutAnchorY: layout.anchorY,
          designflowOriginalWidth: Math.max(1, Number(meta.designflowOriginalWidth || shape.props?.w || 1)),
          designflowOriginalHeight: Math.max(1, Number(meta.designflowOriginalHeight || shape.props?.h || 1)),
        },
      }
    })

    const disposeAfterCreate = editor.sideEffects.registerAfterCreateHandler('shape', (shape: any, source) => {
      if (source === 'user' && isSequentialLayoutImage(editor, shape) && !(shape.meta as any)?.designflowLayoutDeferred) {
        scheduleReflow()
      }
    })

    return () => {
      disposeBeforeCreate()
      disposeAfterCreate()
      if (sequentialLayoutTimerRef.current) {
        window.clearTimeout(sequentialLayoutTimerRef.current)
        sequentialLayoutTimerRef.current = null
      }
    }
  }, [editor])

  const normalizeCurrentAssetUrls = React.useCallback(() => {
    try {
      const assets = ((editor as any).getAssets ? (editor as any).getAssets() : []).filter(Boolean)
      const updates = assets
        .filter((asset: any) => asset && asset.type === 'image' && asset.props && typeof asset.props.src === 'string')
        .map((asset: any) => {
          const normalized = normalizeDesignflowAssetUrl(asset.props.src)
          if (!normalized || normalized === asset.props.src) return null
          return {
            ...asset,
            props: {
              ...asset.props,
              src: normalized,
            },
          }
        })
        .filter(Boolean)
      if (updates.length) {
        ;(editor as any).updateAssets(updates)
      }
      return updates.length
    } catch (error) {
      return 0
    }
  }, [editor])

  const insertImage = React.useCallback(
    async ({ url, mode, name, deferLayout = false }: { url: string; mode?: 'image' | 'background'; name?: string; deferLayout?: boolean }) => {
      url = normalizeDesignflowAssetUrl(url)
      const sourceShape = editor.getOnlySelectedShape()
      const sourceBounds = sourceShape ? editor.getShapePageBounds(sourceShape.id) : null
      const layout = getSequentialLayoutContext(editor)
      const viewport = editor.getViewportPageBounds()

      const file = await fetchImageAsFile(url, name)
      const previewUrl = window.URL.createObjectURL(file)
      let size: { w: number; h: number }
      try {
        size = await getImageSize(previewUrl)
      } finally {
        window.URL.revokeObjectURL(previewUrl)
      }
      const assetId = AssetRecordType.createId()
      const shapeId = createShapeId() as TLImageShape['id']
      const asset: TLImageAsset = {
        id: assetId,
        typeName: 'asset',
        type: 'image',
        props: {
          w: size.w,
          h: size.h,
          name: file.name,
          isAnimated: false,
          mimeType: file.type || 'image/png',
          src: url,
          fileSize: file.size,
        },
        meta: {},
      }
      editor.createAssets([asset])
      editor.createShape({
        id: shapeId,
        type: 'image',
        x: sourceBounds ? sourceBounds.maxX + 40 : viewport.center.x - size.w / 2,
        y: sourceBounds ? sourceBounds.minY : viewport.center.y - size.h / 2,
        props: {
          w: size.w,
          h: size.h,
          assetId,
          playing: true,
          url: '',
          crop: null,
          flipX: false,
          flipY: false,
          altText: file.name,
        },
        meta: {
          designflowInserted: true,
          designflowLayoutExcluded: mode === 'background',
          designflowLayoutOrder: mode === 'background' ? undefined : layout.nextOrder,
          designflowLayoutAnchorX: layout.anchorX,
          designflowLayoutAnchorY: layout.anchorY,
          designflowOriginalWidth: size.w,
          designflowOriginalHeight: size.h,
          designflowLayoutDeferred: deferLayout,
        },
      })
      const insertedIds = [shapeId]

      if (mode === 'background') {
        const shape = editor.getShape<TLImageShape>(shapeId)
        if (!shape || shape.type !== 'image') return shapeId
        const viewport = editor.getViewportPageBounds()
        editor.updateShapes([
          {
            id: shape.id,
            type: shape.type,
            x: viewport.minX,
            y: viewport.minY,
            props: {
              w: viewport.width,
              h: viewport.height,
            },
          } as any,
        ])
        editor.sendToBack([shape.id])
        if (!shape.isLocked) {
          editor.toggleLock([shape.id])
        }
        editor.selectNone()
      } else {
        editor.bringToFront(insertedIds)
        editor.selectNone()
      }
      return shapeId
    },
    [editor]
  )

  const insertImages = React.useCallback(
    async ({
      urls,
      mode,
      name,
    }: {
      urls: string[]
      mode?: 'image' | 'background'
      name?: string
    }) => {
      const cleanUrls = urls.map(normalizeDesignflowAssetUrl).filter(Boolean)
      if (!cleanUrls.length) return

      if (cleanUrls.length === 1 || mode === 'background') {
        await insertImage({ url: cleanUrls[0], mode, name })
        return
      }

      const insertedShapeIds: string[] = []
      for (let i = 0; i < cleanUrls.length; i++) {
        const shapeId = await insertImage({
          url: cleanUrls[i],
          mode: 'image',
          name: cleanUrls.length > 1 ? `${name || '生成结果'} ${i + 1}` : name,
          deferLayout: true,
        })
        if (shapeId) insertedShapeIds.push(shapeId)
      }

      if (insertedShapeIds.length) {
        reflowSequentialImages(editor)
        editor.zoomToFit({ animation: { duration: 0 } })
        editor.selectNone()
      }
    },
    [editor, insertImage]
  )

  const handleHostMessage = React.useCallback(
    async (data: any) => {
      if (data.type === 'designflow:new-canvas') {
        const pageName = data.pageName || '画板 1'
        const existing = editor.getPages().find(p => p.name === pageName)
        if (existing) {
          editor.setCurrentPage(existing.id)
        } else {
          editor.createPage({ name: pageName })
        }
        if (!(await saveSnapshotNowRef.current())) {
          window.parent.postMessage({ type: 'designflow:editor-error', message: '新建画板保存失败' }, '*')
        }
        return
      }

      if (data.type === 'designflow:set-page-name') {
        const page = editor.getCurrentPage()
        if (page && data.pageName) {
          editor.renamePage(page.id, data.pageName)
          if (!(await saveSnapshotNowRef.current())) {
            window.parent.postMessage({ type: 'designflow:editor-error', message: '画板名称保存失败' }, '*')
          }
        }
        return
      }

      if (data.type === 'designflow:insert-image' && (data.url || (Array.isArray(data.urls) && data.urls.length))) {
        try {
          const urls = Array.isArray(data.urls) && data.urls.length ? data.urls : [data.url]
          // 1 秒内相同 URL 的去重，防止重复消息导致多张相同图片
          var now = Date.now()
          var deduped = urls.filter(function(u: string) {
            var last = recentInsertsRef.current[u]
            if (last && now - last < 1000) return false
            recentInsertsRef.current[u] = now
            return true
          })
          // 清理超过 5 秒的旧记录
          Object.keys(recentInsertsRef.current).forEach(function(k) { if (now - recentInsertsRef.current[k] > 5000) delete recentInsertsRef.current[k] })
          if (deduped.length === 0) return
          await insertImages({
            urls: deduped,
            mode: data.mode === 'background' ? 'background' : 'image',
            name: data.name,
          })
          if (!(await saveSnapshotNowRef.current())) {
            throw new Error('图片已插入，但画板保存失败')
          }
          window.parent.postMessage({ type: 'designflow:editor-inserted', mode: data.mode || 'image', urls: deduped }, '*')
        } catch (error: any) {
          window.parent.postMessage({ type: 'designflow:editor-error', message: error?.message || 'insert_failed' }, '*')
        }
      }
    },
    [editor, insertImages]
  )

  React.useEffect(() => {
    const notifyReady = () => {
      if (!snapshotHydratedRef.current) return
      try {
        window.parent.postMessage({ type: 'designflow:editor-ready' }, '*')
      } catch (error) {}
    }
    notifyReadyRef.current = notifyReady

    const handleMessage = async (event: MessageEvent) => {
      const data = event.data
      if (!data || typeof data !== 'object') return

      if (data.type === 'designflow:ping') {
        notifyReady()
        return
      }

      if (String(data.type || '').startsWith('designflow:') && !snapshotHydratedRef.current) {
        queuedHostMessagesRef.current.push(data)
        return
      }

      await handleHostMessage(data)
    }

    notifyReady()
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [handleHostMessage])

  // —— 画布持久化（自动保存 & 恢复）——
  React.useEffect(() => {
    let saveTimer: number | null = null
    let lastRaw = ''
    let lastSavedSnapshot: any = null
    let revisionRef = { current: 0 }
    let pendingIntentRef = { current: 'update' }
    let reconcilingSnapshot = false
    let syncSaveSent = false
    let snapshotNeedsMigrationSave = false
    let saveChain: Promise<boolean> = Promise.resolve(true)

    const scheduleSave = (delay = 500) => {
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = window.setTimeout(doSave, delay)
    }

    const rebaseSnapshot = async (localSnapshot: any, intent: string) => {
      const latestResponse = await fetch(editorSnapshotUrl, { credentials: 'include' })
      if (!latestResponse.ok) {
        const text = await latestResponse.text()
        throw new Error(text || `HTTP ${latestResponse.status}`)
      }
      const latestData = await latestResponse.json()
      if (!latestData?.snapshot || typeof latestData.revision !== 'number') {
        throw new Error('服务端没有返回可恢复的画板快照')
      }

      const remoteSnapshot = normalizeDesignflowAssetUrlsInSnapshot(
        normalizeImageShapesInSnapshot(cloneEditorSnapshot(latestData.snapshot))
      )
      const mergedSnapshot = mergeEditorSnapshots(lastSavedSnapshot, localSnapshot, remoteSnapshot)
      reconcilingSnapshot = true
      try {
        editor.loadSnapshot(mergedSnapshot)
      } finally {
        reconcilingSnapshot = false
      }

      const currentSnapshot = pruneUnreferencedImageAssetsInSnapshot(editor.getSnapshot() as any)
      const remoteComparable = pruneUnreferencedImageAssetsInSnapshot(cloneEditorSnapshot(remoteSnapshot))
      const currentRaw = JSON.stringify(currentSnapshot)
      const remoteRaw = JSON.stringify(remoteComparable)
      revisionRef.current = latestData.revision
      lastSavedSnapshot = cloneEditorSnapshot(remoteSnapshot)
      lastRaw = remoteRaw
      pendingIntentRef.current = intent || 'update'
      return currentRaw !== remoteRaw
    }

    const performSave = async (attempt = 0): Promise<boolean> => {
      if (!snapshotHydratedRef.current) return true
      try {
        const snapshot = pruneUnreferencedImageAssetsInSnapshot(editor.getSnapshot() as any)
        const store = snapshot.store || snapshot.document?.store
        if (!store || typeof store !== 'object' || Object.keys(store).length === 0) return true
        const currentRaw = JSON.stringify(snapshot)
        if (currentRaw === lastRaw) return true

        const currentIntent = pendingIntentRef.current

        const payload = {
          snapshot,
          base_revision: revisionRef.current,
          intent: currentIntent,
        }

        const res = await fetch(editorSnapshotUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          credentials: 'include',
        })

        if (res.ok) {
          const data = await res.json()
          if (data && data.saved && typeof data.revision === 'number') {
            lastRaw = currentRaw
            lastSavedSnapshot = cloneEditorSnapshot(snapshot)
            revisionRef.current = data.revision
            pendingIntentRef.current = 'update'
            return true
          }
        } else if (res.status === 409) {
          let conflict: any = null
          try {
            conflict = await res.json()
          } catch {}
          const detail = conflict?.detail
          const reason = typeof detail === 'object' && detail ? String(detail.reason || '') : ''
          const recoverable = reason === 'stale_revision' ||
            reason === 'uninitialized_overwrite_rejected' ||
            reason === 'stale_revision_or_uninitialized'

          if (recoverable && attempt < 2) {
            try {
              if (await rebaseSnapshot(snapshot, currentIntent)) return await performSave(attempt + 1)
              return true
            } catch (rebaseError) {
              console.error('Failed to reconcile editor snapshot conflict', rebaseError)
            }
          }

          const detailText = typeof detail === 'string' ? detail : ''
          const message = detailText || (
            recoverable
              ? '画板保存冲突，当前内容已保留；自动合并失败，请稍后重试'
              : '画板保存被拒绝，请刷新后重试'
          )
          window.parent.postMessage({
            type: 'designflow:editor-error',
            message,
          }, '*')
          return false
        } else {
          throw new Error(`画板保存失败: HTTP ${res.status}`)
        }
      } catch (e) {
        console.error('Failed to save canvas snapshot', e)
        try {
          window.parent.postMessage({
            type: 'designflow:editor-error',
            message: e instanceof Error ? e.message : '画板保存失败',
          }, '*')
        } catch {}
        return false
      }
      return false
    }
    const doSave = () => {
      saveChain = saveChain.then(() => performSave(), () => performSave())
      return saveChain
    }
    saveSnapshotNowRef.current = doSave

    const doSaveSync = () => {
      try {
        if (!snapshotHydratedRef.current) return
        if (syncSaveSent) return
        const snapshot = pruneUnreferencedImageAssetsInSnapshot(editor.getSnapshot() as any)
        const store = snapshot.store || snapshot.document?.store
        if (!store || typeof store !== 'object' || Object.keys(store).length === 0) return
        const currentRaw = JSON.stringify(snapshot)
        if (currentRaw === lastRaw) return
        syncSaveSent = true

        const payload = {
          snapshot,
          base_revision: revisionRef.current,
          intent: pendingIntentRef.current,
        }
        const bodyStr = JSON.stringify(payload)
        if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
          const blob = new Blob([bodyStr], { type: 'application/json' })
          if (navigator.sendBeacon(editorSnapshotUrl, blob)) return
        }
        fetch(editorSnapshotUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: bodyStr,
          credentials: 'include',
          keepalive: true,
        }).catch(() => {})
      } catch (e) {}
    }

    // 加载已保存的快照
    const loadSnapshot = async () => {
      try {
        const res = await fetch(editorSnapshotUrl, { credentials: 'include' })
        const data = await res.json()
        if (typeof data.revision === 'number') {
          revisionRef.current = data.revision
        }
        if (data.snapshot) {
          // 验证快照有效：store 至少有一个 page 记录
          const normalizedSnapshot = normalizeDesignflowAssetUrlsInSnapshot(
            normalizeImageShapesInSnapshot(cloneEditorSnapshot(data.snapshot))
          )
          const store = normalizedSnapshot.store || normalizedSnapshot.document?.store
          if (store && typeof store === 'object' && Object.keys(store).length > 0) {
            editor.loadSnapshot(normalizedSnapshot)
            const migration = await compactAndPersistEditorAssets(editor)
            snapshotNeedsMigrationSave = migration.changed
            lastSavedSnapshot = cloneEditorSnapshot(normalizedSnapshot)
            lastRaw = snapshotNeedsMigrationSave
              ? JSON.stringify(normalizedSnapshot)
              : JSON.stringify(editor.getSnapshot())
            window.setTimeout(() => {
              normalizeCurrentAssetUrls()
              reflowSequentialImages(editor)
              editor.zoomToFit({ animation: { duration: 0 } })
            }, 0)
          }
        }
        if (!lastSavedSnapshot) {
          const initialSnapshot = editor.getSnapshot() as any
          lastSavedSnapshot = cloneEditorSnapshot(initialSnapshot)
          lastRaw = JSON.stringify(initialSnapshot)
        }
      } catch (e) {
      } finally {
        snapshotHydratedRef.current = true
        ;(window as any).__designflowEditorHydrated = true
        try {
          window.dispatchEvent(new Event('designflow:editor-hydrated'))
        } catch {}
        if (snapshotNeedsMigrationSave) scheduleSave(0)
        notifyReadyRef.current()
        const queued = queuedHostMessagesRef.current.splice(0)
        queued.reduce((promise, message) => {
          return promise.then(() => handleHostMessage(message))
        }, Promise.resolve()).catch(() => {})
      }
    }

    loadSnapshot()
    window.setTimeout(() => {
      if (normalizeCurrentAssetUrls()) {
        doSave()
      }
    }, 500)

    // 监听用户变更，识别删除动作，自动串行化保存
    const unlisten = editor.store.listen((entry: any) => {
      if (!snapshotHydratedRef.current) return
      if (reconcilingSnapshot) return
      try {
        const removed = entry?.changes?.removed || {}
        const added = entry?.changes?.added || {}
        const hasRemovedShapesOrPages = Object.values(removed).some((record: any) => {
          const typeName = record?.typeName
          return typeName === 'shape' || typeName === 'page'
        })
        if (hasRemovedShapesOrPages) {
          pendingIntentRef.current = 'user_delete'
        }
        const hasAddedCanvasContent = Object.values(added).some((record: any) => {
          const typeName = record?.typeName
          return typeName === 'shape' || typeName === 'page' || typeName === 'asset'
        })
        scheduleSave(hasAddedCanvasContent ? 0 : 500)
        return
      } catch (e) {}

      scheduleSave(500)
    })

    // 页面关闭/刷新/切换前立即保存，避免 debounce 未触发的修改丢失
    window.addEventListener('beforeunload', doSaveSync)
    window.addEventListener('pagehide', doSaveSync)

    return () => {
      unlisten()
      if (saveTimer) clearTimeout(saveTimer)
      window.removeEventListener('beforeunload', doSaveSync)
      window.removeEventListener('pagehide', doSaveSync)
      saveSnapshotNowRef.current = async () => true
    }
  }, [editor, handleHostMessage, normalizeCurrentAssetUrls])

  return null
}

export default function App() {
  const handleMount = React.useCallback((instance: Editor) => {
    instance.selectNone()
    instance.setCurrentTool('select')
    const page = instance.getCurrentPage()
    if (page && page.name === 'Page 1') {
      instance.renamePage(page.id, '画板 1')
    }
    instance.zoomToFit({ animation: { duration: 0 } })
    // 默认开启始终吸附
    instance.user.updateUserPreferences({ isSnapMode: true })

    // 尽早通知父窗口编辑器已就绪，不依赖 useEffect 的时序
    try {
      window.parent.postMessage({ type: 'designflow:editor-ready' }, '*')
    } catch (error) {}
  }, [])

  const components = React.useMemo<TLComponents>(
    () => ({
      HelperButtons: null,
      StylePanel: null,
      ImageToolbar: DesignflowImageToolbar,
    }),
    []
  )

  const assetUrls = React.useMemo(
    () => ({
      icons: Object.fromEntries(iconTypes.map((name) => [name, `./tldraw-assets/0_merged.svg#${name}`])),
      translations: {
        en: './tldraw-assets/en.json',
        'zh-cn': './tldraw-assets/zh-cn.json',
      },
    }),
    []
  )

  return (
    <div className="app-shell">
      <div className="app-frame">
        <div className="canvas-shell">
          <Tldraw assets={editorAssetStore} onMount={handleMount} components={components} locale="zh-cn" assetUrls={assetUrls} licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY}>
            <EditorSurface />
          </Tldraw>
        </div>
      </div>
    </div>
  )
}

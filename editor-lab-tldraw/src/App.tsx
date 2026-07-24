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
  type TLGeoShape,
  type TLImageAsset,
  type TLImageShape,
  type TLShape,
  type TLTextShape,
  TldrawUiButtonIcon,
  TldrawUiContextualToolbar,
  TldrawUiToolbarButton,
  useEditor,
  useValue,
} from 'tldraw'

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


function useLayerExtractSelectedImage() {
  const editor = useEditor()
  const [layerExtractState, setLayerExtractState] = React.useState<{ loading: boolean; status: 'idle' | 'done' | 'error'; message: string }>({ loading: false, status: 'idle', message: '' })
  const clearTimerRef = React.useRef<number | null>(null)

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

    setLayerExtractState({ loading: true, status: 'idle', message: '正在转分层 PSD' })
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

      let result: any = null
      for (let i = 0; i < 600; i++) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000))
        const statusResp = await fetch(`/ai-image/${encodeURIComponent(jobId)}`, { credentials: 'include' })
        if (!statusResp.ok) {
          const text = await statusResp.text()
          throw new Error(text || `HTTP ${statusResp.status}`)
        }
        result = await statusResp.json()
        if (result.status === 'done') break
        if (result.status === 'failed') throw new Error(result.error || '转 PSD 失败')
      }
      if (!result || result.status !== 'done') {
        throw new Error('转 PSD 超时（超过 10 分钟）')
      }
      const extra = result.layer_extract
      if (!extra || !extra.psd_url || !extra.layers) {
        throw new Error('转 PSD 结果异常')
      }

      // 1. 自动下载 PSD
      const psdUrl = normalizeDesignflowAssetUrl(extra.psd_url)
      const psdLink = document.createElement('a')
      psdLink.href = psdUrl
      psdLink.download = 'layered.psd'
      psdLink.target = '_blank'
      psdLink.rel = 'noopener noreferrer'
      document.body.appendChild(psdLink)
      psdLink.click()
      document.body.removeChild(psdLink)

      // 2. 把每个 layer 作为独立 image shape 插入到源图右侧，按原 bbox 相对位置排列
      const sourceShape = editor.getOnlySelectedShape()
      const sourceBounds = sourceShape ? editor.getShapePageBounds(sourceShape.id) : null
      const sourceSize: [number, number] = extra.source_size || [0, 0]
      const layers: any[] = extra.layers
      const layersUrlPrefix = normalizeDesignflowAssetUrl(extra.layers_url_prefix || '')

      // 源图在画布上的尺寸 → 计算 layer bbox 到画布坐标的缩放比
      const scale = sourceBounds && sourceSize[0] ? sourceBounds.width / sourceSize[0] : 1
      const groupOffsetX = sourceBounds ? sourceBounds.maxX + 40 : 0
      const groupOriginY = sourceBounds ? sourceBounds.minY : 0

      const assetRecords: TLImageAsset[] = []
      const shapeCreations: any[] = []
      for (const layer of layers) {
        const layerUrl = `${layersUrlPrefix}/${layer.path}`
        const file = await fetchImageAsFile(layerUrl, layer.path.split('/').pop() || 'layer.png')
        const previewUrl = window.URL.createObjectURL(file)
        let size: { w: number; h: number }
        try {
          size = await getImageSize(previewUrl)
        } finally {
          window.URL.revokeObjectURL(previewUrl)
        }
        const assetId = AssetRecordType.createId()
        const shapeId = createShapeId() as TLImageShape['id']
        assetRecords.push({
          id: assetId,
          typeName: 'asset',
          type: 'image',
          props: {
            w: size.w,
            h: size.h,
            name: layer.path.split('/').pop() || 'layer.png',
            isAnimated: false,
            mimeType: 'image/png',
            src: layerUrl,
            fileSize: file.size,
          },
          meta: { layerExtractFrom: src, layerIndex: layer.index },
        })
        const layerX = groupOffsetX + (layer.x || 0) * scale
        const layerY = groupOriginY + (layer.y || 0) * scale
        shapeCreations.push({
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
            layerExtractFrom: src,
            layerIndex: layer.index,
          },
        })
      }

      editor.markHistoryStoppingPoint('insert-layer-extract')
      if (assetRecords.length) editor.createAssets(assetRecords)
      for (const creation of shapeCreations) {
        editor.createShape(creation)
      }
      if (shapeCreations.length) {
        editor.bringToFront(shapeCreations.map((c) => c.id))
      }

      const layerCount = layers.length
      setTemporaryState('done', layerCount > 0 ? `已转 ${layerCount} 层并下载 PSD` : '已生成 PSD', 3200)
    } catch (error: any) {
      // 错误持久显示在按钮旁，不自动消失（用户可能离开页面很久才回来）
      if (clearTimerRef.current) {
        window.clearTimeout(clearTimerRef.current)
        clearTimerRef.current = null
      }
      setLayerExtractState({ loading: false, status: 'error', message: formatUpscaleError(error) })
    }
  }, [editor, setTemporaryState])

  return { layerExtractState, handleLayerExtractSelectedImage, clearMessage }
}



function DesignflowImageToolbar() {
  const editor = useEditor()
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
  const { layerExtractState, handleLayerExtractSelectedImage, clearMessage: clearLayerExtractMessage } = useLayerExtractSelectedImage()
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
    clearLayerExtractMessage()
    setBatchDownloadState({ loading: false, message: '' })
  }, [clearMessage, clearVectorizeMessage, clearLayerExtractMessage, selectionKey])

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
        className="tlui-media__toolbar tlui-image__toolbar designflow-upscale-toolbar"
        getSelectionBounds={getSelectionBounds}
        label={imageCount > 1 ? `批量下载 ${imageCount} 张` : '下载图片'}
      >
        <TldrawUiToolbarButton
          type="icon"
          title={
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
            <TldrawUiButtonIcon small icon="download" />
          )}
        </TldrawUiToolbarButton>
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
      className="tlui-media__toolbar tlui-image__toolbar designflow-upscale-toolbar"
      getSelectionBounds={getSelectionBounds}
      label="高清放大"
    >
      <TldrawUiToolbarButton
        type="icon"
        title="下载原图"
        data-testid="tool.image-download-original"
        onClick={handleDownloadOriginal}
      >
        <TldrawUiButtonIcon small icon="download" />
      </TldrawUiToolbarButton>
      <TldrawUiToolbarButton
        type="icon"
        title={upscaleState.loading ? '正在高清放大' : (upscaleState.message || '高清放大')}
        data-testid="tool.image-upscale"
        onClick={handleUpscaleSelectedImage}
        disabled={upscaleState.loading || vectorizeState.loading || layerExtractState.loading}
      >
        {upscaleState.loading ? (
          <span className="designflow-upscale-spinner" />
        ) : (
          <TldrawUiButtonIcon small icon="zoom-in" />
        )}
      </TldrawUiToolbarButton>
      <TldrawUiToolbarButton
        type="icon"
        title={vectorizeState.loading ? '正在转为 SVG' : (vectorizeState.message || '转为 SVG')}
        data-testid="tool.image-vectorize"
        onClick={handleVectorizeSelectedImage}
        disabled={vectorizeState.loading || upscaleState.loading || layerExtractState.loading}
      >
        {vectorizeState.loading ? (
          <span className="designflow-upscale-spinner" />
        ) : (
          <TldrawUiButtonIcon small icon="spline-cubic" />
        )}
      </TldrawUiToolbarButton>
      <TldrawUiToolbarButton
        type="icon"
        title={layerExtractState.loading ? '正在转分层 PSD' : (layerExtractState.message || '转 PSD')}
        data-testid="tool.image-layer-extract"
        onClick={handleLayerExtractSelectedImage}
        disabled={layerExtractState.loading || upscaleState.loading || vectorizeState.loading}
      >
        {layerExtractState.loading ? (
          <span className="designflow-upscale-spinner" />
        ) : (
          <TldrawUiButtonIcon small icon="stack-vertical" />
        )}
      </TldrawUiToolbarButton>
      {layerExtractState.status === 'error' && layerExtractState.message && (
        <span className="designflow-layer-extract-error" title={layerExtractState.message}>
          {layerExtractState.message}
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

function TldrawHostBridge() {
  const editor = useEditor()

  const recentInsertsRef = React.useRef<Record<string, number>>({})
  const sequentialLayoutTimerRef = React.useRef<number | null>(null)
  const snapshotHydratedRef = React.useRef(false)
  const queuedHostMessagesRef = React.useRef<any[]>([])
  const notifyReadyRef = React.useRef<() => void>(() => {})

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
        return
      }

      if (data.type === 'designflow:set-page-name') {
        const page = editor.getCurrentPage()
        if (page && data.pageName) {
          editor.renamePage(page.id, data.pageName)
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

    const doSave = () => {
      try {
        if (!snapshotHydratedRef.current) return
        const snapshot = editor.getSnapshot() as any
        const store = snapshot.store || snapshot.document?.store
        if (!store || typeof store !== 'object' || Object.keys(store).length === 0) return
        const raw = JSON.stringify(snapshot)
        if (raw === lastRaw) return
        lastRaw = raw
        fetch('/editor/snapshot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ snapshot }),
          credentials: 'include',
        }).catch(() => {})
      } catch (e) {}
    }

    const doSaveSync = () => {
      try {
        if (!snapshotHydratedRef.current) return
        const snapshot = editor.getSnapshot() as any
        const store = snapshot.store || snapshot.document?.store
        if (!store || typeof store !== 'object' || Object.keys(store).length === 0) return
        const raw = JSON.stringify(snapshot)
        if (raw === lastRaw) return
        lastRaw = raw
        fetch('/editor/snapshot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ snapshot }),
          credentials: 'include',
          keepalive: true,
        }).catch(() => {})
      } catch (e) {}
    }

    // 加载已保存的快照
    const loadSnapshot = async () => {
      try {
        const res = await fetch('/editor/snapshot', { credentials: 'include' })
        const data = await res.json()
        if (data.snapshot) {
          // 验证快照有效：store 至少有一个 page 记录
          const normalizedSnapshot = normalizeDesignflowAssetUrlsInSnapshot(normalizeImageShapesInSnapshot(data.snapshot))
          const store = normalizedSnapshot.store || normalizedSnapshot.document?.store
          if (store && typeof store === 'object' && Object.keys(store).length > 0) {
            editor.loadSnapshot(normalizedSnapshot)
            window.setTimeout(() => {
              normalizeCurrentAssetUrls()
              reflowSequentialImages(editor)
              editor.zoomToFit({ animation: { duration: 0 } })
              doSave()
            }, 0)
          }
        }
      } catch (e) {
      } finally {
        snapshotHydratedRef.current = true
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

    // 监听用户变更，debounce 2 秒后自动保存（source: 'user' 过滤掉 loadSnapshot 触发的变更）
    const unlisten = editor.store.listen(() => {
      if (!snapshotHydratedRef.current) return
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = window.setTimeout(doSave, 2000)
    }, { source: 'user' })

    // 页面关闭/刷新前立即保存，避免 debounce 未触发的修改丢失
    window.addEventListener('beforeunload', doSaveSync)

    return () => {
      unlisten()
      if (saveTimer) clearTimeout(saveTimer)
      window.removeEventListener('beforeunload', doSaveSync)
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
          <Tldraw onMount={handleMount} components={components} locale="zh-cn" assetUrls={assetUrls} licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY}>
            <EditorSurface />
          </Tldraw>
        </div>
      </div>
    </div>
  )
}

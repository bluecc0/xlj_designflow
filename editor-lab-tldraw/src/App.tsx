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
        meta: { designflowInserted: true, upscaledFrom: src },
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
        meta: { designflowInserted: true, vectorizedFrom: src },
      })
      editor.bringToFront([shapeId])
      setTemporaryState('done', '已插入 SVG', 2200)
    } catch (error: any) {
      setTemporaryState('error', formatUpscaleError(error))
    }
  }, [editor, setTemporaryState])

  return { vectorizeState, handleVectorizeSelectedImage, clearMessage: clearMessage }
}



function DesignflowImageToolbar() {
  const editor = useEditor()
  const imageShapeId = useValue(
    'designflow-upscale-toolbar-shape',
    () => {
      const onlySelectedShape = editor.getOnlySelectedShape()
      if (!onlySelectedShape || onlySelectedShape.type !== 'image') return null
      return onlySelectedShape.id as TLImageShape['id']
    },
    [editor]
  )
  const showToolbar = useValue(
    'designflow-upscale-toolbar-visible',
    () => editor.isInAny('select.idle', 'select.pointing_shape'),
    [editor]
  )
  const isLocked = useValue(
    'designflow-upscale-toolbar-locked',
    () => (imageShapeId ? editor.getShape<TLImageShape>(imageShapeId)?.isLocked : false),
    [editor, imageShapeId]
  )
  const { upscaleState, handleUpscaleSelectedImage, clearMessage } = useUpscaleSelectedImage()
  const { vectorizeState, handleVectorizeSelectedImage, clearMessage: clearVectorizeMessage } = useVectorizeSelectedImage()

  React.useEffect(() => {
    clearMessage()
    clearVectorizeMessage()
  }, [clearMessage, clearVectorizeMessage, imageShapeId])

  const handleDownloadOriginal = React.useCallback(() => {
    if (!imageShapeId) return
    const shape = editor.getShape<TLImageShape>(imageShapeId)
    if (!shape) return
    if (!shape.props.assetId) return
    const asset = editor.getAsset(shape.props.assetId)
    const src = String((asset?.props as any)?.src || '').trim()
    if (!src) return
    const link = document.createElement('a')
    link.href = src
    link.download = String((asset?.props as any)?.name || shape.props.altText || 'image.png')
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.click()
  }, [editor, imageShapeId])

  const getSelectionBounds = React.useCallback(() => {
    const fullBounds = editor.getSelectionScreenBounds()
    if (!fullBounds) return undefined
    return new Box(fullBounds.x, fullBounds.y, fullBounds.width, fullBounds.height)
  }, [editor])

  if (!imageShapeId || !showToolbar || isLocked) return null

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
        disabled={upscaleState.loading || vectorizeState.loading}
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
        disabled={vectorizeState.loading || upscaleState.loading}
      >
        {vectorizeState.loading ? (
          <span className="designflow-upscale-spinner" />
        ) : (
          <TldrawUiButtonIcon small icon="spline-cubic" />
        )}
      </TldrawUiToolbarButton>
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

  const handleDownloadImages = React.useCallback(() => {
    const ids = editor.getSelectedShapeIds()
    const imageIds = ids.filter((id) => editor.getShape(id)?.type === 'image')
    if (!imageIds.length) return
    imageIds.forEach((id) => {
      const shape = editor.getShape(id)
      if (!shape) return
      const asset = editor.getAsset((shape.props as any).assetId)
      if (!asset) return
      const src = (asset.props as any).src
      if (!src) return
      const a = document.createElement('a')
      a.href = src
      a.download = (asset.props as any).name || 'image.png'
      a.target = '_blank'
      a.click()
    })
  }, [editor])

  const getSelectedImageAssets = React.useCallback(() => {
    const ids = editor.getSelectedShapeIds()
    const imageIds = ids.filter((id) => editor.getShape(id)?.type === 'image')
    const seen = new Set<string>()
    return imageIds
      .map((id) => {
        const shape = editor.getShape(id)
        if (!shape) return null
        const asset = editor.getAsset((shape.props as any).assetId)
        if (!asset) return null
        const src = String((asset.props as any).src || '').trim()
        if (!src || seen.has(src)) return null
        seen.add(src)
        return {
          src,
          name: String((asset.props as any).name || `reference-${seen.size}.png`),
        }
      })
      .filter(Boolean) as Array<{ src: string; name: string }>
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
              <button type="button" className="lab-sidebtn" onClick={handleDownloadImages}>
                下载图片 ({selectedImageCount})
              </button>
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

async function fetchImageAsFile(url: string, nameHint?: string) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 30000)
  let response: Response
  try {
    response = await fetch(url, { credentials: 'include', signal: controller.signal })
  } finally {
    window.clearTimeout(timer)
  }
  if (!response.ok) {
    throw new Error(`图片读取失败: HTTP ${response.status}`)
  }
  const blob = await response.blob()
  const mime = blob.type || 'image/png'
  const ext = mime.split('/')[1] || 'png'
  const fileName = (nameHint || `designflow-${Date.now()}.${ext}`).replace(/[\\/:*?"<>|]+/g, '_')
  return new File([blob], fileName, { type: mime })
}

function getImageSize(src: string) {
  return new Promise<{ w: number; h: number }>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth || img.width || 1, h: img.naturalHeight || img.height || 1 })
    img.onerror = () => reject(new Error('image_decode_failed'))
    img.src = src
  })
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

  const clearCanvas = React.useCallback(
    (pageName?: string) => {
      const ids = editor.getCurrentPageShapes().map((shape) => shape.id)
      if (ids.length) {
        editor.deleteShapes(ids)
      }
      editor.selectNone()
      const page = editor.getCurrentPage()
      if (page && pageName) {
        editor.renamePage(page.id, pageName)
      }
      editor.zoomToFit({ animation: { duration: 0 } })
    },
    [editor]
  )

  const recentInsertsRef = React.useRef<Record<string, number>>({})

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

  const isDesignflowImageShape = React.useCallback(
    (shape: TLShape) => {
      if (shape.type !== 'image' || shape.isLocked) return false
      const assetId = (shape.props as any).assetId
      const asset = assetId ? editor.getAsset(assetId) : null
      const src = String((asset as any)?.props?.src || '')
      return src.startsWith('/ai-images/') || src.startsWith('/results/') || src.includes('/ai-images/') || src.includes('/results/')
    },
    [editor]
  )

  const reflowDesignflowImages = React.useCallback(
    () => {
      const shapes = editor.getCurrentPageShapes().filter(isDesignflowImageShape)
      if (!shapes.length) return

      const viewport = editor.getViewportPageBounds()
      const spacing = 40
      const maxW = 420
      const maxH = 560
      const normalized = shapes.map((shape) => {
        const props = shape.props as any
        const rawW = Number(props.w || 1)
        const rawH = Number(props.h || 1)
        const scale = Math.min(1, maxW / rawW, maxH / rawH)
        return {
          shape,
          w: Math.max(1, Math.round(rawW * scale)),
          h: Math.max(1, Math.round(rawH * scale)),
        }
      })

      const cellW = Math.max(...normalized.map((item) => item.w))
      const cellH = Math.max(...normalized.map((item) => item.h))
      const maxCols = 4
      const availableCols = Math.max(1, Math.floor((viewport.width + spacing) / (cellW + spacing)))
      const cols = Math.min(maxCols, availableCols, normalized.length)
      const totalW = cols * cellW + (cols - 1) * spacing
      const originX = viewport.center.x - totalW / 2
      const originY = viewport.minY + spacing

      editor.updateShapes(
        normalized.map((item, index) => {
          const col = index % cols
          const row = Math.floor(index / cols)
          const x = originX + col * (cellW + spacing) + (cellW - item.w) / 2
          const y = originY + row * (cellH + spacing)
          return {
            id: item.shape.id,
            type: item.shape.type,
            x,
            y,
            props: {
              ...(item.shape.props as any),
              w: item.w,
              h: item.h,
            },
          } as any
        })
      )

      editor.zoomToFit({ animation: { duration: 0 } })
    },
    [editor, isDesignflowImageShape]
  )

  const insertImage = React.useCallback(
    async ({ url, mode, name }: { url: string; mode?: 'image' | 'background'; name?: string }) => {
      url = normalizeDesignflowAssetUrl(url)
      const sourceShape = editor.getOnlySelectedShape()
      const sourceBounds = sourceShape ? editor.getShapePageBounds(sourceShape.id) : null
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
        reflowDesignflowImages()
        editor.selectNone()
      }
      return shapeId
    },
    [editor, reflowDesignflowImages]
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
        })
        if (shapeId) insertedShapeIds.push(shapeId)
      }

      if (insertedShapeIds.length) {
        editor.zoomToFit({ animation: { duration: 0 } })
        editor.selectNone()
      }
    },
    [editor, insertImage]
  )

  React.useEffect(() => {
    const notifyReady = () => {
      try {
        window.parent.postMessage({ type: 'designflow:editor-ready' }, '*')
      } catch (error) {}
    }

    const handleMessage = async (event: MessageEvent) => {
      const data = event.data
      if (!data || typeof data !== 'object') return

      if (data.type === 'designflow:ping') {
        notifyReady()
        return
      }

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
    }

    notifyReady()
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [clearCanvas, editor, insertImages])

  // —— 画布持久化（自动保存 & 恢复）——
  React.useEffect(() => {
    let saveTimer: number | null = null
    let lastRaw = ''

    const doSave = () => {
      try {
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
              doSave()
            }, 0)
          }
        }
      } catch (e) {}
    }

    loadSnapshot()
    window.setTimeout(() => {
      if (normalizeCurrentAssetUrls()) {
        doSave()
      }
    }, 500)

    // 监听用户变更，debounce 2 秒后自动保存（source: 'user' 过滤掉 loadSnapshot 触发的变更）
    const unlisten = editor.store.listen(() => {
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
  }, [editor, normalizeCurrentAssetUrls])

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

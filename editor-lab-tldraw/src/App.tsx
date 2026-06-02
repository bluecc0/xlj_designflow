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

function TldrawPropertiesPanel() {
  const editor = useEditor()
  const selectedShape = useValue('only-selected-shape', () => editor.getOnlySelectedShape(), [editor])
  const selectedIds = useValue('selected-shape-ids', () => editor.getSelectedShapeIds(), [editor])
  const selectedCount = selectedIds.length
  const selectedImageCount = useValue('selected-image-count', () => {
    return editor.getSelectedShapeIds().filter((id) => editor.getShape(id)?.type === 'image').length
  }, [editor])
  const [textValue, setTextValue] = React.useState('')
  const replaceImageInputRef = React.useRef<HTMLInputElement | null>(null)

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

  const handleReplaceImage = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      const shape = editor.getOnlySelectedShape()
      if (!file || !shape || shape.type !== 'image') return
      editor.markHistoryStoppingPoint('replace-image')
      await editor.replaceExternalContent({
        type: 'file-replace',
        file,
        shapeId: shape.id,
        isImage: true,
      })
      if (replaceImageInputRef.current) {
        replaceImageInputRef.current.value = ''
      }
    },
    [editor]
  )

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

      {isImageShape && selectedCount === 1 && (
        <div className="lab-sidepanel-body">
          <div className="lab-sidepanel-section">
            <div className="lab-sidepanel-section-title">图片</div>
            <div className="lab-sidepanel-empty-copy">
              可以替换图片内容，位置、缩放和旋转继续直接在画布上完成。
            </div>
            <div className="lab-sidepanel-actions">
              <button type="button" className="lab-sidebtn" onClick={() => replaceImageInputRef.current?.click()}>
                替换图片
              </button>
              <button type="button" className="lab-sidebtn" onClick={handleDuplicate}>
                复制对象
              </button>
              <button type="button" className="lab-sidebtn" onClick={handleDownloadImages}>
                下载图片
              </button>
              <button type="button" className="lab-sidebtn lab-sidebtn-danger" onClick={handleDelete}>
                删除对象
              </button>
            </div>
            <input ref={replaceImageInputRef} type="file" accept="image/*" hidden onChange={handleReplaceImage} />
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
  const store = snapshot?.store || snapshot?.document
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

  const insertTrackerRef = React.useRef({ col: 0, lastMaxX: 0, rowTopY: 0, rowMaxH: 0 })
  // 清除画布时重置插入位置
  React.useEffect(() => {
    insertTrackerRef.current = { col: 0, lastMaxX: 0, rowTopY: 0, rowMaxH: 0 }
  }, [clearCanvas])

  const insertImage = React.useCallback(
    async ({ url, mode, name }: { url: string; mode?: 'image' | 'background'; name?: string }) => {
      const viewport = editor.getViewportPageBounds()
      const spacing = 32
      const MAX_COLS = 5

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
        x: viewport.center.x - size.w / 2,
        y: viewport.center.y - size.h / 2,
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
      })
      editor.setSelectedShapes([shapeId])
      const insertedIds = [shapeId]

      // 非背景图：插入后重新定位到网格中，顶部对齐
      if (mode !== 'background') {
        const shape = editor.getShape(shapeId) as TLShape | undefined
        if (shape) {
          const bounds = editor.getShapePageBounds(shape)
          if (bounds) {
            const t = insertTrackerRef.current
            let targetX: number
            let targetY: number

            if (t.col === 0) {
              // 行首：放在视口中心
              targetX = viewport.center.x
              targetY = viewport.center.y
              insertTrackerRef.current = {
                col: 1,
                lastMaxX: 0,  // 会在下面更新
                rowTopY: targetY - bounds.h / 2,
                rowMaxH: bounds.h,
              }
            } else {
              // 同行后续
              targetX = t.lastMaxX + spacing + bounds.w / 2
              targetY = t.rowTopY + bounds.h / 2  // 顶部对齐
            }

            // 换行判断
            if (t.col > 0 && t.col < MAX_COLS) {
              // 继续当前行
            } else if (t.col >= MAX_COLS) {
              // 换行
              targetX = viewport.center.x
              targetY = t.rowTopY + t.rowMaxH + spacing + bounds.h / 2
              insertTrackerRef.current = {
                col: 0,
                lastMaxX: 0,
                rowTopY: targetY - bounds.h / 2,
                rowMaxH: bounds.h,
              }
            }

            // 移动 shape 到目标位置
            editor.updateShapes([{
              id: shape.id,
              type: shape.type,
              x: targetX - bounds.w / 2,
              y: targetY - bounds.h / 2,
            } as any])

            // 更新追踪
            const newBounds = editor.getShapePageBounds(shape)
            if (newBounds) {
              const t2 = insertTrackerRef.current
              insertTrackerRef.current = {
                col: t2.col + 1,
                lastMaxX: newBounds.maxX,
                rowTopY: t2.rowTopY,
                rowMaxH: Math.max(t2.rowMaxH, newBounds.height),
              }
            }
          }
        }
      }

      if (mode === 'background') {
        const shape = editor.getOnlySelectedShape()
        if (!shape || shape.type !== 'image') return
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
      }
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
      const cleanUrls = urls.filter(Boolean)
      if (!cleanUrls.length) return

      if (cleanUrls.length === 1 || mode === 'background') {
        await insertImage({ url: cleanUrls[0], mode, name })
        return
      }

      const insertedShapeIds: string[] = []
      for (let i = 0; i < cleanUrls.length; i++) {
        await insertImage({
          url: cleanUrls[i],
          mode: 'image',
          name: cleanUrls.length > 1 ? `${name || '生成结果'} ${i + 1}` : name,
        })
        const ids = editor.getSelectedShapeIds()
        if (ids.length) insertedShapeIds.push(ids[0])
      }

      const shapes = insertedShapeIds
        .map((id) => editor.getShape(id as any))
        .filter(Boolean) as TLShape[]
      if (!shapes.length) return

      const viewport = editor.getViewportPageBounds()
      const spacing = 32
      const cols = Math.max(1, Math.min(3, Math.ceil(Math.sqrt(shapes.length))))
      const rows = Math.ceil(shapes.length / cols)

      const widths = new Array(cols).fill(0)
      const heights = new Array(rows).fill(0)

      shapes.forEach((shape, index) => {
        const bounds = editor.getShapePageBounds(shape)
        if (!bounds) return
        const col = index % cols
        const row = Math.floor(index / cols)
        widths[col] = Math.max(widths[col], bounds.width)
        heights[row] = Math.max(heights[row], bounds.height)
      })

      const totalWidth = widths.reduce((sum, w) => sum + w, 0) + spacing * (cols - 1)
      const totalHeight = heights.reduce((sum, h) => sum + h, 0) + spacing * (rows - 1)

      const startX = viewport.center.x - totalWidth / 2
      const startY = viewport.center.y - totalHeight / 2

      const updates: any[] = []
      shapes.forEach((shape, index) => {
        const bounds = editor.getShapePageBounds(shape)
        if (!bounds) return
        const col = index % cols
        const row = Math.floor(index / cols)
        const x =
          startX +
          widths.slice(0, col).reduce((sum, w) => sum + w, 0) +
          spacing * col +
          (widths[col] - bounds.width) / 2
        const y =
          startY +
          heights.slice(0, row).reduce((sum, h) => sum + h, 0) +
          spacing * row +
          (heights[row] - bounds.height) / 2

        updates.push({
          id: shape.id,
          type: shape.type,
          x,
          y,
        })
      })

      if (updates.length) {
        editor.updateShapes(updates)
        ;(editor as any).setSelectedShapes(insertedShapeIds)
        editor.zoomToFit({ animation: { duration: 0 } })
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
          editor.createPage(pageName)
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
          await insertImages({
            urls,
            mode: data.mode === 'background' ? 'background' : 'image',
            name: data.name,
          })
          window.parent.postMessage({ type: 'designflow:editor-inserted', mode: data.mode || 'image', urls }, '*')
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
        const store = snapshot.store || snapshot.document
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
        const store = snapshot.store || snapshot.document
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
          const store = data.snapshot.store || data.snapshot.document
          if (store && typeof store === 'object' && Object.keys(store).length > 0) {
            editor.loadSnapshot(normalizeImageShapesInSnapshot(data.snapshot))
          }
        }
      } catch (e) {}
    }

    loadSnapshot()

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
  }, [editor])

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
          <Tldraw onMount={handleMount} components={components} locale="zh-cn" assetUrls={assetUrls}>
            <EditorSurface />
          </Tldraw>
        </div>
      </div>
    </div>
  )
}

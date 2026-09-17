import React, { useEffect, useRef, useState, useCallback } from 'react'
import { CanvasGrid } from './components/CanvasGrid'
import { FrameShape } from './components/FrameShape'
import { ImageShape } from './components/ImageShape'
import { TextShape } from './components/TextShape'
import { SelectionOverlay } from './components/SelectionOverlay'
import { CanvasZoomBar } from './components/CanvasZoomBar'
import { Minimap } from './components/Minimap'
import { TopBar } from './components/TopBar'
import { BottomToolbar } from './components/BottomToolbar'
import { ContextualToolbar } from './components/ContextualToolbar'
import { OutpaintingOverlay } from './components/OutpaintingOverlay'
import { MarqueeSelection } from './components/MarqueeSelection'
import { ContextMenu, type ContextMenuState } from './components/ContextMenu'
import { ImportProductModal } from './components/ImportProductModal'
import { ImagePropertiesModal } from './components/ImagePropertiesModal'
import { SnapGuides } from './components/SnapGuides'
import type { SnapLine } from './utils/snapping'
import type { OutpaintMargins } from './types'
import { useViewportStore } from './store/viewportStore'
import { useCanvasStore } from './store/canvasStore'
import { useHistoryStore } from './store/historyStore'
import { useAIOperationStore } from './store/aiOperationStore'
import { runOutpainting, getImageDimensions } from './services/aiImageService'
import { convertLegacyTldrawSnapshot } from './compat/legacyTldraw'
import { loadImagesFromFiles } from './utils/imageLoader'

const editorUserId = new URLSearchParams(window.location.search).get('user_id') || ''
const editorSnapshotUrl = `/editor/snapshot?user_id=${encodeURIComponent(editorUserId)}`

export function App() {
  const {
    zoom,
    panX,
    panY,
    isSpacePressed,
    isPanning,
    setSpacePressed,
    setIsPanning,
    panBy,
    zoomAt,
    screenToCanvas,
  } = useViewportStore()

  const {
    pages,
    activePageId,
    frames,
    images,
    texts,
    selectedIds,
    selectedType,
    activeTool,
    setActiveTool,
    setSelected,
    toggleSelected,
    clearSelection,
    deleteSelected,
    duplicateSelected,
    selectAll,
    createPage,
    renamePage,
    addText,
    addImage,
    addImages,
    insertImagesAuto,
    revision,
    isDirty,
    editSequence,
    markSaved,
    loadDocument,
    restoreHistoryDocument,
    mergeConflictDocument,
    getDocument,
  } = useCanvasStore()

  const undo = useHistoryStore((s) => s.undo)
  const redo = useHistoryStore((s) => s.redo)

  const containerRef = useRef<HTMLDivElement>(null)
  const isMouseDownRef = useRef(false)
  const lastMousePosRef = useRef({ x: 0, y: 0 })
  const mousePosRef = useRef<{ x: number; y: number } | null>(null)
  const snapshotHydratedRef = useRef(false)
  const pendingHostCommandsRef = useRef<any[]>([])
  const isConflictRef = useRef(false)
  const isResolvingConflictRef = useRef(false)
  const conflictRetryTimerRef = useRef<any>(null)
  const saveInFlightRef = useRef(false)
  const autoSaveRetryTimerRef = useRef<any>(null)
  const wheelTimerRef = useRef<any>(null)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const [snapshotStatus, setSnapshotStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const claimOperation = useAIOperationStore((s) => s.claimOperation)
  const updateOperation = useAIOperationStore((s) => s.updateOperation)
  const releaseOperation = useAIOperationStore((s) => s.releaseOperation)
  const aiState = useAIOperationStore((s) => s.state)

  // 扩图状态与边距
  const [outpaintingImageId, setOutpaintingImageId] = useState<string | null>(null)
  const [outpaintMargins, setOutpaintMargins] = useState<OutpaintMargins>({
    top: 120,
    right: 120,
    bottom: 120,
    left: 120,
  })

  // 框选状态
  const [marqueeStart, setMarqueeStart] = useState<{ x: number; y: number } | null>(null)
  const [marqueeCurrent, setMarqueeCurrent] = useState<{ x: number; y: number } | null>(null)

  // 右键菜单与吸附参考线状态
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0 })
  const [importModalState, setImportModalState] = useState<{
    visible: boolean
    targetPos: { x: number; y: number } | null
  }>({ visible: false, targetPos: null })
  const [propertiesModalImage, setPropertiesModalImage] = useState<any>(null)
  const [snapLines, setSnapLines] = useState<SnapLine[]>([])
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const dragDepthRef = useRef(0)

  const handleStartOutpainting = useCallback((id: string) => {
    setOutpaintingImageId(id)
    setOutpaintMargins({
      top: 120,
      right: 120,
      bottom: 120,
      left: 120,
    })
  }, [])

  const handleCancelOutpainting = useCallback(() => {
    setOutpaintingImageId(null)
  }, [])

  const handleExecuteOutpainting = useCallback(async () => {
    if (!outpaintingImageId) return
    const target = images.find((im) => im.id === outpaintingImageId)
    if (!target) return

    const totalOutpaint = outpaintMargins.top + outpaintMargins.right + outpaintMargins.bottom + outpaintMargins.left
    if (totalOutpaint <= 0) {
      alert('请先向外拖拽扩图手柄以设定扩展边距')
      return
    }

    if (!claimOperation('outpainting', '正在准备扩图...')) {
      alert('已有 AI 任务在进行中，请等待完成')
      return
    }

    try {
      // 1. 获取原图真实物理尺寸 (naturalWidth / naturalHeight)
      let naturalW = target.naturalWidth
      let naturalH = target.naturalHeight
      if (!naturalW || !naturalH) {
        try {
          const dims = await getImageDimensions(target.url)
          naturalW = dims.width
          naturalH = dims.height
        } catch {
          naturalW = target.width
          naturalH = target.height
        }
      }

      // 2. 计算画布显示尺寸到原图物理像素的比例
      const scaleX = (naturalW || target.width) / target.width
      const scaleY = (naturalH || target.height) / target.height

      // 3. 将画布拉伸的视觉边距精确换算为原图物理像素边距
      const naturalMargins: OutpaintMargins = {
        top: Math.max(0, Math.round(outpaintMargins.top * scaleY)),
        right: Math.max(0, Math.round(outpaintMargins.right * scaleX)),
        bottom: Math.max(0, Math.round(outpaintMargins.bottom * scaleY)),
        left: Math.max(0, Math.round(outpaintMargins.left * scaleX)),
      }

      // 4. 以原图原始清晰度向后端提交扩图
      const result = await runOutpainting(
        target.url,
        naturalW,
        naturalH,
        naturalMargins,
        (msg, progress) => {
          updateOperation({ message: msg, progress })
        }
      )

      const newX = target.x - outpaintMargins.left
      const newY = target.y - outpaintMargins.top
      const newWidth = target.width + outpaintMargins.left + outpaintMargins.right
      const newHeight = target.height + outpaintMargins.top + outpaintMargins.bottom

      const newImg = addImage({
        id: 'img-' + Math.random().toString(36).slice(2, 10),
        frameId: target.frameId,
        x: newX,
        y: newY,
        width: newWidth,
        height: newHeight,
        rotation: target.rotation || 0,
        url: result.imageUrl,
        name: `${target.name}-扩图`,
        naturalWidth: result.width,
        naturalHeight: result.height,
        locked: false,
        opacity: 1,
      })

      setOutpaintingImageId(null)
      setSelected([newImg.id], 'image')
    } catch (err: any) {
      alert(`扩图失败: ${err.message}`)
    } finally {
      releaseOperation()
    }
  }, [outpaintingImageId, images, outpaintMargins, claimOperation, updateOperation, releaseOperation, addImage, setSelected])

  // 1. 快捷键监听
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!snapshotHydratedRef.current) return
      // 忽略在输入框内的快捷键
      const isInput = ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)
      if (isInput) return

      if (e.code === 'Space' && !e.repeat) {
        setSpacePressed(true)
      }

      // 退出扩图 (Escape) / 确认扩图 (Enter)
      if (e.key === 'Escape') {
        if (outpaintingImageId) {
          e.preventDefault()
          setOutpaintingImageId(null)
          return
        }
      } else if (e.key === 'Enter') {
        if (outpaintingImageId && aiState.status !== 'running') {
          e.preventDefault()
          handleExecuteOutpainting()
          return
        }
      }

      // 工具快捷键
      if (e.key === 'v' || e.key === 'V') {
        setActiveTool('select')
      } else if (e.key === 'h' || e.key === 'H') {
        setActiveTool('hand')
      } else if (e.key === 'f' || e.key === 'F') {
        setActiveTool('frame')
      } else if (e.key === 't' || e.key === 'T') {
        setActiveTool('text')
      }

      // 撤销 / 重做
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        const doc = getDocument()
        const prev = undo(doc)
        if (prev) restoreHistoryDocument(prev)
      } else if (
        (e.metaKey || e.ctrlKey) &&
        (e.shiftKey && (e.key === 'z' || e.key === 'Z') || e.key === 'y' || e.key === 'Y')
      ) {
        e.preventDefault()
        const doc = getDocument()
        const next = redo(doc)
        if (next) restoreHistoryDocument(next)
      }

      // 复制
      if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault()
        duplicateSelected()
      }

      // 全选
      if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault()
        selectAll()
      }

      // 查看图片属性 (Alt+I / Option+I)
      if (e.altKey && (e.key === 'i' || e.key === 'I')) {
        if (selectedType === 'image' && selectedIds.length === 1) {
          const targetImg = images.find((im) => im.id === selectedIds[0])
          if (targetImg) {
            e.preventDefault()
            setPropertiesModalImage(targetImg)
            return
          }
        }
      }

      // 删除
      if ((e.code === 'Delete' || e.code === 'Backspace') && selectedIds.length > 0) {
        e.preventDefault()
        deleteSelected()
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpacePressed(false)
        setIsPanning(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    // 实时记录鼠标屏幕坐标
    const onMouseMoveWindow = (e: MouseEvent) => {
      mousePosRef.current = { x: e.clientX, y: e.clientY }
    }
    const onMouseLeaveWindow = () => {
      mousePosRef.current = null
    }

    // 剪贴板粘贴图片处理
    const onPasteWindow = async (e: ClipboardEvent) => {
      if (!snapshotHydratedRef.current) return
      const target = e.target as HTMLElement | null
      const isInput =
        target &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)

      const clipboardData = e.clipboardData
      if (!clipboardData) return

      const items = Array.from(clipboardData.items || [])
      const files = Array.from(clipboardData.files || [])

      // 提取图片文件项
      const imageFiles: File[] = []
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const f = item.getAsFile()
          if (f) imageFiles.push(f)
        }
      }
      if (imageFiles.length === 0) {
        for (const file of files) {
          if (file.type.startsWith('image/')) {
            imageFiles.push(file)
          }
        }
      }

      // 如果在输入框中且剪贴板没有图片，放行原生文本输入
      if (isInput && imageFiles.length === 0) {
        return
      }

      // 1. 处理剪贴板图片文件（截图或复制的文件，支持多张，自动走网格流式排版）
      if (imageFiles.length > 0) {
        e.preventDefault()
        e.stopPropagation()

        loadImagesFromFiles(imageFiles).then((loaded) => {
          if (loaded.length > 0) {
            insertImagesAuto(loaded)
          }
        })
        return
      }

      // 2. 处理剪贴板纯文本为图片 URL 的情况
      const text = (clipboardData.getData('text/plain') || '').trim()
      const isImageUrl = (url: string) => {
        if (!url) return false
        if (url.startsWith('data:image/')) return true
        if (/^\/(ai-images|output|results|avatars|products\/reference-image|products\/mock-image)/.test(url)) return true
        if (/^https?:\/\/.+\.(png|jpe?g|webp|gif|svg|bmp)(\?.*)?$/i.test(url)) return true
        return false
      }

      if (text && isImageUrl(text) && !isInput) {
        e.preventDefault()
        e.stopPropagation()

        const screenCenter = mousePosRef.current || {
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        }
        const center = screenToCanvas(screenCenter)

        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => {
          const MAX_DIM = 800
          const nw = img.naturalWidth || img.width || 400
          const nh = img.naturalHeight || img.height || 400
          const scale = Math.min(1, MAX_DIM / Math.max(nw, nh))
          const w = Math.round(nw * scale)
          const h = Math.round(nh * scale)

          addImages([
            {
              id: 'img-' + Math.random().toString(36).slice(2, 10),
              frameId: null,
              x: Math.round(center.x - w / 2),
              y: Math.round(center.y - h / 2),
              width: w,
              height: h,
              rotation: 0,
              url: text,
              name: '粘贴图片',
              locked: false,
              opacity: 1,
            },
          ])
        }
        img.onerror = () => {
          console.warn('[Canvas] 粘贴图片链接加载失败:', text)
        }
        img.src = text
      }
    }

    window.addEventListener('mousemove', onMouseMoveWindow)
    window.addEventListener('mouseleave', onMouseLeaveWindow)
    window.addEventListener('paste', onPasteWindow)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('mousemove', onMouseMoveWindow)
      window.removeEventListener('mouseleave', onMouseLeaveWindow)
      window.removeEventListener('paste', onPasteWindow)
    }
  }, [
    selectedIds,
    selectedType,
    images,
    deleteSelected,
    duplicateSelected,
    selectAll,
    setSpacePressed,
    setIsPanning,
    setActiveTool,
    undo,
    redo,
    getDocument,
    restoreHistoryDocument,
    addImages,
    screenToCanvas,
  ])

  // 1.1 外部多图片文件拖拽置入画布 (Drag & Drop)
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (!snapshotHydratedRef.current) return
      if (e.dataTransfer?.types?.includes('Files')) {
        dragDepthRef.current++
        e.preventDefault()
        setIsDraggingFiles(true)
      }
    }

    const onDragOver = (e: DragEvent) => {
      if (!snapshotHydratedRef.current) return
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault()
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = 'copy'
        }
      }
    }

    const onDragLeave = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        dragDepthRef.current--
        if (dragDepthRef.current <= 0) {
          dragDepthRef.current = 0
          setIsDraggingFiles(false)
        }
      }
    }

    const onDrop = async (e: DragEvent) => {
      if (!snapshotHydratedRef.current) return
      dragDepthRef.current = 0
      setIsDraggingFiles(false)

      const files = e.dataTransfer?.files
      if (!files || files.length === 0) return

      e.preventDefault()
      e.stopPropagation()

      const loaded = await loadImagesFromFiles(files)
      if (loaded.length > 0) {
        insertImagesAuto(loaded)
      }
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)

    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [insertImagesAuto])

  // 2. 原生非 passive 滚轮与手势监听（彻底杜绝放大整个浏览器界面）
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleNativeWheel = (e: WheelEvent) => {
      // 检查滚轮事件是否发生在下拉框、弹出层或具有滚动条的子元素内，避免拦截子区域的原生滚动
      let el = e.target as HTMLElement | null
      while (el && el !== container) {
        const style = window.getComputedStyle(el)
        const overflowY = style.overflowY
        const overflowX = style.overflowX
        const isScrollableY =
          (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
          el.scrollHeight > el.clientHeight
        const isScrollableX =
          (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay') &&
          el.scrollWidth > el.clientWidth

        if (
          isScrollableY ||
          isScrollableX ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'INPUT' ||
          el.tagName === 'SELECT'
        ) {
          return
        }
        el = el.parentElement
      }

      e.preventDefault()
      e.stopPropagation()

      const isCtrlOrMeta = e.ctrlKey || e.metaKey
      if (isCtrlOrMeta) {
        // 触控板捏合或 Ctrl+滚轮：平滑指数缩放
        const factor = Math.exp(-e.deltaY * 0.01)
        zoomAt({ x: e.clientX, y: e.clientY }, factor)
      } else {
        // 双指滑动平移或鼠标常规滚轮
        panBy(-e.deltaX, -e.deltaY)
      }

      // 视角变动后防抖触发存盘
      clearTimeout(wheelTimerRef.current)
      wheelTimerRef.current = setTimeout(() => {
        useCanvasStore.setState((s) => ({ isDirty: true, editSequence: (s.editSequence || 0) + 1 }))
      }, 1000)
    }

    const preventGesture = (e: Event) => {
      e.preventDefault()
    }

    container.addEventListener('wheel', handleNativeWheel, { passive: false })
    container.addEventListener('gesturestart', preventGesture as any, { passive: false })
    container.addEventListener('gesturechange', preventGesture as any, { passive: false })
    container.addEventListener('gestureend', preventGesture as any, { passive: false })

    return () => {
      container.removeEventListener('wheel', handleNativeWheel)
      container.removeEventListener('gesturestart', preventGesture as any)
      container.removeEventListener('gesturechange', preventGesture as any)
      container.removeEventListener('gestureend', preventGesture as any)
    }
  }, [zoomAt, panBy])

  // 3. 画布背景拖拽平移 & 框选
  const handleMouseDown = (e: React.MouseEvent) => {
    if (contextMenu.visible) {
      setContextMenu((m) => ({ ...m, visible: false }))
    }

    // 中键、空格或当前是抓手工具：触发平移
    if (e.button === 1 || isSpacePressed || activeTool === 'hand') {
      isMouseDownRef.current = true
      setIsPanning(true)
      lastMousePosRef.current = { x: e.clientX, y: e.clientY }
      return
    }

    // 在空白区域按下
    const isCanvasBg =
      e.target === containerRef.current ||
      (e.target as HTMLElement).getAttribute('data-canvas-bg') === 'true'
    if (isCanvasBg) {
      clearSelection()
      setOutpaintingImageId(null)

      if (activeTool === 'text') {
        const pt = screenToCanvas({ x: e.clientX, y: e.clientY })
        addText({
          x: Math.round(pt.x),
          y: Math.round(pt.y),
        })
        setActiveTool('select')
        return
      }

      if (activeTool === 'select') {
        // 开启框选
        setMarqueeStart({ x: e.clientX, y: e.clientY })
        setMarqueeCurrent({ x: e.clientX, y: e.clientY })
      }
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning || isSpacePressed) {
      const dx = e.clientX - lastMousePosRef.current.x
      const dy = e.clientY - lastMousePosRef.current.y
      lastMousePosRef.current = { x: e.clientX, y: e.clientY }
      panBy(dx, dy)
      return
    }

    if (marqueeStart) {
      setMarqueeCurrent({ x: e.clientX, y: e.clientY })
    }
  }

  const handleMouseUp = () => {
    if (isPanning) {
      clearTimeout(wheelTimerRef.current)
      wheelTimerRef.current = setTimeout(() => {
        useCanvasStore.setState((s) => ({ isDirty: true, editSequence: (s.editSequence || 0) + 1 }))
      }, 1000)
    }

    isMouseDownRef.current = false
    setIsPanning(false)

    // 框选结束判定
    if (marqueeStart && marqueeCurrent) {
      const sx = Math.min(marqueeStart.x, marqueeCurrent.x)
      const sy = Math.min(marqueeStart.y, marqueeCurrent.y)
      const sw = Math.abs(marqueeCurrent.x - marqueeStart.x)
      const sh = Math.abs(marqueeCurrent.y - marqueeStart.y)

      if (sw > 6 || sh > 6) {
        // 转换为画布世界坐标系
        const topLeft = screenToCanvas({ x: sx, y: sy })
        const bottomRight = screenToCanvas({ x: sx + sw, y: sy + sh })

        const pageImages = images.filter((im) => im.pageId === activePageId)
        const hitImageIds = pageImages
          .filter((im) => {
            const imR = im.x + im.width
            const imB = im.y + im.height
            return !(
              imR < topLeft.x ||
              im.x > bottomRight.x ||
              imB < topLeft.y ||
              im.y > bottomRight.y
            )
          })
          .map((im) => im.id)

        if (hitImageIds.length > 0) {
          setSelected(hitImageIds, 'image')
        }
      }

      setMarqueeStart(null)
      setMarqueeCurrent(null)
    }
  }

  // 4. 恢复快照
  useEffect(() => {
    let active = true
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const drainPendingCommandsAndNotify = () => {
      snapshotHydratedRef.current = true
      setSnapshotStatus('ready')
      const queued = pendingHostCommandsRef.current
      pendingHostCommandsRef.current = []
      for (const cmd of queued) {
        if (cmd.type === 'designflow:insert-image') {
          const items: any[] = Array.isArray(cmd.images) && cmd.images.length
            ? cmd.images
            : Array.isArray(cmd.urls) && cmd.urls.length
            ? cmd.urls
            : cmd.url
            ? [cmd.url]
            : []
          if (items.length > 0) {
            insertImagesAuto(items, cmd.mode, cmd.name)
            const insertedUrls = items.map((it) => (typeof it === 'string' ? it : it?.url || ''))
            window.parent.postMessage({ type: 'designflow:editor-inserted', urls: insertedUrls, mode: cmd.mode }, '*')
          }
        } else if (cmd.type === 'designflow:new-canvas') {
          const { activePageId, images, texts } = useCanvasStore.getState()
          const pageImages = images.filter((im) => im.pageId === activePageId)
          const pageTexts = texts.filter((t) => t.pageId === activePageId)
          if (pageImages.length === 0 && pageTexts.length === 0) {
            renamePage(activePageId, cmd.pageName || '画板 1')
          } else {
            createPage(cmd.pageName)
          }
        } else if (cmd.type === 'designflow:set-page-name' && cmd.name) {
          renamePage(useCanvasStore.getState().activePageId, cmd.name)
        }
      }
      notifyReady()
    }

    if (!editorUserId) {
      drainPendingCommandsAndNotify()
      return
    }

    const scheduleRetry = () => {
      if (!active) return
      setSnapshotStatus('error')
      retryTimer = setTimeout(loadSnapshot, 2000)
    }

    const loadSnapshot = async () => {
      try {
        const response = await fetch(editorSnapshotUrl)
        if (!active) return
        if (!response.ok) {
          if (response.status === 401) {
            window.parent.postMessage({ type: 'designflow:auth-required' }, '*')
          }
          throw new Error(`快照请求失败 (${response.status})`)
        }
        const data = await response.json()
        if (!active) return
        if (data.snapshot) {
          const parsed = typeof data.snapshot === 'string' ? JSON.parse(data.snapshot) : data.snapshot
          const converted = convertLegacyTldrawSnapshot(parsed)
          if (!converted) throw new Error('无法识别快照格式')
          loadDocument(converted, Number(data.revision || 0))
        } else {
          loadDocument(useCanvasStore.getState().getDocument(), Number(data.revision || 0))
        }
        drainPendingCommandsAndNotify()
      } catch (err) {
        console.warn('[Canvas] 快照加载失败:', err)
        scheduleRetry()
      }
    }

    loadSnapshot()

    return () => {
      active = false
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [insertImagesAuto, createPage, renamePage, loadDocument])

  // 冲突解决控制器：生命周期独立于防抖保存 effect，重试循环不受每次编辑 cleanup 的影响
  const resolveConflict = useCallback(() => {
    if (!editorUserId || !isConflictRef.current) {
      isResolvingConflictRef.current = false
      return
    }

    isResolvingConflictRef.current = true

    fetch(editorSnapshotUrl)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!isConflictRef.current) {
          isResolvingConflictRef.current = false
          return
        }
        if (data && data.snapshot) {
          try {
            const parsed = typeof data.snapshot === 'string' ? JSON.parse(data.snapshot) : data.snapshot
            const converted = convertLegacyTldrawSnapshot(parsed)
            if (converted) {
              isConflictRef.current = false
              isResolvingConflictRef.current = false
              clearTimeout(conflictRetryTimerRef.current)
              mergeConflictDocument(converted, Number(data.revision || useCanvasStore.getState().revision + 1))
              setSaveStatus('saving')
              return
            }
          } catch (err) {
            console.warn('[Canvas] 冲突快照解析错误:', err)
          }
        }
        // 远端快照尚未拉取成功，排定独立重试
        if (isConflictRef.current) {
          clearTimeout(conflictRetryTimerRef.current)
          conflictRetryTimerRef.current = setTimeout(resolveConflict, 2000)
        }
      })
      .catch((err) => {
        console.warn('[Canvas] 冲突快照拉取网络失败:', err)
        if (isConflictRef.current) {
          clearTimeout(conflictRetryTimerRef.current)
          conflictRetryTimerRef.current = setTimeout(resolveConflict, 2000)
        }
      })
  }, [mergeConflictDocument])

  const startConflictResolution = useCallback(() => {
    isConflictRef.current = true
    setSaveStatus('error')
    if (isResolvingConflictRef.current) return
    clearTimeout(conflictRetryTimerRef.current)
    resolveConflict()
  }, [resolveConflict])

  // 组件卸载时清理独立冲突定时器
  useEffect(() => {
    return () => {
      clearTimeout(conflictRetryTimerRef.current)
    }
  }, [])

  // 5. 自动防抖存盘
  useEffect(() => {
    if (!isDirty || !snapshotHydratedRef.current || !editorUserId) return
    if (isConflictRef.current) return // 冲突等待处理中时暂停主动保存

    setSaveStatus('saving')
    const timer = setTimeout(() => {
      if (saveInFlightRef.current) {
        // 前一个保存请求在途，重新递增序列号排入下一轮调度
        useCanvasStore.setState((s) => ({ editSequence: (s.editSequence || 0) + 1 }))
        return
      }

      const state = useCanvasStore.getState()
      const saveSeq = state.editSequence
      const saveIntent = state.lastSaveIntent || 'update'
      const baseRev = state.revision
      const doc = getDocument()

      saveInFlightRef.current = true

      fetch(editorSnapshotUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snapshot: JSON.stringify(doc),
          base_revision: baseRev,
          intent: saveIntent,
        }),
      })
        .then((res) => {
          if (res.ok) {
            isConflictRef.current = false
            clearTimeout(autoSaveRetryTimerRef.current)
            return res.json().then((d) => {
              markSaved(Number(d.revision || baseRev + 1), saveSeq, doc)
              setSaveStatus('saved')
            })
          } else if (res.status === 401) {
            console.warn('[Canvas] 会话未认证或已过期 (401)，保存未执行，保留本地修改')
            setSaveStatus('error')
            window.parent.postMessage({ type: 'designflow:auth-required' }, '*')
            clearTimeout(autoSaveRetryTimerRef.current)
            autoSaveRetryTimerRef.current = setTimeout(() => {
              if (useCanvasStore.getState().isDirty && snapshotHydratedRef.current && !isConflictRef.current) {
                useCanvasStore.setState((s) => ({ editSequence: (s.editSequence || 0) + 1 }))
              }
            }, 4000)
          } else if (res.status === 409) {
            console.warn('[Canvas] 检测到服务端版本冲突 (409)，启动独立冲突解决控制器')
            startConflictResolution()
          } else {
            setSaveStatus('error')
            clearTimeout(autoSaveRetryTimerRef.current)
            autoSaveRetryTimerRef.current = setTimeout(() => {
              if (useCanvasStore.getState().isDirty && snapshotHydratedRef.current && !isConflictRef.current) {
                useCanvasStore.setState((s) => ({ editSequence: (s.editSequence || 0) + 1 }))
              }
            }, 4000)
          }
        })
        .catch((err) => {
          console.warn('[Canvas] 保存网络失败:', err)
          setSaveStatus('error')
          clearTimeout(autoSaveRetryTimerRef.current)
          autoSaveRetryTimerRef.current = setTimeout(() => {
            if (useCanvasStore.getState().isDirty && snapshotHydratedRef.current && !isConflictRef.current) {
              useCanvasStore.setState((s) => ({ editSequence: (s.editSequence || 0) + 1 }))
            }
          }, 4000)
        })
        .finally(() => {
          saveInFlightRef.current = false
        })
    }, 800)

    return () => {
      clearTimeout(timer)
      clearTimeout(autoSaveRetryTimerRef.current)
    }
  }, [isDirty, editSequence, revision, getDocument, markSaved, startConflictResolution])

  // 页面卸载或刷新时，如有未保存的修改，发起 keepalive 同步存盘，避免刷新丢数据
  useEffect(() => {
    const handleBeforeUnload = () => {
      const state = useCanvasStore.getState()
      if (!state.isDirty || !snapshotHydratedRef.current || !editorUserId || isConflictRef.current) {
        return
      }
      const doc = getDocument()
      const payload = JSON.stringify({
        snapshot: JSON.stringify(doc),
        base_revision: state.revision,
        intent: state.lastSaveIntent || 'update',
      })
      try {
        fetch(editorSnapshotUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
        }).catch(() => {})
      } catch (e) {}
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [getDocument])

  // 6. 主站握手与 postMessage
  const notifyReady = useCallback(() => {
    window.parent.postMessage({ type: 'designflow:editor-ready' }, '*')
  }, [])

  useEffect(() => {
    const handleHostMessage = (e: MessageEvent) => {
      const data = e.data
      if (!data || typeof data !== 'object') return

      if (data.type === 'designflow:ping') {
        if (snapshotHydratedRef.current) {
          notifyReady()
        }
        return
      }

      if (data.type === 'designflow:auth-restored') {
        if (isConflictRef.current) {
          startConflictResolution()
        } else {
          useCanvasStore.setState((s) => ({
            editSequence: (s.editSequence || 0) + 1,
            isDirty: true,
          }))
        }
        return
      }

      if (data.type === 'designflow:insert-image') {
        if (!snapshotHydratedRef.current) {
          pendingHostCommandsRef.current.push(data)
          return
        }
        const items: any[] = Array.isArray(data.images) && data.images.length
          ? data.images
          : Array.isArray(data.urls) && data.urls.length
          ? data.urls
          : data.url
          ? [data.url]
          : []
        if (items.length > 0) {
          insertImagesAuto(items, data.mode, data.name)
          const insertedUrls = items.map((it) => (typeof it === 'string' ? it : it?.url || ''))
          window.parent.postMessage({ type: 'designflow:editor-inserted', urls: insertedUrls, mode: data.mode }, '*')
        }
        return
      }

      if (data.type === 'designflow:new-canvas') {
        if (!snapshotHydratedRef.current) {
          pendingHostCommandsRef.current.push(data)
          return
        }
        const { activePageId: currPageId, images: currImages, texts: currTexts } = useCanvasStore.getState()
        const pageImages = currImages.filter((im) => im.pageId === currPageId)
        const pageTexts = currTexts.filter((t) => t.pageId === currPageId)
        if (pageImages.length === 0 && pageTexts.length === 0) {
          renamePage(currPageId, data.pageName || '画板 1')
        } else {
          createPage(data.pageName)
        }
        return
      }

      if (data.type === 'designflow:set-page-name') {
        if (!snapshotHydratedRef.current) {
          pendingHostCommandsRef.current.push(data)
          return
        }
        if (data.name) {
          renamePage(activePageId, data.name)
        }
        return
      }
    }

    window.addEventListener('message', handleHostMessage)
    return () => window.removeEventListener('message', handleHostMessage)
  }, [notifyReady, insertImagesAuto, createPage, renamePage, activePageId])

  // 7. 自动同步画布选中的图片给主站聊天框作为参考图；点选空白或非图片时，通知主站清空自动参考图
  useEffect(() => {
    if (!snapshotHydratedRef.current) return

    if (selectedType === 'image' && selectedIds.length > 0) {
      const selectedImages = images.filter((im) => im.pageId === activePageId && selectedIds.includes(im.id))
      if (selectedImages.length > 0) {
        const payload = selectedImages.map((im, idx) => ({
          src: im.url,
          name: im.name || `reference-${idx + 1}.png`,
        }))
        window.parent.postMessage(
          {
            type: 'designflow:use-as-reference',
            images: payload,
          },
          '*'
        )
        return
      }
    }

    // 选区为空或非图片时，通知主站清空画布自动参考图（不影响用户手动上传的参考图）
    window.parent.postMessage(
      {
        type: 'designflow:use-as-reference',
        images: [],
      },
      '*'
    )
  }, [selectedIds, selectedType, images, activePageId])

  // 过滤当前活动页面的画板和图片
  const currentFrames = frames.filter((f) => f.pageId === activePageId)
  const currentImages = images.filter((im) => im.pageId === activePageId)
  const currentTexts = (texts || []).filter((t) => t.pageId === activePageId)

  // 正在扩图的目标图元
  const outpaintingTarget = currentImages.find((im) => im.id === outpaintingImageId)

  // 单选中的第一张图片（用于挂载控制手柄）
  const singleSelectedImage =
    selectedType === 'image' && selectedIds.length === 1
      ? currentImages.find((im) => im.id === selectedIds[0])
      : null

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onContextMenu={(e) => {
        e.preventDefault()
        const isCanvasBackground =
          e.target === containerRef.current ||
          (e.target as HTMLElement).getAttribute('data-canvas-bg') === 'true'
        if (isCanvasBackground) {
          clearSelection()
        }
        setContextMenu({
          visible: true,
          x: e.clientX,
          y: e.clientY,
          targetType: 'canvas',
        })
      }}
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        touchAction: 'none',
        overscrollBehavior: 'none',
        cursor: isPanning || isSpacePressed || activeTool === 'hand' ? 'grab' : activeTool === 'text' ? 'text' : 'default',
        backgroundColor: '#f8fafc',
      }}
    >
      {/* 顶部多画板标签栏与存盘指示 */}
      <TopBar saveStatus={saveStatus} />

      {/* 点阵网格背景 */}
      <CanvasGrid zoom={zoom} panX={panX} panY={panY} />

      {/* 无限视口容器（应用矩阵变换） */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
          transformOrigin: '0 0',
          transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
          pointerEvents: 'none',
        }}
      >
        {/* 画板列表 */}
        {currentFrames.map((frame) => (
          <div key={frame.id} style={{ pointerEvents: 'auto' }}>
            <FrameShape
              frame={frame}
              isSelected={selectedType === 'frame' && selectedIds.includes(frame.id)}
              onSelect={() => setSelected([frame.id], 'frame')}
              onContextMenu={(e) => {
                setSelected([frame.id], 'frame')
                setContextMenu({
                  visible: true,
                  x: e.clientX,
                  y: e.clientY,
                  targetId: frame.id,
                  targetType: 'frame',
                })
              }}
            />
          </div>
        ))}

        {/* 图片图元列表 */}
        {currentImages.map((im) => (
          <div key={im.id} style={{ pointerEvents: 'auto' }}>
            <ImageShape
              image={im}
              isSelected={selectedType === 'image' && selectedIds.includes(im.id)}
              isSingleSelected={selectedType === 'image' && selectedIds.length === 1 && selectedIds[0] === im.id}
              onSelect={(isShift) => {
                if (isShift) {
                  toggleSelected(im.id, 'image')
                } else {
                  setSelected([im.id], 'image')
                }
              }}
              onContextMenu={(e) => {
                if (!selectedIds.includes(im.id)) {
                  setSelected([im.id], 'image')
                }
                setContextMenu({
                  visible: true,
                  x: e.clientX,
                  y: e.clientY,
                  targetId: im.id,
                  targetType: 'image',
                })
              }}
            />
          </div>
        ))}

        {/* 文本图元列表 */}
        {currentTexts.map((txt) => (
          <div key={txt.id} style={{ pointerEvents: 'auto' }}>
            <TextShape
              text={txt}
              isSelected={selectedType === 'text' && selectedIds.includes(txt.id)}
              onSelect={(isShift) => {
                if (isShift) {
                  toggleSelected(txt.id, 'text')
                } else {
                  setSelected([txt.id], 'text')
                }
              }}
              onContextMenu={(e) => {
                if (!selectedIds.includes(txt.id)) {
                  setSelected([txt.id], 'text')
                }
                setContextMenu({
                  visible: true,
                  x: e.clientX,
                  y: e.clientY,
                  targetId: txt.id,
                  targetType: 'text',
                })
              }}
            />
          </div>
        ))}

        {/* 智能磁吸辅助线（位于世界坐标系） */}
        <SnapGuides lines={snapLines} />

        {/* 单选中图片的变换拉伸手柄 Overlay */}
        {singleSelectedImage && !outpaintingImageId && (
          <SelectionOverlay
            image={singleSelectedImage}
            onSnapLinesChange={setSnapLines}
            onContextMenu={(e) => {
              setContextMenu({
                visible: true,
                x: e.clientX,
                y: e.clientY,
                targetId: singleSelectedImage.id,
                targetType: 'image',
              })
            }}
          />
        )}

        {/* 智能扩图交互外框 */}
        {outpaintingTarget && (
          <OutpaintingOverlay
            image={outpaintingTarget}
            margins={outpaintMargins}
            onMarginsChange={setOutpaintMargins}
            isSubmitting={aiState.status === 'running' && aiState.type === 'outpainting'}
          />
        )}
      </div>

      {/* 框选矩形浮层 */}
      <MarqueeSelection startScreen={marqueeStart} currentScreen={marqueeCurrent} />

      {/* 选中图元的浮动工具条（位于屏幕坐标系） */}
      <ContextualToolbar
        isOutpainting={Boolean(outpaintingImageId)}
        outpaintMargins={outpaintMargins}
        onStartOutpainting={handleStartOutpainting}
        onExecuteOutpainting={handleExecuteOutpainting}
        onCancelOutpainting={handleCancelOutpainting}
      />

      {/* 自定义右键上下文菜单 */}
      <ContextMenu
        menuState={contextMenu}
        onClose={() => setContextMenu((m) => ({ ...m, visible: false }))}
        onOpenImportModal={(screenPos) => {
          const pt = screenToCanvas(screenPos)
          setImportModalState({ visible: true, targetPos: pt })
        }}
        onOpenPropertiesModal={(img) => setPropertiesModalImage(img)}
      />

      {/* 导入产品图输入弹窗 */}
      <ImportProductModal
        visible={importModalState.visible}
        targetPos={importModalState.targetPos}
        onClose={() => setImportModalState((s) => ({ ...s, visible: false }))}
      />

      {/* 图片详细属性及 AI Prompt 弹窗 */}
      {propertiesModalImage && (
        <ImagePropertiesModal
          image={propertiesModalImage}
          onClose={() => setPropertiesModalImage(null)}
        />
      )}

      {/* 竖向浮动右侧工具坞 */}
      <BottomToolbar />

      {/* 左下角鸟瞰图 / Minimap 导航器 */}
      <Minimap />

      {/* 右下角缩放控制条 */}
      <CanvasZoomBar />

      {/* 外部多图拖拽放置指示浮层 */}
      {isDraggingFiles && (
        <div
          style={{
            position: 'absolute',
            inset: 12,
            borderRadius: 16,
            border: '2px dashed #3b82f6',
            backgroundColor: 'rgba(239, 246, 255, 0.76)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            zIndex: 999,
            pointerEvents: 'none',
            color: '#1d4ed8',
            boxShadow: '0 16px 40px rgba(37, 99, 235, 0.12)',
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              backgroundColor: '#dbeafe',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#2563eb',
              boxShadow: '0 4px 14px rgba(37, 99, 235, 0.18)',
            }}
          >
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>松开鼠标，自动排版置入图片</div>
          <div style={{ fontSize: 13, color: '#3b82f6' }}>支持批量多图导入，自动按 4 列流式网格排版并适配视野</div>
        </div>
      )}

      {snapshotStatus !== 'ready' && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 2000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(248, 250, 252, 0.94)',
            color: '#334155',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {snapshotStatus === 'loading' ? '正在加载画板…' : '画板加载失败，正在重试…'}
        </div>
      )}
    </div>
  )
}

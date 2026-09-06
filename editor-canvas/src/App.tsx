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
import { SnapGuides } from './components/SnapGuides'
import type { SnapLine } from './utils/snapping'
import { useViewportStore } from './store/viewportStore'
import { useCanvasStore } from './store/canvasStore'
import { useHistoryStore } from './store/historyStore'
import { convertLegacyTldrawSnapshot } from './compat/legacyTldraw'

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
    insertImagesAuto,
    revision,
    isDirty,
    markSaved,
    loadDocument,
    getDocument,
  } = useCanvasStore()

  const undo = useHistoryStore((s) => s.undo)
  const redo = useHistoryStore((s) => s.redo)

  const containerRef = useRef<HTMLDivElement>(null)
  const isMouseDownRef = useRef(false)
  const lastMousePosRef = useRef({ x: 0, y: 0 })
  const snapshotHydratedRef = useRef(false)
  const wheelTimerRef = useRef<any>(null)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved')

  // 扩图状态
  const [outpaintingImageId, setOutpaintingImageId] = useState<string | null>(null)

  // 框选状态
  const [marqueeStart, setMarqueeStart] = useState<{ x: number; y: number } | null>(null)
  const [marqueeCurrent, setMarqueeCurrent] = useState<{ x: number; y: number } | null>(null)

  // 右键菜单与吸附参考线状态
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0 })
  const [importModalState, setImportModalState] = useState<{
    visible: boolean
    targetPos: { x: number; y: number } | null
  }>({ visible: false, targetPos: null })
  const [snapLines, setSnapLines] = useState<SnapLine[]>([])

  // 1. 快捷键监听
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // 忽略在输入框内的快捷键
      const isInput = ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)
      if (isInput) return

      if (e.code === 'Space' && !e.repeat) {
        setSpacePressed(true)
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
        if (prev) loadDocument(prev)
      } else if (
        (e.metaKey || e.ctrlKey) &&
        (e.shiftKey && (e.key === 'z' || e.key === 'Z') || e.key === 'y' || e.key === 'Y')
      ) {
        e.preventDefault()
        const doc = getDocument()
        const next = redo(doc)
        if (next) loadDocument(next)
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
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [
    selectedIds,
    deleteSelected,
    duplicateSelected,
    selectAll,
    setSpacePressed,
    setIsPanning,
    setActiveTool,
    undo,
    redo,
    getDocument,
    loadDocument,
  ])

  // 2. 原生非 passive 滚轮与手势监听（彻底杜绝放大整个浏览器界面）
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleNativeWheel = (e: WheelEvent) => {
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
        useCanvasStore.setState({ isDirty: true })
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
        useCanvasStore.setState({ isDirty: true })
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
    if (!editorUserId) return
    let active = true

    fetch(editorSnapshotUrl)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data || !data.snapshot) {
          snapshotHydratedRef.current = true
          notifyReady()
          return
        }
        try {
          const parsed = typeof data.snapshot === 'string' ? JSON.parse(data.snapshot) : data.snapshot
          const converted = convertLegacyTldrawSnapshot(parsed)
          if (converted) {
            loadDocument(converted, Number(data.revision || 1))
          }
        } catch (err) {
          console.warn('[Canvas] 快照解析错误:', err)
        } finally {
          snapshotHydratedRef.current = true
          notifyReady()
        }
      })
      .catch((err) => {
        console.warn('[Canvas] 快照加载失败:', err)
        snapshotHydratedRef.current = true
        notifyReady()
      })

    return () => {
      active = false
    }
  }, [])

  // 5. 自动防抖存盘
  useEffect(() => {
    if (!isDirty || !snapshotHydratedRef.current || !editorUserId) return

    setSaveStatus('saving')
    const timer = setTimeout(() => {
      const doc = getDocument()
      fetch(editorSnapshotUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snapshot: JSON.stringify(doc),
          base_revision: revision,
          intent: 'update',
        }),
      })
        .then((res) => {
          if (res.ok) {
            return res.json().then((d) => {
              markSaved(Number(d.revision || revision + 1))
              setSaveStatus('saved')
            })
          } else if (res.status === 401) {
            markSaved(revision)
            setSaveStatus('saved')
          } else {
            res.json().then((d) => {
              const currentRev = d?.detail?.current_revision
              if (currentRev && Number(currentRev) > revision) {
                markSaved(Number(currentRev))
              }
            }).catch(() => {})
            setSaveStatus('error')
          }
        })
        .catch(() => setSaveStatus('error'))
    }, 800)

    return () => clearTimeout(timer)
  }, [isDirty, revision, getDocument, markSaved])

  // 6. 主站握手与 postMessage
  const notifyReady = useCallback(() => {
    window.parent.postMessage({ type: 'designflow:editor-ready' }, '*')
  }, [])

  useEffect(() => {
    const handleHostMessage = (e: MessageEvent) => {
      const data = e.data
      if (!data || typeof data !== 'object') return

      if (data.type === 'designflow:ping') {
        notifyReady()
        return
      }

      if (data.type === 'designflow:insert-image') {
        const urls: string[] = Array.isArray(data.urls) && data.urls.length
          ? data.urls
          : data.url
          ? [data.url]
          : []
        if (urls.length > 0) {
          insertImagesAuto(urls, data.mode, data.name)
          window.parent.postMessage({ type: 'designflow:editor-inserted', urls, mode: data.mode }, '*')
        }
        return
      }

      if (data.type === 'designflow:new-canvas') {
        createPage(data.pageName)
        return
      }

      if (data.type === 'designflow:set-page-name') {
        if (data.name) {
          renamePage(activePageId, data.name)
        }
        return
      }
    }

    window.addEventListener('message', handleHostMessage)
    notifyReady()
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
          />
        )}

        {/* 智能扩图交互外框 */}
        {outpaintingTarget && (
          <OutpaintingOverlay
            image={outpaintingTarget}
            onClose={() => setOutpaintingImageId(null)}
          />
        )}
      </div>

      {/* 框选矩形浮层 */}
      <MarqueeSelection startScreen={marqueeStart} currentScreen={marqueeCurrent} />

      {/* 选中图元的浮动工具条（位于屏幕坐标系） */}
      {!outpaintingImageId && (
        <ContextualToolbar
          onStartOutpainting={(id) => setOutpaintingImageId(id)}
        />
      )}

      {/* 自定义右键上下文菜单 */}
      <ContextMenu
        menuState={contextMenu}
        onClose={() => setContextMenu((m) => ({ ...m, visible: false }))}
        onOpenImportModal={(screenPos) => {
          const pt = screenToCanvas(screenPos)
          setImportModalState({ visible: true, targetPos: pt })
        }}
      />

      {/* 导入产品图输入弹窗 */}
      <ImportProductModal
        visible={importModalState.visible}
        targetPos={importModalState.targetPos}
        onClose={() => setImportModalState((s) => ({ ...s, visible: false }))}
      />

      {/* 竖向浮动右侧工具坞 */}
      <BottomToolbar />

      {/* 左下角鸟瞰图 / Minimap 导航器 */}
      <Minimap />

      {/* 右下角缩放控制条 */}
      <CanvasZoomBar />
    </div>
  )
}

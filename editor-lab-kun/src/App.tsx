import React, { useEffect, useRef, useState, useCallback } from 'react'
import { CanvasGrid } from './components/CanvasGrid'
import { FrameShape } from './components/FrameShape'
import { ImageShape } from './components/ImageShape'
import { SelectionOverlay } from './components/SelectionOverlay'
import { FloatingToolbar } from './components/FloatingToolbar'
import { CanvasZoomBar } from './components/CanvasZoomBar'
import { useViewportStore } from './store/viewportStore'
import { useCanvasStore } from './store/canvasStore'
import { convertLegacyTldrawSnapshot } from './compat/legacyTldraw'

const editorUserId = new URLSearchParams(window.location.search).get('user_id') || ''
const editorSnapshotUrl = `/editor/snapshot?user_id=${encodeURIComponent(editorUserId)}`

export function App() {
  const { zoom, panX, panY, isSpacePressed, isPanning, setSpacePressed, setIsPanning, panBy, zoomAt } =
    useViewportStore()

  const {
    frames,
    images,
    selectedId,
    activeFrameId,
    revision,
    isDirty,
    setSelectedId,
    setActiveFrameId,
    deleteImage,
    insertImageAuto,
    addFrame,
    loadDocument,
    getDocument,
    markSaved,
  } = useCanvasStore()

  const containerRef = useRef<HTMLDivElement>(null)
  const isMouseDownRef = useRef(false)
  const lastMousePosRef = useRef({ x: 0, y: 0 })
  const snapshotHydratedRef = useRef(false)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved')

  // 1. 快捷键监听（空格平移、Delete删除）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        setSpacePressed(true)
      }
      if ((e.code === 'Delete' || e.code === 'Backspace') && selectedId) {
        // 如果焦点在输入框中则不触发删除
        if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return
        deleteImage(selectedId)
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
  }, [selectedId, deleteImage, setSpacePressed, setIsPanning])

  // 2. 滚轮与触控板手势缩放与平移
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault()
      const isCtrlOrMeta = e.ctrlKey || e.metaKey

      if (isCtrlOrMeta) {
        // 缩放
        const factor = e.deltaY < 0 ? 1.08 : 0.92
        zoomAt({ x: e.clientX, y: e.clientY }, factor)
      } else {
        // 触控板滑动平移
        panBy(-e.deltaX, -e.deltaY)
      }
    },
    [zoomAt, panBy]
  )

  // 3. 画布背景拖拽平移（按住空格或中键拖动）
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || isSpacePressed || e.target === containerRef.current) {
      isMouseDownRef.current = true
      setIsPanning(true)
      lastMousePosRef.current = { x: e.clientX, y: e.clientY }
      if (e.target === containerRef.current) {
        setSelectedId(null)
      }
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isMouseDownRef.current) return
    const dx = e.clientX - lastMousePosRef.current.x
    const dy = e.clientY - lastMousePosRef.current.y
    lastMousePosRef.current = { x: e.clientX, y: e.clientY }
    panBy(dx, dy)
  }

  const handleMouseUp = () => {
    isMouseDownRef.current = false
    setIsPanning(false)
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
          console.warn('[KunCanvas] 快照解析错误:', err)
        } finally {
          snapshotHydratedRef.current = true
          notifyReady()
        }
      })
      .catch((err) => {
        console.warn('[KunCanvas] 快照加载失败:', err)
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
            // 未登录状态下演示，降级为本地状态已保持
            markSaved(revision)
            setSaveStatus('saved')
          } else {
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
        const urls: string[] = Array.isArray(data.urls) && data.urls.length ? data.urls : data.url ? [data.url] : []
        urls.forEach((u) => {
          if (u) insertImageAuto(u, data.name)
        })
        window.parent.postMessage({ type: 'designflow:editor-inserted', urls, mode: data.mode }, '*')
        return
      }

      if (data.type === 'designflow:new-canvas') {
        const pageName = data.pageName || '画板 1'
        const existing = frames.find((f) => f.name === pageName)
        if (existing) {
          setActiveFrameId(existing.id)
        } else {
          const nextX = frames.length * 1200
          addFrame({
            id: 'frame-' + Math.random().toString(36).slice(2, 8),
            name: pageName,
            x: nextX,
            y: 0,
            width: 1080,
            height: 1080,
          })
        }
        return
      }
    }

    window.addEventListener('message', handleHostMessage)
    notifyReady()
    return () => window.removeEventListener('message', handleHostMessage)
  }, [frames, notifyReady, insertImageAuto, addFrame, setActiveFrameId])

  const selectedImage = images.find((im) => im.id === selectedId)

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        cursor: isPanning || isSpacePressed ? 'grab' : 'default',
      }}
    >
      {/* 顶部指示条 */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 14,
          zIndex: 80,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 10px',
          backgroundColor: '#ffffff',
          borderRadius: 6,
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          border: '1px solid #e2e8f0',
          fontSize: 11,
          fontWeight: 600,
          color: '#334155',
        }}
      >
        <div style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: '#4f46e5' }} />
        <span>Kun Canvas Demo</span>
        <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 400 }}>
          {saveStatus === 'saving' ? '正在保存...' : saveStatus === 'error' ? '保存异常' : '已保存'}
        </span>
      </div>

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
          pointerEvents: 'none', // 事件由子元素各自捕获
        }}
      >
        {/* 画板列表 */}
        {frames.map((frame) => (
          <div key={frame.id} style={{ pointerEvents: 'auto' }}>
            <FrameShape
              frame={frame}
              isActive={activeFrameId === frame.id}
              onClick={() => {
                setActiveFrameId(frame.id)
                setSelectedId(null)
              }}
            />
          </div>
        ))}

        {/* 图片图元列表 */}
        {images.map((im) => (
          <div key={im.id} style={{ pointerEvents: 'auto' }}>
            <ImageShape image={im} isSelected={selectedId === im.id} onSelect={() => setSelectedId(im.id)} />
          </div>
        ))}

        {/* 选中控制器手柄 Overlay */}
        {selectedImage && <SelectionOverlay image={selectedImage} />}
      </div>

      {/* 选中图元的浮动工具条（位于屏幕坐标系） */}
      {selectedImage && <FloatingToolbar image={selectedImage} />}

      {/* 右下角缩放控制条 */}
      <CanvasZoomBar />
    </div>
  )
}

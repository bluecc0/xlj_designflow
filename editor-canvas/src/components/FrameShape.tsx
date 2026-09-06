import React, { useRef, useState, useEffect } from 'react'
import { Trash2, GripHorizontal } from 'lucide-react'
import type { CanvasFrame, ResizeHandle } from '../types'
import { useCanvasStore } from '../store/canvasStore'
import { useViewportStore } from '../store/viewportStore'

interface Props {
  frame: CanvasFrame
  isSelected: boolean
  onSelect: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}

const FRAME_RESIZE_HANDLES: { pos: ResizeHandle; cursor: string; style: React.CSSProperties }[] = [
  { pos: 'nw', cursor: 'nwse-resize', style: { top: -5, left: -5 } },
  { pos: 'n', cursor: 'ns-resize', style: { top: -5, left: '50%', marginLeft: -5 } },
  { pos: 'ne', cursor: 'nesw-resize', style: { top: -5, right: -5 } },
  { pos: 'e', cursor: 'ew-resize', style: { top: '50%', right: -5, marginTop: -5 } },
  { pos: 'se', cursor: 'nwse-resize', style: { bottom: -5, right: -5 } },
  { pos: 's', cursor: 'ns-resize', style: { bottom: -5, left: '50%', marginLeft: -5 } },
  { pos: 'sw', cursor: 'nesw-resize', style: { bottom: -5, left: -5 } },
  { pos: 'w', cursor: 'ew-resize', style: { top: '50%', left: -5, marginTop: -5 } },
]

export function FrameShape({ frame, isSelected, onSelect, onContextMenu }: Props) {
  const updateFrame = useCanvasStore((s) => s.updateFrame)
  const deleteFrame = useCanvasStore((s) => s.deleteFrame)
  const activeTool = useCanvasStore((s) => s.activeTool)
  const setActiveTool = useCanvasStore((s) => s.setActiveTool)
  const addText = useCanvasStore((s) => s.addText)
  const recalcFrameAttachment = useCanvasStore((s) => s.recalcFrameAttachment)
  const images = useCanvasStore((s) => s.images)
  const texts = useCanvasStore((s) => s.texts)

  const childImagesCount = images.filter((im) => im.frameId === frame.id).length
  const childTextsCount = (texts || []).filter((t) => t.frameId === frame.id).length
  const totalChildren = childImagesCount + childTextsCount

  const zoom = useViewportStore((s) => s.zoom)
  const screenToCanvas = useViewportStore((s) => s.screenToCanvas)

  const [isEditingName, setIsEditingName] = useState(false)
  const [nameVal, setNameVal] = useState(frame.name)
  const isDraggingRef = useRef(false)
  const dragStartPosRef = useRef({ x: 0, y: 0 })
  const frameStartPosRef = useRef({ x: 0, y: 0 })

  // 画板尺寸拉伸状态
  const [activeResizeHandle, setActiveResizeHandle] = useState<ResizeHandle | null>(null)
  const resizeStartRef = useRef<{
    clientX: number
    clientY: number
    fx: number
    fy: number
    fw: number
    fh: number
    aspect: number
  }>({ clientX: 0, clientY: 0, fx: 0, fy: 0, fw: 0, fh: 0, aspect: 1 })

  // 1. 拖拽画板标题移动画板
  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation()
    onSelect()
    isDraggingRef.current = true
    dragStartPosRef.current = { x: e.clientX, y: e.clientY }
    frameStartPosRef.current = { x: frame.x, y: frame.y }

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return
      const dx = (moveEvent.clientX - dragStartPosRef.current.x) / zoom
      const dy = (moveEvent.clientY - dragStartPosRef.current.y) / zoom
      updateFrame(
        frame.id,
        {
          x: Math.round(frameStartPosRef.current.x + dx),
          y: Math.round(frameStartPosRef.current.y + dy),
        },
        true // 同步移动内部包含的图片与文本
      )
    }

    const onMouseUp = () => {
      isDraggingRef.current = false
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  // 2. 拖拽手柄拉伸画板尺寸（放大/缩小）
  const handleResizeHandleMouseDown = (handle: ResizeHandle, e: React.MouseEvent) => {
    e.stopPropagation()
    onSelect()
    setActiveResizeHandle(handle)
    resizeStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      fx: frame.x,
      fy: frame.y,
      fw: frame.width,
      fh: frame.height,
      aspect: frame.width / frame.height,
    }
  }

  useEffect(() => {
    if (!activeResizeHandle) return

    const onMouseMove = (e: MouseEvent) => {
      const dx = (e.clientX - resizeStartRef.current.clientX) / zoom
      const dy = (e.clientY - resizeStartRef.current.clientY) / zoom

      const { fx, fy, fw, fh, aspect } = resizeStartRef.current
      let nextW = fw
      let nextH = fh
      let nextX = fx
      let nextY = fy

      const MIN_FRAME_SIZE = 80

      if (activeResizeHandle.includes('e')) nextW = Math.max(MIN_FRAME_SIZE, fw + dx)
      if (activeResizeHandle.includes('s')) nextH = Math.max(MIN_FRAME_SIZE, fh + dy)
      if (activeResizeHandle.includes('w')) {
        const possibleW = Math.max(MIN_FRAME_SIZE, fw - dx)
        nextX = fx + (fw - possibleW)
        nextW = possibleW
      }
      if (activeResizeHandle.includes('n')) {
        const possibleH = Math.max(MIN_FRAME_SIZE, fh - dy)
        nextY = fy + (fh - possibleH)
        nextH = possibleH
      }

      // 按住 Shift 键等比缩放
      if (e.shiftKey && ['se', 'ne', 'sw', 'nw'].includes(activeResizeHandle)) {
        nextH = Math.round(nextW / aspect)
      }

      updateFrame(
        frame.id,
        {
          x: Math.round(nextX),
          y: Math.round(nextY),
          width: Math.round(nextW),
          height: Math.round(nextH),
        },
        false // 拉伸画板边界不偏移内部原有图元坐标
      )
    }

    const onMouseUp = () => {
      setActiveResizeHandle(null)
      const pageImages = images.filter((im) => im.pageId === frame.pageId)
      const pageTexts = (texts || []).filter((t) => t.pageId === frame.pageId)
      if (pageImages.length > 0) recalcFrameAttachment('image', pageImages.map((im) => im.id))
      if (pageTexts.length > 0) recalcFrameAttachment('text', pageTexts.map((t) => t.id))
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [activeResizeHandle, zoom, frame.id, frame.pageId, updateFrame, recalcFrameAttachment, images, texts])

  const handleFinishRename = () => {
    setIsEditingName(false)
    if (nameVal.trim()) {
      updateFrame(frame.id, { name: nameVal.trim() })
    } else {
      setNameVal(frame.name)
    }
  }

  return (
    <div
      onMouseDown={(e) => {
        if (activeTool === 'text') {
          e.stopPropagation()
          const pt = screenToCanvas({ x: e.clientX, y: e.clientY })
          addText({
            frameId: frame.id,
            x: Math.round(pt.x),
            y: Math.round(pt.y),
          })
          setActiveTool('select')
        }
      }}
      onClick={(e) => {
        if (activeTool === 'text') return
        // 点击画板底色选中画板
        e.stopPropagation()
        onSelect()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onContextMenu?.(e)
      }}
      style={{
        position: 'absolute',
        left: frame.x,
        top: frame.y,
        width: frame.width,
        height: frame.height,
        backgroundColor: frame.background || '#ffffff',
        boxShadow: isSelected
          ? '0 0 0 1.5px #181b24, 0 16px 40px -8px rgba(0, 0, 0, 0.12)'
          : '0 4px 24px -2px rgba(0, 0, 0, 0.06), 0 0 0 1px rgba(0, 0, 0, 0.05)',
        borderRadius: 4,
        userSelect: 'none',
        pointerEvents: 'auto',
      }}
    >
      {/* 顶部画板标题栏 */}
      <div
        onMouseDown={handleHeaderMouseDown}
        style={{
          position: 'absolute',
          top: -30,
          left: 0,
          height: 26,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '2px 8px',
          borderRadius: 4,
          backgroundColor: isSelected ? '#181b24' : 'rgba(255,255,255,0.85)',
          color: isSelected ? '#ffffff' : '#475569',
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          backdropFilter: 'blur(4px)',
          fontSize: 11,
          fontWeight: 600,
          cursor: 'grab',
          whiteSpace: 'nowrap',
          zIndex: 10,
        }}
      >
        <GripHorizontal size={12} opacity={0.6} />

        {isEditingName ? (
          <input
            autoFocus
            value={nameVal}
            onChange={(e) => setNameVal(e.target.value)}
            onBlur={handleFinishRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleFinishRename()
              if (e.key === 'Escape') {
                setNameVal(frame.name)
                setIsEditingName(false)
              }
            }}
            onClick={(e) => e.stopPropagation()}
            style={{
              fontSize: 11,
              padding: '0 4px',
              height: 18,
              borderRadius: 2,
              border: '1px solid #94a3b8',
              outline: 'none',
              width: 80,
            }}
          />
        ) : (
          <span
            onDoubleClick={(e) => {
              e.stopPropagation()
              setIsEditingName(true)
            }}
            title="双击重命名画板"
          >
            {frame.name}
          </span>
        )}

        <span style={{ fontSize: 10, opacity: 0.75, fontWeight: 400 }}>
          {frame.width} × {frame.height}
          {totalChildren > 0 ? ` · ${totalChildren} 项` : ''}
        </span>

        {/* 删除画板按钮 */}
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            deleteFrame(frame.id)
          }}
          style={{
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            padding: '2px 4px',
            borderRadius: 3,
            color: isSelected ? '#fecaca' : '#94a3b8',
            display: 'flex',
            alignItems: 'center',
            marginLeft: 2,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
          onMouseLeave={(e) => (e.currentTarget.style.color = isSelected ? '#fecaca' : '#94a3b8')}
          title="删除画板（内部内容将保留在画布上）"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* 选中时显示的四周/四角拉伸手柄（放大/缩小画板） */}
      {isSelected &&
        FRAME_RESIZE_HANDLES.map((h) => (
          <div
            key={h.pos}
            onMouseDown={(e) => handleResizeHandleMouseDown(h.pos, e)}
            style={{
              position: 'absolute',
              width: 10,
              height: 10,
              backgroundColor: '#ffffff',
              border: '1.5px solid #181b24',
              borderRadius: 2,
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2)',
              cursor: h.cursor,
              zIndex: 20,
              boxSizing: 'border-box',
              ...h.style,
            }}
          />
        ))}
    </div>
  )
}

import React, { useRef, useState, useEffect } from 'react'
import type { CanvasImage, ResizeHandle } from '../types'
import { useViewportStore } from '../store/viewportStore'
import { useCanvasStore } from '../store/canvasStore'
import { calculateSnap, type SnapLine, type RectBox } from '../utils/snapping'

interface Props {
  image: CanvasImage
  onSnapLinesChange?: (lines: SnapLine[]) => void
}

const HANDLES: { pos: ResizeHandle; cursor: string; x: string; y: string }[] = [
  { pos: 'nw', cursor: 'nwse-resize', x: '0%', y: '0%' },
  { pos: 'n', cursor: 'ns-resize', x: '50%', y: '0%' },
  { pos: 'ne', cursor: 'nesw-resize', x: '100%', y: '0%' },
  { pos: 'e', cursor: 'ew-resize', x: '100%', y: '50%' },
  { pos: 'se', cursor: 'nwse-resize', x: '100%', y: '100%' },
  { pos: 's', cursor: 'ns-resize', x: '50%', y: '100%' },
  { pos: 'sw', cursor: 'nesw-resize', x: '0%', y: '100%' },
  { pos: 'w', cursor: 'ew-resize', x: '0%', y: '50%' },
]

export function SelectionOverlay({ image, onSnapLinesChange }: Props) {
  const zoom = useViewportStore((s) => s.zoom)
  const screenToCanvas = useViewportStore((s) => s.screenToCanvas)
  const updateImage = useCanvasStore((s) => s.updateImage)
  const frames = useCanvasStore((s) => s.frames)
  const images = useCanvasStore((s) => s.images)
  const activePageId = useCanvasStore((s) => s.activePageId)

  const [isDragging, setIsDragging] = useState(false)
  const [activeHandle, setActiveHandle] = useState<ResizeHandle | null>(null)
  const dragStartRef = useRef<{
    clientX: number
    clientY: number
    imgX: number
    imgY: number
    imgW: number
    imgH: number
    aspect: number
  }>({ clientX: 0, clientY: 0, imgX: 0, imgY: 0, imgW: 0, imgH: 0, aspect: 1 })

  // 1. 拖拽移动
  const handleMoveMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (e.shiftKey || e.metaKey) {
      useCanvasStore.getState().toggleSelected(image.id, 'image')
      return
    }
    setIsDragging(true)
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      imgX: image.x,
      imgY: image.y,
      imgW: image.width,
      imgH: image.height,
      aspect: image.width / image.height,
    }
  }

  // 2. 拖拽缩放
  const handleResizeMouseDown = (handle: ResizeHandle, e: React.MouseEvent) => {
    e.stopPropagation()
    setActiveHandle(handle)
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      imgX: image.x,
      imgY: image.y,
      imgW: image.width,
      imgH: image.height,
      aspect: image.width / image.height,
    }
  }

  useEffect(() => {
    if (!isDragging && !activeHandle) return

    const onMouseMove = (e: MouseEvent) => {
      const dx = (e.clientX - dragStartRef.current.clientX) / zoom
      const dy = (e.clientY - dragStartRef.current.clientY) / zoom

      if (isDragging) {
        const rawX = dragStartRef.current.imgX + dx
        const rawY = dragStartRef.current.imgY + dy

        // 收集对齐候选框：当前页面的画板与其他图片
        const currentFrames = frames.filter((f) => f.pageId === activePageId)
        const currentImages = images.filter((im) => im.pageId === activePageId && im.id !== image.id)
        const targetBoxes: RectBox[] = [
          ...currentFrames.map((f) => ({ id: f.id, x: f.x, y: f.y, width: f.width, height: f.height })),
          ...currentImages.map((im) => ({ id: im.id, x: im.x, y: im.y, width: im.width, height: im.height })),
        ]

        const snap = calculateSnap(
          { id: image.id, x: rawX, y: rawY, width: image.width, height: image.height },
          targetBoxes,
          zoom
        )

        onSnapLinesChange?.(snap.lines)

        updateImage(image.id, {
          x: Math.round(snap.snappedX),
          y: Math.round(snap.snappedY),
        })
      } else if (activeHandle) {
        onSnapLinesChange?.([])
        const { imgX, imgY, imgW, imgH, aspect } = dragStartRef.current
        let nextW = imgW
        let nextH = imgH
        let nextX = imgX
        let nextY = imgY

        // 根据不同手柄计算新尺寸
        if (activeHandle.includes('e')) nextW = Math.max(30, imgW + dx)
        if (activeHandle.includes('s')) nextH = Math.max(30, imgH + dy)
        if (activeHandle.includes('w')) {
          const possibleW = Math.max(30, imgW - dx)
          nextX = imgX + (imgW - possibleW)
          nextW = possibleW
        }
        if (activeHandle.includes('n')) {
          const possibleH = Math.max(30, imgH - dy)
          nextY = imgY + (imgH - possibleH)
          nextH = possibleH
        }

        // Shift 键锁定等比缩放
        if (e.shiftKey && (activeHandle === 'se' || activeHandle === 'ne' || activeHandle === 'sw' || activeHandle === 'nw')) {
          nextH = Math.round(nextW / aspect)
        }

        updateImage(image.id, {
          x: Math.round(nextX),
          y: Math.round(nextY),
          width: Math.round(nextW),
          height: Math.round(nextH),
        })
      }
    }

    const onMouseUp = () => {
      if (isDragging) {
        useCanvasStore.getState().recalcFrameAttachment('image', [image.id])
      }
      setIsDragging(false)
      setActiveHandle(null)
      onSnapLinesChange?.([])
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [isDragging, activeHandle, image.id, zoom, updateImage, frames, images, activePageId, onSnapLinesChange])

  return (
    <div
      style={{
        position: 'absolute',
        left: image.x,
        top: image.y,
        width: image.width,
        height: image.height,
        transform: `rotate(${image.rotation}deg)`,
        transformOrigin: 'center center',
        pointerEvents: 'none',
        zIndex: 50,
      }}
    >
      {/* 选中外框（极简暗色，无蓝色，边框保持 1.5px 屏幕像素） */}
      <div
        onMouseDown={handleMoveMouseDown}
        style={{
          position: 'absolute',
          inset: 0,
          border: `${1.5 / zoom}px solid #181b24`,
          pointerEvents: 'auto',
          cursor: 'move',
        }}
      />

      {/* 实时尺寸提示（保持 1x 矢量文本清晰度） */}
      <div
        style={{
          position: 'absolute',
          top: '100%',
          left: '50%',
          marginTop: 6 / zoom,
          transform: `translateX(-50%) scale(${1 / zoom})`,
          transformOrigin: 'top center',
          backgroundColor: '#1e293b',
          color: '#ffffff',
          fontSize: 10,
          padding: '2px 6px',
          borderRadius: 3,
          whiteSpace: 'nowrap',
          fontFamily: 'monospace',
          pointerEvents: 'none',
          boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
          WebkitFontSmoothing: 'antialiased',
        }}
      >
        {Math.round(image.width)} × {Math.round(image.height)}
      </div>

      {/* 8 个控制手柄（保持 8px 屏幕像素与清晰边框） */}
      {HANDLES.map(({ pos, cursor, x, y }) => (
        <div
          key={pos}
          onMouseDown={(e) => handleResizeMouseDown(pos, e)}
          style={{
            position: 'absolute',
            left: x,
            top: y,
            width: 8,
            height: 8,
            backgroundColor: '#ffffff',
            border: '1.5px solid #181b24',
            borderRadius: 1.5,
            pointerEvents: 'auto',
            cursor,
            zIndex: 60,
            boxSizing: 'border-box',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            transform: `translate(-50%, -50%) scale(${1 / zoom})`,
            transformOrigin: 'center center',
          }}
        />
      ))}
    </div>
  )
}

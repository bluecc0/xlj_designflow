import React, { useRef, useState, useEffect } from 'react'
import type { CanvasImage, ResizeHandle } from '../types'
import { useViewportStore } from '../store/viewportStore'
import { useCanvasStore } from '../store/canvasStore'
import { calculateSnap, calculateResizeSnap, getSnapTargets, type SnapLine, type RectBox } from '../utils/snapping'
import { useSnapStore } from '../store/snapStore'

interface Props {
  image: CanvasImage
  onContextMenu?: (e: React.MouseEvent) => void
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

export function SelectionOverlay({ image, onContextMenu }: Props) {
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

      // 统一收集对齐目标
      const snapTargets = getSnapTargets([image.id], image.pageId)

      if (isDragging) {
        const rawX = dragStartRef.current.imgX + dx
        const rawY = dragStartRef.current.imgY + dy

        let finalX = rawX
        let finalY = rawY

        if (!e.altKey) {
          const snap = calculateSnap(
            { id: image.id, x: rawX, y: rawY, width: image.width, height: image.height },
            snapTargets,
            zoom
          )
          useSnapStore.getState().setSnapLines(snap.lines)
          finalX = snap.snappedX
          finalY = snap.snappedY
        } else {
          useSnapStore.getState().clearSnapLines()
        }

        updateImage(image.id, {
          x: Math.round(finalX),
          y: Math.round(finalY),
        })
      } else if (activeHandle) {
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

        const isCorner = activeHandle === 'se' || activeHandle === 'ne' || activeHandle === 'sw' || activeHandle === 'nw'
        const keepAspect = e.shiftKey && isCorner

        if (!e.altKey) {
          const resizeSnap = calculateResizeSnap(
            activeHandle,
            { id: image.id, x: nextX, y: nextY, width: nextW, height: nextH },
            snapTargets,
            zoom,
            keepAspect ? aspect : undefined
          )
          nextX = resizeSnap.box.x
          nextY = resizeSnap.box.y
          nextW = resizeSnap.box.width
          nextH = resizeSnap.box.height
          useSnapStore.getState().setSnapLines(resizeSnap.lines)
        } else {
          if (keepAspect) {
            nextH = Math.round(nextW / aspect)
          }
          useSnapStore.getState().clearSnapLines()
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
      useSnapStore.getState().clearSnapLines()
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [isDragging, activeHandle, image.id, zoom, updateImage, frames, images, activePageId])

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
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onContextMenu?.(e)
        }}
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

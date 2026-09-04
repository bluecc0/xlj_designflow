import React, { useRef, useState, useEffect } from 'react'
import type { CanvasImage, ResizeHandle } from '../types'
import { useViewportStore } from '../store/viewportStore'
import { useCanvasStore } from '../store/canvasStore'

interface Props {
  image: CanvasImage
}

const HANDLES: { pos: ResizeHandle; cursor: string; style: React.CSSProperties }[] = [
  { pos: 'nw', cursor: 'nwse-resize', style: { top: -4, left: -4 } },
  { pos: 'n', cursor: 'ns-resize', style: { top: -4, left: '50%', marginLeft: -4 } },
  { pos: 'ne', cursor: 'nesw-resize', style: { top: -4, right: -4 } },
  { pos: 'e', cursor: 'ew-resize', style: { top: '50%', right: -4, marginTop: -4 } },
  { pos: 'se', cursor: 'nwse-resize', style: { bottom: -4, right: -4 } },
  { pos: 's', cursor: 'ns-resize', style: { bottom: -4, left: '50%', marginLeft: -4 } },
  { pos: 'sw', cursor: 'nesw-resize', style: { bottom: -4, left: -4 } },
  { pos: 'w', cursor: 'ew-resize', style: { top: '50%', left: -4, marginTop: -4 } },
]

export function SelectionOverlay({ image }: Props) {
  const zoom = useViewportStore((s) => s.zoom)
  const screenToCanvas = useViewportStore((s) => s.screenToCanvas)
  const updateImage = useCanvasStore((s) => s.updateImage)

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
        updateImage(image.id, {
          x: Math.round(dragStartRef.current.imgX + dx),
          y: Math.round(dragStartRef.current.imgY + dy),
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
      setIsDragging(false)
      setActiveHandle(null)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [isDragging, activeHandle, image.id, zoom, updateImage])

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
      {/* 蓝色选中外框 */}
      <div
        onMouseDown={handleMoveMouseDown}
        style={{
          position: 'absolute',
          inset: -1,
          border: '1.5px solid #4f46e5',
          pointerEvents: 'auto',
          cursor: 'move',
        }}
      />

      {/* 实时尺寸提示 */}
      <div
        style={{
          position: 'absolute',
          bottom: -22,
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: '#1e293b',
          color: '#ffffff',
          fontSize: 10,
          padding: '2px 6px',
          borderRadius: 3,
          whiteSpace: 'nowrap',
          fontFamily: 'monospace',
          pointerEvents: 'none',
        }}
      >
        {Math.round(image.width)} × {Math.round(image.height)}
      </div>

      {/* 8 个控制手柄 */}
      {HANDLES.map(({ pos, cursor, style }) => (
        <div
          key={pos}
          onMouseDown={(e) => handleResizeMouseDown(pos, e)}
          style={{
            position: 'absolute',
            width: 8,
            height: 8,
            backgroundColor: '#ffffff',
            border: '1.5px solid #4f46e5',
            borderRadius: 1,
            pointerEvents: 'auto',
            cursor,
            zIndex: 60,
            ...style,
          }}
        />
      ))}
    </div>
  )
}

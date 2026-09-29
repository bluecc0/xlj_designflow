import React, { useRef } from 'react'
import type { CanvasImage, OutpaintMargins } from '../types'
import { useViewportStore } from '../store/viewportStore'

interface Props {
  image: CanvasImage
  margins: OutpaintMargins
  onMarginsChange: (margins: OutpaintMargins) => void
  initialImage?: {
    width: number
    height: number
    naturalWidth: number
    naturalHeight: number
  } | null
  onImageResize?: (patch: { x: number; y: number; width: number; height: number }) => void
  isSubmitting?: boolean
}

export function OutpaintingOverlay({
  image,
  margins,
  onMarginsChange,
  initialImage,
  onImageResize,
  isSubmitting = false,
}: Props) {
  const zoom = useViewportStore((s) => s.zoom)

  const activeHandleRef = useRef<string | null>(null)
  const dragStartRef = useRef<{ clientX: number; clientY: number; margins: OutpaintMargins }>({
    clientX: 0,
    clientY: 0,
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
  })

  // 原图角点缩放状态
  const activeImageHandleRef = useRef<string | null>(null)
  const imageDragStartRef = useRef<{
    clientX: number
    clientY: number
    x: number
    y: number
    width: number
    height: number
  }>({
    clientX: 0,
    clientY: 0,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  })

  const handleMouseDown = (e: React.MouseEvent, handle: string) => {
    if (isSubmitting) return
    e.stopPropagation()
    e.preventDefault()
    activeHandleRef.current = handle
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      margins: { ...margins },
    }

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!activeHandleRef.current) return
      const dx = (moveEvent.clientX - dragStartRef.current.clientX) / zoom
      const dy = (moveEvent.clientY - dragStartRef.current.clientY) / zoom
      const prev = dragStartRef.current.margins

      const next = { ...prev }
      if (activeHandleRef.current.includes('t')) {
        next.top = Math.max(0, Math.min(2048, Math.round(prev.top - dy)))
      }
      if (activeHandleRef.current.includes('b')) {
        next.bottom = Math.max(0, Math.min(2048, Math.round(prev.bottom + dy)))
      }
      if (activeHandleRef.current.includes('l')) {
        next.left = Math.max(0, Math.min(2048, Math.round(prev.left - dx)))
      }
      if (activeHandleRef.current.includes('r')) {
        next.right = Math.max(0, Math.min(2048, Math.round(prev.right + dx)))
      }

      // 面积与尺寸硬约束 (≤ 4096, ≤ 4,194,304 像素)
      const totalW = image.width + next.left + next.right
      const totalH = image.height + next.top + next.bottom
      if (totalW <= 4096 && totalH <= 4096 && totalW * totalH <= 4194304) {
        onMarginsChange(next)
      }
    }

    const onMouseUp = () => {
      activeHandleRef.current = null
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  // 原图 4 个角缩放手柄交互
  const handleImageCornerMouseDown = (e: React.MouseEvent, corner: 'tl' | 'tr' | 'br' | 'bl') => {
    if (isSubmitting || !onImageResize) return
    e.stopPropagation()
    e.preventDefault()
    activeImageHandleRef.current = corner
    imageDragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      x: image.x,
      y: image.y,
      width: image.width,
      height: image.height,
    }

    const start = imageDragStartRef.current
    const aspect = start.width / start.height
    const natW = initialImage?.naturalWidth || image.naturalWidth || start.width
    const initW = initialImage?.width || start.width

    const onMouseMove = (moveEvt: MouseEvent) => {
      if (!activeImageHandleRef.current) return
      const dx = (moveEvt.clientX - start.clientX) / zoom
      const dy = (moveEvt.clientY - start.clientY) / zoom

      let delta = 0
      if (corner === 'br') {
        delta = Math.abs(dx) > Math.abs(dy * aspect) ? dx : dy * aspect
      } else if (corner === 'tl') {
        delta = Math.abs(-dx) > Math.abs(-dy * aspect) ? -dx : -dy * aspect
      } else if (corner === 'tr') {
        delta = Math.abs(dx) > Math.abs(-dy * aspect) ? dx : -dy * aspect
      } else if (corner === 'bl') {
        delta = Math.abs(-dx) > Math.abs(dy * aspect) ? -dx : dy * aspect
      }

      let newW = start.width + delta
      const minW = Math.max(32, Math.round(initW * (64 / natW)))
      const maxW = Math.min(8192, Math.round(initW * (4096 / natW)))
      newW = Math.max(minW, Math.min(maxW, Math.round(newW)))
      const newH = Math.round(newW / aspect)

      let newX = start.x
      let newY = start.y
      if (corner === 'br') {
        newX = start.x
        newY = start.y
      } else if (corner === 'tl') {
        newX = start.x + start.width - newW
        newY = start.y + start.height - newH
      } else if (corner === 'tr') {
        newX = start.x
        newY = start.y + start.height - newH
      } else if (corner === 'bl') {
        newX = start.x + start.width - newW
        newY = start.y
      }

      onImageResize({ x: newX, y: newY, width: newW, height: newH })
    }

    const onMouseUp = () => {
      activeImageHandleRef.current = null
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  const expandedX = image.x - margins.left
  const expandedY = image.y - margins.top
  const expandedWidth = image.width + margins.left + margins.right
  const expandedHeight = image.height + margins.top + margins.bottom

  // 原图物理尺寸估算
  const natW = initialImage?.naturalWidth || image.naturalWidth || image.width
  const natH = initialImage?.naturalHeight || image.naturalHeight || image.height
  const initW = initialImage?.width || image.width
  const currentMultiplier = initW > 0 ? image.width / initW : 1
  const physicalW = Math.round(natW * currentMultiplier)
  const physicalH = Math.round(natH * currentMultiplier)

  return (
    <div
      className="designflow-outpaint-box"
      style={{
        left: expandedX,
        top: expandedY,
        width: expandedWidth,
        height: expandedHeight,
        zIndex: 95,
      }}
    >
      {/* 扩图范围外框 */}
      <div className="designflow-outpaint-outline" />

      {/* 原图孔位参考 */}
      <div
        className="designflow-outpaint-source-hole"
        style={{
          left: margins.left,
          top: margins.top,
          width: image.width,
          height: image.height,
        }}
      >
        {/* 原图物理尺寸徽标 */}
        <div
          className="designflow-outpaint-source-badge"
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 8,
            transform: `translateX(-50%) scale(${1 / zoom})`,
            transformOrigin: 'center bottom',
            padding: '3px 8px',
            background: 'rgba(24, 27, 36, 0.88)',
            color: '#ffffff',
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 15,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <span>原图: {physicalW} × {physicalH} px</span>
        </div>

        {/* 原图4个角的物理尺寸缩放手柄 */}
        {onImageResize && !isSubmitting && (
          <>
            <div
              className="designflow-outpaint-image-handle"
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                cursor: 'nwse-resize',
                transform: `translate(-50%, -50%) scale(${1 / zoom})`,
              }}
              onMouseDown={(e) => handleImageCornerMouseDown(e, 'tl')}
              title="按住拖拽缩放原图物理尺寸"
            >
              <span />
            </div>
            <div
              className="designflow-outpaint-image-handle"
              style={{
                position: 'absolute',
                left: image.width,
                top: 0,
                cursor: 'nesw-resize',
                transform: `translate(-50%, -50%) scale(${1 / zoom})`,
              }}
              onMouseDown={(e) => handleImageCornerMouseDown(e, 'tr')}
              title="按住拖拽缩放原图物理尺寸"
            >
              <span />
            </div>
            <div
              className="designflow-outpaint-image-handle"
              style={{
                position: 'absolute',
                left: image.width,
                top: image.height,
                cursor: 'nwse-resize',
                transform: `translate(-50%, -50%) scale(${1 / zoom})`,
              }}
              onMouseDown={(e) => handleImageCornerMouseDown(e, 'br')}
              title="按住拖拽缩放原图物理尺寸"
            >
              <span />
            </div>
            <div
              className="designflow-outpaint-image-handle"
              style={{
                position: 'absolute',
                left: 0,
                top: image.height,
                cursor: 'nesw-resize',
                transform: `translate(-50%, -50%) scale(${1 / zoom})`,
              }}
              onMouseDown={(e) => handleImageCornerMouseDown(e, 'bl')}
              title="按住拖拽缩放原图物理尺寸"
            >
              <span />
            </div>
          </>
        )}
      </div>

      {/* 4 个角手柄 */}
      <div
        className="designflow-outpaint-corner-handle"
        style={{ left: 0, top: 0, cursor: 'nwse-resize', transform: `translate(-50%, -50%) scale(${1 / zoom})` }}
        onMouseDown={(e) => handleMouseDown(e, 'tl')}
        title="向外拖拽扩展左上角"
      >
        <span />
      </div>
      <div
        className="designflow-outpaint-corner-handle"
        style={{ left: expandedWidth, top: 0, cursor: 'nesw-resize', transform: `translate(-50%, -50%) scale(${1 / zoom})` }}
        onMouseDown={(e) => handleMouseDown(e, 'tr')}
        title="向外拖拽扩展右上角"
      >
        <span />
      </div>
      <div
        className="designflow-outpaint-corner-handle"
        style={{ left: expandedWidth, top: expandedHeight, cursor: 'nwse-resize', transform: `translate(-50%, -50%) scale(${1 / zoom})` }}
        onMouseDown={(e) => handleMouseDown(e, 'br')}
        title="向外拖拽扩展右下角"
      >
        <span />
      </div>
      <div
        className="designflow-outpaint-corner-handle"
        style={{ left: 0, top: expandedHeight, cursor: 'nesw-resize', transform: `translate(-50%, -50%) scale(${1 / zoom})` }}
        onMouseDown={(e) => handleMouseDown(e, 'bl')}
        title="向外拖拽扩展左下角"
      >
        <span />
      </div>

      {/* 4 条边手柄 */}
      <div
        className="designflow-outpaint-edge-handle"
        style={{
          left: '50%',
          top: 0,
          transform: `translate(-50%, -50%) scale(${1 / zoom})`,
          width: 36,
          height: 16,
          cursor: 'ns-resize',
        }}
        onMouseDown={(e) => handleMouseDown(e, 't')}
        title="向上拖拽扩展上方"
      >
        <span style={{ width: 18, height: 4 }} />
      </div>
      <div
        className="designflow-outpaint-edge-handle"
        style={{
          left: expandedWidth,
          top: '50%',
          transform: `translate(-50%, -50%) scale(${1 / zoom})`,
          width: 16,
          height: 36,
          cursor: 'ew-resize',
        }}
        onMouseDown={(e) => handleMouseDown(e, 'r')}
        title="向右拖拽扩展右侧"
      >
        <span style={{ width: 4, height: 18 }} />
      </div>
      <div
        className="designflow-outpaint-edge-handle"
        style={{
          left: '50%',
          top: expandedHeight,
          transform: `translate(-50%, -50%) scale(${1 / zoom})`,
          width: 36,
          height: 16,
          cursor: 'ns-resize',
        }}
        onMouseDown={(e) => handleMouseDown(e, 'b')}
        title="向下拖拽扩展下方"
      >
        <span style={{ width: 18, height: 4 }} />
      </div>
      <div
        className="designflow-outpaint-edge-handle"
        style={{
          left: 0,
          top: '50%',
          transform: `translate(-50%, -50%) scale(${1 / zoom})`,
          width: 16,
          height: 36,
          cursor: 'ew-resize',
        }}
        onMouseDown={(e) => handleMouseDown(e, 'l')}
        title="向左拖拽扩展左侧"
      >
        <span style={{ width: 4, height: 18 }} />
      </div>

      {/* 边距徽标提示 (仅在边距 > 0 时显示) */}
      {margins.top > 0 && (
        <div
          className="designflow-outpaint-margin-badge"
          style={{ left: '50%', top: margins.top / 2, transform: `translate(-50%, -50%) scale(${1 / zoom})` }}
        >
          +{margins.top}px
        </div>
      )}
      {margins.bottom > 0 && (
        <div
          className="designflow-outpaint-margin-badge"
          style={{ left: '50%', top: margins.top + image.height + margins.bottom / 2, transform: `translate(-50%, -50%) scale(${1 / zoom})` }}
        >
          +{margins.bottom}px
        </div>
      )}
      {margins.left > 0 && (
        <div
          className="designflow-outpaint-margin-badge"
          style={{ left: margins.left / 2, top: '50%', transform: `translate(-50%, -50%) scale(${1 / zoom})` }}
        >
          +{margins.left}px
        </div>
      )}
      {margins.right > 0 && (
        <div
          className="designflow-outpaint-margin-badge"
          style={{ left: margins.left + image.width + margins.right / 2, top: '50%', transform: `translate(-50%, -50%) scale(${1 / zoom})` }}
        >
          +{margins.right}px
        </div>
      )}

      {/* 预计生成总尺寸徽标 */}
      <div
        className="designflow-outpaint-size-badge"
        style={{
          transform: `translateX(-50%) scale(${1 / zoom})`,
          bottom: -28 / zoom,
        }}
      >
        预计 {expandedWidth} × {expandedHeight} px
      </div>
    </div>
  )
}

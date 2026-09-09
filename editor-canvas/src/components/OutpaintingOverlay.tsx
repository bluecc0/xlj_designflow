import React, { useRef } from 'react'
import type { CanvasImage, OutpaintMargins } from '../types'
import { useViewportStore } from '../store/viewportStore'

interface Props {
  image: CanvasImage
  margins: OutpaintMargins
  onMarginsChange: (margins: OutpaintMargins) => void
  isSubmitting?: boolean
}

export function OutpaintingOverlay({ image, margins, onMarginsChange, isSubmitting = false }: Props) {
  const zoom = useViewportStore((s) => s.zoom)

  const activeHandleRef = useRef<string | null>(null)
  const dragStartRef = useRef<{ clientX: number; clientY: number; margins: OutpaintMargins }>({
    clientX: 0,
    clientY: 0,
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
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

  const expandedX = image.x - margins.left
  const expandedY = image.y - margins.top
  const expandedWidth = image.width + margins.left + margins.right
  const expandedHeight = image.height + margins.top + margins.bottom

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
      />

      {/* 4 个角手柄 */}
      <div
        className="designflow-outpaint-corner-handle"
        style={{ left: 0, top: 0, cursor: 'nwse-resize' }}
        onMouseDown={(e) => handleMouseDown(e, 'tl')}
        title="向外拖拽扩展左上角"
      >
        <span />
      </div>
      <div
        className="designflow-outpaint-corner-handle"
        style={{ left: expandedWidth, top: 0, cursor: 'nesw-resize' }}
        onMouseDown={(e) => handleMouseDown(e, 'tr')}
        title="向外拖拽扩展右上角"
      >
        <span />
      </div>
      <div
        className="designflow-outpaint-corner-handle"
        style={{ left: expandedWidth, top: expandedHeight, cursor: 'nwse-resize' }}
        onMouseDown={(e) => handleMouseDown(e, 'br')}
        title="向外拖拽扩展右下角"
      >
        <span />
      </div>
      <div
        className="designflow-outpaint-corner-handle"
        style={{ left: 0, top: expandedHeight, cursor: 'nesw-resize' }}
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
          transform: 'translate(-50%, -50%)',
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
          transform: 'translate(-50%, -50%)',
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
          transform: 'translate(-50%, -50%)',
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
          transform: 'translate(-50%, -50%)',
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
          style={{ left: '50%', top: margins.top / 2 }}
        >
          +{margins.top}px
        </div>
      )}
      {margins.bottom > 0 && (
        <div
          className="designflow-outpaint-margin-badge"
          style={{ left: '50%', top: margins.top + image.height + margins.bottom / 2 }}
        >
          +{margins.bottom}px
        </div>
      )}
      {margins.left > 0 && (
        <div
          className="designflow-outpaint-margin-badge"
          style={{ left: margins.left / 2, top: '50%' }}
        >
          +{margins.left}px
        </div>
      )}
      {margins.right > 0 && (
        <div
          className="designflow-outpaint-margin-badge"
          style={{ left: margins.left + image.width + margins.right / 2, top: '50%' }}
        >
          +{margins.right}px
        </div>
      )}

      {/* 预计生成总尺寸徽标 */}
      <div className="designflow-outpaint-size-badge">
        预计 {expandedWidth} × {expandedHeight} px
      </div>
    </div>
  )
}

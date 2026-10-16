import React, { memo, useRef, useState, useEffect } from 'react'
import { X } from 'lucide-react'
import type { CanvasImage, QuickEditMarker } from '../types'
import { useViewportStore } from '../store/viewportStore'

interface Props {
  image: CanvasImage
  markers: QuickEditMarker[]
  onAddMarker: (marker: QuickEditMarker) => void
  onUpdateMarker: (marker: QuickEditMarker) => void
  onRemoveMarker: (id: string) => void
}

export const QuickEditMarkerOverlay = memo(function QuickEditMarkerOverlay({
  image,
  markers,
  onAddMarker,
  onUpdateMarker,
  onRemoveMarker,
}: Props) {
  const zoom = useViewportStore((s) => s.zoom)
  const screenToCanvas = useViewportStore((s) => s.screenToCanvas)

  const [hoveredMarkerId, setHoveredMarkerId] = useState<string | null>(null)
  const [draggingMarkerId, setDraggingMarkerId] = useState<string | null>(null)

  // 正在框选区域的临时坐标状态
  const [drawingBox, setDrawingBox] = useState<{
    startX: number
    startY: number
    currentX: number
    currentY: number
  } | null>(null)

  const dragStartRef = useRef<{
    markerId: string
    startX: number
    startY: number
    initialRatioX: number
    initialRatioY: number
    hasMoved: boolean
  } | null>(null)

  const clickStartRef = useRef<{
    clientX: number
    clientY: number
    time: number
  } | null>(null)

  // 计算相对图片的局部坐标 (考虑 rotation 与边界裁剪)
  const getLocalRatio = (screenX: number, screenY: number) => {
    const pt = screenToCanvas({ x: screenX, y: screenY })
    const cx = image.x + image.width / 2
    const cy = image.y + image.height / 2
    const rotation = image.rotation || 0
    const rad = -(rotation * Math.PI) / 180

    const dx = pt.x - cx
    const dy = pt.y - cy
    const rotX = cx + (dx * Math.cos(rad) - dy * Math.sin(rad))
    const rotY = cy + (dx * Math.sin(rad) + dy * Math.cos(rad))

    const localX = rotX - image.x
    const localY = rotY - image.y

    const ratioX = Math.max(0, Math.min(1, localX / image.width))
    const ratioY = Math.max(0, Math.min(1, localY / image.height))

    const naturalW = image.naturalWidth || image.width
    const naturalH = image.naturalHeight || image.height
    const pixelX = Math.round(ratioX * naturalW)
    const pixelY = Math.round(ratioY * naturalH)

    return {
      ratioX: Math.round(ratioX * 1000) / 1000,
      ratioY: Math.round(ratioY * 1000) / 1000,
      pixelX,
      pixelY,
    }
  }

  // 统一完成标记创建（点标记或选框）
  const finishMarkerCreation = (endClientX: number, endClientY: number) => {
    if (!clickStartRef.current) return
    const start = clickStartRef.current
    clickStartRef.current = null

    // 获取下一个编号
    const existingNums = new Set(markers.map((m) => m.number))
    let nextNum = 1
    while (existingNums.has(nextNum)) {
      nextNum++
    }

    const naturalW = image.naturalWidth || image.width
    const naturalH = image.naturalHeight || image.height

    // 判定是框选区域还是单击落点
    if (drawingBox) {
      const pt1 = getLocalRatio(drawingBox.startX, drawingBox.startY)
      const pt2 = getLocalRatio(drawingBox.currentX, drawingBox.currentY)

      const minRatioX = Math.min(pt1.ratioX, pt2.ratioX)
      const minRatioY = Math.min(pt1.ratioY, pt2.ratioY)
      const maxRatioX = Math.max(pt1.ratioX, pt2.ratioX)
      const maxRatioY = Math.max(pt1.ratioY, pt2.ratioY)
      const ratioW = Math.round((maxRatioX - minRatioX) * 1000) / 1000
      const ratioH = Math.round((maxRatioY - minRatioY) * 1000) / 1000

      setDrawingBox(null)

      if (ratioW >= 0.02 && ratioH >= 0.02) {
        const pixelW = Math.round(ratioW * naturalW)
        const pixelH = Math.round(ratioH * naturalH)
        onAddMarker({
          id: 'marker-' + Math.random().toString(36).slice(2, 9),
          number: nextNum,
          type: 'rect',
          ratioX: minRatioX,
          ratioY: minRatioY,
          ratioWidth: ratioW,
          ratioHeight: ratioH,
          pixelX: Math.round(minRatioX * naturalW),
          pixelY: Math.round(minRatioY * naturalH),
          pixelWidth: pixelW,
          pixelHeight: pixelH,
        })
        return
      }
    }

    // 单击落点
    const dx = Math.abs(endClientX - start.clientX)
    const dy = Math.abs(endClientY - start.clientY)
    if (dx < 12 && dy < 12) {
      const { ratioX, ratioY, pixelX, pixelY } = getLocalRatio(endClientX, endClientY)
      onAddMarker({
        id: 'marker-' + Math.random().toString(36).slice(2, 9),
        number: nextNum,
        type: 'point',
        ratioX,
        ratioY,
        pixelX,
        pixelY,
      })
    }
    setDrawingBox(null)
  }

  // 点击/框选背景按下
  const handleOverlayMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    clickStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      time: Date.now(),
    }
  }

  const handleOverlayMouseUp = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    finishMarkerCreation(e.clientX, e.clientY)
  }

  // 全局鼠标移动与抬起监听
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      // 1. 处理标记点拖拽
      if (draggingMarkerId && dragStartRef.current) {
        // 鼠标已在窗口外松开（未收到 mouseup），立即结束拖拽
        if ((e.buttons & 1) === 0) {
          dragStartRef.current = null
          setDraggingMarkerId(null)
          return
        }
        const start = dragStartRef.current
        const dx = Math.abs(e.clientX - start.startX)
        const dy = Math.abs(e.clientY - start.startY)
        if (dx > 3 || dy > 3) {
          start.hasMoved = true
        }
        if (!start.hasMoved) return

        const { ratioX, ratioY, pixelX, pixelY } = getLocalRatio(e.clientX, e.clientY)
        const target = markers.find((m) => m.id === start.markerId)
        if (target) {
          onUpdateMarker({
            ...target,
            ratioX,
            ratioY,
            pixelX,
            pixelY,
          })
        }
        return
      }

      // 2. 处理图上框选绘制
      if (clickStartRef.current && !draggingMarkerId) {
        const start = clickStartRef.current
        const dx = Math.abs(e.clientX - start.clientX)
        const dy = Math.abs(e.clientY - start.clientY)
        if (dx > 7 || dy > 7) {
          setDrawingBox({
            startX: start.clientX,
            startY: start.clientY,
            currentX: e.clientX,
            currentY: e.clientY,
          })
        }
      }
    }

    const onMouseUp = (e: MouseEvent) => {
      if (draggingMarkerId) {
        dragStartRef.current = null
        setDraggingMarkerId(null)
        return
      }

      if (clickStartRef.current) {
        finishMarkerCreation(e.clientX, e.clientY)
      }
    }

    // 捕获阶段监听：图层上的 onMouseUp 会 stopPropagation，冒泡阶段收不到 mouseup，拖拽将无法结束
    window.addEventListener('mousemove', onMouseMove, true)
    window.addEventListener('mouseup', onMouseUp, true)
    return () => {
      window.removeEventListener('mousemove', onMouseMove, true)
      window.removeEventListener('mouseup', onMouseUp, true)
    }
  }, [draggingMarkerId, drawingBox, markers, onAddMarker, onUpdateMarker])

  // 拖拽已有标记
  const handleMarkerMouseDown = (marker: QuickEditMarker, e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    setDraggingMarkerId(marker.id)
    dragStartRef.current = {
      markerId: marker.id,
      startX: e.clientX,
      startY: e.clientY,
      initialRatioX: marker.ratioX,
      initialRatioY: marker.ratioY,
      hasMoved: false,
    }
  }

  // 绘制框选过程中的黑白灰虚线框
  let previewBoxStyle: React.CSSProperties | null = null
  if (drawingBox) {
    const pt1 = getLocalRatio(drawingBox.startX, drawingBox.startY)
    const pt2 = getLocalRatio(drawingBox.currentX, drawingBox.currentY)
    const minX = Math.min(pt1.ratioX, pt2.ratioX) * image.width
    const minY = Math.min(pt1.ratioY, pt2.ratioY) * image.height
    const w = Math.abs(pt2.ratioX - pt1.ratioX) * image.width
    const h = Math.abs(pt2.ratioY - pt1.ratioY) * image.height
    previewBoxStyle = {
      position: 'absolute',
      left: minX,
      top: minY,
      width: w,
      height: h,
      border: '1.5px dashed #181b24',
      backgroundColor: 'rgba(0, 0, 0, 0.06)',
      borderRadius: 2,
      pointerEvents: 'none',
      boxSizing: 'border-box',
    }
  }

  return (
    <div
      data-quick-edit-area="true"
      onMouseDown={handleOverlayMouseDown}
      onMouseUp={handleOverlayMouseUp}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: image.x,
        top: image.y,
        width: image.width,
        height: image.height,
        transform: `rotate(${image.rotation || 0}deg)`,
        transformOrigin: 'center center',
        pointerEvents: 'auto',
        zIndex: 55,
        cursor: 'crosshair',
        backgroundColor: 'rgba(0, 0, 0, 0.01)',
        border: `${1.5 / zoom}px dashed #181b24`,
        borderRadius: 2,
        boxSizing: 'border-box',
        userSelect: 'none',
      }}
    >
      {/* 正在框选时的临时虚线预览框 */}
      {previewBoxStyle && <div style={previewBoxStyle} />}

      {/* 渲染所有标记点/选框（直接显示 1, 2, 3 点） */}
      {markers.map((marker) => {
        const isHovered = hoveredMarkerId === marker.id
        const isDragging = draggingMarkerId === marker.id
        const isRect = marker.type === 'rect' && marker.ratioWidth && marker.ratioHeight

        if (isRect) {
          const rectX = marker.ratioX * image.width
          const rectY = marker.ratioY * image.height
          const rectW = (marker.ratioWidth || 0) * image.width
          const rectH = (marker.ratioHeight || 0) * image.height

          return (
            <div
              key={marker.id}
              onMouseEnter={() => setHoveredMarkerId(marker.id)}
              onMouseLeave={() => setHoveredMarkerId(null)}
              onMouseDown={(e) => handleMarkerMouseDown(marker, e)}
              style={{
                position: 'absolute',
                left: rectX,
                top: rectY,
                width: rectW,
                height: rectH,
                border: isHovered || isDragging
                  ? '1.5px solid #181b24'
                  : '1.5px dashed #181b24',
                backgroundColor: isHovered || isDragging
                  ? 'rgba(0, 0, 0, 0.12)'
                  : 'rgba(0, 0, 0, 0.06)',
                borderRadius: 2,
                boxSizing: 'border-box',
                zIndex: isDragging ? 100 : 70,
                cursor: isDragging ? 'grabbing' : 'move',
                pointerEvents: 'auto',
                transition: 'background-color 120ms ease, border-color 120ms ease',
              }}
            >
              {/* 区域左上角的 1, 2, 3 点 */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  transform: `translate(-50%, -50%) scale(${1 / zoom})`,
                  transformOrigin: 'center center',
                  zIndex: 2,
                }}
              >
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    backgroundColor: '#181b24',
                    border: '1.5px solid #ffffff',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11.5,
                    fontWeight: 700,
                    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.3)',
                  }}
                >
                  {marker.number}
                </div>
              </div>

              {/* 删除按钮 (悬停时显示) */}
              {isHovered && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemoveMarker(marker.id)
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  title="删除此标记"
                  style={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    backgroundColor: '#181b24',
                    border: '1.5px solid #ffffff',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                    padding: 0,
                    zIndex: 10,
                  }}
                >
                  <X size={10} strokeWidth={2.4} />
                </button>
              )}
            </div>
          )
        }

        // 单点标记：直接显示 1, 2, 3 点
        const posX = marker.ratioX * image.width
        const posY = marker.ratioY * image.height

        return (
          <div
            key={marker.id}
            onMouseEnter={() => setHoveredMarkerId(marker.id)}
            onMouseLeave={() => setHoveredMarkerId(null)}
            onMouseDown={(e) => handleMarkerMouseDown(marker, e)}
            style={{
              position: 'absolute',
              left: posX,
              top: posY,
              transform: 'translate(-50%, -50%)',
              zIndex: isDragging ? 100 : 70,
              cursor: isDragging ? 'grabbing' : 'grab',
              pointerEvents: 'auto',
            }}
          >
            <div
              style={{
                transform: `scale(${1 / zoom})`,
                transformOrigin: 'center center',
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {/* 直接清晰显示 1, 2, 3 圆点 */}
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  backgroundColor: '#181b24',
                  border: '1.5px solid #ffffff',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11.5,
                  fontWeight: 700,
                  boxShadow: isHovered || isDragging
                    ? '0 0 0 2px #181b24, 0 3px 8px rgba(0, 0, 0, 0.4)'
                    : '0 2px 6px rgba(0, 0, 0, 0.3)',
                  transition: 'box-shadow 120ms ease, transform 120ms ease',
                  transform: isHovered || isDragging ? 'scale(1.1)' : 'scale(1)',
                }}
              >
                {marker.number}
              </div>

              {/* 删除小按钮 (悬停时显示) */}
              {isHovered && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemoveMarker(marker.id)
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  title="删除此标记点"
                  style={{
                    position: 'absolute',
                    top: -6,
                    right: -6,
                    width: 15,
                    height: 15,
                    borderRadius: '50%',
                    backgroundColor: '#181b24',
                    border: '1.5px solid #ffffff',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                    padding: 0,
                    zIndex: 10,
                  }}
                >
                  <X size={9} strokeWidth={2.4} />
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
})

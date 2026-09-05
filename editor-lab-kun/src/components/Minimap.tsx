import React, { useRef, useCallback } from 'react'
import { useViewportStore } from '../store/viewportStore'
import { useCanvasStore } from '../store/canvasStore'

export function Minimap() {
  const containerRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)

  const { zoom, panX, panY, setPan } = useViewportStore()
  const frames = useCanvasStore((s) => s.frames)
  const images = useCanvasStore((s) => s.images)
  const activePageId = useCanvasStore((s) => s.activePageId)

  // 当前激活页面的画板和图片
  const currentFrames = frames.filter((f) => f.pageId === activePageId)
  const currentImages = images.filter((im) => im.pageId === activePageId)

  // 视口尺寸
  const screenW = window.innerWidth
  const screenH = window.innerHeight

  // 画布世界坐标系中的当前可见视口区域
  const viewLeft = (0 - panX) / zoom
  const viewTop = (0 - panY) / zoom
  const viewWidth = screenW / zoom
  const viewHeight = screenH / zoom

  // 小地图物理宽高 (px)
  const MAP_W = 146
  const MAP_H = 104

  // 计算全局包围盒 (涵盖当前所有图元和视口区域，预留适量 padding)
  const PADDING = 200
  const allBoxes = [
    { x: viewLeft, y: viewTop, w: viewWidth, h: viewHeight },
    ...currentFrames.map((f) => ({ x: f.x, y: f.y, w: f.width, h: f.height })),
    ...currentImages.map((im) => ({ x: im.x, y: im.y, w: im.width, h: im.height })),
  ]

  const boundsMinX = Math.min(...allBoxes.map((b) => b.x)) - PADDING
  const boundsMaxX = Math.max(...allBoxes.map((b) => b.x + b.w)) + PADDING
  const boundsMinY = Math.min(...allBoxes.map((b) => b.y)) - PADDING
  const boundsMaxY = Math.max(...allBoxes.map((b) => b.y + b.h)) + PADDING

  const boundsW = Math.max(80, boundsMaxX - boundsMinX)
  const boundsH = Math.max(80, boundsMaxY - boundsMinY)

  // 映射缩放比例与居中偏移
  const scale = Math.min(MAP_W / boundsW, MAP_H / boundsH)
  const innerW = boundsW * scale
  const innerH = boundsH * scale
  const offsetX = (MAP_W - innerW) / 2
  const offsetY = (MAP_H - innerH) / 2

  // 画布坐标 -> 小地图坐标
  const canvasToMap = useCallback(
    (cx: number, cy: number) => ({
      x: offsetX + (cx - boundsMinX) * scale,
      y: offsetY + (cy - boundsMinY) * scale,
    }),
    [offsetX, offsetY, boundsMinX, boundsMinY, scale]
  )

  // 小地图坐标 -> 画布坐标
  const mapToCanvas = useCallback(
    (mx: number, my: number) => ({
      cx: boundsMinX + (mx - offsetX) / scale,
      cy: boundsMinY + (my - offsetY) / scale,
    }),
    [offsetX, offsetY, boundsMinX, boundsMinY, scale]
  )

  // 视口在小地图中的矩形位置
  const mapVP = canvasToMap(viewLeft, viewTop)
  const mapVPW = Math.max(14, viewWidth * scale)
  const mapVPH = Math.max(10, viewHeight * scale)

  // 点击或拖拽定位视口
  const handleMapInteract = useCallback(
    (clientX: number, clientY: number) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const mx = clientX - rect.left
      const my = clientY - rect.top

      const { cx, cy } = mapToCanvas(mx, my)

      // 将目标点平移至屏幕中央
      const nextPanX = screenW / 2 - cx * zoom
      const nextPanY = screenH / 2 - cy * zoom
      setPan(nextPanX, nextPanY)
    },
    [mapToCanvas, screenW, screenH, zoom, setPan]
  )

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    isDraggingRef.current = true

    handleMapInteract(e.clientX, e.clientY)

    const handleMouseMove = (me: MouseEvent) => {
      if (!isDraggingRef.current) return
      handleMapInteract(me.clientX, me.clientY)
    }

    const handleMouseUp = () => {
      isDraggingRef.current = false
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      style={{
        position: 'absolute',
        bottom: 18,
        left: 18,
        zIndex: 80,
        userSelect: 'none',
        width: MAP_W,
        height: MAP_H,
        borderRadius: 14,
        backgroundColor: 'rgba(241, 243, 247, 0.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid #e1e6ed',
        boxShadow: '0 12px 34px rgba(20, 47, 95, 0.09), 0 2px 6px rgba(20, 47, 95, 0.04)',
        overflow: 'hidden',
        cursor: 'grab',
        boxSizing: 'border-box',
      }}
      title="鸟瞰图（点击或拖拽平移画布）"
    >
      {/* 1. 画板（Frames）实体微缩 */}
      {currentFrames.map((f) => {
        const pos = canvasToMap(f.x, f.y)
        const w = Math.max(4, f.width * scale)
        const h = Math.max(4, f.height * scale)
        return (
          <div
            key={f.id}
            style={{
              position: 'absolute',
              left: pos.x,
              top: pos.y,
              width: w,
              height: h,
              backgroundColor: '#ffffff',
              border: '1px solid #cbd2dc',
              borderRadius: 2,
              pointerEvents: 'none',
              boxShadow: '0 0.5px 2px rgba(0,0,0,0.04)',
            }}
          />
        )
      })}

      {/* 2. 图片（Images）实体微缩 (灰色实心圆角矩形，对齐参考图中的网格图元) */}
      {currentImages.map((im) => {
        const pos = canvasToMap(im.x, im.y)
        const w = Math.max(4, im.width * scale)
        const h = Math.max(4, im.height * scale)
        return (
          <div
            key={im.id}
            style={{
              position: 'absolute',
              left: pos.x,
              top: pos.y,
              width: w,
              height: h,
              backgroundColor: '#aab4c2',
              borderRadius: 2,
              pointerEvents: 'none',
              boxShadow: '0 0.5px 1.5px rgba(0,0,0,0.06)',
            }}
          />
        )
      })}

      {/* 3. 当前屏幕可见视口指示框 (纯净亮蓝线框，精准对应参考图) */}
      <div
        style={{
          position: 'absolute',
          left: Math.round(mapVP.x),
          top: Math.round(mapVP.y),
          width: Math.round(mapVPW),
          height: Math.round(mapVPH),
          border: '2px solid #2563eb',
          backgroundColor: 'rgba(37, 99, 235, 0.04)',
          borderRadius: 2,
          boxSizing: 'border-box',
          pointerEvents: 'none',
          transition: isDraggingRef.current ? 'none' : 'left 60ms linear, top 60ms linear',
        }}
      />
    </div>
  )
}

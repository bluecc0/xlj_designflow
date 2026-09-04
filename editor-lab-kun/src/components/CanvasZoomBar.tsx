import React from 'react'
import { ZoomIn, ZoomOut, Maximize2, RotateCcw } from 'lucide-react'
import { useViewportStore } from '../store/viewportStore'
import { useCanvasStore } from '../store/canvasStore'

export function CanvasZoomBar() {
  const zoom = useViewportStore((s) => s.zoom)
  const setZoom = useViewportStore((s) => s.setZoom)
  const setPan = useViewportStore((s) => s.setPan)
  const frames = useCanvasStore((s) => s.frames)

  const handleZoomIn = () => setZoom(zoom * 1.2)
  const handleZoomOut = () => setZoom(zoom / 1.2)
  const handleReset = () => {
    setZoom(1.0)
    setPan(100, 80)
  }

  // 适应画板
  const handleFitAll = () => {
    if (!frames.length) return
    const frame = frames[0]
    const screenW = window.innerWidth
    const screenH = window.innerHeight

    const scaleX = (screenW - 120) / frame.width
    const scaleY = (screenH - 120) / frame.height
    const nextZoom = Math.max(0.1, Math.min(1.5, Math.min(scaleX, scaleY)))

    const nextPanX = (screenW - frame.width * nextZoom) / 2
    const nextPanY = (screenH - frame.height * nextZoom) / 2

    setZoom(nextZoom)
    setPan(nextPanX, nextPanY)
  }

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 16,
        right: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: '3px 6px',
        backgroundColor: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: 8,
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)',
        zIndex: 90,
        fontSize: 12,
        userSelect: 'none',
      }}
    >
      <button
        onClick={handleZoomOut}
        style={{
          border: 'none',
          background: 'none',
          padding: 4,
          cursor: 'pointer',
          borderRadius: 4,
          color: '#475569',
          display: 'flex',
          alignItems: 'center',
        }}
        title="缩小 (Ctrl + 滚轮)"
      >
        <ZoomOut size={14} />
      </button>

      <span
        onClick={handleReset}
        style={{
          minWidth: 44,
          textAlign: 'center',
          fontFamily: 'monospace',
          fontWeight: 600,
          color: '#1e293b',
          cursor: 'pointer',
          padding: '2px 4px',
        }}
        title="点击重置 100%"
      >
        {Math.round(zoom * 100)}%
      </span>

      <button
        onClick={handleZoomIn}
        style={{
          border: 'none',
          background: 'none',
          padding: 4,
          cursor: 'pointer',
          borderRadius: 4,
          color: '#475569',
          display: 'flex',
          alignItems: 'center',
        }}
        title="放大 (Ctrl + 滚轮)"
      >
        <ZoomIn size={14} />
      </button>

      <div style={{ width: 1, height: 14, backgroundColor: '#cbd5e1', margin: '0 2px' }} />

      <button
        onClick={handleFitAll}
        style={{
          border: 'none',
          background: 'none',
          padding: 4,
          cursor: 'pointer',
          borderRadius: 4,
          color: '#475569',
          display: 'flex',
          alignItems: 'center',
        }}
        title="适应画板"
      >
        <Maximize2 size={14} />
      </button>
    </div>
  )
}

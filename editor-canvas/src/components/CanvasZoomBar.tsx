import React, { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize,
  Focus,
  Grid3X3,
  Check,
} from 'lucide-react'
import { useViewportStore } from '../store/viewportStore'
import { useCanvasStore } from '../store/canvasStore'
import { useHistoryStore } from '../store/historyStore'

const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0
const MOD = isMac ? '⌘' : 'Ctrl+'

export const CanvasZoomBar = memo(function CanvasZoomBar() {
  const zoom = useViewportStore((s) => s.zoom)
  const setZoom = useViewportStore((s) => s.setZoom)
  const setPan = useViewportStore((s) => s.setPan)

  const canUndo = useHistoryStore((s) => s.canUndo)
  const canRedo = useHistoryStore((s) => s.canRedo)
  const undo = useHistoryStore((s) => s.undo)
  const redo = useHistoryStore((s) => s.redo)

  const getDocument = useCanvasStore((s) => s.getDocument)
  const loadDocument = useCanvasStore((s) => s.loadDocument)
  const frames = useCanvasStore((s) => s.frames)
  const images = useCanvasStore((s) => s.images)
  const activePageId = useCanvasStore((s) => s.activePageId)

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const zoomPercent = Math.round(zoom * 100)

  // 点击外部关闭弹出菜单
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const handleUndo = useCallback(() => {
    const doc = getDocument()
    const prev = undo(doc)
    if (prev) loadDocument(prev)
  }, [getDocument, undo, loadDocument])

  const handleRedo = useCallback(() => {
    const doc = getDocument()
    const next = redo(doc)
    if (next) loadDocument(next)
  }, [getDocument, redo, loadDocument])

  const zoomIn = useCallback(() => {
    setZoom(zoom * 1.2)
  }, [zoom, setZoom])

  const zoomOut = useCallback(() => {
    setZoom(zoom / 1.2)
  }, [zoom, setZoom])

  const zoomTo100 = useCallback(() => {
    setZoom(1.0)
  }, [setZoom])

  const zoomToFit = useCallback(() => {
    const currentFrames = frames.filter((f) => f.pageId === activePageId)
    const currentImages = images.filter((im) => im.pageId === activePageId)
    const allBoxes = [
      ...currentFrames.map((f) => ({ x: f.x, y: f.y, w: f.width, h: f.height })),
      ...currentImages.map((im) => ({ x: im.x, y: im.y, w: im.width, h: im.height })),
    ]

    if (allBoxes.length === 0) {
      setZoom(1)
      setPan(window.innerWidth / 2, window.innerHeight / 2)
      return
    }

    const minX = Math.min(...allBoxes.map((b) => b.x))
    const maxX = Math.max(...allBoxes.map((b) => b.x + b.w))
    const minY = Math.min(...allBoxes.map((b) => b.y))
    const maxY = Math.max(...allBoxes.map((b) => b.y + b.h))

    const totalW = maxX - minX
    const totalH = maxY - minY
    const screenW = window.innerWidth
    const screenH = window.innerHeight

    const scaleX = (screenW - 160) / totalW
    const scaleY = (screenH - 160) / totalH
    const nextZoom = Math.max(0.08, Math.min(2.0, Math.min(scaleX, scaleY)))

    const centerX = minX + totalW / 2
    const centerY = minY + totalH / 2

    const nextPanX = screenW / 2 - centerX * nextZoom
    const nextPanY = screenH / 2 - centerY * nextZoom

    setZoom(nextZoom)
    setPan(nextPanX, nextPanY)
  }, [frames, images, activePageId, setZoom, setPan])

  const menuItems = [
    { label: '放大', shortcut: `${MOD}+`, icon: ZoomIn, action: zoomIn },
    { label: '缩小', shortcut: `${MOD}-`, icon: ZoomOut, action: zoomOut },
    { label: '实际大小 (100%)', shortcut: '⇧0', icon: Maximize, action: zoomTo100 },
    { label: '适应视图全部', shortcut: '⇧1', icon: Focus, action: zoomToFit },
  ]

  return (
    <div
      ref={menuRef}
      style={{
        position: 'absolute',
        bottom: 18,
        right: 18,
        zIndex: 90,
        userSelect: 'none',
      }}
    >
      {/* 展开的缩放与视图菜单 */}
      {menuOpen && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            right: 0,
            marginBottom: 8,
            width: 196,
            padding: '4px',
            backgroundColor: 'rgba(255, 255, 255, 0.94)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            borderRadius: 14,
            border: '1px solid #e7e9ee',
            boxShadow: '0 16px 40px rgba(20, 47, 95, 0.12), 0 2px 8px rgba(20, 47, 95, 0.04)',
            zIndex: 100,
          }}
        >
          {menuItems.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                item.action()
                setMenuOpen(false)
              }}
              style={{
                display: 'flex',
                width: '100%',
                alignItems: 'center',
                gap: 8,
                padding: '7px 10px',
                borderRadius: 8,
                border: 'none',
                backgroundColor: 'transparent',
                color: '#20242d',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'background-color 120ms ease',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#eef1f6')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <item.icon size={15} color="#687083" strokeWidth={1.8} />
              <span style={{ flex: 1 }}>{item.label}</span>
              <span style={{ fontSize: 11, color: '#9299a8', fontFamily: 'monospace' }}>
                {item.shortcut}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* 圆角胶囊药丸 (Pill) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          padding: '4px 6px',
          backgroundColor: 'rgba(255, 255, 255, 0.86)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderRadius: 9999,
          border: '1px solid #e7e9ee',
          boxShadow: '0 12px 34px rgba(20, 47, 95, 0.10), 0 2px 6px rgba(20, 47, 95, 0.04)',
        }}
      >
        {/* 撤销 (Undo) */}
        <button
          type="button"
          onClick={handleUndo}
          disabled={!canUndo}
          style={{
            display: 'inline-flex',
            width: 28,
            height: 28,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 8,
            border: 'none',
            backgroundColor: 'transparent',
            color: canUndo ? '#687083' : '#c5c9d3',
            cursor: canUndo ? 'pointer' : 'not-allowed',
            transition: 'all 140ms ease',
            opacity: canUndo ? 1 : 0.45,
          }}
          onMouseEnter={(e) => {
            if (canUndo) {
              e.currentTarget.style.backgroundColor = '#eef1f6'
              e.currentTarget.style.color = '#20242d'
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent'
            e.currentTarget.style.color = canUndo ? '#687083' : '#c5c9d3'
          }}
          title={`撤销 (${MOD}Z)`}
        >
          <Undo2 size={16} strokeWidth={1.8} />
        </button>

        {/* 重做 (Redo) */}
        <button
          type="button"
          onClick={handleRedo}
          disabled={!canRedo}
          style={{
            display: 'inline-flex',
            width: 28,
            height: 28,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 8,
            border: 'none',
            backgroundColor: 'transparent',
            color: canRedo ? '#687083' : '#c5c9d3',
            cursor: canRedo ? 'pointer' : 'not-allowed',
            transition: 'all 140ms ease',
            opacity: canRedo ? 1 : 0.45,
          }}
          onMouseEnter={(e) => {
            if (canRedo) {
              e.currentTarget.style.backgroundColor = '#eef1f6'
              e.currentTarget.style.color = '#20242d'
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent'
            e.currentTarget.style.color = canRedo ? '#687083' : '#c5c9d3'
          }}
          title={`重做 (${MOD}⇧Z)`}
        >
          <Redo2 size={16} strokeWidth={1.8} />
        </button>

        {/* 缩放数值按钮（Tabular-nums 现代等宽数字，点击弹窗菜单） */}
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          style={{
            display: 'inline-flex',
            height: 28,
            minWidth: 46,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 8,
            padding: '0 8px',
            border: 'none',
            backgroundColor: menuOpen ? '#eef1f6' : 'transparent',
            color: menuOpen ? '#20242d' : '#687083',
            fontSize: 12,
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
            cursor: 'pointer',
            transition: 'all 140ms ease',
            letterSpacing: '-0.01em',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#eef1f6'
            e.currentTarget.style.color = '#20242d'
          }}
          onMouseLeave={(e) => {
            if (!menuOpen) {
              e.currentTarget.style.backgroundColor = 'transparent'
              e.currentTarget.style.color = '#687083'
            }
          }}
          title="点击查看视图与缩放选项"
        >
          {zoomPercent}%
        </button>
      </div>
    </div>
  )
})

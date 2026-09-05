import React, { useEffect, useRef, useState } from 'react'
import { useCanvasStore } from '../store/canvasStore'
import { useViewportStore } from '../store/viewportStore'

export function BottomToolbar() {
  const activeTool = useCanvasStore((s) => s.activeTool)
  const setActiveTool = useCanvasStore((s) => s.setActiveTool)
  const addFrame = useCanvasStore((s) => s.addFrame)
  const addImage = useCanvasStore((s) => s.addImage)
  const frames = useCanvasStore((s) => s.frames)
  const images = useCanvasStore((s) => s.images)
  const activePageId = useCanvasStore((s) => s.activePageId)
  const getDocument = useCanvasStore((s) => s.getDocument)

  const setZoom = useViewportStore((s) => s.setZoom)
  const setPan = useViewportStore((s) => s.setPan)
  const screenToCanvas = useViewportStore((s) => s.screenToCanvas)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const framePresetsRef = useRef<HTMLDivElement>(null)
  const [showFramePresets, setShowFramePresets] = useState(false)

  // 点击外部关闭新建画板预设菜单
  useEffect(() => {
    if (!showFramePresets) return
    const handleClickOutside = (e: MouseEvent) => {
      if (framePresetsRef.current && !framePresetsRef.current.contains(e.target as Node)) {
        setShowFramePresets(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showFramePresets])

  const handleFitAll = () => {
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
  }

  const handleUploadFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (evt) => {
      const dataUrl = evt.target?.result as string
      if (!dataUrl) return

      const img = new Image()
      img.onload = () => {
        const center = screenToCanvas({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        })
        const maxDim = 600
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)

        addImage({
          id: 'img-' + Math.random().toString(36).slice(2, 10),
          frameId: null,
          x: center.x - w / 2,
          y: center.y - h / 2,
          width: w,
          height: h,
          rotation: 0,
          url: dataUrl,
          name: file.name.replace(/\.[^/.]+$/, ''),
          locked: false,
          opacity: 1,
        })
      }
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handleCreateFrame = (w = 1080, h = 1080) => {
    const center = screenToCanvas({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    })
    addFrame({
      id: 'frame-' + Math.random().toString(36).slice(2, 10),
      x: Math.round(center.x - w / 2),
      y: Math.round(center.y - h / 2),
      width: w,
      height: h,
    })
    setShowFramePresets(false)
  }

  const handleExportJSON = () => {
    const doc = getDocument()
    const jsonStr = JSON.stringify(doc, null, 2)
    const blob = new Blob([jsonStr], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `designflow-canvas-${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleUploadFile}
      />

      {/* 竖向浮动右侧工具坞 (Pill Dock) */}
      <div
        style={{
          position: 'absolute',
          right: 18,
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 88,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          padding: '6px',
          backgroundColor: 'rgba(255, 255, 255, 0.86)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderRadius: 9999,
          border: '1px solid #e7e9ee',
          boxShadow: '0 16px 42px rgba(20, 47, 95, 0.13), 0 2px 6px rgba(20, 47, 95, 0.04)',
          userSelect: 'none',
        }}
      >
        {/* 1. 顶部标志性圆形指针按钮 (Select) */}
        <button
          type="button"
          onClick={() => setActiveTool('select')}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 30,
            height: 30,
            borderRadius: '50%',
            border: 'none',
            backgroundColor: activeTool === 'select' ? '#181b24' : 'transparent',
            color: activeTool === 'select' ? '#ffffff' : '#687083',
            cursor: 'pointer',
            transition: 'all 140ms ease',
            boxShadow: activeTool === 'select' ? '0 2px 8px rgba(24, 27, 36, 0.25)' : 'none',
          }}
          onMouseEnter={(e) => {
            if (activeTool !== 'select') {
              e.currentTarget.style.backgroundColor = '#eef1f6'
              e.currentTarget.style.color = '#20242d'
            }
          }}
          onMouseLeave={(e) => {
            if (activeTool !== 'select') {
              e.currentTarget.style.backgroundColor = 'transparent'
              e.currentTarget.style.color = '#687083'
            }
          }}
          title="选择工具 (V)"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="3 11 22 2 13 21 11 13 3 11" fill={activeTool === 'select' ? '#ffffff' : 'none'} />
          </svg>
        </button>

        {/* 2. 抓手平移 (Hand) */}
        <button
          type="button"
          onClick={() => setActiveTool(activeTool === 'hand' ? 'select' : 'hand')}
          style={{
            ...dockBtnStyle,
            backgroundColor: activeTool === 'hand' ? '#181b24' : 'transparent',
            color: activeTool === 'hand' ? '#ffffff' : '#687083',
          }}
          onMouseEnter={(e) => {
            if (activeTool !== 'hand') {
              e.currentTarget.style.backgroundColor = '#eef1f6'
              e.currentTarget.style.color = '#20242d'
            }
          }}
          onMouseLeave={(e) => {
            if (activeTool !== 'hand') {
              e.currentTarget.style.backgroundColor = 'transparent'
              e.currentTarget.style.color = '#687083'
            }
          }}
          title="抓手平移 (H / 空格拖动)"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" />
            <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2" />
            <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8" />
            <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
          </svg>
        </button>

        {/* 3. 文本工具 (Text T) */}
        <button
          type="button"
          onClick={() => setActiveTool(activeTool === 'text' ? 'select' : 'text')}
          style={{
            ...dockBtnStyle,
            backgroundColor: activeTool === 'text' ? '#181b24' : 'transparent',
            color: activeTool === 'text' ? '#ffffff' : '#687083',
          }}
          onMouseEnter={(e) => {
            if (activeTool !== 'text') {
              e.currentTarget.style.backgroundColor = '#eef1f6'
              e.currentTarget.style.color = '#20242d'
            }
          }}
          onMouseLeave={(e) => {
            if (activeTool !== 'text') {
              e.currentTarget.style.backgroundColor = 'transparent'
              e.currentTarget.style.color = '#687083'
            }
          }}
          title="文本工具 (T / 点击画布打字)"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 7 4 4 20 4 20 7" />
            <line x1="12" y1="4" x2="12" y2="20" />
            <line x1="8" y1="20" x2="16" y2="20" />
          </svg>
        </button>

        {/* 4. 画板工具 (Frame 井号) */}
        <div ref={framePresetsRef} style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setShowFramePresets((p) => !p)}
            style={{
              ...dockBtnStyle,
              backgroundColor: showFramePresets ? '#eef1f6' : 'transparent',
              color: showFramePresets ? '#20242d' : '#687083',
            }}
            onMouseEnter={(e) => {
              if (!showFramePresets) {
                e.currentTarget.style.backgroundColor = '#eef1f6'
                e.currentTarget.style.color = '#20242d'
              }
            }}
            onMouseLeave={(e) => {
              if (!showFramePresets) {
                e.currentTarget.style.backgroundColor = 'transparent'
                e.currentTarget.style.color = '#687083'
              }
            }}
            title="新建画板 (F)"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="9" x2="20" y2="9" />
              <line x1="4" y1="15" x2="20" y2="15" />
              <line x1="10" y1="3" x2="8" y2="21" />
              <line x1="16" y1="3" x2="14" y2="21" />
            </svg>
          </button>

          {showFramePresets && (
            <div
              style={{
                position: 'absolute',
                right: 42,
                top: 0,
                backgroundColor: 'rgba(255, 255, 255, 0.94)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                color: '#20242d',
                borderRadius: 14,
                padding: '4px',
                minWidth: 156,
                boxShadow: '0 16px 40px rgba(20, 47, 95, 0.12), 0 2px 8px rgba(20, 47, 95, 0.04)',
                border: '1px solid #e7e9ee',
                fontSize: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                zIndex: 100,
              }}
            >
              <div
                onClick={() => handleCreateFrame(1080, 1080)}
                style={presetItemStyle}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#eef1f6')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                1:1
              </div>
              <div
                onClick={() => handleCreateFrame(750, 1000)}
                style={presetItemStyle}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#eef1f6')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                3:4
              </div>
              <div
                onClick={() => handleCreateFrame(1920, 1080)}
                style={presetItemStyle}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#eef1f6')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                16:9
              </div>
              <div
                onClick={() => handleCreateFrame(1080, 1920)}
                style={presetItemStyle}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#eef1f6')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                9:16
              </div>
            </div>
          )}
        </div>

        {/* 4. 适应视图全部 (Fit / Monitor) */}
        <button
          type="button"
          onClick={handleFitAll}
          style={dockBtnStyle}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#eef1f6'
            e.currentTarget.style.color = '#20242d'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent'
            e.currentTarget.style.color = '#687083'
          }}
          title="适应视图全部内容"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        </button>

        {/* 5. 导入图片 (Image Plus) */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          style={dockBtnStyle}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#eef1f6'
            e.currentTarget.style.color = '#20242d'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent'
            e.currentTarget.style.color = '#687083'
          }}
          title="导入本地图片"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7" />
            <line x1="16" y1="5" x2="22" y2="5" />
            <line x1="19" y1="2" x2="19" y2="8" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
          </svg>
        </button>

        {/* 6. 导出工程快照 JSON (Download) */}
        <button
          type="button"
          onClick={handleExportJSON}
          style={dockBtnStyle}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#eef1f6'
            e.currentTarget.style.color = '#20242d'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent'
            e.currentTarget.style.color = '#687083'
          }}
          title="导出工程快照 JSON"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
      </div>
    </>
  )
}

const dockBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 30,
  height: 30,
  borderRadius: 8,
  border: 'none',
  backgroundColor: 'transparent',
  color: '#687083',
  cursor: 'pointer',
  transition: 'all 140ms ease',
}

const presetItemStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 8,
  cursor: 'pointer',
  fontWeight: 500,
  transition: 'background-color 120ms ease',
}

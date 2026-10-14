import React, { memo, useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  X,
  ArrowLeftRight,
  ArrowUpDown,
  SlidersHorizontal,
  Maximize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Eye,
  Columns2,
  Layers,
  MousePointer,
  Sparkles,
  Download,
  Check,
} from 'lucide-react'
import type { CanvasImage } from '../types'

export type CompareMode = 'split' | 'hover' | 'hold' | 'opacity' | 'side-by-side'
export type CompareOrientation = 'horizontal' | 'vertical'

interface Props {
  imageA: CanvasImage
  imageB: CanvasImage
  onClose: () => void
}

function getImageFileName(img: CanvasImage): string {
  try {
    const pathname = new URL(img.url, window.location.origin).pathname
    const parts = pathname.split('/')
    return decodeURIComponent(parts[parts.length - 1] || img.name || 'image.png')
  } catch {
    return img.name || 'image.png'
  }
}

export const ImageCompareModal = memo(function ImageCompareModal({
  imageA,
  imageB,
  onClose,
}: Props) {
  // A 为 Before，B 为 After（支持一键交换）
  const [isSwapped, setIsSwapped] = useState(false)
  const [compareMode, setCompareMode] = useState<CompareMode>('split')
  const [orientation, setOrientation] = useState<CompareOrientation>('horizontal')

  // 滑块分割位置 (0 ~ 100%)
  const [sliderPos, setSliderPos] = useState(50)
  // 透明度模式下 After 层的透明度 (0 ~ 100)
  const [opacityVal, setOpacityVal] = useState(50)
  // 长按模式下是否当前正按住显示 Before
  const [isHoldingBefore, setIsHoldingBefore] = useState(false)

  // 缩放与平移视口状态
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const panStartRef = useRef({ x: 0, y: 0, initialPanX: 0, initialPanY: 0 })

  // 拖拽滑块状态
  const [isDraggingSlider, setIsDraggingSlider] = useState(false)

  // 探测两张图片的真实自然宽高
  const [naturalDimA, setNaturalDimA] = useState<{ w: number; h: number }>({
    w: imageA.naturalWidth || Math.round(imageA.width),
    h: imageA.naturalHeight || Math.round(imageA.height),
  })
  const [naturalDimB, setNaturalDimB] = useState<{ w: number; h: number }>({
    w: imageB.naturalWidth || Math.round(imageB.width),
    h: imageB.naturalHeight || Math.round(imageB.height),
  })

  // DOM 引用
  const containerRef = useRef<HTMLDivElement>(null)
  const stageBoxRef = useRef<HTMLDivElement>(null)

  // 确定当前的 Before 图与 After 图
  const beforeImg = isSwapped ? imageB : imageA
  const afterImg = isSwapped ? imageA : imageB

  const beforeDimObj = isSwapped ? naturalDimB : naturalDimA
  const afterDimObj = isSwapped ? naturalDimA : naturalDimB

  const beforeName = useMemo(() => getImageFileName(beforeImg), [beforeImg])
  const afterName = useMemo(() => getImageFileName(afterImg), [afterImg])

  const beforeDim = useMemo(() => `${beforeDimObj.w} × ${beforeDimObj.h}`, [beforeDimObj])
  const afterDim = useMemo(() => `${afterDimObj.w} × ${afterDimObj.h}`, [afterDimObj])

  // 异步探测两张图的原图物理分辨率，保证纵横比绝对精准
  useEffect(() => {
    let active = true
    const probeA = new Image()
    probeA.onload = () => {
      if (active && probeA.naturalWidth > 0 && probeA.naturalHeight > 0) {
        setNaturalDimA({ w: probeA.naturalWidth, h: probeA.naturalHeight })
      }
    }
    probeA.src = imageA.url

    const probeB = new Image()
    probeB.onload = () => {
      if (active && probeB.naturalWidth > 0 && probeB.naturalHeight > 0) {
        setNaturalDimB({ w: probeB.naturalWidth, h: probeB.naturalHeight })
      }
    }
    probeB.src = imageB.url

    return () => {
      active = false
    }
  }, [imageA.url, imageB.url])

  // 计算用于居中舞台的纵横比（默认采用 Before 图的比例，保证主体不形变）
  const stageRatio = useMemo(() => {
    const w = beforeDimObj.w || afterDimObj.w || 1000
    const h = beforeDimObj.h || afterDimObj.h || 1000
    return w / h
  }, [beforeDimObj, afterDimObj])

  // 重置视口缩放和平移
  const resetView = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  // 交换 Before 和 After
  const handleSwap = useCallback(() => {
    setIsSwapped((s) => !s)
  }, [])

  // 快捷键监听
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return

      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'Tab' || e.key.toLowerCase() === 'x') {
        e.preventDefault()
        handleSwap()
      } else if (e.key === '0' || e.key.toLowerCase() === 'f') {
        e.preventDefault()
        resetView()
      } else if (e.key === '1') {
        e.preventDefault()
        setZoom(1)
        setPan({ x: 0, y: 0 })
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        setSliderPos((p) => Math.max(0, p - 4))
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        setSliderPos((p) => Math.min(100, p + 4))
      } else if (e.code === 'Space' && !e.repeat) {
        e.preventDefault()
        setIsHoldingBefore(true)
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        setIsHoldingBefore(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [onClose, handleSwap, resetView])

  // 计算鼠标在图片主体盒子中的相对百分比 (0 ~ 100)
  const calcPercentFromEvent = useCallback(
    (clientX: number, clientY: number) => {
      if (!stageBoxRef.current) return 50
      const rect = stageBoxRef.current.getBoundingClientRect()
      if (orientation === 'horizontal') {
        const offsetX = clientX - rect.left
        const p = (offsetX / rect.width) * 100
        return Math.max(0, Math.min(100, Math.round(p * 10) / 10))
      } else {
        const offsetY = clientY - rect.top
        const p = (offsetY / rect.height) * 100
        return Math.max(0, Math.min(100, Math.round(p * 10) / 10))
      }
    },
    [orientation]
  )

  // 鼠标移动到图片区域（Hover 模式自动跟随滑动，或者拖拽滑块中）
  const handleBoxMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isDraggingSlider || compareMode === 'hover') {
        const p = calcPercentFromEvent(e.clientX, e.clientY)
        setSliderPos(p)
      }
    },
    [isDraggingSlider, compareMode, calcPercentFromEvent]
  )

  // 点击图片区域（Split 模式下定位并启动拖拽，Hold 模式下按住）
  const handleBoxMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // 鼠标中键 / Alt 键 / Shift 键按住触发平移
      if (e.button === 1 || e.altKey || (e.button === 0 && e.shiftKey)) {
        e.preventDefault()
        setIsPanning(true)
        panStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          initialPanX: pan.x,
          initialPanY: pan.y,
        }
        return
      }

      if (e.button === 0) {
        if (compareMode === 'split') {
          setIsDraggingSlider(true)
          const p = calcPercentFromEvent(e.clientX, e.clientY)
          setSliderPos(p)
        } else if (compareMode === 'hold') {
          setIsHoldingBefore(true)
        }
      }
    },
    [compareMode, calcPercentFromEvent, pan]
  )

  // 全局鼠标移动与释放事件监听
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (isDraggingSlider) {
        const p = calcPercentFromEvent(e.clientX, e.clientY)
        setSliderPos(p)
      } else if (isPanning) {
        const dx = e.clientX - panStartRef.current.x
        const dy = e.clientY - panStartRef.current.y
        setPan({
          x: panStartRef.current.initialPanX + dx,
          y: panStartRef.current.initialPanY + dy,
        })
      }
    }

    const handleGlobalMouseUp = () => {
      if (isDraggingSlider) {
        setIsDraggingSlider(false)
      }
      if (isPanning) {
        setIsPanning(false)
      }
      if (compareMode === 'hold') {
        setIsHoldingBefore(false)
      }
    }

    if (isDraggingSlider || isPanning || compareMode === 'hold') {
      window.addEventListener('mousemove', handleGlobalMouseMove)
      window.addEventListener('mouseup', handleGlobalMouseUp)
    }
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove)
      window.removeEventListener('mouseup', handleGlobalMouseUp)
    }
  }, [isDraggingSlider, isPanning, compareMode, calcPercentFromEvent])

  // 鼠标滚轮缩放
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87
    setZoom((prevZoom) => {
      const next = Math.max(0.4, Math.min(5, prevZoom * zoomFactor))
      return Math.round(next * 100) / 100
    })
  }, [])

  // 顶层 After 裁剪蒙版：严格以滑块百分比无损裁剪
  const clipPathStyle = useMemo(() => {
    if (orientation === 'horizontal') {
      return `inset(0 0 0 ${sliderPos}%)`
    } else {
      return `inset(${sliderPos}% 0 0 0)`
    }
  }, [orientation, sliderPos])

  return (
    <div
      ref={containerRef}
      onMouseDown={(e) => {
        if (e.target === containerRef.current) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'rgba(8, 12, 22, 0.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        color: '#f1f5f9',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      {/* 顶部控制栏 */}
      <header
        style={{
          height: 54,
          padding: '0 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          backgroundColor: 'rgba(15, 23, 42, 0.82)',
          flexShrink: 0,
          zIndex: 20,
        }}
      >
        {/* 左侧：标题与状态提示 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 15,
              fontWeight: 600,
              color: '#ffffff',
              letterSpacing: '-0.01em',
            }}
          >
            <SlidersHorizontal size={18} color="#38bdf8" />
            <span>Before / After 图像对比</span>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              color: '#94a3b8',
              backgroundColor: 'rgba(255, 255, 255, 0.06)',
              padding: '3px 10px',
              borderRadius: 6,
            }}
          >
            <span>滑动鼠标对比</span>
            <span style={{ opacity: 0.35 }}>•</span>
            <span>按住空格瞬切</span>
            <span style={{ opacity: 0.35 }}>•</span>
            <span>Esc 退出</span>
          </div>
        </div>

        {/* 中间：对比模式切换 Tabs */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            backgroundColor: 'rgba(255, 255, 255, 0.08)',
            padding: 3,
            borderRadius: 8,
            gap: 2,
          }}
        >
          <button
            type="button"
            onClick={() => setCompareMode('split')}
            style={{
              border: 'none',
              borderRadius: 6,
              padding: '5px 12px',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              color: compareMode === 'split' ? '#ffffff' : '#94a3b8',
              backgroundColor: compareMode === 'split' ? '#2563eb' : 'transparent',
              transition: 'all 0.15s ease',
            }}
            title="拖拽滑块分割对比"
          >
            <SlidersHorizontal size={13} />
            <span>拖拽分割</span>
          </button>

          <button
            type="button"
            onClick={() => setCompareMode('hover')}
            style={{
              border: 'none',
              borderRadius: 6,
              padding: '5px 12px',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              color: compareMode === 'hover' ? '#ffffff' : '#94a3b8',
              backgroundColor: compareMode === 'hover' ? '#2563eb' : 'transparent',
              transition: 'all 0.15s ease',
            }}
            title="鼠标滑动自动跟随对比"
          >
            <MousePointer size={13} />
            <span>悬停滑动</span>
          </button>

          <button
            type="button"
            onClick={() => setCompareMode('hold')}
            style={{
              border: 'none',
              borderRadius: 6,
              padding: '5px 12px',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              color: compareMode === 'hold' ? '#ffffff' : '#94a3b8',
              backgroundColor: compareMode === 'hold' ? '#2563eb' : 'transparent',
              transition: 'all 0.15s ease',
            }}
            title="鼠标长按或按空格瞬切对比"
          >
            <Eye size={13} />
            <span>长按瞬切</span>
          </button>

          <button
            type="button"
            onClick={() => setCompareMode('opacity')}
            style={{
              border: 'none',
              borderRadius: 6,
              padding: '5px 12px',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              color: compareMode === 'opacity' ? '#ffffff' : '#94a3b8',
              backgroundColor: compareMode === 'opacity' ? '#2563eb' : 'transparent',
              transition: 'all 0.15s ease',
            }}
            title="重叠透明度渐变观察"
          >
            <Layers size={13} />
            <span>透明度叠印</span>
          </button>

          <button
            type="button"
            onClick={() => setCompareMode('side-by-side')}
            style={{
              border: 'none',
              borderRadius: 6,
              padding: '5px 12px',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              color: compareMode === 'side-by-side' ? '#ffffff' : '#94a3b8',
              backgroundColor: compareMode === 'side-by-side' ? '#2563eb' : 'transparent',
              transition: 'all 0.15s ease',
            }}
            title="左右双图并排对比"
          >
            <Columns2 size={13} />
            <span>并排查看</span>
          </button>
        </div>

        {/* 右侧：方向、对调、缩放与关闭 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* 分割方向（左右 / 上下） */}
          {(compareMode === 'split' || compareMode === 'hover') && (
            <button
              type="button"
              onClick={() =>
                setOrientation((o) => (o === 'horizontal' ? 'vertical' : 'horizontal'))
              }
              style={{
                border: 'none',
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                color: '#e2e8f0',
                padding: '6px 11px',
                borderRadius: 6,
                fontSize: 12,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
              title={orientation === 'horizontal' ? '切换为上下分割对比' : '切换为左右分割对比'}
            >
              {orientation === 'horizontal' ? (
                <>
                  <ArrowUpDown size={14} />
                  <span>上下分割</span>
                </>
              ) : (
                <>
                  <ArrowLeftRight size={14} />
                  <span>左右分割</span>
                </>
              )}
            </button>
          )}

          {/* 交换 Before / After 顺序 */}
          <button
            type="button"
            onClick={handleSwap}
            style={{
              border: 'none',
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
              color: '#e2e8f0',
              padding: '6px 12px',
              borderRadius: 6,
              fontSize: 12,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
            title="对调两张图片的 Before / After 顺序 (Tab 或 X 快捷键)"
          >
            <ArrowLeftRight size={14} />
            <span>对调顺序</span>
          </button>

          {/* 缩放控制组 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
              borderRadius: 6,
              padding: '2px 4px',
            }}
          >
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.4, Math.round(z * 0.85 * 100) / 100))}
              style={{
                border: 'none',
                background: 'transparent',
                color: '#94a3b8',
                padding: 4,
                cursor: 'pointer',
                display: 'flex',
              }}
              title="缩小 (滚轮向下)"
            >
              <ZoomOut size={14} />
            </button>
            <span
              onClick={resetView}
              style={{
                fontSize: 12,
                padding: '0 6px',
                color: '#cbd5e1',
                cursor: 'pointer',
                minWidth: 44,
                textAlign: 'center',
              }}
              title="点击复位缩放"
            >
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(5, Math.round(z * 1.15 * 100) / 100))}
              style={{
                border: 'none',
                background: 'transparent',
                color: '#94a3b8',
                padding: 4,
                cursor: 'pointer',
                display: 'flex',
              }}
              title="放大 (滚轮向上)"
            >
              <ZoomIn size={14} />
            </button>
            <button
              type="button"
              onClick={resetView}
              style={{
                border: 'none',
                background: 'transparent',
                color: '#94a3b8',
                padding: 4,
                cursor: 'pointer',
                display: 'flex',
                borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
                marginLeft: 2,
              }}
              title="适应视口 / 重置 (0 快捷键)"
            >
              <RotateCcw size={13} />
            </button>
          </div>

          {/* 关闭按钮 */}
          <button
            type="button"
            onClick={onClose}
            style={{
              border: 'none',
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
              color: '#94a3b8',
              width: 32,
              height: 32,
              borderRadius: 8,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
            }}
            title="关闭对比 (Esc)"
          >
            <X size={18} />
          </button>
        </div>
      </header>

      {/* 主展示区（棋盘透明网格背景，支持平移与缩放） */}
      <main
        onWheel={handleWheel}
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: isPanning ? 'grabbing' : 'default',
          backgroundImage: `
            linear-gradient(45deg, #131b2e 25%, transparent 25%), 
            linear-gradient(-45deg, #131b2e 25%, transparent 25%), 
            linear-gradient(45deg, transparent 75%, #131b2e 75%), 
            linear-gradient(-45deg, transparent 75%, #131b2e 75%)
          `,
          backgroundSize: '24px 24px',
          backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0px',
          backgroundColor: '#0a101d',
        }}
      >
        {/* 并排对比模式 */}
        {compareMode === 'side-by-side' ? (
          <div
            style={{
              display: 'flex',
              gap: 20,
              width: '90vw',
              height: '80vh',
              alignItems: 'center',
              justifyContent: 'center',
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
              transition: isPanning ? 'none' : 'transform 0.08s ease-out',
            }}
          >
            {/* 左侧 Before */}
            <div
              style={{
                flex: 1,
                height: '100%',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(0, 0, 0, 0.4)',
                borderRadius: 12,
                overflow: 'hidden',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                boxShadow: '0 20px 48px rgba(0, 0, 0, 0.5)',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 12,
                  left: 12,
                  zIndex: 2,
                  backgroundColor: 'rgba(15, 23, 42, 0.88)',
                  backdropFilter: 'blur(8px)',
                  padding: '4px 10px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#38bdf8',
                  border: '1px solid rgba(56, 189, 248, 0.35)',
                }}
              >
                Before（原图）· {beforeDim}
              </div>
              <img
                src={beforeImg.url}
                alt={beforeName}
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                }}
                draggable={false}
              />
            </div>

            {/* 右侧 After */}
            <div
              style={{
                flex: 1,
                height: '100%',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(0, 0, 0, 0.4)',
                borderRadius: 12,
                overflow: 'hidden',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                boxShadow: '0 20px 48px rgba(0, 0, 0, 0.5)',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 12,
                  left: 12,
                  zIndex: 2,
                  backgroundColor: 'rgba(15, 23, 42, 0.88)',
                  backdropFilter: 'blur(8px)',
                  padding: '4px 10px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#c084fc',
                  border: '1px solid rgba(192, 132, 252, 0.35)',
                }}
              >
                After（对比图）· {afterDim}
              </div>
              <img
                src={afterImg.url}
                alt={afterName}
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                }}
                draggable={false}
              />
            </div>
          </div>
        ) : (
          /* 叠在一起对比视口（严密贴合图片真实比例的 stageBox） */
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
              transition: isPanning ? 'none' : 'transform 0.08s ease-out',
            }}
          >
            <div
              ref={stageBoxRef}
              onMouseDown={handleBoxMouseDown}
              onMouseMove={handleBoxMouseMove}
              style={{
                position: 'relative',
                width: 'auto',
                height: 'auto',
                maxWidth: '86vw',
                maxHeight: '80vh',
                aspectRatio: stageRatio ? `${stageRatio}` : undefined,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 10,
                overflow: 'hidden',
                boxShadow: '0 25px 60px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.12)',
                backgroundColor: 'rgba(0, 0, 0, 0.3)',
                cursor:
                  compareMode === 'hover'
                    ? 'ew-resize'
                    : compareMode === 'hold'
                    ? 'pointer'
                    : isDraggingSlider
                    ? orientation === 'horizontal'
                      ? 'ew-resize'
                      : 'ns-resize'
                    : 'default',
              }}
            >
              {/* 1. 底层：Before 图片 */}
              <img
                src={beforeImg.url}
                alt={beforeName}
                style={{
                  display: 'block',
                  maxWidth: '86vw',
                  maxHeight: '80vh',
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  pointerEvents: 'none',
                }}
                draggable={false}
              />

              {/* 2. 顶层：After 图片 */}
              <img
                src={afterImg.url}
                alt={afterName}
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'block',
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  pointerEvents: 'none',
                  opacity:
                    compareMode === 'hold'
                      ? isHoldingBefore
                        ? 0
                        : 1
                      : compareMode === 'opacity'
                      ? opacityVal / 100
                      : 1,
                  clipPath:
                    compareMode === 'split' || compareMode === 'hover'
                      ? clipPathStyle
                      : undefined,
                  transition:
                    compareMode === 'hold'
                      ? 'opacity 0.12s ease'
                      : compareMode === 'opacity'
                      ? 'opacity 0.05s ease'
                      : 'none',
                }}
                draggable={false}
              />

              {/* 3. 分割线与手柄（在 Split 或 Hover 模式下渲染） */}
              {(compareMode === 'split' || compareMode === 'hover') && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    pointerEvents: 'none',
                  }}
                >
                  {orientation === 'horizontal' ? (
                    /* 垂直分割线（左右滑动） */
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left: `${sliderPos}%`,
                        width: 2,
                        backgroundColor: '#ffffff',
                        boxShadow:
                          '0 0 10px rgba(0, 0, 0, 0.8), 0 0 2px rgba(255, 255, 255, 0.9)',
                        pointerEvents: 'auto',
                        cursor: 'ew-resize',
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation()
                        setIsDraggingSlider(true)
                      }}
                    >
                      {/* 分割线中央手柄 */}
                      <div
                        style={{
                          position: 'absolute',
                          top: '50%',
                          left: '50%',
                          transform: 'translate(-50%, -50%)',
                          width: 42,
                          height: 42,
                          borderRadius: '50%',
                          backgroundColor: '#ffffff',
                          boxShadow:
                            '0 6px 20px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(0, 0, 0, 0.15)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#0f172a',
                          cursor: 'ew-resize',
                          transition: 'transform 0.1s ease',
                        }}
                        onMouseDown={(e) => {
                          e.stopPropagation()
                          setIsDraggingSlider(true)
                        }}
                      >
                        <ArrowLeftRight size={19} strokeWidth={2.4} />
                      </div>
                    </div>
                  ) : (
                    /* 水平分割线（上下滑动） */
                    <div
                      style={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        top: `${sliderPos}%`,
                        height: 2,
                        backgroundColor: '#ffffff',
                        boxShadow:
                          '0 0 10px rgba(0, 0, 0, 0.8), 0 0 2px rgba(255, 255, 255, 0.9)',
                        pointerEvents: 'auto',
                        cursor: 'ns-resize',
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation()
                        setIsDraggingSlider(true)
                      }}
                    >
                      {/* 水平分割线中央手柄 */}
                      <div
                        style={{
                          position: 'absolute',
                          left: '50%',
                          top: '50%',
                          transform: 'translate(-50%, -50%)',
                          width: 42,
                          height: 42,
                          borderRadius: '50%',
                          backgroundColor: '#ffffff',
                          boxShadow:
                            '0 6px 20px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(0, 0, 0, 0.15)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#0f172a',
                          cursor: 'ns-resize',
                        }}
                        onMouseDown={(e) => {
                          e.stopPropagation()
                          setIsDraggingSlider(true)
                        }}
                      >
                        <ArrowUpDown size={19} strokeWidth={2.4} />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 4. 浮动指示标签（Before / After） */}
              <div
                style={{
                  position: 'absolute',
                  top: 12,
                  left: 12,
                  zIndex: 5,
                  backgroundColor: 'rgba(15, 23, 42, 0.85)',
                  backdropFilter: 'blur(8px)',
                  padding: '4px 10px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#38bdf8',
                  border: '1px solid rgba(56, 189, 248, 0.35)',
                  pointerEvents: 'none',
                  opacity:
                    (compareMode === 'split' || compareMode === 'hover') &&
                    orientation === 'horizontal' &&
                    sliderPos < 14
                      ? 0.15
                      : 1,
                  transition: 'opacity 0.15s ease',
                }}
              >
                Before（原图）· {beforeDim}
              </div>

              <div
                style={{
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  zIndex: 5,
                  backgroundColor: 'rgba(15, 23, 42, 0.85)',
                  backdropFilter: 'blur(8px)',
                  padding: '4px 10px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#c084fc',
                  border: '1px solid rgba(192, 132, 252, 0.35)',
                  pointerEvents: 'none',
                  opacity:
                    (compareMode === 'split' || compareMode === 'hover') &&
                    orientation === 'horizontal' &&
                    sliderPos > 86
                      ? 0.15
                      : 1,
                  transition: 'opacity 0.15s ease',
                }}
              >
                After（对比图）· {afterDim}
              </div>

              {/* 长按模式下的状态指示徽章 */}
              {compareMode === 'hold' && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: 20,
                    zIndex: 5,
                    backgroundColor: isHoldingBefore
                      ? 'rgba(56, 189, 248, 0.95)'
                      : 'rgba(192, 132, 252, 0.95)',
                    color: isHoldingBefore ? '#0f172a' : '#ffffff',
                    padding: '6px 18px',
                    borderRadius: 20,
                    fontSize: 13,
                    fontWeight: 600,
                    boxShadow: '0 4px 18px rgba(0, 0, 0, 0.4)',
                    pointerEvents: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    transition: 'all 0.12s ease',
                  }}
                >
                  <Eye size={15} />
                  <span>
                    {isHoldingBefore
                      ? '正在查看：Before（原图）'
                      : '当前显示：After（对比图）- 按住鼠标或空格瞬切原图'}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* 底部悬浮控制条 */}
      <footer
        style={{
          height: 50,
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          backgroundColor: 'rgba(15, 23, 42, 0.88)',
          flexShrink: 0,
          zIndex: 20,
        }}
      >
        {/* 左侧：对比双方文件名 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 12, color: '#94a3b8' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#38bdf8', fontWeight: 600 }}>Before:</span>
            <span
              style={{
                maxWidth: 240,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: '#e2e8f0',
              }}
              title={beforeName}
            >
              {beforeName}
            </span>
          </div>
          <span style={{ opacity: 0.35 }}>|</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#c084fc', fontWeight: 600 }}>After:</span>
            <span
              style={{
                maxWidth: 240,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: '#e2e8f0',
              }}
              title={afterName}
            >
              {afterName}
            </span>
          </div>
        </div>

        {/* 中间：根据模式动态渲染快速定位按钮或透明度滑块 */}
        {compareMode === 'opacity' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: 340 }}>
            <span style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap' }}>Before</span>
            <input
              type="range"
              min="0"
              max="100"
              value={opacityVal}
              onChange={(e) => setOpacityVal(Number(e.target.value))}
              style={{
                flex: 1,
                cursor: 'pointer',
                accentColor: '#38bdf8',
              }}
            />
            <span style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap' }}>After</span>
            <span style={{ fontSize: 12, color: '#e2e8f0', minWidth: 36, textAlign: 'right' }}>
              {opacityVal}%
            </span>
          </div>
        ) : compareMode === 'split' || compareMode === 'hover' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#64748b', marginRight: 6 }}>快捷定位:</span>
            {[0, 25, 50, 75, 100].map((pos) => (
              <button
                key={pos}
                type="button"
                onClick={() => setSliderPos(pos)}
                style={{
                  border: 'none',
                  backgroundColor:
                    Math.round(sliderPos) === pos
                      ? '#2563eb'
                      : 'rgba(255, 255, 255, 0.08)',
                  color: Math.round(sliderPos) === pos ? '#ffffff' : '#cbd5e1',
                  padding: '3px 10px',
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.12s ease',
                }}
              >
                {pos === 0 ? '全原图' : pos === 100 ? '全对比' : `${pos}%`}
              </button>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: '#64748b' }}>
            按住鼠标左键或空格键随时瞬切 Before 查看
          </div>
        )}

        {/* 右侧：交互快捷提示 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#64748b' }}>
          <span>滚轮缩放</span>
          <span>•</span>
          <span>Shift/中键拖动画布</span>
          <span>•</span>
          <span>Tab/X 对调</span>
        </div>
      </footer>
    </div>
  )
})

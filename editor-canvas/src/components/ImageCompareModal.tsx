import { memo, useState, useEffect, useRef, useCallback, type PointerEvent } from 'react'
import type { CanvasImage } from '../types'

interface Props {
  imageA: CanvasImage
  imageB: CanvasImage
  onClose: () => void
}

// 舞台四周留白
const STAGE_PADDING_X = 64
const STAGE_PADDING_Y = 72
const MAX_ZOOM = 8

type View = { zoom: number; x: number; y: number }
const FIT_VIEW: View = { zoom: 1, x: 0, y: 0 }

// 以舞台内 (cx, cy) 为锚点缩放，并限制平移范围，保证图片始终铺满舞台
function zoomAt(view: View, nextZoom: number, cx: number, cy: number, w: number, h: number): View {
  const zoom = Math.max(1, Math.min(MAX_ZOOM, nextZoom))
  const k = zoom / view.zoom
  return clampView({ zoom, x: cx - (cx - view.x) * k, y: cy - (cy - view.y) * k }, w, h)
}

// 区分妙控板双指滑动与鼠标滚轮：Chrome / Safari 中触控板事件的 wheelDeltaY 恰为 -3 × deltaY，
// 鼠标滚轮为 ±120 的整格；无 wheelDeltaY 的浏览器按像素模式视为触控板
function isTrackpadScroll(e: WheelEvent): boolean {
  if (e.deltaY === 0) return true
  const wheelDeltaY = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY
  if (typeof wheelDeltaY === 'number' && wheelDeltaY !== 0) return wheelDeltaY === -3 * e.deltaY
  return e.deltaMode === 0
}

function clampView(view: View, w: number, h: number): View {
  return {
    zoom: view.zoom,
    x: Math.min(0, Math.max(w * (1 - view.zoom), view.x)),
    y: Math.min(0, Math.max(h * (1 - view.zoom), view.y)),
  }
}

/**
 * Before / After 滑动对比（极简）：鼠标在图片上左右移动，分割线随之跟随。
 * 默认 A 为 Before（底层），B 为 After（顶层，按滑块位置裁剪），按 X 对调。
 * 妙控板捏合或鼠标滚轮缩放，放大后双指滑动或按住拖动平移，双击或按 0 复位。
 */
export const ImageCompareModal = memo(function ImageCompareModal({ imageA, imageB, onClose }: Props) {
  const [sliderPos, setSliderPos] = useState(50)
  const [isSwapped, setIsSwapped] = useState(false)
  const beforeImg = isSwapped ? imageB : imageA
  const afterImg = isSwapped ? imageA : imageB
  const [ratio, setRatio] = useState(1)
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight })
  const [view, setView] = useState<View>(FIT_VIEW)
  const viewRef = useRef(view)
  viewRef.current = view
  const [isPanning, setIsPanning] = useState(false)
  const panStartRef = useRef<{ clientX: number; clientY: number; x: number; y: number } | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)

  // 以 Before 图的真实比例确定舞台尺寸
  useEffect(() => {
    const w = beforeImg.naturalWidth || beforeImg.width
    const h = beforeImg.naturalHeight || beforeImg.height
    if (w > 0 && h > 0) setRatio(w / h)
    setView(FIT_VIEW)

    let active = true
    const probe = new Image()
    probe.onload = () => {
      if (active && probe.naturalWidth > 0 && probe.naturalHeight > 0) {
        setRatio(probe.naturalWidth / probe.naturalHeight)
      }
    }
    probe.src = beforeImg.url
    return () => {
      active = false
    }
  }, [beforeImg])

  useEffect(() => {
    const onResize = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight })
      setView(FIT_VIEW)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const maxW = Math.max(120, viewport.w - STAGE_PADDING_X * 2)
  const maxH = Math.max(120, viewport.h - STAGE_PADDING_Y * 2)
  const stageW = Math.min(maxW, maxH * ratio)
  const stageH = stageW / ratio

  useEffect(() => {
    // 捕获阶段拦截全部按键：弹窗打开时画布快捷键（删除、撤销、切换工具等）不得作用于背后选中的图片
    const onKeyDown = (e: KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'x' || e.key === 'X') {
        e.preventDefault()
        setIsSwapped((v) => !v)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setSliderPos((p) => Math.max(0, p - 5))
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        setSliderPos((p) => Math.min(100, p + 5))
      } else if (e.key === '0') {
        e.preventDefault()
        setView(FIT_VIEW)
      } else if (e.key === '=' || e.key === '+' || e.key === '-') {
        e.preventDefault()
        const factor = e.key === '-' ? 1 / 1.25 : 1.25
        setView((v) => zoomAt(v, v.zoom * factor, stageW / 2, stageH / 2, stageW, stageH))
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose, stageW, stageH])

  // 整个弹窗拦截滚轮与手势（否则捏合会缩放整个页面），只有指针在预览区内才作用于图片：
  // 妙控板双指捏合 → 缩放；妙控板双指滑动 → 放大后平移；鼠标滚轮 → 缩放
  useEffect(() => {
    const backdrop = backdropRef.current
    const stage = stageRef.current
    if (!backdrop || !stage) return
    const inStage = (e: Event) => stage.contains(e.target as Node)

    const onWheel = (e: WheelEvent) => {
      // 弹窗渲染在画布容器内，必须阻止冒泡，否则背后的画布会跟着平移/缩放
      e.preventDefault()
      e.stopPropagation()
      if (!inStage(e)) return
      const rect = stage.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      if (e.ctrlKey) {
        // Chrome / Edge / Firefox 的触控板捏合以 ctrl + wheel 形式上报
        setView((v) => zoomAt(v, v.zoom * Math.exp(-e.deltaY * 0.01), cx, cy, rect.width, rect.height))
      } else if (isTrackpadScroll(e)) {
        setView((v) => clampView({ zoom: v.zoom, x: v.x - e.deltaX, y: v.y - e.deltaY }, rect.width, rect.height))
      } else {
        setView((v) => zoomAt(v, v.zoom * Math.exp(-e.deltaY * 0.0015), cx, cy, rect.width, rect.height))
      }
    }

    // Safari 的触控板捏合走 gesture 事件，scale 为相对手势开始时的累计倍数
    let gestureStartZoom = 1
    const onGestureStart = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
      gestureStartZoom = viewRef.current.zoom
    }
    const onGestureChange = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
      if (!inStage(e)) return
      const g = e as Event & { scale: number; clientX: number; clientY: number }
      const rect = stage.getBoundingClientRect()
      setView((v) => zoomAt(v, gestureStartZoom * g.scale, g.clientX - rect.left, g.clientY - rect.top, rect.width, rect.height))
    }
    const preventGesture = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
    }

    backdrop.addEventListener('wheel', onWheel, { passive: false })
    backdrop.addEventListener('gesturestart', onGestureStart, { passive: false })
    backdrop.addEventListener('gesturechange', onGestureChange, { passive: false })
    backdrop.addEventListener('gestureend', preventGesture, { passive: false })
    return () => {
      backdrop.removeEventListener('wheel', onWheel)
      backdrop.removeEventListener('gesturestart', onGestureStart)
      backdrop.removeEventListener('gesturechange', onGestureChange)
      backdrop.removeEventListener('gestureend', preventGesture)
    }
  }, [])

  const updateFromPointer = useCallback((clientX: number) => {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return
    const p = ((clientX - rect.left) / rect.width) * 100
    setSliderPos(Math.max(0, Math.min(100, p)))
  }, [])

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (view.zoom > 1 && e.button === 0) {
      e.currentTarget.setPointerCapture(e.pointerId)
      panStartRef.current = { clientX: e.clientX, clientY: e.clientY, x: view.x, y: view.y }
      setIsPanning(true)
      return
    }
    updateFromPointer(e.clientX)
  }

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const start = panStartRef.current
    if (start) {
      setView((v) =>
        clampView({ zoom: v.zoom, x: start.x + e.clientX - start.clientX, y: start.y + e.clientY - start.clientY }, stageW, stageH)
      )
      return
    }
    updateFromPointer(e.clientX)
  }

  const endPan = () => {
    panStartRef.current = null
    setIsPanning(false)
  }

  // 两张图共用同一变换；裁剪放在未变换的外层，分割线始终以舞台坐标为准
  const imgTransform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`

  return (
    <div
      ref={backdropRef}
      className="designflow-compare-backdrop"
      onPointerDown={(e) => {
        // 只有左键点击空白处才关闭，右键/中键不应误关
        if (e.target === e.currentTarget && e.button === 0) onClose()
      }}
      // 弹窗渲染在画布容器内：拦截鼠标与右键事件，避免冒泡触发画布的平移、框选和右键菜单
      onMouseDown={(e) => e.stopPropagation()}
      onMouseMove={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <button
        type="button"
        className="designflow-compare-close"
        onClick={onClose}
        title="关闭 (Esc)"
        aria-label="关闭对比"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>

      <div
        ref={stageRef}
        className="designflow-compare-stage"
        style={{
          width: stageW,
          height: stageH,
          cursor: view.zoom > 1 ? (isPanning ? 'grabbing' : 'grab') : undefined,
        }}
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerDown}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onDoubleClick={() => setView(FIT_VIEW)}
        role="slider"
        aria-label="Before / After 对比"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(sliderPos)}
      >
        <div className="designflow-compare-layer">
          <img src={beforeImg.url} alt="Before" draggable={false} className="designflow-compare-img" style={{ transform: imgTransform }} />
        </div>
        <div className="designflow-compare-layer" style={{ clipPath: `inset(0 0 0 ${sliderPos}%)` }}>
          <img src={afterImg.url} alt="After" draggable={false} className="designflow-compare-img" style={{ transform: imgTransform }} />
        </div>

        <span className="designflow-compare-tag" style={{ left: 12, opacity: sliderPos < 12 ? 0 : 1 }}>
          Before
        </span>
        <span className="designflow-compare-tag" style={{ right: 12, opacity: sliderPos > 88 ? 0 : 1 }}>
          After
        </span>

        <div className="designflow-compare-divider" style={{ left: `${sliderPos}%` }}>
          <div className="designflow-compare-handle">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 7l-5 5 5 5" />
              <path d="M15 7l5 5-5 5" />
            </svg>
          </div>
        </div>
      </div>

      {view.zoom > 1 && (
        <button type="button" className="designflow-compare-zoom" onClick={() => setView(FIT_VIEW)} title="复位 (0 / 双击)">
          {Math.round(view.zoom * 100)}%
        </button>
      )}
    </div>
  )
})

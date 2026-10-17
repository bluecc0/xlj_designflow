import { memo, useState, useEffect, useRef, useCallback } from 'react'
import type { CanvasImage } from '../types'

interface Props {
  imageA: CanvasImage
  imageB: CanvasImage
  onClose: () => void
}

// 舞台四周留白
const STAGE_PADDING_X = 64
const STAGE_PADDING_Y = 72

/**
 * Before / After 滑动对比（极简）：鼠标在图片上左右移动，分割线随之跟随。
 * 默认 A 为 Before（底层），B 为 After（顶层，按滑块位置裁剪），按 X 对调。
 */
export const ImageCompareModal = memo(function ImageCompareModal({ imageA, imageB, onClose }: Props) {
  const [sliderPos, setSliderPos] = useState(50)
  const [isSwapped, setIsSwapped] = useState(false)
  const beforeImg = isSwapped ? imageB : imageA
  const afterImg = isSwapped ? imageA : imageB
  const [ratio, setRatio] = useState(1)
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight })
  const stageRef = useRef<HTMLDivElement>(null)

  // 以 Before 图的真实比例确定舞台尺寸
  useEffect(() => {
    const w = beforeImg.naturalWidth || beforeImg.width
    const h = beforeImg.naturalHeight || beforeImg.height
    if (w > 0 && h > 0) setRatio(w / h)

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
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

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
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  const maxW = Math.max(120, viewport.w - STAGE_PADDING_X * 2)
  const maxH = Math.max(120, viewport.h - STAGE_PADDING_Y * 2)
  const stageW = Math.min(maxW, maxH * ratio)
  const stageH = stageW / ratio

  const updateFromPointer = useCallback((clientX: number) => {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return
    const p = ((clientX - rect.left) / rect.width) * 100
    setSliderPos(Math.max(0, Math.min(100, p)))
  }, [])

  return (
    <div
      className="designflow-compare-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
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
        style={{ width: stageW, height: stageH }}
        onPointerMove={(e) => updateFromPointer(e.clientX)}
        onPointerDown={(e) => updateFromPointer(e.clientX)}
        role="slider"
        aria-label="Before / After 对比"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(sliderPos)}
      >
        <img src={beforeImg.url} alt="Before" draggable={false} className="designflow-compare-img" />
        <img
          src={afterImg.url}
          alt="After"
          draggable={false}
          className="designflow-compare-img"
          style={{ clipPath: `inset(0 0 0 ${sliderPos}%)` }}
        />

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
    </div>
  )
})

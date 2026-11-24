import React, { useEffect, useState } from 'react'
import { MathCurveLoader } from './MathCurveLoader'

export interface PendingCanvasImage {
  id: string
  label?: string
  aspectRatio?: string
  progress?: number
  startedAt?: number
  seed?: number
  previewUrl?: string
}

interface Props {
  item: PendingCanvasImage
  x: number
  y: number
  width: number
  height: number
  cellX?: number
  cellWidth?: number
  cellHeight?: number
  index?: number
  zoom?: number
}

export function parsePendingAspectDimensions(
  aspectRatio: string | undefined,
  cellW: number,
  cellH: number
): { width: number; height: number } {
  const raw = String(aspectRatio || '').trim().toLowerCase()
  let ratio = 1
  if (raw && raw !== 'auto') {
    const m = raw.match(/^(\d+(?:\.\d+)?)\s*[:x×/]\s*(\d+(?:\.\d+)?)$/)
    if (m) {
      const w = parseFloat(m[1])
      const h = parseFloat(m[2])
      if (w > 0 && h > 0) ratio = w / h
    }
  }
  const baseW = ratio >= 1 ? cellW : Math.round(cellH * ratio)
  const baseH = ratio >= 1 ? Math.round(cellW / ratio) : cellH
  const scale = Math.min(1, cellW / Math.max(1, baseW), cellH / Math.max(1, baseH))
  return {
    width: Math.max(120, Math.round(baseW * scale)),
    height: Math.max(120, Math.round(baseH * scale)),
  }
}

export const PendingImagePlaceholder: React.FC<Props> = ({
  item,
  x,
  y,
  width,
  height,
  cellX,
  cellWidth,
  cellHeight,
  index = 0,
  zoom = 1,
}) => {
  const seed = Number(item.seed) || index
  // 抵消画布 scale(zoom)，使居中动效与文字在任意缩放下都与右侧面板保持一致的屏幕视觉尺寸
  const contentScale = Math.min(2.2, Math.max(0.85, 1 / Math.max(0.35, zoom)))
  const borderWidth = Math.min(2.5, Math.max(1, 1 / Math.max(0.4, zoom)))
  const [previewLoaded, setPreviewLoaded] = useState(false)
  const [naturalDims, setNaturalDims] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    if (!item.previewUrl) {
      setPreviewLoaded(false)
      setNaturalDims(null)
    }
  }, [item.previewUrl])

  const phaseDelay = `${-((seed % 5) * 1.65).toFixed(2)}s`
  const sweepDelay = `${-((seed % 5) * 0.85).toFixed(2)}s`

  // 提前显影出真实图片时，按 reflowSequentialImages 同款算法贴合真实图片宽高
  let renderX = x
  let renderW = width
  let renderH = height
  if (previewLoaded && naturalDims && cellWidth && cellHeight) {
    const scale = Math.min(1, cellWidth / naturalDims.w, cellHeight / naturalDims.h)
    renderW = Math.max(1, Math.round(naturalDims.w * scale))
    renderH = Math.max(1, Math.round(naturalDims.h * scale))
    if (typeof cellX === 'number') {
      renderX = cellX + Math.round((cellWidth - renderW) / 2)
    }
  }

  return (
    <div
      className={previewLoaded ? 'df-canvas-pending is-settled' : 'df-canvas-pending'}
      style={{
        position: 'absolute',
        left: renderX,
        top: y,
        width: renderW,
        height: renderH,
        borderWidth: previewLoaded ? 0 : borderWidth,
        pointerEvents: 'none',
        userSelect: 'none',
        transition: 'left 260ms ease, width 260ms ease, height 260ms ease, border-color 320ms ease, box-shadow 320ms ease',
      }}
    >
      <div className={previewLoaded ? 'df-canvas-pending-aurora is-fading' : 'df-canvas-pending-aurora'}>
        <span className="df-canvas-pending-orb is-a" style={{ animationDelay: phaseDelay }} />
        <span className="df-canvas-pending-orb is-b" style={{ animationDelay: phaseDelay }} />
        <span className="df-canvas-pending-sweep" style={{ animationDelay: sweepDelay }} />
      </div>

      {item.previewUrl && (
        <img
          src={item.previewUrl}
          alt={item.label || 'preview'}
          className={`df-canvas-reveal-img ${previewLoaded ? 'is-loaded' : 'is-loading'}`}
          onLoad={(e) => {
            const img = e.currentTarget
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              setNaturalDims({ w: img.naturalWidth, h: img.naturalHeight })
            }
            setPreviewLoaded(true)
          }}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            display: 'block',
            zIndex: 1,
          }}
        />
      )}

      {!previewLoaded && (
        <div
          className="df-canvas-pending-center"
          style={{ transform: `scale(${contentScale.toFixed(3)})` }}
        >
          <MathCurveLoader size={34} seed={seed} />
          <span className="df-canvas-pending-label">
            正在生成<span className="df-pending-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>
          </span>
        </div>
      )}
    </div>
  )
}

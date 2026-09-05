import React, { memo } from 'react'

interface Props {
  zoom: number
  panX: number
  panY: number
}

function CanvasGridInner({ zoom, panX, panY }: Props) {
  const dotSize = 20 * zoom
  const dotRadius = Math.max(0.6, 1.2 * Math.min(1.2, zoom))
  const dotColor = 'rgba(110, 125, 145, 0.22)'

  // 视口偏移对齐 pattern
  const offsetX = panX % dotSize
  const offsetY = panY % dotSize

  return (
    <svg
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    >
      <defs>
        <pattern
          id="canvas-dot-grid"
          width={dotSize}
          height={dotSize}
          x={offsetX}
          y={offsetY}
          patternUnits="userSpaceOnUse"
        >
          <circle cx={dotSize / 2} cy={dotSize / 2} r={dotRadius} fill={dotColor} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#canvas-dot-grid)" />
    </svg>
  )
}

export const CanvasGrid = memo(CanvasGridInner)

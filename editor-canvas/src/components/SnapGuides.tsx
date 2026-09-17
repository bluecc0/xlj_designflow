import React, { memo } from 'react'
import type { SnapLine } from '../utils/snapping'
import { useViewportStore } from '../store/viewportStore'
import { useSnapStore } from '../store/snapStore'

interface Props {
  lines?: SnapLine[]
}

function SnapGuidesInner({ lines: propLines }: Props) {
  const zoom = useViewportStore((s) => s.zoom)
  const storeLines = useSnapStore((s) => s.snapLines)

  const activeLines = propLines && propLines.length > 0 ? propLines : storeLines
  if (!activeLines || activeLines.length === 0) return null

  // 保持屏幕像素固定为 1px 的矢量辅助线
  const lineWidth = Math.max(0.5, 1 / zoom)

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 55,
      }}
    >
      {activeLines.map((line) => {
        if (line.type === 'vertical') {
          const top = Math.min(line.start, line.end)
          const height = Math.abs(line.end - line.start)
          return (
            <div
              key={line.id}
              style={{
                position: 'absolute',
                left: line.pos,
                top,
                width: lineWidth,
                height,
                backgroundColor: '#f43f5e',
                boxShadow: '0 0 1px rgba(244, 63, 94, 0.4)',
                transform: 'translateX(-50%)',
              }}
            />
          )
        }

        const left = Math.min(line.start, line.end)
        const width = Math.abs(line.end - line.start)
        return (
          <div
            key={line.id}
            style={{
              position: 'absolute',
              left,
              top: line.pos,
              width,
              height: lineWidth,
              backgroundColor: '#f43f5e',
              boxShadow: '0 0 1px rgba(244, 63, 94, 0.4)',
              transform: 'translateY(-50%)',
            }}
          />
        )
      })}
    </div>
  )
}

export const SnapGuides = memo(SnapGuidesInner)

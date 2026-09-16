import React, { memo } from 'react'
import type { SnapLine } from '../utils/snapping'
import { useViewportStore } from '../store/viewportStore'

interface Props {
  lines: SnapLine[]
}

function SnapGuidesInner({ lines }: Props) {
  const zoom = useViewportStore((s) => s.zoom)
  if (!lines || lines.length === 0) return null

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
        zIndex: 50,
      }}
    >
      {lines.map((line) => {
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
                backgroundColor: '#2563eb',
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
              backgroundColor: '#2563eb',
              transform: 'translateY(-50%)',
            }}
          />
        )
      })}
    </div>
  )
}

export const SnapGuides = memo(SnapGuidesInner)

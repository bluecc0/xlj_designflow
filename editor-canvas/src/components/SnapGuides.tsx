import React, { memo } from 'react'
import type { SnapLine } from '../utils/snapping'

interface Props {
  lines: SnapLine[]
}

function SnapGuidesInner({ lines }: Props) {
  if (!lines || lines.length === 0) return null

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
                width: 1,
                height,
                backgroundColor: '#2563eb',
                boxShadow: '0 0 2px rgba(37, 99, 235, 0.4)',
                transform: 'translateX(-0.5px)',
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
              height: 1,
              backgroundColor: '#2563eb',
              boxShadow: '0 0 2px rgba(37, 99, 235, 0.4)',
              transform: 'translateY(-0.5px)',
            }}
          />
        )
      })}
    </div>
  )
}

export const SnapGuides = memo(SnapGuidesInner)

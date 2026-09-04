import React from 'react'
import type { CanvasFrame } from '../types'

interface Props {
  frame: CanvasFrame
  isActive: boolean
  onClick: () => void
}

export function FrameShape({ frame, isActive, onClick }: Props) {
  return (
    <div
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      style={{
        position: 'absolute',
        left: frame.x,
        top: frame.y,
        width: frame.width,
        height: frame.height,
        backgroundColor: '#ffffff',
        boxShadow: isActive
          ? '0 0 0 1.5px #4f46e5, 0 12px 36px -4px rgba(0, 0, 0, 0.12)'
          : '0 4px 20px -2px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0,0,0,0.05)',
        borderRadius: 4,
        userSelect: 'none',
        transition: 'box-shadow 150ms ease',
      }}
    >
      {/* 顶部画板标题 */}
      <div
        style={{
          position: 'absolute',
          top: -24,
          left: 0,
          fontSize: 11,
          fontWeight: 600,
          color: isActive ? '#4f46e5' : '#64748b',
          letterSpacing: '0.02em',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          whiteSpace: 'nowrap',
        }}
      >
        <span>{frame.name}</span>
        <span style={{ fontSize: 10, opacity: 0.7, fontWeight: 400 }}>
          {frame.width} × {frame.height}
        </span>
      </div>
    </div>
  )
}

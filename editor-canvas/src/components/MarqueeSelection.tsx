import React from 'react'
import { useViewportStore } from '../store/viewportStore'

interface Props {
  startScreen: { x: number; y: number } | null
  currentScreen: { x: number; y: number } | null
}

export function MarqueeSelection({ startScreen, currentScreen }: Props) {
  if (!startScreen || !currentScreen) return null

  const x = Math.min(startScreen.x, currentScreen.x)
  const y = Math.min(startScreen.y, currentScreen.y)
  const width = Math.abs(currentScreen.x - startScreen.x)
  const height = Math.abs(currentScreen.y - startScreen.y)

  if (width < 3 && height < 3) return null

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        height,
        backgroundColor: 'rgba(15, 23, 42, 0.06)',
        border: '1px solid rgba(15, 23, 42, 0.35)',
        borderRadius: 2,
        pointerEvents: 'none',
        zIndex: 85,
      }}
    />
  )
}

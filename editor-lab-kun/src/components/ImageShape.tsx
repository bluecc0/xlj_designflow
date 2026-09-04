import React, { memo } from 'react'
import type { CanvasImage } from '../types'

interface Props {
  image: CanvasImage
  isSelected: boolean
  onSelect: () => void
}

function ImageShapeInner({ image, onSelect }: Props) {
  return (
    <div
      onClick={(e) => {
        e.stopPropagation()
        onSelect()
      }}
      style={{
        position: 'absolute',
        left: image.x,
        top: image.y,
        width: image.width,
        height: image.height,
        transform: `rotate(${image.rotation}deg)`,
        transformOrigin: 'center center',
        cursor: 'move',
        userSelect: 'none',
      }}
    >
      <img
        src={image.url}
        alt={image.name || 'image'}
        draggable={false}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          display: 'block',
          opacity: image.opacity ?? 1,
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}

export const ImageShape = memo(ImageShapeInner)

import React, { memo, useRef } from 'react'
import type { CanvasImage } from '../types'
import { useViewportStore } from '../store/viewportStore'
import { useCanvasStore } from '../store/canvasStore'

interface Props {
  image: CanvasImage
  isSelected: boolean
  isSingleSelected?: boolean
  onSelect: (isShift: boolean) => void
  onContextMenu?: (e: React.MouseEvent) => void
}

function ImageShapeInner({
  image,
  isSelected,
  isSingleSelected = false,
  onSelect,
  onContextMenu,
}: Props) {
  const zoom = useViewportStore((s) => s.zoom)
  const updateImages = useCanvasStore((s) => s.updateImages)

  const handleMouseDown = (e: React.MouseEvent) => {
    // 仅响应鼠标主键（左键）
    if (e.button !== 0) return
    e.stopPropagation()

    const isShift = e.shiftKey || e.metaKey

    if (isShift) {
      // 按住 Shift 键：切换多选（加选 / 减选）
      onSelect(true)
      return
    }

    // 没按 Shift 键：若当前未被选中，则立即单选
    if (!isSelected) {
      onSelect(false)
    }

    // 开始拖拽准备
    const startClientX = e.clientX
    const startClientY = e.clientY
    let hasMoved = false

    // 获取当前选区内的所有图片及其初始坐标
    const { selectedIds, selectedType, images } = useCanvasStore.getState()
    const isMulti = isSelected && selectedType === 'image' && selectedIds.length > 1
    const targetIds = isMulti ? selectedIds : [image.id]
    const initialPositions = images
      .filter((im) => targetIds.includes(im.id))
      .map((im) => ({ id: im.id, x: im.x, y: im.y }))

    const onMouseMove = (moveEvt: MouseEvent) => {
      const dist = Math.hypot(moveEvt.clientX - startClientX, moveEvt.clientY - startClientY)
      if (!hasMoved && dist > 3) {
        hasMoved = true
      }
      if (hasMoved) {
        const dx = (moveEvt.clientX - startClientX) / zoom
        const dy = (moveEvt.clientY - startClientY) / zoom

        updateImages(
          initialPositions.map((pos) => ({
            id: pos.id,
            patch: {
              x: Math.round(pos.x + dx),
              y: Math.round(pos.y + dy),
            },
          }))
        )
      }
    }

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      if (hasMoved) {
        useCanvasStore.getState().recalcFrameAttachment('image', targetIds)
      }
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  return (
    <div
      onMouseDown={handleMouseDown}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onContextMenu?.(e)
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
        // 多选或单选时的高亮轮廓（单选时若已有 SelectionOverlay 则不重复加深阴影）
        boxShadow: isSelected && !isSingleSelected ? '0 0 0 1.5px #181b24, 0 4px 14px rgba(0,0,0,0.10)' : 'none',
        borderRadius: 2,
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

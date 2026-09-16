import React, { memo, useRef, useState, useEffect } from 'react'
import type { CanvasText } from '../types'
import { useViewportStore } from '../store/viewportStore'
import { useCanvasStore } from '../store/canvasStore'

interface Props {
  text: CanvasText
  isSelected: boolean
  isEditingDefault?: boolean
  onSelect: (isShift: boolean) => void
  onContextMenu?: (e: React.MouseEvent) => void
}

function TextShapeInner({
  text,
  isSelected,
  isEditingDefault = false,
  onSelect,
  onContextMenu,
}: Props) {
  const zoom = useViewportStore((s) => s.zoom)
  const updateText = useCanvasStore((s) => s.updateText)
  const deleteText = useCanvasStore((s) => s.deleteText)

  const [isEditing, setIsEditing] = useState(isEditingDefault)
  const [editingValue, setEditingValue] = useState(text.text)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setEditingValue(text.text)
  }, [text.text])

  useEffect(() => {
    if (isEditing) {
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus()
          textareaRef.current.select()
        }
      }, 30)
    }
  }, [isEditing])

  const handleFinishEditing = () => {
    setIsEditing(false)
    const trimmed = editingValue.trim()
    if (!trimmed) {
      // 如果完全清空则移除该文本
      deleteText(text.id)
    } else {
      updateText(text.id, { text: editingValue })
    }
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isEditing) {
      e.stopPropagation()
      return
    }
    if (e.button !== 0) return
    e.stopPropagation()

    const isShift = e.shiftKey || e.metaKey
    if (isShift) {
      onSelect(true)
      return
    }

    if (!isSelected) {
      onSelect(false)
    }

    // 准备拖拽
    const startClientX = e.clientX
    const startClientY = e.clientY
    const startX = text.x
    const startY = text.y
    let hasMoved = false

    const onMouseMove = (moveEvt: MouseEvent) => {
      const dist = Math.hypot(moveEvt.clientX - startClientX, moveEvt.clientY - startClientY)
      if (!hasMoved && dist > 3) {
        hasMoved = true
      }
      if (hasMoved) {
        const dx = (moveEvt.clientX - startClientX) / zoom
        const dy = (moveEvt.clientY - startClientY) / zoom
        updateText(text.id, {
          x: Math.round(startX + dx),
          y: Math.round(startY + dy),
        })
      }
    }

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      if (hasMoved) {
        useCanvasStore.getState().recalcFrameAttachment('text', [text.id])
      }
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  return (
    <div
      onMouseDown={handleMouseDown}
      onDoubleClick={(e) => {
        e.stopPropagation()
        setIsEditing(true)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onContextMenu?.(e)
      }}
      style={{
        position: 'absolute',
        left: text.x,
        top: text.y,
        width: 'max-content',
        minWidth: 'max-content',
        maxWidth: 1200,
        cursor: isEditing ? 'text' : 'move',
        userSelect: isEditing ? 'text' : 'none',
        padding: '4px 8px',
        borderRadius: 4,
        outline: isSelected && !isEditing ? '1.5px solid #0f172a' : 'none',
        outlineOffset: 2,
        background: isEditing ? '#ffffff' : 'transparent',
        boxShadow: isEditing ? '0 4px 16px rgba(0,0,0,0.12), 0 0 0 1px #0f172a' : 'none',
        zIndex: isSelected ? 40 : 15,
      }}
    >
      {isEditing ? (
        <textarea
          ref={textareaRef}
          value={editingValue}
          onChange={(e) => setEditingValue(e.target.value)}
          onBlur={handleFinishEditing}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') {
              handleFinishEditing()
            } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              handleFinishEditing()
            }
          }}
          style={{
            display: 'block',
            width: '100%',
            minWidth: 160,
            minHeight: Math.max(32, (text.fontSize || 24) * 1.4),
            border: 'none',
            outline: 'none',
            background: 'transparent',
            resize: 'none',
            fontFamily: 'inherit',
            fontSize: text.fontSize || 24,
            fontWeight: text.fontWeight || 'normal',
            fontStyle: text.fontStyle || 'normal',
            textAlign: text.textAlign || 'left',
            color: text.color || '#0f172a',
            lineHeight: 1.35,
            padding: 0,
            margin: 0,
            whiteSpace: 'pre',
          }}
        />
      ) : (
        <div
          style={{
            fontFamily: 'inherit',
            fontSize: text.fontSize || 24,
            fontWeight: text.fontWeight || 'normal',
            fontStyle: text.fontStyle || 'normal',
            textAlign: text.textAlign || 'left',
            color: text.color || '#0f172a',
            lineHeight: 1.35,
            whiteSpace: 'pre',
            pointerEvents: 'none',
          }}
        >
          {text.text || '双击编辑文本'}
        </div>
      )}
    </div>
  )
}

export const TextShape = memo(TextShapeInner)

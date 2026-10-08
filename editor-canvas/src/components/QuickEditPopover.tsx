import React, { memo, useEffect, useRef, useState } from 'react'
import { ArrowUp, Loader2 } from 'lucide-react'
import type { CanvasImage } from '../types'
import { useViewportStore } from '../store/viewportStore'

interface Props {
  image: CanvasImage
  onClose: () => void
  onSubmit: (prompt: string, image: CanvasImage) => void | Promise<void>
  isSubmitting?: boolean
}

export const QuickEditPopover = memo(function QuickEditPopover({
  image,
  onClose,
  onSubmit,
  isSubmitting = false,
}: Props) {
  // 输入框初始为空，展示预输入灰色提示文案
  const [prompt, setPrompt] = useState('')
  const popoverRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const zoom = useViewportStore((s) => s.zoom)
  const panX = useViewportStore((s) => s.panX)
  const panY = useViewportStore((s) => s.panY)

  // 自动聚焦
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus()
    }, 40)
    return () => clearTimeout(timer)
  }, [image.id])

  // 点击外部与全局 Esc 监听
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const handleSubmit = () => {
    const cleanPrompt = prompt.trim()
    if (!cleanPrompt || isSubmitting) return
    onSubmit(cleanPrompt, image)
  }

  // 视口坐标计算（极简暗色圆形胶囊坞）
  const popoverWidth = 420
  const popoverHeight = 44
  const winW = typeof window !== 'undefined' ? window.innerWidth : 1200
  const winH = typeof window !== 'undefined' ? window.innerHeight : 800

  const imgScreenX = image.x * zoom + panX
  const imgScreenY = image.y * zoom + panY
  const imgScreenW = image.width * zoom
  const imgScreenH = image.height * zoom
  const centerX = imgScreenX + imgScreenW / 2
  const bottomY = imgScreenY + imgScreenH + 8

  const clampedX = Math.max(popoverWidth / 2 + 14, Math.min(winW - (popoverWidth / 2 + 14), centerX))

  // 优先在图片底部显示；若底部空间不足则翻转至图片上方
  let finalTop = bottomY
  if (bottomY + popoverHeight > winH - 16) {
    if (imgScreenY - popoverHeight > 56) {
      finalTop = imgScreenY - popoverHeight - 8
    } else {
      finalTop = Math.max(56, winH - popoverHeight - 16)
    }
  }

  const canSubmit = Boolean(prompt.trim()) && !isSubmitting

  return (
    <div
      ref={popoverRef}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: clampedX,
        top: finalTop,
        transform: 'translateX(-50%)',
        width: popoverWidth,
        maxWidth: 'calc(100vw - 28px)',
        height: popoverHeight,
        zIndex: 900,
        backgroundColor: 'rgba(32, 34, 40, 0.96)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderRadius: 9999,
        border: '1px solid rgba(255, 255, 255, 0.10)',
        boxShadow: '0 16px 40px rgba(0, 0, 0, 0.45), 0 2px 8px rgba(0, 0, 0, 0.22)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 6px 0 18px',
        boxSizing: 'border-box',
        gap: 10,
        userSelect: 'none',
      }}
    >
      <style>{`
        .quick-edit-pill-input::placeholder {
          color: #848999;
          opacity: 1;
        }
      `}</style>

      <input
        ref={inputRef}
        type="text"
        className="quick-edit-pill-input"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            if (e.nativeEvent.isComposing || (e as any).keyCode === 229) {
              return
            }
            e.preventDefault()
            handleSubmit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
        onKeyUp={(e) => e.stopPropagation()}
        placeholder="输入改图提示词，描述你想生成的图片..."
        disabled={isSubmitting}
        style={{
          flex: 1,
          minWidth: 0,
          border: 'none',
          outline: 'none',
          backgroundColor: 'transparent',
          fontSize: 13.5,
          color: '#ffffff',
          padding: 0,
          fontFamily: 'inherit',
          caretColor: '#ffffff',
        }}
      />

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        aria-label="生成"
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          border: 'none',
          backgroundColor: '#ffffff',
          color: '#181b24',
          cursor: canSubmit ? 'pointer' : 'not-allowed',
          opacity: canSubmit ? 1 : 0.4,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          transition: 'opacity 150ms ease, transform 120ms ease, background-color 150ms ease',
          boxShadow: canSubmit ? '0 2px 8px rgba(0, 0, 0, 0.2)' : 'none',
        }}
        onMouseEnter={(e) => {
          if (canSubmit) {
            e.currentTarget.style.transform = 'scale(1.05)'
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1)'
        }}
      >
        {isSubmitting ? (
          <Loader2 size={15} className="animate-spin" />
        ) : (
          <ArrowUp size={16} strokeWidth={2.4} />
        )}
      </button>
    </div>
  )
})

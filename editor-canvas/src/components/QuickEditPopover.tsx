import React, { memo, useEffect, useRef, useState } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'
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

  // 视口坐标计算（极简单行胶囊悬浮坞）
  const popoverWidth = 360
  const popoverHeight = 38
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
        backgroundColor: 'rgba(255, 255, 255, 0.94)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderRadius: 9999,
        border: '1px solid #e7e9ee',
        boxShadow: '0 12px 34px rgba(20, 47, 95, 0.10), 0 2px 6px rgba(20, 47, 95, 0.04)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 5px 0 13px',
        boxSizing: 'border-box',
        gap: 8,
        userSelect: 'none',
      }}
    >
      <Sparkles size={14} color="#687083" strokeWidth={1.8} style={{ flexShrink: 0, pointerEvents: 'none' }} />

      <input
        ref={inputRef}
        type="text"
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
        placeholder="输入改图提示词，Enter 发送..."
        disabled={isSubmitting}
        style={{
          flex: 1,
          minWidth: 0,
          border: 'none',
          outline: 'none',
          backgroundColor: 'transparent',
          fontSize: 13,
          color: '#181b24',
          padding: 0,
          fontFamily: 'inherit',
        }}
      />

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!prompt.trim() || isSubmitting}
        style={{
          height: 28,
          padding: '0 12px',
          borderRadius: 9999,
          border: 'none',
          backgroundColor: !prompt.trim() || isSubmitting ? '#eef1f6' : '#181b24',
          color: !prompt.trim() || isSubmitting ? '#94a3b8' : '#ffffff',
          fontSize: 12,
          fontWeight: 500,
          cursor: !prompt.trim() || isSubmitting ? 'not-allowed' : 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          flexShrink: 0,
          transition: 'background-color 140ms ease, color 140ms ease',
        }}
        onMouseEnter={(e) => {
          if (prompt.trim() && !isSubmitting) {
            e.currentTarget.style.backgroundColor = '#2d3340'
          }
        }}
        onMouseLeave={(e) => {
          if (prompt.trim() && !isSubmitting) {
            e.currentTarget.style.backgroundColor = '#181b24'
          }
        }}
      >
        {isSubmitting ? (
          <>
            <Loader2 size={12} className="animate-spin" />
            <span>生成中</span>
          </>
        ) : (
          <span>生成</span>
        )}
      </button>
    </div>
  )
})

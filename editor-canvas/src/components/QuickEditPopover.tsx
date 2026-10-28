import React, { memo, useEffect, useRef, useState } from 'react'
import { ArrowUp, Loader2 } from 'lucide-react'
import type { CanvasImage, QuickEditMarker } from '../types'
import { useViewportStore } from '../store/viewportStore'

interface Props {
  image: CanvasImage
  markers?: QuickEditMarker[]
  onRemoveMarker?: (id: string) => void
  onClearMarkers?: () => void
  onClose: () => void
  onSubmit: (prompt: string, image: CanvasImage, markers: QuickEditMarker[]) => void | Promise<void>
  isSubmitting?: boolean
}

export const QuickEditPopover = memo(function QuickEditPopover({
  image,
  markers = [],
  onClose,
  onSubmit,
  isSubmitting = false,
}: Props) {
  const [prompt, setPrompt] = useState('')
  const popoverRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const prevMarkersRef = useRef(markers)

  const zoom = useViewportStore((s) => s.zoom)
  const panX = useViewportStore((s) => s.panX)
  const panY = useViewportStore((s) => s.panY)

  // 初始自动聚焦
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus()
    }, 40)
    return () => clearTimeout(timer)
  }, [image.id])

  // 标记增删同步到输入框；只移除对应标签，保留用户输入的修改描述。
  useEffect(() => {
    const previousMarkers = prevMarkersRef.current
    prevMarkersRef.current = markers
    const currentIds = new Set(markers.map((marker) => marker.id))
    const previousIds = new Set(previousMarkers.map((marker) => marker.id))
    const removedTags = new Set(previousMarkers
      .filter((marker) => !currentIds.has(marker.id))
      .map((marker) => `<标记${marker.number}>`))
    const addedMarkers = markers.filter((marker) => !previousIds.has(marker.id))

    if (removedTags.size || addedMarkers.length) {
      setPrompt((prev) => {
        let next = prev.replace(/<标记\d+>/g, (tag) => removedTags.has(tag) ? '' : tag)
        for (const marker of addedMarkers) {
          const tag = `<标记${marker.number}>`
          if (next.includes(tag)) continue
          const trimmed = next.trimEnd()
          next = trimmed ? `${trimmed} ${tag}` : tag
        }
        return next
      })
    }
    if (addedMarkers.length) {
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus()
          const len = inputRef.current.value.length
          inputRef.current.setSelectionRange(len, len)
        }
      }, 30)
    }
  }, [markers])

  // 点击外部与全局 Esc 监听（排除标记区域与自身）
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (popoverRef.current && popoverRef.current.contains(target)) return
      if (target.closest && target.closest('[data-quick-edit-area="true"]')) return

      onClose()
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
    onSubmit(cleanPrompt, image, markers)
  }

  // 视口坐标计算（统一停靠在图片下方或屏幕底端，避免与顶部的工具条冲突遮挡）
  const popoverWidth = 440
  const popoverHeight = 44
  const winW = typeof window !== 'undefined' ? window.innerWidth : 1200
  const winH = typeof window !== 'undefined' ? window.innerHeight : 800

  const imgScreenX = image.x * zoom + panX
  const imgScreenY = image.y * zoom + panY
  const imgScreenW = image.width * zoom
  const imgScreenH = image.height * zoom
  const centerX = imgScreenX + imgScreenW / 2
  const bottomY = imgScreenY + imgScreenH + 12

  const clampedX = Math.max(popoverWidth / 2 + 14, Math.min(winW - (popoverWidth / 2 + 14), centerX))

  // 始终在图片下方；若超出屏幕则停靠在视口底端，绝不上翻遮挡顶部的工具栏
  const finalTop = Math.min(winH - popoverHeight - 20, Math.max(72, bottomY))

  const canSubmit = Boolean(prompt.trim()) && !isSubmitting

  const placeholderText = markers.length > 0
    ? '如：<标记1>改为红色 <标记2>增加反光...'
    : '输入修改需求，或在图片上标记/框选局部...'

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
        userSelect: 'none',
      }}
    >
      <style>{`
        .quick-edit-pill-input-light::placeholder {
          color: #94a3b8;
          opacity: 1;
        }
      `}</style>

      {/* 主输入浅色黑白灰胶囊坞 */}
      <div
        style={{
          width: '100%',
          height: 44,
          backgroundColor: '#ffffff',
          borderRadius: 9999,
          border: '1px solid #cbd5e1',
          boxShadow: '0 8px 28px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.04)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 6px 0 18px',
          boxSizing: 'border-box',
          gap: 10,
        }}
      >
        <input
          ref={inputRef}
          type="text"
          className="quick-edit-pill-input-light"
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
          placeholder={placeholderText}
          disabled={isSubmitting}
          style={{
            flex: 1,
            minWidth: 0,
            border: 'none',
            outline: 'none',
            backgroundColor: 'transparent',
            fontSize: 13.5,
            color: '#0f172a',
            padding: 0,
            fontFamily: 'inherit',
            caretColor: '#181b24',
          }}
        />

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          aria-label="生成"
          title={markers.length > 0 ? `提交精准编辑 (包含 ${markers.length} 处标记坐标)` : '提交生成'}
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            border: 'none',
            backgroundColor: canSubmit ? '#181b24' : '#f1f5f9',
            color: canSubmit ? '#ffffff' : '#94a3b8',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            opacity: canSubmit ? 1 : 0.6,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            transition: 'opacity 150ms ease, transform 120ms ease, background-color 150ms ease',
            boxShadow: canSubmit ? '0 2px 6px rgba(0, 0, 0, 0.2)' : 'none',
          }}
          onMouseEnter={(e) => {
            if (canSubmit) {
              e.currentTarget.style.transform = 'scale(1.05)'
              e.currentTarget.style.backgroundColor = '#000000'
            }
          }}
          onMouseLeave={(e) => {
            if (canSubmit) {
              e.currentTarget.style.transform = 'scale(1)'
              e.currentTarget.style.backgroundColor = '#181b24'
            }
          }}
        >
          {isSubmitting ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <ArrowUp size={16} strokeWidth={2.4} />
          )}
        </button>
      </div>
    </div>
  )
})

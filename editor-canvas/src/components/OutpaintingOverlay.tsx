import React, { useState, useRef, useEffect } from 'react'
import { Check, X, RotateCcw, Sparkles } from 'lucide-react'
import type { CanvasImage, OutpaintMargins } from '../types'
import { useViewportStore } from '../store/viewportStore'
import { useCanvasStore } from '../store/canvasStore'
import { useAIOperationStore } from '../store/aiOperationStore'
import { runOutpainting } from '../services/aiImageService'

interface Props {
  image: CanvasImage
  onClose: () => void
}

export function OutpaintingOverlay({ image, onClose }: Props) {
  const [margins, setMargins] = useState<OutpaintMargins>({
    top: 120,
    right: 120,
    bottom: 120,
    left: 120,
  })

  const zoom = useViewportStore((s) => s.zoom)
  const addImage = useCanvasStore((s) => s.addImage)
  const claimOperation = useAIOperationStore((s) => s.claimOperation)
  const updateOperation = useAIOperationStore((s) => s.updateOperation)
  const releaseOperation = useAIOperationStore((s) => s.releaseOperation)
  const aiState = useAIOperationStore((s) => s.state)

  const isSubmitting = aiState.status === 'running'

  // 拖拽手柄
  const activeHandleRef = useRef<string | null>(null)
  const dragStartRef = useRef<{ clientX: number; clientY: number; margins: OutpaintMargins }>({
    clientX: 0,
    clientY: 0,
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
  })

  const handleMouseDown = (e: React.MouseEvent, handle: string) => {
    e.stopPropagation()
    activeHandleRef.current = handle
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      margins: { ...margins },
    }

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!activeHandleRef.current) return
      const dx = (moveEvent.clientX - dragStartRef.current.clientX) / zoom
      const dy = (moveEvent.clientY - dragStartRef.current.clientY) / zoom
      const prev = dragStartRef.current.margins

      setMargins((m) => {
        const next = { ...m }
        if (activeHandleRef.current?.includes('t')) {
          next.top = Math.max(0, Math.min(1000, Math.round(prev.top - dy)))
        }
        if (activeHandleRef.current?.includes('b')) {
          next.bottom = Math.max(0, Math.min(1000, Math.round(prev.bottom + dy)))
        }
        if (activeHandleRef.current?.includes('l')) {
          next.left = Math.max(0, Math.min(1000, Math.round(prev.left - dx)))
        }
        if (activeHandleRef.current?.includes('r')) {
          next.right = Math.max(0, Math.min(1000, Math.round(prev.right + dx)))
        }
        return next
      })
    }

    const onMouseUp = () => {
      activeHandleRef.current = null
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  // 提交扩图
  const handleStartOutpainting = async () => {
    const totalOutpaint = margins.top + margins.right + margins.bottom + margins.left
    if (totalOutpaint <= 0) {
      alert('请先向外拖拽扩图手柄')
      return
    }

    if (!claimOperation('outpainting', '正在准备扩图...')) {
      alert('已有 AI 任务在进行中，请等待完成')
      return
    }

    try {
      const result = await runOutpainting(
        image.url,
        image.width,
        image.height,
        margins,
        (msg, progress) => {
          updateOperation({ message: msg, progress })
        }
      )

      // 计算扩图后在画布上的新定位
      const newX = image.x - margins.left
      const newY = image.y - margins.top
      const newWidth = image.width + margins.left + margins.right
      const newHeight = image.height + margins.top + margins.bottom

      addImage({
        id: 'img-' + Math.random().toString(36).slice(2, 10),
        frameId: image.frameId,
        x: newX,
        y: newY,
        width: newWidth,
        height: newHeight,
        rotation: 0,
        url: result.imageUrl,
        name: `${image.name}-扩图`,
        locked: false,
        opacity: 1,
      })

      onClose()
    } catch (err: any) {
      alert(`扩图失败: ${err.message}`)
    } finally {
      releaseOperation()
    }
  }

  const expandedX = image.x - margins.left
  const expandedY = image.y - margins.top
  const expandedWidth = image.width + margins.left + margins.right
  const expandedHeight = image.height + margins.top + margins.bottom

  return (
    <div
      style={{
        position: 'absolute',
        left: expandedX,
        top: expandedY,
        width: expandedWidth,
        height: expandedHeight,
        zIndex: 95,
        pointerEvents: 'none',
      }}
    >
      {/* 扩图范围虚线外框 */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          border: '2px dashed #181b24',
          backgroundColor: 'rgba(15, 23, 42, 0.04)',
          borderRadius: 4,
        }}
      />

      {/* 原图遮罩孔位（提示原图范围） */}
      <div
        style={{
          position: 'absolute',
          left: margins.left,
          top: margins.top,
          width: image.width,
          height: image.height,
          border: '1px solid rgba(15, 23, 42, 0.4)',
          boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.25)',
          borderRadius: 2,
        }}
      />

      {/* 8 个拖拽手柄 */}
      {/* Top-Left */}
      <div
        onMouseDown={(e) => handleMouseDown(e, 'tl')}
        style={{
          position: 'absolute',
          left: -6,
          top: -6,
          width: 12,
          height: 12,
          backgroundColor: '#ffffff',
          border: '2px solid #181b24',
          borderRadius: '50%',
          cursor: 'nwse-resize',
          pointerEvents: 'auto',
        }}
      />
      {/* Top */}
      <div
        onMouseDown={(e) => handleMouseDown(e, 't')}
        style={{
          position: 'absolute',
          left: '50%',
          top: -6,
          transform: 'translateX(-50%)',
          width: 28,
          height: 8,
          backgroundColor: '#181b24',
          borderRadius: 4,
          cursor: 'ns-resize',
          pointerEvents: 'auto',
        }}
      />
      {/* Top-Right */}
      <div
        onMouseDown={(e) => handleMouseDown(e, 'tr')}
        style={{
          position: 'absolute',
          right: -6,
          top: -6,
          width: 12,
          height: 12,
          backgroundColor: '#ffffff',
          border: '2px solid #181b24',
          borderRadius: '50%',
          cursor: 'nesw-resize',
          pointerEvents: 'auto',
        }}
      />
      {/* Right */}
      <div
        onMouseDown={(e) => handleMouseDown(e, 'r')}
        style={{
          position: 'absolute',
          right: -6,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 8,
          height: 28,
          backgroundColor: '#181b24',
          borderRadius: 4,
          cursor: 'ew-resize',
          pointerEvents: 'auto',
        }}
      />
      {/* Bottom-Right */}
      <div
        onMouseDown={(e) => handleMouseDown(e, 'br')}
        style={{
          position: 'absolute',
          right: -6,
          bottom: -6,
          width: 12,
          height: 12,
          backgroundColor: '#ffffff',
          border: '2px solid #181b24',
          borderRadius: '50%',
          cursor: 'nwse-resize',
          pointerEvents: 'auto',
        }}
      />
      {/* Bottom */}
      <div
        onMouseDown={(e) => handleMouseDown(e, 'b')}
        style={{
          position: 'absolute',
          left: '50%',
          bottom: -6,
          transform: 'translateX(-50%)',
          width: 28,
          height: 8,
          backgroundColor: '#181b24',
          borderRadius: 4,
          cursor: 'ns-resize',
          pointerEvents: 'auto',
        }}
      />
      {/* Bottom-Left */}
      <div
        onMouseDown={(e) => handleMouseDown(e, 'bl')}
        style={{
          position: 'absolute',
          left: -6,
          bottom: -6,
          width: 12,
          height: 12,
          backgroundColor: '#ffffff',
          border: '2px solid #181b24',
          borderRadius: '50%',
          cursor: 'nesw-resize',
          pointerEvents: 'auto',
        }}
      />
      {/* Left */}
      <div
        onMouseDown={(e) => handleMouseDown(e, 'l')}
        style={{
          position: 'absolute',
          left: -6,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 8,
          height: 28,
          backgroundColor: '#181b24',
          borderRadius: 4,
          cursor: 'ew-resize',
          pointerEvents: 'auto',
        }}
      />

      {/* 底部悬浮操作控制条 */}
      <div
        style={{
          position: 'absolute',
          bottom: -54,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '6px 14px',
          backgroundColor: '#1e293b',
          color: '#ffffff',
          borderRadius: 24,
          boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          fontSize: 12,
          whiteSpace: 'nowrap',
          pointerEvents: 'auto',
        }}
      >
        <div style={{ display: 'flex', gap: 8, color: '#94a3b8', fontSize: 11 }}>
          <span>上: {margins.top}px</span>
          <span>下: {margins.bottom}px</span>
          <span>左: {margins.left}px</span>
          <span>右: {margins.right}px</span>
        </div>

        <div style={{ width: 1, height: 14, backgroundColor: '#334155' }} />

        {/* 重置 */}
        <button
          onClick={() => setMargins({ top: 120, right: 120, bottom: 120, left: 120 })}
          disabled={isSubmitting}
          style={{
            background: 'none',
            border: 'none',
            color: '#94a3b8',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 11,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#ffffff')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#94a3b8')}
        >
          <RotateCcw size={12} />
          重置
        </button>

        {/* 取消 */}
        <button
          onClick={onClose}
          disabled={isSubmitting}
          style={{
            background: 'none',
            border: 'none',
            color: '#94a3b8',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 11,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#94a3b8')}
        >
          <X size={13} />
          取消
        </button>

        {/* 确定生成 */}
        <button
          onClick={handleStartOutpainting}
          disabled={isSubmitting}
          style={{
            background: '#181b24',
            border: 'none',
            color: '#ffffff',
            padding: '4px 12px',
            borderRadius: 14,
            cursor: isSubmitting ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontWeight: 600,
            fontSize: 12,
          }}
        >
          <Sparkles size={13} />
          {isSubmitting ? aiState?.message || '扩图中...' : '开始扩图'}
        </button>
      </div>
    </div>
  )
}

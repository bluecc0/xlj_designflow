import React from 'react'
import { Download, Image as ImageIcon, Trash2, ArrowUpToLine } from 'lucide-react'
import type { CanvasImage } from '../types'
import { useCanvasStore } from '../store/canvasStore'
import { useViewportStore } from '../store/viewportStore'

interface Props {
  image: CanvasImage
}

export function FloatingToolbar({ image }: Props) {
  const canvasToScreen = useViewportStore((s) => s.canvasToScreen)
  const zoom = useViewportStore((s) => s.zoom)
  const deleteImage = useCanvasStore((s) => s.deleteImage)
  const bringToFront = useCanvasStore((s) => s.bringToFront)

  // 计算在屏幕上的坐标
  const screenPos = canvasToScreen({
    x: image.x + image.width / 2,
    y: image.y + image.height,
  })

  // 1. 同步到主站聊天框作为参考图
  const handleUseAsReference = () => {
    window.parent.postMessage(
      {
        type: 'designflow:use-as-reference',
        images: [
          {
            src: image.url,
            url: image.url,
            name: image.name || '画布参考图',
          },
        ],
      },
      '*'
    )
  }

  // 2. 下载图片
  const handleDownload = () => {
    const a = document.createElement('a')
    a.href = image.url
    a.download = image.name ? `${image.name}.png` : 'canvas-image.png'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  return (
    <div
      style={{
        position: 'absolute',
        left: screenPos.x,
        top: screenPos.y + 12,
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 6px',
        backgroundColor: '#1e293b',
        color: '#f8fafc',
        borderRadius: 8,
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255,255,255,0.1)',
        zIndex: 100,
        fontSize: 12,
        userSelect: 'none',
      }}
    >
      <button
        onClick={handleUseAsReference}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          background: 'none',
          border: 'none',
          color: '#e2e8f0',
          cursor: 'pointer',
          borderRadius: 4,
          fontSize: 12,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
        title="放入右侧聊天框作为生图参考图"
      >
        <ImageIcon size={14} color="#818cf8" />
        <span>用作参考图</span>
      </button>

      <div style={{ width: 1, height: 16, backgroundColor: 'rgba(255,255,255,0.15)' }} />

      <button
        onClick={() => bringToFront(image.id)}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: 6,
          background: 'none',
          border: 'none',
          color: '#cbd5e1',
          cursor: 'pointer',
          borderRadius: 4,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
        title="图层置顶"
      >
        <ArrowUpToLine size={14} />
      </button>

      <button
        onClick={handleDownload}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: 6,
          background: 'none',
          border: 'none',
          color: '#cbd5e1',
          cursor: 'pointer',
          borderRadius: 4,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
        title="下载此图片"
      >
        <Download size={14} />
      </button>

      <button
        onClick={() => deleteImage(image.id)}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: 6,
          background: 'none',
          border: 'none',
          color: '#f87171',
          cursor: 'pointer',
          borderRadius: 4,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.2)')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
        title="删除"
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}

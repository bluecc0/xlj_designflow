import React, { useState, useEffect } from 'react'
import { useCanvasStore } from '../store/canvasStore'
import { useViewportStore } from '../store/viewportStore'
import { useAIOperationStore } from '../store/aiOperationStore'
import { TextToolbar } from './TextToolbar'
import {
  runMatting,
  runUpscale,
  runVectorize,
  runLayerExtract,
} from '../services/aiImageService'

interface Props {
  onStartOutpainting: (imageId: string) => void
}

/**
 * 还原原版 tldraw 自研矢量线性图标（17×17）
 */
function DesignflowToolbarIcon({ name }: { name: 'download' | 'outpaint' | 'upscale' | 'vectorize' | 'matting' | 'layers' }) {
  const commonProps = {
    viewBox: '0 0 24 24',
    width: 17,
    height: 17,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
  }

  if (name === 'download') {
    return (
      <svg {...commonProps}>
        <path d="M12 3v12" />
        <path d="M7 10l5 5 5-5" />
        <path d="M4 19h16" />
      </svg>
    )
  }

  if (name === 'outpaint') {
    return (
      <svg {...commonProps}>
        <path d="M8 8h8v8H8z" />
        <path d="M12 5V2m0 3-1.5-1.5M12 5l1.5-1.5" />
        <path d="M19 12h3m-3 0 1.5-1.5M19 12l1.5 1.5" />
        <path d="M12 19v3m0-3-1.5 1.5M12 19l1.5 1.5" />
        <path d="M5 12H2m3 0-1.5-1.5M5 12l-1.5 1.5" />
      </svg>
    )
  }

  if (name === 'upscale') {
    return (
      <svg {...commonProps}>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="M20 20l-4.35-4.35" />
        <path d="M10.5 8v5" />
        <path d="M8 10.5h5" />
      </svg>
    )
  }

  if (name === 'vectorize') {
    return (
      <svg {...commonProps}>
        <circle cx="5" cy="19" r="1.6" />
        <circle cx="19" cy="5" r="1.6" />
        <path d="M6.3 17.8C10 14 12 10 17.6 6.4" />
      </svg>
    )
  }

  if (name === 'matting') {
    return (
      <svg {...commonProps}>
        <circle cx="6" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M20 4L8.12 15.88" />
        <path d="M14.47 14.48L20 20" />
        <path d="M8.12 8.12L12 12" />
      </svg>
    )
  }

  if (name === 'layers') {
    return (
      <svg {...commonProps}>
        <path d="M12 3l8 4.5-8 4.5-8-4.5z" />
        <path d="M4 12.5l8 4.5 8-4.5" />
        <path d="M4 16.5l8 4.5 8-4.5" />
      </svg>
    )
  }

  return null
}

export function ContextualToolbar({ onStartOutpainting }: Props) {
  const selectedIds = useCanvasStore((s) => s.selectedIds)
  const selectedType = useCanvasStore((s) => s.selectedType)
  const images = useCanvasStore((s) => s.images)
  const addImage = useCanvasStore((s) => s.addImage)
  const alignSelected = useCanvasStore((s) => s.alignSelected)
  const tidyUpSelected = useCanvasStore((s) => s.tidyUpSelected)

  const zoom = useViewportStore((s) => s.zoom)
  const panX = useViewportStore((s) => s.panX)
  const panY = useViewportStore((s) => s.panY)

  const claimOperation = useAIOperationStore((s) => s.claimOperation)
  const updateOperation = useAIOperationStore((s) => s.updateOperation)
  const releaseOperation = useAIOperationStore((s) => s.releaseOperation)
  const aiState = useAIOperationStore((s) => s.state)

  const [activeTaskMsg, setActiveTaskMsg] = useState<string | null>(null)
  const [tidyGap, setTidyGap] = useState(24)

  const selectedImages = images.filter((im) => selectedIds.includes(im.id))

  // 文本选中时显示文本专属控制工具条
  if (selectedType === 'text') {
    return <TextToolbar />
  }

  // 仅在有选中图片时显示（画板不显示此图片工具条）
  if (selectedType !== 'image' || selectedImages.length === 0) return null

  // 计算选区在屏幕坐标系的中心与顶部位置
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const im of selectedImages) {
    minX = Math.min(minX, im.x)
    minY = Math.min(minY, im.y)
    maxX = Math.max(maxX, im.x + im.width)
    maxY = Math.max(maxY, im.y + im.height)
  }

  if (minX === Infinity) return null

  const screenCenterX = ((minX + maxX) / 2) * zoom + panX
  const screenTopY = minY * zoom + panY - 52

  const clampedX = Math.max(180, Math.min(window.innerWidth - 180, screenCenterX))
  const clampedY = Math.max(62, screenTopY)

  // 1. 下载单张图片
  const handleDownloadSingle = (im: (typeof images)[0]) => {
    const a = document.createElement('a')
    a.href = im.url
    a.download = `${im.name || 'image'}.png`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  // 2. 批量下载
  const handleBatchDownload = async () => {
    for (let i = 0; i < selectedImages.length; i++) {
      handleDownloadSingle(selectedImages[i])
      if (i < selectedImages.length - 1) {
        await new Promise((r) => setTimeout(r, 280))
      }
    }
  }

  // 3. 智能抠图
  const handleMatting = async () => {
    const target = selectedImages[0]
    if (!target) return

    if (!claimOperation('matting', '智能抠图中...')) {
      alert('已有 AI 任务在进行中')
      return
    }
    setActiveTaskMsg('智能抠图中...')

    try {
      const res = await runMatting(target.url, (msg) => {
        setActiveTaskMsg(msg)
        updateOperation({ message: msg })
      })

      addImage({
        id: 'img-' + Math.random().toString(36).slice(2, 10),
        frameId: target.frameId,
        x: target.x + target.width + 36,
        y: target.y,
        width: target.width,
        height: target.height,
        rotation: 0,
        url: res.imageUrl,
        name: `${target.name}-抠图`,
        locked: false,
        opacity: 1,
      })
    } catch (e: any) {
      alert(`抠图失败: ${e.message}`)
    } finally {
      releaseOperation()
      setActiveTaskMsg(null)
    }
  }

  // 4. 高清放大 2x
  const handleUpscale = async () => {
    const target = selectedImages[0]
    if (!target) return

    if (!claimOperation('upscale', '超分高清放大中...')) {
      alert('已有 AI 任务在进行中')
      return
    }
    setActiveTaskMsg('超分高清放大中...')

    try {
      const res = await runUpscale(target.url, 2, (msg) => {
        setActiveTaskMsg(msg)
        updateOperation({ message: msg })
      })

      addImage({
        id: 'img-' + Math.random().toString(36).slice(2, 10),
        frameId: target.frameId,
        x: target.x + target.width + 36,
        y: target.y,
        width: target.width,
        height: target.height,
        rotation: 0,
        url: res.imageUrl,
        name: `${target.name}-2x高清`,
        locked: false,
        opacity: 1,
      })
    } catch (e: any) {
      alert(`放大失败: ${e.message}`)
    } finally {
      releaseOperation()
      setActiveTaskMsg(null)
    }
  }

  // 5. 转矢量 SVG
  const handleVectorize = async () => {
    const target = selectedImages[0]
    if (!target) return

    if (!claimOperation('vectorize', '矢量化提取轮廓中...')) {
      alert('已有 AI 任务在进行中')
      return
    }
    setActiveTaskMsg('矢量化提取轮廓中...')

    try {
      const res = await runVectorize(target.url, (msg) => {
        setActiveTaskMsg(msg)
        updateOperation({ message: msg })
      })

      addImage({
        id: 'img-' + Math.random().toString(36).slice(2, 10),
        frameId: target.frameId,
        x: target.x + target.width + 36,
        y: target.y,
        width: target.width,
        height: target.height,
        rotation: 0,
        url: res.svgUrl,
        name: `${target.name}-矢量`,
        locked: false,
        opacity: 1,
      })
    } catch (e: any) {
      alert(`矢量化失败: ${e.message}`)
    } finally {
      releaseOperation()
      setActiveTaskMsg(null)
    }
  }

  // 6. 图层分离 PSD
  const handleLayerExtract = async () => {
    const target = selectedImages[0]
    if (!target) return

    if (!claimOperation('layer-extract', '正在分解 PSD 图层...')) {
      alert('已有 AI 任务在进行中')
      return
    }
    setActiveTaskMsg('正在分解 PSD 图层...')

    try {
      const res = await runLayerExtract(target.url, (msg) => {
        setActiveTaskMsg(msg)
        updateOperation({ message: msg })
      })

      if (res.psdUrl) {
        const a = document.createElement('a')
        a.href = res.psdUrl
        a.download = `${target.name || 'layers'}.psd`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
      }

      if (res.layers && res.layers.length > 0) {
        let offsetX = target.x + target.width + 36
        for (const l of res.layers) {
          addImage({
            id: 'img-' + Math.random().toString(36).slice(2, 10),
            frameId: target.frameId,
            x: offsetX,
            y: target.y,
            width: l.width || target.width,
            height: l.height || target.height,
            rotation: 0,
            url: l.url,
            name: `${target.name}-分层`,
            locked: false,
            opacity: 1,
          })
          offsetX += (l.width || target.width) + 24
        }
      }
    } catch (e: any) {
      alert(`分层提取失败: ${e.message}`)
    } finally {
      releaseOperation()
      setActiveTaskMsg(null)
    }
  }

  const isSingleImage = selectedImages.length === 1
  const firstImage = selectedImages[0]
  const isAiBusy = aiState.status === 'running'

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: clampedX,
        top: clampedY,
        transform: 'translateX(-50%)',
        zIndex: 92,
      }}
    >
      <div className="designflow-upscale-toolbar">
        {isSingleImage ? (
          <>
            {/* 1. 下载原图 */}
            <button
              onClick={() => handleDownloadSingle(firstImage)}
              className="designflow-toolbar-button"
              title="下载原图"
            >
              <DesignflowToolbarIcon name="download" />
              <span className="designflow-toolbar-label">下载原图</span>
            </button>

            <span className="designflow-toolbar-divider" />

            {/* 2. 智能扩图 */}
            <button
              onClick={() => onStartOutpainting(firstImage.id)}
              className="designflow-toolbar-button designflow-toolbar-button-ai"
              title="智能扩图 (FLUX Outpainting)"
              disabled={isAiBusy}
            >
              <DesignflowToolbarIcon name="outpaint" />
              <span className="designflow-toolbar-label">扩图</span>
              <span className="designflow-ai-dot" />
            </button>

            <span className="designflow-toolbar-divider" />

            {/* 3. 高清放大 */}
            <button
              onClick={handleUpscale}
              className="designflow-toolbar-button"
              title="高清放大 2x"
              disabled={isAiBusy}
            >
              {aiState.type === 'upscale' && isAiBusy ? (
                <span className="designflow-upscale-spinner" />
              ) : (
                <DesignflowToolbarIcon name="upscale" />
              )}
              <span className="designflow-toolbar-label">高清放大</span>
            </button>

            <span className="designflow-toolbar-divider" />

            {/* 4. 转矢量 SVG */}
            <button
              onClick={handleVectorize}
              className="designflow-toolbar-button"
              title="转为 SVG"
              disabled={isAiBusy}
            >
              {aiState.type === 'vectorize' && isAiBusy ? (
                <span className="designflow-upscale-spinner" />
              ) : (
                <DesignflowToolbarIcon name="vectorize" />
              )}
              <span className="designflow-toolbar-label">转为 SVG</span>
            </button>

            <span className="designflow-toolbar-divider" />

            {/* 5. 智能抠图 */}
            <button
              onClick={handleMatting}
              className="designflow-toolbar-button"
              title="智能抠图 (消除背景)"
              disabled={isAiBusy}
            >
              {aiState.type === 'matting' && isAiBusy ? (
                <span className="designflow-upscale-spinner" />
              ) : (
                <DesignflowToolbarIcon name="matting" />
              )}
              <span className="designflow-toolbar-label">抠图</span>
            </button>

            <span className="designflow-toolbar-divider" />

            {/* 6. 图层分离 PSD */}
            <button
              onClick={handleLayerExtract}
              className="designflow-toolbar-button"
              title="图层分离 (导出 PSD)"
              disabled={isAiBusy}
            >
              {aiState.type === 'layer-extract' && isAiBusy ? (
                <span className="designflow-upscale-spinner" />
              ) : (
                <DesignflowToolbarIcon name="layers" />
              )}
              <span className="designflow-toolbar-label">图层分离</span>
            </button>
          </>
        ) : (
          /* 多图选中：批量下载与对齐操作组 */
          <>
            <button
              onClick={handleBatchDownload}
              className="designflow-toolbar-button"
              title={`下载选中图片 (${selectedImages.length})`}
            >
              <DesignflowToolbarIcon name="download" />
              <span className="designflow-toolbar-label" style={{ maxWidth: 100, opacity: 1, marginInlineStart: 6 }}>
                下载图片 ({selectedImages.length})
              </span>
            </button>

            <span className="designflow-toolbar-divider" />

            {/* 对齐按钮组 */}
            <button
              onClick={() => alignSelected('left')}
              className="designflow-toolbar-button"
              title="左对齐"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="4" y1="21" x2="4" y2="3" />
                <rect x="8" y="5" width="12" height="4" rx="1" />
                <rect x="8" y="13" width="8" height="4" rx="1" />
              </svg>
            </button>

            <button
              onClick={() => alignSelected('center')}
              className="designflow-toolbar-button"
              title="水平居中"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="21" x2="12" y2="3" />
                <rect x="5" y="5" width="14" height="4" rx="1" />
                <rect x="7" y="13" width="10" height="4" rx="1" />
              </svg>
            </button>

            <button
              onClick={() => alignSelected('right')}
              className="designflow-toolbar-button"
              title="右对齐"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="20" y1="21" x2="20" y2="3" />
                <rect x="4" y="5" width="12" height="4" rx="1" />
                <rect x="8" y="13" width="8" height="4" rx="1" />
              </svg>
            </button>

            <span className="designflow-toolbar-divider" />

            <button
              onClick={() => alignSelected('top')}
              className="designflow-toolbar-button"
              title="顶对齐"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="4" x2="21" y2="4" />
                <rect x="5" y="8" width="4" height="12" rx="1" />
                <rect x="13" y="8" width="4" height="8" rx="1" />
              </svg>
            </button>

            <button
              onClick={() => alignSelected('middle')}
              className="designflow-toolbar-button"
              title="垂直居中"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="12" x2="21" y2="12" />
                <rect x="5" y="5" width="4" height="14" rx="1" />
                <rect x="13" y="7" width="4" height="10" rx="1" />
              </svg>
            </button>

            <button
              onClick={() => alignSelected('bottom')}
              className="designflow-toolbar-button"
              title="底对齐"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="20" x2="21" y2="20" />
                <rect x="5" y="4" width="4" height="12" rx="1" />
                <rect x="13" y="8" width="4" height="8" rx="1" />
              </svg>
            </button>

            <span className="designflow-toolbar-divider" />

            {/* 快速整理工具组 (类似 Photoshop / Figma Tidy Up) */}
            <button
              onClick={() => tidyUpSelected('horizontal', tidyGap)}
              className="designflow-toolbar-button"
              title={`水平整齐排列 (间距 ${tidyGap}px)`}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="3" y="5" width="5" height="14" rx="1.5" />
                <rect x="9.5" y="5" width="5" height="14" rx="1.5" />
                <rect x="16" y="5" width="5" height="14" rx="1.5" />
              </svg>
            </button>

            <button
              onClick={() => tidyUpSelected('vertical', tidyGap)}
              className="designflow-toolbar-button"
              title={`垂直整齐排列 (间距 ${tidyGap}px)`}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="5" y="3" width="14" height="5" rx="1.5" />
                <rect x="5" y="9.5" width="14" height="5" rx="1.5" />
                <rect x="5" y="16" width="14" height="5" rx="1.5" />
              </svg>
            </button>

            <button
              onClick={() => tidyUpSelected('grid', tidyGap)}
              className="designflow-toolbar-button"
              title={`网格方阵排列 (间距 ${tidyGap}px)`}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
                <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
                <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
                <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
              </svg>
            </button>

            {/* 间距快捷调节胶囊 */}
            <button
              onClick={() => {
                const nextGap = tidyGap === 16 ? 24 : tidyGap === 24 ? 36 : tidyGap === 36 ? 48 : 16
                setTidyGap(nextGap)
              }}
              className="designflow-toolbar-button"
              title={`点击切换固定间距 (当前 ${tidyGap}px，支持 16/24/36/48px)`}
              style={{
                padding: '0 6px',
                fontSize: 11,
                fontWeight: 600,
                color: '#475569',
                minWidth: 40,
                height: 24,
              }}
            >
              <span>{tidyGap}px</span>
            </button>
          </>
        )}
      </div>
    </div>
  )
}

import React, { memo, useState, useEffect, useMemo } from 'react'
import {
  X,
  Sparkles,
  Copy,
  Check,
  ExternalLink,
  Loader2,
} from 'lucide-react'
import type { CanvasImage } from '../types'
import { useCanvasStore } from '../store/canvasStore'
import { fetchImageMetadata, type ImageMetadataResponse } from '../services/aiImageService'

async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 忽略并降级
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    ta.style.top = '-9999px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const successful = document.execCommand('copy')
    document.body.removeChild(ta)
    return successful
  } catch {
    return false
  }
}

interface Props {
  image: CanvasImage | null
  onClose: () => void
}

export const ImagePropertiesModal = memo(function ImagePropertiesModal({
  image,
  onClose,
}: Props) {
  if (!image) return null
  return <ImagePropertiesModalContent image={image} onClose={onClose} />
})

const ImagePropertiesModalContent = memo(function ImagePropertiesModalContent({
  image,
  onClose,
}: {
  image: CanvasImage
  onClose: () => void
}) {
  const updateImage = useCanvasStore((s) => s.updateImage)

  const [copiedPrompt, setCopiedPrompt] = useState(false)
  const [loadingMeta, setLoadingMeta] = useState(false)
  const [remoteMeta, setRemoteMeta] = useState<ImageMetadataResponse | null>(null)

  // 物理尺寸本地状态
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number }>({
    w: image.naturalWidth || 0,
    h: image.naturalHeight || 0,
  })

  // 探测原图物理宽高
  useEffect(() => {
    if (!image) return
    if (image.naturalWidth && image.naturalHeight) {
      setNaturalSize({ w: image.naturalWidth, h: image.naturalHeight })
      return
    }
    let active = true
    const probe = new Image()
    probe.onload = () => {
      if (!active) return
      const nw = probe.naturalWidth || probe.width
      const nh = probe.naturalHeight || probe.height
      if (nw > 0 && nh > 0) {
        setNaturalSize({ w: nw, h: nh })
        updateImage(image.id, { naturalWidth: nw, naturalHeight: nh })
      }
    }
    probe.src = image.url
    return () => {
      active = false
    }
  }, [image?.id, image?.url, image?.naturalWidth, image?.naturalHeight, updateImage])

  // 按需异步水合远端元数据
  useEffect(() => {
    if (!image) return
    setRemoteMeta(null)

    const hasLocalPrompt = Boolean(image.meta?.prompt)
    const hasLocalFileSize = Boolean(image.meta?.fileSize)
    if (hasLocalPrompt && hasLocalFileSize) {
      return
    }

    let active = true
    setLoadingMeta(true)

    fetchImageMetadata(image.url)
      .then((data) => {
        if (!active || !data) return
        setRemoteMeta(data)

        const patchMeta: Record<string, any> = {}
        if (data.fileSize && !image.meta?.fileSize) patchMeta.fileSize = data.fileSize
        if (data.mimeType && !image.meta?.mimeType) patchMeta.mimeType = data.mimeType
        if (data.aiMetadata) {
          if (data.aiMetadata.prompt && !image.meta?.prompt) patchMeta.prompt = data.aiMetadata.prompt
          if (data.aiMetadata.model && !image.meta?.model) patchMeta.model = data.aiMetadata.model
          if (data.aiMetadata.provider && !image.meta?.provider) patchMeta.provider = data.aiMetadata.provider
          if (data.aiMetadata.jobId && !image.meta?.jobId) patchMeta.jobId = data.aiMetadata.jobId
          if (data.aiMetadata.createdAt && !image.meta?.createdAt) patchMeta.createdAt = data.aiMetadata.createdAt
        }
        if (Object.keys(patchMeta).length > 0) {
          updateImage(image.id, {
            meta: { ...(image.meta || {}), ...patchMeta },
          })
        }
      })
      .finally(() => {
        if (active) setLoadingMeta(false)
      })

    return () => {
      active = false
    }
  }, [image?.id, image?.url, image?.meta, updateImage])

  // 按 ESC 键关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const meta = image.meta || {}
  const aiInfo = remoteMeta?.aiMetadata

  const prompt = meta.prompt || aiInfo?.prompt || ''
  const model = meta.model || aiInfo?.model || ''
  const isAiGenerated = Boolean(prompt || model || remoteMeta?.isAiGenerated)

  // 文件名
  const fileName = useMemo(() => {
    try {
      const pathname = new URL(image.url, window.location.origin).pathname
      const parts = pathname.split('/')
      return decodeURIComponent(parts[parts.length - 1] || image.name || 'image.png')
    } catch {
      return image.name || 'image.png'
    }
  }, [image.url, image.name])

  // 格式徽章
  const format = useMemo(() => {
    const ext = fileName.split('.').pop()?.toUpperCase() || ''
    if (['PNG', 'JPG', 'JPEG', 'WEBP', 'SVG', 'GIF'].includes(ext)) {
      return ext
    }
    return remoteMeta?.mimeType ? remoteMeta.mimeType.split('/').pop()?.toUpperCase() : 'IMAGE'
  }, [fileName, remoteMeta?.mimeType])

  // 体积
  const fileSizeText = useMemo(() => {
    const bytes = meta.fileSize || remoteMeta?.fileSize
    if (bytes !== undefined && bytes !== null && !isNaN(bytes)) {
      if (bytes < 1024) return `${bytes} B`
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    }
    return remoteMeta?.fileSizeFormatted || ''
  }, [meta.fileSize, remoteMeta?.fileSize, remoteMeta?.fileSizeFormatted])

  // 尺寸计算
  const displayW = Math.round(image.width)
  const displayH = Math.round(image.height)
  const scalePercent = naturalSize.w > 0 ? Math.round((displayW / naturalSize.w) * 100) : null

  // 复制 Prompt
  const handleCopyPrompt = async () => {
    if (!prompt) return
    await copyToClipboard(prompt)
    setCopiedPrompt(true)
    setTimeout(() => setCopiedPrompt(false), 2000)
  }

  return (
    <div
      data-modal="image-properties"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(15, 23, 42, 0.35)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 360,
          backgroundColor: '#ffffff',
          borderRadius: 12,
          boxShadow: '0 16px 36px -8px rgba(15, 23, 42, 0.16), 0 0 0 1px rgba(15, 23, 42, 0.06)',
          overflow: 'hidden',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif',
          color: '#0f172a',
        }}
      >
        {/* 标题栏 */}
        <div
          style={{
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #f1f5f9',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>图片属性</div>
          <button
            onClick={onClose}
            title="关闭 (Esc)"
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              border: 'none',
              backgroundColor: 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#94a3b8',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f5f9')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <X size={15} />
          </button>
        </div>

        {/* 内容主体 */}
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* 顶栏：缩略图 + 名字 + 标签 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 6,
                overflow: 'hidden',
                flexShrink: 0,
                border: '1px solid #e2e8f0',
                backgroundColor: '#f8fafc',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <img
                src={image.url}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                title={fileName}
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#0f172a',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  marginBottom: 3,
                }}
              >
                {fileName}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '1px 5px',
                    borderRadius: 4,
                    backgroundColor: '#f1f5f9',
                    color: '#64748b',
                  }}
                >
                  {format}
                </span>

                {isAiGenerated && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: '1px 5px',
                      borderRadius: 4,
                      backgroundColor: '#f3e8ff',
                      color: '#7e22ce',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 2,
                    }}
                  >
                    <Sparkles size={9} strokeWidth={2.4} />
                    AI 生成
                  </span>
                )}

                <a
                  href={image.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="查看原图"
                  style={{
                    fontSize: 11,
                    color: '#2563eb',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 2,
                    textDecoration: 'none',
                    marginLeft: 'auto',
                  }}
                >
                  原图 <ExternalLink size={10} />
                </a>
              </div>
            </div>
          </div>

          {/* 属性表格行 */}
          <div
            style={{
              backgroundColor: '#f8fafc',
              borderRadius: 8,
              padding: '8px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 7,
              fontSize: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#64748b' }}>物理尺寸</span>
              <span style={{ fontWeight: 500, color: '#0f172a' }}>
                {naturalSize.w > 0 && naturalSize.h > 0
                  ? `${naturalSize.w} × ${naturalSize.h} px`
                  : '探测中...'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#64748b' }}>画布渲染</span>
              <span style={{ fontWeight: 500, color: '#0f172a' }}>
                {displayW} × {displayH} px
                {scalePercent !== null && (
                  <span style={{ color: '#94a3b8', fontWeight: 400, marginLeft: 4 }}>
                    ({scalePercent}%)
                  </span>
                )}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#64748b' }}>文件大小</span>
              <span style={{ fontWeight: 500, color: '#0f172a' }}>
                {fileSizeText || (loadingMeta ? '计算中...' : '未知')}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#64748b' }}>画布位置</span>
              <span style={{ fontWeight: 500, color: '#0f172a' }}>
                X: {Math.round(image.x)}, Y: {Math.round(image.y)}
                {image.rotation ? ` (${Math.round(image.rotation)}°)` : ''}
              </span>
            </div>
          </div>

          {/* AI 提示词（仅在有 Prompt 或 AI 任务时展示） */}
          {prompt ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b' }}>
                  生成 Prompt
                </span>
                <button
                  onClick={handleCopyPrompt}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    fontSize: 11,
                    fontWeight: 500,
                    padding: '2px 6px',
                    borderRadius: 4,
                    border: '1px solid #e2e8f0',
                    backgroundColor: copiedPrompt ? '#dcfce7' : '#ffffff',
                    color: copiedPrompt ? '#15803d' : '#475569',
                    cursor: 'pointer',
                  }}
                >
                  {copiedPrompt ? <Check size={10} /> : <Copy size={10} />}
                  {copiedPrompt ? '已复制' : '复制'}
                </button>
              </div>

              <div
                style={{
                  backgroundColor: '#faf5ff',
                  border: '1px solid #f3e8ff',
                  borderRadius: 6,
                  padding: '8px 10px',
                  fontSize: 11.5,
                  lineHeight: 1.5,
                  color: '#3b0764',
                  maxHeight: 96,
                  overflowY: 'auto',
                  wordBreak: 'break-word',
                  userSelect: 'text',
                }}
              >
                {prompt}
              </div>

              {model && (
                <div style={{ fontSize: 10, color: '#94a3b8', textAlign: 'right' }}>
                  模型: {model}
                </div>
              )}
            </div>
          ) : isAiGenerated && loadingMeta ? (
            <div
              style={{
                fontSize: 11,
                color: '#94a3b8',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                justifyContent: 'center',
                padding: '6px 0',
              }}
            >
              <Loader2 size={12} className="animate-spin" /> 查询 AI 生成参数中...
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
})

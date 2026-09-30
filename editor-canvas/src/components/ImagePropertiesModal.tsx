import React, { memo, useState, useEffect, useMemo } from 'react'
import {
  X,
  Sparkles,
  Copy,
  Check,
  ExternalLink,
  Loader2,
  ChevronDown,
  ChevronRight,
  Image as ImageIcon,
  ArrowLeft,
  SlidersHorizontal,
} from 'lucide-react'
import type { CanvasImage, ReferenceImageItem } from '../types'
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
    // 降级使用 textarea
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

function formatTimestamp(ts?: number | string): string {
  if (!ts) return ''
  const num = typeof ts === 'string' ? parseFloat(ts) : ts
  if (isNaN(num)) return String(ts)
  const ms = num < 10000000000 ? num * 1000 : num
  const d = new Date(ms)
  if (isNaN(d.getTime())) return String(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function formatQualityLabel(quality?: string): string {
  if (!quality) return ''
  const q = quality.toLowerCase()
  if (q === 'auto') return '自动 (Auto)'
  if (q === 'standard') return '标准 (Standard)'
  if (q === 'high') return '高清 (High)'
  if (q === 'ultra') return '极清 (Ultra)'
  return quality
}

function formatVariantLabel(variant?: string): string {
  if (!variant) return ''
  const v = variant.toLowerCase()
  if (v === 'flare') return '通透锐利 (flare)'
  if (v === 'sunburst') return '暖阳柔光 (sunburst)'
  return variant
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

  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [loadingMeta, setLoadingMeta] = useState(false)
  const [remoteMeta, setRemoteMeta] = useState<ImageMetadataResponse | null>(null)

  // 提示词视图切换：'resolved' (最终生成词) | 'original' (用户原始输入)
  const [promptTab, setPromptTab] = useState<'resolved' | 'original'>('resolved')
  // 提示词扩充追踪展开
  const [showTrace, setShowTrace] = useState(false)
  // 大图放大预览浮层
  const [previewingImg, setPreviewingImg] = useState<{ url: string; title: string } | null>(null)

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

  // 异步水合远端元数据 (获取完整生图请求链路与参考图)
  useEffect(() => {
    if (!image) return
    setRemoteMeta(null)

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
          const ai = data.aiMetadata
          if (ai.prompt && !image.meta?.prompt) patchMeta.prompt = ai.prompt
          if (ai.originalPrompt && !image.meta?.originalPrompt) patchMeta.originalPrompt = ai.originalPrompt
          if (ai.resolvedPrompt && !image.meta?.resolvedPrompt) patchMeta.resolvedPrompt = ai.resolvedPrompt
          if (ai.promptTrace && !image.meta?.promptTrace) patchMeta.promptTrace = ai.promptTrace
          if (ai.model && !image.meta?.model) patchMeta.model = ai.model
          if (ai.provider && !image.meta?.provider) patchMeta.provider = ai.provider
          if (ai.jobId && !image.meta?.jobId) patchMeta.jobId = ai.jobId
          if (ai.clientRequestId && !image.meta?.clientRequestId) patchMeta.clientRequestId = ai.clientRequestId
          if (ai.size && !image.meta?.size) patchMeta.size = ai.size
          if (ai.resolution && !image.meta?.resolution) patchMeta.resolution = ai.resolution
          if (ai.variant && !image.meta?.variant) patchMeta.variant = ai.variant
          if (ai.quality && !image.meta?.quality) patchMeta.quality = ai.quality
          if (ai.skill && !image.meta?.skill) patchMeta.skill = ai.skill
          if (ai.hasReference !== undefined && image.meta?.hasReference === undefined) {
            patchMeta.hasReference = ai.hasReference
          }
          if (ai.referenceImages && (!image.meta?.referenceImages || image.meta.referenceImages.length === 0)) {
            patchMeta.referenceImages = ai.referenceImages
          }
          if (ai.createdAt && !image.meta?.createdAt) patchMeta.createdAt = ai.createdAt
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
  }, [image?.id, image?.url, updateImage])

  // 按 ESC 键关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (previewingImg) {
          setPreviewingImg(null)
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, previewingImg])

  const meta = image.meta || {}
  const aiInfo = remoteMeta?.aiMetadata

  // 提示词数据
  const prompt = meta.prompt || aiInfo?.prompt || ''
  const originalPrompt = aiInfo?.originalPrompt || meta.originalPrompt || ''
  const resolvedPrompt = aiInfo?.resolvedPrompt || meta.resolvedPrompt || prompt || ''
  const promptTrace = aiInfo?.promptTrace || meta.promptTrace || ''

  // 是否存在差异提示词
  const hasDistinctPrompts = Boolean(
    originalPrompt && resolvedPrompt && originalPrompt.trim() !== resolvedPrompt.trim()
  )

  // 模型与生图元参数
  const model = meta.model || aiInfo?.model || ''
  const provider = meta.provider || aiInfo?.provider || meta.requestMeta?.provider || ''
  const size = meta.size || aiInfo?.size || ''
  const resolution = meta.resolution || aiInfo?.resolution || ''
  const variant = meta.variant || aiInfo?.variant || meta.requestMeta?.variant || ''
  const quality = meta.quality || aiInfo?.quality || meta.requestMeta?.quality || ''
  const skill = meta.skill || aiInfo?.skill || meta.requestMeta?.skill || ''
  const jobId = meta.jobId || aiInfo?.jobId || ''
  const clientRequestId = meta.clientRequestId || aiInfo?.clientRequestId || meta.requestMeta?.client_request_id || ''
  const createdAt = meta.createdAt || aiInfo?.createdAt

  // 参考图列表提取
  const referenceImages: ReferenceImageItem[] = useMemo(() => {
    if (aiInfo?.referenceImages && aiInfo.referenceImages.length > 0) {
      return aiInfo.referenceImages
    }
    if (Array.isArray(meta.referenceImages) && meta.referenceImages.length > 0) {
      return meta.referenceImages
    }
    return []
  }, [aiInfo?.referenceImages, meta.referenceImages])

  const hasReference = Boolean(
    referenceImages.length > 0 ||
    meta.hasReference ||
    aiInfo?.hasReference ||
    (meta.refCount && meta.refCount > 0)
  )

  const isAiGenerated = Boolean(
    prompt || model || jobId || isAiGeneratedProp(meta) || remoteMeta?.isAiGenerated
  )

  function isAiGeneratedProp(m: any): boolean {
    return Boolean(m?.jobId || m?.model || m?.prompt || m?.variant || m?.quality)
  }

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

  // 复制处理
  const handleCopy = async (key: string, text: string) => {
    if (!text) return
    const ok = await copyToClipboard(text)
    if (ok) {
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 2000)
    }
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
        backgroundColor: 'rgba(15, 23, 42, 0.45)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 450,
          maxWidth: '92vw',
          maxHeight: '88vh',
          backgroundColor: '#ffffff',
          borderRadius: 14,
          boxShadow: '0 20px 48px -12px rgba(15, 23, 42, 0.22), 0 0 0 1px rgba(15, 23, 42, 0.08)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif',
          color: '#0f172a',
        }}
      >
        {/* 标题栏 */}
        <div
          style={{
            padding: '12px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #f1f5f9',
            backgroundColor: '#ffffff',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            {previewingImg ? (
              <button
                type="button"
                onClick={() => setPreviewingImg(null)}
                style={{
                  border: 'none',
                  backgroundColor: 'transparent',
                  padding: 2,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  color: '#475569',
                }}
                title="返回详情"
              >
                <ArrowLeft size={16} />
              </button>
            ) : null}
            <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
              {previewingImg ? previewingImg.title : '图片属性'}
            </div>
            {isAiGenerated && !previewingImg && (
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  padding: '1.5px 6px',
                  borderRadius: 4,
                  backgroundColor: '#f1f5f9',
                  color: '#334155',
                  border: '1px solid #e2e8f0',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3.5,
                }}
              >
                <Sparkles size={10} strokeWidth={2.0} color="#475569" />
                AI 生图档案
              </span>
            )}
          </div>
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
              transition: 'all 120ms ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f5f9')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <X size={15} />
          </button>
        </div>

        {/* 内容主体 - 支持纵向平滑滚动 */}
        <div
          style={{
            padding: '16px 18px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          {/* 大图预览模式 */}
          {previewingImg ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
              <div
                style={{
                  width: '100%',
                  maxHeight: '55vh',
                  borderRadius: 8,
                  overflow: 'hidden',
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <img
                  src={previewingImg.url}
                  alt={previewingImg.title}
                  style={{
                    maxWidth: '100%',
                    maxHeight: '55vh',
                    objectFit: 'contain',
                    display: 'block',
                  }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>{previewingImg.title}</span>
                <a
                  href={previewingImg.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: 11,
                    color: '#0f172a',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    textDecoration: 'none',
                    fontWeight: 500,
                  }}
                >
                  新窗口打开原图 <ExternalLink size={11} />
                </a>
              </div>
            </div>
          ) : (
            <>
              {/* 1. 顶栏：缩略图 + 名字 + 标签 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  onClick={() => setPreviewingImg({ url: image.url, title: fileName })}
                  title="点击查看大图"
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 8,
                    overflow: 'hidden',
                    flexShrink: 0,
                    border: '1px solid #e2e8f0',
                    backgroundColor: '#f8fafc',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    position: 'relative',
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
                      fontWeight: 600,
                      color: '#0f172a',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      marginBottom: 4,
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
                          backgroundColor: '#f1f5f9',
                          color: '#334155',
                          border: '1px solid #e2e8f0',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 3,
                        }}
                      >
                        <Sparkles size={9} strokeWidth={2.0} color="#475569" />
                        AI 生成
                      </span>
                    )}

                    <a
                      href={image.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="在新标签页查看原图"
                      style={{
                        fontSize: 11,
                        color: '#64748b',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 3,
                        textDecoration: 'none',
                        marginLeft: 'auto',
                        transition: 'color 120ms ease',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = '#0f172a')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = '#64748b')}
                    >
                      原图 <ExternalLink size={10} color="#64748b" />
                    </a>
                  </div>
                </div>
              </div>

              {/* 2. 基础物理与渲染规格 */}
              <div
                style={{
                  backgroundColor: '#f8fafc',
                  border: '1px solid #f1f5f9',
                  borderRadius: 10,
                  padding: '9px 12px',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: '8px 12px',
                  fontSize: 11.5,
                }}
              >
                <div>
                  <div style={{ color: '#64748b', marginBottom: 2 }}>物理分辨率</div>
                  <div style={{ fontWeight: 600, color: '#0f172a' }}>
                    {naturalSize.w > 0 && naturalSize.h > 0
                      ? `${naturalSize.w} × ${naturalSize.h} px`
                      : '探测中...'}
                  </div>
                </div>

                <div>
                  <div style={{ color: '#64748b', marginBottom: 2 }}>画布渲染</div>
                  <div style={{ fontWeight: 600, color: '#0f172a' }}>
                    {displayW} × {displayH} px
                    {scalePercent !== null && (
                      <span style={{ color: '#94a3b8', fontWeight: 400, marginLeft: 4 }}>
                        ({scalePercent}%)
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <div style={{ color: '#64748b', marginBottom: 2 }}>文件大小</div>
                  <div style={{ fontWeight: 600, color: '#0f172a' }}>
                    {fileSizeText || (loadingMeta ? '计算中...' : '未知')}
                  </div>
                </div>

                <div>
                  <div style={{ color: '#64748b', marginBottom: 2 }}>画布坐标</div>
                  <div style={{ fontWeight: 600, color: '#0f172a' }}>
                    X: {Math.round(image.x)}, Y: {Math.round(image.y)}
                    {image.rotation ? ` (${Math.round(image.rotation)}°)` : ''}
                  </div>
                </div>
              </div>

              {/* 3. AI 生图全请求参数记录 */}
              {isAiGenerated && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      borderBottom: '1px solid #f1f5f9',
                      paddingBottom: 5,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: '#475569',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <SlidersHorizontal size={12} strokeWidth={2.2} />
                      生图请求参数记录
                    </div>
                    {loadingMeta && (
                      <span style={{ fontSize: 10.5, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Loader2 size={10} className="animate-spin" /> 查询中
                      </span>
                    )}
                  </div>

                  <div
                    style={{
                      backgroundColor: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: 10,
                      padding: '10px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 7,
                      fontSize: 11.5,
                    }}
                  >
                    {/* 模型 */}
                    {model && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: '#64748b' }}>生成模型 (Model)</span>
                        <span style={{ fontWeight: 600, color: '#0f172a' }}>{model}</span>
                      </div>
                    )}

                    {/* 服务商 */}
                    {provider && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: '#64748b' }}>服务商 (Provider)</span>
                        <span style={{ fontWeight: 500, color: '#1e293b' }}>{provider.toUpperCase()}</span>
                      </div>
                    )}

                    {/* 比例与规格 */}
                    {(size || resolution) && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: '#64748b' }}>出图规格 (Size)</span>
                        <span style={{ fontWeight: 500, color: '#1e293b' }}>
                          {size} {resolution ? `· ${resolution}` : ''}
                        </span>
                      </div>
                    )}

                    {/* 画质 */}
                    {quality && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: '#64748b' }}>画质等级 (Quality)</span>
                        <span style={{ fontWeight: 500, color: '#1e293b' }}>{formatQualityLabel(quality)}</span>
                      </div>
                    )}

                    {/* 风格模式 */}
                    {variant && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: '#64748b' }}>风格模式 (Variant)</span>
                        <span style={{ fontWeight: 500, color: '#1e293b' }}>{formatVariantLabel(variant)}</span>
                      </div>
                    )}

                    {/* 技能预设 */}
                    {skill && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: '#64748b' }}>技能预设 (Skill)</span>
                        <span style={{ fontWeight: 500, color: '#1e293b' }}>{skill}</span>
                      </div>
                    )}

                    {/* 任务编号 Job ID */}
                    {jobId && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: '#64748b' }}>任务编号 (Job ID)</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#334155' }}>
                            {jobId.slice(0, 12)}...
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopy('jobId', jobId)}
                            title="复制 Job ID"
                            style={{
                              border: 'none',
                              backgroundColor: 'transparent',
                              cursor: 'pointer',
                              padding: 2,
                              color: copiedKey === 'jobId' ? '#0f172a' : '#94a3b8',
                              display: 'inline-flex',
                            }}
                          >
                            {copiedKey === 'jobId' ? <Check size={11} /> : <Copy size={11} />}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* 客户端请求号 Client Request ID */}
                    {clientRequestId && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: '#64748b' }}>请求单号 (Client Req)</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#334155' }}>
                            {clientRequestId.slice(0, 14)}...
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopy('clientReq', clientRequestId)}
                            title="复制 Client Request ID"
                            style={{
                              border: 'none',
                              backgroundColor: 'transparent',
                              cursor: 'pointer',
                              padding: 2,
                              color: copiedKey === 'clientReq' ? '#0f172a' : '#94a3b8',
                              display: 'inline-flex',
                            }}
                          >
                            {copiedKey === 'clientReq' ? <Check size={11} /> : <Copy size={11} />}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* 生成时间 */}
                    {createdAt && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: '#64748b' }}>生成时间</span>
                        <span style={{ color: '#475569' }}>{formatTimestamp(createdAt)}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 4. 参考图全记录 (如有) */}
              {hasReference && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      borderBottom: '1px solid #f1f5f9',
                      paddingBottom: 5,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: '#475569',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <ImageIcon size={12} strokeWidth={2.2} />
                      参考图全记录
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: '1px 5px',
                          borderRadius: 9999,
                          backgroundColor: '#f1f5f9',
                          color: '#334155',
                          border: '1px solid #e2e8f0',
                        }}
                      >
                        {referenceImages.length || 1} 张
                      </span>
                    </div>
                  </div>

                  {referenceImages.length > 0 ? (
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: referenceImages.length === 1 ? '1fr' : 'repeat(2, 1fr)',
                        gap: 8,
                      }}
                    >
                      {referenceImages.map((ref, idx) => {
                        const typeTag =
                          ref.type === 'manual'
                            ? '用户上传'
                            : ref.type === 'context'
                            ? '上下文续图'
                            : ref.type === 'outpainting_source'
                            ? '扩图原图'
                            : '参考图'

                        return (
                          <div
                            key={ref.url || idx}
                            style={{
                              backgroundColor: '#f8fafc',
                              border: '1px solid #e2e8f0',
                              borderRadius: 8,
                              padding: '8px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 9,
                            }}
                          >
                            {/* 参考图缩略图 */}
                            <div
                              onClick={() => setPreviewingImg({ url: ref.url, title: ref.name || `参考图 ${idx + 1}` })}
                              title="点击查看原参考图"
                              style={{
                                width: 44,
                                height: 44,
                                borderRadius: 6,
                                overflow: 'hidden',
                                flexShrink: 0,
                                backgroundColor: '#ffffff',
                                border: '1px solid #cbd5e1',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                              }}
                            >
                              <img
                                src={ref.url}
                                alt={ref.name || '参考图'}
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              />
                            </div>

                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                                <span
                                  style={{
                                    fontSize: 9.5,
                                    fontWeight: 600,
                                    padding: '1px 4px',
                                    borderRadius: 3,
                                    backgroundColor: '#ffffff',
                                    color: '#334155',
                                    border: '1px solid #cbd5e1',
                                  }}
                                >
                                  {typeTag}
                                </span>
                              </div>
                              <div
                                title={ref.name || `参考图 ${idx + 1}`}
                                style={{
                                  fontSize: 11,
                                  fontWeight: 500,
                                  color: '#0f172a',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {ref.name || `参考图 ${idx + 1}`}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div
                      style={{
                        backgroundColor: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: 8,
                        padding: '10px 12px',
                        fontSize: 11,
                        color: '#64748b',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span>已启用参考图上下文约束（早期任务未缓存参考图本地副本）</span>
                      <span style={{ fontSize: 10, color: '#94a3b8' }}>图生图模式</span>
                    </div>
                  )}
                </div>
              )}

              {/* 5. 提示词记录 (原始提示词 vs 最终生成词) */}
              {isAiGenerated && (resolvedPrompt || originalPrompt) ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    {hasDistinctPrompts ? (
                      <div
                        style={{
                          display: 'inline-flex',
                          backgroundColor: '#f1f5f9',
                          borderRadius: 6,
                          padding: 2,
                          gap: 2,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => setPromptTab('resolved')}
                          style={{
                            border: 'none',
                            borderRadius: 4,
                            padding: '3px 8px',
                            fontSize: 11,
                            fontWeight: promptTab === 'resolved' ? 600 : 500,
                            backgroundColor: promptTab === 'resolved' ? '#ffffff' : 'transparent',
                            color: promptTab === 'resolved' ? '#0f172a' : '#64748b',
                            boxShadow: promptTab === 'resolved' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                            cursor: 'pointer',
                          }}
                        >
                          最终生成词 (Resolved)
                        </button>
                        <button
                          type="button"
                          onClick={() => setPromptTab('original')}
                          style={{
                            border: 'none',
                            borderRadius: 4,
                            padding: '3px 8px',
                            fontSize: 11,
                            fontWeight: promptTab === 'original' ? 600 : 500,
                            backgroundColor: promptTab === 'original' ? '#ffffff' : 'transparent',
                            color: promptTab === 'original' ? '#0f172a' : '#64748b',
                            boxShadow: promptTab === 'original' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                            cursor: 'pointer',
                          }}
                        >
                          原始输入 (Original)
                        </button>
                      </div>
                    ) : (
                      <span style={{ fontSize: 11.5, fontWeight: 600, color: '#475569' }}>
                        生成提示词 (Prompt)
                      </span>
                    )}

                    <button
                      onClick={() =>
                        handleCopy(
                          'prompt',
                          hasDistinctPrompts && promptTab === 'original' ? originalPrompt : resolvedPrompt
                        )
                      }
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 3,
                        fontSize: 11,
                        fontWeight: 500,
                        padding: '2px 7px',
                        borderRadius: 4,
                        border: '1px solid #e2e8f0',
                        backgroundColor: copiedKey === 'prompt' ? '#f1f5f9' : '#ffffff',
                        color: copiedKey === 'prompt' ? '#0f172a' : '#475569',
                        cursor: 'pointer',
                      }}
                    >
                      {copiedKey === 'prompt' ? <Check size={10} /> : <Copy size={10} />}
                      {copiedKey === 'prompt' ? '已复制' : '复制'}
                    </button>
                  </div>

                  <div
                    style={{
                      backgroundColor: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: 8,
                      padding: '9px 11px',
                      fontSize: 11.5,
                      lineHeight: 1.55,
                      color: '#1e293b',
                      maxHeight: 108,
                      overflowY: 'auto',
                      wordBreak: 'break-word',
                      userSelect: 'text',
                    }}
                  >
                    {hasDistinctPrompts && promptTab === 'original' ? originalPrompt : resolvedPrompt}
                  </div>

                  {/* 提示词扩充追踪 / 思考链折叠 */}
                  {promptTrace && (
                    <div style={{ marginTop: 2 }}>
                      <button
                        type="button"
                        onClick={() => setShowTrace((s) => !s)}
                        style={{
                          border: 'none',
                          backgroundColor: 'transparent',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 11,
                          fontWeight: 500,
                          color: '#64748b',
                          cursor: 'pointer',
                          padding: 0,
                        }}
                      >
                        {showTrace ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        <span>提示词润色规划追踪 (Trace)</span>
                      </button>

                      {showTrace && (
                        <div
                          style={{
                            marginTop: 6,
                            backgroundColor: '#f1f5f9',
                            border: '1px solid #e2e8f0',
                            borderRadius: 6,
                            padding: '8px 10px',
                            fontSize: 10.5,
                            fontFamily: 'monospace',
                            lineHeight: 1.45,
                            color: '#334155',
                            maxHeight: 120,
                            overflowY: 'auto',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all',
                            userSelect: 'text',
                          }}
                        >
                          {promptTrace}
                        </div>
                      )}
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
                    padding: '8px 0',
                  }}
                >
                  <Loader2 size={12} className="animate-spin" /> 查询 AI 生成参数中...
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  )
})

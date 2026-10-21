import React, { memo, useState, useEffect, useMemo, useId } from 'react'
import {
  X,
  Copy,
  Check,
  ExternalLink,
  Loader2,
  ChevronDown,
  ArrowLeft,
} from 'lucide-react'
import type { CanvasImage, ReferenceImageItem } from '../types'
import { useCanvasStore } from '../store/canvasStore'
import { fetchImageMetadata, type ImageMetadataResponse } from '../services/aiImageService'
import { getOriginalImageViewerUrl } from '../utils/imageViewer'
import './ImagePropertiesModal.css'

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
  if (q === 'auto') return '自动'
  if (q === 'standard') return '标准'
  if (q === 'high') return '高清'
  if (q === 'ultra') return '极清'
  return quality
}

function formatVariantLabel(variant?: string): string {
  if (!variant) return ''
  const v = variant.toLowerCase()
  if (v === 'flare') return '通透锐利'
  if (v === 'sunburst') return '暖阳柔光'
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
  return <ImagePropertiesModalContent key={`${image.id}:${image.url}`} image={image} onClose={onClose} />
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

  const titleId = useId()
  const detailsId = useId()
  const [showDetails, setShowDetails] = useState(false)
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
        e.stopPropagation()
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
    (meta.referenceCount && meta.referenceCount > 0) ||
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
    if (image.url.startsWith('data:') || image.url.startsWith('blob:')) {
      return image.name || remoteMeta?.fileName || 'image.png'
    }
    try {
      const pathname = new URL(image.url, window.location.origin).pathname
      const parts = pathname.split('/')
      return decodeURIComponent(parts[parts.length - 1] || image.name || 'image.png')
    } catch {
      return image.name || 'image.png'
    }
  }, [image.url, image.name, remoteMeta?.fileName])

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

  const dimensions = naturalSize.w > 0 && naturalSize.h > 0
    ? `${naturalSize.w} × ${naturalSize.h} px`
    : ''
  const summary = [format, dimensions, fileSizeText].filter(Boolean).join(' · ')
  const name = image.name || fileName
  const displayName = /^[a-f0-9-]{16,}(?:\.[a-z0-9]+)?$/i.test(name)
    ? (isAiGenerated ? 'AI 生成图片' : '图片')
    : name
  const specification = [size, resolution].filter(Boolean).join(' · ')
  const referenceCount = referenceImages.length || aiInfo?.referenceCount || meta.referenceCount || meta.refCount
  const visiblePrompt = resolvedPrompt || originalPrompt
  const detailRows = [
    { label: '文件名', value: fileName },
    { label: '画布尺寸', value: `${Math.round(image.width)} × ${Math.round(image.height)} px` },
    { label: '画布位置', value: `${Math.round(image.x)}, ${Math.round(image.y)}` },
    { label: '旋转角度', value: image.rotation ? `${Math.round(image.rotation)}°` : '' },
    { label: '服务商', value: provider.toUpperCase() },
    { label: '画质', value: formatQualityLabel(quality) },
    { label: '风格', value: formatVariantLabel(variant) },
    { label: '预设', value: skill },
    { label: '生成时间', value: formatTimestamp(createdAt) },
    { label: '任务编号', value: jobId, copyKey: 'jobId' },
    { label: '请求编号', value: clientRequestId, copyKey: 'clientReq' },
  ].filter((row) => row.value)

  const handleCopy = async (key: string, text: string) => {
    if (!text) return
    if (await copyToClipboard(text)) {
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 2000)
    }
  }

  const copyButton = (key: string, text: string, label = '复制') => (
    <button
      type="button"
      className="image-properties__text-button"
      onClick={() => handleCopy(key, text)}
      title={`复制${key === 'prompt' ? '提示词' : key === 'original' ? '原始输入' : key === 'trace' ? '提示词记录' : '编号'}`}
    >
      {copiedKey === key ? <Check size={12} /> : <Copy size={12} />}
      {copiedKey === key ? '已复制' : label}
    </button>
  )

  return (
    <div data-modal="image-properties" className="image-properties__overlay" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="image-properties"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="image-properties__header">
          <div className="image-properties__heading">
            {previewingImg && (
              <button
                type="button"
                className="image-properties__icon-button"
                onClick={() => setPreviewingImg(null)}
                aria-label="返回图片属性"
              >
                <ArrowLeft size={16} />
              </button>
            )}
            <h2 id={titleId}>{previewingImg ? '图片预览' : '图片属性'}</h2>
          </div>
          <button type="button" className="image-properties__icon-button" onClick={onClose} aria-label="关闭" title="关闭（Esc）">
            <X size={16} />
          </button>
        </header>

        <div className="image-properties__body">
          {previewingImg ? (
            <div className="image-properties__preview">
              <img src={previewingImg.url} alt={previewingImg.title} />
              <a href={getOriginalImageViewerUrl(previewingImg.url, previewingImg.title)} target="_blank" rel="noopener noreferrer" className="image-properties__text-button">
                查看原图 <ExternalLink size={12} />
              </a>
            </div>
          ) : (
            <>
              <div className="image-properties__summary">
                <button
                  type="button"
                  className="image-properties__thumbnail"
                  onClick={() => setPreviewingImg({ url: image.url, title: displayName })}
                  aria-label="预览图片"
                >
                  <img src={image.url} alt={displayName} />
                </button>
                <div className="image-properties__file">
                  <div className="image-properties__name" title={fileName}>{displayName}</div>
                  <div className="image-properties__meta">
                    <span>{summary}</span>
                    {loadingMeta && !fileSizeText && <Loader2 size={12} className="animate-spin" aria-label="正在读取图片信息" />}
                  </div>
                  <a href={getOriginalImageViewerUrl(image.url, displayName)} target="_blank" rel="noopener noreferrer" className="image-properties__text-button">
                    查看原图 <ExternalLink size={11} />
                  </a>
                </div>
              </div>

              {isAiGenerated && (model || specification) && (
                <dl className="image-properties__generation" aria-label="生成信息">
                  {model && <><dt>模型</dt><dd>{model}</dd></>}
                  {specification && <><dt>规格</dt><dd>{specification}</dd></>}
                </dl>
              )}

              {hasReference && (
                <section className="image-properties__section" aria-label="参考图">
                  <div className="image-properties__section-heading">
                    <h3>参考图</h3>
                    {referenceCount > 0 && <span className="image-properties__count">{referenceCount}</span>}
                  </div>
                  {referenceImages.length > 0 ? (
                    <div className="image-properties__references">
                      {referenceImages.map((ref, index) => {
                        const title = ref.name || `参考图 ${index + 1}`
                        return (
                          <button
                            type="button"
                            key={`${ref.url}-${index}`}
                            className="image-properties__thumbnail"
                            onClick={() => setPreviewingImg({ url: ref.url, title })}
                            title={title}
                            aria-label={`预览参考图 ${index + 1}：${title}`}
                          >
                            <img src={ref.url} alt={title} />
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="image-properties__empty">参考图暂不可预览</p>
                  )}
                </section>
              )}

              {isAiGenerated && visiblePrompt && (
                <section className="image-properties__section" aria-label="提示词">
                  <div className="image-properties__section-heading">
                    <h3>提示词</h3>
                    {copyButton('prompt', visiblePrompt)}
                  </div>
                  <div className="image-properties__prompt" tabIndex={0}>{visiblePrompt}</div>
                </section>
              )}

              <div className="image-properties__details">
                <button
                  type="button"
                  className="image-properties__details-toggle"
                  onClick={() => setShowDetails((value) => !value)}
                  aria-expanded={showDetails}
                  aria-controls={detailsId}
                >
                  {showDetails ? '收起信息' : '更多信息'}
                  <ChevronDown size={14} style={{ transform: showDetails ? 'rotate(180deg)' : undefined }} />
                </button>
                {showDetails && (
                  <div id={detailsId} className="image-properties__details-content">
                    <dl className="image-properties__detail-list">
                      {detailRows.map(({ label, value, copyKey }) => (
                        <React.Fragment key={label}>
                          <dt>{label}</dt>
                          <dd>
                            <span>{value}</span>
                            {copyKey && copyButton(copyKey, value)}
                          </dd>
                        </React.Fragment>
                      ))}
                    </dl>
                    {hasDistinctPrompts && (
                      <section className="image-properties__section" aria-label="原始输入">
                        <div className="image-properties__section-heading">
                          <h3>原始输入</h3>
                          {copyButton('original', originalPrompt)}
                        </div>
                        <div className="image-properties__prompt" tabIndex={0}>{originalPrompt}</div>
                      </section>
                    )}
                    {promptTrace && (
                      <section className="image-properties__section" aria-label="提示词记录">
                        <div className="image-properties__section-heading">
                          <h3>提示词记录</h3>
                          {copyButton('trace', promptTrace)}
                        </div>
                        <div className="image-properties__prompt" tabIndex={0}>{promptTrace}</div>
                      </section>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
})

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  ImagePlus,
  Loader2,
  RefreshCw,
  Search,
  Shirt,
  Sparkles,
  X,
  ZoomIn,
} from 'lucide-react'
import type { CanvasImage } from '../types'
import {
  analyzeOutfit,
  normalizeAssetUrl,
  searchOutfitAssets,
  type OutfitAnalysis,
  type OutfitAsset,
  type OutfitAssetSearchResult,
  type OutfitChangeRequest,
} from '../services/aiImageService'

interface Props {
  image: CanvasImage
  onClose: () => void
  onSubmit: (req: OutfitChangeRequest) => Promise<void>
}

interface UploadItem {
  id: string
  file: File
  previewUrl: string
}

type AnalysisState =
  | { status: 'loading' }
  | { status: 'done'; data: OutfitAnalysis }
  | { status: 'error'; error: string }
  | { status: 'skipped' }

const DEFAULT_MAX_REFS = 8
const ACCEPTED_UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/webp']

// 跨次打开记住上一次的货号与生成设置，便于同款连续换装
let lastSkuInput = ''
let lastModel: OutfitChangeRequest['model'] = 'gpt-image-2.5'
let lastResolution: OutfitChangeRequest['resolution'] = '1K'

const MODEL_OPTIONS: { key: OutfitChangeRequest['model']; label: string; desc: string }[] = [
  { key: 'gpt-image-2.5', label: 'GPT Image 2.5', desc: '中文理解强，智能路由' },
  { key: 'nano-banana-pro', label: 'Nano Banana Pro', desc: '编辑一致性高' },
]

export const OutfitChangeModal: React.FC<Props> = ({ image, onClose, onSubmit }) => {
  const [analysis, setAnalysis] = useState<AnalysisState>({ status: 'loading' })
  const [targetIds, setTargetIds] = useState<string[]>([])

  const [skuInput, setSkuInput] = useState(lastSkuInput)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchResult, setSearchResult] = useState<OutfitAssetSearchResult | null>(null)
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [selected, setSelected] = useState<OutfitAsset[]>([])
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [isDragOver, setIsDragOver] = useState(false)

  const [model, setModel] = useState<OutfitChangeRequest['model']>(lastModel)
  const [resolution, setResolution] = useState<OutfitChangeRequest['resolution']>(lastResolution)
  const [batchCount, setBatchCount] = useState(1)
  const [extraPrompt, setExtraPrompt] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  const skuInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadsRef = useRef<UploadItem[]>([])
  uploadsRef.current = uploads

  const maxRefs = searchResult?.max_references || DEFAULT_MAX_REFS
  const totalSelected = selected.length + uploads.length
  const remaining = maxRefs - totalSelected

  // ── 1. 打开即触发 VLM 分析 ──
  const runAnalysis = useCallback(() => {
    setAnalysis({ status: 'loading' })
    let cancelled = false
    analyzeOutfit(image.url)
      .then((data) => {
        if (!cancelled) setAnalysis({ status: 'done', data })
      })
      .catch((err: any) => {
        if (!cancelled) setAnalysis({ status: 'error', error: err?.message || '分析失败' })
      })
    return () => {
      cancelled = true
    }
  }, [image.url])

  useEffect(() => runAnalysis(), [runAnalysis])

  useEffect(() => {
    const t = setTimeout(() => skuInputRef.current?.focus(), 60)
    return () => clearTimeout(t)
  }, [])

  // 卸载时释放本地预览 URL
  useEffect(
    () => () => {
      uploadsRef.current.forEach((u) => URL.revokeObjectURL(u.previewUrl))
    },
    []
  )

  // Esc：先关大图预览，再关弹窗
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (preview) setPreview(null)
      else if (!submitting) onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [preview, submitting, onClose])

  const parsedSkus = useMemo(() => {
    const tokens = skuInput.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean)
    return Array.from(new Set(tokens))
  }, [skuInput])

  // ── 2. SKU 检索 ──
  const handleSearch = async () => {
    if (parsedSkus.length === 0) {
      setSearchError('请输入商品货号（SKU）')
      skuInputRef.current?.focus()
      return
    }
    lastSkuInput = skuInput
    setSearching(true)
    setSearchError(null)
    try {
      const result = await searchOutfitAssets(parsedSkus)
      setSearchResult(result)
      setTypeFilter('all')
      // 保留仍在新结果中的已选项
      const ids = new Set(result.items.flatMap((it) => it.assets.map((a) => a.id + '|' + a.sku)))
      setSelected((prev) => prev.filter((a) => ids.has(a.id + '|' + a.sku)))
      if (!result.library_exists) {
        setSearchError('当前服务器未挂载素材库，可点击「本地上传」添加素材图')
      } else if (!result.items.some((it) => it.found)) {
        setSearchError('素材库中未找到这些货号的素材图，请检查货号或使用本地上传')
      }
    } catch (err: any) {
      setSearchError(err?.message || '检索失败')
    } finally {
      setSearching(false)
    }
  }

  const assetKey = (a: OutfitAsset) => `${a.sku}|${a.id}`
  const selectedKeys = useMemo(() => new Set(selected.map(assetKey)), [selected])

  const toggleAsset = (asset: OutfitAsset) => {
    const key = assetKey(asset)
    if (selectedKeys.has(key)) {
      setSelected((prev) => prev.filter((a) => assetKey(a) !== key))
      return
    }
    if (remaining <= 0) {
      setSubmitError(`最多选择 ${maxRefs} 张素材（含原图共 9 张参考图）`)
      return
    }
    setSubmitError(null)
    setSelected((prev) => [...prev, asset])
  }

  const selectAllOfSku = (assets: OutfitAsset[]) => {
    const toAdd = assets.filter((a) => !selectedKeys.has(assetKey(a)))
    if (toAdd.length === 0) {
      const keys = new Set(assets.map(assetKey))
      setSelected((prev) => prev.filter((a) => !keys.has(assetKey(a))))
      return
    }
    const allowed = toAdd.slice(0, Math.max(0, remaining))
    if (allowed.length < toAdd.length) {
      setSubmitError(`已达上限，仅添加了 ${allowed.length} 张（最多 ${maxRefs} 张）`)
    }
    setSelected((prev) => [...prev, ...allowed])
  }

  // ── 本地上传兜底 ──
  const addFiles = (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => ACCEPTED_UPLOAD_TYPES.includes(f.type))
    if (list.length === 0) {
      setSubmitError('仅支持 PNG / JPG / WEBP 图片')
      return
    }
    const allowed = list.slice(0, Math.max(0, remaining))
    if (allowed.length < list.length) {
      setSubmitError(`已达上限，仅添加了 ${allowed.length} 张（最多 ${maxRefs} 张）`)
    } else {
      setSubmitError(null)
    }
    setUploads((prev) => [
      ...prev,
      ...allowed.map((file) => ({
        id: 'up-' + Math.random().toString(36).slice(2, 10),
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ])
  }

  const removeUpload = (id: string) => {
    setUploads((prev) => {
      const hit = prev.find((u) => u.id === id)
      if (hit) URL.revokeObjectURL(hit.previewUrl)
      return prev.filter((u) => u.id !== id)
    })
  }

  const toggleTarget = (id: string) => {
    setTargetIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  // ── 3. 提交 ──
  const analysisPending = analysis.status === 'loading'
  const canSubmit = totalSelected > 0 && !analysisPending && !submitting

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setSubmitError(null)
    lastModel = model
    lastResolution = resolution
    try {
      await onSubmit({
        sourceUrl: image.url,
        sourceName: image.name,
        assets: selected,
        uploads: uploads.map((u) => u.file),
        analysis: analysis.status === 'done' ? analysis.data : null,
        targetGarmentIds: analysis.status === 'done' ? targetIds : [],
        extraPrompt: extraPrompt.trim(),
        model,
        resolution,
        batchCount,
      })
    } catch (err: any) {
      setSubmitError(err?.message || '提交失败')
      setSubmitting(false)
    }
  }

  const availableTypes = useMemo(() => {
    const map = new Map<string, string>()
    searchResult?.items.forEach((it) => it.assets.forEach((a) => map.set(a.asset_type, a.type_label)))
    return Array.from(map.entries())
  }, [searchResult])

  const submitLabel = analysisPending
    ? '等待图片分析…'
    : totalSelected === 0
    ? '请先勾选素材图'
    : `开始换装（${totalSelected} 张素材${batchCount > 1 ? ` · 出 ${batchCount} 张` : ''}）`

  return (
    <div
      data-modal="outfit-change"
      style={styles.backdrop}
      // 弹窗内的鼠标/键盘事件不能冒泡到画布（否则会触发框选、右键菜单、Delete 删除选中图等）
      onMouseDown={(e) => {
        e.stopPropagation()
        if (e.target === e.currentTarget && !submitting) onClose()
      }}
      onMouseUp={(e) => e.stopPropagation()}
      onMouseMove={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onKeyDown={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
    >
      <div style={styles.dialog} onMouseDown={(e) => e.stopPropagation()}>
        {/* 标题栏 */}
        <div style={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={styles.headerIcon}>
              <Shirt size={18} strokeWidth={2.2} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>AI 换装</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>
                识别当前图片服饰 → 选择货号素材角度图 → 参考图生图，结果自动放到原图右侧
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} style={styles.iconButton} title="关闭 (Esc)">
            <X size={16} />
          </button>
        </div>

        <div style={styles.body}>
          {/* ── 左栏：原图 + 分析 ── */}
          <div style={styles.leftCol}>
            <div style={styles.sectionLabel}>原图</div>
            <div style={styles.sourceBox} onClick={() => setPreview(normalizeAssetUrl(image.url))}>
              <img src={normalizeAssetUrl(image.url)} alt="" style={styles.sourceImg} draggable={false} />
            </div>

            <div style={{ ...styles.sectionLabel, marginTop: 14, display: 'flex', justifyContent: 'space-between' }}>
              <span>服饰识别</span>
              {analysis.status === 'done' && (
                <span style={styles.typeBadge}>{analysis.data.image_type_label}</span>
              )}
            </div>

            {analysis.status === 'loading' && (
              <div style={styles.analysisBox}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#475569', fontSize: 12 }}>
                  <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                  <span>VLM 正在识别图中服饰…</span>
                </div>
                {[72, 54, 64].map((w, i) => (
                  <div key={i} style={{ ...styles.skeleton, width: `${w}%` }} />
                ))}
                <button
                  type="button"
                  style={styles.linkButton}
                  onClick={() => setAnalysis({ status: 'skipped' })}
                >
                  跳过分析，直接换装
                </button>
              </div>
            )}

            {analysis.status === 'error' && (
              <div style={{ ...styles.analysisBox, borderColor: '#fde68a', backgroundColor: '#fffbeb' }}>
                <div style={{ display: 'flex', gap: 6, fontSize: 12, color: '#92400e', lineHeight: 1.5 }}>
                  <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                  <span>识别失败：{analysis.error}。仍可直接换装，模型会自动判断替换部位。</span>
                </div>
                <button type="button" style={styles.linkButton} onClick={() => runAnalysis()}>
                  <RefreshCw size={12} /> 重新识别
                </button>
              </div>
            )}

            {analysis.status === 'skipped' && (
              <div style={styles.analysisBox}>
                <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
                  已跳过识别，模型将根据素材品类自动替换对应部位。
                </div>
                <button type="button" style={styles.linkButton} onClick={() => runAnalysis()}>
                  <RefreshCw size={12} /> 重新识别
                </button>
              </div>
            )}

            {analysis.status === 'done' && (
              <div style={styles.analysisBox}>
                {analysis.data.summary && (
                  <div style={{ fontSize: 12, color: '#334155', lineHeight: 1.5 }}>{analysis.data.summary}</div>
                )}
                {analysis.data.garments.length > 0 ? (
                  <>
                    <div style={{ fontSize: 11, color: '#64748b' }}>
                      点选要替换的部位（不选则按素材品类自动匹配）
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {analysis.data.garments.map((g) => {
                        const active = targetIds.includes(g.id)
                        return (
                          <button
                            key={g.id}
                            type="button"
                            onClick={() => toggleTarget(g.id)}
                            title={[g.color, g.material, g.details, g.position].filter(Boolean).join(' · ')}
                            style={{
                              ...styles.garmentChip,
                              borderColor: active ? '#0f172a' : '#e2e8f0',
                              backgroundColor: active ? '#0f172a' : '#ffffff',
                              color: active ? '#ffffff' : '#334155',
                            }}
                          >
                            {active && <Check size={11} strokeWidth={3} />}
                            <span style={{ opacity: active ? 0.75 : 0.6 }}>{g.slot_label}</span>
                            <span>
                              {g.color}
                              {g.name}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 12, color: '#64748b' }}>未识别到明确的服饰，将按素材品类自动替换。</div>
                )}
              </div>
            )}
          </div>

          {/* ── 右栏：素材检索与勾选 ── */}
          <div style={styles.rightCol}>
            <div style={{ ...styles.sectionLabel, display: 'flex', justifyContent: 'space-between' }}>
              <span>换装素材</span>
              <span style={{ fontWeight: 500, color: remaining <= 0 ? '#ef4444' : '#64748b' }}>
                已选 {totalSelected} / {maxRefs}
              </span>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <div style={styles.searchBox}>
                <Search size={14} color="#94a3b8" />
                <input
                  ref={skuInputRef}
                  value={skuInput}
                  onChange={(e) => setSkuInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleSearch()
                    }
                  }}
                  placeholder="输入货号 SKU，多个用逗号分隔，回车检索"
                  style={styles.searchInput}
                />
              </div>
              <button
                type="button"
                onClick={handleSearch}
                disabled={searching}
                style={{ ...styles.secondaryButton, minWidth: 72 }}
              >
                {searching ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : '检索'}
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={styles.secondaryButton}
                title="素材库没有时，可上传本地服饰图"
              >
                <ImagePlus size={14} /> 本地上传
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_UPLOAD_TYPES.join(',')}
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files)
                  e.target.value = ''
                }}
              />
            </div>

            {availableTypes.length > 1 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[['all', '全部'] as [string, string], ...availableTypes].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTypeFilter(key)}
                    style={{
                      ...styles.filterChip,
                      backgroundColor: typeFilter === key ? '#0f172a' : '#f1f5f9',
                      color: typeFilter === key ? '#ffffff' : '#475569',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {searchError && (
              <div style={styles.infoBar}>
                <AlertCircle size={14} style={{ flexShrink: 0 }} />
                <span>{searchError}</span>
              </div>
            )}

            {/* 素材网格（可拖入本地图片） */}
            <div
              style={{
                ...styles.assetArea,
                borderColor: isDragOver ? '#3b82f6' : '#e2e8f0',
                backgroundColor: isDragOver ? '#eff6ff' : '#f8fafc',
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('Files')) {
                  e.preventDefault()
                  setIsDragOver(true)
                }
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setIsDragOver(false)
                if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files)
              }}
            >
              {uploads.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={styles.groupHeader}>
                    <span style={{ fontWeight: 600, color: '#0f172a' }}>本地上传</span>
                    <span style={{ color: '#94a3b8' }}>{uploads.length} 张 · 已全部选用</span>
                  </div>
                  <div style={styles.grid}>
                    {uploads.map((u, idx) => (
                      <div key={u.id} style={{ ...styles.tile, ...styles.tileSelected }}>
                        <img src={u.previewUrl} alt="" style={styles.tileImg} draggable={false} />
                        <div style={styles.tileFooter}>
                          <span style={styles.tileAngle}>上传素材 {idx + 1}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeUpload(u.id)}
                          style={styles.tileRemove}
                          title="移除"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {searchResult?.items.map((group) => {
                const assets = group.assets.filter((a) => typeFilter === 'all' || a.asset_type === typeFilter)
                if (!group.found) {
                  return (
                    <div key={group.sku} style={{ marginBottom: 12 }}>
                      <div style={styles.groupHeader}>
                        <span style={{ fontWeight: 600, color: '#0f172a' }}>{group.sku}</span>
                        <span style={{ color: '#ef4444' }}>未找到素材</span>
                      </div>
                    </div>
                  )
                }
                if (assets.length === 0) return null
                const allChosen = assets.every((a) => selectedKeys.has(assetKey(a)))
                return (
                  <div key={group.sku} style={{ marginBottom: 12 }}>
                    <div style={styles.groupHeader}>
                      <span style={{ fontWeight: 600, color: '#0f172a' }}>{group.sku}</span>
                      <span style={{ color: '#94a3b8' }}>{assets.length} 张角度图</span>
                      <button type="button" style={styles.linkButton} onClick={() => selectAllOfSku(assets)}>
                        {allChosen ? '取消全选' : '全选'}
                      </button>
                    </div>
                    <div style={styles.grid}>
                      {assets.map((asset) => {
                        const isSelected = selectedKeys.has(assetKey(asset))
                        const order = isSelected ? selected.findIndex((a) => assetKey(a) === assetKey(asset)) : -1
                        return (
                          <div
                            key={assetKey(asset)}
                            role="checkbox"
                            aria-checked={isSelected}
                            tabIndex={0}
                            onClick={() => toggleAsset(asset)}
                            onKeyDown={(e) => {
                              if (e.key === ' ' || e.key === 'Enter') {
                                e.preventDefault()
                                toggleAsset(asset)
                              }
                            }}
                            title={`${asset.filename}（${asset.type_label}）`}
                            style={{
                              ...styles.tile,
                              ...(isSelected ? styles.tileSelected : null),
                              opacity: !isSelected && remaining <= 0 ? 0.5 : 1,
                            }}
                          >
                            <img
                              src={asset.thumb_url}
                              alt={asset.filename}
                              loading="lazy"
                              style={styles.tileImg}
                              draggable={false}
                            />
                            <div style={styles.tileFooter}>
                              <span style={styles.tileAngle}>{asset.angle}</span>
                              <span style={styles.tileType}>{asset.type_label}</span>
                            </div>
                            <div
                              style={{
                                ...styles.checkbox,
                                backgroundColor: isSelected ? '#0f172a' : 'rgba(255,255,255,0.92)',
                                borderColor: isSelected ? '#0f172a' : '#cbd5e1',
                              }}
                            >
                              {isSelected && (
                                <span style={{ fontSize: 10, fontWeight: 700, color: '#fff' }}>{order + 1}</span>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setPreview(asset.url)
                              }}
                              style={styles.tileZoom}
                              title="查看大图"
                            >
                              <ZoomIn size={12} />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}

              {!searchResult && uploads.length === 0 && (
                <div style={styles.emptyState}>
                  <Shirt size={28} color="#cbd5e1" />
                  <div style={{ fontSize: 13, color: '#475569', fontWeight: 500 }}>输入货号检索素材库中的各角度素材图</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>
                    同一货号建议勾选 2–4 个角度（正面/背面/细节），也可拖入本地图片
                  </div>
                </div>
              )}
            </div>

            {/* 生成设置 */}
            <button type="button" style={styles.advancedToggle} onClick={() => setShowAdvanced((v) => !v)}>
              {showAdvanced ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <span>生成设置</span>
              <span style={{ color: '#94a3b8', fontWeight: 400 }}>
                {MODEL_OPTIONS.find((m) => m.key === model)?.label} · {resolution} · {batchCount} 张
                {extraPrompt.trim() ? ' · 有补充要求' : ''}
              </span>
            </button>
            {showAdvanced && (
              <div style={styles.advancedBox}>
                <div style={styles.settingRow}>
                  <span style={styles.settingLabel}>模型</span>
                  <div style={styles.segment}>
                    {MODEL_OPTIONS.map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        title={opt.desc}
                        onClick={() => setModel(opt.key)}
                        style={{ ...styles.segmentItem, ...(model === opt.key ? styles.segmentActive : null) }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={styles.settingRow}>
                  <span style={styles.settingLabel}>清晰度</span>
                  <div style={styles.segment}>
                    {(['1K', '2K'] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setResolution(r)}
                        style={{ ...styles.segmentItem, ...(resolution === r ? styles.segmentActive : null) }}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                  <span style={styles.settingLabel}>出图数</span>
                  <div style={styles.segment}>
                    {[1, 2, 4].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setBatchCount(n)}
                        style={{ ...styles.segmentItem, ...(batchCount === n ? styles.segmentActive : null) }}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                <textarea
                  value={extraPrompt}
                  onChange={(e) => setExtraPrompt(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="补充要求（可选），如：上衣下摆塞进裤腰、袖子挽起"
                  style={styles.textarea}
                />
              </div>
            )}
          </div>
        </div>

        {/* 底部 */}
        <div style={styles.footer}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {submitError && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#ef4444' }}>
                <AlertCircle size={13} style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{submitError}</span>
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} disabled={submitting} style={styles.cancelButton}>
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              ...styles.primaryButton,
              opacity: canSubmit ? 1 : 0.55,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
          >
            {submitting ? (
              <>
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                <span>正在提交…</span>
              </>
            ) : (
              <>
                <Sparkles size={14} />
                <span>{submitLabel}</span>
                {canSubmit && <ArrowRight size={14} />}
              </>
            )}
          </button>
        </div>
      </div>

      {/* 大图预览 */}
      {preview && (
        <div style={styles.lightbox} onMouseDown={() => setPreview(null)}>
          <img src={preview} alt="" style={{ maxWidth: '86vw', maxHeight: '86vh', borderRadius: 8 }} />
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 10000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.42)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    animation: 'fadeIn 150ms ease-out',
  },
  dialog: {
    width: 'min(920px, calc(100vw - 32px))',
    maxHeight: 'calc(100vh - 48px)',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    boxShadow: '0 24px 48px -12px rgba(15, 23, 42, 0.25), 0 0 0 1px rgba(226, 232, 240, 0.9)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: '#1e293b',
  },
  header: {
    padding: '14px 20px',
    borderBottom: '1px solid #f1f5f9',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: 'linear-gradient(to bottom, #ffffff, #fbfcfe)',
  },
  headerIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
    color: '#0f172a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButton: {
    background: 'transparent',
    border: 'none',
    padding: 6,
    borderRadius: 8,
    cursor: 'pointer',
    color: '#94a3b8',
    display: 'flex',
  },
  body: {
    display: 'flex',
    gap: 20,
    padding: 20,
    minHeight: 0,
    flex: 1,
    overflow: 'hidden',
  },
  leftCol: {
    width: 240,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    overflowY: 'auto',
  },
  rightCol: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    minHeight: 0,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: '#334155',
    marginBottom: 8,
    alignItems: 'center',
  },
  sourceBox: {
    width: '100%',
    height: 260,
    borderRadius: 12,
    border: '1px solid #e2e8f0',
    backgroundColor: '#f8fafc',
    backgroundImage:
      'linear-gradient(45deg, #f1f5f9 25%, transparent 25%), linear-gradient(-45deg, #f1f5f9 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f1f5f9 75%), linear-gradient(-45deg, transparent 75%, #f1f5f9 75%)',
    backgroundSize: '16px 16px',
    backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    cursor: 'zoom-in',
  },
  sourceImg: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' },
  typeBadge: {
    fontSize: 11,
    fontWeight: 600,
    padding: '1px 8px',
    borderRadius: 99,
    backgroundColor: '#eef2ff',
    color: '#4338ca',
  },
  analysisBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    border: '1px solid #e2e8f0',
    backgroundColor: '#ffffff',
  },
  skeleton: {
    height: 10,
    borderRadius: 5,
    background: 'linear-gradient(90deg, #f1f5f9 0%, #e2e8f0 50%, #f1f5f9 100%)',
    backgroundSize: '200% 100%',
    animation: 'shimmer 1.4s ease-in-out infinite',
  },
  garmentChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 9px',
    borderRadius: 99,
    border: '1px solid',
    fontSize: 11,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 120ms ease',
  },
  linkButton: {
    alignSelf: 'flex-start',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    background: 'none',
    border: 'none',
    padding: 0,
    fontSize: 12,
    color: '#2563eb',
    cursor: 'pointer',
  },
  searchBox: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    height: 36,
    padding: '0 12px',
    borderRadius: 9,
    border: '1px solid #cbd5e1',
    backgroundColor: '#ffffff',
  },
  searchInput: {
    flex: 1,
    border: 'none',
    outline: 'none',
    fontSize: 13,
    color: '#0f172a',
    background: 'transparent',
    fontFamily: 'inherit',
  },
  secondaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    height: 36,
    padding: '0 12px',
    borderRadius: 9,
    border: '1px solid #e2e8f0',
    backgroundColor: '#f8fafc',
    color: '#0f172a',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  filterChip: {
    border: 'none',
    padding: '3px 10px',
    borderRadius: 99,
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
  },
  infoBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '7px 12px',
    borderRadius: 8,
    backgroundColor: '#fffbeb',
    border: '1px solid #fde68a',
    color: '#92400e',
    fontSize: 12,
  },
  assetArea: {
    flex: 1,
    minHeight: 220,
    overflowY: 'auto',
    padding: 12,
    borderRadius: 12,
    border: '1px dashed',
    transition: 'all 120ms ease',
  },
  groupHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    fontSize: 12,
    marginBottom: 8,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))',
    gap: 10,
  },
  tile: {
    position: 'relative',
    borderRadius: 10,
    border: '1.5px solid #e2e8f0',
    backgroundColor: '#ffffff',
    overflow: 'hidden',
    cursor: 'pointer',
    transition: 'border-color 120ms ease, box-shadow 120ms ease',
    outline: 'none',
  },
  tileSelected: {
    borderColor: '#0f172a',
    boxShadow: '0 0 0 2px rgba(15, 23, 42, 0.14)',
  },
  tileImg: {
    width: '100%',
    aspectRatio: '1 / 1',
    objectFit: 'contain',
    display: 'block',
    backgroundColor: '#f8fafc',
  },
  tileFooter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
    padding: '5px 7px',
    borderTop: '1px solid #f1f5f9',
  },
  tileAngle: { fontSize: 11, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap' },
  tileType: { fontSize: 10, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  checkbox: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 18,
    height: 18,
    borderRadius: 5,
    border: '1.5px solid',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileZoom: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 6,
    border: 'none',
    backgroundColor: 'rgba(255,255,255,0.92)',
    color: '#475569',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'zoom-in',
    boxShadow: '0 1px 3px rgba(15,23,42,0.12)',
  },
  tileRemove: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    border: 'none',
    backgroundColor: 'rgba(15,23,42,0.75)',
    color: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  emptyState: {
    height: '100%',
    minHeight: 190,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    textAlign: 'center',
  },
  advancedToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: 'none',
    border: 'none',
    padding: 0,
    fontSize: 12,
    fontWeight: 600,
    color: '#334155',
    cursor: 'pointer',
    textAlign: 'left',
  },
  advancedBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#f8fafc',
    border: '1px solid #e2e8f0',
  },
  settingRow: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  settingLabel: { fontSize: 12, color: '#64748b', minWidth: 40 },
  segment: {
    display: 'inline-flex',
    padding: 2,
    borderRadius: 8,
    backgroundColor: '#e2e8f0',
  },
  segmentItem: {
    border: 'none',
    background: 'transparent',
    padding: '4px 12px',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 500,
    color: '#475569',
    cursor: 'pointer',
  },
  segmentActive: {
    backgroundColor: '#ffffff',
    color: '#0f172a',
    fontWeight: 600,
    boxShadow: '0 1px 2px rgba(15,23,42,0.12)',
  },
  textarea: {
    width: '100%',
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    fontSize: 12,
    lineHeight: 1.5,
    resize: 'none',
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
    backgroundColor: '#ffffff',
  },
  footer: {
    padding: '12px 20px',
    backgroundColor: '#f8fafc',
    borderTop: '1px solid #f1f5f9',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  cancelButton: {
    height: 36,
    padding: '0 16px',
    borderRadius: 8,
    border: '1px solid #e2e8f0',
    backgroundColor: '#ffffff',
    color: '#475569',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
  },
  primaryButton: {
    height: 36,
    padding: '0 18px',
    borderRadius: 8,
    border: 'none',
    backgroundColor: '#0f172a',
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    boxShadow: '0 2px 4px rgba(15, 23, 42, 0.15)',
    whiteSpace: 'nowrap',
  },
  lightbox: {
    position: 'fixed',
    inset: 0,
    zIndex: 10001,
    backgroundColor: 'rgba(15, 23, 42, 0.78)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'zoom-out',
  },
}

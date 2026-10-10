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
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
  ZoomIn,
} from 'lucide-react'
import type { CanvasImage } from '../types'
import {
  analyzeOutfit,
  normalizeAssetUrl,
  PRESET_SLOTS,
  searchOutfitAssets,
  type OutfitAnalysis,
  type OutfitAsset,
  type OutfitAssetSearchResult,
  type OutfitChangeRequest,
} from '../services/aiImageService'
import { InteractiveMannequin } from './InteractiveMannequin'

interface Props {
  image: CanvasImage
  onClose: () => void
  onSubmit: (req: OutfitChangeRequest) => Promise<void>
}

interface UploadItem {
  id: string
  file: File
  previewUrl: string
  slot: string
}

interface SlotState {
  skuInput: string
  searchResult: OutfitAssetSearchResult | null
  searching: boolean
  searchError: string | null
  typeFilter: string
  selected: OutfitAsset[]
  uploads: UploadItem[]
}

type AnalysisState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; data: OutfitAnalysis }
  | { status: 'error'; error: string }

const DEFAULT_MAX_REFS = 8
const ACCEPTED_UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/webp']

// 记住全局模型配置
let lastModel: OutfitChangeRequest['model'] = 'gpt-image-2.5'
let lastResolution: OutfitChangeRequest['resolution'] = '1K'

const MODEL_OPTIONS: { key: OutfitChangeRequest['model']; label: string; desc: string }[] = [
  { key: 'gpt-image-2.5', label: 'GPT Image 2.5', desc: '中文理解强，智能路由' },
  { key: 'nano-banana-pro', label: 'Nano Banana Pro', desc: '编辑一致性高' },
]

export const OutfitChangeModal: React.FC<Props> = ({ image, onClose, onSubmit }) => {
  // ── 1. VLM 识别状态（默认 idle，用户点击触发） ──
  const [analysis, setAnalysis] = useState<AnalysisState>({ status: 'idle' })
  const [targetIds, setTargetIds] = useState<string[]>([])

  // ── 2. 部位驱动状态 ──
  const [activeSlotKey, setActiveSlotKey] = useState<string>('top')
  const [slotStates, setSlotStates] = useState<Record<string, SlotState>>(() => {
    const initial: Record<string, SlotState> = {}
    PRESET_SLOTS.forEach((slot) => {
      initial[slot.key] = {
        skuInput: '',
        searchResult: null,
        searching: false,
        searchError: null,
        typeFilter: 'all',
        selected: [],
        uploads: [],
      }
    })
    return initial
  })

  const [isDragOver, setIsDragOver] = useState(false)

  // ── 3. 生成参数 ──
  const [model, setModel] = useState<OutfitChangeRequest['model']>(lastModel)
  const [resolution, setResolution] = useState<OutfitChangeRequest['resolution']>(lastResolution)
  const [batchCount, setBatchCount] = useState(1)
  const [extraPrompt, setExtraPrompt] = useState('')
  const [showSettings, setShowSettings] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  const skuInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 当前激活部位的信息与状态
  const activeSlot = useMemo(
    () => PRESET_SLOTS.find((s) => s.key === activeSlotKey) || PRESET_SLOTS[0],
    [activeSlotKey]
  )
  const activeState = slotStates[activeSlotKey] || {
    skuInput: '',
    searchResult: null,
    searching: false,
    searchError: null,
    typeFilter: 'all',
    selected: [],
    uploads: [],
  }

  // 计算全局所有部位选中的素材总量
  const allSelectedAssets = useMemo(() => {
    return PRESET_SLOTS.flatMap((s) => slotStates[s.key]?.selected || [])
  }, [slotStates])

  const allUploads = useMemo(() => {
    return PRESET_SLOTS.flatMap((s) => slotStates[s.key]?.uploads || [])
  }, [slotStates])

  const totalSelected = allSelectedAssets.length + allUploads.length
  const maxRefs = DEFAULT_MAX_REFS
  const remaining = maxRefs - totalSelected

  // 计算每个部位已选素材总数，传递给人偶组件
  const configuredCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    PRESET_SLOTS.forEach((s) => {
      const st = slotStates[s.key]
      const count = (st?.selected.length || 0) + (st?.uploads.length || 0)
      if (count > 0) counts[s.key] = count
    })
    return counts
  }, [slotStates])

  // 已配置素材的部位列表
  const configuredSlots = useMemo(() => {
    return PRESET_SLOTS.filter((s) => {
      const st = slotStates[s.key]
      return st && (st.selected.length > 0 || st.uploads.length > 0)
    })
  }, [slotStates])

  // 更新指定部位状态的 helper
  const updateSlotState = useCallback((slotKey: string, patch: Partial<SlotState>) => {
    setSlotStates((prev) => ({
      ...prev,
      [slotKey]: {
        ...prev[slotKey],
        ...patch,
      },
    }))
  }, [])

  // ── VLM 智能分析（用户手动触发） ──
  const runAnalysis = useCallback(() => {
    setAnalysis({ status: 'loading' })
    let cancelled = false
    analyzeOutfit(image.url)
      .then((data) => {
        if (!cancelled) {
          setAnalysis({ status: 'done', data })
          setTargetIds(data.garments.map((g) => g.id))
        }
      })
      .catch((err: any) => {
        if (!cancelled) setAnalysis({ status: 'error', error: err?.message || '分析失败' })
      })
    return () => {
      cancelled = true
    }
  }, [image.url])

  // 切换部位时聚焦输入框
  useEffect(() => {
    const t = setTimeout(() => skuInputRef.current?.focus(), 60)
    return () => clearTimeout(t)
  }, [activeSlotKey])

  // 卸载时释放所有本地预览 URL
  useEffect(() => {
    return () => {
      Object.values(slotStates).forEach((st) => {
        st.uploads.forEach((u) => URL.revokeObjectURL(u.previewUrl))
      })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Esc 键监听
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (preview) setPreview(null)
      else if (showSettings) setShowSettings(false)
      else if (!submitting) onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [preview, showSettings, submitting, onClose])

  // ── 当前部位 SKU 检索 ──
  const handleSearch = async () => {
    const tokens = activeState.skuInput
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    const parsedSkus = Array.from(new Set(tokens))

    if (parsedSkus.length === 0) {
      updateSlotState(activeSlotKey, { searchError: `请输入【${activeSlot.label}】商品货号（SKU）` })
      skuInputRef.current?.focus()
      return
    }

    updateSlotState(activeSlotKey, { searching: true, searchError: null })
    try {
      const result = await searchOutfitAssets(parsedSkus)
      const newAssetKeys = new Set(result.items.flatMap((it) => it.assets.map((a) => a.id + '|' + a.sku)))
      const preservedSelected = activeState.selected.filter((a) => newAssetKeys.has(a.id + '|' + a.sku))

      let errorMsg: string | null = null
      if (!result.library_exists) {
        errorMsg = '当前未挂载素材库，可点击「本地上传」添加图片'
      } else if (!result.items.some((it) => it.found)) {
        errorMsg = `未在商品库中找到货号：${parsedSkus.join(', ')}`
      }

      updateSlotState(activeSlotKey, {
        searching: false,
        searchResult: result,
        searchError: errorMsg,
        selected: preservedSelected,
      })
    } catch (err: any) {
      updateSlotState(activeSlotKey, {
        searching: false,
        searchError: err?.message || '检索失败，请重试',
      })
    }
  }

  const assetKey = (a: OutfitAsset) => `${a.id}|${a.sku}`
  const activeSelectedKeys = useMemo(
    () => new Set(activeState.selected.map(assetKey)),
    [activeState.selected]
  )

  const toggleAsset = (asset: OutfitAsset) => {
    const key = assetKey(asset)
    const exists = activeSelectedKeys.has(key)
    if (exists) {
      updateSlotState(activeSlotKey, {
        selected: activeState.selected.filter((a) => assetKey(a) !== key),
      })
    } else {
      if (remaining <= 0) return
      const assetWithSlot: OutfitAsset = { ...asset, slot: activeSlotKey }
      updateSlotState(activeSlotKey, {
        selected: [...activeState.selected, assetWithSlot],
      })
    }
  }

  const selectAllOfSku = (assets: OutfitAsset[]) => {
    const currentKeys = new Set(activeState.selected.map(assetKey))
    const skuKeys = new Set(assets.map(assetKey))
    const allChosen = assets.every((a) => currentKeys.has(assetKey(a)))

    if (allChosen) {
      updateSlotState(activeSlotKey, {
        selected: activeState.selected.filter((a) => !skuKeys.has(assetKey(a))),
      })
    } else {
      const needed = assets.filter((a) => !currentKeys.has(assetKey(a)))
      const canTake = needed.slice(0, remaining).map((a) => ({ ...a, slot: activeSlotKey }))
      updateSlotState(activeSlotKey, {
        selected: [...activeState.selected, ...canTake],
      })
    }
  }

  const addFilesToActiveSlot = (files: FileList | File[]) => {
    const validFiles = Array.from(files).filter((f) => ACCEPTED_UPLOAD_TYPES.includes(f.type))
    if (validFiles.length === 0) return
    const canTakeCount = Math.max(0, remaining)
    const toAdd = validFiles.slice(0, canTakeCount).map((file) => ({
      id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      slot: activeSlotKey,
    }))
    updateSlotState(activeSlotKey, {
      uploads: [...activeState.uploads, ...toAdd],
    })
  }

  const removeUploadFromActiveSlot = (id: string) => {
    const target = activeState.uploads.find((u) => u.id === id)
    if (target) URL.revokeObjectURL(target.previewUrl)
    updateSlotState(activeSlotKey, {
      uploads: activeState.uploads.filter((u) => u.id !== id),
    })
  }

  const clearSlotAssets = (slotKey: string) => {
    const st = slotStates[slotKey]
    if (st) {
      st.uploads.forEach((u) => URL.revokeObjectURL(u.previewUrl))
      updateSlotState(slotKey, { selected: [], uploads: [] })
    }
  }

  const toggleTarget = (id: string) => {
    setTargetIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const canSubmit = totalSelected > 0 && !submitting

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setSubmitError(null)

    lastModel = model
    lastResolution = resolution

    const gatheredAssets = PRESET_SLOTS.flatMap((s) => slotStates[s.key]?.selected || [])
    const gatheredUploads = PRESET_SLOTS.flatMap((s) => (slotStates[s.key]?.uploads || []).map((u) => u.file))
    const gatheredUploadSlots = PRESET_SLOTS.flatMap((s) => (slotStates[s.key]?.uploads || []).map((u) => u.slot))
    const targetSlotsList = configuredSlots.map((s) => s.key)

    try {
      await onSubmit({
        sourceUrl: image.url,
        sourceName: image.name,
        assets: gatheredAssets,
        uploads: gatheredUploads,
        uploadSlots: gatheredUploadSlots,
        analysis: analysis.status === 'done' ? analysis.data : null,
        targetGarmentIds: analysis.status === 'done' ? targetIds : [],
        targetSlots: targetSlotsList,
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
    activeState.searchResult?.items.forEach((it) =>
      it.assets.forEach((a) => map.set(a.asset_type, a.type_label))
    )
    return Array.from(map.entries())
  }, [activeState.searchResult])

  return (
    <div
      data-modal="outfit-change"
      style={styles.backdrop}
      onMouseDown={(e) => {
        e.stopPropagation()
        if (e.target === e.currentTarget && !submitting) onClose()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <div style={styles.dialog} onMouseDown={(e) => e.stopPropagation()}>
        {/* ── 顶部 Header ── */}
        <div style={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={styles.headerIcon}>
              <Shirt size={17} strokeWidth={2.2} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#09090b', letterSpacing: '-0.01em' }}>
                AI 虚拟换装 · Virtual Try-On
              </div>
              <div style={{ fontSize: 12, color: '#71717a', marginTop: 1 }}>
                点击人体部位或标签选择更替 · 检索商品多角度素材 · 智能自然融合
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={styles.iconButton}
            title="关闭 (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── 主体分栏 ── */}
        <div style={styles.body}>
          {/* ── 左栏：人体线框模特 + 原图底图微缩卡片 (宽 320px) ── */}
          <div style={styles.leftCol}>
            {/* 1. 交互式人体线框模特 */}
            <div style={styles.mannequinCard}>
              <InteractiveMannequin
                activeSlot={activeSlotKey}
                configuredCounts={configuredCounts}
                onSelectSlot={(slotKey) => setActiveSlotKey(slotKey)}
                disabled={submitting}
              />
            </div>

            {/* 2. 原图底图微缩卡片 + VLM 辅助 */}
            <div style={styles.sourceCard}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                }}
              >
                {/* 紧凑原图预览（点击放大） */}
                <div
                  style={styles.sourceThumb}
                  onClick={() => setPreview(normalizeAssetUrl(image.url))}
                  title="点击查看原图大图"
                >
                  <img
                    src={normalizeAssetUrl(image.url)}
                    alt=""
                    style={styles.sourceThumbImg}
                    draggable={false}
                  />
                  <div style={styles.zoomHover}>
                    <ZoomIn size={12} color="#fff" />
                  </div>
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#09090b' }}>原图基准</span>
                    {analysis.status === 'done' && (
                      <span style={styles.typeBadge}>{analysis.data.image_type_label}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: '#71717a', lineHeight: 1.4 }}>
                    模特身姿与光影保持一致
                  </div>

                  {/* VLM 触发按钮 */}
                  {analysis.status === 'idle' && (
                    <button
                      type="button"
                      style={styles.vlmButton}
                      onClick={() => runAnalysis()}
                      title="AI 智能解析原图人物穿搭单品"
                    >
                      <Sparkles size={11} strokeWidth={2.5} />
                      <span>智能识别穿搭 (可选)</span>
                    </button>
                  )}

                  {analysis.status === 'loading' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#18181b', marginTop: 4 }}>
                      <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                      <span>正在识别…</span>
                    </div>
                  )}

                  {analysis.status === 'error' && (
                    <div style={{ fontSize: 11, color: '#71717a', marginTop: 4 }}>
                      识别跳过 · 不影响换装
                    </div>
                  )}
                </div>
              </div>

              {/* 识别出的单品胶囊（点击可联动切换模特部位） */}
              {analysis.status === 'done' && analysis.data.garments.length > 0 && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #f4f4f5', width: '100%' }}>
                  <div style={{ fontSize: 10, color: '#a1a1aa', marginBottom: 4 }}>
                    已识别穿搭（点击联动定位部位）：
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {analysis.data.garments.map((g) => {
                      const isLinked = g.slot === activeSlotKey
                      return (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => {
                            toggleTarget(g.id)
                            if (g.slot && PRESET_SLOTS.some((s) => s.key === g.slot)) {
                              setActiveSlotKey(g.slot)
                            }
                          }}
                          style={{
                            ...styles.garmentPill,
                            border: isLinked ? '1px solid #09090b' : '1px solid #e4e4e7',
                            backgroundColor: isLinked ? '#09090b' : '#fafafa',
                            color: isLinked ? '#ffffff' : '#27272a',
                          }}
                        >
                          <span>{g.slot_label}</span>
                          <span style={{ opacity: 0.75 }}>
                            {g.color}
                            {g.name}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── 右栏：当前激活部位的素材装配台 (Flex 弹性宽) ── */}
          <div style={styles.rightCol}>
            {/* 1. 当前部位标题与指引条 */}
            <div style={styles.slotHeaderBar}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16, fontWeight: 600, color: '#09090b' }}>
                    {activeSlot.label}
                  </span>
                  <span style={{ fontSize: 11, color: '#71717a', textTransform: 'uppercase' }}>
                    · {activeSlot.key}
                  </span>
                  {activeState.selected.length + activeState.uploads.length > 0 ? (
                    <span style={styles.configuredActiveBadge}>
                      已配置 {activeState.selected.length + activeState.uploads.length} 张素材
                    </span>
                  ) : (
                    <span style={styles.unconfiguredBadge}>未配置</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: '#71717a', marginTop: 2 }}>
                  {activeSlot.region ? `${activeSlot.region} · ${activeSlot.desc}` : activeSlot.desc}
                </div>
              </div>

              {/* 快速清除当前部位 */}
              {(activeState.selected.length > 0 || activeState.uploads.length > 0) && (
                <button
                  type="button"
                  onClick={() => clearSlotAssets(activeSlotKey)}
                  style={styles.clearSlotButton}
                  title="清除该部位已选素材"
                >
                  <Trash2 size={12} />
                  <span>清空该部位</span>
                </button>
              )}
            </div>

            {/* 2. 极简 SKU 检索输入条 + 本地上传按钮 */}
            <div style={styles.searchBarContainer}>
              <div style={styles.searchInputBox}>
                <Search size={14} color="#71717a" style={{ flexShrink: 0 }} />
                <input
                  ref={skuInputRef}
                  type="text"
                  value={activeState.skuInput}
                  onChange={(e) => updateSlotState(activeSlotKey, { skuInput: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleSearch()
                    }
                  }}
                  placeholder={`输入【${activeSlot.label}】商品货号 SKU（如 ABC-01），按回车检索`}
                  style={styles.searchInput}
                  disabled={activeState.searching}
                />
                {activeState.skuInput && (
                  <button
                    type="button"
                    onClick={() => {
                      updateSlotState(activeSlotKey, { skuInput: '', searchError: null })
                      skuInputRef.current?.focus()
                    }}
                    style={styles.clearSearchBtn}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={handleSearch}
                disabled={activeState.searching}
                style={styles.searchSubmitBtn}
              >
                {activeState.searching ? (
                  <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                ) : (
                  '检索'
                )}
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={styles.uploadBtn}
                title="上传本地图片作为当前部位素材"
              >
                <ImagePlus size={14} />
                <span>本地上传</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPTED_UPLOAD_TYPES.join(',')}
                onChange={(e) => {
                  if (e.target.files) addFilesToActiveSlot(e.target.files)
                  e.target.value = ''
                }}
                style={{ display: 'none' }}
              />
            </div>

            {/* 角度多分类筛选胶囊条 */}
            {availableTypes.length > 1 && (
              <div style={styles.filterPillsRow}>
                <button
                  type="button"
                  onClick={() => updateSlotState(activeSlotKey, { typeFilter: 'all' })}
                  style={{
                    ...styles.filterPill,
                    ...(activeState.typeFilter === 'all' ? styles.filterPillActive : null),
                  }}
                >
                  全部角度
                </button>
                {availableTypes.map(([typeKey, typeLabel]) => (
                  <button
                    key={typeKey}
                    type="button"
                    onClick={() => updateSlotState(activeSlotKey, { typeFilter: typeKey })}
                    style={{
                      ...styles.filterPill,
                      ...(activeState.typeFilter === typeKey ? styles.filterPillActive : null),
                    }}
                  >
                    {typeLabel}
                  </button>
                ))}
              </div>
            )}

            {/* 检索异常提醒 */}
            {activeState.searchError && (
              <div style={styles.errorNotice}>
                <AlertCircle size={13} style={{ flexShrink: 0 }} />
                <span>{activeState.searchError}</span>
              </div>
            )}

            {/* 3. 素材展示与勾选网格 */}
            <div
              style={{
                ...styles.assetArea,
                borderColor: isDragOver ? '#09090b' : '#e4e4e7',
                backgroundColor: isDragOver ? '#f4f4f5' : '#fafafa',
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
                if (e.dataTransfer.files?.length) addFilesToActiveSlot(e.dataTransfer.files)
              }}
            >
              {/* 本部位本地上传项 */}
              {activeState.uploads.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={styles.groupHeader}>
                    <span style={{ fontWeight: 600, color: '#09090b' }}>
                      【{activeSlot.label}】本地上传素材
                    </span>
                    <span style={{ color: '#71717a' }}>
                      {activeState.uploads.length} 张已应用
                    </span>
                  </div>
                  <div style={styles.grid}>
                    {activeState.uploads.map((u, idx) => (
                      <div key={u.id} style={{ ...styles.tile, ...styles.tileSelected }}>
                        <img src={u.previewUrl} alt="" style={styles.tileImg} draggable={false} />
                        <div style={styles.tileFooter}>
                          <span style={styles.tileAngle}>上传 {idx + 1}</span>
                          <span style={styles.tileType}>{activeSlot.label}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeUploadFromActiveSlot(u.id)}
                          style={styles.tileRemove}
                          title="移除图片"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 素材库检索结果列表 */}
              {activeState.searchResult?.items.map((group) => {
                const assets = group.assets.filter(
                  (a) => activeState.typeFilter === 'all' || a.asset_type === activeState.typeFilter
                )
                if (!group.found) {
                  return (
                    <div key={group.sku} style={{ marginBottom: 12 }}>
                      <div style={styles.groupHeader}>
                        <span style={{ fontWeight: 600, color: '#09090b' }}>{group.sku}</span>
                        <span style={{ color: '#ef4444' }}>未找到素材</span>
                      </div>
                    </div>
                  )
                }
                if (assets.length === 0) return null
                const allChosen = assets.every((a) => activeSelectedKeys.has(assetKey(a)))
                return (
                  <div key={group.sku} style={{ marginBottom: 14 }}>
                    <div style={styles.groupHeader}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontWeight: 600, color: '#09090b' }}>{group.sku}</span>
                        <span style={{ color: '#71717a' }}>({assets.length} 张多角度)</span>
                      </div>
                      <button
                        type="button"
                        style={styles.linkButton}
                        onClick={() => selectAllOfSku(assets)}
                      >
                        {allChosen ? '取消全选' : '全选此款'}
                      </button>
                    </div>
                    <div style={styles.grid}>
                      {assets.map((asset) => {
                        const isSelected = activeSelectedKeys.has(assetKey(asset))
                        const order = isSelected
                          ? activeState.selected.findIndex((a) => assetKey(a) === assetKey(asset))
                          : -1
                        return (
                          <div
                            key={assetKey(asset)}
                            role="checkbox"
                            aria-checked={isSelected}
                            tabIndex={0}
                            onClick={() => toggleAsset(asset)}
                            title={`${asset.filename}（${asset.type_label}）`}
                            style={{
                              ...styles.tile,
                              ...(isSelected ? styles.tileSelected : null),
                              opacity: !isSelected && remaining <= 0 ? 0.45 : 1,
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
                                backgroundColor: isSelected ? '#09090b' : 'rgba(255,255,255,0.92)',
                                border: isSelected ? '1px solid #09090b' : '1px solid #d4d4d8',
                              }}
                            >
                              {isSelected && (
                                <span style={{ fontSize: 10, fontWeight: 700, color: '#fff' }}>
                                  {order + 1}
                                </span>
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

              {/* 空状态指引 */}
              {!activeState.searchResult && activeState.uploads.length === 0 && (
                <div style={styles.emptyState}>
                  <div style={styles.emptyIconBox}>
                    <Shirt size={24} strokeWidth={1.5} color="#71717a" />
                  </div>
                  <div style={{ fontSize: 13, color: '#18181b', fontWeight: 600 }}>
                    输入【{activeSlot.label}】货号检索，或拖拽图片到此处
                  </div>
                  <div style={{ fontSize: 12, color: '#71717a', maxWidth: 360, lineHeight: 1.6 }}>
                    推荐勾选 2–4 个角度（正面、侧面或细节），让生成模型精准还原版型。
                  </div>
                </div>
              )}
            </div>

            {/* 4. 已配置部位快捷托盘 */}
            {configuredSlots.length > 0 && (
              <div style={styles.configuredBar}>
                <span style={{ fontSize: 11, color: '#71717a', fontWeight: 500 }}>已配部位：</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {configuredSlots.map((s) => {
                    const st = slotStates[s.key]
                    const count = (st?.selected.length || 0) + (st?.uploads.length || 0)
                    const isCur = s.key === activeSlotKey
                    return (
                      <div
                        key={s.key}
                        onClick={() => setActiveSlotKey(s.key)}
                        style={{
                          ...styles.configuredPill,
                          border: isCur ? '1px solid #09090b' : '1px solid #e4e4e7',
                          backgroundColor: isCur ? '#09090b' : '#ffffff',
                          color: isCur ? '#ffffff' : '#18181b',
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>{s.label}</span>
                        <span style={{ opacity: isCur ? 0.75 : 0.6 }}>({count}张)</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            clearSlotAssets(s.key)
                          }}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            color: isCur ? '#ffffff' : '#71717a',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            padding: 0,
                            marginLeft: 2,
                          }}
                          title="移除该部位"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── 底部控制栏 ── */}
        <div style={styles.footer}>
          {/* 左侧：已选资产统计与生成设置抽屉开关 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ fontSize: 12, color: '#52525b' }}>
              {totalSelected > 0 ? (
                <>
                  已选 <strong style={{ color: '#09090b' }}>{totalSelected}</strong> / {maxRefs} 张参考图 ·{' '}
                  <strong style={{ color: '#09090b' }}>{configuredSlots.length}</strong> 个部位
                </>
              ) : (
                '请在上方选择部位并添加素材图'
              )}
            </div>

            {/* 生成设置切换按钮 */}
            <button
              type="button"
              onClick={() => setShowSettings((v) => !v)}
              style={styles.settingsToggle}
            >
              <SlidersHorizontal size={13} />
              <span>
                {MODEL_OPTIONS.find((m) => m.key === model)?.label} · {resolution}
                {batchCount > 1 ? ` · 出 ${batchCount} 张` : ''}
              </span>
              {showSettings ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          </div>

          {/* 右侧：操作按钮 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {submitError && (
              <span style={{ fontSize: 11, color: '#ef4444', marginRight: 4 }}>
                {submitError}
              </span>
            )}
            <button type="button" onClick={onClose} disabled={submitting} style={styles.cancelBtn}>
              取消
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              style={{
                ...styles.primaryBtn,
                opacity: canSubmit ? 1 : 0.45,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
              }}
            >
              {submitting ? (
                <>
                  <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                  <span>提交中…</span>
                </>
              ) : (
                <>
                  <Sparkles size={13} />
                  <span>
                    {totalSelected === 0
                      ? '请选择部位添加素材'
                      : `开始换装 (${totalSelected}张 · ${configuredSlots.length}部位)`}
                  </span>
                  {canSubmit && <ArrowRight size={13} />}
                </>
              )}
            </button>
          </div>
        </div>

        {/* ── 高级设置浮层抽屉 ── */}
        {showSettings && (
          <div style={styles.settingsPopover}>
            <div style={styles.settingRow}>
              <span style={styles.settingLabel}>生图模型</span>
              <div style={styles.segment}>
                {MODEL_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    title={opt.desc}
                    onClick={() => setModel(opt.key)}
                    style={{
                      ...styles.segmentItem,
                      ...(model === opt.key ? styles.segmentActive : null),
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={styles.settingRow}>
              <span style={styles.settingLabel}>分辨率</span>
              <div style={styles.segment}>
                {(['1K', '2K'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setResolution(r)}
                    style={{
                      ...styles.segmentItem,
                      ...(resolution === r ? styles.segmentActive : null),
                    }}
                  >
                    {r}
                  </button>
                ))}
              </div>

              <span style={{ ...styles.settingLabel, marginLeft: 16 }}>批次数量</span>
              <div style={styles.segment}>
                {[1, 2, 4].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setBatchCount(n)}
                    style={{
                      ...styles.segmentItem,
                      ...(batchCount === n ? styles.segmentActive : null),
                    }}
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
              placeholder="补充指令（可选），如：上衣下摆自然塞入腰际、袖口微挽、保持自然摄影光影"
              style={styles.textarea}
            />
          </div>
        )}

        {/* ── 大图灯箱 ── */}
        {preview && (
          <div style={styles.lightbox} onClick={() => setPreview(null)}>
            <div style={styles.lightboxBox} onClick={(e) => e.stopPropagation()}>
              <img src={preview} alt="" style={styles.lightboxImg} />
              <button
                type="button"
                onClick={() => setPreview(null)}
                style={styles.lightboxClose}
              >
                <X size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(9, 9, 11, 0.45)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    padding: 16,
    userSelect: 'none',
  },
  dialog: {
    position: 'relative',
    width: 'min(1160px, 96vw)',
    height: 'min(860px, 92vh)',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    boxShadow: '0 24px 60px rgba(9, 9, 11, 0.16), 0 4px 16px rgba(9, 9, 11, 0.06)',
    border: '1px solid #e4e4e7',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    height: 58,
    padding: '0 20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottom: '1px solid #f4f4f5',
    flexShrink: 0,
  },
  headerIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#f4f4f5',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#09090b',
  },
  iconButton: {
    width: 30,
    height: 30,
    borderRadius: 6,
    border: 'none',
    backgroundColor: 'transparent',
    color: '#71717a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'background 0.15s ease, color 0.15s ease',
  },
  body: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    overflow: 'hidden',
  },
  leftCol: {
    width: 320,
    borderRight: '1px solid #f4f4f5',
    backgroundColor: '#fcfcfc',
    padding: '16px 16px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    overflowY: 'auto',
    flexShrink: 0,
  },
  mannequinCard: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  sourceCard: {
    padding: '10px 12px',
    borderRadius: 10,
    backgroundColor: '#ffffff',
    border: '1px solid #e4e4e7',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  sourceThumb: {
    position: 'relative',
    width: 54,
    height: 70,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: '#f4f4f5',
    border: '1px solid #e4e4e7',
    cursor: 'pointer',
    flexShrink: 0,
  },
  sourceThumbImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  zoomHover: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(9, 9, 11, 0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0,
    transition: 'opacity 0.15s ease',
  },
  typeBadge: {
    fontSize: 10,
    fontWeight: 600,
    padding: '1px 6px',
    borderRadius: 999,
    backgroundColor: '#f4f4f5',
    color: '#18181b',
  },
  vlmButton: {
    marginTop: 6,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '3px 8px',
    borderRadius: 6,
    border: '1px solid #e4e4e7',
    backgroundColor: '#ffffff',
    color: '#18181b',
    fontSize: 11,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  garmentPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 7px',
    borderRadius: 4,
    border: '1px solid #e4e4e7',
    fontSize: 10,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  rightCol: {
    flex: 1,
    minWidth: 0,
    padding: '16px 20px',
    display: 'flex',
    flexDirection: 'column',
    overflowY: 'auto',
    backgroundColor: '#ffffff',
  },
  slotHeaderBar: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottom: '1px solid #f4f4f5',
    marginBottom: 12,
  },
  configuredActiveBadge: {
    fontSize: 11,
    fontWeight: 600,
    padding: '2px 7px',
    borderRadius: 999,
    backgroundColor: '#f4f4f5',
    color: '#09090b',
  },
  unconfiguredBadge: {
    fontSize: 11,
    color: '#a1a1aa',
  },
  clearSlotButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 11,
    color: '#71717a',
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: '2px 6px',
    borderRadius: 4,
  },
  searchBarContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  searchInputBox: {
    flex: 1,
    height: 36,
    borderRadius: 8,
    border: '1px solid #e4e4e7',
    backgroundColor: '#ffffff',
    padding: '0 10px',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    transition: 'border-color 0.15s ease',
  },
  searchInput: {
    flex: 1,
    border: 'none',
    outline: 'none',
    backgroundColor: 'transparent',
    fontSize: 12,
    color: '#09090b',
  },
  clearSearchBtn: {
    border: 'none',
    background: 'transparent',
    color: '#a1a1aa',
    cursor: 'pointer',
    padding: 2,
    display: 'flex',
  },
  searchSubmitBtn: {
    height: 36,
    padding: '0 14px',
    borderRadius: 8,
    border: 'none',
    backgroundColor: '#09090b',
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadBtn: {
    height: 36,
    padding: '0 12px',
    borderRadius: 8,
    border: '1px solid #e4e4e7',
    backgroundColor: '#ffffff',
    color: '#18181b',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 5,
  },
  filterPillsRow: {
    display: 'flex',
    gap: 6,
    marginBottom: 10,
  },
  filterPill: {
    padding: '3px 9px',
    borderRadius: 999,
    border: '1px solid #e4e4e7',
    backgroundColor: '#ffffff',
    color: '#71717a',
    fontSize: 11,
    cursor: 'pointer',
  },
  filterPillActive: {
    backgroundColor: '#09090b',
    border: '1px solid #09090b',
    color: '#ffffff',
    fontWeight: 500,
  },
  errorNotice: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 10px',
    borderRadius: 6,
    backgroundColor: '#fef2f2',
    border: '1px solid #fee2e2',
    color: '#b91c1c',
    fontSize: 11,
    marginBottom: 10,
  },
  assetArea: {
    flex: 1,
    minHeight: 280,
    borderRadius: 10,
    border: '1px dashed #e4e4e7',
    padding: 12,
    overflowY: 'auto',
    transition: 'all 0.15s ease',
  },
  groupHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: 12,
    marginBottom: 8,
  },
  linkButton: {
    border: 'none',
    background: 'transparent',
    color: '#09090b',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    padding: 0,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
    gap: 8,
  },
  tile: {
    position: 'relative',
    aspectRatio: '1',
    borderRadius: 8,
    border: '1px solid #e4e4e7',
    backgroundColor: '#ffffff',
    overflow: 'hidden',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  tileSelected: {
    border: '1.5px solid #09090b',
    boxShadow: '0 0 0 1px #09090b',
  },
  tileImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  tileFooter: {
    position: 'absolute',
    bottom: 0,
    insetInline: 0,
    padding: '4px 6px',
    background: 'linear-gradient(to top, rgba(9, 9, 11, 0.75) 0%, transparent 100%)',
    display: 'flex',
    justifyContent: 'space-between',
    color: '#ffffff',
    fontSize: 10,
  },
  tileAngle: {
    fontWeight: 500,
  },
  tileType: {
    opacity: 0.8,
  },
  checkbox: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 18,
    height: 18,
    borderRadius: 4,
    border: '1px solid #d4d4d8',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileZoom: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.9)',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    opacity: 0,
    transition: 'opacity 0.15s ease',
  },
  tileRemove: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: 4,
    backgroundColor: '#09090b',
    color: '#ffffff',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  emptyState: {
    height: '100%',
    minHeight: 240,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    gap: 6,
  },
  emptyIconBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#ffffff',
    border: '1px solid #e4e4e7',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  configuredBar: {
    marginTop: 10,
    paddingTop: 8,
    borderTop: '1px solid #f4f4f5',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  configuredPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 8px',
    borderRadius: 6,
    border: '1px solid #e4e4e7',
    fontSize: 11,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  footer: {
    height: 56,
    padding: '0 20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTop: '1px solid #f4f4f5',
    backgroundColor: '#ffffff',
    flexShrink: 0,
  },
  settingsToggle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 8px',
    borderRadius: 6,
    border: '1px solid #e4e4e7',
    backgroundColor: '#ffffff',
    color: '#18181b',
    fontSize: 11,
    cursor: 'pointer',
  },
  cancelBtn: {
    height: 34,
    padding: '0 14px',
    borderRadius: 8,
    border: '1px solid #e4e4e7',
    backgroundColor: '#ffffff',
    color: '#18181b',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
  },
  primaryBtn: {
    height: 34,
    padding: '0 16px',
    borderRadius: 8,
    border: 'none',
    backgroundColor: '#09090b',
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 500,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  settingsPopover: {
    position: 'absolute',
    bottom: 60,
    left: 20,
    width: 440,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    border: '1px solid #e4e4e7',
    boxShadow: '0 12px 30px rgba(9, 9, 11, 0.12)',
    padding: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    zIndex: 20,
  },
  settingRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  settingLabel: {
    fontSize: 11,
    color: '#71717a',
    width: 52,
  },
  segment: {
    display: 'inline-flex',
    borderRadius: 6,
    border: '1px solid #e4e4e7',
    padding: 2,
    backgroundColor: '#f4f4f5',
  },
  segmentItem: {
    padding: '3px 9px',
    borderRadius: 4,
    border: 'none',
    backgroundColor: 'transparent',
    color: '#71717a',
    fontSize: 11,
    fontWeight: 500,
    cursor: 'pointer',
  },
  segmentActive: {
    backgroundColor: '#ffffff',
    color: '#09090b',
    boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
  },
  textarea: {
    width: '100%',
    borderRadius: 6,
    border: '1px solid #e4e4e7',
    padding: '6px 8px',
    fontSize: 11,
    outline: 'none',
    resize: 'none',
    fontFamily: 'inherit',
    color: '#09090b',
  },
  lightbox: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(9, 9, 11, 0.8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
  },
  lightboxBox: {
    position: 'relative',
    maxWidth: '90vw',
    maxHeight: '90vh',
  },
  lightboxImg: {
    maxWidth: '85vw',
    maxHeight: '85vh',
    objectFit: 'contain',
    borderRadius: 8,
  },
  lightboxClose: {
    position: 'absolute',
    top: -36,
    right: 0,
    color: '#ffffff',
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
  },
}

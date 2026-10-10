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
  type PresetSlotInfo,
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

const SLOT_ICONS: Record<string, string> = {
  top: '👕',
  bottom: '👖',
  shoes: '👟',
  hat: '🧢',
  outerwear: '🧥',
  dress: '👗',
  bag: '👜',
  accessory: '✨',
}

// 记住全局模型配置
let lastModel: OutfitChangeRequest['model'] = 'gpt-image-2.5'
let lastResolution: OutfitChangeRequest['resolution'] = '1K'

const MODEL_OPTIONS: { key: OutfitChangeRequest['model']; label: string; desc: string }[] = [
  { key: 'gpt-image-2.5', label: 'GPT Image 2.5', desc: '中文理解强，智能路由' },
  { key: 'nano-banana-pro', label: 'Nano Banana Pro', desc: '编辑一致性高' },
]

export const OutfitChangeModal: React.FC<Props> = ({ image, onClose, onSubmit }) => {
  // ── 1. VLM 识别状态（默认 idle，用户自主点击触发） ──
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
  const [showAdvanced, setShowAdvanced] = useState(false)

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
          // 若有识别出的部位，默认全部高亮选中
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
      else if (!submitting) onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [preview, submitting, onClose])

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
      // 保留当前部位已选择项中仍然有效的
      const newAssetKeys = new Set(result.items.flatMap((it) => it.assets.map((a) => a.id + '|' + a.sku)))
      const preservedSelected = activeState.selected.filter((a) => newAssetKeys.has(a.id + '|' + a.sku))

      let errorMsg: string | null = null
      if (!result.library_exists) {
        errorMsg = '当前服务器未挂载素材库，可点击「本地上传」添加素材图'
      } else if (!result.items.some((it) => it.found)) {
        errorMsg = `素材库中未找到货号素材图，请检查货号或使用本地上传`
      }

      updateSlotState(activeSlotKey, {
        searchResult: result,
        typeFilter: 'all',
        selected: preservedSelected,
        searchError: errorMsg,
      })
    } catch (err: any) {
      updateSlotState(activeSlotKey, { searchError: err?.message || '检索失败' })
    } finally {
      updateSlotState(activeSlotKey, { searching: false })
    }
  }

  // 素材选中状态
  const assetKey = (a: OutfitAsset) => `${a.sku}|${a.id}`
  const activeSelectedKeys = useMemo(
    () => new Set(activeState.selected.map(assetKey)),
    [activeState.selected]
  )

  const toggleAsset = (asset: OutfitAsset) => {
    const key = assetKey(asset)
    if (activeSelectedKeys.has(key)) {
      updateSlotState(activeSlotKey, {
        selected: activeState.selected.filter((a) => assetKey(a) !== key),
      })
      return
    }
    if (remaining <= 0) {
      setSubmitError(`最多选择 ${maxRefs} 张素材（含原图共 9 张参考图）`)
      return
    }
    setSubmitError(null)
    // 标记该资产属于当前部位
    const assetWithSlot: OutfitAsset = { ...asset, slot: activeSlotKey }
    updateSlotState(activeSlotKey, {
      selected: [...activeState.selected, assetWithSlot],
    })
  }

  const selectAllOfSku = (assets: OutfitAsset[]) => {
    const toAdd = assets.filter((a) => !activeSelectedKeys.has(assetKey(a)))
    if (toAdd.length === 0) {
      const keys = new Set(assets.map(assetKey))
      updateSlotState(activeSlotKey, {
        selected: activeState.selected.filter((a) => !keys.has(assetKey(a))),
      })
      return
    }
    const allowed = toAdd.slice(0, Math.max(0, remaining))
    if (allowed.length < toAdd.length) {
      setSubmitError(`已达上限，仅添加了 ${allowed.length} 张（最多 ${maxRefs} 张）`)
    }
    const assetsWithSlot = allowed.map((a) => ({ ...a, slot: activeSlotKey }))
    updateSlotState(activeSlotKey, {
      selected: [...activeState.selected, ...assetsWithSlot],
    })
  }

  // 本地上传兜底（归属于当前部位）
  const addFilesToActiveSlot = (files: FileList | File[]) => {
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
    const newItems: UploadItem[] = allowed.map((file) => ({
      id: 'up-' + Math.random().toString(36).slice(2, 10),
      file,
      previewUrl: URL.createObjectURL(file),
      slot: activeSlotKey,
    }))
    updateSlotState(activeSlotKey, {
      uploads: [...activeState.uploads, ...newItems],
    })
  }

  const removeUploadFromActiveSlot = (id: string) => {
    const hit = activeState.uploads.find((u) => u.id === id)
    if (hit) URL.revokeObjectURL(hit.previewUrl)
    updateSlotState(activeSlotKey, {
      uploads: activeState.uploads.filter((u) => u.id !== id),
    })
  }

  const clearActiveSlot = () => {
    activeState.uploads.forEach((u) => URL.revokeObjectURL(u.previewUrl))
    updateSlotState(activeSlotKey, {
      selected: [],
      uploads: [],
      searchResult: null,
      searchError: null,
      skuInput: '',
    })
  }

  const toggleTarget = (id: string) => {
    setTargetIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  // ── 提交换装 ──
  const canSubmit = totalSelected > 0 && !submitting

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setSubmitError(null)
    lastModel = model
    lastResolution = resolution

    // 收集所有部位的素材与上传图片
    const targetSlotsList: string[] = []
    const gatheredAssets: OutfitAsset[] = []
    const gatheredUploads: File[] = []
    const gatheredUploadSlots: string[] = []

    PRESET_SLOTS.forEach((slot) => {
      const st = slotStates[slot.key]
      if (!st) return
      const hasAssets = st.selected.length > 0
      const hasUploads = st.uploads.length > 0
      if (hasAssets || hasUploads) {
        targetSlotsList.push(slot.key)
        st.selected.forEach((a) => gatheredAssets.push({ ...a, slot: slot.key }))
        st.uploads.forEach((u) => {
          gatheredUploads.push(u.file)
          gatheredUploadSlots.push(slot.key)
        })
      }
    })

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

  const submitLabel =
    totalSelected === 0
      ? '请在上方选择部位并勾选素材'
      : `开始换装（${totalSelected} 张素材 · ${configuredSlots.length} 个部位${
          batchCount > 1 ? ` · 出 ${batchCount} 张` : ''
        }）`

  return (
    <div
      data-modal="outfit-change"
      style={styles.backdrop}
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
              <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>AI 虚拟换装</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>
                选择换装部位（如上衣、下装、鞋子）→ 输入货号添加素材图 → 提交生成，结果自动插入画布原图右侧
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

        <div style={styles.body}>
          {/* ── 左栏：原图 + 可选 VLM 分析 ── */}
          <div style={styles.leftCol}>
            <div style={styles.sectionLabel}>原图底图</div>
            <div style={styles.sourceBox} onClick={() => setPreview(normalizeAssetUrl(image.url))}>
              <img src={normalizeAssetUrl(image.url)} alt="" style={styles.sourceImg} draggable={false} />
            </div>

            <div
              style={{
                ...styles.sectionLabel,
                marginTop: 14,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>原图服饰识别（可选）</span>
              {analysis.status === 'done' && (
                <span style={styles.typeBadge}>{analysis.data.image_type_label}</span>
              )}
            </div>

            {/* VLM 初始状态：展示触发按钮，不自动执行 */}
            {analysis.status === 'idle' && (
              <div style={styles.analysisBox}>
                <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
                  AI 智能分析原图已穿服饰，可辅助精准替换。无需识别也可直接在右侧选部位换装。
                </div>
                <button
                  type="button"
                  style={styles.vlmTriggerButton}
                  onClick={() => runAnalysis()}
                  title="点击启动视觉大模型解析图中穿搭"
                >
                  <Sparkles size={13} color="#4338ca" />
                  <span>智能识别原图服饰</span>
                </button>
              </div>
            )}

            {/* VLM 正在加载：不阻塞右侧操作与提交 */}
            {analysis.status === 'loading' && (
              <div style={styles.analysisBox}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#4338ca', fontSize: 12, fontWeight: 500 }}>
                  <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                  <span>正在识别图中服饰…</span>
                </div>
                {[72, 54, 64].map((w, i) => (
                  <div key={i} style={{ ...styles.skeleton, width: `${w}%` }} />
                ))}
                <div style={{ fontSize: 11, color: '#94a3b8' }}>
                  分析中不影响在右侧继续勾选素材与提交
                </div>
              </div>
            )}

            {/* VLM 失败：友好提示 */}
            {analysis.status === 'error' && (
              <div style={{ ...styles.analysisBox, borderColor: '#fde68a', backgroundColor: '#fffbeb' }}>
                <div style={{ display: 'flex', gap: 6, fontSize: 12, color: '#92400e', lineHeight: 1.5 }}>
                  <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                  <span>识别未成功：{analysis.error}。不影响正常换装，系统将按您选择的部位精准替换。</span>
                </div>
                <button type="button" style={styles.linkButton} onClick={() => runAnalysis()}>
                  <RefreshCw size={12} /> 重新识别
                </button>
              </div>
            )}

            {/* VLM 完成：展示穿搭摘要与单品胶囊 */}
            {analysis.status === 'done' && (
              <div style={styles.analysisBox}>
                {analysis.data.summary && (
                  <div style={{ fontSize: 12, color: '#334155', lineHeight: 1.5 }}>
                    {analysis.data.summary}
                  </div>
                )}
                {analysis.data.garments.length > 0 ? (
                  <>
                    <div style={{ fontSize: 11, color: '#64748b' }}>
                      识别到的单品（点击定位对应部位）：
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {analysis.data.garments.map((g) => {
                        const active = targetIds.includes(g.id)
                        return (
                          <button
                            key={g.id}
                            type="button"
                            onClick={() => {
                              toggleTarget(g.id)
                              // 自动切换到对应部位 Tab
                              if (g.slot && PRESET_SLOTS.some((s) => s.key === g.slot)) {
                                setActiveSlotKey(g.slot)
                              }
                            }}
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
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    已完成识别，将按右侧选定的部位精准替换。
                  </div>
                )}
                <button type="button" style={styles.linkButton} onClick={() => runAnalysis()}>
                  <RefreshCw size={11} /> 重新识别
                </button>
              </div>
            )}
          </div>

          {/* ── 右栏：部位驱动导航与素材选择 ── */}
          <div style={styles.rightCol}>
            {/* 1. 部位选择 Tabs 导航 */}
            <div>
              <div style={{ ...styles.sectionLabel, display: 'flex', justifyContent: 'space-between' }}>
                <span>选择替换部位</span>
                <span style={{ fontWeight: 500, color: remaining <= 0 ? '#ef4444' : '#64748b' }}>
                  已选 {totalSelected} / {maxRefs} 张参考图
                </span>
              </div>
              <div style={styles.slotTabsContainer}>
                {PRESET_SLOTS.map((slot) => {
                  const isActive = slot.key === activeSlotKey
                  const st = slotStates[slot.key]
                  const count = (st?.selected.length || 0) + (st?.uploads.length || 0)
                  const icon = SLOT_ICONS[slot.key] || '👕'
                  return (
                    <button
                      key={slot.key}
                      type="button"
                      onClick={() => setActiveSlotKey(slot.key)}
                      style={{
                        ...styles.slotTab,
                        ...(isActive ? styles.slotTabActive : null),
                      }}
                    >
                      <span style={{ fontSize: 14 }}>{icon}</span>
                      <span style={{ fontWeight: isActive ? 600 : 500 }}>{slot.label}</span>
                      {count > 0 && (
                        <span
                          style={{
                            ...styles.slotCountBadge,
                            backgroundColor: isActive ? '#ffffff' : '#0f172a',
                            color: isActive ? '#0f172a' : '#ffffff',
                          }}
                        >
                          {count}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 2. 当前部位操作指示与检索栏 */}
            <div style={styles.activeSlotHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 16 }}>{SLOT_ICONS[activeSlot.key] || '👕'}</span>
                <span style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>
                  当前部位：【{activeSlot.label}】
                </span>
                <span style={{ fontSize: 12, color: '#64748b' }}>（{activeSlot.region || activeSlot.desc}）</span>
              </div>
              {(activeState.selected.length > 0 || activeState.uploads.length > 0) && (
                <button
                  type="button"
                  onClick={clearActiveSlot}
                  style={styles.clearSlotButton}
                  title="清空当前部位已选素材"
                >
                  <Trash2 size={12} /> 清空本部位素材
                </button>
              )}
            </div>

            {/* SKU 检索与上传输入行 */}
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={styles.searchBox}>
                <Search size={14} color="#94a3b8" />
                <input
                  ref={skuInputRef}
                  value={activeState.skuInput}
                  onChange={(e) => updateSlotState(activeSlotKey, { skuInput: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleSearch()
                    }
                  }}
                  placeholder={`输入【${activeSlot.label}】货号 SKU，按回车检索素材库`}
                  style={styles.searchInput}
                />
              </div>
              <button
                type="button"
                onClick={handleSearch}
                disabled={activeState.searching}
                style={{ ...styles.secondaryButton, minWidth: 72 }}
              >
                {activeState.searching ? (
                  <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                ) : (
                  '检索素材'
                )}
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={styles.secondaryButton}
                title={`为【${activeSlot.label}】上传本地商品图片`}
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
                  if (e.target.files) addFilesToActiveSlot(e.target.files)
                  e.target.value = ''
                }}
              />
            </div>

            {/* 角度/品类筛选器 */}
            {availableTypes.length > 1 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[['all', '全部角度'] as [string, string], ...availableTypes].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => updateSlotState(activeSlotKey, { typeFilter: key })}
                    style={{
                      ...styles.filterChip,
                      backgroundColor: activeState.typeFilter === key ? '#0f172a' : '#f1f5f9',
                      color: activeState.typeFilter === key ? '#ffffff' : '#475569',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {/* 检索异常提醒 */}
            {activeState.searchError && (
              <div style={styles.infoBar}>
                <AlertCircle size={14} style={{ flexShrink: 0 }} />
                <span>{activeState.searchError}</span>
              </div>
            )}

            {/* 3. 素材展示与勾选网格 */}
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
                if (e.dataTransfer.files?.length) addFilesToActiveSlot(e.dataTransfer.files)
              }}
            >
              {/* 本部位本地上传项 */}
              {activeState.uploads.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={styles.groupHeader}>
                    <span style={{ fontWeight: 600, color: '#0f172a' }}>
                      【{activeSlot.label}】本地上传素材
                    </span>
                    <span style={{ color: '#94a3b8' }}>
                      {activeState.uploads.length} 张 · 已全部应用
                    </span>
                  </div>
                  <div style={styles.grid}>
                    {activeState.uploads.map((u, idx) => (
                      <div key={u.id} style={{ ...styles.tile, ...styles.tileSelected }}>
                        <img src={u.previewUrl} alt="" style={styles.tileImg} draggable={false} />
                        <div style={styles.tileFooter}>
                          <span style={styles.tileAngle}>上传图片 {idx + 1}</span>
                          <span style={styles.tileType}>{activeSlot.label}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeUploadFromActiveSlot(u.id)}
                          style={styles.tileRemove}
                          title="移除此图片"
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
                        <span style={{ fontWeight: 600, color: '#0f172a' }}>{group.sku}</span>
                        <span style={{ color: '#ef4444' }}>未找到素材</span>
                      </div>
                    </div>
                  )
                }
                if (assets.length === 0) return null
                const allChosen = assets.every((a) => activeSelectedKeys.has(assetKey(a)))
                return (
                  <div key={group.sku} style={{ marginBottom: 12 }}>
                    <div style={styles.groupHeader}>
                      <span style={{ fontWeight: 600, color: '#0f172a' }}>{group.sku}</span>
                      <span style={{ color: '#94a3b8' }}>{assets.length} 张多角度素材</span>
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

              {!activeState.searchResult && activeState.uploads.length === 0 && (
                <div style={styles.emptyState}>
                  <div style={{ fontSize: 32, marginBottom: 4 }}>
                    {SLOT_ICONS[activeSlot.key] || '👕'}
                  </div>
                  <div style={{ fontSize: 13, color: '#334155', fontWeight: 600 }}>
                    输入【{activeSlot.label}】货号 SKU，检索多角度商品图
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', maxWidth: 360, lineHeight: 1.6 }}>
                    建议勾选 2–4 个角度（正面、侧面或细节），让模型精准还原款式。选好后可切换上方其他部位（如裤子、鞋子）继续配置。
                  </div>
                </div>
              )}
            </div>

            {/* 4. 已配置部位汇总微标签 */}
            {configuredSlots.length > 0 && (
              <div style={styles.configuredSummaryBar}>
                <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>已配置部位：</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {configuredSlots.map((s) => {
                    const st = slotStates[s.key]
                    const count = (st?.selected.length || 0) + (st?.uploads.length || 0)
                    const isCur = s.key === activeSlotKey
                    return (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => setActiveSlotKey(s.key)}
                        style={{
                          ...styles.configuredSlotChip,
                          borderColor: isCur ? '#0f172a' : '#cbd5e1',
                          backgroundColor: isCur ? '#f1f5f9' : '#ffffff',
                        }}
                      >
                        <span>{SLOT_ICONS[s.key] || '👕'}</span>
                        <span style={{ fontWeight: 600 }}>{s.label}</span>
                        <span style={{ color: '#2563eb' }}>({count}张)</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* 5. 高级生成设置 */}
            <button
              type="button"
              style={styles.advancedToggle}
              onClick={() => setShowAdvanced((v) => !v)}
            >
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
                  <span style={styles.settingLabel}>清晰度</span>
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
                  <span style={styles.settingLabel}>出图数</span>
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
                  placeholder="补充要求（可选），如：上衣下摆塞进裤腰、袖子稍微挽起、保持自然站立光影"
                  style={styles.textarea}
                />
              </div>
            )}
          </div>
        </div>

        {/* 底部提交栏 */}
        <div style={styles.footer}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {submitError ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#ef4444' }}>
                <AlertCircle size={13} style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {submitError}
                </span>
              </div>
            ) : totalSelected > 0 ? (
              <div style={{ fontSize: 12, color: '#475569' }}>
                已配置 <strong style={{ color: '#0f172a' }}>{configuredSlots.length}</strong> 个部位，共{' '}
                <strong style={{ color: '#0f172a' }}>{totalSelected}</strong> 张素材图（未选部位保持原图不变）
              </div>
            ) : (
              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                请在上方选择要替换的部位并添加素材图
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
                <span>正在提交换装任务…</span>
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

      {/* 大图预览灯箱 */}
      {preview && (
        <div style={styles.lightbox} onMouseDown={() => setPreview(null)}>
          <img
            src={preview}
            alt=""
            style={{ maxWidth: '86vw', maxHeight: '86vh', borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.45)' }}
          />
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
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    animation: 'fadeIn 150ms ease-out',
  },
  dialog: {
    width: 'min(980px, calc(100vw - 32px))',
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
  },
  sourceBox: {
    width: '100%',
    height: 250,
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
  vlmTriggerButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 32,
    padding: '0 12px',
    borderRadius: 8,
    border: '1px solid #e0e7ff',
    backgroundColor: '#eef2ff',
    color: '#4338ca',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 120ms ease',
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
  slotTabsContainer: {
    display: 'flex',
    gap: 6,
    overflowX: 'auto',
    paddingBottom: 4,
  },
  slotTab: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    borderRadius: 8,
    border: '1px solid #e2e8f0',
    backgroundColor: '#f8fafc',
    color: '#334155',
    fontSize: 12,
    cursor: 'pointer',
    transition: 'all 120ms ease',
    whiteSpace: 'nowrap',
  },
  slotTabActive: {
    backgroundColor: '#0f172a',
    borderColor: '#0f172a',
    color: '#ffffff',
    boxShadow: '0 1px 3px rgba(15, 23, 42, 0.2)',
  },
  slotCountBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 16,
    height: 16,
    padding: '0 4px',
    borderRadius: 99,
    fontSize: 10,
    fontWeight: 700,
  },
  activeSlotHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 10px',
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    border: '1px solid #e2e8f0',
  },
  clearSlotButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    background: 'none',
    border: 'none',
    color: '#94a3b8',
    fontSize: 11,
    cursor: 'pointer',
    padding: '2px 6px',
    borderRadius: 4,
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
    minHeight: 200,
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
    minHeight: 180,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    textAlign: 'center',
  },
  configuredSummaryBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px',
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    border: '1px solid #e2e8f0',
  },
  configuredSlotChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 8px',
    borderRadius: 6,
    border: '1px solid',
    fontSize: 11,
    cursor: 'pointer',
    color: '#0f172a',
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

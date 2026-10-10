import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  ImagePlus,
  Loader2,
  Search,
  Shirt,
  SlidersHorizontal,
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
  type OutfitGarment,
} from '../services/aiImageService'
import { InteractiveMannequin, OUTFIT_ZONES, type OutfitItem } from './InteractiveMannequin'

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

interface ItemState {
  skuInput: string
  searchResult: OutfitAssetSearchResult | null
  searching: boolean
  searchError: string | null
  selected: OutfitAsset[]
  uploads: UploadItem[]
}

type AnalysisState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; data: OutfitAnalysis }
  | { status: 'error'; error: string }

const DEFAULT_MAX_REFS = 8
// 检索到货号后默认勾选的角度数（正面/背面/细节通常足够还原版型）
const AUTO_PICK_PER_SKU = 3
const ACCEPTED_UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/webp']

const ALL_ITEMS: OutfitItem[] = OUTFIT_ZONES.flatMap((z) => z.items)
const zoneOfItem = (itemKey: string) => OUTFIT_ZONES.find((z) => z.items.some((i) => i.key === itemKey))!

// 记住全局模型配置
let lastModel: OutfitChangeRequest['model'] = 'gpt-image-2.5'
let lastResolution: OutfitChangeRequest['resolution'] = '1K'

const MODEL_OPTIONS: { key: OutfitChangeRequest['model']; label: string; desc: string }[] = [
  { key: 'gpt-image-2.5', label: 'GPT Image 2.5', desc: '中文理解强，智能路由' },
  { key: 'nano-banana-pro', label: 'Nano Banana Pro', desc: '编辑一致性高' },
]

const emptyItemState = (): ItemState => ({
  skuInput: '',
  searchResult: null,
  searching: false,
  searchError: null,
  selected: [],
  uploads: [],
})

// VLM 识别结果 → 对应的单品入口
function itemForGarment(g: OutfitGarment): string | null {
  switch (g.slot) {
    case 'hat':
      return 'hat'
    case 'outerwear':
      return 'outerwear'
    case 'top':
      return /卫衣|连帽|hoodie|sweat/i.test(g.name) ? 'hoodie' : 'tshirt'
    case 'bottom':
    case 'dress':
      return 'pants'
    case 'shoes':
      return 'shoes'
    case 'socks':
      return 'socks'
    default:
      return null
  }
}

export const OutfitChangeModal: React.FC<Props> = ({ image, onClose, onSubmit }) => {
  const [analysis, setAnalysis] = useState<AnalysisState>({ status: 'idle' })

  const [activeItemKey, setActiveItemKey] = useState<string>('tshirt')
  const [itemStates, setItemStates] = useState<Record<string, ItemState>>(() =>
    Object.fromEntries(ALL_ITEMS.map((i) => [i.key, emptyItemState()]))
  )
  const [isDragOver, setIsDragOver] = useState(false)

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

  const activeItem = ALL_ITEMS.find((i) => i.key === activeItemKey) || ALL_ITEMS[0]
  const activeZone = zoneOfItem(activeItem.key)
  const activeState = itemStates[activeItem.key]

  const itemCount = useCallback(
    (key: string) => (itemStates[key]?.selected.length || 0) + (itemStates[key]?.uploads.length || 0),
    [itemStates]
  )
  const configuredItems = useMemo(() => ALL_ITEMS.filter((i) => itemCount(i.key) > 0), [itemCount])
  const totalSelected = useMemo(() => ALL_ITEMS.reduce((n, i) => n + itemCount(i.key), 0), [itemCount])
  const maxRefs = DEFAULT_MAX_REFS
  const remaining = maxRefs - totalSelected

  const zoneCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    OUTFIT_ZONES.forEach((z) => {
      const n = z.items.reduce((sum, i) => sum + itemCount(i.key), 0)
      if (n > 0) counts[z.key] = n
    })
    return counts
  }, [itemCount])

  const updateItem = useCallback((key: string, patch: Partial<ItemState>) => {
    setItemStates((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }))
  }, [])

  // 点击人偶区域：已配置过的单品优先，否则进入该区域第一个单品
  const selectZone = (zoneKey: string) => {
    const zone = OUTFIT_ZONES.find((z) => z.key === zoneKey)
    if (!zone) return
    if (zone.key === activeZone.key) return
    const configured = zone.items.find((i) => itemCount(i.key) > 0)
    setActiveItemKey((configured || zone.items[0]).key)
  }

  const runAnalysis = useCallback(() => {
    setAnalysis({ status: 'loading' })
    analyzeOutfit(image.url)
      .then((data) => setAnalysis({ status: 'done', data }))
      .catch((err: any) => setAnalysis({ status: 'error', error: err?.message || '分析失败' }))
  }, [image.url])

  useEffect(() => {
    const t = setTimeout(() => skuInputRef.current?.focus(), 60)
    return () => clearTimeout(t)
  }, [activeItemKey])

  // 卸载时释放所有本地预览 URL
  useEffect(() => {
    return () => {
      Object.values(itemStates).forEach((st) => st.uploads.forEach((u) => URL.revokeObjectURL(u.previewUrl)))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

  const assetKey = (a: OutfitAsset) => `${a.id}|${a.sku}`
  const activeSelectedKeys = useMemo(() => new Set(activeState.selected.map(assetKey)), [activeState.selected])

  const handleSearch = async () => {
    const item = activeItem
    const state = itemStates[item.key]
    const skus = Array.from(new Set(state.skuInput.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean)))
    if (skus.length === 0) {
      updateItem(item.key, { searchError: `请输入${item.label}货号` })
      skuInputRef.current?.focus()
      return
    }

    updateItem(item.key, { searching: true, searchError: null })
    try {
      const result = await searchOutfitAssets(skus)
      const newKeys = new Set(result.items.flatMap((it) => it.assets.map(assetKey)))
      const kept = state.selected.filter((a) => newKeys.has(assetKey(a)))

      // 自动勾选：每个新找到的货号默认取前几张角度图，省去逐张点选
      let budget = remaining + (state.selected.length - kept.length)
      const autoPicked: OutfitAsset[] = []
      result.items.forEach((it) => {
        if (!it.found || kept.some((a) => a.sku === it.sku)) return
        const take = it.assets.slice(0, Math.min(AUTO_PICK_PER_SKU, Math.max(0, budget)))
        budget -= take.length
        autoPicked.push(...take.map((a) => ({ ...a, slot: item.slot })))
      })

      let errorMsg: string | null = null
      if (!result.library_exists) errorMsg = '未挂载商品素材库，可用「上传」添加图片'
      else if (!result.items.some((it) => it.found)) errorMsg = `未找到货号：${skus.join(', ')}`

      updateItem(item.key, {
        searching: false,
        searchResult: result,
        searchError: errorMsg,
        selected: [...kept, ...autoPicked],
      })
    } catch (err: any) {
      updateItem(item.key, { searching: false, searchError: err?.message || '检索失败，请重试' })
    }
  }

  const toggleAsset = (asset: OutfitAsset) => {
    const key = assetKey(asset)
    if (activeSelectedKeys.has(key)) {
      updateItem(activeItem.key, { selected: activeState.selected.filter((a) => assetKey(a) !== key) })
    } else if (remaining > 0) {
      updateItem(activeItem.key, { selected: [...activeState.selected, { ...asset, slot: activeItem.slot }] })
    }
  }

  const removeAsset = (itemKey: string, asset: OutfitAsset) => {
    const st = itemStates[itemKey]
    updateItem(itemKey, { selected: st.selected.filter((a) => assetKey(a) !== assetKey(asset)) })
  }

  const addFiles = (files: FileList | File[]) => {
    const valid = Array.from(files).filter((f) => ACCEPTED_UPLOAD_TYPES.includes(f.type))
    if (valid.length === 0) return
    const toAdd = valid.slice(0, Math.max(0, remaining)).map((file) => ({
      id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }))
    updateItem(activeItem.key, { uploads: [...activeState.uploads, ...toAdd] })
  }

  const removeUpload = (itemKey: string, id: string) => {
    const st = itemStates[itemKey]
    const target = st.uploads.find((u) => u.id === id)
    if (target) URL.revokeObjectURL(target.previewUrl)
    updateItem(itemKey, { uploads: st.uploads.filter((u) => u.id !== id) })
  }

  const canSubmit = totalSelected > 0 && !submitting

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setSubmitError(null)
    lastModel = model
    lastResolution = resolution

    const assets = ALL_ITEMS.flatMap((i) => itemStates[i.key].selected)
    const uploads = ALL_ITEMS.flatMap((i) => itemStates[i.key].uploads.map((u) => u.file))
    const uploadSlots = ALL_ITEMS.flatMap((i) => itemStates[i.key].uploads.map(() => i.slot))
    const targetSlots = Array.from(new Set(configuredItems.map((i) => i.slot)))
    const garments = analysis.status === 'done' ? analysis.data.garments : []

    try {
      await onSubmit({
        sourceUrl: image.url,
        sourceName: image.name,
        assets,
        uploads,
        uploadSlots,
        analysis: analysis.status === 'done' ? analysis.data : null,
        // 识别到的原图单品里，与所选部位相同的视为被替换对象
        targetGarmentIds: garments.filter((g) => targetSlots.includes(g.slot)).map((g) => g.id),
        targetSlots,
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

  const hasActiveContent = !!activeState.searchResult || activeState.uploads.length > 0

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
        {/* ── Header ── */}
        <div style={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={styles.headerIcon}>
              <Shirt size={16} strokeWidth={2.2} />
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#09090b' }}>AI 换装</div>
            <div style={styles.steps}>
              <span>① 点选部位</span>
              <ChevronRight size={11} />
              <span>② 输入货号</span>
              <ChevronRight size={11} />
              <span>③ 开始换装</span>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} style={styles.iconButton} title="关闭 (Esc)">
            <X size={16} />
          </button>
        </div>

        <div style={styles.body}>
          {/* ── 左栏：人偶 + 原图 / VLM 辅助 ── */}
          <div style={styles.leftCol}>
            <InteractiveMannequin
              activeZone={activeZone.key}
              zoneCounts={zoneCounts}
              onSelectZone={selectZone}
              disabled={submitting}
            />

            <div style={styles.sourceRow}>
              <div style={styles.sourceThumb} onClick={() => setPreview(normalizeAssetUrl(image.url))} title="查看原图">
                <img src={normalizeAssetUrl(image.url)} alt="" style={styles.coverImg} draggable={false} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#18181b' }}>
                  原图
                  {analysis.status === 'done' && (
                    <span style={{ fontWeight: 400, color: '#a1a1aa' }}> · {analysis.data.image_type_label}</span>
                  )}
                </div>
                {analysis.status === 'idle' && (
                  <button type="button" style={styles.vlmLink} onClick={runAnalysis}>
                    <Sparkles size={10} /> 识别原图穿搭（可选）
                  </button>
                )}
                {analysis.status === 'loading' && (
                  <div style={styles.vlmHint}>
                    <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> 识别中…
                  </div>
                )}
                {analysis.status === 'error' && <div style={styles.vlmHint}>识别失败，不影响换装</div>}
                {analysis.status === 'done' && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 3 }}>
                    {analysis.data.garments.length === 0 && <span style={styles.vlmHint}>未识别到服饰</span>}
                    {analysis.data.garments.map((g) => {
                      const target = itemForGarment(g)
                      return (
                        <button
                          key={g.id}
                          type="button"
                          disabled={!target}
                          onClick={() => target && setActiveItemKey(target)}
                          title={target ? '定位到该部位' : undefined}
                          style={{
                            ...styles.garmentChip,
                            cursor: target ? 'pointer' : 'default',
                            ...(target === activeItem.key ? styles.garmentChipActive : null),
                          }}
                        >
                          {g.color}
                          {g.name}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── 右栏：当前部位的单品配置 ── */}
          <div style={styles.rightCol}>
            {/* 单品切换：同一区域下的细分品类 */}
            <div style={styles.zoneBar}>
              <span style={{ fontSize: 15, fontWeight: 600, color: '#09090b' }}>{activeZone.label}</span>
              <div style={styles.segment}>
                {activeZone.items.map((it) => {
                  const n = itemCount(it.key)
                  return (
                    <button
                      key={it.key}
                      type="button"
                      onClick={() => setActiveItemKey(it.key)}
                      style={{ ...styles.segmentItem, ...(it.key === activeItem.key ? styles.segmentActive : null) }}
                    >
                      {it.label}
                      {n > 0 && <span style={styles.segmentCount}>{n}</span>}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 货号检索 */}
            <div style={styles.searchRow}>
              <div style={styles.searchBox}>
                <Search size={14} color="#a1a1aa" style={{ flexShrink: 0 }} />
                <input
                  ref={skuInputRef}
                  type="text"
                  value={activeState.skuInput}
                  onChange={(e) => updateItem(activeItem.key, { skuInput: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleSearch()
                    }
                  }}
                  placeholder={`${activeItem.placeholder}，回车检索（多个用空格分隔）`}
                  style={styles.searchInput}
                  disabled={activeState.searching}
                />
                {activeState.searching && <Loader2 size={13} color="#71717a" style={{ animation: 'spin 1s linear infinite' }} />}
              </div>
              <button type="button" onClick={() => fileInputRef.current?.click()} style={styles.ghostBtn} title="上传本地图片">
                <ImagePlus size={14} />
                <span>上传</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPTED_UPLOAD_TYPES.join(',')}
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files)
                  e.target.value = ''
                }}
                style={{ display: 'none' }}
              />
            </div>

            {activeState.searchError && (
              <div style={styles.errorNotice}>
                <AlertCircle size={13} style={{ flexShrink: 0 }} />
                <span>{activeState.searchError}</span>
              </div>
            )}

            {/* 素材区（支持拖拽上传） */}
            <div
              style={{
                ...styles.assetArea,
                borderColor: isDragOver ? '#09090b' : hasActiveContent ? 'transparent' : '#e4e4e7',
                backgroundColor: isDragOver ? '#f4f4f5' : '#ffffff',
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
              {activeState.searchResult?.items.map((group) => (
                <div key={group.sku} style={{ marginBottom: 14 }}>
                  <div style={styles.groupHeader}>
                    <span style={{ fontWeight: 600, color: '#09090b' }}>{group.sku}</span>
                    {group.found ? (
                      <span style={{ color: '#a1a1aa' }}>
                        已选 {group.assets.filter((a) => activeSelectedKeys.has(assetKey(a))).length}/{group.assets.length}
                      </span>
                    ) : (
                      <span style={{ color: '#ef4444' }}>未找到</span>
                    )}
                  </div>
                  {group.found && (
                    <div style={styles.grid}>
                      {group.assets.map((asset) => {
                        const isSelected = activeSelectedKeys.has(assetKey(asset))
                        return (
                          <div
                            key={assetKey(asset)}
                            role="checkbox"
                            aria-checked={isSelected}
                            className="outfit-tile"
                            onClick={() => toggleAsset(asset)}
                            title={`${asset.angle} · ${asset.type_label}`}
                            style={{
                              ...styles.tile,
                              ...(isSelected ? styles.tileSelected : null),
                              opacity: !isSelected && remaining <= 0 ? 0.4 : 1,
                            }}
                          >
                            <div style={styles.tileImgBox}>
                              <img src={asset.thumb_url} alt="" loading="lazy" style={styles.coverImg} draggable={false} />
                              {isSelected && <div style={styles.tileCheck}>✓</div>}
                              <button
                                type="button"
                                className="outfit-tile-zoom"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setPreview(asset.url)
                                }}
                                style={styles.tileZoom}
                                title="查看大图"
                              >
                                <ZoomIn size={11} />
                              </button>
                            </div>
                            <div style={styles.tileLabel}>{asset.angle}</div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))}

              {activeState.uploads.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={styles.groupHeader}>
                    <span style={{ fontWeight: 600, color: '#09090b' }}>本地上传</span>
                    <span style={{ color: '#a1a1aa' }}>{activeState.uploads.length} 张</span>
                  </div>
                  <div style={styles.grid}>
                    {activeState.uploads.map((u, idx) => (
                      <div key={u.id} style={{ ...styles.tile, ...styles.tileSelected }}>
                        <div style={styles.tileImgBox}>
                          <img src={u.previewUrl} alt="" style={styles.coverImg} draggable={false} />
                          <button
                            type="button"
                            onClick={() => removeUpload(activeItem.key, u.id)}
                            style={styles.tileRemove}
                            title="移除"
                          >
                            <X size={10} />
                          </button>
                        </div>
                        <div style={styles.tileLabel}>上传 {idx + 1}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!hasActiveContent && (
                <div style={styles.emptyState}>
                  <div style={{ fontSize: 13, color: '#18181b', fontWeight: 500 }}>
                    输入{activeItem.label}货号，自动带出多角度图
                  </div>
                  <div style={{ fontSize: 12, color: '#a1a1aa', lineHeight: 1.6 }}>
                    默认勾选前 {AUTO_PICK_PER_SKU} 个角度，点击图片可增减 · 也可直接拖入图片
                  </div>
                </div>
              )}
            </div>

            {/* 换装清单：全部部位的已选素材一览 */}
            <div style={styles.summary}>
              <div style={styles.summaryHead}>
                <span>换装清单</span>
                <span style={{ color: remaining <= 0 ? '#ef4444' : '#a1a1aa', fontWeight: 400 }}>
                  {totalSelected}/{maxRefs} 张参考图
                </span>
              </div>
              {configuredItems.length === 0 ? (
                <div style={{ fontSize: 11, color: '#a1a1aa', padding: '6px 0' }}>
                  尚未添加 · 未选择的部位将保持原图不变
                </div>
              ) : (
                <div style={styles.summaryList}>
                  {configuredItems.map((it) => {
                    const st = itemStates[it.key]
                    const isCur = it.key === activeItem.key
                    return (
                      <div
                        key={it.key}
                        onClick={() => setActiveItemKey(it.key)}
                        style={{ ...styles.summaryItem, ...(isCur ? styles.summaryItemActive : null) }}
                      >
                        <span style={styles.summaryLabel}>{it.label}</span>
                        {st.selected.map((a) => (
                          <div key={assetKey(a)} style={styles.miniThumb} title={`${a.sku} · ${a.angle}`}>
                            <img src={a.thumb_url} alt="" style={styles.coverImg} draggable={false} />
                            <button
                              type="button"
                              style={styles.miniRemove}
                              onClick={(e) => {
                                e.stopPropagation()
                                removeAsset(it.key, a)
                              }}
                            >
                              <X size={8} />
                            </button>
                          </div>
                        ))}
                        {st.uploads.map((u) => (
                          <div key={u.id} style={styles.miniThumb}>
                            <img src={u.previewUrl} alt="" style={styles.coverImg} draggable={false} />
                            <button
                              type="button"
                              style={styles.miniRemove}
                              onClick={(e) => {
                                e.stopPropagation()
                                removeUpload(it.key, u.id)
                              }}
                            >
                              <X size={8} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div style={styles.footer}>
          <button type="button" onClick={() => setShowSettings((v) => !v)} style={styles.settingsToggle}>
            <SlidersHorizontal size={13} />
            <span>
              {MODEL_OPTIONS.find((m) => m.key === model)?.label} · {resolution}
              {batchCount > 1 ? ` · ${batchCount} 张` : ''}
              {extraPrompt.trim() ? ' · 有补充指令' : ''}
            </span>
            {showSettings ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {submitError && <span style={{ fontSize: 11, color: '#ef4444', marginRight: 4 }}>{submitError}</span>}
            <button type="button" onClick={onClose} disabled={submitting} style={styles.cancelBtn}>
              取消
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              style={{ ...styles.primaryBtn, opacity: canSubmit ? 1 : 0.4, cursor: canSubmit ? 'pointer' : 'not-allowed' }}
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
                      ? '开始换装'
                      : `换装 ${configuredItems.map((i) => i.label).join(' + ')}`}
                  </span>
                  {canSubmit && <ArrowRight size={13} />}
                </>
              )}
            </button>
          </div>
        </div>

        {showSettings && (
          <div style={styles.settingsPopover}>
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
              <span style={styles.settingLabel}>分辨率</span>
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
              <span style={{ ...styles.settingLabel, marginLeft: 12 }}>数量</span>
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
              placeholder="补充指令（可选），如：上衣下摆塞进裤腰、袖口微挽"
              style={styles.textarea}
            />
          </div>
        )}

        {preview && (
          <div style={styles.lightbox} onClick={() => setPreview(null)}>
            <div style={styles.lightboxBox} onClick={(e) => e.stopPropagation()}>
              <img src={preview} alt="" style={styles.lightboxImg} />
              <button type="button" onClick={() => setPreview(null)} style={styles.lightboxClose}>
                <X size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
      <style>{`
        [data-modal="outfit-change"] .outfit-tile:hover .outfit-tile-zoom { opacity: 1; }
        [data-modal="outfit-change"] .outfit-tile:hover { border-color: #a1a1aa; }
      `}</style>
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
    width: 'min(980px, 96vw)',
    height: 'min(700px, 92vh)',
    backgroundColor: '#ffffff',
    borderRadius: 14,
    boxShadow: '0 24px 60px rgba(9, 9, 11, 0.16), 0 4px 16px rgba(9, 9, 11, 0.06)',
    border: '1px solid #e4e4e7',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    height: 50,
    padding: '0 16px 0 18px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottom: '1px solid #f4f4f5',
    flexShrink: 0,
  },
  headerIcon: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: '#f4f4f5',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#09090b',
  },
  steps: {
    marginLeft: 8,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 11,
    color: '#a1a1aa',
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
  },
  body: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    overflow: 'hidden',
  },
  leftCol: {
    width: 300,
    borderRight: '1px solid #f4f4f5',
    backgroundColor: '#fafafa',
    padding: '18px 16px 14px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    gap: 12,
    overflowY: 'auto',
    flexShrink: 0,
  },
  sourceRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    border: '1px solid #f0f0f1',
  },
  sourceThumb: {
    width: 32,
    height: 42,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#f4f4f5',
    cursor: 'zoom-in',
    flexShrink: 0,
  },
  coverImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  vlmLink: {
    marginTop: 3,
    padding: 0,
    border: 'none',
    background: 'transparent',
    color: '#71717a',
    fontSize: 11,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
  },
  vlmHint: {
    marginTop: 3,
    fontSize: 11,
    color: '#a1a1aa',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  garmentChip: {
    padding: '1px 6px',
    borderRadius: 4,
    border: '1px solid #e4e4e7',
    backgroundColor: '#fafafa',
    color: '#52525b',
    fontSize: 10,
    lineHeight: '16px',
  },
  garmentChipActive: {
    borderColor: '#09090b',
    color: '#09090b',
    backgroundColor: '#ffffff',
  },
  rightCol: {
    flex: 1,
    minWidth: 0,
    padding: '16px 20px 12px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  zoneBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  searchRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  searchBox: {
    flex: 1,
    height: 36,
    borderRadius: 8,
    border: '1px solid #e4e4e7',
    backgroundColor: '#ffffff',
    padding: '0 10px',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    border: 'none',
    outline: 'none',
    backgroundColor: 'transparent',
    fontSize: 13,
    color: '#09090b',
  },
  ghostBtn: {
    height: 36,
    padding: '0 12px',
    borderRadius: 8,
    border: '1px solid #e4e4e7',
    backgroundColor: '#ffffff',
    color: '#18181b',
    fontSize: 12,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 5,
  },
  errorNotice: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 10px',
    borderRadius: 6,
    backgroundColor: '#fef2f2',
    color: '#b91c1c',
    fontSize: 11,
    marginBottom: 10,
  },
  assetArea: {
    flex: 1,
    minHeight: 0,
    borderRadius: 10,
    border: '1px dashed #e4e4e7',
    padding: 2,
    overflowY: 'auto',
  },
  groupHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    marginBottom: 6,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, 76px)',
    gap: 8,
  },
  tile: {
    position: 'relative',
    width: 76,
    padding: 3,
    borderRadius: 8,
    border: '1px solid #e4e4e7',
    backgroundColor: '#ffffff',
    cursor: 'pointer',
    transition: 'border-color 0.12s ease',
  },
  tileSelected: {
    borderColor: '#09090b',
    boxShadow: '0 0 0 1px #09090b',
  },
  tileImgBox: {
    position: 'relative',
    width: '100%',
    aspectRatio: '1',
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: '#f4f4f5',
  },
  tileCheck: {
    position: 'absolute',
    top: 3,
    left: 3,
    width: 15,
    height: 15,
    borderRadius: 4,
    backgroundColor: '#09090b',
    color: '#ffffff',
    fontSize: 10,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileZoom: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 17,
    height: 17,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.92)',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    opacity: 0,
    transition: 'opacity 0.12s ease',
  },
  tileRemove: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 16,
    height: 16,
    borderRadius: 4,
    backgroundColor: '#09090b',
    color: '#ffffff',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  tileLabel: {
    marginTop: 3,
    fontSize: 10,
    color: '#52525b',
    textAlign: 'center',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  emptyState: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    gap: 4,
  },
  summary: {
    marginTop: 10,
    paddingTop: 10,
    borderTop: '1px solid #f4f4f5',
    flexShrink: 0,
  },
  summaryHead: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 11,
    fontWeight: 600,
    color: '#18181b',
    marginBottom: 6,
  },
  summaryList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
  },
  summaryItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 4px 3px 8px',
    borderRadius: 8,
    border: '1px solid #e4e4e7',
    cursor: 'pointer',
  },
  summaryItemActive: {
    borderColor: '#09090b',
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: '#18181b',
    marginRight: 2,
  },
  miniThumb: {
    position: 'relative',
    width: 28,
    height: 28,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#f4f4f5',
  },
  miniRemove: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 12,
    height: 12,
    padding: 0,
    border: 'none',
    borderBottomLeftRadius: 4,
    backgroundColor: 'rgba(9,9,11,0.7)',
    color: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  footer: {
    height: 54,
    padding: '0 18px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTop: '1px solid #f4f4f5',
    flexShrink: 0,
  },
  settingsToggle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 9px',
    borderRadius: 6,
    border: '1px solid #e4e4e7',
    backgroundColor: '#ffffff',
    color: '#3f3f46',
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
    bottom: 58,
    left: 18,
    width: 400,
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
    width: 40,
  },
  segment: {
    display: 'inline-flex',
    borderRadius: 7,
    padding: 2,
    backgroundColor: '#f4f4f5',
  },
  segmentItem: {
    padding: '4px 12px',
    borderRadius: 5,
    border: 'none',
    backgroundColor: 'transparent',
    color: '#71717a',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
  },
  segmentActive: {
    backgroundColor: '#ffffff',
    color: '#09090b',
    boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
  },
  segmentCount: {
    fontSize: 10,
    minWidth: 15,
    height: 15,
    padding: '0 4px',
    borderRadius: 999,
    backgroundColor: '#18181b',
    color: '#ffffff',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textarea: {
    width: '100%',
    boxSizing: 'border-box',
    borderRadius: 6,
    border: '1px solid #e4e4e7',
    padding: '6px 8px',
    fontSize: 12,
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

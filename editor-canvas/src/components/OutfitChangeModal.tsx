import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Crosshair,
  ImagePlus,
  Loader2,
  Search,
  SlidersHorizontal,
  Sparkles,
  UploadCloud,
  X,
  ZoomIn,
} from 'lucide-react'
import type { CanvasImage } from '../types'
import {
  normalizeAssetUrl,
  searchOutfitAssets,
  type OutfitAsset,
  type OutfitAssetSearchResult,
  type OutfitChangeRequest,
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

const DEFAULT_MAX_REFS = 8
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

export const OutfitChangeModal: React.FC<Props> = ({ image, onClose, onSubmit }) => {
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

      let errorMsg: string | null = null
      if (!result.library_exists) errorMsg = '未挂载商品素材库，可用「上传」添加图片'
      else if (!result.items.some((it) => it.found)) errorMsg = `未找到货号：${skus.join(', ')}`

      updateItem(item.key, {
        searching: false,
        searchResult: result,
        searchError: errorMsg,
        // 检索只展示素材，选择权交给用户，不自动勾选任何角度图。
        selected: kept,
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
    try {
      await onSubmit({
        sourceUrl: image.url,
        sourceName: image.name,
        assets,
        uploads,
        uploadSlots,
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <Crosshair size={16} strokeWidth={2.1} color="#444444" />
            <div style={{ fontSize: 16, fontWeight: 700, color: '#282828', letterSpacing: '-0.02em' }}>AI 换装</div>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} style={styles.iconButton} title="关闭 (Esc)">
            <X size={16} />
          </button>
        </div>

        <div style={styles.body}>
          {/* ── 左栏：人偶 + 原图 ── */}
          <div style={styles.leftCol}>
            <div style={styles.panelHeading}>
              <div>
                <div style={styles.panelKicker}>换装区域</div>
                <div style={styles.panelTitle}>选择要替换的部位</div>
              </div>
              <span style={styles.panelIndex}>01 / 02</span>
            </div>
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
                <div style={{ fontSize: 11, fontWeight: 650, color: '#3d3d3d', letterSpacing: '0.04em' }}>
                  原图
                </div>
                <div style={styles.sourceHint}>换装将以当前原图为基础生成</div>
              </div>
            </div>
          </div>

          {/* ── 右栏：当前部位的单品配置 ── */}
          <div style={styles.rightCol}>
            {/* 单品切换：同一区域下的细分品类 */}
            <div style={styles.zoneBar}>
              <div style={styles.zoneTitle}>{activeZone.label}</div>
              <div style={styles.zoneSegment} role="tablist" aria-label={`${activeZone.label}单品类型`}>
                {activeZone.items.map((it) => {
                  const n = itemCount(it.key)
                  return (
                    <button
                      key={it.key}
                      type="button"
                      role="tab"
                      aria-selected={it.key === activeItem.key}
                      onClick={() => setActiveItemKey(it.key)}
                      className="outfit-zone-tab"
                      style={{ ...styles.zoneSegmentItem, ...(it.key === activeItem.key ? styles.zoneSegmentActive : null) }}
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
                <Search size={14} color="#8b8b8b" style={{ flexShrink: 0 }} />
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
                {activeState.searching && <Loader2 size={13} color="#727272" style={{ animation: 'spin 1s linear infinite' }} />}
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
                backgroundColor: isDragOver ? 'rgba(134, 134, 134,.08)' : 'transparent',
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
                    <span style={{ fontWeight: 650, color: '#333333', letterSpacing: '0.04em' }}>{group.sku}</span>
                    {group.found ? (
                    <span style={{ color: '#8a8a8a' }}>
                        已选 {group.assets.filter((a) => activeSelectedKeys.has(assetKey(a))).length}/{group.assets.length}
                      </span>
                    ) : (
                      <span style={{ color: '#686868' }}>未找到</span>
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
                            {isSelected && <div style={styles.tileCheck}><CheckCircle2 size={12} /></div>}
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
                    <span style={{ fontWeight: 650, color: '#333333' }}>本地上传</span>
                    <span style={{ color: '#8a8a8a' }}>{activeState.uploads.length} 张</span>
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
                  <div style={styles.emptyIcon}><UploadCloud size={18} strokeWidth={1.7} /></div>
                  <div style={styles.emptyTitle}>添加{activeItem.label}参考图</div>
                  <div style={styles.emptyHint}>输入货号检索，或上传图片 · 选择后才会加入换装</div>
                </div>
              )}
            </div>

            {/* 换装清单：全部部位的已选素材一览 */}
            <div style={styles.summary}>
              <div style={styles.summaryHead}>
                <span>换装清单</span>
                  <span style={{ color: remaining <= 0 ? '#5a5a5a' : '#8b8b8b', fontWeight: 400 }}>
                  {totalSelected}/{maxRefs} 张参考图
                </span>
              </div>
              {configuredItems.length === 0 ? (
                  <div style={{ fontSize: 11, color: '#8a8a8a', padding: '6px 0' }}>
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
            {submitError && <span style={{ fontSize: 11, color: '#686868', marginRight: 4 }}>{submitError}</span>}
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
        [data-modal="outfit-change"]::before { content: ''; position: absolute; inset: 0; pointer-events: none; opacity: .18; background-image: linear-gradient(rgba(109, 109, 109,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(109, 109, 109,.04) 1px, transparent 1px); background-size: 36px 36px; mask-image: linear-gradient(to bottom, #000000, transparent 70%); }
        [data-modal="outfit-change"] .mannequin-shell { animation: outfit-rise .45s cubic-bezier(.2,.8,.2,1) both; }
        [data-modal="outfit-change"] .outfit-tile:hover .outfit-tile-zoom { opacity: 1; }
        [data-modal="outfit-change"] .outfit-tile:hover { border-color: #555555; transform: translateY(-2px); box-shadow: 0 8px 18px rgba(0, 0, 0, .1); }
        [data-modal="outfit-change"] .outfit-tile { transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease; }
        [data-modal="outfit-change"] .outfit-zone-tab:hover { color: #1b1b1b; background: #f0f0f0; }
        [data-modal="outfit-change"] input::placeholder, [data-modal="outfit-change"] textarea::placeholder { color: #989898; }
        @keyframes outfit-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(36, 36, 36, 0.36)',
    backdropFilter: 'blur(16px)',
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
    width: 'min(1040px, 94vw)',
    height: 'min(640px, 82vh)',
    backgroundColor: '#fafafa',
    backgroundImage: 'radial-gradient(circle at 6% 0%, rgba(165, 165, 165, .09), transparent 32%), radial-gradient(circle at 96% 100%, rgba(126, 126, 126, .07), transparent 35%)',
    borderRadius: 14,
    boxShadow: '0 30px 80px rgba(46, 46, 46, 0.2), 0 0 0 1px rgba(135, 135, 135, .16)',
    border: '1px solid #dcdcdc',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    height: 58,
    padding: '0 18px 0 20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottom: '1px solid #dedede',
    backgroundColor: 'rgba(255, 255, 255, .9)',
    flexShrink: 0,
  },
  iconButton: {
    width: 30,
    height: 30,
    borderRadius: 6,
    border: 'none',
    backgroundColor: 'transparent',
    color: '#737373',
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
    width: 280,
    borderRight: '1px solid #e2e2e2',
    backgroundColor: '#fafafa',
    padding: '15px 14px 12px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-start',
    gap: 10,
    overflowY: 'auto',
    flexShrink: 0,
  },
  panelHeading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 0,
  },
  panelKicker: {
    fontSize: 10,
    color: '#8a8a8a',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  panelTitle: {
    fontSize: 15,
    color: '#2f2f2f',
    fontWeight: 650,
    letterSpacing: '-0.01em',
  },
  panelIndex: {
    fontSize: 10,
    color: '#9b9b9b',
    letterSpacing: '0.08em',
  },
  sourceRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: '8px 0 0',
    borderRadius: 0,
    backgroundColor: 'transparent',
    border: 'none',
    borderTop: '1px solid #dedede',
    marginTop: 10,
    color: '#3c3c3c',
  },
  sourceHint: {
    marginTop: 4,
    fontSize: 11,
    color: '#8a8a8a',
  },
  sourceThumb: {
    width: 32,
    height: 42,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#f3f3f3',
    cursor: 'zoom-in',
    flexShrink: 0,
  },
  coverImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  rightCol: {
    flex: 1,
    minWidth: 0,
    padding: '16px 22px 12px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  zoneBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 22,
    marginBottom: 12,
    paddingBottom: 10,
    borderBottom: '1px solid #dedede',
  },
  zoneTitle: {
    minWidth: 42,
    fontSize: 11,
    color: '#8a8a8a',
    letterSpacing: '0.08em',
  },
  zoneSegment: {
    display: 'inline-flex',
    alignItems: 'stretch',
    gap: 18,
    padding: 0,
    border: 'none',
    borderRadius: 0,
    backgroundColor: 'transparent',
    boxShadow: 'none',
  },
  zoneSegmentItem: {
    minHeight: 30,
    padding: '0 0 7px',
    border: 'none',
    borderRadius: 0,
    backgroundColor: 'transparent',
    color: '#5f5f5f',
    fontSize: 15,
    fontWeight: 550,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderBottom: '2px solid transparent',
    transition: 'color .15s ease, border-color .15s ease',
  },
  zoneSegmentActive: {
    backgroundColor: 'transparent',
    color: '#171717',
    borderBottomColor: '#171717',
    boxShadow: 'none',
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
    borderRadius: 6,
    border: 'none',
    borderBottom: '1px solid #bcbcbc',
    backgroundColor: 'transparent',
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
    color: '#313131',
  },
  ghostBtn: {
    height: 36,
    padding: '0 12px',
    borderRadius: 6,
    border: 'none',
    borderBottom: '1px solid #bcbcbc',
    backgroundColor: 'transparent',
    color: '#3d3d3d',
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
    borderRadius: 0,
    backgroundColor: '#f1f1f1',
    color: '#434343',
    fontSize: 11,
    marginBottom: 10,
  },
  assetArea: {
    flex: 1,
    borderRadius: 0,
    border: 'none',
    minHeight: 190,
    padding: '6px 0',
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
    padding: 0,
    borderRadius: 5,
    border: '1px solid #d7d7d7',
    backgroundColor: '#f7f7f7',
    cursor: 'pointer',
    transition: 'border-color 0.12s ease',
  },
  tileSelected: {
    borderColor: '#333333',
    boxShadow: '0 0 0 1px #333333',
  },
  tileImgBox: {
    position: 'relative',
    width: '100%',
    aspectRatio: '1',
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: '#f4f4f4',
  },
  tileCheck: {
    position: 'absolute',
    top: 3,
    left: 3,
    width: 15,
    height: 15,
    borderRadius: 4,
    backgroundColor: '#555555',
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
    backgroundColor: 'rgba(255, 255, 255,0.92)',
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
    backgroundColor: '#090909',
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
    color: '#696969',
    textAlign: 'center',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  emptyState: {
    height: '100%',
    minHeight: 220,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-start',
    textAlign: 'center',
    gap: 8,
    paddingTop: 48,
    color: '#666666',
  },
  emptyIcon: {
    width: 38,
    height: 38,
    border: '1px solid #d3d3d3',
    borderRadius: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#777777',
    marginBottom: 2,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: 650,
    color: '#343434',
  },
  emptyHint: {
    fontSize: 11,
    color: '#969696',
    lineHeight: 1.5,
    textAlign: 'center',
  },
  summary: {
    marginTop: 10,
    paddingTop: 10,
    borderTop: 'none',
    flexShrink: 0,
  },
  summaryHead: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 11,
    fontWeight: 600,
    color: '#3c3c3c',
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
    padding: '3px 4px 3px 0',
    borderRadius: 0,
    border: 'none',
    borderBottom: '1px solid #dedede',
    cursor: 'pointer',
  },
  summaryItemActive: {
    borderBottomColor: '#333333',
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: '#4d4d4d',
    marginRight: 2,
  },
  miniThumb: {
    position: 'relative',
    width: 28,
    height: 28,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#f4f4f4',
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
    backgroundColor: 'rgba(9, 9, 9,0.7)',
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
    borderTop: '1px solid #dedede',
    backgroundColor: 'rgba(255, 255, 255, .92)',
    flexShrink: 0,
  },
  settingsToggle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 0',
    borderRadius: 0,
    border: 'none',
    backgroundColor: 'transparent',
    color: '#5f5f5f',
    fontSize: 11,
    cursor: 'pointer',
  },
  cancelBtn: {
    height: 34,
    padding: '0 14px',
    borderRadius: 6,
    border: '1px solid #cfcfcf',
    backgroundColor: 'transparent',
    color: '#5f5f5f',
    fontSize: 12,
    cursor: 'pointer',
  },
  primaryBtn: {
    height: 34,
    padding: '0 16px',
    borderRadius: 8,
    border: 'none',
    backgroundColor: '#2f2f2f',
    color: '#ffffff',
    boxShadow: '0 8px 18px rgba(120, 120, 120, .2)',
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
    borderRadius: 8,
    border: '1px solid #cfcfcf',
    boxShadow: '0 18px 40px rgba(61, 61, 61, .16)',
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
    color: '#7d7d7d',
    width: 40,
  },
  segment: {
    display: 'inline-flex',
    borderRadius: 7,
    padding: 2,
    backgroundColor: '#f5f5f5',
  },
  segmentItem: {
    padding: '4px 12px',
    borderRadius: 5,
    border: 'none',
    backgroundColor: 'transparent',
    color: '#666666',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
  },
  segmentActive: {
    backgroundColor: '#ededed',
    color: '#5b5b5b',
    boxShadow: '0 2px 8px rgba(129, 129, 129, .14)',
  },
  segmentCount: {
    fontSize: 10,
    minWidth: 15,
    height: 15,
    padding: '0 4px',
    borderRadius: 999,
    backgroundColor: '#747474',
    color: '#ffffff',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textarea: {
    width: '100%',
    boxSizing: 'border-box',
    borderRadius: 6,
    border: '1px solid #dcdcdc',
    backgroundColor: '#ffffff',
    padding: '6px 8px',
    fontSize: 12,
    outline: 'none',
    resize: 'none',
    fontFamily: 'inherit',
    color: '#3c3c3c',
  },
  lightbox: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(9, 9, 9, 0.8)',
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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Check,
  ChevronDown,
  ImagePlus,
  Loader2,
  Maximize2,
  Search,
  Shirt,
  Sparkles,
  UploadCloud,
  X,
} from 'lucide-react'
import type { CanvasImage } from '../types'
import {
  normalizeAssetUrl,
  searchOutfitAssets,
  type OutfitAsset,
  type OutfitAssetSearchResult,
  type OutfitChangeRequest,
} from '../services/aiImageService'
import { InteractiveMannequin, OUTFIT_ZONES, type OutfitZone } from './InteractiveMannequin'

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

interface ZoneState {
  skuInput: string
  searchResult: OutfitAssetSearchResult | null
  searching: boolean
  searchError: string | null
  selected: OutfitAsset[]
  uploads: UploadItem[]
  /** 单品 → 品类 key（'' = 自动识别）；单品 key 为 `sku:<货号>` 或 `upload:<id>` */
  types: Record<string, string>
}

/** 一件单品：同一货号的多张角度图，或一张本地上传图 */
interface Piece {
  key: string
  zone: OutfitZone
  sku: string
  assets: OutfitAsset[]
  upload?: UploadItem
  type: string
}

const DEFAULT_MAX_REFS = 8
const ACCEPTED_UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/webp']

const AUTO_LABEL = '自动识别'
const skuPieceKey = (sku: string) => `sku:${sku}`
const uploadPieceKey = (id: string) => `upload:${id}`
const hasTypes = (zone: OutfitZone) => zone.items.length > 1
const defaultType = (zone: OutfitZone) => (zone.allowAuto ? '' : zone.items[0].key)
const typeOptions = (zone: OutfitZone) => [
  ...(zone.allowAuto ? [{ key: '', label: AUTO_LABEL }] : []),
  ...zone.items.map((i) => ({ key: i.key, label: i.label })),
]
const typeItem = (p: Piece) => p.zone.items.find((i) => i.key === p.type)
// 只有多品类部位才把品类传给后端；单品类部位（帽子、下装）只传部位，避免把半裙写成“裤子”
const pieceItemKey = (p: Piece) => (hasTypes(p.zone) ? typeItem(p)?.key || '' : '')
const pieceSlot = (p: Piece) => typeItem(p)?.slot || p.zone.slot
const pieceLabel = (p: Piece) => (hasTypes(p.zone) ? typeItem(p)?.label || p.zone.label : p.zone.items[0].label)
const pieceCount = (p: Piece) => (p.upload ? 1 : p.assets.length)

function zonePieces(zone: OutfitZone, st: ZoneState): Piece[] {
  const valid = new Set(typeOptions(zone).map((o) => o.key))
  const typeOf = (key: string) => (key in st.types && valid.has(st.types[key]) ? st.types[key] : defaultType(zone))
  const bySku = new Map<string, OutfitAsset[]>()
  st.selected.forEach((a) => {
    const list = bySku.get(a.sku)
    if (list) list.push(a)
    else bySku.set(a.sku, [a])
  })
  return [
    ...Array.from(bySku, ([sku, assets]) => ({ key: skuPieceKey(sku), zone, sku, assets, type: typeOf(skuPieceKey(sku)) })),
    ...st.uploads.map((u) => ({ key: uploadPieceKey(u.id), zone, sku: '', assets: [], upload: u, type: typeOf(uploadPieceKey(u.id)) })),
  ]
}

// 记住全局模型配置
let lastModel: OutfitChangeRequest['model'] = 'gpt-image-2.5'
let lastResolution: OutfitChangeRequest['resolution'] = '1K'

const RESOLUTIONS: OutfitChangeRequest['resolution'][] = ['1K', '2K', '4K']

// FLUX vto-v2 输出跟随人物图，官方上限约 4MP，因此最高只到 2K
const MODEL_OPTIONS: {
  key: OutfitChangeRequest['model']
  label: string
  desc: string
  resolutions: OutfitChangeRequest['resolution'][]
}[] = [
  { key: 'gpt-image-2.5', label: 'GPT Image 2.5', desc: '中文理解强，智能路由', resolutions: RESOLUTIONS },
  { key: 'flux-vto', label: 'FLUX Try-On', desc: 'BFL 官方虚拟试穿，保持脸部与姿势', resolutions: ['1K', '2K'] },
]

// 与画布其余界面一致的冷灰（slate）色板
const C = {
  ink: '#1e232d',
  text: '#3a4150',
  muted: '#687083',
  subtle: '#98a0ae',
  line: '#e7e9ee',
  lineStrong: '#d5d9e1',
  panel: '#f7f8fa',
  hover: '#eef1f6',
  surface: '#ffffff',
  danger: '#c43d3d',
  dangerBg: '#fdf1f1',
}

const emptyZoneState = (): ZoneState => ({
  skuInput: '',
  searchResult: null,
  searching: false,
  searchError: null,
  selected: [],
  uploads: [],
  types: {},
})

export const OutfitChangeModal: React.FC<Props> = ({ image, onClose, onSubmit }) => {
  const [activeZoneKey, setActiveZoneKey] = useState<string>('upper')
  const [zoneStates, setZoneStates] = useState<Record<string, ZoneState>>(() =>
    Object.fromEntries(OUTFIT_ZONES.map((z) => [z.key, emptyZoneState()]))
  )
  const [isDragOver, setIsDragOver] = useState(false)

  const [model, setModel] = useState<OutfitChangeRequest['model']>(lastModel)
  const [resolution, setResolution] = useState<OutfitChangeRequest['resolution']>(lastResolution)
  const [batchCount, setBatchCount] = useState(1)
  const [extraPrompt, setExtraPrompt] = useState('')
  const [modelMenuOpen, setModelMenuOpen] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  const skuInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const modelMenuRef = useRef<HTMLDivElement>(null)

  const activeZone = OUTFIT_ZONES.find((z) => z.key === activeZoneKey) || OUTFIT_ZONES[0]
  const activeState = zoneStates[activeZone.key]

  const pieces = useMemo(() => OUTFIT_ZONES.flatMap((z) => zonePieces(z, zoneStates[z.key])), [zoneStates])
  const activePieces = pieces.filter((p) => p.zone.key === activeZone.key)
  const totalSelected = pieces.reduce((n, p) => n + pieceCount(p), 0)
  const maxRefs = DEFAULT_MAX_REFS
  const remaining = maxRefs - totalSelected

  const zoneCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    pieces.forEach((p) => {
      counts[p.zone.key] = (counts[p.zone.key] || 0) + pieceCount(p)
    })
    return counts
  }, [pieces])

  const updateZone = useCallback((key: string, patch: Partial<ZoneState>) => {
    setZoneStates((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }))
  }, [])

  const setPieceType = (zoneKey: string, pieceKey: string, type: string) => {
    setZoneStates((prev) => ({
      ...prev,
      [zoneKey]: { ...prev[zoneKey], types: { ...prev[zoneKey].types, [pieceKey]: type } },
    }))
  }

  const selectZone = (zoneKey: string) => setActiveZoneKey(zoneKey)

  useEffect(() => {
    const t = setTimeout(() => skuInputRef.current?.focus(), 60)
    return () => clearTimeout(t)
  }, [activeZoneKey])

  // 卸载时释放所有本地预览 URL
  useEffect(() => {
    return () => {
      Object.values(zoneStates).forEach((st) => st.uploads.forEach((u) => URL.revokeObjectURL(u.previewUrl)))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (preview) setPreview(null)
      else if (modelMenuOpen) setModelMenuOpen(false)
      else if (!submitting) onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [preview, modelMenuOpen, submitting, onClose])

  // 模型下拉：点击外部收起
  useEffect(() => {
    if (!modelMenuOpen) return
    const onDown = (e: MouseEvent) => {
      if (!modelMenuRef.current?.contains(e.target as Node)) setModelMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [modelMenuOpen])

  const assetKey = (a: OutfitAsset) => `${a.id}|${a.sku}`
  const activeSelectedKeys = useMemo(() => new Set(activeState.selected.map(assetKey)), [activeState.selected])

  const handleSearch = async () => {
    const zone = activeZone
    const state = zoneStates[zone.key]
    const skus = Array.from(new Set(state.skuInput.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean)))
    if (skus.length === 0) {
      updateZone(zone.key, { searchError: `请输入${zone.label}货号` })
      skuInputRef.current?.focus()
      return
    }

    updateZone(zone.key, { searching: true, searchError: null })
    try {
      const result = await searchOutfitAssets(skus)
      const newKeys = new Set(result.items.flatMap((it) => it.assets.map(assetKey)))
      const kept = state.selected.filter((a) => newKeys.has(assetKey(a)))

      let errorMsg: string | null = null
      if (!result.library_exists) errorMsg = '未挂载商品素材库，可用「上传」添加图片'
      else if (!result.items.some((it) => it.found)) errorMsg = `未找到货号：${skus.join(', ')}`

      updateZone(zone.key, {
        searching: false,
        searchResult: result,
        searchError: errorMsg,
        // 检索只展示素材，选择权交给用户，不自动勾选任何角度图。
        selected: kept,
      })
    } catch (err: any) {
      updateZone(zone.key, { searching: false, searchError: err?.message || '检索失败，请重试' })
    }
  }

  const toggleAsset = (asset: OutfitAsset) => {
    const key = assetKey(asset)
    if (activeSelectedKeys.has(key)) {
      updateZone(activeZone.key, { selected: activeState.selected.filter((a) => assetKey(a) !== key) })
    } else if (remaining > 0) {
      updateZone(activeZone.key, { selected: [...activeState.selected, asset] })
    }
  }

  const removeAsset = (zoneKey: string, asset: OutfitAsset) => {
    const st = zoneStates[zoneKey]
    updateZone(zoneKey, { selected: st.selected.filter((a) => assetKey(a) !== assetKey(asset)) })
  }

  const addFiles = (files: FileList | File[]) => {
    const valid = Array.from(files).filter((f) => ACCEPTED_UPLOAD_TYPES.includes(f.type))
    if (valid.length === 0) return
    const toAdd = valid.slice(0, Math.max(0, remaining)).map((file) => ({
      id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }))
    updateZone(activeZone.key, { uploads: [...activeState.uploads, ...toAdd] })
  }

  const removeUpload = (zoneKey: string, id: string) => {
    const st = zoneStates[zoneKey]
    const target = st.uploads.find((u) => u.id === id)
    if (target) URL.revokeObjectURL(target.previewUrl)
    updateZone(zoneKey, { uploads: st.uploads.filter((u) => u.id !== id) })
  }

  const canSubmit = totalSelected > 0 && !submitting

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setSubmitError(null)
    lastModel = model
    lastResolution = resolution

    // 部位与品类在提交时按单品统一计算，素材本身不记部位
    const assets = pieces.flatMap((p) => p.assets.map((a) => ({ ...a, slot: pieceSlot(p), item: pieceItemKey(p) })))
    const uploadPieces = pieces.filter((p) => p.upload)
    const uploads = uploadPieces.map((p) => p.upload!.file)
    const uploadSlots = uploadPieces.map(pieceSlot)
    const uploadItems = uploadPieces.map(pieceItemKey)
    const targetSlots = Array.from(new Set(pieces.map(pieceSlot)))
    try {
      await onSubmit({
        sourceUrl: image.url,
        sourceName: image.name,
        assets,
        uploads,
        uploadSlots,
        uploadItems,
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

  const currentModel = MODEL_OPTIONS.find((m) => m.key === model) || MODEL_OPTIONS[0]
  const hasActiveContent = !!activeState.searchResult || activeState.uploads.length > 0
  const pieceLabels = Array.from(new Set(pieces.map(pieceLabel)))

  // 同一部位多件单品：未标注或品类重复时提示标注，上衣含外套时说明叠穿关系
  const layeringHint = (() => {
    if (activePieces.length < 2 || !hasTypes(activeZone)) return null
    const types = activePieces.map((p) => p.type)
    if (types.includes('') || new Set(types).size < types.length) {
      return {
        warn: true,
        text: `${activeZone.label}有 ${activePieces.length} 件单品，请为每件标注品类${
          activeZone.key === 'upper' ? '（如 外套 + T恤），AI 会按内外层叠穿' : '，避免混淆'
        }`,
      }
    }
    if (activeZone.key === 'upper' && types.includes('outerwear')) {
      const inner = activePieces.filter((p) => p.type !== 'outerwear').map(pieceLabel)
      return { warn: false, text: `将按「外套在外、${inner.join('、')}内搭」叠穿` }
    }
    return null
  })()

  const renderTypeSelect = (pieceKey: string, value: string) => (
    <select
      className="oc-type"
      value={value}
      aria-label="品类"
      onChange={(e) => setPieceType(activeZone.key, pieceKey, e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      style={styles.typeSelect}
    >
      {typeOptions(activeZone).map((o) => (
        <option key={o.key} value={o.key}>
          {o.label}
        </option>
      ))}
    </select>
  )
  const sourceUrl = normalizeAssetUrl(image.url)

  const onTileKey = (e: React.KeyboardEvent, fn: () => void) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      fn()
    }
  }

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
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="outfit-change-title"
        style={styles.dialog}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div style={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={styles.headerIcon}>
              <Shirt size={15} strokeWidth={1.9} />
            </div>
            <div>
              <div id="outfit-change-title" style={styles.title}>AI 换装</div>
              <div style={styles.subtitle}>选择部位并添加单品参考图，未选择的部位保持原样</div>
            </div>
          </div>
          <button
            type="button"
            className="oc-icon-btn"
            onClick={onClose}
            disabled={submitting}
            style={styles.iconButton}
            title="关闭 (Esc)"
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>

        <div style={styles.body}>
          {/* ── 左栏：原图 + 换装部位 ── */}
          <aside className="oc-left" style={styles.leftCol}>
            <div style={styles.sectionLabel}>原图</div>
            <button
              type="button"
              className="oc-source"
              style={styles.sourceCard}
              onClick={() => setPreview(sourceUrl)}
              title="查看原图"
            >
              <div style={styles.sourceThumb}>
                <img src={sourceUrl} alt="" style={styles.containImg} draggable={false} />
              </div>
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <div style={styles.sourceName}>{image.name || '未命名图片'}</div>
                <div style={styles.sourceHint}>以此图为基础生成</div>
              </div>
              <Maximize2 size={13} color={C.subtle} style={{ flexShrink: 0 }} />
            </button>

            <div style={{ ...styles.sectionLabel, marginTop: 18 }}>
              换装部位
              <span style={styles.sectionHint}>点击人台切换</span>
            </div>
            <div style={styles.mannequinWrap}>
              <InteractiveMannequin
                activeZone={activeZone.key}
                zoneCounts={zoneCounts}
                onSelectZone={selectZone}
                disabled={submitting}
              />
            </div>
          </aside>

          {/* ── 中栏：当前单品的素材检索 ── */}
          <section style={styles.centerCol}>
            <div style={styles.centerHead}>
              <div style={styles.zoneTitle}>{activeZone.label}</div>
              {hasTypes(activeZone) && (
                <div style={styles.zoneHint}>
                  可直接添加；选中后可标注品类：{activeZone.items.map((i) => i.label).join(' / ')}
                </div>
              )}
            </div>

            {/* 货号检索 */}
            <div style={styles.searchRow}>
              <div className="oc-search" style={styles.searchBox}>
                <Search size={14} color={C.subtle} style={{ flexShrink: 0 }} />
                <input
                  ref={skuInputRef}
                  type="text"
                  value={activeState.skuInput}
                  onChange={(e) => updateZone(activeZone.key, { skuInput: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleSearch()
                    }
                  }}
                  placeholder={`输入${activeZone.label}货号`}
                  aria-label={`${activeZone.label}货号`}
                  style={styles.searchInput}
                  disabled={activeState.searching}
                />
                <button
                  type="button"
                  className="oc-search-btn"
                  onClick={handleSearch}
                  disabled={activeState.searching}
                  style={styles.searchBtn}
                >
                  {activeState.searching ? (
                    <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                  ) : (
                    '检索'
                  )}
                </button>
              </div>
              <button
                type="button"
                className="oc-ghost"
                onClick={() => fileInputRef.current?.click()}
                style={styles.ghostBtn}
                title="上传本地图片（PNG / JPG / WebP）"
              >
                <ImagePlus size={14} />
                <span>上传图片</span>
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
            {activeState.searchError ? (
              <div style={styles.errorNotice} role="alert">
                <AlertCircle size={13} style={{ flexShrink: 0 }} />
                <span>{activeState.searchError}</span>
              </div>
            ) : (
              <div style={styles.searchHint}>
                {activeState.searchResult
                  ? '点击图片选择要提供给 AI 的角度，可跨货号多选'
                  : '多个货号用空格或逗号分隔，回车检索'}
              </div>
            )}
            {layeringHint && (
              <div style={{ ...styles.layerNotice, ...(layeringHint.warn ? styles.layerNoticeWarn : null) }}>
                <AlertCircle size={13} style={{ flexShrink: 0 }} />
                <span>{layeringHint.text}</span>
              </div>
            )}

            {/* 素材区（支持拖拽上传） */}
            <div
              style={styles.assetArea}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('Files')) {
                  e.preventDefault()
                  setIsDragOver(true)
                }
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsDragOver(false)
              }}
              onDrop={(e) => {
                e.preventDefault()
                setIsDragOver(false)
                if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files)
              }}
            >
              {activeState.searchResult?.items.map((group) => {
                const picked = group.assets.filter((a) => activeSelectedKeys.has(assetKey(a))).length
                return (
                  <div key={group.sku} style={styles.group}>
                    <div style={styles.groupHeader}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={styles.groupSku}>{group.sku}</span>
                        {group.found && picked > 0 && hasTypes(activeZone) &&
                          renderTypeSelect(
                            skuPieceKey(group.sku),
                            activePieces.find((p) => p.key === skuPieceKey(group.sku))?.type ?? defaultType(activeZone)
                          )}
                      </span>
                      {group.found ? (
                        <span style={{ color: picked ? C.text : C.subtle }}>
                          已选 {picked} / {group.assets.length}
                        </span>
                      ) : (
                        <span style={{ color: C.danger }}>未找到</span>
                      )}
                    </div>
                    {group.found && (
                      <div style={styles.grid}>
                        {group.assets.map((asset) => {
                          const isSelected = activeSelectedKeys.has(assetKey(asset))
                          const blocked = !isSelected && remaining <= 0
                          return (
                            <div
                              key={assetKey(asset)}
                              role="checkbox"
                              aria-checked={isSelected}
                              aria-disabled={blocked}
                              aria-label={`${asset.sku} ${asset.angle}`}
                              tabIndex={0}
                              className="oc-tile"
                              onClick={() => toggleAsset(asset)}
                              onKeyDown={(e) => onTileKey(e, () => toggleAsset(asset))}
                              title={blocked ? `最多 ${maxRefs} 张参考图` : `${asset.angle} · ${asset.type_label}`}
                              style={{
                                ...styles.tile,
                                ...(isSelected ? styles.tileSelected : null),
                                ...(blocked ? styles.tileBlocked : null),
                              }}
                            >
                              <div style={styles.tileImgBox}>
                                <img src={asset.thumb_url} alt="" loading="lazy" style={styles.containImg} draggable={false} />
                                <div style={{ ...styles.tileCheck, ...(isSelected ? styles.tileCheckOn : null) }}>
                                  {isSelected && <Check size={11} strokeWidth={3} />}
                                </div>
                                <button
                                  type="button"
                                  className="oc-tile-zoom"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setPreview(asset.url)
                                  }}
                                  style={styles.tileZoom}
                                  title="查看大图"
                                  aria-label="查看大图"
                                >
                                  <Maximize2 size={11} />
                                </button>
                              </div>
                              <div style={styles.tileLabel}>{asset.angle}</div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}

              {activeState.uploads.length > 0 && (
                <div style={styles.group}>
                  <div style={styles.groupHeader}>
                    <span style={styles.groupSku}>本地上传</span>
                    <span style={{ color: C.text }}>{activeState.uploads.length} 张</span>
                  </div>
                  <div style={styles.grid}>
                    {activeState.uploads.map((u, idx) => (
                      <div key={u.id} className="oc-tile" style={{ ...styles.tile, ...styles.tileSelected }}>
                        <div style={styles.tileImgBox}>
                          <img src={u.previewUrl} alt="" style={styles.containImg} draggable={false} />
                          <button
                            type="button"
                            onClick={() => removeUpload(activeZone.key, u.id)}
                            style={styles.tileRemove}
                            title="移除"
                            aria-label="移除"
                          >
                            <X size={11} />
                          </button>
                        </div>
                        {hasTypes(activeZone) ? (
                          <div style={{ padding: '5px 0 1px' }}>
                            {renderTypeSelect(
                              uploadPieceKey(u.id),
                              activePieces.find((p) => p.key === uploadPieceKey(u.id))?.type ?? defaultType(activeZone)
                            )}
                          </div>
                        ) : (
                          <div style={styles.tileLabel}>上传 {idx + 1}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!hasActiveContent && (
                <div
                  role="button"
                  tabIndex={0}
                  className="oc-dropzone"
                  style={styles.emptyState}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => onTileKey(e, () => fileInputRef.current?.click())}
                >
                  <div style={styles.emptyIcon}>
                    <UploadCloud size={20} strokeWidth={1.6} />
                  </div>
                  <div style={styles.emptyTitle}>添加{activeZone.label}参考图</div>
                  <div style={styles.emptyHint}>在上方输入货号自动带出多角度图</div>
                  <div style={styles.emptyHint}>或将图片拖到这里、点击选择本地文件</div>
                  <div style={styles.emptyMeta}>PNG / JPG / WebP · 全部部位合计最多 {maxRefs} 张</div>
                </div>
              )}

              {isDragOver && (
                <div style={styles.dropOverlay}>
                  <UploadCloud size={22} strokeWidth={1.6} />
                  <span>松开即可添加为{activeZone.label}参考图</span>
                </div>
              )}
            </div>
          </section>

          {/* ── 右栏：换装清单 + 生成设置 + 提交 ── */}
          <aside className="oc-right" style={styles.rightCol}>
            <div style={styles.rightScroll}>
              <div style={styles.cartHead}>
                <span style={styles.sectionLabelInline}>换装清单</span>
                <span style={{ ...styles.cartCount, color: remaining <= 0 ? C.ink : C.muted }}>
                  {totalSelected} / {maxRefs}
                </span>
              </div>
              <div style={styles.meter} aria-hidden>
                <div style={{ ...styles.meterFill, width: `${(totalSelected / maxRefs) * 100}%` }} />
              </div>

              {pieces.length === 0 ? (
                <div style={styles.cartEmpty}>
                  还没有选择单品
                  <br />
                  在中间选择参考图后会出现在这里
                </div>
              ) : (
                <div style={styles.cartList}>
                  {pieces.map((p) => {
                    const isCur = p.zone.key === activeZone.key
                    return (
                      <div
                        key={`${p.zone.key}|${p.key}`}
                        role="button"
                        tabIndex={0}
                        className="oc-cart-item"
                        onClick={() => setActiveZoneKey(p.zone.key)}
                        onKeyDown={(e) => onTileKey(e, () => setActiveZoneKey(p.zone.key))}
                        style={{ ...styles.cartItem, ...(isCur ? styles.cartItemActive : null) }}
                      >
                        <div style={styles.cartItemHead}>
                          <span style={{ fontWeight: 600, color: C.ink }}>
                            {pieceLabel(p)}
                            {hasTypes(p.zone) && p.type === '' && (
                              <span style={{ fontWeight: 400, color: C.subtle }}> · {AUTO_LABEL}</span>
                            )}
                          </span>
                          <span style={styles.cartItemMeta}>
                            {p.sku || '本地上传'} · {pieceCount(p)} 张
                          </span>
                        </div>
                        <div style={styles.cartThumbs}>
                          {p.assets.map((a) => (
                            <div key={assetKey(a)} className="oc-mini" style={styles.miniThumb} title={`${a.sku} · ${a.angle}`}>
                              <img src={a.thumb_url} alt="" style={styles.containImg} draggable={false} />
                              <button
                                type="button"
                                className="oc-mini-remove"
                                style={styles.miniRemove}
                                aria-label="移除"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  removeAsset(p.zone.key, a)
                                }}
                              >
                                <X size={9} />
                              </button>
                            </div>
                          ))}
                          {p.upload && (
                            <div className="oc-mini" style={styles.miniThumb}>
                              <img src={p.upload.previewUrl} alt="" style={styles.containImg} draggable={false} />
                              <button
                                type="button"
                                className="oc-mini-remove"
                                style={styles.miniRemove}
                                aria-label="移除"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  removeUpload(p.zone.key, p.upload!.id)
                                }}
                              >
                                <X size={9} />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              <div style={styles.divider} />

              <div style={styles.sectionLabelInline}>生成设置</div>
              <div style={styles.field}>
                <div style={styles.fieldLabel}>模型</div>
                <div ref={modelMenuRef} style={{ position: 'relative' }}>
                  <button
                    type="button"
                    className="oc-select"
                    aria-haspopup="listbox"
                    aria-expanded={modelMenuOpen}
                    onClick={() => setModelMenuOpen((v) => !v)}
                    style={{ ...styles.select, ...(modelMenuOpen ? styles.selectOpen : null) }}
                  >
                    <span style={styles.selectValue}>{currentModel.label}</span>
                    <ChevronDown
                      size={14}
                      color={C.muted}
                      style={{ flexShrink: 0, transition: 'transform .15s ease', transform: modelMenuOpen ? 'rotate(180deg)' : 'none' }}
                    />
                  </button>
                  {modelMenuOpen && (
                    <div role="listbox" aria-label="模型" style={styles.menu}>
                      {MODEL_OPTIONS.map((opt) => {
                        const on = model === opt.key
                        return (
                          <button
                            key={opt.key}
                            type="button"
                            role="option"
                            aria-selected={on}
                            className="oc-menu-item"
                            onClick={() => {
                              setModel(opt.key)
                              if (!opt.resolutions.includes(resolution)) {
                                setResolution(opt.resolutions[opt.resolutions.length - 1])
                              }
                              setModelMenuOpen(false)
                            }}
                            style={styles.menuItem}
                          >
                            <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                              <span style={{ display: 'block', fontSize: 12.5, fontWeight: on ? 600 : 500, color: C.ink }}>
                                {opt.label}
                              </span>
                              <span style={{ display: 'block', fontSize: 11, color: C.muted, marginTop: 2 }}>{opt.desc}</span>
                            </span>
                            {on && <Check size={14} color={C.ink} style={{ flexShrink: 0 }} />}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
                <div style={styles.fieldHint}>{currentModel.desc}</div>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ ...styles.field, flex: 1 }}>
                  <div style={styles.fieldLabel}>分辨率</div>
                  <div style={styles.segment}>
                    {RESOLUTIONS.map((r) => {
                      const unsupported = !currentModel.resolutions.includes(r)
                      return (
                        <button
                          key={r}
                          type="button"
                          aria-pressed={resolution === r}
                          disabled={unsupported}
                          title={unsupported ? `${currentModel.label} 最高支持 ${currentModel.resolutions[currentModel.resolutions.length - 1]}` : undefined}
                          className="oc-seg"
                          onClick={() => setResolution(r)}
                          style={{
                            ...styles.segmentItem,
                            ...(resolution === r ? styles.segmentActive : null),
                            ...(unsupported ? styles.segmentDisabled : null),
                          }}
                        >
                          {r}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div style={{ ...styles.field, flex: 1 }}>
                  <div style={styles.fieldLabel}>生成数量</div>
                  <div style={styles.segment}>
                    {[1, 2, 4].map((n) => (
                      <button
                        key={n}
                        type="button"
                        aria-pressed={batchCount === n}
                        className="oc-seg"
                        onClick={() => setBatchCount(n)}
                        style={{ ...styles.segmentItem, ...(batchCount === n ? styles.segmentActive : null) }}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div style={styles.field}>
                <div style={styles.fieldLabel}>
                  补充指令<span style={{ color: C.subtle, fontWeight: 400 }}>（可选）</span>
                </div>
                <textarea
                  value={extraPrompt}
                  onChange={(e) => setExtraPrompt(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="如：上衣下摆塞进裤腰、袖口微挽"
                  className="oc-textarea"
                  style={styles.textarea}
                />
              </div>
            </div>

            <div style={styles.submitBar}>
              {submitError && (
                <div style={{ ...styles.errorNotice, margin: '0 0 10px' }} role="alert">
                  <AlertCircle size={13} style={{ flexShrink: 0 }} />
                  <span>{submitError}</span>
                </div>
              )}
              <button
                type="button"
                className="oc-primary"
                onClick={handleSubmit}
                disabled={!canSubmit}
                style={{ ...styles.primaryBtn, ...(canSubmit ? null : styles.primaryBtnDisabled) }}
              >
                {submitting ? (
                  <>
                    <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                    <span>提交中…</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={14} />
                    <span style={styles.primaryLabel}>
                      {totalSelected === 0 ? '开始换装' : `换装 ${pieceLabels.join(' + ')}`}
                    </span>
                  </>
                )}
              </button>
              <div style={styles.submitHint}>
                {totalSelected === 0
                  ? '至少选择 1 张参考图'
                  : `生成 ${batchCount} 张 · ${resolution} · 完成后放在原图右侧`}
              </div>
            </div>
          </aside>
        </div>

        {preview && (
          <div style={styles.lightbox} onClick={() => setPreview(null)}>
            <div style={styles.lightboxBox} onClick={(e) => e.stopPropagation()}>
              <img src={preview} alt="" style={styles.lightboxImg} />
              <button type="button" onClick={() => setPreview(null)} style={styles.lightboxClose} aria-label="关闭预览">
                <X size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
      <style>{`
        [data-modal="outfit-change"] .mannequin-shell { animation: outfit-rise .45s cubic-bezier(.2,.8,.2,1) both; }
        [data-modal="outfit-change"] button { font-family: inherit; }
        [data-modal="outfit-change"] :focus-visible { outline: 2px solid ${C.ink}; outline-offset: 2px; }
        [data-modal="outfit-change"] .oc-icon-btn:hover:not(:disabled) { background: ${C.hover}; color: ${C.ink}; }
        [data-modal="outfit-change"] .oc-source:hover { border-color: ${C.lineStrong}; background: ${C.surface}; }
        [data-modal="outfit-change"] .oc-type:hover { border-color: ${C.subtle}; }
        [data-modal="outfit-change"] .oc-type:focus-visible { outline: 2px solid ${C.ink}; outline-offset: 1px; }
        [data-modal="outfit-change"] .oc-search:focus-within { border-color: ${C.ink}; box-shadow: 0 0 0 3px rgba(30,35,45,.08); }
        [data-modal="outfit-change"] .oc-search :focus-visible { outline: none; }
        [data-modal="outfit-change"] .oc-search-btn:hover:not(:disabled) { background: #2d3442; }
        [data-modal="outfit-change"] .oc-ghost:hover { background: ${C.hover}; border-color: ${C.lineStrong}; color: ${C.ink}; }
        [data-modal="outfit-change"] .oc-tile { transition: border-color .15s ease, box-shadow .15s ease, transform .15s ease; }
        [data-modal="outfit-change"] .oc-tile:hover:not([aria-disabled="true"]) { border-color: ${C.subtle}; box-shadow: 0 6px 16px rgba(20, 30, 50, .08); transform: translateY(-1px); }
        [data-modal="outfit-change"] .oc-tile[aria-checked="true"]:hover { border-color: ${C.ink}; }
        [data-modal="outfit-change"] .oc-tile:hover .oc-tile-zoom, [data-modal="outfit-change"] .oc-tile:focus-within .oc-tile-zoom { opacity: 1; }
        [data-modal="outfit-change"] .oc-dropzone:hover { border-color: ${C.subtle}; background: ${C.hover}; }
        [data-modal="outfit-change"] .mq-label:focus { outline: none; }
        [data-modal="outfit-change"] .mq-label:focus-visible rect { stroke: ${C.ink}; stroke-width: 1.4px; }
        [data-modal="outfit-change"] .oc-cart-item:hover { border-color: ${C.lineStrong}; }
        [data-modal="outfit-change"] .oc-mini-remove { opacity: 0; transition: opacity .12s ease; }
        [data-modal="outfit-change"] .oc-mini:hover .oc-mini-remove, [data-modal="outfit-change"] .oc-mini-remove:focus-visible { opacity: 1; }
        [data-modal="outfit-change"] .oc-select:hover { border-color: ${C.subtle}; }
        [data-modal="outfit-change"] .oc-menu-item:hover, [data-modal="outfit-change"] .oc-menu-item[aria-selected="true"] { background: ${C.hover}; }
        [data-modal="outfit-change"] .oc-seg:hover:not(:disabled) { color: ${C.ink}; }
        [data-modal="outfit-change"] .oc-textarea:focus { border-color: ${C.ink}; box-shadow: 0 0 0 3px rgba(30,35,45,.08); outline: none; }
        [data-modal="outfit-change"] .oc-primary:hover:not(:disabled) { background: #2d3442; }
        [data-modal="outfit-change"] input::placeholder, [data-modal="outfit-change"] textarea::placeholder { color: ${C.subtle}; }
        @media (max-width: 1100px) { [data-modal="outfit-change"] .oc-left { width: 224px !important; } [data-modal="outfit-change"] .oc-right { width: 264px !important; } }
        @media (max-width: 860px) { [data-modal="outfit-change"] .oc-left { width: 196px !important; padding: 12px !important; } [data-modal="outfit-change"] .oc-right { width: 236px !important; } }
        @keyframes outfit-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(20, 24, 32, 0.32)',
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
    height: 'min(720px, 90vh)',
    backgroundColor: C.surface,
    borderRadius: 14,
    boxShadow: '0 24px 70px rgba(20, 30, 50, 0.18), 0 0 0 1px rgba(20, 30, 50, .06)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    color: C.text,
  },
  header: {
    height: 60,
    padding: '0 16px 0 20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottom: `1px solid ${C.line}`,
    flexShrink: 0,
  },
  headerIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: C.panel,
    border: `1px solid ${C.line}`,
    color: C.ink,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 15,
    fontWeight: 650,
    color: C.ink,
    letterSpacing: '-0.01em',
    lineHeight: 1.2,
  },
  subtitle: {
    fontSize: 11.5,
    color: C.muted,
    marginTop: 2,
  },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    border: 'none',
    backgroundColor: 'transparent',
    color: C.muted,
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

  // ── 左栏 ──
  leftCol: {
    width: 260,
    flexShrink: 0,
    borderRight: `1px solid ${C.line}`,
    backgroundColor: C.panel,
    padding: '16px 16px 12px',
    display: 'flex',
    flexDirection: 'column',
    overflowY: 'auto',
  },
  sectionLabel: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    fontSize: 11,
    fontWeight: 600,
    color: C.muted,
    letterSpacing: '0.04em',
    marginBottom: 8,
  },
  sectionLabelInline: {
    fontSize: 11,
    fontWeight: 600,
    color: C.muted,
    letterSpacing: '0.04em',
  },
  sectionHint: {
    fontWeight: 400,
    color: C.subtle,
    letterSpacing: 0,
  },
  sourceCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    padding: 8,
    borderRadius: 10,
    border: `1px solid ${C.line}`,
    backgroundColor: 'rgba(255,255,255,.7)',
    cursor: 'zoom-in',
    transition: 'border-color .15s ease, background .15s ease',
  },
  sourceThumb: {
    width: 52,
    height: 64,
    borderRadius: 6,
    overflow: 'hidden',
    flexShrink: 0,
    backgroundColor: C.hover,
    border: `1px solid ${C.line}`,
  },
  sourceName: {
    fontSize: 12,
    fontWeight: 600,
    color: C.ink,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  sourceHint: {
    fontSize: 11,
    color: C.muted,
    marginTop: 3,
  },
  mannequinWrap: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '14px 10px',
    borderRadius: 10,
    border: `1px solid ${C.line}`,
    backgroundColor: C.surface,
    backgroundImage: 'radial-gradient(rgba(30,35,45,.07) 1px, transparent 1px)',
    backgroundSize: '14px 14px',
  },

  // ── 中栏 ──
  centerCol: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    padding: '16px 20px 0',
  },
  centerHead: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 12,
    height: 32,
    marginBottom: 12,
  },
  zoneTitle: {
    fontSize: 16,
    fontWeight: 650,
    color: C.ink,
    letterSpacing: '-0.01em',
  },
  zoneHint: {
    fontSize: 11.5,
    color: C.subtle,
  },
  searchRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },
  searchBox: {
    flex: 1,
    height: 38,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '0 4px 0 12px',
    borderRadius: 9,
    border: `1px solid ${C.lineStrong}`,
    backgroundColor: C.surface,
    transition: 'border-color .15s ease, box-shadow .15s ease',
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontSize: 13,
    color: C.ink,
    userSelect: 'text',
  },
  searchBtn: {
    height: 30,
    minWidth: 56,
    padding: '0 14px',
    borderRadius: 7,
    border: 'none',
    backgroundColor: C.ink,
    color: '#fff',
    fontSize: 12,
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'background .15s ease',
  },
  ghostBtn: {
    height: 38,
    padding: '0 14px',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    borderRadius: 9,
    border: `1px solid ${C.lineStrong}`,
    backgroundColor: C.surface,
    color: C.text,
    fontSize: 12.5,
    fontWeight: 500,
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'background .15s ease, border-color .15s ease, color .15s ease',
  },
  searchHint: {
    fontSize: 11,
    color: C.subtle,
    margin: '8px 2px 0',
    minHeight: 16,
  },
  layerNotice: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    margin: '8px 0 0',
    padding: '6px 10px',
    borderRadius: 7,
    backgroundColor: C.hover,
    color: C.text,
    fontSize: 11.5,
    lineHeight: 1.4,
  },
  layerNoticeWarn: {
    backgroundColor: '#fdf6e7',
    color: '#8a5a12',
  },
  typeSelect: {
    height: 24,
    maxWidth: '100%',
    padding: '0 6px',
    borderRadius: 6,
    border: `1px solid ${C.lineStrong}`,
    backgroundColor: C.surface,
    color: C.ink,
    fontSize: 11.5,
    fontWeight: 500,
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  errorNotice: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    margin: '8px 0 0',
    padding: '6px 10px',
    borderRadius: 7,
    backgroundColor: C.dangerBg,
    color: C.danger,
    fontSize: 11.5,
    lineHeight: 1.4,
  },
  assetArea: {
    position: 'relative',
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    margin: '14px -20px 0',
    padding: '2px 20px 20px',
  },
  group: {
    marginBottom: 18,
  },
  groupHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: 11.5,
    marginBottom: 8,
  },
  groupSku: {
    fontWeight: 650,
    color: C.ink,
    letterSpacing: '0.03em',
    fontVariantNumeric: 'tabular-nums',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))',
    gap: 10,
  },
  tile: {
    position: 'relative',
    borderRadius: 10,
    border: `1px solid ${C.line}`,
    backgroundColor: C.surface,
    padding: 4,
    cursor: 'pointer',
  },
  tileSelected: {
    borderColor: C.ink,
    boxShadow: `0 0 0 1px ${C.ink}`,
  },
  tileBlocked: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },
  tileImgBox: {
    position: 'relative',
    width: '100%',
    aspectRatio: '3 / 4',
    borderRadius: 7,
    overflow: 'hidden',
    backgroundColor: C.panel,
  },
  tileCheck: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    border: '1.5px solid rgba(255,255,255,.95)',
    backgroundColor: 'rgba(20,24,32,.18)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 1px 3px rgba(0,0,0,.15)',
  },
  tileCheckOn: {
    backgroundColor: C.ink,
    borderColor: C.ink,
  },
  tileZoom: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 22,
    height: 22,
    borderRadius: 6,
    border: 'none',
    backgroundColor: 'rgba(255,255,255,.92)',
    color: C.ink,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'zoom-in',
    opacity: 0,
    transition: 'opacity .15s ease',
    boxShadow: '0 1px 3px rgba(0,0,0,.12)',
  },
  tileRemove: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 20,
    height: 20,
    borderRadius: 10,
    border: 'none',
    backgroundColor: 'rgba(20,24,32,.72)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  tileLabel: {
    fontSize: 11,
    color: C.text,
    textAlign: 'center',
    padding: '6px 2px 2px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  emptyState: {
    height: '100%',
    minHeight: 240,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    textAlign: 'center',
    borderRadius: 12,
    border: `1.5px dashed ${C.lineStrong}`,
    backgroundColor: C.panel,
    cursor: 'pointer',
    transition: 'border-color .15s ease, background .15s ease',
  },
  emptyIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: C.surface,
    border: `1px solid ${C.line}`,
    color: C.muted,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 13.5,
    fontWeight: 600,
    color: C.ink,
  },
  emptyHint: {
    fontSize: 12,
    color: C.muted,
    lineHeight: 1.6,
  },
  emptyMeta: {
    marginTop: 12,
    padding: '3px 10px',
    borderRadius: 999,
    backgroundColor: C.surface,
    border: `1px solid ${C.line}`,
    fontSize: 10.5,
    color: C.subtle,
  },
  dropOverlay: {
    position: 'absolute',
    inset: '2px 20px 20px',
    borderRadius: 12,
    border: `1.5px dashed ${C.ink}`,
    backgroundColor: 'rgba(247,248,250,.94)',
    color: C.ink,
    fontSize: 13,
    fontWeight: 600,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    pointerEvents: 'none',
  },

  // ── 右栏 ──
  rightCol: {
    width: 300,
    flexShrink: 0,
    borderLeft: `1px solid ${C.line}`,
    backgroundColor: C.panel,
    display: 'flex',
    flexDirection: 'column',
  },
  rightScroll: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: '16px 16px 12px',
  },
  cartHead: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  cartCount: {
    fontSize: 12,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
  meter: {
    height: 4,
    borderRadius: 2,
    backgroundColor: C.line,
    overflow: 'hidden',
    margin: '8px 0 12px',
  },
  meterFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: C.ink,
    transition: 'width .2s ease',
  },
  cartEmpty: {
    padding: '18px 12px',
    borderRadius: 10,
    border: `1px dashed ${C.lineStrong}`,
    fontSize: 11.5,
    lineHeight: 1.7,
    color: C.subtle,
    textAlign: 'center',
  },
  cartList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  cartItem: {
    padding: '9px 10px 10px',
    borderRadius: 10,
    border: `1px solid ${C.line}`,
    backgroundColor: C.surface,
    cursor: 'pointer',
    transition: 'border-color .15s ease',
  },
  cartItemActive: {
    borderColor: C.ink,
  },
  cartItemHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: 12,
    marginBottom: 8,
  },
  cartItemMeta: {
    color: C.subtle,
    maxWidth: 140,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  cartThumbs: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
  },
  miniThumb: {
    position: 'relative',
    width: 40,
    height: 50,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: C.panel,
    border: `1px solid ${C.line}`,
  },
  miniRemove: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 16,
    height: 16,
    borderRadius: 8,
    border: 'none',
    backgroundColor: 'rgba(20,24,32,.75)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    padding: 0,
  },
  divider: {
    height: 1,
    backgroundColor: C.line,
    margin: '18px 0 14px',
  },
  field: {
    marginTop: 12,
  },
  fieldLabel: {
    fontSize: 11.5,
    fontWeight: 500,
    color: C.text,
    marginBottom: 6,
  },
  select: {
    width: '100%',
    height: 36,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '0 10px 0 12px',
    borderRadius: 9,
    border: `1px solid ${C.lineStrong}`,
    backgroundColor: C.surface,
    cursor: 'pointer',
    transition: 'border-color .15s ease, box-shadow .15s ease',
  },
  selectOpen: {
    borderColor: C.ink,
    boxShadow: '0 0 0 3px rgba(30,35,45,.08)',
  },
  selectValue: {
    flex: 1,
    minWidth: 0,
    textAlign: 'left',
    fontSize: 12.5,
    fontWeight: 600,
    color: C.ink,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  menu: {
    position: 'absolute',
    top: 'calc(100% + 4px)',
    left: 0,
    right: 0,
    zIndex: 5,
    maxHeight: 240,
    overflowY: 'auto',
    padding: 4,
    borderRadius: 10,
    border: `1px solid ${C.line}`,
    backgroundColor: C.surface,
    boxShadow: '0 12px 32px rgba(20, 30, 50, .14), 0 2px 6px rgba(20, 30, 50, .05)',
  },
  menuItem: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '7px 10px',
    border: 'none',
    borderRadius: 7,
    backgroundColor: 'transparent',
    cursor: 'pointer',
  },
  fieldHint: {
    fontSize: 11,
    color: C.subtle,
    marginTop: 6,
  },
  segment: {
    display: 'flex',
    padding: 3,
    gap: 2,
    borderRadius: 8,
    backgroundColor: C.hover,
  },
  segmentItem: {
    flex: 1,
    height: 26,
    border: 'none',
    borderRadius: 6,
    backgroundColor: 'transparent',
    color: C.muted,
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    fontVariantNumeric: 'tabular-nums',
  },
  segmentDisabled: {
    color: C.lineStrong,
    cursor: 'not-allowed',
  },
  segmentActive: {
    backgroundColor: C.surface,
    color: C.ink,
    fontWeight: 600,
    boxShadow: '0 1px 2px rgba(20,30,50,.1), 0 0 0 1px rgba(20,30,50,.04)',
  },
  textarea: {
    width: '100%',
    resize: 'none',
    padding: '8px 10px',
    borderRadius: 9,
    border: `1px solid ${C.lineStrong}`,
    backgroundColor: C.surface,
    fontSize: 12,
    lineHeight: 1.55,
    color: C.ink,
    fontFamily: 'inherit',
    userSelect: 'text',
    transition: 'border-color .15s ease, box-shadow .15s ease',
  },
  submitBar: {
    flexShrink: 0,
    padding: '12px 16px 14px',
    borderTop: `1px solid ${C.line}`,
    backgroundColor: C.surface,
  },
  primaryBtn: {
    width: '100%',
    height: 42,
    borderRadius: 10,
    border: 'none',
    backgroundColor: C.ink,
    color: '#fff',
    fontSize: 13.5,
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    cursor: 'pointer',
    transition: 'background .15s ease',
    padding: '0 14px',
  },
  primaryBtnDisabled: {
    backgroundColor: C.lineStrong,
    color: '#fff',
    cursor: 'not-allowed',
  },
  primaryLabel: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  submitHint: {
    fontSize: 11,
    color: C.subtle,
    textAlign: 'center',
    marginTop: 8,
  },

  containImg: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    display: 'block',
  },

  lightbox: {
    position: 'absolute',
    inset: 0,
    zIndex: 10,
    backgroundColor: 'rgba(20, 24, 32, .55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    cursor: 'zoom-out',
  },
  lightboxBox: {
    position: 'relative',
    maxWidth: '100%',
    maxHeight: '100%',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: C.surface,
    boxShadow: '0 20px 60px rgba(0,0,0,.25)',
    cursor: 'default',
  },
  lightboxImg: {
    display: 'block',
    maxWidth: '100%',
    maxHeight: 'calc(min(720px, 90vh) - 64px)',
    objectFit: 'contain',
  },
  lightboxClose: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    border: 'none',
    backgroundColor: 'rgba(255,255,255,.92)',
    color: C.ink,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: '0 1px 4px rgba(0,0,0,.15)',
  },
}

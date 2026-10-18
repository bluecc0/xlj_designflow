import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Check,
  ImagePlus,
  Loader2,
  Maximize2,
  Search,
  SlidersHorizontal,
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
import { OUTFIT_ZONES, type OutfitZone } from './outfitZones'

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
  const [settingsOpen, setSettingsOpen] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  const skuInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const settingsRef = useRef<HTMLDivElement>(null)

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

  // 鼠标切换部位后聚焦检索框；键盘方向键切 tab 时焦点留在 tab 上，避免打断方向键导航
  const focusSearchRef = useRef(true)
  const selectZone = (zoneKey: string, focusSearch = true) => {
    focusSearchRef.current = focusSearch
    setActiveZoneKey(zoneKey)
  }

  useEffect(() => {
    if (!focusSearchRef.current) return
    const t = setTimeout(() => skuInputRef.current?.focus(), 60)
    return () => clearTimeout(t)
  }, [activeZoneKey])

  const onZoneTabsKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const idx = OUTFIT_ZONES.findIndex((z) => z.key === activeZone.key)
    const next = (idx + (e.key === 'ArrowRight' ? 1 : -1) + OUTFIT_ZONES.length) % OUTFIT_ZONES.length
    selectZone(OUTFIT_ZONES[next].key, false)
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }

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
      else if (settingsOpen) setSettingsOpen(false)
      else if (!submitting) onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [preview, settingsOpen, submitting, onClose])

  // 设置弹层：点击外部收起
  useEffect(() => {
    if (!settingsOpen) return
    const onDown = (e: MouseEvent) => {
      if (!settingsRef.current?.contains(e.target as Node)) setSettingsOpen(false)
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [settingsOpen])

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
        <div style={styles.header}>
          <div id="outfit-change-title" style={styles.title}>AI 换装</div>
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
          {/* ── 左：原图（换装只替换图中已有的单品） ── */}
          <aside className="oc-left" style={styles.leftCol}>
            <button
              type="button"
              className="oc-source"
              style={styles.sourceStage}
              onClick={() => setPreview(sourceUrl)}
              title="查看原图"
              aria-label="查看原图大图"
            >
              <img src={sourceUrl} alt="" style={styles.containImg} draggable={false} />
              <span className="oc-source-zoom" style={styles.sourceZoom}>
                <Maximize2 size={12} />
              </span>
            </button>
            <div style={styles.ruleNote}>只替换原图中已有的单品</div>
          </aside>

          {/* ── 右：部位 → 素材 ── */}
          <section style={styles.workCol}>
            <div style={styles.zoneTabs} role="tablist" aria-label="换装部位" onKeyDown={onZoneTabsKey}>
              {OUTFIT_ZONES.map((z) => {
                const on = z.key === activeZone.key
                const n = zoneCounts[z.key] || 0
                return (
                  <button
                    key={z.key}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    tabIndex={on ? 0 : -1}
                    className="oc-zone-tab"
                    disabled={submitting}
                    onClick={() => selectZone(z.key)}
                    style={{ ...styles.zoneTab, ...(on ? styles.zoneTabActive : null) }}
                  >
                    {z.label}
                    {n > 0 && <span style={{ ...styles.zoneCount, ...(on ? styles.zoneCountActive : null) }}>{n}</span>}
                  </button>
                )
              })}
            </div>

            <div style={styles.searchWrap}>
              <div className="oc-search" style={styles.searchBox}>
                <Search size={15} color={C.subtle} style={{ flexShrink: 0 }} />
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
                  placeholder={`输入${activeZone.label}货号，回车检索`}
                  aria-label={`${activeZone.label}货号`}
                  style={styles.searchInput}
                  disabled={activeState.searching}
                />
                {activeState.searching && <Loader2 size={14} color={C.muted} style={{ animation: 'spin 1s linear infinite' }} />}
                <span style={styles.searchDivider} />
                <button
                  type="button"
                  className="oc-icon-btn"
                  onClick={() => fileInputRef.current?.click()}
                  style={styles.uploadBtn}
                  title="上传本地图片（PNG / JPG / WebP）"
                  aria-label="上传本地图片"
                >
                  <ImagePlus size={16} />
                </button>
              </div>
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
              {activeState.searchError && (
                <div style={styles.errorNotice} role="alert">
                  <AlertCircle size={13} style={{ flexShrink: 0 }} />
                  <span>{activeState.searchError}</span>
                </div>
              )}
            </div>

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
                      <span style={styles.groupSku}>{group.sku}</span>
                      {group.found && picked > 0 && hasTypes(activeZone) &&
                        renderTypeSelect(
                          skuPieceKey(group.sku),
                          activePieces.find((p) => p.key === skuPieceKey(group.sku))?.type ?? defaultType(activeZone)
                        )}
                      <span style={{ marginLeft: 'auto', color: group.found ? (picked ? C.text : C.subtle) : C.danger }}>
                        {group.found ? `${picked} / ${group.assets.length}` : '未找到'}
                      </span>
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
                              <img src={asset.thumb_url} alt="" loading="lazy" style={styles.containImg} draggable={false} />
                              {isSelected && (
                                <span style={styles.tileCheck}>
                                  <Check size={11} strokeWidth={3} />
                                </span>
                              )}
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
                  </div>
                  <div style={styles.grid}>
                    {activeState.uploads.map((u) => (
                      <div key={u.id} style={styles.uploadCell}>
                        <div className="oc-tile" style={{ ...styles.tile, ...styles.tileSelected }}>
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
                        {hasTypes(activeZone) &&
                          renderTypeSelect(
                            uploadPieceKey(u.id),
                            activePieces.find((p) => p.key === uploadPieceKey(u.id))?.type ?? defaultType(activeZone)
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
                  <UploadCloud size={22} strokeWidth={1.5} color={C.subtle} />
                  <div style={styles.emptyTitle}>搜索货号，或拖入图片</div>
                  <div style={styles.emptyHint}>选中的素材会用来替换原图中的{activeZone.label}</div>
                </div>
              )}

              {isDragOver && (
                <div style={styles.dropOverlay}>
                  <UploadCloud size={22} strokeWidth={1.6} />
                  <span>松开添加为{activeZone.label}素材</span>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* ── 底部：已选素材 + 设置 + 生成 ── */}
        <div style={styles.footer}>
          <div style={styles.tray}>
            {pieces.length === 0 ? (
              <span style={{ color: C.subtle }}>还没有选择素材</span>
            ) : (
              pieces.map((p) => (
                <div
                  key={`${p.zone.key}|${p.key}`}
                  role="button"
                  tabIndex={0}
                  className="oc-piece"
                  title={`${p.zone.label} · ${p.sku || '本地上传'}`}
                  onClick={() => selectZone(p.zone.key)}
                  onKeyDown={(e) => onTileKey(e, () => selectZone(p.zone.key))}
                  style={{ ...styles.piece, ...(p.zone.key === activeZone.key ? styles.pieceActive : null) }}
                >
                  <span style={styles.pieceLabel}>{pieceLabel(p)}</span>
                  {(p.upload ? [{ key: p.upload.id, src: p.upload.previewUrl }] : p.assets.map((a) => ({ key: assetKey(a), src: a.thumb_url }))).map(
                    (t) => (
                      <span key={t.key} className="oc-mini" style={styles.miniThumb}>
                        <img src={t.src} alt="" style={styles.containImg} draggable={false} />
                        <button
                          type="button"
                          className="oc-mini-remove"
                          style={styles.miniRemove}
                          aria-label="移除"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (p.upload) removeUpload(p.zone.key, p.upload.id)
                            else {
                              const a = p.assets.find((x) => assetKey(x) === t.key)
                              if (a) removeAsset(p.zone.key, a)
                            }
                          }}
                        >
                          <X size={9} />
                        </button>
                      </span>
                    )
                  )}
                </div>
              ))
            )}
          </div>

          <div style={styles.footerActions}>
            {submitError && (
              <span style={styles.submitError} role="alert" title={submitError}>
                {submitError}
              </span>
            )}
            <span style={{ ...styles.refCount, color: remaining <= 0 ? C.ink : C.subtle }}>
              {totalSelected}/{maxRefs}
            </span>
            <div ref={settingsRef} style={{ position: 'relative' }}>
              <button
                type="button"
                className="oc-settings"
                aria-haspopup="dialog"
                aria-expanded={settingsOpen}
                onClick={() => setSettingsOpen((v) => !v)}
                style={{ ...styles.settingsBtn, ...(settingsOpen ? styles.settingsBtnOpen : null) }}
                title="生成设置"
              >
                <SlidersHorizontal size={14} />
                <span>
                  {currentModel.label} · {resolution}
                  {batchCount > 1 ? ` · ${batchCount} 张` : ''}
                  {extraPrompt.trim() ? ' · 补充' : ''}
                </span>
              </button>
              {settingsOpen && (
                <div role="dialog" aria-label="生成设置" style={styles.popover}>
                  <div style={styles.popLabel}>模型</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {MODEL_OPTIONS.map((opt) => {
                      const on = model === opt.key
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          className="oc-menu-item"
                          onClick={() => {
                            setModel(opt.key)
                            if (!opt.resolutions.includes(resolution)) {
                              setResolution(opt.resolutions[opt.resolutions.length - 1])
                            }
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

                  <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={styles.popLabel}>分辨率</div>
                      <div style={styles.segment}>
                        {RESOLUTIONS.map((r) => {
                          const unsupported = !currentModel.resolutions.includes(r)
                          return (
                            <button
                              key={r}
                              type="button"
                              aria-pressed={resolution === r}
                              disabled={unsupported}
                              title={
                                unsupported
                                  ? `${currentModel.label} 最高支持 ${currentModel.resolutions[currentModel.resolutions.length - 1]}`
                                  : undefined
                              }
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
                    <div style={{ flex: 1 }}>
                      <div style={styles.popLabel}>数量</div>
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

                  <div style={{ ...styles.popLabel, marginTop: 12 }}>补充指令（可选）</div>
                  <textarea
                    value={extraPrompt}
                    onChange={(e) => setExtraPrompt(e.target.value)}
                    rows={2}
                    maxLength={500}
                    placeholder="如：上衣下摆塞进裤腰"
                    className="oc-textarea"
                    style={styles.textarea}
                  />
                </div>
              )}
            </div>
            <button
              type="button"
              className="oc-primary"
              onClick={handleSubmit}
              disabled={!canSubmit}
              style={{ ...styles.primaryBtn, ...(canSubmit ? null : styles.primaryBtnDisabled) }}
            >
              {submitting ? (
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
              ) : (
                <Sparkles size={14} />
              )}
              <span>{submitting ? '提交中…' : 'AI 换装'}</span>
            </button>
          </div>
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
        [data-modal="outfit-change"] button { font-family: inherit; }
        [data-modal="outfit-change"] :focus-visible { outline: 2px solid ${C.ink}; outline-offset: 2px; }
        [data-modal="outfit-change"] .oc-icon-btn:hover:not(:disabled) { background: ${C.hover}; color: ${C.ink}; }
        [data-modal="outfit-change"] .oc-source:hover .oc-source-zoom { opacity: 1; }
        [data-modal="outfit-change"] .oc-zone-tab:hover:not(:disabled) { color: ${C.ink}; }
        [data-modal="outfit-change"] .oc-search:focus-within { border-color: ${C.ink}; box-shadow: 0 0 0 3px rgba(30,35,45,.08); }
        [data-modal="outfit-change"] .oc-search :focus-visible { outline: none; }
        [data-modal="outfit-change"] .oc-tile { transition: box-shadow .15s ease, transform .15s ease; }
        [data-modal="outfit-change"] .oc-tile:hover:not([aria-disabled="true"]) { box-shadow: 0 6px 16px rgba(20, 30, 50, .1); transform: translateY(-1px); }
        [data-modal="outfit-change"] .oc-tile:hover .oc-tile-zoom, [data-modal="outfit-change"] .oc-tile:focus-within .oc-tile-zoom { opacity: 1; }
        [data-modal="outfit-change"] .oc-dropzone:hover { border-color: ${C.subtle}; background: ${C.hover}; }
        [data-modal="outfit-change"] .oc-type:hover { border-color: ${C.subtle}; }
        [data-modal="outfit-change"] .oc-piece:hover { border-color: ${C.lineStrong}; }
        [data-modal="outfit-change"] .oc-mini-remove { opacity: 0; transition: opacity .12s ease; }
        [data-modal="outfit-change"] .oc-mini:hover .oc-mini-remove, [data-modal="outfit-change"] .oc-mini-remove:focus-visible { opacity: 1; }
        [data-modal="outfit-change"] .oc-settings:hover { border-color: ${C.subtle}; color: ${C.ink}; }
        [data-modal="outfit-change"] .oc-menu-item:hover, [data-modal="outfit-change"] .oc-menu-item[aria-checked="true"] { background: ${C.hover}; }
        [data-modal="outfit-change"] .oc-seg:hover:not(:disabled) { color: ${C.ink}; }
        [data-modal="outfit-change"] .oc-textarea:focus { border-color: ${C.ink}; box-shadow: 0 0 0 3px rgba(30,35,45,.08); outline: none; }
        [data-modal="outfit-change"] .oc-primary:hover:not(:disabled) { background: #2d3442; }
        [data-modal="outfit-change"] input::placeholder, [data-modal="outfit-change"] textarea::placeholder { color: ${C.subtle}; }
        @media (max-width: 1100px) { [data-modal="outfit-change"] .oc-left { width: 220px !important; } }
        @media (max-width: 860px) { [data-modal="outfit-change"] .oc-left { width: 180px !important; padding: 12px !important; } }
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
    width: 'min(1040px, 94vw)',
    height: 'min(680px, 88vh)',
    backgroundColor: C.surface,
    borderRadius: 14,
    boxShadow: '0 24px 70px rgba(20, 30, 50, 0.18), 0 0 0 1px rgba(20, 30, 50, .06)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    color: C.text,
  },
  header: {
    height: 52,
    padding: '0 12px 0 20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0,
  },
  title: {
    fontSize: 15,
    fontWeight: 650,
    color: C.ink,
    letterSpacing: '-0.01em',
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

  // ── 左：原图 ──
  leftCol: {
    width: 260,
    flexShrink: 0,
    padding: '4px 0 16px 20px',
    display: 'flex',
    flexDirection: 'column',
  },
  sourceStage: {
    position: 'relative',
    flex: 1,
    minHeight: 0,
    width: '100%',
    padding: 0,
    borderRadius: 10,
    border: 'none',
    backgroundColor: C.panel,
    overflow: 'hidden',
    cursor: 'zoom-in',
  },
  sourceZoom: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 7,
    backgroundColor: 'rgba(255,255,255,.92)',
    color: C.ink,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 1px 3px rgba(0,0,0,.12)',
    opacity: 0,
    transition: 'opacity .15s ease',
  },
  ruleNote: {
    marginTop: 8,
    fontSize: 11,
    color: C.subtle,
    textAlign: 'center',
  },

  // ── 右：工作区 ──
  workCol: {
    flex: 1,
    minWidth: 0,
    marginLeft: 12,
    display: 'flex',
    flexDirection: 'column',
  },
  zoneTabs: {
    display: 'flex',
    gap: 2,
    padding: '0 14px',
    borderBottom: `1px solid ${C.line}`,
  },
  zoneTab: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    height: 38,
    padding: '0 10px',
    marginBottom: -1,
    border: 'none',
    borderBottom: '2px solid transparent',
    backgroundColor: 'transparent',
    color: C.muted,
    fontSize: 13.5,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'color .15s ease, border-color .15s ease',
  },
  // 状态样式写完整的 border 简写：只覆盖 borderBottomColor 时，取消选中后 React 会把它清成 ''，
  // 颜色回落到 currentColor，表现为点过的 tab 一直带下划线
  zoneTabActive: {
    color: C.ink,
    fontWeight: 650,
    borderBottom: `2px solid ${C.ink}`,
  },
  zoneCount: {
    minWidth: 16,
    height: 16,
    padding: '0 4px',
    borderRadius: 8,
    backgroundColor: C.hover,
    color: C.text,
    fontSize: 10,
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontVariantNumeric: 'tabular-nums',
  },
  zoneCountActive: {
    backgroundColor: C.ink,
    color: '#fff',
  },
  searchWrap: {
    padding: '14px 24px 0',
  },
  searchBox: {
    height: 40,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '0 4px 0 12px',
    borderRadius: 10,
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
    fontSize: 13.5,
    color: C.ink,
    userSelect: 'text',
  },
  searchDivider: {
    width: 1,
    height: 18,
    backgroundColor: C.line,
  },
  uploadBtn: {
    width: 32,
    height: 32,
    borderRadius: 7,
    border: 'none',
    backgroundColor: 'transparent',
    color: C.muted,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  errorNotice: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
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
    padding: '16px 24px 20px',
  },
  group: {
    marginBottom: 18,
  },
  groupHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minHeight: 24,
    fontSize: 11.5,
    marginBottom: 8,
  },
  groupSku: {
    fontWeight: 650,
    color: C.ink,
    letterSpacing: '0.03em',
    fontVariantNumeric: 'tabular-nums',
  },
  // 去掉原生下拉箭头（无法控制边距），改用自绘箭头并留出右侧空间
  typeSelect: {
    height: 26,
    maxWidth: '100%',
    padding: '0 26px 0 9px',
    borderRadius: 7,
    border: `1px solid ${C.lineStrong}`,
    backgroundColor: C.surface,
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23687083' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 9px center',
    backgroundSize: '10px 6px',
    appearance: 'none',
    WebkitAppearance: 'none',
    MozAppearance: 'none',
    color: C.ink,
    fontSize: 12,
    fontWeight: 500,
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
    gap: 10,
  },
  tile: {
    position: 'relative',
    aspectRatio: '3 / 4',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: C.panel,
    cursor: 'pointer',
  },
  tileSelected: {
    boxShadow: `0 0 0 2px ${C.ink}`,
  },
  tileBlocked: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },
  tileCheck: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: C.ink,
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
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
  uploadCell: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  emptyState: {
    height: '100%',
    minHeight: 220,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    textAlign: 'center',
    borderRadius: 12,
    border: `1.5px dashed ${C.lineStrong}`,
    cursor: 'pointer',
    transition: 'border-color .15s ease, background .15s ease',
  },
  emptyTitle: {
    marginTop: 4,
    fontSize: 13.5,
    fontWeight: 600,
    color: C.ink,
  },
  emptyHint: {
    fontSize: 12,
    color: C.subtle,
  },
  dropOverlay: {
    position: 'absolute',
    inset: '16px 24px 20px',
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

  // ── 底部操作栏 ──
  footer: {
    flexShrink: 0,
    height: 64,
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '0 20px',
    borderTop: `1px solid ${C.line}`,
  },
  tray: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    overflowX: 'auto',
    fontSize: 12,
  },
  piece: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    height: 44,
    padding: '0 5px 0 10px',
    borderRadius: 9,
    border: `1px solid ${C.line}`,
    cursor: 'pointer',
    transition: 'border-color .15s ease, background .15s ease',
  },
  pieceActive: {
    backgroundColor: C.panel,
    border: `1px solid ${C.lineStrong}`,
  },
  pieceLabel: {
    marginRight: 4,
    fontSize: 12,
    fontWeight: 600,
    color: C.ink,
    whiteSpace: 'nowrap',
  },
  miniThumb: {
    position: 'relative',
    width: 26,
    height: 34,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: C.panel,
  },
  miniRemove: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    border: 'none',
    backgroundColor: 'rgba(20,24,32,.6)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    padding: 0,
  },
  footerActions: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  submitError: {
    maxWidth: 200,
    fontSize: 11.5,
    color: C.danger,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  refCount: {
    fontSize: 12,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
  settingsBtn: {
    height: 36,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '0 12px',
    borderRadius: 9,
    border: `1px solid ${C.lineStrong}`,
    backgroundColor: C.surface,
    color: C.text,
    fontSize: 12.5,
    fontWeight: 500,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'border-color .15s ease, color .15s ease',
  },
  settingsBtnOpen: {
    border: `1px solid ${C.ink}`,
    color: C.ink,
  },
  popover: {
    position: 'absolute',
    right: 0,
    bottom: 'calc(100% + 10px)',
    zIndex: 5,
    width: 300,
    padding: 14,
    borderRadius: 12,
    border: `1px solid ${C.line}`,
    backgroundColor: C.surface,
    boxShadow: '0 16px 40px rgba(20, 30, 50, .16), 0 2px 6px rgba(20, 30, 50, .05)',
  },
  popLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: C.muted,
    margin: '0 0 6px',
  },
  // 悬停底色向两侧外扩，文字仍与其它控件左对齐
  menuItem: {
    width: 'calc(100% + 16px)',
    margin: '0 -8px',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '7px 8px',
    border: 'none',
    borderRadius: 8,
    backgroundColor: 'transparent',
    cursor: 'pointer',
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
  primaryBtn: {
    height: 36,
    maxWidth: 260,
    borderRadius: 9,
    border: 'none',
    backgroundColor: C.ink,
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    padding: '0 16px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    transition: 'background .15s ease',
  },
  primaryBtnDisabled: {
    backgroundColor: C.line,
    color: C.subtle,
    cursor: 'not-allowed',
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
    maxHeight: 'calc(min(680px, 88vh) - 64px)',
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

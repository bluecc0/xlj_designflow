import { notifyError, feedback } from '../utils/feedback'
import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  Package,
  Check,
  Loader2,
  X,
  Sparkles,
  ArrowRight,
  Layers,
  FolderOpen,
} from 'lucide-react'
import { useCanvasStore } from '../store/canvasStore'
import { useViewportStore } from '../store/viewportStore'
import {
  searchSkuFolders, importSkuFolderImages,
  type SkuFolderSearchResult, type ImportedProductImage,
} from '../services/productImportService'

interface Props {
  visible: boolean
  targetPos: { x: number; y: number } | null // 触发右键的世界坐标
  onClose: () => void
}

export interface AssetTypeOption {
  key: string
  label: string
  desc: string
}

const AVAILABLE_ASSET_TYPES: AssetTypeOption[] = [
  { key: 'white', label: '白底图', desc: 'White_Base' },
  { key: 'png', label: '透明图', desc: 'PNG' },
  { key: 'white2x', label: '一双鞋角度', desc: 'White_Basex2' },
  { key: 'shadow', label: '阴影图', desc: 'PNG_Shadow' },
  { key: 'model', label: '模特图', desc: 'Model_Images' },
]

export const ImportProductModal: React.FC<Props> = ({ visible, targetPos, onClose }) => {
  const [skuInput, setSkuInput] = useState('')
  // 默认勾选白底图
  const [selectedAssetTypes, setSelectedAssetTypes] = useState<string[]>(['white'])
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'types' | 'folders'>('types')
  const [folderLoading, setFolderLoading] = useState(false)
  const [folderResult, setFolderResult] = useState<SkuFolderSearchResult | null>(null)
  const [folderResultQuery, setFolderResultQuery] = useState('')
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(new Set())
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  useEffect(() => { if (visible && errorMsg) notifyError(errorMsg, '商品素材未能导入，请稍后再试。', { key: 'product-import' }); else feedback.resolve('product-import'); }, [errorMsg, visible]);
  useEffect(() => () => feedback.resolve('product-import'), []);

  const [notFoundInfo, setNotFoundInfo] = useState<{
    missingSkus: string[]
    libraryExists: boolean
    allItems: { sku: string; mockUrl: string }[]
  } | null>(null)

  useEffect(() => {
    if (!visible || !notFoundInfo) return;
    notifyError(notFoundInfo.libraryExists ? '部分商品未找到素材，请检查货号和素材类型后再试。' : '商品素材库暂未连接，请先上传本地图片或联系管理员。', undefined, { key: 'product-import' });
  }, [notFoundInfo, visible]);

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const addImages = useCanvasStore((s) => s.addImages)
  const screenToCanvas = useViewportStore((s) => s.screenToCanvas)

  // 解析并去重用户输入的多个 SKU（支持中英文逗号、换行、空格）
  const parsedSkus = useMemo(() => {
    const raw = skuInput.trim()
    if (!raw) return []
    const tokens = raw.split(/[,，\s\n\r]+/).map((s) => s.trim()).filter(Boolean)
    return Array.from(new Set(tokens))
  }, [skuInput])
  const folderQuery = parsedSkus.join(',')
  const folderImages = useMemo(() => folderResult?.folders.flatMap((folder) => folder.images) || [], [folderResult])

  useEffect(() => {
    const controller = new AbortController()
    setFolderResult(null)
    setFolderResultQuery('')
    setSelectedImageIds(new Set())
    if (!visible || mode !== 'folders' || !folderQuery) {
      setFolderLoading(false)
      return () => controller.abort()
    }
    setFolderLoading(true)
    const timer = setTimeout(async () => {
      try {
        const result = await searchSkuFolders(folderQuery.split(','), controller.signal)
        if (controller.signal.aborted) return
        setFolderResult(result)
        setFolderResultQuery(folderQuery)
      } catch (error) {
        if (!controller.signal.aborted) setErrorMsg(feedback.message(error, '商品文件夹暂时无法读取，请稍后再试。'))
      } finally {
        if (!controller.signal.aborted) setFolderLoading(false)
      }
    }, 450)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [visible, mode, folderQuery])

  useEffect(() => {
    if (visible) {
      setSkuInput('')
      setSelectedAssetTypes(['white'])
      setErrorMsg(null)
      setNotFoundInfo(null)
      setLoading(false)
      setMode('types')
      setTimeout(() => {
        textareaRef.current?.focus()
      }, 50)
    }
  }, [visible])

  // ESC 键关闭
  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, onClose, loading])

  if (!visible) return null

  // 切换素材类型勾选（保证至少勾选一项）
  const toggleAssetType = (key: string) => {
    setSelectedAssetTypes((prev) => {
      if (prev.includes(key)) {
        if (prev.length === 1) return prev // 至少保留一个
        return prev.filter((k) => k !== key)
      } else {
        return [...prev, key]
      }
    })
  }

  // 批量加载图片元数据并按网格流式计算坐标
  const batchInsertToCanvas = async (
    items: ImportedProductImage[]
  ) => {
    if (items.length === 0) return

    // 预加载每张图片的天然宽高
    const loadedImages = await Promise.all(
      items.map(
        (it) =>
          new Promise<{
            url: string
            name: string
            naturalW: number
            naturalH: number
          }>((resolve) => {
            if (it.naturalWidth && it.naturalHeight) {
              resolve({ url: it.url, name: it.name, naturalW: it.naturalWidth, naturalH: it.naturalHeight })
              return
            }
            const img = new Image()
            img.onload = () => {
              resolve({
                url: it.url,
                name: it.name,
                naturalW: img.naturalWidth || 600,
                naturalH: img.naturalHeight || 600,
              })
            }
            img.onerror = () => {
              // 加载异常时退回默认尺寸
              resolve({
                url: it.url,
                name: it.name,
                naturalW: 600,
                naturalH: 600,
              })
            }
            img.src = it.url
          })
      )
    )

    // 计算网格排列参数
    const total = loadedImages.length
    const cols = total <= 1 ? 1 : total <= 4 ? 2 : total <= 9 ? 3 : 4
    const CARD_MAX_W = 460
    const CARD_MAX_H = 560
    const GAP = 28

    let originX = 0
    let originY = 0

    if (targetPos) {
      originX = targetPos.x
      originY = targetPos.y
    } else {
      const centerScreen = screenToCanvas({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      })
      originX = centerScreen.x
      originY = centerScreen.y
    }

    const newCanvasImages = loadedImages.map((img, idx) => {
      const scale = Math.min(1, CARD_MAX_W / img.naturalW, CARD_MAX_H / img.naturalH)
      const w = Math.round(img.naturalW * scale)
      const h = Math.round(img.naturalH * scale)

      const col = idx % cols
      const row = Math.floor(idx / cols)

      const x = Math.round(originX + col * (CARD_MAX_W + GAP))
      const y = Math.round(originY + row * (CARD_MAX_H + GAP))

      return {
        id: 'prod-' + Math.random().toString(36).slice(2, 10),
        url: img.url,
        name: img.name,
        x,
        y,
        width: w,
        height: h,
        rotation: 0,
        naturalWidth: img.naturalW,
        naturalHeight: img.naturalH,
        locked: false,
        opacity: 1,
      }
    })

    // 一次性批量添加到画布，并全部激活选中状态
    addImages(newCanvasImages)
  }

  // 执行查询与导入
  const handleImport = async (forceMockAll = false) => {
    if (parsedSkus.length === 0) {
      setErrorMsg('请输入至少一个商品货号（SKU）')
      textareaRef.current?.focus()
      return
    }
    if (selectedAssetTypes.length === 0) {
      setErrorMsg('请至少勾选一种素材类型')
      return
    }

    setLoading(true)
    setErrorMsg(null)
    setNotFoundInfo(null)

    try {
      // 传入全部 SKU，逗号连接
      const skuQuery = parsedSkus.join(',')
      const res = await fetch(`/products/search-sku?sku=${encodeURIComponent(skuQuery)}`)
      if (!res.ok) {
        throw feedback.responseError(res.status, await res.text())
      }
      const data = await res.json()
      const skuItems: any[] = data.items || []
      const libraryExists = Boolean(data.library_exists)

      // 构建待置入画布的素材列表
      const toInsert: { url: string; name: string; sku: string; assetType: string }[] = []
      const missingList: string[] = []

      for (const sku of parsedSkus) {
        const item = skuItems.find((it: any) => it.sku === sku)
        for (const typeKey of selectedAssetTypes) {
          const typeDef = AVAILABLE_ASSET_TYPES.find((t) => t.key === typeKey)
          const typeLabel = typeDef?.label || typeKey

          if (!forceMockAll && item && item.assets && item.assets.length > 0) {
            const matchedAsset = item.assets.find((a: any) => a.asset_type === typeKey)
            if (matchedAsset) {
              toInsert.push({
                url: matchedAsset.url,
                name: `${sku} (${typeLabel})`,
                sku,
                assetType: typeKey,
              })
              continue
            }
          }

          // 如果未找到或开发机未连接素材库，生成对应类型的测试模拟图
          if (!libraryExists || forceMockAll) {
            toInsert.push({
              url: `/products/mock-image?sku=${encodeURIComponent(sku)}&asset_type=${encodeURIComponent(typeKey)}`,
              name: `${sku} (${typeLabel})`,
              sku,
              assetType: typeKey,
            })
          } else {
            // 素材库存在但该 SKU/类型未找到
            missingList.push(`${sku} - ${typeLabel}`)
          }
        }
      }

      // 如果有可置入的图，执行插入
      if (toInsert.length > 0) {
        await batchInsertToCanvas(toInsert)
        onClose()
      } else {
        // 素材库连接了但完全未找到对应图片，提示用户并提供一键模拟导入
        setNotFoundInfo({
          missingSkus: missingList,
          libraryExists,
          allItems: parsedSkus.map((s) => ({
            sku: s,
            mockUrl: `/products/mock-image?sku=${encodeURIComponent(s)}&asset_type=white`,
          })),
        })
      }
    } catch (e: any) {
      setErrorMsg(feedback.message(e, '商品素材暂时无法检索，请稍后再试。'))

    } finally {
      setLoading(false)
    }
  }

  const handleFolderImport = async () => {
    if (loading || folderLoading || folderResultQuery !== folderQuery || !selectedImageIds.size) return
    if (selectedImageIds.size > 200) {
      setErrorMsg('一次最多导入 200 张图片，请分批导入。')
      return
    }
    setLoading(true)
    setErrorMsg(null)
    try {
      const selected = folderImages.filter((image) => selectedImageIds.has(image.id))
      const originals = await importSkuFolderImages(selected)
      await batchInsertToCanvas(originals)
      onClose()
    } catch (error) {
      setErrorMsg(feedback.message(error, '图片暂时无法导入，请稍后再试。'))
    } finally {
      setLoading(false)
    }
  }

  const totalToImport = mode === 'folders' ? selectedImageIds.size : parsedSkus.length * selectedAssetTypes.length
  const canImport = !loading && (mode === 'folders'
    ? !folderLoading && folderResultQuery === folderQuery && selectedImageIds.size > 0
    : parsedSkus.length > 0 && selectedAssetTypes.length > 0)

  // 勾选/取消一组图片（单个文件夹或全部）
  const toggleImages = (ids: string[]) => setSelectedImageIds((previous) => {
    const next = new Set(previous)
    const allSelected = ids.every((id) => next.has(id))
    ids.forEach((id) => (allSelected ? next.delete(id) : next.add(id)))
    return next
  })
  const allFolderImageIds = folderImages.map((image) => image.id)
  const allImagesSelected = allFolderImageIds.length > 0 && selectedImageIds.size === allFolderImageIds.length

  const emptyState = (icon: React.ReactNode, text: string) => (
    <div className="ipm-empty">
      {icon}
      <span>{text}</span>
    </div>
  )

  return (
    <div
      data-modal="import-product"
      style={{
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
      }}
      onClick={loading ? undefined : onClose}
    >
      <style>{`
        [data-modal="import-product"] button { font-family: inherit; }
        [data-modal="import-product"] :focus-visible { outline: 2px solid #0f172a; outline-offset: 2px; }
        [data-modal="import-product"] .ipm-icon-btn:hover:not(:disabled) { background: #f1f5f9; color: #334155; }
        [data-modal="import-product"] .ipm-seg { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px; border-radius: 12px; background: #f1f5f9; }
        [data-modal="import-product"] .ipm-seg-btn { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border: 0; border-radius: 9px; background: transparent; color: #64748b; cursor: pointer; text-align: left; transition: background-color 150ms ease, color 150ms ease, box-shadow 150ms ease; }
        [data-modal="import-product"] .ipm-seg-btn:hover:not(:disabled):not([aria-pressed="true"]) { color: #0f172a; }
        [data-modal="import-product"] .ipm-seg-btn[aria-pressed="true"] { background: #ffffff; color: #0f172a; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.1), 0 0 0 1px rgba(226, 232, 240, 0.8); }
        [data-modal="import-product"] .ipm-seg-title { font-size: 13px; font-weight: 600; line-height: 1.3; }
        [data-modal="import-product"] .ipm-seg-desc { font-size: 11px; color: #94a3b8; line-height: 1.3; margin-top: 1px; }
        [data-modal="import-product"] .ipm-label { font-size: 12px; font-weight: 600; color: #334155; }
        [data-modal="import-product"] .ipm-hint { font-size: 11px; color: #94a3b8; }
        [data-modal="import-product"] .ipm-textarea { width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid #cbd5e1; background: #ffffff; font-size: 13px; line-height: 1.5; color: #0f172a; outline: none; box-sizing: border-box; resize: none; font-family: inherit; transition: border-color 150ms ease, box-shadow 150ms ease; }
        [data-modal="import-product"] .ipm-textarea:focus { border-color: #0f172a; box-shadow: 0 0 0 3px rgba(15, 23, 42, 0.08); }
        [data-modal="import-product"] .ipm-chip { font-size: 11px; font-weight: 600; background: #f1f5f9; color: #475569; padding: 2px 8px; border-radius: 6px; letter-spacing: 0.02em; }
        [data-modal="import-product"] .ipm-type { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 10px; border: 1px solid #e2e8f0; background: #ffffff; color: #475569; cursor: pointer; text-align: left; transition: border-color 120ms ease, background-color 120ms ease; }
        [data-modal="import-product"] .ipm-type:hover:not(:disabled) { border-color: #cbd5e1; background: #f8fafc; }
        [data-modal="import-product"] .ipm-type[aria-pressed="true"] { border-color: #0f172a; background: #f8fafc; color: #0f172a; box-shadow: inset 0 0 0 0.5px #0f172a; }
        [data-modal="import-product"] .ipm-check { width: 16px; height: 16px; border-radius: 5px; border: 1.5px solid #cbd5e1; background: #ffffff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 120ms ease; }
        [data-modal="import-product"] [aria-pressed="true"] > .ipm-check, [data-modal="import-product"] .ipm-check.is-on { border-color: #0f172a; background: #0f172a; }
        [data-modal="import-product"] .ipm-link { border: 0; background: none; padding: 2px 4px; border-radius: 6px; color: #475569; cursor: pointer; font-size: 12px; }
        [data-modal="import-product"] .ipm-link:hover:not(:disabled) { color: #0f172a; background: #f1f5f9; }
        [data-modal="import-product"] .ipm-tile { position: relative; display: block; cursor: pointer; min-width: 0; }
        [data-modal="import-product"] .ipm-tile-img { position: relative; aspect-ratio: 1; border-radius: 10px; overflow: hidden; background: #f8fafc; }
        [data-modal="import-product"] .ipm-tile-img::after { content: ''; position: absolute; inset: 0; border-radius: inherit; box-shadow: inset 0 0 0 1px #e2e8f0; pointer-events: none; transition: box-shadow 120ms ease; }
        [data-modal="import-product"] .ipm-tile:hover .ipm-tile-img::after { box-shadow: inset 0 0 0 1px #94a3b8; }
        [data-modal="import-product"] .ipm-tile.is-on .ipm-tile-img::after { box-shadow: inset 0 0 0 2px #0f172a; }
        [data-modal="import-product"] .ipm-tile .ipm-check { position: absolute; top: 7px; right: 7px; opacity: 0; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.15); }
        [data-modal="import-product"] .ipm-tile:hover .ipm-check, [data-modal="import-product"] .ipm-tile.is-on .ipm-check, [data-modal="import-product"] .ipm-tile:focus-within .ipm-check { opacity: 1; }
        [data-modal="import-product"] .ipm-tile input { position: absolute; opacity: 0; width: 0; height: 0; }
        [data-modal="import-product"] .ipm-tile:focus-within .ipm-tile-img { outline: 2px solid #0f172a; outline-offset: 2px; }
        [data-modal="import-product"] .ipm-empty { flex: 1; min-height: 160px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; border: 1px dashed #e2e8f0; border-radius: 12px; font-size: 12px; color: #94a3b8; text-align: center; padding: 24px; }
        [data-modal="import-product"] .ipm-note { font-size: 12px; color: #64748b; padding: 8px 12px; border-radius: 8px; background: #f8fafc; }
      `}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 640,
          maxWidth: 'calc(100vw - 32px)',
          height: 'min(88vh, 640px)',
          backgroundColor: '#ffffff',
          borderRadius: 16,
          boxShadow: '0 24px 48px -12px rgba(15, 23, 42, 0.25), 0 0 0 1px rgba(226, 232, 240, 0.9)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          color: '#1e293b',
        }}
      >
        {/* 标题栏 */}
        <div style={{ padding: '16px 20px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                backgroundColor: '#f1f5f9',
                color: '#0f172a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Package size={18} strokeWidth={2.2} />
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>批量导入产品图</div>
          </div>
          <button
            className="ipm-icon-btn"
            onClick={onClose}
            disabled={loading}
            aria-label="关闭导入产品图"
            style={{
              background: 'transparent',
              border: 'none',
              padding: 6,
              borderRadius: 8,
              cursor: 'pointer',
              color: '#94a3b8',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 120ms ease',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* 模式切换 */}
        <div style={{ padding: '0 20px 16px', borderBottom: '1px solid #f1f5f9' }}>
          <div className="ipm-seg" role="group" aria-label="导入方式">
            {([
              { key: 'types', label: '按类型导入', desc: '每个货号按素材类型各取一张', icon: <Layers size={16} /> },
              { key: 'folders', label: '按文件夹选图', desc: '浏览色号文件夹，挑选具体图片', icon: <FolderOpen size={16} /> },
            ] as const).map((tab) => (
              <button key={tab.key} type="button" className="ipm-seg-btn" disabled={loading}
                onClick={() => { setMode(tab.key); setErrorMsg(null); setNotFoundInfo(null) }}
                aria-pressed={mode === tab.key}>
                {tab.icon}
                <span style={{ minWidth: 0 }}>
                  <div className="ipm-seg-title">{tab.label}</div>
                  <div className="ipm-seg-desc">{tab.desc}</div>
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* 内容区 */}
        <div style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column', gap: 18, overflowY: 'auto', minHeight: 0 }}>
          {/* 输入框（多 SKU 支持，中英文逗号、换行、空格） */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label className="ipm-label">{mode === 'folders' ? '款号 / 色号' : '商品货号 (SKU)'}</label>
              <span className="ipm-hint">
                {parsedSkus.length > 0 ? (
                  <span style={{ color: '#0f172a', fontWeight: 600 }}>已识别 {parsedSkus.length} 个货号</span>
                ) : (
                  '支持以逗号、换行或空格分隔'
                )}
              </span>
            </div>

            <textarea
              ref={textareaRef}
              className="ipm-textarea"
              rows={2}
              value={skuInput}
              disabled={loading}
              onChange={(e) => {
                setSkuInput(e.target.value)
                if (errorMsg) setErrorMsg(null)
                if (notFoundInfo) setNotFoundInfo(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  if (mode === 'folders') handleFolderImport()
                  else handleImport()
                }
              }}
              placeholder={mode === 'folders'
                ? '输入款号或完整色号，支持多个货号\n例如：YKCW196, YKLW120-4'
                : '输入一个或多个货号，以逗号、空格或换行分隔\n例如：C24B1201, C24B1202, C24B1203'}
            />

            {/* 解析出的 SKU 标签预览 */}
            {parsedSkus.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 52, overflowY: 'auto' }}>
                {parsedSkus.map((sku) => <span key={sku} className="ipm-chip">{sku}</span>)}
              </div>
            )}
          </div>

          {/* 素材类型多选（默认勾选白底图） */}
          {mode === 'types' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label className="ipm-label">素材类型</label>
                <span className="ipm-hint">可多选，至少保留一项</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(176px, 1fr))', gap: 8 }}>
                {AVAILABLE_ASSET_TYPES.map((item) => {
                  const checked = selectedAssetTypes.includes(item.key)
                  return (
                    <button key={item.key} type="button" className="ipm-type" disabled={loading}
                      aria-pressed={checked} onClick={() => toggleAssetType(item.key)}>
                      <span className="ipm-check">{checked && <Check size={11} color="#ffffff" strokeWidth={3} />}</span>
                      <span style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: checked ? 600 : 500 }}>{item.label}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.desc}</div>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* 未在素材库找到时的反馈与开发模拟图置入 */}
          {mode === 'types' && import.meta.env.DEV && notFoundInfo && (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 10,
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.5 }}>
                部分或全部商品未在素材库中检索到素材文件。
                {!notFoundInfo.libraryExists && (
                  <span style={{ display: 'block', color: '#94a3b8', fontSize: 11, marginTop: 2 }}>
                    （当前开发机未挂载本地素材库，可使用标准开发模拟图测试导入与排版）
                  </span>
                )}
              </div>

              <button
                type="button"
                className="ipm-link"
                onClick={() => handleImport(true)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  height: 34,
                  border: '1px solid #e2e8f0',
                  background: '#ffffff',
                  color: '#0f172a',
                  fontWeight: 600,
                }}
              >
                <Sparkles size={13} />
                <span>载入开发模拟图测试排版 ({totalToImport} 张)</span>
              </button>
            </div>
          )}

          {mode === 'folders' && (
            folderLoading ? (
              <div role="status" className="ipm-empty">
                <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
                <span>正在查找商品文件夹…</span>
              </div>
            ) : !folderResult ? (
              emptyState(<FolderOpen size={22} strokeWidth={1.6} />, '输入款号后会列出各色号文件夹的图片，也可直接输入完整色号')
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                {!folderResult.library_exists && <div className="ipm-note">商品素材库暂未连接，请联系管理员。</div>}
                {folderResult.library_exists && folderResult.missing_skus.length > 0 && (
                  <div className="ipm-note">未找到同名文件夹：{folderResult.missing_skus.join('、')}</div>
                )}
                {folderResult.library_exists && folderResult.folders.length === 0 && folderResult.missing_skus.length === 0 &&
                  emptyState(<FolderOpen size={22} strokeWidth={1.6} />, '没有找到可选的图片')}
                {folderResult.folders.map((folder) => {
                  const ids = folder.images.map((image) => image.id)
                  const folderAllSelected = ids.length > 0 && ids.every((id) => selectedImageIds.has(id))
                  return (
                    <div key={folder.id}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#334155' }}>
                          <FolderOpen size={14} color="#64748b" />
                          <span>{folder.name}</span>
                          <span style={{ color: '#94a3b8', fontWeight: 400 }}>{folder.images.length} 张</span>
                        </div>
                        {ids.length > 0 && (
                          <button type="button" className="ipm-link" disabled={loading} onClick={() => toggleImages(ids)}>
                            {folderAllSelected ? '取消本组' : '选本组'}
                          </button>
                        )}
                      </div>
                      {folder.images.length === 0 ? <div className="ipm-hint" style={{ padding: '4px 0' }}>文件夹内暂无图片</div> : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 10 }}>
                          {folder.images.map((image) => {
                            const checked = selectedImageIds.has(image.id)
                            return (
                              <label key={image.id} title={image.filename} className={`ipm-tile${checked ? ' is-on' : ''}`}
                                style={{ cursor: loading ? 'wait' : 'pointer' }}>
                                <div className="ipm-tile-img">
                                  <img src={image.preview_url} alt={image.filename} loading="lazy" decoding="async"
                                    style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} />
                                  <input type="checkbox" checked={checked} disabled={loading} aria-label={`${folder.name} ${image.filename}`}
                                    onChange={() => toggleImages([image.id])} />
                                  <span className={`ipm-check${checked ? ' is-on' : ''}`}>
                                    {checked && <Check size={11} color="#ffffff" strokeWidth={3} />}
                                  </span>
                                </div>
                                <div style={{ fontSize: 10, color: checked ? '#334155' : '#94a3b8', marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{image.filename}</div>
                              </label>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          )}
        </div>

        {/* 底部按钮栏：左侧统一显示本次导入的数量 */}
        <div
          style={{
            padding: '14px 20px',
            backgroundColor: '#f8fafc',
            borderTop: '1px solid #f1f5f9',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#64748b' }}>
            {mode === 'types' ? (
              parsedSkus.length > 0 ? (
                <span>
                  {parsedSkus.length} 个货号 × {selectedAssetTypes.length} 种类型，共 <strong style={{ color: '#0f172a' }}>{totalToImport}</strong> 张
                </span>
              ) : <span>导入后按网格排入画布</span>
            ) : folderImages.length > 0 ? (
              <>
                <span>已选 <strong style={{ color: '#0f172a' }}>{selectedImageIds.size}</strong> / {folderImages.length} 张</span>
                <button type="button" className="ipm-link" disabled={loading} onClick={() => toggleImages(allFolderImageIds)}>
                  {allImagesSelected ? '取消全选' : '全选'}
                </button>
              </>
            ) : <span>导入后按网格排入画布</span>}
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="ipm-link"
            style={{
              height: 36,
              padding: '0 16px',
              borderRadius: 8,
              border: '1px solid #e2e8f0',
              backgroundColor: '#ffffff',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            取消
          </button>

          <button
            type="button"
            onClick={() => mode === 'folders' ? handleFolderImport() : handleImport(false)}
            disabled={!canImport}
            style={{
              height: 36,
              padding: '0 18px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: '#0f172a',
              color: '#ffffff',
              fontSize: 13,
              fontWeight: 600,
              cursor: !canImport ? 'not-allowed' : 'pointer',
              opacity: !canImport ? 0.45 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              boxShadow: '0 2px 4px rgba(15, 23, 42, 0.15)',
              transition: 'opacity 150ms ease',
              whiteSpace: 'nowrap',
            }}
          >
            {loading ? (
              <>
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                <span>正在检索与置入…</span>
              </>
            ) : (
              <>
                <span>导入到画布</span>
                <ArrowRight size={14} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

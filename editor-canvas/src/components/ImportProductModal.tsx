import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  Package,
  Check,
  AlertCircle,
  Loader2,
  X,
  Sparkles,
  ArrowRight,
  Layers,
} from 'lucide-react'
import { useCanvasStore } from '../store/canvasStore'
import { useViewportStore } from '../store/viewportStore'

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
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [notFoundInfo, setNotFoundInfo] = useState<{
    missingSkus: string[]
    libraryExists: boolean
    allItems: { sku: string; mockUrl: string }[]
  } | null>(null)

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

  useEffect(() => {
    if (visible) {
      setSkuInput('')
      setSelectedAssetTypes(['white'])
      setErrorMsg(null)
      setNotFoundInfo(null)
      setLoading(false)
      setTimeout(() => {
        textareaRef.current?.focus()
      }, 50)
    }
  }, [visible])

  // ESC 键关闭
  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, onClose])

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
    items: { url: string; name: string; sku: string; assetType: string }[]
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
      const scale = img.naturalW > CARD_MAX_W ? CARD_MAX_W / img.naturalW : 1
      const w = Math.round(img.naturalW * scale)
      const h = Math.round(img.naturalH * scale)

      const col = idx % cols
      const row = Math.floor(idx / cols)

      const x = Math.round(originX + col * (CARD_MAX_W + GAP))
      const y = Math.round(originY + row * (CARD_MAX_W + GAP))

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
        throw new Error(`查询接口异常 (${res.status})`)
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
      // 若后端接口未启动或网络异常，支持一键载入测试模拟图
      setErrorMsg(e.message || '连接素材库失败')
      setNotFoundInfo({
        missingSkus: parsedSkus,
        libraryExists: false,
        allItems: parsedSkus.map((s) => ({
          sku: s,
          mockUrl: `/products/mock-image?sku=${encodeURIComponent(s)}&asset_type=white`,
        })),
      })
    } finally {
      setLoading(false)
    }
  }

  const totalToImport = parsedSkus.length * selectedAssetTypes.length

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
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480,
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
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #f1f5f9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(to bottom, #ffffff, #fbfcfe)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                backgroundColor: '#eff6ff',
                color: '#2563eb',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Package size={18} strokeWidth={2.2} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>
                批量导入产品图
              </div>
              <div style={{ fontSize: 11, color: '#64748b' }}>
                支持多个 SKU 逗号分割，勾选素材类型批量网格平铺置入
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
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
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#f1f5f9'
              e.currentTarget.style.color = '#334155'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent'
              e.currentTarget.style.color = '#94a3b8'
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* 内容区 */}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 输入框（多 SKU 支持，中英文逗号、换行、空格） */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>
                商品货号 (SKU)
              </label>
              <span style={{ fontSize: 11, color: '#64748b' }}>
                {parsedSkus.length > 0 ? (
                  <span style={{ color: '#2563eb', fontWeight: 600 }}>
                    已识别 {parsedSkus.length} 个货号
                  </span>
                ) : (
                  '支持以逗号、换行或空格分隔'
                )}
              </span>
            </div>

            <textarea
              ref={textareaRef}
              rows={3}
              value={skuInput}
              onChange={(e) => {
                setSkuInput(e.target.value)
                if (errorMsg) setErrorMsg(null)
                if (notFoundInfo) setNotFoundInfo(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  handleImport()
                }
              }}
              placeholder="输入一个或多个货号，以逗号、空格或换行分隔&#10;例如：C24B1201, C24B1202, C24B1203"
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                fontSize: 13,
                lineHeight: 1.5,
                color: '#0f172a',
                outline: 'none',
                boxSizing: 'border-box',
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.04)',
                resize: 'none',
                fontFamily: 'inherit',
                transition: 'border-color 150ms ease, box-shadow 150ms ease',
              }}
              onFocus={(e) => {
                e.target.style.borderColor = '#3b82f6'
                e.target.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.15)'
              }}
              onBlur={(e) => {
                e.target.style.borderColor = '#cbd5e1'
                e.target.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.04)'
              }}
            />

            {/* 解析出的 SKU 标签预览 */}
            {parsedSkus.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                  maxHeight: 64,
                  overflowY: 'auto',
                  padding: '4px 2px',
                }}
              >
                {parsedSkus.map((sku) => (
                  <span
                    key={sku}
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      backgroundColor: '#f1f5f9',
                      color: '#475569',
                      padding: '2px 8px',
                      borderRadius: 6,
                      border: '1px solid #e2e8f0',
                      letterSpacing: '0.02em',
                    }}
                  >
                    {sku}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 素材类型多选（默认勾选白底图） */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>
                素材类型（可勾选多个）
              </label>
              <span style={{ fontSize: 11, color: '#64748b' }}>
                已勾选 {selectedAssetTypes.length} 项（默认白底图）
              </span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 8,
              }}
            >
              {AVAILABLE_ASSET_TYPES.map((item) => {
                const checked = selectedAssetTypes.includes(item.key)
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => toggleAssetType(item.key)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 10px',
                      borderRadius: 9,
                      border: checked ? '1.5px solid #2563eb' : '1px solid #e2e8f0',
                      backgroundColor: checked ? '#eff6ff' : '#ffffff',
                      color: checked ? '#1d4ed8' : '#475569',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontWeight: checked ? 600 : 500,
                      transition: 'all 120ms ease',
                      textAlign: 'left',
                    }}
                    onMouseEnter={(e) => {
                      if (!checked) e.currentTarget.style.backgroundColor = '#f8fafc'
                    }}
                    onMouseLeave={(e) => {
                      if (!checked) e.currentTarget.style.backgroundColor = '#ffffff'
                    }}
                  >
                    <div
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: 4,
                        border: checked ? 'none' : '1.5px solid #94a3b8',
                        backgroundColor: checked ? '#2563eb' : 'transparent',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {checked && <Check size={12} color="#ffffff" strokeWidth={3} />}
                    </div>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.label}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* 导入预览摘要 */}
          {parsedSkus.length > 0 && selectedAssetTypes.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                borderRadius: 8,
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                fontSize: 12,
                color: '#64748b',
              }}
            >
              <Layers size={14} color="#3b82f6" />
              <span>
                预计生成{' '}
                <strong style={{ color: '#0f172a' }}>{totalToImport}</strong> 张素材（
                {parsedSkus.length} 个 SKU × {selectedAssetTypes.length} 种类型），将整齐网格排布入画布
              </span>
            </div>
          )}

          {/* 错误提示 */}
          {errorMsg && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                borderRadius: 8,
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#ef4444',
                fontSize: 12,
              }}
            >
              <AlertCircle size={14} style={{ flexShrink: 0 }} />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* 未在素材库找到时的反馈与开发模拟图置入 */}
          {notFoundInfo && (
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
                onClick={() => handleImport(true)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  height: 34,
                  padding: '0 12px',
                  borderRadius: 8,
                  backgroundColor: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  color: '#2563eb',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'background-color 150ms ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#dbeafe')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#eff6ff')}
              >
                <Sparkles size={13} />
                <span>载入开发模拟图测试排版 ({totalToImport} 张)</span>
              </button>
            </div>
          )}
        </div>

        {/* 底部按钮栏 */}
        <div
          style={{
            padding: '14px 20px',
            backgroundColor: '#f8fafc',
            borderTop: '1px solid #f1f5f9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 10,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            style={{
              height: 36,
              padding: '0 16px',
              borderRadius: 8,
              border: '1px solid #e2e8f0',
              backgroundColor: '#ffffff',
              color: '#475569',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f5f9')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#ffffff')}
          >
            取消
          </button>

          <button
            type="button"
            onClick={() => handleImport(false)}
            disabled={loading || parsedSkus.length === 0 || selectedAssetTypes.length === 0}
            style={{
              height: 36,
              padding: '0 18px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: '#0f172a',
              color: '#ffffff',
              fontSize: 13,
              fontWeight: 600,
              cursor:
                loading || parsedSkus.length === 0 || selectedAssetTypes.length === 0
                  ? 'not-allowed'
                  : 'pointer',
              opacity:
                loading || parsedSkus.length === 0 || selectedAssetTypes.length === 0 ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              boxShadow: '0 2px 4px rgba(15, 23, 42, 0.15)',
              transition: 'opacity 150ms ease',
            }}
          >
            {loading ? (
              <>
                <Loader2
                  size={14}
                  className="animate-spin"
                  style={{ animation: 'spin 1s linear infinite' }}
                />
                <span>正在检索与置入…</span>
              </>
            ) : (
              <>
                <span>
                  导入到画布
                  {totalToImport > 0 ? ` (${totalToImport} 张)` : ''}
                </span>
                <ArrowRight size={14} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

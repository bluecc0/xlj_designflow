import React, { useState, useRef, useEffect } from 'react'
import { useCanvasStore } from '../store/canvasStore'
import { useViewportStore } from '../store/viewportStore'
import type { CanvasText } from '../types'

const FONT_SIZE_PRESETS = [12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 64, 72, 96]

const COLOR_PRESETS = [
  { label: '纯黑', color: '#0f172a' },
  { label: '深灰', color: '#475569' },
  { label: '中灰', color: '#94a3b8' },
  { label: '纯白', color: '#ffffff' },
  { label: '珊瑚红', color: '#ef4444' },
  { label: '暖橙', color: '#f97316' },
  { label: '金黄', color: '#f59e0b' },
  { label: '薄荷绿', color: '#10b981' },
  { label: '科技蓝', color: '#3b82f6' },
  { label: '霓虹紫', color: '#8b5cf6' },
]

export function TextToolbar() {
  const selectedIds = useCanvasStore((s) => s.selectedIds)
  const selectedType = useCanvasStore((s) => s.selectedType)
  const texts = useCanvasStore((s) => s.texts)
  const updateText = useCanvasStore((s) => s.updateText)
  const deleteSelected = useCanvasStore((s) => s.deleteSelected)
  const duplicateSelected = useCanvasStore((s) => s.duplicateSelected)

  const zoom = useViewportStore((s) => s.zoom)
  const panX = useViewportStore((s) => s.panX)
  const panY = useViewportStore((s) => s.panY)

  const [showSizeMenu, setShowSizeMenu] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)

  const sizeMenuRef = useRef<HTMLDivElement>(null)
  const colorPickerRef = useRef<HTMLDivElement>(null)
  const colorInputRef = useRef<HTMLInputElement>(null)

  // 点击外部关闭弹层
  useEffect(() => {
    if (!showSizeMenu && !showColorPicker) return
    const handleClickOutside = (e: MouseEvent) => {
      if (showSizeMenu && sizeMenuRef.current && !sizeMenuRef.current.contains(e.target as Node)) {
        setShowSizeMenu(false)
      }
      if (showColorPicker && colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setShowColorPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showSizeMenu, showColorPicker])

  if (selectedType !== 'text') return null

  const selectedTexts = (texts || []).filter((t) => selectedIds.includes(t.id))
  if (selectedTexts.length === 0) return null

  const firstText = selectedTexts[0]
  const currentFontSize = firstText.fontSize || 24
  const currentWeight = firstText.fontWeight || 'normal'
  const isBold = currentWeight === 'bold' || currentWeight === '600'
  const currentStyle = firstText.fontStyle || 'normal'
  const isItalic = currentStyle === 'italic'
  const currentColor = firstText.color || '#0f172a'
  const currentAlign = firstText.textAlign || 'left'

  const updateSelectedTexts = (patch: Partial<CanvasText>) => {
    for (const t of selectedTexts) {
      updateText(t.id, patch)
    }
  }

  // 计算选区在屏幕坐标系的中心与顶部位置
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const txt of selectedTexts) {
    const w = txt.width || 120
    const h = txt.height || (txt.fontSize || 24) * 1.5
    minX = Math.min(minX, txt.x)
    minY = Math.min(minY, txt.y)
    maxX = Math.max(maxX, txt.x + w)
    maxY = Math.max(maxY, txt.y + h)
  }

  if (minX === Infinity) return null

  const screenCenterX = ((minX + maxX) / 2) * zoom + panX
  const screenTopY = minY * zoom + panY - 52

  const clampedX = Math.max(200, Math.min(window.innerWidth - 200, screenCenterX))
  const clampedY = Math.max(62, screenTopY)

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: clampedX,
        top: clampedY,
        transform: 'translateX(-50%)',
        zIndex: 92,
      }}
    >
      <div className="designflow-upscale-toolbar" style={{ gap: 2, padding: '4px 8px' }}>
        {/* 1. 字号微调与下拉选择组 */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          {/* 字号 - */}
          <button
            type="button"
            className="designflow-toolbar-button"
            title="减小字号 (-2)"
            onClick={() => updateSelectedTexts({ fontSize: Math.max(10, currentFontSize - 2) })}
            style={{ width: 24, height: 26, padding: 0 }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>

          {/* 字号选择触发按钮 */}
          <div ref={sizeMenuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              className="designflow-toolbar-button"
              title="选择字号"
              onClick={() => setShowSizeMenu((s) => !s)}
              style={{
                height: 26,
                padding: '0 6px',
                fontSize: 12,
                fontWeight: 600,
                color: '#1e293b',
                minWidth: 44,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                backgroundColor: showSizeMenu ? '#eef1f6' : 'transparent',
              }}
            >
              <span>{currentFontSize}</span>
              <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {/* 字号下拉浮层 */}
            {showSizeMenu && (
              <div
                style={{
                  position: 'absolute',
                  top: 32,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  backgroundColor: 'rgba(255, 255, 255, 0.96)',
                  backdropFilter: 'blur(20px)',
                  WebkitBackdropFilter: 'blur(20px)',
                  border: '1px solid #e7e9ee',
                  borderRadius: 12,
                  boxShadow: '0 12px 32px rgba(20, 47, 95, 0.12), 0 2px 6px rgba(20, 47, 95, 0.04)',
                  padding: '4px',
                  maxHeight: 220,
                  overflowY: 'auto',
                  zIndex: 100,
                  minWidth: 70,
                }}
              >
                {FONT_SIZE_PRESETS.map((sz) => (
                  <div
                    key={sz}
                    onClick={() => {
                      updateSelectedTexts({ fontSize: sz })
                      setShowSizeMenu(false)
                    }}
                    style={{
                      padding: '5px 10px',
                      fontSize: 12,
                      fontWeight: sz === currentFontSize ? 700 : 500,
                      color: sz === currentFontSize ? '#0f172a' : '#475569',
                      backgroundColor: sz === currentFontSize ? '#eef1f6' : 'transparent',
                      borderRadius: 6,
                      cursor: 'pointer',
                      textAlign: 'center',
                      transition: 'all 120ms ease',
                    }}
                    onMouseEnter={(e) => {
                      if (sz !== currentFontSize) e.currentTarget.style.backgroundColor = '#f8fafc'
                    }}
                    onMouseLeave={(e) => {
                      if (sz !== currentFontSize) e.currentTarget.style.backgroundColor = 'transparent'
                    }}
                  >
                    {sz}px
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 字号 + */}
          <button
            type="button"
            className="designflow-toolbar-button"
            title="增大字号 (+2)"
            onClick={() => updateSelectedTexts({ fontSize: Math.min(160, currentFontSize + 2) })}
            style={{ width: 24, height: 26, padding: 0 }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>

        <span className="designflow-toolbar-divider" />

        {/* 2. 加粗 (B) */}
        <button
          type="button"
          className="designflow-toolbar-button"
          title="加粗 (Bold)"
          onClick={() => updateSelectedTexts({ fontWeight: isBold ? 'normal' : 'bold' })}
          style={{
            width: 28,
            height: 26,
            padding: 0,
            backgroundColor: isBold ? '#181b24' : 'transparent',
            color: isBold ? '#ffffff' : '#475569',
          }}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
            <path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
          </svg>
        </button>

        {/* 3. 斜体 (I) */}
        <button
          type="button"
          className="designflow-toolbar-button"
          title="斜体 (Italic)"
          onClick={() => updateSelectedTexts({ fontStyle: isItalic ? 'normal' : 'italic' })}
          style={{
            width: 28,
            height: 26,
            padding: 0,
            backgroundColor: isItalic ? '#181b24' : 'transparent',
            color: isItalic ? '#ffffff' : '#475569',
          }}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="4" x2="10" y2="4" />
            <line x1="14" y1="20" x2="5" y2="20" />
            <line x1="15" y1="4" x2="9" y2="20" />
          </svg>
        </button>

        <span className="designflow-toolbar-divider" />

        {/* 4. 颜色选择器 (Color) */}
        <div ref={colorPickerRef} style={{ position: 'relative' }}>
          <button
            type="button"
            className="designflow-toolbar-button"
            title="文字颜色"
            onClick={() => setShowColorPicker((c) => !c)}
            style={{
              height: 26,
              padding: '0 6px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              backgroundColor: showColorPicker ? '#eef1f6' : 'transparent',
            }}
          >
            <span
              style={{
                width: 16,
                height: 16,
                borderRadius: '50%',
                backgroundColor: currentColor,
                border: currentColor.toLowerCase() === '#ffffff' ? '1.5px solid #cbd5e1' : '1px solid rgba(0,0,0,0.15)',
                boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
              }}
            />
            <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {/* 颜色面板浮层 */}
          {showColorPicker && (
            <div
              style={{
                position: 'absolute',
                top: 32,
                left: '50%',
                transform: 'translateX(-50%)',
                backgroundColor: 'rgba(255, 255, 255, 0.96)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border: '1px solid #e7e9ee',
                borderRadius: 14,
                boxShadow: '0 12px 32px rgba(20, 47, 95, 0.12), 0 2px 6px rgba(20, 47, 95, 0.04)',
                padding: '10px',
                zIndex: 100,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                minWidth: 160,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', paddingBottom: 2 }}>预设颜色</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
                {COLOR_PRESETS.map((p) => (
                  <button
                    key={p.color}
                    type="button"
                    title={p.label}
                    onClick={() => {
                      updateSelectedTexts({ color: p.color })
                      setShowColorPicker(false)
                    }}
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      backgroundColor: p.color,
                      border: p.color === '#ffffff' ? '1.5px solid #cbd5e1' : '1px solid rgba(0,0,0,0.15)',
                      cursor: 'pointer',
                      boxShadow: p.color === currentColor ? '0 0 0 2px #3b82f6' : 'none',
                      transition: 'transform 120ms ease',
                      padding: 0,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.15)')}
                    onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1.0)')}
                  />
                ))}
              </div>

              {/* 自定义拾色器 */}
              <div style={{ borderTop: '1px solid #eef1f6', paddingTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: '#64748b' }}>自定义</span>
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '2px 8px',
                    borderRadius: 6,
                    backgroundColor: '#f1f5f9',
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#334155',
                    cursor: 'pointer',
                  }}
                >
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 3,
                      background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)',
                    }}
                  />
                  <span>拾色</span>
                  <input
                    ref={colorInputRef}
                    type="color"
                    value={currentColor}
                    onChange={(e) => updateSelectedTexts({ color: e.target.value })}
                    style={{ opacity: 0, position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }}
                  />
                </label>
              </div>
            </div>
          )}
        </div>

        <span className="designflow-toolbar-divider" />

        {/* 5. 文本对齐方式组 */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
          {/* 左对齐 */}
          <button
            type="button"
            className="designflow-toolbar-button"
            title="左对齐"
            onClick={() => updateSelectedTexts({ textAlign: 'left' })}
            style={{
              width: 26,
              height: 26,
              padding: 0,
              backgroundColor: currentAlign === 'left' ? '#181b24' : 'transparent',
              color: currentAlign === 'left' ? '#ffffff' : '#687083',
            }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="21" y1="6" x2="3" y2="6" />
              <line x1="15" y1="12" x2="3" y2="12" />
              <line x1="17" y1="18" x2="3" y2="18" />
            </svg>
          </button>

          {/* 居中对齐 */}
          <button
            type="button"
            className="designflow-toolbar-button"
            title="居中对齐"
            onClick={() => updateSelectedTexts({ textAlign: 'center' })}
            style={{
              width: 26,
              height: 26,
              padding: 0,
              backgroundColor: currentAlign === 'center' ? '#181b24' : 'transparent',
              color: currentAlign === 'center' ? '#ffffff' : '#687083',
            }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="6" />
              <line x1="21" y1="12" x2="3" y2="12" />
              <line x1="18" y1="18" x2="6" y2="18" />
            </svg>
          </button>

          {/* 右对齐 */}
          <button
            type="button"
            className="designflow-toolbar-button"
            title="右对齐"
            onClick={() => updateSelectedTexts({ textAlign: 'right' })}
            style={{
              width: 26,
              height: 26,
              padding: 0,
              backgroundColor: currentAlign === 'right' ? '#181b24' : 'transparent',
              color: currentAlign === 'right' ? '#ffffff' : '#687083',
            }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="21" y1="6" x2="3" y2="6" />
              <line x1="21" y1="12" x2="9" y2="12" />
              <line x1="21" y1="18" x2="7" y2="18" />
            </svg>
          </button>
        </div>

        <span className="designflow-toolbar-divider" />

        {/* 6. 复制与删除 */}
        <button
          type="button"
          className="designflow-toolbar-button"
          title="复制文本 (⌘D)"
          onClick={duplicateSelected}
          style={{ width: 26, height: 26, padding: 0 }}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>

        <button
          type="button"
          className="designflow-toolbar-button"
          title="删除文本 (Delete)"
          onClick={deleteSelected}
          style={{ width: 26, height: 26, padding: 0 }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'inherit')}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>
    </div>
  )
}

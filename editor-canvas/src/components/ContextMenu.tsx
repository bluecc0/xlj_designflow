import React, { memo, useEffect, useRef, useState } from 'react'
import {
  Files,
  Trash2,
  ChevronRight,
  ArrowUpToLine,
  ArrowUp,
  ArrowDown,
  ArrowDownToLine,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  Columns3,
  Rows3,
  LayoutGrid,
  Lock,
  Unlock,
  Maximize2,
  Focus,
  Maximize,
} from 'lucide-react'
import { useCanvasStore } from '../store/canvasStore'
import { useViewportStore } from '../store/viewportStore'

export interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  targetId?: string | null
  targetType?: 'image' | 'frame' | 'canvas' | 'text'
}

interface Props {
  menuState: ContextMenuState
  onClose: () => void
}

const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0
const MOD = isMac ? '⌘' : 'Ctrl+'

export const ContextMenu = memo(function ContextMenu({
  menuState,
  onClose,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null)

  const selectedIds = useCanvasStore((s) => s.selectedIds)
  const selectedType = useCanvasStore((s) => s.selectedType)
  const images = useCanvasStore((s) => s.images)
  const frames = useCanvasStore((s) => s.frames)
  const activePageId = useCanvasStore((s) => s.activePageId)

  const deleteSelected = useCanvasStore((s) => s.deleteSelected)
  const duplicateSelected = useCanvasStore((s) => s.duplicateSelected)
  const bringToFront = useCanvasStore((s) => s.bringToFront)
  const bringForward = useCanvasStore((s) => s.bringForward)
  const sendBackward = useCanvasStore((s) => s.sendBackward)
  const sendToBack = useCanvasStore((s) => s.sendToBack)
  const alignSelected = useCanvasStore((s) => s.alignSelected)
  const distributeSelected = useCanvasStore((s) => s.distributeSelected)
  const tidyUpSelected = useCanvasStore((s) => s.tidyUpSelected)
  const toggleLockSelected = useCanvasStore((s) => s.toggleLockSelected)
  const selectAll = useCanvasStore((s) => s.selectAll)
  const addFrame = useCanvasStore((s) => s.addFrame)

  const setZoom = useViewportStore((s) => s.setZoom)
  const setPan = useViewportStore((s) => s.setPan)
  const screenToCanvas = useViewportStore((s) => s.screenToCanvas)

  // 点击外部关闭
  useEffect(() => {
    if (!menuState.visible) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleScrollOrWheel = () => onClose()
    document.addEventListener('mousedown', handleClick)
    window.addEventListener('wheel', handleScrollOrWheel, { passive: true })
    return () => {
      document.removeEventListener('mousedown', handleClick)
      window.removeEventListener('wheel', handleScrollOrWheel)
    }
  }, [menuState.visible, onClose])

  if (!menuState.visible) return null

  // 边界防溢出计算
  const menuWidth = 196
  const menuHeight = 220
  const winW = window.innerWidth
  const winH = window.innerHeight

  const posX = menuState.x + menuWidth > winW - 12 ? Math.max(12, menuState.x - menuWidth) : menuState.x
  const posY = menuState.y + menuHeight > winH - 12 ? Math.max(12, menuState.y - menuHeight) : menuState.y

  const isMultipleSelected = selectedIds.length > 1
  const isSingleImage = selectedType === 'image' && selectedIds.length === 1
  const singleImage = isSingleImage ? images.find((im) => im.id === selectedIds[0]) : null

  // 创建画板
  const handleCreateFrame = (w = 1080, h = 1080) => {
    const pt = screenToCanvas({ x: menuState.x, y: menuState.y })
    const newFrame = addFrame({
      id: 'frame-' + Math.random().toString(36).slice(2, 10),
      x: Math.round(pt.x),
      y: Math.round(pt.y),
      width: w,
      height: h,
    })
    useCanvasStore.getState().setSelected([newFrame.id], 'frame')
    onClose()
  }

  // 适应视图
  const handleZoomToFit = () => {
    const currentFrames = frames.filter((f) => f.pageId === activePageId)
    const currentImages = images.filter((im) => im.pageId === activePageId)
    const allBoxes = [
      ...currentFrames.map((f) => ({ x: f.x, y: f.y, w: f.width, h: f.height })),
      ...currentImages.map((im) => ({ x: im.x, y: im.y, w: im.width, h: im.height })),
    ]

    if (allBoxes.length === 0) {
      setZoom(1)
      setPan(window.innerWidth / 2, window.innerHeight / 2)
      onClose()
      return
    }

    const minX = Math.min(...allBoxes.map((b) => b.x))
    const maxX = Math.max(...allBoxes.map((b) => b.x + b.w))
    const minY = Math.min(...allBoxes.map((b) => b.y))
    const maxY = Math.max(...allBoxes.map((b) => b.y + b.h))

    const totalW = maxX - minX
    const totalH = maxY - minY
    const screenW = window.innerWidth
    const screenH = window.innerHeight

    const scaleX = (screenW - 160) / totalW
    const scaleY = (screenH - 160) / totalH
    const nextZoom = Math.max(0.08, Math.min(2.0, Math.min(scaleX, scaleY)))

    const centerX = minX + totalW / 2
    const centerY = minY + totalH / 2

    setZoom(nextZoom)
    setPan(screenW / 2 - centerX * nextZoom, screenH / 2 - centerY * nextZoom)
    onClose()
  }

  return (
    <div
      ref={menuRef}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      style={{
        position: 'fixed',
        left: posX,
        top: posY,
        zIndex: 9999,
        width: menuWidth,
        padding: '5px',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(28px)',
        WebkitBackdropFilter: 'blur(28px)',
        borderRadius: 12,
        border: '1px solid #e5e8ee',
        boxShadow: '0 18px 46px rgba(20, 47, 95, 0.16), 0 2px 8px rgba(20, 47, 95, 0.06)',
        fontSize: 12,
        color: '#1e232d',
        userSelect: 'none',
      }}
    >
      {/* ─── 元素选中态菜单项 ─── */}
      {selectedIds.length > 0 ? (
        <>
          {/* 剪贴板操作 */}
          <div
            onClick={() => {
              duplicateSelected()
              onClose()
            }}
            style={menuItemStyle}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f4f8')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <Files size={14} color="#687083" strokeWidth={1.8} style={{ pointerEvents: 'none' }} />
            <span style={{ flex: 1 }}>创建副本</span>
            <span style={shortcutStyle}>{MOD}D</span>
          </div>

          <div
            onClick={() => {
              deleteSelected()
              onClose()
            }}
            style={{ ...menuItemStyle, color: '#ef4444' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#fee2e2')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <Trash2 size={14} color="#ef4444" strokeWidth={1.8} style={{ pointerEvents: 'none' }} />
            <span style={{ flex: 1 }}>删除</span>
            <span style={{ ...shortcutStyle, color: '#f87171' }}>⌫</span>
          </div>

          <div style={dividerStyle} />

          {/* 图层顺序子菜单 */}
          <div
            onMouseEnter={() => setActiveSubmenu('order')}
            onMouseLeave={() => setActiveSubmenu(null)}
            style={{ position: 'relative' }}
          >
            <div
              style={{
                ...menuItemStyle,
                backgroundColor: activeSubmenu === 'order' ? '#f1f4f8' : 'transparent',
              }}
            >
              <ArrowUpToLine size={14} color="#687083" strokeWidth={1.8} style={{ pointerEvents: 'none' }} />
              <span style={{ flex: 1 }}>图层层级</span>
              <ChevronRight size={13} color="#949dae" style={{ pointerEvents: 'none' }} />
            </div>

            {activeSubmenu === 'order' && (
              <div
                onMouseDown={(e) => e.stopPropagation()}
                onMouseUp={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: 'absolute',
                  left: '100%',
                  top: -5,
                  marginLeft: 4,
                  width: 176,
                  padding: '5px',
                  backgroundColor: 'rgba(255, 255, 255, 0.96)',
                  backdropFilter: 'blur(28px)',
                  WebkitBackdropFilter: 'blur(28px)',
                  borderRadius: 12,
                  border: '1px solid #e5e8ee',
                  boxShadow: '0 18px 46px rgba(20, 47, 95, 0.16)',
                  zIndex: 1000,
                }}
              >
                <div
                  onClick={() => {
                    bringToFront(selectedIds[0])
                    onClose()
                  }}
                  style={menuItemStyle}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f4f8')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <ArrowUpToLine size={13} color="#687083" style={{ pointerEvents: 'none' }} />
                  <span style={{ flex: 1 }}>置于顶层</span>
                  <span style={shortcutStyle}>]</span>
                </div>
                <div
                  onClick={() => {
                    bringForward(selectedIds[0])
                    onClose()
                  }}
                  style={menuItemStyle}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f4f8')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <ArrowUp size={13} color="#687083" style={{ pointerEvents: 'none' }} />
                  <span style={{ flex: 1 }}>上移一层</span>
                  <span style={shortcutStyle}>Alt+]</span>
                </div>
                <div
                  onClick={() => {
                    sendBackward(selectedIds[0])
                    onClose()
                  }}
                  style={menuItemStyle}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f4f8')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <ArrowDown size={13} color="#687083" style={{ pointerEvents: 'none' }} />
                  <span style={{ flex: 1 }}>下移一层</span>
                  <span style={shortcutStyle}>Alt+[</span>
                </div>
                <div
                  onClick={() => {
                    sendToBack(selectedIds[0])
                    onClose()
                  }}
                  style={menuItemStyle}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f4f8')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <ArrowDownToLine size={13} color="#687083" style={{ pointerEvents: 'none' }} />
                  <span style={{ flex: 1 }}>置于底层</span>
                  <span style={shortcutStyle}>[</span>
                </div>
              </div>
            )}
          </div>

          {/* 对齐与分布（多选 2 个以上） */}
          {isMultipleSelected && (
            <div
              onMouseEnter={() => setActiveSubmenu('align')}
              onMouseLeave={() => setActiveSubmenu(null)}
              style={{ position: 'relative' }}
            >
              <div
                style={{
                  ...menuItemStyle,
                  backgroundColor: activeSubmenu === 'align' ? '#f1f4f8' : 'transparent',
                }}
              >
                <AlignCenter size={14} color="#687083" strokeWidth={1.8} style={{ pointerEvents: 'none' }} />
                <span style={{ flex: 1 }}>对齐与分布</span>
                <ChevronRight size={13} color="#949dae" style={{ pointerEvents: 'none' }} />
              </div>

              {activeSubmenu === 'align' && (
                <div
                  onMouseDown={(e) => e.stopPropagation()}
                  onMouseUp={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: 'absolute',
                    left: '100%',
                    top: -5,
                    marginLeft: 4,
                    width: 184,
                    padding: '5px',
                    backgroundColor: 'rgba(255, 255, 255, 0.96)',
                    backdropFilter: 'blur(28px)',
                    WebkitBackdropFilter: 'blur(28px)',
                    borderRadius: 12,
                    border: '1px solid #e5e8ee',
                    boxShadow: '0 18px 46px rgba(20, 47, 95, 0.16)',
                    zIndex: 1000,
                  }}
                >
                  {/* 快速整理 (Tidy Up) */}
                  <div
                    onClick={() => {
                      tidyUpSelected('horizontal', 24)
                      onClose()
                    }}
                    style={menuItemStyle}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f4f8')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <Columns3 size={13} color="#687083" style={{ pointerEvents: 'none' }} />
                    <span>水平整理 (间距 24px)</span>
                  </div>
                  <div
                    onClick={() => {
                      tidyUpSelected('vertical', 24)
                      onClose()
                    }}
                    style={menuItemStyle}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f4f8')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <Rows3 size={13} color="#687083" style={{ pointerEvents: 'none' }} />
                    <span>垂直整理 (间距 24px)</span>
                  </div>
                  {selectedIds.length >= 3 && (
                    <div
                      onClick={() => {
                        tidyUpSelected('grid', 24)
                        onClose()
                      }}
                      style={menuItemStyle}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f4f8')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <LayoutGrid size={13} color="#687083" style={{ pointerEvents: 'none' }} />
                      <span>网格方阵排列</span>
                    </div>
                  )}

                  <div style={dividerStyle} />

                  <div
                    onClick={() => {
                      alignSelected('left')
                      onClose()
                    }}
                    style={menuItemStyle}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f4f8')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <AlignLeft size={13} color="#687083" style={{ pointerEvents: 'none' }} />
                    <span>左对齐</span>
                  </div>
                  <div
                    onClick={() => {
                      alignSelected('center')
                      onClose()
                    }}
                    style={menuItemStyle}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f4f8')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <AlignCenter size={13} color="#687083" style={{ pointerEvents: 'none' }} />
                    <span>水平居中</span>
                  </div>
                  <div
                    onClick={() => {
                      alignSelected('right')
                      onClose()
                    }}
                    style={menuItemStyle}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f4f8')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <AlignRight size={13} color="#687083" style={{ pointerEvents: 'none' }} />
                    <span>右对齐</span>
                  </div>
                  <div style={dividerStyle} />
                  <div
                    onClick={() => {
                      alignSelected('top')
                      onClose()
                    }}
                    style={menuItemStyle}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f4f8')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <AlignStartVertical size={13} color="#687083" style={{ pointerEvents: 'none' }} />
                    <span>顶对齐</span>
                  </div>
                  <div
                    onClick={() => {
                      alignSelected('middle')
                      onClose()
                    }}
                    style={menuItemStyle}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f4f8')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <AlignCenterVertical size={13} color="#687083" style={{ pointerEvents: 'none' }} />
                    <span>垂直居中</span>
                  </div>
                  <div
                    onClick={() => {
                      alignSelected('bottom')
                      onClose()
                    }}
                    style={menuItemStyle}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f4f8')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <AlignEndVertical size={13} color="#687083" style={{ pointerEvents: 'none' }} />
                    <span>底对齐</span>
                  </div>
                  {selectedIds.length >= 3 && (
                    <>
                      <div style={dividerStyle} />
                      <div
                        onClick={() => {
                          distributeSelected('horizontal')
                          onClose()
                        }}
                        style={menuItemStyle}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f4f8')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        <span>水平均匀分布</span>
                      </div>
                      <div
                        onClick={() => {
                          distributeSelected('vertical')
                          onClose()
                        }}
                        style={menuItemStyle}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f4f8')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        <span>垂直均匀分布</span>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          <div style={dividerStyle} />

          {/* 锁定 / 解锁 */}
          <div
            onClick={() => {
              toggleLockSelected()
              onClose()
            }}
            style={menuItemStyle}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f4f8')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            {singleImage?.locked ? (
              <>
                <Unlock size={14} color="#687083" strokeWidth={1.8} style={{ pointerEvents: 'none' }} />
                <span style={{ flex: 1 }}>解锁</span>
              </>
            ) : (
              <>
                <Lock size={14} color="#687083" strokeWidth={1.8} style={{ pointerEvents: 'none' }} />
                <span style={{ flex: 1 }}>锁定</span>
              </>
            )}
          </div>
        </>
      ) : (
        /* ─── 空白画布菜单项 ─── */
        <>
          {/* 新建画板子菜单 */}
          <div
            onMouseEnter={() => setActiveSubmenu('new-frame')}
            onMouseLeave={() => setActiveSubmenu(null)}
            style={{ position: 'relative' }}
          >
            <div
              style={{
                ...menuItemStyle,
                backgroundColor: activeSubmenu === 'new-frame' ? '#f1f4f8' : 'transparent',
              }}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#687083" strokeWidth="1.8" style={{ pointerEvents: 'none' }}>
                <line x1="4" y1="9" x2="20" y2="9" />
                <line x1="4" y1="15" x2="20" y2="15" />
                <line x1="10" y1="3" x2="8" y2="21" />
                <line x1="16" y1="3" x2="14" y2="21" />
              </svg>
              <span style={{ flex: 1 }}>新建画板</span>
              <ChevronRight size={13} color="#949dae" style={{ pointerEvents: 'none' }} />
            </div>

            {activeSubmenu === 'new-frame' && (
              <div
                onMouseDown={(e) => e.stopPropagation()}
                onMouseUp={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: 'absolute',
                  left: '100%',
                  top: -5,
                  marginLeft: 4,
                  zIndex: 1000,
                  width: 130,
                  padding: '5px',
                  backgroundColor: 'rgba(255, 255, 255, 0.96)',
                  backdropFilter: 'blur(28px)',
                  WebkitBackdropFilter: 'blur(28px)',
                  borderRadius: 12,
                  border: '1px solid #e5e8ee',
                  boxShadow: '0 18px 46px rgba(20, 47, 95, 0.16)',
                }}
              >
                <div
                  onClick={() => handleCreateFrame(1080, 1080)}
                  style={menuItemStyle}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f4f8')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <span style={{ fontWeight: 600 }}>1:1</span>
                </div>
                <div
                  onClick={() => handleCreateFrame(750, 1000)}
                  style={menuItemStyle}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f4f8')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <span style={{ fontWeight: 600 }}>3:4</span>
                </div>
                <div
                  onClick={() => handleCreateFrame(1920, 1080)}
                  style={menuItemStyle}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f4f8')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <span style={{ fontWeight: 600 }}>16:9</span>
                </div>
                <div
                  onClick={() => handleCreateFrame(1080, 1920)}
                  style={menuItemStyle}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f4f8')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <span style={{ fontWeight: 600 }}>9:16</span>
                </div>
              </div>
            )}
          </div>

          <div style={dividerStyle} />

          {/* 全选 */}
          <div
            onClick={() => {
              selectAll()
              onClose()
            }}
            style={menuItemStyle}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f4f8')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <Focus size={14} color="#687083" strokeWidth={1.8} style={{ pointerEvents: 'none' }} />
            <span style={{ flex: 1 }}>全选</span>
            <span style={shortcutStyle}>{MOD}A</span>
          </div>

          {/* 适应视图全部 */}
          <div
            onClick={handleZoomToFit}
            style={menuItemStyle}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f4f8')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <Maximize size={14} color="#687083" strokeWidth={1.8} style={{ pointerEvents: 'none' }} />
            <span style={{ flex: 1 }}>适应视图全部</span>
            <span style={shortcutStyle}>⇧1</span>
          </div>

          {/* 实际大小 100% */}
          <div
            onClick={() => {
              setZoom(1.0)
              onClose()
            }}
            style={menuItemStyle}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f4f8')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <Maximize2 size={14} color="#687083" strokeWidth={1.8} style={{ pointerEvents: 'none' }} />
            <span style={{ flex: 1 }}>实际大小 (100%)</span>
            <span style={shortcutStyle}>⇧0</span>
          </div>
        </>
      )}
    </div>
  )
})

const menuItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  padding: '7px 10px',
  borderRadius: 8,
  cursor: 'pointer',
  transition: 'background-color 100ms ease',
  fontSize: 12,
  fontWeight: 500,
}

const shortcutStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#949dae',
  fontFamily: 'monospace',
}

const dividerStyle: React.CSSProperties = {
  height: 1,
  backgroundColor: '#edf0f4',
  margin: '4px 2px',
}

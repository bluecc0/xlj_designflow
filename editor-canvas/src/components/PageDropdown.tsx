import React, { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check, Plus, Trash2, Edit2 } from 'lucide-react'
import { useCanvasStore } from '../store/canvasStore'

export function PageDropdown() {
  const pages = useCanvasStore((s) => s.pages)
  const activePageId = useCanvasStore((s) => s.activePageId)
  const switchPage = useCanvasStore((s) => s.switchPage)
  const createPage = useCanvasStore((s) => s.createPage)
  const renamePage = useCanvasStore((s) => s.renamePage)
  const deletePage = useCanvasStore((s) => s.deletePage)

  const [isOpen, setIsOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

  const dropdownRef = useRef<HTMLDivElement>(null)

  const activePage = pages.find((p) => p.id === activePageId) || pages[0] || { id: 'page-1', name: '画布 1' }

  // 点击外部关闭下拉框
  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setEditingId(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const handleStartRename = (id: string, currentName: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setEditingId(id)
    setEditingName(currentName)
  }

  const handleFinishRename = (id: string) => {
    if (editingName.trim()) {
      renamePage(id, editingName.trim())
    }
    setEditingId(null)
  }

  const handleCreateNew = (e: React.MouseEvent) => {
    e.stopPropagation()
    createPage()
  }

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      {/* 触发下拉的精致按钮（仅显示 画板 n ▾） */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          height: 24,
          padding: '0 6px',
          borderRadius: 6,
          border: 'none',
          backgroundColor: isOpen ? '#eef1f6' : 'transparent',
          color: '#20242d',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'all 120ms ease',
          letterSpacing: '-0.01em',
        }}
        onMouseEnter={(e) => {
          if (!isOpen) e.currentTarget.style.backgroundColor = '#eef1f6'
        }}
        onMouseLeave={(e) => {
          if (!isOpen) e.currentTarget.style.backgroundColor = 'transparent'
        }}
        title="点击切换或管理画布"
      >
        <span style={{ maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {activePage.name}
        </span>
        <ChevronDown
          size={12}
          strokeWidth={2}
          color="#687083"
          style={{
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 180ms ease',
          }}
        />
      </button>

      {/* 下拉浮层（字号缩小，紧凑精致） */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: 0,
            width: 176,
            padding: '4px',
            backgroundColor: 'rgba(255, 255, 255, 0.94)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            borderRadius: 12,
            border: '1px solid #e7e9ee',
            boxShadow: '0 16px 40px rgba(20, 47, 95, 0.12), 0 2px 8px rgba(20, 47, 95, 0.04)',
            zIndex: 100,
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
          }}
        >
          {/* 画布列表小标题 */}
          <div
            style={{
              padding: '3px 6px 4px',
              fontSize: 10,
              fontWeight: 500,
              color: '#9299a8',
              borderBottom: '1px solid #f0f2f5',
              marginBottom: 2,
            }}
          >
            画布列表 ({pages.length})
          </div>

          {/* 页面列表 */}
          <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
            {pages.map((page) => {
              const isActive = page.id === activePageId
              const isEditing = editingId === page.id

              return (
                <div
                  key={page.id}
                  onClick={() => {
                    if (!isEditing) {
                      switchPage(page.id)
                      setIsOpen(false)
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '5px 6px',
                    borderRadius: 6,
                    backgroundColor: isActive ? '#f1f5f9' : 'transparent',
                    color: isActive ? '#181b24' : '#687083',
                    fontSize: 11,
                    fontWeight: isActive ? 600 : 500,
                    cursor: 'pointer',
                    transition: 'background-color 120ms ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.backgroundColor = '#eef1f6'
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'
                  }}
                >
                  {/* 选中态指示勾 */}
                  <div style={{ width: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {isActive ? <Check size={11} strokeWidth={2.4} color="#181b24" /> : null}
                  </div>

                  {/* 画板名称 / 重命名输入框 */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {isEditing ? (
                      <input
                        autoFocus
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={() => handleFinishRename(page.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleFinishRename(page.id)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          fontSize: 11,
                          fontWeight: 500,
                          padding: '0 4px',
                          height: 18,
                          borderRadius: 3,
                          border: '1px solid #181b24',
                          outline: 'none',
                          width: '100%',
                          color: '#181b24',
                          backgroundColor: '#ffffff',
                          boxSizing: 'border-box',
                        }}
                      />
                    ) : (
                      <span
                        onDoubleClick={(e) => handleStartRename(page.id, page.name, e)}
                        title="双击重命名"
                        style={{
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {page.name}
                      </span>
                    )}
                  </div>

                  {/* 操作按钮组 (重命名 / 删除) */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {!isEditing && (
                      <button
                        type="button"
                        onClick={(e) => handleStartRename(page.id, page.name, e)}
                        style={{
                          border: 'none',
                          background: 'none',
                          cursor: 'pointer',
                          padding: '2px',
                          borderRadius: 3,
                          color: '#9299a8',
                          display: 'flex',
                          alignItems: 'center',
                          transition: 'color 120ms ease',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = '#20242d')}
                        onMouseLeave={(e) => (e.currentTarget.style.color = '#9299a8')}
                        title="重命名"
                      >
                        <Edit2 size={11} strokeWidth={1.8} />
                      </button>
                    )}

                    {pages.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          deletePage(page.id)
                        }}
                        style={{
                          border: 'none',
                          background: 'none',
                          cursor: 'pointer',
                          padding: '2px',
                          borderRadius: 3,
                          color: '#9299a8',
                          display: 'flex',
                          alignItems: 'center',
                          transition: 'color 120ms ease',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
                        onMouseLeave={(e) => (e.currentTarget.style.color = '#9299a8')}
                        title="删除画布"
                      >
                        <Trash2 size={11} strokeWidth={1.8} />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* 底部新增画布按钮 */}
          <div style={{ borderTop: '1px solid #f0f2f5', marginTop: 3, paddingTop: 3 }}>
            <button
              type="button"
              onClick={handleCreateNew}
              style={{
                display: 'flex',
                width: '100%',
                alignItems: 'center',
                gap: 6,
                padding: '5px 6px',
                borderRadius: 6,
                border: 'none',
                backgroundColor: 'transparent',
                color: '#20242d',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background-color 120ms ease',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#eef1f6')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <Plus size={13} strokeWidth={2.2} color="#181b24" />
              <span>新建画布</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

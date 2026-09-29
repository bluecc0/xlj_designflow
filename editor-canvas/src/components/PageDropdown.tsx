import React, { useState, useRef, useEffect } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Check,
  Plus,
  Trash2,
  Edit2,
  Folder,
  FolderPlus,
  Archive,
  RotateCcw,
  Layers,
} from 'lucide-react'
import { useCanvasStore } from '../store/canvasStore'
import type { CanvasPage } from '../types'

export function PageDropdown() {
  const pages = useCanvasStore((s) => s.pages)
  const groups = useCanvasStore((s) => s.groups) || []
  const activePageId = useCanvasStore((s) => s.activePageId)
  const switchPage = useCanvasStore((s) => s.switchPage)
  const createPage = useCanvasStore((s) => s.createPage)
  const renamePage = useCanvasStore((s) => s.renamePage)
  const deletePage = useCanvasStore((s) => s.deletePage)
  const archivePage = useCanvasStore((s) => s.archivePage)
  const unarchivePage = useCanvasStore((s) => s.unarchivePage)
  const createGroup = useCanvasStore((s) => s.createGroup)
  const renameGroup = useCanvasStore((s) => s.renameGroup)
  const deleteGroup = useCanvasStore((s) => s.deleteGroup)
  const toggleGroupCollapse = useCanvasStore((s) => s.toggleGroupCollapse)

  const [isOpen, setIsOpen] = useState(false)
  const [isArchivedOpen, setIsArchivedOpen] = useState(false)
  const [editingPageId, setEditingPageId] = useState<string | null>(null)
  const [editingPageName, setEditingPageName] = useState('')
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [editingGroupName, setEditingGroupName] = useState('')

  const dropdownRef = useRef<HTMLDivElement>(null)

  const activePage = pages.find((p) => p.id === activePageId) || pages[0] || { id: 'page-1', name: '画布 1' }

  // 页面分类
  const unarchivedPages = pages.filter((p) => !p.archived)
  const archivedPages = pages.filter((p) => p.archived)
  const canArchiveOrDeleteActive = unarchivedPages.length > 1

  // 激活归档画布时，默认展开归档抽屉
  useEffect(() => {
    if (activePage?.archived) {
      setIsArchivedOpen(true)
    }
  }, [activePage?.archived])

  // 点击外部关闭下拉框
  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setEditingPageId(null)
        setEditingGroupId(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  // 页面重命名
  const handleStartRenamePage = (id: string, currentName: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setEditingPageId(id)
    setEditingPageName(currentName)
  }

  const handleFinishRenamePage = (id: string) => {
    if (editingPageName.trim()) {
      renamePage(id, editingPageName.trim())
    }
    setEditingPageId(null)
  }

  // 分组重命名
  const handleStartRenameGroup = (id: string, currentName: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setEditingGroupId(id)
    setEditingGroupName(currentName)
  }

  const handleFinishRenameGroup = (id: string) => {
    if (editingGroupName.trim()) {
      renameGroup(id, editingGroupName.trim())
    }
    setEditingGroupId(null)
  }

  // 渲染单个画布行
  const renderPageItem = (page: CanvasPage, isArchived = false, isIndented = false) => {
    const isActive = page.id === activePageId
    const isEditing = editingPageId === page.id

    return (
      <div
        key={page.id}
        className={`canvas-page-item ${isActive ? 'is-selected' : ''}`}
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
          height: 30,
          padding: '0 8px',
          paddingLeft: isIndented ? 26 : 8,
          borderRadius: 8,
          color: isActive ? '#0f172a' : isArchived ? '#94a3b8' : '#334155',
          fontSize: 12,
          fontWeight: isActive ? 600 : 500,
          cursor: 'pointer',
        }}
      >
        {/* 左侧选中态对勾指示 */}
        <div style={{ width: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {isActive ? (
            <Check size={12} strokeWidth={2.4} color="#0f172a" />
          ) : (
            <div style={{ width: 3, height: 3, borderRadius: '50%', backgroundColor: '#cbd5e1', opacity: 0.5 }} />
          )}
        </div>

        {/* 画板名称 / 重命名输入框 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {isEditing ? (
            <input
              autoFocus
              value={editingPageName}
              onChange={(e) => setEditingPageName(e.target.value)}
              onBlur={() => handleFinishRenamePage(page.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleFinishRenamePage(page.id)
                if (e.key === 'Escape') setEditingPageId(null)
              }}
              onClick={(e) => e.stopPropagation()}
              style={{
                fontSize: 12,
                fontWeight: 500,
                padding: '1px 6px',
                height: 22,
                borderRadius: 4,
                border: '1px solid #0f172a',
                outline: 'none',
                width: '100%',
                color: '#0f172a',
                backgroundColor: '#ffffff',
                boxSizing: 'border-box',
              }}
            />
          ) : (
            <span
              onDoubleClick={(e) => handleStartRenamePage(page.id, page.name, e)}
              title="双击重命名"
              style={{
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontStyle: isArchived ? 'italic' : 'normal',
                letterSpacing: '-0.01em',
              }}
            >
              {page.name}
            </span>
          )}
        </div>

        {/* 仅在悬浮或重命名时展示操作项（通过 CSS 纯净淡入） */}
        <div
          className={`canvas-item-actions ${isEditing ? 'force-visible' : ''}`}
          onClick={(e) => e.stopPropagation()}
        >
          {!isEditing && (
            <button
              type="button"
              onClick={(e) => handleStartRenamePage(page.id, page.name, e)}
              style={iconButtonStyle}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#e2e8f0')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              title="重命名画布"
            >
              <Edit2 size={12} strokeWidth={1.8} color="#64748b" />
            </button>
          )}

          {/* 活跃画板：归档按钮 */}
          {!isArchived && !isEditing && (
            <button
              type="button"
              disabled={!canArchiveOrDeleteActive}
              onClick={(e) => {
                e.stopPropagation()
                if (canArchiveOrDeleteActive) archivePage(page.id)
              }}
              style={{
                ...iconButtonStyle,
                cursor: canArchiveOrDeleteActive ? 'pointer' : 'not-allowed',
                opacity: canArchiveOrDeleteActive ? 1 : 0.4,
              }}
              onMouseEnter={(e) => {
                if (canArchiveOrDeleteActive) e.currentTarget.style.backgroundColor = '#e2e8f0'
              }}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              title={canArchiveOrDeleteActive ? '归档此画布' : '至少保留一个未归档画布'}
            >
              <Archive size={12} strokeWidth={1.8} color="#64748b" />
            </button>
          )}

          {/* 已归档画板：恢复按钮 */}
          {isArchived && !isEditing && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                unarchivePage(page.id)
              }}
              style={iconButtonStyle}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#e2e8f0')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              title="移出归档并恢复"
            >
              <RotateCcw size={12} strokeWidth={1.8} color="#0f172a" />
            </button>
          )}

          {/* 删除按钮 */}
          {!isEditing && (isArchived || canArchiveOrDeleteActive) && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                deletePage(page.id)
              }}
              style={iconButtonStyle}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#fee2e2'
                const svg = e.currentTarget.querySelector('svg')
                if (svg) svg.style.stroke = '#ef4444'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent'
                const svg = e.currentTarget.querySelector('svg')
                if (svg) svg.style.stroke = '#64748b'
              }}
              title={isArchived ? '彻底删除此画布' : '删除画布'}
            >
              <Trash2 size={12} strokeWidth={1.8} color="#64748b" />
            </button>
          )}
        </div>
      </div>
    )
  }

  // 根级未分组活跃画布
  const rootPages = unarchivedPages.filter((p) => !p.groupId || !groups.some((g) => g.id === p.groupId))

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      {/* 顶部触发器胶囊内按钮 */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          height: 26,
          padding: '0 8px 0 6px',
          borderRadius: 7,
          border: 'none',
          backgroundColor: isOpen ? '#f1f5f9' : 'transparent',
          color: '#0f172a',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'all 140ms ease',
          letterSpacing: '-0.01em',
        }}
        onMouseEnter={(e) => {
          if (!isOpen) e.currentTarget.style.backgroundColor = '#f1f5f9'
        }}
        onMouseLeave={(e) => {
          if (!isOpen) e.currentTarget.style.backgroundColor = 'transparent'
        }}
        title="点击管理画布与分组"
      >
        <Layers size={13} strokeWidth={1.8} color="#64748b" style={{ flexShrink: 0 }} />

        {activePage.archived && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0 5px',
              height: 16,
              borderRadius: 4,
              backgroundColor: '#f1f5f9',
              color: '#475569',
              border: '1px solid #e2e8f0',
              fontSize: 10,
              fontWeight: 600,
            }}
          >
            已归档
          </span>
        )}

        <span style={{ maxWidth: 108, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {activePage.name}
        </span>

        <ChevronDown
          size={11}
          strokeWidth={2.2}
          color="#94a3b8"
          style={{
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 180ms ease',
          }}
        />
      </button>

      {/* 下拉面板 */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: 0,
            width: 256,
            padding: '6px',
            backgroundColor: 'rgba(255, 255, 255, 0.98)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            borderRadius: 14,
            border: '1px solid rgba(0, 0, 0, 0.08)',
            boxShadow: '0 20px 48px -8px rgba(15, 23, 42, 0.14), 0 4px 16px rgba(15, 23, 42, 0.04)',
            zIndex: 100,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {/* 面板顶栏提示 */}
          <div
            style={{
              padding: '5px 8px 6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid #f1f5f9',
              marginBottom: 3,
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', letterSpacing: '0.02em' }}>
              画布列表
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: '#64748b',
                backgroundColor: '#f1f5f9',
                padding: '1px 6px',
                borderRadius: 9999,
              }}
            >
              {unarchivedPages.length}
            </span>
          </div>

          {/* 活跃画布与分组滚动区 */}
          <div
            style={{
              maxHeight: 250,
              overflowY: 'auto',
              overscrollBehavior: 'contain',
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
            }}
          >
            {/* 1. 未分组的活跃画布 */}
            {rootPages.map((page) => renderPageItem(page, false, false))}

            {/* 2. 各分组与组内画布 */}
            {groups.map((group) => {
              const groupPages = unarchivedPages.filter((p) => p.groupId === group.id)
              const isGroupEditing = editingGroupId === group.id
              const isCollapsed = Boolean(group.collapsed)

              return (
                <div key={group.id} style={{ display: 'flex', flexDirection: 'column' }}>
                  {/* 分组头部栏 */}
                  <div
                    className="canvas-group-item"
                    onClick={() => {
                      if (!isGroupEditing) {
                        toggleGroupCollapse(group.id)
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      height: 30,
                      padding: '0 8px',
                      borderRadius: 8,
                      color: '#334155',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {/* 折叠箭头 */}
                    <div style={{ width: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <ChevronRight
                        size={11}
                        strokeWidth={2.2}
                        color="#94a3b8"
                        style={{
                          transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                          transition: 'transform 140ms ease',
                        }}
                      />
                    </div>

                    {/* 文件夹图标 */}
                    <Folder size={13} strokeWidth={1.8} color="#64748b" style={{ flexShrink: 0 }} />

                    {/* 分组名 / 输入框 */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {isGroupEditing ? (
                        <input
                          autoFocus
                          value={editingGroupName}
                          onChange={(e) => setEditingGroupName(e.target.value)}
                          onBlur={() => handleFinishRenameGroup(group.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleFinishRenameGroup(group.id)
                            if (e.key === 'Escape') setEditingGroupId(null)
                          }}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            padding: '1px 6px',
                            height: 22,
                            borderRadius: 4,
                            border: '1px solid #0f172a',
                            outline: 'none',
                            width: '100%',
                            color: '#0f172a',
                            backgroundColor: '#ffffff',
                            boxSizing: 'border-box',
                          }}
                        />
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span
                            onDoubleClick={(e) => handleStartRenameGroup(group.id, group.name, e)}
                            title="双击重命名分组"
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              letterSpacing: '-0.01em',
                            }}
                          >
                            {group.name}
                          </span>
                          <span style={{ fontSize: 10, fontWeight: 500, color: '#94a3b8' }}>
                            ({groupPages.length})
                          </span>
                        </div>
                      )}
                    </div>

                    {/* 分组悬浮操作项 */}
                    <div
                      className={`canvas-item-actions ${isGroupEditing ? 'force-visible' : ''}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* 在组内新建画布 */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          createPage(undefined, group.id)
                        }}
                        style={iconButtonStyle}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#e2e8f0')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                        title="在此组内新建画布"
                      >
                        <Plus size={12} strokeWidth={2.2} color="#0f172a" />
                      </button>

                      {/* 重命名分组 */}
                      {!isGroupEditing && (
                        <button
                          type="button"
                          onClick={(e) => handleStartRenameGroup(group.id, group.name, e)}
                          style={iconButtonStyle}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#e2e8f0')}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                          title="重命名分组"
                        >
                          <Edit2 size={12} strokeWidth={1.8} color="#64748b" />
                        </button>
                      )}

                      {/* 解散分组 */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteGroup(group.id)
                        }}
                        style={iconButtonStyle}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = '#fee2e2'
                          const svg = e.currentTarget.querySelector('svg')
                          if (svg) svg.style.stroke = '#ef4444'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'transparent'
                          const svg = e.currentTarget.querySelector('svg')
                          if (svg) svg.style.stroke = '#64748b'
                        }}
                        title="解散分组 (安全保留组内画布)"
                      >
                        <Trash2 size={12} strokeWidth={1.8} color="#64748b" />
                      </button>
                    </div>
                  </div>

                  {/* 展开展示组内画板 */}
                  {!isCollapsed && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {groupPages.length === 0 ? (
                        <div
                          style={{
                            padding: '4px 8px 4px 28px',
                            fontSize: 11,
                            color: '#94a3b8',
                            fontStyle: 'italic',
                          }}
                        >
                          组内暂无画布，点击 + 新建
                        </div>
                      ) : (
                        groupPages.map((page) => renderPageItem(page, false, true))
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* 3. 已归档专区 (折叠抽屉) */}
          <div style={{ borderTop: '1px solid #f1f5f9', marginTop: 4, paddingTop: 4 }}>
            <div
              onClick={() => setIsArchivedOpen((prev) => !prev)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                height: 28,
                padding: '0 8px',
                borderRadius: 7,
                color: '#64748b',
                fontSize: 11.5,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 120ms ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <div style={{ width: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <ChevronRight
                  size={11}
                  strokeWidth={2.2}
                  color="#94a3b8"
                  style={{
                    transform: isArchivedOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                    transition: 'transform 140ms ease',
                  }}
                />
              </div>
              <Archive size={12} strokeWidth={1.8} color="#64748b" style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, textAlign: 'left', letterSpacing: '-0.01em' }}>已归档</span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: archivedPages.length > 0 ? '#475569' : '#94a3b8',
                  backgroundColor: archivedPages.length > 0 ? '#f1f5f9' : 'transparent',
                  padding: archivedPages.length > 0 ? '1px 6px' : '0',
                  borderRadius: 9999,
                }}
              >
                {archivedPages.length}
              </span>
            </div>

            {/* 展开归档列表 */}
            {isArchivedOpen && (
              <div
                style={{
                  maxHeight: 140,
                  overflowY: 'auto',
                  overscrollBehavior: 'contain',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                  marginTop: 2,
                }}
              >
                {archivedPages.length === 0 ? (
                  <div
                    style={{
                      padding: '5px 8px 6px 28px',
                      fontSize: 11,
                      color: '#94a3b8',
                      fontStyle: 'italic',
                    }}
                  >
                    暂无已归档画布
                  </div>
                ) : (
                  archivedPages.map((page) => renderPageItem(page, true, false))
                )}
              </div>
            )}
          </div>

          {/* 底部新增操作组: [+ 新建画布] 与 [📁 新建组] */}
          <div
            style={{
              display: 'flex',
              gap: 6,
              borderTop: '1px solid #f1f5f9',
              marginTop: 4,
              paddingTop: 6,
            }}
          >
            {/* 新建画布 (主要行动点) */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                createPage()
              }}
              style={{
                flex: 1,
                height: 28,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                borderRadius: 7,
                border: 'none',
                backgroundColor: '#0f172a',
                color: '#ffffff',
                fontSize: 11.5,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 120ms ease',
                boxShadow: '0 1px 3px rgba(15, 23, 42, 0.12)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1e293b')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#0f172a')}
              title="在顶层新建画布"
            >
              <Plus size={12} strokeWidth={2.4} color="#ffffff" />
              <span>新建画布</span>
            </button>

            {/* 新建组 (次要行动点) */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                const newGroupId = createGroup()
                setEditingGroupId(newGroupId)
                setEditingGroupName('新分组')
              }}
              style={{
                flex: 1,
                height: 28,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                borderRadius: 7,
                border: '1px solid #e2e8f0',
                backgroundColor: '#ffffff',
                color: '#334155',
                fontSize: 11.5,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 120ms ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#f8fafc'
                e.currentTarget.style.borderColor = '#cbd5e1'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#ffffff'
                e.currentTarget.style.borderColor = '#e2e8f0'
              }}
              title="新建分组"
            >
              <FolderPlus size={12} strokeWidth={1.8} color="#475569" />
              <span>新建组</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const iconButtonStyle: React.CSSProperties = {
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  padding: '4px',
  borderRadius: 4,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background-color 120ms ease',
}

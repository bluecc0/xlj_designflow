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

  // 分类页面数据
  const unarchivedPages = pages.filter((p) => !p.archived)
  const archivedPages = pages.filter((p) => p.archived)
  const canArchiveOrDeleteActive = unarchivedPages.length > 1

  // 如果当前激活的是已归档画板，默认展开归档专区
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

  // 渲染单张画板条目
  const renderPageItem = (page: CanvasPage, isArchived = false, isIndented = false) => {
    const isActive = page.id === activePageId
    const isEditing = editingPageId === page.id

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
          padding: '4px 6px',
          paddingLeft: isIndented ? 22 : 6,
          borderRadius: 6,
          backgroundColor: isActive ? '#f1f5f9' : 'transparent',
          color: isActive ? '#181b24' : isArchived ? '#8a92a3' : '#4b5563',
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
        <div style={{ width: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {isActive ? <Check size={11} strokeWidth={2.4} color="#181b24" /> : null}
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
              onDoubleClick={(e) => handleStartRenamePage(page.id, page.name, e)}
              title="双击重命名"
              style={{
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontStyle: isArchived ? 'italic' : 'normal',
              }}
            >
              {page.name}
            </span>
          )}
        </div>

        {/* 操作按钮组 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
          {!isEditing && (
            <button
              type="button"
              onClick={(e) => handleStartRenamePage(page.id, page.name, e)}
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
                border: 'none',
                background: 'none',
                cursor: canArchiveOrDeleteActive ? 'pointer' : 'not-allowed',
                padding: '2px',
                borderRadius: 3,
                color: canArchiveOrDeleteActive ? '#9299a8' : '#d1d5db',
                display: 'flex',
                alignItems: 'center',
                transition: 'color 120ms ease',
              }}
              onMouseEnter={(e) => {
                if (canArchiveOrDeleteActive) e.currentTarget.style.color = '#d97706'
              }}
              onMouseLeave={(e) => {
                if (canArchiveOrDeleteActive) e.currentTarget.style.color = '#9299a8'
              }}
              title={canArchiveOrDeleteActive ? '归档画布' : '至少保留一个未归档画布'}
            >
              <Archive size={11} strokeWidth={1.8} />
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
              onMouseEnter={(e) => (e.currentTarget.style.color = '#10b981')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#9299a8')}
              title="恢复画布 (移出归档)"
            >
              <RotateCcw size={11} strokeWidth={1.8} />
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
              title={isArchived ? '彻底删除画布' : '删除画布'}
            >
              <Trash2 size={11} strokeWidth={1.8} />
            </button>
          )}
        </div>
      </div>
    )
  }

  // 未分组的活跃画板
  const rootPages = unarchivedPages.filter((p) => !p.groupId || !groups.some((g) => g.id === p.groupId))

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      {/* 触发下拉按钮 */}
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
              marginRight: 2,
            }}
          >
            已归档
          </span>
        )}
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

      {/* 下拉浮层 */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: 0,
            width: 236,
            padding: '4px',
            backgroundColor: 'rgba(255, 255, 255, 0.96)',
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
              padding: '4px 6px',
              fontSize: 10,
              fontWeight: 600,
              color: '#9299a8',
              borderBottom: '1px solid #f0f2f5',
              marginBottom: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>画布与分组</span>
            <span style={{ fontWeight: 500 }}>活跃: {unarchivedPages.length}</span>
          </div>

          {/* 活跃画板与分组滚动区域 */}
          <div
            style={{
              maxHeight: 240,
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
                    onClick={() => {
                      if (!isGroupEditing) {
                        toggleGroupCollapse(group.id)
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '4px 6px',
                      borderRadius: 6,
                      color: '#475569',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'background-color 120ms ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    {/* 折叠箭头 */}
                    <div style={{ width: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <ChevronRight
                        size={11}
                        strokeWidth={2.2}
                        color="#94a3b8"
                        style={{
                          transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                          transition: 'transform 120ms ease',
                        }}
                      />
                    </div>

                    {/* 文件夹图标 */}
                    <Folder size={12} strokeWidth={2} color="#475569" style={{ flexShrink: 0 }} />

                    {/* 分组名称 / 编辑框 */}
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
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '0 4px',
                            height: 18,
                            borderRadius: 3,
                            border: '1px solid #181b24',
                            outline: 'none',
                            width: '100%',
                            color: '#1e293b',
                            backgroundColor: '#ffffff',
                            boxSizing: 'border-box',
                          }}
                        />
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span
                            onDoubleClick={(e) => handleStartRenameGroup(group.id, group.name, e)}
                            title="双击重命名分组"
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
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

                    {/* 分组操作按钮 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
                      {/* 在组内新建画布 */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          createPage(undefined, group.id)
                        }}
                        style={{
                          border: 'none',
                          background: 'none',
                          cursor: 'pointer',
                          padding: '2px',
                          borderRadius: 3,
                          color: '#94a3b8',
                          display: 'flex',
                          alignItems: 'center',
                          transition: 'color 120ms ease',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = '#181b24')}
                        onMouseLeave={(e) => (e.currentTarget.style.color = '#94a3b8')}
                        title="在此组内新建画布"
                      >
                        <Plus size={11} strokeWidth={2.2} />
                      </button>

                      {/* 重命名分组 */}
                      {!isGroupEditing && (
                        <button
                          type="button"
                          onClick={(e) => handleStartRenameGroup(group.id, group.name, e)}
                          style={{
                            border: 'none',
                            background: 'none',
                            cursor: 'pointer',
                            padding: '2px',
                            borderRadius: 3,
                            color: '#94a3b8',
                            display: 'flex',
                            alignItems: 'center',
                            transition: 'color 120ms ease',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = '#20242d')}
                          onMouseLeave={(e) => (e.currentTarget.style.color = '#9299a8')}
                          title="重命名分组"
                        >
                          <Edit2 size={11} strokeWidth={1.8} />
                        </button>
                      )}

                      {/* 解散分组 */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteGroup(group.id)
                        }}
                        style={{
                          border: 'none',
                          background: 'none',
                          cursor: 'pointer',
                          padding: '2px',
                          borderRadius: 3,
                          color: '#94a3b8',
                          display: 'flex',
                          alignItems: 'center',
                          transition: 'color 120ms ease',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
                        onMouseLeave={(e) => (e.currentTarget.style.color = '#94a3b8')}
                        title="解散分组 (保留组内画布)"
                      >
                        <Trash2 size={11} strokeWidth={1.8} />
                      </button>
                    </div>
                  </div>

                  {/* 展开展示组内画板 */}
                  {!isCollapsed && (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {groupPages.length === 0 ? (
                        <div
                          style={{
                            padding: '3px 8px 3px 24px',
                            fontSize: 10,
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

          {/* 3. 已归档专区 (折叠面板) */}
          <div style={{ borderTop: '1px solid #f0f2f5', marginTop: 3, paddingTop: 3 }}>
            <div
              onClick={() => setIsArchivedOpen((prev) => !prev)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '4px 6px',
                borderRadius: 6,
                color: '#64748b',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background-color 120ms ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <div style={{ width: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <ChevronRight
                  size={11}
                  strokeWidth={2.2}
                  color="#94a3b8"
                  style={{
                    transform: isArchivedOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                    transition: 'transform 120ms ease',
                  }}
                />
              </div>
              <Archive size={12} strokeWidth={2} color="#64748b" style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, textAlign: 'left' }}>已归档</span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 500,
                  color: archivedPages.length > 0 ? '#475569' : '#94a3b8',
                  backgroundColor: archivedPages.length > 0 ? '#f1f5f9' : 'transparent',
                  border: archivedPages.length > 0 ? '1px solid #e2e8f0' : 'none',
                  padding: archivedPages.length > 0 ? '1px 5px' : '0',
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
                      padding: '4px 8px 6px 24px',
                      fontSize: 10,
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

          {/* 底部新增操作组: [+ 新建画布] 与 [📁+ 新建组] */}
          <div
            style={{
              display: 'flex',
              gap: 4,
              borderTop: '1px solid #f0f2f5',
              marginTop: 4,
              paddingTop: 4,
            }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                createPage()
              }}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                padding: '5px 4px',
                borderRadius: 6,
                border: 'none',
                backgroundColor: '#f8fafc',
                color: '#181b24',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background-color 120ms ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#eef1f6')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
              title="在顶层新建画布"
            >
              <Plus size={12} strokeWidth={2.4} color="#181b24" />
              <span>新建画布</span>
            </button>

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
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                padding: '5px 4px',
                borderRadius: 6,
                border: 'none',
                backgroundColor: '#f8fafc',
                color: '#181b24',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background-color 120ms ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#eef1f6')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
              title="新建分组"
            >
              <FolderPlus size={12} strokeWidth={2} color="#181b24" />
              <span>新建组</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

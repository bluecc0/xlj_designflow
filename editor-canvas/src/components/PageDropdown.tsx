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
  Share2,
  Link2Off,
  Users,
  Loader2,
} from 'lucide-react'
import { feedback, notifyError } from '../utils/feedback'
import { confirmAction } from '../utils/confirm'
import { useCanvasStore } from '../store/canvasStore'
import { useAIOperationStore } from '../store/aiOperationStore'
import { useTeamStore, type TeamCanvasMeta } from '../store/teamStore'
import { shareCanvasPage, unshareTeamCanvas } from '../services/teamCanvasService'
import { refreshTeamCanvases } from '../useTeamCanvasSync'
import type { CanvasPage } from '../types'

const currentUserId = new URLSearchParams(window.location.search).get('user_id') || ''

// 分享前等本地修改落盘，服务端才能拿到这页的最新内容
function waitUntilSaved(timeoutMs = 10000) {
  const started = Date.now()
  return new Promise<void>((resolve, reject) => {
    const check = () => {
      if (!useCanvasStore.getState().isDirty) return resolve()
      if (Date.now() - started > timeoutMs) return reject(new Error('画布还没保存完成，请稍后再分享'))
      setTimeout(check, 100)
    }
    check()
  })
}

export function PageDropdown() {
  const storePages = useCanvasStore((s) => s.pages)
  const storeGroups = useCanvasStore((s) => s.groups) || []
  const source = useTeamStore((s) => s.source)
  const personalPages = useTeamStore((s) => s.personalPages)
  const personalGroups = useTeamStore((s) => s.personalGroups)
  const teamCanvases = useTeamStore((s) => s.canvases)
  const requestOpen = useTeamStore((s) => s.requestOpen)
  // 打开团队画布时，store 里只有这一页；个人画布列表取自切换前保留的结构，只做跳转
  const inTeam = source.kind === 'team'
  const pages = inTeam ? personalPages : storePages
  const groups = inTeam ? personalGroups : storeGroups
  const [teamBusyId, setTeamBusyId] = useState<string | null>(null)
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
  const pendingPageSwitch = useRef<ReturnType<typeof window.setTimeout> | null>(null)

  const cancelPendingPageSwitch = () => {
    if (pendingPageSwitch.current !== null) {
      window.clearTimeout(pendingPageSwitch.current)
      pendingPageSwitch.current = null
    }
  }

  useEffect(() => cancelPendingPageSwitch, [isOpen])

  useEffect(() => {
    if (isOpen) refreshTeamCanvases()
  }, [isOpen])

  const activePage = (inTeam ? storePages[0] : pages.find((p) => p.id === activePageId))
    || pages[0] || { id: 'page-1', name: '画布 1' }

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
        cancelPendingPageSwitch()
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
    cancelPendingPageSwitch()
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
  const handleShare = async (page: CanvasPage) => {
    if (useAIOperationStore.getState().state.status === 'running') {
      feedback.show('有 AI 任务正在进行，完成后再分享', { tone: 'warn', key: 'team-share' })
      return
    }
    if (!(await confirmAction({
      title: `把「${page.name}」分享到团队？`,
      message: '分享后它会移到「团队」文件夹，所有人都能查看和编辑，你可以随时取消分享。',
      confirmText: '分享',
    }))) return
    setTeamBusyId(page.id)
    try {
      await waitUntilSaved()
      const { canvas } = await shareCanvasPage(page.id)
      useTeamStore.setState((s) => ({
        canvases: [...s.canvases.filter((c) => c.id !== canvas.id), canvas],
        personalPages: s.personalPages.filter((p) => p.id !== page.id),
      }))
      requestOpen({ kind: 'team', id: canvas.id })
      feedback.show(`已把「${page.name}」分享到团队`, { tone: 'ok', key: 'team-share' })
      setIsOpen(false)
    } catch (error) {
      notifyError(error, '暂时无法分享，请稍后再试。', { key: 'team-share' })
    } finally {
      setTeamBusyId(null)
    }
  }

  const handleUnshare = async (canvas: TeamCanvasMeta) => {
    if (!(await confirmAction({
      title: `取消分享「${canvas.name}」？`,
      message: '所有人的修改都会保留并回到你的个人画布，其他人将无法再打开它。',
      confirmText: '取消分享',
      cancelText: '保留分享',
      danger: true,
    }))) return
    setTeamBusyId(canvas.id)
    try {
      const isOpenNow = source.kind === 'team' && source.id === canvas.id
      if (isOpenNow) await waitUntilSaved()
      const { page_id } = await unshareTeamCanvas(canvas.id)
      if (isOpenNow) useCanvasStore.setState({ isDirty: false })
      useTeamStore.setState((s) => ({ canvases: s.canvases.filter((c) => c.id !== canvas.id) }))
      // 服务端已把这页写回个人画布，重新加载个人画布才能看到
      requestOpen({ kind: 'personal', pageId: page_id, reload: true })
      feedback.show(`已取消分享「${canvas.name}」，画布已回到你的个人画布`, { tone: 'ok', key: 'team-share' })
      setIsOpen(false)
    } catch (error) {
      notifyError(error, '暂时无法取消分享，请稍后再试。', { key: 'team-share' })
    } finally {
      setTeamBusyId(null)
    }
  }

  const renderTeamItem = (canvas: TeamCanvasMeta) => {
    const isActive = source.kind === 'team' && source.id === canvas.id
    const isEditing = editingPageId === canvas.page_id
    const isOwner = canvas.owner_id === currentUserId
    return (
      <div
        key={canvas.id}
        className={`canvas-page-item ${isActive ? 'is-selected' : ''}`}
        onClick={() => {
          if (isEditing) return
          cancelPendingPageSwitch()
          pendingPageSwitch.current = window.setTimeout(() => {
            pendingPageSwitch.current = null
            requestOpen({ kind: 'team', id: canvas.id })
            setIsOpen(false)
          }, isActive ? 500 : 0)
        }}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, height: 30, padding: '0 8px 0 26px', borderRadius: 8,
          color: isActive ? '#0f172a' : '#334155', fontSize: 12, fontWeight: isActive ? 600 : 500, cursor: 'pointer',
        }}
      >
        <div style={{ width: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {isActive ? <Check size={12} strokeWidth={2.4} color="#0f172a" />
            : <div style={{ width: 3, height: 3, borderRadius: '50%', backgroundColor: '#cbd5e1', opacity: 0.5 }} />}
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 5 }}>
          {isEditing ? (
            <input
              autoFocus
              aria-label="画布名称"
              value={editingPageName}
              onChange={(e) => setEditingPageName(e.target.value)}
              onBlur={() => handleFinishRenamePage(canvas.page_id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleFinishRenamePage(canvas.page_id)
                if (e.key === 'Escape') setEditingPageId(null)
              }}
              onClick={(e) => e.stopPropagation()}
              style={renameInputStyle}
            />
          ) : (
            <>
              <span
                onDoubleClick={(e) => isActive && handleStartRenamePage(canvas.page_id, activePage.name, e)}
                title={isActive ? '双击重命名' : canvas.name}
                style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-0.01em' }}
              >
                {isActive ? activePage.name : canvas.name}
              </span>
              <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 500, whiteSpace: 'nowrap', flexShrink: 0 }}>
                {isOwner ? '我' : canvas.owner_name}
              </span>
            </>
          )}
        </div>
        {isOwner && !isEditing && (
          <div className="canvas-item-actions" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              disabled={teamBusyId !== null}
              onClick={() => handleUnshare(canvas)}
              style={iconButtonStyle}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#e2e8f0')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              title="取消分享，画布回到我的个人画布"
            >
              {teamBusyId === canvas.id
                ? <Loader2 size={12} color="#64748b" style={{ animation: 'spin 1s linear infinite' }} />
                : <Link2Off size={12} strokeWidth={1.8} color="#64748b" />}
            </button>
          </div>
        )}
      </div>
    )
  }

  const renderPageItem = (page: CanvasPage, isArchived = false, isIndented = false) => {
    const isActive = !inTeam && page.id === activePageId
    const isEditing = editingPageId === page.id

    return (
      <div
        key={page.id}
        className={`canvas-page-item ${isActive ? 'is-selected' : ''}`}
        onClick={() => {
          if (!isEditing) {
            // Keep the row mounted long enough for a double-click to start renaming.
            cancelPendingPageSwitch()
            pendingPageSwitch.current = window.setTimeout(() => {
              pendingPageSwitch.current = null
              if (inTeam) requestOpen({ kind: 'personal', pageId: page.id })
              else switchPage(page.id)
              setIsOpen(false)
            }, inTeam ? 0 : 500)
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
              aria-label="画布名称"
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
              onDoubleClick={(e) => !inTeam && handleStartRenamePage(page.id, page.name, e)}
              title={inTeam ? page.name : '双击重命名'}
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
        {!inTeam && (
        <div
          className={`canvas-item-actions ${isEditing ? 'force-visible' : ''}`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 分享到团队 */}
          {!isArchived && !isEditing && (
            <button
              type="button"
              disabled={teamBusyId !== null}
              onClick={(e) => {
                e.stopPropagation()
                handleShare(page)
              }}
              style={iconButtonStyle}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#e2e8f0')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              title="分享到团队，所有人都能查看和编辑"
            >
              {teamBusyId === page.id
                ? <Loader2 size={12} color="#64748b" style={{ animation: 'spin 1s linear infinite' }} />
                : <Share2 size={12} strokeWidth={1.8} color="#64748b" />}
            </button>
          )}

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
        )}
      </div>
    )
  }

  // 根级未分组活跃画布
  const rootPages = unarchivedPages.filter((p) => !p.groupId || !groups.some((g) => g.id === p.groupId))

  return (
    <div ref={dropdownRef} onMouseDownCapture={cancelPendingPageSwitch} style={{ position: 'relative' }}>
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
            {/* 0. 团队文件夹：所有人分享的画布 */}
            {teamCanvases.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, paddingBottom: 4, marginBottom: 3, borderBottom: '1px solid #f1f5f9' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, height: 30, padding: '0 8px', color: '#334155', fontSize: 12, fontWeight: 600 }}>
                  <div style={{ width: 14, flexShrink: 0 }} />
                  <Users size={13} strokeWidth={1.8} color="#4f46e5" style={{ flexShrink: 0 }} />
                  <span style={{ letterSpacing: '-0.01em' }}>团队</span>
                  <span style={{ fontSize: 10, fontWeight: 500, color: '#94a3b8' }}>({teamCanvases.length})</span>
                </div>
                {teamCanvases.map(renderTeamItem)}
              </div>
            )}

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
                      if (!isGroupEditing && !inTeam) {
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
                    {!inTeam && <div
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
                    </div>}
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
                if (inTeam) {
                  requestOpen({ kind: 'personal', createPage: true })
                  setIsOpen(false)
                } else {
                  createPage()
                }
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
            {!inTeam && <button
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
            </button>}
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

const renameInputStyle: React.CSSProperties = {
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
}

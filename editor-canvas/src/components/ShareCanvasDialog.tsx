import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2 } from 'lucide-react'
import { notifyError } from '../utils/feedback'
import { listShareTargets } from '../services/teamCanvasService'
import type { TeamViewer } from '../store/teamStore'

interface ShareCanvasDialogProps {
  title: string
  confirmText: string
  ownerId: string
  // null 表示当前是全团队；新分享传空数组，默认进入“指定用户”
  initialMemberIds: string[] | null
  onCancel: () => void
  // 失败时抛错，弹窗保持打开
  onSubmit: (memberIds: string[] | null) => Promise<void>
}

export function ShareCanvasDialog({ title, confirmText, ownerId, initialMemberIds, onCancel, onSubmit }: ShareCanvasDialogProps) {
  const [wholeTeam, setWholeTeam] = useState(initialMemberIds === null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialMemberIds || []))
  const [users, setUsers] = useState<TeamViewer[] | null>(null)
  const [keyword, setKeyword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let active = true
    listShareTargets()
      .then((list) => { if (active) setUsers(list.filter((u) => u.id !== ownerId)) })
      .catch((error) => {
        if (!active) return
        setUsers([])
        notifyError(error, '暂时无法读取成员列表，请稍后再试。', { key: 'team-share' })
      })
    return () => { active = false }
  }, [ownerId])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  const visibleUsers = useMemo(() => {
    const query = keyword.trim().toLowerCase()
    return (users || []).filter((u) => !query || u.name.toLowerCase().includes(query))
  }, [users, keyword])
  // 名单里可能有已被删除的账号，只提交当前还存在的
  const memberIds = (users || []).filter((u) => selected.has(u.id)).map((u) => u.id)
  const canSubmit = !submitting && users !== null && (wholeTeam || memberIds.length > 0)

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const submit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await onSubmit(wholeTeam ? null : memberIds)
    } catch (error) {
      notifyError(error, '暂时无法保存共享范围，请稍后再试。', { key: 'team-share' })
      setSubmitting(false)
    }
  }

  return createPortal(
    <div style={overlayStyle} onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div role="dialog" aria-modal="true" aria-label={title} style={dialogStyle}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{title}</div>
        <div role="radiogroup" aria-label="共享范围" style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 8, backgroundColor: '#f1f5f9' }}>
          {[{ team: false, label: '指定用户' }, { team: true, label: '全团队' }].map((item) => (
            <button
              key={item.label}
              type="button"
              role="radio"
              aria-checked={wholeTeam === item.team}
              onClick={() => setWholeTeam(item.team)}
              style={{
                flex: 1, height: 28, border: 'none', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
                fontWeight: wholeTeam === item.team ? 600 : 400,
                color: wholeTeam === item.team ? '#0f172a' : '#64748b',
                backgroundColor: wholeTeam === item.team ? '#ffffff' : 'transparent',
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        {wholeTeam ? (
          <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.6 }}>所有同事都能查看和编辑这个画布。</div>
        ) : (
          <>
            <input
              aria-label="搜索同事"
              placeholder="搜索同事"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              style={searchStyle}
            />
            <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
              {users === null && <div style={hintStyle}>正在读取成员…</div>}
              {users !== null && visibleUsers.length === 0 && (
                <div style={hintStyle}>{keyword.trim() ? '没有找到匹配的同事' : '暂时没有可选择的同事'}</div>
              )}
              {visibleUsers.map((u) => (
                <label key={u.id} style={rowStyle}>
                  <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</span>
                </label>
              ))}
            </div>
            <div style={{ fontSize: 11, color: '#64748b' }}>
              已选 {memberIds.length} 人，他们都能查看和编辑这个画布。
            </div>
          </>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button type="button" onClick={onCancel} style={{ ...buttonStyle, backgroundColor: '#ffffff', color: '#475569', border: '1px solid #e2e8f0' }}>
            取消
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={submit}
            style={{ ...buttonStyle, backgroundColor: '#0f172a', color: '#ffffff', fontWeight: 600, border: '1px solid #0f172a', opacity: canSubmit ? 1 : 0.45, cursor: canSubmit ? 'pointer' : 'not-allowed' }}
          >
            {submitting && <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />}
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 10050, backgroundColor: 'rgba(15, 23, 42, 0.24)', display: 'grid', placeItems: 'center',
}

const dialogStyle: React.CSSProperties = {
  width: 360, maxWidth: 'calc(100vw - 32px)', borderRadius: 14, padding: 18, backgroundColor: '#ffffff',
  border: '1px solid #e2e8f0', boxShadow: '0 18px 50px rgba(15, 23, 42, 0.18)', display: 'flex', flexDirection: 'column', gap: 10,
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', boxSizing: 'border-box',
}

const searchStyle: React.CSSProperties = {
  height: 30, padding: '0 10px', borderRadius: 8, border: '1px solid #e2e8f0', outline: 'none', fontSize: 12,
  fontFamily: 'inherit', color: '#0f172a', boxSizing: 'border-box', width: '100%',
}

const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, minHeight: 30, padding: '0 6px', borderRadius: 6, fontSize: 12, color: '#334155', cursor: 'pointer',
}

const hintStyle: React.CSSProperties = { padding: '10px 6px', fontSize: 12, color: '#94a3b8' }

const buttonStyle: React.CSSProperties = {
  height: 32, padding: '0 14px', borderRadius: 8, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
}

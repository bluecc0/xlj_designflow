import React, { useEffect, useState } from 'react'
import { History, Loader2, RotateCcw, X } from 'lucide-react'
import { feedback, notifyError } from '../utils/feedback'
import { confirmAction } from '../utils/confirm'
import { useCanvasStore } from '../store/canvasStore'
import { useTeamStore } from '../store/teamStore'
import {
  listTeamActivity, listTeamVersions, restoreTeamVersion,
  type TeamActivityItem, type TeamVersionItem,
} from '../services/teamCanvasService'

const REFRESH_INTERVAL = 8000

function formatTime(seconds: number) {
  const date = new Date(seconds * 1000)
  const diff = Date.now() - date.getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  const pad = (n: number) => String(n).padStart(2, '0')
  const hm = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  return date.toDateString() === new Date().toDateString() ? hm : `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${hm}`
}

export function TeamActivityPanel() {
  const source = useTeamStore((s) => s.source)
  const open = useTeamStore((s) => s.activityOpen)
  const activityVersion = useTeamStore((s) => s.activityVersion)
  const setOpen = useTeamStore((s) => s.setActivityOpen)
  const restoreRecords = useCanvasStore((s) => s.restoreRecords)
  const [tab, setTab] = useState<'activity' | 'versions'>('activity')
  const [activity, setActivity] = useState<TeamActivityItem[] | null>(null)
  const [versions, setVersions] = useState<TeamVersionItem[] | null>(null)
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null)
  const canvasId = source.kind === 'team' ? source.id : null

  useEffect(() => {
    setActivity(null)
    setVersions(null)
  }, [canvasId])

  useEffect(() => {
    if (!open || !canvasId) return
    let stopped = false
    const load = () => {
      const task = tab === 'activity' ? listTeamActivity(canvasId).then((items) => !stopped && setActivity(items))
        : listTeamVersions(canvasId).then((items) => !stopped && setVersions(items))
      task.catch(() => {})
    }
    load()
    const timer = setInterval(load, REFRESH_INTERVAL)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [open, canvasId, tab, activityVersion])

  if (!open || !canvasId) return null

  const handleRestoreRecords = (item: TeamActivityItem) => {
    const restored = restoreRecords(item.payload || {})
    feedback.show(restored ? `已恢复 ${restored} 个元素` : '这些元素已经在画布里了', { tone: restored ? 'ok' : 'info', key: 'team-restore' })
  }

  const handleRestoreVersion = async (version: TeamVersionItem) => {
    if (!(await confirmAction({
      title: `恢复到 ${formatTime(version.created_at)} 的版本？`,
      message: '画布会整体换成这个版本，当前内容会先自动备份，可以再恢复回来。',
      confirmText: '恢复',
    }))) return
    setRestoringVersion(version.id)
    try {
      await restoreTeamVersion(canvasId, version.id)
      feedback.show('已恢复历史版本，几秒内同步到画布', { tone: 'ok', key: 'team-restore' })
      setTab('activity')
    } catch (error) {
      notifyError(error, '历史版本暂时无法恢复，请稍后再试。')
    } finally {
      setRestoringVersion(null)
    }
  }

  const list = tab === 'activity' ? activity : versions

  return (
    <div data-panel="team-activity" style={panelStyle} onMouseDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <style>{`
        [data-panel="team-activity"] button { font-family: inherit; }
        [data-panel="team-activity"] .ta-tab { border: 0; background: none; padding: 0 0 8px; font-size: 12px; color: #94a3b8; cursor: pointer; border-bottom: 2px solid transparent; }
        [data-panel="team-activity"] .ta-tab[aria-pressed="true"] { color: #0f172a; font-weight: 600; border-bottom-color: #0f172a; }
        [data-panel="team-activity"] .ta-btn { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 8px; border-radius: 6px; border: 1px solid #e2e8f0; background: #ffffff; color: #334155; font-size: 11px; font-weight: 500; cursor: pointer; }
        [data-panel="team-activity"] .ta-btn:hover:not(:disabled) { background: #f1f5f9; }
        [data-panel="team-activity"] .ta-close:hover { background: #f1f5f9; color: #334155; }
      `}</style>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
          <History size={14} /> 画布动态
        </div>
        <button type="button" className="ta-close" aria-label="关闭画布动态" onClick={() => setOpen(false)}
          style={{ border: 0, background: 'none', padding: 4, borderRadius: 6, color: '#94a3b8', cursor: 'pointer', display: 'flex' }}>
          <X size={14} />
        </button>
      </div>
      <div style={{ display: 'flex', gap: 16, padding: '10px 16px 0', borderBottom: '1px solid #f1f5f9' }}>
        <button type="button" className="ta-tab" aria-pressed={tab === 'activity'} onClick={() => setTab('activity')}>操作记录</button>
        <button type="button" className="ta-tab" aria-pressed={tab === 'versions'} onClick={() => setTab('versions')}>历史版本</button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 8px 10px' }}>
        {list === null ? (
          <div role="status" style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        ) : list.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: '#94a3b8' }}>
            {tab === 'activity' ? '暂无记录' : '编辑约 10 分钟后或删除内容前会自动保存版本'}
          </div>
        ) : tab === 'activity' ? (
          activity!.map((item) => (
            <div key={item.id} style={{ display: 'flex', gap: 9, padding: '9px 8px', borderRadius: 8 }}>
              <div style={avatarStyle}>
                {item.avatar_url
                  ? <img src={item.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : (item.username || '?').slice(0, 1).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: '#334155', lineHeight: 1.5 }}>
                  <strong style={{ color: '#0f172a', fontWeight: 600 }}>{item.username}</strong> {item.summary}
                </div>
                {item.action === 'generate' && Array.isArray(item.payload?.images) && (
                  <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                    {item.payload.images.slice(0, 4).map((im: any) => (
                      <img key={im.id} src={im.url} alt={im.name || ''} title={im.prompt || im.name || ''} loading="lazy"
                        style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover', background: '#f1f5f9' }} />
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>{formatTime(item.created_at)}</span>
                  {item.action === 'delete' && (
                    <button type="button" className="ta-btn" onClick={() => handleRestoreRecords(item)}>
                      <RotateCcw size={11} /> 恢复
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        ) : (
          versions!.map((version) => (
            <div key={version.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 8px', borderRadius: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>{formatTime(version.created_at)}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                  {version.reason} · {version.image_count} 张图片{version.created_by_name ? ` · ${version.created_by_name}` : ''}
                </div>
              </div>
              <button type="button" className="ta-btn" disabled={restoringVersion !== null} onClick={() => handleRestoreVersion(version)}>
                {restoringVersion === version.id ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <RotateCcw size={11} />}
                恢复
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 60,
  left: 16,
  zIndex: 85,
  width: 300,
  maxHeight: 'calc(100% - 140px)',
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: 'rgba(255, 255, 255, 0.98)',
  borderRadius: 14,
  border: '1px solid rgba(0, 0, 0, 0.08)',
  boxShadow: '0 20px 48px -8px rgba(15, 23, 42, 0.14), 0 4px 16px rgba(15, 23, 42, 0.04)',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
}

const avatarStyle: React.CSSProperties = {
  overflow: 'hidden',
  width: 24,
  height: 24,
  borderRadius: '50%',
  flexShrink: 0,
  display: 'grid',
  placeItems: 'center',
  backgroundColor: '#e2e8f0',
  color: '#334155',
  fontSize: 11,
  fontWeight: 600,
}

import React from 'react'
import { History, RotateCw, Users } from 'lucide-react'
import { PageDropdown } from './PageDropdown'
import { useTeamStore } from '../store/teamStore'

interface Props {
  saveStatus: 'saved' | 'saving' | 'error'
  saveError?: string
  onRetrySave?: () => void
}

export function TopBar({ saveStatus, saveError, onRetrySave }: Props) {
  const source = useTeamStore((s) => s.source)
  const canvases = useTeamStore((s) => s.canvases)
  const viewers = useTeamStore((s) => s.viewers)
  const switching = useTeamStore((s) => s.switching)
  const activityOpen = useTeamStore((s) => s.activityOpen)
  const setActivityOpen = useTeamStore((s) => s.setActivityOpen)
  const teamCanvas = source.kind === 'team' ? canvases.find((c) => c.id === source.id) : null

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        left: 16,
        zIndex: 80,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        height: 32,
        padding: '0 10px 0 5px',
        backgroundColor: 'rgba(255, 255, 255, 0.92)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderRadius: 9999,
        border: '1px solid rgba(0, 0, 0, 0.08)',
        boxShadow: '0 8px 24px -4px rgba(0, 0, 0, 0.08), 0 2px 6px -1px rgba(0, 0, 0, 0.03)',
        userSelect: 'none',
      }}
    >
      {/* 画板名称下拉选择器 */}
      <PageDropdown />

      {/* 团队画布：分享者、正在查看的成员与动态入口 */}
      {source.kind === 'team' && (
        <>
          <div style={{ width: 1, height: 12, backgroundColor: '#e2e8f0', margin: '0 1px' }} />
          <span
            title={teamCanvas ? `${teamCanvas.owner_name} 分享的团队画布，所有人都可以编辑` : '团队画布'}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 18, padding: '0 6px', borderRadius: 5,
              backgroundColor: '#eef2ff', color: '#4338ca', fontSize: 10.5, fontWeight: 600, whiteSpace: 'nowrap' }}
          >
            <Users size={11} strokeWidth={2} />
            团队{teamCanvas ? ` · ${teamCanvas.owner_name}` : ''}
          </span>
          {viewers.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center' }} title={`正在查看：${viewers.map((v) => v.name).join('、')}`}>
              {viewers.slice(0, 4).map((viewer, index) => (
                <span key={viewer.id} style={{ width: 20, height: 20, borderRadius: '50%', display: 'grid', placeItems: 'center',
                  marginLeft: index ? -5 : 0, border: '1.5px solid #ffffff', backgroundColor: VIEWER_COLORS[index % VIEWER_COLORS.length],
                  color: '#ffffff', fontSize: 10, fontWeight: 600, lineHeight: 1 }}>
                  {/* 小写字母没有上半部分，会显得偏低，统一用大写 */}
                  {viewer.name.slice(0, 1).toUpperCase()}
                </span>
              ))}
              {viewers.length > 4 && <span style={{ fontSize: 10, color: '#64748b', marginLeft: 3 }}>+{viewers.length - 4}</span>}
            </div>
          )}
          <button
            type="button"
            title="画布动态：操作记录与历史版本"
            aria-label="画布动态"
            aria-pressed={activityOpen}
            onClick={() => setActivityOpen(!activityOpen)}
            style={{ width: 24, height: 24, display: 'grid', placeItems: 'center', padding: 0, border: 0, borderRadius: 6,
              background: activityOpen ? '#f1f5f9' : 'transparent', color: '#64748b', cursor: 'pointer' }}
          >
            <History size={13} />
          </button>
        </>
      )}

      {/* 极简分隔点线 */}
      <div style={{ width: 1, height: 12, backgroundColor: '#e2e8f0', margin: '0 1px' }} />

      {/* 云端保存状态指示 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          paddingLeft: 3,
        }}
        title={saveStatus === 'saving' ? '正在保存到云端…' : saveStatus === 'error' ? saveError || '保存遇到异常' : '云端已实时同步'}
      >
        <div
          style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            backgroundColor: saveStatus === 'saving' ? '#f59e0b' : saveStatus === 'error' ? '#ef4444' : '#10b981',
            transition: 'background-color 200ms ease',
          }}
        />
        <span style={{ fontSize: 11, fontWeight: 500, color: '#64748b', letterSpacing: '-0.01em' }}>
          {switching ? '切换中' : saveStatus === 'saving' ? '保存中' : saveStatus === 'error' ? '保存失败' : '已保存'}
        </span>
      </div>
      {saveStatus === 'error' && onRetrySave && (
        <button
          type="button"
          title="重试保存"
          aria-label="重试保存"
          onClick={onRetrySave}
          style={{ width: 24, height: 24, display: 'grid', placeItems: 'center', padding: 0,
            border: 0, background: 'transparent', color: '#64748b', cursor: 'pointer' }}
        >
          <RotateCw size={13} />
        </button>
      )}
    </div>
  )
}

const VIEWER_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899']

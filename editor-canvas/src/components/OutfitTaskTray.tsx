import React, { memo, useEffect } from 'react'
import { AlertCircle, CheckCircle2, Loader2, Shirt, X } from 'lucide-react'

export interface OutfitTask {
  id: string
  label: string
  thumbUrl: string
  status: 'running' | 'done' | 'error'
  total: number
  done: number
  failed: number
  progress?: number
  message?: string
}

interface Props {
  tasks: OutfitTask[]
  onDismiss: (id: string) => void
}

const AUTO_DISMISS_MS = 6000

/**
 * AI 换装后台任务托盘：提交后弹窗即关闭，用户可继续编辑画布，这里展示进度与结果。
 */
export const OutfitTaskTray = memo(function OutfitTaskTray({ tasks, onDismiss }: Props) {
  // 全部成功的任务几秒后自动收起；失败的保留到用户手动关闭
  useEffect(() => {
    const timers = tasks
      .filter((t) => t.status === 'done' && t.failed === 0)
      .map((t) => setTimeout(() => onDismiss(t.id), AUTO_DISMISS_MS))
    return () => timers.forEach(clearTimeout)
  }, [tasks, onDismiss])

  if (tasks.length === 0) return null

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        top: 54,
        right: 16,
        zIndex: 1100,
        width: 280,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {tasks.map((task) => {
        const finished = task.done + task.failed
        const pct =
          task.status === 'running'
            ? Math.max(4, Math.min(96, task.progress ?? (finished / Math.max(1, task.total)) * 100))
            : 100
        return (
          <div
            key={task.id}
            style={{
              display: 'flex',
              gap: 10,
              padding: 10,
              borderRadius: 12,
              backgroundColor: 'rgba(255,255,255,0.97)',
              border: '1px solid #e5e8ee',
              boxShadow: '0 12px 32px rgba(20, 47, 95, 0.14)',
              fontSize: 12,
              color: '#1e232d',
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                flexShrink: 0,
                borderRadius: 8,
                overflow: 'hidden',
                backgroundColor: '#f1f5f9',
                position: 'relative',
              }}
            >
              <img src={task.thumbUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {task.status === 'running' && (
                  <Loader2 size={13} color="#2563eb" style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                )}
                {task.status === 'done' && <CheckCircle2 size={13} color="#16a34a" style={{ flexShrink: 0 }} />}
                {task.status === 'error' && <AlertCircle size={13} color="#ef4444" style={{ flexShrink: 0 }} />}
                <Shirt size={12} color="#687083" style={{ flexShrink: 0 }} />
                <span
                  style={{ fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  AI 换装 · {task.label}
                </span>
                {task.total > 1 && (
                  <span style={{ color: '#94a3b8', flexShrink: 0 }}>
                    {task.done}/{task.total}
                  </span>
                )}
                {task.status !== 'running' && (
                  <button
                    type="button"
                    onClick={() => onDismiss(task.id)}
                    style={{
                      border: 'none',
                      background: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      color: '#94a3b8',
                      display: 'flex',
                    }}
                    title="关闭"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
              <div
                style={{
                  color: task.status === 'error' ? '#ef4444' : '#64748b',
                  fontSize: 11,
                  lineHeight: 1.4,
                  overflow: 'hidden',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                }}
                title={task.message}
              >
                {task.message}
              </div>
              <div style={{ height: 3, borderRadius: 2, backgroundColor: '#eef2f7', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    backgroundColor:
                      task.status === 'error' ? '#ef4444' : task.status === 'done' ? '#16a34a' : '#2563eb',
                    transition: 'width 300ms ease',
                  }}
                />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
})

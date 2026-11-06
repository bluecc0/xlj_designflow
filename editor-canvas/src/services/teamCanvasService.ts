import { feedback } from '../utils/feedback'
import type { TeamCanvasMeta, TeamViewer } from '../store/teamStore'
import type { CanvasPage } from '../types'

export interface TeamActivityItem {
  id: number
  user_id: string
  username: string
  action: 'share' | 'unshare' | 'generate' | 'add' | 'delete' | 'rename' | 'restore_version' | string
  summary: string
  payload: Record<string, any>
  created_at: number
}

export interface TeamVersionItem {
  id: number
  revision: number
  reason: string
  created_by_name: string
  created_at: number
  image_count: number
  shape_count: number
}

// 团队画布不存在或已取消分享
export class TeamCanvasGoneError extends Error {}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...(init.headers || {}) } : init?.headers,
  })
  if (response.status === 404) throw new TeamCanvasGoneError('该团队画布已取消分享')
  if (!response.ok) throw feedback.responseError(response.status, await response.text())
  return response.json()
}

export const teamSnapshotUrl = (id: string) => `/team-canvases/${encodeURIComponent(id)}`
export const teamSnapshotSaveUrl = (id: string) => `/team-canvases/${encodeURIComponent(id)}/snapshot`

export function listTeamCanvases() {
  return request<{ canvases: TeamCanvasMeta[] }>('/team-canvases').then((d) => d.canvases)
}

export function shareCanvasPage(pageId: string) {
  return request<{ canvas: TeamCanvasMeta; personal_revision: number }>('/team-canvases', {
    method: 'POST',
    body: JSON.stringify({ page_id: pageId }),
  })
}

export function unshareTeamCanvas(id: string) {
  return request<{ page_id: string }>(`/team-canvases/${encodeURIComponent(id)}/unshare`, { method: 'POST' })
}

export function copyTeamCanvas(id: string) {
  return request<{ page: CanvasPage; personal_revision: number }>(
    `/team-canvases/${encodeURIComponent(id)}/copy`,
    { method: 'POST' },
  )
}

export function teamHeartbeat(id: string) {
  return request<{ revision: number; canvas: TeamCanvasMeta; viewers: TeamViewer[] }>(
    `/team-canvases/${encodeURIComponent(id)}/heartbeat`,
    { method: 'POST' },
  )
}

export function listTeamActivity(id: string) {
  return request<{ items: TeamActivityItem[] }>(`/team-canvases/${encodeURIComponent(id)}/activity`).then((d) => d.items)
}

export function listTeamVersions(id: string) {
  return request<{ items: TeamVersionItem[] }>(`/team-canvases/${encodeURIComponent(id)}/versions`).then((d) => d.items)
}

export function restoreTeamVersion(id: string, versionId: number) {
  return request<{ revision: number }>(
    `/team-canvases/${encodeURIComponent(id)}/versions/${versionId}/restore`,
    { method: 'POST' },
  )
}

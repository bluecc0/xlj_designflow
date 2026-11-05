import { create } from 'zustand'
import type { CanvasPage, CanvasPageGroup } from '../types'

// 编辑器当前打开的文档：个人画布（含多页）或某个团队共享画布（只有一页）
export type CanvasSource = { kind: 'personal' } | { kind: 'team'; id: string }

// 切换请求：由下拉菜单等发起，App 负责保存当前文档后再加载目标文档
export type OpenTarget =
  | { kind: 'personal'; pageId?: string; createPage?: boolean; reload?: boolean }
  | { kind: 'team'; id: string; restore?: boolean }

export interface TeamCanvasMeta {
  id: string
  name: string
  page_id: string
  owner_id: string
  owner_name: string
  revision: number
  updated_at: number
  updated_by_name: string
  image_count: number
}

export interface TeamViewer {
  id: string
  name: string
}

interface TeamStore {
  source: CanvasSource
  canvases: TeamCanvasMeta[]
  // 打开团队画布时，下拉菜单仍要列出个人画布，这里保留最近一次个人文档的页面结构
  personalPages: CanvasPage[]
  personalGroups: CanvasPageGroup[]
  viewers: TeamViewer[]
  pendingTarget: OpenTarget | null
  switching: boolean
  activityOpen: boolean
  activityVersion: number
  requestOpen: (target: OpenTarget) => void
  setCanvases: (canvases: TeamCanvasMeta[]) => void
  setActivityOpen: (open: boolean) => void
}

export const useTeamStore = create<TeamStore>((set) => ({
  source: { kind: 'personal' },
  canvases: [],
  personalPages: [],
  personalGroups: [],
  viewers: [],
  pendingTarget: null,
  switching: false,
  activityOpen: false,
  activityVersion: 0,
  requestOpen: (target) => set({ pendingTarget: target }),
  setCanvases: (canvases) => set({ canvases }),
  setActivityOpen: (open) => set({ activityOpen: open }),
}))

export function currentTeamCanvas(): TeamCanvasMeta | null {
  const { source, canvases } = useTeamStore.getState()
  if (source.kind !== 'team') return null
  return canvases.find((c) => c.id === source.id) || null
}

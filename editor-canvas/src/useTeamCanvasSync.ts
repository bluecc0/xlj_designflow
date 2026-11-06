import { useEffect, type MutableRefObject } from 'react'
import { feedback, notifyError } from './utils/feedback'
import { useCanvasStore } from './store/canvasStore'
import { setViewportNamespace } from './store/viewportStore'
import { useHistoryStore } from './store/historyStore'
import { useTeamStore, type CanvasSource, type OpenTarget, type TeamCanvasMeta } from './store/teamStore'
import { convertLegacyTldrawSnapshot } from './compat/legacyTldraw'
import { requestSnapshot } from './utils/snapshotSave'
import { listTeamCanvases, teamHeartbeat, teamSnapshotUrl, TeamCanvasGoneError } from './services/teamCanvasService'

const POLL_INTERVAL = 4000
const LIST_INTERVAL = 15000
const SAVE_WAIT_TIMEOUT = 15000
const LAST_SOURCE_KEY = `designflow_canvas_last_source_${new URLSearchParams(window.location.search).get('user_id') || 'default'}`

// 记住上次打开的是个人画布还是哪个团队画布，刷新或重新打开时回到那里
function readLastTeamCanvas(): string | null {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_SOURCE_KEY) || 'null')
    return saved?.kind === 'team' && typeof saved.id === 'string' ? saved.id : null
  } catch {
    return null
  }
}

function writeLastSource(source: CanvasSource) {
  try {
    localStorage.setItem(LAST_SOURCE_KEY, JSON.stringify(source))
  } catch {}
}

interface SyncRefs {
  snapshotHydratedRef: MutableRefObject<boolean>
  saveInFlightRef: MutableRefObject<boolean>
  isConflictRef: MutableRefObject<boolean>
}

interface Options extends SyncRefs {
  personalSnapshotUrl: string
  // 返回不允许切换的原因（例如 AI 任务进行中，结果需要回到当前画布）
  getBusyReason: () => string | null
  // 切换完成后回放切换期间排队的主站指令
  onSwitched: () => void
}

function upsertCanvas(canvases: TeamCanvasMeta[], canvas: TeamCanvasMeta) {
  return canvases.some((c) => c.id === canvas.id)
    ? canvases.map((c) => (c.id === canvas.id ? canvas : c))
    : [...canvases, canvas]
}

export function refreshTeamCanvases() {
  return listTeamCanvases()
    .then((canvases) => useTeamStore.getState().setCanvases(canvases))
    .catch(() => {})
}

// 当前打开的团队画布被取消分享或自己被移出名单：丢弃未保存的修改并回到个人画布
export function handleTeamCanvasGone() {
  const { source, canvases, switching, pendingTarget } = useTeamStore.getState()
  // 已经在切走（例如分享者自己刚取消分享），不用再提示
  if (source.kind !== 'team' || switching || pendingTarget) return
  const name = canvases.find((c) => c.id === source.id)?.name
  feedback.show(`${name ? `「${name}」` : '该团队画布'}已取消分享或你已被移出名单，已回到你的画布`, { tone: 'warn', key: 'team-canvas-gone' })
  useCanvasStore.setState({ isDirty: false })
  useTeamStore.setState((s) => ({ canvases: s.canvases.filter((c) => c.id !== source.id) }))
  useTeamStore.getState().requestOpen({ kind: 'personal' })
}

function waitForSaved({ saveInFlightRef, isConflictRef }: SyncRefs) {
  const started = Date.now()
  return new Promise<void>((resolve, reject) => {
    const check = () => {
      const { isDirty } = useCanvasStore.getState()
      if (!isDirty && !saveInFlightRef.current && !isConflictRef.current) return resolve()
      if (Date.now() - started > SAVE_WAIT_TIMEOUT) return reject(new Error('当前画布还没保存完成，请稍后再切换'))
      setTimeout(check, 100)
    }
    check()
  })
}

export function useTeamCanvasSync(options: Options) {
  const { snapshotHydratedRef, saveInFlightRef, isConflictRef } = options
  const source = useTeamStore((s) => s.source)
  const pendingTarget = useTeamStore((s) => s.pendingTarget)

  // 打开个人画布期间，同步保留它的页面结构，供团队画布模式下的下拉菜单使用
  useEffect(() => {
    const mirror = (pages = useCanvasStore.getState().pages, groups = useCanvasStore.getState().groups) => {
      if (useTeamStore.getState().source.kind === 'personal') {
        useTeamStore.setState({ personalPages: pages, personalGroups: groups })
      }
    }
    mirror()
    return useCanvasStore.subscribe((s, prev) => {
      if (s.pages !== prev.pages || s.groups !== prev.groups) mirror(s.pages, s.groups)
    })
  }, [])

  useEffect(() => {
    refreshTeamCanvases()
    const timer = setInterval(refreshTeamCanvases, LIST_INTERVAL)
    return () => clearInterval(timer)
  }, [])

  // 个人画布加载完成后，如果上次停在团队画布，直接切回去
  useEffect(() => {
    const lastTeamId = readLastTeamCanvas()
    if (!lastTeamId) return
    const started = Date.now()
    const timer = setInterval(() => {
      if (snapshotHydratedRef.current) {
        clearInterval(timer)
        useTeamStore.getState().requestOpen({ kind: 'team', id: lastTeamId, restore: true })
      } else if (Date.now() - started > 30000) {
        clearInterval(timer)
      }
    }, 50)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => useTeamStore.subscribe((s, prev) => {
    if (s.source !== prev.source) writeLastSource(s.source)
  }), [])

  // 处理切换请求：先等当前文档保存完成，再加载目标文档
  useEffect(() => {
    if (!pendingTarget || useTeamStore.getState().switching) return
    const target: OpenTarget = pendingTarget
    useTeamStore.setState({ pendingTarget: null })
    const current = useTeamStore.getState().source
    const store = useCanvasStore.getState()

    if (target.kind === 'personal' && current.kind === 'personal' && !target.reload) {
      if (target.pageId) store.switchPage(target.pageId)
      if (target.createPage) store.createPage()
      return
    }
    if (target.kind === 'team' && current.kind === 'team' && current.id === target.id) return

    const busy = options.getBusyReason()
    if (busy) {
      feedback.show(busy, { tone: 'warn', key: 'team-canvas-switch' })
      return
    }

    useTeamStore.setState({ switching: true })
    ;(async () => {
      try {
        await waitForSaved(options)
        snapshotHydratedRef.current = false
        const editSequence = useCanvasStore.getState().editSequence
        const url = target.kind === 'team' ? teamSnapshotUrl(target.id) : options.personalSnapshotUrl
        const res = await requestSnapshot(url)
        if (!res.ok) {
          if (target.kind === 'team' && res.status === 404) throw new TeamCanvasGoneError('该团队画布已取消分享，或你不在共享名单中')
          throw new Error(`画布加载失败 (${res.status})`)
        }
        const raw = typeof res.body?.snapshot === 'string' ? JSON.parse(res.body.snapshot) : res.body?.snapshot
        const doc = raw ? convertLegacyTldrawSnapshot(raw) : { version: 2, pages: [], frames: [], images: [], texts: [] }
        if (!doc) throw new Error('无法识别画布格式')
        // 等待期间画布又被改动（例如键盘操作）：保留修改，放弃这次切换
        if (useCanvasStore.getState().editSequence !== editSequence) {
          throw new Error('切换时画布有新的修改，已保留在当前画布，请保存后再切换')
        }

        useHistoryStore.getState().clear()
        setViewportNamespace(target.kind === 'team' ? `team_${target.id}` : '')
        // 先切换来源再加载文档，避免团队画布的页面被记成个人画布结构
        useTeamStore.setState((s) => ({
          source: target.kind === 'team' ? { kind: 'team', id: target.id } : { kind: 'personal' },
          viewers: [],
          canvases: target.kind === 'team' && res.body?.canvas ? upsertCanvas(s.canvases, res.body.canvas) : s.canvases,
        }))
        useCanvasStore.getState().loadDocument(
          doc,
          Number(res.body?.revision || 0),
          target.kind === 'personal' ? target.pageId : undefined,
        )
        if (target.kind === 'personal' && target.createPage) useCanvasStore.getState().createPage()
      } catch (error) {
        if (error instanceof TeamCanvasGoneError) {
          useTeamStore.setState((s) => ({ canvases: s.canvases.filter((c) => target.kind !== 'team' || c.id !== target.id) }))
          // 恢复上次的团队画布时它已取消分享：安静地留在个人画布
          if (target.kind === 'team' && target.restore) writeLastSource({ kind: 'personal' })
        }
        if (!(error instanceof TeamCanvasGoneError && target.kind === 'team' && target.restore)) {
          notifyError(error, '画布暂时无法切换，请稍后再试。', { key: 'team-canvas-switch' })
        }
      } finally {
        snapshotHydratedRef.current = true
        useTeamStore.setState({ switching: false })
        // 切换被放弃时，暂停存盘期间的修改要重新触发一次保存
        if (useCanvasStore.getState().isDirty) {
          useCanvasStore.setState((s) => ({ editSequence: s.editSequence + 1 }))
        }
        options.onSwitched()
        // 切换期间又收到的请求，在这里接着处理
        const next = useTeamStore.getState().pendingTarget
        if (next) useTeamStore.setState({ pendingTarget: { ...next } })
      }
    })()
  }, [pendingTarget])

  // 团队画布：定时上报在线状态，发现别人保存了新版本就合并进来
  useEffect(() => {
    if (source.kind !== 'team') return
    let stopped = false
    const canvasId = source.id
    const tick = async () => {
      try {
        const hb = await teamHeartbeat(canvasId)
        if (stopped) return
        useTeamStore.setState((s) => ({ viewers: hb.viewers, canvases: upsertCanvas(s.canvases, hb.canvas) }))
        const idle = () => {
          const st = useCanvasStore.getState()
          return !st.isDirty && !saveInFlightRef.current && !isConflictRef.current && snapshotHydratedRef.current
        }
        if (hb.revision <= useCanvasStore.getState().revision || !idle()) return
        const res = await requestSnapshot(teamSnapshotUrl(canvasId))
        if (stopped) return
        if (res.status === 404) throw new TeamCanvasGoneError('该团队画布已取消分享，或你不在共享名单中')
        const revision = Number(res.body?.revision || 0)
        if (!res.ok || revision <= useCanvasStore.getState().revision || !idle()) return
        const doc = convertLegacyTldrawSnapshot(res.body.snapshot)
        if (!doc) return
        useCanvasStore.getState().mergeConflictDocument(doc, revision)
        // 撤销记录是整份快照，保留它会在撤销时抹掉别人的修改
        useHistoryStore.getState().clear()
        useTeamStore.setState((s) => ({ activityVersion: s.activityVersion + 1 }))
      } catch (error) {
        if (!stopped && error instanceof TeamCanvasGoneError) handleTeamCanvasGone()
      }
    }
    tick()
    const timer = setInterval(tick, POLL_INTERVAL)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [source])
}

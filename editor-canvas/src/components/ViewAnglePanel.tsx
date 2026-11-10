import React, { useEffect, useRef, useState } from 'react'
import { AlertCircle, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Loader2, RotateCcw, X } from 'lucide-react'
import type { CanvasImage } from '../types'
import { normalizeAssetUrl, type ViewAngleRequest, type ViewAngleView } from '../services/aiImageService'

interface Props {
  image: CanvasImage
  onClose: () => void
  /** 提交成功后由调用方关闭弹窗；抛错时弹窗保持打开并展示错误 */
  onSubmit: (req: ViewAngleRequest) => Promise<void>
}

// 档位与后端 view_angle.py 一致。模型只能稳定执行这些档位，所以滑块按档吸附、显示方位名而不是角度数字。
// 旋转：相机向画面右侧绕主体转为正，-180 与 180 都是背面
const ROTATIONS: Array<[number, string]> = [
  [-180, '背面'], [-135, '左后方'], [-90, '左侧'], [-45, '左前方'], [0, '正面'],
  [45, '右前方'], [90, '右侧'], [135, '右后方'], [180, '背面'],
]
const HEIGHTS: Array<[number, string]> = [[-60, '贴地仰拍'], [-20, '仰视'], [0, '平视'], [30, '俯视'], [90, '鸟瞰']]
const ZOOMS: Array<[ViewAngleView['distance'], string]> = [
  ['extreme_close', '大特写'], ['closer', '近景'], ['same', '原景别'], ['farther', '远景'], ['extreme_far', '极远景'],
]
const ZOOM_SCALE: Record<string, number> = { extreme_close: 1.45, closer: 1.2, same: 1, farther: 0.78, extreme_far: 0.55 }
const MODES: Array<[ViewAngleRequest['mode'], string]> = [['subject', '主体'], ['camera', '摄像头']]
const DEFAULTS = { rotation: 0, height: 0, zoom: 'same' as ViewAngleView['distance'] }

let lastMode: ViewAngleRequest['mode'] = 'camera'

const C = {
  ink: '#1e232d',
  text: '#3a4150',
  muted: '#687083',
  subtle: '#98a0ae',
  line: '#e7e9ee',
  lineStrong: '#d5d9e1',
  panel: '#f7f8fa',
  surface: '#ffffff',
  danger: '#c43d3d',
  dangerBg: '#fdf1f1',
}

const nearest = <T,>(tiers: Array<[T, string]>, value: number, valueOf: (t: T) => number) =>
  tiers.reduce((best, tier) => (Math.abs(valueOf(tier[0]) - value) < Math.abs(valueOf(best[0]) - value) ? tier : best))[0]
const snapRotation = (deg: number) => nearest(ROTATIONS, ((((deg + 180) % 360) + 360) % 360) - 180, (v) => v)
const snapHeight = (deg: number) => nearest(HEIGHTS, deg, (v) => v)

/** 吸附档位的滑块：拖动或点击停在最近的一档，右侧显示档位名 */
function TierSlider<T extends string | number>({
  label, tiers, value, onChange, disabled, valueText,
}: {
  label: string; tiers: Array<[T, string]>; value: T; onChange: (v: T) => void; disabled?: boolean; valueText?: string
}) {
  const idx = Math.max(0, tiers.findIndex(([v]) => v === value))
  return (
    <div style={{ opacity: disabled ? 0.4 : 1 }}>
      <div style={styles.sliderHead}>
        <span style={styles.sliderLabel}>{label}</span>
        <span style={styles.sliderValue}>{valueText ?? tiers[idx][1]}</span>
      </div>
      <input
        type="range"
        className="va-range"
        aria-label={label}
        aria-valuetext={tiers[idx][1]}
        min={0}
        max={tiers.length - 1}
        step={1}
        value={idx}
        disabled={disabled}
        onChange={(e) => onChange(tiers[Number(e.target.value)][0])}
        style={{ '--va-fill': `${(idx / (tiers.length - 1)) * 100}%` } as React.CSSProperties}
      />
    </div>
  )
}

/** 预览上拖动：左右改旋转、上下改高度，松手吸附 */
function useDragAngles(rotation: number, height: number, onCommit: (r: number, h: number) => void, disabled: boolean) {
  const [live, setLive] = useState<{ r: number; h: number } | null>(null)
  const start = useRef<{ x: number; y: number; r: number; h: number } | null>(null)
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (disabled) return
      e.currentTarget.setPointerCapture(e.pointerId)
      start.current = { x: e.clientX, y: e.clientY, r: rotation, h: height }
      setLive({ r: rotation, h: height })
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current
      if (!s) return
      setLive({ r: s.r + (e.clientX - s.x) * 0.8, h: Math.max(-60, Math.min(90, s.h - (e.clientY - s.y) * 0.6)) })
    },
    onPointerUp: () => {
      if (live) onCommit(snapRotation(live.r), snapHeight(live.h))
      start.current = null
      setLive(null)
    },
  }
  return { r: live ? live.r : rotation, h: live ? live.h : height, handlers, dragging: Boolean(live) }
}

/** 主体模式：方块就是主体，正面贴原图，跟着旋转、高度、缩放、歪斜一起动 */
function SubjectPreview({ imageUrl, rotation, height, zoom, dutch }: {
  imageUrl: string; rotation: number; height: number; zoom: string; dutch: boolean
}) {
  const s = 104
  const face = (transform: string, content: React.ReactNode, bg = '#f1f3f7') => (
    <div style={{
      position: 'absolute', width: s, height: s, transform, backfaceVisibility: 'hidden', background: bg,
      border: `1px solid ${C.lineStrong}`, borderRadius: 8, overflow: 'hidden', display: 'flex', alignItems: 'center',
      justifyContent: 'center', fontSize: 15, fontWeight: 700, color: '#b6bcc8',
    }}>
      {content}
    </div>
  )
  return (
    <div style={{ perspective: 520, width: s, height: s, transform: `scale(${ZOOM_SCALE[zoom] ?? 1})`, transition: 'transform .3s' }}>
      <div style={{
        position: 'relative', width: s, height: s, transformStyle: 'preserve-3d',
        // 相机向右绕 = 主体相对镜头向左转；相机升高 = 看到顶面
        transform: `rotateZ(${dutch ? -25 : 0}deg) rotateX(${-height}deg) rotateY(${-rotation}deg)`,
        transition: 'transform .3s cubic-bezier(.2,.8,.2,1)',
      }}>
        {face(`translateZ(${s / 2}px)`, <img src={imageUrl} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />, '#fff')}
        {face(`rotateY(180deg) translateZ(${s / 2}px)`, 'B')}
        {face(`rotateY(90deg) translateZ(${s / 2}px)`, 'R')}
        {face(`rotateY(-90deg) translateZ(${s / 2}px)`, 'L')}
        {face(`rotateX(90deg) translateZ(${s / 2}px)`, 'T')}
        {face(`rotateX(-90deg) translateZ(${s / 2}px)`, '')}
      </div>
    </div>
  )
}

/** 摄像头模式：主体卡片不动，相机在球面上移动；缩放体现为相机离主体的远近 */
const TILT = (20 * Math.PI) / 180
function project(azDeg: number, elDeg: number, r: number) {
  const az = (azDeg * Math.PI) / 180, el = (elDeg * Math.PI) / 180
  const x = Math.sin(az) * Math.cos(el), y = Math.sin(el), z = Math.cos(az) * Math.cos(el)
  return { x: x * r, y: (z * Math.sin(TILT) - y * Math.cos(TILT)) * r, front: z * Math.cos(TILT) + y * Math.sin(TILT) > -0.05 }
}

function CameraPreview({ imageUrl, rotation, height, zoom, dutch }: {
  imageUrl: string; rotation: number; height: number; zoom: string; dutch: boolean
}) {
  const size = 230, c = size / 2, R = 92
  // 推近时相机贴近主体，拉远时相机在球外
  const camR = R * Math.min(1.12, Math.max(0.6, 1 / (ZOOM_SCALE[zoom] ?? 1) * 0.85))
  const cam = project(rotation, height, camR)
  const ring = (fn: (t: number) => { x: number; y: number }) =>
    Array.from({ length: 73 }, (_, i) => fn(i * 5)).map((p, i) => `${i ? 'L' : 'M'}${c + p.x} ${c + p.y}`).join(' ')
  return (
    <svg width={size} height={size} style={{ display: 'block', overflow: 'visible' }}>
      <circle cx={c} cy={c} r={R} fill="none" stroke={C.line} />
      {[-60, -20, 30, 60].map((lat) => (
        <path key={lat} d={ring((t) => project(t, lat, R))} fill="none" stroke={C.line} />
      ))}
      <path d={ring((t) => project(t, 0, R))} fill="none" stroke={C.lineStrong} />
      {[0, 45, 90, 135].map((lon) => (
        <path key={lon} d={ring((t) => project(lon, t - 180, R))} fill="none" stroke={C.line} />
      ))}
      {/* 主体卡片 */}
      <foreignObject x={c - 40} y={c - 30} width={80} height={60}>
        <div style={{ width: 80, height: 60, borderRadius: 6, overflow: 'hidden', border: `2px solid ${C.lineStrong}`, background: '#fff', boxSizing: 'border-box' }}>
          <img src={imageUrl} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      </foreignObject>
      <line x1={c} y1={c} x2={c + cam.x} y2={c + cam.y} stroke="#8b93a3" strokeWidth={1.2} strokeDasharray="3 3" opacity={cam.front ? 1 : 0.5} />
      {/* 相机 */}
      <g transform={`translate(${c + cam.x} ${c + cam.y}) rotate(${dutch ? -25 : 0})`} opacity={cam.front ? 1 : 0.55}>
        <rect x={-15} y={-11} width={30} height={22} rx={6} fill="#fff" stroke="#8b93a3" strokeWidth={1.4} />
        <circle r={5.5} fill="#fff" stroke={C.ink} strokeWidth={1.6} />
        <circle r={2} fill={C.ink} />
      </g>
    </svg>
  )
}

export const ViewAnglePanel: React.FC<Props> = ({ image, onClose, onSubmit }) => {
  const [mode, setMode] = useState<ViewAngleRequest['mode']>(lastMode)
  const [rotation, setRotation] = useState(DEFAULTS.rotation)
  const [height, setHeight] = useState(DEFAULTS.height)
  const [zoom, setZoom] = useState<ViewAngleView['distance']>(DEFAULTS.zoom)
  const [overShoulder, setOverShoulder] = useState(false)
  const [dutch, setDutch] = useState(false)
  const [resolution, setResolution] = useState<ViewAngleRequest['resolution']>('1K')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (!submitting) onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [submitting, onClose])

  // 清晰度跟随个人设置里的默认清晰度，面板上不再单独选择
  useEffect(() => {
    fetch('/auth/session', { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        const res = data?.user?.preferences?.default_resolution
        if (res === '2K' || res === '4K') setResolution(res)
      })
      .catch(() => {})
  }, [])

  const isBird = height === 90
  const azimuth = ((rotation % 360) + 360) % 360
  // 鸟瞰没有水平方位；背后过肩固定从身后高处拍（与后端 normalize_views 一致）
  const view: ViewAngleView = overShoulder
    ? { azimuth: 180, elevation: 30, distance: 'over_shoulder', dutch }
    : { azimuth: isBird ? 0 : azimuth, elevation: height, distance: zoom, dutch }
  const sameAsSource = view.azimuth === 0 && view.elevation === 0 && view.distance === 'same' && !dutch
  const sourceUrl = normalizeAssetUrl(image.url)
  const locked = overShoulder || submitting

  const drag = useDragAngles(isBird ? 0 : rotation, height, (r, h) => { setRotation(r); setHeight(h) }, locked)
  const previewRotation = overShoulder ? 180 : isBird && !drag.dragging ? 0 : drag.r
  const previewHeight = overShoulder ? 30 : drag.h
  const step = (dr: number, dh: number) => {
    if (locked) return
    if (dr) setRotation(snapRotation(rotation + dr))
    if (dh) {
      const i = HEIGHTS.findIndex(([v]) => v === height)
      setHeight(HEIGHTS[Math.max(0, Math.min(HEIGHTS.length - 1, i + dh))][0])
    }
  }

  const reset = () => {
    setRotation(DEFAULTS.rotation)
    setHeight(DEFAULTS.height)
    setZoom(DEFAULTS.zoom)
    setOverShoulder(false)
    setDutch(false)
    setError(null)
  }

  const submit = async () => {
    if (submitting || sameAsSource) return
    setSubmitting(true)
    setError(null)
    lastMode = mode
    try {
      await onSubmit({ sourceUrl: image.url, sourceName: image.name, views: [view], mode, resolution })
    } catch (err: any) {
      setError(err?.message || '提交失败')
      setSubmitting(false)
    }
  }

  const rotationText = overShoulder ? '背面' : isBird ? '—' : ROTATIONS.find(([v]) => v === rotation)?.[1]

  return (
    <div
      data-modal="view-angle"
      style={styles.backdrop}
      onMouseDown={(e) => {
        e.stopPropagation()
        if (e.target === e.currentTarget && !submitting) onClose()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="view-angle-title" style={styles.dialog} onMouseDown={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div id="view-angle-title" style={styles.title}>切换视角</div>
          <div style={{ display: 'flex', gap: 2 }}>
            <button type="button" onClick={reset} disabled={submitting} style={styles.iconButton} title="恢复默认" aria-label="恢复默认">
              <RotateCcw size={15} />
            </button>
            <button type="button" onClick={onClose} disabled={submitting} style={styles.iconButton} title="关闭 (Esc)" aria-label="关闭">
              <X size={16} />
            </button>
          </div>
        </div>

        <div style={styles.body}>
          <div role="tablist" aria-label="方式" style={styles.tabs}>
            {MODES.map(([key, text]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={mode === key}
                disabled={submitting}
                onClick={() => setMode(key)}
                style={{ ...styles.tab, ...(mode === key ? styles.tabActive : null) }}
              >
                {text}
              </button>
            ))}
          </div>

          <div style={styles.stage}>
            <div
              {...drag.handlers}
              style={{ ...styles.stageInner, cursor: locked ? 'default' : drag.dragging ? 'grabbing' : 'grab' }}
              title={locked ? undefined : '拖动预览：左右旋转，上下改高度'}
            >
              {mode === 'subject' ? (
                <SubjectPreview imageUrl={sourceUrl} rotation={previewRotation} height={previewHeight} zoom={overShoulder ? 'same' : zoom} dutch={dutch} />
              ) : (
                <CameraPreview imageUrl={sourceUrl} rotation={previewRotation} height={previewHeight} zoom={overShoulder ? 'closer' : zoom} dutch={dutch} />
              )}
            </div>
            {mode === 'camera' && !locked && (
              <>
                <button type="button" style={{ ...styles.arrow, top: 8, left: '50%', marginLeft: -12 }} onClick={() => step(0, 1)} aria-label="升高"><ChevronUp size={16} /></button>
                <button type="button" style={{ ...styles.arrow, bottom: 24, left: '50%', marginLeft: -12 }} onClick={() => step(0, -1)} aria-label="降低"><ChevronDown size={16} /></button>
                <button type="button" style={{ ...styles.arrow, left: 8, top: '50%', marginTop: -12 }} onClick={() => step(-45, 0)} aria-label="向左绕"><ChevronLeft size={16} /></button>
                <button type="button" style={{ ...styles.arrow, right: 8, top: '50%', marginTop: -12 }} onClick={() => step(45, 0)} aria-label="向右绕"><ChevronRight size={16} /></button>
              </>
            )}
            <div style={styles.stageNote}>看不到的一面由 AI 推测</div>
          </div>

          <TierSlider label="旋转" tiers={ROTATIONS} value={rotation} onChange={setRotation}
            disabled={locked || isBird} valueText={rotationText} />
          <TierSlider label="高度" tiers={HEIGHTS} value={height} onChange={setHeight} disabled={locked} />
          <TierSlider label="缩放" tiers={ZOOMS} value={zoom} onChange={setZoom} disabled={locked} />

          <div style={styles.extras}>
            <span style={{ color: C.subtle }}>特殊镜头</span>
            {([
              ['背后过肩', overShoulder, () => setOverShoulder((v) => !v), '从主体身后越过肩膀向前看'],
              ['画面歪斜', dutch, () => setDutch((v) => !v), '镜头倾斜约 25°（荷兰角）'],
            ] as Array<[string, boolean, () => void, string]>).map(([text, on, toggle, title]) => (
              <button
                key={text}
                type="button"
                aria-pressed={on}
                disabled={submitting}
                onClick={toggle}
                title={title}
                style={{ ...styles.chip, ...(on ? styles.chipActive : null) }}
              >
                {text}
              </button>
            ))}
          </div>

          {error && (
            <div role="alert" style={styles.error}>
              <AlertCircle size={13} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div style={styles.footer}>
          <button type="button" onClick={onClose} disabled={submitting} style={styles.secondaryButton}>取消</button>
          <button
            type="button"
            disabled={submitting || sameAsSource}
            onClick={submit}
            style={{ ...styles.primaryButton, opacity: submitting || sameAsSource ? 0.5 : 1 }}
            title={sameAsSource ? '请先调整到一个与原图不同的视角' : `${mode === 'subject' ? '主体' : '摄像头'} · ${resolution}`}
          >
            {submitting && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />}
            生成
          </button>
        </div>
      </div>
      <style>{`
        [data-modal="view-angle"] .va-range { -webkit-appearance: none; appearance: none; width: 100%; height: 22px; background: transparent; margin: 0; cursor: pointer; }
        [data-modal="view-angle"] .va-range:disabled { cursor: default; }
        [data-modal="view-angle"] .va-range::-webkit-slider-runnable-track { height: 3px; border-radius: 2px; background: linear-gradient(to right, ${C.ink} var(--va-fill), ${C.line} var(--va-fill)); }
        [data-modal="view-angle"] .va-range::-moz-range-track { height: 3px; border-radius: 2px; background: linear-gradient(to right, ${C.ink} var(--va-fill), ${C.line} var(--va-fill)); }
        [data-modal="view-angle"] .va-range::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; margin-top: -7.5px; border-radius: 50%; background: #fff; border: 5px solid ${C.ink}; box-sizing: border-box; }
        [data-modal="view-angle"] .va-range::-moz-range-thumb { width: 18px; height: 18px; border-radius: 50%; background: #fff; border: 5px solid ${C.ink}; box-sizing: border-box; }
        [data-modal="view-angle"] button:focus-visible, [data-modal="view-angle"] .va-range:focus-visible { outline: 2px solid ${C.ink}; outline-offset: 2px; }
      `}</style>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0, backgroundColor: 'rgba(20, 24, 32, 0.32)', backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 9999, padding: 16, userSelect: 'none',
  },
  dialog: {
    position: 'relative', width: 'min(400px, 94vw)', maxHeight: '92vh', backgroundColor: C.surface, borderRadius: 16,
    boxShadow: '0 24px 70px rgba(20, 30, 50, 0.18), 0 0 0 1px rgba(20, 30, 50, .06)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden', color: C.text,
  },
  header: { height: 52, padding: '0 12px 0 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 },
  title: { fontSize: 16, fontWeight: 700, color: C.ink, letterSpacing: '-0.01em' },
  iconButton: {
    width: 32, height: 32, borderRadius: 8, border: 'none', backgroundColor: 'transparent', color: C.muted,
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
  },
  body: { flex: 1, minHeight: 0, overflow: 'auto', padding: '0 20px 4px', display: 'flex', flexDirection: 'column', gap: 12 },
  tabs: { display: 'flex', padding: 3, background: '#f1f3f6', borderRadius: 11, flexShrink: 0 },
  tab: {
    flex: 1, height: 34, border: 'none', borderRadius: 9, background: 'transparent', color: C.muted,
    fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
  },
  tabActive: { background: C.surface, color: C.ink, fontWeight: 600, boxShadow: '0 1px 3px rgba(20,30,50,.12)' },
  stage: { position: 'relative', height: 260, borderRadius: 12, background: C.panel, overflow: 'hidden', flexShrink: 0 },
  stageInner: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'none' },
  stageNote: { position: 'absolute', left: 0, right: 0, bottom: 8, textAlign: 'center', fontSize: 11, color: C.subtle, pointerEvents: 'none' },
  arrow: {
    position: 'absolute', width: 24, height: 24, border: 'none', borderRadius: 6, background: 'transparent',
    color: C.subtle, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  sliderHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 },
  sliderLabel: { fontSize: 14, fontWeight: 600, color: C.ink },
  sliderValue: { fontSize: 13, color: C.muted },
  extras: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, flexWrap: 'wrap' },
  chip: {
    height: 26, padding: '0 10px', borderRadius: 13, border: `1px solid ${C.line}`, background: C.surface,
    color: C.text, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
  },
  // 用完整的 border 覆盖：只改 borderColor 时，取消选中会清掉简写里的颜色，边框变成黑色
  chipActive: { border: `1px solid ${C.ink}`, color: C.ink, fontWeight: 650, background: '#f1f3f6' },
  error: {
    display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.danger, background: C.dangerBg,
    padding: '6px 10px', borderRadius: 8,
  },
  footer: { display: 'flex', gap: 10, padding: '14px 20px 18px', flexShrink: 0 },
  secondaryButton: {
    flex: 1, height: 40, borderRadius: 10, border: `1px solid ${C.lineStrong}`, background: C.surface,
    color: C.ink, fontSize: 14, fontWeight: 550, cursor: 'pointer', fontFamily: 'inherit',
  },
  primaryButton: {
    flex: 1, height: 40, borderRadius: 10, border: 'none', background: C.ink, color: '#fff',
    fontSize: 14, fontWeight: 650, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontFamily: 'inherit',
  },
}

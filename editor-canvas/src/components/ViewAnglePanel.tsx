import React, { useEffect, useRef, useState } from 'react'
import { AlertCircle, Camera, Loader2, X } from 'lucide-react'
import type { CanvasImage } from '../types'
import { normalizeAssetUrl, type ViewAngleRequest, type ViewAngleView } from '../services/aiImageService'

interface Props {
  image: CanvasImage
  onClose: () => void
  /** 提交成功后由调用方关闭弹窗；抛错时弹窗保持打开并展示错误 */
  onSubmit: (req: ViewAngleRequest) => Promise<void>
}

// 档位与后端 view_angle.py 一致：方位 45° 一档，俯仰 3 档
const AZIMUTH_LABELS: Record<number, string> = {
  0: '正面', 45: '右前方', 90: '右侧', 135: '右后方', 180: '背面', 225: '左后方', 270: '左侧', 315: '左前方',
}
// 相对原机位描述：最终朝向由后端按原图主体的朝向换算，原图本身侧身时也成立
const AZIMUTH_HINTS: Record<number, string> = {
  0: '与原图同一方向',
  45: '相机向右绕 45°',
  90: '相机向右绕到侧面',
  135: '相机绕到右后方',
  180: '相机绕到主体背后',
  225: '相机绕到左后方',
  270: '相机向左绕到侧面',
  315: '相机向左绕 45°',
}
const ELEVATIONS: Array<[number, string]> = [[-20, '仰视'], [0, '平视'], [30, '俯视']]
const DISTANCES: Array<[ViewAngleView['distance'], string]> = [['closer', '近景'], ['same', '原景别'], ['farther', '远景']]
const MODES: Array<[ViewAngleRequest['mode'], string, string]> = [
  ['camera', '转镜头', '背景跟着机位变化，适合场景图'],
  ['subject', '转主体', '背景不变，主体原地转身，适合白底图'],
]
const RESOLUTIONS: ViewAngleRequest['resolution'][] = ['1K', '2K', '4K']
const PRESETS: Array<[number, string]> = [[315, '左前方'], [270, '左侧'], [180, '背面'], [90, '右侧'], [45, '右前方']]
// 「一次出 4 个视角」：左右两侧、背面、俯视
const FOUR_VIEWS: ViewAngleView[] = [
  { azimuth: 270, elevation: 0, distance: 'same' },
  { azimuth: 90, elevation: 0, distance: 'same' },
  { azimuth: 180, elevation: 0, distance: 'same' },
  { azimuth: 0, elevation: 30, distance: 'same' },
]

let lastMode: ViewAngleRequest['mode'] = 'camera'
let lastResolution: ViewAngleRequest['resolution'] = '1K'

const C = {
  ink: '#1e232d',
  text: '#3a4150',
  muted: '#687083',
  subtle: '#98a0ae',
  line: '#e7e9ee',
  lineStrong: '#d5d9e1',
  panel: '#f7f8fa',
  surface: '#ffffff',
  accent: '#2563eb',
  danger: '#c43d3d',
  dangerBg: '#fdf1f1',
}

const RING = { size: 228, center: 114, radius: 76 }

function snapAzimuth(deg: number): number {
  return (Math.round((((deg % 360) + 360) % 360) / 45) * 45) % 360
}

/** 俯视转盘：中心是主体（箭头朝下 = 朝向原机位），拖动或点击外圈的相机选择方位 */
function OrbitDial({ azimuth, onChange, disabled }: { azimuth: number; onChange: (a: number) => void; disabled: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragging = useRef(false)
  // 方位 0 在正下方，向画面右侧绕为正
  const point = (deg: number, r = RING.radius) => ({
    x: RING.center + Math.sin((deg * Math.PI) / 180) * r,
    y: RING.center + Math.cos((deg * Math.PI) / 180) * r,
  })
  const pick = (e: React.PointerEvent) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const scale = RING.size / rect.width
    const dx = (e.clientX - rect.left) * scale - RING.center
    const dy = (e.clientY - rect.top) * scale - RING.center
    if (Math.hypot(dx, dy) < 18) return
    onChange(snapAzimuth((Math.atan2(dx, dy) * 180) / Math.PI))
  }
  const cam = point(azimuth)
  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${RING.size} ${RING.size}`}
      width={RING.size}
      height={RING.size}
      role="slider"
      aria-label="机位方向"
      aria-valuemin={0}
      aria-valuemax={315}
      aria-valuenow={azimuth}
      aria-valuetext={AZIMUTH_LABELS[azimuth]}
      tabIndex={disabled ? -1 : 0}
      style={{ touchAction: 'none', cursor: disabled ? 'default' : 'pointer', outline: 'none', flexShrink: 0 }}
      onPointerDown={(e) => {
        if (disabled) return
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        pick(e)
      }}
      onPointerMove={(e) => dragging.current && pick(e)}
      onPointerUp={() => { dragging.current = false }}
      onKeyDown={(e) => {
        if (disabled) return
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onChange(snapAzimuth(azimuth + 45)) }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onChange(snapAzimuth(azimuth - 45)) }
      }}
    >
      <circle cx={RING.center} cy={RING.center} r={RING.radius} fill="none" stroke={C.line} strokeWidth={14} />
      {Object.keys(AZIMUTH_LABELS).map((key) => {
        const deg = Number(key)
        const p = point(deg)
        const t = point(deg, RING.radius + 24)
        return (
          <g key={deg}>
            <circle cx={p.x} cy={p.y} r={3} fill={deg === 0 ? C.muted : C.lineStrong} />
            {deg % 90 === 0 && (
              <text x={t.x} y={t.y + 4} textAnchor="middle" fontSize={10} fill={deg === azimuth ? C.accent : C.subtle}>
                {deg === 0 ? '原机位' : AZIMUTH_LABELS[deg]}
              </text>
            )}
          </g>
        )
      })}
      {/* 主体：圆点 + 朝向原机位的箭头 */}
      <circle cx={RING.center} cy={RING.center} r={16} fill={C.panel} stroke={C.lineStrong} />
      <path
        d={`M ${RING.center - 6} ${RING.center + 2} L ${RING.center} ${RING.center + 10} L ${RING.center + 6} ${RING.center + 2}`}
        fill="none"
        stroke={C.muted}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1={RING.center} y1={RING.center} x2={cam.x} y2={cam.y} stroke={C.accent} strokeWidth={1.2} strokeDasharray="3 3" />
      {/* 相机 */}
      <g transform={`translate(${cam.x} ${cam.y})`}>
        <circle r={13} fill={C.accent} />
        <g transform="translate(-7 -7)">
          <Camera size={14} color="#fff" strokeWidth={2} />
        </g>
      </g>
    </svg>
  )
}

/** 跟着机位转的小方块：正面贴原图，便于理解「现在要从哪边看」 */
function ViewCube({ imageUrl, azimuth, elevation }: { imageUrl: string; azimuth: number; elevation: number }) {
  const s = 84
  const face = (transform: string, content: React.ReactNode, bg = '#eef1f6'): React.ReactNode => (
    <div
      style={{
        position: 'absolute', width: s, height: s, transform, backfaceVisibility: 'hidden',
        background: bg, border: `1px solid ${C.lineStrong}`, borderRadius: 6, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: C.muted,
      }}
    >
      {content}
    </div>
  )
  return (
    <div style={{ width: 132, height: 132, perspective: 420, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div
        style={{
          position: 'relative', width: s, height: s, transformStyle: 'preserve-3d',
          // 机位向右绕 = 主体相对镜头向左转；机位升高 = 能看到顶面
          transform: `rotateX(${-elevation}deg) rotateY(${-azimuth}deg)`,
          transition: 'transform .35s cubic-bezier(.2,.8,.2,1)',
        }}
      >
        {face(`translateZ(${s / 2}px)`, <img src={imageUrl} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />, '#fff')}
        {face(`rotateY(180deg) translateZ(${s / 2}px)`, '背面')}
        {face(`rotateY(90deg) translateZ(${s / 2}px)`, '侧面')}
        {face(`rotateY(-90deg) translateZ(${s / 2}px)`, '侧面')}
        {face(`rotateX(90deg) translateZ(${s / 2}px)`, '顶面', '#f4f6f9')}
        {face(`rotateX(-90deg) translateZ(${s / 2}px)`, '底面', '#f4f6f9')}
      </div>
    </div>
  )
}

function Segmented<T extends string | number>({
  value, options, onChange, disabled, label,
}: { value: T; options: Array<[T, string, string?]>; onChange: (v: T) => void; disabled: boolean; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} style={styles.segmented}>
      {options.map(([key, text, title], idx) => {
        const active = key === value
        return (
          <button
            key={String(key)}
            type="button"
            role="radio"
            aria-checked={active}
            title={title}
            disabled={disabled}
            onClick={() => onChange(key)}
            style={{
              ...styles.segment,
              borderLeft: idx === 0 ? 'none' : `1px solid ${C.line}`,
              background: active ? C.ink : 'transparent',
              color: active ? '#fff' : C.text,
              fontWeight: active ? 650 : 500,
            }}
          >
            {text}
          </button>
        )
      })}
    </div>
  )
}

export const ViewAnglePanel: React.FC<Props> = ({ image, onClose, onSubmit }) => {
  const [azimuth, setAzimuth] = useState(180)
  const [elevation, setElevation] = useState(0)
  const [distance, setDistance] = useState<ViewAngleView['distance']>('same')
  const [mode, setMode] = useState<ViewAngleRequest['mode']>(lastMode)
  const [resolution, setResolution] = useState<ViewAngleRequest['resolution']>(lastResolution)
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

  const sameAsSource = azimuth === 0 && elevation === 0 && distance === 'same'
  const sourceUrl = normalizeAssetUrl(image.url)
  // 与后端 view_label 一致：方位不变时只显示俯仰和景别
  const viewText = [azimuth === 0 && !sameAsSource ? '' : AZIMUTH_LABELS[azimuth],
    elevation ? ELEVATIONS.find(([v]) => v === elevation)?.[1] : '',
    distance !== 'same' ? DISTANCES.find(([v]) => v === distance)?.[1] : ''].filter(Boolean).join(' · ')

  const submit = async (views: ViewAngleView[]) => {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    lastMode = mode
    lastResolution = resolution
    try {
      await onSubmit({ sourceUrl: image.url, sourceName: image.name, views, mode, resolution })
    } catch (err: any) {
      setError(err?.message || '提交失败')
      setSubmitting(false)
    }
  }

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
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="view-angle-title"
        style={styles.dialog}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={styles.header}>
          <div id="view-angle-title" style={styles.title}>切换视角</div>
          <button type="button" onClick={onClose} disabled={submitting} style={styles.iconButton} title="关闭 (Esc)" aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        <div style={styles.body}>
          <aside style={styles.leftCol}>
            <div style={styles.sourceBox}>
              <img src={sourceUrl} alt={image.name || '原图'} draggable={false} style={styles.sourceImg} />
            </div>
            <div style={styles.caption}>原图</div>
          </aside>

          <section style={styles.rightCol}>
            <div style={styles.fieldLabel}>机位</div>
            <div style={styles.orbitRow}>
              <OrbitDial azimuth={azimuth} onChange={setAzimuth} disabled={submitting} />
              <div style={styles.orbitSide}>
                <ViewCube imageUrl={sourceUrl} azimuth={azimuth} elevation={elevation} />
                <div style={styles.viewName}>{viewText}</div>
                <div style={styles.viewHint}>{AZIMUTH_HINTS[azimuth]}</div>
              </div>
            </div>
            <div style={styles.presets}>
              {PRESETS.map(([deg, text]) => (
                <button
                  key={deg}
                  type="button"
                  disabled={submitting}
                  onClick={() => setAzimuth(deg)}
                  style={{ ...styles.chip, ...(azimuth === deg ? styles.chipActive : null) }}
                >
                  {text}
                </button>
              ))}
            </div>

            <div style={styles.grid}>
              <div>
                <div style={styles.fieldLabel}>俯仰</div>
                <Segmented label="俯仰" value={elevation} options={ELEVATIONS} onChange={setElevation} disabled={submitting} />
              </div>
              <div>
                <div style={styles.fieldLabel}>景别</div>
                <Segmented label="景别" value={distance} options={DISTANCES} onChange={setDistance} disabled={submitting} />
              </div>
              <div>
                <div style={styles.fieldLabel}>方式</div>
                <Segmented label="方式" value={mode} options={MODES} onChange={setMode} disabled={submitting} />
              </div>
              <div>
                <div style={styles.fieldLabel}>清晰度</div>
                <Segmented
                  label="清晰度"
                  value={resolution}
                  options={RESOLUTIONS.map((r) => [r, r] as [ViewAngleRequest['resolution'], string])}
                  onChange={setResolution}
                  disabled={submitting}
                />
              </div>
            </div>
            <div style={styles.note}>原图里看不到的一面由 AI 推测，可能与实物不同。</div>
          </section>
        </div>

        <div style={styles.footer}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {error && (
              <div role="alert" style={styles.error}>
                <AlertCircle size={13} style={{ flexShrink: 0 }} />
                <span>{error}</span>
              </div>
            )}
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={() => submit(FOUR_VIEWS)}
            style={styles.secondaryButton}
            title="左侧、右侧、背面、俯视各出一张"
          >
            一次出 4 个视角
          </button>
          <button
            type="button"
            disabled={submitting || sameAsSource}
            onClick={() => submit([{ azimuth, elevation, distance }])}
            style={{ ...styles.primaryButton, opacity: submitting || sameAsSource ? 0.5 : 1 }}
            title={sameAsSource ? '请先选择一个与原图不同的视角' : undefined}
          >
            {submitting && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />}
            生成这个视角
          </button>
        </div>
      </div>
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
    position: 'relative', width: 'min(760px, 94vw)', maxHeight: '90vh', backgroundColor: C.surface, borderRadius: 14,
    boxShadow: '0 24px 70px rgba(20, 30, 50, 0.18), 0 0 0 1px rgba(20, 30, 50, .06)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden', color: C.text,
  },
  header: { height: 52, padding: '0 12px 0 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 },
  title: { fontSize: 15, fontWeight: 650, color: C.ink, letterSpacing: '-0.01em' },
  iconButton: {
    width: 32, height: 32, borderRadius: 8, border: 'none', backgroundColor: 'transparent', color: C.muted,
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
  },
  body: { flex: 1, minHeight: 0, display: 'flex', gap: 20, padding: '4px 20px 16px', overflow: 'auto', flexWrap: 'wrap' },
  leftCol: { width: 200, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 },
  sourceBox: {
    width: 200, height: 260, borderRadius: 10, background: C.panel, border: `1px solid ${C.line}`,
    display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  sourceImg: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' },
  caption: { fontSize: 12, color: C.subtle, textAlign: 'center' },
  rightCol: { flex: 1, minWidth: 300, display: 'flex', flexDirection: 'column', gap: 10 },
  fieldLabel: { fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6 },
  orbitRow: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  orbitSide: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 140 },
  viewName: { fontSize: 14, fontWeight: 650, color: C.ink },
  viewHint: { fontSize: 12, color: C.muted, textAlign: 'center' },
  presets: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  chip: {
    height: 28, padding: '0 10px', borderRadius: 14, border: `1px solid ${C.line}`, background: C.surface,
    color: C.text, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
  },
  chipActive: { borderColor: C.ink, color: C.ink, fontWeight: 650 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginTop: 4 },
  segmented: {
    display: 'flex', width: '100%', border: `1px solid ${C.line}`, borderRadius: 9, overflow: 'hidden', background: C.surface,
  },
  segment: {
    flex: 1, height: 30, padding: 0, border: 'none', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
  },
  note: { fontSize: 12, color: C.subtle, marginTop: 2 },
  footer: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px', borderTop: `1px solid ${C.line}`, flexShrink: 0,
  },
  error: {
    display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.danger, background: C.dangerBg,
    padding: '6px 10px', borderRadius: 8,
  },
  secondaryButton: {
    height: 34, padding: '0 14px', borderRadius: 9, border: `1px solid ${C.lineStrong}`, background: C.surface,
    color: C.ink, fontSize: 13, fontWeight: 550, cursor: 'pointer', fontFamily: 'inherit',
  },
  primaryButton: {
    height: 34, padding: '0 16px', borderRadius: 9, border: 'none', background: C.ink, color: '#fff',
    fontSize: 13, fontWeight: 650, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit',
  },
}

import React, { useEffect, useRef } from 'react'

interface Props {
  size?: number
  seed?: number
  color?: string
}

// 10 · 透镜焦散（Lens Caustic / Nephroid）：双对称彗星沿光学焦散曲线滑行
const TRAILS = 2
const PARTICLES_PER_TRAIL = 28
const TOTAL_PARTICLES = TRAILS * PARTICLES_PER_TRAIL
const PATH_STEPS = 160
const TRAIL_SPAN = 0.28
const DURATION_MS = 4600
const PULSE_DURATION_MS = 4600
const ROTATION_DURATION_MS = 34000
const STROKE_WIDTH = 3.8

function normalizeProgress(p: number): number {
  return ((p % 1) + 1) % 1
}

function samplePoint(progress: number, pulse: number): { x: number; y: number } {
  const t = progress * Math.PI * 2
  const k = 0.22 + pulse * 0.14
  const x = (Math.cos(t) * (1 - k) + k * Math.cos(3 * t)) * 35
  const y = (Math.sin(t) * (1 + k * 0.5) - k * Math.sin(3 * t)) * 32
  return { x: 50 + x, y: 50 + y }
}

function buildPath(pulse: number): string {
  const parts: string[] = new Array(PATH_STEPS + 1)
  for (let i = 0; i <= PATH_STEPS; i++) {
    const pt = samplePoint(i / PATH_STEPS, pulse)
    parts[i] = `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`
  }
  return parts.join(' ')
}

export const MathCurveLoader: React.FC<Props> = ({
  size = 34,
  seed = 0,
  color = '#94a3b8',
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const groupRef = useRef<SVGGElement | null>(null)
  const pathRef = useRef<SVGPathElement | null>(null)
  const circlesRef = useRef<(SVGCircleElement | null)[]>([])

  useEffect(() => {
    const svg = svgRef.current
    const group = groupRef.current
    const path = pathRef.current
    if (!svg || !group || !path) return

    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const phaseOffset = ((Number(seed) || 0) * 0.23) % 1
    const startTime = performance.now()
    let visible = true
    let raf = 0

    const io =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(
            (entries) => {
              visible = entries[0]?.isIntersecting !== false
            },
            { rootMargin: '64px' }
          )
        : null
    io?.observe(svg)

    const renderFrame = (now: number) => {
      const time = reduceMotion ? 0 : now - startTime
      const progress = ((time + phaseOffset * DURATION_MS) % DURATION_MS) / DURATION_MS
      const pulseProgress = ((time + phaseOffset * PULSE_DURATION_MS) % PULSE_DURATION_MS) / PULSE_DURATION_MS
      const pulse = (Math.sin(pulseProgress * Math.PI * 2) + 1) / 2
      const rotation = -(((time + phaseOffset * ROTATION_DURATION_MS) % ROTATION_DURATION_MS) / ROTATION_DURATION_MS) * 360

      group.setAttribute('transform', `rotate(${rotation.toFixed(2)} 50 50)`)
      path.setAttribute('d', buildPath(pulse))

      for (let tr = 0; tr < TRAILS; tr++) {
        const offset = tr / TRAILS
        for (let i = 0; i < PARTICLES_PER_TRAIL; i++) {
          const node = circlesRef.current[tr * PARTICLES_PER_TRAIL + i]
          if (!node) continue
          const tail = i / (PARTICLES_PER_TRAIL - 1)
          const pt = samplePoint(normalizeProgress(progress + offset - tail * TRAIL_SPAN), pulse)
          const fade = Math.pow(1 - tail, 0.58)
          node.setAttribute('cx', pt.x.toFixed(2))
          node.setAttribute('cy', pt.y.toFixed(2))
          node.setAttribute('r', (0.65 + fade * 1.95).toFixed(2))
          node.setAttribute('opacity', (0.03 + fade * 0.78).toFixed(3))
        }
      }
    }

    renderFrame(startTime)
    if (reduceMotion) {
      return () => {
        io?.disconnect()
      }
    }

    const tick = (now: number) => {
      raf = window.requestAnimationFrame(tick)
      if (!visible) return
      renderFrame(now)
    }
    raf = window.requestAnimationFrame(tick)

    return () => {
      window.cancelAnimationFrame(raf)
      io?.disconnect()
    }
  }, [seed])

  return (
    <svg
      ref={svgRef}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden="true"
      style={{ color, display: 'block', flexShrink: 0 }}
    >
      <g ref={groupRef}>
        <path
          ref={pathRef}
          stroke="currentColor"
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.09}
        />
        {Array.from({ length: TOTAL_PARTICLES }).map((_, i) => (
          <circle
            key={i}
            ref={(el) => {
              circlesRef.current[i] = el
            }}
            fill="currentColor"
          />
        ))}
      </g>
    </svg>
  )
}

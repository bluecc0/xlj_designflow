import React, { memo, useEffect, useRef, useState } from 'react'
import { RotateCw, X } from 'lucide-react'
import type { CanvasImage } from '../types'
import { useViewportStore } from '../store/viewportStore'
import {
  applyCrop,
  canvasToLocal,
  normalizeAngle,
  localDeltaToPatch,
  type RepairCrop,
  type RepairPatch,
} from '../utils/detailRepair'

interface Props {
  image: CanvasImage
  patch: RepairPatch
  /** 可以同时有多个图案，同一时间只选中一个（由外层管理） */
  selected: boolean
  onSelect: () => void
  onDeselect: () => void
  onPatchChange: (patch: RepairPatch) => void
  onRemove: () => void
}

type Point = { x: number; y: number }
type CropHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const ACCENT = '#2563eb'

/**
 * 细节修复的图案图层，放在快捷编辑标记浮层里（与原图同一局部坐标）。
 * 选中后显示手柄（新放上来默认选中，点原图其他位置取消，点另一个图案就切换到那个）：
 * 拖动移动、四角缩放、顶部手柄旋转；双击进入/退出裁切。
 * 按住 Shift / Alt 时不接管鼠标，交给外层做涂抹。
 */
export const RepairPatchLayer = memo(function RepairPatchLayer({
  image,
  patch,
  selected,
  onSelect,
  onDeselect,
  onPatchChange,
  onRemove,
}: Props) {
  const zoom = useViewportStore((s) => s.zoom)
  const screenToCanvas = useViewportStore((s) => s.screenToCanvas)
  const [cropping, setCropping] = useState(false)
  const layerRef = useRef<HTMLDivElement>(null)

  const toLocal = (clientX: number, clientY: number): Point =>
    canvasToLocal(screenToCanvas({ x: clientX, y: clientY }), image)

  // 裁切中：回车 / Esc 或点到图案外面就结束裁切（Esc 不再继续退出快捷编辑）
  useEffect(() => {
    if (!cropping) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        setCropping(false)
      }
    }
    const onDown = (e: MouseEvent) => {
      const el = layerRef.current
      if (el && e.target instanceof Node && !el.contains(e.target)) setCropping(false)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onDown, true)
    }
  }, [cropping])

  // 选中时点到原图上图案以外的位置就取消选中（点下方输入框等不影响；按住 Shift/Alt 涂抹不影响）
  useEffect(() => {
    if (!selected || cropping) return
    const onDown = (e: MouseEvent) => {
      const el = layerRef.current
      const host = el?.parentElement
      if (!el || !host || !(e.target instanceof Node)) return
      if (e.button !== 0 || e.shiftKey || e.altKey) return
      if (!el.contains(e.target) && host.contains(e.target)) {
        // 点到另一个图案：交给那个图案自己选中并开始拖动
        if (e.target instanceof Element && e.target.closest('[data-repair-patch]')) return
        // 这一下只用来取消选中，不在原图上加标记
        e.stopPropagation()
        onDeselect()
      }
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [selected, cropping, onDeselect])

  /** 通用拖拽：按住 Shift / Alt 时让给外层涂抹 */
  const startDrag = (e: React.MouseEvent, onMove: (local: Point, start: Point, ev: MouseEvent) => void) => {
    if (e.button !== 0 || e.shiftKey || e.altKey) return
    e.preventDefault()
    e.stopPropagation()
    const start = toLocal(e.clientX, e.clientY)
    const move = (ev: MouseEvent) => onMove(toLocal(ev.clientX, ev.clientY), start, ev)
    const up = () => {
      window.removeEventListener('mousemove', move, true)
      window.removeEventListener('mouseup', up, true)
    }
    window.addEventListener('mousemove', move, true)
    window.addEventListener('mouseup', up, true)
  }

  const startMove = (e: React.MouseEvent) => {
    const origin = patch
    startDrag(e, (local, start) => {
      onPatchChange({ ...origin, cx: origin.cx + local.x - start.x, cy: origin.cy + local.y - start.y })
    })
  }

  const startScale = (e: React.MouseEvent) => {
    const origin = patch
    startDrag(e, (local, start) => {
      const d0 = Math.hypot(start.x - origin.cx, start.y - origin.cy) || 1
      const d1 = Math.hypot(local.x - origin.cx, local.y - origin.cy)
      const minScale = 4 / Math.max(origin.crop.width, origin.crop.height)
      onPatchChange({ ...origin, scale: Math.max(minScale, (origin.scale * d1) / d0) })
    })
  }

  const startRotate = (e: React.MouseEvent) => {
    const origin = patch
    startDrag(e, (local, start, ev) => {
      const a0 = Math.atan2(start.y - origin.cy, start.x - origin.cx)
      const a1 = Math.atan2(local.y - origin.cy, local.x - origin.cx)
      let rotation = normalizeAngle(origin.rotation + ((a1 - a0) * 180) / Math.PI)
      if (ev.shiftKey) rotation = normalizeAngle(Math.round(rotation / 15) * 15)
      onPatchChange({ ...origin, rotation: Math.round(rotation * 10) / 10 })
    })
  }

  const startCrop = (handle: CropHandle) => (e: React.MouseEvent) => {
    const origin = patch
    startDrag(e, (local, start) => {
      const d = localDeltaToPatch(local.x - start.x, local.y - start.y, origin)
      const c: RepairCrop = { ...origin.crop }
      if (handle.includes('e')) c.width = origin.crop.width + d.x
      if (handle.includes('s')) c.height = origin.crop.height + d.y
      if (handle.includes('w')) {
        const x = Math.max(0, Math.min(origin.crop.x + origin.crop.width - 8, origin.crop.x + d.x))
        c.width = origin.crop.width + origin.crop.x - x
        c.x = x
      }
      if (handle.includes('n')) {
        const y = Math.max(0, Math.min(origin.crop.y + origin.crop.height - 8, origin.crop.y + d.y))
        c.height = origin.crop.height + origin.crop.y - y
        c.y = y
      }
      onPatchChange(applyCrop(origin, c))
    })
  }

  const pw = patch.crop.width * patch.scale
  const ph = patch.crop.height * patch.scale
  const fullW = patch.naturalWidth * patch.scale
  const fullH = patch.naturalHeight * patch.scale
  const hs = 16 / zoom
  const rotSize = 26 / zoom
  const rotGap = 34 / zoom
  const line = 2 / zoom
  const showHandles = selected || cropping

  const handleStyle = (left: string, top: string, cursor: string, round = false): React.CSSProperties => ({
    position: 'absolute',
    left,
    top,
    width: hs,
    height: hs,
    marginLeft: -hs / 2,
    marginTop: -hs / 2,
    background: '#fff',
    border: `${line}px solid ${ACCENT}`,
    borderRadius: round ? '50%' : 2,
    boxSizing: 'border-box',
    cursor,
    zIndex: 3,
  })

  const cropHandles: [CropHandle, string, string, string][] = [
    ['nw', '0%', '0%', 'nwse-resize'],
    ['n', '50%', '0%', 'ns-resize'],
    ['ne', '100%', '0%', 'nesw-resize'],
    ['e', '100%', '50%', 'ew-resize'],
    ['se', '100%', '100%', 'nwse-resize'],
    ['s', '50%', '100%', 'ns-resize'],
    ['sw', '0%', '100%', 'nesw-resize'],
    ['w', '0%', '50%', 'ew-resize'],
  ]

  const patchImg = (style: React.CSSProperties) => (
    <img
      src={patch.url}
      alt="图案"
      draggable={false}
      style={{
        position: 'absolute',
        left: -patch.crop.x * patch.scale,
        top: -patch.crop.y * patch.scale,
        width: fullW,
        height: fullH,
        maxWidth: 'none',
        pointerEvents: 'none',
        ...style,
      }}
    />
  )

  return (
    <div
      ref={layerRef}
      data-repair-patch={patch.id}
      onMouseDownCapture={(e) => {
        if (!e.shiftKey && !e.altKey && !selected) onSelect()
      }}
      onMouseUp={(e) => {
        if (!e.shiftKey && !e.altKey) e.stopPropagation()
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        setCropping((v) => !v)
      }}
      style={{
        position: 'absolute',
        left: patch.cx,
        top: patch.cy,
        width: pw,
        height: ph,
        transform: `translate(-50%, -50%) rotate(${patch.rotation}deg)`,
        transformOrigin: 'center center',
        zIndex: 60,
      }}
    >
      {cropping && patchImg({ opacity: 0.25 })}
      <div
        onMouseDown={cropping ? (e) => !e.shiftKey && !e.altKey && e.stopPropagation() : startMove}
        title={cropping ? '拖动边框裁切，回车或双击结束' : '拖动移动，双击裁切白边'}
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          opacity: patch.opacity,
          cursor: cropping ? 'default' : 'move',
        }}
      >
        {patchImg({})}
      </div>
      {showHandles && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            outline: `${line}px ${cropping ? 'dashed' : 'solid'} ${ACCENT}`,
            pointerEvents: 'none',
          }}
        />
      )}
      {showHandles && !cropping && (
        <>
          {(['0%', '100%'] as const).flatMap((x) =>
            (['0%', '100%'] as const).map((y) => (
              <div
                key={x + y}
                onMouseDown={startScale}
                title="拖动缩放"
                style={handleStyle(x, y, x === y ? 'nwse-resize' : 'nesw-resize')}
              />
            ))
          )}
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: -rotGap,
              width: line,
              height: rotGap,
              background: ACCENT,
              pointerEvents: 'none',
            }}
          />
          <div
            onMouseDown={startRotate}
            title="拖动旋转（按住 Shift 每次 15°）"
            style={{
              ...handleStyle('50%', '0%', 'grab', true),
              top: -rotGap,
              width: rotSize,
              height: rotSize,
              marginLeft: -rotSize / 2,
              marginTop: -rotSize / 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: ACCENT,
            }}
          >
            <RotateCw size={14 / zoom} strokeWidth={2.4} style={{ pointerEvents: 'none' }} />
          </div>
          <button
            type="button"
            title="移除图案"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              transform: `translate(50%, -50%) translate(${18 / zoom}px, ${-18 / zoom}px) scale(${1 / zoom})`,
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: '#181b24',
              border: '1.5px solid #fff',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              cursor: 'pointer',
              zIndex: 4,
            }}
          >
            <X size={13} strokeWidth={2.4} />
          </button>
        </>
      )}
      {cropping &&
        cropHandles.map(([h, x, y, cursor]) => (
          <div key={h} onMouseDown={startCrop(h)} style={handleStyle(x, y, cursor)} />
        ))}
    </div>
  )
})

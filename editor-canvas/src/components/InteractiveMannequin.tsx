import React, { useState } from 'react'

export interface MannequinSlot {
  key: string
  label: string
  shortLabel: string
  hint: string
}

interface Props {
  activeSlot: string
  configuredCounts: Record<string, number>
  onSelectSlot: (slotKey: string) => void
  disabled?: boolean
}

export const MANNEQUIN_SLOTS: MannequinSlot[] = [
  { key: 'hat', label: '帽子 / 头饰', shortLabel: '帽子', hint: '头部及发顶' },
  { key: 'accessory', label: '配饰 / 首饰', shortLabel: '配饰', hint: '领口、围巾、饰物' },
  { key: 'outerwear', label: '外套 / 罩衫', shortLabel: '外套', hint: '大衣、西装、夹克' },
  { key: 'top', label: '上衣 / 内搭', shortLabel: '上衣', hint: '胸腔躯干部位' },
  { key: 'bag', label: '包袋 / 提包', shortLabel: '包袋', hint: '单肩包、手提包' },
  { key: 'bottom', label: '下装 / 裤裙', shortLabel: '下装', hint: '腰腹至脚踝双腿' },
  { key: 'shoes', label: '鞋履 / 鞋子', shortLabel: '鞋子', hint: '脚部及站立鞋履' },
]

export const InteractiveMannequin: React.FC<Props> = ({
  activeSlot,
  configuredCounts,
  onSelectSlot,
  disabled = false,
}) => {
  const [hoveredSlot, setHoveredSlot] = useState<string | null>(null)

  const isSlotActive = (key: string) => activeSlot === key
  const isSlotHovered = (key: string) => hoveredSlot === key
  const getSlotCount = (key: string) => configuredCounts[key] || 0

  // 风格参数：极简黑白灰，高对比科技感
  const getSlotStyle = (key: string) => {
    const active = isSlotActive(key)
    const hovered = isSlotHovered(key)
    const count = getSlotCount(key)

    if (active) {
      return {
        stroke: '#09090b',
        strokeWidth: 2.2,
        fill: 'rgba(9, 9, 11, 0.12)',
        filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.12))',
      }
    }
    if (hovered) {
      return {
        stroke: '#18181b',
        strokeWidth: 2,
        fill: 'rgba(24, 24, 27, 0.06)',
        filter: 'none',
      }
    }
    if (count > 0) {
      return {
        stroke: '#27272a',
        strokeWidth: 1.6,
        fill: 'rgba(39, 39, 42, 0.05)',
        filter: 'none',
      }
    }
    return {
      stroke: '#a1a1aa',
      strokeWidth: 1.3,
      fill: 'transparent',
      filter: 'none',
    }
  }

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: 290,
        margin: '0 auto',
        userSelect: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      {/* 顶部简明提示 */}
      <div
        style={{
          fontSize: 11,
          color: '#71717a',
          marginBottom: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            backgroundColor: '#09090b',
            display: 'inline-block',
          }}
        />
        <span>点击人体部位或标签选择更替</span>
      </div>

      <div
        style={{
          position: 'relative',
          width: '100%',
          height: 380,
          background: 'linear-gradient(180deg, #ffffff 0%, #fbfbfb 100%)',
          borderRadius: 14,
          border: '1px solid #e4e4e7',
          boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.02)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {/* 背景微网格线，营造设计工作台质感 */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'radial-gradient(circle, #e4e4e7 0.8px, transparent 0.8px)',
            backgroundSize: '16px 16px',
            opacity: 0.5,
            pointerEvents: 'none',
          }}
        />

        {/* 交互式人体 SVG */}
        <svg
          viewBox="0 0 240 400"
          style={{
            width: '100%',
            height: '100%',
            overflow: 'visible',
            cursor: disabled ? 'default' : 'pointer',
          }}
        >
          <defs>
            {/* 模特基础轮廓柔和渐变 */}
            <linearGradient id="bodyBaseGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f4f4f5" />
              <stop offset="100%" stopColor="#e4e4e7" />
            </linearGradient>
          </defs>

          {/* 模特底层参考轮廓（淡灰骨架线） */}
          <g opacity={0.35} stroke="#d4d4d8" strokeWidth={1} fill="none">
            {/* 脊椎中轴虚线 */}
            <line x1="120" y1="20" x2="120" y2="370" strokeDasharray="3 3" />
            {/* 肩宽水平线 */}
            <line x1="85" y1="92" x2="155" y2="92" strokeDasharray="2 2" />
            {/* 腰节水平线 */}
            <line x1="98" y1="168" x2="142" y2="168" strokeDasharray="2 2" />
            {/* 臀围水平线 */}
            <line x1="94" y1="204" x2="146" y2="204" strokeDasharray="2 2" />
          </g>

          {/* ── 1. 帽子 / 头部 (hat) ── */}
          <g
            id="slot-hat"
            onClick={() => !disabled && onSelectSlot('hat')}
            onMouseEnter={() => setHoveredSlot('hat')}
            onMouseLeave={() => setHoveredSlot(null)}
            style={{ transition: 'all 0.15s ease' }}
          >
            {/* 头部椭圆底稿 */}
            <ellipse
              cx="120"
              cy="46"
              rx="15"
              ry="19"
              stroke="#d4d4d8"
              strokeWidth={1}
              fill="#fafafa"
            />
            {/* 帽子主体造型（贝雷帽/礼帽/棒球帽流线） */}
            <path
              d="M 102 38 C 104 22, 136 20, 138 38 C 145 42, 142 46, 120 45 C 98 46, 95 42, 102 38 Z"
              {...getSlotStyle('hat')}
            />
            {/* 帽檐 */}
            <path
              d="M 96 44 Q 120 40 144 44"
              stroke={getSlotStyle('hat').stroke}
              strokeWidth={getSlotStyle('hat').strokeWidth}
              fill="none"
            />
          </g>

          {/* ── 2. 配饰 / 颈部 (accessory) ── */}
          <g
            id="slot-accessory"
            onClick={() => !disabled && onSelectSlot('accessory')}
            onMouseEnter={() => setHoveredSlot('accessory')}
            onMouseLeave={() => setHoveredSlot(null)}
            style={{ transition: 'all 0.15s ease' }}
          >
            {/* 颈部 */}
            <path
              d="M 115 65 L 115 80 Q 120 84 125 80 L 125 65 Z"
              fill="#fafafa"
              stroke="#e4e4e7"
              strokeWidth={1}
            />
            {/* 项链/领饰流线 */}
            <path
              d="M 112 76 Q 120 88 128 76"
              {...getSlotStyle('accessory')}
              fill="none"
            />
            {/* 饰品小吊坠 */}
            <circle
              cx="120"
              cy="88"
              r="2.5"
              fill={getSlotStyle('accessory').stroke}
            />
          </g>

          {/* ── 3. 外套 (outerwear) ── */}
          <g
            id="slot-outerwear"
            onClick={() => !disabled && onSelectSlot('outerwear')}
            onMouseEnter={() => setHoveredSlot('outerwear')}
            onMouseLeave={() => setHoveredSlot(null)}
            style={{ transition: 'all 0.15s ease' }}
          >
            {/* 外套外围轮廓：双肩翻领延伸至手臂外侧 */}
            <path
              d="M 92 92 C 80 102, 70 145, 68 190 C 72 192, 80 190, 82 184 C 84 146, 92 110, 98 100 L 108 140 L 98 190 L 108 200 L 120 178 L 132 200 L 142 190 L 132 140 L 142 100 C 148 110, 156 146, 158 184 C 160 190, 168 192, 172 190 C 170 145, 160 102, 148 92 C 136 86, 104 86, 92 92 Z"
              {...getSlotStyle('outerwear')}
            />
          </g>

          {/* ── 4. 上衣 (top) ── */}
          <g
            id="slot-top"
            onClick={() => !disabled && onSelectSlot('top')}
            onMouseEnter={() => setHoveredSlot('top')}
            onMouseLeave={() => setHoveredSlot(null)}
            style={{ transition: 'all 0.15s ease' }}
          >
            {/* 上衣躯干（T恤/衬衫） */}
            <path
              d="M 106 86 C 114 92, 126 92, 134 86 L 144 94 L 140 120 L 134 116 L 132 168 C 124 170, 116 170, 108 168 L 106 116 L 100 120 L 96 94 Z"
              {...getSlotStyle('top')}
            />
            {/* 领口轮廓细线 */}
            <path
              d="M 112 85 Q 120 94 128 85"
              stroke={getSlotStyle('top').stroke}
              strokeWidth={1.2}
              fill="none"
            />
          </g>

          {/* ── 5. 包袋 (bag) ── */}
          <g
            id="slot-bag"
            onClick={() => !disabled && onSelectSlot('bag')}
            onMouseEnter={() => setHoveredSlot('bag')}
            onMouseLeave={() => setHoveredSlot(null)}
            style={{ transition: 'all 0.15s ease' }}
          >
            {/* 斜挎带 */}
            <path
              d="M 136 88 L 84 172"
              stroke={getSlotStyle('bag').stroke}
              strokeWidth={1.2}
              strokeDasharray="2 2"
              fill="none"
            />
            {/* 侧边单肩包 / 手提包 */}
            <rect
              x="62"
              y="172"
              width="24"
              height="30"
              rx="4"
              {...getSlotStyle('bag')}
            />
            {/* 包盖/搭扣 */}
            <path
              d="M 62 182 Q 74 186 86 182"
              stroke={getSlotStyle('bag').stroke}
              strokeWidth={1.2}
              fill="none"
            />
            <circle
              cx="74"
              cy="188"
              r="2"
              fill={getSlotStyle('bag').stroke}
            />
          </g>

          {/* ── 6. 下装 / 裤子 (bottom) ── */}
          <g
            id="slot-bottom"
            onClick={() => !disabled && onSelectSlot('bottom')}
            onMouseEnter={() => setHoveredSlot('bottom')}
            onMouseLeave={() => setHoveredSlot(null)}
            style={{ transition: 'all 0.15s ease' }}
          >
            {/* 裤子（高腰裤/直筒裤双腿） */}
            <path
              d="M 108 168 Q 120 171 132 168 L 138 206 C 139 240, 142 280, 140 326 L 126 326 C 127 285, 126 248, 120 220 C 114 248, 113 285, 114 326 L 100 326 C 98 280, 101 240, 102 206 Z"
              {...getSlotStyle('bottom')}
            />
            {/* 裤中缝中轴细线 */}
            <line
              x1="120"
              y1="170"
              x2="120"
              y2="216"
              stroke={getSlotStyle('bottom').stroke}
              strokeWidth={1}
            />
          </g>

          {/* ── 7. 鞋子 (shoes) ── */}
          <g
            id="slot-shoes"
            onClick={() => !disabled && onSelectSlot('shoes')}
            onMouseEnter={() => setHoveredSlot('shoes')}
            onMouseLeave={() => setHoveredSlot(null)}
            style={{ transition: 'all 0.15s ease' }}
          >
            {/* 左脚鞋 */}
            <path
              d="M 100 326 L 114 326 L 114 346 C 114 350, 110 354, 96 354 C 94 350, 96 346, 100 326 Z"
              {...getSlotStyle('shoes')}
            />
            {/* 右脚鞋 */}
            <path
              d="M 126 326 L 140 326 L 140 346 C 144 346, 146 350, 144 354 C 130 354, 126 350, 126 346 Z"
              {...getSlotStyle('shoes')}
            />
            {/* 鞋底站立线 */}
            <line
              x1="92"
              y1="355"
              x2="148"
              y2="355"
              stroke="#d4d4d8"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
          </g>
        </svg>

        {/* ── 模特周边的引线指示标签 (Callout Pins) ── */}
        {/* 左侧标签：帽子、外套、上衣、包袋 */}
        <div
          style={{
            position: 'absolute',
            left: 8,
            top: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 22,
            zIndex: 10,
          }}
        >
          {MANNEQUIN_SLOTS.filter((s) =>
            ['hat', 'outerwear', 'top', 'bag'].includes(s.key)
          ).map((slot) => {
            const active = isSlotActive(slot.key)
            const count = getSlotCount(slot.key)
            const hovered = isSlotHovered(slot.key)
            return (
              <button
                key={slot.key}
                type="button"
                onClick={() => !disabled && onSelectSlot(slot.key)}
                onMouseEnter={() => setHoveredSlot(slot.key)}
                onMouseLeave={() => setHoveredSlot(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '4px 8px',
                  borderRadius: 6,
                  border: active
                    ? '1px solid #09090b'
                    : count > 0
                    ? '1px solid #71717a'
                    : hovered
                    ? '1px solid #a1a1aa'
                    : '1px solid #e4e4e7',
                  backgroundColor: active
                    ? '#09090b'
                    : hovered
                    ? '#f4f4f5'
                    : count > 0
                    ? '#fafafa'
                    : '#ffffff',
                  color: active ? '#ffffff' : count > 0 ? '#09090b' : '#52525b',
                  fontSize: 11,
                  fontWeight: active || count > 0 ? 600 : 500,
                  cursor: disabled ? 'default' : 'pointer',
                  boxShadow: active
                    ? '0 2px 8px rgba(0,0,0,0.15)'
                    : '0 1px 2px rgba(0,0,0,0.03)',
                  transition: 'all 0.15s ease',
                  textAlign: 'left',
                }}
              >
                <span>{slot.shortLabel}</span>
                {count > 0 && (
                  <span
                    style={{
                      fontSize: 10,
                      padding: '0 4px',
                      borderRadius: 999,
                      backgroundColor: active ? 'rgba(255,255,255,0.25)' : '#18181b',
                      color: '#ffffff',
                    }}
                  >
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* 右侧标签：配饰、下装、鞋子 */}
        <div
          style={{
            position: 'absolute',
            right: 8,
            top: 70,
            display: 'flex',
            flexDirection: 'column',
            gap: 65,
            zIndex: 10,
          }}
        >
          {MANNEQUIN_SLOTS.filter((s) =>
            ['accessory', 'bottom', 'shoes'].includes(s.key)
          ).map((slot) => {
            const active = isSlotActive(slot.key)
            const count = getSlotCount(slot.key)
            const hovered = isSlotHovered(slot.key)
            return (
              <button
                key={slot.key}
                type="button"
                onClick={() => !disabled && onSelectSlot(slot.key)}
                onMouseEnter={() => setHoveredSlot(slot.key)}
                onMouseLeave={() => setHoveredSlot(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '4px 8px',
                  borderRadius: 6,
                  border: active
                    ? '1px solid #09090b'
                    : count > 0
                    ? '1px solid #71717a'
                    : hovered
                    ? '1px solid #a1a1aa'
                    : '1px solid #e4e4e7',
                  backgroundColor: active
                    ? '#09090b'
                    : hovered
                    ? '#f4f4f5'
                    : count > 0
                    ? '#fafafa'
                    : '#ffffff',
                  color: active ? '#ffffff' : count > 0 ? '#09090b' : '#52525b',
                  fontSize: 11,
                  fontWeight: active || count > 0 ? 600 : 500,
                  cursor: disabled ? 'default' : 'pointer',
                  boxShadow: active
                    ? '0 2px 8px rgba(0,0,0,0.15)'
                    : '0 1px 2px rgba(0,0,0,0.03)',
                  transition: 'all 0.15s ease',
                  textAlign: 'left',
                }}
              >
                <span>{slot.shortLabel}</span>
                {count > 0 && (
                  <span
                    style={{
                      fontSize: 10,
                      padding: '0 4px',
                      borderRadius: 999,
                      backgroundColor: active ? 'rgba(255,255,255,0.25)' : '#18181b',
                      color: '#ffffff',
                    }}
                  >
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* 底部悬浮指示：当前悬停部位说明 */}
        {hoveredSlot && (
          <div
            style={{
              position: 'absolute',
              bottom: 10,
              padding: '3px 10px',
              backgroundColor: 'rgba(9, 9, 11, 0.85)',
              backdropFilter: 'blur(8px)',
              color: '#ffffff',
              borderRadius: 999,
              fontSize: 11,
              pointerEvents: 'none',
              animation: 'fadeIn 0.15s ease',
            }}
          >
            {MANNEQUIN_SLOTS.find((s) => s.key === hoveredSlot)?.label} · 点击切换配置
          </div>
        )}
      </div>
    </div>
  )
}

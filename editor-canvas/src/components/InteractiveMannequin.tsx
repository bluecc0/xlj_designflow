import React, { useState } from 'react'

export interface OutfitItem {
  key: string
  /** 提交给后端的部位 slot */
  slot: string
  label: string
  placeholder: string
}

export interface OutfitZone {
  key: string
  label: string
  items: OutfitItem[]
}

// 人偶 4 个可点区域，每个区域下细分具体单品
export const OUTFIT_ZONES: OutfitZone[] = [
  {
    key: 'head',
    label: '头部',
    items: [{ key: 'hat', slot: 'hat', label: '帽子', placeholder: '帽子货号' }],
  },
  {
    key: 'upper',
    label: '上衣',
    items: [
      { key: 'outerwear', slot: 'outerwear', label: '外套', placeholder: '外套货号' },
      { key: 'hoodie', slot: 'top', label: '卫衣', placeholder: '卫衣货号' },
      { key: 'tshirt', slot: 'top', label: 'T恤', placeholder: 'T恤货号' },
    ],
  },
  {
    key: 'lower',
    label: '下装',
    items: [{ key: 'pants', slot: 'bottom', label: '裤子', placeholder: '裤子货号' }],
  },
  {
    key: 'feet',
    label: '鞋袜',
    items: [
      { key: 'shoes', slot: 'shoes', label: '鞋子', placeholder: '鞋子货号' },
      { key: 'socks', slot: 'socks', label: '袜子', placeholder: '袜子货号' },
    ],
  },
]

interface Props {
  activeZone: string
  zoneCounts: Record<string, number>
  onSelectZone: (zoneKey: string) => void
  disabled?: boolean
}

// 标签引线锚点：[部位上的圆点 x, y, 标签中心 y]
const CALLOUTS: Record<string, [number, number, number]> = {
  head: [105, 40, 38],
  upper: [126, 122, 122],
  lower: [112, 252, 256],
  feet: [122, 356, 350],
}

const W = 260
const H = 390
const LABEL_X = 146
const LABEL_W = 106

// ── 几何轮廓：人物真正“穿”着服饰，无多余重复裸体衬底 ──

// 头部与面廓
const HEAD_SKULL =
  'M 90 26 C 99 26, 104 34, 104 46 C 104 56, 98 64, 90 65 C 82 64, 76 56, 76 46 C 76 34, 81 26, 90 26 Z'

// 颈部（从下巴内侧 y=56 自然落入衣领开口 y=82）
const NECK_PATH = 'M 83.5 56 L 83.5 80 Q 90 85 96.5 80 L 96.5 56 Z'

// 帽子（紧密包裹颅顶并自然伸出前檐）
const CAP_CROWN = 'M 75 42 C 74 23, 106 23, 105 42 Q 90 38 75 42 Z'
const CAP_VISOR = 'M 98 40 Q 112 38 120 42 Q 110 46 98 44 Z'

// 上衣主体（含肩膀、左右袖筒及衣身，完全包裹躯干与上臂，双手从袖口自然伸出）
const UPPER_GARMENT =
  'M 82 76 L 58 86 C 52 92, 48 112, 45 138 L 44 168 L 54 168 L 56 138 C 58 118, 62 108, 68 108 L 70 148 L 68 194 Q 90 198 112 194 L 110 148 L 112 108 C 118 108, 122 118, 124 138 L 126 168 L 136 168 L 135 138 C 132 112, 128 92, 122 86 L 98 76 Q 90 86 82 76 Z'

// 袖口伸出的手腕与手部（只露双手，不露多余手臂）
const HAND_L = 'M 46 168 L 45 190 C 45 198, 48 202, 51 202 C 54 202, 56 198, 55 190 L 53 168 Z'
const HAND_R = 'M 127 168 L 125 190 C 124 198, 126 202, 129 202 C 132 202, 135 198, 134 190 L 133 168 Z'

// 下装（裤子：从腰部 y=194 紧密承接上衣下摆，向下包裹整条腿部直至裤脚 y=330）
const PANTS_GARMENT =
  'M 68 194 Q 90 198 112 194 L 113 230 C 113 250, 110 280, 107 330 L 95 330 C 94 285, 93 255, 90 240 C 87 255, 86 285, 85 330 L 73 330 C 70 280, 67 250, 67 230 Z'

// 裤脚露出的脚踝与袜子
const SOCK_L = 'M 75 330 L 76 348 L 84 348 L 83 330 Z'
const SOCK_R = 'M 97 330 L 96 348 L 104 348 L 105 330 Z'

// 鞋子（脚踏地面，平稳扎实）
const SHOE_L = 'M 75 348 Q 72 354 67 358 C 61 360, 56 361, 56 364 L 86 364 C 88 364, 88 358, 87 352 L 85 348 Z'
const SHOE_R = 'M 95 348 Q 93 352 94 364 L 124 364 C 124 361, 119 360, 113 358 Q 108 354 105 348 Z'

export const InteractiveMannequin: React.FC<Props> = ({
  activeZone,
  zoneCounts,
  onSelectZone,
  disabled = false,
}) => {
  const [hovered, setHovered] = useState<string | null>(null)

  // 浅色系服饰材质：纯净、轻柔、不显眼、克制
  const garment = (zone: string): React.SVGProps<SVGPathElement> => {
    const isActive = activeZone === zone
    const isHov = hovered === zone
    const count = zoneCounts[zone] || 0

    if (isActive) {
      return {
        fill: '#f0f0f3',
        stroke: '#18181b',
        strokeWidth: 1.15,
      }
    }
    if (isHov) {
      return {
        fill: '#f8f8fa',
        stroke: '#71717a',
        strokeWidth: 0.95,
      }
    }
    if (count > 0) {
      return {
        fill: '#f4f4f7',
        stroke: '#a1a1aa',
        strokeWidth: 0.9,
      }
    }
    return {
      fill: '#ffffff',
      stroke: '#d4d4d8',
      strokeWidth: 0.8,
    }
  }

  // 结构细节线颜色
  const detailColor = (zone: string) => {
    if (activeZone === zone) return 'rgba(24, 24, 27, 0.35)'
    if (hovered === zone) return 'rgba(24, 24, 27, 0.22)'
    return 'rgba(9, 9, 11, 0.12)'
  }

  const zoneProps = (zone: string) => ({
    onClick: () => !disabled && onSelectZone(zone),
    onMouseEnter: () => setHovered(zone),
    onMouseLeave: () => setHovered(null),
    style: { cursor: disabled ? 'default' : 'pointer' } as React.CSSProperties,
  })

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{
        width: '100%',
        display: 'block',
        userSelect: 'none',
        borderRadius: 10,
        backgroundColor: '#fafafa',
      }}
    >
      <defs>
        {/* 地面微渐变投影 */}
        <radialGradient id="mqGround" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#09090b" stopOpacity={0.06} />
          <stop offset="100%" stopColor="#09090b" stopOpacity={0} />
        </radialGradient>
      </defs>

      {/* ── 1. 地面投影 ── */}
      <ellipse cx={90} cy={367} rx={44} ry={5} fill="url(#mqGround)" />

      {/* ── 2. 裸露肢体（皮肤底层，被服饰包裹与穿透） ── */}
      <g fill="#fafafa" stroke="#d4d4d8" strokeWidth={0.75}>
        {/* 颈部：插在衣领深处 */}
        <path d={NECK_PATH} />
        {/* 头部面廓 */}
        <path d={HEAD_SKULL} />
        {/* 袖口伸出的手部 */}
        <path d={HAND_L} />
        <path d={HAND_R} />
        {/* 裤脚伸出的踝部 */}
        <path d={SOCK_L} />
        <path d={SOCK_R} />
      </g>

      {/* ── 3. 下装（裤子） ── */}
      <g {...zoneProps('lower')}>
        <path d={PANTS_GARMENT} {...garment('lower')} />
        {/* 腰带线 */}
        <path
          d="M 68 200 Q 90 204 112 200"
          stroke={detailColor('lower')}
          strokeWidth={0.7}
          fill="none"
        />
        {/* 门襟 */}
        <path
          d="M 90 200 L 90 226 C 90 231, 93 233, 95 233"
          stroke={detailColor('lower')}
          strokeWidth={0.7}
          fill="none"
        />
        {/* 两侧裤管中缝折线（极简考究裁线） */}
        <path
          d="M 79 204 L 79 324 M 101 204 L 101 324"
          stroke={detailColor('lower')}
          strokeWidth={0.6}
          strokeDasharray="2 4"
          fill="none"
        />
        {/* 裤脚折边 */}
        <path
          d="M 73 325 L 85 325 M 95 325 L 107 325"
          stroke={detailColor('lower')}
          strokeWidth={0.6}
          fill="none"
        />
      </g>

      {/* ── 4. 上衣（外套/卫衣/T恤：衣袖包裹双臂、衣领包裹颈部） ── */}
      <g {...zoneProps('upper')}>
        {/* 衣身与袖筒整体 */}
        <path d={UPPER_GARMENT} {...garment('upper')} />
        {/* 前衣领结构弧线 */}
        <path
          d="M 82 76 Q 90 86 98 76"
          stroke={garment('upper').stroke}
          strokeWidth={garment('upper').strokeWidth}
          fill="none"
        />
        {/* 领口罗纹内沿 */}
        <path
          d="M 81 74 Q 90 83 99 74"
          stroke={detailColor('upper')}
          strokeWidth={0.6}
          fill="none"
        />
        {/* 躯干中心虚线（门襟/拉链中线，极简科技感，与参考图一致） */}
        <path
          d="M 90 88 L 90 194"
          stroke={detailColor('upper')}
          strokeWidth={0.75}
          strokeDasharray="3 3"
          fill="none"
        />
        {/* 袖口罗纹缝线 */}
        <path
          d="M 44 163 L 54 163 M 126 163 L 136 163"
          stroke={detailColor('upper')}
          strokeWidth={0.6}
          fill="none"
        />
        {/* 下摆包边 */}
        <path
          d="M 68 189 Q 90 193 112 189"
          stroke={detailColor('upper')}
          strokeWidth={0.6}
          fill="none"
        />
      </g>

      {/* ── 5. 头部与帽子 ── */}
      <g {...zoneProps('head')}>
        {/* 宽容点击热区 */}
        <ellipse cx={90} cy={44} rx={24} ry={26} fill="transparent" />
        {/* 帽冠与帽檐（紧贴颅顶佩戴） */}
        <path d={CAP_CROWN} {...garment('head')} />
        <path d={CAP_VISOR} {...garment('head')} />
        <circle cx={90} cy={23} r={1.3} fill={garment('head').stroke as string} />
      </g>

      {/* ── 6. 底部（鞋子与袜子） ── */}
      <g {...zoneProps('feet')}>
        {/* 宽容点击热区 */}
        <rect x={54} y={328} width={74} height={42} fill="transparent" />
        {/* 袜子袜口细纹 */}
        <path
          d="M 75 336 L 83 336 M 97 336 L 105 336"
          stroke={detailColor('feet')}
          strokeWidth={0.6}
          strokeDasharray="1.5 1.5"
          fill="none"
        />
        {/* 鞋子轮廓与鞋底 */}
        <path d={SHOE_L} {...garment('feet')} />
        <path d={SHOE_R} {...garment('feet')} />
        <path
          d="M 56 361 L 86 361 M 94 361 L 124 361"
          stroke={detailColor('feet')}
          strokeWidth={0.7}
          fill="none"
        />
      </g>

      {/* ── 7. 引线与标签卡片（与参考图一致的点+水平虚线导引） ── */}
      {OUTFIT_ZONES.map((zone) => {
        const [ax, ay, ly] = CALLOUTS[zone.key]
        const active = activeZone === zone.key
        const isHover = hovered === zone.key
        const count = zoneCounts[zone.key] || 0
        const lineColor = active ? '#18181b' : isHover ? '#71717a' : '#d4d4d8'

        return (
          <g key={zone.key} {...zoneProps(zone.key)}>
            {/* 水平虚线引线 */}
            <path
              d={`M ${ax} ${ay} L ${LABEL_X} ${ly}`}
              fill="none"
              stroke={lineColor}
              strokeWidth={active ? 1.1 : 0.8}
              strokeDasharray={active ? undefined : '2 3'}
            />
            {/* 部位锚点圆点 */}
            <circle
              cx={ax}
              cy={ay}
              r={active ? 2.5 : 2}
              fill={active ? '#18181b' : '#ffffff'}
              stroke={lineColor}
              strokeWidth={0.9}
            />

            {/* 标签卡片：浅白底 + 细边框 */}
            <rect
              x={LABEL_X}
              y={ly - 16}
              width={LABEL_W}
              height={32}
              rx={6}
              fill={active ? '#ffffff' : isHover ? '#f7f7f9' : '#ffffff'}
              stroke={active ? '#18181b' : count ? '#a1a1aa' : '#e4e4e7'}
              strokeWidth={active ? 1.1 : 0.8}
            />
            <text
              x={LABEL_X + 9}
              y={ly - 2}
              fontSize={11.5}
              fontWeight={active ? 600 : 500}
              fill={active ? '#09090b' : '#27272a'}
            >
              {zone.label}
            </text>
            <text
              x={LABEL_X + 9}
              y={ly + 10}
              fontSize={9}
              fill={active ? '#71717a' : '#a1a1aa'}
            >
              {zone.items.map((i) => i.label).join(' · ')}
            </text>

            {/* 数量角标 */}
            {count > 0 && (
              <g>
                <circle
                  cx={LABEL_X + LABEL_W - 13}
                  cy={ly}
                  r={7}
                  fill={active ? '#18181b' : '#71717a'}
                />
                <text
                  x={LABEL_X + LABEL_W - 13}
                  y={ly + 3}
                  fontSize={9}
                  fontWeight={600}
                  textAnchor="middle"
                  fill="#ffffff"
                >
                  {count}
                </text>
              </g>
            )}
          </g>
        )
      })}
    </svg>
  )
}

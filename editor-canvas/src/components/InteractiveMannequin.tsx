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
        fill: 'rgba(134, 134, 134, .12)',
        stroke: '#555555',
        strokeWidth: 1.25,
      }
    }
    if (isHov) {
      return {
        fill: 'rgba(134, 134, 134, .08)',
        stroke: '#777777',
        strokeWidth: 1,
      }
    }
    if (count > 0) {
      return {
        fill: 'rgba(134, 134, 134, .07)',
        stroke: '#a9a9a9',
        strokeWidth: 0.9,
      }
    }
    return {
      fill: '#ffffff',
      stroke: '#b8b8b8',
      strokeWidth: 0.8,
    }
  }

  // 结构细节线颜色
  const detailColor = (zone: string) => {
    if (activeZone === zone) return 'rgba(127, 127, 127, .58)'
    if (hovered === zone) return 'rgba(156, 156, 156, .42)'
    return 'rgba(116, 116, 116, .34)'
  }

  const zoneProps = (zone: string) => ({
    onClick: () => !disabled && onSelectZone(zone),
    onMouseEnter: () => setHovered(zone),
    onMouseLeave: () => setHovered(null),
    style: { cursor: disabled ? 'default' : 'pointer' } as React.CSSProperties,
  })

  return (
    <svg
      className="mannequin-shell"
      viewBox={`0 0 ${W} ${H}`}
      style={{
        width: '100%',
        height: 350,
        objectFit: 'contain',
        display: 'block',
        userSelect: 'none',
        backgroundColor: 'transparent',
      }}
    >
      <defs>
        {/* 地面微渐变投影 */}
        <radialGradient id="mqGround" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#666666" stopOpacity={0.18} />
          <stop offset="100%" stopColor="#666666" stopOpacity={0} />
        </radialGradient>
      </defs>

      <path d="M 24 78 H 236" stroke="#666666" strokeOpacity=".16" strokeWidth=".5" strokeDasharray="2 5" />
      <path d="M 24 280 H 236" stroke="#666666" strokeOpacity=".16" strokeWidth=".5" strokeDasharray="2 5" />

      {/* ── 1. 地面投影 ── */}
      <ellipse cx={90} cy={367} rx={44} ry={5} fill="url(#mqGround)" />

      {/* ── 2. 裸露肢体（皮肤底层，被服饰包裹与穿透） ── */}
      <g fill="#f7f7f7" stroke="#858585" strokeOpacity=".88" strokeWidth={0.75}>
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

      {/* 人体结构辅助线：面部、关节、手部和踝部 */}
      <g fill="none" stroke="#888888" strokeWidth={0.55} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none">
        <path d="M 79 43 Q 82 39 86 41 M 94 41 Q 98 39 101 43" />
        <path d="M 90 42 L 89 51 L 93 53 M 84 58 Q 90 61 96 58" />
        <path d="M 76 45 Q 72 47 76 51 M 104 45 Q 108 47 104 51" />
        <path d="M 83 67 Q 90 71 97 67 M 83 70 L 83 78 M 97 70 L 97 78" />
        <path d="M 45 176 L 52 176 M 45 181 L 53 181 M 45 186 L 53 186" />
        <path d="M 127 176 L 134 176 M 127 181 L 135 181 M 127 186 L 135 186" />
        <path d="M 76 340 L 83 340 M 97 340 L 104 340" />
        <circle cx="68" cy="195" r="1.6" /><circle cx="112" cy="195" r="1.6" />
        <circle cx="72" cy="270" r="1.6" /><circle cx="108" cy="270" r="1.6" />
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
        {/* 裤装立体裁片、膝位和口袋结构 */}
        <path d="M 69 216 Q 79 220 87 216 M 91 216 Q 101 220 111 216" stroke={detailColor('lower')} strokeWidth={0.55} fill="none" />
        <path d="M 69 236 Q 77 242 84 240 M 111 236 Q 103 242 96 240" stroke={detailColor('lower')} strokeWidth={0.5} fill="none" />
        <path d="M 70 260 Q 78 264 85 260 M 110 260 Q 102 264 95 260" stroke={detailColor('lower')} strokeWidth={0.65} fill="none" />
        <path d="M 70 215 L 80 225 M 110 215 L 100 225" stroke={detailColor('lower')} strokeWidth={0.55} fill="none" />
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
        {/* 肩线、袖片、袋口和侧缝 */}
        <path d="M 61 91 Q 68 96 73 102 M 119 91 Q 112 96 107 102" stroke={detailColor('upper')} strokeWidth={0.65} fill="none" />
        <path d="M 57 108 Q 61 124 61 145 M 123 108 Q 119 124 119 145" stroke={detailColor('upper')} strokeWidth={0.55} fill="none" />
        <path d="M 71 145 L 82 151 L 82 166 L 72 161 Z M 109 145 L 98 151 L 98 166 L 108 161 Z" stroke={detailColor('upper')} strokeWidth={0.6} fill="none" />
        <path d="M 74 174 Q 90 180 106 174" stroke={detailColor('upper')} strokeWidth={0.55} strokeDasharray="1.5 2" fill="none" />
        <path d="M 68 94 L 68 188 M 112 94 L 112 188" stroke={detailColor('upper')} strokeWidth={0.4} strokeDasharray="1 3" fill="none" />
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
        <path d="M 67 353 L 82 355 M 98 355 L 113 353" stroke={detailColor('feet')} strokeWidth={0.55} fill="none" />
        <path d="M 70 350 L 78 359 M 74 349 L 82 358 M 103 358 L 110 350 M 99 359 L 106 349" stroke={detailColor('feet')} strokeWidth={0.5} fill="none" />
        <path d="M 60 365 Q 71 367 84 365 M 96 365 Q 109 367 121 365" stroke={detailColor('feet')} strokeWidth={0.55} fill="none" />
      </g>

      {/* ── 7. 引线与标签卡片（与参考图一致的点+水平虚线导引） ── */}
      {OUTFIT_ZONES.map((zone) => {
        const [ax, ay, ly] = CALLOUTS[zone.key]
        const active = activeZone === zone.key
        const isHover = hovered === zone.key
        const count = zoneCounts[zone.key] || 0
        const lineColor = active ? '#555555' : isHover ? '#777777' : '#999999'

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
              fill={active ? '#555555' : '#ffffff'}
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
              fill={active ? 'rgba(134, 134, 134,.12)' : isHover ? 'rgba(134, 134, 134,.07)' : '#ffffff'}
              stroke={active ? '#555555' : count ? '#999999' : '#d3d3d3'}
              strokeWidth={active ? 1.1 : 0.8}
            />
            <text
              x={LABEL_X + 9}
              y={ly - 2}
              fontSize={11.5}
              fontWeight={active ? 600 : 500}
              fill={active ? '#505050' : '#535353'}
            >
              {zone.label}
            </text>
            <text
              x={LABEL_X + 9}
              y={ly + 10}
              fontSize={9}
              fill={active ? '#737373' : '#8b8b8b'}
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
                  fill={active ? '#555555' : '#888888'}
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

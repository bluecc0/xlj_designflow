import React, { useState } from 'react'

export interface OutfitItem {
  key: string
  /** 提交给后端的部位 slot */
  slot: string
  label: string
}

export interface OutfitZone {
  key: string
  label: string
  /** 单品未标注品类（自动识别）时提交的部位 slot */
  slot: string
  /** 是否允许「自动识别」品类；不允许时默认取 items[0] */
  allowAuto: boolean
  items: OutfitItem[]
}

// 人偶 4 个可点区域；items 是可选的下一级品类，用户可直接在区域内添加单品
export const OUTFIT_ZONES: OutfitZone[] = [
  {
    key: 'head',
    label: '头部',
    slot: 'hat',
    allowAuto: false,
    items: [{ key: 'hat', slot: 'hat', label: '帽子' }],
  },
  {
    key: 'upper',
    label: '上衣',
    slot: 'top',
    allowAuto: true,
    items: [
      { key: 'outerwear', slot: 'outerwear', label: '外套' },
      { key: 'hoodie', slot: 'top', label: '卫衣' },
      { key: 'tshirt', slot: 'top', label: 'T恤' },
    ],
  },
  {
    key: 'lower',
    label: '下装',
    slot: 'bottom',
    allowAuto: false,
    items: [{ key: 'pants', slot: 'bottom', label: '裤子' }],
  },
  {
    key: 'feet',
    label: '鞋袜',
    slot: 'shoes',
    allowAuto: false,
    items: [
      { key: 'shoes', slot: 'shoes', label: '鞋子' },
      { key: 'socks', slot: 'socks', label: '袜子' },
    ],
  },
  {
    key: 'accessory',
    label: '配件',
    slot: 'bag',
    allowAuto: false,
    // 目前配件只支持包袋一个品类（背包、斜挎包、手提包等由参考图决定）
    items: [{ key: 'bag', slot: 'bag', label: '包袋' }],
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
  accessory: [106, 132, 189],
}

const LABEL_X = 146
const LABEL_W = 62
const LABEL_H = 30
// 只保留人台与标签的包围盒：细长构图，在窄栏里可按高度撑满
const VIEWBOX = '38 14 176 362'

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

// 背包：包身背在身后（只从肩头上沿、手臂与躯干的缝隙露出），肩带与胸带在身前
const BAG_BODY =
  'M 66 84 Q 66 72 78 72 L 102 72 Q 114 72 114 84 L 115 172 Q 115 178 109 178 L 71 178 Q 65 178 65 172 Z'
const BAG_HANDLE = 'M 84 72 Q 90 64 96 72'
const BAG_STRAPS = 'M 78 80 C 75 96, 73 118, 74 138 M 102 80 C 105 96, 107 118, 106 138'
const BAG_CHEST_STRAP = 'M 75 112 L 105 112'

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
        fill: 'rgba(30, 35, 45, .07)',
        stroke: '#1e232d',
        strokeWidth: 1.25,
      }
    }
    if (isHov) {
      return {
        fill: 'rgba(30, 35, 45, .04)',
        stroke: '#687083',
        strokeWidth: 1,
      }
    }
    if (count > 0) {
      return {
        fill: 'rgba(30, 35, 45, .05)',
        stroke: '#98a0ae',
        strokeWidth: 0.9,
      }
    }
    return {
      fill: '#ffffff',
      stroke: '#b4bac5',
      strokeWidth: 0.8,
    }
  }

  // 肩带内芯：不透明，盖住外描边中间形成有宽度的带子
  const strapFill = (zone: string) => {
    if (activeZone === zone) return '#e6e8ec'
    if (hovered === zone) return '#f0f2f5'
    return '#ffffff'
  }

  // 结构细节线颜色
  const detailColor = (zone: string) => {
    if (activeZone === zone) return 'rgba(30, 35, 45, .5)'
    if (hovered === zone) return 'rgba(30, 35, 45, .36)'
    return 'rgba(30, 35, 45, .22)'
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
      viewBox={VIEWBOX}
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        userSelect: 'none',
        backgroundColor: 'transparent',
      }}
    >
      <defs>
        {/* 地面微渐变投影 */}
        <radialGradient id="mqGround" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#1e232d" stopOpacity={0.14} />
          <stop offset="100%" stopColor="#1e232d" stopOpacity={0} />
        </radialGradient>
      </defs>


      {/* ── 1. 地面投影 ── */}
      <ellipse cx={90} cy={367} rx={44} ry={5} fill="url(#mqGround)" />

      {/* ── 1.5 背包包身（背在身后，最底层） ── */}
      <g {...zoneProps('accessory')}>
        <path d={BAG_BODY} {...garment('accessory')} />
        <path d={BAG_HANDLE} fill="none" stroke={garment('accessory').stroke} strokeWidth={1.6} strokeLinecap="round" />
        <path d="M 70 92 L 110 92" stroke={detailColor('accessory')} strokeWidth={0.6} fill="none" />
      </g>

      {/* ── 2. 裸露肢体（皮肤底层，被服饰包裹与穿透） ── */}
      <g fill="#f8f9fb" stroke="#8a92a0" strokeOpacity=".9" strokeWidth={0.75}>
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
      <g fill="none" stroke="#9aa1ad" strokeWidth={0.55} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none">
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

      {/* ── 4.5 背包肩带与胸带（压在上衣外面） ── */}
      <g {...zoneProps('accessory')}>
        {/* 加宽的透明热区，细肩带也容易点中 */}
        <path d={BAG_STRAPS} fill="none" stroke="transparent" strokeWidth={9} />
        <path d={BAG_STRAPS} fill="none" stroke={garment('accessory').stroke} strokeWidth={3.6} strokeLinecap="round" />
        <path d={BAG_STRAPS} fill="none" stroke={strapFill('accessory')} strokeWidth={2.2} strokeLinecap="round" />
        <path d={BAG_CHEST_STRAP} fill="none" stroke={garment('accessory').stroke} strokeWidth={1} />
        <rect x={87} y={109.5} width={6} height={5} rx={1} fill={strapFill('accessory')} stroke={garment('accessory').stroke} strokeWidth={0.8} />
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

      {/* ── 7. 引线与标签：第二行显示该部位的配置状态 ── */}
      {OUTFIT_ZONES.map((zone) => {
        const [ax, ay, ly] = CALLOUTS[zone.key]
        const active = activeZone === zone.key
        const isHover = hovered === zone.key
        const count = zoneCounts[zone.key] || 0
        const lineColor = active ? '#1e232d' : isHover ? '#687083' : '#b4bac5'
        const status = count > 0 ? `已选 ${count} 张` : '未设置'

        return (
          <g
            key={zone.key}
            {...zoneProps(zone.key)}
            className="mq-label"
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-pressed={active}
            aria-label={`${zone.label}，${status}`}
            onFocus={() => setHovered(zone.key)}
            onBlur={() => setHovered(null)}
            onKeyDown={(e) => {
              if (disabled || (e.key !== 'Enter' && e.key !== ' ')) return
              e.preventDefault()
              onSelectZone(zone.key)
            }}
          >
            <path
              d={`M ${ax} ${ay} L ${LABEL_X} ${ly}`}
              fill="none"
              stroke={lineColor}
              strokeWidth={active ? 1 : 0.75}
              strokeDasharray={active ? undefined : '2 3'}
            />
            <circle
              cx={ax}
              cy={ay}
              r={active ? 2.4 : 2}
              fill={active ? '#1e232d' : '#ffffff'}
              stroke={lineColor}
              strokeWidth={0.9}
            />
            <rect
              x={LABEL_X}
              y={ly - LABEL_H / 2}
              width={LABEL_W}
              height={LABEL_H}
              rx={7}
              fill={active ? '#1e232d' : isHover ? '#eef1f6' : '#ffffff'}
              stroke={active ? '#1e232d' : count ? '#98a0ae' : '#dfe3e9'}
              strokeWidth={0.8}
            />
            <text x={LABEL_X + 8} y={ly - 2} fontSize={11} fontWeight={600} fill={active ? '#ffffff' : '#1e232d'}>
              {zone.label}
            </text>
            <text
              x={LABEL_X + 8}
              y={ly + 9.5}
              fontSize={8.5}
              fontWeight={count > 0 ? 600 : 400}
              fill={active ? 'rgba(255,255,255,.72)' : count > 0 ? '#3a4150' : '#98a0ae'}
            >
              {status}
            </text>
            {count > 0 && (
              <circle cx={LABEL_X + LABEL_W - 8} cy={ly - 6} r={2.2} fill={active ? '#ffffff' : '#1e232d'} />
            )}
          </g>
        )
      })}
    </svg>
  )
}

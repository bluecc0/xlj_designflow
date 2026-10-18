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

// 换装部位（按使用频率排序，即弹窗里 tab 的顺序）；items 是可选的下一级品类，用户可直接在部位内添加单品
export const OUTFIT_ZONES: OutfitZone[] = [
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
    // 配件含包袋与帽子；默认包袋，选中素材后可改标为帽子
    items: [
      { key: 'bag', slot: 'bag', label: '包袋' },
      { key: 'hat', slot: 'hat', label: '帽子' },
    ],
  },
]

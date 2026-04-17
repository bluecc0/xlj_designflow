/**
 * Penpot MCP Template Generation Library
 * =======================================
 * 提供通用的模板创建工具函数，供各类模板脚本使用。
 *
 * Slot 命名规范（与 backend/compose.py 兼容）:
 *   slot/product_{N}/image  — 产品图片（Rectangle）
 *   slot/product_{N}/name    — 产品名称（Text）
 *   slot/product_{N}/price   — 价格（Text）
 *   slot/product_{N}/tag     — 角标文字（Text）
 *   slot/product_{N}/spec    — 规格说明（Text）
 *   slot/poster              — 海报整体背景（可选）
 *   slot/title               — 整体标题（可选）
 *
 * 使用方法:
 *   const { createGridTemplate, DEFAULT_STYLES } = require('./grid_utils.js');
 */

/**
 * 默认颜色样式
 */
const DEFAULT_STYLES = {
  // 画布
  bg_color: "#F5F5F5",

  // 产品格
  cell_bg: "#FFFFFF",
  cell_corner: 12,

  // 图片占位
  img_placeholder: "#E8E8E8",

  // 文字
  name_color: "#1A1A1A",
  name_size: 15,
  name_weight: "600",

  // 价格
  price_color: "#E02020",
  price_size: 22,
  price_weight: "700",

  // 角标
  tag_bg: "#FF6B35",
  tag_color: "#FFFFFF",
  tag_size: 12,
  tag_weight: "600",

  // 规格
  spec_color: "#888888",
  spec_size: 12,
  spec_weight: "400",
};

/**
 * 模板预设配置
 */
const PRESETS = {
  // 4宫格（2×2）竖版
  grid_4: {
    canvas: { w: 1200, h: 1200 },
    cols: 2, rows: 2,
    gap: 20, padding: 20,
    cell_corner: 12,
    img_ratio: 0.62,
    colors: {
      bg_color: "#F5F5F5",
      cell_bg: "#FFFFFF",
      price_color: "#E02020",
      tag_bg: "#FF6B35",
    },
  },

  // 6宫格（2×3）横版
  grid_6: {
    canvas: { w: 1200, h: 900 },
    cols: 3, rows: 2,
    gap: 15, padding: 18,
    cell_corner: 10,
    img_ratio: 0.58,
    colors: {
      bg_color: "#FAFAFA",
      cell_bg: "#FFFFFF",
      price_color: "#D63031",
      tag_bg: "#00B894",
    },
  },

  // 9宫格（3×3）竖版
  grid_9: {
    canvas: { w: 1200, h: 1600 },
    cols: 3, rows: 3,
    gap: 12, padding: 16,
    cell_corner: 8,
    img_ratio: 0.60,
    colors: {
      bg_color: "#F8F8F8",
      cell_bg: "#FFFFFF",
      price_color: "#D63031",
      tag_bg: "#E17055",
    },
  },

  // 单品模板
  single: {
    canvas: { w: 800, h: 1000 },
    cols: 1, rows: 1,
    gap: 0, padding: 40,
    cell_corner: 16,
    img_ratio: 0.65,
    colors: {
      bg_color: "#FFFFFF",
      cell_bg: "#FFFFFF",
      price_color: "#E02020",
      tag_bg: "#FF6B35",
    },
  },
};

/**
 * 创建产品格 Board
 * @param {Board} parent - 父级 Board
 * @param {number} idx - 产品编号（1-based）
 * @param {object} cellBounds - {x, y, w, h}
 * @param {object} styles - 样式配置
 * @returns {object} { cellBoard, imgSlot, slots }
 */
function createProductCell(parent, idx, cellBounds, styles) {
  const { x, y, w, h } = cellBounds;
  const { cell_bg, cell_corner, img_placeholder } = styles;

  // 产品格背景 Board
  const cellBoard = penpot.createBoard();
  cellBoard.name = `product_${idx}_cell`;
  cellBoard.resize(w, h);
  cellBoard.x = parent.x + x;
  cellBoard.y = parent.y + y;
  cellBoard.fills = [{ fillColor: cell_bg, fillOpacity: 1 }];
  cellBoard.borderRadius = cell_corner;
  parent.appendChild(cellBoard);

  const imgH = Math.floor(h * styles.img_ratio);

  // ── 图片 slot ──────────────────────────────────────────────────────────
  const imgSlot = penpot.createRectangle();
  imgSlot.name = `slot/product_${idx}/image`;
  imgSlot.resize(w, imgH);
  imgSlot.x = cellBoard.x;
  imgSlot.y = cellBoard.y;
  imgSlot.fills = [{ fillColor: img_placeholder, fillOpacity: 1 }];
  imgSlot.borderRadiusTopLeft = cell_corner;
  imgSlot.borderRadiusTopRight = cell_corner;
  imgSlot.borderRadiusBottomLeft = 0;
  imgSlot.borderRadiusBottomRight = 0;
  cellBoard.appendChild(imgSlot);

  // ── 角标背景 ───────────────────────────────────────────────────────────
  const tagW = styles.tag_width || 72;
  const tagH = styles.tag_height || 26;

  const tagBg = penpot.createRectangle();
  tagBg.name = `slot/product_${idx}/tag_bg`;
  tagBg.resize(tagW, tagH);
  tagBg.x = cellBoard.x + 8;
  tagBg.y = cellBoard.y + 8;
  tagBg.fills = [{ fillColor: styles.tag_bg, fillOpacity: 1 }];
  tagBg.borderRadius = 4;
  cellBoard.appendChild(tagBg);

  // ── 角标文字 ───────────────────────────────────────────────────────────
  const tagText = penpot.createText(styles.tag_text || "新品");
  tagText.name = `slot/product_${idx}/tag`;
  tagText.resize(tagW, tagH);
  tagText.x = cellBoard.x + 8;
  tagText.y = cellBoard.y + 8;
  tagText.fills = [{ fillColor: styles.tag_color || "#FFFFFF", fillOpacity: 1 }];
  tagText.fontSize = String(styles.tag_size || 12);
  tagText.fontWeight = String(styles.tag_weight || "600");
  tagText.align = "center";
  tagText.growType = "fixed";
  cellBoard.appendChild(tagText);

  // ── 文字区域 ────────────────────────────────────────────────────────────
  const textY = imgH;
  const textPadding = styles.text_padding || 8;
  const textW = w - textPadding * 2;

  // 商品名称
  const nameText = penpot.createText("商品名称示例");
  nameText.name = `slot/product_${idx}/name`;
  nameText.resize(textW, styles.name_height || 32);
  nameText.x = cellBoard.x + textPadding;
  nameText.y = cellBoard.y + textY + 10;
  nameText.fills = [{ fillColor: styles.name_color, fillOpacity: 1 }];
  nameText.fontSize = String(styles.name_size || 15);
  nameText.fontWeight = String(styles.name_weight || "600");
  nameText.align = "left";
  nameText.growType = "fixed";
  cellBoard.appendChild(nameText);

  // 规格
  const specText = penpot.createText("规格 / 250ml");
  specText.name = `slot/product_${idx}/spec`;
  specText.resize(textW, styles.spec_height || 22);
  specText.x = cellBoard.x + textPadding;
  specText.y = cellBoard.y + textY + 46;
  specText.fills = [{ fillColor: styles.spec_color, fillOpacity: 1 }];
  specText.fontSize = String(styles.spec_size || 12);
  specText.fontWeight = String(styles.spec_weight || "400");
  specText.align = "left";
  specText.growType = "fixed";
  cellBoard.appendChild(specText);

  // 价格
  const priceText = penpot.createText("¥ 99.00");
  priceText.name = `slot/product_${idx}/price`;
  priceText.resize(textW, styles.price_height || 36);
  priceText.x = cellBoard.x + textPadding;
  priceText.y = cellBoard.y + textY + 72;
  priceText.fills = [{ fillColor: styles.price_color, fillOpacity: 1 }];
  priceText.fontSize = String(styles.price_size || 22);
  priceText.fontWeight = String(styles.price_weight || "700");
  priceText.align = "left";
  priceText.growType = "fixed";
  cellBoard.appendChild(priceText);

  return { cellBoard, imgSlot, slots: { nameText, specText, priceText, tagText, tagBg } };
}

/**
 * 根据预设创建宫格模板
 * @param {string} presetName - 预设名称（grid_4 / grid_6 / grid_9 / single）
 * @param {object} overrides - 可选的颜色覆盖
 * @returns {object} 模板结果
 */
function createGridTemplate(presetName, overrides = {}) {
  const preset = PRESETS[presetName];
  if (!preset) {
    throw new Error(`Unknown preset: ${presetName}. Available: ${Object.keys(PRESETS).join(", ")}`);
  }

  const { canvas, cols, rows, gap, padding, cell_corner, img_ratio } = preset;
  const CANVAS_W = canvas.w;
  const CANVAS_H = canvas.h;
  const PRODUCT_COUNT = cols * rows;

  // 合并颜色
  const colors = { ...DEFAULT_STYLES, ...preset.colors, ...overrides };

  // 计算每个产品格尺寸
  const CELL_W = Math.floor((CANVAS_W - padding * 2 - gap * (cols - 1)) / cols);
  const CELL_H = Math.floor((CANVAS_H - padding * 2 - gap * (rows - 1)) / rows);

  // ── 主画布 Board ─────────────────────────────────────────────────────────
  const mainBoard = penpot.createBoard();
  mainBoard.name = `${presetName.replace("_", "-")}产品模板`;
  mainBoard.resize(CANVAS_W, CANVAS_H);
  mainBoard.x = 400;  // 偏移避免重叠
  mainBoard.y = 0;
  mainBoard.fills = [{ fillColor: colors.bg_color, fillOpacity: 1 }];
  mainBoard.borderRadius = 0;

  // ── 生成产品格 ───────────────────────────────────────────────────────────
  const results = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const idx = row * cols + col + 1;  // 1-based
      const cellX = padding + col * (CELL_W + gap);
      const cellY = padding + row * (CELL_H + gap);

      const cellResult = createProductCell(mainBoard, idx, { x: cellX, y: cellY, w: CELL_W, h: CELL_H }, {
        cell_bg: colors.cell_bg,
        cell_corner,
        img_placeholder: colors.img_placeholder,
        img_ratio,
        tag_bg: colors.tag_bg,
        tag_color: colors.tag_color,
        tag_size: colors.tag_size,
        tag_weight: colors.tag_weight,
        tag_text: colors.tag_text,
        name_color: colors.name_color,
        name_size: colors.name_size,
        name_weight: colors.name_weight,
        name_height: 32,
        spec_color: colors.spec_color,
        spec_size: colors.spec_size,
        spec_weight: colors.spec_weight,
        spec_height: 22,
        price_color: colors.price_color,
        price_size: colors.price_size,
        price_weight: colors.price_weight,
        price_height: 36,
        text_padding: 8,
      });

      results.push(`product_${idx}: (${cellX},${cellY}) ${CELL_W}x${CELL_H}`);
    }
  }

  return {
    template: presetName,
    board_name: mainBoard.name,
    board_id: mainBoard.id,
    canvas: `${CANVAS_W}x${CANVAS_H}`,
    cell_size: `${CELL_W}x${CELL_H}`,
    products: results,
    slots_per_product: ["image", "name", "price", "tag", "spec", "tag_bg"],
    total_slots: PRODUCT_COUNT * 6,
    grid: { cols, rows, gap, padding },
  };
}

// ── 导出 ─────────────────────────────────────────────────────────────────────

module.exports = {
  PRESETS,
  DEFAULT_STYLES,
  createProductCell,
  createGridTemplate,
};
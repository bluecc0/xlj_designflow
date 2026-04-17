/**
 * 创建 4宫格产品海报模板 (2行 × 2列)
 * 模板尺寸: 1200 × 1200 px
 * 每个产品格: 580 × 560 px
 *
 * Slot 命名规范（后端 parse_slots 识别）:
 *   slot/product_1/image  — 产品图片占位（Rectangle）
 *   slot/product_1/name   — 产品名称（Text）
 *   slot/product_1/price  — 价格（Text）
 *   slot/product_1/tag    — 标签/角标（Text）
 *   slot/product_1/spec   — 规格（Text）
 *
 * 使用方法: 通过 penpot MCP execute_code 工具运行此脚本
 */

// ─── 配置 ────────────────────────────────────────────────────────────────────

const COLS = 2;
const ROWS = 2;
const PRODUCT_COUNT = COLS * ROWS;  // 4

const CANVAS_W = 1200;
const CANVAS_H = 1200;
const GAP = 20;             // 宫格间距
const PADDING = 20;         // 外边距
const CORNER_R = 12;        // 圆角

// 计算每个产品格尺寸
const CELL_W = Math.floor((CANVAS_W - PADDING * 2 - GAP * (COLS - 1)) / COLS);
const CELL_H = Math.floor((CANVAS_H - PADDING * 2 - GAP * (ROWS - 1)) / ROWS);

// 产品图片占产品格高度的比例
const IMG_RATIO = 0.62;
const IMG_H = Math.floor(CELL_H * IMG_RATIO);

// 文字区域
const TEXT_H = CELL_H - IMG_H;
const TEXT_PADDING = 8;

// 颜色
const BG_COLOR = "#F5F5F5";          // 画布背景
const CELL_BG = "#FFFFFF";           // 产品格背景
const IMG_PLACEHOLDER = "#E8E8E8";   // 图片占位灰
const NAME_COLOR = "#1A1A1A";        // 商品名
const PRICE_COLOR = "#E02020";       // 价格红
const TAG_COLOR = "#FFFFFF";         // 标签文字
const TAG_BG = "#FF6B35";            // 标签背景橙
const SPEC_COLOR = "#888888";        // 规格灰

// ─── 主画布 Board ─────────────────────────────────────────────────────────────

const mainBoard = penpot.createBoard();
mainBoard.name = "4宫格产品模板";
mainBoard.resize(CANVAS_W, CANVAS_H);
mainBoard.x = 0;
mainBoard.y = 0;
mainBoard.fills = [{ fillColor: BG_COLOR, fillOpacity: 1 }];
mainBoard.borderRadius = 0;

// ─── 辅助函数 ────────────────────────────────────────────────────────────────

function addRect(parent, name, x, y, w, h, color, radius = 0) {
  const r = penpot.createRectangle();
  r.name = name;
  r.resize(w, h);
  r.x = parent.x + x;
  r.y = parent.y + y;
  r.fills = [{ fillColor: color, fillOpacity: 1 }];
  if (radius > 0) r.borderRadius = radius;
  parent.appendChild(r);
  return r;
}

function addText(parent, name, content, x, y, w, h, color, size, weight, align) {
  const t = penpot.createText(content);
  t.name = name;
  t.resize(w, h);
  t.x = parent.x + x;
  t.y = parent.y + y;
  t.fills = [{ fillColor: color, fillOpacity: 1 }];
  t.fontSize = String(size);
  t.fontWeight = String(weight);
  t.align = align || "center";
  t.growType = "fixed";
  parent.appendChild(t);
  return t;
}

// ─── 生成产品格 ───────────────────────────────────────────────────────────────

const results = [];

for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    const idx = row * COLS + col + 1;  // 1-based
    const cellX = PADDING + col * (CELL_W + GAP);
    const cellY = PADDING + row * (CELL_H + GAP);

    // 产品格背景
    const cellBoard = penpot.createBoard();
    cellBoard.name = `product_${idx}_cell`;
    cellBoard.resize(CELL_W, CELL_H);
    cellBoard.x = mainBoard.x + cellX;
    cellBoard.y = mainBoard.y + cellY;
    cellBoard.fills = [{ fillColor: CELL_BG, fillOpacity: 1 }];
    cellBoard.borderRadius = CORNER_R;
    mainBoard.appendChild(cellBoard);

    // ── 图片 slot ─────────────────────────────────────────────────────────
    const imgSlot = penpot.createRectangle();
    imgSlot.name = `slot/product_${idx}/image`;
    imgSlot.resize(CELL_W, IMG_H);
    imgSlot.x = cellBoard.x;
    imgSlot.y = cellBoard.y;
    imgSlot.fills = [{ fillColor: IMG_PLACEHOLDER, fillOpacity: 1 }];
    imgSlot.borderRadiusTopLeft = CORNER_R;
    imgSlot.borderRadiusTopRight = CORNER_R;
    imgSlot.borderRadiusBottomLeft = 0;
    imgSlot.borderRadiusBottomRight = 0;
    cellBoard.appendChild(imgSlot);

    // ── 标签 slot（左上角角标）─────────────────────────────────────────────
    const tagBg = penpot.createRectangle();
    tagBg.name = `slot/product_${idx}/tag_bg`;
    tagBg.resize(72, 26);
    tagBg.x = cellBoard.x + 8;
    tagBg.y = cellBoard.y + 8;
    tagBg.fills = [{ fillColor: TAG_BG, fillOpacity: 1 }];
    tagBg.borderRadius = 4;
    cellBoard.appendChild(tagBg);

    const tagText = penpot.createText("新品");
    tagText.name = `slot/product_${idx}/tag`;
    tagText.resize(72, 26);
    tagText.x = cellBoard.x + 8;
    tagText.y = cellBoard.y + 8;
    tagText.fills = [{ fillColor: TAG_COLOR, fillOpacity: 1 }];
    tagText.fontSize = "12";
    tagText.fontWeight = "600";
    tagText.align = "center";
    tagText.growType = "fixed";
    cellBoard.appendChild(tagText);

    // ── 文字区域 (在图片下方) ────────────────────────────────────────────────
    const textAreaY = IMG_H;

    // 商品名称
    const nameText = penpot.createText("商品名称示例");
    nameText.name = `slot/product_${idx}/name`;
    nameText.resize(CELL_W - TEXT_PADDING * 2, 32);
    nameText.x = cellBoard.x + TEXT_PADDING;
    nameText.y = cellBoard.y + textAreaY + 10;
    nameText.fills = [{ fillColor: NAME_COLOR, fillOpacity: 1 }];
    nameText.fontSize = "15";
    nameText.fontWeight = "600";
    nameText.align = "left";
    nameText.growType = "fixed";
    cellBoard.appendChild(nameText);

    // 规格
    const specText = penpot.createText("规格 / 250ml × 6");
    specText.name = `slot/product_${idx}/spec`;
    specText.resize(CELL_W - TEXT_PADDING * 2, 22);
    specText.x = cellBoard.x + TEXT_PADDING;
    specText.y = cellBoard.y + textAreaY + 46;
    specText.fills = [{ fillColor: SPEC_COLOR, fillOpacity: 1 }];
    specText.fontSize = "12";
    specText.fontWeight = "400";
    specText.align = "left";
    specText.growType = "fixed";
    cellBoard.appendChild(specText);

    // 价格
    const priceText = penpot.createText("¥ 99.00");
    priceText.name = `slot/product_${idx}/price`;
    priceText.resize(CELL_W - TEXT_PADDING * 2, 36);
    priceText.x = cellBoard.x + TEXT_PADDING;
    priceText.y = cellBoard.y + textAreaY + 72;
    priceText.fills = [{ fillColor: PRICE_COLOR, fillOpacity: 1 }];
    priceText.fontSize = "22";
    priceText.fontWeight = "700";
    priceText.align = "left";
    priceText.growType = "fixed";
    cellBoard.appendChild(priceText);

    results.push(`product_${idx}: cell(${cellX},${cellY}) ${CELL_W}x${CELL_H}`);
  }
}

return {
  template: "4宫格产品模板",
  board_name: mainBoard.name,
  canvas: `${CANVAS_W}x${CANVAS_H}`,
  cell_size: `${CELL_W}x${CELL_H}`,
  products: results,
  slots_per_product: ["image", "name", "price", "tag", "spec"],
  total_slots: PRODUCT_COUNT * 5,
};

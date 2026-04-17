/**
 * 创建 6宫格产品海报模板 (2行 × 3列)
 * 模板尺寸: 1200 × 900 px（横版）
 * 每个产品格: 373 × 410 px
 *
 * Slot 命名规范:
 *   slot/product_N/image  — 图片（Rectangle）
 *   slot/product_N/name   — 商品名（Text）
 *   slot/product_N/price  — 价格（Text）
 *   slot/product_N/tag    — 角标（Text）
 *   slot/product_N/spec   — 规格（Text）
 *
 * 使用方法: 通过 penpot MCP execute_code 工具运行
 */

const COLS = 3;
const ROWS = 2;
const PRODUCT_COUNT = COLS * ROWS;  // 6

const CANVAS_W = 1200;
const CANVAS_H = 900;
const GAP = 15;
const PADDING = 18;
const CORNER_R = 10;

const CELL_W = Math.floor((CANVAS_W - PADDING * 2 - GAP * (COLS - 1)) / COLS);
const CELL_H = Math.floor((CANVAS_H - PADDING * 2 - GAP * (ROWS - 1)) / ROWS);
const IMG_RATIO = 0.58;
const IMG_H = Math.floor(CELL_H * IMG_RATIO);
const TEXT_PADDING = 8;

const BG_COLOR = "#FAFAFA";
const CELL_BG = "#FFFFFF";
const IMG_PLACEHOLDER = "#EBEBEB";
const NAME_COLOR = "#1A1A1A";
const PRICE_COLOR = "#D63031";
const TAG_COLOR = "#FFFFFF";
const TAG_BG = "#00B894";
const SPEC_COLOR = "#999999";

// ─── 主画布 ───────────────────────────────────────────────────────────────────

const mainBoard = penpot.createBoard();
mainBoard.name = "6宫格产品模板";
mainBoard.resize(CANVAS_W, CANVAS_H);
mainBoard.x = 400;  // 偏移避免与4宫格重叠
mainBoard.y = 0;
mainBoard.fills = [{ fillColor: BG_COLOR, fillOpacity: 1 }];

// ─── 生成产品格 ───────────────────────────────────────────────────────────────

const results = [];

for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    const idx = row * COLS + col + 1;
    const cellX = PADDING + col * (CELL_W + GAP);
    const cellY = PADDING + row * (CELL_H + GAP);

    // 产品格
    const cellBoard = penpot.createBoard();
    cellBoard.name = `product_${idx}_cell`;
    cellBoard.resize(CELL_W, CELL_H);
    cellBoard.x = mainBoard.x + cellX;
    cellBoard.y = mainBoard.y + cellY;
    cellBoard.fills = [{ fillColor: CELL_BG, fillOpacity: 1 }];
    cellBoard.borderRadius = CORNER_R;
    mainBoard.appendChild(cellBoard);

    // 图片 slot
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

    // 标签角标背景
    const tagBg = penpot.createRectangle();
    tagBg.name = `slot/product_${idx}/tag_bg`;
    tagBg.resize(60, 22);
    tagBg.x = cellBoard.x + 6;
    tagBg.y = cellBoard.y + 6;
    tagBg.fills = [{ fillColor: TAG_BG, fillOpacity: 1 }];
    tagBg.borderRadius = 3;
    cellBoard.appendChild(tagBg);

    // 标签文字 slot
    const tagText = penpot.createText("推荐");
    tagText.name = `slot/product_${idx}/tag`;
    tagText.resize(60, 22);
    tagText.x = cellBoard.x + 6;
    tagText.y = cellBoard.y + 6;
    tagText.fills = [{ fillColor: TAG_COLOR, fillOpacity: 1 }];
    tagText.fontSize = "11";
    tagText.fontWeight = "600";
    tagText.align = "center";
    tagText.growType = "fixed";
    cellBoard.appendChild(tagText);

    // 文字区域起始 Y
    const textY = IMG_H;

    // 商品名称
    const nameText = penpot.createText("商品名称");
    nameText.name = `slot/product_${idx}/name`;
    nameText.resize(CELL_W - TEXT_PADDING * 2, 28);
    nameText.x = cellBoard.x + TEXT_PADDING;
    nameText.y = cellBoard.y + textY + 8;
    nameText.fills = [{ fillColor: NAME_COLOR, fillOpacity: 1 }];
    nameText.fontSize = "13";
    nameText.fontWeight = "600";
    nameText.align = "left";
    nameText.growType = "fixed";
    cellBoard.appendChild(nameText);

    // 规格
    const specText = penpot.createText("规格 500g");
    specText.name = `slot/product_${idx}/spec`;
    specText.resize(CELL_W - TEXT_PADDING * 2, 20);
    specText.x = cellBoard.x + TEXT_PADDING;
    specText.y = cellBoard.y + textY + 38;
    specText.fills = [{ fillColor: SPEC_COLOR, fillOpacity: 1 }];
    specText.fontSize = "11";
    specText.fontWeight = "400";
    specText.align = "left";
    specText.growType = "fixed";
    cellBoard.appendChild(specText);

    // 价格
    const priceText = penpot.createText("¥ 39.9");
    priceText.name = `slot/product_${idx}/price`;
    priceText.resize(CELL_W - TEXT_PADDING * 2, 32);
    priceText.x = cellBoard.x + TEXT_PADDING;
    priceText.y = cellBoard.y + textY + 60;
    priceText.fills = [{ fillColor: PRICE_COLOR, fillOpacity: 1 }];
    priceText.fontSize = "19";
    priceText.fontWeight = "700";
    priceText.align = "left";
    priceText.growType = "fixed";
    cellBoard.appendChild(priceText);

    results.push(`product_${idx}: (${cellX},${cellY}) ${CELL_W}x${CELL_H}`);
  }
}

return {
  template: "6宫格产品模板",
  board_name: mainBoard.name,
  canvas: `${CANVAS_W}x${CANVAS_H}`,
  cell_size: `${CELL_W}x${CELL_H}`,
  products: results,
  slots_per_product: ["image", "name", "price", "tag", "spec"],
  total_slots: PRODUCT_COUNT * 5,
};

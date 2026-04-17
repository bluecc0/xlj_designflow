/**
 * 创建 9宫格产品海报模板 (3行 × 3列)
 * 模板尺寸: 1200 × 1600 px（竖版）
 * 每个产品格: 383 × 503 px
 *
 * Slot 命名规范（与 backend/compose.py 兼容）:
 *   slot/product_{N}/image  — 产品图片占位（Rectangle）
 *   slot/product_{N}/name    — 产品名称（Text）
 *   slot/product_{N}/price   — 价格（Text）
 *   slot/product_{N}/tag     — 角标文字（Text）
 *   slot/product_{N}/spec     — 规格说明（Text）
 *
 * 使用方法: 通过 penpot MCP execute_code 工具运行此脚本
 */

const { createGridTemplate } = require('./grid_utils.js');

// 创建 9宫格模板
return createGridTemplate('grid_9', {
  // 可选：自定义颜色覆盖
  tag_text: "热卖",
});
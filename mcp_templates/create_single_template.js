/**
 * 创建单产品海报模板
 * 模板尺寸: 800 × 1000 px（竖版）
 * 适合单品详情页、活动主图等
 *
 * Slot 命名规范（与 backend/compose.py 兼容）:
 *   slot/product_1/image  — 产品图片占位（Rectangle）
 *   slot/product_1/name    — 产品名称（Text）
 *   slot/product_1/price   — 价格（Text）
 *   slot/product_1/tag     — 角标文字（Text）
 *   slot/product_1/spec     — 规格说明（Text）
 *   slot/poster             — 海报整体背景（可选）
 *   slot/title              — 整体标题（可选）
 *
 * 使用方法: 通过 penpot MCP execute_code 工具运行此脚本
 */

const { createGridTemplate } = require('./grid_utils.js');

// 创建单品模板
return createGridTemplate('single', {
  tag_text: "新品",
});
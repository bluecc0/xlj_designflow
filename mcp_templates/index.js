/**
 * Penpot MCP Template Index
 * ========================
 * 提供快速模板创建的统一入口
 *
 * 可用模板:
 *   - grid_4:  2×2 宫格（1200×1200）
 *   - grid_6:  2×3 宫格（1200×900）
 *   - grid_9:  3×3 宫格（1200×1600）
 *   - single:  单品模板（800×1000）
 *
 * 使用方法:
 *
 *   // 创建 4 宫格
 *   const { createGridTemplate } = require('./index.js');
 *   return createGridTemplate('grid_4');
 *
 *   // 创建 6 宫格
 *   return createGridTemplate('grid_6');
 *
 *   // 创建 9 宫格
 *   return createGridTemplate('grid_9');
 *
 *   // 创建单品
 *   return createGridTemplate('single');
 *
 *   // 自定义颜色
 *   return createGridTemplate('grid_4', {
 *     bg_color: "#1A1A1A",
 *     price_color: "#FFD700",
 *     tag_bg: "#FF4500",
 *   });
 *
 * Slot 规范说明:
 *   所有模板生成的 slot 都遵循统一命名规则，方便后端合成引擎识别：
 *
 *   slot/product_{N}/image   — 产品图片（Rectangle）
 *   slot/product_{N}/name    — 产品名称（Text）
 *   slot/product_{N}/price   — 价格（Text）
 *   slot/product_{N}/tag     — 角标文字（Text）
 *   slot/product_{N}/spec    — 规格说明（Text）
 *   slot/product_{N}/tag_bg   — 角标背景（Rectangle）
 *
 *   N 从 1 开始，按从左到右、从上到下的顺序编号。
 */

const { PRESETS, DEFAULT_STYLES, createGridTemplate } = require('./grid_utils.js');

module.exports = {
  PRESETS,
  DEFAULT_STYLES,
  createGridTemplate,
};
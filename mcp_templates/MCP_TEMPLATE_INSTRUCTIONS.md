# Template Generation Instructions

## Overview

You have access to a **Template Generation Library** in the `mcp_templates/` directory.
Use this library to quickly create product poster templates in Penpot via the `execute_code` tool.

## Available Templates

| Template ID | Dimensions | Grid | Best For |
|-------------|------------|------|----------|
| `grid_4` | 1200×1200 | 2×2 | 4-product display |
| `grid_6` | 1200×900 | 2×3 | 6-product display (landscape) |
| `grid_9` | 1200×1600 | 3×3 | 9-product display |
| `single` | 800×1000 | 1×1 | Single product hero image |

## Quick Commands

### Create Standard Templates

```javascript
const { createGridTemplate } = require('./mcp_templates/index.js');

// 4-grid (2×2)
return createGridTemplate('grid_4');

// 6-grid (2×3)
return createGridTemplate('grid_6');

// 9-grid (3×3)
return createGridTemplate('grid_9');

// Single product
return createGridTemplate('single');
```

### Custom Colors

Pass a second argument to override default colors:

```javascript
return createGridTemplate('grid_4', {
  bg_color: "#1A1A1A",       // Dark background
  price_color: "#FFD700",    // Gold price
  tag_bg: "#FF4500",         // Orange-red tag
  tag_text: "热卖",          // Tag text
});
```

## Slot Naming Convention

All templates use standardized slot names for **backend composition compatibility**:

```
slot/product_{N}/image   → Product image placeholder (Rectangle)
slot/product_{N}/name    → Product name (Text)
slot/product_{N}/price   → Price text (Text)
slot/product_{N}/tag     → Tag/label text (Text)
slot/product_{N}/spec    → Specification text (Text)
slot/product_{N}/tag_bg  → Tag background (Rectangle)
```

- `{N}` is 1-based index
- Index order: left-to-right, top-to-bottom
- Example: `slot/product_1/image`, `slot/product_2/price`, etc.

**Critical**: Always follow this naming convention! The backend `compose.py` parses slots using this exact pattern.

## Template Creation Workflow

1. **User requests template** → "帮我创建一个6宫格产品模板"
2. **You execute code** → `return createGridTemplate('grid_6')`
3. **Penpot creates board** → Returns metadata with `board_id`
4. **Store board_id** → Save to `storage` for backend reference
5. **Backend uses board** → For composition via Penpot API

## Response Format

Each template creation returns metadata:

```json
{
  "template": "grid_6",
  "board_name": "grid-6产品模板",
  "board_id": "uuid-of-created-board",
  "canvas": "1200x900",
  "cell_size": "383x410",
  "products": ["product_1: (18,18) 383x410", ...],
  "slots_per_product": ["image", "name", "price", "tag", "spec", "tag_bg"],
  "total_slots": 36,
  "grid": {"cols": 3, "rows": 2, "gap": 15, "padding": 18}
}
```

## Common Use Cases

### E-commerce Product Grid

```javascript
const { createGridTemplate } = require('./mcp_templates/index.js');
return createGridTemplate('grid_4', {
  tag_text: "新品",
  price_color: "#D63031",
});
```

### Promotion Banner

```javascript
const { createGridTemplate } = require('./mcp_templates/index.js');
return createGridTemplate('grid_9', {
  bg_color: "#FFF5E6",
  tag_bg: "#FF6B35",
  tag_text: "限时",
});
```

### Single Product Hero

```javascript
const { createGridTemplate } = require('./mcp_templates/index.js');
return createGridTemplate('single', {
  tag_text: "爆款",
  price_color: "#E02020",
});
```

## Color Presets

Quick color combinations for common themes:

**Classic (Red/White)**:
```javascript
{ price_color: "#E02020", tag_bg: "#FF6B35" }
```

**Fresh (Green)**:
```javascript
{ price_color: "#00B894", tag_bg: "#00CEC9" }
```

**Premium (Gold)**:
```javascript
{ price_color: "#D4AF37", tag_bg: "#B8860B", bg_color: "#1A1A1A" }
```

**Summer (Orange)**:
```javascript
{ price_color: "#E17055", tag_bg: "#FDCB6E", tag_text: "清凉" }
```

## Advanced: Custom Layouts

For non-standard layouts, use helper functions directly:

```javascript
const { createProductCell, PRESETS } = require('./mcp_templates/grid_utils.js');

// Create main board
const board = penpot.createBoard();
board.name = "Custom Layout";
board.resize(1200, 1200);
board.fills = [{ fillColor: "#F5F5F5", fillOpacity: 1 }];

// Create 5 cells in a custom arrangement
createProductCell(board, 1, { x: 0, y: 0, w: 500, h: 600 }, PRESETS.grid_4);
createProductCell(board, 2, { x: 520, y: 0, w: 500, h: 600 }, PRESETS.grid_4);
// ... continue for more products
```

## Important Notes

1. **Storage**: Always store created `board_id` in `storage.boardId` for backend reference
2. **Naming**: Use exact slot naming `slot/product_N/field` — backend parses this
3. **Colors**: Use uppercase hex (#FF5533 not #ff5533)
4. **Text**: Set `growType = "fixed"` for predictable text box sizing
5. **Images**: Rectangle slots are placeholders; real images added by backend `compose.py`

## File Structure

```
mcp_templates/
├── index.js           # Main entry, exports createGridTemplate
├── grid_utils.js      # Core library functions
├── create_4grid_template.js    # Pre-made 4-grid script
├── create_6grid_template.js    # Pre-made 6-grid script
├── create_9grid_template.js    # Pre-made 9-grid script
├── create_single_template.js   # Pre-made single product script
└── MCP_TEMPLATE_GUIDE.md        # Full documentation
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Template not found | Use `grid_4`, `grid_6`, `grid_9`, or `single` |
| Slots not recognized | Check naming: `slot/product_1/image` (lowercase) |
| Positioning wrong | Use `penpotUtils.setParentXY()` for relative positioning |
| Colors not applied | Ensure hex format: `#FF0000` with caps |

## Examples in Context

**User**: "我要做一个4宫格的产品海报，标签用橙色"

**Your action**:
```javascript
const { createGridTemplate } = require('./mcp_templates/index.js');
return createGridTemplate('grid_4', {
  tag_bg: "#FF8C00",
  tag_text: "特惠",
});
```

**User**: "帮我创建一个3×3的促销模板"

**Your action**:
```javascript
const { createGridTemplate } = require('./mcp_templates/index.js');
return createGridTemplate('grid_9', {
  bg_color: "#FFF0F0",
  tag_bg: "#E74C3C",
  tag_text: "促销",
  price_color: "#C0392B",
});
```

---

**Remember**: Store `board_id` from the response in `storage` for later backend operations!
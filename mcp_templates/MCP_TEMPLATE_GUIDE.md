# Penpot MCP Template Generation Guide

## Quick Start - Creating Templates via MCP

When users ask to create a product poster template, use the `execute_code` tool with the following patterns:

### Available Templates

| Template | Dimensions | Grid | Use Case |
|----------|------------|------|----------|
| `grid_4` | 1200×1200 | 2×2 | 4产品展示 |
| `grid_6` | 1200×900 | 2×3 | 6产品展示（横版） |
| `grid_9` | 1200×1600 | 3×3 | 9产品展示 |
| `single` | 800×1000 | 1×1 | 单品主图 |

### Basic Usage

**Create 4-grid template:**
```javascript
const { createGridTemplate } = require('./index.js');
return createGridTemplate('grid_4');
```

**Create 6-grid template:**
```javascript
const { createGridTemplate } = require('./index.js');
return createGridTemplate('grid_6');
```

**Create 9-grid template:**
```javascript
const { createGridTemplate } = require('./index.js');
return createGridTemplate('grid_9');
```

**Create single product template:**
```javascript
const { createGridTemplate } = require('./index.js');
return createGridTemplate('single');
```

### Custom Colors

Override colors by passing a second argument:
```javascript
return createGridTemplate('grid_4', {
  bg_color: "#1A1A1A",
  price_color: "#FFD700",
  tag_bg: "#FF4500",
  tag_text: "热卖",
});
```

### Available Color Overrides

| Property | Default | Description |
|----------|---------|-------------|
| `bg_color` | `#F5F5F5` | Canvas background |
| `cell_bg` | `#FFFFFF` | Product cell background |
| `img_placeholder` | `#E8E8E8` | Image placeholder color |
| `name_color` | `#1A1A1A` | Product name color |
| `price_color` | `#E02020` | Price text color (red) |
| `tag_bg` | `#FF6B35` | Tag background color |
| `tag_color` | `#FFFFFF` | Tag text color |
| `spec_color` | `#888888` | Specification text color |

### Slot Naming Convention

All templates use standardized slot names for backend compatibility:

```
slot/product_{N}/image   — Product image placeholder
slot/product_{N}/name    — Product name
slot/product_{N}/price   — Price text
slot/product_{N}/tag     — Tag/label text
slot/product_{N}/spec    — Specification text
slot/product_{N}/tag_bg  — Tag background rectangle
```

{N} is 1-based index, left-to-right, top-to-bottom.

### User Workflow

1. **User**: "帮我创建一个6宫格产品模板"
2. **You**: Execute `createGridTemplate('grid_6')` via `execute_code`
3. **Result**: Returns template metadata including board_id for composition
4. **Backend**: Uses board_id to import template for composition

### Template Metadata Response

Each template creation returns:
```json
{
  "template": "grid_6",
  "board_name": "grid-6产品模板",
  "board_id": "abc123...",
  "canvas": "1200x900",
  "cell_size": "383x410",
  "products": ["product_1: (18,18) 383x410", ...],
  "slots_per_product": ["image", "name", "price", "tag", "spec", "tag_bg"],
  "total_slots": 36,
  "grid": {"cols": 3, "rows": 2, "gap": 15, "padding": 18}
}
```

### Custom Template Design

For custom layouts, use the helper functions directly:

```javascript
const { createProductCell, DEFAULT_STYLES } = require('./grid_utils.js');

// Create a main board
const mainBoard = penpot.createBoard();
mainBoard.name = "Custom Template";
mainBoard.resize(1200, 1200);

// Create cells with custom positioning
createProductCell(mainBoard, 1, { x: 0, y: 0, w: 400, h: 500 }, {
  cell_bg: "#FFFFFF",
  tag_bg: "#FF6B35",
  price_color: "#E02020",
});
```

### Advanced: Manual Slot Creation

For complete custom templates, create slots manually following the naming convention:

```javascript
// Image slot
const img = penpot.createRectangle();
img.name = `slot/product_1/image`;
img.resize(400, 300);
img.fills = [{ fillColor: "#E8E8E8", fillOpacity: 1 }];

// Text slot
const name = penpot.createText("商品名称");
name.name = `slot/product_1/name`;
name.fontSize = "16";
name.fontWeight = "600";
```

### Important Notes

1. **Always use slot naming convention** for backend compatibility
2. **Store board_id** in `storage` for later reference
3. **Use color hex with caps** (e.g., '#FF5533' not '#ff5533')
4. **Images**: Use Rectangle with fill for placeholder; real images are added by backend
5. **Text alignment**: Set `growType = "fixed"` for predictable sizing

### Troubleshooting

- **Template not appearing**: Check if board was created successfully; look for errors in response
- **Slots not recognized**: Ensure slot names follow `slot/product_N/field` pattern exactly
- **Positioning issues**: Remember that x/y in Penpot are absolute; use `penpotUtils.setParentXY()` for relative positioning
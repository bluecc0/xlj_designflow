# Reference Image Analysis

When the user uploads or points to a reference image, analyze the image before generating. The goal is style transfer for Chinese artistic lettering, not blind copying.

## Analysis Checklist

Extract these traits:

1. Lettering category:
   - handwritten, brush, sticker, logo, poster title, 3D, flat graphic, ink, neon, glass, metal, paper-cut, retro, luxury, cartoon.
2. Character construction:
   - rounded or sharp
   - thick or thin
   - compressed or wide
   - upright or tilted
   - regular or irregular baseline
   - connected or separated characters
   - bold silhouette or delicate strokes
3. Stroke behavior:
   - marker, brush, crayon, chalk, pen, ribbon, inflated, beveled, carved, fractured, liquid, glowing.
   - terminals: round, cut, tapered, splattered, hooked, decorative.
   - pressure: flat weight, thick-thin contrast, dry-brush gaps, bouncy variation.
4. Color distribution:
   - per-character colors
   - gradients
   - outlines
   - drop shadows
   - highlights
   - backing layers
   - accent colors
   - monochrome or multi-color logic
5. Material and edge treatment:
   - paper texture, glossy jelly, foam, ink bleed, metallic bevel, glass refraction, sticker edge, neon glow, grain.
6. Decoration system:
   - where decorations sit: inside strokes, around text, negative spaces, corners, background.
   - motif type: stars, clouds, waves, flowers, ribbons, sparks, geometric symbols, cultural ornaments.
   - density: sparse, moderate, maximal.
7. Composition:
   - single line, two lines, stacked, arched, badge, centered logo, diagonal motion, vertical layout.
   - background complexity and contrast.
8. Mood and audience:
   - cute, premium, youthful, heroic, romantic, festive, mysterious, technological, nostalgic.

## Transfer Rules

Transfer:

- stroke style
- color logic
- outline/shadow system
- material feel
- composition rhythm
- decoration density
- mood and polish level

Do not transfer:

- the reference image's original text unless the user asks
- brand names or logos from the reference
- irrelevant objects that conflict with the user's new theme
- accidental artifacts, spelling errors, malformed characters, watermarks

## Conflict Resolution

If the reference image conflicts with the user's text or theme:

- User's exact text wins.
- User's explicit style wins over inferred reference traits.
- Legibility wins over reference complexity.
- Theme-specific symbols can replace reference symbols while preserving the reference's decoration density and placement.

Examples:

- Reference is colorful candy sticker, user asks "乘风破浪": keep thick white outline, bouncy layered color, and sticker shadow only if the user wants playful; otherwise adapt the color layering into more heroic wave/brush accents.
- Reference is black ink brush, user asks "儿童节": keep brush texture but soften it with rounded strokes and brighter child-friendly color.
- Reference is metallic game title, user asks "最好的时光在路上": keep cinematic structure only lightly; avoid heavy metal if the user requested poetic handwriting.

## Internal Brief Pattern

Use a compact style-transfer paragraph:

```text
Use the uploaded reference image only as a style reference. Transfer its [stroke behavior], [color distribution], [outline/shadow/material system], [composition rhythm], and [decoration density] to the new exact Chinese text "[TEXT]". Do not copy any original words, logos, watermarks, or accidental artifacts from the reference image.
```

Then add the normal exact-text and legibility constraints.

## When to Explain

If useful, briefly tell the user what was extracted:

```markdown
我会提取参考图的这几项：笔画形态、配色分配、描边/阴影、材质、构图节奏；文字内容仍以你给的新文字为准。
```

Do not expose a long analysis unless the user asks for style analysis.

# Image Generation Templates

Use English for the internal image brief unless the user requests a Chinese prompt. Keep the exact Chinese text in Chinese quotes.

Default behavior is direct image generation. These templates are internal briefs for the image-generation tool. Only show them to the user when the user explicitly asks for prompts.

## Prompt-Only Response

```markdown
## 需求理解
- 文字：
- 类型：
- 风格：
- 情绪：
- 受众：

## 推荐方向
1. ...
2. ...
3. ...

## gpt-image2 Prompt
Create ...

## 可选微调
- 更可爱：...
- 更高级：...
- 更像 logo：...
```

## Prompt Skeleton
## Internal Image Brief Skeleton

```text
Create a [use case] Chinese artistic lettering design for the exact text "[TEXT]".
The Chinese characters must be accurate, legible, and the main subject of the image.
Design the characters with [character structure rules] and [stroke transformation rules], while preserving the original Chinese character structure.
Use a [style] visual direction: [material], [edge treatment], [color palette], [lighting/texture].
Specify clear color distribution: [per-character colors / stroke gradients / colored outlines / sticker backing layers / shadows]. Avoid monochrome lettering unless the user explicitly asks for it.
Add subtle themed elements such as [symbols], integrated into or around the strokes without covering, replacing, or distorting the Chinese characters.
[Composition instruction].
No extra words, no English text, no misspelled Chinese characters, no pseudo-Chinese symbols, no random marks.
```

## Reference Image Style Transfer Skeleton

```text
Create a Chinese artistic lettering design for the exact text "[TEXT]".
Use the uploaded reference image only as a style reference. Transfer its [stroke behavior], [color distribution], [outline/shadow/material system], [composition rhythm], and [decoration density] to the new exact Chinese text "[TEXT]".
Do not copy any original words, logos, watermarks, or accidental artifacts from the reference image.
The Chinese characters must be accurate, legible, and the main subject of the image.
Preserve authentic Chinese character structure while adapting the reference style to the new text.
If the user also provided a theme or style, merge it with the reference: [theme/style merge rule].
No extra words, no English text, no misspelled Chinese characters, no pseudo-Chinese symbols, no random marks.
```

## Children's Day + Handwritten Example

```text
Create a cute warm Chinese hand-lettering design for the exact text "儿童节".
The Chinese characters must be accurate, legible, and the main subject of the image.
Use a playful handwritten style, with rounded uneven strokes, natural marker-like thickness variation, soft childlike rhythm, and a friendly hand-drawn feeling, while preserving the original Chinese character structure.
Make the lettering feel suitable for Children's Day: use distinct cheerful colors across the characters, for example pastel yellow for one character, sky blue for another, soft pink for another, mint green accents, warm white sticker outlines, and subtle orange shadows. Avoid one-color lettering.
Add small balloons, stars, clouds, rainbow ribbons, and sticker-like decorations.
The decorations should support the Chinese characters but must not cover, replace, or distort them.
Centered poster-title composition, clean light background, cheerful and warm.
No extra words, no English text, no misspelled Chinese characters, no pseudo-Chinese symbols, no dark horror mood, no sharp aggressive metal style.
```

## Logo / Wordmark Template

```text
Create a Chinese logo lettering design for the exact text "[TEXT]".
The Chinese characters must be accurate, legible, and the only text in the image.
Build a strong unified silhouette, front-facing and scalable like a brand wordmark.
Use [style/material] with controlled details and clean stroke transformations, while preserving authentic Chinese character structure.
Minimal or transparent-feeling background, no scene, no extra objects competing with the lettering.
No extra words, no English text, no misspelled Chinese characters, no pseudo-Chinese glyphs.
```

## Poster Title Template

```text
Create a dramatic Chinese poster-title lettering design for the exact text "[TEXT]".
The Chinese characters must be accurate, legible, and the visual focus.
Use [mood/style] with [stroke rules], [material], and [themed symbols].
The title should feel large, centered, high-impact, and readable from a distance.
Use a controlled atmospheric background that supports the title without competing with it.
No extra words, no English text, no misspelled Chinese characters, no pseudo-Chinese symbols.
```

## Experimental Template

Only use when the user asks for experimental or highly artistic results.

```text
Create an experimental Chinese artistic lettering design for the exact text "[TEXT]".
Keep the Chinese characters accurate and still readable, even with expressive deformation.
Transform the strokes using [transformation system], creating a bold visual object rather than a normal font.
Use [material/style] and a strong composition, but preserve enough authentic Chinese structure for recognition.
No extra words, no English text, no misspelled Chinese characters, no pseudo-Chinese glyphs.
```

## Negative Constraint Bank

Use selectively:

- no extra words
- no English text
- no random symbols
- no pseudo-Chinese glyphs
- no misspelled Chinese characters
- no illegible abstract shapes
- no ordinary typed font
- no cluttered background
- no decorations covering the strokes
- no cheap 3D bevel
- no excessive glow
- no stock clipart look

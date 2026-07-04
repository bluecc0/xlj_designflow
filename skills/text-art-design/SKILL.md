---
name: text-art-design
description: Use this skill when directly generating, improving, or critiquing Chinese artistic lettering images, Chinese title logos, poster typography, event title art, game title lettering, brand wordmarks, packaging title text, or stylized Chinese text with image models such as gpt-image2. Use it for short Chinese visual requests, vague themes, explicit styles such as handwritten, ink, cyberpunk, cute, metallic, glass, paper-cut, retro, luxury, uploaded reference images whose lettering style should be analyzed and transferred, requests for reusable prompts, or user feedback about failed generated Chinese text.
---

# Text Art Design Image Director

This skill turns user intent into generated Chinese artistic lettering images. It is not for complete font families or conventional typography engineering. Its job is to act as a visual director: infer meaning, choose a style, define Chinese character transformations, protect legibility, and call the available image-generation tool with a strong internal brief.

Default behavior: generate the image directly. Output a reusable prompt only when the user explicitly asks for a prompt, asks to revise a prompt, or says not to generate an image.

## Core Workflow

For every request:

1. Identify the user's input type:
   - exact Chinese display text
   - theme or occasion
   - use case
   - style
   - emotional tone
   - uploaded reference image
   - reference object
   - feedback on a generated result
2. If the user provides a reference image, analyze it before generating:
   - lettering structure
   - stroke behavior
   - material and edge treatment
   - color distribution
   - decoration system
   - composition and background
   - what should and should not be transferred
3. If exact display text is missing, infer the shortest likely Chinese text from the theme. State the assumption.
4. Infer audience, mood, cultural symbols, and visual taboos.
5. If the user gives an explicit style, preserve it as a primary constraint unless it makes the Chinese text unreadable.
6. Merge reference image style, user style, theme, and use case into Chinese lettering rules:
   - character structure
   - stroke shape
   - material
   - color distribution
   - decoration
   - composition
7. Build an internal gpt-image2 image brief that protects:
   - exact Chinese text
   - accurate characters
   - legibility
   - no extra words
   - no pseudo-Chinese glyphs
   - text as the main subject
8. Unless the user explicitly asks for text output only, call the available image-generation tool using that brief.
9. If the user gives a generated result or complaint, critique the failure mode and either regenerate with a corrected brief or output a revised prompt if requested.

## Reference Selection

Read only the files needed for the current request:

- `references/intent-inference.md`: short or vague user inputs, missing text, theme/use-case/style detection.
- `references/theme-map.md`: holidays, seasons, campaigns, school events, cultural themes, and unknown-theme inference.
- `references/style-system.md`: explicit visual styles such as handwritten, cute, ink, cyberpunk, metallic, glass, paper-cut, retro, luxury, game title, and poster title.
- `references/reference-image-analysis.md`: uploaded reference image analysis and style transfer into new Chinese lettering.
- `references/user-language-map.md`: casual phrases such as "高级一点", "可爱一点", "别太土", "像 logo", "更炸裂".
- `references/stroke-transformation.md`: Chinese character structure and stroke transformation rules.
- `references/image-generation-templates.md`: internal image brief templates, prompt-only output formats, and direct generation patterns.
- `references/critique-and-revision.md`: diagnose generated outputs, revise briefs, and regenerate.

## Default Response Behavior

When the user asks for an image or gives a normal design request:

1. Briefly state the understood direction in Chinese if useful.
2. Generate the image directly with the available image-generation tool.
3. Do not expose the full internal prompt unless the user asks for it.

When the user asks for options before generating, provide 2-3 concise directions and wait for selection.

When the user asks for a prompt, answer in Chinese with:

```markdown
## 需求理解
- 文字：
- 类型：
- 风格：
- 情绪：
- 受众：

## gpt-image2 Prompt
...
```

If the user asks for only the prompt, output only the prompt and no explanation.

## Non-Negotiable Image Brief Constraints

Always include these ideas in the internal image brief, adapted naturally:

- Use the exact Chinese text.
- Chinese characters must be accurate, legible, and the main subject.
- Do not add extra words, English text, random symbols, or pseudo-Chinese glyphs.
- Decorations must support the characters and must not cover, replace, or distort them.
- Keep the composition readable at thumbnail size unless the user explicitly wants experimental abstraction.
- Make the style visible through character construction, material, color distribution, and edge treatment, not only through background decoration.
- If the direction is cheerful, cute, children's, festival, pop, or sticker-like, avoid monochrome lettering unless the user explicitly asks for monochrome. Assign distinct but harmonious colors to different characters, strokes, outlines, shadows, or sticker layers.

## Style Handling

Theme controls semantic symbols and mood.
Style controls stroke shape, material, edge treatment, and visual texture.
Use case controls layout, complexity, and how much background is allowed.
Reference images control observable visual traits, not text content. Transfer style principles; do not copy irrelevant words, logos, or accidental artifacts from the reference.

Examples:

- `儿童节 + 手写`: rounded marker/crayon strokes, bright pastel color, warm childlike rhythm, balloons or stars.
- `中秋 + 水墨`: soft brush texture, moonlight, osmanthus, paper grain, restrained composition.
- `科技发布会 + 玻璃`: geometric Chinese characters, translucent glass material, cold rim light, clean stage-title layout.
- `恐怖片 + 可爱`: treat as deliberate contrast; make it strange-cute or dark fairy-tale, not ordinary children's cuteness.

## Avoid

- Do not write generic prompts like "beautiful Chinese typography".
- Do not use a single vague color phrase when the style needs richness. Specify how colors are distributed.
- Do not overfit to one theme list. Use inference rules for unseen themes.
- Do not let material effects destroy the Chinese character skeleton.
- Do not recommend complete font production workflows unless the user explicitly asks for font files or typeface engineering.

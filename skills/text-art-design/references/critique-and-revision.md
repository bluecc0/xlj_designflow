# Critique and Revision

When the user provides a generated image or feedback, diagnose the failure mode before regenerating or rewriting the prompt.

## Diagnostic Categories

Text accuracy:
- wrong character
- missing character
- extra character
- pseudo-Chinese glyph
- English or random text added

Legibility:
- overdecorated strokes
- low contrast
- too much transparency
- background interference
- fragmented structure

Style mismatch:
- too childish
- too dark
- not premium
- not handwritten enough
- too generic
- not Chinese enough

Composition:
- text too small
- title not centered
- background dominates
- too many props
- logo requested but poster generated

Material failure:
- cheap 3D bevel
- excessive glow
- muddy colors
- all characters collapsed into one color when a cheerful or pop direction needs color variation
- inconsistent lighting
- random particles

## Revision Patterns

If characters are wrong:
- Put exact text at the beginning and near the end.
- Add "only these Chinese characters".
- Add "no extra words, no misspelled Chinese characters, no pseudo-Chinese symbols".
- Reduce complexity and decorations.

If text is unreadable:
- Add "front-facing flat readable Chinese lettering".
- Add "clear silhouette and accurate radicals".
- Reduce texture, particles, glow, and background.

If style is too generic:
- Add explicit stroke transformations.
- Add one material system.
- Add theme-specific symbols integrated into strokes.
- Add "designed lettering, not ordinary typed font".

If result is too messy:
- Reduce color count.
- Use clean background.
- Limit decorations to edges and negative spaces.
- Use one dominant material.

If result is too monochrome or lacks style:
- Add explicit color distribution per character or per stroke group.
- Add colored outlines, sticker backing layers, drop shadows, or two-tone fills.
- Strengthen material words such as crayon grain, marker overlap, paper sticker edge, glossy jelly, or layered paper.
- State "avoid one-color lettering" for cheerful, cute, pop, children's, and festival designs.

If result is not premium:
- Remove cute props and heavy effects.
- Use fewer colors.
- Increase negative space.
- Use subtle foil, embossing, glass, silk, lacquer, or paper texture.

If result is not cute enough:
- Round terminals.
- Increase softness and brightness.
- Use sticker, candy, plush, marker, or crayon material.
- Add small friendly motifs.

If background steals attention:
- Request minimal clean background.
- State text is the main subject.
- Remove scene details.

## Revision Response Shape

```markdown
## 问题判断
最主要的问题是...

## 修正策略
1. ...
2. ...
3. ...

然后直接重新生成图片，除非用户明确要 revised prompt。
```

If the user asks "改 prompt", output the revised prompt directly after one short diagnosis sentence. If the user asks "重新生成", call the image-generation tool with a corrected brief.

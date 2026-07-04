# Intent Inference

The user's request is often incomplete. Infer missing context, but state assumptions when they affect the displayed text or visual direction.

## Input Types

Classify the request into one or more types:

- Exact text: the words that must appear in the image, often in quotes.
- Theme or occasion: 儿童节, 春节, 端午, 开学季, 毕业季, 周年庆.
- Use case: 海报, logo, 字标, 包装, 游戏标题, 社媒封面, 活动主视觉.
- Explicit style: 手写, 水墨, 赛博, 玻璃, 金属, 剪纸, 复古.
- Emotional tone: 温馨, 可爱, 高级, 热血, 神秘, 恐怖, 梦幻.
- Reference object: "像某游戏", "港风", "电影感", "小朋友画的".
- Revision feedback: 字不清楚, 太土, 不够高级, 太花, 错字, 背景抢主体.

## Missing Text Defaults

If the user gives a theme but no exact text:

- Use the theme itself as the default display text.
- Keep the text short.
- Example: "儿童节主题" -> exact text "儿童节".
- Example: "端午海报" -> exact text "端午".
- Example: "开学季活动" -> exact text "开学季".

If the user gives a product category but no brand text, ask for the exact text unless a placeholder would be harmless.

## Inference Chain

For vague inputs, infer in this order:

1. Theme or occasion.
2. Audience.
3. Mood.
4. Use case.
5. Style if explicit; otherwise infer likely style.
6. Character treatment.
7. Material and decoration.
8. Composition and background.
9. Negative constraints.

## Conflict Handling

Some combinations are naturally tense. Do not reject them; resolve them.

- 儿童节 + 赛博: make it playful neon, rounded tech, toy-like cyber, not dark dystopia.
- 儿童节 + 国潮: use folk toys, kites, paper-cut clouds, cloth tiger colors, not heavy imperial luxury.
- 科技发布会 + 手写: make it a futuristic signature mark or human-centered tech, not childish scribble.
- 恐怖片 + 可爱: make it dark fairy-tale or strange-cute, not ordinary warm children's style.
- 奢侈品牌 + 可爱: make it soft luxury, restrained pastel, premium material, not busy cartoon.

## Broad Theme Response

When the theme is broad and the user appears to want ideation before image generation, offer 2-3 directions:

- safe/default direction
- more distinctive direction
- more commercial or more experimental direction

If the user asks for direct image generation, choose the strongest default direction and generate.

If the user asks for direct prompt output, skip directions and output the prompt.

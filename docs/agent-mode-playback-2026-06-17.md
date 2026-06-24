# Agent Mode Playback Test - 2026-06-17

说明：本轮是逻辑级完整回放，不调用真实外部 LLM/生图接口；`simulated_agent_patch` 代表当前架构下我们期望 Intent Parser 给出的结果。

## 01_first_turn_cover_confirm
- 目标：首轮用户描述后，Agent 应该先整理方向并进入 CONFIRM，而不是直接生图。
- 用户输入：`我想做一个小红书的封面海报，竖版3:4，人物封面海报，女性主题，文案“女性力量，放眼未来”`
- 兜底约束提取：`{"copyText": "女性力量，放眼未来", "aspectRatio": "3:4", "useCase": "封面 / 海报", "platform": "小红书", "subject": "人物", "composition": "竖版构图，人物封面构图，3:4 画幅"}`
- 模拟 Agent 返回 patch：`{"turn_type": "add_detail", "target_image_id": null, "target_region": "whole_image", "operation_hint": "text_to_image", "patch": {"subject": "人物", "platform": "小红书", "useCase": "封面", "aspectRatio": "3:4", "style": "简约高级", "mood": "女性力量，放眼未来", "copyText": "女性力量，放眼未来", "composition": "竖版构图，留白构图"}, "preserve": [], "change": [], "avoid": [], "assumptions": [], "missing_critical_info": [], "confidence": 0.88, "creative_suggestion": "可以先走克制高级的人物封面方向。"}`
- 状态前：`{"intent": {}, "brief": null, "currentImage": null, "metadata": {}}`
- 状态后：`{"intent": {"subject": "人物", "platform": "小红书", "useCase": "封面 / 海报", "composition": "竖版构图，人物封面构图，3:4 画幅", "style": "简约高级", "mood": "女性力量，放眼未来", "copyText": "女性力量，放眼未来", "aspectRatio": "3:4"}, "brief": null, "currentImage": null, "metadata": {}}`
- Decision Engine 输出：`{"type": "CONFIRM", "brief": {"concept": "人物，简约高级，女性力量，放眼未来", "visualElements": ["人物", "竖版构图，人物封面构图，3:4 画幅", "女性力量，放眼未来", "3:4"], "platform": "小红书", "targetAudience": "", "style": "简约高级", "mood": "女性力量，放眼未来", "colorDirection": "", "copyText": "女性力量，放眼未来", "aspectRatio": "3:4", "confirmedByUser": false}, "completeness": {"score": 94.0, "critical_gaps": [], "inferrable_gaps": ["scene", "camera", "colorPalette", "lighting", "targetAudience"], "can_generate": true}, "quickActions": [{"label": "确认，开始生成", "value": "确认，开始生成"}, {"label": "强化文案张力", "value": "换个方向：保留文案“女性力量，放眼未来”，让文字成为画面核心视觉之一，排版更有封面张力"}, {"label": "未来感更明确", "value": "换个方向：保留人物，封面 / 海报，3:4，女性力量，放眼未来，强化未来感材质、冷光和空间纵深，但不要偏科幻杂乱"}], "operationReadiness": {"executable": true, "missing_requirements": [], "required_capability": "text_to_image"}}`
- 与预估一致：
  - 状态里成功沉淀了 subject/platform/useCase/aspectRatio/style/mood/copyText。
  - 决策结果是 CONFIRM，说明不会在首轮直接跳过确认。
- 脱离预估：
  - 本轮未发现明显偏离

## 02_confirm_then_generate
- 目标：用户确认后，应进入 GENERATE，并产出完整 generationInstruction。
- 用户输入：`确认，开始生成`
- 兜底约束提取：`{}`
- 模拟 Agent 返回 patch：`{"turn_type": "confirm", "target_image_id": null, "target_region": "whole_image", "operation_hint": "text_to_image", "patch": {}, "preserve": [], "change": [], "avoid": [], "assumptions": [], "missing_critical_info": [], "confidence": 1.0, "creative_suggestion": ""}`
- 状态前：`{"intent": {"subject": "人物", "platform": "小红书", "useCase": "封面 / 海报", "composition": "竖版构图，人物封面构图，3:4 画幅", "style": "简约高级", "mood": "女性力量，放眼未来", "copyText": "女性力量，放眼未来", "aspectRatio": "3:4"}, "brief": null, "currentImage": null, "metadata": {}}`
- 状态后：`{"intent": {"subject": "人物", "platform": "小红书", "useCase": "封面 / 海报", "composition": "竖版构图，人物封面构图，3:4 画幅", "style": "简约高级", "mood": "女性力量，放眼未来", "copyText": "女性力量，放眼未来", "aspectRatio": "3:4"}, "brief": null, "currentImage": null, "metadata": {}}`
- Decision Engine 输出：`{"type": "GENERATE", "prompt": {"mode": "text_to_image", "model": "gpt image 2", "instruction": "Create a 3:4 image with 人物 as the clear main subject. The intended use is 封面 / 海报. Target publishing context: 小红书. Use 竖版构图，人物封面构图，3:4 画幅. Visual style: 简约高级. Overall mood: 女性力量，放眼未来. Include the exact Chinese text \"女性力量，放眼未来\" clearly in the composition. Helpful visual execution cues: premium editorial portrait poster, single clear hero subject, vertical cover composition, minimal high-end layout, clean background with intentional copy space, no product placement", "constraints": {"mustInclude": [], "avoid": [], "preserve": []}, "parameters": {"aspectRatio": "3:4", "size": "3:4", "resolution": ""}, "reasoningForUser": "我会先按「人物封面海报」方向执行，但主体和文案以你刚确认的要求为准。", "positive": "人物, 封面 / 海报, 小红书, 竖版构图，人物封面构图，3:4 画幅, 3:4, 简约高级, 女性力量，放眼未来, include exact Chinese title text \"女性力量，放眼未来\", premium editorial portrait poster, single clear hero subject, vertical cover composition, minimal high-end layout, clean background with intentional copy space, no product placement, masterpiece, best quality, highly detailed", "negative": "product advertisement, cosmetics jar, skincare bottle, product packaging, perfume bottle, skincare ad, cosmetics ad, commercial product packshot, brand logo, luxury brand name, Chanel, Dior, product placement, cluttered, amateur, casual snapshot, messy background, low quality, watermark", "promptReasoning": "使用 gpt image 2 文生图，匹配到「人物封面海报」场景模板。"}, "brief": {"concept": "人物，简约高级，女性力量，放眼未来", "visualElements": ["人物", "竖版构图，人物封面构图，3:4 画幅", "女性力量，放眼未来", "3:4"], "platform": "小红书", "targetAudience": "", "style": "简约高级", "mood": "女性力量，放眼未来", "colorDirection": "", "copyText": "女性力量，放眼未来", "aspectRatio": "3:4", "confirmedByUser": false}, "completeness": {"score": 94.0, "critical_gaps": [], "inferrable_gaps": ["scene", "camera", "colorPalette", "lighting", "targetAudience"], "can_generate": true}, "operationReadiness": {"executable": true, "missing_requirements": [], "required_capability": "text_to_image"}}`
- Generation Instruction：`{"instruction": "Create a 3:4 image with 人物 as the clear main subject. The intended use is 封面 / 海报. Target publishing context: 小红书. Use 竖版构图，人物封面构图，3:4 画幅. Visual style: 简约高级. Overall mood: 女性力量，放眼未来. Include the exact Chinese text \"女性力量，放眼未来\" clearly in the composition. Helpful visual execution cues: premium editorial portrait poster, single clear hero subject, vertical cover composition, minimal high-end layout, clean background with intentional copy space, no product placement", "constraints": {"mustInclude": [], "avoid": [], "preserve": []}, "parameters": {"aspectRatio": "3:4", "size": "3:4", "resolution": ""}, "reasoningForUser": "我会先按「人物封面海报」方向执行，但主体和文案以你刚确认的要求为准。"}`
- 与预估一致：
  - 决策结果是 GENERATE。
  - 带出了 instruction/constraints/parameters。
- 脱离预估：
  - 本轮未发现明显偏离

## 03_automotive_not_portrait
- 目标：汽车发售海报不应被误导到人物封面模板。
- 用户输入：`我想做一张新款汽车发售海报，9:16，竖版构图，公路场景，电影感，文案“未来已来”，不要人物抢主体，要有整车主体和标题区留白`
- 兜底约束提取：`{"copyText": "未来已来", "aspectRatio": "9:16", "useCase": "海报", "subject": "汽车", "composition": "竖版构图，留白构图，9:16 画幅", "scene": "公路场景", "style": "电影感大片风格", "mustInclude": "整车主体和标题区留白", "avoid": "人物抢主体"}`
- 模拟 Agent 返回 patch：`{"turn_type": "add_detail", "target_image_id": null, "target_region": "whole_image", "operation_hint": "text_to_image", "patch": {"subject": "汽车", "scene": "公路场景", "platform": "小红书 / 抖音", "targetAudience": "年轻人", "useCase": "发售海报", "composition": "竖版构图，留白构图", "camera": "低机位广角", "aspectRatio": "9:16", "style": "电影感大片风格", "mood": "动感，临场感", "colorPalette": "黄昏夕阳下的温暖金色调", "copyText": "未来已来", "mustInclude": "整车主体，标题区留白", "avoid": "人物抢主体，杂乱背景"}, "preserve": [], "change": [], "avoid": [], "assumptions": [], "missing_critical_info": [], "confidence": 0.9, "creative_suggestion": ""}`
- 状态前：`{"intent": {}, "brief": null, "currentImage": null, "metadata": {}}`
- 状态后：`{"intent": {"subject": "汽车", "scene": "公路场景", "platform": "小红书 / 抖音", "targetAudience": "年轻人", "useCase": "海报", "composition": "竖版构图，留白构图，9:16 画幅", "camera": "低机位广角", "style": "电影感大片风格", "mood": "动感，临场感", "colorPalette": "黄昏夕阳下的温暖金色调", "copyText": "未来已来", "aspectRatio": "9:16", "mustInclude": "整车主体和标题区留白", "avoid": "人物抢主体"}, "brief": null, "currentImage": null, "metadata": {}}`
- Decision Engine 输出：`{"type": "CONFIRM", "brief": {"concept": "汽车，公路场景，电影感大片风格，动感，临场感", "visualElements": ["汽车", "公路场景", "竖版构图，留白构图，9:16 画幅", "低机位广角"], "platform": "小红书 / 抖音", "targetAudience": "年轻人", "style": "电影感大片风格", "mood": "动感，临场感", "colorDirection": "黄昏夕阳下的温暖金色调", "copyText": "未来已来", "aspectRatio": "9:16", "confirmedByUser": false}, "completeness": {"score": 100.0, "critical_gaps": [], "inferrable_gaps": ["lighting"], "can_generate": true}, "quickActions": [{"label": "确认，开始生成", "value": "确认，开始生成"}, {"label": "强化文案张力", "value": "换个方向：保留文案“未来已来”，让文字成为画面核心视觉之一，排版更有封面张力"}, {"label": "速度感更强", "value": "换个方向：保留汽车，海报，9:16，未来已来，强化车身姿态、路面运动模糊和速度张力，让发售气势更强"}], "operationReadiness": {"executable": true, "missing_requirements": [], "required_capability": "text_to_image"}}`
- 与预估一致：
  - 状态里有 subject=汽车、scene=公路场景、camera=低机位广角。
  - 应该先走 CONFIRM，再等用户确认。
- 脱离预估：
  - 本轮未发现明显偏离

## 04_refine_without_image
- 目标：没有当前图时，用户说“改一下背景”不应直接 REFINE。
- 用户输入：`背景改成海边，人物别变`
- 兜底约束提取：`{"scene": "海边场景"}`
- 模拟 Agent 返回 patch：`{"turn_type": "revise_image", "target_image_id": null, "target_region": "whole_image", "operation_hint": "variation", "patch": {}, "preserve": [], "change": ["背景改成海边"], "avoid": [], "assumptions": [], "missing_critical_info": [], "confidence": 0.72, "creative_suggestion": ""}`
- 状态前：`{"intent": {}, "brief": null, "currentImage": null, "metadata": {}}`
- 状态后：`{"intent": {"scene": "海边场景", "mustInclude": "背景改成海边"}, "brief": null, "currentImage": null, "metadata": {"pendingEdit": {"targetImageId": null, "targetRegion": "whole_image", "operationHint": "variation", "preserve": [], "change": ["背景改成海边"], "avoid": []}}}`
- Decision Engine 输出：`{"type": "ASK", "question": "我可以继续细修，但当前还没有可继承的图。要不要先确定方向并生成第一版？", "dimension": "current_image", "choices": [], "operationReadiness": {"executable": false, "missing_requirements": ["current_image"], "required_capability": "variation"}}`
- 与预估一致：
  - 决策结果是 ASK，不会假装有基础图去细修。
- 脱离预估：
  - 本轮未发现明显偏离

## 05_refine_with_current_image
- 目标：已有当前图且 VLM 给了 refine 建议时，Agent 应能自动补齐 preserve/change/avoid 并进入 REFINE。
- 用户输入：`可以，背景更有速度线一点，标题更清楚`
- 兜底约束提取：`{}`
- 模拟 Agent 返回 patch：`{"turn_type": "revise_image", "target_image_id": null, "target_region": "background", "operation_hint": "variation", "patch": {}, "preserve": ["车身主体", "版式方向"], "change": ["背景更有速度线", "标题识别更强"], "avoid": ["人物抢主体", "背景太杂"], "assumptions": [], "missing_critical_info": [], "confidence": 0.7, "creative_suggestion": ""}`
- 状态前：`{"intent": {"subject": "汽车", "scene": "公路场景", "platform": "小红书 / 抖音", "targetAudience": "年轻人", "useCase": "海报", "composition": "竖版构图，留白构图，9:16 画幅", "camera": "低机位广角", "style": "电影感大片风格", "mood": "动感，临场感", "colorPalette": "黄昏夕阳下的温暖金色调", "copyText": "未来已来", "aspectRatio": "9:16", "mustInclude": "整车主体和标题区留白", "avoid": "人物抢主体"}, "brief": null, "currentImage": {"id": "img_demo_1", "imageUrl": "/ai-images/demo/current.png"}, "metadata": {"suggestedRefine": {"targetRegion": "background", "preserve": ["车身主体", "版式方向"], "change": ["背景更有速度线", "标题识别更强"], "avoid": ["人物抢主体", "背景太杂"], "suggestion": "可以基于这版微调"}}}`
- 状态后：`{"intent": {"subject": "汽车", "scene": "公路场景", "platform": "小红书 / 抖音", "targetAudience": "年轻人", "useCase": "海报", "composition": "竖版构图，留白构图，9:16 画幅", "camera": "低机位广角", "style": "电影感大片风格", "mood": "动感，临场感", "colorPalette": "黄昏夕阳下的温暖金色调", "copyText": "未来已来", "aspectRatio": "9:16", "mustInclude": "整车主体和标题区留白", "avoid": "人物抢主体"}, "brief": null, "currentImage": {"id": "img_demo_1", "imageUrl": "/ai-images/demo/current.png"}, "metadata": {"pendingEdit": {"targetImageId": null, "targetRegion": "background", "operationHint": "variation", "preserve": ["车身主体", "版式方向"], "change": ["背景更有速度线", "标题识别更强"], "avoid": ["人物抢主体", "背景太杂"]}, "suggestedRefine": {"targetRegion": "background", "preserve": ["车身主体", "版式方向"], "change": ["背景更有速度线", "标题识别更强"], "avoid": ["人物抢主体", "背景太杂"], "suggestion": "可以基于这版微调"}}}`
- Decision Engine 输出：`{"type": "REFINE", "prompt": {"mode": "variation", "positive": "汽车, 公路场景, 海报, 小红书 / 抖音, 年轻人, 竖版构图，留白构图，9:16 画幅, 9:16, 低机位广角, 电影感大片风格, 动感，临场感, 黄昏夕阳下的温暖金色调, include exact Chinese title text \"未来已来\", 整车主体和标题区留白, cinematic automotive key visual, vehicle as the unmistakable main subject, dynamic road scene or launch-stage atmosphere, premium commercial lighting, strong sense of motion and scale, clean title area for typography, masterpiece, best quality, highly detailed, keep overall composition and subject consistency, refine with: 可以，背景更有速度线一点，标题更清楚, preserve: 车身主体, 版式方向, focus adjustments on background: 背景更有速度线, 标题识别更强", "negative": "person as sole hero subject, cosmetics product, skincare packaging, perfume bottle, fashion portrait replacing the vehicle, cluttered layout, watermark, low quality, 人物抢主体, 人物抢主体, 背景太杂", "model": "nano banana pro", "instruction": "Create a refined new version based on the current image. Focus on background. Keep: 车身主体, 版式方向. Change: 背景更有速度线, 标题识别更强. Avoid: 人物抢主体, 背景太杂. Additional user feedback: 可以，背景更有速度线一点，标题更清楚", "constraints": {"mustInclude": ["背景更有速度线", "标题识别更强"], "avoid": ["人物抢主体", "背景太杂"], "preserve": ["车身主体", "版式方向"]}, "parameters": {"aspectRatio": "9:16", "size": "9:16", "resolution": ""}, "reasoningForUser": "我会基于当前版本保留满意部分，只把你点到的区域继续细修。", "promptReasoning": "使用 nano banana pro 在保留现有画面核心主体的基础上按用户反馈迭代。"}, "operationReadiness": {"executable": true, "missing_requirements": [], "required_capability": "variation"}}`
- Generation Instruction：`{"instruction": "Create a refined new version based on the current image. Focus on background. Keep: 车身主体, 版式方向. Change: 背景更有速度线, 标题识别更强. Avoid: 人物抢主体, 背景太杂. Additional user feedback: 可以，背景更有速度线一点，标题更清楚", "constraints": {"mustInclude": ["背景更有速度线", "标题识别更强"], "avoid": ["人物抢主体", "背景太杂"], "preserve": ["车身主体", "版式方向"]}, "parameters": {"aspectRatio": "9:16", "size": "9:16", "resolution": ""}, "reasoningForUser": "我会基于当前版本保留满意部分，只把你点到的区域继续细修。"}`
- 与预估一致：
  - pendingEdit 自动吸收了 suggestedRefine。
  - 决策结果是 REFINE。
- 脱离预估：
  - 本轮未发现明显偏离

## 06_new_topic_reset
- 目标：开启新话题应清理旧方向，而不是继承旧汽车项目状态。
- 用户输入：`我们换个话题，做一张小红书人物封面，3:4，简约高级`
- 兜底约束提取：`{"aspectRatio": "3:4", "useCase": "封面", "platform": "小红书", "subject": "人物", "composition": "人物封面构图，3:4 画幅", "style": "简约高级"}`
- 模拟 Agent 返回 patch：`{"turn_type": "create_new", "target_image_id": null, "target_region": "whole_image", "operation_hint": "text_to_image", "patch": {"subject": "人物", "platform": "小红书", "useCase": "封面", "aspectRatio": "3:4", "style": "简约高级"}, "preserve": [], "change": [], "avoid": [], "assumptions": [], "missing_critical_info": [], "confidence": 0.8, "creative_suggestion": ""}`
- 状态前：`{"intent": {"subject": "汽车", "scene": "公路场景", "platform": "小红书 / 抖音", "targetAudience": "年轻人", "useCase": "海报", "composition": "竖版构图，留白构图，9:16 画幅", "camera": "低机位广角", "style": "电影感大片风格", "mood": "动感，临场感", "colorPalette": "黄昏夕阳下的温暖金色调", "copyText": "未来已来", "aspectRatio": "9:16", "mustInclude": "整车主体和标题区留白", "avoid": "人物抢主体"}, "brief": {"concept": "旧汽车方向", "confirmedByUser": true}, "currentImage": {"id": "img_demo_1", "imageUrl": "/ai-images/demo/current.png"}, "metadata": {"pendingEdit": {"targetImageId": null, "targetRegion": "background", "operationHint": "variation", "preserve": ["车身主体", "版式方向"], "change": ["背景更有速度线", "标题识别更强"], "avoid": ["人物抢主体", "背景太杂"]}, "suggestedRefine": {"targetRegion": "background", "preserve": ["车身主体", "版式方向"], "change": ["背景更有速度线", "标题识别更强"], "avoid": ["人物抢主体", "背景太杂"], "suggestion": "可以基于这版微调"}}}`
- 状态后：`{"intent": {"subject": "人物", "platform": "小红书", "useCase": "封面", "composition": "人物封面构图，3:4 画幅", "style": "简约高级", "aspectRatio": "3:4"}, "brief": null, "currentImage": null, "metadata": {}}`
- Decision Engine 输出：`{"type": "CONFIRM", "brief": {"concept": "人物，简约高级", "visualElements": ["人物", "人物封面构图，3:4 画幅", "3:4"], "platform": "小红书", "targetAudience": "", "style": "简约高级", "mood": "", "colorDirection": "", "copyText": "", "aspectRatio": "3:4", "confirmedByUser": false}, "completeness": {"score": 82.0, "critical_gaps": [], "inferrable_gaps": ["scene", "mood", "camera", "colorPalette", "lighting", "targetAudience"], "can_generate": true}, "quickActions": [{"label": "确认，开始生成", "value": "确认，开始生成"}, {"label": "未来冷光封面", "value": "换个方向：保留人物，封面，3:4，加入冷色未来光效和更锋利的竖版构图，避免商品广告感"}, {"label": "极简留白封面", "value": "换个方向：保留人物，封面，3:4，做极简留白人物封面，减少装饰，把情绪和标题作为视觉核心"}], "operationReadiness": {"executable": true, "missing_requirements": [], "required_capability": "text_to_image"}}`
- 与预估一致：
  - 旧 brief/currentImage/currentPrompt 被清掉。
  - 新状态重新落到人物封面方向。
- 脱离预估：
  - 本轮未发现明显偏离

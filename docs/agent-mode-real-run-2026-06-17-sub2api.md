# Agent Mode Real Run - 2026-06-17 - Sub2API

说明：本轮为真实链路测试。
- Agent 意图解析：真实调用当前配置的 Agent LLM
- 生图执行：强制切换到 `sub2api` 订阅线路
- 测试方式：直接调用后端核心函数，不经过前端 UI

## 测试输入
`我想做一张新款汽车发售海报，竖版9:16，公路场景，文案“未来已来”，整车主体，不要人物抢主体`

## 运行时配置
- 原默认 provider：`apimart`
- 本次测试 provider：`sub2api`
- Agent LLM：`Qwen/Qwen2.5-72B-Instruct`
- 文生图模型：`gpt image 2`
- 图生图模型：`nano banana pro`

## 1. 兜底约束提取
```json
{
  "copyText": "未来已来",
  "aspectRatio": "9:16",
  "useCase": "海报",
  "subject": "汽车",
  "composition": "竖版构图，9:16 画幅",
  "scene": "公路场景",
  "avoid": "人物抢主体"
}
```

评估：符合预期，至少没有再掉进“女性人物封面海报”的老坑里。

## 2. Agent 首轮真实返回
```text
明白了，新款汽车发售的海报，竖版9:16的比例，公路场景作为背景，整车是主体，文案是“未来已来”，并且不希望有人物出现来抢主体。这样可以确保汽车成为焦点。
```

真实 intent patch：
```json
{
  "turn_type": "add_detail",
  "operation_hint": "text_to_image",
  "patch": {
    "subject": "新款汽车",
    "scene": "公路",
    "composition": "整车主体",
    "useCase": "发售海报",
    "copyText": "未来已来",
    "aspectRatio": "9:16",
    "mustInclude": "新款汽车",
    "avoid": "人物"
  },
  "confidence": 0.9
}
```

评估：
- 一致的地方：主体、场景、比例、文案、避免人物，都抓到了。
- 偏离的地方：
  - `style / mood / camera / lighting / platform / targetAudience` 全空。
  - `composition` 被 LLM 写成了“整车主体”，不够像构图字段，更像主体约束。
  - 没有给出任何真正有帮助的创意拓展。

结论：Parser 还算没跑偏，但创造性和结构质量偏弱。

## 3. 首轮决策
决策结果：`CONFIRM`

评估：符合预期。
Agent 没有首轮就直接偷跑生图，这一点是对的。

## 4. 用户确认后
确认语：`确认，开始生成`

系统走了 direct-generate shortcut：`should_direct_generate = true`

评估：符合预期。

## 5. 最终 generation instruction
```text
Create a 9:16 image with 汽车 as the clear main subject. The intended use is 海报. Scene direction: 公路场景. Use 竖版构图，9:16 画幅. Include the exact Chinese text "未来已来" clearly in the composition. Must include: 新款汽车. Helpful visual execution cues: cinematic automotive key visual, vehicle as the unmistakable main subject, dynamic road scene or launch-stage atmosphere, premium commercial lighting, strong sense of motion and scale, clean title area for typography
```

约束：
```json
{
  "mustInclude": ["新款汽车"],
  "avoid": ["人物抢主体"],
  "preserve": []
}
```

参数：
```json
{
  "aspectRatio": "9:16",
  "size": "9:16",
  "resolution": ""
}
```

评估：
- 一致的地方：已经是汽车海报，不是人物海报。
- 偏离的地方：
  - 指令还是偏泛，不够“发售海报化”。
  - 没有把“新款发布/上市”这种商业语义强化到版式、主视觉和品牌事件感。
  - 没有明确“标题区留白”这一类更具体的版式约束。

## 6. Sub2API 真实生图事件
```json
[
  {"event": "generation_started", "payload": {"jobId": null, "estimatedSeconds": 45}},
  {"event": "generation_progress", "payload": {"progress": 0}},
  {"event": "generation_progress", "payload": {"progress": 100}},
  {"event": "generation_completed", "payload": {
    "jobId": "task_01KVA76CVD9Y51W9Z5W58YAZKQ",
    "image": {
      "id": "task_01KVA76CVD9Y51W9Z5W58YAZKQ",
      "url": "/ai-images/admin/6698de195552423c8c93217e9712834f.png"
    }
  }}
]
```

评估：
- 生图真实成功。
- 说明 `sub2api` 渠道能被 Agent 模式实际调用。
- SSE 进度很粗，基本只有 0 和 100，没有中间态。

## 7. 实际结果图评估
输出图路径：`/Users/xuduo/Documents/xlj_designflow/output/ai-images/admin/6698de195552423c8c93217e9712834f.png`

主观评估：
- 这次结果总体是对题的。
- 车是绝对主体，没有人物抢主体。
- 画面是公路场景，竖版比例成立。
- 标题“未来已来”也被生成出来了。

但问题仍然存在：
- 更像“汽车 KV / 视觉海报”，还不够像“新款发售海报”。
- 缺少明确的发布信息结构，比如发布日期、卖点区、品牌事件感。
- 文案区虽然大，但没有被组织成更成熟的发售视觉系统。

## 8. 本轮最重要的结论
1. Agent 真实链路已经可以跑通。
2. `sub2api` 订阅线路已经可以被 Agent 生图真实调用。
3. 当前最大的短板，不是“完全跑错题材”，而是：
   - 创意方案层太弱
   - 结构化 patch 还不够强
   - generation instruction 还不够商业化、版式化
4. 这意味着我们已经过了“完全不能测”的阶段，但离“可交付、可依赖”的 Agent 还有明显距离。

## 9. 顺手修掉的小问题
测试中发现一个链路一致性 bug：
- 图片真实走的是 `sub2api`
- 但 Agent 图片落库时 provider 还写死成 `apimart`

已修复：现在会把真实生成结果里的 provider 一路带到 `agent_images` 记录中。

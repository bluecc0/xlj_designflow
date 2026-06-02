# 02 · Agent System Design

## 1. 整体架构

```
┌─────────────────────────────────────────────────────┐
│                      用户                            │
└───────────────────────┬─────────────────────────────┘
                        │ 自然语言输入
┌───────────────────────▼─────────────────────────────┐
│                    Chat UI                           │
│  • 流式输出渲染        • 图片展示                     │
│  • 对话历史           • Creative Brief 卡片           │
└───────────────────────┬─────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────┐
│                   LLM Agent                          │
│  • 意图理解           • 创意协作                      │
│  • 主动提案           • 对话管理                      │
│  输出：Action Intent + 对话内容                       │
└───────────────────────┬─────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────┐
│                Decision Engine                       │
│  • 信息完整度评估      • 动态决策                     │
│  • Gap 分析           • 行动路由                      │
│  输出：Action（ASK / EXPLORE / CONFIRM / GENERATE）   │
└──────┬──────────────────────────────────┬────────────┘
       │                                  │
┌──────▼──────┐                  ┌────────▼───────────┐
│Project State│◄─────────────────│   State Manager    │
│  (持久化)   │                  │  • 读写 State       │
│             │                  │  • 压缩历史          │
└─────────────┘                  │  • 维护 Brief       │
                                 └────────────────────┘
                                          │
                                 ┌────────▼───────────┐
                                 │   Prompt Builder   │
                                 │  • 意图 → prompt    │
                                 │  • 风格词注入        │
                                 │  • 参数决策          │
                                 └────────┬───────────┘
                                          │
                                 ┌────────▼───────────┐
                                 │   Image Provider   │
                                 │  • FAL / Replicate │
                                 │  • 抽象接口          │
                                 │  • 重试 / 降级       │
                                 └────────┬───────────┘
                                          │
                                 ┌────────▼───────────┐
                                 │    VLM Critic      │
                                 │  • 质量评估          │
                                 │  • 反馈解析          │
                                 │  • 迭代 diff        │
                                 └────────┬───────────┘
                                          │
                                       图片 + 分析结果
                                          │
                                       返回用户
```

---

## 2. 各层详细设计

### 2.1 LLM Agent

**职责：** 纯粹的"对话大脑"，负责理解用户、创意协作、生成回复。不做决策，不调用图像 API。

**输入：**
- 用户当前消息
- 对话历史（压缩后）
- 当前 Project State 摘要
- Decision Engine 的上一次 Action 结果

**输出：**
- 对用户的自然语言回复（流式）
- 结构化的 Action Intent（告知 Decision Engine 下一步意图）

**Action Intent 结构：**
```typescript
interface ActionIntent {
  type: 'CONTINUE_CHAT' | 'REQUEST_GENERATE' | 'PRESENT_BRIEF' | 'REQUEST_REFINE'
  confidence: number          // 0-1，LLM 对当前信息充分度的自信程度
  extractedInfo: {            // 本轮从用户消息中提取的新信息
    style?: string
    subject?: string
    mood?: string
    useCase?: string
    colorPalette?: string
    [key: string]: any
  }
  openQuestions: string[]     // LLM 认为还需要澄清的点（可为空）
  creativeSuggestion?: string // 如果 LLM 有主动提案
}
```

**关键设计原则：**
- LLM 不直接触发生成，只表达"我觉得可以生成了"的意图
- 最终决定权在 Decision Engine
- LLM 的 System Prompt 中明确告知其角色边界

---

### 2.2 Decision Engine

**职责：** 系统的"神经中枢"，动态评估信息完整度，决定下一步行动。

详见 `03-Decision-Engine.md`

---

### 2.3 Project State

**职责：** 整个创作过程的持久化记忆，所有层都从这里读写状态。

```typescript
interface ProjectState {
  id: string
  userId: string
  createdAt: Date
  updatedAt: Date

  // 创意意图层
  intent: {
    useCase: string | null          // 用途：官网图/头像/插画/...
    subject: string | null          // 主体描述
    style: string | null            // 风格
    mood: string | null             // 情绪基调
    colorPalette: string[]          // 色彩方向
    composition: string | null      // 构图要求
    references: string[]            // 参考描述
    userAuthorizedFreedom: boolean  // 用户是否授权 LLM 自由发挥
  }

  // 对话层
  phase: ConversationPhase
  clarifiedPoints: string[]         // 已确认的要素
  pendingQuestions: string[]        // 待问的问题
  conversationSummary: string       // 压缩摘要（超过 N 轮后启用）

  // Creative Brief
  brief: {
    concept: string
    visualElements: string[]
    style: string
    mood: string
    colorDirection: string
    confirmedByUser: boolean
  } | null

  // 生成层
  currentPrompt: GenerationPrompt | null
  iterations: Iteration[]

  // 当前展示的图片
  currentImageUrl: string | null
  currentImageId: string | null
}

interface ConversationPhase {
  stage: 'exploring' | 'discussing' | 'confirming' | 'generating' | 'refining'
  turnsInStage: number
}

interface Iteration {
  id: string
  prompt: GenerationPrompt
  imageUrl: string
  vlmAnalysis: VLMAnalysis
  userFeedback: string | null
  diff: IterationDiff | null
  createdAt: Date
}

interface GenerationPrompt {
  positive: string
  negative: string
  model: string
  parameters: {
    aspectRatio: string
    steps?: number
    cfgScale?: number
    seed?: number
  }
}
```

---

### 2.4 Prompt Builder

**职责：** 将 Project State 中的意图信息转化为图像模型能理解的专业 prompt。

**处理流程：**

```
Project State.intent
       ↓
  1. 主体描述提取
       ↓
  2. 风格词扩展（查风格词库）
       ↓
  3. 质量词注入（masterpiece, 8k, highly detailed...）
       ↓
  4. 光线/氛围词补充
       ↓
  5. 负向词模板选择（根据风格匹配对应 negative）
       ↓
  6. 参数决策（尺寸/模型/步数/CFG）
       ↓
  GenerationPrompt
```

**风格词库示例（内置）：**
```typescript
const STYLE_TOKENS: Record<string, StyleTokens> = {
  'cyberpunk': {
    positive: ['cyberpunk', 'neon lights', 'rain-slicked streets', 'holographic displays', 'futuristic city'],
    negative: ['natural lighting', 'countryside', 'vintage'],
    recommendedModel: 'fal-ai/flux/dev',
    defaultRatio: '16:9'
  },
  'watercolor': {
    positive: ['watercolor painting', 'soft edges', 'paper texture', 'flowing colors', 'artistic'],
    negative: ['photorealistic', 'sharp edges', '3d render'],
    recommendedModel: 'fal-ai/flux/schnell',
    defaultRatio: '1:1'
  }
  // ...
}
```

---

### 2.5 Image Provider

**职责：** 图像生成服务的抽象层，屏蔽不同 Provider 的 API 差异。

```typescript
interface ImageProvider {
  generate(prompt: GenerationPrompt): Promise<GenerationResult>
  getStatus(jobId: string): Promise<JobStatus>
  getSupportedModels(): Model[]
}

interface GenerationResult {
  success: boolean
  imageUrl?: string
  imageBase64?: string
  jobId: string
  metadata: {
    model: string
    duration: number
    seed: number
  }
  error?: string
}

// FAL 实现
class FALProvider implements ImageProvider {
  async generate(prompt: GenerationPrompt): Promise<GenerationResult> {
    const result = await fal.run('fal-ai/flux/schnell', {
      input: {
        prompt: prompt.positive,
        negative_prompt: prompt.negative,
        image_size: this.mapAspectRatio(prompt.parameters.aspectRatio),
        num_inference_steps: prompt.parameters.steps ?? 4,
      }
    })
    return {
      success: true,
      imageUrl: result.images[0].url,
      jobId: result.requestId,
      metadata: { model: 'flux-schnell', duration: result.timings.inference, seed: result.seed }
    }
  }
}
```

**重试与降级策略：**
```
首次请求 → FAL FLUX Dev（质量优先）
  ↓ 失败或超时
重试 → FAL FLUX Schnell（速度优先）
  ↓ 失败
降级 → Replicate SDXL
  ↓ 失败
返回错误 + 提示用户
```

---

### 2.6 VLM Critic

**职责：** 生成后的视觉分析与反馈闭环。

**两种工作模式：**

**模式一：自动质量把关（生成后立即触发）**
```typescript
interface QualityCheck {
  passed: boolean
  score: number           // 0-100
  issues: {
    type: 'anatomy' | 'blur' | 'artifact' | 'intent_mismatch' | 'text_error'
    severity: 'critical' | 'minor'
    description: string
  }[]
  autoRetry: boolean      // 是否建议自动重试
}
```

**模式二：用户反馈解析（用户看图后的反馈）**
```typescript
interface IterationDiff {
  keep: string[]          // 保留的元素
  adjust: {
    element: string
    from: string
    to: string
  }[]
  regenerate: string[]    // 需要重新生成的部分
  promptDelta: {          // 对 prompt 的具体修改建议
    add: string[]
    remove: string[]
    modify: Record<string, string>
  }
}
```

**VLM Critic Prompt 核心：**
```
你是一个专业的视觉分析师。
任务：分析图像是否符合创作意图，提取可操作的改进建议。

输入：
1. 原始创作意图（Project Brief）
2. 生成所用的 Prompt
3. 用户的反馈文字（可能为空）
4. 当前图像

输出（JSON）：
{
  "qualityScore": 0-100,
  "intentMatch": 0-100,
  "satisfiedElements": [...],
  "problemElements": [...],
  "iterationDiff": { ... }
}
```

---

## 3. 数据流时序

### 3.1 首次生成流程

```
用户发消息
    │
    ▼
LLM Agent 处理
    │ 返回 ActionIntent
    ▼
Decision Engine 评估
    │
    ├─ 信息不足 → 回复用户，继续对话
    │
    └─ 信息充分
          │
          ▼
      State Manager 更新 ProjectState
          │
          ▼
      Prompt Builder 构建 prompt
          │
          ▼
      Image Provider 生成图像（异步）
          │
          ▼
      VLM Critic 质量检查
          │
          ├─ 不通过（critical issue）→ 自动重试（最多2次）
          │
          └─ 通过
                │
                ▼
            返回图片 + VLM 分析摘要给用户
```

### 3.2 迭代流程

```
用户反馈："颜色太暗，人物面部不清晰"
    │
    ▼
LLM Agent 理解反馈
    │
    ▼
VLM Critic 解析
    │ 输入：当前图 + 用户反馈 + 当前 prompt
    │ 输出：IterationDiff
    ▼
Prompt Builder 应用 diff
    │ 保留满意的部分，修改问题部分
    ▼
Image Provider 重新生成
    │
    ▼
VLM Critic 对比新旧版本
    │
    ▼
返回新图 + 变更说明
```

---

## 4. 关键技术决策

### 4.1 LLM 选型
- **主模型：** Claude Sonnet（对话质量 + tool calling 稳定性）
- **VLM：** Claude Sonnet with Vision（复用，降低接入成本）
- **可选优化：** 高频简单 prompt 优化任务可用更便宜的模型

### 4.2 流式输出
- LLM 回复全部使用 Server-Sent Events（SSE）流式输出
- 图像生成进度通过 WebSocket 推送

### 4.3 Context 管理
- 对话超过 10 轮时，触发历史压缩
- 压缩后保留：Creative Brief + 最近 3 轮对话 + 所有 iterations 摘要
- 压缩由 LLM 执行，生成 `conversationSummary`

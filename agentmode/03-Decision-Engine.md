# 03 · Decision Engine

## 1. 设计哲学

Decision Engine 是整个系统最核心的一层。它解决的核心问题是：

> **"我现在拥有的信息，足够生成一张符合用户期望的图了吗？"**

区别于固定流程驱动（"第一步问风格，第二步问场景..."），Decision Engine 是**信息驱动**的：
- 用户描述充分 → 0 次追问，直接生成
- 用户描述模糊 → 问最关键的一个问题
- 用户主动授权自由发挥 → 立即生成

---

## 2. 核心概念：信息完整度（Information Completeness）

### 2.1 信息维度定义

```typescript
interface InformationDimension {
  key: string
  weight: number          // 权重，影响完整度评分
  required: boolean       // true = 没有则 critical gap
  inferrable: boolean     // true = LLM 可以合理推断，不必追问
}

const DIMENSIONS: InformationDimension[] = [
  // Critical 维度（缺失则无法生成有意义的图）
  { key: 'subject',       weight: 30, required: true,  inferrable: false },
  { key: 'style',         weight: 20, required: false, inferrable: true  },
  { key: 'mood',          weight: 15, required: false, inferrable: true  },

  // Important 维度（影响质量但可以推断）
  { key: 'composition',   weight: 10, required: false, inferrable: true  },
  { key: 'colorPalette',  weight: 10, required: false, inferrable: true  },
  { key: 'lighting',      weight: 10, required: false, inferrable: true  },

  // Optional 维度（锦上添花）
  { key: 'useCase',       weight: 5,  required: false, inferrable: true  },
]
```

### 2.2 完整度评分算法

```typescript
function calculateCompleteness(state: ProjectState): CompletenessResult {
  let score = 0
  const criticalGaps: string[] = []
  const inferrableGaps: string[] = []

  for (const dim of DIMENSIONS) {
    const value = state.intent[dim.key]
    const hasValue = value !== null && value !== undefined && value !== ''

    if (hasValue) {
      score += dim.weight
    } else {
      if (dim.required && !dim.inferrable) {
        criticalGaps.push(dim.key)
      } else if (dim.inferrable) {
        inferrableGaps.push(dim.key)
        // 可推断的维度给一半分，因为 LLM 会自行补全
        score += dim.weight * 0.5
      }
    }
  }

  // 用户授权自由发挥时，完整度直接拉满
  if (state.intent.userAuthorizedFreedom) {
    score = Math.max(score, 85)
  }

  return {
    score: Math.min(score, 100),
    criticalGaps,
    inferrableGaps,
    canGenerate: criticalGaps.length === 0 && score >= GENERATE_THRESHOLD
  }
}

const GENERATE_THRESHOLD = 60  // 60分以上且无 critical gap 即可生成
```

---

## 3. 决策逻辑

### 3.1 决策树

```
收到 LLM Agent 的 ActionIntent
            │
            ▼
    ┌───────────────────┐
    │ 计算信息完整度     │
    │ completeness.score│
    └───────┬───────────┘
            │
            ▼
    ┌───────────────────────────────────────┐
    │ 是否有 critical gap？                  │
    │ (subject 为空 = 完全不知道画什么)       │
    └───────┬───────────────────────────────┘
            │
     YES ───┤─── NO
            │         │
            ▼         ▼
       问最关键    score >= 60?
       的问题       │
                YES ──┤── NO
                      │         │
                      ▼         ▼
               turnsInStage  inferrableGaps
               >= 3?          存在？
                │              │
            YES─┤─NO       YES─┤─NO
                │    │         │    │
                ▼    ▼         ▼    ▼
            EXPLORE CONFIRM  告知  直接
            提案模式  或     默认   CONFIRM
                     GENERATE 选择
                              CONFIRM
```

### 3.2 完整决策函数

```typescript
type Action =
  | { type: 'ASK'; question: string; dimension: string }
  | { type: 'EXPLORE'; suggestion: CreativeSuggestion }
  | { type: 'CONFIRM'; brief: CreativeBrief }
  | { type: 'GENERATE'; prompt: GenerationPrompt }
  | { type: 'REFINE'; diff: IterationDiff }

function decide(
  state: ProjectState,
  intent: ActionIntent,
  userMessage: string
): Action {
  const completeness = calculateCompleteness(state)
  const { score, criticalGaps, canGenerate } = completeness

  // --- 迭代模式（已有图片，用户在给反馈）---
  if (state.phase.stage === 'refining') {
    return handleRefinement(state, userMessage)
  }

  // --- 用户明确表示确认或开始生成 ---
  if (isUserConfirming(userMessage)) {
    return { type: 'GENERATE', prompt: buildPrompt(state) }
  }

  // --- 有 critical gap，必须追问 ---
  if (criticalGaps.length > 0) {
    return {
      type: 'ASK',
      question: pickMostCriticalQuestion(criticalGaps, state),
      dimension: criticalGaps[0]
    }
  }

  // --- 信息充分，可以生成 ---
  if (canGenerate) {
    // 第一次生成先出 brief 确认
    if (state.brief === null || !state.brief.confirmedByUser) {
      return { type: 'CONFIRM', brief: buildBrief(state) }
    }
    return { type: 'GENERATE', prompt: buildPrompt(state) }
  }

  // --- 信息不充分，但没有明确 critical gap ---
  // 在同一阶段停留太久了 → 换策略，主动提案
  if (state.phase.turnsInStage >= 3) {
    return { type: 'EXPLORE', suggestion: generateSuggestion(state) }
  }

  // --- 有缺口但可推断，告知用户默认选择 ---
  if (completeness.inferrableGaps.length > 0) {
    const defaults = inferDefaults(completeness.inferrableGaps, state)
    // 将默认值写入 state，然后 CONFIRM
    applyDefaults(state, defaults)
    return { type: 'CONFIRM', brief: buildBrief(state) }
  }

  // --- 兜底 ---
  return { type: 'CONFIRM', brief: buildBrief(state) }
}
```

---

## 4. 特殊场景处理

### 4.1 用户授权自由发挥

```typescript
const FREE_PLAY_PATTERNS = [
  '你来决定', '随便', '你觉得怎么好就怎么来', '自由发挥',
  '你定', '帮我想', 'you decide', 'surprise me'
]

function detectFreePlayAuthorization(message: string): boolean {
  return FREE_PLAY_PATTERNS.some(p => message.includes(p))
}

// 检测到后，设置 state.intent.userAuthorizedFreedom = true
// 完整度评分自动 >= 85，直接进入 CONFIRM/GENERATE
```

### 4.2 防止无限追问

```typescript
// 同一 stage 超过 N 轮 → 强制切换策略
const MAX_TURNS_PER_STAGE = 3

if (state.phase.turnsInStage >= MAX_TURNS_PER_STAGE) {
  // 不再追问，改为主动提案
  return { type: 'EXPLORE', suggestion: generateSuggestion(state) }
}
```

### 4.3 单次问题质量保证

```typescript
function pickMostCriticalQuestion(
  gaps: string[],
  state: ProjectState
): string {
  // 优先级：subject > useCase > style > mood > ...
  const priority = ['subject', 'useCase', 'style', 'mood', 'composition']
  const topGap = priority.find(p => gaps.includes(p)) ?? gaps[0]

  // 问题模板（避免干巴巴的追问）
  const questionTemplates: Record<string, string[]> = {
    subject: [
      '你想画的主体是什么？比如人物、动物、风景、产品...',
      '帮我了解一下画面的主角是什么？'
    ],
    useCase: [
      '这张图主要用在哪里？比如官网、社交媒体、个人头像...',
      '大概是什么场景下会用到这张图？'
    ],
    style: [
      '风格上有什么偏好吗？比如写实、插画、赛博朋克、水彩...',
      '你倾向于什么视觉风格？'
    ],
  }

  const templates = questionTemplates[topGap] ?? ['能告诉我更多关于这张图的想法吗？']
  return templates[Math.floor(Math.random() * templates.length)]
}
```

### 4.4 迭代模式决策

```typescript
function handleRefinement(state: ProjectState, userFeedback: string): Action {
  // 解析用户反馈类型
  const feedbackType = classifyFeedback(userFeedback)

  switch (feedbackType) {
    case 'MINOR_ADJUST':
      // "颜色调亮一点" → 局部调整，保留大部分
      return { type: 'REFINE', diff: buildMinorDiff(state, userFeedback) }

    case 'STYLE_CHANGE':
      // "换成水彩风" → 风格调整，保留主体
      return { type: 'REFINE', diff: buildStyleDiff(state, userFeedback) }

    case 'MAJOR_RETHINK':
      // "完全不是我想要的" → 重新探索
      state.phase.stage = 'exploring'
      return { type: 'ASK', question: '好的，我们重新来，你最希望这张图传达什么感觉？', dimension: 'mood' }

    case 'SATISFIED':
      // "很好！" → 询问是否需要变体或结束
      return handleSatisfaction(state)
  }
}
```

---

## 5. 决策引擎与 LLM Agent 的分工

| 职责 | LLM Agent | Decision Engine |
|---|---|---|
| 理解用户意图 | ✅ | ❌ |
| 生成自然语言回复 | ✅ | ❌ |
| 提取结构化信息 | ✅ | ❌ |
| 判断是否生成图片 | ❌（表达意图） | ✅（最终决定） |
| 信息完整度评分 | 参考输入 | ✅ |
| 决定问哪个问题 | 提供候选 | ✅ |
| 调用图像 API | ❌ | ✅（触发） |

**设计原则：LLM 负责"理解与表达"，Decision Engine 负责"判断与行动"。**

两者通过 ActionIntent 接口解耦，Decision Engine 可以 override LLM 的意图（例如 LLM 说可以生成，但 Decision Engine 发现 subject 为空，仍然先追问）。

---

## 6. 监控指标

Decision Engine 需要记录以下指标用于后续优化：

```typescript
interface DecisionMetrics {
  projectId: string
  totalTurnsBeforeFirstGeneration: number  // 核心指标：应尽量 <= 2
  criticalGapTurns: number                 // 因 critical gap 追问的次数
  exploreTriggered: boolean                // 是否触发过 EXPLORE 模式
  freePlayDetected: boolean                // 是否检测到自由发挥授权
  autoRetryCount: number                   // VLM Critic 触发自动重试次数
  userSatisfiedAtIteration: number         // 用户在第几次迭代表示满意
}
```

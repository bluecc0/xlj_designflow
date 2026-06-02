# 05 · API Design

## 1. 设计原则

- RESTful 为主，WebSocket/SSE 用于实时通信
- 所有响应统一格式
- 错误码语义化
- 流式输出使用 SSE（Server-Sent Events）

## 2. 统一响应格式

```typescript
// 成功
{
  "success": true,
  "data": { ... },
  "meta": {             // 可选，分页等
    "page": 1,
    "total": 100
  }
}

// 失败
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_INFO",
    "message": "用户描述不够清晰",
    "details": { ... }  // 可选
  }
}
```

---

## 3. 认证

所有 API 需要携带 Bearer Token：
```
Authorization: Bearer <jwt_token>
```

---

## 4. Core API

### 4.1 项目管理

#### 创建项目
```
POST /api/projects

Request: {}  // 无需参数，自动创建

Response:
{
  "success": true,
  "data": {
    "id": "proj_xxx",
    "status": "active",
    "phase": "exploring",
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

#### 获取项目列表
```
GET /api/projects?page=1&limit=20&status=active

Response:
{
  "success": true,
  "data": [
    {
      "id": "proj_xxx",
      "title": "赛博朋克城市",
      "currentImageUrl": "https://...",
      "phase": "refining",
      "totalGenerations": 3,
      "updatedAt": "2024-01-01T00:00:00Z"
    }
  ],
  "meta": { "total": 42, "page": 1 }
}
```

#### 获取项目详情
```
GET /api/projects/:projectId

Response:
{
  "success": true,
  "data": {
    "id": "proj_xxx",
    "phase": "refining",
    "intent": { ... },
    "brief": { ... },
    "currentImageUrl": "https://...",
    "messages": [ ... ],    // 最近 20 条
    "iterations": [ ... ]   // 所有图片版本
  }
}
```

---

### 4.2 对话 & Agent（核心接口）

#### 发送消息（SSE 流式）

这是整个系统最核心的接口，触发完整的 Agent → Decision Engine → 可能的图像生成流程。

```
POST /api/projects/:projectId/chat
Content-Type: application/json

Request:
{
  "message": "帮我画一张赛博朋克风格的城市夜景"
}

Response: text/event-stream (SSE)
```

**SSE 事件流设计：**

```
// 1. Agent 开始思考
event: agent_thinking
data: {"phase": "understanding_intent"}

// 2. Agent 流式回复（打字机效果）
event: agent_text
data: {"delta": "好的，我来帮你构思这张图。"}

event: agent_text
data: {"delta": "赛博朋克城市夜景是个很棒的主题，"}

// 3. Decision Engine 决策结果
event: decision
data: {
  "action": "CONFIRM",
  "brief": {
    "concept": "未来都市霓虹雨夜",
    "visualElements": ["高楼大厦", "霓虹广告牌", "雨后反光街道"],
    "style": "cyberpunk",
    "mood": "mysterious",
    "colorDirection": "深蓝 + 紫红 + 青绿"
  }
}

// 4. 如果 action = GENERATE，触发图像生成
event: generation_started
data: {"jobId": "job_xxx", "estimatedSeconds": 10}

// 5. 生成进度（通过 WebSocket 或轮询）
event: generation_progress
data: {"jobId": "job_xxx", "progress": 60}

// 6. 生成完成
event: generation_completed
data: {
  "jobId": "job_xxx",
  "image": {
    "id": "img_xxx",
    "url": "https://cdn.example.com/xxx.jpg",
    "width": 1024,
    "height": 576
  },
  "vlmAnalysis": {
    "qualityScore": 85,
    "intentMatch": 80,
    "summary": "整体符合预期，霓虹氛围感强烈"
  }
}

// 7. Agent 后续回复（看图后的评论）
event: agent_text
data: {"delta": "图片已生成！整体氛围很符合赛博朋克风格，"}

// 8. 结束
event: done
data: {"messageId": "msg_xxx"}
```

---

### 4.3 图像管理

#### 获取项目所有图片（迭代历史）
```
GET /api/projects/:projectId/images

Response:
{
  "success": true,
  "data": [
    {
      "id": "img_xxx",
      "url": "https://...",
      "iterationNumber": 1,
      "prompt": { ... },
      "vlmAnalysis": { ... },
      "userRating": null,
      "createdAt": "..."
    }
  ]
}
```

#### 收藏/评分图片
```
PATCH /api/images/:imageId
{
  "isFavorite": true,
  "userRating": 4
}
```

#### 下载图片（生成下载 URL）
```
POST /api/images/:imageId/download

Response:
{
  "success": true,
  "data": {
    "downloadUrl": "https://...",  // 有效期 10 分钟
    "filename": "cyberpunk-city-v1.jpg"
  }
}
```

---

### 4.4 生成任务状态

用于轮询生成进度（备选方案，主要用 SSE）。

```
GET /api/jobs/:jobId

Response:
{
  "success": true,
  "data": {
    "id": "job_xxx",
    "status": "processing",   // pending / processing / completed / failed
    "progress": 60,
    "imageUrl": null,
    "error": null,
    "createdAt": "...",
    "estimatedCompletionAt": "..."
  }
}
```

---

### 4.5 用户相关

#### 获取用量统计
```
GET /api/users/me/usage

Response:
{
  "success": true,
  "data": {
    "plan": "free",
    "generationsThisHour": 3,
    "generationsThisMonth": 47,
    "limits": {
      "perHour": 10,
      "perMonth": 100
    }
  }
}
```

---

## 5. WebSocket（可选，用于生成进度推送）

如果使用 WebSocket 替代 SSE 进度推送：

```
WS /ws?token=<jwt>

// 客户端订阅任务
{ "type": "subscribe_job", "jobId": "job_xxx" }

// 服务端推送进度
{ "type": "job_progress", "jobId": "job_xxx", "progress": 60 }
{ "type": "job_completed", "jobId": "job_xxx", "imageUrl": "..." }
{ "type": "job_failed", "jobId": "job_xxx", "error": "..." }
```

---

## 6. 错误码

| 错误码 | HTTP 状态 | 含义 |
|---|---|---|
| `UNAUTHORIZED` | 401 | 未登录或 Token 失效 |
| `PROJECT_NOT_FOUND` | 404 | 项目不存在或无权限 |
| `RATE_LIMIT_EXCEEDED` | 429 | 超过生成频率限制 |
| `GENERATION_FAILED` | 500 | 图像生成失败（已重试） |
| `LLM_ERROR` | 500 | LLM 调用失败 |
| `INSUFFICIENT_CREDITS` | 402 | 余额不足（付费功能） |
| `INVALID_CONTENT` | 400 | 内容违规 |

---

## 7. 速率限制

| 接口 | 免费用户 | Pro 用户 |
|---|---|---|
| `/chat` | 30次/分钟 | 120次/分钟 |
| 图像生成 | 10次/小时，100次/月 | 50次/小时，无月限 |
| 图片下载 | 无限制 | 无限制 |

---

## 8. 前端集成示例

```typescript
// 发送消息并处理 SSE 流
async function sendMessage(projectId: string, message: string) {
  const response = await fetch(`/api/projects/${projectId}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ message })
  })

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const lines = decoder.decode(value).split('\n')
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const event = JSON.parse(line.slice(5))
      handleSSEEvent(event)
    }
  }
}

function handleSSEEvent(event: SSEEvent) {
  switch (event.type) {
    case 'agent_text':
      appendToChat(event.delta)
      break
    case 'decision':
      if (event.action === 'CONFIRM') showBriefCard(event.brief)
      break
    case 'generation_started':
      showGeneratingUI(event.jobId)
      break
    case 'generation_completed':
      showImage(event.image)
      break
  }
}
```

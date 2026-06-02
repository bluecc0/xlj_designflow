# 04 · Database Schema

## 1. 技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 主数据库 | PostgreSQL | 关系型结构，支持 JSONB 灵活字段 |
| 缓存 | Redis | Session 状态、生成队列 |
| 文件存储 | S3 / R2 | 生成图片持久化存储 |
| ORM | Prisma | TypeScript 类型安全 |

---

## 2. 核心表设计

### 2.1 users

```sql
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  display_name  VARCHAR(100),
  avatar_url    TEXT,
  plan          VARCHAR(20) DEFAULT 'free',   -- free / pro / enterprise
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
```

---

### 2.2 projects（创作项目）

每次创作会话对应一个 project，是整个系统的核心业务对象。

```sql
CREATE TABLE projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- 基础信息
  title         VARCHAR(200),               -- 自动生成或用户命名
  status        VARCHAR(20) DEFAULT 'active', -- active / archived / deleted

  -- 对话阶段
  phase         VARCHAR(20) DEFAULT 'exploring',
                -- exploring / discussing / confirming / generating / refining
  turns_in_phase INT DEFAULT 0,

  -- 创意意图（JSONB 灵活存储）
  intent        JSONB DEFAULT '{}',
  /*
  intent 结构：
  {
    "subject": "赛博朋克城市夜景",
    "style": "cyberpunk",
    "mood": "mysterious",
    "colorPalette": ["#0a0a2e", "#ff00ff", "#00ffff"],
    "composition": "wide angle",
    "useCase": "wallpaper",
    "userAuthorizedFreedom": false
  }
  */

  -- Creative Brief
  brief         JSONB DEFAULT NULL,
  /*
  brief 结构：
  {
    "concept": "...",
    "visualElements": [...],
    "style": "...",
    "mood": "...",
    "colorDirection": "...",
    "confirmedByUser": true,
    "confirmedAt": "2024-01-01T00:00:00Z"
  }
  */

  -- 当前使用的 prompt
  current_prompt JSONB DEFAULT NULL,
  /*
  {
    "positive": "...",
    "negative": "...",
    "model": "fal-ai/flux/dev",
    "parameters": { "aspectRatio": "16:9", "steps": 20 }
  }
  */

  -- 当前展示图片
  current_image_id  UUID REFERENCES images(id),
  current_image_url TEXT,

  -- 对话历史摘要（超过 10 轮时压缩）
  conversation_summary TEXT,

  -- 统计
  total_generations INT DEFAULT 0,
  total_turns       INT DEFAULT 0,

  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_projects_user_id ON projects(user_id);
CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_projects_created_at ON projects(created_at DESC);
```

---

### 2.3 messages（对话消息）

```sql
CREATE TABLE messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  role        VARCHAR(20) NOT NULL,  -- user / assistant / system
  content     TEXT NOT NULL,

  -- Agent 内部数据（不展示给用户）
  action_intent   JSONB DEFAULT NULL,
  /*
  {
    "type": "REQUEST_GENERATE",
    "confidence": 0.85,
    "extractedInfo": { "style": "cyberpunk" },
    "openQuestions": []
  }
  */

  decision_action JSONB DEFAULT NULL,
  /*
  {
    "type": "GENERATE",
    "reasoning": "completeness score 78, no critical gaps"
  }
  */

  -- 关联图片（如果本条消息触发了生成）
  image_id    UUID REFERENCES images(id),

  -- Token 统计
  input_tokens  INT,
  output_tokens INT,

  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_project_id ON messages(project_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);
```

---

### 2.4 images（生成图片）

```sql
CREATE TABLE images (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id),

  -- 图片存储
  url           TEXT NOT NULL,        -- CDN URL
  storage_key   TEXT NOT NULL,        -- S3/R2 key
  width         INT,
  height        INT,
  file_size     INT,                  -- bytes

  -- 生成参数（完整记录，方便复现）
  prompt        JSONB NOT NULL,
  /*
  {
    "positive": "...",
    "negative": "...",
    "model": "fal-ai/flux/dev",
    "parameters": { ... }
  }
  */

  -- 提供商信息
  provider      VARCHAR(50),          -- fal / replicate / ...
  provider_job_id TEXT,               -- 第三方任务 ID
  generation_ms  INT,                 -- 生成耗时

  -- VLM Critic 分析结果
  vlm_analysis  JSONB DEFAULT NULL,
  /*
  {
    "qualityScore": 82,
    "intentMatch": 75,
    "satisfiedElements": ["composition", "color palette"],
    "problemElements": [{ "element": "face", "issue": "slight blur" }],
    "autoRetried": false
  }
  */

  -- 用户反馈
  user_rating   INT,                  -- 1-5，用户主动评分
  user_feedback TEXT,                 -- 用户文字反馈
  is_favorite   BOOLEAN DEFAULT FALSE,

  -- 迭代关系
  parent_image_id UUID REFERENCES images(id),   -- 从哪张图迭代来的
  iteration_number INT DEFAULT 1,

  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_images_project_id ON images(project_id);
CREATE INDEX idx_images_user_id ON images(user_id);
CREATE INDEX idx_images_parent_image_id ON images(parent_image_id);
```

---

### 2.5 decision_logs（决策引擎日志）

用于分析和优化 Decision Engine 行为。

```sql
CREATE TABLE decision_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  message_id    UUID REFERENCES messages(id),

  -- 决策输入
  completeness_score  INT,
  critical_gaps       TEXT[],
  inferrable_gaps     TEXT[],
  turns_in_phase      INT,

  -- 决策输出
  action_type     VARCHAR(30),  -- ASK / EXPLORE / CONFIRM / GENERATE / REFINE
  action_detail   JSONB,
  reasoning       TEXT,

  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_decision_logs_project_id ON decision_logs(project_id);
```

---

### 2.6 generation_queue（生成队列）

处理异步图像生成任务。

```sql
CREATE TABLE generation_queue (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id),
  user_id       UUID NOT NULL REFERENCES users(id),

  status        VARCHAR(20) DEFAULT 'pending',
                -- pending / processing / completed / failed / cancelled

  prompt        JSONB NOT NULL,
  provider      VARCHAR(50),
  provider_job_id TEXT,

  -- 重试
  attempts      INT DEFAULT 0,
  max_attempts  INT DEFAULT 3,
  last_error    TEXT,

  -- 结果
  result_image_id UUID REFERENCES images(id),

  created_at    TIMESTAMPTZ DEFAULT NOW(),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ
);

CREATE INDEX idx_generation_queue_status ON generation_queue(status);
CREATE INDEX idx_generation_queue_user_id ON generation_queue(user_id);
```

---

## 3. Redis 数据结构

### 3.1 活跃 Session 状态

```
Key:   session:{projectId}
Type:  Hash
TTL:   30分钟（用户活跃时持续刷新）

Fields:
  phase           当前阶段
  completeness    最新完整度评分（缓存，避免重复计算）
  lastActionType  上一次 Decision 类型
  pendingJobId    正在生成的任务 ID（如有）
```

### 3.2 生成任务进度

```
Key:   job:{jobId}:progress
Type:  String (JSON)
TTL:   10分钟

Value:
{
  "status": "processing",
  "progress": 60,       // 0-100
  "message": "生成中...",
  "imageUrl": null      // 完成后填入
}
```

### 3.3 用户限流

```
Key:   ratelimit:{userId}:generations
Type:  String (counter)
TTL:   1小时

用于限制每小时生成次数（免费用户 10次/小时）
```

---

## 4. Prisma Schema（简化版）

```prisma
model User {
  id          String    @id @default(uuid())
  email       String    @unique
  displayName String?
  plan        String    @default("free")
  projects    Project[]
  images      Image[]
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
}

model Project {
  id                  String    @id @default(uuid())
  userId              String
  user                User      @relation(fields: [userId], references: [id])
  title               String?
  status              String    @default("active")
  phase               String    @default("exploring")
  turnsInPhase        Int       @default(0)
  intent              Json      @default("{}")
  brief               Json?
  currentPrompt       Json?
  currentImageId      String?
  currentImageUrl     String?
  conversationSummary String?
  totalGenerations    Int       @default(0)
  messages            Message[]
  images              Image[]
  decisionLogs        DecisionLog[]
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt

  @@index([userId])
}

model Message {
  id             String   @id @default(uuid())
  projectId      String
  project        Project  @relation(fields: [projectId], references: [id])
  role           String
  content        String
  actionIntent   Json?
  decisionAction Json?
  imageId        String?
  inputTokens    Int?
  outputTokens   Int?
  createdAt      DateTime @default(now())

  @@index([projectId])
}

model Image {
  id              String   @id @default(uuid())
  projectId       String
  project         Project  @relation(fields: [projectId], references: [id])
  userId          String
  user            User     @relation(fields: [userId], references: [id])
  url             String
  storageKey      String
  prompt          Json
  provider        String?
  generationMs    Int?
  vlmAnalysis     Json?
  userRating      Int?
  isFavorite      Boolean  @default(false)
  parentImageId   String?
  iterationNumber Int      @default(1)
  createdAt       DateTime @default(now())

  @@index([projectId])
  @@index([userId])
}
```

---

## 5. 数据迁移策略

- 使用 Prisma Migrate 管理 schema 变更
- 生产环境迁移前必须在 staging 验证
- JSONB 字段变更无需 migration，但需要更新 TypeScript 类型
- 图片文件只存 URL + storage_key，实际文件在 S3/R2，便于 CDN 切换

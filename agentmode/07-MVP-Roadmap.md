# 07 · MVP Roadmap

## 目标

用最小的工程投入验证核心价值：**"动态信息评估 + 创意协作"这个模式，是否真的比固定流程有更好的用户体验？**

MVP 不追求功能完整，追求核心体验的完整闭环。

---

## 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 框架 | Next.js 14 (App Router) | 全栈一体，API Routes + 前端 |
| 数据库 | PostgreSQL + Prisma | 可靠，类型安全 |
| 缓存 | Redis (Upstash) | Serverless 友好 |
| LLM | Claude API (Sonnet) | Tool calling 稳定 |
| 图像生成 | FAL.ai (FLUX Schnell) | 速度快，价格低，适合 MVP |
| 流式输出 | SSE (Next.js Route Handler) | 简单够用 |
| 认证 | NextAuth.js | 快速集成 |
| 部署 | Vercel | 零运维 |
| 存储 | Cloudflare R2 | 便宜，兼容 S3 API |

---

## 里程碑划分

### M0 · 基础搭建（第 1 周）

**目标：** 项目能跑起来，基础设施就位。

**任务清单：**

```
基础设施
□ Next.js 项目初始化（TypeScript + Tailwind）
□ PostgreSQL 数据库搭建（本地 Docker + 云端 Supabase）
□ Prisma schema 初始化（users / projects / messages / images）
□ Redis 接入（Upstash）
□ NextAuth.js 接入（Google OAuth / Email Magic Link）
□ Cloudflare R2 存储配置

环境验证
□ Claude API 调通（发一条消息，收到回复）
□ FAL.ai API 调通（生成一张图，拿到 URL）
□ SSE 基础实现验证
```

**完成标志：** 能跑通"发消息 → 收到 Claude 回复 → 触发 FAL 生成图片 → 拿到图片 URL"的完整链路。

---

### M1 · 核心对话流程（第 2-3 周）

**目标：** 完整的 Agent 对话 + Decision Engine 跑通。

**任务清单：**

```
LLM Agent
□ System Prompt v1 实现
□ 消息构建（注入 project context）
□ ActionIntent 解析（从 LLM 输出中提取 JSON）
□ 对话历史管理（存储 + 读取）

Decision Engine
□ 信息完整度评分算法
□ 基础决策逻辑（ASK / CONFIRM / GENERATE）
□ Critical gap 识别
□ 自由发挥意图检测

Project State
□ State 读写接口
□ Intent 字段动态更新（每轮对话后合并新信息）

API
□ POST /api/projects（创建项目）
□ POST /api/projects/:id/chat（SSE 对话接口）
□ SSE 事件流（agent_text / decision / generation_started / generation_completed）
```

**完成标志：**
- 输入"画一只赛博朋克猫" → 直接生成（0次追问）✅
- 输入"帮我画张图" → 问一个问题 → 回答 → 生成 ✅
- 输入"你来决定" → 直接生成 ✅

---

### M2 · 图像生成闭环（第 3-4 周）

**目标：** 图像生成 + VLM Critic + 基础迭代。

**任务清单：**

```
Prompt Builder
□ 意图 → prompt 转换逻辑
□ 内置风格词库（10种主要风格）
□ 质量词 + 负向词模板

Image Provider
□ FAL Provider 实现
□ 生成任务状态轮询 / SSE 推送
□ 图片上传到 R2 存储
□ 基础重试逻辑（失败重试1次）

VLM Critic（MVP 版）
□ 基础质量检测（有无明显瑕疵）
□ 用户反馈解析（提取调整方向）
□ IterationDiff 生成

迭代流程
□ 用户反馈 → Diff → 更新 prompt → 重新生成
□ 迭代历史存储
□ 保留用户满意的元素
```

**完成标志：**
- 生成图片后，输入"颜色太暗" → 自动调整亮度 → 重新生成 ✅
- 生成图片后，输入"改成水彩风" → 保留主体，改风格 → 重新生成 ✅

---

### M3 · 基础 UI（第 4-5 周）

**目标：** 可以给用户用的界面。

**任务清单：**

```
Chat UI
□ 消息气泡（用户 / 助手）
□ 流式文字渲染（打字机效果）
□ Creative Brief 卡片展示
□ 图片展示（含 loading 动画）
□ 迭代版本对比（左右切换）

项目管理
□ 项目列表页
□ 项目详情页（含完整对话历史）
□ 图片下载按钮

用户系统
□ 登录 / 注册页
□ 基础用量展示
```

**完成标志：** 非技术用户能独立完成一次完整创作流程，无需任何引导。

---

### M4 · 稳定性 & 体验打磨（第 6 周）

**目标：** MVP 达到可对外测试的质量。

**任务清单：**

```
稳定性
□ 错误处理完整（LLM 失败 / 生成失败 / 网络断线）
□ 生成超时处理（> 30s 提示用户）
□ SSE 重连机制
□ 基础日志 & 监控（Vercel Analytics / Sentry）

体验优化
□ 响应速度优化（LLM streaming 延迟 < 500ms）
□ 移动端适配
□ 空状态引导（新用户首次使用的引导文案）

限流
□ 免费用户限制（10次/小时生成）
□ 超限提示 UI
```

---

## MVP 功能边界

### ✅ MVP 包含
- 完整的对话 → 生成 → 迭代闭环
- 动态信息评估（核心差异化）
- 基础的 VLM Critic
- 项目保存 & 历史查看
- 图片下载

### ❌ MVP 不包含
- 用户上传参考图
- 风格灵感库浏览
- 社区/分享功能
- 多模型选择
- 高级参数调节
- 商业化功能（订阅/付费）

---

## 关键风险 & 应对

| 风险 | 概率 | 影响 | 应对方案 |
|---|---|---|---|
| FAL API 不稳定 | 中 | 高 | 接入 Replicate 作为备用 |
| LLM 输出 JSON 格式错误 | 高 | 中 | 鲁棒的 JSON 解析 + 重试 |
| Decision Engine 过于保守（问太多） | 中 | 高 | 设置最大追问次数 + 大量测试 |
| 生成成本超预期 | 低 | 中 | FLUX Schnell 成本很低，先不管 |

---

## 成功标准

MVP 结束后，用以下数据判断是否验证了核心假设：

| 指标 | 目标 | 测量方式 |
|---|---|---|
| 平均首次生成前的对话轮数 | ≤ 2 轮 | decision_logs 统计 |
| 用户完成率（开始 → 生成第一张图） | ≥ 60% | 漏斗分析 |
| 用户自发进行第二次迭代 | ≥ 40% | 行为追踪 |
| NPS（主观满意度） | ≥ 30 | 用户访谈 |

# DesignFlow

AI 驱动的电商设计资产生成平台。通过**对话式 AI** + **Penpot 模板库** + **AI 生图** + **本地产品图库** 批量产出商品主图。

## 启动

```bash
pip install -r backend/requirements.txt
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload   # 后端
cd frontend && python build.py                                    # 前端重新打包（修改后必跑）
cd editor-lab-tldraw && npm install && npm run build             # 画布构建（License key 见 .env）
```

主界面 http://localhost:8000/ui，API 文档 http://localhost:8000/docs

## 目录结构

```
backend/              FastAPI 服务
  main.py             所有路由、lifespan、auth 中间件（~1900 行）
  ai_image.py         AI 生图适配与智能路由（APIMart + CLIProxyAPI + adobe2api）
  compose.py          通用模板合成
  special_compose*.py 特殊品合成（多画板场景）
  penpot_client.py    Penpot REST 客户端
  job_store.py        SQLite 持久化（jobs / sessions / AI 聊天 / 灵感）
  product_library.py  本地产品图库（path-based 查表，无 iterdir）
  table_parser.py     Excel/CSV 列映射

frontend/             前端（浏览器内 Babel 编译）
  src/Chat.jsx        对话 + AI 生图主组件
  src/app.jsx         根组件、3 栏布局、灵感面板浮层
  src/TemplatePanel   左侧模板浏览器
  src/Canvas.jsx      中央画布容器（iframe 嵌 Tldraw）
  src/TopBar.jsx      顶部栏
  src/InspirationPanel.jsx  灵感瀑布流
  src/Icons.jsx       线条图标库
  build.py            src/*.jsx 塞进 index.html（必跑）

editor-lab-tldraw/    Tldraw 画布子项目（独立 vite build）
```

## 维护要点

### 1. 前端无构建工具链

`frontend/src/*.jsx` 通过**浏览器内 Babel standalone** 编译。**修改后必须** `cd frontend && python build.py`，否则用户看到旧版。`build.py` 不读 git，纯按 BABEL_FILES 列表顺序把内容替换进 index.html 的 babel 块里。

### 2. Tldraw 隔离在 iframe

`frontend/src/Canvas.jsx` 用 `<iframe src="/editor-beta/index.html">` 嵌 Tldraw，**避免主页 React 状态污染画布 store**。iframe 高度传导靠 grid item 的 `minmax(0, 1fr)` —— Canvas 必须是 grid **直接子项**，包任何 wrapper 都会断高度（参考之前 1 分钟出图变 7 分钟的 bug 也是这个原因）。

### 3. 灵感面板的"覆盖画布"实现

**不能用 grid wrapper**（会破坏 Canvas 高度）。用 `position: fixed` 浮层，**JS 跟踪 Canvas 的 getBoundingClientRect 定位**。见 `InspirationPanel.jsx` 的 canvasRect state。

### 4. 瀑布流用"最短列"算法，不是 CSS columns

`column-count` 是"先填左列再填右列"，瀑布流应该是"先填最短列"。**手写算法**：每张图按后端返回的 `width/height` 算高度，每次插到当前最矮的列。`InspirationPanel.jsx` 的 `waterFallCols` useMemo。

### 5. 灵感发布的并发安全

`inspiration_posts.job_id` 加了 **UNIQUE INDEX**（不是应用层判断）。`create_inspiration_post` 捕获 IntegrityError 返回 False，主流程 SELECT + INSERT 失败时回查已存在那条转 `already_published: true`。

### 6. 缩略图

服务端发布时生成 `output/ai-images/{user_id}/thumbs/{job_id}.webp` (480px)。**前端不暴露原图 URL**。`generate_inspiration_thumb` 返回 (url, w, h)，瀑布流要用的尺寸从此读取，避免 onLoad 抖动。

### 7. 安全

- `.env` / `.env.*` 都在 `.gitignore`
- `.env.example` 等模板必须用占位符（`REPLACE_WITH_YOUR`），**别复制真 key**
- 项目自带 `pre-commit` hook 扫描常见 key 模式（tldraw-/sk-/AIza/ghp_/xoxb-）
- `pre-push` hook 拦截直接 push master（强制 PR 流程）

### 8. 部署

后端从 `frontend/` 静态 serve（包括 `index.html`）。Tldraw 走 `/editor-beta/` 静态路径。`start.example.bat` 一键拉起后端 + MCP + plugin server（Windows）。

**正式机 license key 必须在 .env 里**（commit 时永远不要 commit 真 key）。`hosts: ["*"]` 通配符覆盖任何域名。

## 关键端点

| 路径 | 说明 |
|---|---|
| `GET /health` | 健康检查 + AI 服务商连通状态 |
| `POST /ai-image` | 提交生图（multipart，prompt + 1-4 张参考图） |
| `GET /ai-image/{job_id}` | 轮询状态，前端每 2 秒一次 |
| `POST /ai-image/retry` | 生图失败触发智能重试 |
| `POST /compose` / `/special-compose` | 模板合成 |
| `GET /templates` | Penpot 模板列表（按 Penpot 团队 + 包含"模板"的项目筛） |
| `GET /inspiration` / `POST /inspiration` | 灵感瀑布流列表 + 发布 |
| `GET /ai-image/{id}/image` | 下载生成图（admin only） |

完整 OpenAPI：`http://localhost:8000/docs`

## 数据库

SQLite (`jobs.db`)，`init_db()` 幂等建表 + 自动迁移（ALTER TABLE ADD COLUMN 容错）。**主要表**：
- `jobs` / `special_jobs` —— 合成任务
- `ai_image_jobs` + `ai_chat_sessions` + `ai_chat_messages` —— AI 生图历史
- `inspiration_posts` —— 灵感发布
- `users` + `sessions` —— 用户和登录态
- `operation_logs` —— admin 审计
- `agent_projects` + `agent_messages` + `agent_images` —— Agent 模式项目

## 排错

- **`/ai-image/{id}` 返回 500** —— 看 `/tmp/designflow.log` 的 KeyError 堆栈，通常是 `load_ai_image_job` 漏字段（`progress` / `task_id` / `created_at`）。该函数 dict 必须和 DB schema 字段对齐。
- **画布消失变白** —— Canvas 必须是 grid **直接子项**。如果中间包了 wrapper，grid track 高度传不下来（之前 `1 分钟出图 7 分钟显示` 就是这个原因）。
- **Tldraw 不显示** —— `.env` 缺 license 或 dist 未 rebuild。`bundle` 里 grep `tldraw-2026` 应该出现 2 次（key inline 进去了）。
- **灵感缩略图加载慢** —— 浏览器 Network 看 `/ai-images/.../thumbs/*.webp`，单图应该 10-50KB。原图 URL 不应该出现在前端任何地方。

## 重要文档

- `CLAUDE.md` —— 给 AI 助手的项目指南（架构、命令、关键决策）
- `IDEAS.md` —— 未来改进想法清单
- `design-tool-prd.md` —— 早期产品需求（部分已过时）
- `KNOWLEDGE.md` —— AI 系统 prompt 注入的产品知识
- `AGENTS.md` / `Agentmode/` —— Agent 模式相关

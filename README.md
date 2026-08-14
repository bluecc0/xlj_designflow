# DesignFlow

AI 驱动的电商设计资产平台。运营/设计通过对话选模板、匹配本地图库、AI 生图、特殊品多画板合成，批量产出商品主图。

主界面：http://localhost:8000/ui  
API 文档：http://localhost:8000/docs  
仓库：https://github.com/bluecc0/xlj_designflow

---

## 目录

- [它做什么](#它做什么)
- [技术栈](#技术栈)
- [仓库结构](#仓库结构)
- [本地启动](#本地启动)
- [改代码后必须 rebuild](#改代码后必须-rebuild)
- [配置](#配置)
- [登录与权限](#登录与权限)
- [核心业务](#核心业务)
- [特殊品合成](#特殊品合成)
- [AI 生图](#ai-生图)
- [画布](#画布)
- [后台管理](#后台管理)
- [主要 HTTP 端点](#主要-http-端点)
- [数据库](#数据库)
- [测试](#测试)
- [Git 与发布](#git-与发布)
- [排错](#排错)
- [相关文档](#相关文档)

---

## 它做什么

```
运营表格 / 对话指令 / SKU
        ↓
FastAPI（解析、匹配图库、调生图、写 Penpot slot）
        ↓
Penpot 模板（图层名 slot/...） + 本地产品图库
        ↓
导出 PNG/JPG，或落到中间 Tldraw 画布继续处理
```

三条主产线：

| 产线 | 入口 | 说明 |
|---|---|---|
| 普通合成 | 选模板 + 上传表格 / `POST /compose` | 单模板填 slot |
| 特殊品 | `/特殊品`、`/特殊品（完整）` | 多画板、变体导出、zip 按画板名改文件名 |
| AI 生图 | GPT Image 2 / Nano Banana Pro | 智能路由多线路，结果进画布 |

另外还有：智能铺货（Excel → PS 插件 JSON）、花瓣下载、画布高清放大 / 转 SVG / 转 PSD、灵感瀑布流、Agent / Skill。

---

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Python FastAPI，`uvicorn`，端口 8000 |
| 前端主 UI | `frontend/`，JSX 由 `build.py` 编成 hashed bundle，后端静态托管 `/ui` |
| 画布 | `editor-lab-tldraw/`（Vite + React + tldraw），iframe 挂在 `/editor-beta/` |
| 模板 | 本地 Penpot（默认 9001），Transit+JSON RPC |
| 持久化 | SQLite `jobs.db`（git 忽略） |
| 图库 | UNC / 本地目录，按 SKU 文件名精确匹配 |

前端**不是** Vite 应用。改 `frontend/src/*.jsx` 后必须跑 `python build.py`。`api.js` 是普通脚本，不进 bundle。

---

## 仓库结构

```
backend/                     FastAPI
  main.py                   路由、鉴权中间件、静态挂载、zip 导出规则
  config.py                 .env + login_users.json + IMAGE_TYPE_FOLDERS
  models.py                 Pydantic 模型
  job_store.py              SQLite：任务、会话、灵感、画布快照、后台统计
  penpot_client.py          Penpot RPC + slot 解析
  compose.py                普通合成（全局 Semaphore 串行）
  special_compose.py        特殊品
  special_compose_full.py   特殊品完整（banner/poster、hide 层）
  product_library.py        图库查找（只拼路径 + exists，禁止热路径 iterdir）
  table_parser.py           普通合成表格列映射
  smart_distribute.py       智能铺货（规则解析，不调 AI）
  ai_image.py               生图适配 + 智能路由
  kie_layer_decomposition.py / layer_*.py   转 PSD
  upscale_worker.py         Gigapixel 高清放大
  vectorize_worker.py       vtracer 转 SVG
  agent_mode.py             Agent 对话状态机
  agent_skill_loader.py     skills/ 目录加载
  test_*.py                 unittest

frontend/                   主 UI（后端从这里 serve，不是 frontend-dist/）
  src/app.jsx               根组件、登录门、三栏布局
  src/Chat.jsx              对话、生图、特殊品、铺货
  src/TemplatePanel.jsx     左侧模板库
  src/Canvas.jsx            中间画布 iframe
  src/TopBar.jsx            顶栏
  src/AdminPage.jsx         /admin 后台
  src/InspirationPanel.jsx  灵感浮层
  src/WhatsNewModal.jsx     更新弹窗
  src/api.js                fetch 封装（credentials: include）
  build.py                  JSX → frontend/compiled/app-<hash>.js
  compiled/                 当前生效 bundle（提交进 git）
  index.html                入口，引用 compiled bundle
  whats-new.json            更新弹窗文案

editor-lab-tldraw/          画布子项目
  src/App.tsx               工具条、批量下载、放大/矢量化/分层
  dist/                     构建产物，挂到 /editor-beta/

skills/                     Agent Skill（SKILL.md + references）
special_flows.json          特殊品字段定义
slot_schema.json            普通合成列别名
template_rules.json         历史规则（智能铺货不再依赖）
login_users.example.json    账号模板
start.example.bat           Windows 一键启动模板（复制为 start.bat，该文件 git 忽略）
KNOWLEDGE.md                注入对话 system prompt 的产品说明
```

`penpot/`、`jobs.db`、`.env`、`login_users.json`、`output/`、`start.bat` 都在 `.gitignore`。

---

## 本地启动

依赖：Python 3.11+、Node.js（编前端 JSX）、本机或局域网 Penpot。

```bash
# 1. 环境
cp .env.example .env          # 填真实值；不要提交
cp login_users.example.json login_users.json
# 按需给账号加 password_hash（bcrypt）

python -m venv .venv
# Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt

# 2. 前端（改过 JSX 才需要）
cd frontend && python build.py && cd ..

# 3. 画布（改过 editor-lab-tldraw/src 才需要）
cd editor-lab-tldraw && npm install && npm run build && cd ..

# 4. 后端
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

Windows 也可：`copy start.example.bat start.bat` 后双击。默认只起后端 `:8000`，同一个窗口，关掉窗口即停。`PENPOT_BASE_URL` 以 `.env` 为准。

```bat
start.bat              只开 8000
start.bat extras       额外再开 Penpot MCP :4401 和插件 :4400（日常不需要）
start.bat install      重装 backend/requirements.txt
```

Penpot 没起来时模板列表为空，其它功能仍可测。

健康检查：`curl http://localhost:8000/health`  
深探测（Penpot / APIMart / adobe2api）：`curl http://localhost:8000/health/deep`

---

## 改代码后必须 rebuild

| 改了什么 | 必须跑 | 否则 |
|---|---|---|
| `frontend/src/*.jsx`（`api.js` 除外） | `cd frontend && python build.py` | `/ui` 仍是旧 bundle |
| `frontend/src/api.js` | 不用 build，刷新即可 | — |
| `frontend/whats-new.json` | 不用 build | — |
| `editor-lab-tldraw/src/*` | `cd editor-lab-tldraw && npm run build` | iframe 仍是旧 dist |
| `backend/*.py` | `--reload` 自动重启 | — |

`build.py` 用本机 Node + `frontend/vendor/babel.min.js` 按 `BABEL_FILES` 顺序编译，写出 `frontend/compiled/app-<12位sha>.js`，并改 `index.html` 里的 `data-designflow-bundle` 标签。旧 hash 文件会被删掉。

新增 JSX 文件时：加入 `BABEL_FILES`，并保证 `index.html` 里对应引用关系还对得上。

两边都改时两个 build 都跑，避免「一半新一半旧」误判。

---

## 配置

根目录 `.env`，对照 `.env.example`。`backend/config.py` 读取。

### 必填（合成 / 对话）

| 变量 | 作用 |
|---|---|
| `PENPOT_BASE_URL` | Penpot 地址 |
| `PENPOT_ACCESS_TOKEN` / `PENPOT_EMAIL` / `PENPOT_PASSWORD` | RPC 认证 |
| `SILICONFLOW_API_KEY` | 对话 / 表格解析兜底 |
| `PRODUCT_LIBRARY_PATH` | 图库根目录，支持 UNC |
| `OUTPUT_PATH` | 导出与生图落盘，默认 `./output` |
| `LOGIN_USERS_PATH` | 默认 `./login_users.json` |

### 生图

| 变量 | 作用 |
|---|---|
| `AI_IMAGE_PROVIDER` | `auto` 走智能路由；也可钉死某一线路 |
| `AI_IMAGE_BASE_URL` / `AI_IMAGE_API_KEY` | APIMart |
| `CLIPROXY_BASE_URL` / `CLIPROXY_API_KEY` | 订阅线路（CLIProxyAPI） |
| `ADOBE2API_BASE_URL` / `ADOBE2API_API_KEY` | adobe2api 兜底 |
| `AI_IMAGE_DOWNLOAD_PROXY_URL` | 只用于下完成图 |
| `NANO_BANANA_*` / `VLM_*` | 空则复用 `AI_IMAGE_*` |

### 可选能力（key 空 = 功能关闭）

| 变量 | 作用 |
|---|---|
| `KIE_*` | 画布「转 PSD」图层分离 |
| `UPSCALE_CLI_PATH` | 本地 Gigapixel，空则高清放大不可用 |
| `AGENT_SKILL_PATHS` | 默认 `./skills`，Windows 多路径用 `;` |
| `SKILL_LLM_*` | Skill 规划模型；空则复用 CLIPROXY |
| `SUB2API_MONITOR_*` | 订阅线路定时探测；本地可关 |
| `PROXY_DOWNLOAD_*` | 花瓣下载 |

不要把真实 key 写进 `.env.example` 或任何会提交的文件。

### 图库目录约定

`config.py` 里 `IMAGE_TYPE_FOLDERS`：

| slot 后缀 / 类型 key | 子目录 |
|---|---|
| `png` | `PNG/` |
| `model` | `Model_Images/` |
| `shadow` | `PNG_Shadow/` |
| `white` | `White_Base/` |
| `whitex2` / `white2x` | `White_Basex2/` |
| `banner` | `场景图/Banner/` |
| `poster` | `场景图/Poster/` |

查找只拼 `{SKU}.png/.jpg/.jpeg/.webp` 再 `exists()`。UNC 大目录禁止 `iterdir()`。

---

## 登录与权限

- Cookie：`designflow_session`，HttpOnly，30 天
- 登录：`POST /auth/login-lite`（用户名 + 密码）
- 账号文件：`login_users.json`（git 忽略）
- `role=admin` 可进后台、看全站任务
- `is_test=true` 的账号会从运营统计里隔离
- 改密码后旧 session 的 `password_marker` 对不上，立即失效

白名单接口见 `backend/main.py` 的 `_AUTH_EXEMPT_PREFIXES`（`/health`、`/ui`、`/editor-beta`、`/auth/login-lite` 等）。其它 API 未登录返回 401，前端会弹登录。

---

## 核心业务

### 模板发现

`GET /templates`：

1. 拉 Penpot 全部 team
2. 项目名含「模板」
3. 文件名也含「模板」
4. 文件内每个顶层 frame 变成一块画板
5. 文件名含「特殊品」→ `is_special`；同时含「完整」→ `is_special_full`

一个 Penpot 文件 = 左侧一张模板卡，文件内多个 frame = 该模板的多画板。

### Slot 命名

图层名以 `slot/` 开头（中间空格会被去掉）：

```
slot/{组}/{字段}
```

| 图层 | 含义 |
|---|---|
| `slot/product_1/image` | 图库根目录按 SKU 找图 |
| `slot/product_1/image_white` | `White_Base/{SKU}` |
| `slot/product_1/image_png` | `PNG/` |
| `slot/product_1/banner` / `poster` | 仅完整特殊品 |
| `slot/product_1/name` | 全文案 |
| `slot/product_1/name_1` / `name_2` | 按最后一个空格切开 |
| `slot/product_1/time` / `time_month` / `time_hour` / `time_c` | 时间展开字段 |
| `slot/variant_a/1`、`/2` | 变体显隐开关 |

解析在 `penpot_client.parse_slots()`。合成时找不到图或文字为空会隐藏该层。

### 普通合成

`compose.py`。所有合成（含特殊品）共用 `_compose_sem`，因为 Penpot 导出不能并行写。提交变更后会走 `penpot_browser_refresh` 刷一次布局再导出。

### 智能铺货

`smart_distribute.py`，规则解析，不调 LLM，也不读 `template_rules.json`。Excel 黄底 = patch，否则 full。详见 `KNOWLEDGE.md`。

---

## 特殊品合成

两条独立接口，前端按中文逗号拆 `SKU，文案，时间`：

- `/特殊品` → `POST /special-compose`
- `/特殊品（完整）` → `POST /special-compose-full`

`special_flows.json` 只描述普通特殊品字段；完整版前端写死同一套三字段。

### 变体

至少两个版本标记才会进入多版本导出。只放一个 `slot/variant_a/1` **不会**出两版。

「版本 1 隐藏某组、版本 2 显示」需要一对：

```
slot/variant_抢购/1    ← 空白占位（1×1 即可）
slot/variant_抢购/2    ← 真正要开关的组
```

名字必须挂在组本身上。普通特殊品里 `variant_*` 只做显隐；完整版里 `slot/variant_a/name` 会填字且不参与版本切换。同一画板不要混多组 `variant_*`（完整版会拆成多次导出）。

### 导出文件名与格式

磁盘始终是 `output/results/{job_id}/frame_0.png`（有变体则 `frame_0_v1.png`）。业务名只在下载 zip 时套上，规则在 `backend/main.py` 的 `FRAME_NAME_OVERRIDES` / `FRAME_EXPORT_FORMATS`，普通版和完整版各有一份，改要两处一起改。

公式：`{前缀}{版本后缀}.{格式}`

- 无变体：无后缀
- `_v1` → `_版本1`

| 画板名（须完全一致） | zip 内文件名 | 格式 |
|---|---|---|
| `尖货轮播-PC-1` | `{SKU}{_版本N}.png` | png |
| `尖货轮播-PC-2` | `{SKU}-1{_版本N}.png` | png |
| `sku` | `{SKU}{_版本N}.png` | png |
| `sku-1` | `{SKU}-1{_版本N}.png` | png |
| `首页SKU` / `首页 SKU` | `首页{SKU}{_版本N}.png` | png |
| `首页SKU-1` / `首页 SKU-1` | `首页{SKU}-1{_版本N}.png` | png |
| `分类页` | `{SKU}_分类页{_版本N}.png` | png |
| `尖货轮播-横版-1/2` | `{SKU}_{画板名}{_版本N}.png` | png |
| 其它画板 | `{SKU}_{画板名}{_版本N}.jpg` | jpg（白底压透明，quality 92） |

画板名对不上表就走默认 JPG。zip 包名：普通 `{SKU}.zip`，完整 `{SKU}_完整.zip`。

---

## AI 生图

`backend/ai_image.py`。`AI_IMAGE_PROVIDER=auto` 时智能路由在 APIMart → CLIProxy → adobe2api 间切线，用户无感。单线路失败会记失败并换线；任务已被上游接受后的失败按 Ambiguous 处理，避免重复出图。

模型入口：

- GPT Image 2 → `gpt-image-2`
- Nano Banana Pro → `gemini-3-pro-image-preview`

参考图：附件最多 4 张；prompt 里 `[SKU]` 会抽本地白底图。也支持 `@参考图` 标签，后端再转成模型能懂的编号。

结果目录：`output/ai-images/{user_id}/{YYYY-MM-DD}/`。前端轮询 `GET /ai-image/{job_id}`。幂等键是 `client_request_id`，防止自动重试打出两张。

---

## 画布

`frontend/src/Canvas.jsx` 用 iframe 加载 `/editor-beta/index.html`，避免主站 React 污染 tldraw store。

**高度**：Canvas 必须是外层 grid 的直接子项，中间不能包 wrapper，否则 track 高度传不下来（历史上会表现为出图很久画布仍是白的）。

**灵感面板**：不能用 grid wrapper 盖住画布。用 `position: fixed`，JS 跟 `getBoundingClientRect`。瀑布流用手写「插最短列」，不要用 CSS `column-count`。

**快照**：`POST/GET /editor/snapshot`，按用户隔离，带 `revision`。409 时必须拉服务端最新快照，禁止抬 revision 后原样重试（会把空画板写进库）。快照里出现其它用户的图也会 409。

画布工具条（`editor-lab-tldraw/src/App.tsx`）：

- 批量下载选中图
- 高清放大（`UPSCALE_CLI_PATH`）
- 转 SVG（vtracer）
- 转 PSD（Kie 分层；`KIE_API_KEY` 为空则不可用）

改画布源码后必须 `npm run build`，提交时带上 `dist/`。

---

## 后台管理

管理员从顶栏进。主要看：

- 运营概览、任务列表、用户 CRUD / 重置密码
- 测试账号隔离
- 订阅线路探测记录
- 操作审计 `operation_logs`

接口都在 `/admin/*`。

---

## 主要 HTTP 端点

完整列表以 `/docs` 为准。维护时常用：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` `/health/deep` | 本地 / 上游探测 |
| POST | `/auth/login-lite` | 登录 |
| GET | `/templates` `/template-groups` | 模板 |
| POST | `/compose` | 普通合成 |
| POST | `/special-compose` `/special-compose-full` | 特殊品 |
| GET | `/special-compose/{id}/download-zip` | zip（文件名/格式规则在这里） |
| POST | `/parse-table` | 表格解析 |
| POST | `/smart-distribute` | 智能铺货 |
| POST | `/ai-image` | 生图 |
| GET | `/ai-image/{id}` | 生图轮询 |
| POST | `/ai-image/retry` | 智能重试 |
| POST | `/ai-image/upscale` `/vectorize` `/layer-extract` | 画布后处理 |
| GET/POST | `/editor/snapshot` | 画布持久化 |
| GET/POST | `/inspiration` | 灵感 |
| GET | `/admin/overview` `/admin/users` | 后台 |
| POST | `/chat` | 对话（注入 `KNOWLEDGE.md`） |

静态挂载：`/ui`、`/editor-beta`、`/results`、`/ai-images`、`/output`、`/product-library`、`/avatars`。`compiled/` 与画布 `assets/` 是长期缓存；`index.html` 是 `no-cache`。

---

## 数据库

`jobs.db`，启动时 `init_db()` 建表，缺列用 `ALTER TABLE ... ADD COLUMN` 容错，可重复执行。

| 表 | 用途 |
|---|---|
| `jobs` / `special_jobs` | 合成任务 |
| `ai_image_jobs` | 生图任务 |
| `ai_chat_sessions` / `ai_chat_messages` | 生图会话历史 |
| `editor_snapshots` | 画布 JSON + revision |
| `users` / `sessions` | 账号与登录态 |
| `inspiration_posts` / `inspiration_favorites` | 灵感；`job_id` 有 UNIQUE |
| `agent_projects` / `agent_messages` / `agent_images` | Agent |
| `operation_logs` | 审计 |
| `service_probes` / `admin_alert_acknowledgements` | 后台探测与告警 |

内存里还有 `_jobs` 字典给进行中的合成用，重启后进行中任务会丢，历史靠 SQLite。

灵感缩略图：`output/ai-images/{user_id}/thumbs/{job_id}.webp`（约 480px）。前端瀑布流不要暴露原图 URL。

---

## 测试

`backend/test_*.py` 是 `unittest`，不依赖真实 Penpot / 外网（用临时 sqlite + mock）。

```bash
# 仓库根目录
python -m unittest backend.test_smart_routing backend.test_admin_console
python -m unittest discover -s backend -p "test_*.py"
```

改智能路由、分层 PSD、画布 snapshot、后台账号时，至少跑对应那几个文件。

---

## Git 与发布

- 默认分支 `master`。远程 hook 拦截直接 push master，走 PR。
- 不要提交 `.env`、`login_users.json`、`jobs.db`、真实 license / API key。
- 改 JSX 后把新的 `frontend/compiled/app-*.js` 和更新过的 `frontend/index.html` 一起提交，否则别人拉下来还是旧 UI。
- 改画布后把 `editor-lab-tldraw/dist/` 一起提交。
- 更新弹窗：改 `frontend/whats-new.json`（及可选 `frontend/changelog.html`）。
- 对话里的产品说明改完要同步 `KNOWLEDGE.md`，否则线上助手还在说旧流程。

正式机：后端直接 serve `frontend/` + `editor-lab-tldraw/dist/`。环境变量、图库 UNC、Gigapixel 路径按机器改 `.env`。

---

## 排错

| 现象 | 先查 |
|---|---|
| `/ui` 还是旧界面 | 没跑 `frontend/build.py`，或跑了没提交 `compiled/` |
| 画布白屏 / 高度为 0 | Canvas 被包进 wrapper；或没 build `editor-lab-tldraw` |
| 模板列表空 | Penpot 没起、token 失效、项目/文件名不含「模板」；可看 `/debug/team-scan` |
| 特殊品 zip 变成 JPG / 文件名不对 | 画板名和 `FRAME_*` 字典差一个空格或用了别的中文 |
| 变体只出一张 | 只有一个 `slot/variant_x/N`，需要成对 `/1` `/2` |
| 图库找不到图 | SKU 与文件名不完全一致；或类型目录不在 `IMAGE_TYPE_FOLDERS` |
| UNC 极慢 | 有人在热路径 `iterdir()` 了，应改回 `exists()` |
| 生图 500 | `load_ai_image_job` 字段和表结构不一致；看后端日志 |
| 画布保存后丢图 | 409 后不要抬 revision 重试空快照；应对齐服务端 revision |
| 转 PSD / 放大灰掉 | `KIE_API_KEY` 或 `UPSCALE_CLI_PATH` 为空 |
| 登录后立刻被踢 | `password_hash` 变了，旧 cookie 失效，重新登录即可 |

---

## 相关文档

| 文件 | 给谁看 |
|---|---|
| `KNOWLEDGE.md` | 注入 LLM 的产品说明，改功能后要同步 |
| `CLAUDE.md` / `AGENTS.md` | 给 AI 助手的仓库指南（部分段落可能落后于本 README） |
| `special_flows.json` | 特殊品字段 |
| `slot_schema.json` | 普通合成列别名 |
| `.env.example` | 环境变量全集 |
| `design-tool-prd.md` / `IDEAS.md` | 早期需求与债，以代码为准 |

用户操作说明优先改 `KNOWLEDGE.md`。维护约定优先改本 README。

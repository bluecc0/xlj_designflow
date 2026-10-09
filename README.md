# DesignFlow

DesignFlow 是面向电商设计生产的本地 Web 工具：通过对话、Penpot 模板、本地产品图库和 AI 生图，生成商品海报、特殊品多画板结果和可继续编辑的无限画布素材。

正式入口：`http://localhost:8000/ui`。仓库：[bluecc0/xlj_designflow](https://github.com/bluecc0/xlj_designflow)

## 维护原则

1. 区分源码、构建产物和运行数据。源码需要提交，运行数据、密钥和本机日志不能提交。
2. 主 UI、当前画布和旧 tldraw 画布是独立构建目标，改哪一边就重建哪一边。
3. `8000` 是正式入口；`8003` 只用于隔离测试，不应作为正式用户入口。
4. 8000 和 8003 不得同时写同一个 SQLite 文件。`jobs.db` 不通过 Git 同步。
5. 构建成功不等于运行时安全。前端改动还要做 bundle 语法、`no-undef` 和浏览器关键路径检查。
6. 本文件记录维护约定，`KNOWLEDGE.md` 记录当前产品行为和用户操作。

## 架构和目录

| 目录/文件 | 维护职责 |
|---|---|
| `backend/` | FastAPI、业务流程、任务轮询和 SQLite |
| `backend/main.py` | 路由、认证、静态挂载、后台任务 |
| `backend/job_store.py` | 任务、会话、快照、账号、审计和备份 |
| `backend/compose.py` | 普通 Penpot 合成 |
| `backend/special_compose.py` | 普通特殊品合成 |
| `backend/special_compose_full.py` | 完整特殊品合成，支持场景图 |
| `backend/ai_image.py` | 生图适配器和智能路由 |
| `frontend/src/` | 主 UI JSX 源码 |
| `frontend/build.py` | JSX 编译和内容哈希 bundle 生成器 |
| `frontend/compiled/` | 当前生效的主 UI bundle |
| `editor-canvas/` | 当前主画布，挂载 `/editor-canvas/` |
| `editor-lab-tldraw/` | 旧 tldraw 画布，挂载 `/editor-beta/` |
| `ensure_ui_build.py` | 启动前检查并重建前端和画布 |
| `special_flows.json` | 特殊品字段流程配置 |
| `slot_schema.json` | 普通合成字段别名和列映射 |

正式主线使用 `editor-canvas`。`editor-lab-tldraw` 只用于兼容、回归或旧实现验证，修改其中一边不会自动更新另一边。

## 启动与端口

正式服务：

```powershell
.venv\Scripts\python.exe -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

Windows 推荐复制 `start.example.bat` 为本机的 `start.bat` 后启动。常用地址：`/ui`、`/docs`、`/health`、`/health/deep`，完整地址均以 `http://localhost:8000` 为前缀。

8003 仅用于新画布或分支预览，使用 `start-preview-8003.ps1`。必须使用独立测试数据或只读数据，不能与 8000 共同写 `jobs.db`。正式迁移应合并源码到 `master`，在正式目录重建，停止旧服务后启动 8000，而不是长期维护两个正式项目。

## 构建规则

修改 `frontend/src/*.jsx` 后：

```powershell
.venv\Scripts\python.exe frontend\build.py
```

该命令按 `frontend/build.py` 的 `BABEL_FILES` 编译 `frontend/compiled/app-<hash>.js`，更新 `frontend/index.html` 并删除旧 bundle。新增 JSX 文件时必须加入 `BABEL_FILES`。`frontend/src/api.js` 是普通脚本，修改后刷新浏览器即可。

修改当前画布后：

```powershell
cd editor-canvas
npm install
npm run build
cd ..
```

修改旧 tldraw 画布后，在 `editor-lab-tldraw` 目录执行同样的 `npm install` 和 `npm run build`。产物分别是两个目录下的 `dist/`。

启动前检查或强制重建：

```powershell
.venv\Scripts\python.exe ensure_ui_build.py
.venv\Scripts\python.exe ensure_ui_build.py --force
```

前端改动后还要运行 `node --check` 检查当前 bundle，使用 `no-undef` 扫描，并实际打开 `/ui` 覆盖登录、空状态、生成中、已完成、特殊品参数面板和右侧画布。Babel 构建不会发现组件状态分支中的自由变量错误。

## 环境配置

复制 `.env.example` 为 `.env`。`.env`、`login_users.json`、数据库、图库路径和 API key 均为本机配置，不提交。

| 变量 | 用途 |
|---|---|
| `PENPOT_BASE_URL` | Penpot 服务地址 |
| `PENPOT_EMAIL` / `PENPOT_PASSWORD` | Penpot RPC 登录 |
| `PRODUCT_LIBRARY_PATH` | 产品图库根目录，可为 UNC |
| `OUTPUT_PATH` | 结果图和任务文件目录 |
| `LOGIN_USERS_PATH` | 登录账号 JSON |
| `AI_IMAGE_PROVIDER` | 生图线路，通常为 `auto` |
| `AI_IMAGE_BASE_URL` / `AI_IMAGE_API_KEY` | APIMart 默认线路 |
| `CLIPROXY_BASE_URL` / `CLIPROXY_API_KEY` | 订阅线路 |
| `ADOBE2API_BASE_URL` / `ADOBE2API_API_KEY` | Adobe 兼容线路 |
| `KIE_API_KEY` | PSD 分层能力 |
| `UPSCALE_CLI_PATH` | 本地高清放大 CLI |
| `AGENT_SKILL_PATHS` | Skill 搜索路径，Windows 用 `;` |
| `PROXY_DOWNLOAD_*` | 花瓣下载中继配置 |

不要把真实 key 写进源码、示例 env、README 或日志。

## 数据与备份

正式数据默认是根目录 `jobs.db`。后端会幂等建表并做缺列迁移，保存任务、会话、画布快照、灵感、Agent 和审计日志。

不要用 Git 提交或回滚 `jobs.db`，不要让 8000 和 8003 同时打开同一个数据库，不要在服务运行时直接复制数据库，也不要用测试数据库覆盖正式数据库。

后端启动后每天创建一次 SQLite 一致性备份到 `backups/`，最多保留 3 份。恢复前先停服务并保留当前数据库副本。画布快照按用户和页面隔离并带 `revision`；发生 409 时应读取服务端最新快照，不得抬高 revision 后把空画布写回。新画布对旧数据是单向迁移，旧版不支持的涂鸦等内容可能丢失，迁移前必须备份。

## 主要业务边界

- 登录使用用户名 + 密码，账号来自 `login_users.json`；`admin` 可进入后台，测试账号应设置 `is_test=true`。
- `backend/compose.py` 负责普通 Penpot 合成；Penpot 写入和导出共用 `_compose_sem`，不要绕过串行锁。
- `backend/ai_image.py` 处理 GPT Image 2.5、Nano Banana Pro、参考图、轮询、失败分类和线路切换。上游已接受但状态不明时不要立即重复提交。
- `backend/smart_distribute.py` 是规则解析器，不调用 LLM，也不依赖历史 `template_rules.json`。

## 模板与特殊品

`GET /templates` 从 Penpot 查找项目名和文件名包含“模板”的资源。文件中的 frame 会成为模板画板；特殊品文件识别为 `is_special` / `is_special_full`。

常见 slot：`slot/product_1/image_white`、`slot/product_1/name`、`slot/product_1/name_1`、`slot/product_1/time_4`、`slot/product_1/banner`、`slot/product_1/poster`、`slot/product_1/poster1`、`slot/variant_a/1`、`slot/variant_a/2`。

`poster1` 表示在 `场景图/Poster/` 查找 `{SKU}_1`，不是普通 `poster` 的别名。图片目录映射以 `backend/config.py` 的 `IMAGE_TYPE_FOLDERS` 为准。

特殊品输入格式：`SKU，产品名称，发售时间`。自动线路会调用 `/special-compose/detect?sku=...`，检查 `Banner`、`Poster`、`Poster1`：找到任意场景素材就提交 `/special-compose-full`，全部找不到就提交 `/special-compose`，检测失败则记录日志并按普通流程继续。日志必须保留检查步骤、找到的素材和最终线路，自动、普通、完整三个按钮必须互斥高亮。

## 画布维护

主 UI 通过 `frontend/src/Canvas.jsx` 加载 `/editor-canvas/index.html`。结果图、特殊品结果和上传素材可以放入画布继续排版。当前画布支持高清放大、转 SVG、转 PSD / 图层分离、图片上编辑和快速生图；每项能力依赖不同 CLI、provider 或 key。

出现“画板已在其他页面更新，当前内容未被覆盖”时，关闭重复页面后刷新，不要强行提高 revision 覆盖服务端内容。

## 测试与发布

后端测试：

```powershell
.venv\Scripts\python.exe -m unittest discover -s backend -p "test_*.py"
```

按改动范围优先运行 `backend.tests.test_special_compose_detect`、`backend.tests.test_smart_routing` 和 `backend.tests.test_editor_snapshot_isolation`。提交前执行 `git status --short` 和 `git diff --check`。

允许提交源码、测试、文档和经验证的 `frontend/compiled/`、`editor-canvas/dist/`、`editor-lab-tldraw/dist/`。禁止提交 `.env`、真实 key、`login_users.json`、`jobs.db`、`backups/`、`output/`、图库、模型、本机日志和 `frontend/whats-new.json`。

推荐同步流程：`git fetch origin master`，检查工作区和差异，修改并测试后 `git add`、`git commit`、`git push origin master`，最后比较 `git rev-parse HEAD` 与 `git rev-parse origin/master`。远程有提交时先 review 再 pull；有未提交改动时不要直接 pull 覆盖。

## 排障顺序

1. 确认访问的端口和服务实际加载的目录。
2. `/ui` 旧：检查 `frontend/index.html` 的 bundle 是否存在，重新执行 `frontend/build.py`。
3. 画布旧或白屏：确认加载的是 `/editor-canvas/`，再检查对应 `dist/`。
4. 页面空白：先看 Console 第一个异常，再做 `node --check` 和 `no-undef`。
5. 模板为空：检查 Penpot、账号、模板命名和 `/health/deep`。
6. 特殊品异常：看 Banner / Poster / Poster1 检测日志和对应 endpoint 的 `progress`。
7. 画布丢图或串图：检查用户隔离、snapshot revision、图片 URL 和 409 处理。
8. 放大或 PSD 失败：检查对应 CLI / provider key、任务轮询和后端日志。
9. 本地远程不一致：`git fetch` 后比较 `HEAD` 与 `origin/master`。

## 相关文档

| 文件 | 用途 |
|---|---|
| `KNOWLEDGE.md` | 对话模型使用的产品行为和用户操作说明 |
| `AGENTS.md` | 开发代理约束 |
| `.env.example` | 环境变量模板 |
| `special_flows.json` | 特殊品字段定义 |
| `slot_schema.json` | 普通合成列别名和字段规则 |
| `backend/tests/` | 后端回归测试 |
| `IDEAS.md` | 历史技术债，不作为当前行为依据 |

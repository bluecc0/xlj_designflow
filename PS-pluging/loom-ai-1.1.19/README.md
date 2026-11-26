# Loom AI

一个基于 CEP 的 Photoshop 面板插件，用于在 Photoshop 中输入提示词，结合当前选区参考图或整张画布尺寸，调用 `yunwu.ai` 的 `gemini-3-pro-image-preview` 模型生成图片，并将结果回写到目标文档图层。

## 当前实现

- 极简中文面板 UI
- Prompt 输入与默认智能填充 Prompt
- Photoshop 文档与选区检测
- 有选区时导出选区 PNG 作为参考图
- 通过 `POST /v1/chat/completions` 调用模型
- 解析返回的图片 URL 或 base64 数据
- 将结果插回原始 Photoshop 文档的新图层
- 生成过程状态提示与可展开日志
- 开发用软连接脚本，避免重复拷贝插件

## 当前网关配置

- Base URL: `https://yunwu.ai/v1`
- Model: `gemini-3-pro-image-preview`
- Endpoint: `POST /v1/chat/completions`

请求方式已切换为同步聊天接口，不再使用旧的：

- `/v1/images/generations`
- `/v1/tasks/{task_id}`

## 参考图逻辑

有选区时：

- Photoshop 导出当前选区范围为临时 PNG
- 面板将其转成 `data:image/png;base64,...`
- 通过多模态 `messages` 发送给模型

无选区时：

- 不发送参考图
- 使用当前画布尺寸作为提示信息的一部分

## 回贴逻辑

- 生成结果会回到提交时记录的原始 Photoshop 文档
- 即使用户中途切换到别的画布，也不会贴错文档
- 返回图会按等比例缩放并居中对齐，避免强行拉伸变形

## 项目结构

```text
CSXS/manifest.xml
client/index.html
client/styles.css
client/app.js
host/main.jsx
assets/
scripts/install-dev.ps1
scripts/uninstall-dev.ps1
```

## 开发安装

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\install-dev.ps1
```

脚本会：

1. 打开常见 `CSXS` 版本的 `PlayerDebugMode`
2. 在 `%APPDATA%\Adobe\CEP\extensions\com.loom.ai.painter` 创建软连接
3. 将软连接指向当前项目目录

移除开发软连接：

```powershell
.\scripts\uninstall-dev.ps1
```

## 更新分发

局域网更新目录：
`\\192.168.150.52\素材库\工具\loom`

发布新版本：

```powershell
.\scripts\publish-update.bat
```

面板启动时会自动读取：
`\\192.168.150.52\素材库\工具\loom\latest.json`

如果检测到新版本，会自动下载安装并提示关闭后重新打开 Loom AI 面板。

## 在 Photoshop 中打开

安装插件后，打开：

`窗口 > 扩展（旧版） > Loom AI`

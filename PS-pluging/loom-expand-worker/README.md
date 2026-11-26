# Loom Expand Worker（Windows 常驻正版订阅机）

独立部署在常驻 Windows 正版 Photoshop 机器上的 CEP Worker 插件，通过反向 WebSocket 连接 DesignFlow FastAPI（`/api/v1/expand/worker`），串行消费全团队 Loom AI 客户端提交的生成式扩展任务。

## 1. Phase 1 Spike 验证（必做）
1. 在 Windows 订阅机打开正版 Photoshop，随意打开一张测试图；
2. 菜单栏：`文件 > 脚本 > 浏览...`，选择 `spike/test_generative_expand.jsx` 运行；
3. 检查桌面 `ps-expand-spike-out/` 是否输出 `spike_v0.jpg`、`spike_v1.jpg`、`spike_v2.jpg`；
4. 若当前 PS 小版本的 `syntheticFill` 或 `setVariation` 报错，启用 Adobe `ScriptingListener` 插件手动录制一次「生成式扩展」并替换 `host/main.jsx` 中的 `_executeGenerativeFillDescriptor` / `_selectVariationIndex`。

## 2. 安装 Worker 插件
```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\install-dev.ps1
```
重启 Photoshop，打开 `窗口 > 扩展（旧版） > Loom Expand Worker`，停靠在右侧工作区，填入：
- **FastAPI 服务地址**：如 `http://192.168.150.52:8000`
- **Worker ID**：如 `win-ps-01`
- **Worker Secret**：与后端 `.env` 中 `PS_EXPAND_WORKER_SECRET` 一致（默认 `loom-expand-dev-secret`）

## 3. 启动 Watchdog 守护（开机自启）
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\watchdog.ps1
```
> 运维注意：请勿用 Windows 自带 RDP 远程连接后直接点右上角关闭（会锁屏挂起 GUI 导致 PS 卡死），建议使用 RustDesk / AnyDesk / VNC 维护。

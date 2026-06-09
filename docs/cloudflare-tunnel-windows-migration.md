# Cloudflare Tunnel 公网入口迁移到 Windows 正式机

本文只描述“公网入口”迁移，不包含 DesignFlow 项目运行环境部署。

目标是把当前开发机上的 Cloudflare Tunnel 迁移到 Windows 正式机，让公网域名继续访问正式机本地服务。

## 当前公网链路

```text
用户访问 https://test.loomai.chat/ui
        ↓
Cloudflare DNS / HTTPS
        ↓
Cloudflare Tunnel: designflow-test
        ↓
开发机 cloudflared
        ↓
http://127.0.0.1:8000
```

## 迁移后公网链路

```text
用户访问 https://test.loomai.chat/ui
        ↓
Cloudflare DNS / HTTPS
        ↓
Cloudflare Tunnel: designflow-test
        ↓
Windows 正式机 cloudflared
        ↓
http://127.0.0.1:8000
```

Cloudflare 后台、域名、Tunnel、DNS 路由都可以沿用，不需要重新创建。

## 当前 Tunnel 信息

```text
Tunnel 名称: designflow-test
Tunnel ID: 9f564ea5-347e-4e10-b6b7-00463d124426
当前测试域名: test.loomai.chat
本地服务地址: http://127.0.0.1:8000
```

当前开发机配置文件：

```text
/Users/xuduo/.cloudflared/designflow-test.yml
```

当前开发机 Tunnel 凭证：

```text
/Users/xuduo/.cloudflared/9f564ea5-347e-4e10-b6b7-00463d124426.json
```

> 注意：`*.json` 是 Tunnel 凭证，等同于这条 Tunnel 的访问密钥，不要提交到 Git，不要发给无关人员。

## 1. Windows 正式机安装 cloudflared

在 Windows PowerShell 执行：

```powershell
winget install Cloudflare.cloudflared
```

验证安装：

```powershell
cloudflared --version
```

如果 `winget` 不可用，也可以从 Cloudflare 官方下载 `cloudflared.exe`，放到一个固定目录，并加入系统 `PATH`。

## 2. 复制 Tunnel 凭证和配置

在 Windows 正式机创建目录：

```powershell
mkdir $env:USERPROFILE\.cloudflared
```

从开发机复制以下文件到 Windows：

```text
/Users/xuduo/.cloudflared/9f564ea5-347e-4e10-b6b7-00463d124426.json
/Users/xuduo/.cloudflared/designflow-test.yml
```

放到 Windows：

```text
C:\Users\<Windows用户名>\.cloudflared\9f564ea5-347e-4e10-b6b7-00463d124426.json
C:\Users\<Windows用户名>\.cloudflared\designflow-test.yml
```

`cert.pem` 通常不需要复制。运行已有 Tunnel 只需要 Tunnel credentials json。

## 3. 修改 Windows 配置文件

编辑：

```text
C:\Users\<Windows用户名>\.cloudflared\designflow-test.yml
```

内容改成：

```yaml
tunnel: 9f564ea5-347e-4e10-b6b7-00463d124426
credentials-file: C:\Users\<Windows用户名>\.cloudflared\9f564ea5-347e-4e10-b6b7-00463d124426.json
protocol: http2

ingress:
  - hostname: test.loomai.chat
    service: http://127.0.0.1:8000
  - service: http_status:404
```

如果以后要直接使用根域名，把 hostname 改成：

```yaml
hostname: loomai.chat
```

同时需要把 Cloudflare DNS 路由也改到根域名。

## 4. 确认正式机本地服务可访问

在 Windows 正式机本机浏览器打开：

```text
http://127.0.0.1:8000/ui
```

并测试健康检查：

```powershell
curl http://127.0.0.1:8000/health
```

必须先保证本地地址正常，再启动公网 Tunnel。

## 5. 停止开发机上的 cloudflared

迁移时不要让开发机和正式机同时运行同一个 Tunnel。

开发机停止方式：

```bash
pkill cloudflared
```

或者在正在运行的 tunnel 终端里按：

```text
Ctrl+C
```

原因：同一个 Tunnel 可以有多个 connector，但如果开发机和正式机同时接入，Cloudflare 可能把流量分发到两边，导致访问到错误环境。

## 6. Windows 正式机启动 Tunnel

在 Windows PowerShell 执行：

```powershell
cloudflared tunnel --config $env:USERPROFILE\.cloudflared\designflow-test.yml run designflow-test
```

看到类似下面日志说明连接成功：

```text
Registered tunnel connection
```

然后测试公网：

```text
https://test.loomai.chat/ui
https://test.loomai.chat/health
```

## 7. 代理绕过规则

如果 Windows 正式机需要开启代理，建议让 `cloudflared.exe` 直连，不要走代理。

代理软件里添加进程绕过：

```text
cloudflared.exe
```

或者添加域名绕过：

```text
*.argotunnel.com
region1.v2.argotunnel.com
region2.v2.argotunnel.com
api.cloudflare.com
*.cloudflare.com
*.cloudflareaccess.org
```

如果用命令行临时启动，可以清理代理环境变量：

```powershell
Remove-Item Env:HTTP_PROXY -ErrorAction SilentlyContinue
Remove-Item Env:HTTPS_PROXY -ErrorAction SilentlyContinue
Remove-Item Env:ALL_PROXY -ErrorAction SilentlyContinue
Remove-Item Env:http_proxy -ErrorAction SilentlyContinue
Remove-Item Env:https_proxy -ErrorAction SilentlyContinue
Remove-Item Env:all_proxy -ErrorAction SilentlyContinue

cloudflared tunnel --config $env:USERPROFILE\.cloudflared\designflow-test.yml run designflow-test
```

## 8. 设置开机自启

测试确认公网可用后，再设置 Windows 开机自启。

推荐使用 Windows 任务计划程序，启动命令：

```powershell
cloudflared tunnel --config C:\Users\<Windows用户名>\.cloudflared\designflow-test.yml run designflow-test
```

建议任务设置：

```text
触发器: 用户登录时，或系统启动时
运行用户: 正式机常用服务账号
权限: 使用最高权限运行
失败重试: 间隔 1 分钟，重试 3 次以上
```

## 9. 切换到根域名 loomai.chat（可选）

如果不想使用 `test.loomai.chat`，可以改成根域名：

```text
https://loomai.chat/ui
```

需要执行：

```bash
cloudflared tunnel route dns designflow-test loomai.chat --overwrite-dns
```

然后把配置文件改成：

```yaml
ingress:
  - hostname: loomai.chat
    service: http://127.0.0.1:8000
  - service: http_status:404
```

再重启 tunnel。

注意：根域名会被 DesignFlow 占用。如果以后要做官网，建议使用：

```text
app.loomai.chat
```

## 10. 回滚方案

如果 Windows 正式机 tunnel 失败，可以回滚到开发机：

1. 停止 Windows 正式机 cloudflared。
2. 在开发机重新启动：

```bash
cloudflared tunnel --config ~/.cloudflared/designflow-test.yml run designflow-test
```

3. 访问：

```text
https://test.loomai.chat/ui
```

DNS 和 Cloudflare Tunnel 不需要重新配置。

## 迁移检查清单

```text
[ ] Windows 正式机本地 http://127.0.0.1:8000/ui 可访问
[ ] Windows 正式机本地 /health 正常
[ ] 已复制 Tunnel credentials json
[ ] 已修改 Windows designflow-test.yml credentials-file 路径
[ ] 开发机 cloudflared 已停止
[ ] Windows cloudflared 已启动并显示 Registered tunnel connection
[ ] https://test.loomai.chat/ui 可访问
[ ] https://test.loomai.chat/health 正常
[ ] 代理软件已设置 cloudflared.exe 直连
[ ] 已设置 Windows 开机自启
```

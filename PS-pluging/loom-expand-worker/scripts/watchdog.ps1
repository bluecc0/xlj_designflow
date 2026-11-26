<#
.SYNOPSIS
    Loom Expand Worker 守护脚本（Watchdog）
.DESCRIPTION
    每 15 秒巡检一次：
      1. 检查 Photoshop.exe 是否运行，若不在则自动启动；
      2. 读取 %TEMP%\ps-expand\heartbeat.json：
         - 连续 90 秒无心跳更新（假死或弹出未捕获模态框）
         - 或单个 task_id 执行超过 120 秒未结束
         触发强杀 Photoshop.exe -> 等待 5 秒 -> 重新拉起。
#>
param(
    [string]$PhotoshopExe = "",
    [int]$PollIntervalSec = 15,
    [int]$HeartbeatTimeoutSec = 90,
    [int]$TaskTimeoutSec = 120,
    [string]$LogDir = (Join-Path $PSScriptRoot "..\logs")
)

$ErrorActionPreference = "Continue"

function Resolve-PhotoshopExe {
    param([string]$ExplicitPath)
    if ($ExplicitPath -and (Test-Path $ExplicitPath)) { return $ExplicitPath }
    $candidates = Get-ChildItem "C:\Program Files\Adobe\Adobe Photoshop*\Photoshop.exe" -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending
    if ($candidates -and $candidates.Count -gt 0) {
        return $candidates[0].FullName
    }
    throw "未找到 Photoshop.exe，请通过 -PhotoshopExe 参数显式指定路径。"
}

$PsExePath = Resolve-PhotoshopExe -ExplicitPath $PhotoshopExe
$HeartbeatFile = Join-Path $env:TEMP "ps-expand\heartbeat.json"

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}
$LogFile = Join-Path $LogDir "watchdog.log"

function Write-WatchdogLog {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Write-Host $line
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
    # 简单滚动：超过 5MB 归档为 .1
    try {
        if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt 5MB)) {
            Move-Item -Path $LogFile -Destination "$LogFile.1" -Force
        }
    } catch {}
}

function Restart-Photoshop {
    param([string]$Reason)
    Write-WatchdogLog "触发恢复重启：$Reason"
    try {
        & taskkill /F /IM Photoshop.exe 2>&1 | Out-Null
    } catch {}
    Start-Sleep -Seconds 5
    # 清理旧心跳防止刚拉起立刻再次触发重启
    try { if (Test-Path $HeartbeatFile) { Remove-Item $HeartbeatFile -Force } } catch {}
    Start-Process -FilePath $PsExePath
    Write-WatchdogLog "已重新拉起 Photoshop：$PsExePath"
    # 给 PS 45 秒冷启动宽限期
    Start-Sleep -Seconds 45
}

Write-WatchdogLog "Watchdog 启动。PS=$PsExePath, Heartbeat=$HeartbeatFile"

while ($true) {
    $psProc = Get-Process -Name "Photoshop" -ErrorAction SilentlyContinue
    if (-not $psProc) {
        Write-WatchdogLog "检测到 Photoshop 未运行，正在拉起..."
        Start-Process -FilePath $PsExePath
        Start-Sleep -Seconds 45
        continue
    }

    if (Test-Path $HeartbeatFile) {
        try {
            $hb = Get-Content -Path $HeartbeatFile -Raw -Encoding UTF8 | ConvertFrom-Json
            $nowUnix = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
            $hbAge = $nowUnix - [long]($hb.ts)
            if ($hbAge -gt $HeartbeatTimeoutSec) {
                Restart-Photoshop -Reason "心跳超时 ${hbAge}s（超过 ${HeartbeatTimeoutSec}s），task_id=$($hb.task_id)"
                continue
            }
            if ($hb.busy -and $hb.task_started_at) {
                $taskElapsed = $nowUnix - [long]($hb.task_started_at)
                if ($taskElapsed -gt $TaskTimeoutSec) {
                    Restart-Photoshop -Reason "单任务执行超时 ${taskElapsed}s（超过 ${TaskTimeoutSec}s），task_id=$($hb.task_id)"
                    continue
                }
            }
        } catch {
            Write-WatchdogLog "读取 heartbeat.json 异常：$($_.Exception.Message)"
        }
    }

    Start-Sleep -Seconds $PollIntervalSec
}

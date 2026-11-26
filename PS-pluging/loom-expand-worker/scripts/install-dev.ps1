$ErrorActionPreference = "Stop"

$ExtensionId = "com.loom.expand.worker"
$CepRoot = Join-Path $env:APPDATA "Adobe\CEP\extensions"
$LinkPath = Join-Path $CepRoot $ExtensionId
$ProjectRoot = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path $CepRoot)) {
    New-Item -ItemType Directory -Path $CepRoot -Force | Out-Null
}

# 开启常见 CSXS 版本的 PlayerDebugMode
foreach ($ver in @("11", "12", "13", "14")) {
    $regPath = "HKCU:\Software\Adobe\CSXS.$ver"
    if (-not (Test-Path $regPath)) {
        New-Item -Path $regPath -Force | Out-Null
    }
    Set-ItemProperty -Path $regPath -Name "PlayerDebugMode" -Value "1" -Type String
}

if (Test-Path $LinkPath) {
    $item = Get-Item $LinkPath -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        cmd /c rmdir "$LinkPath" | Out-Null
    } else {
        throw "目标路径已存在且不是符号链接，请手动清理后重试：$LinkPath"
    }
}

cmd /c mklink /J "$LinkPath" "$ProjectRoot" | Out-Null

Write-Host "✅ Loom Expand Worker 开发链接已创建：$LinkPath -> $ProjectRoot" -ForegroundColor Green
Write-Host "✅ PlayerDebugMode 已开启（CSXS 11-14）" -ForegroundColor Green
Write-Host "请重启 Photoshop，从 窗口 > 扩展（旧版） > Loom Expand Worker 打开面板并停靠在右侧。"

param(
  [string]$ExtensionId = "com.loom.ai.painter",
  [string]$CepRoot = "$env:APPDATA\Adobe\CEP\extensions"
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$linkPath = Join-Path $CepRoot $ExtensionId

if (-not (Test-Path $CepRoot)) {
  New-Item -Path $CepRoot -ItemType Directory -Force | Out-Null
}

$registryVersions = @("11", "12", "13", "14")
foreach ($version in $registryVersions) {
  $registryPath = "HKCU:\Software\Adobe\CSXS.$version"
  if (-not (Test-Path $registryPath)) {
    New-Item -Path $registryPath -Force | Out-Null
  }

  New-ItemProperty -Path $registryPath -Name "PlayerDebugMode" -Value "1" -PropertyType String -Force | Out-Null
}

if (Test-Path $linkPath) {
  $item = Get-Item $linkPath -Force
  $isReparsePoint = ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0

  if (-not $isReparsePoint) {
    throw "Target path already exists and is not a symlink/junction: $linkPath"
  }

  Remove-Item -LiteralPath $linkPath -Force
}

New-Item -ItemType Junction -Path $linkPath -Target $projectRoot | Out-Null

Write-Output "Created development junction: $linkPath -> $projectRoot"
Write-Output "PlayerDebugMode is enabled. Restart Photoshop and open Loom AI Painter from Window > Extensions (Legacy)."

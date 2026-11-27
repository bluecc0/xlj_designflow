param(
  [string]$ExtensionId = "com.loom.ai.painter",
  [string]$CepRoot = "$env:APPDATA\Adobe\CEP\extensions"
)

$ErrorActionPreference = "Stop"

$linkPath = Join-Path $CepRoot $ExtensionId

if (-not (Test-Path $linkPath)) {
  Write-Output "Junction not found: $linkPath"
  exit 0
}

$item = Get-Item $linkPath -Force
$isReparsePoint = ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0

if (-not $isReparsePoint) {
  throw "Target path exists but is not a symlink/junction: $linkPath"
}

Remove-Item -LiteralPath $linkPath -Force
Write-Output "Removed development junction: $linkPath"

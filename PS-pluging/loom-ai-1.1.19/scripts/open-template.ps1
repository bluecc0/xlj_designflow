param(
  [Parameter(Mandatory = $true)]
  [string]$TemplatePath,

  [Parameter(Mandatory = $true)]
  [string]$CopyName
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)

try {
  if (-not (Test-Path -LiteralPath $TemplatePath)) {
    throw "Template file not found: $TemplatePath"
  }

  $extension = [System.IO.Path]::GetExtension($TemplatePath)
  if ([string]::IsNullOrWhiteSpace($extension)) {
    $extension = ".psd"
  }

  $copyFileName = $CopyName
  if ([System.IO.Path]::GetExtension($copyFileName) -ne $extension) {
    $copyFileName = $CopyName + $extension
  }

  $copyPath = Join-Path $env:TEMP $copyFileName
  Copy-Item -LiteralPath $TemplatePath -Destination $copyPath -Force

  $photoshop = New-Object -ComObject Photoshop.Application
  $null = $photoshop.Open($copyPath)

  @{
    ok = $true
    copyPath = $copyPath
    documentName = [System.IO.Path]::GetFileName($copyPath)
  } | ConvertTo-Json -Compress
} catch {
  @{
    ok = $false
    error = $_.Exception.Message
  } | ConvertTo-Json -Compress
}

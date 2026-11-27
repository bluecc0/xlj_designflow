param(
  [Parameter(Mandatory = $true)]
  [string]$HostScriptPath,

  [Parameter(Mandatory = $true)]
  [string]$BannerDir,

  [Parameter(Mandatory = $true)]
  [string]$PosterDir,

  [Parameter(Mandatory = $true)]
  [string]$HorizontalArtboardName,

  [Parameter(Mandatory = $true)]
  [string]$VerticalArtboardName,

  [Parameter(Mandatory = $true)]
  [string]$TemplateMarker
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)

function Escape-JsString {
  param([string]$Value)
  return ($Value -replace "\\", "\\\\" -replace '"', '\"')
}

try {
  if (-not (Test-Path -LiteralPath $HostScriptPath)) {
    throw "Host script not found: $HostScriptPath"
  }

  $standaloneScriptPath = Join-Path ([System.IO.Path]::GetDirectoryName($HostScriptPath)) "..\scripts\export-artboards.jsx"
  $standaloneScriptPath = [System.IO.Path]::GetFullPath($standaloneScriptPath)
  if (-not (Test-Path -LiteralPath $standaloneScriptPath)) {
    throw "Standalone export script not found: $standaloneScriptPath"
  }

  $photoshop = New-Object -ComObject Photoshop.Application
  $documentName = [string]$photoshop.DoJavaScript("app.documents.length ? app.activeDocument.name : '';");
  if ([string]::IsNullOrWhiteSpace($documentName)) {
    throw "No active Photoshop document."
  }

  $productName = [System.IO.Path]::GetFileNameWithoutExtension($documentName).Trim()
  if ([string]::IsNullOrWhiteSpace($productName)) {
    throw "Unable to derive product name from current document."
  }

  if ($productName -like "*$TemplateMarker*") {
    throw "Please save the template copy as a product code first, for example ABC-123.psd."
  }

  $safeProductName = $productName -replace '[\\/:*?""<>|]', '-'

  New-Item -ItemType Directory -Path $BannerDir -Force | Out-Null
  New-Item -ItemType Directory -Path $PosterDir -Force | Out-Null

  $bannerPath = Join-Path $BannerDir ($safeProductName + ".png")
  $posterPath = Join-Path $PosterDir ($safeProductName + ".png")
  $posterExtraPath = Join-Path $PosterDir ($safeProductName + "_1.png")

  $payloadPath = Join-Path $env:TEMP ("loom-export-" + [System.Guid]::NewGuid().ToString("N") + ".json")
  try {
    @{
      exports = @(
        @{
          artboardName = $HorizontalArtboardName
          outputPath = $bannerPath
        },
        @{
          artboardName = $VerticalArtboardName
          outputPath = $posterPath
        },
        @{
          artboardName = $VerticalArtboardName
          outputPath = $posterExtraPath
          hideLayerNames = @("poster-1")
        }
      )
    } | ConvertTo-Json -Depth 5 -Compress | Set-Content -LiteralPath $payloadPath -Encoding UTF8

    $escapedStandaloneScriptPath = Escape-JsString $standaloneScriptPath
    $escapedPayloadPath = Escape-JsString $payloadPath
    $jsx = @"
(function () {
  var LOOM_EXPORT_PAYLOAD_PATH = "$escapedPayloadPath";
  return $.evalFile(new File("$escapedStandaloneScriptPath"));
}())
"@

    $rawResult = [string]$photoshop.DoJavaScript($jsx)
    $parsed = $rawResult | ConvertFrom-Json
    if (-not $parsed.ok) {
      throw ([string]$parsed.error)
    }

    @{
      ok = $true
      documentName = [string]$parsed.data.documentName
      bannerPath = $bannerPath
      posterPath = $posterPath
      posterExtraPath = $posterExtraPath
    } | ConvertTo-Json -Compress
  } finally {
    if (Test-Path -LiteralPath $payloadPath) {
      Remove-Item -LiteralPath $payloadPath -Force -ErrorAction SilentlyContinue
    }
  }
} catch {
  @{
    ok = $false
    error = $_.Exception.Message
  } | ConvertTo-Json -Compress
}

param(
  [Parameter(Mandatory = $true)]
  [string]$ManifestPath,

  [Parameter(Mandatory = $true)]
  [string]$ExtensionRoot
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)

function Compare-Version {
  param(
    [string]$Left,
    [string]$Right
  )

  $leftParts = ($Left -split '\.') | ForEach-Object { [int]$_ }
  $rightParts = ($Right -split '\.') | ForEach-Object { [int]$_ }
  $length = [Math]::Max($leftParts.Count, $rightParts.Count)

  for ($i = 0; $i -lt $length; $i += 1) {
    $leftValue = if ($i -lt $leftParts.Count) { $leftParts[$i] } else { 0 }
    $rightValue = if ($i -lt $rightParts.Count) { $rightParts[$i] } else { 0 }
    if ($leftValue -gt $rightValue) { return 1 }
    if ($leftValue -lt $rightValue) { return -1 }
  }

  return 0
}

try {
  if (-not (Test-Path -LiteralPath $ManifestPath)) {
    throw "Update manifest not found: $ManifestPath"
  }

  $extensionRootPath = [System.IO.Path]::GetFullPath($ExtensionRoot)
  $manifestXmlPath = Join-Path $extensionRootPath "CSXS\\manifest.xml"
  if (-not (Test-Path -LiteralPath $manifestXmlPath)) {
    throw "Local manifest not found: $manifestXmlPath"
  }

  $manifestXml = Get-Content -LiteralPath $manifestXmlPath -Raw -Encoding UTF8
  $versionMatch = [regex]::Match($manifestXml, 'ExtensionBundleVersion="([^"]+)"')
  if (-not $versionMatch.Success) {
    throw "Unable to parse local manifest version."
  }
  $currentVersion = $versionMatch.Groups[1].Value

  $updateManifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if (-not $updateManifest.version -or -not $updateManifest.packageFile) {
    throw "Update manifest is missing required fields."
  }

  $latestVersion = [string]$updateManifest.version
  if ((Compare-Version -Left $latestVersion -Right $currentVersion) -le 0) {
    @{
      ok = $true
      updated = $false
      currentVersion = $currentVersion
      latestVersion = $latestVersion
    } | ConvertTo-Json -Compress
    exit 0
  }

  $manifestDir = Split-Path -Path $ManifestPath -Parent
  $packagePath = Join-Path $manifestDir $updateManifest.packageFile
  if (-not (Test-Path -LiteralPath $packagePath)) {
    throw "Update package not found: $packagePath"
  }

  $tempRoot = Join-Path $env:TEMP ("loom-update-" + [System.Guid]::NewGuid().ToString("N"))
  $zipPath = Join-Path $tempRoot $updateManifest.packageFile
  $extractDir = Join-Path $tempRoot "extract"

  try {
    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
    Copy-Item -LiteralPath $packagePath -Destination $zipPath -Force
    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force

    $bundleRoot = if ($updateManifest.bundleId) {
      Join-Path $extractDir ([string]$updateManifest.bundleId)
    } else {
      $null
    }
    $sourceRoot = if ($bundleRoot -and (Test-Path -LiteralPath $bundleRoot)) { $bundleRoot } else { $extractDir }

    Copy-Item -LiteralPath (Join-Path $sourceRoot '*') -Destination $extensionRootPath -Recurse -Force

    @{
      ok = $true
      updated = $true
      currentVersion = $currentVersion
      latestVersion = $latestVersion
      reloadRequired = $true
    } | ConvertTo-Json -Compress
  } finally {
    if (Test-Path -LiteralPath $tempRoot) {
      Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
} catch {
  @{
    ok = $false
    error = $_.Exception.Message
  } | ConvertTo-Json -Compress
}

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

if (Get-NetTCPConnection -State Listen -LocalPort 8003 -ErrorAction SilentlyContinue) {
    throw 'Port 8003 is already in use. Existing process was not changed.'
}

$process = Start-Process `
    -FilePath 'D:\design-tool\.venv\Scripts\python.exe' `
    -ArgumentList @('-u', "$root\run_preview_8003.py") `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -RedirectStandardOutput "$root\preview-8003.stdout.log" `
    -RedirectStandardError "$root\preview-8003.stderr.log" `
    -PassThru

Write-Output "New canvas preview started: PID=$($process.Id), port=8003"

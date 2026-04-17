@echo off
setlocal

set IMAGES=penpotapp/frontend:latest penpotapp/backend:latest penpotapp/exporter:latest postgres:15 valkey/valkey:8.1 sj26/mailcatcher:latest

echo Pulling penpot images...
echo.

for %%I in (%IMAGES%) do (
    echo [pull] %%I
    :retry
    docker pull %%I
    if errorlevel 1 (
        echo [retry] %%I failed, retrying in 3s...
        timeout /t 3 /nobreak >nul
        goto retry
    )
    echo [done] %%I
    echo.
)

echo All done!
docker images
pause

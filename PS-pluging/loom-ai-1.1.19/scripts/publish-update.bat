@echo off
setlocal

set "ROOT=%~dp0.."

node "%ROOT%\scripts\publish-update.js"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" (
  echo Publish failed.
) else (
  echo Publish completed.
)

pause
exit /b %EXIT_CODE%

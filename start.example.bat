@echo off
setlocal
title DesignFlow :8000

set BACKEND_PORT=8000
set ROOT=%~dp0
set VENV_DIR=%ROOT%.venv
set VENV_PYTHON=%VENV_DIR%\Scripts\python.exe

where py >nul 2>nul
if %errorlevel%==0 (
    set PY_BOOTSTRAP=py -3
) else (
    set PY_BOOTSTRAP=python
)

if not exist "%VENV_PYTHON%" (
    echo Creating virtual environment...
    %PY_BOOTSTRAP% -m venv "%VENV_DIR%"
    if errorlevel 1 (
        echo Failed to create venv. Install Python 3 first.
        pause
        exit /b 1
    )
    echo Installing backend dependencies...
    "%VENV_PYTHON%" -m pip install --upgrade pip
    "%VENV_PYTHON%" -m pip install -r "%ROOT%backend\requirements.txt"
    if errorlevel 1 (
        echo Failed to install dependencies.
        pause
        exit /b 1
    )
)

if /i "%~1"=="install" (
    echo Reinstalling backend dependencies...
    "%VENV_PYTHON%" -m pip install -r "%ROOT%backend\requirements.txt"
    if errorlevel 1 (
        echo Failed to install dependencies.
        pause
        exit /b 1
    )
    shift
)

for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr ":%BACKEND_PORT% " ^| findstr LISTENING') do (
    echo Port %BACKEND_PORT% in use, stopping PID %%p
    taskkill /PID %%p /F >nul 2>&1
)

echo Checking frontend / canvas builds...
"%VENV_PYTHON%" "%ROOT%ensure_ui_build.py"
if errorlevel 1 (
    echo UI rebuild failed.
    pause
    exit /b 1
)

if /i "%~1"=="extras" (
    echo Starting optional Penpot MCP :4401 and plugin :4400
    if exist "%ROOT%penpot\mcp\packages\server\dist\index.js" (
        start "Penpot MCP :4401" /min /D "%ROOT%penpot\mcp\packages\server" cmd /c node dist/index.js
    )
    start "Plugin :4400" /min /D "%ROOT%" "%VENV_PYTHON%" serve_plugin.py
)

echo.
echo  DesignFlow
echo  UI    http://localhost:%BACKEND_PORT%/ui
echo  Docs  http://localhost:%BACKEND_PORT%/docs
echo  Close this window to stop.
echo.

start "" /b "%VENV_PYTHON%" "%ROOT%ensure_ui_build.py" --open-when-ready %BACKEND_PORT%

cd /d "%ROOT%"
"%VENV_PYTHON%" -m uvicorn backend.main:app --host 0.0.0.0 --port %BACKEND_PORT% --reload

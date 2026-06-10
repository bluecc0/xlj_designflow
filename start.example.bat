@echo off
setlocal
title Design Tool

set BACKEND_PORT=8000
set MCP_PORT=4401
set PLUGIN_PORT=4400
set ROOT=%~dp0
set VENV_DIR=%ROOT%.venv
set VENV_PYTHON=%VENV_DIR%\Scripts\python.exe
set VENV_PIP=%VENV_DIR%\Scripts\pip.exe

where py >nul 2>nul
if %errorlevel%==0 (
    set PY_BOOTSTRAP=py -3
) else (
    set PY_BOOTSTRAP=python
)

:: Auto detect local IPv4 (skip 127.x.x.x)
set "LOCAL_IP="
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
    for /f "tokens=1" %%b in ("%%a") do (
        if not defined LOCAL_IP (
            echo %%b | findstr /i /v "127." >nul && set "LOCAL_IP=%%b"
        )
    )
)
if not defined LOCAL_IP set LOCAL_IP=localhost

:: Use local IP for Penpot
set PENPOT_BASE_URL=http://%LOCAL_IP%:9001
echo  [+] PENPOT_BASE_URL=%PENPOT_BASE_URL%

echo.
echo  [0/4] Preparing Python environment...
if not exist "%VENV_PYTHON%" (
    echo        Creating virtual environment...
    %PY_BOOTSTRAP% -m venv "%VENV_DIR%"
    if errorlevel 1 (
        echo        Failed to create virtual environment. Please install Python 3 first.
        pause
        exit /b 1
    )
)

echo        Installing/updating backend dependencies...
"%VENV_PYTHON%" -m pip install --upgrade pip >nul
"%VENV_PIP%" install -r "%ROOT%backend\requirements.txt"
if errorlevel 1 (
    echo        Failed to install backend dependencies.
    pause
    exit /b 1
)

echo.
echo  [0.4/4] Checking frontend build...
set FE_NEEDS_BUILD=0
if not exist "%ROOT%frontend\index.html" (
    set FE_NEEDS_BUILD=1
    echo        frontend index.html not found.
) else (
    for %%I in ("%ROOT%frontend\index.html") do set FE_INDEX_AGE=%%~tI
    :: 检查 src 下任何 jsx 是否比 index 新
    for /r "%ROOT%frontend\src" %%F in (*.jsx) do (
        for %%I in ("%%F") do set FE_FILE_AGE=%%~tI
        if "!FE_FILE_AGE!" GTR "!FE_INDEX_AGE!" (
            if !FE_NEEDS_BUILD!==0 (
                echo        src\*.jsx newer than index.html, rebuild needed.
            )
            set FE_NEEDS_BUILD=1
        )
    )
)
if %FE_NEEDS_BUILD%==1 (
    pushd "%ROOT%frontend"
    call "%VENV_PYTHON%" build.py
    if errorlevel 1 (
        echo        Frontend build failed.
        popd
        pause
        exit /b 1
    )
    popd
    echo        Frontend built.
) else (
    echo        Frontend up-to-date, skipping build.
)

echo.
echo  [0.5/4] Checking editor (tldraw) build...
set NEEDS_BUILD=0
if not exist "%ROOT%editor-lab-tldraw\dist\index.html" (
    set NEEDS_BUILD=1
    echo        editor dist not found.
)
if exist "%ROOT%editor-lab-tldraw\.env" (
    if exist "%ROOT%editor-lab-tldraw\dist\index.html" (
        for %%I in ("%ROOT%editor-lab-tldraw\.env") do set ENV_AGE=%%~tI
        for %%I in ("%ROOT%editor-lab-tldraw\dist\index.html") do set DIST_AGE=%%~tI
        if "!ENV_AGE!" GTR "!DIST_AGE!" (
            echo        .env newer than dist, rebuild needed.
            set NEEDS_BUILD=1
        )
    )
)
if %NEEDS_BUILD%==1 (
    if not exist "%ROOT%editor-lab-tldraw\node_modules" (
        echo        Installing editor dependencies...
        pushd "%ROOT%editor-lab-tldraw"
        call npm install
        if errorlevel 1 (
            echo        Failed to install editor dependencies.
            popd
            pause
            exit /b 1
        )
        popd
    )
    if not exist "%ROOT%editor-lab-tldraw\.env" (
        echo        WARNING: .env not found, creating from .env.example...
        if exist "%ROOT%editor-lab-tldraw\.env.example" (
            copy /Y "%ROOT%editor-lab-tldraw\.env.example" "%ROOT%editor-lab-tldraw\.env" >nul
            echo        Please edit editor-lab-tldraw\.env to add your license key, then re-run.
        ) else (
            echo        # VITE_TLDRAW_LICENSE_KEY=tldraw-YYYY-MM-DD/xxxxx > "%ROOT%editor-lab-tldraw\.env"
            echo        No .env.example found, created template. Please fill license key.
        )
        pause
        exit /b 1
    )
    echo        Building editor...
    pushd "%ROOT%editor-lab-tldraw"
    call npm run build
    if errorlevel 1 (
        echo        Failed to build editor.
        popd
        pause
        exit /b 1
    )
    popd
    echo        Editor built.
) else (
    echo        Editor dist up-to-date, skipping build.
)

echo.
echo  Design Tool - Starting...
echo  ================================
echo.

echo  [1/4] Checking port %BACKEND_PORT%...
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr ":%BACKEND_PORT% " ^| findstr LISTENING') do (
    echo        Killing PID %%p on port %BACKEND_PORT%
    taskkill /PID %%p /F >nul 2>&1
)

echo  [2/4] Checking port %MCP_PORT%...
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr ":%MCP_PORT% " ^| findstr LISTENING') do (
    echo        Killing PID %%p on port %MCP_PORT%
    taskkill /PID %%p /F >nul 2>&1
)

echo  [3/4] Checking port %PLUGIN_PORT%...
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr ":%PLUGIN_PORT% " ^| findstr LISTENING') do (
    echo        Killing PID %%p on port %PLUGIN_PORT%
    taskkill /PID %%p /F >nul 2>&1
)

timeout /t 1 /nobreak >nul

echo  [4/4] Starting services...

echo        Starting MCP server on port %MCP_PORT%...
start "Penpot MCP :4401" /D "%ROOT%penpot\mcp\packages\server" cmd /k node dist/index.js

echo        Starting plugin server on port %PLUGIN_PORT%...
start "Plugin :4400" /D "%ROOT%" "%VENV_PYTHON%" serve_plugin.py

echo        Starting backend on port %BACKEND_PORT%...
start "Backend :8000" /D "%ROOT%" "%VENV_PYTHON%" -m uvicorn backend.main:app --host 0.0.0.0 --port %BACKEND_PORT% --reload

echo        Waiting for backend...
:wait_backend
timeout /t 1 /nobreak >nul
curl -s http://localhost:%BACKEND_PORT%/health >nul 2>&1
if errorlevel 1 goto wait_backend
echo        Backend ready!

echo.
echo  ================================
echo  Frontend:  http://localhost:%BACKEND_PORT%/ui
echo  API Docs:  http://localhost:%BACKEND_PORT%/docs
echo  MCP:       http://localhost:%MCP_PORT%/mcp
echo  Plugin:    http://localhost:%PLUGIN_PORT%/manifest.json
echo  ================================
echo.

timeout /t 2 /nobreak >nul
start http://localhost:%BACKEND_PORT%/ui

echo  All services started. Close their windows to stop.
echo.
pause

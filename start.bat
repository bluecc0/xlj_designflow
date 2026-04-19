@echo off
setlocal enabledelayedexpansion
title Design Tool

set BACKEND_PORT=8000
set MCP_PORT=4401
set PLUGIN_PORT=4400
set ROOT=%~dp0

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
start "Penpot MCP :4401" cmd /k "cd /d %ROOT%penpot\mcp\packages\server && node dist/index.js"

echo        Starting plugin server on port %PLUGIN_PORT%...
start "Plugin :4400" cmd /k "cd /d %ROOT% && python serve_plugin.py"

echo        Starting backend on port %BACKEND_PORT%...
start "Backend :8000" cmd /k "cd /d %ROOT% && uvicorn backend.main:app --host 0.0.0.0 --port %BACKEND_PORT% --reload"

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

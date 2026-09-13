@echo off
setlocal
cd /d "%~dp0"

echo ==========================================================
echo   AI Consumer-Protection Review Tool (Contract Materials)
echo ==========================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install Node.js 18 or newer:
  echo         https://nodejs.org
  echo.
  pause
  exit /b 1
)

netstat -ano | findstr ":8787" | findstr "LISTENING" >nul
if not errorlevel 1 (
  echo [WARN] Port 8787 is already in use - another instance is probably running.
  echo        Close that window first, otherwise the server below will fail to start.
  echo.
)

echo Opening http://localhost:8787 in your browser ...
start "" http://localhost:8787

echo.
echo Keep this window open while using the workbench. Press Ctrl+C to stop.
echo.
node server.js

echo.
echo Server stopped.
pause

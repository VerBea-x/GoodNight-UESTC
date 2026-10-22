@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22 or newer, then run this file again.
  pause
  exit /b 1
)
if not exist "node_modules\leaflet\package.json" goto install_packages
if not exist "node_modules\coordtransform\package.json" goto install_packages
if not exist "node_modules\playwright\package.json" goto install_packages
goto start_service
:install_packages
  call npm ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
:start_service
echo.
echo GoodNight local dashboard: http://127.0.0.1:3210
echo Keep this window open while automatic plans are enabled.
echo.
node bin\goodnight.mjs web
pause

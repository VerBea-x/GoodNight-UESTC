@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto missing_node
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 goto missing_node
if not exist "node_modules\leaflet\package.json" goto install_packages
if not exist "node_modules\coordtransform\package.json" goto install_packages
if not exist "node_modules\playwright\package.json" goto install_packages
goto install_service
:install_packages
call npm ci
if errorlevel 1 goto failed
:install_service
rem A stopped WScript task can leave its child Node process behind. Stop only this checkout's web process.
schtasks /End /TN io.github.beichenO2.goodnight >nul 2>nul
powershell -NoProfile -Command "$entry=[IO.Path]::GetFullPath('bin\goodnight.mjs'); Get-CimInstance Win32_Process -Filter 'name=''node.exe''' | Where-Object { $_.CommandLine -like ('*'+$entry+'*') -and $_.CommandLine -match '\bweb\b' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
node bin\goodnight.mjs service install --web
if errorlevel 1 goto failed
echo.
echo Background service installed for your Windows account.
echo It will start when you log in. Your computer must remain on and online.
echo Open http://127.0.0.1:3210/ to configure your school account.
echo Keep this project folder in place after installation.
start "" "http://127.0.0.1:3210/"
exit /b 0
:missing_node
echo Please install Node.js 22 or newer, then run this file again.
pause
exit /b 1
:failed
echo Installation failed. Check the message above and try again.
pause
exit /b 1

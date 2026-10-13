@echo off
rem Launch GMing Tool on Windows: build, serve on localhost, open the browser.
setlocal
cd /d "%~dp0"

set "PORT=4173"
set "URL=http://127.0.0.1:%PORT%/"

where npm >nul 2>nul
if errorlevel 1 (
  echo error: npm was not found - install Node.js 20 or newer first
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install || exit /b 1
)

echo Building...
call npm run build || exit /b 1

echo Serving %URL% - press Ctrl-C to stop.
start "" "%URL%"
call npm run preview -- --host 127.0.0.1 --port %PORT%

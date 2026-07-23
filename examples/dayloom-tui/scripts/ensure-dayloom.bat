@echo off
setlocal

if not defined DAY_LOOM_DIR (
  echo [ERROR] ensure-dayloom.bat: DAY_LOOM_DIR is not set.
  exit /b 1
)

pushd "%DAY_LOOM_DIR%"
call node -e "require.resolve('promptpile/package.json')" >nul 2>nul
if errorlevel 1 (
  echo Installing dayloom workspace dependencies...
  call npm install
  if errorlevel 1 ( popd & exit /b 1 )
)

echo Building dayloom core and tui...
call npm run build -w @dayloom/core -w @dayloom/tui
if errorlevel 1 ( popd & exit /b 1 )
popd

if not exist "%DAY_LOOM_DIR%\packages\core\dist\index.js" exit /b 1
if not exist "%DAY_LOOM_DIR%\packages\tui\dist\main.js" exit /b 1

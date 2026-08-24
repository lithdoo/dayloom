@echo off
setlocal
if not defined DAY_LOOM_DIR ( echo [ERROR] DAY_LOOM_DIR is not set. & exit /b 1 )

pushd "%DAY_LOOM_DIR%"
call node -e "require.resolve('promptpile')" >nul 2>nul
if errorlevel 1 (
  echo [Dayloom] Dependencies are missing. Running npm install...
  call npm install
  if errorlevel 1 ( popd & exit /b 1 )
)
echo [Dayloom] Building archive-protocol...
call npm run build -w @dayloom/archive-protocol
if errorlevel 1 ( popd & exit /b 1 )
echo [Dayloom] Building core...
call npm run build -w @dayloom/core
if errorlevel 1 ( popd & exit /b 1 )
echo [Dayloom] Building TUI...
call npm run build -w @dayloom/tui
if errorlevel 1 ( popd & exit /b 1 )
popd

if not exist "%DAY_LOOM_DIR%\packages\archive-protocol\dist\index.js" exit /b 1
if not exist "%DAY_LOOM_DIR%\packages\core\dist\index.js" exit /b 1
if not exist "%DAY_LOOM_DIR%\packages\tui\dist\main.js" exit /b 1

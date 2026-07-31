@echo off
setlocal

if not defined DAY_LOOM_DIR (
  echo [ERROR] ensure-dayloom.bat: DAY_LOOM_DIR is not set.
  exit /b 1
)

set "BINDTTY_WORKSPACE_DIR=%DAY_LOOM_DIR%\..\bindtty"
if exist "%BINDTTY_WORKSPACE_DIR%\package.json" (
  echo Building BindTTY terminal and app from the sibling workspace...
  pushd "%BINDTTY_WORKSPACE_DIR%"
  call npm run build -w @bindtty/terminal -w bindtty
  if errorlevel 1 ( popd & exit /b 1 )
  popd
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

pushd "%DAY_LOOM_DIR%"
call node -e "import('@bindtty/terminal').then(m=>process.exit(typeof m.createDiagnosticLogger==='function'?0:1)).catch(()=>process.exit(1))"
if errorlevel 1 (
  echo [ERROR] dayloom is not loading the diagnostic-enabled BindTTY workspace build.
  popd
  exit /b 1
)
popd

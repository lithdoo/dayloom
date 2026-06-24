@echo off
setlocal

if not defined DAY_LOOM_DIR (
  echo [ERROR] ensure-dayloom.bat: DAY_LOOM_DIR is not set.
  exit /b 1
)

set "MODE=%~1"
if not defined MODE set "MODE=init"
set "EXAMPLE_ROOT=%~dp0.."
set "DAY_LOOM_DIST=%DAY_LOOM_DIR%\dist\index.js"
set "FILESYSTEM_MCP_DIST=%EXAMPLE_ROOT%\.runtime\node_modules\@modelcontextprotocol\server-filesystem\dist\index.js"

pushd "%DAY_LOOM_DIR%"
call node -e "require.resolve('promptpile/package.json')" >nul 2>nul
if errorlevel 1 (
  popd
  echo Installing dependencies in packages/dayloom...
  pushd "%DAY_LOOM_DIR%"
  call npm install
  if errorlevel 1 ( popd & exit /b 1 )
  popd
) else (
  popd
)

echo Building dayloom...
pushd "%DAY_LOOM_DIR%"
call npm run build
if errorlevel 1 ( popd & exit /b 1 )
popd

pushd "%DAY_LOOM_DIR%"
call node -e "require.resolve('promptpile/package.json')" >nul 2>nul
if errorlevel 1 ( popd & exit /b 1 )
popd
if not exist "%DAY_LOOM_DIST%" exit /b 1
if /i not "%MODE%"=="revise" exit /b 0

if defined PROMPTPILE_MCP_BASE_URL goto check_filesystem
if defined PROMPTPILE_MCP_BIN goto check_filesystem
pushd "%DAY_LOOM_DIR%"
call node -e "require.resolve('promptpile-mcp/package.json')" >nul 2>nul
if not errorlevel 1 ( popd & goto check_filesystem )
popd
where promptpile-mcp >nul 2>nul
if not errorlevel 1 goto check_filesystem
echo [ERROR] promptpile-mcp CLI is required for interactive revise.
exit /b 1

:check_filesystem
if defined PROMPTPILE_MCP_BASE_URL exit /b 0
if exist "%FILESYSTEM_MCP_DIST%" exit /b 0
echo Installing isolated filesystem MCP runtime...
call npm install --prefix "%EXAMPLE_ROOT%\.runtime" @modelcontextprotocol/server-filesystem@2026.1.14
if errorlevel 1 exit /b 1
if exist "%FILESYSTEM_MCP_DIST%" exit /b 0
echo [ERROR] filesystem MCP not found at:
echo   %FILESYSTEM_MCP_DIST%
exit /b 1

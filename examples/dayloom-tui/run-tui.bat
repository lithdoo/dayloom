@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

if exist ".env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do (
    if not "%%a"=="" (
      if /i "%%a"=="DEEPSEEK_API_KEY" if not "%%b"=="" set "DEEPSEEK_API_KEY=%%b"
      if /i "%%a"=="PROMPTPILE_MCP_BIN" if not "%%b"=="" set "PROMPTPILE_MCP_BIN=%%b"
      if /i "%%a"=="PROMPTPILE_MCP_BASE_URL" if not "%%b"=="" set "PROMPTPILE_MCP_BASE_URL=%%b"
      if /i "%%a"=="PROMPTPILE_MCP_TOKEN" if not "%%b"=="" set "PROMPTPILE_MCP_TOKEN=%%b"
    )
  )
)

if not defined DEEPSEEK_API_KEY (
  echo [ERROR] DEEPSEEK_API_KEY is not set.
  echo Set the User or System environment variable DEEPSEEK_API_KEY, OR create ".env" in this folder with:
  echo   DEEPSEEK_API_KEY=sk-...
  exit /b 1
)

set "SOURCE_WORLD=%~dp0..\dayloom-init-revise\output\world-interactive"
set "OUT_DIR=%~dp0output\world-tui-interactive"
set "DAY_LOOM_DIR=%~dp0..\.."
set "DAY_LOOM_FILESYSTEM_MCP_BIN=%~dp0.runtime\node_modules\@modelcontextprotocol\server-filesystem\dist\index.js"

if not exist "%SOURCE_WORLD%\manifest.yaml" (
  echo [ERROR] Source World not found:
  echo   %SOURCE_WORLD%
  echo.
  echo Create it first:
  echo   cd ..\dayloom-init-revise
  echo   run-interactive.bat
  echo.
  echo Or try the no-API quick demo:
  echo   run-quick.bat
  exit /b 1
)

call "%~dp0scripts\ensure-dayloom.bat"
if errorlevel 1 exit /b 1

if not exist "%OUT_DIR%\manifest.yaml" (
  echo Copying source World into TUI example output...
  if exist "%OUT_DIR%" rmdir /s /q "%OUT_DIR%"
  mkdir "%~dp0output" 2>nul
  xcopy "%SOURCE_WORLD%" "%OUT_DIR%" /E /I /Y >nul
)

echo Launching dayloom-tui on: %OUT_DIR%
echo Shortcuts: Enter = newline, Ctrl+Enter = send, Y/N = confirm
echo.

if defined PROMPTPILE_MCP_BASE_URL goto tui_external_gateway
call node "%DAY_LOOM_DIR%\packages\tui\dist\main.js" ^
  "%OUT_DIR%" ^
  --keep-session ^
  --locale zh
goto tui_done

:tui_external_gateway
call node "%DAY_LOOM_DIR%\packages\tui\dist\main.js" ^
  "%OUT_DIR%" ^
  --keep-session ^
  --locale zh ^
  --mcp-base-url "%PROMPTPILE_MCP_BASE_URL%" ^
  --mcp-token "%PROMPTPILE_MCP_TOKEN%"

:tui_done
exit /b %errorlevel%

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
  echo Set it in the environment or create .env from .env.example.
  exit /b 1
)

set "OUT_DIR=%~dp0output\world-daily-interactive"
set "DAY_LOOM_DIR=%~dp0..\..\packages\dayloom"
set "DAY_LOOM_FILESYSTEM_MCP_BIN=%~dp0.runtime\node_modules\@modelcontextprotocol\server-filesystem\dist\index.js"

if not exist "%OUT_DIR%\manifest.yaml" (
  echo [ERROR] Planned World not found:
  echo   %OUT_DIR%
  echo.
  echo Create a daily plan first:
  echo   run-interactive.bat
  exit /b 1
)

call "%~dp0scripts\ensure-dayloom.bat"
if errorlevel 1 exit /b 1

for /f "usebackq delims=" %%p in (`node -e "const fs=require('fs');const p=process.argv[1]+'\\current.yaml';const m=fs.readFileSync(p,'utf8').match(/^phase:\s*(\S+)/m);console.log(m?m[1]:'')" "%OUT_DIR%"`) do set "PHASE=%%p"
if "%PHASE%"=="settling" goto already_complete
if "%PHASE%"=="planned" goto run_play
if "%PHASE%"=="playing" goto run_play
echo [ERROR] Play requires phase planned or playing, got: %PHASE%
echo Run run-interactive.bat first to create the daily plan.
exit /b 1

:already_complete
echo Play is already complete; verifying output...
node "%~dp0scripts\verify-play.js" "%OUT_DIR%"
exit /b %errorlevel%

:run_play
if defined PROMPTPILE_MCP_BASE_URL goto play_external_gateway
call npx --prefix "%DAY_LOOM_DIR%" dayloom play -d "%OUT_DIR%" --keep-session
goto play_done

:play_external_gateway
if defined PROMPTPILE_MCP_TOKEN goto play_external_gateway_with_token
call npx --prefix "%DAY_LOOM_DIR%" dayloom play -d "%OUT_DIR%" --keep-session --mcp-base-url "%PROMPTPILE_MCP_BASE_URL%"
goto play_done

:play_external_gateway_with_token
call npx --prefix "%DAY_LOOM_DIR%" dayloom play -d "%OUT_DIR%" --keep-session --mcp-base-url "%PROMPTPILE_MCP_BASE_URL%" --mcp-token "%PROMPTPILE_MCP_TOKEN%"

:play_done
if errorlevel 1 (
  echo [ERROR] dayloom play failed.
  exit /b 1
)
node "%~dp0scripts\verify-play.js" "%OUT_DIR%"
exit /b %errorlevel%

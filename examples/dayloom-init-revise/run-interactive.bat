@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

REM cmd.exe does not auto-load .env; read supported settings from optional .env in this folder.
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
  echo If you used setx, open a NEW cmd window ^(setx does not update the current session^).
  exit /b 1
)

set "OUT_DIR=%~dp0output\world-interactive"
set "DAY_LOOM_DIR=%~dp0..\..\packages\dayloom"
set "DAY_LOOM_FILESYSTEM_MCP_BIN=%~dp0.runtime\node_modules\@modelcontextprotocol\server-filesystem\dist\index.js"

if exist "%OUT_DIR%\manifest.yaml" goto revise
if exist "%OUT_DIR%" (
  echo [ERROR] Output directory exists but is not an initialized World:
  echo   %OUT_DIR%
  echo Remove it manually or choose another path.
  exit /b 1
)

:init
call "%~dp0scripts\ensure-dayloom.bat" init
if errorlevel 1 exit /b 1

echo Running dayloom init ^(interactive^)...
echo Finish each reply with Ctrl+Z then Enter ^(Windows^).
call npx --prefix "%DAY_LOOM_DIR%" dayloom init ^
  -d "%OUT_DIR%" ^
  --id campus_life ^
  --title "校园日常" ^
  --max-rounds 8 ^
  --keep-session
if errorlevel 1 (
  echo [ERROR] dayloom init failed.
  exit /b 1
)

echo Verifying world save...
node "%~dp0scripts\verify-world.js" "%OUT_DIR%" --mode interactive
if errorlevel 1 (
  echo [ERROR] verify-world failed.
  exit /b 1
)

echo.
echo Initialized World: %OUT_DIR%
exit /b 0

:revise
call "%~dp0scripts\ensure-dayloom.bat" revise
if errorlevel 1 exit /b 1

echo Existing World found. Running dayloom revise...
if defined PROMPTPILE_MCP_BASE_URL goto revise_external_gateway
call npx --prefix "%DAY_LOOM_DIR%" dayloom revise ^
  -d "%OUT_DIR%" ^
  --keep-session
goto revise_done

:revise_external_gateway
call npx --prefix "%DAY_LOOM_DIR%" dayloom revise ^
  -d "%OUT_DIR%" ^
  --keep-session ^
  --mcp-base-url "%PROMPTPILE_MCP_BASE_URL%" ^
  --mcp-token "%PROMPTPILE_MCP_TOKEN%"

:revise_done
if errorlevel 1 (
  echo [ERROR] dayloom revise failed.
  exit /b 1
)

echo Verifying existing world save...
node "%~dp0scripts\verify-world.js" "%OUT_DIR%" --mode existing
if errorlevel 1 (
  echo [ERROR] verify-world failed.
  exit /b 1
)

echo.
echo Revised World: %OUT_DIR%
exit /b 0

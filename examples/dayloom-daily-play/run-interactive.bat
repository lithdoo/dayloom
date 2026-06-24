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
set "OUT_DIR=%~dp0output\world-daily-interactive"
set "DAY_LOOM_DIR=%~dp0..\..\packages\dayloom"
set "DAY_LOOM_FILESYSTEM_MCP_BIN=%~dp0.runtime\node_modules\@modelcontextprotocol\server-filesystem\dist\index.js"

if not exist "%SOURCE_WORLD%\manifest.yaml" (
  echo [ERROR] Source World not found:
  echo   %SOURCE_WORLD%
  echo.
  echo Create it first:
  echo   cd ..\dayloom-init-revise
  echo   run-interactive.bat
  exit /b 1
)

call "%~dp0scripts\ensure-dayloom.bat"
if errorlevel 1 exit /b 1

if not exist "%OUT_DIR%\manifest.yaml" (
  echo Copying source World into daily example output...
  if exist "%OUT_DIR%" rmdir /s /q "%OUT_DIR%"
  mkdir "%~dp0output" 2>nul
  xcopy "%SOURCE_WORLD%" "%OUT_DIR%" /E /I /Y >nul
)

for /f "usebackq delims=" %%p in (`node -e "const fs=require('fs');const p=process.argv[1]+'\\current.yaml';const m=fs.readFileSync(p,'utf8').match(/^phase:\s*(\S+)/m);console.log(m?m[1]:'')" "%OUT_DIR%"`) do set "PHASE=%%p"
if not "%PHASE%"=="idle" (
  echo [ERROR] Daily requires an idle World, got: %PHASE%
  if "%PHASE%"=="planned" echo Continue with: run-play-interactive.bat
  if "%PHASE%"=="playing" echo Continue with: run-play-interactive.bat
  if not "%PHASE%"=="planned" if not "%PHASE%"=="playing" echo To restart from daily, delete: %OUT_DIR%
  exit /b 1
)

if defined PROMPTPILE_MCP_BASE_URL goto daily_external_gateway
call npx --prefix "%DAY_LOOM_DIR%" dayloom daily ^
  -d "%OUT_DIR%" ^
  --keep-session
goto daily_done

:daily_external_gateway
call npx --prefix "%DAY_LOOM_DIR%" dayloom daily ^
  -d "%OUT_DIR%" ^
  --keep-session ^
  --mcp-base-url "%PROMPTPILE_MCP_BASE_URL%" ^
  --mcp-token "%PROMPTPILE_MCP_TOKEN%"

:daily_done
if errorlevel 1 (
  echo [ERROR] dayloom daily failed.
  exit /b 1
)

for /f "usebackq delims=" %%p in (`node -e "const fs=require('fs');const p=process.argv[1]+'\\current.yaml';const m=fs.readFileSync(p,'utf8').match(/^phase:\s*(\S+)/m);console.log(m?m[1]:'')" "%OUT_DIR%"`) do set "PHASE=%%p"
if "%PHASE%"=="planned" (
  node "%~dp0scripts\verify-daily.js" "%OUT_DIR%"
) else (
  echo Daily plan was not applied; current phase remains: %PHASE%
)
exit /b %errorlevel%

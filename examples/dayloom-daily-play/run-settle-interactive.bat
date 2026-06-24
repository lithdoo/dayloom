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

set "OUT_DIR=%~dp0output\world-daily-interactive"
set "DAY_LOOM_DIR=%~dp0..\..\packages\dayloom"
set "DAY_LOOM_FILESYSTEM_MCP_BIN=%~dp0.runtime\node_modules\@modelcontextprotocol\server-filesystem\dist\index.js"

if not exist "%OUT_DIR%\manifest.yaml" (
  echo [ERROR] World not found: %OUT_DIR%
  exit /b 1
)

call "%~dp0scripts\ensure-dayloom.bat"
if errorlevel 1 exit /b 1

for /f "usebackq delims=" %%p in (`node -e "const fs=require('fs');const p=process.argv[1]+'\\current.yaml';const m=fs.readFileSync(p,'utf8').match(/^phase:\s*(\S+)/m);console.log(m?m[1]:'')" "%OUT_DIR%"`) do set "PHASE=%%p"
if not "%PHASE%"=="settling" (
  echo [ERROR] Settle requires phase settling, got: %PHASE%
  exit /b 1
)

if defined PROMPTPILE_MCP_BASE_URL goto settle_external
call npx --prefix "%DAY_LOOM_DIR%" dayloom settle -d "%OUT_DIR%" --keep-session %*
goto settle_done

:settle_external
call npx --prefix "%DAY_LOOM_DIR%" dayloom settle -d "%OUT_DIR%" --keep-session --mcp-base-url "%PROMPTPILE_MCP_BASE_URL%" --mcp-token "%PROMPTPILE_MCP_TOKEN%" %*

:settle_done
if errorlevel 1 exit /b 1
for /f "usebackq delims=" %%p in (`node -e "const fs=require('fs');const p=process.argv[1]+'\\current.yaml';const m=fs.readFileSync(p,'utf8').match(/^phase:\s*(\S+)/m);console.log(m?m[1]:'')" "%OUT_DIR%"`) do set "PHASE=%%p"
if "%PHASE%"=="idle" (
  node "%~dp0scripts\verify-settle.js" "%OUT_DIR%"
) else (
  echo Settlement draft generated. Review days\*\ending\settlement.proposal.json before applying it.
)
exit /b %errorlevel%

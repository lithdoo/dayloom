@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "DAY_LOOM_DIR=%~dp0..\.."
set "WORLD_DIR=%~1"
set "LLM_CONFIG=%~2"
if not defined LLM_CONFIG set "LLM_CONFIG=%DAYLOOM_LLM_CONFIG%"

if not defined WORLD_DIR goto usage
if not defined LLM_CONFIG goto usage
if not exist "%WORLD_DIR%\" (
  echo World directory does not exist: %WORLD_DIR%
  exit /b 1
)
if not exist "%LLM_CONFIG%" (
  echo LLM config does not exist: %LLM_CONFIG%
  exit /b 1
)
for %%I in ("%WORLD_DIR%") do set "WORLD_DIR=%%~fI"
for %%I in ("%LLM_CONFIG%") do set "LLM_CONFIG=%%~fI"

set "DIAGNOSTIC_DIR=%~dp0.runtime\diagnostics"
if not exist "%DIAGNOSTIC_DIR%" mkdir "%DIAGNOSTIC_DIR%"
for /f "delims=" %%v in ('node -e "process.stdout.write(new Date().toISOString().replace(/[:.]/g,'-'))"') do set "DIAGNOSTIC_RUN_ID=%%v-%RANDOM%"
set "DAYLOOM_DIAGNOSTIC_RUN_ID=%DIAGNOSTIC_RUN_ID%"
set "BINDTTY_DIAGNOSTIC_RUN_ID=%DIAGNOSTIC_RUN_ID%"
set "DAYLOOM_DIAGNOSTIC_LOG_FILE=%DIAGNOSTIC_DIR%\dayloom-%DIAGNOSTIC_RUN_ID%.jsonl"
set "BINDTTY_DIAGNOSTIC_LOG_FILE=%DIAGNOSTIC_DIR%\bindtty-%DIAGNOSTIC_RUN_ID%.jsonl"

echo ============================================================
echo  Dayloom TUI - Windows resize smoke test
echo ============================================================
echo.
echo [env]
echo   cwd            = %CD%
echo   shell          = %ComSpec%
echo   WT_SESSION     = %WT_SESSION%
echo   TERM_PROGRAM   = %TERM_PROGRAM%
echo   diagnostic run = %DIAGNOSTIC_RUN_ID%
echo   dayloom log    = %DAYLOOM_DIAGNOSTIC_LOG_FILE%
echo   bindtty log    = %BINDTTY_DIAGNOSTIC_LOG_FILE%
for /f "delims=" %%v in ('node -p "process.versions.node" 2^>nul') do echo   node            = %%v
pushd "%DAY_LOOM_DIR%" >nul
for /f "delims=" %%v in ('node -p "require('./node_modules/bindtty/package.json').version" 2^>nul') do echo   bindtty         = %%v
for /f "delims=" %%v in ('node -p "require('./node_modules/@bindtty/terminal/package.json').version" 2^>nul') do echo   @bindtty/terminal = %%v
for /f "delims=" %%v in ('git rev-parse --short HEAD 2^>nul') do echo   dayloom HEAD    = %%v
popd >nul
echo.

if defined WT_SESSION (
  echo [host] Windows Terminal detected - good for this check.
) else if /i "%TERM_PROGRAM%"=="vscode" (
  echo [host] WARNING: VS Code-compatible terminals are not in the BindTTY resize matrix.
  echo         Prefer Windows Terminal or classic Console Host.
) else (
  echo [host] No WT_SESSION - likely classic Console Host. Also valid for this check.
)
echo.

cd /d "%DAY_LOOM_DIR%"
call npm run build -w @dayloom/archive-protocol -w @dayloom/core2 -w @dayloom/tui
if errorlevel 1 exit /b 1

echo.
echo ============================================================
echo  Checklist ^(after the TUI starts^)
echo ============================================================
echo  1. Confirm header, footer, and message area at the current size.
echo  2. Slowly shrink width to about 20 columns, then widen to about 80.
echo  3. Shrink to the host minimum width, then restore to about 80.
echo  4. Drag a horizontal edge rapidly 10+ times; stop near 40 columns; wait 2s.
echo  5. Change height once shorter, once taller.
echo  6. Maximize, then restore.
echo.
echo  PASS if there are no stale characters, overlaps, lost chrome, or broken CJK cells.
echo  FAIL if the screen remains garbled after 2s idle or Ctrl+C breaks the shell.
echo.
echo  Exit: Ctrl+C
echo  World dir: %WORLD_DIR%
echo  LLM config: %LLM_CONFIG%
echo  Dayloom log: %DAYLOOM_DIAGNOSTIC_LOG_FILE%
echo  BindTTY log: %BINDTTY_DIAGNOSTIC_LOG_FILE%
echo ============================================================
echo.
pause

echo Starting dayloom-tui...
echo.
call node packages\tui\dist\main.js "%WORLD_DIR%" --llm-config "%LLM_CONFIG%"
set "EXITCODE=%errorlevel%"

echo.
echo ============================================================
echo  TUI exited with code %EXITCODE%
echo  The cursor should be visible and the shell prompt should work normally.
echo  Dayloom log: %DAYLOOM_DIAGNOSTIC_LOG_FILE%
echo  BindTTY log: %BINDTTY_DIAGNOSTIC_LOG_FILE%
echo ============================================================
exit /b %EXITCODE%

:usage
echo Usage: verify-resize.bat ^<planned-archive-v2-world^> [llm-config]
echo The config may instead be supplied through DAYLOOM_LLM_CONFIG.
exit /b 1

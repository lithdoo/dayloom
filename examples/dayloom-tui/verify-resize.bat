@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

rem Manual Windows resize check for dayloom-tui (BindTTY beta.2+).
rem Prefer Windows Terminal or classic Console Host — Cursor/VS Code terminals are not in the BindTTY matrix.

set "WORLD_DIR=%~dp0world"
set "LLM_CONFIG=%~dp0llm.toml"
set "DAY_LOOM_DIR=%~dp0..\.."
set "DIAGNOSTIC_DIR=%~dp0.runtime\diagnostics"
if not exist "%DIAGNOSTIC_DIR%" mkdir "%DIAGNOSTIC_DIR%"
for /f "delims=" %%v in ('node -e "process.stdout.write(new Date().toISOString().replace(/[:.]/g,'-'))"') do set "DIAGNOSTIC_RUN_ID=%%v-%RANDOM%"
set "DAYLOOM_DIAGNOSTIC_RUN_ID=%DIAGNOSTIC_RUN_ID%"
set "BINDTTY_DIAGNOSTIC_RUN_ID=%DIAGNOSTIC_RUN_ID%"
set "DAYLOOM_DIAGNOSTIC_LOG_FILE=%DIAGNOSTIC_DIR%\dayloom-%DIAGNOSTIC_RUN_ID%.jsonl"
set "BINDTTY_DIAGNOSTIC_LOG_FILE=%DIAGNOSTIC_DIR%\bindtty-%DIAGNOSTIC_RUN_ID%.jsonl"

echo ============================================================
echo  dayloom TUI — Windows resize smoke test
echo ============================================================
echo.
echo [env]
echo   cwd          = %CD%
echo   shell        = %ComSpec%
echo   WT_SESSION   = %WT_SESSION%
echo   TERM_PROGRAM = %TERM_PROGRAM%
echo   columns/rows = %COLUMNS%x%LINES%  (may be empty in cmd)
echo   diagnostic run = %DIAGNOSTIC_RUN_ID%
echo   dayloom log    = %DAYLOOM_DIAGNOSTIC_LOG_FILE%
echo   bindtty log    = %BINDTTY_DIAGNOSTIC_LOG_FILE%
for /f "delims=" %%v in ('node -p "process.versions.node" 2^>nul') do echo   node         = %%v
pushd "%DAY_LOOM_DIR%" >nul
for /f "delims=" %%v in ('node -p "require(\"./node_modules/bindtty/package.json\").version" 2^>nul') do echo   bindtty      = %%v
for /f "delims=" %%v in ('node -p "require(\"./node_modules/@bindtty/terminal/package.json\").version" 2^>nul') do echo   @bindtty/terminal = %%v
for /f "delims=" %%v in ('git rev-parse --short HEAD 2^>nul') do echo   dayloom HEAD = %%v
popd >nul
echo.

if defined WT_SESSION (
  echo [host] Windows Terminal detected — good for this check.
) else if /i "%TERM_PROGRAM%"=="vscode" (
  echo [host] WARNING: Cursor/VS Code terminal — BindTTY resize matrix does NOT cover this host.
  echo         Prefer: Windows Terminal ^> PowerShell ^> run this bat.
) else (
  echo [host] No WT_SESSION — likely classic Console Host ^(conhost^). Also OK for this check.
)
echo.

call "%~dp0scripts\ensure-dayloom.bat"
if errorlevel 1 (
  echo [ERROR] ensure-dayloom failed.
  exit /b 1
)

if not exist "%LLM_CONFIG%" (
  echo [ERROR] Copy llm.example.toml to llm.toml before running this check.
  exit /b 1
)

if not exist "%WORLD_DIR%" mkdir "%WORLD_DIR%"

echo.
echo ============================================================
echo  Checklist ^(do this AFTER the TUI starts^)
echo ============================================================
echo  1. Confirm header/footer/message area look normal at current size.
echo  2. Slowly shrink width to ~20 cols, then widen to ~80.
echo  3. Shrink to host minimum width, then restore ~80.
echo  4. Drag left/right edge rapidly 10+ times; stop at ~40 cols; wait 2s.
echo  5. Change height once shorter, once taller.
echo  6. Maximize, then restore.
echo.
echo  PASS if after each stop:
echo    - no leftover characters from previous width
echo    - no duplicated / overlapping lines
echo    - no irreversible scroll that eats the top chrome
echo    - CJK wraps cleanly, no half-cells
echo  FAIL if screen stays garbled after 2s idle, or Ctrl+C leaves broken shell.
echo.
echo  Exit: Ctrl+C
echo  World dir: %WORLD_DIR%
echo  Dayloom log: %DAYLOOM_DIAGNOSTIC_LOG_FILE%
echo  BindTTY log: %BINDTTY_DIAGNOSTIC_LOG_FILE%
echo ============================================================
echo.
pause

echo Starting dayloom-tui...
echo.
call node "%DAY_LOOM_DIR%\packages\tui\dist\main.js" "%WORLD_DIR%" --llm-config "%LLM_CONFIG%"
set "EXITCODE=%errorlevel%"

echo.
echo ============================================================
echo  TUI exited with code %EXITCODE%
echo  After exit: cursor should be visible; shell prompt should work normally.
echo  Dayloom log: %DAYLOOM_DIAGNOSTIC_LOG_FILE%
echo  BindTTY log: %BINDTTY_DIAGNOSTIC_LOG_FILE%
echo ============================================================
exit /b %EXITCODE%

@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "OUT_DIR=%~dp0output\world-quick"
set "DAY_LOOM_DIR=%~dp0..\.."

call "%~dp0scripts\ensure-dayloom.bat" quick
if errorlevel 1 exit /b 1

if exist "%OUT_DIR%" (
  echo Removing previous output: %OUT_DIR%
  rmdir /s /q "%OUT_DIR%"
)

echo Launching dayloom-tui with --quick (no API key required)...
echo Use --no-auto-start: explore the shell before any session starts.
echo.

call npx --prefix "%DAY_LOOM_DIR%" dayloom-tui ^
  "%OUT_DIR%" ^
  --quick ^
  --id campus_demo ^
  --title "Campus Demo" ^
  --no-auto-start
if errorlevel 1 exit /b 1

if exist "%OUT_DIR%\manifest.yaml" (
  echo.
  echo Verifying quick world...
  node "%~dp0..\dayloom-init-revise\scripts\verify-world.js" "%OUT_DIR%" --mode quick
  echo.
  echo Success: %OUT_DIR%
) else (
  echo [WARN] World was not created. Run again and confirm quick init in the TUI shell.
  exit /b 1
)

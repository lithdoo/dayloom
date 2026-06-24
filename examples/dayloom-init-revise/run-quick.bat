@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "OUT_DIR=%~dp0output\world-quick"
set "DAY_LOOM_DIR=%~dp0..\..\packages\dayloom"

call "%~dp0scripts\ensure-dayloom.bat"
if errorlevel 1 exit /b 1

if exist "%OUT_DIR%" (
  echo Removing previous output: %OUT_DIR%
  rmdir /s /q "%OUT_DIR%"
)

echo Running dayloom init --quick...
call npx --prefix "%DAY_LOOM_DIR%" dayloom init ^
  -d "%OUT_DIR%" ^
  --quick ^
  --id campus_demo ^
  --title "Campus Demo"
if errorlevel 1 (
  echo [ERROR] dayloom init --quick failed.
  exit /b 1
)

echo Verifying world save...
node "%~dp0scripts\verify-world.js" "%OUT_DIR%" --mode quick
if errorlevel 1 (
  echo [ERROR] verify-world failed.
  exit /b 1
)

echo.
echo Success: %OUT_DIR%
exit /b 0

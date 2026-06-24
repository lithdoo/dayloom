@echo off
setlocal
cd /d "%~dp0"

set "OUT_DIR=%~dp0output\world-revise-smoke"
set "DAY_LOOM_DIR=%~dp0..\..\packages\dayloom"

call "%~dp0scripts\ensure-dayloom.bat" init
if errorlevel 1 exit /b 1

if exist "%OUT_DIR%" rmdir /s /q "%OUT_DIR%"

call npx --prefix "%DAY_LOOM_DIR%" dayloom init ^
  -d "%OUT_DIR%" ^
  --quick ^
  --id revise_smoke ^
  --title "Revise Smoke"
if errorlevel 1 exit /b 1

call npx --prefix "%DAY_LOOM_DIR%" dayloom revise ^
  -d "%OUT_DIR%" ^
  --proposal "%~dp0fixtures\revise-proposal.json" ^
  --dry-run
if errorlevel 1 exit /b 1

call npx --prefix "%DAY_LOOM_DIR%" dayloom revise ^
  -d "%OUT_DIR%" ^
  --proposal "%~dp0fixtures\revise-proposal.json" ^
  --yes
if errorlevel 1 exit /b 1

node "%~dp0scripts\verify-world.js" "%OUT_DIR%" --mode revise
exit /b %errorlevel%

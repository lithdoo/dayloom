@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "WORLD_DIR=%~dp0world"
set "DAY_LOOM_DIR=%~dp0..\.."

call "%~dp0scripts\ensure-dayloom.bat" quick
if errorlevel 1 exit /b 1

if not exist "%WORLD_DIR%" mkdir "%WORLD_DIR%"

echo Opening dayloom-tui on: %WORLD_DIR%
echo.

call node "%DAY_LOOM_DIR%\packages\tui\dist\main.js" ^
  "%WORLD_DIR%" ^
  --no-auto-start ^
  --locale zh
exit /b %errorlevel%

@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "DAY_LOOM_DIR=%~dp0..\.."
set "WORLD_DIR=%~1"
set "LLM_CONFIG=%~2"
if not defined LLM_CONFIG set "LLM_CONFIG=%DAYLOOM_LLM_CONFIG%"

if not defined WORLD_DIR goto usage
if not defined LLM_CONFIG goto usage

cd /d "%DAY_LOOM_DIR%"
call npm run build -w @dayloom/archive-protocol -w @dayloom/core2 -w @dayloom/tui
if errorlevel 1 exit /b 1
call node packages\tui\dist\main.js "%WORLD_DIR%" --llm-config "%LLM_CONFIG%"
exit /b %errorlevel%

:usage
echo Usage: open-world.bat ^<archive-v2-world^> ^<llm-config^>
echo The config may instead be supplied through DAYLOOM_LLM_CONFIG.
exit /b 1

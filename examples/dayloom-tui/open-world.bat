@echo off
setlocal
cd /d "%~dp0"

set "DAY_LOOM_DIR=%~dp0..\.."
set "WORLD_DIR=%~dp0world"
set "LLM_CONFIG=%~dp0llm.toml"

if not exist "%LLM_CONFIG%" (
  echo Creating default LLM config: %LLM_CONFIG%
  copy /y "%~dp0llm.example.toml" "%LLM_CONFIG%" >nul
  if errorlevel 1 (
    echo [ERROR] Failed to create default LLM config: %LLM_CONFIG%
    exit /b 1
  )
)

call "%~dp0scripts\ensure-dayloom.bat"
if errorlevel 1 exit /b 1
if not exist "%WORLD_DIR%" mkdir "%WORLD_DIR%"

echo Opening dayloom-tui on: %WORLD_DIR%
call node "%DAY_LOOM_DIR%\packages\tui\dist\main.js" "%WORLD_DIR%" --llm-config "%LLM_CONFIG%"
exit /b %errorlevel%

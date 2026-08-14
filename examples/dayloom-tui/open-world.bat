@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "DAY_LOOM_DIR=%~dp0..\.."
set "WORLD_DIR=%~1"
set "LLM_CONFIG=%~2"
if not defined WORLD_DIR set "WORLD_DIR=%SCRIPT_DIR%world"
if not defined LLM_CONFIG set "LLM_CONFIG=%DAYLOOM_LLM_CONFIG%"
if not defined LLM_CONFIG (
  set "LLM_CONFIG=%SCRIPT_DIR%llm.toml"
  if not exist "%SCRIPT_DIR%llm.toml" (
    copy /y "%SCRIPT_DIR%llm.example.toml" "%SCRIPT_DIR%llm.toml" >nul
    if errorlevel 1 (
      echo Failed to create default LLM config: %SCRIPT_DIR%llm.toml
      exit /b 1
    )
  )
)
if not exist "%WORLD_DIR%\" (
  mkdir "%WORLD_DIR%"
  if errorlevel 1 (
    echo Failed to create world directory: %WORLD_DIR%
    exit /b 1
  )
)
if not exist "%LLM_CONFIG%" (
  echo LLM config does not exist: %LLM_CONFIG%
  exit /b 1
)
for %%I in ("%WORLD_DIR%") do set "WORLD_DIR=%%~fI"
for %%I in ("%LLM_CONFIG%") do set "LLM_CONFIG=%%~fI"

cd /d "%DAY_LOOM_DIR%"
call npm run build -w @dayloom/archive-protocol -w @dayloom/core2 -w @dayloom/tui
if errorlevel 1 exit /b 1
call node examples\dayloom-tui\init-world.mjs "%WORLD_DIR%"
if errorlevel 1 exit /b 1
call node packages\tui\dist\main.js "%WORLD_DIR%" --llm-config "%LLM_CONFIG%"
exit /b %errorlevel%

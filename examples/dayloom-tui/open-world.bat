@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

if exist ".env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do (
    if not "%%a"=="" if not "%%b"=="" (
      if /i "%%a"=="DEEPSEEK_API_KEY" set "DEEPSEEK_API_KEY=%%b"
      if /i "%%a"=="DAYLOOM_LLM_API_NAME" set "DAYLOOM_LLM_API_NAME=%%b"
      if /i "%%a"=="DAYLOOM_LLM_MODEL" set "DAYLOOM_LLM_MODEL=%%b"
      if /i "%%a"=="DAYLOOM_LLM_BASE_URL" set "DAYLOOM_LLM_BASE_URL=%%b"
      if /i "%%a"=="DAYLOOM_LLM_API_KEY_ENV" set "DAYLOOM_LLM_API_KEY_ENV=%%b"
      if /i "%%a"=="PROMPTPILE_BIN" set "PROMPTPILE_BIN=%%b"
    )
  )
)

set "WORLD_DIR=%~dp0world2"
set "DAY_LOOM_DIR=%~dp0..\.."

call "%~dp0scripts\ensure-dayloom.bat"
if errorlevel 1 exit /b 1
if not exist "%WORLD_DIR%" mkdir "%WORLD_DIR%"

echo Opening dayloom-tui on: %WORLD_DIR%
echo.
call node "%DAY_LOOM_DIR%\packages\tui2\dist\main.js" "%WORLD_DIR%"
exit /b %errorlevel%

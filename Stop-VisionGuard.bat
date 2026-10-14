@echo off
setlocal enabledelayedexpansion

REM ============================================================================
REM VisionGuard — Service Stopper
REM ============================================================================

title VisionGuard Stopper

set "PROJECT_ROOT=%~dp0"
if "%PROJECT_ROOT:~-1%"=="\" set "PROJECT_ROOT=%PROJECT_ROOT:~0,-1%"

cd /d "%PROJECT_ROOT%"

echo ============================================================================
echo   Stopping VisionGuard Services...
echo ============================================================================

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_ROOT%\scripts\Stop-VisionGuard.ps1" -ProjectRoot "%PROJECT_ROOT%"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [WARNING] Stop script encountered a notice. See details above.
)

echo.
echo Press any key to close this window...
pause >nul
endlocal

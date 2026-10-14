@echo off
setlocal enabledelayedexpansion

REM ============================================================================
REM VisionGuard — Windows One-Click Launcher
REM ============================================================================

title VisionGuard Launcher

REM Resolve project root path safely, handling spaces in directory paths
set "PROJECT_ROOT=%~dp0"
if "%PROJECT_ROOT:~-1%"=="\" set "PROJECT_ROOT=%PROJECT_ROOT:~0,-1%"

cd /d "%PROJECT_ROOT%"

echo ============================================================================
echo   VisionGuard Traffic Intelligence Platform
echo   One-Click Launcher for Windows
echo ============================================================================
echo [INFO] Project directory: "%PROJECT_ROOT%"
echo.

REM Verify PowerShell is available
where powershell >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] PowerShell is required but was not found on your system PATH.
    echo Please install Windows PowerShell or ensure powershell.exe is in PATH.
    echo.
    pause
    exit /b 1
)

REM Execute the PowerShell launcher script with ExecutionPolicy Bypass
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_ROOT%\scripts\Start-VisionGuard.ps1" -ProjectRoot "%PROJECT_ROOT%"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] VisionGuard launcher encountered an issue. See details above.
    pause
    exit /b %ERRORLEVEL%
)

endlocal

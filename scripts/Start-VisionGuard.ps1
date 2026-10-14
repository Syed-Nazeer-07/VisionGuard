[CmdletBinding()]
param(
    [string]$ProjectRoot = ""
)

$ErrorActionPreference = "Continue"

if (-not $ProjectRoot) {
    $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "                VISIONGUARD ONE-CLICK SYSTEM LAUNCHER                   " -ForegroundColor Cyan
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "Project Directory: $ProjectRoot" -ForegroundColor Gray
Write-Host ""

# -----------------------------------------------------------------------------
# 1. Check Node.js
# -----------------------------------------------------------------------------
Write-Host "[1/5] Checking Node.js installation..." -NoNewline
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host " [MISSING]" -ForegroundColor Red
    Write-Host ""
    Write-Host "------------------------------------------------------------------------" -ForegroundColor Red
    Write-Host "[ERROR] Node.js is not installed or not found on system PATH." -ForegroundColor Red
    Write-Host "Action Required:" -ForegroundColor Yellow
    Write-Host "  1. Download and install Node.js LTS (v18+ or v20+) from: https://nodejs.org" -ForegroundColor White
    Write-Host "  2. Restart your terminal or command prompt and re-run Start-VisionGuard.bat" -ForegroundColor White
    Write-Host "------------------------------------------------------------------------" -ForegroundColor Red
    Read-Host "Press Enter to exit..."
    exit 1
}
$nodeVersion = (& node -v 2>$null).Trim()
Write-Host " [OK] ($nodeVersion)" -ForegroundColor Green

# -----------------------------------------------------------------------------
# 2. Check Frontend Dependencies
# -----------------------------------------------------------------------------
Write-Host "[2/5] Checking frontend dependencies (node_modules)..." -NoNewline
$webNodeModules = Join-Path $ProjectRoot "apps\web\node_modules"
$rootNodeModules = Join-Path $ProjectRoot "node_modules"

if (-not (Test-Path $webNodeModules) -and -not (Test-Path $rootNodeModules)) {
    Write-Host " [MISSING]" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "------------------------------------------------------------------------" -ForegroundColor Yellow
    Write-Host "[WARNING] Frontend packages are not yet installed." -ForegroundColor Yellow
    Write-Host "Action Required:" -ForegroundColor Yellow
    Write-Host "  Please run 'npm install' in the project directory before launching:" -ForegroundColor White
    Write-Host "    cd `"$ProjectRoot`"" -ForegroundColor White
    Write-Host "    npm install" -ForegroundColor White
    Write-Host "------------------------------------------------------------------------" -ForegroundColor Yellow
    Read-Host "Press Enter to exit..."
    exit 1
}
Write-Host " [OK]" -ForegroundColor Green

# -----------------------------------------------------------------------------
# 3. Check Python and Backend Virtual Environment
# -----------------------------------------------------------------------------
Write-Host "[3/5] Checking Python backend environment..." -NoNewline
$backendDir = Join-Path $ProjectRoot "backend"
$venvPython = Join-Path $backendDir ".venv\Scripts\python.exe"
$altVenvPython = Join-Path $backendDir "venv\Scripts\python.exe"

$pythonExe = ""
if (Test-Path $venvPython) {
    $pythonExe = $venvPython
} elseif (Test-Path $altVenvPython) {
    $pythonExe = $altVenvPython
} else {
    $sysPython = Get-Command python -ErrorAction SilentlyContinue
    if (-not $sysPython) {
        Write-Host " [PYTHON MISSING]" -ForegroundColor Red
        Write-Host ""
        Write-Host "------------------------------------------------------------------------" -ForegroundColor Red
        Write-Host "[ERROR] Python is not installed or not available in PATH." -ForegroundColor Red
        Write-Host "Action Required:" -ForegroundColor Yellow
        Write-Host "  1. Download Python 3.10 or 3.11 from: https://www.python.org/downloads/" -ForegroundColor White
        Write-Host "  2. Ensure 'Add python.exe to PATH' is checked during installation." -ForegroundColor White
        Write-Host "  3. Re-run Start-VisionGuard.bat." -ForegroundColor White
        Write-Host "------------------------------------------------------------------------" -ForegroundColor Red
        Read-Host "Press Enter to exit..."
        exit 1
    }

    Write-Host " [VENV MISSING]" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "------------------------------------------------------------------------" -ForegroundColor Yellow
    Write-Host "[WARNING] Backend virtual environment not found in backend\.venv" -ForegroundColor Yellow
    Write-Host "Action Required:" -ForegroundColor Yellow
    Write-Host "  To configure the backend virtual environment, run:" -ForegroundColor White
    Write-Host "    cd `"$backendDir`"" -ForegroundColor White
    Write-Host "    python -m venv .venv" -ForegroundColor White
    Write-Host "    .\.venv\Scripts\pip install -r requirements.txt" -ForegroundColor White
    Write-Host "------------------------------------------------------------------------" -ForegroundColor Yellow
    Read-Host "Press Enter to exit..."
    exit 1
}

$pyVersion = (& $pythonExe --version 2>&1).Trim()
Write-Host " [OK] ($pyVersion)" -ForegroundColor Green

# -----------------------------------------------------------------------------
# 4. Check for already running VisionGuard services
# -----------------------------------------------------------------------------
Write-Host "[4/5] Checking for existing VisionGuard service processes..." -ForegroundColor Cyan

function Test-PortOpen([int]$Port) {
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $iar = $tcp.BeginConnect("127.0.0.1", $Port, $null, $null)
        $wh = $iar.AsyncWaitHandle.WaitOne(300, $false)
        if ($wh -and $tcp.Connected) {
            $tcp.EndConnect($iar)
            $tcp.Close()
            return $true
        }
        $tcp.Close()
    } catch {}
    return $false
}

$backendAlreadyRunning = $false
$frontendAlreadyRunning = $false
$backendProvider = "CPU"

if (Test-PortOpen 8000) {
    try {
        $h = Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/v1/health" -TimeoutSec 1 -ErrorAction Stop
        if ($h.status -eq "ok" -or $h.service) {
            $backendAlreadyRunning = $true
            if ($h.execution_provider) {
                $backendProvider = $h.execution_provider.Replace("ExecutionProvider", "")
            }
            Write-Host "  * FastAPI Backend already active on port 8000 [REUSING]" -ForegroundColor Green
        }
    } catch {}
}

if (Test-PortOpen 3000) {
    try {
        $w = Invoke-WebRequest -Uri "http://localhost:3000" -TimeoutSec 1 -UseBasicParsing -ErrorAction Stop
        if ($w.StatusCode -eq 200) {
            $frontendAlreadyRunning = $true
            Write-Host "  * Vite Frontend already active on port 3000 [REUSING]" -ForegroundColor Green
        }
    } catch {}
}

$pidFile = Join-Path $ProjectRoot ".visionguard.pids"

# -----------------------------------------------------------------------------
# 5. Start Backend and Frontend (only if not already running)
# -----------------------------------------------------------------------------
Write-Host "[5/5] Launching VisionGuard Backend & Frontend..." -ForegroundColor Cyan

$backendProcess = $null
if (-not $backendAlreadyRunning) {
    Write-Host "  -> Starting FastAPI Backend on http://127.0.0.1:8000..." -ForegroundColor Gray
    $backendCmd = "`"$pythonExe`" -m uvicorn app.main:app --host 127.0.0.1 --port 8000"
    $backendProcess = Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/k title [VisionGuard] Backend (FastAPI :8000) & cd /d `"$backendDir`" & $backendCmd" `
        -WorkingDirectory $backendDir `
        -PassThru
}

$frontendProcess = $null
if (-not $frontendAlreadyRunning) {
    Write-Host "  -> Starting React/Vite Frontend on http://localhost:3000..." -ForegroundColor Gray
    $frontendCmd = "npm run dev"
    $frontendProcess = Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/k title [VisionGuard] Frontend (Vite :3000) & cd /d `"$ProjectRoot`" & $frontendCmd" `
        -WorkingDirectory $ProjectRoot `
        -PassThru
}

# Save PIDs
$pidsObj = [PSCustomObject]@{
    backend_pid = if ($backendProcess) { $backendProcess.Id } else { $null }
    frontend_pid = if ($frontendProcess) { $frontendProcess.Id } else { $null }
    started_at = (Get-Date).ToString("o")
    backend_url = "http://127.0.0.1:8000"
    frontend_url = "http://localhost:3000"
}
$pidsObj | ConvertTo-Json | Set-Content -Path $pidFile -Encoding UTF8

# -----------------------------------------------------------------------------
# 6. Wait / Health-Check Loop
# -----------------------------------------------------------------------------
Write-Host ""
$backendHealthy = $backendAlreadyRunning
$frontendReady = $frontendAlreadyRunning
$maxSeconds = 30
$sw = [System.Diagnostics.Stopwatch]::StartNew()

if (-not ($backendHealthy -and $frontendReady)) {
    Write-Host "Checking service responsiveness (waiting up to 30s)..." -ForegroundColor Yellow
}

while ($sw.Elapsed.TotalSeconds -lt $maxSeconds) {
    if (-not $backendHealthy) {
        try {
            $healthRes = Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/v1/health" -TimeoutSec 1 -ErrorAction Stop
            if ($healthRes.status -eq "ok" -or $healthRes.service) {
                $backendHealthy = $true
                if ($healthRes.execution_provider) {
                    $backendProvider = $healthRes.execution_provider.Replace("ExecutionProvider", "")
                }
                Write-Host "  * Local AI Backend is ONLINE ($backendProvider acceleration)" -ForegroundColor Green
            }
        } catch {}
    }

    if (-not $frontendReady) {
        try {
            $webRes = Invoke-WebRequest -Uri "http://localhost:3000" -TimeoutSec 1 -UseBasicParsing -ErrorAction Stop
            if ($webRes.StatusCode -eq 200) {
                $frontendReady = $true
                Write-Host "  * React / Vite Frontend is ONLINE at http://localhost:3000" -ForegroundColor Green
            }
        } catch {}
    }

    if ($backendHealthy -and $frontendReady) {
        break
    }
    Start-Sleep -Milliseconds 600
}

# -----------------------------------------------------------------------------
# 7. Open Browser & Print Summary
# -----------------------------------------------------------------------------
if ($frontendReady) {
    Write-Host ""
    Write-Host "Opening VisionGuard in your default web browser..." -ForegroundColor Cyan
    Start-Process "http://localhost:3000"
} else {
    Write-Host ""
    Write-Host "[NOTICE] Frontend did not respond within $maxSeconds seconds." -ForegroundColor Yellow
    Write-Host "Inspect the '[VisionGuard] Frontend (Vite :3000)' window for compile or port errors." -ForegroundColor Yellow
}

if (-not $backendHealthy) {
    Write-Host "[NOTICE] Local AI Backend did not respond within $maxSeconds seconds." -ForegroundColor Yellow
    Write-Host "Inspect the '[VisionGuard] Backend (FastAPI :8000)' window for startup errors." -ForegroundColor Yellow
    Write-Host "Note: Browser WebGPU mode remains available even if the backend is offline." -ForegroundColor Gray
}

Write-Host ""
Write-Host "========================================================================" -ForegroundColor Green
Write-Host "                  VISIONGUARD IS RUNNING SUCCESSFULLY                   " -ForegroundColor Green
Write-Host "========================================================================" -ForegroundColor Green
Write-Host "  * Web Application:  http://localhost:3000" -ForegroundColor White
Write-Host "  * Local AI Backend: http://127.0.0.1:8000  (Health: /api/v1/health)" -ForegroundColor White
Write-Host "  * Acceleration:     $backendProvider" -ForegroundColor White
Write-Host "  * Separate console windows are running for Backend and Frontend." -ForegroundColor Gray
Write-Host ""
Write-Host "To STOP all VisionGuard services cleanly:" -ForegroundColor Yellow
Write-Host "  - Run Stop-VisionGuard.bat from Windows Explorer, OR" -ForegroundColor Yellow
Write-Host "  - Type 'Q' and press Enter in this window." -ForegroundColor Yellow
Write-Host "========================================================================" -ForegroundColor Green
Write-Host ""

$inputChoice = Read-Host "Type 'Q' to quit and stop services, or press Enter to keep running in background"
if ($inputChoice -match "^[qsQS]$") {
    Write-Host "Shutting down services..." -ForegroundColor Yellow
    & (Join-Path $PSScriptRoot "Stop-VisionGuard.ps1") -ProjectRoot $ProjectRoot
}

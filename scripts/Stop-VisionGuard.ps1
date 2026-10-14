[CmdletBinding()]
param(
    [string]$ProjectRoot = ""
)

$ErrorActionPreference = "Continue"

if (-not $ProjectRoot) {
    $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "                    STOPPING VISIONGUARD SERVICES                       " -ForegroundColor Cyan
Write-Host "========================================================================" -ForegroundColor Cyan

$pidFile = Join-Path $ProjectRoot ".visionguard.pids"
$stoppedAny = $false

# 1. Stop services recorded in .visionguard.pids
if (Test-Path $pidFile) {
    try {
        $pidsData = Get-Content $pidFile -Raw | ConvertFrom-Json
        
        if ($pidsData.backend_pid) {
            Write-Host "Stopping Backend process tree (PID $($pidsData.backend_pid))..." -ForegroundColor Gray
            taskkill /PID $pidsData.backend_pid /T /F 2>$null
            $stoppedAny = $true
        }
        
        if ($pidsData.frontend_pid) {
            Write-Host "Stopping Frontend process tree (PID $($pidsData.frontend_pid))..." -ForegroundColor Gray
            taskkill /PID $pidsData.frontend_pid /T /F 2>$null
            $stoppedAny = $true
        }
        
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    } catch {
        Write-Host "Notice reading PID file: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# 2. Targeted cleanup: check port 8000 (FastAPI Backend)
try {
    $port8000 = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
    if ($port8000) {
        $proc8000 = Get-Process -Id $port8000.OwningProcess -ErrorAction SilentlyContinue
        if ($proc8000 -and $proc8000.ProcessName -match "python") {
            Write-Host "Terminating orphaned Python backend on port 8000 (PID $($proc8000.Id))..." -ForegroundColor Gray
            taskkill /PID $proc8000.Id /T /F 2>$null
            $stoppedAny = $true
        }
    }
} catch {}

# 3. Targeted cleanup: check port 3000 (Vite Frontend)
try {
    $port3000 = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
    if ($port3000) {
        $proc3000 = Get-Process -Id $port3000.OwningProcess -ErrorAction SilentlyContinue
        if ($proc3000 -and $proc3000.ProcessName -match "node") {
            Write-Host "Terminating orphaned Node frontend on port 3000 (PID $($proc3000.Id))..." -ForegroundColor Gray
            taskkill /PID $proc3000.Id /T /F 2>$null
            $stoppedAny = $true
        }
    }
} catch {}

Write-Host ""
if ($stoppedAny) {
    Write-Host "[OK] VisionGuard services stopped cleanly." -ForegroundColor Green
} else {
    Write-Host "[INFO] No active VisionGuard services were found running." -ForegroundColor Yellow
}
Write-Host "========================================================================" -ForegroundColor Cyan

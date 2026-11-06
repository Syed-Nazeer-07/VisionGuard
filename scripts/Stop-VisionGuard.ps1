[CmdletBinding()]
param(
    [string]$ProjectRoot = ""
)

$ErrorActionPreference = "Continue"

if (-not $ProjectRoot) {
    $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "                    STOPPING VISIONGUARD WEB SERVER                       " -ForegroundColor Cyan
Write-Host "========================================================================" -ForegroundColor Cyan

$pidFile = Join-Path $ProjectRoot ".visionguard.pids"
$stoppedAny = $false

# 1. Stop services recorded in .visionguard.pids
if (Test-Path $pidFile) {
    try {
        $pidsData = Get-Content $pidFile -Raw | ConvertFrom-Json
        
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

# 2. Only stop the local web server. Do not terminate unrelated Python services.
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

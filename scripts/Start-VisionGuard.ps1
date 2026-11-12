[CmdletBinding()]
param([string]$ProjectRoot = "")

$ErrorActionPreference = "Stop"
if (-not $ProjectRoot) {
    $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "        VISIONGUARD - LOCAL FIRST VIDEO ANALYSIS" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "Project: $ProjectRoot"
Write-Host "One engine: YOLO11s in the browser. Python and Supabase Storage are not required for local video analysis."
Write-Host ""

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Node.js is not installed. Install Node.js LTS." -ForegroundColor Red
    exit 1
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] npm is not available in PATH." -ForegroundColor Red
    exit 1
}

# Vite's workspace root is apps/web. Its own .env.local is needed for cloud
# login and B2 upload signing; repository-root .env files are not loaded.
$frontendEnvFile = Join-Path $ProjectRoot "apps\web\.env.local"
$cloudUrlConfigured = -not [string]::IsNullOrWhiteSpace($env:VITE_SUPABASE_URL)
$cloudKeyConfigured = -not [string]::IsNullOrWhiteSpace($env:VITE_SUPABASE_ANON_KEY)
if (Test-Path $frontendEnvFile) {
    $config = @(Get-Content -Path $frontendEnvFile -ErrorAction SilentlyContinue)
    if ($config | Where-Object { $_ -match '^\s*VITE_SUPABASE_URL\s*=\s*https?://' -and $_ -notmatch 'your-project|placeholder' }) {
        $cloudUrlConfigured = $true
    }
    if ($config | Where-Object { $_ -match '^\s*VITE_SUPABASE_ANON_KEY\s*=\s*(sb_publishable_|eyJ)' }) {
        $cloudKeyConfigured = $true
    }
}
if (-not ($cloudUrlConfigured -and $cloudKeyConfigured)) {
    Write-Host "[CLOUD SETUP] Local YOLO analysis is available, but B2 uploads and sign-in require Supabase Auth." -ForegroundColor Yellow
    Write-Host "  Copy apps\web\.env.example to apps\web\.env.local and fill in the PUBLIC project URL and publishable key." -ForegroundColor Yellow
    Write-Host "  Restart this Vite process after changing .env.local. Do not put B2 secrets in client files." -ForegroundColor Yellow
} else {
    Write-Host "[OK] Frontend cloud connection variables found (not displaying keys)." -ForegroundColor Green
}

$modelsDir = Join-Path $ProjectRoot "apps\web\public\models"
$model = Join-Path $modelsDir "yolo11s.onnx"
if (-not (Test-Path $model)) {
    Write-Host "[WARNING] YOLO11s missing at $model" -ForegroundColor Yellow
    Write-Host "Place your exported yolo11s.onnx here before analyzing videos." -ForegroundColor Yellow
}
if (-not (Test-Path (Join-Path $ProjectRoot "node_modules"))) {
    Write-Host "[SETUP] Installing frontend dependencies..." -ForegroundColor Yellow
    Push-Location $ProjectRoot
    try {
        & npm install
        if ($LASTEXITCODE -ne 0) { throw "npm install exited with code $LASTEXITCODE" }
    } finally { Pop-Location }
}

function Test-VisionGuard {
    try {
        $res = Invoke-WebRequest -Uri "http://127.0.0.1:3000/app/analyze" -TimeoutSec 2 -UseBasicParsing
        return ($res.StatusCode -eq 200)
    } catch { return $false }
}

$pidFile = Join-Path $ProjectRoot ".visionguard.pids"
if (-not (Test-VisionGuard)) {
    Write-Host "[START] Starting React/Vite at http://localhost:3000 ..." -ForegroundColor Cyan
    $cmd = 'title [VisionGuard] Web (Vite :3000) & cd /d "' + $ProjectRoot + '" & npm run dev'
    $process = Start-Process -FilePath "cmd.exe" -ArgumentList "/k $cmd" -WorkingDirectory $ProjectRoot -PassThru
    [PSCustomObject]@{
        frontend_pid = $process.Id
        frontend_url = "http://localhost:3000"
        started_at = (Get-Date).ToString("o")
    } | ConvertTo-Json | Set-Content -Path $pidFile -Encoding UTF8
} else {
    Write-Host "[OK] Existing frontend already running; reusing it." -ForegroundColor Green
    Write-Host "[TIP] If you changed apps\web\.env.local, stop that old Vite process and restart it to load the new settings." -ForegroundColor Yellow
}

$ready = $false
for ($i = 0; $i -lt 40; $i++) {
    if (Test-VisionGuard) { $ready = $true; break }
    Start-Sleep -Seconds 1
}
if (-not $ready) {
    Write-Host "[ERROR] Web server did not respond on port 3000." -ForegroundColor Red
    Write-Host "Check the [VisionGuard] Web console for errors or port conflicts." -ForegroundColor Yellow
    exit 1
}

Write-Host "[OK] Web application is responding at http://localhost:3000/app/analyze" -ForegroundColor Green
Write-Host "Upload a video, select Analyze, and review the saved results." -ForegroundColor White
Start-Process "http://localhost:3000/app/analyze"
Write-Host "Press Enter to leave the launcher open in the background, or type Q to stop." -ForegroundColor Gray
$choice = Read-Host "Choice"
if ($choice -match '^[qQ]$') {
    & (Join-Path $PSScriptRoot "Stop-VisionGuard.ps1") -ProjectRoot $ProjectRoot
}

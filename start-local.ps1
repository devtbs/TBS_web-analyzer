# Start the full local stack (Postgres + backend + frontend) in one command.
#   Run from the repo root:  ./start-local.ps1
# Each server starts detached so it survives this terminal closing.

$ErrorActionPreference = "SilentlyContinue"
$root = $PSScriptRoot

Write-Host "1/3  Postgres (Docker)..." -ForegroundColor Cyan
docker start tbs_pg | Out-Null

Write-Host "2/3  Backend (uvicorn :8000)..." -ForegroundColor Cyan
if (-not (Get-NetTCPConnection -State Listen -LocalPort 8000 -ErrorAction SilentlyContinue)) {
    $env:DATABASE_URL = "postgresql://tbs_user:tbs_secure_2024@localhost:5432/tbs_marketing"
    $env:PYTHONUTF8 = "1"
    Start-Process -FilePath "$root\backend\.venv\Scripts\python.exe" `
        -ArgumentList "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000" `
        -WorkingDirectory "$root\backend" -WindowStyle Hidden
} else { Write-Host "     already running" -ForegroundColor DarkGray }

Write-Host "3/3  Frontend (Vite :5173)..." -ForegroundColor Cyan
if (-not (Get-NetTCPConnection -State Listen -LocalPort 5173 -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm run dev" `
        -WorkingDirectory "$root\frontend" -WindowStyle Hidden
} else { Write-Host "     already running" -ForegroundColor DarkGray }

Write-Host "`nWaiting for servers..." -ForegroundColor Cyan
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 2
    $be = Get-NetTCPConnection -State Listen -LocalPort 8000 -ErrorAction SilentlyContinue
    $fe = Get-NetTCPConnection -State Listen -LocalPort 5173 -ErrorAction SilentlyContinue
    if ($be -and $fe) { break }
}
Write-Host ("backend :8000  " + $(if ($be) { "UP" } else { "DOWN" })) -ForegroundColor $(if ($be) { "Green" } else { "Red" })
Write-Host ("frontend :5173 " + $(if ($fe) { "UP" } else { "DOWN" })) -ForegroundColor $(if ($fe) { "Green" } else { "Red" })
Write-Host "`nOpen  http://localhost:5173" -ForegroundColor Yellow

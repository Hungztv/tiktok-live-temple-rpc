<#
.SYNOPSIS
    Kịch bản khởi chạy 1-Click cho Đại Chiến Thủy Cung (Backend + Frontend).
.DESCRIPTION
    Tự kiểm tra Python/Node, tạo .venv, cài dependencies, copy .env,
    khởi chạy song song Backend (127.0.0.1:8000) & Frontend (127.0.0.1:3000),
    tự mở trình duyệt và dọn dẹp tiến trình con khi bấm Ctrl+C.
#>

$ErrorActionPreference = "Stop"

# Cập nhật PATH mới nhất của máy và user (phòng trường hợp vừa cài Node/Python)
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $RootDir "backend"
$FrontendDir = Join-Path $RootDir "frontend"

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "   ĐẠI CHIẾN THỦY CUNG - KHỞI CHẠY LOCAL 1-CLICK" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan

# 1. Kiểm tra Python & Node.js
$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCmd) {
    Write-Host "[LỖI] Không tìm thấy Python 3.11+. Vui lòng cài đặt Python và thêm vào PATH." -ForegroundColor Red
    exit 1
}
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $nodeCmd -or -not $npmCmd) {
    Write-Host "[LỖI] Không tìm thấy Node.js / npm. Vui lòng cài đặt Node.js LTS." -ForegroundColor Red
    exit 1
}

Write-Host "[OK] Python: $(python --version)" -ForegroundColor Green
Write-Host "[OK] Node.js: $(node --version)" -ForegroundColor Green

# 2. Chuẩn bị Backend (.venv, pip install, .env)
$VenvPython = Join-Path $BackendDir ".venv\Scripts\python.exe"
$ReqFile = Join-Path $BackendDir "requirements.txt"
$EnvExample = Join-Path $BackendDir ".env.example"
$EnvFile = Join-Path $BackendDir ".env"

if (-not (Test-Path $VenvPython)) {
    Write-Host "[1/4] Đang tạo môi trường ảo Python (.venv)..." -ForegroundColor Yellow
    Push-Location $BackendDir
    python -m venv .venv
    Pop-Location
}

Write-Host "[2/4] Đang kiểm tra thư viện Backend..." -ForegroundColor Yellow
Push-Location $BackendDir
& $VenvPython -m pip install -q --no-input -r $ReqFile
Pop-Location

if (-not (Test-Path $EnvFile) -and (Test-Path $EnvExample)) {
    Copy-Item $EnvExample $EnvFile
    Write-Host "[OK] Đã tạo backend\.env từ .env.example" -ForegroundColor Green
}

# 3. Chuẩn bị Frontend (node_modules)
$NodeModules = Join-Path $FrontendDir "node_modules"
if (-not (Test-Path $NodeModules)) {
    Write-Host "[3/4] Đang cài đặt thư viện Frontend (npm install)..." -ForegroundColor Yellow
    Push-Location $FrontendDir
    & npm.cmd install --no-audit --no-fund
    Pop-Location
} else {
    Write-Host "[3/4] Đã có sẵn node_modules trong frontend." -ForegroundColor Green
}

# 4. Khởi chạy song song Backend & Frontend
$BackendProc = $null
$FrontendProc = $null

function Stop-ProcessTree {
    param([int]$ProcessId)
    if ($ProcessId -gt 0) {
        try {
            Start-Process -FilePath "taskkill.exe" -ArgumentList "/PID $ProcessId /T /F" -WindowStyle Hidden -Wait -ErrorAction SilentlyContinue | Out-Null
        } catch {
            # Bỏ qua nếu tiến trình đã tắt
        }
    }
}

try {
    Write-Host "[4/4] Đang khởi động Backend (127.0.0.1:8000) & Frontend (127.0.0.1:3000)..." -ForegroundColor Yellow

    $BackendProc = Start-Process -FilePath $VenvPython `
        -ArgumentList "-m uvicorn main:app --host 127.0.0.1 --port 8000" `
        -WorkingDirectory $BackendDir `
        -PassThru `
        -NoNewWindow

    $FrontendProc = Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c npm.cmd run dev -- --hostname 127.0.0.1 --port 3000" `
        -WorkingDirectory $FrontendDir `
        -PassThru `
        -NoNewWindow

    # Đợi Backend /health sẵn sàng (tối đa 20s)
    $ready = $false
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 500
        if ($BackendProc.HasExited) {
            throw "Backend đã thoát sớm với mã $($BackendProc.ExitCode)."
        }
        try {
            $resp = Invoke-RestMethod -Uri "http://127.0.0.1:8000/health" -TimeoutSec 1 -ErrorAction Stop
            if ($resp.status -eq "ok") {
                $ready = $true
                break
            }
        } catch {
            # Tiếp tục đợi
        }
    }

    if ($ready) {
        Write-Host "[OK] Backend đã sẵn sàng tại http://127.0.0.1:8000" -ForegroundColor Green
    } else {
        Write-Host "[CẢNH BÁO] Backend khởi động hơi chậm, vui lòng kiểm tra log phía trên." -ForegroundColor DarkYellow
    }

    # Đợi Frontend sẵn sàng (tối đa 20s)
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 500
        if ($FrontendProc.HasExited) {
            throw "Frontend đã thoát sớm với mã $($FrontendProc.ExitCode)."
        }
        try {
            $r = Invoke-WebRequest -Uri "http://localhost:3000" -TimeoutSec 1 -UseBasicParsing -ErrorAction Stop
            if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) {
                break
            }
        } catch {
            # Tiếp tục đợi
        }
    }

    Write-Host ""
    Write-Host ">>> Đang mở trình duyệt..." -ForegroundColor Cyan
    Write-Host "    - Dashboard Quản trị : http://localhost:3000/dashboard" -ForegroundColor White
    Write-Host "    - Overlay Live (9:16): http://localhost:3000/overlay" -ForegroundColor White
    Write-Host "    - OBS Transparent    : http://localhost:3000/overlay?transparent=1" -ForegroundColor White
    Write-Host ""
    Write-Host "Nhấn Ctrl+C để dừng toàn bộ hệ thống." -ForegroundColor Yellow

    Start-Process "http://localhost:3000/dashboard"
    Start-Process "http://localhost:3000/overlay"

    # Giữ vòng lặp theo dõi tiến trình cho đến khi nhấn Ctrl+C
    while (-not $BackendProc.HasExited -and -not $FrontendProc.HasExited) {
        Start-Sleep -Seconds 1
    }
}
finally {
    Write-Host "`nĐang dọn dẹp và tắt Backend / Frontend..." -ForegroundColor Yellow
    if ($FrontendProc) { Stop-ProcessTree -ProcessId $FrontendProc.Id }
    if ($BackendProc) { Stop-ProcessTree -ProcessId $BackendProc.Id }
    Write-Host "Đã dừng sạch toàn bộ tiến trình." -ForegroundColor Green
}

# LandfillMind 一键清理 + 重启脚本
# 用法：在 PowerShell（管理员更稳）里执行
#   cd F:\zj_F\LandfillMind
#   .\restart-dev.ps1

# 1) 杀掉所有遗留的 node.exe（会结束本脚本之外的 dev 进程）
Write-Host "杀掉遗留 node.exe..." -ForegroundColor Yellow
Get-Process node -ErrorAction SilentlyContinue | ForEach-Object {
    try { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } catch {}
}
Start-Sleep -Seconds 2

# 2) 清掉过期的 db 锁 + tmp
$dbDir = "F:\zj_F\LandfillMind\data"
foreach ($name in @("chat.db.lock", "chat.db.tmp")) {
    $path = Join-Path $dbDir $name
    if (Test-Path $path) {
        Remove-Item $path -Force -ErrorAction SilentlyContinue
        Write-Host "  清掉 $path" -ForegroundColor Gray
    }
}

# 3) 验证 3000 / 5173 端口已释放
foreach ($port in 3000, 5173) {
    $inUse = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($inUse) {
        Write-Host "  ⚠ 端口 $port 仍被占用：PID $($inUse.OwningProcess)" -ForegroundColor Red
    } else {
        Write-Host "  ✓ 端口 $port 已释放" -ForegroundColor Green
    }
}

# 4) 后台启动前后端（用 Start-Process 而非 npm run dev，因 concurrently 在 PS 里表现不佳）
Write-Host "`n启动后端 (:3000)..." -ForegroundColor Cyan
Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "cd /d F:\zj_F\LandfillMind && npm run dev:server" -WindowStyle Hidden

Write-Host "启动前端 (:5173)..." -ForegroundColor Cyan
Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "cd /d F:\zj_F\LandfillMind && npm run dev:client" -WindowStyle Hidden

Write-Host "`n等待 10 秒后自动验证..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

foreach ($port in 3000, 5173) {
    $inUse = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($inUse) {
        Write-Host "  ✓ $port 已 LISTEN（PID $($inUse.OwningProcess)）" -ForegroundColor Green
    } else {
        Write-Host "  ✗ $port 仍未起来（查看弹窗日志或继续等）" -ForegroundColor Red
    }
}

Write-Host "`n完毕。在浏览器打开 http://localhost:5173" -ForegroundColor Cyan
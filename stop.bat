@echo off
title LandfillMind · 关闭服务
color 0C

echo ============================================================
echo   LandfillMind · 关闭后端 + 前端服务
echo ============================================================
echo.

:: 关闭 npm 启动的所有相关进程
taskkill /FI "WINDOWTITLE eq LandfillMind-Dev*" /T /F > nul 2>&1
taskkill /IM "node.exe" /FI "MEMUSAGE gt 50000" /T /F > nul 2>&1

:: 更直接：杀掉占用 3000 和 5173 的进程
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000 " ^| findstr LISTENING') do (
    echo [*] 关闭后端进程 PID=%%p
    taskkill /PID %%p /F > nul 2>&1
)
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":5173 " ^| findstr LISTENING') do (
    echo [*] 关闭前端进程 PID=%%p
    taskkill /PID %%p /F > nul 2>&1
)

echo.
echo   ✓ 服务已关闭
echo.
pause
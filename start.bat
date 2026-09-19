@echo off
chcp 65001 > nul
title LandfillMind · 填埋场智慧监测系统 v4.2
color 0A

echo ============================================================
echo   LandfillMind · 填埋场智慧监测系统 v4.2
echo   一键启动脚本 - 自动启动服务 + 打开浏览器
echo ============================================================
echo.

cd /d "%~dp0"

:: 检查 Node.js 是否可用
where node >nul 2>&1
if errorlevel 1 (
    echo [X] 未检测到 Node.js，请先安装 Node.js 18+
    echo     下载: https://nodejs.org/
    pause
    exit /b 1
)

:: 检查依赖是否安装
if not exist "node_modules" (
    echo [*] 首次启动，正在安装依赖（耗时约 30-60 秒）...
    call npm install
    if errorlevel 1 (
        echo [X] 依赖安装失败，请检查网络
        pause
        exit /b 1
    )
)

echo [*] 启动后端服务（端口 3000） + 前端服务（端口 5173）...
echo.

:: 启动 npm run dev（前后端并行）
start "LandfillMind-Dev" cmd /k "npm run dev"

:: 等待服务启动（首次可能需要 10-15 秒）
echo [*] 等待服务就绪...
timeout /t 8 /nobreak > nul

:: 自动打开浏览器（多个常用页面）
echo [*] 打开浏览器...
start "" "http://localhost:5173"

echo.
echo ============================================================
echo   ✓ 启动成功！
echo.
echo   主界面: http://localhost:5173
echo   聊天:   http://localhost:5173/chat/new
echo   诊断:   http://localhost:5173/diagnose
echo   计算中心: http://localhost:5173/design
echo   多智能体: http://localhost:5173/multi-agent
echo   3D 模拟: http://localhost:5173/3d-simulator
echo   后台:   http://localhost:5173/admin  (token: landfillmind-dev-2026)
echo.
echo   关闭此窗口不会停止服务，请关闭 "LandfillMind-Dev" 窗口
echo ============================================================
echo.
pause
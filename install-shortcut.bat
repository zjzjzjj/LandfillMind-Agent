@echo off
chcp 65001 > nul
title LandfillMind · 创建桌面快捷方式
color 0B

echo ============================================================
echo   LandfillMind · 桌面快捷方式安装器
echo ============================================================
echo.

:: 获取桌面路径
set DESKTOP=%USERPROFILE%\Desktop

:: 创建"启动"快捷方式
echo [*] 创建桌面快捷方式: LandfillMind-启动.lnk
powershell -Command "$s = (New-Object -COM WScript.Shell).CreateShortcut('%DESKTOP%\LandfillMind-启动.lnk'); $s.TargetPath = '%~dp0start.bat'; $s.WorkingDirectory = '%~dp0'; $s.IconLocation = 'shell32.dll,13'; $s.Description = '启动 LandfillMind 智能体系统'; $s.Save()" > nul 2>&1

:: 创建"关闭"快捷方式
echo [*] 创建桌面快捷方式: LandfillMind-关闭.lnk
powershell -Command "$s = (New-Object -COM WScript.Shell).CreateShortcut('%DESKTOP%\LandfillMind-关闭.lnk'); $s.TargetPath = '%~dp0stop.bat'; $s.WorkingDirectory = '%~dp0'; $s.IconLocation = 'shell32.dll,27'; $s.Description = '关闭 LandfillMind 服务'; $s.Save()" > nul 2>&1

:: 创建"主页面"快捷方式（已运行服务时直接打开）
echo [*] 创建桌面快捷方式: LandfillMind-主页.lnk
powershell -Command "$s = (New-Object -COM WScript.Shell).CreateShortcut('%DESKTOP%\LandfillMind-主页.lnk'); $s.TargetPath = 'http://localhost:5173'; $s.IconLocation = '%ProgramFiles%\Google\Chrome\Application\chrome.exe,0'; $s.Description = 'LandfillMind 首页'; $s.Save()" > nul 2>&1

echo.
echo ============================================================
echo   ✓ 桌面快捷方式创建完成！
echo.
echo   桌面上现在有 3 个快捷方式：
echo     [启动] LandfillMind-启动.lnk   - 双击启动服务
echo     [主页] LandfillMind-主页.lnk   - 直接打开浏览器（需服务已运行）
echo     [关闭] LandfillMind-关闭.lnk   - 关闭所有服务
echo.
echo   提示：右键 "启动" → 发送到 → 桌面快捷方式 也行
echo ============================================================
echo.
pause
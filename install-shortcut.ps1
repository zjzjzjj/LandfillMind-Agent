$ws = New-Object -ComObject WScript.Shell
$desk = [Environment]::GetFolderPath('Desktop')
$proj = 'E:\Son of  the SEA\260811\sea-agent-web-v2'

$results = @()

# 选择更醒目的图标：
#   启动 - shell32.dll,77 = 绿色播放箭头
#   主页 - imageres.dll,21 = 地球仪图标
#   关闭 - shell32.dll,132 = 红色禁止符号
# Windows 资源管理器自带的 .ico 内置图标，无需额外文件

function Make-Shortcut($name, $target, $workdir, $icon, $desc) {
  $lnk = Join-Path $desk $name
  $s = $ws.CreateShortcut($lnk)
  $s.TargetPath = $target
  if ($workdir) { $s.WorkingDirectory = $workdir }
  $s.IconLocation = $icon
  $s.Description = $desc
  try { $s.Save(); return "$name : OK ($icon)" }
  catch { return "$name : FAIL - $_" }
}

# 先删除旧的快捷方式
@('LandfillMind-启动.lnk', 'LandfillMind-主页.lnk', 'LandfillMind-关闭.lnk') | ForEach-Object {
  $old = Join-Path $desk $_
  if (Test-Path $old) { Remove-Item $old -Force }
}

$results += Make-Shortcut 'LandfillMind-启动.lnk' "$proj\start.bat" $proj 'shell32.dll,77' 'LandfillMind - 启动服务'
$results += Make-Shortcut 'LandfillMind-主页.lnk' 'http://localhost:5173' $proj 'imageres.dll,21' 'LandfillMind - 主页'
$results += Make-Shortcut 'LandfillMind-关闭.lnk' "$proj\stop.bat" $proj 'shell32.dll,132' 'LandfillMind - 关闭服务'

$results | Out-File -Encoding utf8 'E:\Son of  the SEA\260811\sea-agent-web-v2\shortcut-result.txt'
"DONE" | Out-File -Encoding utf8 'E:\Son of  the SEA\260811\sea-agent-web-v2\shortcut-done.flag'
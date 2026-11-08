# 安装 Windows 计划任务
$ErrorActionPreference = 'Stop'
$Home_ = $env:USERPROFILE
$Dest  = Join-Path $Home_ '.qq-organizer'
$Src   = Split-Path -Parent $MyInvocation.MyCommand.Path

New-Item -ItemType Directory -Force -Path $Dest | Out-Null
Copy-Item "$Src\*.ps1" $Dest -Force

function New-Task($name, $script, $minutes) {
  $action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
             -Argument "-NoProfile -WindowStyle Hidden -File `"$Dest\$script`""
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $rep     = New-ScheduledTaskTrigger -Once -At (Get-Date) `
             -RepetitionInterval (New-TimeSpan -Minutes $minutes)
  Register-ScheduledTask -TaskName $name -Action $action -Trigger @($trigger, $rep) `
    -RunLevel Highest -Force | Out-Null
  Write-Host "  ✓ $name"
}

Write-Host '安装计划任务：'
New-Task 'LLBot-Reconnect' 'llbot-reconnect.ps1' 1

Write-Host ''
Write-Host '注意：LLBot 本体建议用「任务计划程序 → 创建任务 → 登录时运行」自行配置，'
Write-Host '      程序填 llbot-run.ps1，参数留空。'

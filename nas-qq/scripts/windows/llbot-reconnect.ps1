# LLBot 掉线告警（Windows，不自动登录）
$ErrorActionPreference = 'SilentlyContinue'

$Home_     = $env:USERPROFILE
$PluginCfg = Join-Path $Home_ '.dsh-qq-access\config.json'
$LogSrc    = Join-Path $Home_ '.qq-organizer\llbot.log'
$StateFile = Join-Path $Home_ '.qq-organizer\reconnect.state'
$LogFile   = Join-Path $Home_ '.qq-organizer\reconnect.log'
$ReAlert   = 1800

New-Item -ItemType Directory -Force -Path (Split-Path $LogFile) | Out-Null
function Write-Log($m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m" | Add-Content $LogFile }

$token = (Get-Content $PluginCfg -Raw | ConvertFrom-Json).onebot.token
if (-not $token) { exit }

$downSince = 0; $lastAlert = 0
if (Test-Path $StateFile) {
  $parts = (Get-Content $StateFile -Raw).Trim() -split '\s+'
  $downSince = [int]$parts[0]; $lastAlert = [int]$parts[1]
}

$now = [int][double]::Parse((Get-Date -UFormat %s))

$healthy = $false
try {
  $r = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3000/get_login_info' `
        -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 5
  $healthy = [bool]$r.user_id
} catch { $healthy = $false }

if ($healthy) {
  if ($downSince -ne 0) {
    $mins = [int](($now - $downSince) / 60)
    Write-Log "已恢复（中断 $mins 分钟）"
    # TODO: 调用你的推送方式
  }
  '0 0' | Set-Content $StateFile
  exit
}

if ($downSince -eq 0) { $downSince = $now; Write-Log '检测到掉线' }
if ($lastAlert -ne 0 -and ($now - $lastAlert) -lt $ReAlert) { "$downSince $lastAlert" | Set-Content $StateFile; exit }

$mins = [int](($now - $downSince) / 60)
$link = (Select-String -Path $LogSrc -Pattern 'https://txz\.qq\.com/p\?k=[^&]+&f=\d+' -AllMatches |
         Select-Object -Last 1).Matches.Value
$msg = if ($link) { "QQ 已掉线 $mins 分钟。手机上打开：$link" } else { "QQ 已掉线 $mins 分钟，请扫码登录。" }
Write-Log "告警：$msg"
# TODO: 调用你的推送方式
"$downSince $now" | Set-Content $StateFile

# LLBot 启动包装器（Windows）
#
# 解决换号后三处必须同时改的问题：
#   ① OneBot 配置（config_<号>.json）
#   ② dsh-qq-access 的 selfId
#   ③ 启动参数 --qq=<号>
$ErrorActionPreference = 'Stop'

$Home_     = $env:USERPROFILE
$Data      = Join-Path $Home_ 'llbot\bin\llbot\data'
$PluginCfg = Join-Path $Home_ '.dsh-qq-access\config.json'
$LogFile   = Join-Path $Home_ '.qq-organizer\llbot-run.log'
$Lucky     = Join-Path $Home_ 'llbot\LuckyLillia.exe'

New-Item -ItemType Directory -Force -Path (Split-Path $LogFile) | Out-Null

function Write-Log($msg) {
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg" | Add-Content -Path $LogFile
}

# 1) 取最新会话账号
$Uin = ''
$latest = Get-ChildItem -Path $Data -Filter 'qq-session-*.json' -ErrorAction SilentlyContinue |
          Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($latest) { $Uin = ($latest.BaseName -replace '^qq-session-', '') }
Write-Log "启动，会话账号：$(if ($Uin) { $Uin } else { '（无，将要求扫码）' })"

if ($Uin) {
  # 2) 打开 OneBot 配置
  $cfgFile = Join-Path $Data "config_$Uin.json"
  if ((Test-Path $cfgFile) -and (Test-Path $PluginCfg)) {
    $apiToken = (Get-Content $PluginCfg -Raw | ConvertFrom-Json).onebot.token
    if ($apiToken) {
      $cfg = Get-Content $cfgFile -Raw | ConvertFrom-Json
      $cfg.ob11.enable = $true
      foreach ($c in $cfg.ob11.connect) {
        if ($c.type -eq 'http') {
          $c.enable = $true; $c.host = '127.0.0.1'; $c.port = 3000
          $c.token = $apiToken; $c.messageFormat = 'array'
        } elseif ($c.type -eq 'http-post') {
          $c.enable = $true; $c.url = 'http://127.0.0.1:5702/onebot'; $c.messageFormat = 'array'
        }
      }
      $cfg | ConvertTo-Json -Depth 20 | Set-Content $cfgFile -Encoding UTF8
      Write-Log "已启用 $Uin 的 OneBot 配置"
    }
  }

  # 3) 同步插件 selfId
  if (Test-Path $PluginCfg) {
    $p = Get-Content $PluginCfg -Raw | ConvertFrom-Json
    if ($p.selfId -ne $Uin) {
      $p.selfId = $Uin
      $p | ConvertTo-Json -Depth 20 | Set-Content $PluginCfg -Encoding UTF8
      Write-Log "已同步插件 selfId → $Uin（需重启 DSH 生效）"
    }
  }
}

# 4) 启动
$args = @('--headless', '--cdn', 'china')
if ($Uin) { $args += "--qq=$Uin" }
Write-Log "启动 LLBot：$($args -join ' ')"
& $Lucky @args

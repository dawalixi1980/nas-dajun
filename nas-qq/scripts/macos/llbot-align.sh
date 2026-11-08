#!/bin/sh
# LLBot 登录态自动对齐守护
#
# 解决的问题：扫码登录成功 ≠ 链路可用。登录后还有三处要同步：
#   ① config_<新号>.json 的 OneBot 要打开（否则 3000 端口不起）
#   ② 插件 selfId 要改成新号（否则消息被丢弃）
#   ③ LLBot 进程要带着 --qq=<新号> 运行（否则重启后又去等扫码）
#
# 本脚本每 20 秒检查一次「最新会话账号」与「运行状态」是否一致，
# 不一致就自动对齐并重启 LLBot。用户在哪儿扫码都无所谓，扫完自动生效。
set -u
DATA="$HOME/llbot/bin/llbot/data"
PLUGIN_CFG="$HOME/.dsh-qq-access/config.json"
STATE="$HOME/.qq-organizer/align.state"
LOG="$HOME/.qq-organizer/align.log"
MIN_INTERVAL=60      # 两次重启最小间隔（秒）
HEALTH_WAIT=45       # 重启后等 3000 起来的时长（秒）

log() { echo "$(date '+%F %T') $1" >> "$LOG"; }

# 最新会话对应的账号
UIN=""
LATEST=$(ls -t "$DATA"/qq-session-*.json 2>/dev/null | head -1)
if [ -n "${LATEST:-}" ]; then
  UIN=$(basename "$LATEST" | sed 's/^qq-session-//; s/\.json$//')
fi
# 没有会话 = 还在等扫码，什么都不做（避免重启循环）
[ -z "$UIN" ] && exit 0

# 打开该账号的 OneBot 配置（幂等：已开就不写）
enable_onebot() {
  local f="$DATA/config_$UIN.json"
  [ -f "$f" ] || return 0
  local token
  token=$(/usr/bin/jq -r '.onebot.token // empty' "$PLUGIN_CFG" 2>/dev/null)
  [ -z "$token" ] && return 0
  local need
  need=$(/usr/bin/jq -r --arg t "$token" '
    if (.ob11.connect | map(select(.type=="http" and .enable==true and .port==3000 and .token==$t)) | length) > 0
       and (.ob11.connect | map(select(.type=="http-post" and .enable==true and .url=="http://127.0.0.1:5702/onebot")) | length) > 0
    then "no" else "yes" end' "$f" 2>/dev/null)
  [ "$need" = "yes" ] || return 0
  local tmp="$f.tmp.$$"
  if /usr/bin/jq --arg t "$token" '
    .ob11.enable = true
    | .ob11.connect = (.ob11.connect | map(
        if .type == "http" then .enable = true | .host = "127.0.0.1" | .port = 3000
          | .token = $t | .messageFormat = "array"
        elif .type == "http-post" then .enable = true
          | .url = "http://127.0.0.1:5702/onebot" | .messageFormat = "array"
        else . end))
  ' "$f" > "$tmp" 2>/dev/null; then
    chmod 600 "$tmp"; mv "$tmp" "$f"
    log "已打开 $UIN 的 OneBot 配置"
  else
    rm -f "$tmp"
  fi
}

# 同步插件 selfId
sync_self() {
  [ -f "$PLUGIN_CFG" ] || return 0
  local cur
  cur=$(/usr/bin/jq -r '.selfId // empty' "$PLUGIN_CFG" 2>/dev/null)
  [ "$cur" = "$UIN" ] && return 0
  local tmp="$PLUGIN_CFG.tmp.$$"
  if /usr/bin/jq --arg u "$UIN" '.selfId = $u' "$PLUGIN_CFG" > "$tmp" 2>/dev/null; then
    chmod 600 "$tmp"; mv "$tmp" "$PLUGIN_CFG"
    log "已同步插件 selfId：$cur → $UIN（需重启 DSH 生效）"
  else
    rm -f "$tmp"
  fi
}

# 当前运行的 LLBot 用的哪个账号
PID=$(/usr/bin/pgrep -f "llbot.js" | head -1)
RUN_UIN=""
if [ -n "${PID:-}" ]; then
  RUN_UIN=$(/bin/ps -o command= -p "$PID" 2>/dev/null | /usr/bin/grep -o -- '--qq=[0-9]*' | cut -d= -f2)
fi

# 3000 是否可用
API_UP=0
/usr/bin/nc -z -w1 127.0.0.1 3000 2>/dev/null && API_UP=1   # 仅用于日志

NEED_RESTART=0
REASON=""
if [ "$RUN_UIN" != "$UIN" ]; then
  NEED_RESTART=1; REASON="运行账号(${RUN_UIN:-无}) ≠ 会话账号($UIN)"
fi
# 注意：账号一致但 3000 不通时，不自动重启（由 reconnect 告警，人工扫码）。
# 只有「运行账号 ≠ 会话账号」才自动重启，那是换号后的必要对齐。

if [ "$NEED_RESTART" = "0" ]; then
  # 已对齐：仍然兜底同步一次（幂等）
  enable_onebot
  sync_self
  exit 0
fi

# 节流
LAST=$(cat "$STATE" 2>/dev/null || echo 0)
NOW=$(date +%s)
if [ $((NOW - LAST)) -lt "$MIN_INTERVAL" ]; then
  exit 0
fi

log "需要重启：$REASON"
enable_onebot
sync_self
echo "$NOW" > "$STATE"
/bin/launchctl kickstart -k "gui/$(id -u)/com.qq.llbot" 2>/dev/null \
  && log "已重启 LLBot（--qq=$UIN）"

# 等 3000 起来，记录结果
for _ in $(seq 1 "$HEALTH_WAIT"); do
  sleep 1
  if /usr/bin/nc -z -w1 127.0.0.1 3000 2>/dev/null; then
    log "3000 已就绪"
    exit 0
  fi
done
log "重启后 ${HEALTH_WAIT}s 内 3000 仍未就绪"

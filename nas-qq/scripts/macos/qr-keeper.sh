#!/bin/sh
# 二维码值守：保持屏幕上始终有一个「新鲜的」登录二维码。
#
# 规则：
#   - 已登录（有 session 文件 或 3000 端口通了）→ 退出
#   - 二维码超过 80 秒没更新 → 重启 LLBot 重新生成
#   - 每 5 秒检查一次
#
# 这样用户任何时候去扫都能扫到有效码，不用配合我这边的响应速度。
set -u
LLBOT="$HOME/llbot"
QR="$LLBOT/bin/llbot/data/temp/login-qrcode.png"
DATA="$LLBOT/bin/llbot/data"
LOG="$HOME/.qq-organizer/qr-keeper.log"
MAX_AGE=80
INTERVAL=5

log() { echo "$(date '+%F %T') $1" >> "$LOG"; }

logged_in() {
  ls "$DATA"/qq-session-*.json >/dev/null 2>&1 && return 0
  nc -z -w1 127.0.0.1 3000 2>/dev/null && return 0
  return 1
}

restart_llbot() {
  pkill -f "llbot.js" 2>/dev/null
  sleep 2
  rm -f "$QR" "$DATA"/qq-session-*.json
  cd "$LLBOT" || exit 1
  nohup ./LuckyLillia --headless --cdn china >> "$HOME/.qq-organizer/llbot.log" 2>&1 &
  # 等新二维码出现（最多 60 秒）
  for _ in $(seq 1 60); do
    sleep 1
    [ -f "$QR" ] && { log "已生成新二维码"; return 0; }
  done
  log "重启后 60 秒内未生成二维码"
  return 1
}

log "二维码值守启动"

if ! pgrep -f "llbot.js" >/dev/null 2>&1; then
  log "LLBot 未运行，启动"
  restart_llbot
fi

while :; do
  if logged_in; then
    log "检测到已登录，值守退出"
    break
  fi

  if [ -f "$QR" ]; then
    AGE=$(( $(date +%s) - $(stat -f %m "$QR" 2>/dev/null || echo 0) ))
    if [ "$AGE" -gt "$MAX_AGE" ]; then
      log "二维码已 ${AGE}s，过期，重新生成"
      restart_llbot
    fi
  else
    log "二维码文件不存在，重新生成"
    restart_llbot
  fi

  sleep "$INTERVAL"
done

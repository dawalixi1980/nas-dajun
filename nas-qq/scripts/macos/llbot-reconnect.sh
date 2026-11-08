#!/bin/sh
# LLBot 掉线告警（不做自动登录）
#
# 设计原则：掉线只通知人，不自动重连。
# 原因：频繁尝试无效登录会加重风控；而且登录态作废后自动重启也没用。
#
# 行为：
#   检测到掉线 → 立刻推送「掉线 + 登录链接」到你手机
#   持续掉线   → 每 30 分钟重复提醒一次（避免遗忘）
#   恢复       → 推送「已恢复，中断 X 分钟」
set -u
PLUGIN_CFG="$HOME/.dsh-qq-access/config.json"
LOG_SRC="$HOME/.qq-organizer/llbot.log"
STATE="$HOME/.qq-organizer/reconnect.state"
LOG="$HOME/.qq-organizer/reconnect.log"

REALERT=1800     # 持续掉线时重复提醒间隔（30 分钟）

log() { echo "$(date '+%F %T') $1" >> "$LOG"; }
notify() { /bin/sh "$HOME/.qq-organizer/notify.sh" "QQ 归档" "$1"; }

TOKEN=$(/usr/bin/jq -r '.onebot.token // empty' "$PLUGIN_CFG" 2>/dev/null)
[ -z "$TOKEN" ] && exit 0

# 状态：down_since last_alert
DOWN_SINCE=0; LAST_ALERT=0
[ -f "$STATE" ] && { read -r DOWN_SINCE LAST_ALERT < "$STATE" 2>/dev/null || true; }
DOWN_SINCE=${DOWN_SINCE:-0}; LAST_ALERT=${LAST_ALERT:-0}

NOW=$(date +%s)

# 健康检查必须用「能真拿到数据」的接口。
# get_login_info 在协议层断开后仍会返回缓存值（假在线），不能用。
# get_group_list 在掉线时返回 {"status":"failed",...,"data":null}。
HEALTHY=0
RESP=$(/usr/bin/curl -s -m 8 -X POST "http://127.0.0.1:3000/get_group_list" \
        -H "Authorization: Bearer $TOKEN" 2>/dev/null)
case "$RESP" in
  *'"data":['*) HEALTHY=1 ;;                # 有群数组（含空数组）→ 在线
  *'"data":null'*) HEALTHY=0 ;;              # 明确失败 → 掉线
  *'not logged in'*) HEALTHY=0 ;;             # 协议层未登录
  *) HEALTHY=0 ;;                              # 连不上 → 掉线
esac
if [ "$HEALTHY" = "0" ] && [ -n "$RESP" ]; then
  log "健康检查失败：$(printf '%s' "$RESP" | cut -c1-80)"
fi

# 心跳：每次检查都记一行，用于事后统计真实在线率与掉线间隔
echo "$(date "+%F %T") $([ "$HEALTHY" = "1" ] && echo UP || echo DOWN)" >> "$HOME/.qq-organizer/uptime.log"

if [ "$HEALTHY" = "1" ]; then
  if [ "$DOWN_SINCE" != "0" ]; then
    MINS=$(( (NOW - DOWN_SINCE) / 60 ))
    notify "已恢复：中断约 ${MINS} 分钟，归档继续"
    log "已恢复（中断 ${MINS} 分钟）"
  fi
  echo "0 0" > "$STATE"
  exit 0
fi

# ---- 掉线 ----
if [ "$DOWN_SINCE" = "0" ]; then
  DOWN_SINCE=$NOW
  log "检测到掉线"
fi

if [ "$LAST_ALERT" != "0" ] && [ $((NOW - LAST_ALERT)) -lt "$REALERT" ]; then
  echo "$DOWN_SINCE $LAST_ALERT" > "$STATE"
  exit 0
fi

MINS=$(( (NOW - DOWN_SINCE) / 60 ))
LINK=$(/usr/bin/grep -ao "https://txz\.qq\.com/p?k=[^&]*&f=[0-9]*" "$LOG_SRC" 2>/dev/null | tail -1)

if [ -n "${LINK:-}" ]; then
  notify "QQ 已掉线 ${MINS} 分钟。手机上打开这条链接即可重新登录：${LINK}"
else
  notify "QQ 已掉线 ${MINS} 分钟。请打开 QQ 归档面板点「换号（退出重扫）」扫码登录。"
fi
log "已告警（掉线 ${MINS} 分钟）"

echo "$DOWN_SINCE $NOW" > "$STATE"

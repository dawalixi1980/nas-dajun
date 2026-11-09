#!/bin/sh
# 掉线监测（零 API 调用版）
#
# 为什么不用 API 探测：
#   实测 4 次被踢，每次前面都紧跟着 get_group_list / get_login_info 调用。
#   周期性调接口本身就是最明显的机器特征 —— 监控手段正在制造掉线。
#
# 改为「只看日志」：
#   LLBot 被踢时会立刻写：
#     [W] core [Kick] code=1001 ...
#     [I] root 协议层断开，等待重连…
#   盯着这个文件即可，完全不碰 QQ 服务器。
#
# 成本：0 次 API 调用。
set -u
HOME_DIR="$HOME"
LOG_SRC="$HOME_DIR/.qq-organizer/llbot.log"
STATE="$HOME_DIR/.qq-organizer/kickwatch.state"
LOG="$HOME_DIR/.qq-organizer/kickwatch.log"
REALERT=1800

log() { echo "$(date '+%F %T') $1" >> "$LOG"; }
notify() { /bin/sh "$HOME_DIR/.qq-organizer/notify.sh" "QQ 归档" "$1"; }

[ -f "$LOG_SRC" ] || exit 0

# 上一次检查时日志已经读到的字节位置
LAST_POS=0; LAST_OFFLINE=0; LAST_ALERT=0
[ -f "$STATE" ] && { read -r LAST_POS LAST_OFFLINE LAST_ALERT < "$STATE" 2>/dev/null || true; }
LAST_POS=${LAST_POS:-0}; LAST_OFFLINE=${LAST_OFFLINE:-0}; LAST_ALERT=${LAST_ALERT:-0}

SIZE=$(/usr/bin/stat -f %z "$LOG_SRC" 2>/dev/null || /usr/bin/stat -c %s "$LOG_SRC" 2>/dev/null || echo 0)
NOW=$(date +%s)

# 日志被截断/轮转过 → 从头读
[ "$SIZE" -lt "$LAST_POS" ] && LAST_POS=0

# 只看新增部分
NEW=""
if [ "$SIZE" -gt "$LAST_POS" ]; then
  NEW=$(/usr/bin/tail -c +$((LAST_POS + 1)) "$LOG_SRC" 2>/dev/null | /usr/bin/head -c $((SIZE - LAST_POS)))
fi

NEED_ALERT=0
REASON=""

case "$NEW" in
  *'[Kick]'*)
    NEED_ALERT=1
    REASON="被踢下线（[Kick]）"
    ;;
  *'协议层断开'*)
    NEED_ALERT=1
    REASON="协议层断开"
    ;;
esac

# 检测到新的掉线事件
if [ "$NEED_ALERT" = "1" ]; then
  if [ $((NOW - LAST_ALERT)) -ge "$REALERT" ] || [ "$LAST_ALERT" = "0" ]; then
    LINK=$(/usr/bin/grep -ao 'https://txz\.qq\.com/p?k=[^&]*&f=[0-9]*' "$LOG_SRC" 2>/dev/null | tail -1)
    if [ -n "${LINK:-}" ]; then
      notify "QQ 已掉线（${REASON}）。手机上打开这条链接即可重新登录：${LINK}"
    else
      notify "QQ 已掉线（${REASON}）。请打开 QQ 归档面板点「扫码登录」。"
    fi
    log "掉线：${REASON}"
    LAST_ALERT=$NOW
  fi
  LAST_OFFLINE=$NOW
fi

# 恢复检测：之后又出现 Login successful
case "$NEW" in
  *'Login successful'*)
    if [ "$LAST_OFFLINE" != "0" ]; then
      MINS=$(( (NOW - LAST_OFFLINE) / 60 ))
      notify "已恢复：中断约 ${MINS} 分钟"
      log "已恢复（中断 ${MINS} 分钟）"
      LAST_OFFLINE=0
    fi
    ;;
esac

echo "$SIZE $LAST_OFFLINE $LAST_ALERT" > "$STATE"

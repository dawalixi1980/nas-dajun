#!/bin/sh
# LLBot 启动包装器
#
# 解决的问题：换号时有三处必须同时改，漏一处就整条链路断：
#   ① launchd 的 --qq=<号>       （写错就会去登录旧号）
#   ② config_<号>.json 的 OneBot （默认全关，3000 端口起不来）
#   ③ dsh-qq-access 的 selfId    （不一致就丢弃所有消息）
#
# 这里在每次启动 LLBot 前，自动把这三处对齐到「最新的会话账号」。
set -u
HOME_DIR="$HOME"
DATA="$HOME_DIR/llbot/bin/llbot/data"
PLUGIN_CFG="$HOME_DIR/.dsh-qq-access/config.json"
LOG="$HOME_DIR/.qq-organizer/llbot-run.log"

log() { echo "$(date '+%F %T') $1" >> "$LOG"; }

# 1) 取最新会话对应的 UIN
UIN=""
LATEST=$(ls -t "$DATA"/qq-session-*.json 2>/dev/null | head -1)
if [ -n "${LATEST:-}" ]; then
  UIN=$(basename "$LATEST" | sed 's/^qq-session-//; s/\.json$//')
fi
log "启动，检测到会话账号：${UIN:-（无，将要求扫码）}"

# 2) 打开该账号的 OneBot 配置（http:3000 + http-post:5702）
if [ -n "$UIN" ] && [ -f "$DATA/config_$UIN.json" ] && [ -f "$PLUGIN_CFG" ]; then
  API_TOKEN=$(/usr/bin/jq -r '.onebot.token // empty' "$PLUGIN_CFG" 2>/dev/null)
  if [ -n "$API_TOKEN" ]; then
    TMP="$DATA/.config_$UIN.json.tmp"
    if /usr/bin/jq --arg t "$API_TOKEN" '
      .ob11.enable = true
      | .ob11.connect = (.ob11.connect | map(
          if .type == "http" then .enable = true | .host = "127.0.0.1" | .port = 3000
            | .token = $t | .messageFormat = "array"
          elif .type == "http-post" then .enable = true
            | .url = "http://127.0.0.1:5702/onebot" | .messageFormat = "array"
          else . end))
    ' "$DATA/config_$UIN.json" > "$TMP" 2>/dev/null; then
      mv "$TMP" "$DATA/config_$UIN.json"
      chmod 600 "$DATA/config_$UIN.json" 2>/dev/null
      log "已启用 $UIN 的 OneBot 配置"
    else
      rm -f "$TMP"
      log "启用 OneBot 配置失败"
    fi
  fi

  # 3) 同步插件的 selfId
  if [ -f "$PLUGIN_CFG" ]; then
    CUR=$(/usr/bin/jq -r '.selfId // empty' "$PLUGIN_CFG" 2>/dev/null)
    if [ "$CUR" != "$UIN" ]; then
      TMP2="$PLUGIN_CFG.tmp.$$"
      if /usr/bin/jq --arg u "$UIN" '.selfId = $u' "$PLUGIN_CFG" > "$TMP2" 2>/dev/null; then
        chmod 600 "$TMP2"; mv "$TMP2" "$PLUGIN_CFG"
        log "已同步插件 selfId：$CUR → $UIN（需重启 DSH 生效）"
      else
        rm -f "$TMP2"
      fi
    fi
  fi
fi

# 4) 启动 LLBot
cd "$HOME_DIR/llbot" || exit 1
if [ -n "$UIN" ]; then
  exec ./LuckyLillia --headless --cdn china --qq="$UIN"
else
  exec ./LuckyLillia --headless --cdn china
fi

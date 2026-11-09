#!/bin/sh
# 可靠存活探测（被多个守护脚本 source）
#
# 为什么不能只看 get_group_list：
#   LLBot 的 get_login_info / get_group_list / get_status 都有缓存，
#   协议层被踢之后仍返回上一次的数据，会造成「假在线」。
#   实测会被缓存骗到的接口：
#     get_login_info, get_group_list, get_status, get_version_info
#   能真实反映的：
#     get_group_msg_history（需要 group_id）, get_friend_list
#
# 探测策略：
#   1) 先拿群列表（可能有缓存，但用于取 group_id）
#   2) 用第一个群调 get_group_msg_history，报 "not logged in" 即判定掉线
#   3) 没有群就退到 get_friend_list
#
# 用法：. /path/to/probe.sh; probe_alive; [ "$PROBE_ALIVE" = "1" ] && ...
# 输出变量：PROBE_ALIVE(0/1)  PROBE_UIN  PROBE_GROUPS  PROBE_REASON

probe_alive() {
  PROBE_ALIVE=0
  PROBE_UIN=""
  PROBE_GROUPS=""
  PROBE_REASON=""

  _token=$(/usr/bin/jq -r '.onebot.token // empty' "$PLUGIN_CFG" 2>/dev/null)
  [ -z "$_token" ] && { PROBE_REASON="配置文件缺少 onebot.token"; return; }

  # 1) 群列表（可能缓存）
  _gl=$(/usr/bin/curl -s -m 8 -X POST "http://127.0.0.1:3000/get_group_list" \
          -H "Authorization: Bearer $_token" 2>/dev/null)
  _gid=""
  _count=""
  case "$_gl" in
    *'"data":['*)
      _gid=$(printf '%s' "$_gl" | /usr/bin/jq -r '.data[0].group_id // empty' 2>/dev/null)
      _count=$(printf '%s' "$_gl" | /usr/bin/jq -r '.data | length' 2>/dev/null)
      ;;
    *)
      PROBE_REASON="连不上 3000 端口或群列表失败"
      return
      ;;
  esac
  PROBE_GROUPS="$_count"

  # 2) 用真实操作验证协议层是否在线
  if [ -n "$_gid" ]; then
    _h=$(/usr/bin/curl -s -m 8 -X POST "http://127.0.0.1:3000/get_group_msg_history" \
           -H "Authorization: Bearer $_token" -H "Content-Type: application/json" \
           -d "{\"group_id\":$_gid,\"count\":1}" 2>/dev/null)
    case "$_h" in
      *'not logged in'*) PROBE_REASON="协议层未登录（Direct client not logged in）"; return ;;
      *'"status":"ok"'*) PROBE_ALIVE=1 ;;
      *'"data":'*) PROBE_ALIVE=1 ;;
      *) PROBE_REASON="消息历史接口异常：$(printf '%s' "$_h" | cut -c1-60)"; return ;;
    esac
  else
    _f=$(/usr/bin/curl -s -m 8 -X POST "http://127.0.0.1:3000/get_friend_list" \
           -H "Authorization: Bearer $_token" 2>/dev/null)
    case "$_f" in
      *'not logged in'*) PROBE_REASON="协议层未登录"; return ;;
      *'"status":"ok"'*) PROBE_ALIVE=1 ;;
      *) PROBE_REASON="好友列表接口异常"; return ;;
    esac
  fi

  # 3) 账号（仅展示用，有缓存风险）
  PROBE_UIN=$(/usr/bin/curl -s -m 6 -X POST "http://127.0.0.1:3000/get_login_info" \
    -H "Authorization: Bearer $_token" 2>/dev/null | /usr/bin/jq -r '.data.user_id // empty' 2>/dev/null)
}

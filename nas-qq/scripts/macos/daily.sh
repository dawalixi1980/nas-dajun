#!/bin/sh
# 施工 Wiki 每日自动整理
#
# 做的事：
#   1. 自动发现所有名为「群聊归档」的目录
#   2. 在各自同级生成「项目信息/<项目>/{raw,结构,输出}」
#   3. 生成施工日志与单价台账 Excel
#
# 由 launchd / 计划任务按设定时间调用；也可以手动跑。
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
HOME_DIR="${HOME:-$USERPROFILE}"
LOG="$HOME_DIR/.qq-organizer/construction-wiki.log"
mkdir -p "$(dirname "$LOG")"

log() { echo "$(date '+%F %T') $1" >> "$LOG"; }

# 找 node（优先宿主自带）
NODE_BIN="${DSH_NODE_BIN:-/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness}"
if [ ! -x "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node 2>/dev/null || true)"
fi
[ -z "$NODE_BIN" ] && { log "找不到 node，退出"; exit 1; }

run_node() {
  if [ "$(basename "$NODE_BIN")" = "node" ]; then
    "$NODE_BIN" "$@"
  else
    ELECTRON_RUN_AS_NODE=1 "$NODE_BIN" "$@"
  fi
}

# 找 python（优先 DSH 运行时，带 openpyxl）
PY="${DSH_PYTHON_BIN:-$HOME_DIR/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3}"
[ -x "$PY" ] || PY="$(command -v python3 2>/dev/null || true)"

log "开始"
SCAN_ROOT="${1:-$HOME_DIR/项目文件}"
OUT=$(run_node "$HERE/build-structure.mjs" --scan "$SCAN_ROOT" 2>&1)
echo "$OUT" >> "$LOG"

if command -v "$PY" >/dev/null 2>&1; then
  EX=$(SCAN_ROOT="$SCAN_ROOT" "$PY" "$HERE/build-excel.py" --scan 2>&1)
  echo "$EX" >> "$LOG"
else
  log "找不到 python3，跳过 Excel"
fi

log "结束"
echo "$OUT" | tail -3

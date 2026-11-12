#!/bin/sh
# 「自动化任务」技能的执行入口。
# 机器人的子进程未必有 node 在 PATH 里，这里按常见位置找一遍。
set -e
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if [ -n "${AUTOMATION_NODE:-}" ]; then
  NODE=$AUTOMATION_NODE
elif command -v node >/dev/null 2>&1; then
  NODE=node
else
  NODE=""
  for candidate in \
    "$HOME"/.dsh/dsh-runtimes/*/dependencies/node/bin/node \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    /usr/bin/node; do
    if [ -x "$candidate" ]; then
      NODE=$candidate
      break
    fi
  done
fi

if [ -z "$NODE" ]; then
  echo "✗ 找不到 node，可以用 AUTOMATION_NODE=/path/to/node 指定" >&2
  exit 127
fi

exec "$NODE" "$DIR/automation.mjs" "$@"

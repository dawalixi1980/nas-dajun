#!/bin/sh
# 把插件同步到 DSH 的 profile 安装目录（宿主按包名加载，不复制新文件就看不见新代码）
set -eu
SRC="$(cd "$(dirname "$0")" && pwd)"
DST="$HOME/.dsh/profiles/desktop/node_modules/dsh-construction-wiki"
mkdir -p "$DST"
cp "$SRC/package.json" "$SRC/index.mjs" "$SRC/cordis.patch.yml" "$DST/"
mkdir -p "$DST/lib" "$DST/tools" "$DST/skills/construction-wiki"
cp "$SRC/lib/"* "$DST/lib/" 2>/dev/null || true
cp "$SRC/tools/"* "$DST/tools/" 2>/dev/null || true
cp "$SRC/skills/construction-wiki/"* "$DST/skills/construction-wiki/" 2>/dev/null || true
echo "已同步到 $DST"

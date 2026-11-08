#!/bin/sh
# 安装所有 launchd 服务（macOS）
#
# 前置：先把脚本复制到 ~/.qq-organizer/（TCC 保护 ~/Documents，launchd 无法执行那里）
set -eu
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.qq-organizer"
LA="$HOME/Library/LaunchAgents"

mkdir -p "$DEST" "$LA"
cp "$SRC"/*.sh "$SRC"/*.mjs "$DEST/" 2>/dev/null || true
chmod +x "$DEST"/*.sh

write_plist() {
  label="$1"; script="$2"; interval="$3"; mode="$4"
  plist="$LA/$label.plist"
  if [ "$mode" = "interval" ]; then
    cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array><string>/bin/sh</string><string>$DEST/$script</string></array>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>$interval</integer>
  <key>StandardOutPath</key><string>$DEST/$label.out</string>
  <key>StandardErrorPath</key><string>$DEST/$label.out</string>
</dict></plist>
EOF
  fi
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$plist"
  echo "  ✓ $label"
}

echo "安装服务："
write_plist com.qq.llbot-shim      "" 0 keepalive
write_plist com.qq.llbot-align     llbot-align.sh 20 interval
write_plist com.qq.llbot-reconnect llbot-reconnect.sh 60 interval

echo ""
echo "注意：com.qq.llbot（协议端）需要先填好 auth_token，再执行："
echo "  launchctl bootstrap gui/\$(id -u) ~/Library/LaunchAgents/com.qq.llbot.plist"

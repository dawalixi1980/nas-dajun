# 08 · 日常运维

## 服务清单（macOS launchd）

| 服务 | 频率 | 职责 |
| --- | --- | --- |
| `com.qq.llbot` | 常驻 | 协议端，用 `llbot-run.sh` 包装启动 |
| `com.qq.llbot-shim` | 常驻 | 签名转发 |
| `com.qq.llbot-align` | 20s | 换号后对齐配置（**唯一会重启 LLBot 的**） |
| `com.qq.llbot-reconnect` | 60s | 掉线告警（**不自动登录**） |
| `com.qq.archive-organizer` | 60s | 整理归档 |
| `com.qq.archiver.caffeinate` | 常驻 | 防休眠 |

## 换号流程

```
① 面板点「换号（退出重扫）」
② 手机扫码（注意切到目标号）
③ 等 20 秒 —— llbot-align 自动完成：
     · 打开新号的 OneBot 配置
     · 同步插件 selfId
     · 重启 LLBot 带正确 --qq
④ 重启 DSH（selfId 只在启动时读）
```

第 ④ 步躲不掉。

## 掉线处理

```
检测到 3000 不通
  → 立刻推 QQ 消息（含登录链接）
  → 之后每 30 分钟重复提醒
  → ✓ 不自动重连（频繁无效登录会加重风控）
```

用户点链接 → 手机 QQ 确认 → 恢复。

恢复后自动推送「已恢复，中断 X 分钟」。

## 假在线

`dsh-qq-access` 的 `connected` 是启动时设的一次性标记，掉线后不会更新。

补丁 `patch-qqaccess-live.mjs` 让 `/dsh-qq/api/state` 实时调 `get_login_info`：

```js
try {
  const info = await runtime.client.call('get_login_info', {}, AbortSignal.timeout(4000));
  state.connected = Boolean(info?.user_id);
} catch { state.connected = false; }
```

## 检查命令

```bash
# 登录状态
curl -s -X POST http://127.0.0.1:3000/get_login_info \
  -H "Authorization: Bearer $(jq -r .onebot.token ~/.dsh-qq-access/config.json)"

# 服务状态
for s in llbot llbot-shim llbot-align llbot-reconnect; do
  launchctl print gui/$(id -u)/com.qq.$s >/dev/null 2>&1 && echo "$s ✓" || echo "$s ✗"
done

# 今天归档了多少
wc -l ~/.dsh-qq-access/data/messages/$(date +%F).jsonl

# 最近告警
tail -5 ~/.qq-organizer/reconnect.log
```

## Windows 对应

用 **任务计划程序**（Task Scheduler）替代 launchd：

| macOS | Windows |
| --- | --- |
| LaunchAgent + StartInterval | 计划任务 + 重复间隔 |
| `launchctl bootstrap` | `schtasks /create` |
| `/bin/sh script.sh` | `powershell -File script.ps1` |

脚本见 `nas-qq/scripts/windows/`。

## 磁盘

```bash
du -sh ~/.dsh-qq-access/data/media/blobs   # 图片总量
df -h ~                                      # 剩余空间
```

图片用硬链接共享，通常不会暴涨。

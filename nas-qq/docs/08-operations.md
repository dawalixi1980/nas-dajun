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

---

## 降低被踢频率（实测调整）

### 现象

一次掉线排查中发现 LLBot 单日 API 调用分布：

```
100 次  get_group_msg_history   ← dsh-qq-access 的 60 秒轮询
 96 次  get_login_info          ← 各处健康检查
 52 次  get_status              ← 面板刷新
 20 次  get_group_list
```

真人客户端不会每分钟去拉所有群的历史消息，这是最明显的机器特征。

### 调整

| 项 | 之前 | 之后 |
| --- | --- | --- |
| `poll.enabled` | `true`（60 秒轮询） | **`false`**（只靠事件推送） |
| 掉线守护 | 60 秒 | **300 秒** |
| 换号对齐 | 20 秒 | **60 秒** |
| 归档面板刷新 | 15 秒 | **60 秒** |

LLBot 本来就会实时推送事件，轮询纯属多余：
**关掉后 API 调用量降 80–85%**（约 8–10 次/分钟 → 1–2 次/分钟）。

### 配置片段

```json
"poll": { "enabled": false, "intervalMs": 600000 }
```

## 假在线（两个层次都有）

### 层次一：插件层

`dsh-qq-access` 的 `runtime.connected` 是启动时的一次性标记，掉线后不更新。

### 层次二：LLBot 层（更隐蔽）

**协议层被踢后，`get_login_info` 仍返回缓存的账号信息。**

```
get_login_info     → {"user_id": 1637584338, ...}   ← 假的，还在
get_group_list     → {"status":"failed","data":null,"message":"Direct client not logged in"}
get_group_msg_history → 同上
```

所以健康检查**必须**用能真正拿到数据的接口：

```sh
RESP=$(curl -s -X POST http://127.0.0.1:3000/get_group_list -H "Authorization: Bearer $TOKEN")
case "$RESP" in
  *'"data":['*)   HEALTHY=1 ;;              # 有群数组（含空数组）→ 在线
  *)              HEALTHY=0 ;;              # 其余一律判定掉线
esac
```

两个面板（QQ 接入 / QQ 归档）都改为用这个判断。

## 在线率统计

掉线守护每次检查都记一行心跳：

```
~/.qq-organizer/uptime.log
2026-11-08 23:58:56 UP
2026-11-09 00:03:56 DOWN
```

统计脚本：

```bash
# 掉线次数
grep -c DOWN ~/.qq-organizer/uptime.log

# 在线率
awk '/UP/{u++} /DOWN/{d++} END{printf "在线率 %.1f%%\n", u*100/(u+d)}' ~/.qq-organizer/uptime.log
```

有了真实数据，才能判断是「随机风控」还是「固定会话有效期」：

| 判断 | 含义 | 对策 |
| --- | --- | --- |
| 随机 | 被识别为协议端 | 降频只能缓解 |
| 固定周期（如 3 小时） | 会话有效期 | 可在到期前主动续登 |

## 推送通道排查

告警走 `notify.sh`，QQ 官方机器人是主通道。

**踩过的坑**：在开放平台重新生成 appSecret 后，DSH 配置更新了，
但 `~/.qq-organizer/notify.json` 没同步，导致：

```
{"code":100016,"message":"invalid appid or secret"}
```

推送静默降级成 macOS 通知，人收不到。

排查：

```bash
# 直接测 token
curl -s -X POST https://bots.qq.com/app/getAppAccessToken \
  -H 'Content-Type: application/json' \
  -d "{\"appId\":\"<APPID>\",\"clientSecret\":\"<SECRET>\"}"

# 看最近的推送结果
tail -5 ~/.qq-organizer/notify.log     # 期望出现 qqbot ok: ...
```

**结论**：appSecret 变更后必须同步 notify.json。

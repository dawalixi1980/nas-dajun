# 架构总览

QQ 管家 = **DSH 宿主 + 两个插件**。机器人插件干活，管家插件只是面板。

```
┌────────────────────────── DeepSeek Harness (DSH) ──────────────────────────┐
│                                                                            │
│  ┌──────────────── dsh-qqbot-multi（QQ 机器人插件） ─────────────────┐     │
│  │                                                                  │     │
│  │  gateway      QQ 官方 WebSocket 接入、事件分发                    │     │
│  │  transport    入站解析 / 出站发送 / 分片 / msg_id 缓存            │     │
│  │  session      会话管理：resume / create / 压缩 / 闲置回收          │     │
│  │  model        每个机器人独立的 provider/model/preset              │     │
│  │  commands     斜杠命令（不经模型）                                │     │
│  │  middleware   群归档 / 附件 / 问答回传                            │     │
│  │  archive2     归档流水线（游标增量 → 目录 → 桥接 → Excel）        │     │
│  │  media        富媒体下载、文件发送、图片理解                       │     │
│  │  automation   /todo 定时任务引擎                                  │     │
│  └────────────────────────────────┬─────────────────────────────────┘     │
│                                   │ 读 /archive2、/qqbot 接口               │
│  ┌──────────────── dsh-qq-butler（QQ 管家面板） ─────────────────────┐     │
│  │  纯前端：机器人策略、归档目录选择、桥接开关、立即整理、检查更新     │     │
│  └───────────────────────────────────────────────────────────────────┘     │
│                                                                            │
│  Agent（模型）← 会话 → 工具（send_file / vision / automation / …）          │
└────────────────────────────────────────────────────────────────────────────┘
```

## 1. 消息数据流

```
群/私聊消息
   │  QQ 官方 WebSocket
   ▼
gateway ─► 访问控制（私聊/群聊：open | allowlist | off）
   │
   ├─► middleware/group-archive  先落一份原始 jsonl 到 ~/.dsh-qqbot/archive/
   │                              （含未 @ 的消息，静默收集用）
   │
   ├─► commands  命中斜杠命令？──是──► 直接执行，返回文本，不经过模型
   │                            └─否─┐
   ▼                                  ▼
session.getOrCreate            构造用户消息
   │  resume 已有会话 / create 新会话（此处写死工作目录）
   ▼
Agent（模型）── 流式输出 ──► transport/outbound ──► QQ
```

要点：

- **会话工作目录只在 create 时确定**。改配置不会搬动已存在的会话，需要 `/new`。
- 斜杠命令走快路径，几毫秒返回；同一件事用自然语言则由 agent 调工具完成。

## 2. 归档流水线（archive2）

```
~/.dsh-qqbot/archive/*.jsonl        ← 中间件写的原始消息
        │  state.json 里的字节偏移做游标，只处理新增
        ▼
organize()
        │  先做「机器人改名对账」
        ▼
<归档根>/<机器人名>/<群文件夹>/
        ├─ 2026-11-17.jsonl    结构化记录
        ├─ 2026-11-17.txt      可读聊天记录
        └─ 媒体/2026-11-17/*.jpg
        │
        ├─► 桥接（可选）：<机器人名>工程信息/年.月/日/
        │      ├─ 聊天记录.md
        │      ├─ events.jsonl
        │      └─ 图片/
        │
        └─► Excel：输出/施工日志.xlsx、输出/单价台账.xlsx（调 Python openpyxl）
```

**目录约束（硬规则）**

| 规则 | 实现 |
| --- | --- |
| 一个群一个文件夹 | `state.groups[botId][openid]`，folder 默认 `日期_openid前8位` |
| 群目录可改名 | `/rename 项目名` 或 `/rename 编号 项目名`，同时移动源目录与桥接目录 |
| 改名不撞车 | 两个群不能用同一个文件夹名，重名直接拒绝 |
| 机器人改名跟着改 | 归档根下 `旧机器人名/` → `新机器人名/`，工程信息目录同理 |

**机器人改名对账的触发时机**（三处，任一即可）：

1. 插件加载 / 热重载（改名会触发重载 → 立刻对账）
2. 每轮整理前（定时任务与「立即整理」）
3. 面板「同步目录名」按钮（手动强制）

新旧目录并存时做合并：旧目录的群文件夹并进新目录（同名跳过），再删空目录，不留分裂。

## 3. 持久化

| 文件 | 位置 | 内容 |
| --- | --- | --- |
| `cordis.patch.yml` | `~/.dsh/profiles/<profile>/` | 插件配置：机器人列表（appId/appSecret/name/cwd/模型）、访问控制 |
| `model-prefs.json` | `~/.dsh-qqbot/` | `sessionKey → sessionId` 映射，机器人/群的模型覆盖 |
| `state.json` | `~/.dsh-qqbot/archive2/` | 归档游标、群目录映射、机器人名 |
| `config.json` | `~/.dsh-qqbot/archive2/` | 归档根、整理间隔、桥接机器人列表、模式 |
| `archive/*.jsonl` | `~/.dsh-qqbot/` | 原始入站消息（整理前的中转） |
| `media/` | `~/.dsh-qqbot/` | 下载的图片/文件缓存，按 TTL 清理 |

配置写入遵循：文档保真（保留注释/锚点）→ fail-closed → 原子写 → 读回校验，失败回滚。

## 4. 命令体系

| 类别 | 命令 |
| --- | --- |
| 会话 | `/new`（别名 reset、clear）、`/compact`、`/stop` |
| 模型 | `/model`、`/preset` |
| 归档 | `/rename`、`/groups`、`/day`、`/update` |
| 自动化 | `/todo`、`/todo list`、`/todo del` |
| 工具 | `/github list`、`/github push`、`/skill list`、`/skill <名称>` |
| 状态 | `/bot-ping`、`/bot-version`、`/bot-status`、`/me`、`/help` |

斜杠命令由插件注册，群聊里无需 @ 也能执行（归档中间件补标记绕过 SDK 的 @ 要求）。

## 5. 多机器人

- `bots[]` 每项自带凭据，**凭据不继承**顶层（避免两个连接抢同一个 AppID）
- 每项可独立设置：name、cwd、provider/model/preset、requireMention、access、prompt
- 未配置 `bots[]` 时退化为单机器人，沿用顶层 `appId`/`appSecret`
- 盘点：`GET /qqbot/bots` 返回在线机器人（registry）与配置里的机器人（configured）

## 6. 平台差异

| 项目 | macOS | Windows |
| --- | --- | --- |
| Python | `~/.dsh/.../python/bin/python3` | `~/.dsh/.../python/python.exe`，可 `DSH_PYTHON_BIN` 覆盖 |
| 目录选择器 | 原生 NSOpenPanel | 原生对话框，经 `/qqbot/bots/pick-dir` |
| 定时任务 | launchd plist | 插件内部 cron（不依赖系统） |
| 路径 | `/Users/...` | `C:\...`，代码统一 `path.join` |
| 中文文件名 | NFD | NFC |

详见 [08-平台差异](qq%20管家技术栈%20win/docs/08-平台差异.md)。

## 7. 更新机制

```
面板「检查更新」或群里 /update
  → 拉取仓库 manifest.json（含版本与文件映射）
  → 对比本地版本
  → 覆盖 plugins/ 下对应的插件目录
  → 机器人插件需要重启桌面端；面板插件刷新页面即可
```

manifest 里的 `basePath` 决定从哪个目录拉：
`2.qq管家技术栈`（主线）与 `qq 管家技术栈 win`（Windows 版）各有一份，互不覆盖。

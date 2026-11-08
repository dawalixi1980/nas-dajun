# nas-qq — QQ 群聊归档与施工 Wiki 全套技术栈

一套在**本机运行**的 QQ 群消息采集 → 归档 → 结构化 → 施工日志/台账 的完整方案。
适用于 macOS 与 Windows。

## 它能做什么

```
QQ 群消息（个人号）
  ↓ 自动采集
原始归档（JSONL + 图片原图）
  ↓ 自动整理
按「项目/年.月/日」分层的可读结构
  ↓ 规则提取
施工日志 Excel + 单价台账 Excel
  ↓
官方机器人推送到 QQ（告警与日报）
```

**核心特点**：归档与整理全程不调用大模型，不消耗 token。

## 五个组件

| 层 | 组件 | 作用 | 托管 |
| --- | --- | --- | --- |
| 协议端 | **LLBot** | 登录 QQ、收发消息，暴露 OneBot 11 接口 | 系统服务 |
| 转发 | **shim** | 给事件补 HMAC 签名后转给归档插件 | 系统服务 |
| 归档 | **dsh-qq-access** | 接收事件、写 JSONL、下载图片 | DSH 插件 |
| 整理 | **organizer** | 按群拆文件夹、生成聊天记录 | 系统服务 |
| 输出 | **construction-wiki** | 结构层 + 施工日志/台账 Excel | DSH 插件 |

## 快速开始

1. 读 [docs/01-architecture.md](docs/01-architecture.md) 理解数据流
2. 按 [docs/02-llbot.md](docs/02-llbot.md) 装 LLBot 并登录
3. 按 [docs/03-shim.md](docs/03-shim.md) 起转发器
4. 装 DSH 插件 `dsh-qq-access` 与归档整理器
5. 按 [docs/06-qqbot.md](docs/06-qqbot.md) 配推送（可选）
6. 按 [docs/07-construction-wiki.md](docs/07-construction-wiki.md) 出施工日志

## 重要前提

**QQ 个人号 + 非官方客户端 = 会被踢下线。** 本方案不回避这一点，
而是把"被踢"当成正常事件处理：

- 掉线立刻告警，推登录链接到手机
- **不做自动重连**（频繁无效登录会加重风控）
- 恢复后继续归档，历史不丢

详见 [docs/08-operations.md](docs/08-operations.md)。

## 目录

```
nas-qq/
├── docs/          九个专题文档
├── scripts/
│   ├── macos/     launchd 服务与 shell 脚本
│   └── windows/   PowerShell 脚本与计划任务
└── config/        配置模板（脱敏）
```

## 在你自己的机器上复现

### macOS

```bash
# 1. 脚本落地（TCC 保护 ~/Documents，运行副本必须放普通目录）
mkdir -p ~/.qq-organizer
cp nas-qq/scripts/macos/* ~/.qq-organizer/
chmod +x ~/.qq-organizer/*.sh

# 2. 装 LLBot 并填 auth token
mkdir -p ~/llbot
tar -xJf LuckyLillia-CLI-macos-arm64.tar.xz -C ~/llbot
printf '%s' '<你的token>' > ~/llbot/bin/llbot/data/auth_token.txt
chmod 600 ~/llbot/bin/llbot/data/auth_token.txt

# 3. 起服务
sh nas-qq/scripts/macos/install-launchd.sh

# 4. DSH 里装两个插件
#    dsh-qq-access（归档）
#    dsh-construction-wiki（结构层 + Excel）
```

### Windows

```powershell
# 1. 脚本落地
mkdir $env:USERPROFILE\.qq-organizer
copy nas-qq\scripts\windows\*.ps1 $env:USERPROFILE\.qq-organizer\

# 2. 装 LLBot 并填 auth token
#    %USERPROFILE%\llbot\bin\llbot\data\auth_token.txt

# 3. 注册计划任务
powershell -ExecutionPolicy Bypass -File nas-qq\scripts\windows\install-tasks.ps1

# 4. DSH 里装同样的两个插件
```

### 配置

三个模板在 `nas-qq/config/`：

| 文件 | 目标位置 |
| --- | --- |
| `dsh-qq-access.template.json` | `~/.dsh-qq-access/config.json` |
| `llbot-config.template.json` | `~/llbot/bin/llbot/data/config_<QQ号>.json` |
| `composer.template.yml` | `~/.dsh/profiles/<profile>/cordis.patch.yml` |

**`onebot.token` 与 `events.secret` 在两端必须一致**，自己生成随机串：

```bash
openssl rand -hex 32
```

# 06 · QQ 机器人（官方，用于推送）

## 和归档用的 QQ 完全无关

这是两个不同的东西，务必分清：

| | 归档用的 QQ | 官方机器人 |
| --- | --- | --- |
| 账号 | 个人号（LLBot 登录） | 官方 bot（AppID/AppSecret） |
| 用途 | 采集群消息 | 推送告警/日报 |
| 能收群消息 | 全量（含未 @） | **只能收 @ 的** |
| 用模型 | 否 | 是 |

**官方机器人拿不到全量群消息**，所以只能做推送端，不能做归档端。

## 配置

`~/.dsh/profiles/<profile>/cordis.patch.yml`：

```yaml
- id: im-qqbot
  name: "@tencent-connect/dsh-qqbot"
  config:
    appId: "<AppID>"
    appSecret: "<AppSecret>"
    cwd: "/path/to/agent/workspace"
    requireMention: true
    provider: <LLM provider>     # 可选，不填用全局默认
    model: <model>               # 可选
```

接入方式必须选 **WebSocket**（选 Webhook 会导致收不到事件）。

## 推送脚本

`~/.qq-organizer/notify.sh`：

```bash
#!/bin/sh
title="$1"; body="$2"
# 通过 qqbot 的 API 发到指定 openid
curl -s -X POST "https://api.sgroup.qq.com/v2/users/${OPENID}/messages" \
  -H "Authorization: QQBot ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"content\":\"【${title}】${body}\",\"msg_type\":0}"
```

更省事的做法：让 qqbot 插件自己发（它已维护 token），
通过 DSH 的工具或面板触发。

## 告警节流

避免刷屏：

| 事件 | 间隔 |
| --- | --- |
| 掉线 | 立即 1 次，之后每 30 分钟 |
| 磁盘不足 | 每 6 小时 |
| 恢复 | 立即 1 次 |

## 掉线告警内容

```
QQ 已掉线 12 分钟。手机上打开这条链接即可重新登录：
https://txz.qq.com/p?k=xxxxx&f=1600001615
```

链接从 LLBot 日志里提取最新一条，用户点开即可登录，不用开电脑。

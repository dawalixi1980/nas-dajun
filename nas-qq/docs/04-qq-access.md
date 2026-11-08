# 04 · dsh-qq-access（归档插件）

## 职责

跑在 DSH 进程内的插件，是**真正把消息落盘的那一层**。

1. 接收 shim 转来的事件（:5701）
2. 校验签名
3. **按 selfId 过滤**（只收当前登录号的消息）
4. 写 `data/messages/<日期>.jsonl`
5. 图片到达即下载原图（rKey 会过期）
6. 提供 `qq_*` 工具（发消息、查历史、列联系人等）

## 配置

`~/.dsh-qq-access/config.json`：

```json
{
  "selfId": "<当前登录的QQ号>",
  "onebot": { "apiUrl": "http://127.0.0.1:3000", "token": "<API token>" },
  "events": { "host": "127.0.0.1", "port": 5701, "secret": "<HMAC 密钥>" },
  "dataDir": "./data",
  "access": {
    "privateMode": "disabled",
    "groupMode": "all",
    "blockedUsers": [],
    "blockedGroups": []
  },
  "reply": { "private": false, "group": "off" },
  "retentionDays": 3650,
  "qzone": { "enabled": false },
  "poll": { "enabled": true, "intervalMs": 60000 }
}
```

关键项：

| 字段 | 说明 |
| --- | --- |
| `selfId` | **只在启动时读一次**，换号必须重启 DSH |
| `reply.group` | `"off"` = 只归档不回复（不消耗模型 token） |
| `access.groupMode` | `"all"` = 归档所有群 |
| `retentionDays` | 保留天数，设大一点避免自动清理 |

## 数据格式

`data/messages/2026-11-08.jsonl`，一行一条：

```json
{
  "time": 1794114781,
  "kind": "group",
  "selfId": "1637584338",
  "peerId": "1131567688",
  "senderId": "2048084346",
  "nickname": "张三",
  "messageId": "2096621099",
  "text": "今天浇了 35 方",
  "images": [{ "url": "...", "filename": "x.jpg" }]
}
```

## 已知缺陷：换号会重复归档

去重键是 `selfId:kind:peerId:direction:messageId`，**包含 selfId**。
换号后 `poll` 会把历史重捞一遍，同一条消息存两份。

处理：整理阶段按 `messageId` 去重（`build-structure.mjs` 已实现）。

## 图片下载补丁

原始版本不落盘图片。补丁 `patches/patch-images-raw.mjs` 新增：

- 原图写 `data/media/blobs/<xx>/<sha256>.<ext>`
- 索引写 `data/media/<日期>.jsonl`

## 面板

设置 → **QQ 接入**：显示在线状态、自动回复开关、回复节奏。

> 注意：原版面板的「在线」读的是启动标记，掉线后仍显示在线（假在线）。
> 补丁 `patch-qqaccess-live.mjs` 改为实时调用 `get_login_info`。

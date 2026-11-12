# 02 · LLBot（协议端）

## 是什么

LLBot 是第三方 QQ 协议实现，**不需要安装 QQ 客户端**，直接与 QQ 服务器通信。
它提供 OneBot 11 标准接口，所以我们能用统一的协议对接。

## 与 NapCat 的区别

| | NapCat | LLBot |
| --- | --- | --- |
| 原理 | 注入官方 QQ 客户端 | 纯协议重实现 |
| 需要 QQ 客户端 | 是 | **否** |
| 需要改签名 | 是（adhoc） | 否 |
| 客户端完整性检测 | 会被查出 | 不存在 |
| 被踢次数（实测） | 4 次/天 | 2 次/1.5 小时 |

**结论：两者都会被踢。** 纯协议不代表安全，只是失败机制不同。
采用 LLBot 的理由是「不需要客户端、不折腾签名」，
但仍然需要在运维上接受「会被踢」这个事实。

## 安装

```bash
# 从 https://github.com/luckylillia/LLBot 下载对应平台包
# macOS arm64
tar -xJf LuckyLillia-CLI-macos-arm64.tar.xz -C ~/llbot
chmod +x ~/llbot/LuckyLillia
```

## Auth Token（必需）

LLBot 要求一个授权 token，从 <https://auth.luckylillia.com> 申请（需人工审核）。

```bash
mkdir -p ~/llbot/bin/llbot/data
printf '%s' '你的token' > ~/llbot/bin/llbot/data/auth_token.txt
chmod 600 ~/llbot/bin/llbot/data/auth_token.txt
```

token 是 **client 级**授权（JWT 里 `kind: "client"`），
**一个 token 可以登录任意多个 QQ 号**，不用一号一 token。

## 启动

```bash
# 纯协议模式，指定账号可免扫码
~/llbot/LuckyLillia --headless --cdn china --qq=<QQ号>
```

参数说明：

| 参数 | 作用 |
| --- | --- |
| `--headless` | 不启动 QQ 客户端，直连协议 |
| `--cdn china` | 用国内认证源 `llbot-api-auth.wumiao.wang`（**国际源经常连不上**） |
| `--qq=<号>` | 快速登录指定账号（有会话文件时免扫码） |

## 配置（按账号分开！）

```
~/llbot/bin/llbot/data/
├── config.json              全局配置（只影响首次创建）
├── config_<QQ号>.json       每个账号独立配置 ← 实际生效的是这个
└── qq-session-<QQ号>.json   登录会话
```

**关键**：每个账号有自己的 `config_<号>.json`，新号登录时会生成一份**全关闭**的默认配置。
必须打开 OneBot 才能用：

```json
{
  "ob11": {
    "enable": true,
    "connect": [
      { "type": "http", "enable": true, "host": "127.0.0.1", "port": 3000,
        "token": "<与 dsh-qq-access 的 onebot.token 相同>", "messageFormat": "array" },
      { "type": "http-post", "enable": true,
        "url": "http://127.0.0.1:5702/onebot", "messageFormat": "array" }
    ]
  }
}
```

## 验证

```bash
# 身份
curl -s -X POST http://127.0.0.1:3000/get_login_info \
  -H "Authorization: Bearer <token>"

# 群列表
curl -s -X POST http://127.0.0.1:3000/get_group_list \
  -H "Authorization: Bearer <token>" | jq -r '.data[].group_name'
```

## 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `auth_token 校验网络失败` | 国际认证源不通 | 加 `--cdn china` |
| `auth lookup failed` | token 过期或无效 | 重新申请 |
| 3000 端口不通 | 该账号 OneBot 未启用 | 改 `config_<号>.json` |
| 要求扫码但会话文件在 | 启动时没带 `--qq` | 加 `--qq=<号>` |
| 二维码 2 分钟就过期 | LLBot 不会自动刷新 | 重启进程出新码 |

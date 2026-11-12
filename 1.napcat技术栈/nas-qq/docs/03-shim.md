# 03 · shim（签名转发器）

## 为什么需要它

`dsh-qq-access` 的事件接口强制校验 HMAC-SHA1 签名：

```
X-Signature: sha1=<hex>
```

而 LLBot 推送事件时不带任何签名。shim 就是中间那层，负责补签名。

```
LLBot :5702 ──(无签名)──> shim ──(补签名)──> dsh-qq-access :5701
```

## 代码

文件：`nas-qq/scripts/macos/shim.mjs`（Windows 用同一个文件，Node 跨平台）

核心逻辑：

```js
const secret = config.events.secret;
const raw = await readBody(req);
const sig = crypto.createHmac('sha1', secret).update(raw).digest('hex');
await fetch(target, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Signature': `sha1=${sig}` },
  body: raw,
});
```

要点：
- **必须用原始请求体算签名**，不能先 JSON.parse 再 stringify（空格顺序会变）
- 目标地址是 `http://127.0.0.1:5701/onebot`

## 启动

```bash
ELECTRON_RUN_AS_NODE=1 \
  "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
  ~/.qq-organizer/shim.mjs
```

（用宿主自带的 Node 运行，避免额外装 Node）

## 健康检查

```bash
curl -s http://127.0.0.1:5702/healthz
# {"ok":true,"forwarding":"http://127.0.0.1:5701/onebot"}
```

## 排错

| 现象 | 原因 |
| --- | --- |
| 日志刷 `转发失败 fetch failed` | 5701 没监听（DSH 里的插件没起来） |
| `401 签名不对` | 两边的 `events.secret` 不一致 |
| 5702 `EADDRINUSE` | 已有实例在跑，先 `pkill -f shim.mjs` |

**注意**：`转发失败` 不代表 shim 坏了，通常是下游（DSH 插件）没起。

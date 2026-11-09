# 09 · 踩过的坑

按出现频率排序。每条都标注了「症状 → 原因 → 处理」。

## 1. 换号后消息全被丢弃

**症状**：面板显示在线，但归档文件不再增长。

**原因**：`dsh-qq-access` 只接受 `self_id === selfId` 的事件，且 `selfId` 只在启动时读一次。

**处理**：重启 DSH。面板「插件运行时」与「协议端账号」不一致时会提示。

## 2. 扫码成功但 3000 端口不通

**症状**：扫码后 QQ 显示已登录，但归档不动。

**原因**：每个账号的 `config_<号>.json` 是独立的，新号登录时生成的是**全关闭**配置。

**处理**：`llbot-align` 守护会自动打开；手动则编辑该文件并重启 LLBot。

## 3. 假在线

**症状**：「QQ 接入」显示在线，实际已掉线数小时。

**原因**：`runtime.connected` 是启动快照，不随掉线更新。

**处理**：打 `patch-qqaccess-live.mjs` 补丁。

## 4. launchd 跑不了 ~/Documents 里的脚本

**症状**：`/bin/sh: ./sync.sh: Operation not permitted`（exit 126）。

**原因**：macOS TCC 保护 `~/Documents`，launchd 无权执行。

**处理**：运行副本放 `~/.qq-organizer/`，`install.sh` 负责同步。

## 5. 插件改了代码但没生效

**症状**：改了 `index.mjs`，重启后行为没变。

**原因**：DSH 按**包名**缓存模块，同包名不重新 import。

**处理**：换成新文件名（`index-v2.mjs`）并改 `package.json` 的 `main`，或彻底重启宿主。

## 6. pnpm file: 依赖不复制新文件

**症状**：新增的文件在 profile 的 node_modules 里找不到。

**原因**：`file:` 依赖只在首次安装时复制。

**处理**：用 `deploy.sh` 脚本显式复制。

## 7. LLBot 国际认证源连不上

**症状**：`auth_token 校验网络失败`，反复重试。

**原因**：`auth.luckylillia.com` 国内访问超时。

**处理**：加 `--cdn china`，走 `llbot-api-auth.wumiao.wang`。

## 8. 二维码总是过期

**症状**：扫的时候提示过期。

**原因**：二维码只有约 2 分钟有效期，且 LLBot **不会自动刷新**。

**处理**：做一个"值守"脚本，检测到超过 80 秒就重启生成新码。

## 9. 同一消息被归档两次

**症状**：聊天记录里同样的消息出现两遍。

**原因**：换号后 `poll` 重捞历史，去重键含 `selfId` 所以没识别为重复。

**处理**：整理阶段按 `messageId` 去重。

## 10. React 元素和字符串相加显示 [object Object]

**症状**：面板某处显示 `[object Object]`。

**原因**：`h("span", null, x) + " / " + y` —— React 元素不能和字符串相加。

**处理**：把内容都放进同一个元素的 children 里。

## 11. TDZ：Cannot access 'x' before initialization

**症状**：整个面板渲染失败、白屏。

**原因**：把 `useEffect`/`useCallback` 插到了它依赖的变量定义之前。

**处理**：调整顺序；部署前用 `vm` 模拟渲染一次（语法检查抓不到这类错误）。

## 12. GitHub 空仓库返回 409

**症状**：检查更新报 `GitHub 409`。

**原因**：仓库没有任何提交时，`/commits` 接口返回 409。

**处理**：识别为「空仓库」而非错误。

## 13. Webhook 导致收不到事件

**症状**：官方机器人配置完却收不到任何消息。

**原因**：接入方式选了 Webhook（回调地址为空）。

**处理**：必须选 **WebSocket**。

## 14. 官方机器人只能收 @ 消息

**症状**：探针只抓到 `GROUP_AT_MESSAGE_CREATE`。

**原因**：开放平台没有「接收所有群消息」的开关；白名单群聊也不改变这一点。

**结论**：官方机器人不能做归档端，只能做推送端。

## 15. NapCat 反复被踢

**症状**：每天 3–5 次 `KickedOffLine`。

**原因**：改签名 + 修改入口的客户端会被识别。

**处理**：换 LLBot（纯协议）。但**LLBot 也会被踢**，只是机制不同。

**根本结论**：个人号 + 非官方客户端 = 必然被踢，运维上要接受。

## 16. 推送静默失效（appSecret 过期）

**症状**：掉线了但手机没收到任何 QQ 消息。

**原因**：开放平台重新生成 appSecret 后，DSH 配置更新了，但
`~/.qq-organizer/notify.json` 还是旧的：

```
{"code":100016,"message":"invalid appid or secret"}
```

告警静默降级成 macOS 通知，人在外面就收不到。

**处理**：同步 notify.json 的 appSecret，然后 `tail -5 notify.log`
确认出现 `qqbot ok: ...`。

## 17. 协议层掉线但接口仍返回数据

**症状**：`get_login_info` 返回正常，但群列表残缺、消息不进归档。

**原因**：LLBot 的 `get_login_info` 有缓存，协议断开后仍返回值。
更可靠的判断是 `get_group_list`：

```
在线：{"status":"ok","data":[...]}
掉线：{"status":"failed","data":null,"message":"Direct client not logged in"}
```

**处理**：健康检查改用 `get_group_list`，`data` 不是数组就判定掉线。

## 18. 整理器漏写隐藏过的群

**症状**：`群聊归档/<群>/` 里有图片但**没有 `消息/` 目录**，
而 `~/.dsh-qq-access` 里明明有该群的消息。

**原因**：隐藏（`hidePeer`）期间整理器跳过写入，但文件游标照样前进，
取消隐藏后从游标之后开始处理，前面的消息就永久缺失。

**处理**：构建器检测到某项目无消息时，从原始归档按 `peerId` 兜底补齐。

## 19. 二维码不自动刷新

**症状**：扫的时候总提示过期。

**原因**：LLBot 在连续刷新 10 张仍未登录后会**停止刷新**：

```
已自动刷新 10 张二维码仍未登录, 停止自动刷新
```

**处理**：重启 LLBot 进程生成新码；或提前部署 `qr-keeper.sh` 值守。

## 20. 监控本身在制造掉线（最重要的坑）

**症状**：频繁被踢，且每次被踢前日志里都有 `get_group_list` / `get_login_info` 调用。

**证据**：某天 4 次被踢，逐条核对日志位置：

```
Kick #1  ← 前面：get_login_info + get_status
Kick #2  ← 前面：get_group_list
Kick #3  ← 前面：get_login_info + get_status
Kick #4  ← 前面：连续 4 次 get_group_list（新加的健康检查）
```

**原因**：真人用 QQ 客户端不会每分钟去拉群列表和历史消息。
周期性 API 调用是最明显的机器特征，比协议指纹还容易被识别。

**量级对比**：

| 做法 | API 调用 | 结果 |
| --- | --- | --- |
| 60 秒轮询 + 5 分钟健康检查 + 15 秒面板刷新 | 3000+ 次/天 | 每 3–4 小时被踢 |
| 全部改为读日志 | **0 次/天** | 待验证 |

**处理**：所有周期性监测改为「读 LLBot 日志」，不碰服务器。

```sh
# 掉线信号（日志里出现即判定，零 API）
[W] core [Kick] code=1001 下线通知
[I] root 协议层断开，等待重连…

# 恢复信号
[I] qq-protocol Login successful! ... nick: "xxx"
```

**原则**：
- 状态展示：读日志
- 告警触发：读日志
- 只有用户主动操作（换号、同步、发消息）才调 API

## 21. LLBot 日志不带时间戳

**症状**：出事后无法判断「几点被踢、掉了多久」。

**原因**：LLBot 自己输出的日志行没有时间前缀。

**处理**：在启动包装器里用管道加时间戳：

```sh
./LuckyLillia --headless --cdn china --qq="$UIN" 2>&1 \
  | perl -pe 'use POSIX qw(strftime); $_ = strftime("%Y-%m-%d %H:%M:%S ", localtime) . $_;'
```

注意：
- **不能用 `exec`**（管道会改变退出码，KeepAlive 判断失效）
- `2>&1` 必须在管道前，否则 stderr 不进日志
- macOS 自带 awk **不支持** `strftime`，用 perl

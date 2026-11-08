# 05 · organizer（归档整理器）

## 职责

定时（每 60 秒）把 `dsh-qq-access` 写出的 JSONL 整理成**人能直接看的文件夹结构**。

```
~/项目文件/群聊归档/
├── 施工测试 4_2026-11-07/          ← 群名_首次归档日期
│   ├── 群信息.json
│   ├── 聊天记录.md
│   ├── 消息/2026-11-08.jsonl
│   └── 图片/2026-11-08/xxx.jpg
└── 新时代_2026-11-08/
```

**文件夹按群号索引，与登录哪个 QQ 号无关** —— 换号后同一个群仍写入原文件夹。

## 状态文件

`<归档根>/.organizer/state.json`：

```json
{
  "peers": {
    "1131567688": {
      "kind": "group",
      "name": "施工测试 4",
      "folder": "施工测试 4_2026-11-07",
      "firstSeen": "2026-11-07"
    }
  },
  "files": { "2026-11-08.jsonl": { "lines": 78, "at": "..." } }
}
```

`files` 记录每个源文件已处理到第几行，实现**增量处理**。

## 命令

```bash
~/.qq-organizer/sync.sh sync        # 增量同步一次
~/.qq-organizer/sync.sh list        # 列出会话
~/.qq-organizer/sync.sh status      # 状态
```

## 为什么脚本要放在 ~/.qq-organizer

macOS 的 TCC 保护 `~/Documents`：**launchd 无法执行该目录下的脚本**，
会报 `Operation not permitted`（exit 126）。

所以运行副本必须放在 `~/` 下的普通目录。
开发目录可以是任何地方，`install.sh` 负责同步过去。

## 时间分桶用本地时区

早期版本用 UTC 分日期，导致凌晨消息落到前一天。
现在统一用本地时区：

```js
const d = new Date(ts * 1000);
const key = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
```

## 图片不重复占用空间

图片用 **硬链接** 从 blob 库链到各群文件夹：

```js
await link(blobPath, targetPath);   // 失败则回退 copyFile
```

同一张图在多个群出现也只占一份磁盘。

## 排除

`hidePeer` / `unhidePeer` 可以隐藏某个会话（比如不想归档的群），
隐藏后停止新增，已有文件保留。

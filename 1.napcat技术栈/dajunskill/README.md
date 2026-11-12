# dajunskill

DSH 施工 Wiki 插件**只监听这个目录**。

## 约定

```
dajunskill/
└── construction-wiki/
    ├── SKILL.md         技能定义（插件从这里拉取）
    └── references.md    可选：补充说明
```

## 为什么单独一个目录

插件通过 GitHub API 检查提交时带了 `?path=dajunskill`，
所以**只有改动本目录的提交**才会被识别为「技能更新」。

仓库里其他内容（`nas-qq/` 文档、脚本等）怎么改都不会触发更新提示——
避免写文档时误报“技能有新版本”。

## 更新机制

1. 你在本机面板点「检查更新」→ 比对 `dajunskill/` 最新提交
2. 点「更新技能」→ 插件从 `raw.githubusercontent.com` 拉取 `SKILL.md`
3. 写入本机 `~/.dsh/skills/construction-wiki/SKILL.md`
4. 若技能规则变化，再点「生成结构 + Excel」重建

**全程不需要 git**，Windows 和 macOS 行为一致。

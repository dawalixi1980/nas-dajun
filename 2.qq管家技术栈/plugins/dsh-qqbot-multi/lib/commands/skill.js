/**
 * /skill —— 管理当前机器人可用的 skill（技能包）
 *
 *   /skill            列出已加载的 skill
 *   /skill list       同上
 *   /skill <名称>     把全局 skill 载入到本机器人的工作目录
 *
 * 「加载」= 把 ~/.dsh/skills/<名称> 复制到 <agent 工作目录>/skills/ 下，
 * 之后这个机器人的会话就能在技能清单里看到它。
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { resolveAgentCwd } from '../shared/index.js';

/** 全局已安装的 skill（用户级，所有 profile 共用） */
function globalSkillsDir() {
    return join(homedir(), '.dsh', 'skills');
}

/** 当前机器人的工作目录下的 skills（跟着 cwd 走） */
function botSkillsDir(config) {
    return join(resolveAgentCwd(config.cwd), 'skills');
}

/** 解析 frontmatter：支持 `key: 值`、`key: |` 块状多行、`key: >` 折叠多行 */
function parseFields(body) {
    const lines = body.split(/\r?\n/);
    const out = {};
    for (let i = 0; i < lines.length; i++) {
        const matched = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
        if (!matched)
            continue;
        const key = matched[1];
        const rest = matched[2].trim();
        if (rest === '' || /^[|>][-+]?$/.test(rest)) {
            const parts = [];
            while (i + 1 < lines.length && /^\s+/.test(lines[i + 1]))
                parts.push(lines[++i].trim());
            out[key] = parts.join(' ').trim();
            continue;
        }
        out[key] = rest.replace(/^["']/, '').replace(/["']$/, '');
    }
    return out;
}

/** 读 SKILL.md 的头部元信息 */
function readMeta(dir) {
    const file = join(dir, 'SKILL.md');
    if (!existsSync(file))
        return null;
    let text = '';
    try {
        text = readFileSync(file, 'utf8');
    }
    catch {
        return null;
    }
    const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    const fields = front ? parseFields(front[1]) : {};
    return {
        name: fields.name || basename(dir),
        description: fields.description ?? '',
    };
}

/** 扫描一个目录下的 skill 包 */
function scan(dir) {
    if (!existsSync(dir) || !statSync(dir).isDirectory())
        return [];
    const items = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.'))
            continue;
        const meta = readMeta(join(dir, entry.name));
        if (meta !== null)
            items.push({ ...meta, folder: entry.name, dir: join(dir, entry.name) });
    }
    return items;
}

function mergedList(config) {
    const global = scan(globalSkillsDir());
    const bot = scan(botSkillsDir(config));
    const seen = new Set(bot.map(item => item.name));
    const merged = [
        ...bot.map(item => ({ ...item, source: '机器人' })),
        ...global.filter(item => !seen.has(item.name)).map(item => ({ ...item, source: '全局' })),
    ];
    return { merged, global, bot, botDir: botSkillsDir(config) };
}

function formatList(config) {
    const { merged, botDir } = mergedList(config);
    if (merged.length === 0)
        return `还没有可用的 skill。\n把技能包放进 ${join(homedir(), '.dsh', 'skills')} 后发 /skill <名称>。`;
    const lines = [`### 可用 skill：${merged.length} 个`, ''];
    for (const item of merged) {
        const desc = item.description === '' ? '' : ` — ${item.description.slice(0, 40)}`;
        lines.push(`• \`${item.name}\`（${item.source}）${desc}`);
    }
    lines.push('', `机器人目录：${botDir}`, '加载：`/skill <名称>`');
    return lines.join('\n');
}

function loadSkill(config, query) {
    const name = query.trim();
    if (name === '')
        return formatList(config);
    const globalDir = globalSkillsDir();
    const targetRoot = botSkillsDir(config);
    const candidates = scan(globalDir);
    const found = candidates.find(item => item.name === name || item.folder === name);
    if (found === undefined) {
        const loaded = scan(targetRoot).find(item => item.name === name);
        if (loaded !== undefined)
            return `✅ \`${name}\` 已经加载过了。\n${loaded.description || ''}`;
        const hint = candidates.length === 0
            ? '全局目录里也没有任何 skill。'
            : `可用的有：${candidates.slice(0, 12).map(item => item.name).join('、')}`;
        return `⚠️ 找不到 skill「${name}」。\n${hint}`;
    }
    mkdirSync(targetRoot, { recursive: true });
    const dest = join(targetRoot, found.folder);
    if (existsSync(dest))
        return `✅ \`${found.name}\` 已经加载过了。`;
    try {
        cpSync(found.dir, dest, { recursive: true });
    }
    catch (err) {
        return `⚠️ 加载失败：${err instanceof Error ? err.message : String(err)}`;
    }
    return [
        `✅ 已加载 \`${found.name}\``,
        found.description === '' ? '' : found.description,
        '',
        `位置：${dest}`,
        '下一条消息起，这个机器人就能用它了。',
    ].filter(line => line !== '').join('\n');
}

export function skillCommand({ config, logger }) {
    return {
        name: 'skill',
        category: 'qqbot',
        scope: 'all',
        description: '查看 / 加载 skill',
        usage: [
            '/skill            列出可用的 skill',
            '/skill list       同上',
            '/skill <名称>     载入到本机器人',
            '',
            '自然语言也可以：「加载 zlib 这个 skill」「看看有哪些 skill」',
        ].join('\n'),
        handler(cmdCtx) {
            const args = (cmdCtx.command?.args ?? []).map(item => String(item));
            const sub = (args[0] ?? '').toLowerCase();
            if (sub === '' || sub === 'list' || sub === '列表')
                return formatList(config);
            const query = args.join(' ');
            logger?.info?.(`/skill 加载: ${query}`);
            return loadSkill(config, query);
        },
    };
}

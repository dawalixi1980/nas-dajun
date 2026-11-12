/**
 * QQ 归档 2 —— 把静默归档的群消息按「机器人 / 群聊」整理到指定目录。
 *
 * 输入：~/.dsh-qqbot/archive/*.jsonl（由 group-archive 中间件写入，含未 @ 的消息）
 * 输出：<root>/<机器人名>/<群聊文件夹>/<日期>.jsonl + 媒体/<日期>/xxx.jpg
 */
import { existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { appendFile, copyFile, mkdir, readdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { PLUGIN_HOME } from '../shared/dirs.js';
import { MODES, MODE_LABELS, listModes, resolveMode, setBotMode, setDefaultMode } from './modes.js';
import { buildWiki } from './wiki.js';
import { buildDayDigest, formatDigest, listArchivedGroups, parseDayArg, todayKey } from './day.js';
import { checkRepoVersion, updateFromRepo } from './updater.js';

const ARCHIVE_DIR = join(PLUGIN_HOME, 'archive');
const STATE_DIR = join(PLUGIN_HOME, 'archive2');
const STATE_PATH = join(STATE_DIR, 'state.json');
const CONFIG_PATH = join(STATE_DIR, 'config.json');
const PREFS_PATH = join(PLUGIN_HOME, 'model-prefs.json');
const DEFAULT_ROOT = join(homedir(), '项目文件', 'QQ归档2');

/**
 * 命令库：面板展示用。scope = group / c2c / all
 * 与 commands/ 目录里的实现保持一致，改动时同步更新这里。
 */
const COMMANDS = [
    { name: '/todo', scope: 'all', desc: '创建定时自动化任务（机器人会先问你要什么）' },
    { name: '/todo list', scope: 'all', desc: '查看当前会话的自动化任务（带序号）' },
    { name: '/todo del 序号', scope: 'all', desc: '删除第 N 个自动化任务' },
    { name: '/day', scope: 'all', desc: '总结今天这个群：做了什么工程、花了多少钱，没有工程就总结聊天（模型生成）' },
    { name: '/day 昨天', scope: 'all', desc: '总结昨天，也支持 /day 2026-11-11' },
    { name: '/day 编号 日期', scope: 'all', desc: '私聊里指定群编号与日期，先发 /groups 看编号' },
    { name: '/rename 新名称', scope: 'group', desc: '把当前群的归档文件夹改名' },
    { name: '/rename 编号 新名称', scope: 'all', desc: '按编号改名，先发 /groups 查编号' },
    { name: '/groups', scope: 'all', desc: '列出已归档的群（带编号、消息数）' },
    { name: '/update', scope: 'all', desc: '从仓库拉取最新的 QQ 管家插件代码' },
    { name: '/bot-ping', scope: 'all', desc: '测试与 QQ 服务器的网络延迟' },
    { name: '/bot-version', scope: 'all', desc: '查看插件版本' },
    { name: '/me', scope: 'all', desc: '查看当前会话的身份信息' },
    { name: '/bot-status', scope: 'all', desc: '查看机器人与会话状态' },
    { name: '/new', scope: 'all', desc: '开一个新会话（清空上下文）' },
    { name: '/compact', scope: 'all', desc: '压缩当前会话上下文' },
    { name: '/stop', scope: 'all', desc: '中止当前正在生成的回复' },
    { name: '/help', scope: 'all', desc: '列出全部可用命令' },
];

/** 供 /rename 命令等外部调用者使用的单例接口（mount 时注入） */
let archiveApi = null;
export function setArchiveApi(api) {
    archiveApi = api;
}
export function getArchiveApi() {
    return archiveApi;
}

function readJson(path, fallback) {
    try {
        if (!existsSync(path)) return fallback;
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        return fallback;
    }
}

async function writeJson(path, data) {
    await mkdir(STATE_DIR, { recursive: true });
    writeFileSync(`${path}.tmp`, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(`${path}.tmp`, path);
}

function readState() {
    const data = readJson(STATE_PATH, {});
    return {
        cursors: data.cursors && typeof data.cursors === 'object' ? data.cursors : {},
        groups: data.groups && typeof data.groups === 'object' ? data.groups : {},
    };
}

function readConfig() {
    const data = readJson(CONFIG_PATH, {});
    return {
        root: typeof data.root === 'string' && data.root.trim()
            ? data.root.trim()
            : (data.root && typeof data.root.path === 'string' && data.root.path.trim() ? data.root.path.trim() : DEFAULT_ROOT),
        autoOrganize: data.autoOrganize !== false,
        intervalMinutes: Number.isFinite(data.intervalMinutes) ? data.intervalMinutes : 5,
        bridgeBots: Array.isArray(data.bridgeBots) ? data.bridgeBots.map(String) : [],
    };
}

function sanitize(input) {
    return String(input ?? '')
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
        .replace(/^\.+/, '')
        .trim()
        .slice(0, 80) || '未命名';
}

function dayOf(value) {
    const date = new Date(value ?? Date.now());
    if (Number.isNaN(date.getTime())) return '1970-01-01';
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function ensureGroup(state, botId, botName, openid, time) {
    state.groups[botId] = state.groups[botId] ?? {};
    const bucket = state.groups[botId];
    if (!bucket[openid]) {
        bucket[openid] = {
            name: '',
            folder: `${dayOf(time)}_${String(openid).slice(0, 8)}`,
            createdAt: dayOf(time),
            botName: botName || botId,
            messages: 0,
        };
    }
    if (botName) bucket[openid].botName = botName;
    return bucket[openid];
}

async function organize(state, root, logger) {
    if (!existsSync(ARCHIVE_DIR)) return { messages: 0, media: 0, root };
    const files = readdirSync(ARCHIVE_DIR).filter(item => item.endsWith('.jsonl')).sort();
    let messages = 0;
    let media = 0;

    for (const file of files) {
        const full = join(ARCHIVE_DIR, file);
        const size = statSync(full).size;
        let offset = Number(state.cursors[file] ?? 0);
        if (!Number.isFinite(offset) || offset < 0 || size < offset) offset = 0;
        if (size === offset) continue;

        const buffer = readFileSync(full);
        const text = buffer.subarray(offset).toString('utf8');
        const lastNewline = text.lastIndexOf('\n');
        if (lastNewline === -1) continue;
        const complete = text.slice(0, lastNewline + 1);
        const consumed = Buffer.byteLength(complete, 'utf8');

        for (const line of complete.split('\n')) {
            if (!line.trim()) continue;
            let entry;
            try {
                entry = JSON.parse(line);
            } catch {
                continue;
            }
            const openid = entry.groupOpenid;
            if (!openid) continue;
            const group = ensureGroup(state, entry.botId || 'unknown', entry.botName, openid, entry.time);
            const groupDir = join(root, sanitize(group.botName || entry.botId || 'unknown'), sanitize(group.folder));
            await mkdir(groupDir, { recursive: true });

            const day = dayOf(entry.time);
            const mediaOut = [];
            for (const item of entry.media ?? []) {
                const localPath = item?.localPath;
                if (!localPath || !existsSync(localPath)) continue;
                const targetDir = join(groupDir, '媒体', day);
                await mkdir(targetDir, { recursive: true });
                const targetPath = join(targetDir, basename(localPath));
                try {
                    await copyFile(localPath, targetPath);
                    mediaOut.push({ file: join('媒体', day, basename(localPath)), contentType: item.contentType ?? '' });
                    media += 1;
                } catch (err) {
                    logger?.warn?.(`qq-archive-2: 复制媒体失败: ${err instanceof Error ? err.message : String(err)}`);
                }
            }

            const record = {
                time: new Date(entry.time ?? Date.now()).toISOString(),
                senderId: entry.senderId ?? '',
                senderName: entry.senderName ?? '',
                text: entry.text ?? '',
                mentioned: entry.mentioned === true,
                media: mediaOut,
            };
            await appendFile(join(groupDir, `${day}.jsonl`), `${JSON.stringify(record)}\n`, 'utf8');

            // 可读版聊天记录（供人直接打开看）
            const stamp = new Date(entry.time ?? Date.now()).toLocaleTimeString('zh-CN', { hour12: false });
            const who = entry.senderName || String(entry.senderId ?? '').slice(-6) || '未知';
            const bodyText = (entry.text ?? '').replace(/\s+/g, ' ').trim() || (mediaOut.length > 0 ? '' : '[无文本]');
            const mediaText = mediaOut.length > 0 ? `  [附件: ${mediaOut.map(item => item.file).join(', ')}]` : '';
            await appendFile(join(groupDir, `${day}.txt`), `[${stamp}] ${who}: ${bodyText}${mediaText}\n`, 'utf8');
            group.messages = Number(group.messages ?? 0) + 1;
            messages += 1;
        }
        state.cursors[file] = offset + consumed;
    }

    return { messages, media, root };
}

function findGroup(state, query, hint) {
    const items = [];
    for (const [botId, bucket] of Object.entries(state.groups)) {
        for (const [openid, info] of Object.entries(bucket ?? {})) items.push({ botId, openid, info });
    }
    if (query) {
        const hit = items.find(item => item.openid === query || item.info.folder === query || item.info.name === query);
        if (hit) return hit;
    }
    if (hint) {
        const hit = items.find(item => item.botId === hint.botId && item.openid === hint.openid);
        if (hit) return hit;
    }
    return null;
}

function currentSessionGroup(exec) {
    const sessionId = exec?.agent?.session?.id;
    if (!sessionId) return null;
    try {
        const prefs = JSON.parse(readFileSync(PREFS_PATH, 'utf8'));
        for (const [key, value] of Object.entries(prefs?.sessionIds ?? {})) {
            if (value !== sessionId) continue;
            const match = /^(qqbot|weixin):([^:]+):(group|c2c|private):(.+)$/.exec(key);
            if (!match || match[3] !== 'group') continue;
            return { botId: match[2], openid: match[4] };
        }
    } catch { /* 忽略 */ }
    return null;
}

export function mountArchive2(ctx, logger) {
    const state = readState();
    const settings = readConfig();

    const snapshot = () => {
        const groups = [];
        for (const [botId, bucket] of Object.entries(state.groups)) {
            for (const [openid, info] of Object.entries(bucket ?? {})) {
                groups.push({
                    botId,
                    botName: info.botName || botId,
                    openid,
                    name: info.name || '',
                    folder: info.folder,
                    createdAt: info.createdAt,
                    messages: info.messages ?? 0,
                });
            }
        }
        const bridged = settings.bridgeBots.map(botId => {
            const bucket = state.groups[botId] ?? {};
            const entries = Object.entries(bucket).map(([openid, info]) => ({ openid, ...info }));
            const botName = entries[0]?.botName || botId;
            const outDir = join(settings.root, `${sanitize(botName)}工程信息`);
            return {
                botId,
                botName,
                outDir,
                groups: entries.map(info => {
                    const label = sanitize(info.name || info.folder);
                    const groupDir = join(outDir, label);
                    return {
                        label,
                        dir: groupDir,
                        hasLog: existsSync(join(groupDir, '输出', '施工日志.xlsx')),
                        hasLedger: existsSync(join(groupDir, '输出', '单价台账.xlsx')),
                    };
                }),
            };
        });
        return {
            root: settings.root,
            autoOrganize: settings.autoOrganize,
            bridgeBots: settings.bridgeBots,
            bridged,
            modes: listModes(),
            groups,
        };
    };

    const doRename = async (botId, openid, name) => {
        const hit = findGroup(state, openid, { botId, openid });
        if (!hit) throw new Error('这个群还没有归档记录，先在群里发一条消息');
        const botDir = sanitize(hit.info.botName || hit.botId);
        const oldDir = join(settings.root, botDir, sanitize(hit.info.folder));
        const newFolder = sanitize(name);
        const newDir = join(settings.root, botDir, newFolder);
        if (existsSync(oldDir) && oldDir !== newDir) {
            await mkdir(join(settings.root, botDir), { recursive: true });
            renameSync(oldDir, newDir);
        }
        hit.info.name = String(name);
        hit.info.folder = newFolder;
        await writeJson(STATE_PATH, state);
        return { ok: true, folder: newFolder, name: String(name) };
    };
    setArchiveApi({ rename: doRename, snapshot });

    let organizing = false;
    const runOrganize = async () => {
        if (organizing) {
            logger?.warn?.('qq-archive-2: 上一轮整理还没结束，跳过本次');
            return { messages: 0, media: 0, root: settings.root, skipped: true };
        }
        organizing = true;
        let result;
        try {
            result = await organize(state, settings.root, logger);
        }
        finally {
            organizing = false;
        }
        await writeJson(STATE_PATH, state);
        logger?.info?.(`qq-archive-2: 整理完成 messages=${result.messages} media=${result.media}`);

        // 桥接：为选中的机器人生成结构化归档
        const bridged = [];
        for (const botId of settings.bridgeBots) {
            const bucket = state.groups[botId] ?? {};
            const groups = Object.entries(bucket).map(([openid, info]) => ({ openid, ...info }));
            const botName = groups[0]?.botName || botId;
            try {
                const built = await buildWiki(settings.root, botName, groups, logger);
                bridged.push({ botId, botName, ...built });
            }
            catch (err) {
                logger?.warn?.(`qq-archive-2: 桥接 ${botId} 失败: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        if (bridged.length > 0) logger?.info?.(`qq-archive-2: 桥接完成 ${bridged.length} 个机器人`);
        return { ...result, bridged };
    };

    let stopTimer = () => { };
    const startTimer = () => {
        if (!settings.autoOrganize || settings.intervalMinutes <= 0) return () => { };
        const timer = setInterval(() => {
            void runOrganize().catch(err => logger?.warn?.(`qq-archive-2: ${err instanceof Error ? err.message : String(err)}`));
        }, Math.max(1, settings.intervalMinutes) * 60 * 1000);
        timer.unref?.();
        return () => clearInterval(timer);
    };
    stopTimer = startTimer();
    ctx.effect(() => () => stopTimer(), 'qq-archive-2.timer');
    setTimeout(() => { void runOrganize().catch(() => { }); }, 5_000).unref?.();

    const tools = ctx.get('tools');
    if (tools?.register) {
        tools.register({
            name: 'archive2_status',
            description: '查看群聊归档根目录、已登记的群与各自消息数。',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
            output: { render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value).slice(0, 800) }], schema: { type: 'object', properties: { root: { type: 'string' }, autoOrganize: { type: 'boolean' }, groups: { type: 'array', items: { type: 'object' } } }, required: ['root', 'groups'], additionalProperties: false } },
            async execute() {
                return snapshot();
            },
        });
        tools.register({
            name: 'archive2_organize',
            description: '立即执行一次群聊归档整理。',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
            output: { render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value).slice(0, 800) }], schema: { type: 'object', properties: { messages: { type: 'integer' }, media: { type: 'integer' }, root: { type: 'string' } }, required: ['messages', 'media', 'root'], additionalProperties: false } },
            async execute() {
                return runOrganize();
            },
        });
        tools.register({
            name: 'archive2_rename_group',
            description: '把当前群聊的归档文件夹改名。用户在群里说「这个群叫 XXX」时调用；不传 group 时自动用当前会话所在群。',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: '新的群聊名称（作为文件夹名）' },
                    group: { type: 'string', description: '可选：群 openid 或现有文件夹名；省略则用当前会话所在群' },
                },
                required: ['name'],
                additionalProperties: false,
            },
            output: { render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value).slice(0, 800) }], schema: { type: 'object', properties: { ok: { type: 'boolean' }, folder: { type: 'string' }, name: { type: 'string' } }, required: ['ok', 'folder', 'name'], additionalProperties: false } },
            async execute(args, exec) {
                const hit = findGroup(state, args.group, currentSessionGroup(exec));
                if (!hit) throw new Error('archive2_rename_group: 找不到对应的群，先让群里产生一条消息，或显式传 group');
                const botDir = sanitize(hit.info.botName || hit.botId);
                const oldDir = join(settings.root, botDir, sanitize(hit.info.folder));
                const newFolder = sanitize(args.name);
                const newDir = join(settings.root, botDir, newFolder);
                if (existsSync(oldDir) && oldDir !== newDir) {
                    await mkdir(join(settings.root, botDir), { recursive: true });
                    renameSync(oldDir, newDir);
                }
                hit.info.name = String(args.name);
                hit.info.folder = newFolder;
                await writeJson(STATE_PATH, state);
                return { ok: true, folder: newFolder, name: String(args.name) };
            },
        });
        tools.register({
            name: 'qqbot_set_mode',
            description: '设置某个机器人的策略（作用于它所有群）。collect=静默收集全部消息但只在被 @ 时回复；off=完全不收集、只在被 @ 时回复；active=也归档、并且每条消息都回复。省略 bot 时设置当前会话所属的机器人。',
            parameters: {
                type: 'object',
                properties: {
                    mode: { type: 'string', enum: ['collect', 'off', 'active'], description: '目标策略' },
                    bot: { type: 'string', description: '可选：机器人 id；省略则用当前会话所属机器人' },
                },
                required: ['mode'],
                additionalProperties: false,
            },
            output: { render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value).slice(0, 800) }], schema: { type: 'object', properties: { ok: { type: 'boolean' }, mode: { type: 'string' }, bot: { type: 'string' } }, required: ['ok', 'mode', 'bot'], additionalProperties: false } },
            async execute(args, exec) {
                const hint = currentSessionGroup(exec);
                const botId = String(args.bot || hint?.botId || '');
                if (!botId) throw new Error('qqbot_set_mode: 无法确定机器人，请显式传 bot');
                setBotMode(botId, args.mode);
                return { ok: true, mode: args.mode, bot: botId };
            },
        });
        tools.register({
            name: 'qqbot_day_summary',
            description: '获取某天某个群的群聊摘要素材：消息数、图片数、参与者、抽到的工程分项/单位/单价，以及若干条要点原文。用户说「总结一下今天的群」「今天干了什么」时调用，然后用这些素材写成中文总结。',
            parameters: {
                type: 'object',
                properties: {
                    group: { type: 'string', description: '群名 / 群编号 / openid；省略则用当前会话所在群' },
                    date: { type: 'string', description: '日期：今天 / 昨天 / YYYY-MM-DD；省略=今天' },
                },
                additionalProperties: false,
            },
            output: {
                render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value).slice(0, 1500) }],
                schema: {
                    type: 'object',
                    properties: {
                        date: { type: 'string' },
                        group: { type: 'string' },
                        messages: { type: 'integer' },
                        images: { type: 'integer' },
                        text: { type: 'string' },
                    },
                    required: ['date', 'group', 'messages', 'images', 'text'],
                    additionalProperties: false,
                },
            },
            async execute(args, exec) {
                const hint = currentSessionGroup(exec);
                const groups = listArchivedGroups(String(config.id ?? ''));
                const date = parseDayArg(args?.date) ?? todayKey(0);
                let target = null;
                const query = String(args?.group ?? '').trim();

                if (query === '') {
                    if (hint === null) throw new Error('qqbot_day_summary: 当前不在群里，请指定 group');
                    target = groups.find(item => item.openid === hint.openid) ?? null;
                }
                else if (/^\d+$/.test(query)) {
                    target = groups[Number(query) - 1] ?? null;
                }
                else {
                    target = groups.find(item => item.openid === query || item.label === query) ?? null;
                }
                if (target === null) {
                    const known = groups.map(item => item.label).join('、') || '（暂无）';
                    throw new Error(`qqbot_day_summary: 找不到群「${query}」。已知群：${known}`);
                }

                const botNames = [config.name, ...((config.bots ?? []).map(item => item.name))].filter(Boolean);
                const digest = buildDayDigest(String(config.id ?? ''), target.openid, date, { skipSenders: botNames });
                return {
                    date,
                    group: target.label,
                    messages: digest.messages,
                    images: digest.images,
                    text: formatDigest(digest, target.label),
                };
            },
        });
        tools.register({
            name: 'qqbot_modes',
            description: '查看所有群的回复模式配置。',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
            output: { render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value).slice(0, 800) }], schema: { type: 'object', properties: { default: { type: 'string' }, groups: { type: 'object' } }, required: ['default', 'groups'], additionalProperties: false } },
            async execute() {
                return listModes();
            },
        });
    }

    ctx.inject(['webServer'], (scoped) => {
        const webServer = scoped.webServer;
        if (!webServer?.register) {
            logger?.warn?.('qq-archive-2: webServer 不可用，面板接口未注册（工具仍可用）');
            return;
        }
        if (!webServer?.register) {
        }
        const sendJson = (res, status, body) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify(body));
        };
        const readBody = async req => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        if (chunks.length === 0) return {};
        try {
            return JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
            return {};
        }
        };
        const trusted = req => {
        const origin = req.headers.origin;
        if (origin === undefined) return true;
        try {
            return new URL(origin).host === req.headers.host;
        } catch {
            return false;
        }
        };

        const dispose = webServer.register({
        kind: 'exact',
        path: '/archive2',
        handler: async (req, res) => {
            if (!trusted(req)) {
                sendJson(res, 403, { error: 'forbidden' });
                return;
            }
            if (req.method === 'GET' || req.method === 'HEAD') {
                sendJson(res, 200, snapshot());
                return;
            }
            if (req.method !== 'POST') {
                sendJson(res, 405, { error: 'method not allowed' });
                return;
            }
            const body = await readBody(req);
            const action = typeof body?.action === 'string' ? body.action : '';
            if (action === 'organize') {
                const result = await runOrganize();
                sendJson(res, 200, { ok: true, ...result, ...snapshot() });
                return;
            }
            if (action === 'setMode') {
                const mode = String(body?.mode ?? '');
                const bot = String(body?.bot ?? '');
                if (!MODES.includes(mode)) {
                    sendJson(res, 400, { ok: false, error: `未知策略: ${mode}` });
                    return;
                }
                if (!bot) {
                    sendJson(res, 400, { ok: false, error: '缺少 bot' });
                    return;
                }
                setBotMode(bot, mode);
                sendJson(res, 200, { ok: true, ...snapshot() });
                return;
            }
            if (action === 'setDefaultMode') {
                const mode = String(body?.mode ?? '');
                if (!MODES.includes(mode)) {
                    sendJson(res, 400, { ok: false, error: `未知模式: ${mode}` });
                    return;
                }
                setDefaultMode(mode);
                sendJson(res, 200, { ok: true, ...snapshot() });
                return;
            }
            if (action === 'update') {
                const result = await updateFromRepo(logger);
                sendJson(res, result.ok ? 200 : 500, { ...result });
                return;
            }
            if (action === 'checkUpdate') {
                const result = await checkRepoVersion();
                sendJson(res, result.ok ? 200 : 500, { ...result });
                return;
            }
            if (action === 'setBridge') {
                const botId = String(body?.bot ?? '').trim();
                if (!botId) {
                    sendJson(res, 400, { ok: false, error: '缺少 bot' });
                    return;
                }
                const next = new Set(settings.bridgeBots);
                if (body?.enabled === false) next.delete(botId);
                else next.add(botId);
                settings.bridgeBots = [...next];
                await writeJson(CONFIG_PATH, settings);
                sendJson(res, 200, { ok: true, ...snapshot() });
                return;
            }
            if (action === 'commands') {
                sendJson(res, 200, { ok: true, commands: COMMANDS });
                return;
            }
            if (action === 'listDir') {
                const wanted = typeof body?.path === 'string' && body.path.trim()
                    ? body.path.trim()
                    : homedir();
                try {
                    const dirents = await Promise.race([
                        readdir(wanted, { withFileTypes: true }),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('目录响应超时（5 秒），磁盘可能已休眠或掉线')), 5000)),
                    ]);
                    const entries = dirents
                        .filter(item => item.isDirectory() && !item.name.startsWith('.'))
                        .slice(0, 300)
                        .map(item => ({ name: item.name, path: join(wanted, item.name) }))
                        .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
                    sendJson(res, 200, {
                        ok: true,
                        path: wanted,
                        parent: dirname(wanted),
                        entries,
                    });
                }
                catch (err) {
                    sendJson(res, 400, {
                        ok: false,
                        error: `无法读取目录 ${wanted}: ${err instanceof Error ? err.message : String(err)}`,
                    });
                }
                return;
            }
            if (action === 'setRoot') {
                const raw = body?.root;
                const root = typeof raw === 'string'
                    ? raw.trim()
                    : String(raw && (raw.path || raw.directory) || '').trim();
                if (!root) {
                    sendJson(res, 400, { ok: false, error: 'root 必须是非空字符串路径' });
                    return;
                }
                settings.root = root;
                await writeJson(CONFIG_PATH, settings);
                await mkdir(root, { recursive: true });
                sendJson(res, 200, { ok: true, ...snapshot() });
                return;
            }
            if (action === 'setAuto') {
                const enabled = body?.enabled !== false;
                const minutes = Number(body?.intervalMinutes);
                settings.autoOrganize = enabled;
                if (Number.isFinite(minutes) && minutes > 0) settings.intervalMinutes = minutes;
                await writeJson(CONFIG_PATH, settings);
                stopTimer();
                stopTimer = startTimer();
                sendJson(res, 200, { ok: true, ...snapshot() });
                return;
            }
            if (action === 'rename') {
                const hit = findGroup(state, body?.group, undefined);
                if (!hit) {
                    sendJson(res, 404, { ok: false, error: '找不到该群' });
                    return;
                }
                const botDir = sanitize(hit.info.botName || hit.botId);
                const oldDir = join(settings.root, botDir, sanitize(hit.info.folder));
                const newFolder = sanitize(body?.name);
                const newDir = join(settings.root, botDir, newFolder);
                if (existsSync(oldDir) && oldDir !== newDir) {
                    await mkdir(join(settings.root, botDir), { recursive: true });
                    renameSync(oldDir, newDir);
                }
                hit.info.name = String(body?.name ?? '');
                hit.info.folder = newFolder;
                await writeJson(STATE_PATH, state);
                sendJson(res, 200, { ok: true, ...snapshot() });
                return;
            }
            sendJson(res, 400, { ok: false, error: `未知操作: ${action || '(空)'}` });
        },
        });

        scoped.effect(() => () => {
            try {
                dispose?.();
            } catch { /* 忽略 */ }
        }, 'qq-archive-2.route');
    });
}

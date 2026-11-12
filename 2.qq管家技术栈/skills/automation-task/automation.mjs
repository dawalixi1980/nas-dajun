#!/usr/bin/env node
/**
 * automation.mjs —— 「自动化任务」技能的执行器。
 *
 * 设计要点：
 *   1. 机器人身份取自当前会话绑定（DSH_SESSION_ID → model-prefs.json），
 *      不靠猜、不靠默认值，从源头保证多机器人的任务互不串。
 *   2. 所有写操作都走插件自带接口（/qqbot/automation），
 *      由运行中的引擎直接落盘并热更新，无需重启。
 *   3. 群名 → openid 走本地登记表（~/.dsh-qqbot/groups.json），按机器人分桶。
 *
 * 命令：
 *   whoami                                     我是哪个机器人 / 在哪个群
 *   bots                                       可用机器人
 *   groups [--bot <id>]                        已登记的群
 *   learn --openid <id> --name <群名> [--bot]   登记群名
 *   list [--bot <id>]                          任务列表
 *   add --name <名> --cron "<cron>" --prompt <内容>
 *       [--bot <id>] [--group <群名|openid|本群>] [--private <openid>]
 *       [--disabled] [--dry-run] [--no-prefix]
 *   remove --id <任务id>
 *   toggle --id <任务id> [--off]
 *   run    --id <任务id>
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const QQ_HOME = process.env.QQBOT_HOME ?? join(homedir(), '.dsh-qqbot');
const PREFS_PATH = join(QQ_HOME, 'model-prefs.json');
const GROUPS_PATH = join(QQ_HOME, 'groups.json');
const BASE_URL = (process.env.DSH_WEB_URL ?? process.env.DSH_WEB_URL ?? 'http://127.0.0.1:55746').replace(/\/+$/, '');
const ENDPOINT = `${BASE_URL}/qqbot/automation`;

// ── 基础工具 ────────────────────────────────────────────────
function fail(message, code = 1) {
    console.error(`✗ ${message}`);
    process.exit(code);
}

function readJson(path, fallback) {
    try {
        if (!existsSync(path)) return fallback;
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        return fallback;
    }
}

function writeJsonAtomic(path, data) {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, path);
}

function parseArgs(argv) {
    const positional = [];
    const flags = {};
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        if (!token.startsWith('--')) {
            positional.push(token);
            continue;
        }
        const key = token.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
            flags[key] = next;
            i += 1;
        } else {
            flags[key] = true;
        }
    }
    return { positional, flags };
}

async function api(body) {
    const init = body === undefined
        ? { method: 'GET' }
        : {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        };
    let response;
    try {
        response = await fetch(ENDPOINT, { ...init, signal: AbortSignal.timeout(10_000) });
    } catch (err) {
        fail(`连不上自动化接口 ${ENDPOINT}（DSH 桌面端没在运行？）\n  原因：${err instanceof Error ? err.message : String(err)}`);
    }
    const text = await response.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        fail(`接口返回非 JSON（${response.status}）：${text.slice(0, 200)}`);
    }
    return { status: response.status, data };
}

// ── 身份解析 ────────────────────────────────────────────────
const SESSION_KEY = /^(qqbot|weixin):([^:]+):(group|c2c|private):(.+)$/;

/** 当前会话绑定：{ botId, kind, peerId } */
function currentIdentity() {
    const sessionId = process.env.DSH_SESSION_ID ?? '';
    if (sessionId === '') return null;
    const prefs = readJson(PREFS_PATH, {});
    const map = prefs?.sessionIds ?? {};
    for (const [key, value] of Object.entries(map)) {
        if (value !== sessionId) continue;
        const match = SESSION_KEY.exec(key);
        if (!match) continue;
        return {
            platform: match[1],
            botId: match[2],
            kind: match[3] === 'group' ? 'group' : 'private',
            peerId: match[4],
            sessionKey: key,
        };
    }
    return null;
}

/** 从会话映射里推已出现过的群 openid（按机器人分桶） */
function discoveredGroups(botId) {
    const prefs = readJson(PREFS_PATH, {});
    const out = new Set();
    for (const key of Object.keys(prefs?.sessionIds ?? {})) {
        const match = SESSION_KEY.exec(key);
        if (!match || match[1] !== 'qqbot') continue;
        if (match[3] !== 'group') continue;
        if (botId !== undefined && match[2] !== botId) continue;
        out.add(`${match[2]}:${match[4]}`);
    }
    return [...out].map(item => {
        const [bot, openid] = item.split(':');
        return { botId: bot, openid };
    });
}

function groupRegistry() {
    const data = readJson(GROUPS_PATH, {});
    return data && typeof data === 'object' ? data : {};
}

/** 群名 → openid（严格限定在指定机器人下查找） */
function resolveGroup(botId, query) {
    if (query === '本群' || query === '当前群') {
        const me = currentIdentity();
        if (!me || me.kind !== 'group' || me.botId !== botId) return null;
        return me.peerId;
    }
    if (/^[0-9A-F]{16,}$/i.test(query)) return query; // 已经是 openid
    const bucket = groupRegistry()[botId] ?? {};
    for (const [openid, name] of Object.entries(bucket)) {
        if (name === query) return openid;
    }
    return null;
}

// ── cron 可读化 ─────────────────────────────────────────────
const WEEK_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

function describeCron(expression) {
    const fields = String(expression ?? '').trim().split(/\s+/);
    if (fields.length !== 5) return `cron 非法（需要 5 段）：${expression}`;
    const [minute, hour, day, month, weekday] = fields;
    const pad = value => String(value).padStart(2, '0');
    if (minute === '*' && hour === '*' && day === '*' && month === '*' && weekday === '*') {
        return '每分钟';
    }
    if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && day === '*' && month === '*' && weekday === '*') {
        return `每天 ${pad(hour)}:${pad(minute)}`;
    }
    if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && day === '*' && month === '*' && weekday === '1-5') {
        return `工作日 ${pad(hour)}:${pad(minute)}`;
    }
    if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && day === '*' && month === '*' && /^[\d,]+$/.test(weekday)) {
        const days = weekday.split(',').map(n => WEEK_NAMES[Number(n) % 7] ?? n).join('、');
        return `每周${days} ${pad(hour)}:${pad(minute)}`;
    }
    if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && /^\d+$/.test(day) && month === '*' && weekday === '*') {
        return `每月 ${day} 号 ${pad(hour)}:${pad(minute)}`;
    }
    if (minute.startsWith('*/') && hour === '*' && day === '*' && month === '*' && weekday === '*') {
        return `每 ${minute.slice(2)} 分钟`;
    }
    return `cron ${expression}`;
}

function validateCron(expression) {
    const fields = String(expression).trim().split(/\s+/);
    if (fields.length !== 5) return `cron 需要 5 段（分 时 日 月 周），收到 ${fields.length} 段`;
    const ranges = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
    for (let i = 0; i < 5; i += 1) {
        const [min, max] = ranges[i];
        for (const part of fields[i].split(',')) {
            const token = part.trim();
            const [rangePart, stepPart] = token.split('/');
            if (stepPart !== undefined && !(Number(stepPart) > 0)) return `cron 步长非法：${token}`;
            if (rangePart === '*') continue;
            if (rangePart.includes('-')) {
                const [a, b] = rangePart.split('-').map(Number);
                if (!Number.isInteger(a) || !Number.isInteger(b) || a < min || b > max || a > b) {
                    return `cron 第 ${i + 1} 段取值非法：${token}（允许 ${min}-${max}）`;
                }
                continue;
            }
            const value = Number(rangePart);
            if (!Number.isInteger(value) || value < min || value > max) {
                return `cron 第 ${i + 1} 段取值非法：${token}（允许 ${min}-${max}）`;
            }
        }
    }
    return null;
}

// ── 命令 ────────────────────────────────────────────────────
async function cmdWhoami() {
    const me = currentIdentity();
    if (!me) {
        console.log('当前会话没有绑定任何机器人（可能是桌面端新建的独立会话）。');
        console.log('→ 需要用户明确指定机器人后再创建任务。');
        return;
    }
    const { data } = await api();
    const bot = (data.bots ?? []).find(item => item.id === me.botId);
    console.log(`机器人：${bot?.name ?? '(未注册)'}（id=${me.botId}，平台=${bot?.platform ?? me.platform}）`);
    console.log(`会话类型：${me.kind === 'group' ? '群聊' : '私聊'}`);
    if (me.kind === 'group') {
        const name = groupRegistry()[me.botId]?.[me.peerId];
        console.log(`群 openid：${me.peerId}${name ? `（已登记名：${name}）` : '（尚未登记名字，可用 learn 登记）'}`);
    } else {
        console.log(`对方 openid：${me.peerId}`);
    }
}

async function cmdBots() {
    const { data } = await api();
    for (const bot of data.bots ?? []) {
        console.log(`${bot.ready ? '●' : '○'} ${bot.name}  id=${bot.id}  平台=${bot.platform}${bot.ready ? '' : '（未就绪）'}`);
    }
}

async function cmdGroups(flags) {
    const { data } = await api();
    const registry = groupRegistry();
    const botId = typeof flags.bot === 'string' ? flags.bot : undefined;
    const rows = new Map();
    for (const item of discoveredGroups(botId)) {
        rows.set(`${item.botId}:${item.openid}`, { ...item, name: registry[item.botId]?.[item.openid] ?? null });
    }
    // 登记表里有但没会话记录的也算
    for (const [bot, bucket] of Object.entries(registry)) {
        if (botId !== undefined && bot !== botId) continue;
        for (const [openid, name] of Object.entries(bucket ?? {})) {
            const key = `${bot}:${openid}`;
            if (!rows.has(key)) rows.set(key, { botId: bot, openid, name });
        }
    }
    if (rows.size === 0) {
        console.log('还没有已知的群。等机器人收到群消息后会自动出现。');
        return;
    }
    for (const row of rows.values()) {
        const botName = (data.bots ?? []).find(b => b.id === row.botId)?.name ?? row.botId;
        console.log(`[${botName}] ${row.name ?? '(未命名)'}  ${row.openid}`);
    }
}

async function cmdLearn(flags) {
    const openid = String(flags.openid ?? '').trim();
    const name = String(flags.name ?? '').trim();
    if (openid === '' || name === '') fail('learn 需要 --openid 和 --name');
    let botId = String(flags.bot ?? '').trim();
    if (botId === '') {
        const me = currentIdentity();
        if (!me) fail('没有 --bot，当前会话也没绑定机器人，无法确定归属');
        botId = me.botId;
    }
    const registry = groupRegistry();
    registry[botId] = registry[botId] ?? {};
    registry[botId][openid] = name;
    try {
        writeJsonAtomic(GROUPS_PATH, registry);
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`✗ 群名没能保存到 ${GROUPS_PATH}`);
        console.error(`  原因：${reason}`);
        console.error('  当前会话的文件沙箱通常只允许写工作区，登记群名需要授权。');
        console.error('  可选办法：');
        console.error('    1) 直接用 openid 建任务（--group <openid>），不依赖登记表；');
        console.error('    2) 在桌面端会话里执行同一条命令（那里可以授权）；');
        console.error(`    3) 手动在该文件里补一条："${botId}": { "${openid}": "${name}" }`);
        process.exit(3);
    }
    console.log(`✓ 已登记：机器人 ${botId} 的群 ${openid} → ${name}`);
}

async function cmdList(flags) {
    const { data } = await api();
    const botFilter = typeof flags.bot === 'string' ? flags.bot : undefined;
    const bots = new Map((data.bots ?? []).map(bot => [bot.id, bot.name]));
    const registry = groupRegistry();
    const tasks = (data.tasks ?? []).filter(task => botFilter === undefined || task.action?.botId === botFilter);
    if (tasks.length === 0) {
        console.log('没有任务。');
        return;
    }
    for (const task of tasks) {
        const botName = bots.get(task.action?.botId) ?? task.action?.botId ?? '(无机器人)';
        const target = task.action?.target ?? {};
        const targetText = target.kind === 'group'
            ? `群 ${registry[task.action?.botId]?.[target.id] ?? target.id}`
            : target.kind === 'private' ? `私聊 ${target.id}` : '事件来源';
        const when = task.trigger?.type === 'time'
            ? describeCron(task.trigger?.cron)
            : `收到含「${task.trigger?.keyword ?? '*'}」的消息`;
        console.log(`${task.enabled ? '●' : '○'} ${task.id}  ${task.name}`);
        console.log(`   ${botName} → ${targetText} ｜ ${when}`);
        if (task.lastResult) console.log(`   上次：${task.lastResult}`);
    }
}

async function cmdAdd(flags) {
    const name = String(flags.name ?? '').trim();
    const cron = String(flags.cron ?? '').trim();
    const prompt = String(flags.prompt ?? '').trim();
    if (name === '') fail('缺少 --name（任务名）');
    if (prompt === '') fail('缺少 --prompt（要发给模型执行的指令）');
    const cronError = validateCron(cron);
    if (cronError) fail(cronError);

    // 机器人：命令行显式指定 > 当前会话绑定；都没有就拒绝（绝不猜）
    let botId = String(flags.bot ?? '').trim();
    if (botId === '') {
        const me = currentIdentity();
        if (!me) fail('当前会话没有绑定机器人，请用 --bot 指定（先跑 bots 看可选列表）');
        botId = me.botId;
    }

    const { data: snapshot } = await api();
    const bot = (snapshot.bots ?? []).find(item => item.id === botId);
    if (!bot) {
        const available = (snapshot.bots ?? []).map(item => `${item.name}(${item.id})`).join('、');
        fail(`机器人 id「${botId}」不存在。可用：${available}`);
    }

    // 目标：时间触发必须显式，否则引擎没法知道发给谁
    let target;
    if (typeof flags.private === 'string' && flags.private.trim() !== '') {
        target = { kind: 'private', id: flags.private.trim() };
    } else if (typeof flags.group === 'string' && flags.group.trim() !== '') {
        const query = flags.group.trim();
        // 防串：这个 openid 若只出现在别的机器人名下，拒绝写入
        if (/^[0-9A-F]{16,}$/i.test(query)) {
            const knownToOthers = discoveredGroups().filter(item => item.openid === query && item.botId !== botId);
            const knownToThis = discoveredGroups(botId).some(item => item.openid === query);
            if (knownToOthers.length > 0 && !knownToThis && flags.force !== true) {
                const owners = knownToOthers.map(item => item.botId).join('、');
                fail(`openid ${query} 属于别的机器人（${owners}），不属于「${bot.name}」。\n  确认无误要强行写入，加 --force。`);
            }
        }
        const openid = resolveGroup(botId, query);
        if (openid === null) {
            const known = discoveredGroups(botId)
                .map(item => groupRegistry()[botId]?.[item.openid] ? `  ${groupRegistry()[botId][item.openid]}  ${item.openid}` : `  (未命名)  ${item.openid}`)
                .join('\n');
            fail(`在机器人「${bot.name}」名下找不到群「${flags.group}」。\n已知的群：\n${known || '  （暂无）'}\n→ 先用 learn 登记名字，或直接传 openid，群内可用「本群」。`);
        }
        target = { kind: 'group', id: openid };
    } else {
        fail('缺少发送目标：用 --group <群名|openid|本群> 或 --private <openid>');
    }

    const prefix = flags['no-prefix'] === true ? '' : `【${bot.name}】`;
    const task = {
        name: `${prefix}${name}`,
        enabled: flags.disabled !== true,
        trigger: { type: 'time', cron },
        action: { botId, prompt, target },
    };

    if (flags['dry-run'] === true) {
        console.log(JSON.stringify(task, null, 2));
        return;
    }

    const { status, data } = await api({ action: 'add', task });
    if (status !== 200 || data.ok !== true) {
        fail(`写入失败（${status}）：${data.error ?? JSON.stringify(data).slice(0, 300)}`);
    }
    const created = (data.tasks ?? []).find(item => item.name === task.name);
    const targetText = target.kind === 'group'
        ? `群 ${groupRegistry()[botId]?.[target.id] ?? target.id}`
        : `私聊 ${target.id}`;
    console.log(`✓ 已创建：${task.name}`);
    console.log(`  任务 id：${created?.id ?? '(未知)'}`);
    console.log(`  机器人：${bot.name}（${botId}）`);
    console.log(`  目标：${targetText}`);
    console.log(`  时间：${describeCron(cron)} ｜ cron ${cron}`);
    console.log(`  ${task.enabled ? '已启用' : '已停用（enabled=false，需手动开启）'}`);
}

async function cmdRemove(flags) {
    const id = String(flags.id ?? '').trim();
    if (id === '') fail('缺少 --id');
    const { status, data } = await api({ action: 'remove', id });
    if (status !== 200 || data.ok !== true) fail(`删除失败（${status}）：${data.error ?? ''}`);
    console.log(`✓ 已删除任务 ${id}`);
}

async function cmdToggle(flags) {
    const id = String(flags.id ?? '').trim();
    if (id === '') fail('缺少 --id');
    const enabled = flags.off !== true;
    const { status, data } = await api({ action: 'toggle', id, enabled });
    if (status !== 200 || data.ok !== true) fail(`切换失败（${status}）：${data.error ?? ''}`);
    console.log(`✓ 任务 ${id} 已${enabled ? '启用' : '停用'}`);
}

async function cmdRun(flags) {
    const id = String(flags.id ?? '').trim();
    if (id === '') fail('缺少 --id');
    const { status, data } = await api({ action: 'run', id });
    if (status !== 200 || data.ok !== true) fail(`触发失败（${status}）：${data.error ?? ''}`);
    console.log(`✓ 已触发任务 ${id}，结果写入任务状态（用 list 查看）`);
}

// ── 入口 ────────────────────────────────────────────────────
const { positional, flags } = parseArgs(process.argv.slice(2));
const command = positional[0];

const handlers = {
    whoami: cmdWhoami,
    bots: cmdBots,
    groups: cmdGroups,
    learn: cmdLearn,
    list: cmdList,
    add: cmdAdd,
    remove: cmdRemove,
    toggle: cmdToggle,
    run: cmdRun,
};

if (command === undefined || handlers[command] === undefined) {
    console.log(`用法：node automation.mjs <命令> [参数]

  whoami                                   当前机器人身份（含群 openid）
  bots                                     可用机器人
  groups [--bot <id>]                      已知的群
  learn --openid <id> --name <群名> [--bot] 登记群名
  list [--bot <id>]                        任务列表
  add --name <名> --cron "<5段cron>" --prompt <指令>
      [--bot <id>] [--group <群名|openid|本群>] [--private <openid>]
      [--disabled] [--dry-run] [--no-prefix]
  remove --id <任务id>
  toggle --id <任务id> [--off]
  run    --id <任务id>`);
    process.exit(command === undefined ? 0 : 1);
}

await handlers[command](flags);

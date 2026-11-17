/**
 * qqbot_automation_add —— 让模型在 /todo 会话里创建定时任务。
 *
 * 目标定位顺序：显式 group（群名 / 文件夹名 / openid / 本群）
 *   → 当前会话所在群（model-prefs 反查）
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLUGIN_HOME } from '../shared/dirs.js';

const STATE_PATH = join(PLUGIN_HOME, 'archive2', 'state.json');
const PREFS_PATH = join(PLUGIN_HOME, 'model-prefs.json');

/**
 * 按会话过滤任务：默认只看「当前机器人 + 当前会话目标」的任务。
 * 返回带序号（从 1 开始）的数组，序号用于 /todo del 和自然语言删除。
 */
export function tasksForSession(engine, exec, config, all) {
    const hint = currentSessionTarget(exec);
    const botId = hint?.botId || String(config?.id ?? '');
    const peerId = hint?.peerId || '';
    const tasks = engine.list().filter(task => {
        if (task.action?.botId !== botId) return false;
        if (all) return true;
        return task.action?.target?.id === peerId;
    });
    return tasks.map((task, index) => ({
        index: index + 1,
        id: task.id,
        name: task.name,
        enabled: task.enabled !== false,
        cron: task.trigger?.cron ?? '',
        kind: task.action?.target?.kind ?? 'group',
        target: task.action?.target?.id ?? '',
        lastResult: task.lastResult ?? '',
    }));
}

/** 供 /todo list 等命令读取任务列表 */
let engineRef = null;
export function setAutomationEngine(engine) {
    engineRef = engine;
}
export function getAutomationEngine() {
    return engineRef;
}

function readJson(path, fallback) {
    try {
        if (!existsSync(path)) return fallback;
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        return fallback;
    }
}

function currentSessionTarget(exec) {
    const sessionId = exec?.agent?.session?.id;
    if (!sessionId) return null;
    const prefs = readJson(PREFS_PATH, {});
    for (const [key, value] of Object.entries(prefs?.sessionIds ?? {})) {
        if (value !== sessionId) continue;
        const match = /^(qqbot|weixin):([^:]+):(group|c2c|private):(.+)$/.exec(key);
        if (!match) continue;
        return {
            botId: match[2],
            kind: match[3] === 'group' ? 'group' : 'private',
            peerId: match[4],
        };
    }
    return null;
}

/** 在归档登记表里按 群名 / 文件夹名 / openid 查目标群 */
function findGroupByQuery(botId, query) {
    const state = readJson(STATE_PATH, {});
    const bucket = state?.groups?.[botId] ?? {};
    for (const [openid, info] of Object.entries(bucket)) {
        if (openid === query || info?.name === query || info?.folder === query) {
            return { botId, openid };
        }
    }
    return null;
}

function listKnownGroups(botId) {
    const state = readJson(STATE_PATH, {});
    const bucket = state?.groups?.[botId] ?? {};
    return Object.entries(bucket).map(([openid, info]) => ({
        openid,
        label: info?.name || info?.folder || openid.slice(0, 8),
    }));
}

export function registerAutomationTool(ctx, engine, registry, config, logger) {
    setAutomationEngine(engine);
    const tools = ctx.get('tools');
    if (!tools?.register) {
        logger?.warn?.('qqbot: tools 服务不可用，qqbot_automation_add 未注册');
        return;
    }

    tools.register({
        name: 'qqbot_automation_add',
        description: '创建一个定时自动化任务：按 cron 在指定群定时发送由模型生成的一段内容。'
            + '群可以用群名、归档文件夹名或 openid 指定，也可以传「本群」表示当前会话所在的群。'
            + '任务执行时没有工具、没有历史，只能根据 prompt 直接生成文本，因此 prompt 要写成明确的产出指令。',
        parameters: {
            type: 'object',
            properties: {
                group: {
                    type: 'string',
                    description: '目标：群名 / 归档文件夹名 / 群 openid；传「本群」或「当前私聊」表示当前会话',
                },
                cron: {
                    type: 'string',
                    description: '5 段 cron（分 时 日 月 周），如每天 9 点 = "0 9 * * *"，每 10 分钟 = "*/10 * * * *"',
                },
                prompt: {
                    type: 'string',
                    description: '任务执行时给模型的指令，要求直接产出可发送的文本',
                },
                name: {
                    type: 'string',
                    description: '可选：任务名称，便于在列表里识别',
                },
                bot: {
                    type: 'string',
                    description: '可选：机器人 id；省略则用当前会话所属机器人',
                },
            },
            required: ['group', 'cron', 'prompt'],
            additionalProperties: false,
        },
        output: {
            render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value).slice(0, 800) }],
            schema: {
                type: 'object',
                properties: {
                    ok: { type: 'boolean' },
                    id: { type: 'string' },
                    group: { type: 'string' },
                    cron: { type: 'string' },
                },
                required: ['ok', 'id', 'group', 'cron'],
                additionalProperties: false,
            },
        },
        async execute(args, exec) {
            const hint = currentSessionTarget(exec);
            const botId = String(args.bot || hint?.botId || registry.list().find(item => item.ready)?.id || '');
            if (!botId) throw new Error('qqbot_automation_add: 找不到可用机器人');

            const query = String(args.group ?? '').trim();
            const here = query === '' || query === '本群' || query === '当前群' || query === '当前私聊' || query === '私聊';
            let targetKind = 'group';
            let targetId = '';

            if (here) {
                if (!hint || hint.botId !== botId) {
                    throw new Error('qqbot_automation_add: 当前会话对不上机器人，请显式指定目标');
                }
                targetKind = hint.kind;
                targetId = hint.peerId;
            }
            else {
                const hit = findGroupByQuery(botId, query);
                if (!hit) {
                    const known = listKnownGroups(botId).map(item => item.label).join('、') || '（暂无）';
                    throw new Error(`qqbot_automation_add: 找不到群「${query}」。已知群：${known}`);
                }
                targetKind = 'group';
                targetId = hit.openid;
            }

            const result = engine.upsert({
                name: String(args.name || `${query} 定时任务`),
                enabled: true,
                trigger: { type: 'time', cron: String(args.cron) },
                action: {
                    botId,
                    prompt: String(args.prompt),
                    target: { kind: targetKind, id: targetId },
                },
            });
            if (!result.ok) throw new Error(`创建失败：${result.error}`);
            return { ok: true, id: result.task.id, group: targetId, cron: result.task.trigger.cron };
        },
    });

    tools.register({
        name: 'qqbot_automation_list',
        description: '列出自动化定时任务，返回带序号（index）的列表。默认只列当前会话的任务；用户说「列出全部」时传 all=true。',
        parameters: {
            type: 'object',
            properties: {
                all: { type: 'boolean', description: 'true=列出这个机器人的全部任务；省略=只列当前会话' },
            },
            additionalProperties: false,
        },
        output: {
            render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value).slice(0, 1200) }],
            schema: { type: 'object', properties: { tasks: { type: 'array', items: { type: 'object' } } }, required: ['tasks'], additionalProperties: false },
        },
        async execute(args, exec) {
            return { tasks: tasksForSession(engine, exec, config, args?.all === true) };
        },
    });

    tools.register({
        name: 'qqbot_automation_remove',
        description: '删除一个自动化定时任务。可以传 id，也可以传序号（来自 qqbot_automation_list 的 index）。用户说「删掉第2个」时用 index=2。',
        parameters: {
            type: 'object',
            properties: {
                id: { type: 'string', description: '任务 id；与 index 二选一' },
                index: { type: 'integer', description: '任务序号（从 1 开始）；与 id 二选一' },
                all: { type: 'boolean', description: '配合 index：序号来自全部列表而非当前会话' },
            },
            additionalProperties: false,
        },
        output: {
            render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value).slice(0, 400) }],
            schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
        },
        async execute(args, exec) {
            let id = String(args.id ?? '').trim();
            if (id === '') {
                const tasks = tasksForSession(engine, exec, config, args.all === true);
                const target = tasks[Number(args.index) - 1];
                if (!target) throw new Error(`没有第 ${args.index} 个任务（当前共 ${tasks.length} 个）`);
                id = target.id;
            }
            const result = engine.remove(id);
            if (!result.ok) throw new Error(result.error || '删除失败');
            return { ok: true };
        },
    });

    logger?.info?.('qqbot: 自动化工具已注册（add / list / remove）');
}
